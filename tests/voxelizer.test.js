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

function loadViewportRuntime() {
  const context = { window: {}, console };
  vm.createContext(context);
  loadScript('viewport.js', context);
  return context.window.VoxelViewport;
}

function loadProfileDepthRuntime() {
  const context = { window: {}, console };
  vm.createContext(context);
  loadScript('profile-depth.js', context);
  return context.window.VoxelProfileDepth;
}

function fakeVector(x = 0, y = 0, z = 0) {
  return { x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; } };
}

function fakeCamera(kind) {
  return {
    kind,
    position: fakeVector(),
    up: fakeVector(0, 1, 0),
    fov: 42,
    aspect: 1,
    zoom: 1,
    near: 0.1,
    far: 1000,
    projectionUpdates: 0,
    lookAtTarget: null,
    lookAt(target) { this.lookAtTarget = [target.x, target.y, target.z]; },
    updateProjectionMatrix() { this.projectionUpdates++; },
  };
}

function fakeCameraHarness(dimensions = [44, 44, 44], aspect = 1) {
  const Viewport = loadViewportRuntime();
  const perspectiveCamera = fakeCamera('perspective');
  const orthographicCamera = fakeCamera('orthographic');
  const controls = {
    object: null,
    target: fakeVector(),
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
    autoRotate: true,
    updates: 0,
    update() { this.updates++; },
  };
  const controller = Viewport.createCameraController({ perspectiveCamera, orthographicCamera, controls, dimensions, aspect, autoRotate: true });
  return { Viewport, controller, perspectiveCamera, orthographicCamera, controls };
}

function assertModelInsideClip(camera, controls, dims) {
  const Viewport = loadViewportRuntime();
  const position = [camera.position.x, camera.position.y, camera.position.z];
  const target = [controls.target.x, controls.target.y, controls.target.z];
  const distance = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
  const radius = Viewport.boundingSphere(dims).radius;
  assert.ok(camera.near < distance - radius + 1e-9, `near ${camera.near} should be less than ${distance - radius}`);
  assert.ok(camera.far > distance + radius - 1e-9, `far ${camera.far} should be greater than ${distance + radius}`);
}

function assertModelInsideOrthoFrustum(camera, dims, mode) {
  const [x, y, z] = dims;
  const halfWidth = (camera.right - camera.left) / 2;
  const halfHeight = (camera.top - camera.bottom) / 2;
  let contentWidth = x, contentHeight = y;
  if (mode === 'profile') contentWidth = z;
  else if (mode === 'top') contentHeight = z;
  assert.ok(halfWidth >= contentWidth / 2, `frustum half-width ${halfWidth} should cover ${contentWidth / 2}`);
  assert.ok(halfHeight >= contentHeight / 2, `frustum half-height ${halfHeight} should cover ${contentHeight / 2}`);
}

function loadWorkerRuntime() {
  const messages = [];
  const transferLists = [];
  const context = {
    console,
    importScripts(...files) {
      for (const file of files) loadScript(file, context);
    },
    postMessage(message, transferList) {
      messages.push(message);
      transferLists.push(transferList || []);
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
    takeTransferList() {
      return transferLists.pop();
    },
  };
}

function fakeElement(id) {
  const children = [];
  const listeners = {};
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    style: {},
    className: '',
    classList: {
      toggle(cls, force) {
        const classes = new Set((el.className || '').split(/\s+/).filter(Boolean));
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls); else classes.add(cls);
        } else if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
        el.className = [...classes].join(' ');
      },
      remove(cls) { el.classList.toggle(cls, false); },
      add(cls) { el.classList.toggle(cls, true); },
      contains(cls) { return (el.className || '').split(/\s+/).filter(Boolean).includes(cls); },
    },
    dataset: {},
    children,
    replaceChildren(...newChildren) { children.length = 0; children.push(...newChildren); },
    appendChild(child) { children.push(child); return child; },
    append(...nodes) { children.push(...nodes); },
    removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    removeEventListener() {},
    getContext() {
      return {
        clearRect() {}, fillRect() {}, drawImage() {}, fillText() {}, strokeRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
        fill() {}, arc() {}, scale() {}, imageSmoothingEnabled: false,
      };
    },
    getAttribute(name) { return el.dataset[name] || null; },
    setAttribute(name, value) { el.dataset[name] = value; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    click() {},
    getBoundingClientRect() { return { width: 800, height: 600 }; },
  };
  return el;
}

function fakeDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    createElement(tag) { return fakeElement(tag); },
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector === '.window') {
        if (!elements.has('window')) elements.set('window', fakeElement('window'));
        return elements.get('window');
      }
      return null;
    },
    body: fakeElement('body'),
  };
}

function fakeVector3(x = 0, y = 0, z = 0) {
  return { x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; } };
}

function FakePerspectiveCamera(fov, aspect, near, far) {
  this.kind = 'perspective';
  this.position = fakeVector3();
  this.up = fakeVector3(0, 1, 0);
  this.fov = fov;
  this.aspect = aspect;
  this.near = near;
  this.far = far;
  this.zoom = 1;
  this.projectionUpdates = 0;
  this.lookAtTarget = null;
}
FakePerspectiveCamera.prototype.lookAt = function(target) { this.lookAtTarget = [target.x, target.y, target.z]; };
FakePerspectiveCamera.prototype.updateProjectionMatrix = function() { this.projectionUpdates++; };

function FakeOrthographicCamera(left, right, top, bottom, near, far) {
  this.kind = 'orthographic';
  this.position = fakeVector3();
  this.up = fakeVector3(0, 1, 0);
  this.left = left;
  this.right = right;
  this.top = top;
  this.bottom = bottom;
  this.near = near;
  this.far = far;
  this.zoom = 1;
  this.projectionUpdates = 0;
  this.lookAtTarget = null;
}
FakeOrthographicCamera.prototype.lookAt = function(target) { this.lookAtTarget = [target.x, target.y, target.z]; };
FakeOrthographicCamera.prototype.updateProjectionMatrix = function() { this.projectionUpdates++; };

function FakeOrbitControls(camera, domElement) {
  this.object = camera;
  this.target = fakeVector3();
  this.enableDamping = false;
  this.dampingFactor = 0;
  this.autoRotate = false;
  this.autoRotateSpeed = 0;
}
FakeOrbitControls.prototype.update = function() {};

function FakeGroup() {
  this.children = [];
  this.position = fakeVector3();
  this.scale = { setScalar(k) { this.k = k; } };
}
FakeGroup.prototype.add = function(child) { this.children.push(child); };
FakeGroup.prototype.remove = function(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); };

function FakeBufferGeometry() {
  this.attributes = {};
  this.index = null;
}
FakeBufferGeometry.prototype.setAttribute = function(name, attr) { this.attributes[name] = attr; };
FakeBufferGeometry.prototype.setIndex = function(idx) { this.index = idx; };
FakeBufferGeometry.prototype.dispose = function() {};

function FakeFloat32BufferAttribute(array, itemSize) {
  this.array = array;
  this.itemSize = itemSize;
}
FakeFloat32BufferAttribute.prototype.dispose = function() {};

function FakeMeshBasicMaterial(opts) {
  this.opts = opts || {};
  this.side = this.opts.side;
}
FakeMeshBasicMaterial.prototype.dispose = function() {};

function FakeLineBasicMaterial(opts) { this.opts = opts || {}; }
FakeLineBasicMaterial.prototype.dispose = function() {};

function FakeMesh(geo, mat) {
  this.kind = 'mesh';
  this.geometry = geo;
  this.material = mat;
  this.visible = true;
  this.position = fakeVector3();
}
FakeMesh.prototype.dispose = function() {
  if (this.geometry && this.geometry.dispose) this.geometry.dispose();
  if (this.material && this.material.dispose) this.material.dispose();
};

function FakeLineSegments(geo, mat) {
  this.kind = 'wire';
  this.geometry = geo;
  this.material = mat;
  this.visible = true;
  this.position = fakeVector3();
}
FakeLineSegments.prototype.dispose = function() {
  if (this.geometry && this.geometry.dispose) this.geometry.dispose();
  if (this.material && this.material.dispose) this.material.dispose();
};

function FakeWebGLRenderer() {
  this.domElement = fakeElement('renderer-dom');
  this.domElement.width = 800;
  this.domElement.height = 600;
  this.domElement.clientWidth = 800;
  this.domElement.clientHeight = 600;
}
FakeWebGLRenderer.prototype.setPixelRatio = function() {};
FakeWebGLRenderer.prototype.setSize = function() {};
FakeWebGLRenderer.prototype.render = function() {};

function FakeVector3(x, y, z) { this.x = x; this.y = y; this.z = z; this.normalize = function() {}; }

function FakeGridHelper() { this.position = fakeVector3(); }

function FakeScene() { this.add = function() {}; }

function loadAppRuntime() {
  const context = {};
  context.window = context;
  context.document = fakeDocument();
  context.addEventListener = function() {};
  context.removeEventListener = function() {};
  context.setTimeout = function(fn, ms) { if (typeof fn === 'function') fn(); return 0; };
  context.clearTimeout = function() {};
  context.setInterval = function() { return 0; };
  context.clearInterval = function() {};
  context.requestAnimationFrame = function() {};
  context.cancelAnimationFrame = function() {};
  context.devicePixelRatio = 1;
  context.SAMPLE_SPRITES = [];
  context.ResizeObserver = undefined;
  context.location = { href: '' };
  context.console = console;
  context.structuredClone = structuredClone;
  context.TextEncoder = TextEncoder;
  context.performance = { now() { return 0; } };
  context.URL = { createObjectURL() { return 'blob:fake'; }, revokeObjectURL() {} };
  context.THREE = {
    WebGLRenderer: FakeWebGLRenderer,
    Scene: FakeScene,
    PerspectiveCamera: FakePerspectiveCamera,
    OrthographicCamera: FakeOrthographicCamera,
    OrbitControls: FakeOrbitControls,
    GridHelper: FakeGridHelper,
    Group: FakeGroup,
    Mesh: FakeMesh,
    LineSegments: FakeLineSegments,
    BufferGeometry: FakeBufferGeometry,
    Float32BufferAttribute: FakeFloat32BufferAttribute,
    MeshBasicMaterial: FakeMeshBasicMaterial,
    LineBasicMaterial: FakeLineBasicMaterial,
    Vector3: FakeVector3,
    DoubleSide: 2,
  };
  vm.createContext(context);
  const scripts = ['transfer.js', 'batch.js', 'worker-channel.js', 'profile-depth.js', 'viewport.js', 'voxel.js', 'voxio.js', 'zip.js', 'app.js'];
  for (const file of scripts) loadScript(file, context);
  return context;
}

function makeModelResult(marker) {
  return {
    grid: new Int16Array([0, 0]),
    dims: [1, 1, 2],
    voxels: 2,
    palette: [[255, 0, 0]],
    greedyFacesList: [{
      normal: [0, 0, 1],
      color: 0,
      corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      ao: [1, 1, 1, 1],
    }],
    naiveFacesList: [],
    metrics: {},
    diagnostics: { warnings: [], views: [] },
    marker,
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

function occupiedZ(result, x, py) {
  const out = [], y = result.dims[1] - 1 - py;
  for (let z = 0; z < result.dims[2]; z++) if (result.grid[x + result.dims[0] * (y + result.dims[1] * z)] >= 0) out.push(z);
  return out;
}

function connectedMaterialResults(Voxel) {
  const front = fixtures.clonePixels(fixtures.connectedMaterialFront);
  const side = fixtures.clonePixels(fixtures.connectedMaterialSide);
  const alphaConfig = Voxel.createDefaultConfig(); alphaConfig.depth.layers = 6; alphaConfig.material.enabled = false;
  const materialConfig = Voxel.createDefaultConfig(); materialConfig.depth.layers = 6; materialConfig.material.tolerance = 45;
  return {
    alphaOnly: Voxel.voxelize(front, alphaConfig, { side }),
    aware: Voxel.voxelize(front, materialConfig, { side }),
  };
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
  assert.equal(Voxel.normalizeConfig({}).material.enabled, true);
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

test('profundidad 64 conserva las 64 columnas del perfil sin limite legacy 32', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(64, 1, () => [255, 255, 255, 255]);
  const result = Voxel.voxelize(front, baseOpts({ depth: 64, materialAwareness: false }), { side });
  assert.equal(Voxel.normalizeConfig({ depth: 64 }).depth.layers, 64);
  assert.deepEqual(Array.from(result.dims), [1, 1, 64]);
  assert.equal(result.voxels, 64);
});

test('profundidad maxima 256 acepta el grid exacto y rechaza un solo plano extra', () => {
  const { Voxel } = loadRuntime();
  assert.equal(Voxel.MAX_DEPTH_LAYERS, 256);
  assert.equal(Voxel.MAX_VOXEL_COUNT, 256 ** 3);
  assert.equal(Voxel.normalizeConfig({ depth: 999 }).depth.layers, 256);
  const exact = makePixels(256, 256, (x, y) => x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const result = Voxel.voxelize(exact, baseOpts({ depth: 256, materialAwareness: false }), {});
  assert.deepEqual(Array.from(result.dims), [256, 256, 256]);
  assert.equal(result.voxels, 256);
  const over = makePixels(257, 256, () => [0, 0, 0, 0]);
  assert.throws(
    () => Voxel.voxelize(over, baseOpts({ depth: 256, materialAwareness: false }), {}),
    error => error.code === 'VOXEL_BUDGET_EXCEEDED'
  );
});

test('Match profile usa el ancho de la frame lateral ya cortada del spritesheet', () => {
  const ProfileDepth = loadProfileDepthRuntime();
  const context = { window: {}, console, structuredClone, TextEncoder };
  vm.createContext(context); loadScript('batch.js', context);
  const sideSheet = makePixels(128, 64, (x, y) => [x, y, 0, 255]);
  const selectedFrame = context.window.VoxelBatch.slicePixels(sideSheet, { c: 2, r: 1 }, 1);
  const match = ProfileDepth.actionState({ views: [{ role: 'side', pixels: selectedFrame }] }, 256);
  assert.equal(selectedFrame.w, 64);
  assert.deepEqual({ enabled: match.enabled, depth: match.depth, sourceWidth: match.sourceWidth, clamped: match.clamped }, {
    enabled: true, depth: 64, sourceWidth: 64, clamped: false,
  });
  const capped = ProfileDepth.actionState({ views: [{ role: 'side', pixels: makePixels(300, 1, () => [0, 0, 0, 255]) }] }, 256);
  assert.deepEqual({ depth: capped.depth, clamped: capped.clamped }, { depth: 256, clamped: true });
});

test('Match profile queda deshabilitado sin vista lateral y no infiere desde frontal', () => {
  const ProfileDepth = loadProfileDepthRuntime();
  const match = ProfileDepth.actionState({ views: [{ role: 'top', pixels: makePixels(64, 64, () => [0, 0, 0, 0]) }] }, 256);
  assert.equal(match.enabled, false);
  assert.equal(match.depth, null);
  assert.equal(match.status, ProfileDepth.STATUS.NO_SIDE_VIEW);
});

test('Match profile rechaza pixels laterales con bytes invalidos', () => {
  const ProfileDepth = loadProfileDepthRuntime();
  const badLength = { views: [{ role: 'side', pixels: { w: 4, h: 4, data: new Uint8Array(4) } }] };
  const match = ProfileDepth.actionState(badLength, 256);
  assert.equal(match.enabled, false);
  assert.equal(match.depth, null);
  assert.equal(match.sourceWidth, null);
  assert.equal(match.clamped, false);
  assert.equal(match.status, ProfileDepth.STATUS.INVALID_SIDE_PIXELS);
  assert.equal(match.busy, false);
  assert.equal(match.disabled, true);
  const nonTyped = { views: [{ role: 'side', pixels: { w: 1, h: 1, data: [0, 0, 0, 255] } }] };
  assert.equal(ProfileDepth.actionState(nonTyped, 256).status, ProfileDepth.STATUS.INVALID_SIDE_PIXELS);
});

test('Match profile se deshabilita durante preview o batch', () => {
  const ProfileDepth = loadProfileDepthRuntime();
  const side = makePixels(64, 64, () => [255, 255, 255, 255]);
  const previewBusy = ProfileDepth.actionState({ views: [{ role: 'side', pixels: side }] }, 256, { previewBusy: true });
  assert.equal(previewBusy.busy, true);
  assert.equal(previewBusy.disabled, true);
  const batchBusy = ProfileDepth.actionState({ views: [{ role: 'side', pixels: side }] }, 256, { batchBusy: true });
  assert.equal(batchBusy.busy, true);
  assert.equal(batchBusy.disabled, true);
  const idle = ProfileDepth.actionState({ views: [{ role: 'side', pixels: side }] }, 256);
  assert.equal(idle.busy, false);
  assert.equal(idle.disabled, false);
});

test('diagnostico de perfil separa compresion de IoU sobre el grid', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [255, 0, 0, 255]);
  const side = makePixels(64, 1, () => [255, 255, 255, 255]);
  const compressed = Voxel.voxelize(front, baseOpts({ depth: 32, materialAwareness: false }), { side });
  const view = compressed.diagnostics.views[0];
  assert.equal(view.iou, 1, 'the resampled grid projection can remain exact');
  assert.deepEqual(JSON.parse(JSON.stringify(view.profileResolution)), {
    sourceWidth: 64,
    gridDepth: 32,
    compressionRatio: 0.5,
    downsampled: true,
    label: 'Profile 64 → 32 layers',
  });
  assert.ok(compressed.diagnostics.warnings.some(warning => warning.code === 'PROFILE_DOWNSAMPLED'));
  const exact = Voxel.voxelize(front, baseOpts({ depth: 64, materialAwareness: false }), { side });
  assert.equal(exact.diagnostics.views[0].profileResolution.downsampled, false);
  assert.ok(!exact.diagnostics.warnings.some(warning => warning.code === 'PROFILE_DOWNSAMPLED'));
});

test('poses ortograficas respetan los ejes canonicos frontal perfil y cenital', () => {
  const Viewport = loadViewportRuntime();
  const right = pose => {
    const direction = pose.target.map((value, index) => value - pose.position[index]);
    return [
      direction[1] * pose.up[2] - direction[2] * pose.up[1],
      direction[2] * pose.up[0] - direction[0] * pose.up[2],
      direction[0] * pose.up[1] - direction[1] * pose.up[0],
    ].map(value => value === 0 ? 0 : Math.sign(value));
  };
  assert.deepEqual(Array.from(right(Viewport.orthographicPose('front', [64, 64, 64]))), [1, 0, 0]);
  assert.deepEqual(Array.from(right(Viewport.orthographicPose('profile', [64, 64, 64]))), [0, 0, 1]);
  assert.deepEqual(Array.from(right(Viewport.orthographicPose('top', [64, 64, 64]))), [1, 0, 0]);
  assert.deepEqual(Array.from(Viewport.orthographicPose('top', [64, 64, 64]).up), [0, 0, -1]);
});

test('frustum ortografico encuadra el modelo segun modo y aspect ratio', () => {
  const Viewport = loadViewportRuntime();
  const front = Viewport.orthographicFrustum('front', [40, 20, 80], 2, 1);
  const profile = Viewport.orthographicFrustum('profile', [40, 20, 80], 2, 1);
  const top = Viewport.orthographicFrustum('top', [40, 20, 80], 2, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(front)), { left: -20, right: 20, top: 10, bottom: -10 });
  assert.deepEqual(JSON.parse(JSON.stringify(profile)), { left: -40, right: 40, top: 20, bottom: -20 });
  assert.deepEqual(JSON.parse(JSON.stringify(top)), { left: -80, right: 80, top: 40, bottom: -40 });
});

test('controlador recorre modos y restaura preferencia de rotacion en perspectiva', () => {
  const { controller, perspectiveCamera, orthographicCamera, controls } = fakeCameraHarness();
  assert.equal(controller.mode, 'perspective');
  assert.equal(controller.activeCamera, perspectiveCamera);
  assert.equal(controls.enableRotate, true);
  assert.equal(controls.enablePan, true);
  assert.equal(controls.autoRotate, true);

  controller.setMode('front');
  assert.equal(controller.mode, 'front');
  assert.equal(controller.activeCamera, orthographicCamera);
  assert.equal(controls.enableRotate, false);
  assert.equal(controls.enablePan, false);
  assert.equal(controls.autoRotate, false);

  controller.setMode('profile');
  assert.equal(controller.mode, 'profile');
  assert.equal(controller.activeCamera, orthographicCamera);

  controller.setMode('top');
  assert.equal(controller.mode, 'top');
  assert.equal(controller.activeCamera, orthographicCamera);

  controller.setMode('perspective');
  assert.equal(controller.mode, 'perspective');
  assert.equal(controller.activeCamera, perspectiveCamera);
  assert.equal(controls.autoRotate, true, 'auto-rotate preference must be restored');
  assert.equal(controls.enableRotate, true);
  assert.equal(controls.enablePan, true);
});

test('modelo 1x1x256 permanece dentro del frustum y clip en todo modo, reset, resize y cambio material', () => {
  const dims = [1, 1, 256];
  const { controller, perspectiveCamera, orthographicCamera, controls } = fakeCameraHarness(dims, 1);
  for (const mode of ['perspective', 'front', 'profile', 'top']) {
    controller.setMode(mode);
    controller.reset();
    const camera = mode === 'perspective' ? perspectiveCamera : orthographicCamera;
    assertModelInsideClip(camera, controls, dims);
    if (mode !== 'perspective') assertModelInsideOrthoFrustum(camera, dims, mode);

    controller.resize(2);
    assertModelInsideClip(camera, controls, dims);
    if (mode !== 'perspective') assertModelInsideOrthoFrustum(camera, dims, mode);

    const materialDims = [2, 2, 256];
    controller.setDimensions(materialDims);
    assertModelInsideClip(camera, controls, materialDims);
    if (mode !== 'perspective') assertModelInsideOrthoFrustum(camera, materialDims, mode);
  }
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

test('fixtures de reconstruccion son payloads validos e independientes tras clonar', () => {
  const { Voxel } = loadRuntime();
  const pixelFixtures = {
    frontL: fixtures.frontL,
    sideFullDepth: fixtures.sideFullDepth,
    topFullDepth: fixtures.topFullDepth,
    depthMapGradient: fixtures.depthMapGradient,
    disconnectedUnequal: fixtures.disconnectedUnequal,
    connectedMaterialFront: fixtures.connectedMaterialFront,
    connectedMaterialSide: fixtures.connectedMaterialSide,
  };
  for (const [name, original] of Object.entries(pixelFixtures)) {
    const cloned = fixtures.clonePixels(original);
    const validated = Voxel.validatePixels(cloned);
    assert.equal(validated.w, original.w, name);
    assert.equal(validated.h, original.h, name);
    assert.equal(validated.data.length, original.w * original.h * 4, name);
    assert.notEqual(validated.data, original.data, name);
    cloned.data[0] = 99;
    assert.notEqual(original.data[0], 99, name);
  }
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
  assert.equal(config.version, 3);
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
  assert.equal(message.result.configVersion, 3);
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

test('material-aware confina el material adjunto a la profundidad compatible', () => {
  const { Voxel } = loadRuntime();
  const { alphaOnly, aware } = connectedMaterialResults(Voxel);
  assert.deepEqual(occupiedZ(alphaOnly, 0, 1), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(occupiedZ(aware, 0, 1), [0]);
  assert.equal(alphaOnly.voxels, 105);
  assert.equal(aware.voxels, 66);
});

test('material-aware conserva el volumen del material estructural compatible', () => {
  const { Voxel } = loadRuntime();
  const { aware } = connectedMaterialResults(Voxel);
  assert.deepEqual(occupiedZ(aware, 2, 1), [1, 2, 3, 4, 5]);
  assert.deepEqual(occupiedZ(aware, 3, 1), [1, 2, 3, 4, 5]);
  const structural = aware.diagnostics.material.clusters.find(cluster => cluster.supported);
  assert.ok(structural.structuralVoxels > 0);
});

test('material-aware conserva detalles decorativos solo en la superficie frontal', () => {
  const { Voxel } = loadRuntime();
  const { aware } = connectedMaterialResults(Voxel);
  const black = aware.palette.findIndex(color => color[0] < 12 && color[1] < 12 && color[2] < 12);
  assert.ok(black >= 0);
  assert.equal(Array.from(aware.grid).filter(index => index === black).length, 1);
  assert.ok(aware.greedyFacesList.some(face => face.normal[2] === 1 && face.color === black));
  assert.ok(aware.diagnostics.material.unmatchedFrontMaterials.some(item => item.surfaceOnly));
  assert.equal(aware.diagnostics.material.decorativeFrontFaceArea, 1);
});

test('tolerancia perceptual agrupa variantes de sombreado sin usar igualdad RGB', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.connectedMaterialFront);
  const side = fixtures.clonePixels(fixtures.connectedMaterialSide);
  for (let i = 0; i < side.w * side.h; i++) {
    if (side.data[i * 4] === 245) {
      side.data[i * 4] = 220;
      side.data[i * 4 + 1] = 165;
      side.data[i * 4 + 2] = 20;
    }
  }
  const tolerant = Voxel.createDefaultConfig(); tolerant.depth.layers = 6; tolerant.material.tolerance = 45;
  const exactish = Voxel.createDefaultConfig(); exactish.depth.layers = 6; exactish.material.tolerance = 5;
  const wide = Voxel.voxelize(front, tolerant, { side });
  const narrow = Voxel.voxelize(front, exactish, { side });
  const countAt = result => {
    let count = 0, y = result.dims[1] - 2;
    for (let z = 0; z < 6; z++) if (result.grid[result.dims[0] * (y + result.dims[1] * z)] >= 0) count++;
    return count;
  };
  assert.equal(countAt(wide), 1);
  assert.equal(countAt(narrow), 6);
});

test('material-aware degrada exactamente a alpha-only con metadata mask-only', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.connectedMaterialFront);
  const maskOnly = fixtures.makePixels(6, 4, (z, y) => (z >= 1 || (z === 0 && y >= 1)) ? [0, 0, 0, 255] : [0, 0, 0, 0]);
  const alpha = Voxel.createDefaultConfig(); alpha.depth.layers = 6; alpha.material.enabled = false;
  const aware = Voxel.createDefaultConfig(); aware.depth.layers = 6;
  const views = { views: [{ id: 'mask', role: 'side', pixels: maskOnly, materialEvidence: false }] };
  const expected = Voxel.voxelize(front, alpha, views);
  const actual = Voxel.voxelize(front, aware, views);
  assert.deepEqual(Array.from(actual.grid), Array.from(expected.grid));
  assert.equal(actual.diagnostics.material.reason, 'mask-only');
  assert.ok(actual.diagnostics.warnings.some(warning => warning.code === 'MATERIAL_RGB_MISSING'));
  assert.deepEqual(JSON.parse(JSON.stringify(actual.diagnostics.views[0].material)), {
    eligible: false, evaluated: false, applied: false, compatible: 0, incompatible: 0, compatibility: null,
  });
});

test('RGB negro puro es evidencia material valida sin sentinel implicito', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [0, 0, 0, 255]);
  const side = makePixels(3, 1, () => [0, 0, 0, 255]);
  const result = Voxel.voxelize(front, { depth: { layers: 3 } }, { side });
  assert.equal(result.diagnostics.material.active, true);
  assert.equal(result.diagnostics.material.reason, 'active');
  assert.equal(result.diagnostics.views[0].material.evaluated, true);
  assert.equal(result.diagnostics.views[0].material.compatibility, 1);
});

test('config v1 sin campos materiales preserva el grid alpha legacy', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.connectedMaterialFront);
  const side = fixtures.clonePixels(fixtures.connectedMaterialSide);
  const migrated = Voxel.normalizeConfig({ version: 1, depth: { layers: 6 } });
  const alpha = Voxel.createDefaultConfig(); alpha.depth.layers = 6; alpha.depth.localWidthAware = false; alpha.material.enabled = false;
  assert.equal(migrated.material.enabled, false);
  assert.deepEqual(
    Array.from(Voxel.voxelize(front, migrated, { side }).grid),
    Array.from(Voxel.voxelize(front, alpha, { side }).grid)
  );
});

test('configs v1 y v2 sin campos materiales reproducen exactamente el grid previo', () => {
  const { Voxel } = loadRuntime();
  const front = fixtures.clonePixels(fixtures.connectedMaterialFront);
  const side = fixtures.clonePixels(fixtures.connectedMaterialSide);
  const alpha = Voxel.createDefaultConfig(); alpha.depth.layers = 6; alpha.depth.localWidthAware = false; alpha.material.enabled = false;
  const expected = Array.from(Voxel.voxelize(front, alpha, { side }).grid);
  for (const version of [1, 2]) {
    const migrated = Voxel.normalizeConfig({ version, depth: { layers: 6 } });
    assert.equal(migrated.material.enabled, false);
    assert.deepEqual(Array.from(Voxel.voxelize(front, migrated, { side }).grid), expected, `v${version}`);
    const unknownOnly = Voxel.normalizeConfig({ version, depth: { layers: 6 }, material: { pluginMetadata: 'ignored' } });
    assert.equal(unknownOnly.material.enabled, false, `unknown-only v${version}`);
    assert.deepEqual(Array.from(Voxel.voxelize(front, unknownOnly, { side }).grid), expected, `unknown-only v${version}`);
  }
});

test('diagnosticos distinguen ausencia, desactivado, fuerza cero, mask-only y activo', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [180, 30, 40, 255]);
  const side = makePixels(2, 1, () => [180, 30, 40, 255]);
  const absent = Voxel.voxelize(front, { depth: { layers: 2 } }, {});
  assert.equal(absent.diagnostics.material.reason, 'no-auxiliary-views');
  assert.equal(absent.diagnostics.material.requested, true);
  assert.equal(absent.diagnostics.material.active, false);
  assert.equal(absent.diagnostics.warnings.some(warning => warning.stage === 'material'), false);
  const disabled = Voxel.voxelize(front, { depth: { layers: 2 }, material: { enabled: false } }, { side });
  assert.equal(disabled.diagnostics.material.reason, 'disabled');
  assert.equal(disabled.diagnostics.material.requested, false);
  assert.equal(disabled.diagnostics.material.effective, false);
  const zero = Voxel.voxelize(front, { depth: { layers: 2 }, material: { strength: 0 } }, { side });
  assert.equal(zero.diagnostics.material.reason, 'zero-strength');
  assert.equal(zero.diagnostics.material.requested, true);
  assert.equal(zero.diagnostics.material.effective, false);
  const mask = Voxel.voxelize(front, { depth: { layers: 2 } }, { views: [{ role: 'side', pixels: side, materialEvidence: false }] });
  assert.equal(mask.diagnostics.material.reason, 'mask-only');
  const active = Voxel.voxelize(front, { depth: { layers: 2 } }, { side });
  assert.equal(active.diagnostics.material.reason, 'active');
  assert.equal(active.diagnostics.material.active, true);
});

test('una vista sin pixels compatibles aporta incompatibilidad en strict y weighted', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 1, () => [220, 20, 20, 255]);
  const side = makePixels(3, 1, () => [220, 20, 20, 255]);
  const top = makePixels(1, 3, () => [20, 40, 220, 255]);
  for (const mode of ['strict', 'weighted']) {
    const config = Voxel.createDefaultConfig();
    config.depth.layers = 3; config.reconstruction.mode = mode; config.reconstruction.threshold = 1; config.material.strength = 0.6;
    const result = Voxel.voxelize(front, config, { side, top });
    assert.equal(result.voxels, 0, mode);
    const topDiagnostic = result.diagnostics.views.find(view => view.role === 'top').material;
    assert.equal(topDiagnostic.evaluated, true);
    assert.equal(topDiagnostic.compatibility, 0);
    assert.ok(topDiagnostic.incompatible > 0);
  }
});

test('detalle frontal no colorea caras +Z internas de cavidades desconectadas', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(2, 1, x => x === 0 ? [150, 35, 170, 255] : [0, 0, 0, 255]);
  const side = makePixels(3, 1, z => z === 1 ? [0, 0, 0, 0] : [150, 35, 170, 255]);
  const result = Voxel.voxelize(front, { depth: { layers: 3 }, material: { tolerance: 30 } }, { side });
  const black = result.palette.findIndex(color => color.every(value => value < 12));
  const y = 0;
  assert.ok(black >= 0);
  const faces = JSON.parse(JSON.stringify(result.greedyFacesList));
  const internal = faces.find(face => face.normal[2] === 1 && face.corners.every(point => point[2] === 1)
    && Math.min(...face.corners.map(point => point[0])) <= 1 && Math.max(...face.corners.map(point => point[0])) >= 2);
  assert.ok(internal);
  assert.notEqual(internal.color, black);
  assert.ok(faces.some(face => face.normal[2] === 1 && face.color === black && face.corners.every(point => point[2] === 3)));
  assert.deepEqual(occupiedZ(result, 1, y), [0, 2]);
});

test('weighted incorpora compatibilidad material, diagnosticos, overlays y memoria acotada', () => {
  const { Voxel } = loadRuntime();
  const config = Voxel.createDefaultConfig();
  config.depth.layers = 6;
  config.reconstruction.mode = 'weighted';
  config.reconstruction.threshold = 1;
  config.material.tolerance = 45;
  const result = Voxel.voxelize(fixtures.clonePixels(fixtures.connectedMaterialFront), config, {
    side: fixtures.clonePixels(fixtures.connectedMaterialSide),
  });
  const view = result.diagnostics.views[0];
  assert.equal(result.diagnostics.material.active, true);
  assert.ok(view.materialCoverage > 0);
  assert.ok(view.materialCandidateCompatibility > 0 && view.materialCandidateCompatibility < 1);
  assert.equal(view.materialOverlay.length, 24);
  assert.ok(Array.from(view.materialOverlay).some(value => value === 3));
  assert.ok(result.metrics.materialEvidenceBytes > 0);
  assert.ok(result.metrics.materialEvidenceBytes <= 8 * 1024 * 1024);
  assert.equal(result.metrics.materialEvidenceBytes, result.diagnostics.material.memoryBytes);
  assert.ok(result.metrics.materialCompareWork > 0 && result.metrics.materialCompareWork <= 64 * 1024 * 1024);
  assert.ok(result.metrics.memoryEstimateBytes >= result.metrics.materialEvidenceBytes);
  assert.equal(result.config.material.enabled, true);
  assert.equal(result.legacyOptions.materialAwareness, true);
  assert.ok(result.diagnostics.warnings.some(warning => warning.code === 'MATERIAL_MISMATCH_GHOST_RISK'));
  assert.equal(result.diagnostics.warnings.filter(warning => warning.code === 'MATERIAL_MISMATCH_GHOST_RISK').length, 1);
});

test('worker serializa configuracion y diagnosticos material-aware completos', () => {
  const worker = loadWorkerRuntime();
  const message = worker.dispatch({
    jobId: 'material-job',
    pixels: fixtures.clonePixels(fixtures.connectedMaterialFront),
    opts: { depth: 6, materialAwareness: true, materialTolerance: 45, materialStrength: 0.7 },
    views: { side: fixtures.clonePixels(fixtures.connectedMaterialSide) },
  });
  assert.equal(message.ok, true);
  assert.equal(message.result.config.material.tolerance, 45);
  assert.equal(message.result.config.material.strength, 0.7);
  assert.equal(message.result.diagnostics.material.active, true);
  assert.ok(ArrayBuffer.isView(message.result.diagnostics.views[0].materialOverlay));
  assert.ok(message.result.diagnostics.warnings.some(warning => warning.code === 'SURFACE_ONLY_DETAILS'));
  const transferList = worker.takeTransferList();
  assert.ok(Array.isArray(transferList) && transferList.length > 0);
  assert.equal(new Set(transferList).size, transferList.length, 'transfer buffers must be deduplicated');
  assert.ok(transferList.includes(message.result.grid.buffer));
  assert.ok(transferList.includes(message.result.diagnostics.views[0].materialOverlay.buffer));
  assert.ok(transferList.every(buffer => Number.isInteger(buffer.byteLength)));
});

test('presupuesto de comparacion material degrada a alpha-only antes del trabajo cuadratico', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(1, 10000, (x, y) => y === 0 ? [150, 35, 170, 255] : [0, 0, 0, 0]);
  const side = makePixels(64, 10000, () => [150, 35, 170, 255]);
  const alpha = Voxel.createDefaultConfig(); alpha.depth.layers = 64; alpha.material.enabled = false;
  const aware = Voxel.createDefaultConfig(); aware.depth.layers = 64;
  const expected = Voxel.voxelize(front, alpha, { side });
  const actual = Voxel.voxelize(front, aware, { side });
  assert.deepEqual(Array.from(actual.grid), Array.from(expected.grid));
  assert.equal(actual.diagnostics.material.reason, 'material-compare-budget');
  assert.ok(actual.diagnostics.warnings.some(warning => warning.code === 'MATERIAL_COMPARE_BUDGET'));
  assert.ok(actual.metrics.materialCompareWork <= 64 * 1024 * 1024);
});

test('ruta publica normalizada limita bytes transformados con profundidad legal', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(4096, 64, () => [0, 0, 0, 0]);
  const largeTop = makePixels(4096, 96, () => [255, 0, 0, 255]);
  assert.throws(
    () => Voxel.voxelize(front, { depth: { layers: 64 } }, { views: Array.from({ length: 8 }, (_, index) => ({
      id: `top-${index}`, role: 'top', pixels: largeTop,
    })) }),
    error => error.code === 'TRANSFORMED_VIEW_BUDGET_EXCEEDED'
  );
});

test('presupuesto incluye lookups de ocupacion y degrada antes de reconstruir', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(512, 256, () => [150, 35, 170, 255]);
  const side = makePixels(64, 256, (z) => z === 0 ? [150, 35, 170, 255] : [0, 0, 0, 0]);
  const top = makePixels(512, 64, (x, z) => x === 0 && z === 0 ? [150, 35, 170, 255] : [0, 0, 0, 0]);
  const views = { views: [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `side-${index}`, role: 'side', pixels: side })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `top-${index}`, role: 'top', pixels: top })),
  ] };
  const config = Voxel.createDefaultConfig(); config.depth.layers = 64;
  const result = Voxel.voxelize(front, config, views);
  assert.equal(result.diagnostics.material.reason, 'material-occupancy-budget');
  assert.equal(result.diagnostics.material.active, false);
  assert.equal(result.metrics.materialOccupancyCompareWork, 0);
  assert.ok(result.metrics.materialOccupancyCompareWorkEstimate + result.metrics.materialPrepareCompareWork > 64 * 1024 * 1024);
  assert.ok(result.diagnostics.warnings.some(warning => warning.code === 'MATERIAL_OCCUPANCY_BUDGET'));
});

test('contabilidad material cerca de 8 MiB incluye arrays fijos, rangos y overlays', () => {
  const { Voxel } = loadRuntime();
  const front = makePixels(4096, 63, () => [150, 35, 170, 255]);
  const top = makePixels(4096, 64, (x) => x === 0 ? [150, 35, 170, 255] : [0, 0, 0, 0]);
  const config = Voxel.createDefaultConfig(); config.depth.layers = 64;
  const result = Voxel.voxelize(front, config, { views: Array.from({ length: 4 }, (_, index) => ({
    id: `near-cap-${index}`, role: 'top', pixels: top,
  })) });
  assert.equal(result.metrics.materialEvidenceBytes, 8149203);
  assert.ok(result.metrics.materialEvidenceBytes > 7.75 * 1024 * 1024, result.metrics.materialEvidenceBytes);
  assert.ok(result.metrics.materialEvidenceBytes <= 8 * 1024 * 1024);
  assert.equal(result.metrics.materialEvidenceBytes, result.diagnostics.material.memoryBytes);
  assert.equal(result.diagnostics.material.reason, 'active');
  assert.ok(result.diagnostics.material.clusters[0].acceptedZSpan);
  assert.ok(result.diagnostics.views.every(view => view.materialOverlay && view.materialOverlay.length === 4096 * 64));
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

test('CONFIG_VERSION 3 migra v1/v2 y round-trip de campos nuevos no deriva', () => {
  const { Voxel } = loadRuntime();
  const v1 = Voxel.normalizeConfig({ version: 1, depth: { profile: 'dt' }, color: { darken: 0.41 } });
  assert.equal(v1.version, 3);
  assert.equal(v1.depth.localWidthAware, false);
  assert.equal(v1.material.enabled, false);
  const v2 = Voxel.normalizeConfig({ version: 2, depth: { layers: 6 }, reconstruction: { mode: 'strict' } });
  assert.equal(v2.version, 3);
  assert.equal(v2.material.enabled, false);
  const explicitV1 = Voxel.normalizeConfig({ version: 1, material: { enabled: true, tolerance: 31, strength: 0.4 } });
  const explicitV2 = Voxel.normalizeConfig({ version: 2, material: { enabled: true, tolerance: 29, strength: 0.3 } });
  const partialV2 = Voxel.normalizeConfig({ version: 2, material: { tolerance: 27, strength: 0.2 } });
  assert.deepEqual(JSON.parse(JSON.stringify(explicitV1.material)), { enabled: true, tolerance: 31, strength: 0.4 });
  assert.deepEqual(JSON.parse(JSON.stringify(explicitV2.material)), { enabled: true, tolerance: 29, strength: 0.3 });
  assert.deepEqual(JSON.parse(JSON.stringify(partialV2.material)), { enabled: true, tolerance: 27, strength: 0.2 });
  assert.equal(Voxel.normalizeConfig({ material: { tolerance: 999 } }).material.tolerance, 128);
  const legacy = Voxel.legacyOptionsFromConfig(Voxel.normalizeConfig({
    depth: { localWidthAware: true }, material: { enabled: true, tolerance: 37, strength: 0.72 }, color: { mode: 'auxiliary', side: 'darken', back: 'darken', darken: 0.41 },
  }));
  const roundTrip = Voxel.normalizeConfig(legacy);
  assert.equal(roundTrip.depth.localWidthAware, true);
  assert.equal(roundTrip.material.enabled, true);
  assert.equal(roundTrip.material.tolerance, 37);
  assert.equal(roundTrip.material.strength, 0.72);
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

test('VOX total bytes igual a 1096 mas cuatro por voxel ocupado', () => {
  const { VoxIO } = loadRuntime();
  const palette = [[255, 0, 0], [0, 255, 0]];
  const grid = new Int16Array([-1, 0, 1, -1]);
  const bytes = VoxIO.exportVox({ grid, dims: [2, 2, 1], palette });
  assert.equal(bytes.length, VoxIO.VOX_FIXED_BYTES + 2 * 4);
  assert.equal(bytes.length, 1096 + 2 * 4);
});

test('VOX rechaza exportacion que excede el presupuesto de bytes antes de asignar', () => {
  const { VoxIO } = loadRuntime();
  const dims = [256, 256, 64];
  const grid = new Int16Array(dims[0] * dims[1] * dims[2]).fill(0);
  const palette = [[255, 0, 0]];
  assert.throws(() => VoxIO.exportVox({ grid, dims, palette }), error => error.code === 'VOX_EXPORT_BUDGET_EXCEEDED');
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

test('app invalida malla, estadisticas, diagnosticos y export ante fallo de reconstruccion', () => {
  const win = loadAppRuntime();
  const dbg = win.__dbg;
  assert.ok(dbg, 'app.js must expose a debug seam');
  const result = makeModelResult('stale');
  dbg.buildModel(result);
  assert.ok(dbg.mesh, 'mesh must exist after successful build');
  assert.equal(dbg.modelGroup.children.length, 2, 'mesh and wireframe must be in the scene group');
  dbg.invalidatePreviewEvidence('Error de reconstruccion');
  assert.equal(dbg.mesh, null, 'mesh must be cleared after failure');
  assert.equal(dbg.wire, null, 'wireframe must be cleared after failure');
  assert.equal(dbg.state.last, null, 'last result must be cleared after failure');
  assert.equal(Object.keys(dbg.state.diagnosticViewIds).length, 0, 'diagnostic view ids must be cleared after failure');
  const stVox = win.document.getElementById('stVox');
  const stRaw = win.document.getElementById('stRaw');
  const stGreedy = win.document.getElementById('stGreedy');
  const stRed = win.document.getElementById('stRed');
  const statDims = win.document.getElementById('statDims');
  const swatches = win.document.getElementById('swatches');
  const diagnostics = win.document.getElementById('diagnostics');
  assert.equal(stVox.textContent, '—');
  assert.equal(stRaw.textContent, '—');
  assert.equal(stGreedy.textContent, '—');
  assert.equal(stRed.textContent, '—');
  assert.equal(statDims.textContent, '— grid');
  assert.equal(swatches.children.length, 0);
  assert.equal(diagnostics.children.length, 0);
  dbg.refreshActionState();
  assert.equal(win.document.getElementById('exportBtn').disabled, true, 'export must be disabled after failure');
});

test('app reemplaza modelo obsoleto sin perder el material en reconstrucciones exitosas', () => {
  const win = loadAppRuntime();
  const dbg = win.__dbg;
  const first = makeModelResult('first');
  const second = makeModelResult('second');
  second.palette = [[0, 255, 0]];
  dbg.buildModel(first);
  const firstMesh = dbg.mesh;
  assert.ok(firstMesh);
  dbg.buildModel(second);
  const secondMesh = dbg.mesh;
  assert.ok(secondMesh);
  assert.notEqual(firstMesh, secondMesh, 'a new mesh instance must replace the stale one');
  assert.equal(dbg.modelGroup.children.length, 2, 'only one mesh and one wireframe remain');
  assert.equal(dbg.modelGroup.children.filter(o => o.kind === 'mesh').length, 1, 'exactly one mesh remains');
  dbg.state.last = second;
  assert.equal(dbg.state.last.marker, 'second', 'last result must reflect the new valid result');
  dbg.refreshActionState();
  assert.equal(win.document.getElementById('exportBtn').disabled, false, 'export must be enabled after success');
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

test('worker fallback rechaza trabajo oversized con WORKER_FALLBACK_WORK_EXCEEDED sin bloquear', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const channel = context.window.VoxelWorkerChannel.create({
    WorkerCtor: null,
    voxelize: () => makeVoxelResult(),
    transfer: context.window.VoxelTransfer,
    maxSynchronousWork: 1,
  });
  const promise = channel.run(makePixels(2, 2, () => [255, 0, 0, 255]), { depth: { layers: 2 } }, {});
  await assert.rejects(promise, error => error.code === 'WORKER_FALLBACK_WORK_EXCEEDED');
  assert.equal(channel.status().pending, 0, 'oversized fallback must not leave pending jobs');
});

test('worker settlea todos los pending ante fallo de constructor', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  class FailingConstructorWorker {
    constructor() { throw new Error('constructor failure'); }
  }
  const calls = [];
  const voxelize = pixels => { calls.push(pixels.data[0]); return makeVoxelResult(pixels.data[0]); };
  const channel = context.window.VoxelWorkerChannel.create({
    WorkerCtor: FailingConstructorWorker,
    voxelize,
    transfer: context.window.VoxelTransfer,
    maxSynchronousWork: 10,
  });
  const a = channel.run(makePixels(1, 1, () => [1, 0, 0, 255]), {}, {});
  const b = channel.run(makePixels(1, 1, () => [2, 0, 0, 255]), {}, {});
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.marker, 1);
  assert.equal(rb.marker, 2);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(channel.status().pending, 0);
});

test('worker settlea todos los pending ante fallo de runtime', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const instances = [];
  class RuntimeFailureWorker {
    constructor() { instances.push(this); }
    postMessage(payload) { this.payload = payload; }
    terminate() { this.terminated = true; }
  }
  const calls = [];
  const voxelize = pixels => { calls.push(pixels.data[0]); return makeVoxelResult(pixels.data[0]); };
  const channel = context.window.VoxelWorkerChannel.create({
    WorkerCtor: RuntimeFailureWorker,
    voxelize,
    transfer: context.window.VoxelTransfer,
    backoffBaseMs: 0,
    maxSynchronousWork: 10,
  });
  const a = channel.run(makePixels(1, 1, () => [1, 0, 0, 255]), {}, {});
  const b = channel.run(makePixels(1, 1, () => [2, 0, 0, 255]), {}, {});
  instances[0].onerror({ message: 'runtime failure' });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.marker, 1);
  assert.equal(rb.marker, 2);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(channel.status().pending, 0);
});

test('worker no settlea pending duplicados ante fallo de encarnacion', async () => {
  const context = { window: {}, console, structuredClone, setTimeout, clearTimeout };
  vm.createContext(context); loadScript('transfer.js', context); loadScript('worker-channel.js', context);
  const instances = [];
  let resolves = 0;
  class PassiveWorker {
    constructor() { instances.push(this); }
    postMessage(payload) { this.payload = payload; }
    terminate() { this.terminated = true; }
  }
  const voxelize = () => { resolves++; return makeVoxelResult(); };
  const channel = context.window.VoxelWorkerChannel.create({
    WorkerCtor: PassiveWorker,
    voxelize,
    transfer: context.window.VoxelTransfer,
    backoffBaseMs: 0,
    maxSynchronousWork: 10,
  });
  const a = channel.run(makePixels(1, 1, () => [1, 0, 0, 255]), {}, {});
  const b = channel.run(makePixels(1, 1, () => [2, 0, 0, 255]), {}, {});
  instances[0].onerror({ message: 'runtime failure' });
  await Promise.all([a, b]);
  assert.equal(resolves, 2, 'each pending job must settle exactly once');
  assert.equal(channel.status().pending, 0);
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
