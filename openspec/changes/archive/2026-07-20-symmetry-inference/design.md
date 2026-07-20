# Design: Mirrored-back inference for single-image voxelization

## Technical Approach

Add an opt-in, pure `inferViews(frontPixels, config)` helper in `voxelizer/voxel.js` that synthesizes a `back` view by horizontally mirroring the front RGBA payload. Before the existing view normalization runs, merge the synthetic `back` payload into the view map only when `config.inference.enabled` and `config.inference.back` are true and no real `back` view exists. The rest of the pipeline (silhouette preparation, reconstruction, color fusion, meshing) remains unchanged. This matches the pre-voxelize inference approach from the spec and keeps the change additive and rollback-safe.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Where to inject the inferred view | A) Inside `normalizeViewInputs`; B) In `voxelize` before `normalizeViewInputs` | A) changes the signature of a heavily-tested function; B) reuses the already-validated front pixels and keeps normalization untouched | **B** — merge in `voxelize` |
| Source pixels for mirroring | A) Raw uploaded front; B) Preprocessed front (after silhouette alpha/denoise) | A) matches uploaded file exactly; B) keeps the inferred back consistent with the actual front used for reconstruction | **B** — use `preprocessPixels` output |
| Batch inference dependency | A) Reuse `Voxel.inferViews`; B) Keep a local mirror helper in `batch.js` | A) less duplication, but `batch.js` tests load it standalone; B) keeps batch self-contained and testable in isolation | **B** — local `_mirrorBack` in `batch.js` |
| UI config mapping | A) Add new `inference` object to `state.opts`; B) Map a flat `inferenceEnabled` legacy option through the existing `normalizeConfig` pipeline | A) requires new wiring patterns; B) fits the existing flat-option → `_legacyPatch` → config flow | **B** — `inferenceEnabled` legacy option |
| Expose `inference.back` in UI | A) Toggle both flags; B) Keep `back` as a hidden default-true flag | A) more flexibility; B) simpler UI, covers the current slice | **B** — only `enabled` is toggled; `back` defaults to `true` |

## Data Flow

```
front image
   │
   ▼
preprocessPixels ──► frontPixels
   │                    │
   │                    ▼
   │              inferViews(frontPixels, config)
   │                    │
   │                    ▼
   │            { role: 'back', pixels: mirrored }
   │                    │
   │                    ▼
views ─────► mergeInferredViews ──► normalizeViewInputs
                                         │
                                         ▼
                           prepareSilhouettes / calculateOccupancy / fuseColors / extractMesh
```

`mergeInferredViews` is a small private step inside `voxelize` that adds the synthetic view only when no real `back` role already exists.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `voxelizer/voxel.js` | Modify | Add `DEFAULT_CONFIG.inference`, `normalizeConfig.inference`, `_legacyPatch` for `inferenceEnabled`, add `inferViews()`, merge inferred views in `voxelize()`, export `inferViews`. |
| `voxelizer/app.js` | Modify | Add `state.opts.inferenceEnabled`, wire a new toggle, pass it through `cloneOpts()`. |
| `voxelizer/batch.js` | Modify | Add `_mirrorBack()` and merge an inferred `back` snapshot into `viewSnapshots` when `opts.inferenceEnabled` is true and no real `back` exists. |
| `voxelizer/index.html` | Modify | Add a toggle row under the multi-view section and a hint about mirrored-back colors in auxiliary mode. |
| `tests/voxelizer.test.js` | Modify | Add unit and integration tests for `inferViews`, precedence, disabled behavior, and budget errors. |
| `openspec/changes/symmetry-inference/design.md` | Create | This document. |

## Interfaces / Contracts

```javascript
// New public helper in voxel.js
function inferViews(frontPixels, config) {
  // Returns null when disabled, otherwise:
  // { role: 'back', pixels: { w, h, data: Uint8Array|Uint8ClampedArray } }
}

// New config shape (normalized)
config.inference = {
  enabled: false, // boolean
  back: true,     // boolean
};

// New legacy flat option consumed by app.js and batch.js
opts.inferenceEnabled = false;
```

- `inferViews` validates the front payload with `validatePixels`, clones the data, and mirrors each row horizontally. Dimensions are preserved; alpha values are preserved.
- The merged synthetic view uses the canonical `back` orientation from `CANONICAL_ORIENTATIONS` because `normalizeViewInputs` validates it.
- Inferred payloads are subject to the same `MAX_AUX_PIXEL_COUNT` and `MAX_AUX_BYTES` checks as real views via `_assertAuxiliaryBudgets`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `inferViews` mirror and alpha preservation | `node:test` in `tests/voxelizer.test.js` with hand-crafted 2×2 and 3×3 RGBA payloads |
| Unit | `normalizeConfig` defaults and `inferenceEnabled` legacy round-trip | Assert `inference.enabled === false`, `inference.back === true`, and toggling the legacy option maps correctly |
| Integration | Single front image with inference enabled produces a back-sampled silhouette | `Voxel.voxelize(front, { inferenceEnabled: true }, {})` and inspect diagnostics/previews |
| Integration | Real `back` view wins over inferred back | Pass `{ views: [{ role: 'back', pixels: ... }] }` with inference enabled and verify the real pixels are used |
| Integration | Disabled inference is identical to pre-feature behavior | Compare output grid/config with default options |
| Integration | Pixel budget exceeded for inferred views | Create a front payload that exceeds `MAX_AUX_PIXEL_COUNT` and assert the same `AUX_PIXEL_BUDGET_EXCEEDED` error |
| Integration | Batch manifest includes inferred back and no extra records | `VoxelBatch.createManifest` with a single front record and `inferenceEnabled: true` |
| E2E | UI toggle updates `state.opts.inferenceEnabled` and re-voxelizes | Manual browser verification (no automated E2E harness exists) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. The change is additive:
- `config.inference.enabled` defaults to `false`, so existing users and saved configs are unaffected.
- Removing the `mergeInferredViews` call from `voxelize` restores the previous depth-profile-only behavior.
- The new config key is version-compatible with `CONFIG_VERSION = 3`; no migration routine is needed.

## Open Questions

- None that block the design.
