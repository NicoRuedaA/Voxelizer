# per-palette-pbr-materials Specification

## Purpose

Per-palette physically based rendering (PBR) material properties: metallic, roughness, and emissive. Provides preview rendering and OBJ export so users can see and export surface variation beyond flat color.

## Requirements

### Requirement: Surface material table

The system MUST provide a `surfaceMaterials` table parallel to the RGB palette. Each entry MUST contain `metallic`, `roughness`, and `emissive` as numbers clamped to [0, 1]. Default values MUST be zero.

#### Scenario: Default materials are zero

- GIVEN a voxelization result
- THEN `result.surfaceMaterials` exists with the same length as `result.palette`
- AND every entry has `{metallic: 0, roughness: 0, emissive: 0}`

#### Scenario: Clamped values

- GIVEN a material editor sets metallic to 1.5 or -0.2
- WHEN the value is stored
- THEN it is clamped to 1.0 or 0.0 respectively

### Requirement: PBR preview path

The system MUST render the preview with `MeshStandardMaterial` when any surface material is non-default. When all materials are default, the system MUST keep the existing single-mesh `MeshBasicMaterial` path.

#### Scenario: Emissive swatch glows

- GIVEN a swatch with emissive > 0
- WHEN the preview rebuilds
- THEN that swatch's faces render with emissive color

#### Scenario: Metallic/roughness shows specular response

- GIVEN a swatch with metallic > 0 or roughness < 1
- WHEN the preview rebuilds under the lighting rig
- THEN the faces show specular highlights

#### Scenario: Default palette preserves fast path

- GIVEN all surface materials are default
- WHEN the preview builds
- THEN it uses a single `MeshBasicMaterial` mesh

### Requirement: Preview lighting

The system MUST add a minimal lighting rig to the scene so that metallic and roughness are visible. The rig MUST include ambient light and directional light.

#### Scenario: PBR path has light

- GIVEN a PBR preview is active
- THEN the scene contains ambient and directional lights

#### Scenario: Lights do not break flat path

- GIVEN the default flat preview is active
- THEN the scene still renders correctly

### Requirement: OBJ PBR export

The system MUST emit PBR material extensions in the `.mtl` file for non-default surface materials. The extensions MUST use `Pm` for metallic, `Pr` for roughness, and `Ke` for emissive. Default materials MAY be omitted or written with zero values.

#### Scenario: Metallic roughness export

- GIVEN a surface material with metallic 0.8 and roughness 0.3
- WHEN `exportOBJ()` writes the MTL
- THEN the entry contains `Pm 0.8000` and `Pr 0.3000`

#### Scenario: Emissive export

- GIVEN a surface material with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportOBJ()` writes the MTL
- THEN the entry contains `Ke 0.5000 0.2500 0.0000`

#### Scenario: Default materials omitted

- GIVEN a palette with default materials
- WHEN `exportOBJ()` writes the MTL
- THEN Pm/Pr/Ke lines MAY be omitted or contain zeros

### Requirement: Palette editor surface material controls

The system MUST expose per-swatch inputs for metallic, roughness, and emissive in the palette editor. Edits MUST update the edited surface materials and trigger a preview rebuild.

#### Scenario: Edit metallic

- GIVEN the user edits a swatch's metallic value
- WHEN the edit is confirmed
- THEN `state.paletteEdit.surfaceMaterials` updates
- AND the preview rebuilds

#### Scenario: Edit roughness

- GIVEN the user edits a swatch's roughness value
- WHEN the edit is confirmed
- THEN `state.paletteEdit.surfaceMaterials` updates
- AND the preview rebuilds

#### Scenario: Edit emissive

- GIVEN the user edits a swatch's emissive value
- WHEN the edit is confirmed
- THEN `state.paletteEdit.surfaceMaterials` updates
- AND the preview rebuilds

### Requirement: Material index remapping

The system MUST remap `surfaceMaterials` alongside palette colors when the palette is reordered or merged. The remapped table MUST align with the edited palette indices.

#### Scenario: Reorder preserves material mapping

- GIVEN the user reorders a palette entry
- WHEN the preview rebuilds
- THEN the surface material follows the moved color

#### Scenario: Merge preserves target material

- GIVEN the user merges a source color into a target color
- WHEN the preview rebuilds
- THEN the merged faces use the target's surface material
