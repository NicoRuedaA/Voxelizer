# Depth Orthographic Remediation Specification

## Purpose

Define bounded depth, cameras, invalidation, VOX export, and worker fallback without regressing material-aware v3.

## Requirements

### Requirement: Profile Depth Policy

The system MUST accept depths from 1 through 256 and derive Match Profile depth from the selected valid side-frame width, clamped to that range. Matching MUST be unavailable without a valid side view or during preview or batch work.

#### Scenario: Match a selected side frame

- GIVEN a valid selected side frame with width 300
- WHEN the user invokes Match Profile
- THEN the depth MUST become 256 rather than using the full sheet width

#### Scenario: Reject invalid side pixels

- GIVEN side pixels whose dimensions or RGBA byte count are invalid
- WHEN Match Profile state is evaluated
- THEN the action MUST be disabled with no derived depth

#### Scenario: Disable matching while busy

- GIVEN a valid side view and active preview or batch work
- WHEN Match Profile state is evaluated
- THEN the action MUST be disabled

### Requirement: Camera Modes and Fit

The system MUST provide Perspective, Front, Profile, and Top modes. Orthographic modes MUST use canonical axes and lock rotation and auto-rotation. Every mode MUST fit every legal model without clipping.

#### Scenario: Traverse camera modes

- GIVEN a Perspective auto-rotate preference
- WHEN the user traverses Front, Profile, Top, and returns to Perspective
- THEN each mode MUST use its correct camera and controls
- AND Perspective MUST restore the stored preference
- AND routine recomputation MUST preserve ordinary Perspective orbit

#### Scenario: Display maximum legal depth

- GIVEN a 1×1×256 model
- WHEN any camera mode is activated, resized, or reset
- THEN the complete model MUST remain inside its frustum and clip planes

### Requirement: Stale Result Invalidation

The system MUST clear prior geometry, diagnostics, and statistics when reconstruction starts or fails, and disable export until a valid result exists.

#### Scenario: Reconstruction fails

- GIVEN a previously rendered valid result
- WHEN the next reconstruction fails
- THEN old mesh, wireframe, statistics, and diagnostics MUST be cleared
- AND export MUST be disabled

#### Scenario: Reconstruction succeeds

- GIVEN material-aware v3 input
- WHEN reconstruction completes successfully
- THEN the new valid result MUST replace stale state without losing material behavior

### Requirement: Bounded VOX Export

The system MUST preflight before allocation, preserve palette indices and exact VOX chunks, and enforce an independent export-byte budget.

#### Scenario: Export within budget

- GIVEN a supported palette and occupied voxel count within budget
- WHEN VOX export is requested
- THEN output MUST contain correct SIZE, XYZI, and RGBA bytes
- AND total bytes MUST equal 1096 plus four per occupied voxel

#### Scenario: Export exceeds budget

- GIVEN an otherwise legal solid grid exceeding the export budget
- WHEN VOX export is requested
- THEN it MUST fail with `VOX_EXPORT_BUDGET_EXCEEDED` before allocation

#### Scenario: Palette is unsupported

- GIVEN more colors than valid palette indices can represent
- WHEN VOX export is requested
- THEN export MUST reject rather than corrupt palette references

### Requirement: Bounded Worker Fallback

The system MUST estimate fallback work deterministically, run bounded jobs, reject oversized jobs, and settle all pending jobs after worker failure.

#### Scenario: Small fallback job

- GIVEN worker creation or execution fails for a bounded job
- WHEN fallback is evaluated
- THEN the job MUST execute through synchronous fallback and settle

#### Scenario: Oversized fallback job

- GIVEN worker failure for a job above the synchronous work limit
- WHEN fallback is evaluated
- THEN the job MUST reject with `WORKER_FALLBACK_WORK_EXCEEDED` without blocking the UI

#### Scenario: Worker incarnation fails

- GIVEN multiple pending jobs on a failed worker incarnation
- WHEN the failure is handled
- THEN every pending job MUST settle exactly once
