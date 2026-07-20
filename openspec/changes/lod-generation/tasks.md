# Tasks: LOD Generation for Voxel Exports

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–1000 |
| 400-line budget risk | High |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | PR | Test | Harness | Rollback |
|------|------|----|------|---------|----------|
| 1 | Core LOD downsampling/extraction | 1 | `node --test tests/voxelizer.test.js --grep='downsampleGrid\|LOD\|manifold'` | N/A | `voxelizer/voxel.js`, tests |
| 2 | Export LOD selection and remap | 2 | `node --test tests/voxelizer.test.js --grep='export.*LOD\|applyRemap.*LOD'` | N/A | `voxelizer/voxio.js`, `palette-io.js`, tests |
| 3 | UI preview/export selector | 3 | `node --test tests/voxelizer.test.js --grep='default LOD\|preview LOD'` | Browser: switch LOD/export | `voxelizer/app.js`, `index.html` |

## Phase 1: Core LOD Generation

- [x] 1.1 RED → GREEN: Test and implement `downsampleGrid(grid, dims, factor)` in `voxelizer/voxel.js` with dominant color, first-found tie-breaker, and empty blocks.
- [x] 1.2 Add `DEFAULT_CONFIG.mesh.lod = 'high'`, normalize legacy config, and modify `extractMesh` to build `result.lodFaces = { high, medium, low }` while keeping `greedyFacesList` as high.
- [x] 1.3 RED → GREEN: Test and verify `low.length < medium.length < high.length` on a representative sprite.
- [x] 1.4 RED → GREEN: Test and verify every LOD edge appears exactly twice with opposite winding.

## Phase 2: Export Integration

- [ ] 2.1 RED → GREEN: Test and update `exportOBJ` to select `result.lodFaces[options.lod]` and disable AO for non-high LOD.
- [ ] 2.2 RED → GREEN: Test and update `buildIndexedMesh` and `exportGLB` to honor `options.lod` and validate empty selected LOD.
- [ ] 2.3 RED → GREEN: Test and update `exportFBX` to honor `options.lod` and validate empty selected LOD.
- [ ] 2.4 RED → GREEN: Test and update `applyRemap` in `voxelizer/palette-io.js` to remap `lodFaces.high/medium/low`.

## Phase 3: UI Wiring

- [ ] 3.1 Add segmented LOD selector in Mesh group of `voxelizer/index.html`.
- [ ] 3.2 Add `previewLod` state and event listener in `voxelizer/app.js`.
- [ ] 3.3 Modify `buildModel` to rebuild from `result.lodFaces[state.previewLod]`.
- [ ] 3.4 Pass `options.lod` from `state.previewLod` to `exportOBJ`, `exportGLB`, and `exportFBX` calls.
- [ ] 3.5 RED → GREEN: Test default `mesh.lod` is `high` and exporters fall back to `greedyFacesList`.
- [ ] 3.6 RED → GREEN: Test preview LOD switching rebuilds without re-voxelizing.

## Phase 4: Verification

- [ ] 4.1 Run `node --test --test-reporter=spec tests/voxelizer.test.js`.
- [ ] 4.2 Run `node --check` on modified `voxelizer/*.js` files.
- [ ] 4.3 Smoke test: export `medium` and `low` GLB/FBX/OBJ and load in viewers.
