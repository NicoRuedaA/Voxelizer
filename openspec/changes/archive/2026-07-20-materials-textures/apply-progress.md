# Apply Progress: materials-textures — Unit 3 (PR #3) merged with Units 1–2

## Change

- **Change name**: `materials-textures`
- **Work unit**: Unit 3 — Palette editor UI controls for M/R/E (PR #3)
- **Mode**: Strict TDD
- **Artifact store**: Hybrid (Engram `sdd/materials-textures/apply-progress` + this OpenSpec file)
- **Date**: 2026-07-20

## Completed Tasks

### Phase 1: Foundation (data model)

- [x] 1.1 RED: Add failing test that `voxelize()` returns `surfaceMaterials` with same length as `palette` and zero defaults.
- [x] 1.2 GREEN: Add `surfaceMaterials` default table to `voxelizer/voxel.js` return object.
- [x] 1.3 RED: Add failing test that `PaletteIO.applyRemap()` remaps `surfaceMaterials` through `indexMap`.
- [x] 1.4 GREEN: Extend `applyRemap()` in `voxelizer/palette-io.js` to remap `surfaceMaterials` alongside `palette`.

### Phase 2: Core PBR path, lighting, and export

- [x] 2.1 RED: Add `FakeMeshStandardMaterial` and failing test that `buildModel()` uses PBR path when any material is non-default.
- [x] 2.2 GREEN: Implement conditional PBR material grouping in `voxelizer/app.js` `buildModel()`; keep flat `MeshBasicMaterial` path when all defaults.
- [x] 2.3 RED: Add failing test that `exportOBJ()` emits `Pm`, `Pr`, and `Ke` for non-default materials.
- [x] 2.4 GREEN: Extend `exportOBJ()` in `voxelizer/voxio.js` to write PBR MTL extensions for non-default entries.
- [x] 2.5 RED: Add failing test that the scene contains ambient and directional lights when PBR path is active.
- [x] 2.6 GREEN: Add minimal ambient + directional light rig to `voxelizer/app.js` scene.

### Phase 3: Palette editor UI

- [x] 3.1 RED: Add failing test that `initPaletteEdit()` copies `result.surfaceMaterials` into `state.paletteEdit`.
- [x] 3.2 GREEN: Extend `initPaletteEdit()` in `voxelizer/app.js` to copy and surface `surfaceMaterials`.
- [x] 3.3 RED: Add failing test that `editSurfaceMaterial()` clamps M/R/E to [0,1] and rebuilds the preview.
- [x] 3.4 GREEN: Add `editSurfaceMaterial()` helper in `voxelizer/app.js` and add per-swatch M/R/E inputs in `voxelizer/index.html`.
- [x] 3.5 GREEN: Update `resetPaletteEdit()`, import, merge, and reorder flows to preserve `surfaceMaterials`.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `voxelizer/voxel.js` | Modified | `voxelize()` now returns a parallel `surfaceMaterials` array with `{metallic:0, roughness:0, emissive:0}` entries matching `palette.length`. |
| `voxelizer/palette-io.js` | Modified | `applyRemap()` remaps `surfaceMaterials` through `indexMap`, preserving the target material on merge and shrinking the array to `editedPalette.length`. |
| `voxelizer/app.js` | Modified | `buildModel()` detects non-default `surfaceMaterials`, groups faces by palette index, and renders each group with a `MeshStandardMaterial` carrying color, metalness, roughness, and emissive. Keeps the single-mesh `MeshBasicMaterial` flat path when all materials are default. Added an ambient + directional light rig to the scene. `initPaletteEdit()` copies `surfaceMaterials` into `paletteEdit.surfaceMaterials` and `originalSurfaceMaterials`. Added `editSurfaceMaterial(index, prop, value)` helper that clamps to [0,1], marks dirty, and rebuilds preview. `resetPaletteEdit()`, `reorderPaletteColor()`, and `mergePaletteColors()` now preserve and remap `surfaceMaterials`. `buildPreview()` and `effectiveResult()` merge edited surface materials back into original palette space before remapping. `updateSwatches()` renders each swatch as a draggable row containing the color button plus M/R/E numeric inputs wired to `editSurfaceMaterial()`. |
| `voxelizer/voxio.js` | Modified | `exportOBJ()` now reads `result.surfaceMaterials` and emits `Pm`, `Pr`, and `Ke` for non-default entries, with `Ks 1 1 1` and `illum 3`. Default entries remain `Ks 0 0 0` / `illum 1` without PBR lines. |
| `voxelizer/index.html` | Modified | Added `.swatch-item` and `.mat` input styles; changed `.swatches` layout to a column so each swatch row can host the color button and three M/R/E numeric inputs. |
| `tests/voxelizer.test.js` | Modified | Added Unit 8 tests for PBR preview path, flat-path fallback, OBJ PBR export, and scene lighting. Added Unit 9 tests for `initPaletteEdit()` copying surface materials, `editSurfaceMaterial()` clamping and preview rebuild, `resetPaletteEdit()` restoring materials, `reorderPaletteColor()` moving materials, `mergePaletteColors()` discarding source material, `importPaletteFile()` preserving untouched materials, and `updateSwatches()` rendering and wiring M/R/E inputs. Added `tagName` to `fakeElement` for DOM assertions. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases | ✅ Fixed cross-context `deepEqual` |
| 1.2 | `voxelizer/voxel.js` | Unit | ✅ 170/170 | ✅ From 1.1 | ✅ Passed | ➖ Single | ✅ Clean |
| 1.3 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases | ✅ Clean |
| 1.4 | `voxelizer/palette-io.js` | Unit | ✅ 170/170 | ✅ From 1.3 | ✅ Passed | ✅ 2 cases | ✅ Clean |
| 2.1 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases (PBR + flat) | ✅ Shared helper |
| 2.2 | `voxelizer/app.js` | Unit | ✅ 170/170 | ✅ From 2.1 | ✅ Passed | ✅ 2 cases | ✅ Refactored `disposeModel()` |
| 2.3 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases (non-default + default) | ✅ Clean |
| 2.4 | `voxelizer/voxio.js` | Unit | ✅ 170/170 | ✅ From 2.3 | ✅ Passed | ✅ 2 cases | ✅ Clean |
| 2.5 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases (PBR + flat) | ✅ Clean |
| 2.6 | `voxelizer/app.js` | Unit | ✅ 170/170 | ✅ From 2.5 | ✅ Passed | ✅ 2 cases | ✅ Lights added once at scene setup |
| 3.1 | `tests/voxelizer.test.js` | Unit | ✅ 170/170 | ✅ Written | ✅ Passed | ✅ 2 cases (copy + independence) | ✅ Clean |
| 3.2 | `voxelizer/app.js` | Unit | ✅ 171/171 | ✅ From 3.1 | ✅ Passed | ➖ Single | ✅ Clean |
| 3.3 | `tests/voxelizer.test.js` | Unit | ✅ 173/173 | ✅ Written | ✅ Passed | ✅ 2 cases (clamp + invalid index) | ✅ Clean |
| 3.4 | `voxelizer/app.js` + `voxelizer/index.html` | Unit | ✅ 177/177 | ✅ From 3.3/3.4 | ✅ Passed | ➖ Single | ✅ Clean |
| 3.5 | `voxelizer/app.js` | Unit | ✅ 178/178 | ✅ Written | ✅ Passed | ✅ 4 cases (reset/reorder/merge/import) | ✅ Extracted original-space merge for `buildPreview`/`effectiveResult` |

## Test Summary

- **Total tests written**: 18 (Unit 1: 4, Unit 2: 6, Unit 3: 8)
- **Total tests passing**: 18
- **Full suite result**: `tests 178` / `pass 178` / `fail 0`
- **Layers used**: Unit (18)
- **Approval tests**: None — no refactoring tasks
- **Pure functions created**: 0 (behavior added to existing functions)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `node --test --test-reporter=spec tests/voxelizer.test.js` → `tests 178` / `pass 178` / `fail 0` |
| Runtime harness command/scenario and exact result | Open browser, load a sprite, edit a swatch's M/R/E inputs, and verify the preview switches to `MeshStandardMaterial` and the export `.mtl` contains `Pm`/`Pr`/`Ke`. (Manual — no automated browser harness exists in this project.) |
| Rollback boundary | Revert `updateSwatches()`, `editSurfaceMaterial()`, `initPaletteEdit()`, `resetPaletteEdit()`, `reorderPaletteColor()`, `mergePaletteColors()`, and the `buildPreview`/`effectiveResult` merge logic in `voxelizer/app.js`; revert the `.swatch-item`/`.mat` CSS block in `voxelizer/index.html`; remove the Unit 9 test block in `tests/voxelizer.test.js`. |

## Deviations from Design

- The design example for `exportOBJ()` showed `Ke 0.5000 0.2500 0.0000` for RGB `[255, 128, 0]` with emissive `0.5`. The actual rounded value is `0.2510` because `128/255 * 0.5 = 0.25098...`. The implementation uses standard `toFixed(4)` rounding, and the test expectation was adjusted to match the real math.
- The design data flow showed `applyRemap()` consuming the edited `surfaceMaterials` directly. In practice, `buildPreview()`/`effectiveResult()` merge the edited `surfaceMaterials` (which live in edited-palette space) back into original-palette space before calling `applyRemap()`, because `applyRemap()` expects surface materials aligned with the original `indexMap`. This keeps `applyRemap()` unchanged and preserves the existing remap contract.

## Issues Found

None.

## Remaining Tasks

- [ ] 4.1 Run `node --test --test-reporter=spec tests/voxelizer.test.js` and fix failures.
- [ ] 4.2 Run `node --check` on all modified scripts.
- [ ] 4.3 Manual browser check: emissive glow, metallic specular response, default palette flat-path regression.

## Workload / PR Boundary

- **Mode**: `auto-chain` / `feature-branch-chain`
- **Current work unit**: Unit 3 — Palette editor M/R/E controls
- **PR #3 base**: PR #2 branch (Unit 2)
- **Boundary**: This batch adds per-swatch M/R/E inputs in the palette editor, the `editSurfaceMaterial()` helper, and preserves surface materials across reset/import/merge/reorder. It does not add new export formats or further lighting changes.
- **Estimated review budget impact**: ~50 lines of production code + ~75 lines of tests/CSS; within the 800-line unit budget and focused for a chained PR.

## Status

15/18 tasks complete. Unit 3 ready for PR #3; next recommended phase: `sdd-verify` after Phase 4 verification tasks are completed.