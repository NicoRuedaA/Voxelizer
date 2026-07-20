/* Immutable, budgeted batch manifests and deterministic archive naming. */
(function (root) {
  const MAX_BATCH_JOBS = 256;
  const MAX_BATCH_INPUT_BYTES = 128 * 1024 * 1024;
  const MAX_BATCH_EXPECTED_OUTPUT_BYTES = 128 * 1024 * 1024;
  const MAX_BATCH_OUTPUT_BYTES = 128 * 1024 * 1024;

  function budgetError(code, message) {
    const error = new RangeError(message); error.code = code; return error;
  }
  function frameCount(sheet) {
    return Math.max(1, (sheet.c | 0) * (sheet.r | 0));
  }
  function baseName(name) {
    const value = String(name || 'item').replace(/\\/g, '/').split('/').pop().replace(/\.[a-z0-9]+$/i, '') || 'item';
    return value.replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_');
  }
  function viewRole(kind) {
    return kind === 'depthMap' ? 'depthmap' : kind;
  }
  function allocateBaseNames(names) {
    const used = new Set();
    return names.map(name => {
      const stem = baseName(name);
      let candidate = stem, suffix = 2;
      while (used.has(candidate.toLowerCase())) candidate = `${stem}-${suffix++}`;
      used.add(candidate.toLowerCase());
      return candidate;
    });
  }
  function pixelBytes(pixels) {
    return pixels && pixels.data && typeof pixels.data.byteLength === 'number' ? pixels.data.byteLength : 0;
  }
  function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    return value;
  }
  function _mirrorBack(source) {
    const { w, h, data } = source;
    const mirrored = new data.constructor(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (w - 1 - x + w * y) * 4;
        const dst = (x + w * y) * 4;
        mirrored[dst] = data[src];
        mirrored[dst + 1] = data[src + 1];
        mirrored[dst + 2] = data[src + 2];
        mirrored[dst + 3] = data[src + 3];
      }
    }
    return { w, h, data: mirrored };
  }
  function slicePixels(source, sheet, frame) {
    const cols = Math.max(1, sheet.c | 0), rows = Math.max(1, sheet.r | 0);
    if (cols === 1 && rows === 1) return source;
    const w = Math.floor(source.w / cols), h = Math.floor(source.h / rows);
    if (w < 1 || h < 1) throw budgetError('BATCH_FRAME_DIMENSIONS_INVALID', 'Spritesheet cells must be at least one pixel');
    const safeFrame = Math.max(0, Math.min(frame | 0, cols * rows - 1));
    const ox = (safeFrame % cols) * w, oy = Math.floor(safeFrame / cols) * h;
    const data = new source.data.constructor(w * h * 4);
    for (let y = 0; y < h; y++) {
      const start = ((ox + source.w * (oy + y)) * 4);
      data.set(source.data.subarray(start, start + w * 4), y * w * 4);
    }
    return { w, h, data };
  }
  function createManifest(sourceItems, opts, sheet, adapters) {
    const readPixels = adapters.readPixels;
    const clone = adapters.clone;
    const alignmentFor = adapters.alignmentFor || (() => ({}));
    const records = [...sourceItems];
    const frames = frameCount(sheet);
    const totalJobs = records.length * frames;
    if (totalJobs > MAX_BATCH_JOBS) throw budgetError('BATCH_JOB_BUDGET_EXCEEDED', `Batch has ${totalJobs} jobs; maximum is ${MAX_BATCH_JOBS}`);
    const bases = allocateBaseNames(records.map(record => record.name));
    let inputBytes = 0, expectedOutputBytes = 0;
    const snapshotPixels = (value, label) => {
      const pixels = readPixels(value);
      const bytes = pixelBytes(pixels);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_BATCH_INPUT_BYTES - inputBytes) {
        throw budgetError('BATCH_INPUT_BUDGET_EXCEEDED', `Batch snapshots exceed ${MAX_BATCH_INPUT_BYTES} bytes before cloning ${label}`);
      }
      inputBytes += bytes;
      return clone(pixels);
    };
    const depth = Math.max(1, ((opts.depth && opts.depth.layers) || opts.depth || 1) | 0);
    const snapshots = records.map((record, index) => {
      const source = snapshotPixels(record.canvas, `${record.name} source`);
      const viewSnapshots = {};
      for (const kind of ['back', 'left', 'right', 'side', 'top', 'depthMap']) {
        if (record[kind]) viewSnapshots[kind] = snapshotPixels(record[kind], `${record.name} ${kind}`);
      }
      if (opts.inferenceEnabled && !viewSnapshots.back) {
        viewSnapshots.back = _mirrorBack(source);
      }
      const itemOpts = clone(opts);
      itemOpts.alignment = clone(alignmentFor(record));
      const frameW = Math.floor(source.w / Math.max(1, sheet.c | 0));
      const frameH = Math.floor(source.h / Math.max(1, sheet.r | 0));
      expectedOutputBytes += frameW * frameH * depth * 16 * frames;
      return {
        uiRecord: record,
        name: String(record.name),
        archiveBase: bases[index],
        source,
        views: viewSnapshots,
        viewMetadata: clone(record.viewMetadata || {}),
        opts: itemOpts,
        role: 'front',
      };
    });
    if (expectedOutputBytes > MAX_BATCH_EXPECTED_OUTPUT_BYTES) throw budgetError('BATCH_EXPECTED_OUTPUT_BUDGET_EXCEEDED', `Estimated batch output is ${expectedOutputBytes} bytes; maximum is ${MAX_BATCH_EXPECTED_OUTPUT_BYTES}`);
    return { records: snapshots, sheet: clone(sheet), totalFrames: frames, totalJobs, inputBytes, expectedOutputBytes };
  }
  function jobAt(manifest, index) {
    if (!Number.isInteger(index) || index < 0 || index >= manifest.totalJobs) return null;
    const recordIndex = Math.floor(index / manifest.totalFrames), frame = index % manifest.totalFrames;
    const record = manifest.records[recordIndex];
    if (!record || record.role !== 'front') return null;
    const views = { frame, views: [] };
    for (const kind of Object.keys(record.views)) {
      const source = record.views[kind];
      if (!source) continue;
      const metadata = record.viewMetadata[kind] || { frameMode: 'static' };
      const pixels = metadata.frameMode === 'sheet' ? slicePixels(source, manifest.sheet, frame) : cloneValue(source);
      views.views.push({ role: viewRole(kind), pixels, confidence: 1, frameMetadata: { ...cloneValue(metadata), selectedFrame: frame } });
    }
    return {
      recordIndex,
      record: record.uiRecord,
      name: record.name,
      archiveBase: record.archiveBase,
      frame,
      totalFrames: manifest.totalFrames,
      pixels: manifest.totalFrames === 1 ? cloneValue(record.source) : slicePixels(record.source, manifest.sheet, frame),
      opts: cloneValue(record.opts),
      views,
    };
  }
  function createProgress(manifest) {
    return manifest.records.map(() => ({ processed: 0, succeeded: 0, failed: 0, status: 'queued' }));
  }
  function markProgress(progress, recordIndex, succeeded) {
    const state = progress[recordIndex];
    state.processed++;
    if (succeeded) state.succeeded++; else state.failed++;
    state.status = state.processed === 0 ? 'queued' : (state.processed >= state.total ? (state.failed ? 'failed' : 'done') : 'progress');
    return state;
  }
  function setProgressTotals(progress, totalFrames) {
    progress.forEach(state => { state.total = totalFrames; });
    return progress;
  }
  function dataBytes(value) {
    if (typeof value === 'string') return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).byteLength : value.length * 2;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return 0;
  }
  function appendOutput(archive, files, outputState) {
    const added = files.reduce((sum, file) => sum + dataBytes(file.data), 0);
    const next = outputState.bytes + added;
    if (next > (outputState.maxBytes || MAX_BATCH_OUTPUT_BYTES)) throw budgetError('BATCH_OUTPUT_BUDGET_EXCEEDED', `Batch output exceeds ${outputState.maxBytes || MAX_BATCH_OUTPUT_BYTES} bytes`);
    archive.push(...files); outputState.bytes = next; return next;
  }
  function terminalLabel(state) {
    if (state.cancelled) return 'Batch cancelado';
    if (state.failed) return 'Error de batch';
    return state.failures ? `Batch completado con ${state.failures} error(es)` : 'Batch completado';
  }

  root.VoxelBatch = {
    MAX_BATCH_JOBS,
    MAX_BATCH_INPUT_BYTES,
    MAX_BATCH_EXPECTED_OUTPUT_BYTES,
    MAX_BATCH_OUTPUT_BYTES,
    allocateBaseNames,
    appendOutput,
    createManifest,
    createProgress,
    frameCount,
    jobAt,
    markProgress,
    setProgressTotals,
    slicePixels,
    terminalLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
