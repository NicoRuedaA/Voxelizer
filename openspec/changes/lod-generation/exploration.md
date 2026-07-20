## Exploration: LOD generation for exported voxel models

### Current State

The voxelizer pipeline is: **pixels → quantized palette → 3D grid (`grid: Int16Array`, `dims: [DX,DY,DZ]`) → face extraction → export**.

- Face extraction lives in `voxelizer/voxel.js`. It offers `naiveFaces()` (one quad per exposed voxel face) and `greedyFaces()` (greedy merging of coplanar same-color faces along each axis). `extractMesh()` returns `{ greedyFacesList, naiveFacesList, naiveCount }`.
- `voxelizer/voxio.js` consumes `result.greedyFacesList` to produce OBJ, GLB, and FBX. `buildIndexedMesh()` expands each quad into two triangles, groups indices by `face.color`, and returns typed arrays. `exportGLB`/`exportFBX` wrap that indexed mesh in their respective container formats. VOX export is voxel-based and not mesh-based.
- The preview in `voxelizer/app.js` uses either `result.greedyFacesList` or `result.naiveFacesList` but has no concept of LOD.
- Config/opts live in `voxelizer/voxel.js` (`DEFAULT_CONFIG`, `normalizeConfig`, `legacyOptionsFromConfig`). `mesh.mode` is currently limited to `['voxel']`.
- Tests in `tests/voxelizer.test.js` verify exports, mesh metrics, and grid equivalence. Adding LOD will require tests that assert each LOD level has fewer faces/indices than the previous while preserving closed-surface topology.

There is no existing LOD, decimation, or simplification code.

### Affected Areas

- `voxelizer/voxel.js` — new LOD option in config, new decimation logic, and populating per-LOD face lists in the result.
- `voxelizer/voxio.js` — `buildIndexedMesh()`/`exportGLB()`/`exportFBX()`/`exportOBJ()` need to accept a chosen face list; possibly expose per-LOD exports.
- `voxelizer/app.js` — UI controls to select LOD level for preview and export; wiring to batch export.
- `tests/voxelizer.test.js` — topology and budget tests for generated LODs.
- `voxelizer/worker.js` — no structural change needed; it returns the full `voxelize()` result unchanged.

### Approaches

1. **Uniform grid sampling (pre-mesh)**
   - Description: Downsample the voxel grid by a factor (e.g. 2x or 4x) before face extraction. Run `greedyFaces()` on the reduced grid.
   - Pros: Simple to reason about; naturally preserves axis-aligned blocks and color grouping; directly reduces face count; integrates cleanly with existing greedy meshing; no new geometry algorithms required.
   - Cons: Loses small features at a fixed rate; aggressive sampling can disconnect thin parts; color/material resolution drops with the grid.
   - Effort: Low

2. **Face merging extension (post-greedy merge)**
   - Description: After greedy meshing, further merge adjacent coplanar quads across color boundaries (averaging or dominating color) or relax the "same color" constraint in `greedyFaces()`.
   - Pros: Keeps the original grid resolution; easy to implement as an additional pass over `greedyFacesList`.
   - Cons: Limited reduction factor on complex multi-color models; merging across colors changes appearance; cannot simplify thickness or internal voids.
   - Effort: Low to Medium

3. **Vertex clustering (post-mesh)**
   - Description: Cluster vertices of the greedy mesh into a coarser regular grid and collapse degenerate triangles. Preserve attributes (normals, colors/AO) via dominant or averaged values.
   - Pros: Operates on the existing mesh; can be applied uniformly to all formats (OBJ/GLB/FBX); high reduction potential.
   - Cons: More code (edge collapse, attribute preservation, topology repair); risk of non-manifold output or flipped faces; must keep per-material index groups consistent; increases per-export CPU cost.
   - Effort: High

### Recommendation

**Start with Approach 1 — uniform grid sampling** — as the first slice.

Rationale:
- It is the only approach that integrates with the existing greedy mesher without inventing a new mesh-simplification engine.
- It maps cleanly to the requested "high / medium / low" LOD levels: 1x, 2x, 4x grid sampling.
- It preserves the blocky voxel aesthetic that users expect.
- It is testable by comparing face/index counts and asserting the generated mesh remains closed.

Vertex clustering (Approach 3) is the long-term best quality option but should be deferred until the grid-sampling slice proves the export/UX plumbing. Face merging (Approach 2) can be added later as a cheap complementary pass.

### Viable first slice

The first implementation slice should:
1. Add `mesh.lod` to `DEFAULT_CONFIG` with levels `['high','medium','low']` (default `'high'`) and a corresponding `lod` legacy option.
2. Implement a `downsampleGrid(grid, dims, factor)` helper in `voxelizer/voxel.js` that collapses `factor³` cells into one cell using a deterministic color-selection rule (e.g. most frequent opaque color, with the first-found color as tie-breaker for determinism).
3. In `extractMesh()`, when `lod !== 'high'`, downsample before `greedyFaces()` and return the LOD face list as `greedyFacesList` for that level.
4. Produce the LOD result early enough that `voxio.js` can export it without changes to `buildIndexedMesh()` beyond selecting the requested face list.
5. Add tests verifying that `low` has fewer indices than `medium`, `medium` fewer than `high`, and that each LOD mesh is closed (each edge appears exactly twice with opposite direction).

This slice stays within the 800-line review budget and leaves room for UX wiring in `app.js`.

### Risks

- **Color fidelity loss**: downsampling merges palette indices; dominant-color tie-breaking must be deterministic across runs and workers.
- **Disconnected geometry**: thin features one voxel thick may disappear at 4x sampling.
- **Export budget surprises**: LOD is meant to reduce size, but the downsampled grid can still produce many faces on high-resolution inputs; budget guards in `voxelizer/voxel.js` still apply.
- **VOX format incompatibility**: VOX stores raw voxels and has a 256³ limit; LOD voxels are a different grid. Either skip VOX for non-high LOD or treat it as a separate concern.
- **AO correctness**: `annotateAO()` expects the exported faces to match the exported grid. Downsampling must produce a grid that matches the LOD faces, or AO must be disabled for LOD levels until alignment is verified.

### Ready for Proposal

Yes. The orchestrator should tell the user that the recommended first slice is **uniform grid sampling (1x / 2x / 4x) plugged into the existing greedy mesher**, and that the exploration is ready to move to the proposal phase with an estimated implementation size comfortably under the 800-line budget.
