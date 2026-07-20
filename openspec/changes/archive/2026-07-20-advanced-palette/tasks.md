# Tasks: In-App Palette Editor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–850 |
| 400-line budget risk | High |
| Project budget | 800 lines (per proposal) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (palette-io + tests) → PR 2 (app state/rebuild + tests) → PR 3 (HTML UI + export wiring) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure palette I/O and remapping | PR 1 | `node --test --test-reporter=spec tests/voxelizer.test.js` | `node --check voxelizer/palette-io.js` | Remove `voxelizer/palette-io.js` and related tests |
| 2 | Editor state and preview rebuild | PR 2 | `node --test --test-reporter=spec tests/voxelizer.test.js` | `node --check voxelizer/app.js` | Revert `voxelizer/app.js` palette-edit changes |
| 3 | UI controls and export integration | PR 3 | `node --test --test-reporter=spec tests/voxelizer.test.js` | Browser: import/edit/reorder/merge/export palette | Revert `voxelizer/index.html` and app.js UI wiring |

## Phase 1: Foundation — palette-io.js

- [x] 1.1 RED: Add `parseGpl` tests (valid, too-large, roundtrip) in `tests/voxelizer.test.js`
- [x] 1.2 GREEN: Create `voxelizer/palette-io.js` with `parseGpl` and `serializeGpl`
- [x] 1.3 RED: Add `parseJascPal` tests (valid, invalid header, roundtrip)
- [x] 1.4 GREEN: Add `parseJascPal` and `serializeJascPal` to `voxelizer/palette-io.js`
- [x] 1.5 RED: Add `applyRemap` tests (grid, face remap, palette swap, out-of-range throw)
- [x] 1.6 GREEN: Implement `applyRemap` in `voxelizer/palette-io.js`

## Phase 2: Core Editor State — app.js

- [x] 2.1 RED: Add `state.paletteEdit` shape tests
- [x] 2.2 GREEN: Init `state.paletteEdit` and `initPaletteEdit(result)` in `voxelizer/app.js`
- [x] 2.3 RED: Add preview rebuild path tests
- [x] 2.4 GREEN: Implement `buildPreview()` using `applyRemap` without worker message
- [x] 2.5 RED: Add reset tests
- [x] 2.6 GREEN: Add `resetPaletteEdit()` and wire reset action

## Phase 3: UI + Export Integration

- [x] 3.1 RED: Add edit/reorder/merge map tests
- [x] 3.2 GREEN: Add color-edit, drag-reorder, merge-select handlers in `voxelizer/app.js`
- [x] 3.3 GREEN: Add import/export file handlers and download triggers
- [x] 3.4 GREEN: Update `voxelizer/index.html` palette section with editor controls and swatch interactions

## Phase 4: Verification

- [x] 4.1 Run `node --check` on `voxelizer/palette-io.js` and `voxelizer/app.js`
- [x] 4.2 Run `node --test --test-reporter=spec tests/voxelizer.test.js`
- [ ] 4.3 Manual browser check: import `.gpl`, edit color, reorder, merge, export `.pal`; verify no worker message
