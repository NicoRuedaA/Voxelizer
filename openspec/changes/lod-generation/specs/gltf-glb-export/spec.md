# Delta for gltf-glb-export

## MODIFIED Requirements

### Requirement: Indexed triangle mesh

The serializer MUST convert the selected LOD face list to an indexed triangle mesh with outward winding consistent with `exportOBJ()`.
(Previously: always converted `result.greedyFacesList`.)

#### Scenario: Single cube

- GIVEN a 1×1×1 voxel result and the high LOD face list
- WHEN `exportGLB()` runs
- THEN the primitive mode is TRIANGLES and the mesh has 12 triangles

#### Scenario: Winding matches OBJ

- GIVEN the same input and LOD face list used for `exportOBJ()`
- WHEN both exporters run
- THEN outward-facing rays hit front faces in both outputs

### Requirement: Error handling

The serializer MUST reject invalid, empty, or oversized inputs with a descriptive error.
(Previously: empty check referenced `result.greedyFacesList`.)

#### Scenario: Empty selected LOD face list

- GIVEN the selected LOD face list is empty
- WHEN `exportGLB()` runs
- THEN it throws or rejects with a message stating the result is empty

#### Scenario: Index overflow

- GIVEN a mesh requiring more indices than the chosen index type supports
- WHEN `exportGLB()` runs
- THEN it promotes to 32-bit indices or throws a clear error
