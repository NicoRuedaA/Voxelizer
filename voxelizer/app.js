/* app.js — Three.js scene + UI wiring for the Voxelizer prototype.
   Depends on globals: THREE, THREE.OrbitControls, SAMPLE_SPRITES, Voxel. */
(function () {
  'use strict';

  // ---------- state ----------
  const state = {
    pixels: null,        // current {w,h,data} (single frame, after sheet slice)
    sourceCanvas: null,  // full source canvas (pre-slice)
    name: '—',
    opts: { depth: 6, alpha: 40, colors: 32, greedy: true, depthMode: 'uniform', relief: 1.0, scale: 1.0,
            dtRound: 1.0, poissonTension: 0.0, sfsGamma: 1.0, comboMix: 0.5, ao: false, aoStrength: 0.8,
            humTorso: 0.6, humRound: 1.0, humPrior: 0.4, humHead: 0.25, humSmooth: 0.3 },
    sheet: { c: 1, r: 1, frame: 0 },
    views: { side: null, top: null },   // canvases opcionales para la vista actual
    showWire: false, showGrid: false, autoRotate: true,
    last: null,          // last voxelize() result
  };

  // ---------- three setup ----------
  const host = document.getElementById('three');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);
  camera.position.set(60, 55, 90);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
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

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  // ---------- shading ----------
  const L = (() => { const v = new THREE.Vector3(0.45, 0.85, 0.55); v.normalize(); return v; })();
  function shade(n) {
    const d = Math.max(0, n[0] * L.x + n[1] * L.y + n[2] * L.z);
    return 0.42 + 0.58 * d;
  }

  // ---------- build geometry from faces ----------
  function buildModel(result) {
    if (mesh) { modelGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
    if (wire) { modelGroup.remove(wire); wire.geometry.dispose(); wire.material.dispose(); wire = null; }

    const faces = state.opts.greedy ? result.greedyFacesList : (result.naiveFacesList || result.greedyFacesList);
    const pal = result.palette;
    if (state.opts.ao && result.grid) Voxel.annotateAO(faces, result.grid, result.dims, state.opts.aoStrength);

    const pos = [], col = [], idx = [];
    const wpos = [];
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
      // wire edges (4 sides of quad)
      for (let k = 0; k < 4; k++) {
        const a = c[k], d = c[(k + 1) % 4];
        wpos.push(a[0], a[1], a[2], d[0], d[1], d[2]);
      }
      vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(geo, mat);
    modelGroup.add(mesh);

    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    const wmat = new THREE.LineBasicMaterial({ color: 0x0a0c0f, transparent: true, opacity: 0.55 });
    wire = new THREE.LineSegments(wgeo, wmat);
    wire.visible = state.showWire;
    modelGroup.add(wire);

    // center the model at origin
    const [DX, DY, DZ] = result.dims;
    modelGroup.children.forEach(o => { o.position.set(-DX / 2, -DY / 2, -DZ / 2); });

    // scale group so the largest sprite dim ~= 44 units, regardless of sprite size
    const maxDim = Math.max(DX, DY);
    const k = 44 / maxDim;
    modelGroup.scale.setScalar(k);
  }

  // ---------- sheet slicing ----------
  function sliceFrame() {
    const src = state.sourceCanvas;
    if (!src) return null;
    const cols = state.sheet.c, rows = state.sheet.r;
    if (cols <= 1 && rows <= 1) { return Voxel.canvasToPixels(src); }
    const fw = Math.floor(src.width / cols), fh = Math.floor(src.height / rows);
    const total = cols * rows;
    state.sheet.frame = Math.max(0, Math.min(state.sheet.frame, total - 1));
    const fx = (state.sheet.frame % cols) * fw;
    const fy = Math.floor(state.sheet.frame / cols) * fh;
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    cv.getContext('2d').drawImage(src, fx, fy, fw, fh, 0, 0, fw, fh);
    return Voxel.canvasToPixels(cv);
  }

  // ---------- recompute (debounced to a frame) ----------
  let raf = 0;
  function recompute() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(run);
  }
  function run() {
    if (!state.sourceCanvas) return;
    state.pixels = sliceFrame();
    if (!state.pixels) return;
    const t0 = performance.now();
    const views = {};
    if (state.views.side) views.side = Voxel.canvasToPixels(state.views.side);
    if (state.views.top) views.top = Voxel.canvasToPixels(state.views.top);
    const result = Voxel.voxelize(state.pixels, state.opts, views);
    const ms = (performance.now() - t0);
    state.last = result;
    buildModel(result);
    updateReadouts(result, ms);
  }

  // ---------- readouts ----------
  const $ = id => document.getElementById(id);
  function fmt(n) { return n.toLocaleString('en-US'); }
  function updateReadouts(r, ms) {
    const g = state.opts.greedy ? r.greedyFacesList.length : (r.naiveFacesList ? r.naiveFacesList.length : r.greedyFacesList.length);
    $('stVox').textContent = fmt(r.voxels);
    $('stRaw').textContent = fmt(r.naiveCount);
    $('stGreedy').textContent = fmt(r.greedyFacesList.length);
    const red = r.naiveCount > 0 ? (100 * (1 - r.greedyFacesList.length / r.naiveCount)) : 0;
    $('stRed').textContent = '−' + red.toFixed(0) + '%';
    $('srcDims').textContent = `${state.pixels.w}×${state.pixels.h} px · ${r.dims[2]} capas Z`;
    $('palCount').textContent = r.palette.length + ' colores';
    $('statDims').innerHTML = `<b>${r.dims[0]}×${r.dims[1]}×${r.dims[2]}</b> grid`;
    $('statMain').textContent = `Voxelizado en ${ms.toFixed(0)} ms`;
    // swatches
    const sw = $('swatches'); sw.innerHTML = '';
    r.palette.slice(0, 28).forEach(c => {
      const i = document.createElement('i');
      i.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
      sw.appendChild(i);
    });
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
  function addItem(name, canvas, status = 'queued', select = false) {
    const el = document.createElement('div');
    el.className = 'item';
    const th = thumbCanvas(canvas);
    el.appendChild(th);
    const meta = document.createElement('div'); meta.className = 'meta';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = name;
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `${canvas.width}×${canvas.height}`;
    meta.appendChild(nm); meta.appendChild(sub);
    const st = document.createElement('span'); st.className = 'st ' + status; st.textContent = status === 'done' ? 'OK' : 'cola';
    el.appendChild(meta); el.appendChild(st);
    const rec = { name, canvas, el, st };
    el.onclick = () => selectItem(rec);
    document.getElementById('list').appendChild(el);
    items.push(rec);
    updateBatchCount();
    if (select) selectItem(rec);
    return rec;
  }
  function updateBatchCount() {
    document.getElementById('batchCount').textContent = items.length + (items.length === 1 ? ' item' : ' items');
  }
  function selectItem(rec) {
    items.forEach(it => it.el.classList.toggle('active', it === rec));
    state.sourceCanvas = rec.canvas;
    state.name = rec.name;
    state.sheet.frame = 0;
    state.views = { side: rec.side || null, top: rec.top || null };
    fillSlot('side', state.views.side);
    fillSlot('top', state.views.top);
    $('srcName').textContent = rec.name;
    rec.st.className = 'st done'; rec.st.textContent = 'OK';
    updateFrameUI();
    run();
  }

  // ---------- multi-view slots (side / top) ----------
  function fillSlot(kind, canvas) {
    const el = $(kind === 'side' ? 'slotSide' : 'slotTop');
    const label = kind === 'side' ? 'Perfil' : 'Cenital';
    el.innerHTML = '';
    if (canvas) {
      el.classList.add('set');
      el.appendChild(thumbCanvas(canvas, 46));
      const x = document.createElement('div'); x.className = 'vx'; x.textContent = '×';
      x.onclick = e => { e.stopPropagation(); setView(kind, null); };
      el.appendChild(x);
    } else {
      el.classList.remove('set');
      el.innerHTML = `${label}<span>+ añadir</span>`;
    }
  }
  function setView(kind, canvas) {
    const rec = items.find(it => it.canvas === state.sourceCanvas);
    if (rec) rec[kind] = canvas;
    state.views[kind] = canvas;
    fillSlot(kind, canvas);
    recompute();
  }

  // ---------- image loading (real PNG drop) ----------
  function fileToCanvas(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cap = 96;                       // cap native resolution for performance
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
    img.onerror = () => toast('No se pudo leer la imagen');
    img.src = url;
  }
  function loadImageFile(file) {
    fileToCanvas(file, (cv, name) => {
      addItem(name, cv, 'done', true);
      toast(`<b>${name}</b> cargado`);
    });
  }

  // ---------- frame UI ----------
  function updateFrameUI() {
    const total = state.sheet.c * state.sheet.r;
    const row = $('frameRow');
    if (total > 1) {
      row.style.display = '';
      $('vFrame').textContent = (state.sheet.frame + 1) + ' / ' + total;
    } else {
      row.style.display = 'none';
    }
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- toast ----------
  let toastT = 0;
  function toast(html) {
    const t = $('toast'); t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ================= WIRE UP CONTROLS =================
  function slider(id, valId, fn, fmt) {
    const el = $(id);
    el.addEventListener('input', () => { fn(+el.value); if (valId) $(valId).textContent = fmt ? fmt(+el.value) : el.value; recompute(); });
  }
  slider('depth', 'vDepth', v => state.opts.depth = v);
  slider('alpha', 'vAlpha', v => state.opts.alpha = v);
  slider('colors', 'vColors', v => state.opts.colors = v);
  slider('scale', 'vScale', v => state.opts.scale = v / 10, v => (v / 10).toFixed(1));

  function toggle(id, fn) {
    const el = $(id);
    el.addEventListener('click', () => { const on = el.classList.toggle('on'); fn(on); recompute(); });
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
  });
  slider('aoStr', 'vAoStr', v => state.opts.aoStrength = v / 100, v => v + '%');

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
  function setMode(mode) {
    state.opts.depthMode = mode;
    [...$('depthModeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const show = mode !== 'uniform';
    $('reliefRow').style.display = show ? '' : 'none';
    $('relief').style.display = show ? '' : 'none';
    $('humPanel').style.display = mode === 'humanoid' ? '' : 'none';
    $('modeHint').textContent = MODE_HINT[mode] || '';
    const cfg = PARAM[mode];
    if (cfg) {
      const s = $('modeParam');
      s.min = cfg.min; s.max = cfg.max; s.value = cfg.def; cfg.set(cfg.def);
      $('paramLbl').textContent = cfg.label; $('vParam').textContent = cfg.fmt(cfg.def);
      $('paramRow').style.display = ''; s.style.display = '';
    } else {
      $('paramRow').style.display = 'none'; $('modeParam').style.display = 'none';
    }
    recompute();
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

  // sheet inputs
  function sheetChange() {
    state.sheet.c = Math.max(1, Math.min(16, +$('sheetC').value || 1));
    state.sheet.r = Math.max(1, Math.min(16, +$('sheetR').value || 1));
    state.sheet.frame = 0;
    updateFrameUI(); run();
  }
  $('sheetC').addEventListener('change', sheetChange);
  $('sheetR').addEventListener('change', sheetChange);
  $('framePrev').addEventListener('click', () => { const t = state.sheet.c * state.sheet.r; state.sheet.frame = (state.sheet.frame - 1 + t) % t; updateFrameUI(); run(); });
  $('frameNext').addEventListener('click', () => { const t = state.sheet.c * state.sheet.r; state.sheet.frame = (state.sheet.frame + 1) % t; updateFrameUI(); run(); });

  // format checkboxes
  function chk(id) { const el = $(id); el.addEventListener('click', () => el.classList.toggle('on')); }
  chk('fmtVox'); chk('fmtObj');

  // viewport toolbar
  $('btnRotate').addEventListener('click', e => { state.autoRotate = !state.autoRotate; controls.autoRotate = state.autoRotate; e.currentTarget.classList.toggle('on', state.autoRotate); });
  $('btnGrid').addEventListener('click', e => { state.showGrid = !state.showGrid; grid.visible = state.showGrid; e.currentTarget.classList.toggle('on', state.showGrid); });
  $('btnWire').addEventListener('click', e => { state.showWire = !state.showWire; if (wire) wire.visible = state.showWire; e.currentTarget.classList.toggle('on', state.showWire); });
  $('btnReset').addEventListener('click', () => { camera.position.set(60, 55, 90); controls.target.set(0, 0, 0); });

  // export
  $('exportBtn').addEventListener('click', () => {
    if (!state.last) return;
    const wantObj = $('fmtObj').classList.contains('on');
    const wantVox = $('fmtVox').classList.contains('on');
    if (!wantObj && !wantVox) { toast('Selecciona al menos un formato'); return; }
    const base = state.name.replace(/\.[a-z0-9]+$/i, '');
    const out = [];
    if (wantObj) {
      const { obj, mtl } = VoxIO.exportOBJ(state.last, {
        scale: state.opts.scale,
        useAO: state.opts.ao,
        aoStrength: state.opts.aoStrength,
        annotateAO: Voxel.annotateAO,
        mtlName: base + '.mtl',
      });
      download(base + '.obj', obj);
      download(base + '.mtl', mtl);
      out.push('.obj+.mtl');
    }
    if (wantVox) {
      const bytes = VoxIO.exportVox(state.last);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = base + '.vox';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      out.push('.vox');
    }
    toast(`Exportado <b>${base}</b> → ${out.join(' · ')}`);
  });

  // drop + file picker
  const drop = $('drop'), fileIn = $('file');
  drop.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { [...fileIn.files].forEach(loadImageFile); fileIn.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { [...e.dataTransfer.files].filter(f => f.type.startsWith('image')).forEach(loadImageFile); });

  // multi-view slot pickers (+ drag-drop onto a slot)
  $('slotSide').addEventListener('click', () => $('fileSide').click());
  $('slotTop').addEventListener('click', () => $('fileTop').click());
  $('fileSide').addEventListener('change', () => { const f = $('fileSide').files[0]; if (f) fileToCanvas(f, cv => setView('side', cv)); $('fileSide').value = ''; });
  $('fileTop').addEventListener('change', () => { const f = $('fileTop').files[0]; if (f) fileToCanvas(f, cv => setView('top', cv)); $('fileTop').value = ''; });
  [['slotSide', 'side'], ['slotTop', 'top']].forEach(([id, kind]) => {
    const s = $(id);
    ['dragenter', 'dragover'].forEach(ev => s.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); s.style.borderColor = 'var(--sel)'; }));
    ['dragleave', 'drop'].forEach(ev => s.addEventListener(ev, e => { e.preventDefault(); s.style.borderColor = ''; }));
    s.addEventListener('drop', e => { e.stopPropagation(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image')); if (f) fileToCanvas(f, cv => setView(kind, cv)); });
  });
  // allow dropping anywhere on the window
  const win = document.querySelector('.window');
  ['dragover'].forEach(ev => win.addEventListener(ev, e => e.preventDefault()));
  win.addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].filter(f => f.type.startsWith('image')).forEach(loadImageFile); });

  // ---------- boot: render sample sprites ----------
  function boot() {
    resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 120);
    SAMPLE_SPRITES.forEach((sp, i) => {
      const nat = sp.draw(sp.size); // voxelize at native sprite resolution
      addItem(sp.name, nat, 'queued', i === 0);
    });
  }

  window.__dbg = { scene, camera, controls, get mesh() { return mesh; }, modelGroup, renderer };

  // wait for fonts/three then boot
  if (typeof THREE === 'undefined') {
    document.getElementById('statMain').textContent = 'Error: Three.js no cargó';
  } else {
    boot();
  }
})();
