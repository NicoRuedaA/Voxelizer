# Design: In-App Palette Editor with Model Rebuild

## Technical Approach

Adopt the in-app editor from the proposal. Keep `voxel.js` and `worker-channel.js` untouched. Introduce a small pure palette I/O module that parses/serializes `.gpl` and JASC-`.pal` and remaps a voxel result. In `app.js`, store an edited copy of `result.palette` plus an `oldIndex -> newIndex` map. Rebuild the preview by cloning the last result, applying the map to `grid` and every face list, and calling `buildModel()` and `updateReadouts()` directly—no worker message. Export flows consume the same remapped result so the downloaded files match the viewport.

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|---|---|---|---|
| Edited palette storage | A) Mutate `state.last.palette` | Simpler but corrupts the canonical worker result and complicates reset/export. | B) Wrapper `state.paletteEdit = { palette, map, original }` isolates edits, enables reset, and gives export a stable source. |
| Index remapping | A) Mutate result in place | Faster but risky: the result may be transferred from a worker. | B) Build a `previewResult` clone before `buildModel()`; pure and testable. |
| Parser placement | A) Inline in `app.js` | Avoids a new file but mixes UI with parsing. | B) New `voxelizer/palette-io.js`; keeps UI focused and is unit-testable in Node. |
| Preview rebuild | A) Re-voxelize | Simpler code but defeats the feature's purpose. | B) Remap existing result; fast one-frame preview as required by the spec. |
| Export source | A) Always `state.last` | Would export original colors after edits. | B) Use `previewResult` when edits exist; viewport and download stay consistent. |

## Data Flow

```
User action (import / edit / reorder / merge / reset)
        |
        v
state.paletteEdit updated (palette + oldIndex->newIndex map)
        |
        v
previewResult = applyRemap(state.last, editedPalette, map)
        |
        v
buildModel(previewResult) -> viewport geometry
updateReadouts(previewResult) -> stats + swatches
        |
        v
Export uses previewResult -> .obj/.mtl/.vox
```

`applyRemap` clones the result, remaps every non-negative `grid` value and every `color` field in `greedyFacesList` / `naiveFacesList`, and swaps in the edited palette.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `voxelizer/palette-io.js` | Create | Pure `.gpl`/JASC-`.pal` parsers/serializers and `applyRemap` helper. |
| `voxelizer/index.html` | Modify | Add import/export/reset buttons and make swatches interactive (edit, reorder, merge). |
| `voxelizer/app.js` | Modify | Add `state.paletteEdit`, editor event wiring, preview rebuild via remap, and export integration. |
| `tests/voxelizer.test.js` | Modify | Unit tests for palette parsers/serializers and `applyRemap`. |

## Interfaces / Contracts

```javascript
// voxelizer/palette-io.js
function parseGpl(text)           // -> { name?, colors: [[r,g,b], ...] } | throws
function parseJascPal(text)       // -> { colors: [[r,g,b], ...] } | throws
function serializeGpl(name, colors) // -> string
function serializeJascPal(colors) // -> string
function applyRemap(result, editedPalette, indexMap)
  // result: voxelize() output
  // editedPalette: [[r,g,b], ...]
  // indexMap: array where indexMap[oldIndex] = newIndex
  // returns shallow clone of result with remapped grid/face colors and new palette
  // throws if any remapped index is out of range
```

Editor state shape in `app.js`:

```javascript
state.paletteEdit = {
  original: null,      // result.palette at last voxelize()
  palette: [],         // current edited colors
  map: [],             // oldIndex -> newIndex for the current edit
  dirty: false,
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `.gpl` parse/serialize | Node test runner; roundtrip fixtures and rejection of too-large imports. |
| Unit | JASC-`.pal` parse/serialize | Node test runner; invalid header rejection and roundtrip. |
| Unit | `applyRemap` | Node test runner; verify grid/face colors remap, palette swaps, out-of-range throws. |
| Manual/E2E | Full editor flow | Browser: import, edit color, reorder, merge, export; confirm preview updates without re-voxelizing. |
| Syntax | New/modified JS | `node --check` on `voxelizer/palette-io.js` and `voxelizer/app.js`. |

`strict_tdd` is satisfied by writing the parser and remap tests before production code.

## Threat Matrix

This change only performs browser-local file upload/download and text parsing. No routing, shell commands, subprocesses, VCS/PR automation, executable-file classification, or process integration are introduced.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, etc. | N/A — no file execution or classification boundary. | — | — |
| Git repository selection | `git -C`, relative/absolute paths | N/A — no Git automation. | — | — |
| Commit state | staged, `commit -a`, empty index | N/A — no VCS integration. | — | — |
| Push state | tracking branch, first push, refspec | N/A — no VCS integration. | — | — |
| PR commands | `--head`, composed commands | N/A — no PR automation. | — | — |

## Migration / Rollout

No migration is required. The deterministic voxelization core is untouched.

Rollback: revert the commit that adds the palette editor. All prior read-only palette behavior is restored with no persisted data or schema changes.

## Open Questions

- [ ] What is the exact merge interaction? Two-click select (source, then target) is simplest; confirm before removing the source entry.
- [ ] Should drag-to-reorder have a keyboard-accessible fallback? The project currently has no keyboard drag pattern.
