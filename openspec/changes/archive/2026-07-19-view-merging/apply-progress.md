# Apply Progress: view-merging — Unit 4 (Cleanup)

## Status

- Change: view-merging
- Unit: 4 (Cleanup — disabled selector + axis hint)
- Mode: Strict TDD
- Apply state: all_done
- Delivery: auto-chain, stacked-to-main, 800-line budget

## Completed Tasks

### Unit 1 (Foundation + UI role selector) — completed in earlier batches

- [x] 1.1 Add `role: 'front'` to item record in `voxelizer/app.js`.
- [x] 1.2 Add `findModel(rec)` returning same-base-name siblings.
- [x] 1.3 Generalize `getItemViews(rec)` to emit role-tagged canvases for the active model.
- [x] 1.4 Persist `role` in `voxelizer/batch.js` manifest snapshots.
- [x] 1.5 Make `jobAt()` create jobs only for `front` records and attach sibling views.
- [x] 4.1 Add role `<select>` per batch item in `voxelizer/index.html`.
- [x] 4.2 Render selector in `addItem()`, update `rec.role` on change, and trigger `recompute()`.
- [x] 4.3 Update batch drop hint to reflect multi-view semantics.
- [x] 5.3 Verify existing `side`/`top` regression tests still pass.
- [x] 5.4 Run `node --check` on all modified scripts and full test suite.

### Unit 2 (Back-view silhouette fusion) — completed in previous batch

- [x] 2.1 RED: test `normalizeViewInputs` accepts `back` and rejects unsupported roles.
- [x] 2.2 GREEN: add `back` to `CANONICAL_ORIENTATIONS` and role validation.
- [x] 2.3 Prepare `back` silhouettes at `W × H` and wire `_viewSample`/`_viewWeight` (frontWeight).
- [x] 2.4 Include `back` in `buildHull()` and `fuseVoxelColors()` `-Z` face blending.
- [x] 5.1 RED/GREEN: front+back fusion footprint test.

### Unit 3 (Left/right/top silhouette roles) — completed in previous batch

- [x] 3.1 RED: test `_viewSample` maps `left`/`right`/`top` per design axes.
- [x] 3.2 GREEN: add `left`/`right`/`top` orientations and validation.
- [x] 3.3 Prepare `left`/`right` at `D × H` and `top` at `W × D`.
- [x] 3.4 Wire `_viewSample`/`_viewWeight` (left/right → sideWeight, top → topWeight).
- [x] 3.5 Include new roles in `buildHull()` and `fuseVoxelColors()` face blending.
- [x] 5.2 RED/GREEN: front+back+right Z-bounds test.

### Unit 4 (Cleanup — disabled selector + axis hint) — completed in this batch

- [x] 6.1 RED/GREEN: disable role selector for items without a front sibling.
- [x] 6.2 RED/GREEN: add inline axis hint for role selector.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `voxelizer/voxel.js` | Modified | Exported `CANONICAL_ORIENTATIONS` so the UI can read the single source of truth for canonical axis mapping. |
| `voxelizer/app.js` | Modified | Added `roleAxisHint()`, `hasFrontSibling()`, and `refreshRoleSelectors()` helpers; modified `addItem()` to render a `<span class="role-hint">` next to the role selector, store `roleSel` on the record, and refresh all selector disabled states and hints whenever an item is added or a role changes. |
| `voxelizer/index.html` | Modified | Added `.role:disabled` and `.role-hint` CSS for the batch role selector. |
| `tests/voxelizer.test.js` | Modified | Added `dispatchEvent` to `fakeElement`; added seven focused RED-GREEN tests covering `roleAxisHint`, `hasFrontSibling`, disabled selector state, enabled selector state, hint rendering, hint update on role change, and sibling selector enablement when a front view is added. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 4.1 | `tests/voxelizer.test.js` | Unit | 91/91 passing | Written | 97/97 passing | 2 cases | Clean |
| 1.2 | `tests/voxelizer.test.js` | Unit | 91/91 passing | Written | 97/97 passing | 3 cases | Clean |
| 1.3 | `tests/voxelizer.test.js` | Unit | 91/91 passing | Written | 97/97 passing | 2 roles | Clean |
| 1.4 | `tests/voxelizer.test.js` | Unit | 91/91 passing | Written | 97/97 passing | 2 cases | Clean |
| 1.5 | `tests/voxelizer.test.js` | Unit | 91/91 passing | Written | 97/97 passing | 2 cases | Clean |
| 2.1 | `tests/voxelizer.test.js` | Unit | 97/97 passing | Written | 101/101 passing | 2 cases | Clean |
| 2.2 / 2.3 | `tests/voxelizer.test.js` | Unit | 97/97 passing | Written | 101/101 passing | 2 cases | Clean |
| 2.4 / 5.1 | `tests/voxelizer.test.js` | Unit | 97/97 passing | Written | 101/101 passing | 2 cases | Clean |
| 2.4 (color) | `tests/voxelizer.test.js` | Unit | 97/97 passing | Written | 101/101 passing | 2 cases | Clean |
| 3.1 | `tests/voxelizer.test.js` | Unit | 103/103 passing | Written | 109/109 passing | 3 roles + invalid orientation | Clean |
| 3.2 / 3.3 | `tests/voxelizer.test.js` | Unit | 103/103 passing | Written | 109/109 passing | 3 roles with distinct dimensions | Clean |
| 3.4 | `tests/voxelizer.test.js` | Unit | 103/103 passing | Written | 109/109 passing | 3 views, 2 weight values | Clean |
| 3.5 / 5.2 | `tests/voxelizer.test.js` | Unit | 103/103 passing | Written | 109/109 passing | 2 cases (intersection + wider back) | Clean |
| 3.5 (color) | `tests/voxelizer.test.js` | Unit | 103/103 passing | Written | 109/109 passing | 2 cases (right + top) | Clean |
| 6.1 | `tests/voxelizer.test.js` | Unit | 109/109 passing | Written | 116/116 passing | 2 cases (disabled + enabled) | Clean |
| 6.2 | `tests/voxelizer.test.js` | Unit | 109/109 passing | Written | 116/116 passing | 2 cases (initial + update) | Clean |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `node --test --test-reporter=spec tests/voxelizer.test.js` |
| Focused test result | 116 tests passing, 0 failing (was 109 before Unit 4; added 7 focused tests) |
| Syntax check command | `node --check voxelizer/voxel.js && node --check voxelizer/batch.js && node --check voxelizer/app.js && node --check tests/voxelizer.test.js` |
| Syntax check result | All modified JS files pass `node --check` |
| Runtime harness | `node --test tests/voxelizer.test.js` covers role selector disabled state, axis hint rendering and updates, and sibling selector enablement when a front view is added. |
| Rollback boundary | `voxelizer/app.js` (role selector helpers, disabled state, hint wiring), `voxelizer/voxel.js` (`CANONICAL_ORIENTATIONS` export), `voxelizer/index.html` (role-hint CSS), `tests/voxelizer.test.js` (Unit 4 tests). |

## Deviations from Design

- The design's open question asked whether the role selector should be hidden or disabled for items without a front sibling. The implementation chose to disable the selector and show a tooltip, keeping the selector visible and explaining why it is inactive.
- The design did not specify exact hint text; the implementation uses the canonical horizontal and vertical axes from `CANONICAL_ORIENTATIONS` (e.g., `+X / -Y` for front).

## Issues Found

None. All existing tests continue to pass; no pre-existing failures were encountered.

## Remaining Tasks

- None.

## Workload / PR Boundary

- Mode: chained PR slice (auto-chain, stacked-to-main), 800-line budget.
- Current work unit: Unit 4 — Cleanup (disabled role selector + inline axis hint).
- Boundary: UI-only cleanup in `voxelizer/app.js`, `voxelizer/index.html`, `voxelizer/voxel.js` (CANONICAL_ORIENTATIONS export), and focused tests in `tests/voxelizer.test.js`.
- Estimated review budget impact: ~50–80 lines of authored code plus ~80 lines of focused tests; well under the 400-line slice budget.

## Next Recommended

`sdd-verify`.
