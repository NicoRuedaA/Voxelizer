# gltf-glb-export Specification

## Purpose

Serialize voxelization results to a valid glTF 2.0 binary `.glb` static mesh with optional vertex colors, AO, and per-palette PBR materials.

## Requirements

### Requirement: Valid GLB 2.0 binary

The serializer MUST produce a GLB 2.0 file whose header, JSON chunk, and BIN chunk conform to the glTF 2.0 specification and are parseable by standard loaders.

#### Scenario: Header and chunks

- GIVEN a non-empty voxel result
- WHEN `exportGLB()` runs
- THEN the buffer starts with magic `glTF` and version 2
- AND it contains one JSON chunk followed by one BIN chunk

#### Scenario: Loader parseable

- GIVEN a GLB produced by `exportGLB()`
- WHEN parsed by `THREE.GLTFLoader` or `BABYLON.SceneLoader`
- THEN the scene contains one mesh and no parse errors occur

### Requirement: Indexed triangle mesh

The serializer MUST convert `result.greedyFacesList` to an indexed triangle mesh with outward winding consistent with `exportOBJ()`.

#### Scenario: Single cube

- GIVEN a 1×1×1 voxel result
- WHEN `exportGLB()` runs
- THEN the primitive mode is TRIANGLES and the mesh has 12 triangles

#### Scenario: Winding matches OBJ

- GIVEN the same input used for `exportOBJ()`
- WHEN both exporters run
- THEN outward-facing rays hit front faces in both outputs

### Requirement: Coordinate system and scale

The serializer MUST center the mesh at the origin, apply `opts.scale` uniformly, and use a Y-up coordinate system consistent with `exportOBJ()`.

#### Scenario: Center and scale

- GIVEN bounds offset from origin and `opts.scale = 2.5`
- WHEN `exportGLB()` runs
- THEN the mesh centroid is at (0, 0, 0) and vertices are scaled by 2.5

### Requirement: Per-palette PBR materials

The serializer MUST emit one glTF material per palette entry with non-default `surfaceMaterials`, mapping `metallic` to `metallicFactor`, `roughness` to `roughnessFactor`, and `emissive` to `emissiveFactor` multiplied by the palette RGB.

#### Scenario: Metallic roughness

- GIVEN a palette entry with metallic 0.8 and roughness 0.3
- WHEN `exportGLB()` runs
- THEN the material has `pbrMetallicRoughness.metallicFactor = 0.8` and `roughnessFactor = 0.3`

#### Scenario: Emissive

- GIVEN a palette entry with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportGLB()` runs
- THEN the material has `emissiveFactor = [0.5, 0.25, 0.0]`

### Requirement: Vertex colors and AO

The serializer SHOULD support optional vertex colors from the palette and AO modulation when enabled.

#### Scenario: Vertex colors enabled

- GIVEN `opts.vertexColors` is true
- WHEN `exportGLB()` runs
- THEN the primitive includes a `COLOR_0` accessor

#### Scenario: AO modulation

- GIVEN `opts.ao` is true and per-vertex AO values exist
- WHEN `exportGLB()` runs
- THEN vertex colors are multiplied by the AO value

### Requirement: UI toggle

The application MUST expose a `fmtGlb` toggle. When enabled, individual export MUST download a `.glb` and batch export MUST include `.glb` in the ZIP.

#### Scenario: Individual and batch export

- GIVEN `fmtGlb` is checked
- WHEN the user clicks export or runs a batch
- THEN a `.glb` file is downloaded and the batch ZIP contains it

### Requirement: Error handling

The serializer MUST reject invalid, empty, or oversized inputs with a descriptive error.

#### Scenario: Empty result

- GIVEN `result.greedyFacesList` is empty
- WHEN `exportGLB()` runs
- THEN it throws or rejects with a message stating the result is empty

#### Scenario: Index overflow

- GIVEN a mesh requiring more indices than the chosen index type supports
- WHEN `exportGLB()` runs
- THEN it promotes to 32-bit indices or throws a clear error

### Requirement: Batch/ZIP integration

The serializer MUST integrate with `collectResultFiles` and `exportBatch` so `.glb` files are collected and compressed into the batch ZIP.

#### Scenario: Batch ZIP contains GLB

- GIVEN batch mode with `wantGlb` true
- WHEN `exportBatch()` runs
- THEN the ZIP contains result-named `.glb` files
