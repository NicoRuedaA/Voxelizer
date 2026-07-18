/* Recoverable worker channel with immutable jobs and incarnation-safe events. */
(function (root) {
  function create(options) {
    const workerUrl = options.workerUrl || 'worker.js';
    const voxelize = options.voxelize;
    const transfer = options.transfer;
    const WorkerCtor = options.WorkerCtor === undefined ? root.Worker : options.WorkerCtor;
    const now = options.now || Date.now;
    const backoffBaseMs = options.backoffBaseMs == null ? 500 : Math.max(0, options.backoffBaseMs);
    let worker = null, nextJobId = 0, generation = 0, incarnation = 0, failures = 0, retryAfter = 0;
    const pending = new Map();

    function isCurrent(instance, identity) {
      return worker === instance && incarnation === identity;
    }
    function shutdown(instance) {
      const target = instance || worker;
      if (target) target.terminate();
      if (!instance || worker === instance) worker = null;
    }
    function fallback(job, reason) {
      const result = voxelize(job.pixels, job.opts, job.views);
      if (!validVoxelResult(result)) throw new Error('Main-thread voxelizer returned an invalid result');
      result.metrics.workerMode = 'main-thread';
      result.diagnostics.warnings.push({ code: 'WORKER_FALLBACK', stage: 'runtime', severity: 'warning', message: `Synchronous main-thread fallback: ${reason}. Worker retry remains enabled.` });
      return result;
    }
    function backoff() {
      failures++;
      retryAfter = now() + Math.min(10000, backoffBaseMs * (2 ** Math.min(failures, 4)));
    }
    function settleWithFallback(jobs, reason) {
      for (const job of jobs) {
        try { job.resolve(fallback(job.snapshot, reason)); }
        catch (error) { job.reject(error); }
      }
    }
    function failIncarnation(instance, identity, reason) {
      if (!isCurrent(instance, identity)) return;
      const jobs = [...pending.values()].filter(job => job.incarnation === identity);
      for (const job of jobs) pending.delete(job.jobId);
      shutdown(instance);
      backoff();
      settleWithFallback(jobs, reason);
    }
    function validVoxelResult(result) {
      if (!result || typeof result !== 'object') return false;
      if (!ArrayBuffer.isView(result.grid) || result.grid instanceof DataView) return false;
      if (!Array.isArray(result.dims) || result.dims.length !== 3 || !result.dims.every(value => Number.isSafeInteger(value) && value > 0)) return false;
      const cells = result.dims[0] * result.dims[1] * result.dims[2];
      if (!Number.isSafeInteger(cells) || result.grid.length !== cells) return false;
      return Number.isSafeInteger(result.voxels) && result.voxels >= 0
        && Array.isArray(result.palette)
        && Array.isArray(result.greedyFacesList)
        && result.metrics && typeof result.metrics === 'object'
        && result.diagnostics && typeof result.diagnostics === 'object'
        && Array.isArray(result.diagnostics.warnings);
    }
    function validSuccess(data) {
      return data && typeof data === 'object' && data.ok === true && validVoxelResult(data.result);
    }
    function ensureWorker() {
      if (typeof WorkerCtor !== 'function' || now() < retryAfter) return null;
      if (worker) return worker;
      let instance;
      try { instance = new WorkerCtor(workerUrl); }
      catch (_error) { backoff(); return null; }
      worker = instance;
      const identity = ++incarnation;
      instance.onmessage = event => {
        if (!isCurrent(instance, identity)) return;
        const data = event && event.data;
        if (!data || typeof data !== 'object' || typeof data.jobId !== 'string' || typeof data.ok !== 'boolean') {
          failIncarnation(instance, identity, 'worker-protocol-failure');
          return;
        }
        const job = pending.get(data.jobId);
        if (!job || job.incarnation !== identity || job.generation !== generation) {
          failIncarnation(instance, identity, 'worker-unknown-job');
          return;
        }
        if (data.ok === false) {
          pending.delete(data.jobId);
          job.reject(new Error(typeof data.error === 'string' && data.error ? data.error : 'Voxel worker failed'));
          return;
        }
        if (!validSuccess(data)) {
          failIncarnation(instance, identity, 'worker-invalid-reply');
          return;
        }
        pending.delete(data.jobId);
        failures = 0; retryAfter = 0;
        job.resolve(data.result);
      };
      instance.onerror = event => failIncarnation(instance, identity, event && event.message || 'worker-runtime-failure');
      instance.onmessageerror = () => failIncarnation(instance, identity, 'worker-message-failure');
      return instance;
    }
    function run(pixels, opts, views) {
      const snapshot = transfer.clone({ pixels, opts, views: views || {} });
      const active = ensureWorker();
      if (!active) return Promise.resolve(fallback(snapshot, typeof WorkerCtor !== 'function' ? 'worker-unavailable' : 'worker-retry-cooldown'));
      return new Promise((resolve, reject) => {
        const jobId = `job-${++nextJobId}`;
        const job = { jobId, resolve, reject, snapshot, generation, incarnation };
        pending.set(jobId, job);
        const payload = transfer.clone({ jobId, ...snapshot });
        try { active.postMessage(payload, transfer.buffers(payload)); }
        catch (_error) {
          failIncarnation(active, job.incarnation, 'worker-postmessage-failure');
        }
      });
    }
    function cancelPending(reason) {
      if (!pending.size) return;
      const jobs = [...pending.values()]; pending.clear(); generation++; shutdown();
      const error = new Error(reason || 'cancelled'); jobs.forEach(job => job.reject(error));
    }
    function dispose(reason) {
      const jobs = [...pending.values()]; pending.clear(); generation++; shutdown();
      const error = new Error(reason || 'cancelled'); jobs.forEach(job => job.reject(error));
    }
    return { run, cancelPending, dispose, status: () => ({ worker: !!worker, pending: pending.size, failures, retryAfter, generation, incarnation }) };
  }
  root.VoxelWorkerChannel = { create };
})(typeof window !== 'undefined' ? window : globalThis);
