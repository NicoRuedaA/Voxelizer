# Design: Per-palette PBR material properties and preview lighting

## Technical Approach

Keep the RGB palette unchanged and add a parallel `surfaceMaterials` table with clamped metallic/roughness/emissive values. `voxelize()` returns a default table. `buildModel()` switches to a per-palette `MeshStandardMaterial` path only when any material is non-default; otherwise it keeps the existing fast `MeshBasicMaterial` path. The scene gains a minimal ambient + directional light. `exportOBJ()` writes `Pm`, `Pr`, and `Ke` extensions for non-default entries. The palette editor stores `surfaceMaterials` alongside colors and remaps them through `PaletteIO.applyRemap()`.

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|----------|---------|-----------|--------|
| Material storage | Parallel `surfaceMaterials` array vs extend palette entries | Parallel array keeps existing `result.palette` consumers unchanged and avoids touching voxel grid color semantics | Parallel `surfaceMaterials` array |
| PBR path trigger | Always PBR vs conditional on non-default values | Always PBR is simpler but increases draw calls for every model; conditional preserves fast path for the common default case | Conditional: use PBR only when `surfaceMaterials` has a non-default value |
| Preview lighting | Add ambient + directional vs rely on emissive only | Emissive-only makes metals look black; a small rig is enough and cheap | Ambient + directional lights in the scene |
| OBJ MTL extension | Write Pm/Pr/Ke for all entries vs only non-default | Writing all is simpler but noisy; non-default keeps files smaller | Only non-default entries emit Pm/Pr/Ke |
| Material naming | `surfaceMaterial` vs `material` | `material` collides with the reconstruction-aware material config | `surfaceMaterial` / `surfaceMaterials` |

## Data Flow

```
voxelize()
  └── result.palette
  └── result.surfaceMaterials  (defaults)
        │
        ▼
initPaletteEdit()
  └── state.paletteEdit.palette
  └── state.paletteEdit.surfaceMaterials
        │
        ▼
user edits M/R/E ────────┐
reorder / merge palette ──┤
                          ▼
                   buildPreview()
                          │
                          ▼
              PaletteIO.applyRemap()
                  remaps colors AND surfaceMaterials
                          │
                          ▼
              buildModel(result)
                 ├─ all default? → MeshBasicMaterial (single mesh)
                 └─ any non-default? → MeshStandardMaterial per palette index
                          │
                          ▼
              exportOBJ()
                 writes Pm/Pr/Ke per non-default material
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `voxelizer/voxel.js` | Modify | `voxelize()` returns `surfaceMaterials` array with default `{metallic:0, roughness:0, emissive:0}` entries matching `palette.length`. |
| `voxelizer/palette-io.js` | Modify | `applyRemap()` remaps `surfaceMaterials` through `indexMap` alongside colors. |
| `voxelizer/app.js` | Modify | `initPaletteEdit()` copies `surfaceMaterials`; `buildModel()` adds PBR path; scene adds ambient + directional lights; new `editSurfaceMaterial()` helper. |
| `voxelizer/voxio.js` | Modify | `exportOBJ()` emits `Pm`, `Pr`, `Ke` lines for non-default materials. |
| `voxelizer/index.html` | Modify | Per-swatch M/R/E inputs in the palette editor section. |
| `tests/voxelizer.test.js` | Modify | Add `FakeMeshStandardMaterial`, tests for `surfaceMaterials` defaults, `applyRemap` remapping, and `exportOBJ` PBR output. |

## Interfaces / Contracts

### `surfaceMaterials` entry

```javascript
{
  metallic:  number, // 0..1, default 0
  roughness: number, // 0..1, default 0
  emissive:  number, // 0..1, default 0
}
```

### `result` extension

```javascript
{
  palette: Array<[r,g,b]>,
  surfaceMaterials: Array<{metallic, roughness, emissive}>
}
```

### `applyRemap` extension

`applyRemap(result, editedPalette, indexMap)` returns a new result where `surfaceMaterials` is remapped by `indexMap` exactly like `palette`.

### `exportOBJ` MTL extension

For a non-default material with color `[r,g,b]` and M/R/E values:

```mtl
newmtl color_i
Kd r/255 g/255 b/255
Ka 0 0 0
Ks 1 1 1
Pm 0.8000
Pr 0.3000
Ke 0.5000 0.2500 0.0000
illum 3
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `surfaceMaterials` defaults and length | `loadRuntime()` + `Voxel.voxelize()` assert |
| Unit | `applyRemap` remaps surface materials | `loadPaletteIORuntime()` + reorder/merge fixtures |
| Unit | `exportOBJ` emits `Pm/Pr/Ke` for non-default materials | `VoxIO.exportOBJ()` string assertions |
| Unit | `exportOBJ` omits PBR lines for default materials | `VoxIO.exportOBJ()` `doesNotMatch` assertions |
| Unit | `buildModel` chooses PBR path when material non-default | `loadAppRuntime()` + fake `THREE.MeshStandardMaterial` |
| Unit | `buildModel` keeps flat path when all defaults | `loadAppRuntime()` + existing fake `THREE.MeshBasicMaterial` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. `surfaceMaterials` is session-only and computed with default values for existing results. The flat-path fallback guarantees no visual regression for unedited palettes.

## Open Questions

None.
