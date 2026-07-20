# Tasks: Multi-Role View Merging for Batch Voxelization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1000–1200 (UI + core + tests) |
| Configured review budget | 800 lines |
| 400-line budget risk | High |
| 800-line budget risk | High as single PR; Low per chained slice |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation+UI) → PR 2 (Back core) → PR 3 (Left/Right/Top) → PR 4 (Tests) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Role data model, batch manifest, UI selector | PR 1 | `node --test tests/voxelizer.test.js` | Drop two same-base-name PNGs, set one to back, selector persists | `voxelizer/app.js`, `voxelizer/batch.js`, `voxelizer/index.html` |
| 2 | Back-view silhouette fusion in core | PR 2 | New back-fusion test | Front+back same-base-name pair yields tighter Z footprint | `voxelizer/voxel.js` back additions |
| 3 | Left/right/top silhouette roles in core | PR 3 | New three-view test | N/A — core-only; UI selector already supports roles | `voxelizer/voxel.js` left/right/top additions |
| 4 | Regression tests and validation | PR 4 | `node --test --test-reporter=spec tests/voxelizer.test.js` | `node --check` all modified JS | `tests/voxelizer.test.js` |

## Phase 1: Foundation — Data Model & Batch Manifest

- [x] 1.1 Add `role: 'front'` to item record in `voxelizer/app.js`.
- [x] 1.2 Add `findModel(rec)` returning same-base-name siblings.
- [x] 1.3 Generalize `getItemViews(rec)` to emit role-tagged canvases for the active model.
- [x] 1.4 Persist `role` in `voxelizer/batch.js` manifest snapshots.
- [x] 1.5 Make `jobAt()` create jobs only for `front` records and attach sibling views.

## Phase 2: Core Implementation — Back Role

- [x] 2.1 RED: test `normalizeViewInputs` accepts `back` and rejects unsupported roles.
- [x] 2.2 GREEN: add `back` to `CANONICAL_ORIENTATIONS` and role validation.
- [x] 2.3 Prepare `back` silhouettes at `W × H` and wire `_viewSample`/`_viewWeight` (frontWeight).
- [x] 2.4 Include `back` in `buildHull()` and `fuseVoxelColors()` `-Z` face blending.

## Phase 3: Core Implementation — Left/Right/Top Roles

- [x] 3.1 RED: test `_viewSample` maps `left`/`right`/`top` per design axes.
- [x] 3.2 GREEN: add `left`/`right`/`top` orientations and validation.
- [x] 3.3 Prepare `left`/`right` at `D × H` and `top` at `W × D`.
- [x] 3.4 Wire `_viewSample`/`_viewWeight` (left/right → sideWeight, top → topWeight).
- [x] 3.5 Include new roles in `buildHull()` and `fuseVoxelColors()` face blending.

## Phase 4: Integration — UI Selector & Preview Wiring

- [x] 4.1 Add role `<select>` per batch item in `voxelizer/index.html`.
- [x] 4.2 Render selector in `addItem()`, update `rec.role` on change, and trigger `recompute()`.
- [x] 4.3 Update batch drop hint to reflect multi-view semantics.

## Phase 5: Testing & Verification

- [x] 5.1 RED/GREEN: front+back fusion footprint test.
- [x] 5.2 RED/GREEN: front+back+right Z-bounds test.
- [x] 5.3 Verify existing `side`/`top` regression tests still pass.
- [x] 5.4 Run `node --check` on all modified scripts and full test suite.

## Phase 6: Cleanup

- [x] 6.1 Resolve open question: disable role selector for items without a front sibling.
- [x] 6.2 Add inline axis hint for role selector.
