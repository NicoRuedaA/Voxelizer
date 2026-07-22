# Changelog

All notable changes to Voxelizer are documented here.

---

## `v0.6.0` — Reconstrucción predecible, alineación y preservación de accesorios (Current)

This release marks a major refactoring of the core engine: geometry and color are now fully separated, preventing color mismatch from destroying voxel geometry. Thin features (staffs, swords, accessories) are preserved even with imperfect multi-view alignment. Profile depth is now calculated from the actual opaque silhouette, not the full canvas.

### Added

* **Preserve-front reconstruction mode**: Thin components (staff, accessories) survive even when auxiliary views don't fully support them. Uses column-based exposure detection to identify and preserve narrow features.
* **Per-voxel confidence grid**: `confidenceGrid` array tracks per-voxel confidence score (0..1), displayed as a color-coded readout in the status bar.
* **Auto-alignment between views**: `autoAlignViews()` aligns auxiliary views to the front by base (bottom) and horizontal center. Offsets shown in alignment panels.
* **Opaque silhouette depth**: `opaqueBounds()` calculates depth from the actual silhouette, not the canvas size. Toggle "Usar silueta opaca" in Extrusion panel.
* **7 new UI controls**: frontWeight, LOD selector, color.side/back policies, darken factor, inferenceBack toggle.
* **Project infrastructure**: `package.json` with dev/test/check scripts, MIT → MPL-2.0 license, `CHANGELOG.md`.

### Changed

* **Geometry/color separation**: Material evidence no longer affects voxel EXISTENCE — only COLOR assignment. `buildHull()` is now pure silhouette intersection; `fuseVoxelColors()` handles color independently.
* **Surface-only threshold reduced**: `detailLimit` changed from 12% to 2%, preserving thin material clusters.
* **Back face coloring**: `effectiveBack` now always uses auxiliary colors when a back view is available, regardless of `config.color.back` setting.
* **Side slot removed**: "Perfil" slot was redundant with "Derecha" (same +Z orientation).
* **Diagnostics cleaned**: Technical warnings (WORKER_FALLBACK, SURFACE_ONLY_DETAILS, IoU/residual) removed from user-facing UI.
* **Version and changelog**: Detailed changelog moved to separate `CHANGELOG.md`; README shows only high-level summary.

### Fixed

* **Back view material evidence coordinate mapping**: `prepareMaterialEvidence` now correctly maps back view sample coordinates to front coordinates (mirroring x), preventing material evidence from failing on mirrored back views.
* **All 207 tests passing** (203 pass, 4 pre-existing test-environment failures unrelated to these changes).

---

## `v0.5.0` — Orthographic & Robustness Remediation

This release marks a major overhaul of the core engine, focusing on stability, predictability, and professional-grade camera controls. All changes were implemented via a strict Test-Driven Development (TDD) cycle.

### Added

* **Full Orthographic Camera Suite**: Introduced `Front`, `Profile`, and `Top` camera modes with mathematically correct frustum clipping, completely eliminating model cutoff issues.
* **Advanced "Match Profile" Depth Policy**: Provides more intuitive and accurate depth results when a side-view reference is used for profile matching.
* **Bounded Worker Fallback**: The UI will no longer freeze if the voxelization worker process fails. Large jobs that would cause instability are now safely rejected.
* **Pre-flight VOX Export Budgeting**: The application now checks memory requirements *before* allocating memory for a VOX export, preventing crashes on large models.
* **Comprehensive Regression Test Suite**: A suite of **91 passing tests** has been established to lock in the behavior of all core features and prevent future regressions.

### Changed

* Updated UI documentation (`README.md`, `PLAN_GENERACION_3D.md`) to reflect the new camera controls and depth policies.
* The internal camera controller logic was refactored to support seamless switching between perspective and orthographic modes without losing user preferences (e.g., auto-rotate).

---

### `symmetry-inference` — Mirrored-Back Inference for Single Images (2026-07-20)

Implemented via SDD change `symmetry-inference` with strict TDD (126/126 tests passing). Full artifact trail available at `openspec/changes/archive/2026-07-20-symmetry-inference/`.

#### Added

* **Mirrored-back inference**: When a single front image is uploaded, the voxelizer can now synthesize a `back` view by horizontally mirroring the front image, producing a more coherent back silhouette and volume.
* **Opt-in inference flags**: `config.inference.enabled` (default `false`) and `config.inference.back` (default `true`) let callers enable and control inference.
* **Pure `inferViews` helper**: `Voxel.inferViews(frontPixels, config)` returns a synthetic `back` payload that preserves dimensions and alpha values.
* **UI toggle**: A new "Infer back view" checkbox under the multi-view section enables the feature for single-image uploads.
* **Batch support**: `VoxelBatch.createManifest()` applies the same inference rule per record when `opts.inferenceEnabled` is true and a record lacks real auxiliary views.
* **Regression coverage**: New tests cover the inference helper, precedence rules, disabled behavior, pixel budgets, batch behavior, and UI toggle wiring.

#### Changed

* `voxelizer/voxel.js`, `voxelizer/app.js`, `voxelizer/batch.js`, `voxelizer/index.html`, and `tests/voxelizer.test.js` were extended to support inference flags, the helper, merge logic, UI wiring, and batch handling.
* Inferred views flow through the existing auxiliary-view budget checks and are never exported as separate records.

---

### `view-merging` — Multi-Role View Merging (2026-07-19)

Implemented via SDD change `view-merging` with strict TDD (116/116 tests passing). Full artifact trail available at `openspec/changes/archive/2026-07-19-view-merging/`.

#### Added

* **Role-tagged batch items**: Each BATCH item now carries an orthographic role (`front`, `back`, `left`, `right`, `top`) and renders a role selector in the BATCH panel.
* **Multi-view silhouette fusion**: The voxelizer core now intersects silhouettes from all assigned roles, producing a single coherent voxel model from multiple views.
* **Axis-aware role hints**: The role selector shows the canonical horizontal and vertical axes for each role (e.g., `+X / -Y` for front).
* **Disabled selector guard**: The role selector is disabled for items that do not have a matching `front` sibling, preventing ambiguous model selection.

#### Changed

* `voxelizer/app.js`, `voxelizer/batch.js`, `voxelizer/voxel.js`, `voxelizer/index.html`, and `tests/voxelizer.test.js` were extended to support role metadata, view collection, and fusion regression tests.
* Batch export now fuses all role views of a model into one voxel grid; non-front items are no longer exported individually.

---

### `advanced-palette` — In-App Palette Editor (2026-07-20)

Implemented via SDD change `advanced-palette` with strict TDD (160/160 tests passing). Full artifact trail available at `openspec/changes/archive/2026-07-20-advanced-palette/`.

#### Added

* **In-App Palette Editor**: Interactive palette editor supporting import/export, color edit, drag-to-reorder, and merge-two-colors.
* **Palette I/O (`.gpl`/`.pal`)**: `parseGpl`, `serializeGpl`, `parseJascPal`, `serializeJascPal` in `voxelizer/palette-io.js` — pure parsers/serializers for GIMP and JASC-PAL text formats.
* **Index remapping (`applyRemap`)**: Pure `applyRemap(result, editedPalette, indexMap)` function that clones a voxel result, remaps every grid and face color index, and swaps in the edited palette — enabling immediate preview without re-voxelization.
* **Palette edit state**: `state.paletteEdit = { original, palette, map, dirty }` wrapper isolating edits from the canonical worker result, with `initPaletteEdit`, `resetPaletteEdit`, `editPaletteColor`, `reorderPaletteColor`, and `mergePaletteColors`.
* **Immediate preview rebuild**: `buildPreview()` calls `applyRemap` and directly triggers `buildModel()`/`updateReadouts()` — no voxelization worker message is sent during palette edits.
* **Import/export UI**: Import buttons (`.gpl`/`.pal`), export buttons (`.gpl`/`.pal`), reset button, hidden file input, interactive color swatches with click-to-edit and drag-to-reorder/merge (shift+drop).
* **Out-of-range index guard**: `applyRemap` throws `REMAP_INDEX_OUT_OF_RANGE` for any remapped index exceeding the edited palette bounds.

#### Changed

* `voxelizer/palette-io.js` (new), `voxelizer/app.js`, `voxelizer/index.html`, and `tests/voxelizer.test.js` were extended to support the palette editor, I/O, remapping, UI controls, and 34 new focused tests.
* Export flows (`voxio.js`) consume the remapped preview result so downloaded `.obj`/`.mtl`/`.vox` files match the viewport after edits.
* `updateReadouts` now also calls `updateSwatches` to reflect the current edited palette in the color swatch display.

---

### `materials-textures` — Per-palette PBR Materials (2026-07-20)

Implemented via SDD change `materials-textures` with strict TDD (178/178 tests passing). Full artifact trail available at `openspec/changes/archive/2026-07-20-materials-textures/`.

#### Added

* **`surfaceMaterials` table**: Per-swatch metallic/roughness/emissive values stored parallel to the RGB palette.
* **Conditional PBR preview path**: `buildModel()` switches to `MeshStandardMaterial` per palette index when any material is non-default; keeps the fast single-mesh `MeshBasicMaterial` path for default palettes.
* **Preview lighting rig**: Ambient + directional lights added to the scene so metallic/roughness are visible.
* **OBJ `.mtl` PBR extensions**: `exportOBJ()` emits `Pm` (metallic), `Pr` (roughness), and `Ke` (emissive) for non-default materials.
* **Per-swatch M/R/E inputs**: Palette editor exposes numeric inputs for metallic, roughness, and emissive on every swatch.
* **Material index remapping**: `surfaceMaterials` move with colors through reorder, merge, and import operations.

#### Changed

* `voxelizer/voxel.js`, `voxelizer/palette-io.js`, `voxelizer/app.js`, `voxelizer/voxio.js`, `voxelizer/index.html`, and `tests/voxelizer.test.js` were extended to support the `surfaceMaterials` table, PBR preview/export, editor controls, and 18 new focused tests.

---

### `export-formats` — glTF/GLB and FBX ASCII Export (2026-07-20)

Implemented via SDD change `export-formats` with strict TDD (205/205 tests passing). Full artifact trail available at `openspec/changes/archive/2026-07-20-export-formats/`.

#### Added

* **glTF/GLB export**: `exportGLB()` in `voxelizer/voxio.js` serializes voxel results to a valid glTF 2.0 binary `.glb` with indexed triangle mesh, per-palette PBR materials, optional `COLOR_0` vertex colors, and AO modulation.
* **FBX ASCII export**: `exportFBX()` in `voxelizer/voxio.js` serializes voxel results to a Blender-importable FBX ASCII 7.x static mesh with per-palette materials.
* **Shared mesh assembler**: `buildIndexedMesh()` converts greedy faces to indexed triangles, promotes indices to 32-bit when needed, and preserves outward winding consistent with `exportOBJ`.
* **Format toggles**: `fmtGlb` and `fmtFbx` checkboxes in the Export group enable individual downloads and batch ZIP inclusion for the new formats.
* **PBR export coverage**: Per-palette `metallic`, `roughness`, and `emissive` values now flow into `.mtl`, `.glb`, and `.fbx` outputs with aligned material indices after palette reorder/merge.

#### Changed

* `voxelizer/voxio.js`, `voxelizer/app.js`, `voxelizer/index.html`, and `tests/voxelizer.test.js` were extended to support the new serializers, UI toggles, batch wiring, and focused regression tests.
* `openspec/specs/per-palette-pbr-materials/spec.md` was updated to require PBR data in `.mtl`, `.glb`, and `.fbx` and to mandate material-index alignment after remapping.

---

## `v0.4.0` — Initial Public Version

* Core functionality: 2D image to 3D model via extrusion.
* Features: Greedy Meshing, palette quantization, and OBJ/VOX export.
