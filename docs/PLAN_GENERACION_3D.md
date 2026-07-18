# Deterministic 3D generation: current implementation and roadmap

The deterministic core is implemented while preserving legacy output when new controls remain at their defaults. Product-facing inspection, depth-map authoring, browser integration, and advanced camera/mesh work remain open below.

## Pipeline

```text
validate payloads
→ preprocess front and auxiliary silhouettes
→ normalize calibrated view descriptors
→ estimate single-view depth envelope
→ strict or confidence-weighted occupancy
→ project and diagnose every supported view
→ assign face-specific surface colors
→ derive the explicit lossy per-voxel VOX color
→ greedy/naive voxel faces
→ VOX or OBJ/MTL export
```

## Capability status

| Area | Implemented behavior |
|---|---|
| Configuration | `CONFIG_VERSION=2`, explicit v1 migration, legacy round-trip, opt-in local-width mode; inert smooth-mesh fields removed |
| Validation | Positive dimensions, exact RGBA payload length, unified `alpha > threshold` semantics, per-stage and aggregate budgets |
| Silhouettes | Core supports optional denoise, close, feather, nearest, area, and bilinear resampling; processed/original comparison UI is not implemented |
| Single view | Uniform, DT, Poisson, SFS, Combo, and Humanoid profiles; v1 grids remain default and local-width awareness is opt-in |
| Z envelope | Symmetric, asymmetric `frontRatio` (`0=-Z`, `1=+Z/front`), supplied depth map, strength, and inversion; smoothing and normalized-map preview remain open |
| Views | Serializable `views[]`; canonical orientation tuples are enforced and malformed/unsupported descriptors are diagnostic-only |
| Calibration | Manual transform, bounding-box autofit, and explicit point landmarks |
| Occupancy | Strict visual hull or weighted confidence with boundary distance, weights, threshold, and hard-front constraint |
| Diagnostics | Empty front/view, missing map, unsupported role, empty result, low IoU, residual, and conflicting view; confidence-field debugging remains open |
| Overlays | Target-only, accepted overlap, and projection-only pixels with per-view IoU/residual; same-role views can be selected by ID |
| Colors | Face-specific front/side/top/back materials for preview and OBJ/MTL; explicit mean-of-exposed-faces policy for lossy VOX |
| Animation | Explicit core `frames[]`; UI per-view metadata chooses `static` or `sheet` without size inference |
| Workers | Immutable canonical jobs, incarnation-safe events, validated voxel-result envelopes, whole-incarnation settlement on protocol/dispatch failure, idle reuse, cancellation, visible fallback, bounded retry |
| Exports | OBJ/MTL and VOX; used RGB colors are remapped exactly to 1..255 and excess colors are rejected |
| Metrics | Stage timing, typed data, diagnostic buffers, face estimate, and bytes per occupied voxel |

## Quality gates

The Node suite covers:

- golden-grid output for every active depth profile;
- preprocessing and every resampling mode;
- symmetric/asymmetric/depth-map envelopes;
- strict and weighted reconstruction, weights, thresholds, edge tolerance, and hard-front relaxation;
- invalid, empty, contradictory, and unsupported inputs;
- projection diagnostics and overlays;
- auxiliary RGB fusion and front-only compatibility;
- per-frame view selection and landmark calibration;
- worker response integrity;
- OBJ/MTL, ZIP, and VOX palette-index behavior;
- moderate-volume time and memory sanity.

Run the same checks as CI:

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

## Architectural boundaries

### Single-image uncertainty

One front image cannot reveal its back, hidden cavities, or true depth. The six profiles and grayscale map are explicit artistic priors. The UI and README state this rather than presenting the result as recovered geometry.

### Supported cameras

Only calibrated orthographic front (X/Y), side (Z/Y), and top (X/Z) projections carve the grid. The internal descriptor can carry more views, but an unsupported role produces `UNSUPPORTED_VIEW_ROLE`; arbitrary-angle projection is not faked.

### Smooth meshes

Smooth-mesh settings were deliberately removed. Adding Marching Cubes safely requires a separate surface-color model, normals, topology validation, renderer path, and OBJ tests. Until that complete contract exists, voxel faces are the truthful supported output.

### VOX palette and material capacity

VOX voxel indices reserve byte `0`, leaving indices `1..255` representable, and cannot represent face-specific materials. Preview and OBJ/MTL retain per-face colors. VOX deliberately stores the mean of each voxel's exposed face colors, deduplicates used RGB values, remaps them to `1..255`, and rejects more than 255 distinct results.

Public reconstruction calls are guarded before expensive allocations: front images are capped at 4,194,304 pixels, logical grids at 16,777,216 cells, auxiliary inputs by count/cumulative pixels/bytes, morphology per view and in aggregate, occupied meshing at 2,097,152 voxels, and face objects by exposed-face/estimated-byte budgets.

## Remaining backlog and acceptance criteria

### Perspective and arbitrary-angle calibration

- [ ] Store camera intrinsics/extrinsics for every non-canonical view.
- [ ] Project a known calibration fixture with sub-pixel residual reporting.
- [ ] Reject incomplete camera metadata before carving.
- [ ] Prove two arbitrary-angle golden fixtures without changing orthographic baselines.

**Acceptance:** arbitrary roles are enabled only after their projector, calibration UI, and golden projections exist. Until then they remain `UNSUPPORTED_ORIENTATION`/`UNSUPPORTED_VIEW_ROLE` diagnostics.

### Smooth surface contract

- [ ] Define signed density independently from palette-index occupancy.
- [ ] Choose Marching Cubes or Dual Contouring with topology criteria.
- [ ] Define normals, material interpolation, renderer behavior, and OBJ serialization.
- [ ] Test closed surfaces, valid indices, non-degenerate triangles, and bounded color error.

**Acceptance:** no smooth control returns until browser preview and exported OBJ share the tested surface/material contract.

### Presets and persistence

- [ ] Add versioned Pixel Art, Fine Detail, Tolerant, and Depth Map presets.
- [ ] Migrate stored v1/v2 configurations through the public migration function.
- [ ] Import/export presets as JSON and include the effective config in batch ZIPs.
- [ ] Restore state without changing default legacy grids.

**Acceptance:** a saved preset round-trips every active field and reproduces the same grid after reload.

### Browser integration and batch resilience

- [ ] Exercise drag/drop, explicit static/sheet metadata, and per-frame auxiliary selection in a real browser.
- [ ] Mutate live UI state during a batch and prove the immutable manifest keeps names, totals, pixels, views, alignment, and options unchanged.
- [ ] Crash a worker, observe `WORKER_FALLBACK`, then prove a later bounded retry recovers.
- [ ] Cancel worker-backed and synchronous-fallback batches with documented latency.

**Acceptance:** browser tests prove idle worker reuse, stale preview invalidation, immutable batch outputs, recovery, and cancellation. Synchronous fallback remains unavoidably non-preemptive while one `voxelize()` call is executing.

### Diagnostics and usability

- [x] Let users select among multiple same-role view IDs in the overlay UI.
- [ ] Export per-view IoU/residual diagnostics with batch artifacts.
- [ ] Add budget guidance before users request costly dimensions.
- [ ] Add accessible descriptions for overlap colors and severity.
- [ ] Expose input confidence and weighted-score fields in a per-view debug panel.

### Depth-map and silhouette inspection

- [ ] Add configurable depth-map smoothing without changing the raw source.
- [ ] Show raw and normalized depth-map previews with inversion and strength applied.
- [ ] Show original and processed silhouettes side by side for front and auxiliary views.
- [ ] Add a one-action reset from processed silhouette settings to the untouched source.

**Acceptance:** users can inspect exactly which normalized scalar map and processed mask enter reconstruction, compare them with the originals, and reset processing without reloading images.

**Acceptance:** every diagnostic shown in the UI identifies its view ID, stage, severity, and corrective action.
