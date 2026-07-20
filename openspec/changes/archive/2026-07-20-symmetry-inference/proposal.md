# Proposal: Symmetry inference for single-image voxelization

## Intent

When a user uploads only a front image, the voxelizer currently extrudes the front silhouette into a slab using a depth profile. The resulting back and side faces are geometrically uniform and do not recover plausible hidden geometry. This change adds an opt-in inference module that synthesizes a `back` view by mirroring the front image horizontally, giving single-image uploads a more coherent back silhouette and volume through the existing multi-view reconstruction pipeline.

## Scope

### In Scope
- Opt-in `inference.enabled` config flag (default `false`) and `inference.back` flag (default `true`).
- Pure helper in `voxelizer/voxel.js` that synthesizes a `back` pixel payload from the front image by horizontal flip.
- Merge logic so inferred views are used only when no real view of the same role exists.
- UI toggle in `voxelizer/index.html` wired through `voxelizer/app.js` `state.opts`.
- Batch support in `voxelizer/batch.js` so records without auxiliary views consistently get inferred backs.
- Unit tests in `tests/voxelizer.test.js` for the inference helper and end-to-end behavior.
- Documentation of the feature and its symmetry assumption in the UI hint.

### Out of Scope
- Side and top view inference (Slice 2).
- Depth-map or normal-map generation.
- Learning-based or diffusion-based inpainting.
- Automatic inference when multiple real views are present.
- Modifying the existing silhouette-preparation or occupancy-grid logic beyond accepting synthetic pixel payloads.

## Capabilities

### New Capabilities
- `mirrored-back-inference`: Synthesizes a `back` view from a single front image when enabled and no real back view exists.

### Modified Capabilities
- None at the spec level for Slice 1; the change is a new input source that feeds existing multi-view reconstruction.

## Approach

Follow the pre-voxelize inference approach recommended by exploration. Add a small, pure `inferViews(frontPixels, config)` helper that returns a synthetic pixel payload for the `back` role when `config.inference.enabled` is true. Merge inferred payloads into the `views` map before `normalizeViewInputs()` runs, with real views always taking precedence. This keeps the silhouette-preparation, reconstruction, and color-propagation pipelines unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/voxel.js` | New | `DEFAULT_CONFIG.inference`, `inferViews()` helper, merge logic in `normalizeViewInputs()`. |
| `voxelizer/app.js` | Modified | Wire `state.opts.inference` from the UI toggle; enable inferred views only when the active record lacks real auxiliary views. |
| `voxelizer/batch.js` | Modified | `createManifest()` considers `opts.inference` per record; inferred views are not exported as separate records. |
| `voxelizer/index.html` | New | Checkbox under the multi-view / extrusion section to enable mirrored-back inference. |
| `tests/voxelizer.test.js` | New | Unit tests for `inferViews()` and single-image end-to-end behavior. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Incorrect geometry for asymmetric sprites | High | Keep the feature opt-in and clearly label the symmetry assumption. |
| Real auxiliary views accidentally ignored | Low | Merge rule always prefers real views; add deterministic precedence tests. |
| Pixel budget exceeded by inferred buffers | Low | Validate inferred payloads against the same `MAX_PIXEL_COUNT` / `MAX_AUX_PIXEL_COUNT` limits as real views. |
| Batch exports inconsistent with preview | Low | Apply inference in `createManifest()` using the same `opts` and record state as the preview. |
| Color surprises with `color.mode === 'auxiliary'` | Med | Document that the back face will inherit mirrored front colors when inference is enabled. |

## Rollback Plan

1. Set `config.inference.enabled` default to `false` in `DEFAULT_CONFIG`. Existing users who never enabled the toggle see no change.
2. If a deployed bug is isolated to the helper, remove the `inferViews()` call from `normalizeViewInputs()` so real views pass through unchanged.
3. If the UI toggle causes confusion, hide the checkbox by default while preserving the config key.
4. All changes are additive; reverting the merge commit or the helper restores the previous depth-profile-only behavior.

## Dependencies

- None external; the feature uses existing pixel-payload validation and silhouette preparation.

## Success Criteria

- [ ] A single front-image upload with inference enabled produces a `back` view that is the horizontal mirror of the front image.
- [ ] When a real `back` view is present, the inferred `back` view is not used.
- [ ] When inference is disabled, behavior is identical to the current depth-profile-only behavior.
- [ ] Unit tests verify the `inferViews()` helper output for mirrored pixels and alpha preservation.
- [ ] Batch exports of a single front image with inference enabled match the preview output.
- [ ] The feature stays within existing pixel and memory budgets.
