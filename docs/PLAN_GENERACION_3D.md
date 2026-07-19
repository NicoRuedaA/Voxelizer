# Deterministic 3D generation: current implementation and roadmap

The deterministic core is implemented. New v3 sessions use material-aware multiview occupancy by default; v1/v2 configurations without recognized material fields migrate disabled and preserve their previous alpha-only grids exactly. Explicit supported material settings survive migration; unknown-only metadata does not enable the feature. Canonical orthographic validation cameras and profile-matched depth are implemented; arbitrary-angle calibration, product-facing depth-map authoring, broader browser integration, and smooth-mesh work remain open below.

## Pipeline

```text
validate payloads
→ preprocess front and auxiliary silhouettes
→ normalize calibrated view descriptors
→ estimate single-view depth envelope
→ build bounded front/auxiliary material evidence
→ strict or confidence-weighted alpha + material occupancy
→ project and diagnose every supported view
→ assign face-specific surface colors
→ derive the explicit lossy per-voxel VOX color
→ greedy/naive voxel faces
→ VOX or OBJ/MTL export
```

## Capability status

| Area | Implemented behavior |
|---|---|
| Configuration | `CONFIG_VERSION=3`, exact v1/v2 alpha-only migration unless supported material fields were explicit, legacy round-trip, opt-in local-width mode, and material-aware defaults for fresh sessions |
| Validation | Positive dimensions, exact RGBA payload length, unified `alpha > threshold` semantics, per-stage and aggregate budgets |
| Silhouettes | Core supports optional denoise, close, feather, nearest, area, and bilinear resampling; processed/original comparison UI is not implemented |
| Single view | Uniform, DT, Poisson, SFS, Combo, and Humanoid profiles; v1 grids remain default and local-width awareness is opt-in |
| Z envelope | Symmetric, asymmetric `frontRatio` (`0=-Z`, `1=+Z/front`), supplied depth map, strength, and inversion; smoothing and normalized-map preview remain open |
| Profile resolution | Depth `1..256`; **Match profile** uses the selected side-frame source width (one layer per source pixel before alignment/resampling), source/grid compression diagnostics, and explicit downsampling warnings independent of grid IoU; Match profile improves sampling but does not guarantee anatomically correct geometry |
| Views | Serializable `views[]`; canonical orientation tuples are enforced and malformed/unsupported descriptors are diagnostic-only |
| Viewport cameras | Real Perspective and orthographic Front X/Y, Profile Z/Y, and Top X/Z cameras; locked orthographic rotation and dimension/resize frustum refit; orthographic modes are validation views, Perspective is the artistic inspection mode |
| Calibration | Manual transform, bounding-box autofit, and explicit point landmarks |
| Occupancy | Strict visual hull or weighted confidence with boundary distance, weights, threshold, hard-front constraint, and cross-view material compatibility |
| Materials | Deterministic perceptual-RGB clustering (black included), explicit mask-only metadata, calibrated local compatibility, outer-front-face detail restoration, and 64-cluster/8-MiB/64-Mi-comparison caps |
| Diagnostics | Canonical eligible/evaluated/applied material state, zero incompatibility, structural occupancy, decorative face area, empty inputs/results, low IoU/residual, conflicts, and budget fallbacks |
| Overlays | Silhouette projection plus material match/mismatch/conflict pixels; per-view IoU, material-candidate compatibility, and same-role ID selection |
| Colors | Face-specific front/side/top/back materials for preview and OBJ/MTL; explicit mean-of-exposed-faces policy for lossy VOX |
| Animation | Explicit core `frames[]`; UI per-view metadata chooses `static` or `sheet` without size inference |
| Workers | Immutable canonical jobs, incarnation-safe events, validated voxel-result envelopes, whole-incarnation settlement on protocol/dispatch failure, idle reuse, cancellation, visible fallback, bounded retry; large jobs require a working worker because synchronous fallback rejects `WORKER_FALLBACK_WORK_EXCEEDED` above the bounded limit |
| Exports | OBJ/MTL and VOX; used RGB colors are remapped exactly to 1..255 and excess colors are rejected |
| Metrics | Stage timing, typed data, bounded material evidence, diagnostic buffers, face estimate, and bytes per occupied voxel |

## Quality gates

The Node suite covers:

- golden-grid output for every active depth profile;
- preprocessing and every resampling mode;
- symmetric/asymmetric/depth-map envelopes;
- strict and weighted reconstruction, weights, thresholds, edge tolerance, and hard-front relaxation;
- connected-silhouette material smearing, perceptual tolerance, strict/weighted material semantics, black RGBA, explicit mask-only fallback, zero-compatible views, and outermost-only front details;
- invalid, empty, contradictory, and unsupported inputs;
- projection diagnostics and overlays;
- auxiliary RGB fusion and front-only compatibility;
- per-frame view selection and landmark calibration;
- worker response integrity;
- OBJ/MTL, ZIP, and VOX palette-index behavior;
- moderate-volume time and memory sanity.
- 64/256-layer depth normalization and logical-grid budgets;
- selected spritesheet-frame profile matching, no-side disabled behavior, source-resolution diagnostics, and canonical camera/frustum helpers.

Run the same checks as CI:

```bash
node --check voxelizer/app.js
node --check voxelizer/viewport.js
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

Public reconstruction calls are guarded before expensive allocations: front images are capped at 4,194,304 pixels, logical grids at 16,777,216 cells, auxiliary inputs by count/cumulative pixels/bytes, transformed-view cells and peak bytes before mask preparation, morphology per view and in aggregate, occupied meshing at 2,097,152 voxels, and face objects by exposed-face/estimated-byte budgets.

Depth is capped at 256 because `256³` exactly matches the logical-grid budget. **Match profile** uses the width of the explicitly selected side spritesheet frame, giving roughly one depth layer per source pixel before alignment/resampling; it never infers depth from the front sprite. This preserves cubic voxels and export geometry rather than stretching only the preview. Match profile improves source sampling but does not guarantee anatomically correct 3D geometry. Grid IoU compares the prepared grid projection; it is not original-source fidelity or semantic correctness. Fidelity has a direct performance cost: doubling depth tends to double occupied voxel count, meshing work, and export bytes.

Material evidence uses at most 64 clusters, an exact 8 MiB across all owned typed arrays (including ranges and diagnostic overlays), and 64 Mi combined preparation/occupancy comparisons. Explicit `materialEvidence:false`, zero influence, disabled awareness, no cross-view match, global evidence/occupancy fallback, or having no usable material view preserves alpha-only occupancy. A single oversized comparison view is ignored while other usable material views may keep material reconstruction active. Pure black RGBA remains valid evidence. In strict mode influence is a compatible-evidence threshold; in weighted mode it is a mismatch penalty. Small unmatched clusters become surface-only only when supported structural material exists, and their RGB is restored solely on the outermost front face—not on internal +Z cavity faces.

Limitations remain explicit: orthographic side/top roles need calibrated alignment; color similarity cannot infer object identity when different objects share a palette; surface-detail classification is area-based; and alpha-only fallback favors deterministic safety over guessed semantics.

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
- [x] Report material compatibility separately from silhouette IoU and expose match/mismatch/conflict overlays.
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
