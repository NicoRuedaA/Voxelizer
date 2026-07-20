# Tasks: Mirrored-back inference for single-image voxelization

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 450–650 |
| 800-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Mirrored-back inference end-to-end | PR 1 | `node --test --test-reporter=spec tests/voxelizer.test.js` | Open `voxelizer/index.html` in a browser, upload a single front image, toggle inference | Revert `voxelizer/voxel.js`, `voxelizer/app.js`, `voxelizer/batch.js`, `voxelizer/index.html`, `tests/voxelizer.test.js` |

## Phase 1: Foundation / Config

- [x] 1.1 Add `inference: { enabled: false, back: true }` to `DEFAULT_CONFIG` in `voxelizer/voxel.js`.
- [x] 1.2 Add `inferenceEnabled` legacy patch to `_legacyPatch` and `legacyOptionsFromConfig` in `voxelizer/voxel.js`.
- [x] 1.3 Extend `normalizeConfig` in `voxelizer/voxel.js` to merge and validate `inference.enabled` and `inference.back`.

## Phase 2: Core helper (test-first)

- [x] 2.1 RED test: `Voxel.inferViews` returns `null` when `inference.enabled` is `false`.
- [x] 2.2 RED test: `Voxel.inferViews` mirrors a 2×2 and 3×3 RGBA payload horizontally and preserves alpha.
- [x] 2.3 Implement `inferViews(frontPixels, config)` in `voxelizer/voxel.js` and export it on the `Voxel` namespace.
- [x] 2.4 GREEN: run `node --test --test-reporter=spec tests/voxelizer.test.js` until helper tests pass.

## Phase 3: Merge inferred view into voxelize (test-first)

- [x] 3.1 RED test: with a real `back` view present, enabling inference does not replace it.
- [x] 3.2 RED test: with only a front image and inference enabled, `normalizeViewInputs` receives an inferred `back` payload.
- [x] 3.3 RED test: with inference disabled, inputs remain identical to pre-feature behavior.
- [x] 3.4 Modify `voxelize` in `voxelizer/voxel.js` to merge an inferred `back` view into `views` before `normalizeViewInputs`, only when enabled and no real `back` exists.
- [x] 3.5 GREEN: run focused tests for precedence and disabled behavior.

## Phase 4: Batch support

- [x] 4.1 Add local `_mirrorBack(source)` helper to `voxelizer/batch.js`.
- [x] 4.2 Update `createManifest` in `voxelizer/batch.js` to merge an inferred `back` snapshot into `viewSnapshots` when `opts.inferenceEnabled` is true and no real `back` exists.
- [x] 4.3 RED test: batch manifest with a single front record and `inferenceEnabled` includes one `back` view and no extra records.
- [x] 4.4 GREEN: run batch tests.

## Phase 5: UI wiring

- [x] 5.1 Add `inferenceEnabled: false` to `defaultOpts` and `state.opts` in `voxelizer/app.js`.
- [x] 5.2 Add a toggle row under the Multi-vista section in `voxelizer/index.html`.
- [x] 5.3 Wire the toggle in `voxelizer/app.js` to update `state.opts.inferenceEnabled` and trigger `recompute()`.
- [x] 5.4 Add a hint about mirrored-back colors when `color.mode` is auxiliary in `voxelizer/index.html`.

## Phase 6: Integration tests and verification

- [x] 6.1 Add integration test: single front image with inference enabled produces a back-sampled silhouette and colors.
- [x] 6.2 Add integration test: an inferred view that exceeds `MAX_AUX_PIXEL_COUNT` raises `AUX_PIXEL_BUDGET_EXCEEDED`.
- [x] 6.3 Add integration test: UI toggle updates `state.opts.inferenceEnabled`.
- [x] 6.4 Run full suite: `node --test --test-reporter=spec tests/voxelizer.test.js`.
- [x] 6.5 Run syntax check: `node --check voxelizer/voxel.js && node --check voxelizer/app.js && node --check voxelizer/batch.js`.

## Phase 7: Cleanup

- [x] 7.1 Remove any temporary debug code from modified files.
- [x] 7.2 Review comments and naming in `voxelizer/voxel.js`, `voxelizer/app.js`, and `voxelizer/batch.js`.
