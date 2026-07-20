# Proposal: Multi-Role View Merging for Batch Voxelization

## Intent

Each BATCH item currently represents a single front-facing sprite. Users need to assign orthographic roles (`front`, `back`, `left`, `right`, `top`) to images in the BATCH panel and fuse them into one coherent voxel model, improving reconstruction accuracy without leaving the batch workflow.

## Scope

### In Scope
- Add a `role` field to batch item records (default `front`).
- Render a role selector per item in the BATCH panel.
- Collect all views belonging to the active model via generalized `getItemViews`.
- Extend `voxel.js` to accept `front`, `back`, `left`, `right`, and `top` as silhouette roles in visual-hull intersection and color fusion.
- Add regression tests for two-view and three-view fusion.

### Out of Scope
- Model grouping UI (Approach 2) and breaking "one item = one file" semantics.
- New depth-map roles beyond existing `depthmap`.
- Performance optimization beyond current `MAX_MATERIAL_COMPARE_WORK` preflight.
- Automatic role detection from image content.

## Capabilities

> This section is the CONTRACT between proposal and specs phases.
> The sdd-spec agent reads this to know exactly which spec files to create or update.
> Research `openspec/specs/` before filling this in.

### New Capabilities
- `batch-view-roles`: per-item role metadata and BATCH panel UI for selecting `front`, `back`, `left`, `right`, or `top`.
- `multi-view-voxelization`: core voxelizer support for five canonical silhouette roles and their axis mappings in `prepareSilhouettes`, `buildHull`, and `fuseVoxelColors`.
- `batch-view-fusion`: preview/export pipeline that gathers role views for the active model and fuses them into a single voxel grid.

### Modified Capabilities
- None (no existing OpenSpec capabilities).

## Approach

Adopt **Approach 1** from exploration: keep the flat BATCH list, extend each item with a `role`, and treat the selected item's same-name siblings as its model's auxiliary views. Generalize `getItemViews` to return all role canvases for the active model, then feed them to an extended `Voxel.voxelize` that intersects every provided silhouette. Map `front`/`back` to ±Z silhouettes, `left`/`right` to ±X, and `top` to +Y, reusing existing color fusion when `color.mode === 'auxiliary'`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/app.js` | Modified | item record shape, role UI wiring, preview recompute |
| `voxelizer/batch.js` | Modified | `role` field, `getItemViews` generalization |
| `voxelizer/voxel.js` | Modified | orientation tables, silhouette prep, hull intersection, color fusion |
| `voxelizer/index.html` | Modified | BATCH panel role selector and labels |
| `tests/voxelizer.test.js` | Modified | multi-role fusion regression tests |
| `voxelizer/worker-channel.js` | Modified | pass larger `views` payload unchanged |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regressions in existing `side`/`top` behavior | Med | Preserve old role defaults; run existing tests before and after |
| Coordinate axis confusion for users | Med | Document axis mapping in UI hints and specs |
| 800-line review budget exceeded | High | Chain PRs by UI, core, and tests slices |

## Rollback Plan

Revert to the previous Git commit. Old item records without `role` default to `front`, so persisted batch manifests remain loadable; manifests saved after the change simply contain unused `role` fields for a rollback build.

## Dependencies

- None beyond existing voxelizer codebase and test harness.

## Success Criteria

- [ ] Each BATCH item shows a role selector with `front`, `back`, `left`, `right`, `top`.
- [ ] Selecting a model fuses all its role views into one voxel preview.
- [ ] Existing `side`/`top` tests continue to pass.
- [ ] New tests verify two-view and three-view fusion produce expected voxel bounds.
- [ ] `node --check` passes for all modified scripts.

## First-Slice Boundaries

**In first slice:** `batch-view-roles` and `batch-view-fusion` data flow plus `multi-view-voxelization` for `front`/`back` only.
**Later refinement:** add `left`/`right`/`top`, chained-PR delivery, and potential migration to grouped-model UX (Approach 2) if evaluation shows it is needed.
