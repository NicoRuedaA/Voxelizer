## Exploration: Symmetry inference from a single image

### Current State

The voxelizer already supports multi-view reconstruction: `voxel.js` accepts `front`, `back`, `left`, `right`, `top`, `side` and `depthmap` views, prepares them in `prepareSilhouettes`, and fuses them in `buildHull` using strict/weighted reconstruction plus material-aware color propagation. The UI in `app.js` lets users drop multiple sprites and assign each a role; `batch.js` groups sibling views by model base name.

When only a front image is supplied, the system falls back to a depth profile (`uniform`, `dt`, `combo`, `humanoid`, etc.) that extrudes the front silhouette into a volume. The back and sides are not *inferred* as explicit silhouettes — they are merely the far faces of the extruded slab. The UI already acknowledges this limitation: "Con una sola imagen, la profundidad es un prior artístico: no recupera geometría oculta."

The goal is to generate plausible hidden `back` (and optionally `side`/`top`) views from the front image using symmetry and thickness heuristics, so single-image uploads get a more coherent 3D volume without requiring hand-drawn auxiliary views.

### Affected Areas

- `voxelizer/voxel.js` — core of the change. Needs a new `inference` config section, a helper that synthesizes views from the front image, and integration into `voxelize()` / `normalizeViewInputs()` so inferred views are used only when no real view of the same role is present.
- `voxelizer/app.js` — needs a UI toggle for inference, wiring into `state.opts`, and logic in `getItemViews()` / `run()` to enable inferred views when the active record has no auxiliary canvases.
- `voxelizer/batch.js` — `createManifest()` should consider inferred views so batch exports behave consistently with the preview. Since inference is deterministic and derived from the front image, it can be applied per front record when no sibling views exist.
- `tests/voxelizer.test.js` — new unit tests for the inference helper and for end-to-end behavior (e.g., inferred back reduces the volume exactly where the mirrored silhouette is smaller).
- `voxelizer/index.html` — a small toggle/checkbox under "Multi-vista" or "Extrusión" to enable/disable inference.

### Approaches

1. **Pre-voxelize inference module (recommended)**
   Add a pure helper (`inferViews(frontPixels, config)`) that returns synthetic pixel payloads for missing roles, then merge them into `views` before `normalizeViewInputs()` runs. For the first slice this means mirroring the front horizontally to produce a `back` view and propagating front colors. Later slices can add `side`/`top` silhouettes derived from the front silhouette's row/column extents and the configured depth profile.
   - Pros:
     - Keeps the existing silhouette-preparation and occupancy pipelines untouched.
     - Easy to unit-test in isolation (input/output are pixel payloads).
     - Avoids special-casing inside `buildHull` and keeps material/color fusion paths identical for real and inferred views.
   - Cons:
     - Requires allocating extra pixel buffers (backed by the same 4 MiB/8 MiB auxiliary budgets, so still bounded).
     - Side/top inference needs careful alignment with the depth profile to avoid circular logic.
   - Effort: Medium

2. **Inline silhouette synthesis in `prepareSilhouettes()`**
   Detect missing roles directly while preparing silhouettes and synthesize their masks from the already-quantized front mask. This bypasses pixel buffers and generates masks in the same D×H / W×D spaces used by real views.
   - Pros:
     - No extra pixel payloads or validation overhead.
     - Can reuse `depthState.profile` directly when generating side masks.
   - Cons:
     - Tightly couples inference to silhouette preparation, making it harder to test independently.
     - Material evidence (colors) for inferred views must be fabricated inside the already-complex material pipeline.
     - Diagnostics become harder to keep honest because inferred views are invisible to the caller.
   - Effort: Medium–High

3. **Post-occupancy grid mirroring**
   Let `buildHull()` produce the usual front-extruded grid, then mirror/trim occupancy after the fact to approximate hidden geometry.
   - Pros:
     - No changes to view input handling.
   - Cons:
     - Bypasses silhouette fusion entirely, so weighted reconstruction and material-aware diagnostics become inconsistent.
     - Cannot naturally represent asymmetric thickness or varying side profiles.
     - Harder to integrate with the existing diagnostics / overlays.
   - Effort: High

### Recommendation

Use **Approach 1** and ship it in two slices:

- **Slice 1 — inferred back view:** mirror the front image horizontally to synthesize a `back` view when `config.inference.enabled` is true and no real `back` view exists. This immediately improves single-image exports by giving coherent back faces and a believable back silhouette via the existing intersection logic.
- **Slice 2 — inferred side/top silhouettes:** derive `side` and `top` views from the front silhouette's per-row and per-column bounding extents, using the configured depth layers as the side width and the front's vertical extents as the top depth. This slice is optional and should be gated by additional config flags.

The first slice is the right place to start because it is small, testable, and leverages the already-existing `back` role without inventing new geometry logic.

### Risks

- **Anatomically wrong for asymmetric sprites:** a mirrored back assumes bilateral symmetry, which is false for many sprites (e.g., a character holding a weapon on one side). The feature must be opt-in and easy to disable.
- **Conflicts with real auxiliary views:** if the user later loads a real back/side view, the inferred view must be discarded. The merge rule must be deterministic.
- **Material budget inflation:** inferred views add pixel buffers that count against `MAX_PIXEL_COUNT` / `MAX_AUX_PIXEL_COUNT`. The implementation must validate inferred payloads the same way real views are validated.
- **Batch consistency:** batch mode must apply inference per record independently, and the manifest must not double-count inferred views as separate records.
- **Color policy surprises:** users with `color.mode === 'auxiliary'` will see the back face painted from the mirrored front colors. This is usually desirable but must be documented in the UI hint.

### Ready for Proposal

Yes. The orchestrator can tell the user that the exploration recommends a two-slice implementation starting with an opt-in mirrored-back inference module in `voxelizer/voxel.js`, wired through `app.js`, `batch.js`, and tests.
