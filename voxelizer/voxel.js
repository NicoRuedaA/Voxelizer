/* Voxelizer core: pixels -> palette -> 3D grid -> faces (naive & greedy).
   Pure logic, no Three.js. Returns plain face descriptors that app.js
   turns into geometry. This is where the --depth / --alpha / quantize /
   --depth-map / greedy options actually take effect. */

const CONFIG_VERSION = 3;
const MAX_PIXEL_COUNT = 4 * 1024 * 1024;
const MAX_VOXEL_COUNT = 16 * 1024 * 1024;
// 256^3 is exactly the logical grid budget. Larger requested depths are
// normalized down before the W*H*D preflight validates the actual grid.
const MAX_DEPTH_LAYERS = 256;
const MAX_MORPH_WORK = 64 * 1024 * 1024;
const MAX_TOTAL_MORPH_WORK = 128 * 1024 * 1024;
const MAX_VIEW_COUNT = 8;
const MAX_AUX_PIXEL_COUNT = 8 * 1024 * 1024;
const MAX_AUX_BYTES = 32 * 1024 * 1024;
const MAX_MESH_VOXELS = 2 * 1024 * 1024;
const MAX_EXPOSED_FACES = 250000;
const MAX_FACE_ALLOCATION_BYTES = 64 * 1024 * 1024;
const FACE_OBJECT_ESTIMATE_BYTES = 152;
const MAX_MATERIAL_CLUSTERS = 64;
const MAX_MATERIAL_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_MATERIAL_COMPARE_WORK = 64 * 1024 * 1024;
const MAX_MATERIAL_TOLERANCE = 128;
const MAX_TRANSFORMED_VIEW_CELLS = 8 * 1024 * 1024;
const MAX_TRANSFORMED_VIEW_BYTES = 128 * 1024 * 1024;
const NO_MATERIAL = 255;
const MATERIAL_CONFIG_KEYS = ['enabled', 'tolerance', 'strength'];
const RESAMPLING_MODES = ['nearest', 'area', 'bilinear'];
const RECONSTRUCTION_MODES = ['strict', 'weighted'];
const DEPTH_VOLUME_MODES = ['symmetric', 'asymmetric', 'depthmap'];
const DEPTH_PROFILE_MODES = ['uniform', 'dt', 'poisson', 'sfs', 'combo', 'humanoid'];
const MESH_MODES = ['voxel'];
const LOD_LEVELS = ['high', 'medium', 'low'];
const COLOR_MODES = ['front', 'auxiliary'];
const SURFACE_COLOR_MODES = ['front', 'auxiliary', 'darken'];
const BACK_COLOR_MODES = ['front', 'darken', 'auxiliary'];
const CANONICAL_ORIENTATIONS = {
  front: { projection: 'orthographic', horizontal: '+X', vertical: '-Y' },
  back: { projection: 'orthographic', horizontal: '-X', vertical: '-Y' },
  left: { projection: 'orthographic', horizontal: '-Z', vertical: '-Y' },
  right: { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
  top: { projection: 'orthographic', horizontal: '+X', vertical: '+Z' },
  side: { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
  depthmap: { projection: 'orthographic', horizontal: '+X', vertical: '-Y' },
};

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  palette: {
    colors: 32,
  },
  input: {
    cap: 96,
  },
  silhouette: {
    alphaThreshold: 40,
    enabled: false,
    denoiseRadius: 0,
    closeRadius: 0,
    feather: 0,
    resampling: 'nearest',
  },
  alignment: {
    autoFit: false,
    side: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false, autoFit: false },
    top: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false, autoFit: false },
  },
  reconstruction: {
    mode: 'strict',
    threshold: 1,
    edgeTolerance: 0,
    frontWeight: 1,
    sideWeight: 1,
    topWeight: 1,
    hardFrontConstraint: true,
  },
  material: {
    enabled: true,
    tolerance: 48,
    strength: 0.6,
  },
  depth: {
    layers: 6,
    mode: 'symmetric',
    frontRatio: 0.5,
    profile: 'uniform',
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
    depthMapStrength: 1,
    invertDepthMap: false,
    localWidthAware: false,
  },
  mesh: {
    mode: 'voxel',
    greedy: true,
    scale: 1,
    ao: false,
    aoStrength: 0.8,
    lod: 'high',
  },
  color: {
    mode: 'front',
    side: 'front',
    back: 'front',
    darken: 0.72,
  },
  inference: {
    enabled: false,
    back: true,
  },
};

function _nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function _roundMs(value) {
  return Math.round(value * 1000) / 1000;
}
function _isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function _cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}
function _mergeDeep(base, patch) {
  if (!_isObject(patch)) return _isObject(base) ? { ...base } : patch;
  const out = _isObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const next = patch[key];
    out[key] = _isObject(next) ? _mergeDeep(out[key], next) : next;
  }
  return out;
}
function _pickEnum(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}
function _clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
function _clampInt(value, min, max, fallback) {
  return Math.round(_clampNumber(value, min, max, fallback));
}
function _coerceBool(value, fallback) {
  return value == null ? fallback : !!value;
}
function _configShape(input) {
  if (!_isObject(input)) return {};
  const out = {};
  const keys = ['version', 'palette', 'input', 'silhouette', 'alignment', 'reconstruction', 'material', 'depth', 'mesh', 'color', 'inference'];
  for (const key of keys) {
    const value = input[key];
    if (key === 'version') {
      if (value != null) out.version = value;
    } else if (_isObject(value)) {
      out[key] = value;
    }
  }
  return out;
}
function _legacyPatch(input) {
  if (!_isObject(input)) return {};
  const patch = {};
  if ('colors' in input) patch.palette = { ...(patch.palette || {}), colors: input.colors };
  if ('inputCap' in input) patch.input = { ...(patch.input || {}), cap: input.inputCap };
  if ('alpha' in input) patch.silhouette = { ...(patch.silhouette || {}), alphaThreshold: input.alpha };
  if ('greedy' in input) patch.mesh = { ...(patch.mesh || {}), greedy: input.greedy };
  if ('scale' in input) patch.mesh = { ...(patch.mesh || {}), scale: input.scale };
  if ('ao' in input) patch.mesh = { ...(patch.mesh || {}), ao: input.ao };
  if ('aoStrength' in input) patch.mesh = { ...(patch.mesh || {}), aoStrength: input.aoStrength };
  if ('lod' in input) patch.mesh = { ...(patch.mesh || {}), lod: input.lod };
  if ('depth' in input && !_isObject(input.depth)) patch.depth = { ...(patch.depth || {}), layers: input.depth };
  if ('depthMode' in input) patch.depth = { ...(patch.depth || {}), profile: input.depthMode };
  if ('relief' in input) patch.depth = { ...(patch.depth || {}), relief: input.relief };
  if ('dtRound' in input) patch.depth = { ...(patch.depth || {}), dtRound: input.dtRound };
  if ('poissonTension' in input) patch.depth = { ...(patch.depth || {}), poissonTension: input.poissonTension };
  if ('sfsGamma' in input) patch.depth = { ...(patch.depth || {}), sfsGamma: input.sfsGamma };
  if ('comboMix' in input) patch.depth = { ...(patch.depth || {}), comboMix: input.comboMix };
  if ('humTorso' in input) patch.depth = { ...(patch.depth || {}), humTorso: input.humTorso };
  if ('humRound' in input) patch.depth = { ...(patch.depth || {}), humRound: input.humRound };
  if ('humPrior' in input) patch.depth = { ...(patch.depth || {}), humPrior: input.humPrior };
  if ('humHead' in input) patch.depth = { ...(patch.depth || {}), humHead: input.humHead };
  if ('humSmooth' in input) patch.depth = { ...(patch.depth || {}), humSmooth: input.humSmooth };
  if ('depthVolumeMode' in input) patch.depth = { ...(patch.depth || {}), mode: input.depthVolumeMode };
  if ('frontRatio' in input) patch.depth = { ...(patch.depth || {}), frontRatio: input.frontRatio };
  if ('depthMapStrength' in input) patch.depth = { ...(patch.depth || {}), depthMapStrength: input.depthMapStrength };
  if ('invertDepthMap' in input) patch.depth = { ...(patch.depth || {}), invertDepthMap: input.invertDepthMap };
  if ('localWidthAware' in input) patch.depth = { ...(patch.depth || {}), localWidthAware: input.localWidthAware };
  if ('silhouetteEnabled' in input) patch.silhouette = { ...(patch.silhouette || {}), enabled: input.silhouetteEnabled };
  if ('denoiseRadius' in input) patch.silhouette = { ...(patch.silhouette || {}), denoiseRadius: input.denoiseRadius };
  if ('closeRadius' in input) patch.silhouette = { ...(patch.silhouette || {}), closeRadius: input.closeRadius };
  if ('feather' in input) patch.silhouette = { ...(patch.silhouette || {}), feather: input.feather };
  if ('resampling' in input) patch.silhouette = { ...(patch.silhouette || {}), resampling: input.resampling };
  if ('reconstructionMode' in input) patch.reconstruction = { ...(patch.reconstruction || {}), mode: input.reconstructionMode };
  if ('reconstructionThreshold' in input) patch.reconstruction = { ...(patch.reconstruction || {}), threshold: input.reconstructionThreshold };
  if ('edgeTolerance' in input) patch.reconstruction = { ...(patch.reconstruction || {}), edgeTolerance: input.edgeTolerance };
  if ('frontWeight' in input) patch.reconstruction = { ...(patch.reconstruction || {}), frontWeight: input.frontWeight };
  if ('sideWeight' in input) patch.reconstruction = { ...(patch.reconstruction || {}), sideWeight: input.sideWeight };
  if ('topWeight' in input) patch.reconstruction = { ...(patch.reconstruction || {}), topWeight: input.topWeight };
  if ('hardFrontConstraint' in input) patch.reconstruction = { ...(patch.reconstruction || {}), hardFrontConstraint: input.hardFrontConstraint };
  if ('materialAwareness' in input) patch.material = { ...(patch.material || {}), enabled: input.materialAwareness };
  if ('materialTolerance' in input) patch.material = { ...(patch.material || {}), tolerance: input.materialTolerance };
  if ('materialStrength' in input) patch.material = { ...(patch.material || {}), strength: input.materialStrength };
  if ('colorMode' in input) patch.color = { ...(patch.color || {}), mode: input.colorMode };
  if ('sideColorMode' in input) patch.color = { ...(patch.color || {}), side: input.sideColorMode };
  if ('backColorMode' in input) patch.color = { ...(patch.color || {}), back: input.backColorMode };
  if ('colorDarken' in input) patch.color = { ...(patch.color || {}), darken: input.colorDarken };
  if ('inferenceEnabled' in input) patch.inference = { ...(patch.inference || {}), enabled: input.inferenceEnabled };
  if ('inferenceBack' in input) patch.inference = { ...(patch.inference || {}), back: input.inferenceBack };
  return patch;
}
function _normalizeViewTransform(input) {
  const source = _isObject(input) ? input : {};
  return {
    offsetX: _clampNumber(source.offsetX, -4096, 4096, 0),
    offsetY: _clampNumber(source.offsetY, -4096, 4096, 0),
    scale: _clampNumber(source.scale, 0.1, 8, 1),
    rotation: _clampNumber(source.rotation, -180, 180, 0),
    flipX: _coerceBool(source.flipX, false),
    autoFit: _coerceBool(source.autoFit, false),
  };
}
function createDefaultConfig() {
  return _cloneConfig(DEFAULT_CONFIG);
}
function migrateConfig(input) {
  if (!_isObject(input)) return input;
  const migrated = _cloneConfig(input);
  const version = Number(migrated.version);
  if (version === 1) {
    migrated.depth = { ...(migrated.depth || {}), localWidthAware: false };
  }
  if (version === 1 || version === 2) {
    const explicitMaterialFields = (_isObject(migrated.material) && MATERIAL_CONFIG_KEYS.some(key => key in migrated.material))
      || ['materialAwareness', 'materialTolerance', 'materialStrength'].some(key => key in migrated);
    if (!explicitMaterialFields) migrated.material = { ...(migrated.material || {}), enabled: false };
    migrated.version = CONFIG_VERSION;
  }
  return migrated;
}
function normalizeConfig(input) {
  input = migrateConfig(input);
  const merged = _mergeDeep(
    _mergeDeep(createDefaultConfig(), _legacyPatch(input)),
    _configShape(input)
  );
  const normalized = {
    version: CONFIG_VERSION,
    palette: {
      colors: _clampInt(merged.palette && merged.palette.colors, 2, 256, DEFAULT_CONFIG.palette.colors),
    },
    input: {
      cap: _clampInt(merged.input && merged.input.cap, 16, 1024, DEFAULT_CONFIG.input.cap),
    },
    silhouette: {
      alphaThreshold: _clampInt(merged.silhouette && merged.silhouette.alphaThreshold, 0, 255, DEFAULT_CONFIG.silhouette.alphaThreshold),
      enabled: _coerceBool(merged.silhouette && merged.silhouette.enabled, DEFAULT_CONFIG.silhouette.enabled),
      denoiseRadius: _clampInt(merged.silhouette && merged.silhouette.denoiseRadius, 0, 16, DEFAULT_CONFIG.silhouette.denoiseRadius),
      closeRadius: _clampInt(merged.silhouette && merged.silhouette.closeRadius, 0, 16, DEFAULT_CONFIG.silhouette.closeRadius),
      feather: _clampNumber(merged.silhouette && merged.silhouette.feather, 0, 1, DEFAULT_CONFIG.silhouette.feather),
      resampling: _pickEnum(merged.silhouette && merged.silhouette.resampling, RESAMPLING_MODES, DEFAULT_CONFIG.silhouette.resampling),
    },
    alignment: {
      autoFit: _coerceBool(merged.alignment && merged.alignment.autoFit, DEFAULT_CONFIG.alignment.autoFit),
      side: _normalizeViewTransform(merged.alignment && merged.alignment.side),
      top: _normalizeViewTransform(merged.alignment && merged.alignment.top),
    },
    reconstruction: {
      mode: _pickEnum(merged.reconstruction && merged.reconstruction.mode, RECONSTRUCTION_MODES, DEFAULT_CONFIG.reconstruction.mode),
      threshold: _clampNumber(merged.reconstruction && merged.reconstruction.threshold, 0, 3, DEFAULT_CONFIG.reconstruction.threshold),
      edgeTolerance: _clampNumber(merged.reconstruction && merged.reconstruction.edgeTolerance, 0, 1, DEFAULT_CONFIG.reconstruction.edgeTolerance),
      frontWeight: _clampNumber(merged.reconstruction && merged.reconstruction.frontWeight, 0, 4, DEFAULT_CONFIG.reconstruction.frontWeight),
      sideWeight: _clampNumber(merged.reconstruction && merged.reconstruction.sideWeight, 0, 4, DEFAULT_CONFIG.reconstruction.sideWeight),
      topWeight: _clampNumber(merged.reconstruction && merged.reconstruction.topWeight, 0, 4, DEFAULT_CONFIG.reconstruction.topWeight),
      hardFrontConstraint: _coerceBool(merged.reconstruction && merged.reconstruction.hardFrontConstraint, DEFAULT_CONFIG.reconstruction.hardFrontConstraint),
    },
    material: {
      enabled: _coerceBool(merged.material && merged.material.enabled, DEFAULT_CONFIG.material.enabled),
      tolerance: _clampNumber(merged.material && merged.material.tolerance, 0, MAX_MATERIAL_TOLERANCE, DEFAULT_CONFIG.material.tolerance),
      strength: _clampNumber(merged.material && merged.material.strength, 0, 1, DEFAULT_CONFIG.material.strength),
    },
    depth: {
      layers: _clampInt(merged.depth && merged.depth.layers, 1, MAX_DEPTH_LAYERS, DEFAULT_CONFIG.depth.layers),
      mode: _pickEnum(merged.depth && merged.depth.mode, DEPTH_VOLUME_MODES, DEFAULT_CONFIG.depth.mode),
      frontRatio: _clampNumber(merged.depth && merged.depth.frontRatio, 0, 1, DEFAULT_CONFIG.depth.frontRatio),
      profile: _pickEnum(merged.depth && merged.depth.profile, DEPTH_PROFILE_MODES, DEFAULT_CONFIG.depth.profile),
      relief: _clampNumber(merged.depth && merged.depth.relief, 0, 1, DEFAULT_CONFIG.depth.relief),
      dtRound: _clampNumber(merged.depth && merged.depth.dtRound, 0, 1, DEFAULT_CONFIG.depth.dtRound),
      poissonTension: _clampNumber(merged.depth && merged.depth.poissonTension, 0, 1, DEFAULT_CONFIG.depth.poissonTension),
      sfsGamma: _clampNumber(merged.depth && merged.depth.sfsGamma, 0.25, 4, DEFAULT_CONFIG.depth.sfsGamma),
      comboMix: _clampNumber(merged.depth && merged.depth.comboMix, 0, 1, DEFAULT_CONFIG.depth.comboMix),
      humTorso: _clampNumber(merged.depth && merged.depth.humTorso, 0.1, 2, DEFAULT_CONFIG.depth.humTorso),
      humRound: _clampNumber(merged.depth && merged.depth.humRound, 0, 1, DEFAULT_CONFIG.depth.humRound),
      humPrior: _clampNumber(merged.depth && merged.depth.humPrior, 0, 1, DEFAULT_CONFIG.depth.humPrior),
      humHead: _clampNumber(merged.depth && merged.depth.humHead, 0.05, 0.5, DEFAULT_CONFIG.depth.humHead),
      humSmooth: _clampNumber(merged.depth && merged.depth.humSmooth, 0, 1, DEFAULT_CONFIG.depth.humSmooth),
      depthMapStrength: _clampNumber(merged.depth && merged.depth.depthMapStrength, 0, 4, DEFAULT_CONFIG.depth.depthMapStrength),
      invertDepthMap: _coerceBool(merged.depth && merged.depth.invertDepthMap, DEFAULT_CONFIG.depth.invertDepthMap),
      localWidthAware: _coerceBool(merged.depth && merged.depth.localWidthAware, DEFAULT_CONFIG.depth.localWidthAware),
    },
    mesh: {
      mode: _pickEnum(merged.mesh && merged.mesh.mode, MESH_MODES, DEFAULT_CONFIG.mesh.mode),
      greedy: _coerceBool(merged.mesh && merged.mesh.greedy, DEFAULT_CONFIG.mesh.greedy),
      scale: _clampNumber(merged.mesh && merged.mesh.scale, 0.1, 16, DEFAULT_CONFIG.mesh.scale),
      ao: _coerceBool(merged.mesh && merged.mesh.ao, DEFAULT_CONFIG.mesh.ao),
      aoStrength: _clampNumber(merged.mesh && merged.mesh.aoStrength, 0, 1, DEFAULT_CONFIG.mesh.aoStrength),
      lod: _pickEnum(merged.mesh && merged.mesh.lod, LOD_LEVELS, DEFAULT_CONFIG.mesh.lod),
    },
    color: {
      mode: _pickEnum(merged.color && merged.color.mode, COLOR_MODES, DEFAULT_CONFIG.color.mode),
      side: _pickEnum(merged.color && merged.color.side, SURFACE_COLOR_MODES, DEFAULT_CONFIG.color.side),
      back: _pickEnum(merged.color && merged.color.back, BACK_COLOR_MODES, DEFAULT_CONFIG.color.back),
      darken: _clampNumber(merged.color && merged.color.darken, 0.1, 1, DEFAULT_CONFIG.color.darken),
    },
    inference: {
      enabled: _coerceBool(merged.inference && merged.inference.enabled, DEFAULT_CONFIG.inference.enabled),
      back: _coerceBool(merged.inference && merged.inference.back, DEFAULT_CONFIG.inference.back),
    },
  };
  return normalized;
}
function legacyOptionsFromConfig(input) {
  const config = normalizeConfig(input);
  return {
    depth: config.depth.layers,
    alpha: config.silhouette.alphaThreshold,
    colors: config.palette.colors,
    greedy: config.mesh.greedy,
    depthMode: config.depth.profile,
    relief: config.depth.relief,
    scale: config.mesh.scale,
    inputCap: config.input.cap,
    dtRound: config.depth.dtRound,
    poissonTension: config.depth.poissonTension,
    sfsGamma: config.depth.sfsGamma,
    comboMix: config.depth.comboMix,
    ao: config.mesh.ao,
    aoStrength: config.mesh.aoStrength,
    lod: config.mesh.lod,
    humTorso: config.depth.humTorso,
    humRound: config.depth.humRound,
    humPrior: config.depth.humPrior,
    humHead: config.depth.humHead,
    humSmooth: config.depth.humSmooth,
    depthVolumeMode: config.depth.mode,
    frontRatio: config.depth.frontRatio,
    depthMapStrength: config.depth.depthMapStrength,
    invertDepthMap: config.depth.invertDepthMap,
    localWidthAware: config.depth.localWidthAware,
    silhouetteEnabled: config.silhouette.enabled,
    denoiseRadius: config.silhouette.denoiseRadius,
    closeRadius: config.silhouette.closeRadius,
    feather: config.silhouette.feather,
    resampling: config.silhouette.resampling,
    reconstructionMode: config.reconstruction.mode,
    reconstructionThreshold: config.reconstruction.threshold,
    edgeTolerance: config.reconstruction.edgeTolerance,
    frontWeight: config.reconstruction.frontWeight,
    sideWeight: config.reconstruction.sideWeight,
    topWeight: config.reconstruction.topWeight,
    hardFrontConstraint: config.reconstruction.hardFrontConstraint,
    materialAwareness: config.material.enabled,
    materialTolerance: config.material.tolerance,
    materialStrength: config.material.strength,
    colorMode: config.color.mode,
    sideColorMode: config.color.side,
    backColorMode: config.color.back,
    colorDarken: config.color.darken,
    inferenceEnabled: config.inference.enabled,
    inferenceBack: config.inference.back,
  };
}
function defaultLegacyOptions() {
  return legacyOptionsFromConfig(DEFAULT_CONFIG);
}
function inferViews(frontPixels, config) {
  const normalized = normalizeConfig(config);
  if (!normalized.inference.enabled || !normalized.inference.back) return null;
  const source = validatePixels(frontPixels, 'front');
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
  return { role: 'back', pixels: { w, h, data: mirrored }, inferred: true };
}
function _measureStage(stageMs, name, fn) {
  const start = _nowMs();
  const value = fn();
  stageMs[name] = _roundMs(_nowMs() - start);
  return value;
}
function _byteLength(value) {
  if (!value) return 0;
  if (typeof value.byteLength === 'number') return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + _byteLength(item), 0);
  return 0;
}
function _estimateMemoryBytes(parts) {
  let total = 0;
  for (const value of Object.values(parts)) total += _byteLength(value);
  return total;
}

// ---- read opaque pixels from any canvas ----
function canvasToPixels(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  return { w, h, data };
}

function validatePixels(pixels, label) {
  const name = label || 'pixels';
  if (!pixels || typeof pixels !== 'object') throw new TypeError(`${name} must be a pixel payload`);
  const w = pixels.w, h = pixels.h;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0)
    throw new RangeError(`${name} dimensions must be positive safe integers`);
  if (w > Math.floor(Number.MAX_SAFE_INTEGER / h)) throw _budgetError('PIXEL_DIMENSION_OVERFLOW', `${name} dimensions overflow safe multiplication`);
  const count = w * h;
  if (count > MAX_PIXEL_COUNT) throw _budgetError('PIXEL_BUDGET_EXCEEDED', `${name} exceeds the ${MAX_PIXEL_COUNT}-pixel budget`);
  const data = pixels.data;
  const typedRgba = ArrayBuffer.isView(data) && !(data instanceof DataView)
    && data.BYTES_PER_ELEMENT === 1 && (data.constructor.name === 'Uint8Array' || data.constructor.name === 'Uint8ClampedArray');
  if (!typedRgba) throw new TypeError(`${name}.data must be Uint8Array or Uint8ClampedArray RGBA data`);
  if (data.length !== count * 4)
    throw new RangeError(`${name}.data length must equal w*h*4`);
  return { w, h, data };
}

function _budgetError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}
function _assertVoxelBudget(w, h, depth) {
  if (w > Math.floor(Number.MAX_SAFE_INTEGER / h) || w * h > Math.floor(Number.MAX_SAFE_INTEGER / depth))
    throw _budgetError('VOXEL_DIMENSION_OVERFLOW', 'Voxel dimensions overflow safe multiplication');
  const count = w * h * depth;
  if (count > MAX_VOXEL_COUNT) throw _budgetError('VOXEL_BUDGET_EXCEEDED', `Voxel grid exceeds the ${MAX_VOXEL_COUNT}-cell budget`);
  return count;
}

function _binaryMorph(mask, w, h, radius, dilate) {
  if (!radius) return new Uint8Array(mask);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let value = dilate ? 0 : 1;
    outer: for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
        const hit = mask[xx + w * yy] ? 1 : 0;
        if ((dilate && hit) || (!dilate && !hit)) { value = dilate ? 1 : 0; break outer; }
      }
    }
    out[x + w * y] = value;
  }
  return out;
}

function _preprocessMask(mask, w, h, config) {
  if (!config.enabled) return new Uint8Array(mask);
  let out = new Uint8Array(mask);
  if (config.denoiseRadius > 0) {
    out = _binaryMorph(_binaryMorph(out, w, h, config.denoiseRadius, false), w, h, config.denoiseRadius, true);
  }
  if (config.closeRadius > 0) {
    out = _binaryMorph(_binaryMorph(out, w, h, config.closeRadius, true), w, h, config.closeRadius, false);
  }
  return out;
}

function _morphWork(w, h, silhouette) {
  if (!silhouette.enabled) return 0;
  const radius = Math.max(silhouette.denoiseRadius, silhouette.closeRadius);
  return w * h * Math.max(1, (2 * radius + 1) ** 2) * 4;
}

function preprocessPixels(pixels, silhouette) {
  const normalized = validatePixels(pixels, 'front');
  const { w, h, data } = normalized;
  if (!silhouette.enabled) return normalized;
  const work = _morphWork(w, h, silhouette);
  if (work > MAX_MORPH_WORK) throw _budgetError('MORPH_BUDGET_EXCEEDED', `Silhouette morphology exceeds the ${MAX_MORPH_WORK}-operation budget`);
  const mask = _preprocessMask(_maskFrom(normalized, silhouette.alphaThreshold), w, h, silhouette);
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = mask[i] ? 255 : 0;
  return { w, h, data: out };
}

// ---- agglomerative palette quantization (merge nearest colors) ----
function quantize(pixels, alphaThresh, maxColors) {
  const { w, h, data } = pixels;
  const cutoff = Math.max(0, Math.min(255, alphaThresh | 0));
  const targetColors = Math.max(1, maxColors | 0);
  // collect unique opaque colors with counts + per-pixel color key
  const map = new Map();
  const keyAt = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a <= cutoff) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const k = (r << 16) | (g << 8) | b;
    let e = map.get(k);
    if (!e) { e = { r, g, b, n: 0, id: map.size }; map.set(k, e); }
    e.n++;
    keyAt[i] = k;
  }
  let colors = [...map.values()];
  function d2(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  }
  let groups;
  // cap seed groups before merging for perf, but keep every source color mapped
  const seedLimit = Math.max(targetColors, 160);
  if (colors.length > seedLimit) {
    colors.sort((a, b) => b.n - a.n);
    groups = colors.slice(0, seedLimit).map(c => ({
      r: c.r, g: c.g, b: c.b, n: c.n, keys: [(c.r << 16) | (c.g << 8) | c.b]
    }));
    for (let i = seedLimit; i < colors.length; i++) {
      const c = colors[i];
      let best = 0, bestDist = Infinity;
      for (let j = 0; j < groups.length; j++) {
        const dist = d2(c, groups[j]);
        if (dist < bestDist) { best = j; bestDist = dist; }
      }
      const grp = groups[best];
      const tot = grp.n + c.n;
      grp.r = Math.round((grp.r * grp.n + c.r * c.n) / tot);
      grp.g = Math.round((grp.g * grp.n + c.g * c.n) / tot);
      grp.b = Math.round((grp.b * grp.n + c.b * c.n) / tot);
      grp.n = tot;
      grp.keys.push((c.r << 16) | (c.g << 8) | c.b);
    }
  } else {
    groups = colors.map(c => ({ r: c.r, g: c.g, b: c.b, n: c.n, keys: [(c.r << 16) | (c.g << 8) | c.b] }));
  }
  // merge nearest pair until <= maxColors
  while (groups.length > targetColors && groups.length > 1) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const dd = d2(groups[i], groups[j]);
        if (dd < best) { best = dd; bi = i; bj = j; }
      }
    const A = groups[bi], B = groups[bj], tot = A.n + B.n;
    A.r = Math.round((A.r * A.n + B.r * B.n) / tot);
    A.g = Math.round((A.g * A.n + B.g * B.n) / tot);
    A.b = Math.round((A.b * A.n + B.b * B.n) / tot);
    A.n = tot;
    A.keys = A.keys.concat(B.keys);
    groups.splice(bj, 1);
  }
  // map original color key -> final palette index
  const keyToIdx = new Map();
  groups.forEach((grp, idx) => grp.keys.forEach(k => keyToIdx.set(k, idx)));
  const palette = groups.map(grp => [grp.r, grp.g, grp.b]);
  // per-pixel palette index (-1 transparent)
  const idxAt = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = keyAt[i];
    idxAt[i] = k < 0 ? -1 : (keyToIdx.has(k) ? keyToIdx.get(k) : -1);
  }
  return { palette, idxAt, w, h };
}

// ===================== DEPTH PROFILES (relief modes) =====================
// Cada funcion devuelve un Float32Array(w*h) con valores 0..1 dentro de la
// mascara (0 fuera). buildGrid lo convierte en grosor por pixel.

// 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher, O(n)).
function _edt1d(f, d, n) {
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k]; d[q] = dx * dx + f[v[k]];
  }
}
function _edtSq(mask, w, h) {
  const INF = 1e20, f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? INF : 0; // dist FG->BG
  const cf = new Float64Array(h), cd = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) cf[y] = f[x + w * y];
    _edt1d(cf, cd, h);
    for (let y = 0; y < h; y++) f[x + w * y] = cd[y];
  }
  const rf = new Float64Array(w), rd = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rf[x] = f[x + w * y];
    _edt1d(rf, rd, w);
    for (let x = 0; x < w; x++) f[x + w * y] = rd[x];
  }
  return f;
}

function _componentLabels(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const components = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = components.length;
    let head = 0, tail = 0;
    queue[tail++] = start; labels[start] = id;
    const indices = [];
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      indices.push(i);
      const next = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1];
      for (const n of next) if (n >= 0 && mask[n] && labels[n] < 0) { labels[n] = id; queue[tail++] = n; }
    }
    components.push(indices);
  }
  return { labels, components };
}

// (A) Distance transform. 'round' 0..1 mezcla bisel lineal <-> hombro esferico.
function _profDT(mask, w, h, round, componentLocal) {
  if (round == null) round = 1;
  const sq = _edtSq(mask, w, h);
  const componentState = componentLocal ? _componentLabels(mask, w, h) : null;
  const maxima = new Float64Array(componentState ? componentState.components.length : 1);
  for (let i = 0; i < w * h; i++) if (mask[i]) {
    const d = Math.sqrt(sq[i]), id = componentState ? componentState.labels[i] : 0;
    if (d > maxima[id]) maxima[id] = d;
  }
  const p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) if (mask[i]) {
    const mx = maxima[componentState ? componentState.labels[i] : 0] || 1;
    const dn = Math.sqrt(sq[i]) / mx;
    const sph = Math.sqrt(Math.max(0, 2 * dn - dn * dn)); // hombro esferico
    p[i] = dn + round * (sph - dn);                       // 0=bisel, 1=esfera
  }
  return p;
}

// (B) Poisson "screened": (4+lambda)z = 1 + sum(vecinos). lambda alto -> meseta.
function _profPoisson(mask, w, h, tension) {
  const lambda = Math.max(0, tension || 0) * 3; // 0..1 -> 0..3
  const denom = 4 + lambda;
  const z = new Float64Array(w * h);
  const iters = Math.min(400, 120 + Math.max(w, h) * 4);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + w * y; if (!mask[i]) continue;
      let s = 1.0;
      if (x > 0 && mask[i - 1]) s += z[i - 1];
      if (x < w - 1 && mask[i + 1]) s += z[i + 1];
      if (y > 0 && mask[i - w]) s += z[i - w];
      if (y < h - 1 && mask[i + w]) s += z[i + w];
      z[i] = s / denom;
    }
  }
  let mx = 0;
  for (let i = 0; i < w * h; i++) if (mask[i] && z[i] > mx) mx = z[i];
  const p = new Float32Array(w * h);
  if (mx > 0) for (let i = 0; i < w * h; i++) if (mask[i]) p[i] = z[i] / mx;
  return p;
}

// luminancia normalizada 0..1 dentro de la mascara
function _normLum(mask, lum, w, h) {
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < w * h; i++) if (mask[i]) { if (lum[i] < mn) mn = lum[i]; if (lum[i] > mx) mx = lum[i]; }
  const r = (mx - mn) || 1, p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) if (mask[i]) p[i] = (lum[i] - mn) / r;
  return p;
}

// (C) SFS: relieve = luminancia^gamma. gamma<1 abulta lo medio, >1 solo lo brillante.
function _profSFS(mask, lum, w, h, gamma) {
  const g = gamma == null ? 1 : gamma;
  const Ln = _normLum(mask, lum, w, h);
  if (g !== 1) for (let i = 0; i < w * h; i++) if (mask[i]) Ln[i] = Math.pow(Ln[i], g);
  return Ln;
}

// (D) Combo: bulto DT modulado por la sombra. 'mix' 0=solo DT, 1=sombra fuerte.
function _profCombo(mask, lum, w, h, mix, componentLocal) {
  const m = mix == null ? 0.5 : mix;
  const dt = _profDT(mask, w, h, 1, componentLocal), sf = _normLum(mask, lum, w, h);
  const p = new Float32Array(w * h);
  let mx = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) {
    p[i] = dt[i] * ((1 - m) + m * (0.2 + 1.6 * sf[i]));
    if (p[i] > mx) mx = p[i];
  }
  if (mx > 0) for (let i = 0; i < w * h; i++) if (mask[i]) p[i] /= mx;
  return p;
}

// (E) Humanoide: segmentacion por bandas (nivel 1) + forma/runs (nivel 2),
// con seccion transversal por parte (cabeza esfera, torso caja, miembros
// cilindros). Simetrico/centrado. Sin necesidad de vista de perfil.
function _smoothMasked(p, mask, w, h, s) {
  const iters = Math.round(s * 3);
  let cur = p;
  for (let it = 0; it < iters; it++) {
    const nx = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + w * y; if (!mask[i]) continue;
      let acc = cur[i], c = 1;
      if (x > 0 && mask[i - 1]) { acc += cur[i - 1]; c++; }
      if (x < w - 1 && mask[i + 1]) { acc += cur[i + 1]; c++; }
      if (y > 0 && mask[i - w]) { acc += cur[i - w]; c++; }
      if (y < h - 1 && mask[i + w]) { acc += cur[i + w]; c++; }
      nx[i] = acc / c;
    }
    cur = nx;
  }
  return cur;
}
function _profHumanoid(mask, lum, w, h, o) {
  const kTorso = o.humTorso == null ? 0.7 : o.humTorso;
  const round = o.humRound == null ? 1 : o.humRound;
  const prior = o.humPrior == null ? 0.4 : o.humPrior;
  const headFr = o.humHead == null ? 0.25 : o.humHead;
  const smooth = o.humSmooth == null ? 0.3 : o.humSmooth;
  const nLimb = 2 + (1 - round) * 6;   // 2 redondo .. 8 cuadrado
  const nTorso = 4 + (1 - round) * 4;

  let ymin = h, ymax = -1;
  for (let y = 0; y < h; y++) { let a = false; for (let x = 0; x < w; x++) if (mask[x + w * y]) { a = true; break; } if (a) { if (y < ymin) ymin = y; ymax = y; } }
  if (ymax < 0) return new Float32Array(w * h);
  const Ht = (ymax - ymin) || 1;
  const headBot = ymin + headFr * Ht;
  const torsoBot = ymin + Math.max(headFr + 0.08, 0.55) * Ht;
  const band = y => y <= headBot ? 0 : (y <= torsoBot ? 1 : 2);   // 0 cabeza,1 torso,2 piernas
  const cross = (u, n) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), n)), 1 / n);

  const rawSeg = new Float32Array(w * h), rawBand = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const bt = band(y);
    const runs = [];
    let x = 0;
    while (x < w) {
      if (!mask[x + w * y]) { x++; continue; }
      const x0 = x; while (x < w && mask[x + w * y]) x++;
      runs.push([x0, x]);
    }
    const multi = runs.length >= 2;
    for (const [x0, x1] of runs) {
      const wid = x1 - x0;
      // nivel 2 (segmentacion forma): varios runs -> miembro
      let kS, nS;
      if (multi) { kS = 1; nS = nLimb; }
      else if (bt === 0) { kS = 1; nS = 2; }
      else if (bt === 1) { kS = kTorso; nS = nTorso; }
      else { kS = 1; nS = nLimb; }
      // nivel 1 (plantilla por bandas): solo el tipo de banda
      let kB, nB;
      if (bt === 0) { kB = 1; nB = 2; }
      else if (bt === 1) { kB = kTorso; nB = nTorso; }
      else { kB = 1; nB = nLimb; }
      for (let xx = x0; xx < x1; xx++) {
        const u = (xx - x0 + 0.5) / wid, i = xx + w * y;
        rawSeg[i] = kS * wid * cross(u, nS);
        rawBand[i] = kB * wid * cross(u, nB);
      }
    }
  }
  // cascada: mezcla nivel1 (prior) <-> nivel2 (evidencia)
  let mx = 0;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { raw[i] = (1 - prior) * rawSeg[i] + prior * rawBand[i]; if (raw[i] > mx) mx = raw[i]; }
  let prof = new Float32Array(w * h);
  if (mx > 0) for (let i = 0; i < w * h; i++) if (mask[i]) prof[i] = raw[i] / mx;
  return smooth > 0 ? _smoothMasked(prof, mask, w, h, smooth) : prof;
}

function _applyLocalWidth(profile, mask, w, h) {
  if (!profile) return profile;
  const widths = new Uint16Array(w * h);
  let maxWidth = 1;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[x + w * y]) { x++; continue; }
      const x0 = x;
      while (x < w && mask[x + w * y]) x++;
      const width = x - x0;
      if (width > maxWidth) maxWidth = width;
      for (let xx = x0; xx < x; xx++) widths[xx + w * y] = width;
    }
  }
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) if (mask[i]) {
    const local = Math.sqrt(Math.max(1, widths[i]) / maxWidth);
    out[i] = Math.max(0, Math.min(1, profile[i] * local));
  }
  return out;
}

// dispatcher: quant + modo + opts -> perfil 0..1
function depthProfile(quant, mode, opts) {
  const { idxAt, palette, w, h } = quant;
  const mask = new Uint8Array(w * h), lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const ci = idxAt[i];
    if (ci >= 0) {
      mask[i] = 1;
      const c = palette[ci];
      lum[i] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    }
  }
  let profile = null;
  if (mode === 'dt') profile = _profDT(mask, w, h, opts.dtRound, !!opts.localWidthAware);
  else if (mode === 'poisson') profile = _profPoisson(mask, w, h, opts.poissonTension);
  else if (mode === 'sfs') profile = _profSFS(mask, lum, w, h, opts.sfsGamma);
  else if (mode === 'combo') profile = _profCombo(mask, lum, w, h, opts.comboMix, !!opts.localWidthAware);
  else if (mode === 'humanoid') profile = _profHumanoid(mask, lum, w, h, opts);
  if (profile && mode !== 'humanoid' && opts.localWidthAware) return _applyLocalWidth(profile, mask, w, h);
  if (profile) return profile;
  return null; // uniforme
}

function depthSpanAt(index, depth, prof, relief) {
  if (!prof) return depth;
  const norm = (1 - relief) + relief * prof[index];
  return Math.max(1, Math.round(norm * depth));
}

// ---- build 3D voxel grid from quantized pixels ----
function _depthStart(depth, span, mode, frontRatio) {
  if (mode !== 'asymmetric') return (depth - span) >> 1;
  return Math.max(0, Math.min(depth - span, Math.round((depth - span) * frontRatio)));
}

function buildGrid(quant, depthState) {
  const { idxAt, w, h } = quant;
  const depth = Math.max(1, depthState.layers | 0);
  const relief = (depthState.relief == null) ? 1 : Math.max(0, Math.min(1, depthState.relief));
  const prof = depthState.profile || null;
  const DX = w, DY = h, DZ = depth;
  _assertVoxelBudget(DX, DY, DZ);
  const grid = new Int16Array(DX * DY * DZ).fill(-1);
  let voxels = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = px + w * py;
      const ci = idxAt[i];
      if (ci < 0) continue;
      const dz = depthSpanAt(i, depth, prof, relief);
      const gx = px, gy = (h - 1 - py); // flip so up is +Y
      const z0 = _depthStart(DZ, dz, depthState.mode, depthState.frontRatio);
      for (let z = z0; z < z0 + dz; z++) {
        grid[gx + DX * (gy + DY * z)] = ci;
        voxels++;
      }
    }
  }
  return { grid, dims: [DX, DY, DZ], voxels };
}

// ---- face extraction ----
function unitFace(x, y, z, dir, color) {
  // dir: 0 +X,1 -X,2 +Y,3 -Y,4 +Z,5 -Z
  const F = {
    0: { c: [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], n: [1, 0, 0] },
    1: { c: [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]], n: [-1, 0, 0] },
    2: { c: [[x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]], n: [0, 1, 0] },
    3: { c: [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], n: [0, -1, 0] },
    4: { c: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], n: [0, 0, 1] },
    5: { c: [[x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]], n: [0, 0, -1] },
  }[dir];
  return { corners: F.c, normal: F.n, color };
}

function naiveFaces(grid, dims, colorAtFace) {
  const [DX, DY, DZ] = dims;
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) ? -1 : grid[x + DX * (y + DY * z)];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faces = [];
  for (let z = 0; z < DZ; z++) for (let y = 0; y < DY; y++) for (let x = 0; x < DX; x++) {
    const c = get(x, y, z); if (c < 0) continue;
    for (let d = 0; d < 6; d++) {
      const [nx, ny, nz] = dirs[d];
      if (get(x + nx, y + ny, z + nz) < 0) faces.push(unitFace(x, y, z, d, colorAtFace ? colorAtFace(x, y, z, d, c) : c));
    }
  }
  return faces;
}

function greedyFaces(grid, dims, colorAtFace) {
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) ? -1 : grid[x + dims[0] * (y + dims[1] * z)];
  const faces = [];
  const same = (a, b) => a && b && a.color === b.color && a.dir === b.dir;
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const x = [0, 0, 0], q = [0, 0, 0]; q[d] = 1;
    const mask = new Array(dims[u] * dims[v]);
    for (x[d] = -1; x[d] < dims[d];) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++, n++) {
          const a = x[d] >= 0 ? get(x[0], x[1], x[2]) : -1;
          const b = x[d] < dims[d] - 1 ? get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : -1;
          if (a >= 0 && b < 0) mask[n] = { color: colorAtFace ? colorAtFace(x[0], x[1], x[2], d * 2, a) : a, dir: 1 };
          else if (b >= 0 && a < 0) mask[n] = { color: colorAtFace ? colorAtFace(x[0] + q[0], x[1] + q[1], x[2] + q[2], d * 2 + 1, b) : b, dir: -1 };
          else mask[n] = null;
        }
      }
      x[d]++;
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u];) {
          const m = mask[n];
          if (m) {
            let w = 1;
            while (i + w < dims[u] && same(mask[n + w], m)) w++;
            let hh = 1, stop = false;
            while (j + hh < dims[v]) {
              for (let k = 0; k < w; k++) if (!same(mask[n + k + hh * dims[u]], m)) { stop = true; break; }
              if (stop) break; hh++;
            }
            const pos = [0, 0, 0]; pos[u] = i; pos[v] = j; pos[d] = x[d];
            const du = [0, 0, 0]; du[u] = w;
            const dv = [0, 0, 0]; dv[v] = hh;
            const p = pos;
            const corners = [
              [p[0], p[1], p[2]],
              [p[0] + du[0], p[1] + du[1], p[2] + du[2]],
              [p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]],
              [p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]],
            ];
            const normal = [0, 0, 0]; normal[d] = m.dir;
            faces.push({ corners, normal, color: m.color });
            for (let l = 0; l < hh; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = null;
            i += w; n += w;
          } else { i++; n++; }
        }
      }
    }
  }
  return faces;
}

// ===================== MULTI-VISTA (visual hull) =====================
// Intersecta las siluetas de frontal + perfil (+ cenital) para dar
// profundidad real. Color desde la frontal.
function _maskFrom(px, alpha) {
  validatePixels(px, 'view');
  const m = new Uint8Array(px.w * px.h);
  for (let i = 0; i < px.w * px.h; i++) m[i] = px.data[i * 4 + 3] > alpha ? 1 : 0;
  return m;
}
function _sampleScalar(src, sw, sh, x, y, mode) {
  if (mode === 'bilinear') {
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= sw || yy >= sh) ? 0 : src[xx + sw * yy];
    return at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty)
      + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
  }
  const sx = Math.floor(x), sy = Math.floor(y);
  return (sx < 0 || sy < 0 || sx >= sw || sy >= sh) ? 0 : src[sx + sw * sy];
}
function _resampleScalar(src, sw, sh, dw, dh, mode) {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (mode === 'area' && (dw < sw || dh < sh)) {
        const sx0 = x * sw / dw, sx1 = (x + 1) * sw / dw;
        const sy0 = y * sh / dh, sy1 = (y + 1) * sh / dh;
        let sum = 0, weight = 0;
        for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
          const wx = Math.max(0, Math.min(sx1, sx + 1) - Math.max(sx0, sx));
          const wy = Math.max(0, Math.min(sy1, sy + 1) - Math.max(sy0, sy));
          sum += src[sx + sw * sy] * wx * wy; weight += wx * wy;
        }
        out[x + dw * y] = weight ? sum / weight : 0;
      } else {
        out[x + dw * y] = _sampleScalar(src, sw, sh, (x + 0.5) * sw / dw, (y + 0.5) * sh / dh, mode);
      }
    }
  }
  return out;
}
function _resampleMask(src, sw, sh, dw, dh, mode) {
  const values = _resampleScalar(src, sw, sh, dw, dh, mode || 'nearest');
  if (values instanceof Uint8Array) return values;
  const out = new Uint8Array(dw * dh);
  for (let i = 0; i < out.length; i++) out[i] = values[i] >= 0.5 ? 1 : 0;
  return out;
}
function _maskBounds(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[x + w * y]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  };
}
function _sampleMaskNearest(src, sw, sh, x, y) {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return 0;
  return src[sx + sw * sy] ? 1 : 0;
}
function _transformScalar(src, sw, sh, dw, dh, transform, mode, regionOverride) {
  const bounds = transform.autoFit ? (regionOverride || _maskBounds(src, sw, sh)) : null;
  if (!bounds && transform.autoFit) return {
    values: new Float32Array(dw * dh),
    bounds: null,
    sourceBounds: null,
    transform,
  };
  const region = bounds || { minX: 0, minY: 0, width: sw, height: sh };
  const identity = !transform.autoFit
    && transform.offsetX === 0
    && transform.offsetY === 0
    && transform.scale === 1
    && transform.rotation === 0
    && !transform.flipX;
  if (identity) {
    const values = _resampleScalar(src, sw, sh, dw, dh, mode);
    return {
      values,
      bounds: null,
      sourceBounds: _maskBounds(src, sw, sh),
      transform,
    };
  }
  const out = new Float32Array(dw * dh);
  const radians = transform.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scale = transform.scale || 1;
  const halfW = dw / 2;
  const halfH = dh / 2;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let tx = (x + 0.5) - halfW - transform.offsetX;
      let ty = (y + 0.5) - halfH - transform.offsetY;
      if (transform.flipX) tx = -tx;
      const rx = tx * cos + ty * sin;
      const ry = -tx * sin + ty * cos;
      const nx = (rx / scale) + halfW;
      const ny = (ry / scale) + halfH;
      const sx = region.minX + (nx / dw) * region.width;
      const sy = region.minY + (ny / dh) * region.height;
      out[x + dw * y] = _sampleScalar(src, sw, sh, sx, sy, mode);
    }
  }
  return {
    values: out,
    bounds: null,
    sourceBounds: _maskBounds(src, sw, sh),
    transform,
  };
}
function _transformMask(src, sw, sh, dw, dh, transform, mode) {
  const result = _transformScalar(src, sw, sh, dw, dh, transform, mode || 'nearest');
  const mask = new Uint8Array(dw * dh);
  for (let i = 0; i < mask.length; i++) mask[i] = result.values[i] >= 0.5 ? 1 : 0;
  result.mask = mask;
  result.bounds = _maskBounds(mask, dw, dh);
  delete result.values;
  return result;
}
function _prepareViewMask(view, alpha, dw, dh, transform, silhouette) {
  if (!view) return null;
  const baseMask = _preprocessMask(_maskFrom(view, alpha), view.w, view.h, silhouette);
  const result = _transformMask(baseMask, view.w, view.h, dw, dh, transform, silhouette.resampling);
  const sourceConfidence = new Float32Array(view.w * view.h);
  const insideSq = silhouette.feather > 0 ? _edtSq(baseMask, view.w, view.h) : null;
  const featherRadius = silhouette.feather * Math.max(1, Math.min(view.w, view.h));
  for (let i = 0; i < sourceConfidence.length; i++) {
    const a = view.data[i * 4 + 3];
    const raw = a > alpha ? (a - alpha) / Math.max(1, 255 - alpha) : 0;
    const spatial = insideSq ? Math.min(1, Math.sqrt(insideSq[i]) / Math.max(0.001, featherRadius)) : 1;
    sourceConfidence[i] = baseMask[i] ? (silhouette.feather > 0 ? raw * spatial : 1) : 0;
  }
  result.confidenceMap = _transformScalar(sourceConfidence, view.w, view.h, dw, dh, transform, silhouette.resampling, result.sourceBounds).values;
  const colors = new Uint8Array(dw * dh * 3);
  for (let channel = 0; channel < 3; channel++) {
    const source = new Float32Array(view.w * view.h);
    for (let i = 0; i < source.length; i++) source[i] = view.data[i * 4 + channel];
    const sampled = _transformScalar(source, view.w, view.h, dw, dh, transform, silhouette.resampling, result.sourceBounds).values;
    for (let i = 0; i < sampled.length; i++) colors[i * 3 + channel] = Math.round(Math.max(0, Math.min(255, sampled[i])));
  }
  result.colors = colors;
  return result;
}

function _depthMapProfile(depthMap, quant, config) {
  if (!depthMap) return null;
  validatePixels(depthMap, 'depthMap');
  const values = new Float32Array(depthMap.w * depthMap.h);
  for (let i = 0; i < values.length; i++) {
    const r = depthMap.data[i * 4], g = depthMap.data[i * 4 + 1], b = depthMap.data[i * 4 + 2];
    values[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const sampled = _resampleScalar(values, depthMap.w, depthMap.h, quant.w, quant.h, config.silhouette.resampling);
  const out = new Float32Array(quant.w * quant.h);
  for (let i = 0; i < out.length; i++) if (quant.idxAt[i] >= 0) {
    const v = config.depth.invertDepthMap ? 1 - sampled[i] : sampled[i];
    out[i] = Math.max(0, Math.min(1, 1 + config.depth.depthMapStrength * (v - 1)));
  }
  return out;
}

function createDepthState(quant, config, viewInputs) {
  const opts = legacyOptionsFromConfig(config);
  const depthView = (viewInputs || []).find(view => view.valid && view.role === 'depthmap');
  const depthMapProfile = config.depth.mode === 'depthmap' ? _depthMapProfile(depthView && depthView.pixels, quant, config) : null;
  return {
    layers: Math.max(1, opts.depth | 0),
    relief: (opts.relief == null) ? 1 : Math.max(0, Math.min(1, opts.relief)),
    profile: depthMapProfile || (opts.depthMode === 'uniform' ? null : depthProfile(quant, opts.depthMode, opts)),
    mode: config.depth.mode,
    frontRatio: config.depth.frontRatio,
    depthMapMissing: config.depth.mode === 'depthmap' && !depthMapProfile,
    options: opts,
  };
}
function transformViewPixels(view, transform) {
  if (!view) return null;
  return { pixels: view, transform: _normalizeViewTransform(transform) };
}
function normalizeViewInputs(views, config) {
  const source = views || {}, inputs = [];
  if (Array.isArray(source.views)) inputs.push(...source.views);
  if (source.side && !inputs.some(view => view && view.role === 'side')) inputs.push({ role: 'side', pixels: source.side });
  if (source.top && !inputs.some(view => view && view.role === 'top')) inputs.push({ role: 'top', pixels: source.top });
  if (source.depthMap && !inputs.some(view => view && view.role === 'depthmap')) inputs.push({ role: 'depthmap', pixels: source.depthMap });
  const seenIds = new Set();
  return inputs.map((input, index) => {
    if (!_isObject(input)) return { id: `view-${index}`, role: '', valid: false, issues: [{ code: 'MALFORMED_VIEW', message: 'View descriptor must be an object.' }] };
    const descriptor = input;
    const role = typeof descriptor.role === 'string' ? descriptor.role.toLowerCase() : '';
    let id = typeof descriptor.id === 'string' && descriptor.id.trim() ? descriptor.id.trim() : `${role || 'view'}-${index}`;
    if (seenIds.has(id)) id = `${id}-${index}`;
    seenIds.add(id);
    const issues = [];
    const frameIndex = Math.max(0, source.frame | 0);
    const selectedPixels = Array.isArray(descriptor.frames)
      ? descriptor.frames[Math.min(frameIndex, Math.max(0, descriptor.frames.length - 1))] : descriptor.pixels;
    let pixels = null;
    if (!selectedPixels) issues.push({ code: 'MISSING_VIEW_PIXELS', message: 'View has no pixels for the selected frame.' });
    else {
      try { pixels = validatePixels(selectedPixels, `views[${index}]`); }
      catch (error) { issues.push({ code: error.code || 'INVALID_VIEW_PIXELS', message: error.message }); }
    }
    const configured = (role === 'left' || role === 'right' || role === 'side') ? config.alignment.side
      : (role === 'top' ? config.alignment.top : {});
    const canonical = CANONICAL_ORIENTATIONS[role] || null;
    const orientation = descriptor.orientation == null ? canonical : descriptor.orientation;
    if (!canonical) issues.push({ code: 'UNSUPPORTED_VIEW_ROLE', message: `View role "${role || '(missing)'}" has no calibrated projector.` });
    else if (!_isObject(orientation) || orientation.projection !== canonical.projection
      || orientation.horizontal !== canonical.horizontal || orientation.vertical !== canonical.vertical) {
      issues.push({ code: 'UNSUPPORTED_ORIENTATION', message: `View ${id} must use ${canonical.projection} ${canonical.horizontal}/${canonical.vertical}.` });
    }
    const landmarks = [];
    if (descriptor.landmarks != null && !Array.isArray(descriptor.landmarks)) {
      issues.push({ code: 'INVALID_LANDMARK', message: 'Landmarks must be an array of source/target point pairs.' });
    } else for (const mark of descriptor.landmarks || []) {
      const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
      if (mark && validPoint(mark.source) && validPoint(mark.target)) landmarks.push({ source: [...mark.source], target: [...mark.target] });
      else issues.push({ code: 'INVALID_LANDMARK', message: 'Ignored a malformed landmark.' });
    }
    return {
      role,
      pixels,
      materialEvidence: descriptor.materialEvidence !== false,
      transform: _normalizeViewTransform({ ...configured, ...(descriptor.transform || {}) }),
      confidence: _clampNumber(descriptor.confidence, 0, 1, 1),
      orientation,
      id,
      landmarks,
      issues,
      valid: !!pixels && !!canonical && !issues.some(issue => issue.code === 'UNSUPPORTED_ORIENTATION'),
    };
  });
}
function _assertTransformedViewBudgets(inputs, dims, materialEnabled) {
  const [W, H, D] = dims;
  let transformedCells = 0, sourceCells = 0;
  for (const input of inputs) {
    const isLateral = input.role === 'side' || input.role === 'left' || input.role === 'right';
    const isTop = input.role === 'top';
    if (!input.valid || !input.pixels || (!isLateral && !isTop && input.role !== 'back')) continue;
    transformedCells += isLateral ? D * H : (isTop ? W * D : W * H);
    sourceCells += input.pixels.w * input.pixels.h;
  }
  // Includes resampled mask/confidence/RGB, inverse/EDT/edge distance,
  // projected diagnostic buffers and the worst-case material arrays.
  const targetBytesPerCell = materialEnabled ? 32 : 25;
  // Includes source RGBA, morphology masks, confidence, per-channel sampling
  // scratch and the optional feather EDT. This is deliberately conservative.
  const sourceBytesPerCell = 25;
  const peakBytes = transformedCells * targetBytesPerCell + sourceCells * sourceBytesPerCell;
  if (transformedCells > MAX_TRANSFORMED_VIEW_CELLS || peakBytes > MAX_TRANSFORMED_VIEW_BYTES) {
    throw _budgetError('TRANSFORMED_VIEW_BUDGET_EXCEEDED', `Transformed auxiliary views require ${transformedCells} cells and an estimated ${peakBytes} peak bytes`);
  }
  return { transformedCells, peakBytes };
}
function _assertAuxiliaryBudgets(inputs, silhouette) {
  if (inputs.length > MAX_VIEW_COUNT) throw _budgetError('VIEW_COUNT_BUDGET_EXCEEDED', `A reconstruction accepts at most ${MAX_VIEW_COUNT} auxiliary views`);
  let pixels = 0, bytes = 0, morphologyWork = 0;
  for (const input of inputs) {
    if (!input.pixels) continue;
    const count = input.pixels.w * input.pixels.h;
    pixels += count;
    bytes += input.pixels.data.byteLength;
    if (input.role === 'side' || input.role === 'top' || input.role === 'back' || input.role === 'left' || input.role === 'right') {
      const work = _morphWork(input.pixels.w, input.pixels.h, silhouette);
      if (work > MAX_MORPH_WORK) throw _budgetError('AUX_MORPH_BUDGET_EXCEEDED', `View ${input.id} exceeds the ${MAX_MORPH_WORK}-operation morphology budget`);
      morphologyWork += work;
    }
  }
  if (pixels > MAX_AUX_PIXEL_COUNT) throw _budgetError('AUX_PIXEL_BUDGET_EXCEEDED', `Auxiliary views exceed the cumulative ${MAX_AUX_PIXEL_COUNT}-pixel budget`);
  if (bytes > MAX_AUX_BYTES) throw _budgetError('AUX_BYTE_BUDGET_EXCEEDED', `Auxiliary views exceed the cumulative ${MAX_AUX_BYTES}-byte input budget`);
  if (morphologyWork > MAX_TOTAL_MORPH_WORK) throw _budgetError('AUX_MORPH_TOTAL_BUDGET_EXCEEDED', `Auxiliary views exceed the cumulative ${MAX_TOTAL_MORPH_WORK}-operation morphology budget`);
  return { pixels, bytes, morphologyWork };
}
function transformViews(views, config) {
  const inputs = normalizeViewInputs(views, config);
  const autoFit = !!(config.alignment && config.alignment.autoFit);
  return inputs.map(input => ({ ...input, transform: { ...input.transform, autoFit: autoFit || input.transform.autoFit } }));
}
function prepareSilhouettes(config, views, dims) {
  const [W, H, D] = dims;
  const alpha = config.silhouette.alphaThreshold;
  const transformed = transformViews(views, config);
  const budget = _assertTransformedViewBudgets(transformed, dims, config.material.enabled);
  const prepared = [];
  for (const view of transformed) {
    const isLateral = view.role === 'side' || view.role === 'left' || view.role === 'right';
    const isTop = view.role === 'top';
    if (!view.valid || !view.pixels || (!isLateral && !isTop && view.role !== 'back')) continue;
    const dw = isLateral ? D : (isTop ? W : W);
    const dh = isLateral ? H : (isTop ? D : H);
    const transform = _landmarkTransform(view, dw, dh);
    const meta = _prepareViewMask(view.pixels, alpha, dw, dh, transform, config.silhouette);
    const inverse = new Uint8Array(meta.mask.length);
    for (let i = 0; i < inverse.length; i++) inverse[i] = meta.mask[i] ? 0 : 1;
    const distanceSq = _edtSq(inverse, dw, dh);
    const edgeDistance = new Float32Array(distanceSq.length);
    for (let i = 0; i < edgeDistance.length; i++) edgeDistance[i] = Math.sqrt(distanceSq[i]);
    prepared.push({ ...view, transform, ...meta, edgeDistance, w: dw, h: dh });
  }
  const side = prepared.find(view => view.role === 'side') || null;
  const left = prepared.find(view => view.role === 'left') || null;
  const right = prepared.find(view => view.role === 'right') || null;
  const top = prepared.find(view => view.role === 'top') || null;
  const back = prepared.find(view => view.role === 'back') || null;
  const byId = Object.create(null);
  for (const view of prepared) byId[view.id] = { id: view.id, role: view.role, w: view.w, h: view.h, mask: view.mask, bounds: view.bounds, sourceBounds: view.sourceBounds, transform: view.transform };
  return {
    prepared,
    sideMask: side && side.mask,
    sideRow: side ? _projectAxis(side.mask, side.w, side.h, 'row') : null,
    topMask: top && top.mask,
    topCol: top ? _projectAxis(top.mask, top.w, top.h, 'col') : null,
    transformed,
    budget,
    previews: {
      byId,
      side: side ? byId[side.id] : null,
      left: left ? byId[left.id] : null,
      right: right ? byId[right.id] : null,
      top: top ? byId[top.id] : null,
      back: back ? byId[back.id] : null,
    },
  };
}
function _landmarkTransform(view, dw, dh) {
  const marks = view.landmarks || [];
  if (!marks.length) return view.transform;
  const sourcePoint = mark => [(mark.source[0] / view.pixels.w) * dw, (mark.source[1] / view.pixels.h) * dh];
  const targetPoint = mark => mark.target;
  const transform = { ...view.transform, autoFit: false };
  if (marks.length >= 2) {
    const a = sourcePoint(marks[0]), b = sourcePoint(marks[1]), ta = targetPoint(marks[0]), tb = targetPoint(marks[1]);
    const sdx = b[0] - a[0], sdy = b[1] - a[1];
    const tdx = tb[0] - ta[0], tdy = tb[1] - ta[1];
    const reflectedTargetX = view.transform.flipX ? -tdx : tdx;
    const sd = Math.hypot(sdx, sdy) || 1, td = Math.hypot(tdx, tdy);
    transform.scale = Math.max(0.1, Math.min(8, td / sd));
    transform.rotation = (Math.atan2(tdy, reflectedTargetX) - Math.atan2(sdy, sdx)) * 180 / Math.PI;
  }
  const p = sourcePoint(marks[0]), t = targetPoint(marks[0]);
  transform.offsetX = 0; transform.offsetY = 0;
  const mapped = _forwardTransformPoint(p, dw, dh, transform);
  transform.offsetX = t[0] - mapped[0]; transform.offsetY = t[1] - mapped[1];
  return transform;
}
function _forwardTransformPoint(point, dw, dh, transform) {
  const cx = dw / 2, cy = dh / 2, radians = transform.rotation * Math.PI / 180;
  const sx = (point[0] - cx) * transform.scale, sy = (point[1] - cy) * transform.scale;
  let rx = sx * Math.cos(radians) - sy * Math.sin(radians);
  const ry = sx * Math.sin(radians) + sy * Math.cos(radians);
  if (transform.flipX) rx = -rx;
  return [cx + rx + transform.offsetX, cy + ry + transform.offsetY];
}
function _projectAxis(mask, w, h, direction) {
  const out = new Uint8Array(direction === 'row' ? h : w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[x + w * y]) out[direction === 'row' ? y : x] = 1;
  return out;
}
function _viewSample(view, x, py, z) {
  if (view.role === 'side' || view.role === 'right') return z + view.w * py;
  if (view.role === 'left') return (view.w - 1 - z) + view.w * py;
  if (view.role === 'top') return x + view.w * z;
  if (view.role === 'back') return (view.w - 1 - x) + view.w * py;
  return x + view.w * py;
}
function _viewWeight(view, config) {
  const roleWeight = (view.role === 'side' || view.role === 'left' || view.role === 'right') ? config.reconstruction.sideWeight
    : (view.role === 'top' ? config.reconstruction.topWeight : config.reconstruction.frontWeight);
  return roleWeight * view.confidence;
}
function _viewConfidenceAt(view, sample, edgeTolerance) {
  if (view.mask[sample]) return view.confidenceMap[sample];
  if (edgeTolerance <= 0) return 0;
  const radius = Math.max(0.001, edgeTolerance * Math.max(1, Math.min(view.w, view.h)));
  const distance = view.edgeDistance[sample];
  return distance <= radius ? Math.max(0, 1 - distance / (radius + 0.001)) : 0;
}
function _materialDistance(ar, ag, ab, br, bg, bb) {
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  // Weighted RGB keeps the control in familiar 0..255 units while giving
  // green-channel differences the perceptual importance they deserve.
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
}
function _nearestMaterialCluster(centers, count, r, g, b, tolerance) {
  let nearest = -1, distance = Infinity;
  for (let cluster = 0; cluster < count; cluster++) {
    const base = cluster * 3;
    const d = _materialDistance(centers[base], centers[base + 1], centers[base + 2], r, g, b);
    if (d < distance) { distance = d; nearest = cluster; }
  }
  return distance <= tolerance ? nearest : -(nearest + 2);
}
function _clusterFrontMaterials(quant, tolerance) {
  const paletteCounts = new Uint32Array(quant.palette.length);
  for (let i = 0; i < quant.idxAt.length; i++) if (quant.idxAt[i] >= 0) paletteCounts[quant.idxAt[i]]++;
  const centers = new Uint8Array(MAX_MATERIAL_CLUSTERS * 3);
  const counts = new Uint32Array(MAX_MATERIAL_CLUSTERS);
  const paletteCluster = new Uint8Array(quant.palette.length).fill(NO_MATERIAL);
  let clusterCount = 0, clipped = false;
  for (let paletteIndex = 0; paletteIndex < quant.palette.length; paletteIndex++) {
    if (!paletteCounts[paletteIndex]) continue;
    const rgb = quant.palette[paletteIndex];
    const selection = _nearestMaterialCluster(centers, clusterCount, rgb[0], rgb[1], rgb[2], tolerance);
    let cluster = selection >= 0 ? selection : -1;
    if (cluster < 0) {
      if (clusterCount < MAX_MATERIAL_CLUSTERS) {
        cluster = clusterCount++;
        centers.set(rgb, cluster * 3);
      } else {
        cluster = -selection - 2;
        clipped = true;
      }
    }
    paletteCluster[paletteIndex] = cluster;
    const previous = counts[cluster], added = paletteCounts[paletteIndex], total = previous + added;
    const base = cluster * 3;
    if (previous) for (let channel = 0; channel < 3; channel++) {
      centers[base + channel] = Math.round((centers[base + channel] * previous + rgb[channel] * added) / total);
    }
    counts[cluster] = total;
  }
  const clusterAt = new Uint8Array(quant.idxAt.length).fill(NO_MATERIAL);
  for (let i = 0; i < clusterAt.length; i++) if (quant.idxAt[i] >= 0) clusterAt[i] = paletteCluster[quant.idxAt[i]];
  return { centers, counts, paletteCluster, clusterAt, clusterCount, clipped };
}
function _clusterViewMaterials(view, tolerance, maxWork) {
  let opaque = 0;
  for (let i = 0; i < view.mask.length; i++) if (view.mask[i]) opaque++;
  if (!opaque) return { usable: false, opaque, ids: null, centers: null, counts: null, clusterCount: 0, clipped: false, budgetExceeded: false, work: 0 };
  // Worst-case clustering plus shared-axis compatibility scan.
  const work = opaque * MAX_MATERIAL_CLUSTERS * 2 + MAX_MATERIAL_CLUSTERS * MAX_MATERIAL_CLUSTERS;
  if (work > maxWork) {
    return { usable: false, opaque, ids: null, centers: null, counts: null, clusterCount: 0, clipped: false, budgetExceeded: true, work: 0 };
  }
  const ids = new Uint8Array(view.mask.length).fill(NO_MATERIAL);
  const centers = new Uint8Array(MAX_MATERIAL_CLUSTERS * 3);
  const counts = new Uint32Array(MAX_MATERIAL_CLUSTERS);
  let clusterCount = 0, clipped = false;
  for (let i = 0; i < view.mask.length; i++) {
    if (!view.mask[i]) continue;
    const r = view.colors[i * 3], g = view.colors[i * 3 + 1], b = view.colors[i * 3 + 2];
    const selection = _nearestMaterialCluster(centers, clusterCount, r, g, b, tolerance);
    let cluster = selection >= 0 ? selection : -1;
    if (cluster < 0) {
      if (clusterCount < MAX_MATERIAL_CLUSTERS) {
        cluster = clusterCount++;
        const base = cluster * 3;
        centers[base] = r; centers[base + 1] = g; centers[base + 2] = b;
      } else {
        cluster = -selection - 2;
        clipped = true;
      }
    }
    ids[i] = cluster;
    const previous = counts[cluster], total = previous + 1, base = cluster * 3;
    if (previous) for (let channel = 0; channel < 3; channel++) {
      const value = channel === 0 ? r : (channel === 1 ? g : b);
      centers[base + channel] = Math.round((centers[base + channel] * previous + value) / total);
    }
    counts[cluster] = total;
  }
  return { usable: true, opaque, ids, centers, counts, clusterCount, clipped, budgetExceeded: false, work };
}
function _materialEvidenceBytes(state) {
  if (!state) return 0;
  const arrays = [];
  const add = value => { if (ArrayBuffer.isView(value)) arrays.push(value); };
  if (state.front) {
    add(state.front.centers); add(state.front.counts); add(state.front.paletteCluster); add(state.front.clusterAt);
  }
  add(state.rowBits); add(state.colBits); add(state.supportedFront); add(state.surfaceOnly);
  add(state.structuralColorAt); add(state.acceptedVoxels); add(state.acceptedMinZ); add(state.acceptedMaxZ);
  for (const view of state.views || []) {
    add(view.ids); add(view.centers); add(view.counts); add(view.supportedFront); add(view.compatibility);
    add(view.overlay); add(view.candidateMatchesBySample); add(view.candidateMismatchesBySample); add(view.diagnosticOverlay);
  }
  const seen = new Set();
  let total = 0;
  for (const array of arrays) {
    if (seen.has(array.buffer)) continue;
    seen.add(array.buffer); total += array.byteLength;
  }
  return total;
}
function _refreshMaterialEvidenceBytes(state) {
  state.memoryBytes = _materialEvidenceBytes(state);
  return state.memoryBytes;
}
function _materialEvidenceWorstCaseBytes(quant, silhouettes) {
  const W = quant.w, H = quant.h, words = Math.ceil(MAX_MATERIAL_CLUSTERS / 32);
  const hasSide = silhouettes.prepared.some(view => view.role === 'side' || view.role === 'left' || view.role === 'right');
  const hasTop = silhouettes.prepared.some(view => view.role === 'top');
  let bytes = quant.idxAt.length * 3 + quant.palette.length + 192 + 256 + MAX_MATERIAL_CLUSTERS * 10;
  bytes += ((hasSide ? H : 0) + (hasTop ? W : 0)) * words * 4;
  for (const view of silhouettes.prepared) {
    bytes += MAX_MATERIAL_CLUSTERS;
    if (view.materialEvidence) bytes += view.mask.length * 7 + 192 + 256 + MAX_MATERIAL_CLUSTERS * MAX_MATERIAL_CLUSTERS;
  }
  return bytes;
}
function _axisHasCluster(bits, words, axis, cluster) {
  return !!(bits[axis * words + (cluster >> 5)] & (1 << (cluster & 31)));
}
function _buildStructuralColors(quant, front, surfaceOnly) {
  const nearest = new Int16Array(quant.idxAt.length).fill(-1);
  const queue = new Int32Array(quant.idxAt.length);
  let head = 0, tail = 0;
  for (let i = 0; i < nearest.length; i++) {
    const paletteIndex = quant.idxAt[i], cluster = front.clusterAt[i];
    if (paletteIndex >= 0 && cluster !== NO_MATERIAL && !surfaceOnly[cluster]) {
      nearest[i] = paletteIndex;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++], x = i % quant.w, y = (i / quant.w) | 0;
    let n;
    if (x > 0 && nearest[n = i - 1] < 0) { nearest[n] = nearest[i]; queue[tail++] = n; }
    if (x + 1 < quant.w && nearest[n = i + 1] < 0) { nearest[n] = nearest[i]; queue[tail++] = n; }
    if (y > 0 && nearest[n = i - quant.w] < 0) { nearest[n] = nearest[i]; queue[tail++] = n; }
    if (y + 1 < quant.h && nearest[n = i + quant.w] < 0) { nearest[n] = nearest[i]; queue[tail++] = n; }
  }
  return nearest;
}
function prepareMaterialEvidence(quant, silhouettes, config) {
  const enabled = !!config.material.enabled;
  const requested = enabled;
  const effective = enabled && config.material.strength > 0;
  const state = {
    enabled,
    requested,
    effective,
    active: false,
    reason: !enabled ? 'disabled' : (config.material.strength <= 0 ? 'zero-strength' : (silhouettes.prepared.length ? 'mask-only' : 'no-auxiliary-views')),
    tolerance: config.material.tolerance,
    strength: config.material.strength,
    views: [],
    byId: Object.create(null),
    unmatched: [],
    memoryBytes: 0,
    clusterCount: 0,
    clipped: false,
  };
  if (!effective || !silhouettes.prepared.length) return state;
  const W = quant.w, H = quant.h;
  const hasSide = silhouettes.prepared.some(view => view.role === 'side' || view.role === 'left' || view.role === 'right');
  const hasTop = silhouettes.prepared.some(view => view.role === 'top');
  const words = Math.ceil(MAX_MATERIAL_CLUSTERS / 32);
  const estimatedEvidenceBytes = _materialEvidenceWorstCaseBytes(quant, silhouettes);
  if (estimatedEvidenceBytes > MAX_MATERIAL_EVIDENCE_BYTES) {
    state.reason = 'material-evidence-budget';
    return state;
  }
  const front = _clusterFrontMaterials(quant, config.material.tolerance);
  state.front = front;
  state.clusterCount = front.clusterCount;
  state.clipped = front.clipped;
  const rowBits = hasSide ? new Uint32Array(H * words) : null;
  const colBits = hasTop ? new Uint32Array(W * words) : null;
  for (let py = 0; py < H; py++) for (let x = 0; x < W; x++) {
    const cluster = front.clusterAt[x + W * py];
    if (cluster === NO_MATERIAL) continue;
    if (rowBits) rowBits[py * words + (cluster >> 5)] |= 1 << (cluster & 31);
    if (colBits) colBits[x * words + (cluster >> 5)] |= 1 << (cluster & 31);
  }
  const supported = new Uint8Array(front.clusterCount);
  let usableViews = 0, compareWork = 0;
  for (const view of silhouettes.prepared) {
    const clustered = view.materialEvidence
      ? _clusterViewMaterials(view, config.material.tolerance, MAX_MATERIAL_COMPARE_WORK - compareWork)
      : { usable: false, opaque: 0, ids: null, centers: null, counts: null, clusterCount: 0, clipped: false, budgetExceeded: false, work: 0 };
    compareWork += clustered.work;
    const effectiveWeight = _viewWeight(view, config);
    const entry = {
      id: view.id,
      role: view.role,
      eligible: !!view.materialEvidence,
      usable: clustered.usable && effectiveWeight > 0,
      rgbUsable: clustered.usable,
      effectiveWeight,
      opaque: clustered.opaque,
      ids: clustered.ids,
      centers: clustered.centers,
      counts: clustered.counts,
      clusterCount: clustered.clusterCount,
      clipped: clustered.clipped,
      budgetExceeded: clustered.budgetExceeded,
      supportedFront: new Uint8Array(front.clusterCount),
      compatibility: null,
      overlay: view.materialEvidence ? new Uint8Array(view.mask.length) : null,
      compatiblePixels: 0,
      mismatchPixels: 0,
      candidateMatches: 0,
      candidateMismatches: 0,
      candidateMatchesBySample: view.materialEvidence ? new Uint16Array(view.mask.length) : null,
      candidateMismatchesBySample: view.materialEvidence ? new Uint16Array(view.mask.length) : null,
    };
    state.clipped = state.clipped || clustered.clipped;
    state.compareBudgetExceeded = state.compareBudgetExceeded || clustered.budgetExceeded;
    if (entry.usable) {
      usableViews++;
      entry.compatibility = new Uint8Array(front.clusterCount * clustered.clusterCount);
      for (let fc = 0; fc < front.clusterCount; fc++) for (let vc = 0; vc < clustered.clusterCount; vc++) {
        const fb = fc * 3, vb = vc * 3;
        if (_materialDistance(
          front.centers[fb], front.centers[fb + 1], front.centers[fb + 2],
          clustered.centers[vb], clustered.centers[vb + 1], clustered.centers[vb + 2]
        ) <= config.material.tolerance) entry.compatibility[fc * clustered.clusterCount + vc] = 1;
      }
        const isLateral = view.role === 'side' || view.role === 'left' || view.role === 'right';
        const axisBits = isLateral ? rowBits : colBits;
        for (let sample = 0; sample < view.mask.length; sample++) {
          if (!view.mask[sample]) continue;
          const vc = clustered.ids[sample];
          let match = false;
          if (view.role === 'back') {
            // Map back view sample coordinates to front coordinates
            const bx = sample % view.w, by = (sample / view.w) | 0;
            const fx = view.w - 1 - bx;  // Mirror x for back view
            const fc = front.clusterAt[fx + view.w * by];
            if (fc !== NO_MATERIAL && fc < front.clusterCount && entry.compatibility[fc * clustered.clusterCount + vc]) {
              entry.supportedFront[fc] = 1;
              supported[fc] = 1;
              match = true;
            }
          } else {
            const x = sample % view.w, y = (sample / view.w) | 0;
            const axis = isLateral ? y : x;
            for (let fc = 0; fc < front.clusterCount; fc++) {
              if (!_axisHasCluster(axisBits, words, axis, fc)) continue;
              if (entry.compatibility[fc * clustered.clusterCount + vc]) {
                entry.supportedFront[fc] = 1;
                supported[fc] = 1;
                match = true;
              }
            }
          }
        entry.overlay[sample] = match ? 1 : 2;
        if (match) entry.compatiblePixels++; else entry.mismatchPixels++;
      }
    }
    state.views.push(entry);
    state.byId[entry.id] = entry;
  }
  state.usableViews = usableViews;
  state.compareWork = compareWork;
  state.rowBits = rowBits;
  state.colBits = colBits;
  state.supportedFront = supported;
  _refreshMaterialEvidenceBytes(state);
  if (!usableViews) {
    if (state.compareBudgetExceeded) state.reason = 'material-compare-budget';
    else if (state.views.some(view => view.eligible && view.rgbUsable)) state.reason = 'no-effective-material-weight';
    else state.reason = state.views.some(view => view.eligible) ? 'missing-rgb-evidence' : 'mask-only';
    return state;
  }
  let supportedClusters = 0, occupiedFront = 0;
  for (let cluster = 0; cluster < front.clusterCount; cluster++) {
    occupiedFront += front.counts[cluster];
    if (supported[cluster]) supportedClusters++;
  }
  if (!supportedClusters) {
    state.reason = 'no-cross-view-material-match';
    return state;
  }
  const detailLimit = Math.max(4, Math.ceil(occupiedFront * 0.12));
  const surfaceOnly = new Uint8Array(front.clusterCount);
  for (let cluster = 0; cluster < front.clusterCount; cluster++) if (!supported[cluster]) {
    const detail = front.counts[cluster] <= detailLimit;
    surfaceOnly[cluster] = detail ? 1 : 0;
    state.unmatched.push({
      cluster,
      rgb: [front.centers[cluster * 3], front.centers[cluster * 3 + 1], front.centers[cluster * 3 + 2]],
      pixels: front.counts[cluster],
      surfaceOnly: detail,
    });
  }
  state.surfaceOnly = surfaceOnly;
  state.structuralColorAt = _buildStructuralColors(quant, front, surfaceOnly);
  state.active = true;
  state.reason = 'active';
  _refreshMaterialEvidenceBytes(state);
  return state;
}
function _materialViewEntry(material, view) {
  return material && material.byId ? material.byId[view.id] : null;
}
function _materialMatchAt(material, view, frontCluster, sample) {
  const entry = _materialViewEntry(material, view);
  if (!material.active || !entry || !entry.usable || !material.supportedFront[frontCluster]) return null;
  material.occupancyCompareWork = (material.occupancyCompareWork || 0) + 1;
  if (!entry.supportedFront[frontCluster]) return 0;
  const viewCluster = entry.ids[sample];
  if (viewCluster === NO_MATERIAL) return 0;
  return entry.compatibility[frontCluster * entry.clusterCount + viewCluster] ? 1 : 0;
}
function _recordMaterialCandidate(entry, sample, match) {
  if (!entry || !entry.candidateMatchesBySample || !entry.candidateMismatchesBySample) return;
  if (match) {
    entry.candidateMatches++;
    if (entry.candidateMatchesBySample[sample] < 65535) entry.candidateMatchesBySample[sample]++;
  } else {
    entry.candidateMismatches++;
    if (entry.candidateMismatchesBySample[sample] < 65535) entry.candidateMismatchesBySample[sample]++;
  }
}
function _nearestFrontColors(quant) {
  const { w, h, idxAt } = quant, nearest = new Int16Array(idxAt), queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let i = 0; i < nearest.length; i++) if (nearest[i] >= 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % w, y = (i / w) | 0;
    const next = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1];
    for (const n of next) if (n >= 0 && nearest[n] < 0) { nearest[n] = nearest[i]; queue[tail++] = n; }
  }
  return nearest;
}
function _preflightMaterialOccupancy(quant, depthState, silhouettes, material) {
  if (!material || !material.active) return material;
  const D = Math.max(1, depthState.layers | 0);
  const relief = (depthState.relief == null) ? 1 : Math.max(0, Math.min(1, depthState.relief));
  const usableViews = material.views.filter(view => view.usable).length;
  let work = 0;
  for (let i = 0; i < quant.idxAt.length; i++) {
    const frontColor = quant.idxAt[i];
    if (frontColor < 0) continue;
    const frontCluster = material.front.clusterAt[i];
    const structuralColor = material.surfaceOnly[frontCluster] ? material.structuralColorAt[i] : frontColor;
    const structuralCluster = structuralColor >= 0 ? material.front.paletteCluster[structuralColor] : NO_MATERIAL;
    if (structuralCluster === NO_MATERIAL || !material.supportedFront[structuralCluster]) continue;
    work += depthSpanAt(i, D, depthState.profile || null, relief) * usableViews;
    if (material.compareWork + work > MAX_MATERIAL_COMPARE_WORK) break;
  }
  material.occupancyCompareWorkEstimate = work;
  material.occupancyCompareWork = 0;
  if (material.compareWork + work > MAX_MATERIAL_COMPARE_WORK) {
    material.active = false;
    material.reason = 'material-occupancy-budget';
  }
  return material;
}
function buildHull(quant, depthState, silhouettes, config, material) {
  const { idxAt, w: W, h: H } = quant;
  const D = Math.max(1, depthState.layers | 0);
  const relief = (depthState.relief == null) ? 1 : Math.max(0, Math.min(1, depthState.relief));
  const prof = depthState.profile || null;
  _assertVoxelBudget(W, H, D);
  const grid = new Int16Array(W * H * D).fill(-1);
  const totalEffectiveWeight = config.reconstruction.frontWeight
    + silhouettes.prepared.reduce((sum, view) => sum + _viewWeight(view, config), 0);
  if (config.reconstruction.mode === 'weighted' && totalEffectiveWeight <= 0) {
    return { grid, dims: [W, H, D], voxels: 0, zeroTotalWeight: true };
  }
  const nearestColors = config.reconstruction.hardFrontConstraint ? null : _nearestFrontColors(quant);
  if (material && material.active) {
    material.acceptedVoxels = new Uint32Array(material.clusterCount);
    material.acceptedMinZ = new Int16Array(material.clusterCount).fill(32767);
    material.acceptedMaxZ = new Int16Array(material.clusterCount).fill(-1);
  }
  let voxels = 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = px + W * py;
      const frontColor = idxAt[i];
      const frontCluster = material && material.active && frontColor >= 0 ? material.front.clusterAt[i] : NO_MATERIAL;
      const structuralColor = frontCluster !== NO_MATERIAL && material.surfaceOnly[frontCluster]
        ? material.structuralColorAt[i] : frontColor;
      const evidenceCluster = material && material.active && structuralColor >= 0
        ? material.front.paletteCluster[structuralColor] : frontCluster;
      const ci = frontColor >= 0 ? structuralColor : (nearestColors && nearestColors[i]);
      if (ci == null || ci < 0 || (frontColor < 0 && (config.reconstruction.mode === 'strict' || config.reconstruction.hardFrontConstraint))) continue;
      const dz = frontColor >= 0 ? depthSpanAt(i, D, prof, relief) : D;
      const z0 = _depthStart(D, dz, depthState.mode, depthState.frontRatio);
      const z1 = z0 + dz;
      const my = H - 1 - py;
      for (let z = z0; z < z1; z++) {
        let accepted = true;
        if (config.reconstruction.mode === 'strict') {
          for (const view of silhouettes.prepared) if (_viewConfidenceAt(view, _viewSample(view, px, py, z), config.reconstruction.edgeTolerance) <= 0) { accepted = false; break; }
          if (accepted && evidenceCluster !== NO_MATERIAL && material && material.active) {
            let evidenceWeight = 0, compatibleWeight = 0;
            for (const view of silhouettes.prepared) {
              const sample = _viewSample(view, px, py, z);
              const match = _materialMatchAt(material, view, evidenceCluster, sample);
              if (match == null) continue;
              const weight = _viewWeight(view, config)
                * _viewConfidenceAt(view, sample, config.reconstruction.edgeTolerance);
              evidenceWeight += weight;
              compatibleWeight += weight * match;
              const entry = _materialViewEntry(material, view);
              _recordMaterialCandidate(entry, sample, match);
            }
            if (evidenceWeight > 0 && compatibleWeight / evidenceWeight < config.material.strength) accepted = false;
          }
        } else {
          let score = frontColor >= 0 ? config.reconstruction.frontWeight : 0, total = config.reconstruction.frontWeight;
          for (const view of silhouettes.prepared) {
            const weight = _viewWeight(view, config), sample = _viewSample(view, px, py, z);
            let confidence = _viewConfidenceAt(view, sample, config.reconstruction.edgeTolerance);
            const match = evidenceCluster === NO_MATERIAL ? null : _materialMatchAt(material, view, evidenceCluster, sample);
            if (match != null) {
              confidence *= (1 - config.material.strength) + config.material.strength * match;
              const entry = _materialViewEntry(material, view);
              _recordMaterialCandidate(entry, sample, match);
            }
            total += weight; score += weight * confidence;
          }
          const threshold = config.reconstruction.threshold <= 1
            ? config.reconstruction.threshold * total : config.reconstruction.threshold;
          accepted = score >= threshold;
        }
        if (!accepted) continue;
        grid[px + W * (my + H * z)] = ci; voxels++;
        if (evidenceCluster !== NO_MATERIAL && material && material.active) {
          material.acceptedVoxels[evidenceCluster]++;
          if (z < material.acceptedMinZ[evidenceCluster]) material.acceptedMinZ[evidenceCluster] = z;
          if (z > material.acceptedMaxZ[evidenceCluster]) material.acceptedMaxZ[evidenceCluster] = z;
        }
      }
    }
  }
  return { grid, dims: [W, H, D], voxels, material };
}
function calculateOccupancy(quant, config, silhouettes, depthState, material) {
  const useHull = silhouettes.prepared.length > 0 || config.reconstruction.mode === 'weighted';
  const occupancy = useHull ? buildHull(quant, depthState, silhouettes, config, material) : buildGrid(quant, depthState);
  occupancy.material = material;
  return occupancy;
}

function _isExposed(grid, dims, x, y, z, dx, dy, dz) {
  const nx = x + dx, ny = y + dy, nz = z + dz;
  return nx < 0 || ny < 0 || nz < 0 || nx >= dims[0] || ny >= dims[1] || nz >= dims[2]
    || grid[nx + dims[0] * (ny + dims[1] * nz)] < 0;
}
function fuseVoxelColors(occupancy, quant, silhouettes, config) {
  const sourceGrid = occupancy.grid, dims = occupancy.dims;
  const material = occupancy.material;
  const sideViews = silhouettes.prepared.filter(view => view.role === 'side' || view.role === 'left' || view.role === 'right');
  const topViews = silhouettes.prepared.filter(view => view.role === 'top');
  const backViews = silhouettes.prepared.filter(view => view.role === 'back');
  const usableAuxiliary = sideViews.concat(topViews).concat(backViews).some(view => view.confidence > 0 && !!view.bounds);
  const effectiveSide = config.color.mode === 'auxiliary' && sideViews.concat(topViews).some(view => view.confidence > 0 && !!view.bounds) ? 'auxiliary' : config.color.side;
  const effectiveBack = config.color.back === 'auxiliary' && backViews.some(view => view.confidence > 0 && !!view.bounds) ? 'auxiliary' : config.color.back;
  const [W, H, D] = dims;
  const frontmostZ = new Int16Array(W * H).fill(-1);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (sourceGrid[x + W * (y + H * z)] >= 0) frontmostZ[x + W * y] = z;
  }
  if (material) {
    material.decorativeFrontFaceArea = 0;
    if (material.active) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const z = frontmostZ[x + W * y];
      if (z < 0) continue;
      const py = H - 1 - y, frontIndex = quant.idxAt[x + W * py];
      if (frontIndex < 0) continue;
      const cluster = material.front.clusterAt[x + W * py];
      if (cluster !== NO_MATERIAL && material.surfaceOnly[cluster]) material.decorativeFrontFaceArea++;
    }
  }
  const palette = quant.palette.map(color => [...color]);
  const colorKeys = new Map(palette.map((color, index) => [color.join(','), index]));
  const maxColors = Math.max(1, config.palette.colors | 0);
  const internColor = rgb => {
    const color = rgb.map(value => Math.max(0, Math.min(255, Math.round(value))));
    const key = color.join(',');
    if (colorKeys.has(key)) return colorKeys.get(key);
    if (palette.length < maxColors) {
      const index = palette.length; palette.push(color); colorKeys.set(key, index); return index;
    }
    let nearest = 0, nearestDistance = Infinity;
    for (let index = 0; index < palette.length; index++) {
      const candidate = palette[index], dr = color[0] - candidate[0], dg = color[1] - candidate[1], db = color[2] - candidate[2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
    }
    return nearest;
  };
  const darken = rgb => rgb.map(value => Math.round(value * config.color.darken));
  const auxiliaryColor = (views, sampleFn) => {
    let total = 0, r = 0, g = 0, b = 0;
    for (const view of views) {
      const sample = sampleFn(view);
      const weight = _viewWeight(view, config) * view.confidenceMap[sample];
      if (weight <= 0) continue;
      total += weight;
      r += view.colors[sample * 3] * weight;
      g += view.colors[sample * 3 + 1] * weight;
      b += view.colors[sample * 3 + 2] * weight;
    }
    return total ? [r / total, g / total, b / total] : null;
  };
  const faceRgb = (x, y, z, dir, baseIndex) => {
    const base = quant.palette[baseIndex] || [200, 200, 200];
    if (dir === 4) {
      const py = H - 1 - y, frontIndex = quant.idxAt[x + W * py];
      if (material && material.active && frontIndex >= 0) {
        const cluster = material.front.clusterAt[x + W * py];
        if (z === frontmostZ[x + W * y] && cluster !== NO_MATERIAL && material.surfaceOnly[cluster]) return quant.palette[frontIndex] || base;
      }
      return base;
    }
    if (dir === 5) {
      if (effectiveBack === 'auxiliary') {
        const py = H - 1 - y;
        const auxiliary = auxiliaryColor(backViews, view => _viewSample(view, x, py, z));
        if (auxiliary) return auxiliary;
      }
      return effectiveBack === 'darken' ? darken(base) : base;
    }
    const py = H - 1 - y;
    if (effectiveSide === 'auxiliary') {
      const auxiliary = dir <= 1
        ? auxiliaryColor(sideViews, view => _viewSample(view, x, py, z))
        : auxiliaryColor(topViews, view => _viewSample(view, x, py, z));
      if (auxiliary) return auxiliary;
    }
    return effectiveSide === 'darken' ? darken(base) : base;
  };
  const faceColorAt = (x, y, z, dir) => {
    const baseIndex = sourceGrid[x + W * (y + H * z)];
    return internColor(faceRgb(x, y, z, dir, baseIndex));
  };

  // Populate the bounded surface palette before deriving the deliberately lossy
  // per-voxel VOX color. Preview and OBJ retain these face-specific indices.
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gi = x + W * (y + H * z), ci = sourceGrid[gi];
    if (ci < 0) continue;
    for (let dir = 0; dir < 6; dir++) {
      const delta = directions[dir];
      if (_isExposed(sourceGrid, dims, x, y, z, delta[0], delta[1], delta[2])) faceColorAt(x, y, z, dir, ci);
    }
  }

  const grid = new Int16Array(sourceGrid);
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gi = x + W * (y + H * z), ci = sourceGrid[gi];
    if (ci < 0) continue;
    const exposedColors = [];
    for (let dir = 0; dir < 6; dir++) {
      const delta = directions[dir];
      if (_isExposed(sourceGrid, dims, x, y, z, delta[0], delta[1], delta[2])) exposedColors.push(faceRgb(x, y, z, dir, ci));
    }
    const colors = exposedColors.length ? exposedColors : [quant.palette[ci] || [200, 200, 200]];
    const rgb = [0, 1, 2].map(channel => colors.reduce((sum, color) => sum + color[channel], 0) / colors.length);
    grid[gi] = internColor(rgb);
  }
  return { grid, palette, faceColorAt, voxelColorPolicy: 'mean-of-exposed-face-colors' };
}

function _iou(a, b) {
  let intersection = 0, union = 0, mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) intersection++;
    if (!!a[i] !== !!b[i]) mismatch++;
  }
  return { iou: union ? intersection / union : 1, residual: union ? mismatch / union : 0 };
}
function _profileResolution(sourceWidth, gridDepth) {
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth <= 0) return null;
  return {
    sourceWidth,
    gridDepth,
    compressionRatio: gridDepth / sourceWidth,
    downsampled: gridDepth < sourceWidth,
    label: `Profile ${sourceWidth} → ${gridDepth} layers`,
  };
}
function buildDiagnostics(quant, grid, dims, silhouettes, depthState, allViews, occupancy) {
  const warnings = [], views = [];
  const material = occupancy && occupancy.material;
  const frontMask = new Uint8Array(quant.w * quant.h);
  for (let i = 0; i < frontMask.length; i++) frontMask[i] = quant.idxAt[i] >= 0 ? 1 : 0;
  if (!_maskBounds(frontMask, quant.w, quant.h)) warnings.push({ code: 'EMPTY_FRONT', stage: 'input', severity: 'error', message: 'The front silhouette is empty.' });
  if (depthState.depthMapMissing) warnings.push({ code: 'DEPTH_MAP_MISSING', stage: 'input', severity: 'warning', view: 'depthmap', message: 'Depth-map mode needs a supplied depth map; the selected profile was used as fallback.' });
  for (const input of allViews) for (const issue of input.issues || []) {
    warnings.push({ code: issue.code, stage: 'input', severity: issue.code === 'MALFORMED_VIEW' ? 'error' : 'warning', view: input.id, message: issue.message });
  }
  if (occupancy && occupancy.zeroTotalWeight) warnings.push({ code: 'ZERO_TOTAL_WEIGHT', stage: 'reconstruction', severity: 'error', message: 'Weighted reconstruction has zero total effective view weight.' });
  if (material && material.effective && material.reason === 'material-evidence-budget') {
    warnings.push({ code: 'MATERIAL_EVIDENCE_BUDGET', stage: 'material', severity: 'warning', message: 'Material evidence exceeded its bounded memory budget; alpha-only reconstruction was preserved.' });
  } else if (material && material.effective && material.reason === 'material-compare-budget') {
    warnings.push({ code: 'MATERIAL_COMPARE_BUDGET', stage: 'material', severity: 'warning', message: 'Material clustering exceeded its bounded comparison budget; alpha-only reconstruction was preserved.' });
  } else if (material && material.effective && material.reason === 'material-occupancy-budget') {
    warnings.push({ code: 'MATERIAL_OCCUPANCY_BUDGET', stage: 'material', severity: 'warning', message: 'Material occupancy lookup exceeded its bounded comparison budget; alpha-only reconstruction was preserved.' });
  } else if (material && material.effective && (material.reason === 'mask-only' || material.reason === 'missing-rgb-evidence')) {
    const message = material.reason === 'mask-only'
      ? 'Auxiliary views are explicitly mask-only; alpha-only reconstruction was preserved.'
      : 'Auxiliary views contain no opaque material samples; alpha-only reconstruction was preserved.';
    warnings.push({ code: 'MATERIAL_RGB_MISSING', stage: 'material', severity: 'warning', message });
  } else if (material && material.requested && material.reason === 'zero-strength') {
    warnings.push({ code: 'MATERIAL_STRENGTH_ZERO', stage: 'material', severity: 'info', message: 'Material influence is zero; alpha-only reconstruction is active.' });
  } else if (material && material.effective && material.reason === 'no-effective-material-weight') {
    warnings.push({ code: 'MATERIAL_WEIGHT_ZERO', stage: 'material', severity: 'warning', message: 'Auxiliary RGB has zero effective confidence/role weight; alpha-only reconstruction was preserved.' });
  } else if (material && material.effective && material.reason === 'no-cross-view-material-match') {
    warnings.push({ code: 'MATERIAL_MISMATCH_GHOST_RISK', stage: 'material', severity: 'warning', message: 'Silhouettes overlap, but no front material matches auxiliary RGB. IoU alone cannot prove semantic alignment; ghost volumes remain possible.' });
  }
  if (material && material.active && material.unmatched.some(item => item.surfaceOnly)) {
    warnings.push({ code: 'SURFACE_ONLY_DETAILS', stage: 'material', severity: 'warning', message: 'Unmatched small front materials were kept on exposed front faces and replaced by nearby structural material in the interior.' });
  }
  if (material && material.active && material.compareBudgetExceeded) {
    warnings.push({ code: 'MATERIAL_COMPARE_BUDGET', stage: 'material', severity: 'warning', message: 'One oversized auxiliary material view was ignored after reaching the bounded comparison budget.' });
  }
  let occupied = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) occupied++;
  if (!occupied && _maskBounds(frontMask, quant.w, quant.h)) warnings.push({ code: 'EMPTY_RECONSTRUCTION', stage: 'reconstruction', severity: 'error', message: 'The supplied silhouettes contradict each other and removed all voxels.' });
  const frontRows = _projectAxis(frontMask, quant.w, quant.h, 'row');
  const frontCols = _projectAxis(frontMask, quant.w, quant.h, 'col');
  for (const view of silhouettes.prepared) {
    const sourceInput = allViews.find(input => input && input.id === view.id);
    const isLateral = view.role === 'side' || view.role === 'left' || view.role === 'right';
    const profileResolution = isLateral
      ? _profileResolution(sourceInput && sourceInput.pixels && sourceInput.pixels.w, dims[2]) : null;
    const materialView = _materialViewEntry(material, view);
    const projected = new Uint8Array(view.w * view.h);
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
      if (grid[x + dims[0] * (y + dims[1] * z)] < 0) continue;
      const py = dims[1] - 1 - y;
      projected[_viewSample(view, x, py, z)] = 1;
    }
    const quality = _iou(view.mask, projected), overlay = new Uint8Array(projected.length);
    const inputAxis = isLateral ? _projectAxis(view.mask, view.w, view.h, 'row') : _projectAxis(view.mask, view.w, view.h, 'col');
    const frontAxis = isLateral ? frontRows : frontCols;
    const inputOverlap = _iou(frontAxis, inputAxis).iou;
    for (let i = 0; i < overlay.length; i++) overlay[i] = view.mask[i] ? (projected[i] ? 1 : 2) : (projected[i] ? 3 : 0);
    const empty = !_maskBounds(view.mask, view.w, view.h);
    if (empty) warnings.push({ code: 'EMPTY_VIEW', stage: 'input', severity: 'error', view: view.id, message: `The ${view.role} silhouette is empty.` });
    else if (inputOverlap < 0.25) warnings.push({ code: 'LOW_SHARED_AXIS_OVERLAP', stage: 'input', severity: 'warning', view: view.id, iou: inputOverlap, message: `The ${view.role} view does not align on its shared front axis.` });
    if (!empty && quality.iou < 0.25) warnings.push({ code: 'LOW_OVERLAP', stage: 'projection', severity: 'warning', view: view.id, iou: quality.iou, message: `The ${view.role} view has low projected overlap.` });
    if (quality.residual > 0.75) warnings.push({ code: 'VIEW_CONFLICT', stage: 'projection', severity: 'warning', view: view.id, residual: quality.residual, message: `The ${view.role} view is the strongest reconstruction conflict.` });
    if (profileResolution && profileResolution.downsampled) {
      warnings.push({
        code: 'PROFILE_DOWNSAMPLED',
        stage: 'resolution',
        severity: 'warning',
        view: view.id,
        sourceWidth: profileResolution.sourceWidth,
        gridDepth: profileResolution.gridDepth,
        compressionRatio: profileResolution.compressionRatio,
        message: `${profileResolution.label}; source-resolution profile detail is downsampled even when grid projection IoU is exact.`,
      });
    }
    const materialTotal = materialView ? materialView.compatiblePixels + materialView.mismatchPixels : 0;
    const candidateTotal = materialView ? materialView.candidateMatches + materialView.candidateMismatches : 0;
    const materialCoverage = materialTotal ? materialView.compatiblePixels / materialTotal : null;
    const materialMismatchCoverage = materialTotal ? materialView.mismatchPixels / materialTotal : null;
    const materialEvaluated = !!(materialView && materialView.usable);
    const materialCandidateCompatibility = materialEvaluated ? (candidateTotal ? materialView.candidateMatches / candidateTotal : 0) : null;
    const materialOverlay = materialEvaluated ? new Uint8Array(view.mask.length) : null;
    if (materialOverlay) for (let i = 0; i < materialOverlay.length; i++) {
      const matched = materialView.candidateMatchesBySample[i] > 0;
      const mismatched = materialView.candidateMismatchesBySample[i] > 0;
      materialOverlay[i] = matched ? (mismatched ? 3 : 1) : (mismatched ? 2 : 0);
    }
    if (materialView) materialView.diagnosticOverlay = materialOverlay;
    if (material && material.active && materialView && materialView.usable
      && (materialMismatchCoverage > 0.5 || (candidateTotal > 0 && materialCandidateCompatibility < 0.9))) {
      warnings.push({ code: 'MATERIAL_MISMATCH_GHOST_RISK', stage: 'material', severity: 'warning', view: view.id, coverage: materialCandidateCompatibility, message: `The ${view.role} silhouette aligns, but front-to-auxiliary material candidates conflict. Inspect the material overlay; silhouette IoU is not semantic alignment and alpha-only fusion can create ghost volume.` });
    }
    const materialDiagnostic = {
      eligible: materialView ? !!materialView.eligible : view.materialEvidence !== false,
      evaluated: materialEvaluated,
      applied: !!(material && material.active && materialView && materialView.usable),
      compatible: materialView ? materialView.candidateMatches : 0,
      incompatible: materialView ? materialView.candidateMismatches : 0,
      compatibility: materialCandidateCompatibility,
    };
    views.push({
      id: view.id,
      role: view.role,
      confidence: view.confidence,
      inputOverlap,
      iou: quality.iou,
      residual: quality.residual,
      materialCoverage,
      materialMismatchCoverage,
      materialCandidateCompatibility,
      materialUsable: !!(materialView && materialView.usable),
      material: materialDiagnostic,
      profileResolution,
      w: view.w,
      h: view.h,
      projected,
      overlay,
      materialOverlay,
      materialEvidenceOverlay: materialView && materialView.overlay,
    });
  }
  return {
    warnings,
    views,
    material: material ? {
      enabled: material.enabled,
      requested: material.requested,
      effective: material.effective,
      active: material.active,
      reason: material.reason,
      tolerance: material.tolerance,
      strength: material.strength,
      clusterCount: material.clusterCount,
      clipped: material.clipped,
      memoryBytes: material.memoryBytes,
      compareWork: material.compareWork || 0,
      occupancyCompareWork: material.occupancyCompareWork || 0,
      occupancyCompareWorkEstimate: material.occupancyCompareWorkEstimate || 0,
      decorativeFrontFaceArea: material.decorativeFrontFaceArea || 0,
      unmatchedFrontMaterials: material.unmatched,
      clusters: material.front ? Array.from({ length: material.front.clusterCount }, (_, cluster) => ({
        cluster,
        rgb: [material.front.centers[cluster * 3], material.front.centers[cluster * 3 + 1], material.front.centers[cluster * 3 + 2]],
        frontPixels: material.front.counts[cluster],
        supported: !!(material.supportedFront && material.supportedFront[cluster]),
        surfaceOnly: !!(material.surfaceOnly && material.surfaceOnly[cluster]),
        structuralVoxels: material.acceptedVoxels ? material.acceptedVoxels[cluster] : null,
        acceptedVoxels: material.acceptedVoxels ? material.acceptedVoxels[cluster] : null,
        acceptedZSpan: material.acceptedVoxels && material.acceptedVoxels[cluster]
          ? [material.acceptedMinZ[cluster], material.acceptedMaxZ[cluster]] : null,
      })) : [],
    } : null,
    hasErrors: warnings.some(w => w.severity === 'error'),
  };
}

function _countExposedFaces(grid, dims) {
  let count = 0;
  const [DX, DY, DZ] = dims;
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) ? -1 : grid[x + DX * (y + DY * z)];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let z = 0; z < DZ; z++) for (let y = 0; y < DY; y++) for (let x = 0; x < DX; x++) {
    if (get(x, y, z) < 0) continue;
    for (const dir of dirs) if (get(x + dir[0], y + dir[1], z + dir[2]) < 0) count++;
  }
  return count;
}
function _assertFaceBudget(exposedFaces, greedy) {
  const listMultiplier = greedy ? 1 : 2;
  const estimatedBytes = exposedFaces * FACE_OBJECT_ESTIMATE_BYTES * listMultiplier;
  if (exposedFaces > MAX_EXPOSED_FACES || estimatedBytes > MAX_FACE_ALLOCATION_BYTES) {
    throw _budgetError('FACE_BUDGET_EXCEEDED', `Surface has ${exposedFaces} exposed unit faces; estimated face allocation ${estimatedBytes} bytes exceeds the safe mesh budget`);
  }
  return estimatedBytes;
}
function downsampleGrid(grid, dims, factor) {
  const [w, h, d] = dims;
  const f = Math.max(1, factor | 0);
  const ow = Math.ceil(w / f);
  const oh = Math.ceil(h / f);
  const od = Math.ceil(d / f);
  const out = new Int16Array(ow * oh * od);
  const counts = new Map();
  for (let oz = 0; oz < od; oz++) {
    const z0 = oz * f;
    const z1 = Math.min(z0 + f, d);
    for (let oy = 0; oy < oh; oy++) {
      const y0 = oy * f;
      const y1 = Math.min(y0 + f, h);
      for (let ox = 0; ox < ow; ox++) {
        const x0 = ox * f;
        const x1 = Math.min(x0 + f, w);
        counts.clear();
        for (let z = z0; z < z1; z++) {
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const c = grid[x + w * (y + h * z)];
              if (c < 0) continue;
              counts.set(c, (counts.get(c) || 0) + 1);
            }
          }
        }
        let winner = -1;
        let winnerCount = 0;
        for (const count of counts.values()) {
          if (count > winnerCount) winnerCount = count;
        }
        for (const [color, count] of counts) {
          if (count === winnerCount) { winner = color; break; }
        }
        out[ox + ow * (oy + oh * oz)] = winner;
      }
    }
  }
  return { grid: out, dims: [ow, oh, od] };
}
function extractMesh(grid, dims, config, colorAtFace, exposedFaceCount) {
  const opts = legacyOptionsFromConfig(config);
  const naiveCount = exposedFaceCount == null ? _countExposedFaces(grid, dims) : exposedFaceCount;
  _assertFaceBudget(naiveCount, opts.greedy);
  const high = greedyFaces(grid, dims, colorAtFace);
  const mediumGrid = downsampleGrid(grid, dims, 2);
  const medium = greedyFaces(mediumGrid.grid, mediumGrid.dims);
  const lowGrid = downsampleGrid(grid, dims, 4);
  const low = greedyFaces(lowGrid.grid, lowGrid.dims);
  const selectedLod = (config && config.mesh && config.mesh.lod) || 'high';
  return {
    greedyFacesList: high,
    naiveFacesList: opts.greedy ? null : naiveFaces(grid, dims, colorAtFace),
    naiveCount,
    lodFaces: { high, medium, low },
    selectedLod,
  };
}

// ---- top-level: pixels + opts -> everything app.js needs ----
function _hasRealBack(views) {
  if (!views) return false;
  if (Array.isArray(views.views)) return views.views.some(view => view && view.role === 'back');
  return false;
}
function _mergeInferredViews(frontPixels, views, config) {
  if (!config.inference.enabled || !config.inference.back) return views;
  if (_hasRealBack(views)) return views;
  const inferred = inferViews(frontPixels, config);
  if (!inferred) return views;
  const base = views || {};
  const mergedViews = Array.isArray(base.views) ? [...base.views, inferred] : [inferred];
  return { ...base, views: mergedViews };
}
function voxelize(pixels, opts, views) {
  const stageMs = {};
  const totalStart = _nowMs();
  views = views || {};
  const config = _measureStage(stageMs, 'normalizeConfig', () => normalizeConfig(opts));
  const validatedFront = _measureStage(stageMs, 'validateInput', () => {
    const valid = validatePixels(pixels, 'front');
    _assertVoxelBudget(valid.w, valid.h, config.depth.layers);
    return valid;
  });
  const frontPixels = _measureStage(stageMs, 'preprocessFront', () => preprocessPixels(validatedFront, config.silhouette));
  const quant = _measureStage(stageMs, 'prepareFront', () => quantize(frontPixels, config.silhouette.alphaThreshold, config.palette.colors));
  const mergedViews = _measureStage(stageMs, 'mergeInferredViews', () => _mergeInferredViews(frontPixels, views, config));
  const viewInputs = _measureStage(stageMs, 'normalizeViews', () => normalizeViewInputs(mergedViews, config));
  _measureStage(stageMs, 'validateViewBudgets', () => _assertAuxiliaryBudgets(viewInputs, config.silhouette));
  const depthState = _measureStage(stageMs, 'prepareDepth', () => createDepthState(quant, config, viewInputs));
  const silhouettes = _measureStage(stageMs, 'prepareSilhouettes', () => prepareSilhouettes(config, { views: viewInputs }, [quant.w, quant.h, depthState.layers]));
  const material = _measureStage(stageMs, 'prepareMaterials', () => prepareMaterialEvidence(quant, silhouettes, config));
  _measureStage(stageMs, 'preflightMaterialOccupancy', () => _preflightMaterialOccupancy(quant, depthState, silhouettes, material));
  const occupancy = _measureStage(stageMs, 'calculateOccupancy', () => calculateOccupancy(quant, config, silhouettes, depthState, material));
  _refreshMaterialEvidenceBytes(material);
  if (occupancy.voxels > MAX_MESH_VOXELS) throw _budgetError('MESH_BUDGET_EXCEEDED', `Occupied volume exceeds the ${MAX_MESH_VOXELS}-voxel meshing budget`);
  const exposedFaceCount = _measureStage(stageMs, 'validateMeshBudget', () => {
    const count = _countExposedFaces(occupancy.grid, occupancy.dims);
    _assertFaceBudget(count, config.mesh.greedy);
    return count;
  });
  const colored = _measureStage(stageMs, 'fuseColors', () => fuseVoxelColors(occupancy, quant, silhouettes, config));
  const { grid, dims, voxels } = { ...occupancy, grid: colored.grid };
  const mesh = _measureStage(stageMs, 'extractMesh', () => extractMesh(grid, dims, config, colored.faceColorAt, exposedFaceCount));
  const diagnostics = _measureStage(stageMs, 'diagnostics', () => buildDiagnostics(quant, grid, dims, silhouettes, depthState, viewInputs, occupancy));
  _refreshMaterialEvidenceBytes(material);
  if (material.memoryBytes > MAX_MATERIAL_EVIDENCE_BYTES) throw _budgetError('MATERIAL_EVIDENCE_BUDGET_EXCEEDED', 'Tracked material evidence exceeded its exact 8 MiB cap');
  if (diagnostics.material) diagnostics.material.memoryBytes = material.memoryBytes;
  for (const view of diagnostics.views) {
    const preview = silhouettes.previews.byId[view.id];
    if (preview) {
      preview.projected = view.projected;
      preview.overlay = view.overlay;
      preview.materialOverlay = view.materialOverlay;
      preview.materialEvidenceOverlay = view.materialEvidenceOverlay;
      preview.iou = view.iou;
      preview.residual = view.residual;
      preview.materialCoverage = view.materialCoverage;
      preview.materialMismatchCoverage = view.materialMismatchCoverage;
      preview.materialCandidateCompatibility = view.materialCandidateCompatibility;
      preview.material = view.material;
    }
  }
  const lodFaces = mesh.lodFaces || {};
  const faceEstimateBytes = mesh.greedyFacesList.length * 152
    + (mesh.naiveFacesList ? mesh.naiveFacesList.length * 152 : 0)
    + (lodFaces.medium ? lodFaces.medium.length * 152 : 0)
    + (lodFaces.low ? lodFaces.low.length * 152 : 0);
  const memoryEstimateBytes = _estimateMemoryBytes({
    frontPixels: frontPixels.data,
    quantIdxAt: quant.idxAt,
    grid,
    depthProfile: depthState.profile,
    sideMask: silhouettes.sideMask,
    sideRow: silhouettes.sideRow,
    topMask: silhouettes.topMask,
    topCol: silhouettes.topCol,
    viewData: silhouettes.prepared.map(view => [view.mask, view.confidenceMap, view.edgeDistance, view.colors]),
    diagnosticData: diagnostics.views.map(view => [view.projected, view.overlay, view.materialOverlay]),
  }) + faceEstimateBytes + material.memoryBytes;
  return {
    configVersion: CONFIG_VERSION,
    config,
    legacyOptions: legacyOptionsFromConfig(config),
    palette: colored.palette,
    surfaceMaterials: colored.palette.map(() => ({ metallic: 0, roughness: 0, emissive: 0 })),
    voxelColorPolicy: colored.voxelColorPolicy,
    grid,
    dims, voxels,
    greedyFacesList: mesh.greedyFacesList,
    naiveFacesList: mesh.naiveFacesList,
    naiveCount: mesh.naiveCount,
    lodFaces: mesh.lodFaces,
    selectedLod: mesh.selectedLod,
    metrics: {
      stageMs,
      totalMs: _roundMs(_nowMs() - totalStart),
      memoryEstimateBytes,
      memoryEstimateMiB: Math.round((memoryEstimateBytes / (1024 * 1024)) * 1000) / 1000,
      faceEstimateBytes,
      materialEvidenceBytes: material.memoryBytes,
      materialPrepareCompareWork: material.compareWork || 0,
      materialOccupancyCompareWork: material.occupancyCompareWork || 0,
      materialOccupancyCompareWorkEstimate: material.occupancyCompareWorkEstimate || 0,
      materialCompareWork: (material.compareWork || 0) + (material.occupancyCompareWork || 0),
      transformedViewCells: silhouettes.budget.transformedCells,
      transformedViewPeakBytes: silhouettes.budget.peakBytes,
      bytesPerVoxel: voxels ? Math.round(memoryEstimateBytes / voxels) : 0,
      viewBytes: Object.assign(Object.create(null), Object.fromEntries(silhouettes.prepared.map(view => [view.id, _estimateMemoryBytes({ mask: view.mask, confidence: view.confidenceMap, distance: view.edgeDistance, colors: view.colors })]))),
    },
    diagnostics,
    debug: {
      silhouettes: silhouettes.previews,
      views: silhouettes.previews.byId,
    },
  };
}

// ===================== AMBIENT OCCLUSION (baked) =====================
// Oscurece cada esquina de cada cara segun los vecinos solidos (regla de
// Minecraft: lado1, lado2, diagonal). Funciona sobre cualquier quad, asi
// que sirve tanto para malla greedy como por-voxel.
function _solidGet(grid, dims) {
  const [DX, DY, DZ] = dims;
  return (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ)
    ? false : grid[x + DX * (y + DY * z)] >= 0;
}
function _aoLevel(get, P, nax, ua, ub, su, sv, sOut) {
  const aOut = (sOut > 0) ? P[nax] : P[nax] - 1;          // capa de celdas exterior
  const u0 = P[ua] - 1, u1 = P[ua], v0 = P[ub] - 1, v1 = P[ub];
  const outerU = (su > 0) ? u1 : u0, intu = (su > 0) ? u0 : u1;
  const outerV = (sv > 0) ? v1 : v0, intv = (sv > 0) ? v0 : v1;
  const cell = (cu, cv) => { const c = [0, 0, 0]; c[nax] = aOut; c[ua] = cu; c[ub] = cv; return get(c[0], c[1], c[2]) ? 1 : 0; };
  const s1 = cell(outerU, intv), s2 = cell(intu, outerV), cor = cell(outerU, outerV);
  return (s1 && s2) ? 0 : 3 - (s1 + s2 + cor);            // 0=ocluido, 3=abierto
}
// Anota cada cara con f.ao = [4] (multiplicadores de brillo por esquina).
function annotateAO(faces, grid, dims, strength) {
  const get = _solidGet(grid, dims);
  const s = (strength == null) ? 1 : strength;
  const base = [0.35, 0.6, 0.8, 1.0];
  for (const f of faces) {
    const n = f.normal;
    const nax = n[0] ? 0 : (n[1] ? 1 : 2), sOut = n[nax];
    const ua = (nax + 1) % 3, ub = (nax + 2) % 3, C = f.corners;
    const cu = (C[0][ua] + C[1][ua] + C[2][ua] + C[3][ua]) / 4;
    const cv = (C[0][ub] + C[1][ub] + C[2][ub] + C[3][ub]) / 4;
    f.ao = C.map(P => {
      const su = P[ua] > cu ? 1 : -1, sv = P[ub] > cv ? 1 : -1;
      const fac = base[_aoLevel(get, P, nax, ua, ub, su, sv, sOut)];
      return 1 - s * (1 - fac);
    });
  }
  return faces;
}

const voxelRoot = (typeof window !== 'undefined') ? window : globalThis;
voxelRoot.Voxel = {
  CONFIG_VERSION,
  MAX_DEPTH_LAYERS,
  MAX_VOXEL_COUNT,
  CANONICAL_ORIENTATIONS,
  LOD_LEVELS,
  canvasToPixels,
  validatePixels,
  preprocessPixels,
  createDefaultConfig,
  migrateConfig,
  defaultLegacyOptions,
  legacyOptionsFromConfig,
  normalizeConfig,
  inferViews,
  _maskBounds,
  prepareSilhouettes,
  transformViews,
  normalizeViewInputs,
  _landmarkTransform,
  _forwardTransformPoint,
  _viewSample,
  _viewWeight,
  createDepthState,
  calculateOccupancy,
  extractMesh,
  downsampleGrid,
  voxelize,
  annotateAO,
};
