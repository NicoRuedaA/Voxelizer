# Proposal: Per-palette PBR material properties and preview lighting

## Intent

The preview is currently unlit and uses a single `MeshBasicMaterial`, so every model looks like a flat plastic toy regardless of its intended surface. This change adds per-palette metallic, roughness, and emissive (M/R/E) properties and a minimal lighting rig so users can see PBR surfaces in the preview before exporting to OBJ.

## Scope

### In Scope
- Per-palette `surfaceMaterials` table with `{metallic, roughness, emissive}` defaults (0).
- Palette-editor UI controls (M/R/E) attached to each swatch.
- `buildModel()` PBR path that groups faces by palette index and renders with `MeshStandardMaterial` + palette color when any material is non-default.
- Minimal lighting rig (ambient + directional) so M/R/E are visible.
- `exportOBJ()` emits PBR MTL entries with `Pm`, `Pr`, `Ke`.
- Node tests for material table parsing, remapping, and export formatting.
- Strict TDD compliance per `openspec/config.yaml`.

### Out of Scope
- Texture projection / UV generation from the sprite (Slice 2).
- Persisting M/R/E in `.gpl`/`.pal` (session-only in Slice 1).
- VOX export PBR support (MagicaVoxel format limitation).
- Complex material systems (normal maps, opacity, transmission).

## Capabilities

> This section is the CONTRACT between proposal and specs phases.
> The sdd-spec agent reads this to know exactly which spec files to create or update.
> Research `openspec/specs/` before filling this in.

### New Capabilities
- `per-palette-pbr-materials`: per-palette metallic/roughness/emissive properties, PBR preview rendering, and OBJ export.

### Modified Capabilities
- `advanced-palette-editor`: add M/R/E editing to the palette editor; extend `applyRemap` to remap surface-material indices alongside palette colors.

## Approach

Keep the RGB palette unchanged and add a parallel `surfaceMaterials` table with clamped 0..1 values. `buildModel()` detects whether any material is non-default; if yes, it groups faces by palette index and creates one `MeshStandardMaterial` per group, otherwise it keeps the single-mesh `MeshBasicMaterial` path for performance. Add a small ambient + directional light to the scene so metallic/roughness are visible. `exportOBJ()` writes PBR MTL extensions (`Pm`, `Pr`, `Ke`) for non-default entries. The palette editor UI adds per-swatch inputs; edits update `state.paletteEdit.surfaceMaterials` and rebuild the preview via the existing `buildPreview()` flow.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/app.js` | Modified | `buildModel()` gets PBR material-group path; scene adds lights; palette editor state holds surface materials. |
| `voxelizer/voxel.js` | Modified | `voxelize()` returns a `surfaceMaterials` table with default values. |
| `voxelizer/palette-io.js` | Modified | `applyRemap()` remaps `surfaceMaterials` alongside palette indices. |
| `voxelizer/voxio.js` | Modified | `exportOBJ()` writes PBR MTL entries. |
| `voxelizer/index.html` | Modified | Palette section adds M/R/E controls per swatch. |
| `tests/voxelizer.test.js` | Modified | New tests for material table; fake `THREE` gets `MeshStandardMaterial`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Preview appears black because `MeshStandardMaterial` needs light | High | Add ambient + directional light; fallback to `MeshBasicMaterial` when all values are default. |
| Draw-call increase from material groups hurts large models | Med | Keep the fast `MeshBasicMaterial` path when no material is edited; greedy meshing already reduces face count. |
| "Material" naming collides with reconstruction material awareness | Med | Use `surfaceMaterial` / `surfaceMaterials` for PBR to avoid confusion with `material` config. |
| VOX export silently drops PBR values | High | UI note that `.vox` only exports RGB; documented in export hints. |

## Rollback Plan

Remove the `surfaceMaterials` table from the voxelization result and `paletteEdit`, revert `buildModel()` to the single `MeshBasicMaterial` path, delete the lighting setup, and revert `exportOBJ()` to the original MTL format. A single revert restores the previous renderer and editor behavior.

## Dependencies

- None external; relies on existing Three.js `MeshStandardMaterial` from the bundled vendor scripts.

## Success Criteria

- [ ] A swatch can be set to emissive and the preview shows it glowing.
- [ ] A swatch can be set to metallic/roughness and the preview shows specular response under the new lights.
- [ ] Exported OBJ `.mtl` contains `Pm`, `Pr`, and `Ke` for edited materials.
- [ ] Default palette produces the same preview as before (no regression).
- [ ] New unit tests pass under `node --test`.
