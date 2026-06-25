const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixtures = require('./fixtures/reconstruction-fixtures.js');

function loadRuntime() {
  const context = { window: {}, console, TextEncoder };
  vm.createContext(context);
  const root = path.resolve(__dirname, '..', 'voxelizer');
  const files = ['voxel.js', 'voxio.js'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return {
    Voxel: context.window.Voxel,
    VoxIO: context.window.VoxIO,
  };
}

function loadScript(file, context) {
  const root = path.resolve(__dirname, '..', 'voxelizer');
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

function loadWorkerRuntime() {
  const messages = [];
  const context = {
    console,
    importScripts(...files) {
      for (const file of files) loadScript(file, context);
    },
    postMessage(message) {
      messages.push(message);
    },
  };
  context.self = context;
  vm.createContext(context);
  loadScript('worker.js', context);
  return {
    dispatch(data) {
      context.onmessage({ data });
      return messages.pop();
    },
  };
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tail = bytes.byteLength - 22;
  assert.equal(view.getUint32(tail, true), 0x06054b50);
  const total = view.getUint16(tail + 10, true);
  let offset = view.getUint32(tail + 16, true);
  const decoder = new TextDecoder();
  const names = [];
  for (let i = 0; i < total; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function makePixels(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (x + w * y) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { w, h, data };
}

function baseOpts(extra) {
  return Object.assign({
    depth: 1,
    alpha: 0,
    colors: 32,
    greedy: true,
    depthMode: 'uniform',
    relief: 1,
    dtRound: 1,
    poissonTension: 0,
    sfsGamma: 1,
    comboMix: 0.5,
    humTorso: 0.6,
    humRound: 1,
    humPrior: 0.4,
    humHead: 0.25,
    humSmooth: 0.3,
  }, extra || {});
}

test('alpha 0 no voxeliza pixeles totalmente transparentes', () => {
  const { Voxel } = loadRuntime();
  const pixels = makePixels(1, 1, () => [12, 34, 56, 0]);
  const result = Voxel.voxelize(pixels, baseOpts({ alpha: 0 }), {});
  assert.equal(result.voxels, 0);
  assert.deepEqual(Array.from(result.dims), [1, 1, 1]);
});

test('la cuantizacion remapea colores excedentes sin borrar voxeles', () => {
  const { Voxel } = loadRuntime();
  const pixels = makePixels(161, 1, x => [x, 0, 255 - x, 255]);
  const result = Voxel.voxelize(pixels, baseOpts({ colors: 32 }), {});
  assert.equal(result.voxels, 161);
  assert.equal(result.palette.length, 32);
});

test('el visual hull respeta la profundidad pedida en multivista', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(3, 1, () => [255, 255, 255, 255]);
  const shallow = Voxel.voxelize(front, baseOpts({ depth: 1 }), { side });
  const deep = Voxel.voxelize(front, baseOpts({ depth: 6 }), { side });
  assert.equal(shallow.dims[2], 1);
  assert.equal(shallow.voxels, 1);
  assert.equal(deep.dims[2], 6);
  assert.equal(deep.voxels, 6);
});

test('exportOBJ referencia el MTL solicitado sin AO', () => {
  const { Voxel, VoxIO } = loadRuntime();
  const pixels = makePixels(1, 1, () => [200, 120, 80, 255]);
  const result = Voxel.voxelize(pixels, baseOpts({ depth: 2 }), {});
  const exported = VoxIO.exportOBJ(result, { scale: 1, useAO: false, mtlName: 'hero.mtl' });
  assert.match(exported.obj, /mtllib hero\.mtl/);
  assert.doesNotMatch(exported.obj, /mtllib model\.mtl/);
});

test('exportOBJ referencia el MTL solicitado con AO', () => {
  const { Voxel, VoxIO } = loadRuntime();
  const pixels = makePixels(1, 1, () => [120, 180, 240, 255]);
  const result = Voxel.voxelize(pixels, baseOpts({ depth: 2 }), {});
  const exported = VoxIO.exportOBJ(result, {
    scale: 1,
    useAO: true,
    aoStrength: 0.8,
    annotateAO: Voxel.annotateAO,
    mtlName: 'hero-ao.mtl',
  });
  assert.match(exported.obj, /mtllib hero-ao\.mtl/);
  assert.match(exported.obj, /usemtl voxel/);
  assert.doesNotMatch(exported.obj, /mtllib model\.mtl/);
});

test('voxel.js expone Voxel en globalThis para compatibilidad con workers', () => {
  const context = { console };
  vm.createContext(context);
  loadScript('voxel.js', context);
  assert.ok(context.Voxel);
  assert.equal(typeof context.Voxel.voxelize, 'function');
});

test('la config versionada por defecto conserva el grid legacy actual', () => {
  const { Voxel } = loadRuntime();
  const pixels = fixtures.clonePixels(fixtures.frontL);
  const legacy = Voxel.defaultLegacyOptions();
  const config = Voxel.createDefaultConfig();
  const previous = Voxel.voxelize(pixels, legacy, {});
  const current = Voxel.voxelize(pixels, config, {});
  assert.deepEqual(Array.from(current.dims), Array.from(previous.dims));
  assert.deepEqual(Array.from(current.grid), Array.from(previous.grid));
  assert.deepEqual(current.palette, previous.palette);
});

test('normalizeConfig migra opciones legacy parciales sin perder defaults', () => {
  const { Voxel } = loadRuntime();
  const config = Voxel.normalizeConfig({
    alpha: 18,
    colors: 12,
    depth: 5,
    depthMode: 'combo',
    comboMix: 0.75,
    greedy: false,
    scale: 2.5,
    silhouette: { resampling: 'bilinear' },
    reconstruction: { mode: 'weighted', threshold: 0.6, sideWeight: 2.5 },
    alignment: { side: { offsetX: 8, rotation: 90, scale: 1.5 } },
    mesh: { ao: true, aoStrength: 0.35 },
  });
  assert.equal(config.version, 1);
  assert.equal(config.silhouette.alphaThreshold, 18);
  assert.equal(config.silhouette.resampling, 'bilinear');
  assert.equal(config.palette.colors, 12);
  assert.equal(config.depth.layers, 5);
  assert.equal(config.depth.profile, 'combo');
  assert.equal(config.depth.comboMix, 0.75);
  assert.equal(config.reconstruction.mode, 'weighted');
  assert.equal(config.reconstruction.threshold, 0.6);
  assert.equal(config.reconstruction.sideWeight, 2.5);
  assert.equal(config.mesh.greedy, false);
  assert.equal(config.mesh.scale, 2.5);
  assert.equal(config.mesh.ao, true);
  assert.equal(config.mesh.aoStrength, 0.35);
  assert.equal(config.alignment.side.offsetX, 8);
  assert.equal(config.alignment.side.rotation, 90);
  assert.equal(config.alignment.side.scale, 1.5);
  assert.equal(config.alignment.top.scale, 1);
});

test('voxelize devuelve metricas por etapa y estimacion de memoria', () => {
  const { Voxel } = loadRuntime();
  const result = Voxel.voxelize(fixtures.clonePixels(fixtures.frontL), Voxel.createDefaultConfig(), {
    side: fixtures.clonePixels(fixtures.sideFullDepth),
    top: fixtures.clonePixels(fixtures.topFullDepth),
  });
  assert.ok(result.metrics);
  assert.ok(result.metrics.totalMs >= 0);
  assert.ok(result.metrics.memoryEstimateBytes > 0);
  assert.ok(Object.prototype.hasOwnProperty.call(result.metrics.stageMs, 'normalizeConfig'));
  assert.ok(Object.prototype.hasOwnProperty.call(result.metrics.stageMs, 'prepareDepth'));
  assert.ok(Object.prototype.hasOwnProperty.call(result.metrics.stageMs, 'prepareSilhouettes'));
  assert.ok(Object.prototype.hasOwnProperty.call(result.metrics.stageMs, 'calculateOccupancy'));
  assert.ok(Object.prototype.hasOwnProperty.call(result.metrics.stageMs, 'extractMesh'));
});

test('worker conserva la configuracion normalizada en la respuesta', () => {
  const worker = loadWorkerRuntime();
  const message = worker.dispatch({
    jobId: 'job-1',
    pixels: fixtures.clonePixels(fixtures.frontL),
    opts: {
      silhouette: { alphaThreshold: 12, resampling: 'bilinear' },
      depth: { layers: 4, profile: 'dt', dtRound: 0.4 },
      reconstruction: { mode: 'weighted', threshold: 0.8, topWeight: 1.7 },
      mesh: { ao: true, aoStrength: 0.5, greedy: false },
    },
    views: {
      side: fixtures.clonePixels(fixtures.sideFullDepth),
    },
  });
  assert.equal(message.jobId, 'job-1');
  assert.equal(message.ok, true);
  assert.equal(message.result.configVersion, 1);
  assert.equal(message.result.config.silhouette.alphaThreshold, 12);
  assert.equal(message.result.config.silhouette.resampling, 'bilinear');
  assert.equal(message.result.config.depth.layers, 4);
  assert.equal(message.result.config.depth.profile, 'dt');
  assert.equal(message.result.config.depth.dtRound, 0.4);
  assert.equal(message.result.config.reconstruction.mode, 'weighted');
  assert.equal(message.result.config.reconstruction.threshold, 0.8);
  assert.equal(message.result.config.reconstruction.topWeight, 1.7);
  assert.equal(message.result.config.mesh.ao, true);
  assert.equal(message.result.config.mesh.greedy, false);
});

test('la alineacion multivista respeta el espejo horizontal esperado', () => {
  const { Voxel } = loadRuntime();
  const side = makePixels(3, 3, (x, y) => (x === 0 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const config = Voxel.createDefaultConfig();
  config.silhouette.alphaThreshold = 1;
  config.depth.layers = 3;
  config.alignment.side.flipX = true;
  const silhouettes = Voxel.prepareSilhouettes(config, { side }, [3, 3, 3]);
  assert.equal(silhouettes.previews.side.bounds.minX, 2);
  assert.equal(silhouettes.previews.side.bounds.maxX, 2);
  assert.equal(silhouettes.previews.side.bounds.minY, 1);
  assert.equal(silhouettes.previews.side.bounds.maxY, 1);
});

test('el autoajuste por bounding box elimina margenes al preparar la vista lateral', () => {
  const { Voxel } = loadRuntime();
  const side = makePixels(6, 6, (x, y) => (x >= 2 && x <= 3 && y >= 1 && y <= 4 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const manual = Voxel.createDefaultConfig();
  manual.silhouette.alphaThreshold = 1;
  manual.depth.layers = 4;
  const auto = Voxel.createDefaultConfig();
  auto.silhouette.alphaThreshold = 1;
  auto.depth.layers = 4;
  auto.alignment.side.autoFit = true;
  const manualPrep = Voxel.prepareSilhouettes(manual, { side }, [4, 4, 4]);
  const autoPrep = Voxel.prepareSilhouettes(auto, { side }, [4, 4, 4]);
  assert.ok(autoPrep.previews.side.bounds.width > manualPrep.previews.side.bounds.width);
  assert.equal(autoPrep.previews.side.bounds.width, 4);
  assert.equal(autoPrep.previews.side.bounds.height, 4);
});

test('rotaciones y espejos no cambian las dimensiones finales del volumen', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.frontL);
  const side = fixtures.clonePixels(fixtures.sideFullDepth);
  const base = Voxel.voxelize(front, Voxel.createDefaultConfig(), { side });
  const aligned = Voxel.createDefaultConfig();
  aligned.alignment.side.rotation = 90;
  aligned.alignment.side.flipX = true;
  const result = Voxel.voxelize(front, aligned, { side });
  assert.deepEqual(Array.from(result.dims), Array.from(base.dims));
});

test('una vista ausente no altera la reconstruccion de las vistas presentes', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.frontL);
  const side = fixtures.clonePixels(fixtures.sideFullDepth);
  const clean = Voxel.createDefaultConfig();
  clean.depth.layers = 4;
  const noisy = Voxel.createDefaultConfig();
  noisy.depth.layers = 4;
  noisy.alignment.top.offsetX = 14;
  noisy.alignment.top.offsetY = -9;
  noisy.alignment.top.rotation = 45;
  noisy.alignment.top.scale = 1.8;
  noisy.alignment.top.flipX = true;
  noisy.alignment.top.autoFit = true;
  const base = Voxel.voxelize(front, clean, { side });
  const same = Voxel.voxelize(front, noisy, { side });
  assert.deepEqual(Array.from(same.grid), Array.from(base.grid));
});

test('zip.js empaqueta multiples archivos en un ZIP valido', () => {
  const context = { window: {}, console, TextEncoder };
  vm.createContext(context);
  loadScript('zip.js', context);
  const zip = context.window.ZipUtil.createZip([
    { name: 'hero.obj', data: 'v 0 0 0\n' },
    { name: 'hero.mtl', data: 'newmtl voxel\n' },
    { name: 'hero.vox', data: new Uint8Array([1, 2, 3, 4]) },
  ], new Date('2024-01-02T03:04:05Z'));
  assert.ok(ArrayBuffer.isView(zip));
  assert.deepEqual(readZipEntries(zip), ['hero.obj', 'hero.mtl', 'hero.vox']);
});
