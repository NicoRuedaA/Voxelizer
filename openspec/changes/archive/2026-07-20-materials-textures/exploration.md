## Exploration: materials-textures

### Current State

The voxelizer palette editor is in place. The palette is an array of `[r, g, b]` arrays produced by `voxel.js` and remapped by `palette-io.js`. The renderer uses a single `MeshBasicMaterial` with `vertexColors: true` and shades faces by palette index. The OBJ exporter groups faces by color and writes one `.mtl` entry per palette index; the VOX exporter remaps colors by RGB and writes a fixed 256-entry palette.

Existing "material awareness" in `voxel.js` is a reconstruction feature: it clusters RGB evidence across views to decide which voxels belong to the hull. It is not a rendering material system and has no metallic/roughness/emissive properties.

There is no texture projection pipeline. The original sprite is consumed during quantization and discarded; only the reduced palette survives. Faces carry `corners`, `normal`, and `color`, but no UVs, material references, or per-face PBR attributes.

### Affected Areas

- `voxelizer/voxel.js` — `quantize()` and `fuseVoxelColors()` currently emit an RGB-only palette. Any material/texture data must either be attached here or derived later from the palette and the original sprite.
- `voxelizer/app.js` — `buildModel()` creates one mesh with `MeshBasicMaterial`. It must be extended to support material groups or material properties. The palette editor state (`state.paletteEdit`) needs parallel material state and UI wiring.
- `voxelizer/index.html` — the palette section needs per-swatch material controls (metallic/roughness/emissive toggles or inputs) and a texture-projection mode selector.
- `voxelizer/palette-io.js` — `.gpl` and `.pal` only carry RGB. Persisting M/R/E values will require a companion format or an extended file convention.
- `voxelizer/voxio.js` — `exportOBJ()` can write PBR-like MTL properties, but `exportVox()` is limited to RGBA because the MagicaVoxel format has no standard PBR chunk. Texture projection requires UV export, which OBJ supports but VOX does not.
- `tests/voxelizer.test.js` — needs deterministic tests for material table parsing, remapping, and export formatting, plus fake `THREE` material types for `app.js` tests.
- `openspec/config.yaml` — `strict_tdd: true` applies; any new pure utility must be added with tests first.

### Approaches

1. **Per-palette PBR material properties (M/R/E)**
   - Keep the palette as RGB. Add a parallel `materials` table with `{metallic, roughness, emissive}` per palette index.
   - In `buildModel()`, group faces by palette index and create one `MeshStandardMaterial` per group with the palette color and PBR values. This is correct but increases draw calls.
   - In `exportOBJ()`, write MTL entries with `Pm`, `Pr`, and `Ke` extensions (or `illum` + annotations). Keep VOX export RGB-only.
   - Defaults are `0`, so existing models are unchanged until the user edits them.
   - Pros: minimal change to the existing palette and color pipeline; natural extension of the palette editor; export to OBJ is straightforward; fits within the 800-line budget.
   - Cons: preview becomes N draw calls instead of one; VOX cannot carry PBR data; `.gpl`/`.pal` need a separate sidecar or extended format to persist material values.
   - Effort: Medium

2. **Front-face texture projection from the sprite**
   - Preserve the original sprite as a texture atlas. For each front-facing face, assign UVs based on the source pixel coordinates.
   - Use a `MeshBasicMaterial` with the sprite texture and either white vertex colors or texture-only coloring for front faces; keep vertex colors for other faces.
   - Export to OBJ with a linked texture and UV coordinates; VOX export remains RGB-only.
   - Pros: gives the voxel model the exact look of the source sprite on exposed front faces; leverages the existing front-facing face identification in `fuseVoxelColors()`.
   - Cons: requires UV generation in the face pipeline, changes to `buildModel()` material setup, and a texture upload path; side/back/top faces need a fallback policy (solid color, darken, or repeat edge pixels); larger than the material-properties slice.
   - Effort: Medium–High

3. **Combined material properties + texture projection in one slice**
   - Add both M/R/E and UV texture projection simultaneously, with a unified material system where palette entries can optionally reference a texture region.
   - Pros: one cohesive feature delivery.
   - Cons: exceeds the 800-line review budget and the auto-chain safety window; couples two unrelated technical changes (PBR attributes vs UV generation); harder to debug and review.
   - Effort: High

### Recommendation

Use **Approach 1** as the first slice in the auto-chain. It extends the existing palette editor with the smallest blast radius, preserves the deterministic RGB pipeline, and keeps the change under the 800-line budget. Texture projection (Approach 2) should be the second chained slice after the material-property renderer/export path is solid.

A viable first-slice plan:
1. Add a parallel `materials` table to `state.paletteEdit` and to the voxelization result (default all zeros).
2. Add per-swatch material controls in the palette section of `index.html`.
3. Update `buildModel()` to group faces by palette index and render with `MeshStandardMaterial` when the material table is active; keep `MeshBasicMaterial` as the default path to avoid regressions.
4. Extend `exportOBJ()` to emit M/R/E in the `.mtl` file.
5. Add Node tests for the material table and export formatting.
6. Defer `.gpl`/`.pal` material persistence to a follow-up; for the first slice, material values are session-only.

### Risks

- `MeshStandardMaterial` requires a light source; the current scene has no lights, so the preview may appear black or flat unless lighting is added or the material emissive channel is used.
- Switching from one mesh to a material-grouped mesh increases draw calls; large models may see a preview performance drop, but greedy meshing already reduces face count.
- VOX export cannot represent PBR properties, so users will see the preview with materials but the exported `.vox` will only contain RGB. This must be documented in the UI.
- `.gpl` and `.pal` are RGB-only; if material persistence is deferred, users lose edits on reload. The UI should make this clear.
- The term "material" is already used for reconstruction material awareness in `voxel.js`; naming collisions are likely and must be avoided (e.g., use `pbr` or `surfaceMaterial` for the new concept).
- The fake `THREE` objects in `tests/voxelizer.test.js` do not include `MeshStandardMaterial` or lighting; app tests will need to be updated to support the new renderer path.
- Without texture projection, emissive is the only property that visibly changes the preview under the current unlit scene; metallic and roughness will need at least one light to be meaningful.

### Ready for Proposal

Yes. The next phase is `sdd-propose` for `materials-textures`. The proposal should choose the per-palette PBR material-properties slice as the first PR in the auto-chain, keep texture projection as the second slice, document the VOX/PAL/GPL limitations, and define a rollback plan that restores the single-mesh `MeshBasicMaterial` preview path.
