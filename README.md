# Voxelizer

Web prototype that turns one front sprite—and optional orthographic views—into a deterministic voxel model exportable as `.vox` or `.obj + .mtl`.

## Quick path

1. Serve `voxelizer/` with any static HTTP server.
2. Load a PNG and choose a depth prior.
3. Optionally add side, top, or depth-map images.
4. Review projection diagnostics before exporting.

```bash
python3 -m http.server 8000 --directory voxelizer
# open http://localhost:8000
```

Opening `index.html` directly also works in browsers that allow local workers; otherwise the app falls back to the main thread.

## Reconstruction modes

### One sprite

The front silhouette is extruded with one of six deterministic profiles:

| Profile | Prior |
|---|---|
| Uniform | Constant thickness |
| DT | Legacy contour-distance inflation; optional local-width modulation |
| Poisson | Smooth screened inflation |
| SFS | Artist-painted luminance |
| Combo | DT shape modulated by luminance |
| Humanoid | Head, torso, and limb cross-section heuristic |

The Z envelope can be symmetric, asymmetric (`frontRatio`), or driven by a supplied grayscale depth map. `frontRatio=0` places a partial span toward back/`-Z`, `0.5` centers it, and `1` places it toward documented front/`+Z`. Local-width modulation is an explicit v2 opt-in so migrated v1 DT/Poisson/SFS/Combo grids remain unchanged. A single image does **not** reveal hidden geometry: these modes are artistic priors, not physical reconstruction.

### Multiple views

Supported calibrated orthographic roles are:

| Role | Image plane | Shared axes |
|---|---|---|
| Front | X/Y | Width and height |
| Side | Z/Y | Depth and height |
| Top | X/Z | Width and depth |

`strict` requires every supplied silhouette to accept a voxel. `weighted` combines the front, side, and top confidences with configurable weights, threshold, boundary-distance tolerance, and an optional hard front constraint.

The UI reports per-view projected IoU and residuals. Empty masks, contradictory inputs, low overlap, missing depth maps, and unsupported roles produce structured warnings rather than failing silently.

## Input contract

Legacy `side` and `top` payloads remain supported:

```js
Voxel.voxelize(frontPixels, config, { side: sidePixels, top: topPixels });
```

The serializable contract supports confidence, transform, landmarks, and animation frames:

```js
const views = {
  frame: 1,
  views: [
    {
      id: 'profile',
      role: 'side',
      confidence: 0.8,
      orientation: { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
      transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false },
      frames: [sideFrame0, sideFrame1],
    },
    { role: 'depthmap', pixels: depthPixels },
  ],
};
```

Explicit orientation metadata is validated against the canonical tuples above. Perspective, arbitrary-angle, unsupported-role, and mismatched-axis descriptors are ignored with structured diagnostics: accepting metadata while silently using another projector would invent geometry.

## Silhouette and color pipeline

- Alpha semantics are uniform: a pixel is foreground only when `alpha > alphaThreshold`.
- Pixel payloads must provide positive integer `w`/`h` and exactly `w*h*4` values.
- Pixel-art-safe defaults keep cleanup disabled and use nearest-neighbor resampling.
- Optional denoise, morphological closing, alpha/spatial feathering, area, and bilinear resampling are available.
- `color.mode="front"` keeps explicit policies: `color.side` accepts `front`, `darken`, or calibrated `auxiliary`; `color.back` accepts `front` or `darken` because no rear camera role exists.
- `color.mode="auxiliary"` is a side/top fusion preset: it overrides the side policy only when at least one usable auxiliary color source exists; `color.back` always remains explicit. With no usable auxiliary source, front/back behavior and colors remain unchanged.
- Auxiliary color fusion assigns calibrated side/top RGB to the corresponding exposed face materials. Front and back policies remain independent. Preview and OBJ/MTL preserve those face-specific colors.

Auxiliary views are static by default. The UI exposes an explicit “follows spritesheet” flag per view; no canvas-size inference is used. The core contract also accepts an explicit `frames[]` array and selected `frame`.

## Exports and performance

- Greedy voxel meshing remains the only supported mesh contract.
- Smooth mesh controls were removed because Marching Cubes would require a different normal, color, renderer, and OBJ contract; exposing inert settings was worse than an explicit limitation.
- Idle workers are reused. Pending preview work is generation-cancelled without disposing idle workers; batch cancellation disposes its worker. Jobs are cloned once into canonical immutable snapshots used by both dispatch and fallback. Unknown job IDs, invalid result envelopes, dispatch failures, and runtime failures settle every pending job owned by that worker incarnation through rejection or `WORKER_FALLBACK`; later stale events are ignored.
- Metrics include typed buffers, diagnostics, and estimated face memory.
- VOX cannot encode a different material per face. Its explicit lossy policy stores the mean of each voxel's exposed face colors, then remaps used RGB colors to indices `1..255`. More than 255 distinct used colors is rejected instead of corrupted.
- Front input is limited to 4,194,304 pixels, the grid to 16,777,216 cells, auxiliary views to bounded count/cumulative bytes, morphology to per-view and aggregate work estimates, occupied meshing to 2,097,152 voxels, and face objects to exposed-face/byte budgets before allocation.
- Batch manifests account for input bytes before each clone, snapshot each source/static view once, slice frames lazily, return defensive per-job copies, assign deterministic unique archive basenames, and reject excessive jobs or expected/actual output bytes.

Current hard caps are 8 auxiliary views, 8,388,608 cumulative auxiliary pixels/32 MiB RGBA, 128 Mi operations of aggregate morphology, 250,000 exposed unit faces/64 MiB estimated face objects, 256 batch jobs, 128 MiB batch input snapshots, and 128 MiB expected or actual batch output.

## Architecture

| File | Responsibility |
|---|---|
| `voxelizer/voxel.js` | Validation, preprocessing, depth priors, view calibration, occupancy, diagnostics, color fusion, and meshing |
| `voxelizer/app.js` | UI state, spritesheet slicing, worker lifecycle, preview, batch, and exports |
| `voxelizer/worker.js` | Transferable worker protocol |
| `voxelizer/worker-channel.js` | Recoverable worker lifecycle, cancellation, fallback, and retry |
| `voxelizer/transfer.js` | Shared clone/transferable traversal |
| `voxelizer/batch.js` | Immutable lazy batch manifests, progress, names, and memory budgets |
| `voxelizer/voxio.js` | VOX and OBJ/MTL serialization |
| `tests/voxelizer.test.js` | Deterministic grids, edge cases, contracts, exports, and performance sanity |

## Tests

```bash
node --check voxelizer/app.js
node --check voxelizer/voxel.js
node --check voxelizer/voxio.js
node --check voxelizer/worker.js
node --check voxelizer/batch.js
node --check voxelizer/worker-channel.js
node --check voxelizer/transfer.js
node --check voxelizer/zip.js
node --test --test-reporter=spec tests/voxelizer.test.js
```

GitHub Actions runs the same browser-script checks and full Node suite on pushes to `main` and on pull requests.

## Deliberate limits

- Orthographic visual hulls cannot recover concavities hidden from every view.
- Bounding-box and landmark alignment do not correct perspective or lens distortion.
- A depth map is interpreted as a normalized artistic thickness field.
- VOX stores one palette index per voxel, so its documented mean-of-exposed-faces policy is intentionally lossy; OBJ/MTL and preview retain face-specific materials.
- No arbitrary-angle or ML reconstruction is claimed.

## License

Not defined yet.
