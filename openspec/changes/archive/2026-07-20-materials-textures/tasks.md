# Tasks: Per-palette PBR material properties and preview lighting

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–900 |
| 400-line budget risk | High |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR #1 data foundation → PR #2 PBR preview/export → PR #3 UI controls |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Data foundation: `surfaceMaterials` table + palette-io remap | PR #1 | `node --test --test-reporter=spec tests/voxelizer.test.js` (new surfaceMaterial tests) | N/A: pure data, no UI | `voxelizer/voxel.js`, `voxelizer/palette-io.js`, plus tests |
| 2 | PBR preview path, lighting rig, OBJ export | PR #2 | `node --test --test-reporter=spec tests/voxelizer.test.js` | Open browser, set M/R/E, verify preview and `.mtl` | `voxelizer/app.js` `buildModel`/lights, `voxelizer/voxio.js` |
| 3 | Palette editor M/R/E controls | PR #3 | `node --test --test-reporter=spec tests/voxelizer.test.js` | Open browser, edit swatch M/R/E, verify preview rebuild | `voxelizer/index.html`, `voxelizer/app.js` editor helpers |

PR #1 base = `feat/materials-textures`; PR #2 base = PR #1 branch; PR #3 base = PR #2 branch.

## Phase 1: Foundation (data model)

- [x] 1.1 RED: Add failing test that `voxelize()` returns `surfaceMaterials` with same length as `palette` and zero defaults.
- [x] 1.2 GREEN: Add `surfaceMaterials` default table to `voxelizer/voxel.js` return object.
- [x] 1.3 RED: Add failing test that `PaletteIO.applyRemap()` remaps `surfaceMaterials` through `indexMap`.
- [x] 1.4 GREEN: Extend `applyRemap()` in `voxelizer/palette-io.js` to remap `surfaceMaterials` alongside `palette`.

## Phase 2: Core PBR path, lighting, and export

- [x] 2.1 RED: Add `FakeMeshStandardMaterial` and failing test that `buildModel()` uses PBR path when any material is non-default.
- [x] 2.2 GREEN: Implement conditional PBR material grouping in `voxelizer/app.js` `buildModel()`; keep flat `MeshBasicMaterial` path when all defaults.
- [x] 2.3 RED: Add failing test that `exportOBJ()` emits `Pm`, `Pr`, and `Ke` for non-default materials.
- [x] 2.4 GREEN: Extend `exportOBJ()` in `voxelizer/voxio.js` to write PBR MTL extensions for non-default entries.
- [x] 2.5 RED: Add failing test that the scene contains ambient and directional lights when PBR path is active.
- [x] 2.6 GREEN: Add minimal ambient + directional light rig to `voxelizer/app.js` scene.

## Phase 3: Palette editor UI

- [x] 3.1 RED: Add failing test that `initPaletteEdit()` copies `result.surfaceMaterials` into `state.paletteEdit`.
- [x] 3.2 GREEN: Extend `initPaletteEdit()` in `voxelizer/app.js` to copy and surface `surfaceMaterials`.
- [x] 3.3 RED: Add failing test that `editSurfaceMaterial()` clamps M/R/E to [0,1] and rebuilds the preview.
- [x] 3.4 GREEN: Add `editSurfaceMaterial()` helper in `voxelizer/app.js` and add per-swatch M/R/E inputs in `voxelizer/index.html`.
- [x] 3.5 GREEN: Update `resetPaletteEdit()`, import, merge, and reorder flows to preserve `surfaceMaterials`.

## Phase 4: Verification

- [x] 4.1 Run `node --test --test-reporter=spec tests/voxelizer.test.js` and fix failures.
- [x] 4.2 Run `node --check` on all modified scripts.
- [ ] 4.3 Manual browser check: emissive glow, metallic specular response, default palette flat-path regression.
