# Delta for fbx-ascii-export

## MODIFIED Requirements

### Requirement: Static mesh geometry

The serializer MUST emit a `Model` node with `Type: "Mesh"` and a `Geometry` node containing vertices, polygon vertex indices, and normals derived from the selected LOD face list.
(Previously: geometry derived from `result.greedyFacesList`.)

#### Scenario: Cube mesh

- GIVEN a 1×1×1 voxel result and the high LOD face list
- WHEN `exportFBX()` runs
- THEN output contains a `Model` node linked to a `Geometry` node

#### Scenario: Triangle polygons

- GIVEN a single voxel and the high LOD face list
- WHEN `exportFBX()` runs
- THEN `PolygonVertexIndex` has 36 entries with every third value negative

### Requirement: Error handling

The serializer MUST reject invalid, empty, or oversized inputs with a descriptive error.
(Previously: empty check referenced `result.greedyFacesList`.)

#### Scenario: Empty selected LOD face list

- GIVEN the selected LOD face list is empty
- WHEN `exportFBX()` runs
- THEN it throws or rejects with a message stating the result is empty

#### Scenario: Oversized output

- GIVEN a result whose ASCII representation would exceed safe memory limits
- WHEN `exportFBX()` runs
- THEN it throws a clear memory budget error
