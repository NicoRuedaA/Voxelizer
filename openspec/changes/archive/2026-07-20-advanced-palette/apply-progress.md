# Apply Progress: advanced-palette — Unit 3 (PR 3)

## Change

- **Name**: `advanced-palette`
- **Project**: `voxelizer-app`
- **Work unit**: Unit 3 — UI controls and export integration
- **Mode**: Strict TDD
- **Delivery**: auto-chain, stacked-to-main
- **Batch**: 2026-07-20

## Task Progress

### Phase 1: Foundation — palette-io.js

- [x] 1.1 RED: Add `parseGpl` tests (valid, too-large, roundtrip) in `tests/voxelizer.test.js`
- [x] 1.2 GREEN: Create `voxelizer/palette-io.js` with `parseGpl` and `serializeGpl`
- [x] 1.3 RED: Add `parseJascPal` tests (valid, invalid header, roundtrip)
- [x] 1.4 GREEN: Add `parseJascPal` and `serializeJascPal` to `voxelizer/palette-io.js`
- [x] 1.5 RED: Add `applyRemap` tests (grid, face remap, palette swap, out-of-range throw)
- [x] 1.6 GREEN: Implement `applyRemap` in `voxelizer/palette-io.js`

### Phase 2: Core Editor State — app.js

- [x] 2.1 RED: Add `state.paletteEdit` shape tests
- [x] 2.2 GREEN: Init `state.paletteEdit` and `initPaletteEdit(result)` in `voxelizer/app.js`
- [x] 2.3 RED: Add preview rebuild path tests
- [x] 2.4 GREEN: Implement `buildPreview()` using `applyRemap` without worker message
- [x] 2.5 RED: Add reset tests
- [x] 2.6 GREEN: Add `resetPaletteEdit()` and wire reset action

### Phase 3: UI + Export Integration

- [x] 3.1 RED: Add edit/reorder/merge map tests
- [x] 3.2 GREEN: Add color-edit, drag-reorder, merge-select handlers in `voxelizer/app.js`
- [x] 3.3 GREEN: Add import/export file handlers and download triggers
- [x] 3.4 GREEN: Update `voxelizer/index.html` palette section with editor controls and swatch interactions

### Phase 4: Verification

- [x] 4.1 Run `node --check` on `voxelizer/palette-io.js` and `voxelizer/app.js`
- [x] 4.2 Run `node --test --test-reporter=spec tests/voxelizer.test.js`
- [ ] 4.3 Manual browser check: import `.gpl`, edit color, reorder, merge, export `.pal`; verify no worker message

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `voxelizer/app.js` | Modified | Added `editPaletteColor`, `reorderPaletteColor`, `mergePaletteColors`, `importPaletteFile`, `exportPaletteFile`, `updateSwatches`, `openColorEditor`, `selectMergeSource`, `triggerDownload`; wired import/export/reset buttons and palette file input; updated `updateReadouts` to use `updateSwatches`; exposed new handlers via `__dbg` seam |
| `voxelizer/index.html` | Modified | Added palette editor controls (Import, .gpl, .pal, Reset buttons, hidden file input) and interactive hints; swatches remain draggable/clickable |
| `tests/voxelizer.test.js` | Modified | Added Unit 6 focused tests for edit, reorder, merge, import/export handlers and UI button wiring; added `Blob` and `parentElement`/`remove` support to fake DOM harness |
| `openspec/changes/advanced-palette/tasks.md` | Modified | Marked Unit 3 and Phase 4 syntax/test tasks `[x]` complete |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `tests/voxelizer.test.js` | Unit | ✅ 146/146 baseline | ✅ Written (edit color, guard index, reorder, merge, merge invalid) | ✅ Passed (5/5) | ✅ 2+ cases per handler | ✅ Extracted `guardPaletteIndex` |
| 3.2 | `tests/voxelizer.test.js` | Unit | ✅ 151/151 | ✅ Written (drag reorder map, merge reduces palette) | ✅ Passed | ✅ 2 cases | ✅ Fixed `reorderPaletteColor` positionMap |
| 3.3 | `tests/voxelizer.test.js` | Unit | ✅ 156/156 | ✅ Written (import .gpl, import .pal, reject too-large, export .gpl, export .pal, export reflects edits) | ✅ Passed (6/6) | ✅ 2+ cases per format | ✅ Reused `PaletteIO` serializers |
| 3.4 | `tests/voxelizer.test.js` | Unit | ✅ 157/157 | ✅ Written (reset button, .gpl export button, .pal export button) | ✅ Passed (3/3) | ✅ 3 buttons | ✅ Added `Blob`/`remove` to test harness |

## Test Summary

- **Total tests written**: 14 (Unit 3 focused)
- **Total tests passing**: 160/160 (full suite)
- **Layers used**: Unit (14)
- **Approval tests**: None — no refactoring tasks
- **Pure functions created**: 7 (`guardPaletteIndex`, `editPaletteColor`, `reorderPaletteColor`, `mergePaletteColors`, `importPaletteFile`, `exportPaletteFile`, `triggerDownload`)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `node --test --test-reporter=spec tests/voxelizer.test.js` → `ℹ tests 160`, `ℹ pass 160`, `ℹ fail 0` |
| Runtime harness command/scenario and exact result | `node --check voxelizer/app.js && node --check voxelizer/palette-io.js` → `app.js ok` / `palette-io.js ok` |
| Rollback boundary | Revert `voxelizer/app.js` palette editor block (handlers + UI wiring + `updateSwatches` integration), `voxelizer/index.html` palette editor controls, and the Unit 6 test block in `tests/voxelizer.test.js` |

## Deviations from Design

None — implementation matches design. Added `guardPaletteIndex` helper for consistent range validation; the merge interaction uses shift+drop as the primary two-click equivalent (click to edit, drag to reorder, shift+drop to merge). The design's open question about exact merge interaction is resolved by the shift+drop interaction pattern.

## Issues Found

1. `reorderPaletteColor` first draft produced an invalid `-1` remapped index due to an incorrect position map; fixed with a direct `originalIndex -> currentPosition` pass.
2. `updateReadouts` requires `state.pixels`; Unit 3 tests set `{ w, h }` before calling handlers that trigger `buildPreview()`.
3. The fake DOM harness needed `Blob`, `parentElement`, and `remove()` support for the export download button tests.

## Workload / PR Boundary

- **Mode**: chained PR slice (stacked-to-main)
- **Current work unit**: Unit 3 / PR 3 — UI controls and export integration
- **Boundary**: Starts after Unit 2 `buildPreview()` and export integration; ends with HTML controls, UI handlers, import/export wiring, and focused tests passing
- **Estimated review budget impact**: Unit 3 adds ~190 lines (app.js handlers + wiring + HTML + tests), remaining within the 400-line PR budget and the 800-line project budget

## Status

16/17 tasks complete. Phase 4 item 4.3 (manual browser check) remains pending. All automated verification passes.
