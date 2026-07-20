# Design: Multi-Role View Merging for Batch Voxelization

## Technical Approach

Keep the flat BATCH list and add a `role` field to every item (default `front`). Items with the same base name form one model. The `front` item provides the primary `pixels`; siblings with roles `back`, `left`, `right`, and `top` are fed as auxiliary silhouettes into the voxelizer. `voxel.js` is extended to understand those five canonical roles, prepare their silhouette masks along the correct axes, and include them in visual-hull intersection and auxiliary color fusion. `batch.js` is updated so only `front` records spawn jobs, gathering sibling views automatically.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Model grouping | Grouped model UI (Approach 2) vs. flat list + same-name siblings | Approach 2 breaks "one item = one file" and needs larger UI rewrite; Approach 1 reuses existing batch list and file semantics. | Flat list + same-name siblings (proposal Approach 1). |
| Where to store role | New `role` field on item record; no new database schema | Backward compatible: old records default to `front`; manifests remain loadable. | Add `role` to item records and batch manifest snapshots. |
| Front role vs. primary `pixels` | Treat `front` as a view role vs. keep it as primary `pixels` | Treating `front` as a view requires a breaking API change; keeping it as primary preserves `voxelize(pixels, opts, views)` and only adds auxiliary roles. | `front` is the primary `pixels`; other roles are auxiliary `views`. |
| Back-view depth semantics | Back view as X/Y footprint vs. depth cap | Footprint intersection is the standard visual-hull behavior for a view in the X/Y plane; depth is already controlled by the depth profile. | Back view acts as an X/Y silhouette constraint (footprint refinement). |
| Role weights | Add new weight fields vs. map to existing weights | New weights require UI and config migration; mapping keeps the existing inspector untouched. | `left`/`right` use `sideWeight`, `top` uses `topWeight`, `back` uses `frontWeight`. |

## Data Flow

```
User drops PNG ──► addItem() creates item { name, canvas, role:'front', ... }
                      │
Role selector change ─┤
                      ▼
              selectItem(rec) ──► findModel(rec) = same base name
                      │
                      ▼
              getItemViews(model) ──► { front, back, left, right, top, side, top, depthMap }
                      │
                      ▼
              run() ──► pixels = front.canvas
                        views = [back, left, right, top, plus record side/top/depthMap]
                      │
                      ▼
              voxelizePreview(pixels, opts, views)
                      │
                      ▼
              normalizeViewInputs() validates roles
              prepareSilhouettes() builds masks per axis
              buildHull() intersects all silhouettes
              fuseVoxelColors() blends auxiliary colors per face
                      │
                      ▼
              buildModel(result) renders preview
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `voxelizer/app.js` | Modify | Add `role` to item record; render role selector in batch item; generalize `getItemViews` to collect same-base-name siblings; use `front` item as primary pixels; refresh on role change. |
| `voxelizer/batch.js` | Modify | Persist `role` in manifest snapshots; make `jobAt` only create jobs for `front` records and collect sibling views by base name/role. |
| `voxelizer/voxel.js` | Modify | Extend `CANONICAL_ORIENTATIONS`; generalize `prepareSilhouettes` dimensions for `back/left/right/top`; update `_viewSample` and `_viewWeight`; update `fuseVoxelColors` to blend back/side/top colors on correct face directions. |
| `voxelizer/index.html` | Modify | Add role selector per batch item (HTML + CSS hook). |
| `tests/voxelizer.test.js` | Modify | Add regression tests for two-view and three-view fusion bounds. |
| `voxelizer/worker-channel.js` | No change | Existing `views` payload already passes through unchanged. |

## Interfaces / Contracts

```javascript
// Item record shape (voxelizer/app.js)
const rec = {
  name, canvas, el, st,
  role: 'front', // 'front' | 'back' | 'left' | 'right' | 'top'
  alignment: cloneData(defaultAlignment),
  viewMetadata: { side: {...}, top: {...}, depthMap: {...} },
  side: null, top: null, depthMap: null,
};

// View descriptor passed to Voxel.voxelize
{ role: 'back', pixels, confidence: 1, frameMetadata: {...} }

// New canonical orientations (voxelizer/voxel.js)
const CANONICAL_ORIENTATIONS = {
  front:  { projection: 'orthographic', horizontal: '+X', vertical: '-Y' },
  back:   { projection: 'orthographic', horizontal: '-X', vertical: '-Y' },
  left:   { projection: 'orthographic', horizontal: '-Z', vertical: '-Y' },
  right:  { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
  top:    { projection: 'orthographic', horizontal: '+X', vertical: '+Z' },
  side:   { projection: 'orthographic', horizontal: '+Z', vertical: '-Y' },
  depthmap:{ projection: 'orthographic', horizontal: '+X', vertical: '-Y' },
};
```

`_viewSample` mapping:
- `right` / `side`: `z + view.w * py`
- `left`: `(D - 1 - z) + view.w * py`
- `top`: `x + view.w * z`
- `back`: `x + view.w * py`

`prepareSilhouettes` dimensions:
- `back`: `W x H`
- `left`/`right`: `D x H`
- `top`: `W x D`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `normalizeViewInputs` accepts and rejects new roles | Direct `Voxel.normalizeViewInputs` calls in `tests/voxelizer.test.js` |
| Unit | `_viewSample` maps each role to the correct auxiliary index | Test helper with small `W,H,D` grids |
| Integration | Front + back fusion bounds | `Voxel.voxelize` with two role views; assert occupied footprint equals intersection |
| Integration | Front + back + right three-view fusion | Assert X bounds are constrained by right silhouette |
| Regression | Existing `side`/`top` tests still pass | Run full test suite before and after change |
| Syntax | `node --check` passes | CI check command for all modified scripts |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Web workers are already in use and require no new process integration.

## Migration / Rollout

No migration required. Old item records without `role` default to `front`, so existing batch manifests remain loadable. Batch export semantics change: non-front items are no longer exported individually; they are merged into the matching front model. This is intended behavior, but the UI hint should be updated to reflect "1 modelo por archivo (o varias vistas con mismo nombre base)".

## Open Questions

- [ ] Should the role selector be hidden or disabled for items whose base name already has a `front` sibling? (Multiple front items for one model are ambiguous.)
- [ ] Should the first slice include `left`/`right`/`top` in `voxel.js` or only front/back? Proposal says front/back only in first slice, but it lists all five roles as in scope.
