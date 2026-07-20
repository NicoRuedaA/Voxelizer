# Proposal: LOD Generation for Voxel Exports

## Intent

Add three pre-mesh LOD variants so users can export smaller, game-ready voxel meshes without manual decimation. High keeps full detail, medium halves resolution, and low quarters resolution, each produced by the existing greedy mesher.

## Scope

### In Scope
- Config option `mesh.lod` with levels `high` (1x), `medium` (2x), `low` (4x), default `high`.
- `downsampleGrid()` helper in `voxelizer/voxel.js` using deterministic dominant-color sampling.
- Per-LOD face extraction through `greedyFaces()` before mesh indexing.
- Export path selection so `voxio.js` builds the chosen LOD into OBJ/GLB/FBX.
- Preview LOD selector in `voxelizer/app.js`.
- Tests verifying face/index budget decreases and closed-surface topology per LOD.

### Out of Scope
- Runtime LOD switching or progressive meshing.
- Post-mesh vertex clustering / edge collapse.
- LOD for VOX format.
- AO on downsampled grids until alignment is verified.

## Capabilities

### New Capabilities
- `mesh-lod-generation`: downsampling the voxel grid and generating per-LOD greedy face lists.

### Modified Capabilities
- `gltf-glb-export`: accept a selected LOD face list; emit the chosen level.
- `fbx-ascii-export`: accept a selected LOD face list; emit the chosen level.

## Approach

Use uniform grid sampling before face extraction. `extractMesh()` maps `lod` to a factor, downsamples the grid once, then runs `greedyFaces()` on the reduced grid. The result carries the selected LOD face list; exporters consume it without changing mesh-generation internals.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/voxel.js` | Modified | Add `mesh.lod`, `downsampleGrid()`, and per-LOD extraction. |
| `voxelizer/voxio.js` | Modified | `buildIndexedMesh()`/`exportOBJ()`/`exportGLB()`/`exportFBX()` accept a LOD face list. |
| `voxelizer/app.js` | Modified | UI selector for preview and export LOD. |
| `tests/voxelizer.test.js` | Modified | Topology and budget tests for LOD levels. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Thin features disappear at 4x | Medium | Document behavior; default to high. |
| Color ties cause non-deterministic output | Low | First-found color tie-breaker across workers. |
| AO mismatch with downsampled grid | Medium | Disable AO for medium/low until verified. |
| Export still oversized on dense inputs | Low | Keep existing budget guards. |

## Rollback Plan

- Remove `mesh.lod` from `DEFAULT_CONFIG` and legacy options.
- Delete `downsampleGrid()` and revert `extractMesh()` to single greedy output.
- Revert exporter signatures to the original `greedyFacesList`.
- Revert UI selector.
- Tests return to single-LOD assertions.

## Dependencies

- None; reuses existing greedy mesher and palette indexing.

## Success Criteria

- [ ] `low` LOD produces fewer indices than `medium`, and `medium` fewer than `high` on a representative model.
- [ ] Each LOD mesh is a closed manifold (every edge appears exactly twice with opposite winding).
- [ ] GLB/FBX/OBJ exports for `medium` and `low` load correctly in standard viewers.
- [ ] Default behavior remains unchanged when `mesh.lod` is `high`.
- [ ] All existing tests pass after the change.
