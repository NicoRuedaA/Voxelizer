## Exploration: view-merging

### Current State
Voxelizer is a browser-JavaScript static app (no package manifest). The left BATCH panel is a flat list of independent items; each item currently represents one front-facing sprite. The right inspector has optional `side`, `top`, and `depthMap` view slots that attach to the *selected* item. These views are passed to `Voxel.voxelize(pixels, opts, views)` with the roles `side`, `top`, and `depthmap`. The voxel core (`voxelizer/voxel.js`) only supports `side` and `top` as silhouette roles in `prepareSilhouettes`; `depthmap` only feeds the depth profile. The visual hull in `buildHull` intersects the front mask with at most one side and one top silhouette. Colors can already be fused from side/top views in `fuseVoxelColors` when `color.mode === 'auxiliary'`.

### Affected Areas
- `voxelizer/app.js` — item record shape, view-slot wiring, batch export, preview recompute, alignment state, and UI wiring.
- `voxelizer/batch.js` — manifest creation and `jobAt` must handle per-item multi-role views and view metadata.
- `voxelizer/voxel.js` — `CANONICAL_ORIENTATIONS`, `normalizeViewInputs`, `prepareSilhouettes`, `_viewSample`, `_viewWeight`, `buildHull`, `fuseVoxelColors`, `buildDiagnostics`, and material evidence need to support `front`, `back`, `left`, `right`, and `top`.
- `voxelizer/index.html` — BATCH panel UI for role assignment, plus updated hints/labels.
- `tests/voxelizer.test.js` — new regression tests for multi-role view fusion and role assignment.
- `voxelizer/worker-channel.js` / `voxelizer/worker.js` — serialization path unchanged, but payload shape for `views` may grow.

### Approaches
1. **Extend each item record with multiple view canvases mapped to roles** — Keep the current batch as a list of models, but allow each item to carry more than one view. The BATCH panel gains a role selector/dropdown per item (front, back, left, right, top). The first front image is the model; subsequent images are attached as auxiliary views.
   - Pros: Minimal change to `batch.js` export semantics (one model per item), preserves existing side/top behavior, aligns with current `getItemViews` flow.
   - Cons: Clutters the BATCH panel with role UI; less intuitive than the requested "assign roles to images" model.
   - Effort: Medium

2. **Group BATCH items into a model with role-tagged images** — Change the batch panel to list *models*, each containing multiple images tagged with roles. Export fuses each model's images into one voxel grid.
   - Pros: Matches the requested mental model directly; batch panel becomes a true multi-view model builder.
   - Cons: Large refactor of `batch.js`, `exportBatch`, manifest progress tracking, and item selection UX; breaks existing "one item = one file" assumption.
   - Effort: High

3. **Role-only tags on existing flat items + implicit grouping** — Keep the flat item list, add a role chip to each item, and implicitly group items with the same name or an explicit "model group" into a single fused model.
   - Pros: Backward compatible; no role means current behavior.
   - Cons: Ambiguous grouping semantics; users must manage group names; export progress becomes complicated.
   - Effort: Medium-High

### Recommendation
**Start with Approach 1.** It is the smallest viable slice that satisfies "assign roles to images in the BATCH panel and fuse aligned views into a single coherent voxel model" without rewriting the batch export pipeline. The first deliverable should:
- Add `role` to item records (default `front`).
- Render a role selector in the BATCH panel for each item.
- Generalize `getItemViews` to collect all views for the active model.
- Extend `voxel.js` to support `front`, `back`, `left`, `right`, and `top` as silhouette roles with strict visual-hull intersection.
- Add regression tests for at least two-view and three-view fusion.

A later slice can move to Approach 2 if the UX proves insufficient.

### Risks
- **Core fragility**: `voxel.js` is 2221 lines and heavily tested; role additions must not regress existing `side`/`top` behavior.
- **Performance**: Multiple silhouettes multiply transformed-view budgets and material-compare work; strict mode already preflights `MAX_MATERIAL_COMPARE_WORK`.
- **Coordinate ambiguity**: The current axis convention is `side` = Z/Y (`+Z` horizontal, `-Y` vertical) and `top` = X/Z (`+X` horizontal, `+Z` vertical). `front`, `back`, `left`, `right` must map cleanly to these axes without confusing users.
- **Review budget**: The 800-line budget may be exceeded by core changes alone; plan chained PRs for UI, core, and tests.

### Ready for Proposal
Yes. Proceed to `sdd-propose` for `view-merging` with Approach 1 as the default direction, noting that the proposal should include a chained-PR strategy due to the core/UI/test scope.
