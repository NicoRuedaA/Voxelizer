/* app.js — Three.js scene + UI wiring for the Voxelizer prototype.
   Depends on globals: THREE, THREE.OrbitControls, SAMPLE_SPRITES, Voxel,
   VoxelTransfer, VoxelBatch, VoxelWorkerChannel, VoxelViewport,
   VoxelProfileDepth, VoxIO, ZipUtil. */
(function () {
  'use strict';

  // ---------- state ----------
  const cloneData = value => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };
  const defaultConfig = Voxel.createDefaultConfig ? Voxel.createDefaultConfig() : null;
  const defaultAlignment = defaultConfig ? cloneData(defaultConfig.alignment) : {
    autoFit: false,
    side: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false, autoFit: false },
    top: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false, autoFit: false },
  };
  const defaultOpts = Voxel.defaultLegacyOptions ? Voxel.defaultLegacyOptions() : {
    depth: 6, alpha: 40, colors: 32, greedy: true, depthMode: 'uniform', relief: 1.0, scale: 1.0,
    inputCap: 96,
    dtRound: 1.0, poissonTension: 0.0, sfsGamma: 1.0, comboMix: 0.5, ao: false, aoStrength: 0.8,
    humTorso: 0.6, humRound: 1.0, humPrior: 0.4, humHead: 0.25, humSmooth: 0.3,
    inferenceEnabled: false
  };
  const state = {
    pixels: null,        // current {w,h,data} (single frame, after sheet slice)
    sourceCanvas: null,  // full source canvas (pre-slice)
    name: '—',
    opts: { ...defaultOpts, alignment: cloneData(defaultAlignment) },
    sheet: { c: 1, r: 1, frame: 0 },
    views: { side: null, top: null, depthMap: null },   // optional canvases for the active record
    showWire: false, showGrid: false,
    last: null,          // last voxelize() result
    busy: false,
    batchBusy: false,
    batchCancelRequested: false,
    batchProgress: { visible: false, done: 0, total: 0, label: 'Listo' },
    diagnosticViewIds: {},
    paletteEdit: null,
  };

  // Download history used for testing / debugging batch and individual exports.
  const downloadHistory = [];

  // ---------- three setup ----------
  const host = document.getElementById('three');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(50, 80, 60);
  scene.add(directionalLight);
  const perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  const orthographicCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  let modelWorldDims = [44, 44, 44];

  const controls = new THREE.OrbitControls(perspectiveCamera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.4;

  // ground grid
  const grid = new THREE.GridHelper(200, 40, 0x3fbacb, 0x2a2d35);
  grid.position.y = -0.01;
  grid.visible = false;
  scene.add(grid);

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  let mesh = null, wire = null;

  const cameraController = VoxelViewport.createCameraController({
    perspectiveCamera,
    orthographicCamera,
    controls,
    dimensions: modelWorldDims,
    aspect: 1,
    autoRotate: true,
  });

  function syncCameraUi() {
    const mode = cameraController.mode;
    const perspective = mode === 'perspective';
    $('btnRotate').disabled = !perspective;
    setPressed($('btnRotate'), perspective && cameraController.autoRotatePreference);
    document.querySelectorAll('[data-camera-mode]').forEach(button => setPressed(button, button.dataset.cameraMode === mode));
    const labels = { perspective: 'Perspective', front: 'Front · orthographic', profile: 'Profile · orthographic', top: 'Top · orthographic' };
    $('cameraModeLabel').textContent = labels[mode];
  }

  function resetCamera() {
    cameraController.reset();
  }

  function setCameraMode(mode) {
    cameraController.setMode(mode);
    syncCameraUi();
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    cameraController.resize(w / h);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, cameraController.activeCamera);
  })();

  // ---------- shading ----------
  const L = (() => { const v = new THREE.Vector3(0.45, 0.85, 0.55); v.normalize(); return v; })();
  function shade(n) {
    const d = Math.max(0, n[0] * L.x + n[1] * L.y + n[2] * L.z);
    return 0.42 + 0.58 * d;
  }
  function cloneOpts(opts = state.opts) {
    return cloneData(opts);
  }
  function activeRecord() {
    return items.find(it => it.canvas === state.sourceCanvas) || null;
  }
  function ensureAlignmentState() {
    if (!state.opts.alignment) state.opts.alignment = cloneData(defaultAlignment);
    if (!state.opts.alignment.side) state.opts.alignment.side = cloneData(defaultAlignment.side);
    if (!state.opts.alignment.top) state.opts.alignment.top = cloneData(defaultAlignment.top);
    return state.opts.alignment;
  }
  function ensureRecordAlignment(rec) {
    if (!rec) return cloneData(defaultAlignment);
    if (!rec.alignment) rec.alignment = cloneData(defaultAlignment);
    if (!rec.alignment.side) rec.alignment.side = cloneData(defaultAlignment.side);
    if (!rec.alignment.top) rec.alignment.top = cloneData(defaultAlignment.top);
    if (typeof rec.alignment.autoFit !== 'boolean') rec.alignment.autoFit = false;
    return rec.alignment;
  }
  function alignRef(kind) {
    const alignment = ensureAlignmentState();
    return alignment[kind];
  }

  // ---------- build geometry from faces ----------
  function disposeModel() {
    // Remove every mesh/wire child so the flat path and the PBR multi-mesh path
    // both leave the modelGroup empty before rebuilding.
    const children = modelGroup.children.slice();
    for (const child of children) {
      modelGroup.remove(child);
      if (child.geometry && child.geometry.dispose) child.geometry.dispose();
      if (child.material && child.material.dispose) child.material.dispose();
    }
    mesh = null;
    wire = null;
  }

  function buildModel(result) {
    disposeModel();

    const faces = state.opts.greedy ? result.greedyFacesList : (result.naiveFacesList || result.greedyFacesList);
    const pal = result.palette;
    const surfaceMaterials = result.surfaceMaterials || pal.map(() => ({ metallic: 0, roughness: 0, emissive: 0 }));
    const hasPBR = surfaceMaterials.some(m => m && (m.metallic > 0 || m.roughness > 0 || m.emissive > 0));
    if (state.opts.ao && result.grid && !hasPBR) Voxel.annotateAO(faces, result.grid, result.dims, state.opts.aoStrength);

    const [DX, DY, DZ] = result.dims;

    if (!hasPBR) {
      // Flat path: one mesh, one material, vertex colors + fake shading.
      const pos = [], col = [], idx = [];
      let vi = 0;
      for (const f of faces) {
        const c = f.corners, s = shade(f.normal);
        const rgb = pal[f.color] || [200, 200, 200];
        const r = (rgb[0] / 255) * s, g = (rgb[1] / 255) * s, b = (rgb[2] / 255) * s;
        const ao = f.ao;
        for (let k = 0; k < 4; k++) {
          const a = ao ? ao[k] : 1;
          pos.push(c[k][0], c[k][1], c[k][2]); col.push(r * a, g * a, b * a);
        }
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geo, mat);
      modelGroup.add(mesh);
    } else {
      // PBR path: one MeshStandardMaterial per palette index used by the faces.
      const byColor = new Map();
      for (const f of faces) {
        if (!byColor.has(f.color)) byColor.set(f.color, []);
        byColor.get(f.color).push(f);
      }
      byColor.forEach((group, colorIndex) => {
        const pos = [], nor = [], idx = [];
        let vi = 0;
        const rgb = pal[colorIndex] || [200, 200, 200];
        const mat = surfaceMaterials[colorIndex] || { metallic: 0, roughness: 0, emissive: 0 };
        for (const f of group) {
          const c = f.corners, n = f.normal;
          for (let k = 0; k < 4; k++) {
            pos.push(c[k][0], c[k][1], c[k][2]);
            nor.push(n[0], n[1], n[2]);
          }
          idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          vi += 4;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setIndex(idx);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255),
          metalness: mat.metallic,
          roughness: mat.roughness,
          emissive: new THREE.Color((rgb[0] / 255) * mat.emissive, (rgb[1] / 255) * mat.emissive, (rgb[2] / 255) * mat.emissive),
          side: THREE.DoubleSide,
        });
        const pbrMesh = new THREE.Mesh(geo, material);
        modelGroup.add(pbrMesh);
        mesh = pbrMesh;
      });
    }

    // wireframe for both paths
    const wpos = [];
    for (const f of faces) {
      const c = f.corners;
      for (let k = 0; k < 4; k++) {
        const a = c[k], d = c[(k + 1) % 4];
        wpos.push(a[0], a[1], a[2], d[0], d[1], d[2]);
      }
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    const wmat = new THREE.LineBasicMaterial({ color: 0x0a0c0f, transparent: true, opacity: 0.55 });
    wire = new THREE.LineSegments(wgeo, wmat);
    wire.visible = state.showWire;
    modelGroup.add(wire);

    // center the model at origin
    modelGroup.children.forEach(o => { o.position.set(-DX / 2, -DY / 2, -DZ / 2); });

    // scale group so the largest sprite dim ~= 44 units, regardless of sprite size
    const maxDim = Math.max(DX, DY);
    const k = 44 / maxDim;
    modelGroup.scale.setScalar(k);
    modelWorldDims = [DX * k, DY * k, DZ * k];
    cameraController.setDimensions(modelWorldDims);
  }

  // ---------- palette editor ----------
  function initPaletteEdit(result) {
    if (!result || !result.palette) {
      state.paletteEdit = null;
      return;
    }
    const palette = result.palette.slice();
    const surfaceMaterials = (result.surfaceMaterials || palette.map(() => ({ metallic: 0, roughness: 0, emissive: 0 })))
      .map(m => ({ metallic: m.metallic, roughness: m.roughness, emissive: m.emissive }));
    state.paletteEdit = {
      original: palette,
      palette: palette.slice(),
      originalSurfaceMaterials: surfaceMaterials.map(m => ({ ...m })),
      surfaceMaterials: surfaceMaterials.map(m => ({ ...m })),
      map: palette.map((_, i) => i),
      dirty: false,
    };
  }

  function resetPaletteEdit() {
    if (!state.paletteEdit || !state.paletteEdit.original) return;
    const palette = state.paletteEdit.original;
    const originalSurfaceMaterials = state.paletteEdit.originalSurfaceMaterials;
    state.paletteEdit.palette = palette.slice();
    state.paletteEdit.surfaceMaterials = originalSurfaceMaterials.map(m => ({ ...m }));
    state.paletteEdit.map = palette.map((_, i) => i);
    state.paletteEdit.dirty = false;
    buildPreview();
  }

  function buildPreview() {
    if (!state.last || !state.paletteEdit || !state.paletteEdit.dirty) return null;
    const { palette, map, surfaceMaterials, originalSurfaceMaterials } = state.paletteEdit;
    const originalMaterials = originalSurfaceMaterials.map((m, originalIndex) => {
      const currentIndex = map[originalIndex];
      if (currentIndex < 0 || currentIndex >= surfaceMaterials.length) return m;
      return surfaceMaterials[currentIndex];
    });
    const preview = PaletteIO.applyRemap({ ...state.last, surfaceMaterials: originalMaterials }, palette, map);
    buildModel(preview);
    updateReadouts(preview, 0);
    return preview;
  }

  function effectiveResult() {
    if (!state.last || !state.paletteEdit || !state.paletteEdit.dirty) return state.last;
    const { palette, map, surfaceMaterials, originalSurfaceMaterials } = state.paletteEdit;
    const originalMaterials = originalSurfaceMaterials.map((m, originalIndex) => {
      const currentIndex = map[originalIndex];
      if (currentIndex < 0 || currentIndex >= surfaceMaterials.length) return m;
      return surfaceMaterials[currentIndex];
    });
    return PaletteIO.applyRemap({ ...state.last, surfaceMaterials: originalMaterials }, palette, map);
  }

  function guardPaletteIndex(index, max, label) {
    if (!Number.isFinite(index) || index < 0 || index >= max) {
      throw new RangeError(`${label} index ${index} out of range [0, ${max})`);
    }
  }

  function editPaletteColor(index, rgb) {
    const edit = state.paletteEdit;
    if (!edit) return;
    guardPaletteIndex(index, edit.palette.length, 'editPaletteColor');
    edit.palette[index] = [rgb[0] & 255, rgb[1] & 255, rgb[2] & 255];
    edit.dirty = true;
    buildPreview();
    updateSwatches();
  }

  function editSurfaceMaterial(index, prop, value) {
    const edit = state.paletteEdit;
    if (!edit) return;
    guardPaletteIndex(index, edit.surfaceMaterials.length, 'editSurfaceMaterial');
    const validProps = ['metallic', 'roughness', 'emissive'];
    if (!validProps.includes(prop)) {
      throw new RangeError(`editSurfaceMaterial: invalid property ${prop}`);
    }
    const num = Number(value);
    const clamped = Number.isNaN(num) ? 0 : Math.max(0, Math.min(1, num));
    edit.surfaceMaterials[index][prop] = clamped;
    edit.dirty = true;
    buildPreview();
    updateSwatches();
  }

  function reorderPaletteColor(fromIndex, toIndex) {
    const edit = state.paletteEdit;
    if (!edit) return;
    const len = edit.palette.length;
    guardPaletteIndex(fromIndex, len, 'reorderPaletteColor from');
    guardPaletteIndex(toIndex, len, 'reorderPaletteColor to');
    if (fromIndex === toIndex) return;
    const moved = edit.palette.splice(fromIndex, 1)[0];
    edit.palette.splice(toIndex, 0, moved);
    const movedMaterial = edit.surfaceMaterials.splice(fromIndex, 1)[0];
    edit.surfaceMaterials.splice(toIndex, 0, movedMaterial);
    // Build originalIndex -> currentPosition map.
    const positionMap = new Array(len);
    for (let pos = 0; pos < len; pos++) {
      let originalIndex = pos;
      if (pos >= Math.min(fromIndex, toIndex) && pos <= Math.max(fromIndex, toIndex)) {
        originalIndex = pos === toIndex ? fromIndex : (fromIndex < toIndex ? pos + 1 : pos - 1);
      }
      positionMap[originalIndex] = pos;
    }
    edit.map = edit.map.map(oldIndex => positionMap[oldIndex]);
    edit.dirty = true;
    buildPreview();
    updateSwatches();
  }

  function mergePaletteColors(sourceIndex, targetIndex) {
    const edit = state.paletteEdit;
    if (!edit) return;
    const len = edit.palette.length;
    guardPaletteIndex(sourceIndex, len, 'mergePaletteColors source');
    guardPaletteIndex(targetIndex, len, 'mergePaletteColors target');
    if (sourceIndex === targetIndex) {
      throw new RangeError('mergePaletteColors source and target must be different');
    }
    edit.palette.splice(sourceIndex, 1);
    edit.surfaceMaterials.splice(sourceIndex, 1);
    edit.map = edit.map.map(oldIndex => oldIndex === sourceIndex ? targetIndex : (oldIndex > sourceIndex ? oldIndex - 1 : oldIndex));
    edit.dirty = true;
    buildPreview();
    updateSwatches();
  }

  function importPaletteFile(text, ext) {
    const edit = state.paletteEdit;
    if (!edit) throw new Error('No palette to import into');
    const parsed = ext === 'pal' ? PaletteIO.parseJascPal(text) : PaletteIO.parseGpl(text);
    const colors = parsed.colors;
    if (colors.length > edit.palette.length) {
      throw new RangeError(`Imported palette too large: ${colors.length} colors exceed current ${edit.palette.length}`);
    }
    for (let i = 0; i < colors.length; i++) {
      edit.palette[i] = colors[i];
    }
    edit.dirty = true;
    buildPreview();
    updateSwatches();
  }

  function exportPaletteFile(ext) {
    const edit = state.paletteEdit;
    if (!edit) throw new Error('No palette to export');
    const palette = edit.dirty ? edit.palette : edit.original;
    return ext === 'pal' ? PaletteIO.serializeJascPal(palette) : PaletteIO.serializeGpl(baseName(state.name), palette);
  }

  function triggerDownload(name, text) {
    download(name, text);
  }

  function updateSwatches() {
    const edit = state.paletteEdit;
    const sw = $('swatches');
    sw.replaceChildren();
    const palette = edit ? edit.palette : (state.last && state.last.palette ? state.last.palette : []);
    const materials = edit && edit.surfaceMaterials ? edit.surfaceMaterials : [];
    palette.slice(0, 28).forEach((c, index) => {
      const item = document.createElement('div');
      item.className = 'swatch-item';
      item.dataset.index = String(index);
      item.draggable = true;
      item.title = `Color ${index}: ${c[0]},${c[1]},${c[2]}`;
      const i = document.createElement('i');
      i.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
      i.setAttribute('role', 'button');
      i.setAttribute('aria-label', `Color ${index}`);
      i.addEventListener('click', () => openColorEditor(index));
      item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; });
      item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      item.addEventListener('drop', e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(from)) return;
        if (e.shiftKey) {
          mergePaletteColors(from, index);
        } else {
          reorderPaletteColor(from, index);
        }
      });
      item.appendChild(i);
      const mat = materials[index] || { metallic: 0, roughness: 0, emissive: 0 };
      [['metallic', 'M'], ['roughness', 'R'], ['emissive', 'E']].forEach(([prop, label]) => {
        const input = document.createElement('input');
        input.className = 'mat';
        input.type = 'number';
        input.min = 0;
        input.max = 1;
        input.step = 0.1;
        input.value = mat[prop].toFixed(1);
        input.title = `${label} ${index}`;
        input.setAttribute('aria-label', `${label} ${index}`);
        input.addEventListener('change', e => {
          e.stopPropagation();
          editSurfaceMaterial(index, prop, e.target.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
        item.appendChild(input);
      });
      sw.appendChild(item);
    });
  }

  let mergeSourceIndex = null;
  function openColorEditor(index) {
    const edit = state.paletteEdit;
    if (!edit) return;
    guardPaletteIndex(index, edit.palette.length, 'openColorEditor');
    const c = edit.palette[index];
    const input = prompt ? prompt(`Edit color ${index} (R G B):`, `${c[0]} ${c[1]} ${c[2]}`) : null;
    if (input == null) return;
    const parts = input.trim().split(/\s+/);
    if (parts.length < 3) { toast('Formato: R G B'); return; }
    const rgb = parts.map(v => Math.max(0, Math.min(255, parseInt(v, 10) || 0)));
    editPaletteColor(index, rgb);
  }

  function selectMergeSource(index) {
    const edit = state.paletteEdit;
    if (!edit) return;
    guardPaletteIndex(index, edit.palette.length, 'selectMergeSource');
    mergeSourceIndex = index;
    toast(`Color ${index} seleccionado como origen. Shift+clic en el destino para fusionar.`);
  }

  // ---------- sheet slicing ----------
  function frameCount(sheet) {
    return Math.max(1, (sheet.c | 0) * (sheet.r | 0));
  }
  function frameLabel(frame, total) {
    const width = String(total).length;
    return `_f${String(frame + 1).padStart(width, '0')}`;
  }
  function sliceFrameFromCanvas(src, sheet, frame) {
    if (!src) return null;
    const cols = Math.max(1, sheet.c | 0), rows = Math.max(1, sheet.r | 0);
    if (cols <= 1 && rows <= 1) { return Voxel.canvasToPixels(src); }
    const fw = Math.floor(src.width / cols), fh = Math.floor(src.height / rows);
    const total = cols * rows;
    const safeFrame = Math.max(0, Math.min(frame, total - 1));
    const fx = (safeFrame % cols) * fw;
    const fy = Math.floor(safeFrame / cols) * fh;
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    cv.getContext('2d').drawImage(src, fx, fy, fw, fh, 0, 0, fw, fh);
    return Voxel.canvasToPixels(cv);
  }
  function sliceFrame() {
    return sliceFrameFromCanvas(state.sourceCanvas, state.sheet, state.sheet.frame);
  }

  function getItemViews(rec, sheet = state.sheet, frame = state.sheet.frame) {
    const views = { frame, views: [] };
    const add = (kind, role, canvas, sourceRec = rec) => {
      if (!canvas) return;
      const metadata = sourceRec.viewMetadata && sourceRec.viewMetadata[kind] ? cloneData(sourceRec.viewMetadata[kind]) : { frameMode: 'static' };
      const pixels = metadata.frameMode === 'sheet' ? sliceFrameFromCanvas(canvas, sheet, frame) : Voxel.canvasToPixels(canvas);
      views.views.push({ role, pixels, confidence: 1, frameMetadata: { ...metadata, selectedFrame: frame } });
    };
    add('back', 'back', rec.back);
    add('left', 'left', rec.left);
    add('right', 'right', rec.right);
    add('side', 'side', rec.side);
    add('top', 'top', rec.top);
    add('depthMap', 'depthmap', rec.depthMap);
    return views;
  }

  function profileDepthState() {
    const rec = activeRecord();
    const views = rec ? getItemViews(rec, state.sheet, state.sheet.frame) : { views: [] };
    return VoxelProfileDepth.actionState(views, Voxel.MAX_DEPTH_LAYERS, {
      previewBusy: state.busy,
      batchBusy: state.batchBusy,
    });
  }

  function profileDepthMessage(match) {
    if (match.busy) return 'Wait for the current preview or batch before matching depth.';
    if (match.status === VoxelProfileDepth.STATUS.NO_SIDE_VIEW) return 'Add a calibrated profile view to match its selected frame width.';
    if (match.status === VoxelProfileDepth.STATUS.INVALID_SIDE_PIXELS) return 'The selected profile frame is not a valid RGBA pixel payload.';
    if (match.clamped) return `The selected profile frame is ${match.sourceWidth}px wide and is limited to ${match.depth} layers.`;
    return `Use ${match.depth} layers: one depth layer per source pixel in the selected profile frame, before alignment or resampling.`;
  }

  function updateMatchProfileAction() {
    const match = profileDepthState();
    const button = $('matchProfileDepth');
    const message = profileDepthMessage(match);
    button.disabled = match.disabled;
    button.title = message;
    $('matchProfileHint').textContent = message;
    return match;
  }

  function createVoxelWorkerChannel() {
    return VoxelWorkerChannel.create({
      workerUrl: 'worker.js',
      voxelize: Voxel.voxelize,
      transfer: VoxelTransfer,
    });
  }

  const previewWorker = createVoxelWorkerChannel();
  const batchWorker = createVoxelWorkerChannel();

  function spawnVoxelTask(pixels, opts, views) {
    return batchWorker.run(pixels, opts, views);
  }

  function cancelPreviewJob(reason = 'stale') {
    previewWorker.cancelPending(reason);
  }
  function voxelizePreview(pixels, opts, views) {
    cancelPreviewJob();
    return previewWorker.run(pixels, opts, views);
  }

  // ---------- recompute (debounced to a frame) ----------
  let raf = 0;
  let renderSeq = 0;
  function invalidatePreviewEvidence(statusText) {
    state.last = null;
    state.diagnosticViewIds = {};
    disposeModel();
    $('stVox').textContent = '—';
    $('stRaw').textContent = '—';
    $('stGreedy').textContent = '—';
    $('stRed').textContent = '—';
    $('srcDims').textContent = state.pixels ? `${state.pixels.w}×${state.pixels.h} px · — capas Z` : '—';
    $('profileResolution').textContent = 'Profile resolution —';
    $('profileResolution').classList.remove('warning');
    $('palCount').textContent = '— colores';
    $('statDims').textContent = '— grid';
    $('swatches').replaceChildren();
    $('diagnostics').replaceChildren();
    updateAlignmentViews();
    $('statMain').textContent = statusText;
  }

  function recompute() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(run);
  }
  async function run() {
    if (!state.sourceCanvas) return;
    const seq = ++renderSeq;
    const pixels = sliceFrame();
    if (!pixels) return;
    state.pixels = pixels;
    const t0 = performance.now();
    const views = getItemViews(items.find(it => it.canvas === state.sourceCanvas) || {}, state.sheet, state.sheet.frame);
    state.busy = true;
    invalidatePreviewEvidence('Voxelizando…');
    refreshActionState();
    try {
      const result = await voxelizePreview(pixels, cloneOpts(), views);
      if (seq !== renderSeq) return;
      const ms = (performance.now() - t0);
      state.last = result;
      initPaletteEdit(result);
      buildModel(result);
      updateAlignmentViews();
      updateReadouts(result, ms);
    } catch (error) {
      if (error.message === 'stale') return;
      invalidatePreviewEvidence('Error de voxelización');
      toast(error.message || 'No se pudo voxelizar el sprite');
    } finally {
      if (seq === renderSeq) state.busy = false;
      if (seq === renderSeq) refreshActionState();
    }
  }

  // ---------- readouts ----------
  const $ = id => document.getElementById(id);
  function fmt(n) { return n.toLocaleString('en-US'); }
  function setPressed(el, on) {
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function bindPseudoButton(el, action) {
    el.addEventListener('click', action);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        action(e);
      }
    });
  }
  function updateReadouts(r, ms) {
    $('stVox').textContent = fmt(r.voxels);
    $('stRaw').textContent = fmt(r.naiveCount);
    $('stGreedy').textContent = fmt(r.greedyFacesList.length);
    const red = r.naiveCount > 0 ? (100 * (1 - r.greedyFacesList.length / r.naiveCount)) : 0;
    $('stRed').textContent = '−' + red.toFixed(0) + '%';
    $('srcDims').textContent = `${state.pixels.w}×${state.pixels.h} px · ${r.dims[2]} capas Z`;
    const profile = (r.diagnostics && r.diagnostics.views || [])
      .map(view => view.profileResolution).find(Boolean);
    $('profileResolution').textContent = profile ? profile.label : 'Profile resolution —';
    $('profileResolution').classList.toggle('warning', !!(profile && profile.downsampled));
    $('palCount').textContent = r.palette.length + ' colores';
    const statDims = $('statDims');
    const dimsStrong = document.createElement('b');
    dimsStrong.textContent = `${r.dims[0]}×${r.dims[1]}×${r.dims[2]}`;
    statDims.replaceChildren(dimsStrong, document.createTextNode(' grid'));
    $('statMain').textContent = `Voxelizado en ${ms.toFixed(0)} ms`;
    // swatches
    updateSwatches();
    const diagnostics = $('diagnostics');
    diagnostics.replaceChildren();
    // Filter technical warnings that are only useful for developers
    const technicalWarnings = ['WORKER_FALLBACK', 'SURFACE_ONLY_DETAILS'];
    const warnings = r.diagnostics ? r.diagnostics.warnings.filter(w => !technicalWarnings.includes(w.code)) : [];
    if (!warnings.length) {
      // No need to show "all good" message - just leave diagnostics empty
    } else {
      warnings.forEach(warning => {
        const line = document.createElement('p');
        line.className = warning.severity || 'warning';
        line.textContent = `${warning.stage || 'diagnostic'} · ${warning.code}${warning.view ? ` · ${warning.view}` : ''}: ${warning.message}`;
        diagnostics.appendChild(line);
      });
    }
    // Remove technical diagnostic view buttons (IoU, residual, material %)
    // These are developer-only metrics, not useful for end users
  }

  // ---------- thumbnails / batch ----------
  function thumbCanvas(srcCanvas, px = 34) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    // fit preserving aspect
    const s = Math.min(px / srcCanvas.width, px / srcCanvas.height);
    const w = srcCanvas.width * s, h = srcCanvas.height * s;
    g.drawImage(srcCanvas, (px - w) / 2, (px - h) / 2, w, h);
    return cv;
  }

  const items = []; // {name, canvas, el, status}
  function setItemStatus(rec, status, label) {
    rec.st.className = 'st ' + status;
    rec.st.textContent = label || ({
      done: 'OK',
      queued: 'cola',
      progress: 'PROC',
      err: 'ERR',
    }[status] || status);
  }
  function removeItem(rec) {
    const idx = items.indexOf(rec);
    if (idx === -1) return;
    items.splice(idx, 1);
    rec.el.remove();
    if (items.length === 0) {
      state.sourceCanvas = null;
      state.name = null;
      invalidatePreviewEvidence('No hay sprites');
      disposeModel();
    } else if (rec.canvas === state.sourceCanvas) {
      const nextIdx = Math.min(idx, items.length - 1);
      selectItem(items[nextIdx]);
    }
    updateBatchCount();
    refreshActionState();
  }
  function addItem(name, canvas, status = 'queued', select = false) {
    const el = document.createElement('div');
    el.className = 'item';
    const th = thumbCanvas(canvas);
    el.appendChild(th);
    const meta = document.createElement('div'); meta.className = 'meta';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = name;
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `${canvas.width}×${canvas.height}`;
    meta.appendChild(nm); meta.appendChild(sub);
    const st = document.createElement('span');
    el.appendChild(meta); el.appendChild(st);
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'del-item';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `Eliminar ${name}`);
    delBtn.addEventListener('click', e => { e.stopPropagation(); removeItem(rec); });
    el.appendChild(delBtn);
    const rec = { name, canvas, el, st, alignment: cloneData(defaultAlignment), viewMetadata: {
      side: { frameMode: 'static' }, top: { frameMode: 'static' }, depthMap: { frameMode: 'static' },
    } };
    setItemStatus(rec, status);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Abrir sprite ${name}`);
    bindPseudoButton(el, () => selectItem(rec));
    document.getElementById('list').appendChild(el);
    items.push(rec);
    updateBatchCount();
    refreshActionState();
    if (select) selectItem(rec);
    return rec;
  }
  function updateBatchCount() {
    document.getElementById('batchCount').textContent = items.length + (items.length === 1 ? ' item' : ' items');
    refreshActionState();
  }
  function selectItem(rec) {
    items.forEach(it => it.el.classList.toggle('active', it === rec));
    state.sourceCanvas = rec.canvas;
    state.name = rec.name;
    state.sheet.frame = 0;
    state.diagnosticViewIds = {};
    state.opts.alignment = ensureRecordAlignment(rec);
    const viewKinds = ['back', 'left', 'right', 'side', 'top', 'depthMap'];
    state.views = {};
    viewKinds.forEach(kind => state.views[kind] = rec[kind] || null);
    ['side', 'top', 'depthMap'].forEach(kind => syncToggle(kind + 'FollowsSheet', rec.viewMetadata && rec.viewMetadata[kind] && rec.viewMetadata[kind].frameMode === 'sheet'));
    fillFrontSlot(rec.canvas);
    viewKinds.forEach(kind => fillSlot(kind, state.views[kind]));
    $('srcName').textContent = rec.name;
    state.last = null;
    updateAlignmentViews();
    updateMatchProfileAction();
    if (!state.batchBusy) setItemStatus(rec, 'done');
    updateFrameUI();
    refreshActionState();
    run();
  }

  // ---------- multi-view slots ----------
  const SLOT_IDS = {
    back: 'slotBack', left: 'slotLeft', right: 'slotRight',
    side: 'slotSide', top: 'slotTop', depthMap: 'slotDepth',
  };
  const SLOT_LABELS = {
    back: 'Trasera', left: 'Izquierda', right: 'Derecha',
    side: 'Perfil', top: 'Cenital', depthMap: 'Depth',
  };
  function fillSlot(kind, canvas) {
    const id = SLOT_IDS[kind];
    if (!id) return;
    const el = $(id);
    if (!el) return;
    const label = SLOT_LABELS[kind] || kind;
    el.replaceChildren();
    if (canvas) {
      el.classList.add('set');
      el.setAttribute('aria-label', `${label} cargada. Pulsa para reemplazar.`);
      el.appendChild(thumbCanvas(canvas, 46));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'vx';
      x.textContent = '×';
      x.setAttribute('aria-label', `Quitar vista ${label.toLowerCase()}`);
      x.addEventListener('click', e => { e.stopPropagation(); setView(kind, null); });
      el.appendChild(x);
    } else {
      el.classList.remove('set');
      el.setAttribute('aria-label', `Añadir vista ${label.toLowerCase()}`);
      const text = document.createTextNode(label);
      const hint = document.createElement('span');
      hint.textContent = '+ añadir';
      el.append(text, hint);
    }
  }
  function fillFrontSlot(canvas) {
    const el = $('slotFront');
    if (!el) return;
    el.replaceChildren();
    if (canvas) {
      el.classList.add('set');
      el.appendChild(thumbCanvas(canvas, 46));
      const label = document.createElement('span');
      label.textContent = 'Frontal';
      el.appendChild(label);
    } else {
      el.classList.remove('set');
      el.replaceChildren();
      el.appendChild(document.createTextNode('Frontal'));
    }
  }
  function setView(kind, canvas) {
    const rec = activeRecord();
    if (rec) rec[kind] = canvas;
    if (rec && kind !== 'depthMap') state.opts.alignment = ensureRecordAlignment(rec);
    state.views[kind] = canvas;
    fillSlot(kind, canvas);
    state.last = null;
    if (kind !== 'depthMap') updateAlignmentViews();
    updateMatchProfileAction();
    recompute();
  }

  // ---------- image loading (real PNG drop) ----------
  function fileToCanvas(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cap = Math.max(32, state.opts.inputCap | 0);
      let w = img.naturalWidth, h = img.naturalHeight;
      const sc = Math.min(1, cap / Math.max(w, h));
      w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cb(cv, file.name);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen'); };
    img.src = url;
  }
  function loadImageFile(file) {
    fileToCanvas(file, (cv, name) => {
      addItem(name, cv, 'done', true);
      toast([{ accent: name }, { text: ' cargado' }]);
    });
  }

  // ---------- frame UI ----------
  function updateFrameUI() {
    const total = frameCount(state.sheet);
    const row = $('frameRow');
    if (total > 1) {
      row.style.display = '';
      $('vFrame').textContent = (state.sheet.frame + 1) + ' / ' + total;
    } else {
      row.style.display = 'none';
    }
  }

  function setBatchProgress(visible, done, total, label) {
    state.batchProgress = { visible, done, total, label };
    $('batchProgress').hidden = !visible;
    $('cancelBatchBtn').hidden = !visible;
    $('cancelBatchBtn').disabled = !state.batchBusy;
    $('batchProgressLabel').textContent = label || 'Preparando lote…';
    $('batchProgressCount').textContent = total ? `${done} / ${total}` : '0 / 0';
    $('batchProgressBar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function refreshActionState() {
    $('exportBtn').disabled = !state.last || state.busy || state.batchBusy;
    $('exportBatchBtn').disabled = !items.length || state.batchBusy;
    $('cancelBatchBtn').disabled = !state.batchBusy;
    updateMatchProfileAction();
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(name, blob);
  }
  function downloadBlob(name, blob) {
    downloadHistory.push({ name, blob, bytes: blob.parts ? blob.parts[0] : null });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function baseName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '');
  }
  function collectResultFiles(base, result, wantObj, wantVox, wantGlb, wantFbx, opts = state.opts) {
    const files = [];
    if (wantObj) {
      const { obj, mtl } = VoxIO.exportOBJ(result, {
        scale: opts.scale,
        useAO: opts.ao,
        aoStrength: opts.aoStrength,
        annotateAO: Voxel.annotateAO,
        mtlName: base + '.mtl',
      });
      files.push({ name: base + '.obj', data: obj, type: 'text/plain' });
      files.push({ name: base + '.mtl', data: mtl, type: 'text/plain' });
    }
    if (wantVox) {
      const bytes = VoxIO.exportVox(result);
      files.push({ name: base + '.vox', data: bytes, type: 'application/octet-stream' });
    }
    if (wantGlb) {
      const bytes = VoxIO.exportGLB(result, {
        scale: opts.scale,
        useAO: opts.ao,
        aoStrength: opts.aoStrength,
        annotateAO: Voxel.annotateAO,
      });
      files.push({ name: base + '.glb', data: bytes, type: 'application/octet-stream' });
    }
    if (wantFbx) {
      const text = VoxIO.exportFBX(result, { scale: opts.scale });
      files.push({ name: base + '.fbx', data: text, type: 'text/plain' });
    }
    return files;
  }

  function exportResultFiles(base, result, wantObj, wantVox, wantGlb, wantFbx, opts = state.opts) {
    const files = collectResultFiles(base, result, wantObj, wantVox, wantGlb, wantFbx, opts);
    files.forEach(file => downloadBlob(file.name, new Blob([file.data], { type: file.type })));
    return files.length;
  }

  function batchZipName(totalJobs) {
    const now = new Date();
    const pad = v => String(v).padStart(2, '0');
    return `voxelizer-batch-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${totalJobs}jobs.zip`;
  }

  function createBatchManifest(sourceItems, opts, sheet) {
    return VoxelBatch.createManifest(sourceItems, opts, sheet, {
      readPixels: Voxel.canvasToPixels,
      clone: VoxelTransfer.clone,
      alignmentFor: ensureRecordAlignment,
    });
  }

  function cancelBatchExport() {
    if (!state.batchBusy) return;
    state.batchCancelRequested = true;
    $('statMain').textContent = 'Cancelando lote…';
    setBatchProgress(true, state.batchProgress.done, state.batchProgress.total, 'Cancelando lote…');
    batchWorker.dispose('cancelled');
  }

  async function exportBatch() {
    if (!items.length) { toast('No hay sprites cargados para exportar'); return; }
    if (state.batchBusy) { toast('Ya hay un batch en curso'); return; }
    const wantObj = $('fmtObj').classList.contains('on');
    const wantVox = $('fmtVox').classList.contains('on');
    const wantGlb = $('fmtGlb').classList.contains('on');
    const wantFbx = $('fmtFbx').classList.contains('on');
    if (!wantObj && !wantVox && !wantGlb && !wantFbx) { toast('Selecciona al menos un formato'); return; }
    if (!window.ZipUtil || typeof window.ZipUtil.createZip !== 'function') {
      throw new Error('No se pudo inicializar el empaquetado ZIP');
    }
    cancelPreviewJob('stale');
    const batchOpts = cloneOpts();
    const batchSheet = { ...state.sheet };
    const manifest = createBatchManifest(items, batchOpts, batchSheet);
    const totalJobs = manifest.totalJobs;
    let finished = 0, files = 0, failures = 0;
    const archiveFiles = [];
    const outputState = { bytes: 0, maxBytes: VoxelBatch.MAX_BATCH_OUTPUT_BYTES };
    let cancelled = false;
    let failed = false;
    state.batchBusy = true;
    state.batchCancelRequested = false;
    items.forEach(rec => setItemStatus(rec, 'queued'));
    $('statMain').textContent = `Exportando lote 0/${totalJobs}`;
    setBatchProgress(true, 0, totalJobs, 'Preparando lote…');
    refreshActionState();
    try {
      const progress = VoxelBatch.setProgressTotals(VoxelBatch.createProgress(manifest), manifest.totalFrames);
      for (let jobIndex = 0; jobIndex < manifest.totalJobs; jobIndex++) {
          const job = VoxelBatch.jobAt(manifest, jobIndex);
          const rec = job.record, frame = job.frame, totalFrames = job.totalFrames;
          const recordProgress = progress[job.recordIndex];
          if (recordProgress.processed === 0) setItemStatus(rec, 'progress', totalFrames > 1 ? `0/${totalFrames}` : 'PROC');
          if (state.batchCancelRequested) throw new Error('cancelled');
          const suffix = totalFrames > 1 ? frameLabel(frame, totalFrames) : '';
          const exportName = job.archiveBase + suffix;
          try {
            const result = await spawnVoxelTask(job.pixels, job.opts, job.views);
            const outFiles = collectResultFiles(exportName, result, wantObj, wantVox, wantGlb, wantFbx, job.opts);
            VoxelBatch.appendOutput(archiveFiles, outFiles, outputState);
            files += outFiles.length;
            VoxelBatch.markProgress(progress, job.recordIndex, true);
          } catch (error) {
            if (error.message === 'cancelled') throw error;
            if (error.code === 'BATCH_OUTPUT_BUDGET_EXCEEDED') throw error;
            failures++;
            VoxelBatch.markProgress(progress, job.recordIndex, false);
            console.error(error);
          }
          const current = progress[job.recordIndex];
          if (current.status === 'done') setItemStatus(rec, 'done');
          else if (current.status === 'failed') setItemStatus(rec, 'err', `${current.succeeded}/${current.total}`);
          else setItemStatus(rec, 'progress', totalFrames > 1 ? `${current.processed}/${totalFrames}` : 'PROC');
          finished++;
          $('statMain').textContent = `Exportando lote ${finished}/${totalJobs}`;
          setBatchProgress(true, finished, totalJobs, job.name);
      }
      if (!archiveFiles.length) {
        throw new Error('El batch no generó archivos exportables');
      }
      const zipName = batchZipName(totalJobs);
      const zipBytes = window.ZipUtil.createZip(archiveFiles);
      downloadBlob(zipName, new Blob([zipBytes], { type: 'application/zip' }));
      if (failures) {
        toast([{ text: `Batch listo con ${failures} error(es) · ZIP: ` }, { accent: zipName }, { text: ` · archivos: ${files}` }]);
      } else {
        toast([{ text: 'Batch exportado en ' }, { accent: zipName }, { text: ` · archivos: ${files}` }]);
      }
    } catch (error) {
      if (error.message !== 'cancelled') {
        failed = true;
        throw error;
      }
      cancelled = true;
      toast('Batch cancelado');
    } finally {
      state.batchBusy = false;
      state.batchCancelRequested = false;
      setBatchProgress(false, 0, 0, 'Listo');
      refreshActionState();
      $('statMain').textContent = VoxelBatch.terminalLabel({ cancelled, failed, failures });
    }
  }

  // ---------- toast ----------
  let toastT = 0;
  function toast(parts) {
    const t = $('toast');
    const list = Array.isArray(parts) ? parts : [{ text: String(parts) }];
    t.replaceChildren();
    list.forEach(part => {
      if (part.accent) {
        const strong = document.createElement('b');
        strong.textContent = part.accent;
        t.appendChild(strong);
      }
      if (part.text) t.appendChild(document.createTextNode(part.text));
    });
    t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ================= WIRE UP CONTROLS =================
  function setDisabled(ids, disabled) {
    ids.forEach(id => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
  }
  function syncRange(id, value, valId, fmt) {
    const el = $(id);
    if (!el) return;
    el.value = value;
    if (valId) $(valId).textContent = fmt ? fmt(value) : value;
  }
  function syncToggle(id, on) {
    setPressed($(id), on);
  }
  function syncMeshControls() {
    syncToggle('greedy', state.opts.greedy);
    $('greedyState').textContent = state.opts.greedy ? 'activado' : 'desactivado';
    $('greedyState').style.color = state.opts.greedy ? 'var(--sel)' : 'var(--dim)';
    syncToggle('ao', state.opts.ao);
    $('aoRow').style.display = state.opts.ao ? '' : 'none';
    $('aoStr').style.display = state.opts.ao ? '' : 'none';
    $('aoStr').disabled = !state.opts.ao;
    syncRange('aoStr', Math.round(state.opts.aoStrength * 100), 'vAoStr', v => v + '%');
    syncRange('scale', Math.round(state.opts.scale * 10), 'vScale', v => (v / 10).toFixed(1));
  }
  function syncHumanoidControls() {
    syncRange('humTorso', Math.round(state.opts.humTorso * 100), 'vHumTorso', v => v + '%');
    syncRange('humRound', Math.round(state.opts.humRound * 100), 'vHumRound', v => v + '%');
    syncRange('humPrior', Math.round(state.opts.humPrior * 100), 'vHumPrior', v => v + '%');
    syncRange('humHead', Math.round(state.opts.humHead * 100), 'vHumHead', v => v + '%');
    syncRange('humSmooth', Math.round(state.opts.humSmooth * 100), 'vHumSmooth', v => v + '%');
  }
  function syncMaterialControls() {
    syncToggle('materialAwareness', state.opts.materialAwareness);
    syncRange('materialTolerance', Math.round(state.opts.materialTolerance), 'vMaterialTolerance');
    syncRange('materialStrength', Math.round(state.opts.materialStrength * 100), 'vMaterialStrength', v => v + '%');
    setDisabled(['materialTolerance', 'materialStrength'], !state.opts.materialAwareness);
  }
  function clearAlignmentPreview(kind, message) {
    const canvas = $(kind + 'AlignPreview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#151821';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
    $(kind + 'AlignMeta').textContent = message;
  }
  function drawAlignmentPreview(kind) {
    const diagnosticView = state.last && state.last.diagnostics && state.last.diagnostics.views
      ? state.last.diagnostics.views.find(view => view.role === kind && view.id === state.diagnosticViewIds[kind])
        || state.last.diagnostics.views.find(view => view.role === kind) : null;
    const debug = diagnosticView && state.last.debug && state.last.debug.views ? state.last.debug.views[diagnosticView.id] : null;
    const label = kind === 'side' ? 'perfil' : 'cenital';
    if (!state.views[kind]) {
      clearAlignmentPreview(kind, `Sin vista ${label} cargada.`);
      return;
    }
    if (!debug || !debug.mask) {
      clearAlignmentPreview(kind, `Esperando previsualización alineada de ${label}.`);
      return;
    }
    const canvas = $(kind + 'AlignPreview');
    const ctx = canvas.getContext('2d');
    canvas.width = debug.w;
    canvas.height = debug.h;
    ctx.clearRect(0, 0, debug.w, debug.h);
    ctx.fillStyle = '#11141c';
    ctx.fillRect(0, 0, debug.w, debug.h);
    for (let y = 0; y < debug.h; y++) {
      for (let x = 0; x < debug.w; x++) {
        const i = x + debug.w * y;
        if (debug.materialOverlay && debug.materialOverlay[i]) {
          const materialState = debug.materialOverlay[i];
          ctx.fillStyle = materialState === 1 ? '#6de2a0' : (materialState === 2 ? '#ff6b6b' : '#d56dff');
        } else if (debug.overlay) {
          const state = debug.overlay[i];
          if (!state) continue;
          ctx.fillStyle = state === 1 ? '#6de2e1' : (state === 2 ? '#ff9b54' : '#d56dff');
        } else {
          if (!debug.mask[i]) continue;
          ctx.fillStyle = '#6de2e1';
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if (debug.bounds) {
      ctx.strokeStyle = '#ff9b54';
      ctx.lineWidth = 1;
      ctx.strokeRect(debug.bounds.minX + 0.5, debug.bounds.minY + 0.5, debug.bounds.width, debug.bounds.height);
    }
    const b = debug.bounds;
    const summary = b
      ? `${debug.id} · BBox ${b.width}x${b.height} · IoU ${debug.iou == null ? '—' : (debug.iou * 100).toFixed(0) + '%'} · material ${debug.material && debug.material.compatibility != null ? (debug.material.compatibility * 100).toFixed(0) + '%' : '—'} · residual ${debug.residual == null ? '—' : (debug.residual * 100).toFixed(0) + '%'} · off ${debug.transform.offsetX}/${debug.transform.offsetY}`
      : 'Sin silueta útil tras la transformación.';
    $(kind + 'AlignMeta').textContent = summary;
  }
  function syncAlignmentControls(kind) {
    const hasView = !!state.views[kind];
    const align = alignRef(kind);
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    syncToggle(kind + 'AutoFit', !!align.autoFit);
    syncToggle(kind + 'FlipX', !!align.flipX);
    syncRange(kind + 'OffsetX', Math.round(align.offsetX), 'v' + cap + 'OffsetX', v => (v > 0 ? '+' : '') + v);
    syncRange(kind + 'OffsetY', Math.round(align.offsetY), 'v' + cap + 'OffsetY', v => (v > 0 ? '+' : '') + v);
    syncRange(kind + 'Scale', Math.round(align.scale * 100), 'v' + cap + 'Scale', v => v + '%');
    syncRange(kind + 'Rotation', Math.round(align.rotation), 'v' + cap + 'Rotation', v => v + '°');
    setDisabled([
      kind + 'AutoFit',
      kind + 'FlipX',
      kind + 'OffsetX',
      kind + 'OffsetY',
      kind + 'Scale',
      kind + 'Rotation',
      kind + 'Center',
      kind + 'Reset',
    ], !hasView);
    drawAlignmentPreview(kind);
  }
  function updateAlignmentViews() {
    syncAlignmentControls('side');
    syncAlignmentControls('top');
  }
  function slider(id, valId, fn, fmt, trigger = true) {
    const el = $(id);
    el.addEventListener('input', () => {
      fn(+el.value);
      if (valId) $(valId).textContent = fmt ? fmt(+el.value) : el.value;
      if (trigger) recompute();
    });
  }
  slider('depth', 'vDepth', v => state.opts.depth = v);
  $('matchProfileDepth').addEventListener('click', () => {
    const match = updateMatchProfileAction();
    if (match.disabled) return;
    state.opts.depth = match.depth;
    syncRange('depth', match.depth, 'vDepth');
    recompute();
  });
  slider('alpha', 'vAlpha', v => state.opts.alpha = v);
  slider('colors', 'vColors', v => state.opts.colors = v);
  slider('scale', 'vScale', v => state.opts.scale = v / 10, v => (v / 10).toFixed(1));
  slider('inputCap', 'vInputCap', v => state.opts.inputCap = v, v => `${v} px`, false);

  function toggle(id, fn) {
    const el = $(id);
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      setPressed(el, on);
      fn(on);
      recompute();
    });
  }
  toggle('greedy', on => {
    state.opts.greedy = on;
    $('greedyState').textContent = on ? 'activado' : 'desactivado';
    $('greedyState').style.color = on ? 'var(--sel)' : 'var(--dim)';
  });
  toggle('ao', on => {
    state.opts.ao = on;
    $('aoRow').style.display = on ? '' : 'none';
    $('aoStr').style.display = on ? '' : 'none';
    $('aoStr').disabled = !on;
  });
  slider('aoStr', 'vAoStr', v => state.opts.aoStrength = v / 100, v => v + '%');
  toggle('silhouetteEnabled', on => state.opts.silhouetteEnabled = on);
  toggle('inferenceEnabled', on => state.opts.inferenceEnabled = on);
  toggle('inferenceBack', on => state.opts.inferenceBack = on);
  slider('denoiseRadius', 'vDenoiseRadius', v => state.opts.denoiseRadius = v, v => `${v} px`);
  slider('closeRadius', 'vCloseRadius', v => state.opts.closeRadius = v, v => `${v} px`);
  slider('feather', 'vFeather', v => state.opts.feather = v / 100, v => `${v}%`);
  $('resampling').addEventListener('change', () => { state.opts.resampling = $('resampling').value; recompute(); });
  toggle('hardFrontConstraint', on => state.opts.hardFrontConstraint = on);
  toggle('materialAwareness', on => { state.opts.materialAwareness = on; syncMaterialControls(); });
  slider('materialTolerance', 'vMaterialTolerance', v => state.opts.materialTolerance = v);
  slider('materialStrength', 'vMaterialStrength', v => state.opts.materialStrength = v / 100, v => `${v}%`);
  toggle('invertDepthMap', on => state.opts.invertDepthMap = on);
  toggle('localWidthAware', on => state.opts.localWidthAware = on);
  [['sideFollowsSheet', 'side'], ['topFollowsSheet', 'top'], ['depthMapFollowsSheet', 'depthMap']].forEach(([id, kind]) => {
    toggle(id, on => {
      const rec = activeRecord();
      if (!rec) return;
      if (!rec.viewMetadata) rec.viewMetadata = {};
      rec.viewMetadata[kind] = { frameMode: on ? 'sheet' : 'static' };
      if (kind === 'side') updateMatchProfileAction();
    });
  });
  slider('reconThreshold', 'vReconThreshold', v => state.opts.reconstructionThreshold = v / 100, v => `${v}%`);
  slider('edgeTolerance', 'vEdgeTolerance', v => state.opts.edgeTolerance = v / 100, v => `${v}%`);
  slider('frontWeight', 'vFrontWeight', v => state.opts.frontWeight = v / 100, v => `${v}%`);
  slider('sideWeight', 'vSideWeight', v => state.opts.sideWeight = v / 100, v => `${v}%`);
  slider('topWeight', 'vTopWeight', v => state.opts.topWeight = v / 100, v => `${v}%`);
  slider('frontRatio', 'vFrontRatio', v => state.opts.frontRatio = v / 100, v => `${v}%`);
  slider('depthMapStrength', 'vDepthMapStrength', v => state.opts.depthMapStrength = v / 100, v => `${v}%`);
  [...$('reconstructionModeSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.reconstructionMode = button.dataset.reconstruction;
    [...$('reconstructionModeSeg').children].forEach(item => item.classList.toggle('on', item === button));
    recompute();
  }));
  [...$('depthVolumeSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.depthVolumeMode = button.dataset.volume;
    [...$('depthVolumeSeg').children].forEach(item => item.classList.toggle('on', item === button));
    recompute();
  }));
  [...$('colorModeSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.colorMode = button.dataset.color;
    [...$('colorModeSeg').children].forEach(item => item.classList.toggle('on', item === button));
    $('colorPolicyControls').style.display = button.dataset.color === 'auxiliary' ? '' : 'none';
    recompute();
  }));
  [...$('colorSideSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.colorSide = button.dataset.side;
    [...$('colorSideSeg').children].forEach(item => item.classList.toggle('on', item === button));
    recompute();
  }));
  [...$('colorBackSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.colorBack = button.dataset.back;
    [...$('colorBackSeg').children].forEach(item => item.classList.toggle('on', item === button));
    recompute();
  }));
  slider('darken', 'vDarken', v => state.opts.darken = v / 100, v => `${v}%`);
  [...$('lodSeg').children].forEach(button => button.addEventListener('click', () => {
    state.opts.lod = button.dataset.lod;
    [...$('lodSeg').children].forEach(item => item.classList.toggle('on', item === button));
    recompute();
  }));

  // depth mode (segmented) + relief strength
  const MODE_HINT = {
    uniform: 'Plano: extrusión uniforme, grosor constante.',
    dt: 'Distance transform: el grosor sigue el contorno real (miembros finos se abomban menos).',
    poisson: 'Poisson: globo suave, sin la cresta del eje medial.',
    sfs: 'Shape-from-shading: usa la luminancia que pintó el artista como relieve.',
    combo: 'Combo: bulto del distance transform modulado por la sombra. Recomendado.',
    humanoid: 'Humanoide: detecta cabeza/torso/miembros (bandas + forma) y aplica sección anatómica. Profundidad creíble sin vista de perfil.',
  };
  // per-mode contextual parameter (one slider, meaning changes with the mode)
  const PARAM = {
    dt:      { label: 'Redondez',        min: 0,  max: 100, def: 100, set: v => state.opts.dtRound = v / 100,        fmt: v => v + '%' },
    poisson: { label: 'Tensión',         min: 0,  max: 100, def: 0,   set: v => state.opts.poissonTension = v / 100, fmt: v => v + '%' },
    sfs:     { label: 'Contraste',       min: 50, max: 250, def: 100, set: v => state.opts.sfsGamma = v / 100,       fmt: v => (v / 100).toFixed(2) },
    combo:   { label: 'Mezcla DT↔luz',   min: 0,  max: 100, def: 50,  set: v => state.opts.comboMix = v / 100,       fmt: v => v + '%' },
  };
  function setMode(mode, trigger = true) {
    state.opts.depthMode = mode;
    [...$('depthModeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const show = mode !== 'uniform';
    $('reliefRow').style.display = show ? '' : 'none';
    $('relief').style.display = show ? '' : 'none';
    $('humPanel').style.display = mode === 'humanoid' ? '' : 'none';
    $('relief').disabled = !show;
    setDisabled(['humTorso', 'humRound', 'humPrior', 'humHead', 'humSmooth'], mode !== 'humanoid');
    $('modeHint').textContent = MODE_HINT[mode] || '';
    const cfg = PARAM[mode];
    if (cfg) {
      const s = $('modeParam');
      s.min = cfg.min; s.max = cfg.max; s.value = cfg.def; cfg.set(cfg.def);
      $('paramLbl').textContent = cfg.label; $('vParam').textContent = cfg.fmt(cfg.def);
      $('paramRow').style.display = ''; s.style.display = '';
      s.disabled = false;
    } else {
      $('paramRow').style.display = 'none'; $('modeParam').style.display = 'none';
      $('vParam').textContent = '—';
      $('modeParam').disabled = true;
    }
    if (!cfg) $('paramLbl').textContent = 'Parámetro';
    if (trigger) recompute();
  }
  [...$('depthModeSeg').children].forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  slider('relief', 'vRelief', v => state.opts.relief = v / 100, v => v + '%');
  $('modeParam').addEventListener('input', () => {
    const cfg = PARAM[state.opts.depthMode]; if (!cfg) return;
    const v = +$('modeParam').value; cfg.set(v); $('vParam').textContent = cfg.fmt(v); recompute();
  });
  // humanoid parameters (live)
  slider('humTorso', 'vHumTorso', v => state.opts.humTorso = v / 100, v => v + '%');
  slider('humRound', 'vHumRound', v => state.opts.humRound = v / 100, v => v + '%');
  slider('humPrior', 'vHumPrior', v => state.opts.humPrior = v / 100, v => v + '%');
  slider('humHead', 'vHumHead', v => state.opts.humHead = v / 100, v => v + '%');
  slider('humSmooth', 'vHumSmooth', v => state.opts.humSmooth = v / 100, v => v + '%');
  $('resetDepthProfile').addEventListener('click', () => {
    state.opts.depthMode = defaultOpts.depthMode;
    state.opts.relief = defaultOpts.relief;
    state.opts.dtRound = defaultOpts.dtRound;
    state.opts.poissonTension = defaultOpts.poissonTension;
    state.opts.sfsGamma = defaultOpts.sfsGamma;
    state.opts.comboMix = defaultOpts.comboMix;
    syncRange('relief', Math.round(state.opts.relief * 100), 'vRelief', v => v + '%');
    setMode(state.opts.depthMode);
  });
  $('resetHumanoid').addEventListener('click', () => {
    state.opts.humTorso = defaultOpts.humTorso;
    state.opts.humRound = defaultOpts.humRound;
    state.opts.humPrior = defaultOpts.humPrior;
    state.opts.humHead = defaultOpts.humHead;
    state.opts.humSmooth = defaultOpts.humSmooth;
    syncHumanoidControls();
    if (state.opts.depthMode === 'humanoid') recompute();
  });
  $('resetMesh').addEventListener('click', () => {
    state.opts.greedy = defaultOpts.greedy;
    state.opts.ao = defaultOpts.ao;
    state.opts.aoStrength = defaultOpts.aoStrength;
    state.opts.scale = defaultOpts.scale;
    syncMeshControls();
    recompute();
  });
  [['side', 'Side'], ['top', 'Top']].forEach(([kind, cap]) => {
    toggle(kind + 'AutoFit', on => {
      const align = alignRef(kind);
      align.autoFit = on;
      if (on) {
        align.offsetX = 0;
        align.offsetY = 0;
        align.scale = 1;
        align.rotation = 0;
      }
      syncAlignmentControls(kind);
    });
    toggle(kind + 'FlipX', on => {
      alignRef(kind).flipX = on;
      syncAlignmentControls(kind);
    });
    slider(kind + 'OffsetX', 'v' + cap + 'OffsetX', v => {
      alignRef(kind).offsetX = v;
      syncAlignmentControls(kind);
    }, v => (v > 0 ? '+' : '') + v);
    slider(kind + 'OffsetY', 'v' + cap + 'OffsetY', v => {
      alignRef(kind).offsetY = v;
      syncAlignmentControls(kind);
    }, v => (v > 0 ? '+' : '') + v);
    slider(kind + 'Scale', 'v' + cap + 'Scale', v => {
      alignRef(kind).scale = v / 100;
      syncAlignmentControls(kind);
    }, v => v + '%');
    slider(kind + 'Rotation', 'v' + cap + 'Rotation', v => {
      alignRef(kind).rotation = v;
      syncAlignmentControls(kind);
    }, v => v + '°');
    $(kind + 'Center').addEventListener('click', () => {
      const align = alignRef(kind);
      align.offsetX = 0;
      align.offsetY = 0;
      syncAlignmentControls(kind);
      recompute();
    });
    $(kind + 'Reset').addEventListener('click', () => {
      state.opts.alignment[kind] = cloneData(defaultAlignment[kind]);
      syncAlignmentControls(kind);
      recompute();
    });
  });

  // sheet inputs
  function sheetChange() {
    state.sheet.c = Math.max(1, Math.min(16, +$('sheetC').value || 1));
    state.sheet.r = Math.max(1, Math.min(16, +$('sheetR').value || 1));
    state.sheet.frame = 0;
    updateFrameUI(); updateMatchProfileAction(); run();
  }
  $('sheetC').addEventListener('change', sheetChange);
  $('sheetR').addEventListener('change', sheetChange);
  $('framePrev').addEventListener('click', () => { const t = state.sheet.c * state.sheet.r; state.sheet.frame = (state.sheet.frame - 1 + t) % t; updateFrameUI(); updateMatchProfileAction(); run(); });
  $('frameNext').addEventListener('click', () => { const t = state.sheet.c * state.sheet.r; state.sheet.frame = (state.sheet.frame + 1) % t; updateFrameUI(); updateMatchProfileAction(); run(); });

  // format checkboxes
  function chk(id) {
    const el = $(id);
    el.addEventListener('click', () => setPressed(el, !el.classList.contains('on')));
  }
  chk('fmtVox'); chk('fmtObj'); chk('fmtGlb'); chk('fmtFbx');
  // Default all export formats to enabled (matches the `class="chk on"` markup).
  setPressed($('fmtVox'), true);
  setPressed($('fmtObj'), true);
  setPressed($('fmtGlb'), true);
  setPressed($('fmtFbx'), true);

  // viewport toolbar
  $('btnRotate').addEventListener('click', () => {
    cameraController.setAutoRotate(!cameraController.autoRotatePreference);
    syncCameraUi();
  });
  document.querySelectorAll('[data-camera-mode]').forEach(button => button.addEventListener('click', () => setCameraMode(button.dataset.cameraMode)));
  $('btnGrid').addEventListener('click', e => { state.showGrid = !state.showGrid; grid.visible = state.showGrid; setPressed(e.currentTarget, state.showGrid); });
  $('btnWire').addEventListener('click', e => { state.showWire = !state.showWire; if (wire) wire.visible = state.showWire; setPressed(e.currentTarget, state.showWire); });
  $('btnReset').addEventListener('click', resetCamera);

  // export
  $('exportBtn').addEventListener('click', () => {
    if (!state.last || state.busy) { toast('Esperá a que termine la voxelización actual'); return; }
    const wantObj = $('fmtObj').classList.contains('on');
    const wantVox = $('fmtVox').classList.contains('on');
    const wantGlb = $('fmtGlb').classList.contains('on');
    const wantFbx = $('fmtFbx').classList.contains('on');
    if (!wantObj && !wantVox && !wantGlb && !wantFbx) { toast('Selecciona al menos un formato'); return; }
    const base = baseName(state.name);
    const out = [];
    exportResultFiles(base, effectiveResult(), wantObj, wantVox, wantGlb, wantFbx);
    if (wantObj) out.push('.obj+.mtl');
    if (wantVox) out.push('.vox');
    if (wantGlb) out.push('.glb');
    if (wantFbx) out.push('.fbx');
    toast([{ text: 'Exportado ' }, { accent: base }, { text: ` → ${out.join(' · ')}` }]);
  });

  // palette editor
  $('importPaletteBtn').addEventListener('click', () => $('paletteFileInput').click());
  $('exportPaletteGplBtn').addEventListener('click', () => {
    if (!state.paletteEdit) { toast('No hay paleta para exportar'); return; }
    const base = baseName(state.name);
    triggerDownload(`${base}.gpl`, exportPaletteFile('gpl'));
  });
  $('exportPalettePalBtn').addEventListener('click', () => {
    if (!state.paletteEdit) { toast('No hay paleta para exportar'); return; }
    const base = baseName(state.name);
    triggerDownload(`${base}.pal`, exportPaletteFile('pal'));
  });
  $('resetPaletteBtn').addEventListener('click', () => resetPaletteEdit());
  $('paletteFileInput').addEventListener('change', () => {
    const f = $('paletteFileInput').files[0];
    if (!f) return;
    const ext = f.name.toLowerCase().endsWith('.pal') ? 'pal' : 'gpl';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importPaletteFile(String(reader.result), ext);
        toast('Paleta importada');
      } catch (error) {
        toast(error.message || 'No se pudo importar la paleta');
      }
    };
    reader.onerror = () => toast('No se pudo leer el archivo de paleta');
    reader.readAsText(f);
    $('paletteFileInput').value = '';
  });
  $('cancelBatchBtn').addEventListener('click', cancelBatchExport);
  $('exportBatchBtn').addEventListener('click', () => { exportBatch().catch(err => {
    console.error(err);
    state.batchBusy = false;
    state.batchCancelRequested = false;
    setBatchProgress(false, 0, 0, 'Listo');
    refreshActionState();
    toast(err.message || 'No se pudo exportar el batch');
  }); });

  // drop + file picker
  const drop = $('drop'), fileIn = $('file');
  drop.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { [...fileIn.files].forEach(loadImageFile); fileIn.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { [...e.dataTransfer.files].filter(f => f.type.startsWith('image')).forEach(loadImageFile); });

  // multi-view slot pickers (+ drag-drop onto a slot)
  const SLOT_BINDINGS = [
    ['slotBack', 'back', 'fileBack'],
    ['slotLeft', 'left', 'fileLeft'],
    ['slotRight', 'right', 'fileRight'],
    ['slotSide', 'side', 'fileSide'],
    ['slotTop', 'top', 'fileTop'],
    ['slotDepth', 'depthMap', 'fileDepth'],
  ];
  for (const [slotId, kind, fileId] of SLOT_BINDINGS) {
    const slot = $(slotId);
    const fileInput = $(fileId);
    if (!slot || !fileInput) continue;
    bindPseudoButton(slot, () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (f) fileToCanvas(f, cv => setView(kind, cv));
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev => slot.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); slot.style.borderColor = 'var(--sel)'; }));
    ['dragleave', 'drop'].forEach(ev => slot.addEventListener(ev, e => { e.preventDefault(); slot.style.borderColor = ''; }));
    slot.addEventListener('drop', e => { e.stopPropagation(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image')); if (f) fileToCanvas(f, cv => setView(kind, cv)); });
  }
  // allow dropping anywhere on the window
  const win = document.querySelector('.window');
  ['dragover'].forEach(ev => win.addEventListener(ev, e => e.preventDefault()));
  win.addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].filter(f => f.type.startsWith('image')).forEach(loadImageFile); });

  // ---------- boot: render sample sprites ----------
  function boot() {
    setBatchProgress(false, 0, 0, 'Listo');
    refreshActionState();
    updateMatchProfileAction();
    setCameraMode('perspective');
    resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 120);
    SAMPLE_SPRITES.forEach((sp, i) => {
      const nat = sp.draw(sp.size); // voxelize at native sprite resolution
      addItem(sp.name, nat, 'queued', i === 0);
    });
  }

  window.__dbg = {
    scene,
    get camera() { return cameraController.activeCamera; },
    perspectiveCamera,
    orthographicCamera,
    cameraController,
    controls,
    get mesh() { return mesh; },
    get wire() { return wire; },
    modelGroup,
    renderer,
    setCameraMode,
    state,
    buildModel,
    invalidatePreviewEvidence,
    refreshActionState,
    addItem,
    removeItem,
    getItemViews,
    get items() { return items; },
    baseName,
    initPaletteEdit,
    buildPreview,
    resetPaletteEdit,
    effectiveResult,
    editPaletteColor,
    editSurfaceMaterial,
    reorderPaletteColor,
    mergePaletteColors,
    importPaletteFile,
    exportPaletteFile,
    updateSwatches,
    selectMergeSource,
    collectResultFiles,
    exportBatch,
    downloadHistory,
  };

  // wait for fonts/three then boot
  if (typeof THREE === 'undefined') {
    document.getElementById('statMain').textContent = 'Error: Three.js no cargó';
  } else {
    syncHumanoidControls();
    syncMeshControls();
    syncMaterialControls();
    syncCameraUi();
    updateAlignmentViews();
    setMode(state.opts.depthMode, false);
    boot();
  }
})();
