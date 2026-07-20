# Proposal: In-App Palette Editor with Model Rebuild

## Intent

The current palette is read-only: users can only change `maxColors` or `colorMode`, both of which trigger a full re-voxelization. This makes fine palette tuning slow and prevents artists from importing an existing palette, merging near-duplicates, or previewing a color tweak before committing. We will add an in-app palette editor that rebuilds the 3D model immediately without re-running the voxelization worker.

## Scope

### In Scope
- Import and export palettes in `.gpl` (GIMP) and JASC-`.pal` text formats.
- Click-to-edit color values, drag-to-reorder, and merge two colors into one.
- Immediate preview by rebuilding the model from the current voxel result with a remapped palette index.
- Unit tests for the parsers and the remapping function.

### Out of Scope
- Seed palette as a voxelization input (re-quantization from source).
- Binary 768-byte `.pal` format.
- Adding new colors beyond those already produced by voxelization.
- Undo/redo history.
- Batch workflow palette editing.

## Capabilities

### New Capabilities
- `advanced-palette-editor`: In-app palette editor supporting `.gpl` and JASC-`.pal` import/export, color edit/reorder/merge, and immediate model rebuild preview without re-voxelization.

### Modified Capabilities
- None

## Approach

Adopt the in-app editor approach (Approach 1) from the exploration. Keep `voxel.js` and `worker-channel.js` untouched. Store an edited copy of `result.palette` in `app.js`, maintain an `oldIndex -> newIndex` map, and apply it to `result.grid`, `greedyFacesList`, and `naiveFacesList` before calling `buildModel()` and `updateReadouts()`. Add small pure parser utilities for `.gpl` and JASC-`.pal`, and file upload/download handlers. Export flows (`voxio.js`) consume the same palette object, so they stay consistent with the preview.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/index.html` | Modified | Add palette editor controls (import/export, edit, reorder, merge, reset) to the palette section. |
| `voxelizer/app.js` | Modified | Add editor state, index remapping, model rebuild, and file upload/download handlers. |
| `tests/voxelizer.test.js` | Modified | Add tests for `.gpl`/`.pal` parsers and palette remapping. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Index remapping misses some face lists | Med | Remap both grid and every face list; assert no out-of-range indices before rebuild. |
| Export format mismatch after merge | Low | Keep exported palette identical to the previewed palette; rely on existing VOX deduplication plus tests. |
| `.pal` format confusion | Low | Explicitly support only JASC-PAL text and document it. |
| 800-line review budget exceeded | Med | Slice strictly to the four in-scope items; defer seed-palette and undo. |

## Rollback Plan

- Revert the commit that adds `advanced-palette-editor`. The deterministic core is unchanged, so reverting restores the previous read-only palette behavior with no migration needed.
- If a release is live, serve the previous static build; no persisted user data or schema changes are involved.

## Dependencies

- None

## Success Criteria

- [ ] User can import a `.gpl` or JASC-`.pal` file and see the palette update in the UI.
- [ ] User can edit, reorder, and merge colors; the 3D model preview updates within one frame without re-voxelizing.
- [ ] User can export the current palette to `.gpl` and JASC-`.pal` formats.
- [ ] Unit tests for parsers and remapping pass under `strict_tdd`.
- [ ] The change ships within the 800-line review budget.
