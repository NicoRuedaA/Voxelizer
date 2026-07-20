# Archive Report: symmetry-inference

## Change Metadata

- **Change name**: symmetry-inference
- **Archive date**: 2026-07-20
- **Artifact store mode**: hybrid (Engram + OpenSpec)
- **Delivery strategy**: auto-chain
- **Chain strategy**: stacked-to-main
- **Review budget**: 800 lines
- **Preflight**: automatic, both artifacts, skip validation blockers

## Artifact References

| Artifact | Store | Location / Observation ID |
|---|---|---|
| Exploration | Engram | obs-392227c39bec6e5a (#670) |
| Proposal | Engram | obs-c3f5cc698b25699b (#671) |
| Spec | Engram | obs-9ce1ebcd445fc419 (#672) |
| State | Engram | obs-5857bf0a01016e20 (#673) |
| Design | Engram | obs-f7b6edabc6e8549e (#674) |
| Tasks | Engram | obs-dd0e8f483d722ded (#676) |
| Apply Progress | Engram | obs-0e46d50a7f3f7128 (#677) |
| Verify Report | Engram | obs-1f30d1746a0e9cbf (#679) |
| Proposal | OpenSpec | `openspec/changes/symmetry-inference/proposal.md` |
| Spec | OpenSpec | `openspec/changes/symmetry-inference/specs/mirrored-back-inference/spec.md` |
| Design | OpenSpec | `openspec/changes/symmetry-inference/design.md` |
| Tasks | OpenSpec | `openspec/changes/symmetry-inference/tasks.md` |
| Verify Report | OpenSpec | `openspec/changes/symmetry-inference/verify-report.md` |

## Review Gate

- **Status**: No review artifacts present. There is no `reviews/transaction.json`, `ledger.json`, `receipt.json`, or `gate-context.json` in the OpenSpec change folder, and no `sdd/symmetry-inference/review/*` topics in Engram.
- **Disposition**: Archive continued per explicit user instruction to skip validation blockers (`skip_validation_blockers: true` in `state.yaml`).
- **Risk**: No formal review receipt exists. The archive relies on the passing verification report and the completed task list as the acceptance evidence.

## Task Completion Gate

- **OpenSpec tasks.md**: 27/27 implementation tasks checked complete.
- **Engram tasks observation #676**: stale — all checkboxes remain unchecked because the observation was saved before `sdd-apply` ran and was not updated by the apply phase.
- **Reconciliation**: Stale Engram checkboxes were reconciled against OpenSpec `tasks.md` and `verify-report.md` (which states 27/27 complete) per the user's instruction to continue. OpenSpec `tasks.md` is the source of truth for completion visibility.

## Verification Status

- **OpenSpec verify-report.md**: PASS
  - 126/126 tests passing
  - 12/12 scenarios compliant
  - 0 critical findings
  - 0 blockers
  - Build/syntax check passed
- **Stale Engram file `sdd/symmetry-inference/verify-report`**: FAIL (11/12, 125 tests) — superseded by the remediated OpenSpec `verify-report.md`. The missing `Back flag off` regression test was added (obs-1f30d1746a0e9cbf) and the full suite was re-run.

## Spec Sync

- **Domain**: mirrored-back-inference
- **Action**: Created main spec
- **Details**: Delta spec copied directly to `openspec/specs/mirrored-back-inference/spec.md` because no main spec existed.

## Implementation Summary

Implemented mirrored-back inference for single-image voxelization:

- Added `DEFAULT_CONFIG.inference` (`enabled: false`, `back: true`) and `normalizeConfig` merge in `voxelizer/voxel.js`.
- Added `inferViews(frontPixels, config)` pure helper in `voxelizer/voxel.js`.
- Merged inferred `back` view into `voxelize()` before `normalizeViewInputs` when enabled and no real back view exists.
- Added UI toggle for `inferenceEnabled` in `voxelizer/index.html` wired through `voxelizer/app.js`.
- Added local `_mirrorBack` helper in `voxelizer/batch.js`.
- Added regression tests in `tests/voxelizer.test.js`.

## Files Changed

- `voxelizer/voxel.js`
- `voxelizer/app.js`
- `voxelizer/batch.js`
- `voxelizer/index.html`
- `tests/voxelizer.test.js`
- `openspec/specs/mirrored-back-inference/spec.md` (new main spec)
- `README.md` (changelog updated)

## Warnings

- No formal review receipt exists; archive proceeded under user override.
- Engram tasks observation #676 is stale; OpenSpec `tasks.md` is the completion source of truth.
- Engram `sdd/symmetry-inference/verify-report` file is stale; authoritative verification is the OpenSpec `verify-report.md`.
- WARNING from verify-report: `_hasRealBack` only checks `views.views` and ignores top-level `views.back` legacy shape. This is a latent edge case, not an active regression.

## Archive Path

- `openspec/changes/symmetry-inference/` → `openspec/changes/archive/2026-07-20-symmetry-inference/`
