# Delta for per-palette-pbr-materials

## MODIFIED Requirements

### Requirement: PBR export across supported formats

The system MUST emit PBR material data for non-default `surfaceMaterials` in `.mtl`, `.glb`, and `.fbx` outputs. MTL MUST use `Pm`/`Pr`/`Ke`; GLB MUST use `pbrMetallicRoughness.metallicFactor`/`roughnessFactor` and `emissiveFactor`; FBX MUST use `Material` numeric properties.
(Previously: PBR export was required only for OBJ `.mtl` files.)

#### Scenario: OBJ metallic roughness

- GIVEN a surface material with metallic 0.8 and roughness 0.3
- WHEN `exportOBJ()` writes the MTL
- THEN the entry contains `Pm 0.8000` and `Pr 0.3000`

#### Scenario: OBJ emissive

- GIVEN a surface material with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportOBJ()` writes the MTL
- THEN the entry contains `Ke 0.5000 0.2500 0.0000`

#### Scenario: OBJ default materials omitted

- GIVEN a palette with default materials
- WHEN `exportOBJ()` writes the MTL
- THEN Pm/Pr/Ke lines MAY be omitted or contain zeros

#### Scenario: GLB metallic roughness

- GIVEN a surface material with metallic 0.8 and roughness 0.3
- WHEN `exportGLB()` writes the glTF JSON
- THEN the material has `pbrMetallicRoughness.metallicFactor = 0.8` and `roughnessFactor = 0.3`

#### Scenario: GLB emissive

- GIVEN a surface material with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportGLB()` writes the glTF JSON
- THEN the material has `emissiveFactor = [0.5, 0.25, 0.0]`

#### Scenario: FBX metallic roughness

- GIVEN a surface material with metallic 0.8 and roughness 0.3
- WHEN `exportFBX()` writes the material
- THEN the output contains numeric properties reflecting metallic 0.8 and roughness 0.3

#### Scenario: FBX emissive

- GIVEN a surface material with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportFBX()` writes the material
- THEN the output contains an emissive color scaled by 0.5

## ADDED Requirements

### Requirement: PBR material index alignment

The system MUST ensure that material indices in `.glb` and `.fbx` outputs align with the post-remap palette indices used by the renderer and OBJ export.

#### Scenario: GLB alignment

- GIVEN a palette-reordered result
- WHEN `exportGLB()` serializes it
- THEN each primitive's material index corresponds to the same palette entry as the preview

#### Scenario: FBX alignment

- GIVEN a palette-reordered result
- WHEN `exportFBX()` serializes it
- THEN each polygon's material index corresponds to the same palette entry as the preview
