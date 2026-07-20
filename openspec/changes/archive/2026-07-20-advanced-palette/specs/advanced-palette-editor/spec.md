# advanced-palette-editor Specification

## Purpose

Define the in-app palette editor for importing, editing, reordering, merging, exporting, and immediately previewing the voxelization palette without re-voxelizing.

## Requirements

### Requirement: Import .gpl palettes

The system MUST parse GIMP `.gpl` files and apply imported colors to the edited palette.

#### Scenario: Successful .gpl import

- GIVEN a valid `.gpl` with `N` colors and at least `N` palette slots
- WHEN the user imports it
- THEN the first `N` edited palette entries are replaced
- AND the preview rebuilds without re-voxelizing

#### Scenario: .gpl import too large

- GIVEN a `.gpl` with more colors than the current palette
- WHEN the user imports it
- THEN the import is rejected and the palette is unchanged

### Requirement: Import JASC-.pal palettes

The system MUST parse JASC-PAL `.pal` files and apply imported colors to the edited palette.

#### Scenario: Successful JASC-.pal import

- GIVEN a valid JASC-PAL file with `N` RGB lines
- WHEN the user imports it
- THEN the first `N` edited palette entries are replaced
- AND the preview rebuilds without re-voxelizing

#### Scenario: Invalid JASC-.pal header

- GIVEN a `.pal` file not starting with `JASC-PAL`
- WHEN the user imports it
- THEN the import is rejected with an unsupported format error

### Requirement: Export palettes

The system MUST export the edited palette to `.gpl` and JASC-`.pal` formats.

#### Scenario: Export .gpl

- GIVEN the edited palette has `N` colors
- WHEN the user exports to `.gpl`
- THEN a valid `.gpl` file with `N` colors is downloaded

#### Scenario: Export JASC-.pal

- GIVEN the edited palette has `N` colors
- WHEN the user exports to `.pal`
- THEN a valid JASC-PAL file with `N` colors is downloaded

### Requirement: Edit colors

The system MUST let users change a palette entry and preview the result.

#### Scenario: Edit single color

- GIVEN the user edits a palette entry to a new RGB value
- WHEN the edit is confirmed
- THEN the entry updates and the preview rebuilds within one frame

### Requirement: Reorder colors

The system MUST let users drag palette entries to new positions and remap indices.

#### Scenario: Drag to reorder

- GIVEN the user drags entry `A` to position `B`
- WHEN the drop is confirmed
- THEN the palette is reordered and all voxel/face indices are remapped

### Requirement: Merge colors

The system MUST let users merge two entries into one.

#### Scenario: Merge two colors

- GIVEN the user selects a source and target color
- WHEN merge is confirmed
- THEN the source entry is removed, its indices map to the target, and the preview rebuilds

### Requirement: Immediate preview

The system MUST rebuild the preview by remapping indices instead of re-voxelizing.

#### Scenario: Preview after change

- GIVEN a palette change has been applied
- WHEN the model rebuilds
- THEN it uses the edited palette and remapped indices
- AND no voxelization worker message is sent

#### Scenario: Out-of-range index guard

- GIVEN a remapping would produce an index outside the edited palette
- WHEN the rebuild is triggered
- THEN the rebuild aborts and an error is logged

### Requirement: Reset edits

The system SHOULD provide a reset action that restores the original palette.

#### Scenario: Reset

- GIVEN the user has modified the palette
- WHEN reset is chosen
- THEN the edited palette and index map revert to `result.palette`
