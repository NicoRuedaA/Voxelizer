/* Voxelizer core: pixels -> palette -> 3D grid -> faces (naive & greedy).
   Pure logic, no Three.js. Returns plain face descriptors that app.js
   turns into geometry. This is where the --depth / --alpha / quantize /
   --depth-map / greedy options actually take effect. */

// ---- read opaque pixels from any canvas ----
function canvasToPixels(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  return { w, h, data };
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

// (A) Distance transform. 'round' 0..1 mezcla bisel lineal <-> hombro esferico.
function _profDT(mask, w, h, round) {
  if (round == null) round = 1;
  const sq = _edtSq(mask, w, h);
  let mx = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) { const d = Math.sqrt(sq[i]); if (d > mx) mx = d; }
  const p = new Float32Array(w * h);
  if (mx <= 0) return p;
  for (let i = 0; i < w * h; i++) if (mask[i]) {
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
function _profCombo(mask, lum, w, h, mix) {
  const m = mix == null ? 0.5 : mix;
  const dt = _profDT(mask, w, h, 1), sf = _normLum(mask, lum, w, h);
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
  if (mode === 'dt') return _profDT(mask, w, h, opts.dtRound);
  if (mode === 'poisson') return _profPoisson(mask, w, h, opts.poissonTension);
  if (mode === 'sfs') return _profSFS(mask, lum, w, h, opts.sfsGamma);
  if (mode === 'combo') return _profCombo(mask, lum, w, h, opts.comboMix);
  if (mode === 'humanoid') return _profHumanoid(mask, lum, w, h, opts);
  return null; // uniforme
}

function depthSpanAt(index, depth, prof, relief) {
  if (!prof) return depth;
  const norm = (1 - relief) + relief * prof[index];
  return Math.max(1, Math.round(norm * depth));
}

// ---- build 3D voxel grid from quantized pixels ----
function buildGrid(quant, opts) {
  const { idxAt, w, h } = quant;
  const depth = Math.max(1, opts.depth | 0);
  const mode = opts.depthMode || 'uniform';
  const relief = (opts.relief == null) ? 1 : Math.max(0, Math.min(1, opts.relief));
  const prof = (mode === 'uniform') ? null : depthProfile(quant, mode, opts);
  const DX = w, DY = h, DZ = depth;
  const grid = new Int16Array(DX * DY * DZ).fill(-1);
  let voxels = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = px + w * py;
      const ci = idxAt[i];
      if (ci < 0) continue;
      const dz = depthSpanAt(i, depth, prof, relief);
      const gx = px, gy = (h - 1 - py); // flip so up is +Y
      const z0 = (DZ - dz) >> 1;         // centrado en Z (relieve por ambas caras)
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

function naiveFaces(grid, dims) {
  const [DX, DY, DZ] = dims;
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) ? -1 : grid[x + DX * (y + DY * z)];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faces = [];
  for (let z = 0; z < DZ; z++) for (let y = 0; y < DY; y++) for (let x = 0; x < DX; x++) {
    const c = get(x, y, z); if (c < 0) continue;
    for (let d = 0; d < 6; d++) {
      const [nx, ny, nz] = dirs[d];
      if (get(x + nx, y + ny, z + nz) < 0) faces.push(unitFace(x, y, z, d, c));
    }
  }
  return faces;
}

function greedyFaces(grid, dims) {
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
          if (a >= 0 && b < 0) mask[n] = { color: a, dir: 1 };
          else if (b >= 0 && a < 0) mask[n] = { color: b, dir: -1 };
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
  const m = new Uint8Array(px.w * px.h);
  for (let i = 0; i < px.w * px.h; i++) m[i] = px.data[i * 4 + 3] >= alpha ? 1 : 0;
  return m;
}
function _resampleMask(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / dw));
      out[x + dw * y] = src[sx + sw * sy];
    }
  }
  return out;
}
function buildHull(quant, opts, views) {
  const { idxAt, w: W, h: H } = quant;
  const alpha = opts.alpha;
  const D = Math.max(1, opts.depth | 0);
  const mode = opts.depthMode || 'uniform';
  const relief = (opts.relief == null) ? 1 : Math.max(0, Math.min(1, opts.relief));
  const prof = (mode === 'uniform') ? null : depthProfile(quant, mode, opts);

  let sideMask = null, sideRow = null;
  if (views.side) {
    const sp = views.side;
    sideMask = _resampleMask(_maskFrom(sp, alpha), sp.w, sp.h, D, H); // alto -> H
    sideRow = new Uint8Array(H);                // filas vacias -> no recortar (seguridad)
    for (let y = 0; y < H; y++) { let a = 0; for (let z = 0; z < D; z++) if (sideMask[z + D * y]) { a = 1; break; } sideRow[y] = a; }
  }
  let topMask = null, topCol = null;
  if (views.top) {
    const tp = views.top;
    topMask = _resampleMask(_maskFrom(tp, alpha), tp.w, tp.h, W, D); // ancho->W, alto->D
    topCol = new Uint8Array(W);
    for (let x = 0; x < W; x++) { let a = 0; for (let z = 0; z < D; z++) if (topMask[x + W * z]) { a = 1; break; } topCol[x] = a; }
  }

  const grid = new Int16Array(W * H * D).fill(-1);
  let voxels = 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = px + W * py;
      const ci = idxAt[i];
      if (ci < 0) continue;
      if (sideMask && sideRow[py] === 0) continue;
      if (topMask && topCol[px] === 0) continue;
      const dz = depthSpanAt(i, D, prof, relief);
      const z0 = (D - dz) >> 1;
      const z1 = z0 + dz;
      const my = H - 1 - py;
      for (let z = z0; z < z1; z++) {
        if (sideMask && sideRow[py] && sideMask[z + D * py] !== 1) continue;
        if (topMask && topCol[px] && topMask[px + W * z] !== 1) continue;
        grid[px + W * (my + H * z)] = ci; voxels++;
      }
    }
  }
  return { grid, dims: [W, H, D], voxels };
}

// ---- top-level: pixels + opts -> everything app.js needs ----
function voxelize(pixels, opts, views) {
  views = views || {};
  const quant = quantize(pixels, opts.alpha, opts.colors);
  const useHull = !!(views.side || views.top);
  const { grid, dims, voxels } = useHull ? buildHull(quant, opts, views) : buildGrid(quant, opts);
  const greedy = greedyFaces(grid, dims);
  // naive count only (don't keep geometry unless needed)
  let naiveCount = 0;
  {
    const [DX, DY, DZ] = dims;
    const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) ? -1 : grid[x + DX * (y + DY * z)];
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let z = 0; z < DZ; z++) for (let y = 0; y < DY; y++) for (let x = 0; x < DX; x++) {
      if (get(x, y, z) < 0) continue;
      for (let dd = 0; dd < 6; dd++) if (get(x + dirs[dd][0], y + dirs[dd][1], z + dirs[dd][2]) < 0) naiveCount++;
    }
  }
  return {
    palette: quant.palette,
    grid,
    dims, voxels,
    greedyFacesList: greedy,
    naiveFacesList: opts.greedy ? null : naiveFaces(grid, dims),
    naiveCount,
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

window.Voxel = { canvasToPixels, voxelize, annotateAO };
