# Design: LOD Generation for Voxel Exports

## Technical Approach

Generate three pre-mesh LOD variants by downsampling the final voxel grid before greedy face extraction, matching the proposal's uniform-grid-sampling approach. `extractMesh()` produces independent `high`, `medium`, and `low` greedy face lists in one pass. The result stores all three in `lodFaces`, keeps `greedyFacesList` as the unchanged high detail default, and records `selectedLod` from `config.mesh.lod`. Exporters accept an explicit `lod` option and consume the matching list. The UI adds a preview/export LOD selector that switches between stored lists without re-voxelizing.

This satisfies the `mesh-lod-generation` spec (deterministic downsampling, per-LOD greedy extraction, topology preservation), the `gltf-glb-export` delta (selected LOD face list, empty/index checks), and the `fbx-ascii-export` delta (selected LOD geometry, empty/memory checks).

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|---|---|---|---|
| Pre-mesh vs post-mesh downsampling | Pre-mesh (downsample grid, then greedy) | Preserves closed manifold, cheap, deterministic; loses sub-voxel detail | Pre-mesh |
| | Post-mesh decimation | More detail preservation; complex, may break manifold | Rejected |
| Dominant-color tie-breaker | First-found in storage order (x→y→z) | Deterministic across workers, simple | First-found in storage order |
| | Random / last-found | Non-deterministic output | Rejected |
| LOD storage | `result.lodFaces` all levels; `greedyFacesList` stays high | Fast preview switching, backward compatible | Store all levels; keep `greedyFacesList` high |
| | Only selected list | Simpler but requires re-voxelize to preview other levels | Rejected |
| Exporter LOD selection | `options.lod` selects `result.lodFaces[lod]` | Minimal signature change, explicit | `options.lod` |
| | Pass raw face list | More flexible but breaks result contract | Rejected |
| Default LOD behavior | `mesh.lod` defaults to `high`; absent treated as `high` | Unchanged default output | Default `high` |
| AO on medium/low | Disable AO for non-high LOD | Avoids grid/dimension mismatch; matches proposal out-of-scope note | Disable for medium/low |

## Data Flow

```
grid + faceColorAt
    │
    ▼
extractMesh(config.mesh.lod)
    ├── high:   greedyFaces(originalGrid, dims)
    ├── medium: downsampleGrid(grid, 2) → greedyFaces
    └── low:    downsampleGrid(grid, 4) → greedyFaces
            │
            ▼
    result.lodFaces = { high, medium, low }
    result.greedyFacesList = lodFaces.high   // unchanged default
    result.selectedLod = config.mesh.lod
            │
            ├──► app.js preview: result.lodFaces[state.previewLod]
            └──► VoxIO export:   result.lodFaces[options.lod ?? result.selectedLod]
```

## File Changes

| File | Action | Description |
|---|---|---|
| `voxelizer/voxel.js` | Modify | Add `mesh.lod` default/validation/legacy wiring, `downsampleGrid()`, and per-LOD extraction in `extractMesh()`. |
| `voxelizer/voxio.js` | Modify | `exportOBJ`, `buildIndexedMesh`, `exportGLB`, `exportFBX` accept `options.lod` and select the matching `result.lodFaces` list. |
| `voxelizer/app.js` | Modify | Add LOD selector in Mesh group, preview LOD state, rebuild model from selected LOD, pass LOD to exporters. |
| `voxelizer/palette-io.js` | Modify | Remap `lodFaces.high`, `lodFaces.medium`, `lodFaces.low` in `applyRemap`. |
| `voxelizer/index.html` | Modify | Add segmented LOD selector inside the Mesh group. |
| `tests/voxelizer.test.js` | Modify | Add downsampling, budget, topology, export integration, and default LOD tests. |

## Interfaces / Contracts

```javascript
// Config additions
DEFAULT_CONFIG.mesh.lod = 'high'; // 'high' | 'medium' | 'low'

// New helper
function downsampleGrid(grid, dims, factor) {
  // Iterates each output cell block in x→y→z order.
  // Returns { grid: Int16Array, dims: [dx, dy, dz] }.
  // Empty blocks become -1. Ties use first-seen palette index.
}

// Modified result shape (additions only)
result = {
  // ... existing fields ...
  lodFaces: {
    high:   [...], // identical to greedyFacesList
    medium: [...],
    low:    [...],
  },
  selectedLod: 'high', // normalized config.mesh.lod
};

// Exporter options
VoxIO.exportOBJ(result, { lod: 'medium', scale, useAO, ... });
VoxIO.buildIndexedMesh(result, { lod: 'medium', scale, useAO, ... });
VoxIO.exportGLB(result, { lod: 'medium', scale, useAO, ... });
VoxIO.exportFBX(result, { lod: 'medium', scale });
// If lod is omitted, exporters use result.lodFaces[result.selectedLod],
// falling back to result.greedyFacesList.
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `downsampleGrid` dominant color and tie-breaker | Build 2×2×2 and 4×4×4 grids with known distributions; assert output color matches dominant and first-seen rule. |
| Unit | Face budget ordering | Voxelize a representative sprite; assert `low.length < medium.length < high.length`. |
| Unit | Closed manifold per LOD | Build edge map from each LOD face list; assert every edge appears exactly twice with opposite winding. |
| Integration | GLB/FBX/OBJ export with LOD | Call exporters with `lod: 'medium'` and `lod: 'low'`; assert non-empty output and expected primitive/face counts. |
| Integration | Default behavior | Voxelize without `mesh.lod`; assert `selectedLod === 'high'` and output matches pre-change baseline. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No data migration required. The change is feature-flagged by `mesh.lod`: callers that omit it receive the `high` LOD, producing the same mesh as before. The UI defaults to `high`. Ambient occlusion remains available only on `high` to avoid grid/dimension mismatches on downsampled LODs.

## Open Questions

None.
