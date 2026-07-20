## Exploration: advanced-palette

### Current State

The palette is produced automatically during voxelization and is read-only from the UI perspective.

- `voxelizer/voxel.js:499` `quantize(pixels, alphaThresh, maxColors)` returns `{ palette, idxAt, w, h }`. `palette` is an array of `[r,g,b]` arrays and `idxAt` maps each front pixel to a palette index.
- `voxelizer/voxel.js:2156` `voxelize()` calls `quantize()` during `prepareFront` and stores `result.palette` (the palette returned by `fuseVoxelColors`, which may extend it up to `config.palette.colors` when auxiliary/side/back colors are used).
- `voxelizer/app.js:150` `buildModel(result)` reads `result.palette` and applies `pal[f.color]` to each face.
- `voxelizer/app.js:379` `updateReadouts()` displays `palCount` and renders the first 28 palette entries as CSS swatches in `#swatches`.
- `voxelizer/voxio.js:47` `exportOBJ()` and `voxelizer/voxio.js:102` `exportVox()` consume `result.palette` directly; `exportVox()` already remaps colors by unique RGB and enforces a 255-color limit.
- `voxelizer/worker-channel.js:83` `validVoxelResult()` only validates that `result.palette` is an array.
- The user can only change `maxColors` (`state.opts.colors`) and `colorMode` (`state.opts.colorMode`); both trigger a full re-voxelize via `app.js run()`.
- No palette import/export, editing, reordering, merging, or preview-before-reconstruction features exist.

### Affected Areas

- `voxelizer/index.html` — the palette section currently shows only a count, the `colors` slider, the `colorModeSeg` segment, and the `swatches` grid. It needs controls for import/export, edit, reorder, merge, and apply/preview.
- `voxelizer/app.js` — owns `state.last`, `buildModel()`, `updateReadouts()`, and all UI event wiring. It needs palette editor state, index remapping, model rebuild without re-voxelizing, and file download/upload handlers.
- `voxelizer/voxel.js` — if we later want a seed palette to drive quantization, `quantize()` needs an optional seed palette. For the first slice it can remain unchanged.
- `voxelizer/voxio.js` — export logic already deduplicates colors, but must be verified after palette reordering/merging creates holes or duplicates.
- `tests/voxelizer.test.js` — needs unit tests for `.gpl`/`.pal` parsers and for palette index remapping utilities.
- `openspec/config.yaml` — TDD is enabled (`strict_tdd: true`), so any new pure functions must be added with tests first.

### Approaches

1. **In-app palette editor with model rebuild (no re-voxelize)**
   - Allow the user to edit, reorder, and merge colors in a copy of `result.palette`.
   - Maintain an `oldIndex -> newIndex` map and apply it to both `result.grid` and `result.greedyFacesList`/`naiveFacesList` color indices.
   - Call `buildModel()` and `updateReadouts()` to preview the change immediately without running the worker.
   - Add `.gpl` and `.pal` import/export parsers that populate or serialize `result.palette`.
   - Pros: Fast preview; minimal changes to the deterministic core; no worker-channel changes; fits the "preview before reconstruction" requirement naturally.
   - Cons: Editing the palette does not change the underlying quantization, so colors removed by merging are lost and new colors cannot be added from the source. Export formats must be kept consistent with the remapped palette.
   - Effort: Medium

2. **Seed palette as voxelization input**
   - Extend `quantize()` to accept an optional `seedPalette` array. When present, it clusters source colors toward the seed instead of performing agglomerative merging from scratch.
   - Add `state.opts.paletteSeed` and re-run `voxelize()` whenever it changes.
   - Pros: Palette is a true input to the reconstruction pipeline; batch exports remain consistent automatically.
   - Cons: Much more invasive; changes the core algorithm and the config schema; every preview is expensive; auxiliary colors in `fuseVoxelColors()` may still expand the palette beyond the seed.
   - Effort: High

3. **Hybrid: preview via approach 1, then apply via approach 2**
   - Approach 1 for fast preview, plus an "Apply to source" button that converts the edited palette into a seed and re-voxelizes.
   - Pros: Best of both worlds; users can iterate quickly and then commit.
   - Cons: Two mental models and two code paths; more UI state to manage.
   - Effort: High

### Recommendation

Use **Approach 1** for the first slice. It satisfies import/export, editing, reordering, merging, and preview-before-reconstruction with the smallest blast radius. The deterministic core (`voxel.js`, `worker-channel.js`) stays untouched except for the exported palette contract, and the heavy voxelization step is not repeated for every palette tweak.

A future slice can add a seed-palette option (Approach 2 or 3) if users want palette changes to drive color reduction from the source image.

### Risks

- `.pal` format ambiguity: the extension is used for both binary 768-byte palettes and JASC-PAL text files. We must document which variant we support (JASC-PAL is recommended because it is text and supports arbitrary color counts).
- Index remapping errors: merging colors requires updating every occurrence in `result.grid` and all face lists. A bug would produce visible color shifts or invalid indices.
- Export consistency: `exportOBJ()` and `exportVox()` read the same `result.palette`. After editing, the exported file must match the preview; the existing VOX deduplication logic already handles duplicate colors but must be tested after merging.
- Transparency is not part of the palette: colors are RGB only; alpha is handled earlier. Import/export formats must ignore or clamp alpha channels consistently.
- Color distance metric: merging should use Euclidean RGB distance (matching existing core conventions) to avoid surprising users.
- No UI test harness exists; the palette editor must be covered with pure-parser/remap unit tests and manual end-to-end verification.
- 800-line review budget and auto-chain are enabled; the first slice should be kept under the budget so it can ship as a single PR.

### Ready for Proposal

Yes. The orchestrator can tell the user that the exploration is complete and that the next phase is `sdd-propose` for the `advanced-palette` change, using the recommended in-app editor approach.

A viable first slice for the auto-chain pipeline is:
1. Add `.gpl` and JASC-`.pal` import/export in `app.js` with small parser utilities.
2. Add a clickable, reorderable, mergeable swatch grid in the palette section of `index.html`.
3. Implement palette index remapping and model rebuild in `app.js` so edits preview without re-voxelizing.
4. Add Node tests for the parsers and the remapping function.

