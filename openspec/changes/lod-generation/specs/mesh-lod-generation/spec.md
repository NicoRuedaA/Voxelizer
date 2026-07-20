# mesh-lod-generation Specification

## Purpose

Generate level-of-detail voxel face lists by downsampling the voxel grid before greedy mesh extraction.

## Requirements

### Requirement: LOD levels

The system MUST support `mesh.lod` values `high` (1x), `medium` (2x), and `low` (4x), defaulting to `high`.

#### Scenario: Default level

- GIVEN no LOD option is provided
- WHEN `extractMesh()` runs
- THEN it behaves as `high`

#### Scenario: Level selection

- GIVEN `mesh.lod` is set to `medium`
- WHEN `extractMesh()` runs
- THEN the grid is downsampled by 2x before face extraction

### Requirement: Deterministic downsampling

The system MUST downsample by selecting the dominant color in each sample cell, breaking ties by first-found voxel.

#### Scenario: Dominant color

- GIVEN a 2×2×2 cell containing five red and three blue voxels
- WHEN downsampling runs
- THEN the output cell is red

#### Scenario: Tie-breaker

- GIVEN a 2×2×2 cell with equal red and blue counts
- WHEN downsampling runs
- THEN the output cell uses the first-found color in Morton/index order

### Requirement: Per-LOD face extraction

The system MUST run `greedyFaces()` independently on each downsampled grid.

#### Scenario: Medium LOD

- GIVEN a 4×4×4 solid cube and `mesh.lod = medium`
- WHEN `extractMesh()` runs
- THEN it returns a 2×2×2 greedy face list

### Requirement: Topology preservation

Each LOD face list MUST represent a closed manifold: every edge appears exactly twice with opposite winding.

#### Scenario: Closed manifold

- GIVEN any non-empty input and a valid LOD level
- WHEN the LOD face list is built
- THEN every edge is shared by exactly two faces with opposite direction

#### Scenario: Empty downsampling

- GIVEN a grid that downsamples to zero voxels
- WHEN `extractMesh()` runs
- THEN the LOD face list is empty

### Requirement: Export integration

The system MUST pass the selected LOD face list to exporters instead of always using `result.greedyFacesList`.

#### Scenario: Selected list

- GIVEN `mesh.lod = low`
- WHEN `exportGLB()` or `exportFBX()` is invoked
- THEN it receives the low-LOD face list
