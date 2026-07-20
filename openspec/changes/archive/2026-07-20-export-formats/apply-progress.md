# Apply Progress: export-formats — Unit 3 (PR #3) merged with Units 1–2

## Change

- **Change name**: `export-formats`
- **Work unit**: Unit 3 — UI toggles + app wiring + integration tests + spec merge (PR #3)
- **Mode**: Strict TDD
- **Artifact store**: Hybrid (Engram `sdd/export-formats/apply-progress` + this OpenSpec file)
- **Date**: 2026-07-20

## Completed Tasks

### Phase 1: Foundation

- [x] 1.1 RED: add test asserting `buildIndexedMesh` emits outward winding matching `exportOBJ`.
- [x] 1.2 GREEN: implement `buildIndexedMesh(result, opts)` in `voxelizer/voxio.js` returning positions, normals, indices, material indices, optional AO colors.
- [x] 1.3 Export `exportGLB` and `exportFBX` stubs from `VoxIO`.

### Phase 2: GLB Serializer

- [x] 2.1 RED: add test asserting `exportGLB` throws empty error for empty `greedyFacesList`.
- [x] 2.2 RED: add test asserting GLB magic `glTF`/version 2 and JSON+BIN chunks.
- [x] 2.3 RED: add test asserting 12 triangles for a 1×1×1 voxel.
- [x] 2.4 RED: add test asserting centroid at origin and `opts.scale` applied.
- [x] 2.5 RED: add test asserting PBR `metallicFactor`/`roughnessFactor`/`emissiveFactor`.
- [x] 2.6 GREEN: implement `exportGLB` glTF JSON, accessors, bufferViews, and chunk writer.
- [x] 2.7 Implement `UNSIGNED_SHORT` → `UNSIGNED_INT` promotion when `faces*6 > 65535`.
- [x] 2.8 Implement optional `COLOR_0` vertex colors with AO modulation.

### Phase 3: FBX Serializer

- [x] 3.1 RED: add test asserting `exportFBX` throws empty error for empty `greedyFacesList`.
- [x] 3.2 RED: add test asserting FBX header and top-level sections.
- [x] 3.3 RED: add test asserting `Model:Mesh`, `Geometry`, and 36 `PolygonVertexIndex` entries.
- [x] 3.4 RED: add test asserting Y-up `GlobalSettings` and `opts.scale` applied.
- [x] 3.5 RED: add test asserting metallic/roughness/emissive material properties.
- [x] 3.6 GREEN: implement `exportFBX` header, `GlobalSettings`, `Objects`, `Connections`.
- [x] 3.7 Implement FBX ASCII output memory budget guard.

### Phase 4: UI and App Wiring

- [x] 4.1 Add `fmtGlb` and `fmtFbx` checkboxes to `voxelizer/index.html` Export group.
- [x] 4.2 Wire `fmtGlb`/`fmtFbx` click handlers in `voxelizer/app.js`.
- [x] 4.3 Extend `collectResultFiles` to accept `wantGlb`/`wantFbx` and emit `.glb`/`.fbx`.
- [x] 4.4 Extend `exportResultFiles` and `exportBatch` to honor new flags.
- [x] 4.5 RED: add integration test asserting `collectResultFiles` includes new formats when requested.
- [x] 4.6 GREEN: run integration tests until passing.

### Phase 5: Spec Merge and Verification

- [x] 5.1 Merge PBR delta into `openspec/specs/per-palette-pbr-materials/spec.md`.
- [x] 5.2 Run full suite: `node --test --test-reporter=spec tests/voxelizer.test.js`.
- [x] 5.3 Run syntax checks: `node --check voxelizer/voxio.js && node --check voxelizer/app.js`.
- [x] 5.4 Verify existing OBJ/VOX export tests still pass.

## Files Changed (Unit 3)

| File | Action | What Was Done |
|------|--------|---------------|
| `voxelizer/index.html` | Modified | Added `fmtGlb` and `fmtFbx` `.chk` buttons in the Export group with descriptive metadata. |
| `voxelizer/app.js` | Modified | Added `downloadHistory` seam; extended `collectResultFiles`/`exportResultFiles` with `wantGlb`/`wantFbx`; wired `fmtGlb`/`fmtFbx` click handlers and default-on state; updated `exportBtn` and `exportBatch` to read the new toggles and include the formats in output; exposed `collectResultFiles`, `exportBatch`, and `downloadHistory` on `__dbg`. |
| `tests/voxelizer.test.js` | Modified | Added Unit 12 integration tests: toggle presence/wiring, `collectResultFiles` includes/excludes `.glb`/`.fbx`, and `exportBatch` includes the new formats in the ZIP. |
| `openspec/specs/per-palette-pbr-materials/spec.md` | Modified | Merged the PBR export delta: replaced the OBJ-only PBR requirement with the cross-format requirement covering `.mtl`, `.glb`, and `.fbx`, and added the material-index alignment requirement. |
| `openspec/changes/export-formats/tasks.md` | Modified | Marked Phase 4 and Phase 5 tasks complete. |
| `openspec/changes/export-formats/apply-progress.md` | Created/Updated | This cumulative apply-progress artifact. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `tests/voxelizer.test.js` | Integration | ✅ 194/194 pre-existing | ✅ Written | ✅ Passed | ✅ Toggle off/on/off-on cycle | ➖ None needed |
| 4.3 | `tests/voxelizer.test.js` | Unit | ✅ 194/194 pre-existing | ✅ Written | ✅ Passed | ✅ With glb/fbx, without glb/fbx, obj/vox only | ➖ None needed |
| 4.4 | `tests/voxelizer.test.js` | Integration | ✅ 194/194 pre-existing | ✅ Written | ✅ Passed | ✅ glb/fbx only + all four formats | ➖ None needed |
| 5.1 | `openspec/specs/per-palette-pbr-materials/spec.md` | Spec | N/A (doc merge) | N/A | ✅ Merged | ➖ Single delta | ➖ None needed |
| 5.2–5.4 | `tests/voxelizer.test.js` | Verification | ✅ 194/194 pre-existing | N/A | ✅ 200/200 | ➖ Full suite + syntax checks | ➖ None needed |

## Test Summary

- **Total tests written**: 6 (Unit 3 focused tests)
- **Total tests passing**: 6/6 focused + 200/200 full suite
- **Layers used**: Integration (4), Unit (2)
- **Approval tests**: None — no refactoring tasks
- **Pure functions created**: None — behavior is UI/app wiring

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `node --test --test-name-pattern="fmtGlb|fmtFbx|collectResultFiles|exportBatch" --test-reporter=spec tests/voxelizer.test.js` → 6 tests passing |
| Runtime harness command/scenario and exact result | Manual: open `voxelizer/index.html`, toggle `.glb`/`.fbx`, click Exportar modelo or Exportar batch, and verify the downloaded file/zip contains the selected formats. No automated browser harness exists in this project. |
| Rollback boundary | Revert the Export group in `voxelizer/index.html`; revert `collectResultFiles`, `exportResultFiles`, `exportBatch`, `exportBtn`, and format toggle wiring in `voxelizer/app.js`; remove the Unit 12 test block from `tests/voxelizer.test.js`; revert the PBR delta in `openspec/specs/per-palette-pbr-materials/spec.md`. |

## Deviations from Design

None — implementation matches design.

## Issues Found

None.

## Remaining Tasks

All tasks for the `export-formats` change are complete.

## Workload / PR Boundary

- **Mode**: `auto-chain`, chain strategy `stacked-to-main`
- **Current work unit**: Unit 3 / PR 3
- **Scope of this batch**: UI toggles (`fmtGlb`/`fmtFbx`), app wiring, `collectResultFiles`/`exportResultFiles`/`exportBatch` format flag integration, focused Node integration tests, and PBR spec merge
- **Files touched**: `voxelizer/index.html`, `voxelizer/app.js`, `tests/voxelizer.test.js`, `openspec/specs/per-palette-pbr-materials/spec.md`, `openspec/changes/export-formats/tasks.md`, `openspec/changes/export-formats/apply-progress.md`
- **Estimated review budget impact**: This slice is focused on UI/app wiring and stays well within the 800-line effective budget for PR 3.

## Status

28/28 tasks complete. Unit 3 (UI toggles + app wiring / PR 3) ready. The `export-formats` change is complete across Units 1–3 and ready for verify/archive.