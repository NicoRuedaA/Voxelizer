# fbx-ascii-export Specification

## Purpose

Serialize voxelization results to a valid FBX ASCII 7.x `.fbx` static mesh with per-palette materials for DCC tool interchange.

## Requirements

### Requirement: Valid FBX ASCII output

The serializer MUST produce an FBX ASCII 7.x file containing all required top-level sections and importable by Blender.

#### Scenario: Header and sections

- GIVEN a non-empty voxel result
- WHEN `exportFBX()` runs
- THEN output starts with the FBX header comment
- AND contains `FBXHeaderExtension`, `GlobalSettings`, `Documents`, `References`, `Definitions`, and `Objects`

#### Scenario: Blender import

- GIVEN an FBX produced by `exportFBX()`
- WHEN imported into Blender 3.6+
- THEN the import succeeds and the scene contains one mesh object

### Requirement: Static mesh geometry

The serializer MUST emit a `Model` node with `Type: "Mesh"` and a `Geometry` node containing vertices, polygon vertex indices, and normals.

#### Scenario: Cube mesh

- GIVEN a 1×1×1 voxel result
- WHEN `exportFBX()` runs
- THEN output contains a `Model` node linked to a `Geometry` node

#### Scenario: Triangle polygons

- GIVEN a single voxel
- WHEN `exportFBX()` runs
- THEN `PolygonVertexIndex` has 36 entries with every third value negative

### Requirement: Coordinate system and units

The serializer MUST center the mesh, apply `opts.scale`, and declare Y-up global settings.

#### Scenario: Axis and scale

- GIVEN any input and `opts.scale = 2.5`
- WHEN `exportFBX()` runs
- THEN `GlobalSettings` declares Y-up and vertices are scaled by 2.5

### Requirement: Per-palette materials

The serializer MUST emit one FBX `Material` per palette entry with non-default `surfaceMaterials`, mapping `metallic`, `roughness`, and `emissive` to numeric material properties.

#### Scenario: Metallic roughness

- GIVEN a palette entry with metallic 0.8 and roughness 0.3
- WHEN `exportFBX()` runs
- THEN the material contains numeric properties reflecting metallic 0.8 and roughness 0.3

#### Scenario: Emissive

- GIVEN a palette entry with emissive 0.5 and RGB [255, 128, 0]
- WHEN `exportFBX()` runs
- THEN the material contains an emissive color scaled by 0.5

### Requirement: UI toggle

The application MUST expose a `fmtFbx` toggle. When enabled, individual export MUST download a `.fbx` and batch export MUST include `.fbx` in the ZIP.

#### Scenario: Individual and batch export

- GIVEN `fmtFbx` is checked
- WHEN the user clicks export or runs a batch
- THEN a `.fbx` file is downloaded and the batch ZIP contains it

### Requirement: Error handling

The serializer MUST reject invalid, empty, or oversized inputs with a descriptive error.

#### Scenario: Empty result

- GIVEN `result.greedyFacesList` is empty
- WHEN `exportFBX()` runs
- THEN it throws or rejects with a message stating the result is empty

#### Scenario: Oversized output

- GIVEN a result whose ASCII representation would exceed safe memory limits
- WHEN `exportFBX()` runs
- THEN it throws a clear memory budget error

### Requirement: Batch/ZIP integration

The serializer MUST integrate with `collectResultFiles` and `exportBatch` so `.fbx` files are collected and compressed into the batch ZIP.

#### Scenario: Batch ZIP contains FBX

- GIVEN batch mode with `wantFbx` true
- WHEN `exportBatch()` runs
- THEN the ZIP contains result-named `.fbx` files
