const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRuntime() {
  const context = { window: {}, console };
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
