# Tasks: Add glTF/GLB and FBX ASCII Export Formats

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 850–1,100 |
| Effective review budget | 800 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Shared mesh assembler + GLB serializer + tests | PR 1 | `node --test --test-name-pattern="GLB|glb" --test-reporter=spec tests/voxelizer.test.js` | Manual: export `.glb` in browser and load with `THREE.GLTFLoader` | New GLB code and tests in `voxelizer/voxio.js` and `tests/voxelizer.test.js` |
| 2 | FBX serializer + tests | PR 2 | `node --test --test-name-pattern="FBX|fbx" --test-reporter=spec tests/voxelizer.test.js` | Manual: import `.fbx` into Blender 3.6+ | New FBX code and tests in `voxelizer/voxio.js` and `tests/voxelizer.test.js` |
| 3 | UI toggles + app wiring + integration tests + spec merge | PR 3 | `node --test --test-name-pattern="collectResultFiles|exportBatch|format" --test-reporter=spec tests/voxelizer.test.js` | Manual: toggle `.glb`/`.fbx` in browser and run batch ZIP | `voxelizer/app.js`, `voxelizer/index.html`, spec file |

## Phase 1: Foundation

- [x] 1.1 RED: add test asserting `buildIndexedMesh` emits outward winding matching `exportOBJ`.
- [x] 1.2 GREEN: implement `buildIndexedMesh(result, opts)` in `voxelizer/voxio.js` returning positions, normals, indices, material indices, optional AO colors.
- [x] 1.3 Export `exportGLB` and `exportFBX` stubs from `VoxIO`.

## Phase 2: GLB Serializer

- [x] 2.1 RED: add test asserting `exportGLB` throws empty error for empty `greedyFacesList`.
- [x] 2.2 RED: add test asserting GLB magic `glTF`/version 2 and JSON+BIN chunks.
- [x] 2.3 RED: add test asserting 12 triangles for a 1×1×1 voxel.
- [x] 2.4 RED: add test asserting centroid at origin and `opts.scale` applied.
- [x] 2.5 RED: add test asserting PBR `metallicFactor`/`roughnessFactor`/`emissiveFactor`.
- [x] 2.6 GREEN: implement `exportGLB` glTF JSON, accessors, bufferViews, and chunk writer.
- [x] 2.7 Implement `UNSIGNED_SHORT` → `UNSIGNED_INT` promotion when `faces*6 > 65535`.
- [x] 2.8 Implement optional `COLOR_0` vertex colors with AO modulation.

## Phase 3: FBX Serializer

- [x] 3.1 RED: add test asserting `exportFBX` throws empty error for empty `greedyFacesList`.
- [x] 3.2 RED: add test asserting FBX header and top-level sections.
- [x] 3.3 RED: add test asserting `Model:Mesh`, `Geometry`, and 36 `PolygonVertexIndex` entries.
- [x] 3.4 RED: add test asserting Y-up `GlobalSettings` and `opts.scale` applied.
- [x] 3.5 RED: add test asserting metallic/roughness/emissive material properties.
- [x] 3.6 GREEN: implement `exportFBX` header, `GlobalSettings`, `Objects`, `Connections`.
- [x] 3.7 Implement FBX ASCII output memory budget guard.

## Phase 4: UI and App Wiring

- [x] 4.1 Add `fmtGlb` and `fmtFbx` checkboxes to `voxelizer/index.html` Export group.
- [x] 4.2 Wire `fmtGlb`/`fmtFbx` click handlers in `voxelizer/app.js`.
- [x] 4.3 Extend `collectResultFiles` to accept `wantGlb`/`wantFbx` and emit `.glb`/`.fbx`.
- [x] 4.4 Extend `exportResultFiles` and `exportBatch` to honor new flags.
- [x] 4.5 RED: add integration test asserting `collectResultFiles` includes new formats when requested.
- [x] 4.6 GREEN: run integration tests until passing.

## Phase 5: Spec Merge and Verification

- [x] 5.1 Merge PBR delta into `openspec/specs/per-palette-pbr-materials/spec.md`.
- [x] 5.2 Run full suite: `node --test --test-reporter=spec tests/voxelizer.test.js`.
- [x] 5.3 Run syntax checks: `node --check voxelizer/voxio.js && node --check voxelizer/app.js`.
- [x] 5.4 Verify existing OBJ/VOX export tests still pass.
