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

function makeVoxelResult(marker) {
  return {
    grid: new Int16Array([-1]),
    dims: [1, 1, 1],
    voxels: 0,
    palette: [],
    greedyFacesList: [],
    metrics: {},
    diagnostics: { warnings: [] },
    marker,
  };
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
  assert.equal(config.version, 2);
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
  assert.equal(message.result.configVersion, 2);
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

test('los perfiles conservan los grids legacy v1 cuando ancho local esta desactivado', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(3, 3, (x, y) => (x === 1 || y === 1)
    ? [50 + x * 70, 60 + y * 60, 100, 255] : [0, 0, 0, 0]);
  for (const [profile, expectedGrid] of Object.entries(fixtures.legacyDepthGrids)) {
    const config = Voxel.createDefaultConfig();
    config.depth.layers = 4;
    config.depth.profile = profile;
    config.depth.localWidthAware = false;
    assert.deepEqual(Array.from(Voxel.voxelize(front, config, {}).grid), expectedGrid, profile);
  }
});

test('valida dimensiones y longitud de payload antes de reconstruir', () => {
  const { Voxel } = loadRuntime();
  assert.throws(() => Voxel.voxelize({ w: 2, h: 2, data: new Uint8Array(3) }, {}, {}), /w\*h\*4/);
  assert.throws(() => Voxel.validatePixels({ w: 0, h: 1, data: new Uint8Array() }), /positive safe integers/);
});

test('el umbral alpha usa la misma semantica estricta en frontal y auxiliares', () => {
  const { Voxel } = loadRuntime();
  const equal = makePixels(1, 1, () => [255, 0, 0, 40]);
  const config = Voxel.createDefaultConfig();
  config.silhouette.alphaThreshold = 40;
  assert.equal(Voxel.voxelize(equal, config, {}).voxels, 0);
  assert.equal(Voxel.prepareSilhouettes(config, { side: equal }, [1, 1, 1]).previews.side.bounds, null);
});

test('preprocesamiento elimina ruido, cierra huecos y mantiene defaults conservadores', () => {
  const { Voxel } = loadRuntime();
  const noise = makePixels(3, 3, (x, y) => (x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const untouched = Voxel.createDefaultConfig();
  untouched.silhouette.alphaThreshold = 1;
  assert.equal(Voxel.voxelize(noise, untouched, {}).voxels, untouched.depth.layers);
  const clean = Voxel.createDefaultConfig();
  clean.silhouette.alphaThreshold = 1;
  clean.silhouette.enabled = true;
  clean.silhouette.denoiseRadius = 1;
  assert.equal(Voxel.voxelize(noise, clean, {}).voxels, 0);
  const gap = makePixels(3, 1, x => (x === 1 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
  clean.silhouette.denoiseRadius = 0;
  clean.silhouette.closeRadius = 1;
  assert.ok(Voxel.preprocessPixels(gap, clean.silhouette).data[7] > 0);
});

test('nearest, area y bilinear producen remuestreos de silueta validos', () => {
  const { Voxel } = loadRuntime();
  const side = makePixels(2, 1, x => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  for (const mode of ['nearest', 'area', 'bilinear']) {
    const config = Voxel.createDefaultConfig();
    config.silhouette.alphaThreshold = 1;
    config.silhouette.resampling = mode;
    const preview = Voxel.prepareSilhouettes(config, { side }, [1, 1, 4]).previews.side;
    assert.equal(preview.mask.length, 4);
    assert.ok(preview.bounds, mode);
  }
});

test('frontRatio 0, 0.5 y 1 desplaza el relieve hacia +Z frontal', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(7, 7, (x, y) => (x >= 1 && x <= 5 && y >= 1 && y <= 5) ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  const occupiedZ = ratio => {
    const config = Voxel.createDefaultConfig();
    config.depth.layers = 8; config.depth.profile = 'dt'; config.depth.mode = 'asymmetric'; config.depth.frontRatio = ratio;
    const result = Voxel.voxelize(front, config, {}), zs = [];
    for (let z = 0; z < 8; z++) if (result.grid[1 + 7 * (3 + 7 * z)] >= 0) zs.push(z);
    return zs;
  };
  assert.deepEqual(occupiedZ(0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(occupiedZ(0.5), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(occupiedZ(1), [2, 3, 4, 5, 6, 7]);
});

test('depth-map aplica fuerza e inversion y diagnostica cuando falta', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(2, 1, () => [255, 0, 0, 255]);
  const map = makePixels(2, 1, x => x ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const config = Voxel.createDefaultConfig();
  config.depth.layers = 4; config.depth.mode = 'depthmap'; config.depth.depthMapStrength = 1;
  const normal = Voxel.voxelize(front, config, { depthMap: map });
  config.depth.invertDepthMap = true;
  const inverted = Voxel.voxelize(front, config, { depthMap: map });
  assert.notDeepEqual(Array.from(normal.grid), Array.from(inverted.grid));
  const missing = Voxel.voxelize(front, config, {});
  assert.ok(missing.diagnostics.warnings.some(w => w.code === 'DEPTH_MAP_MISSING'));
});

test('strict y weighted aplican threshold, tolerancia y pesos por vista', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(3, 1, x => x === 1 ? [0, 255, 0, 255] : [0, 0, 0, 0]);
  const strict = Voxel.createDefaultConfig(); strict.depth.layers = 3;
  assert.equal(Voxel.voxelize(front, strict, { side }).voxels, 1);
  const weighted = Voxel.createDefaultConfig(); weighted.depth.layers = 3; weighted.reconstruction.mode = 'weighted'; weighted.reconstruction.threshold = 0.5;
  assert.equal(Voxel.voxelize(front, weighted, { side }).voxels, 3);
  weighted.reconstruction.threshold = 0.75;
  assert.equal(Voxel.voxelize(front, weighted, { side }).voxels, 1);
  weighted.reconstruction.threshold = 1;
  weighted.reconstruction.sideWeight = 0;
  assert.equal(Voxel.voxelize(front, weighted, { side }).voxels, 3);
  strict.reconstruction.edgeTolerance = 1;
  assert.equal(Voxel.voxelize(front, strict, { side }).voxels, 3);
});

test('hard-front constraint puede relajarse de forma explicita en weighted', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(3, 1, x => x === 1 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  const side = makePixels(2, 1, () => [255, 255, 255, 255]);
  const config = Voxel.createDefaultConfig();
  config.depth.layers = 2; config.reconstruction.mode = 'weighted'; config.reconstruction.threshold = 0.5;
  const constrained = Voxel.voxelize(front, config, { side });
  config.reconstruction.hardFrontConstraint = false;
  const relaxed = Voxel.voxelize(front, config, { side });
  assert.ok(relaxed.voxels > constrained.voxels);
});

test('diagnosticos identifican mascaras vacias y vistas contradictorias', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const empty = makePixels(3, 1, () => [0, 0, 0, 0]);
  const result = Voxel.voxelize(front, baseOpts({ depth: 3 }), { side: empty });
  const codes = result.diagnostics.warnings.map(w => w.code);
  assert.ok(codes.includes('EMPTY_VIEW'));
  assert.ok(codes.includes('EMPTY_RECONSTRUCTION'));
  assert.equal(result.diagnostics.views[0].role, 'side');
  assert.equal(result.debug.silhouettes.side.overlay.length, 3);
});

test('contrato views serializable conserva roles, orientacion, confianza y frames', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const full = makePixels(3, 1, () => [255, 255, 255, 255]);
  const center = makePixels(3, 1, x => x === 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const views = { frame: 1, views: [{
    id: 'profile', role: 'side', confidence: 0.4, frames: [full, center],
    orientation: { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
  }] };
  const config = Voxel.createDefaultConfig(); config.depth.layers = 3;
  const normalized = Voxel.normalizeViewInputs(views, config);
  assert.equal(normalized[0].id, 'profile');
  assert.equal(normalized[0].confidence, 0.4);
  assert.equal(normalized[0].orientation.horizontal, '+Z');
  assert.equal(Voxel.voxelize(front, config, views).voxels, 1);
  const unsupported = Voxel.voxelize(front, config, { views: [{ role: 'rear-oblique', pixels: full }] });
  assert.ok(unsupported.diagnostics.warnings.some(w => w.code === 'UNSUPPORTED_VIEW_ROLE'));
});

test('feather produce confianza espacial sin alterar la mascara binaria', () => {
  const { Voxel } = loadRuntime();
  const side = makePixels(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3) ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const config = Voxel.createDefaultConfig();
  config.silhouette.enabled = true; config.silhouette.feather = 0.5; config.silhouette.alphaThreshold = 1;
  const prepared = Voxel.prepareSilhouettes(config, { side }, [1, 5, 5]).prepared[0];
  assert.equal(prepared.mask[2 + 5 * 2], 1);
  assert.ok(prepared.confidenceMap[1 + 5] < prepared.confidenceMap[2 + 5 * 2]);
});

test('landmarks calibrados desplazan la silueta auxiliar de forma determinista', () => {
  const { Voxel } = loadRuntime();
  const side = makePixels(3, 1, x => x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const config = Voxel.createDefaultConfig(); config.depth.layers = 3; config.silhouette.alphaThreshold = 1;
  const prepared = Voxel.prepareSilhouettes(config, { views: [{ role: 'side', pixels: side, landmarks: [{ source: [0.5, 0.5], target: [2.5, 0.5] }] }] }, [1, 1, 3]);
  assert.equal(prepared.previews.side.bounds.maxX, 2);
});

test('fusion auxiliar usa RGB calibrado y conserva modo frontal compatible', () => {
  const { Voxel, VoxIO } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(3, 1, () => [0, 0, 255, 255]);
  const frontOnly = Voxel.createDefaultConfig(); frontOnly.depth.layers = 3;
  const conservative = Voxel.voxelize(front, frontOnly, { side });
  assert.equal(JSON.stringify(conservative.palette), '[[255,0,0]]');
  const fusedConfig = Voxel.createDefaultConfig(); fusedConfig.depth.layers = 3; fusedConfig.color.mode = 'auxiliary';
  const fused = Voxel.voxelize(front, fusedConfig, { side });
  assert.ok(fused.palette.some(c => c[2] > c[0]));
  assert.match(VoxIO.exportOBJ(fused, { mtlName: 'fused.mtl' }).mtl, /Kd 0\.0000 0\.0000 1\.0000/);
});

test('VOX nunca envuelve el indice interno 255 al indice reservado cero', () => {
  const { VoxIO } = loadRuntime();
  const palette = Array.from({ length: 256 }, (_, i) => [i, 0, 255 - i]);
  const bytes = VoxIO.exportVox({ grid: new Int16Array([255]), dims: [1, 1, 1], palette });
  const marker = [0x58, 0x59, 0x5a, 0x49];
  let offset = -1;
  for (let i = 0; i < bytes.length - 4; i++) if (marker.every((v, j) => bytes[i + j] === v)) { offset = i; break; }
  assert.ok(offset >= 0);
  assert.equal(bytes[offset + 12 + 4 + 3], 1);
  const rgba = bytes.findIndex((_, i) => bytes[i] === 0x52 && bytes[i + 1] === 0x47 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x41);
  assert.ok(rgba >= 0);
  assert.deepEqual(Array.from(bytes.slice(rgba + 12, rgba + 16)), [255, 0, 0, 255]);
});

test('config no anuncia malla smooth no implementada', () => {
  const { Voxel } = loadRuntime();
  const config = Voxel.normalizeConfig({ mesh: { mode: 'smooth', smoothing: 1, isoLevel: 0.2 } });
  assert.equal(config.mesh.mode, 'voxel');
  assert.equal(Object.prototype.hasOwnProperty.call(config.mesh, 'smoothing'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config.mesh, 'isoLevel'), false);
});

test('CONFIG_VERSION 2 migra v1 y round-trip de campos nuevos no deriva', () => {
  const { Voxel } = loadRuntime();
  const v1 = Voxel.normalizeConfig({ version: 1, depth: { profile: 'dt' }, color: { darken: 0.41 } });
  assert.equal(v1.version, 2);
  assert.equal(v1.depth.localWidthAware, false);
  const legacy = Voxel.legacyOptionsFromConfig(Voxel.normalizeConfig({
    depth: { localWidthAware: true }, color: { mode: 'auxiliary', side: 'darken', back: 'darken', darken: 0.41 },
  }));
  const roundTrip = Voxel.normalizeConfig(legacy);
  assert.equal(roundTrip.depth.localWidthAware, true);
  assert.equal(roundTrip.color.mode, 'auxiliary');
  assert.equal(roundTrip.color.side, 'darken');
  assert.equal(roundTrip.color.back, 'darken');
  assert.equal(roundTrip.color.darken, 0.41);
});

test('modulacion por ancho local es opt-in y no altera baseline por defecto', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(5, 3, (x, y) => (y === 1 || (x === 2 && y === 0)) ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const legacy = Voxel.createDefaultConfig(); legacy.depth.layers = 5; legacy.depth.profile = 'dt';
  const aware = Voxel.createDefaultConfig(); aware.depth.layers = 5; aware.depth.profile = 'dt'; aware.depth.localWidthAware = true;
  const legacyGrid = Array.from(Voxel.voxelize(front, legacy, {}).grid);
  const awareGrid = Array.from(Voxel.voxelize(front, aware, {}).grid);
  const explicitLegacy = Voxel.createDefaultConfig(); explicitLegacy.depth.layers = 5; explicitLegacy.depth.profile = 'dt'; explicitLegacy.depth.localWidthAware = false;
  assert.deepEqual(Array.from(Voxel.voxelize(front, explicitLegacy, {}).grid), legacyGrid);
  assert.notDeepEqual(awareGrid, legacyGrid);
});

test('dos landmarks resuelven escala, rotacion y traslacion alrededor del centro', () => {
  const { Voxel } = loadRuntime();
  const pixels = makePixels(10, 10, () => [255, 255, 255, 255]);
  const config = Voxel.createDefaultConfig();
  const view = Voxel.normalizeViewInputs({ views: [{
    role: 'top', pixels,
    landmarks: [{ source: [2, 2], target: [8, 3] }, { source: [6, 2], target: [8, 9] }],
  }] }, config)[0];
  const transform = Voxel._landmarkTransform(view, 10, 10);
  assert.ok(Math.abs(transform.scale - 1.5) < 1e-9);
  assert.ok(Math.abs(transform.rotation - 90) < 1e-9);
  assert.deepEqual(Array.from(Voxel._forwardTransformPoint([2, 2], 10, 10, transform), v => Math.round(v * 1e6) / 1e6), [8, 3]);
  assert.deepEqual(Array.from(Voxel._forwardTransformPoint([6, 2], 10, 10, transform), v => Math.round(v * 1e6) / 1e6), [8, 9]);
});

test('orientaciones no canonicas se ignoran con diagnostico estructurado', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(3, 1, () => [255, 255, 255, 255]);
  const result = Voxel.voxelize(front, { depth: { layers: 3 } }, { views: [{
    id: 'perspective-side', role: 'side', pixels: side,
    orientation: { projection: 'perspective', horizontal: '+X', vertical: '+Y' },
  }] });
  assert.equal(result.voxels, 3, 'invalid auxiliary view must be ignored');
  const warning = result.diagnostics.warnings.find(item => item.code === 'UNSUPPORTED_ORIENTATION');
  assert.equal(warning.view, 'perspective-side');
  assert.equal(warning.stage, 'input');
});

test('descriptores y landmarks malformados degradan a diagnosticos sin crash', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(1, 1, () => [255, 255, 255, 255]);
  const result = Voxel.voxelize(front, {}, { views: [null, { role: 'side', pixels: side, landmarks: [{ source: [0], target: null }] }] });
  const codes = result.diagnostics.warnings.map(item => item.code);
  assert.ok(codes.includes('MALFORMED_VIEW'));
  assert.ok(codes.includes('INVALID_LANDMARK'));
});

test('weighted con peso efectivo cero devuelve vacio y diagnostico', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const config = Voxel.createDefaultConfig();
  config.reconstruction.mode = 'weighted'; config.reconstruction.frontWeight = 0;
  config.reconstruction.sideWeight = 0; config.reconstruction.topWeight = 0;
  const result = Voxel.voxelize(front, config, {});
  assert.equal(result.voxels, 0);
  assert.ok(result.diagnostics.warnings.some(item => item.code === 'ZERO_TOTAL_WEIGHT'));
});

test('auxiliary sin fuente util conserva color frontal y politica back configurada', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [200, 100, 50, 255]);
  const config = Voxel.createDefaultConfig(); config.depth.layers = 2; config.color.mode = 'auxiliary';
  const withoutViews = Voxel.voxelize(front, config, {});
  assert.equal(JSON.stringify(withoutViews.palette), '[[200,100,50]]');
  const emptySide = makePixels(2, 1, () => [0, 0, 0, 0]);
  const ignored = Voxel.voxelize(front, config, { side: emptySide });
  assert.equal(JSON.stringify(ignored.palette), '[[200,100,50]]');
});

test('presupuestos rechazan tipos, pixels y volumen antes de asignaciones gigantes', () => {
  const { Voxel } = loadRuntime();
  assert.throws(() => Voxel.validatePixels({ w: 1, h: 1, data: [0, 0, 0, 0] }), /Uint8Array/);
  assert.throws(() => Voxel.validatePixels({ w: Number.MAX_SAFE_INTEGER, h: 2, data: new Uint8Array() }), error => error.code === 'PIXEL_DIMENSION_OVERFLOW');
  const tiny = makePixels(1, 1, () => [255, 255, 255, 255]);
  const oversized = { ...tiny, w: 4097, h: 1024, data: new Uint8Array(4097 * 1024 * 4) };
  assert.throws(() => Voxel.validatePixels(oversized), error => error.code === 'PIXEL_BUDGET_EXCEEDED');
  const largeFront = { w: 1024, h: 1024, data: new Uint8Array(1024 * 1024 * 4) };
  const config = Voxel.createDefaultConfig(); config.depth.layers = 17;
  assert.throws(() => Voxel.voxelize(largeFront, config, {}), error => error.code === 'VOXEL_BUDGET_EXCEEDED');
  config.depth.layers = 1; config.silhouette.enabled = true; config.silhouette.denoiseRadius = 16;
  assert.throws(() => Voxel.voxelize(largeFront, config, {}), error => error.code === 'MORPH_BUDGET_EXCEEDED');
  const meshFront = makePixels(200, 200, () => [255, 255, 255, 255]);
  const meshConfig = Voxel.createDefaultConfig(); meshConfig.depth.layers = 64;
  assert.throws(() => Voxel.voxelize(meshFront, meshConfig, {}), error => error.code === 'MESH_BUDGET_EXCEEDED');
});

test('previews, overlays y metricas se indexan por id para vistas del mismo rol', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(2, 1, () => [255, 255, 255, 255]);
  const result = Voxel.voxelize(front, { depth: { layers: 2 } }, { views: [
    { id: 'left-profile', role: 'side', pixels: side }, { id: 'right-profile', role: 'side', pixels: side },
  ] });
  assert.deepEqual(Object.keys(result.debug.views).sort(), ['left-profile', 'right-profile']);
  assert.deepEqual(Object.keys(result.metrics.viewBytes).sort(), ['left-profile', 'right-profile']);
  assert.ok(result.debug.views['left-profile'].overlay);
  assert.ok(result.debug.views['right-profile'].overlay);
});

test('depth-map strength compara espesor neutro, medio y completo', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(2, 1, () => [255, 0, 0, 255]);
  const map = makePixels(2, 1, x => x ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const voxelsAt = strength => {
    const config = Voxel.createDefaultConfig(); config.depth.layers = 4; config.depth.mode = 'depthmap'; config.depth.depthMapStrength = strength;
    return Voxel.voxelize(front, config, { depthMap: map }).voxels;
  };
  assert.equal(voxelsAt(0), 8);
  assert.ok(voxelsAt(0.5) < voxelsAt(0));
  assert.ok(voxelsAt(1) < voxelsAt(0.5));
});

test('VOX rechaza mas de 255 colores usados en lugar de corromper RGBA', () => {
  const { VoxIO } = loadRuntime();
  const palette = Array.from({ length: 256 }, (_, i) => [i, (i * 17) & 255, (i * 31) & 255]);
  assert.throws(() => VoxIO.exportVox({ grid: Int16Array.from({ length: 256 }, (_, i) => i), dims: [256, 1, 1], palette }), /at most 255/);
});

test('transfer helper deduplica buffers compartidos y clona payloads', () => {
  const context = { window: {}, console, structuredClone };
  vm.createContext(context); loadScript('transfer.js', context);
  const array = new Uint8Array([1, 2, 3]);
  const payload = { a: array, nested: [array] };
  assert.equal(context.window.VoxelTransfer.buffers(payload).length, 1);
  const clone = context.window.VoxelTransfer.clone(payload);
  clone.a[0] = 9;
  assert.equal(array[0], 1);
});

test('worker channel preserva worker idle, cancela pending y expone fallback', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const instances = [];
  class FakeWorker {
    constructor() { this.terminated = false; instances.push(this); }
    postMessage(payload) { this.payload = payload; }
    terminate() { this.terminated = true; }
  }
  const result = () => makeVoxelResult();
  const channel = context.window.VoxelWorkerChannel.create({ WorkerCtor: FakeWorker, voxelize: result, transfer: context.window.VoxelTransfer });
  const first = channel.run(makePixels(1, 1, () => [0, 0, 0, 0]), {}, {});
  instances[0].onmessage({ data: { jobId: instances[0].payload.jobId, ok: true, result: result() } });
  await first;
  channel.cancelPending('stale');
  assert.equal(instances[0].terminated, false, 'idle worker must be preserved');
  const second = channel.run(makePixels(1, 1, () => [0, 0, 0, 0]), {}, {});
  channel.cancelPending('stale');
  await assert.rejects(second, /stale/);
  assert.equal(instances[0].terminated, true);
  const fallback = context.window.VoxelWorkerChannel.create({ WorkerCtor: null, voxelize: result, transfer: context.window.VoxelTransfer });
  const degraded = await fallback.run(makePixels(1, 1, () => [0, 0, 0, 0]), {}, {});
  assert.equal(degraded.metrics.workerMode, 'main-thread');
  assert.ok(degraded.diagnostics.warnings.some(item => item.code === 'WORKER_FALLBACK'));
});

test('reconstruccion moderada mantiene metricas y tiempo de ejecucion acotados', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(64, 64, (x, y) => (x > 7 && x < 56 && y > 7 && y < 56) ? [x * 4, y * 4, 128, 255] : [0, 0, 0, 0]);
  const config = Voxel.createDefaultConfig(); config.depth.layers = 16;
  const started = Date.now(), result = Voxel.voxelize(front, config, {}), elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `elapsed=${elapsed}ms`);
  assert.ok(result.metrics.memoryEstimateBytes >= result.grid.byteLength);
  assert.ok(result.metrics.faceEstimateBytes > 0);
  assert.ok(result.metrics.bytesPerVoxel > 0);
});

test('presupuesto de caras rechaza checkerboards antes de crear objetos de malla', () => {
  const { Voxel } = loadRuntime();
  const dims = [64, 64, 64], grid = new Int16Array(dims[0] * dims[1] * dims[2]).fill(-1);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    if ((x + y + z) % 2 === 0) grid[x + dims[0] * (y + dims[1] * z)] = 0;
  }
  assert.throws(() => Voxel.extractMesh(grid, dims, Voxel.createDefaultConfig()), error => error.code === 'FACE_BUDGET_EXCEEDED');
});

test('presupuestos auxiliares limitan cantidad, pixels y morfologia individual y agregada', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 255, 255, 255]);
  const tiny = makePixels(1, 1, () => [255, 255, 255, 255]);
  assert.throws(() => Voxel.voxelize(front, {}, { views: Array.from({ length: 9 }, (_, index) => ({ id: `v${index}`, role: 'side', pixels: tiny })) }), error => error.code === 'VIEW_COUNT_BUDGET_EXCEEDED');

  const oversized = { w: 4097, h: 1024, data: new Uint8Array(4) };
  const oversizedResult = Voxel.voxelize(front, {}, { views: [{ id: 'oversized', role: 'side', pixels: oversized }] });
  assert.ok(oversizedResult.diagnostics.warnings.some(warning => warning.code === 'PIXEL_BUDGET_EXCEEDED' && warning.view === 'oversized'));

  const large = makePixels(2048, 1536, () => [255, 255, 255, 255]);
  assert.throws(() => Voxel.voxelize(front, {}, { views: [0, 1, 2].map(index => ({ id: `large${index}`, role: 'side', pixels: large })) }), error => error.code === 'AUX_PIXEL_BUDGET_EXCEEDED');

  const individual = makePixels(1024, 1024, () => [255, 255, 255, 255]);
  const individualConfig = Voxel.createDefaultConfig(); individualConfig.silhouette.enabled = true; individualConfig.silhouette.closeRadius = 4;
  assert.throws(() => Voxel.voxelize(front, individualConfig, { side: individual }), error => error.code === 'AUX_MORPH_BUDGET_EXCEEDED');

  const aggregate = makePixels(512, 512, () => [255, 255, 255, 255]);
  const aggregateConfig = Voxel.createDefaultConfig(); aggregateConfig.silhouette.enabled = true; aggregateConfig.silhouette.closeRadius = 3;
  assert.throws(() => Voxel.voxelize(front, aggregateConfig, { views: [0, 1, 2].map(index => ({ id: `morph${index}`, role: 'side', pixels: aggregate })) }), error => error.code === 'AUX_MORPH_TOTAL_BUDGET_EXCEEDED');
});

test('DT y Combo conservan grids v1 exactos en componentes desconectados desiguales', () => {
  const { Voxel } = loadRuntime();
  for (const mode of ['dt', 'combo']) {
    const config = Voxel.createDefaultConfig();
    config.depth.layers = 6; config.depth.profile = mode; config.depth.relief = 1; config.depth.localWidthAware = false;
    const result = Voxel.voxelize(fixtures.clonePixels(fixtures.disconnectedUnequal), config, {});
    assert.deepEqual(Array.from(result.grid), fixtures.disconnectedLegacyGrids[mode], mode);
    config.depth.localWidthAware = true;
    const local = Voxel.voxelize(fixtures.clonePixels(fixtures.disconnectedUnequal), config, {});
    assert.notDeepEqual(Array.from(local.grid), fixtures.disconnectedLegacyGrids[mode], `${mode} component-local mode must remain opt-in`);
  }
});

test('calibracion de dos landmarks con flipX mapea ambos puntos', () => {
  const { Voxel } = loadRuntime();
  const view = {
    pixels: makePixels(10, 10, () => [255, 255, 255, 255]),
    transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: true, autoFit: false },
    landmarks: [{ source: [2, 2], target: [8, 3] }, { source: [6, 2], target: [8, 9] }],
  };
  const transform = Voxel._landmarkTransform(view, 10, 10);
  for (const mark of view.landmarks) {
    const mapped = Voxel._forwardTransformPoint(mark.source, 10, 10, transform);
    assert.ok(Math.abs(mapped[0] - mark.target[0]) < 1e-9);
    assert.ok(Math.abs(mapped[1] - mark.target[1]) < 1e-9);
  }
});

test('ids reservados sobreviven en mapas de diagnostico con claves propias', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(2, 1, () => [255, 255, 255, 255]);
  const result = Voxel.voxelize(front, { depth: { layers: 2 } }, { views: [
    { id: '__proto__', role: 'side', pixels: side },
    { id: 'constructor', role: 'side', pixels: side },
  ] });
  assert.equal(Object.getPrototypeOf(result.debug.views), null);
  assert.ok(Object.hasOwn(result.debug.views, '__proto__'));
  assert.ok(Object.hasOwn(result.debug.views, 'constructor'));
  assert.ok(Object.hasOwn(result.metrics.viewBytes, '__proto__'));
});

test('colores auxiliares son especificos por cara y VOX declara fusion voxel lossless-imposible', () => {
  const { Voxel, VoxIO } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(2, 1, () => [0, 0, 255, 255]);
  const top = makePixels(1, 2, () => [0, 255, 0, 255]);
  const config = Voxel.createDefaultConfig();
  config.depth.layers = 2; config.color.mode = 'auxiliary'; config.color.back = 'darken'; config.color.darken = 0.5;
  const result = Voxel.voxelize(front, config, { side, top });
  const colorFor = normal => {
    const face = result.greedyFacesList.find(item => item.normal.every((value, index) => value === normal[index]));
    assert.ok(face, `missing face ${normal}`);
    return result.palette[face.color];
  };
  assert.deepEqual(Array.from(colorFor([0, 0, 1])), [255, 0, 0]);
  assert.deepEqual(Array.from(colorFor([0, 0, -1])), [128, 0, 0]);
  assert.deepEqual(Array.from(colorFor([1, 0, 0])), [0, 0, 255]);
  assert.deepEqual(Array.from(colorFor([0, 1, 0])), [0, 255, 0]);
  assert.equal(result.voxelColorPolicy, 'mean-of-exposed-face-colors');
  assert.deepEqual(Array.from(result.palette[result.grid[0]]), [26, 102, 102]);
  assert.deepEqual(Array.from(result.palette[result.grid[1]]), [51, 102, 102]);
  const exported = VoxIO.exportOBJ(result, { mtlName: 'faces.mtl' });
  for (const face of result.greedyFacesList) {
    assert.match(exported.obj, new RegExp(`usemtl color_${face.color}`));
    assert.match(exported.mtl, new RegExp(`newmtl color_${face.color}`));
  }
  const vox = VoxIO.exportVox(result);
  const rgbaOffset = vox.findIndex((_, index) => vox[index] === 0x52 && vox[index + 1] === 0x47 && vox[index + 2] === 0x42 && vox[index + 3] === 0x41);
  assert.ok(rgbaOffset >= 0);
  assert.deepEqual(Array.from(vox.slice(rgbaOffset + 12, rgbaOffset + 20)), [26, 102, 102, 255, 51, 102, 102, 255]);
});

test('worker channel conserva snapshot canonico, degrada replies nulas e ignora errores tardios', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const instances = [], fallbackBytes = [];
  class MutatingWorker {
    constructor() { instances.push(this); }
    postMessage(payload) { this.payload = payload; payload.pixels.data[0] = 99; }
    terminate() { this.terminated = true; }
  }
  const voxelize = pixels => {
    fallbackBytes.push(pixels.data[0]);
    return makeVoxelResult(pixels.data[0]);
  };
  const channel = context.window.VoxelWorkerChannel.create({ WorkerCtor: MutatingWorker, voxelize, transfer: context.window.VoxelTransfer, backoffBaseMs: 0 });
  const original = makePixels(1, 1, () => [7, 0, 0, 255]);
  const first = channel.run(original, {}, {});
  const companion = channel.run(makePixels(1, 1, () => [8, 0, 0, 255]), {}, {});
  instances[0].onmessage({ data: null });
  assert.equal((await first).marker, 7);
  assert.equal((await companion).marker, 8);
  assert.deepEqual(fallbackBytes, [7, 8]);

  const second = channel.run(original, {}, {});
  assert.equal(instances.length, 2);
  instances[0].onerror({ message: 'late stale failure' });
  assert.equal(channel.status().pending, 1);
  instances[1].onmessage({ data: { jobId: instances[1].payload.jobId, ok: true, result: makeVoxelResult('worker') } });
  assert.equal((await second).marker, 'worker');
});

test('worker protocol settlea toda la encarnacion ante ids, envelopes o dispatch invalidos', async () => {
  const context = { window: {}, console, structuredClone };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const createHarness = WorkerClass => {
    const instances = [];
    class Wrapped extends WorkerClass { constructor(...args) { super(...args); instances.push(this); } }
    const channel = context.window.VoxelWorkerChannel.create({ WorkerCtor: Wrapped, voxelize: pixels => makeVoxelResult(pixels.data[0]), transfer: context.window.VoxelTransfer, backoffBaseMs: 0 });
    return { channel, instances };
  };
  class PassiveWorker {
    postMessage(payload) { this.payload = payload; }
    terminate() { this.terminated = true; }
  }

  const unknown = createHarness(PassiveWorker);
  const unknownA = unknown.channel.run(makePixels(1, 1, () => [1, 0, 0, 255]), {}, {});
  const unknownB = unknown.channel.run(makePixels(1, 1, () => [2, 0, 0, 255]), {}, {});
  unknown.instances[0].onmessage({ data: { jobId: 'unknown-current-job', ok: true, result: makeVoxelResult() } });
  assert.deepEqual([(await unknownA).marker, (await unknownB).marker], [1, 2]);
  assert.equal(unknown.channel.status().pending, 0);

  const empty = createHarness(PassiveWorker);
  const emptyA = empty.channel.run(makePixels(1, 1, () => [3, 0, 0, 255]), {}, {});
  const emptyB = empty.channel.run(makePixels(1, 1, () => [4, 0, 0, 255]), {}, {});
  empty.instances[0].onmessage({ data: { jobId: empty.instances[0].payload.jobId, ok: true, result: {} } });
  assert.deepEqual([(await emptyA).marker, (await emptyB).marker], [3, 4]);
  assert.equal(empty.channel.status().pending, 0);

  class ThrowSecondWorker extends PassiveWorker {
    postMessage(payload) { this.calls = (this.calls || 0) + 1; if (this.calls === 2) throw new Error('second dispatch failed'); super.postMessage(payload); }
  }
  const dispatch = createHarness(ThrowSecondWorker);
  const dispatchA = dispatch.channel.run(makePixels(1, 1, () => [5, 0, 0, 255]), {}, {});
  const dispatchB = dispatch.channel.run(makePixels(1, 1, () => [6, 0, 0, 255]), {}, {});
  assert.deepEqual([(await dispatchA).marker, (await dispatchB).marker], [5, 6]);
  assert.equal(dispatch.channel.status().pending, 0);
});

test('manifest batch snapshottea una vez, genera lazy, limita memoria y nombres duplicados', () => {
  const context = { window: {}, console, structuredClone, TextEncoder };
  vm.createContext(context); loadScript('batch.js', context); loadScript('zip.js', context);
  const Batch = context.window.VoxelBatch;
  const source = makePixels(4, 2, (x, y) => [x, y, 0, 255]);
  const side = makePixels(4, 2, () => [0, 0, 255, 255]);
  let reads = 0;
  const records = [0, 1].map(() => ({ name: 'hero.png', canvas: source, side, viewMetadata: { side: { frameMode: 'static' } } }));
  const manifest = Batch.createManifest(records, { depth: 2 }, { c: 2, r: 1 }, {
    readPixels(value) { reads++; return value; }, clone: structuredClone, alignmentFor: () => ({}),
  });
  assert.equal(reads, 4, 'source and static side are each snapshotted once per record');
  assert.deepEqual(Array.from(manifest.records, record => record.archiveBase), ['hero', 'hero-2']);
  const archive = context.window.ZipUtil.createZip(manifest.records.map(record => ({ name: `${record.archiveBase}.vox`, data: new Uint8Array([1]) })), new Date(2024, 0, 1));
  assert.deepEqual(readZipEntries(archive), ['hero.vox', 'hero-2.vox']);
  const first = Batch.jobAt(manifest, 0);
  first.opts.depth = 99;
  first.views.views[0].pixels.data[0] = 99;
  first.pixels.data[0] = 99;
  const second = Batch.jobAt(manifest, 1);
  assert.notEqual(first.pixels, second.pixels);
  assert.notEqual(first.views.views[0].pixels, second.views.views[0].pixels);
  assert.equal(second.opts.depth, 2);
  assert.notEqual(second.views.views[0].pixels.data[0], 99);
  assert.notEqual(second.pixels.data[0], 99);
  const progress = Batch.setProgressTotals(Batch.createProgress(manifest), 2);
  Batch.markProgress(progress, 0, true); Batch.markProgress(progress, 0, false);
  assert.deepEqual({ processed: progress[0].processed, succeeded: progress[0].succeeded, failed: progress[0].failed, status: progress[0].status }, { processed: 2, succeeded: 1, failed: 1, status: 'failed' });
  assert.equal(Batch.terminalLabel({ cancelled: false, failed: false, failures: 0 }), 'Batch completado');

  const tooMany = Array.from({ length: Batch.MAX_BATCH_JOBS + 1 }, (_, index) => ({ name: `x${index}.png`, canvas: source }));
  assert.throws(() => Batch.createManifest(tooMany, { depth: 1 }, { c: 1, r: 1 }, { readPixels: value => value, clone: structuredClone }), error => error.code === 'BATCH_JOB_BUDGET_EXCEEDED');
  const huge = makePixels(1024, 1024, () => [0, 0, 0, 0]);
  assert.throws(() => Batch.createManifest([{ name: 'huge.png', canvas: huge }], { depth: 17 }, { c: 1, r: 1 }, { readPixels: value => value, clone: structuredClone }), error => error.code === 'BATCH_EXPECTED_OUTPUT_BUDGET_EXCEEDED');
  let clonedPixelPayloads = 0;
  const atLimit = { w: 1, h: 1, data: { byteLength: Batch.MAX_BATCH_INPUT_BYTES } };
  const rejected = { w: 1, h: 1, data: { byteLength: 1 } };
  assert.throws(() => Batch.createManifest([{ name: 'first.png', canvas: atLimit }, { name: 'rejected.png', canvas: rejected }], { depth: 1 }, { c: 1, r: 1 }, {
    readPixels: value => value,
    clone(value) { if (value && value.data) clonedPixelPayloads++; return value; },
  }), error => error.code === 'BATCH_INPUT_BUDGET_EXCEEDED');
  assert.equal(clonedPixelPayloads, 1, 'the over-budget source must be rejected before clone');
  assert.throws(() => Batch.appendOutput([], [{ name: 'x.bin', data: new Uint8Array(4) }], { bytes: 0, maxBytes: 3 }), error => error.code === 'BATCH_OUTPUT_BUDGET_EXCEEDED');
});
