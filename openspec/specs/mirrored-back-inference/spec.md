# mirrored-back-inference Specification

## Purpose

Defines the behavior for synthesizing a `back` view from a single front image by horizontal mirroring when the user opts in.

## Requirements

### Requirement: Opt-in inference flags

The system MUST expose `inference.enabled` (default `false`) and `inference.back` (default `true`). A `back` view MUST be inferred only when both are `true`. When disabled, behavior MUST be identical to the pre-feature behavior.

#### Scenario: Enabled

- GIVEN both flags are `true`
- WHEN a single front image is voxelized
- THEN an inferred `back` view reaches the pipeline

#### Scenario: Back flag off

- GIVEN `inference.enabled` is `true` and `inference.back` is `false`
- WHEN a single front image is voxelized
- THEN no `back` view is inferred

#### Scenario: Disabled

- GIVEN `inference.enabled` is `false`
- WHEN a single front image is voxelized
- THEN the pipeline receives the same inputs as before

### Requirement: Pure inference helper

The system MUST provide a pure `inferViews(frontPixels, config)` helper that returns a synthetic `back` payload when inference is enabled. The payload MUST mirror the front RGBA data horizontally while preserving dimensions. The helper MUST return nothing when disabled.

#### Scenario: Mirror

- GIVEN a valid front pixel payload
- WHEN `inferViews` is called with inference enabled
- THEN the returned `back` payload has the same dimensions and reversed rows

#### Scenario: Alpha

- GIVEN a front payload with transparent, semi-transparent, and opaque pixels
- WHEN `inferViews` produces the `back` payload
- THEN each mirrored pixel has the same alpha as its source

### Requirement: Real views take precedence

The system MUST merge inferred views into the view map before normalization. An inferred view MUST be discarded when a real view of the same role exists.

#### Scenario: Real back wins

- GIVEN a front image and a real `back` image
- WHEN inference is enabled
- THEN the real `back` view is used and the inferred `back` is discarded

#### Scenario: Fills missing role

- GIVEN only a front image and no `back` image
- WHEN inference is enabled
- THEN the inferred `back` view is merged into the view map

### Requirement: Pixel budget validation

Inferred payloads MUST pass the same pixel budget checks as real views. If a budget is exceeded, the system MUST report the same error code.

#### Scenario: Within budget

- GIVEN a front image whose mirrored copy fits within the budgets
- WHEN inference is enabled
- THEN voxelization proceeds without error

#### Scenario: Exceeds budget

- GIVEN a front image whose pixel count exceeds the single-view budget
- WHEN inference is enabled
- THEN the system raises the same budget error as for real views

### Requirement: UI toggle

The web UI MUST expose a toggle that sets the inference-enabled state, and the application state MUST pass it to the voxelization config.

#### Scenario: Toggle on

- GIVEN the inference toggle is off
- WHEN the user turns it on and uploads a single front image
- THEN the config has `inference.enabled` `true`

### Requirement: Batch support

The batch workflow MUST apply the same inference rule per record when enabled and a record lacks real auxiliary views. Inferred views MUST NOT be exported as separate records.

#### Scenario: Single front batch record

- GIVEN a batch record with only a front image and inference enabled
- WHEN the batch manifest is created
- THEN the record includes an inferred `back` view and no extra exported records

### Requirement: Color mode documentation

When the color mode draws from auxiliary views, the system MUST document that the back surface inherits mirrored front colors. The inference feature MUST NOT alter the existing color-propagation contract.

#### Scenario: Auxiliary mode

- GIVEN `color.mode` is `auxiliary` and inference is enabled
- WHEN a single front image is voxelized
- THEN the back surface is colored from the mirrored front image
