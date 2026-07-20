# Archive Report: export-formats

**Change**: `export-formats`
**Project**: `/mnt/dev/voxelizer-app`
**Artifact store mode**: `hybrid` (Engram + OpenSpec)
**Archive date**: `2026-07-20`
**Archive path**: `openspec/changes/archive/2026-07-20-export-formats/`
**Archive status**: `intentional-with-warnings` — archive completed after logging user-overridden blockers.

## Executive Summary

The `export-formats` change adds pure-JavaScript glTF/GLB and FBX ASCII exporters to `voxelizer/voxio.js`, wires `fmtGlb`/`fmtFbx` toggles into the UI and batch ZIP flow, extends per-palette PBR material export coverage, and verifies the work with 202/202 passing Node tests. This report closes the SDD cycle and records the archive audit trail.

## Artifact Retrieval Trace

All SDD artifacts were read before archive actions were taken.

### OpenSpec artifacts (filesystem)

| Artifact | Path | State |
|----------|------|-------|
| Proposal | `openspec/changes/export-formats/proposal.md` | read |
| Specs | `openspec/changes/export-formats/specs/gltf-glb-export/spec.md` | read |
| Specs | `openspec/changes/export-formats/specs/fbx-ascii-export/spec.md` | read |
| Specs | `openspec/changes/export-formats/specs/per-palette-pbr-materials/spec.md` | read |
| Design | `openspec/changes/export-formats/design.md` | read |
| Tasks | `openspec/changes/export-formats/tasks.md` | read |
| Apply progress | `openspec/changes/export-formats/apply-progress.md` | read |
| Verify report | `openspec/changes/export-formats/verify-report.md` | read |

### Engram artifacts (observation IDs)

| Topic | Observation ID | Type | State |
|-------|----------------|------|-------|
| `sdd/export-formats/explore` | `#702` | architecture | read |
| `sdd/export-formats/proposal` | `#703` | architecture | read |
| `sdd/export-formats/spec` | `#704` | architecture | read |
| `sdd/export-formats/design` | `#705` | architecture | read |
| `sdd/export-formats/tasks` | `#706` | architecture | read |
| `sdd/export-formats/apply-progress` | `#707` | architecture | read |
| `sdd/export-formats/verify` (decision log) | `#709` | decision | read |

No Engram topics were found for `sdd/export-formats/verify-report` or `sdd/export-formats/review/{transaction,ledger,receipt,gate-context}`.

## Gate Validation

### Review / Receipt Gate

- **Result**: `blocked / missing`
- **Reason**: No native review artifacts exist. The OpenSpec `openspec/changes/export-formats/reviews/` directory is absent, and no Engram `sdd/export-formats/review/{transaction,ledger,receipt,gate-context}` topics were found.
- **Override applied**: User instruction: "Preflight: automatic", "Skip validation blockers", and "If review/receipt blockers prevent archive, log them and continue per user instruction." The missing review gate was logged and archive proceeded without a validated receipt.

### Task Completion Gate

- **Result**: `allow`
- **Evidence**: `openspec/changes/export-formats/tasks.md` shows all 28 implementation tasks checked `[x]`. Engram `sdd/export-formats/tasks` (`#706`) also shows 28/28 complete.
- **No stale checkboxes**: No unchecked implementation tasks remained; no reconciliation was required.

### Verification Gate

- **OpenSpec verify report**: `PASS` — `verdict: pass`, `requirements: 17/17`, `scenarios: 33/33`, `critical_findings: 0`, `test_exit_code: 0`, 202/202 tests passing.
- **Engram / local verify artifact**: The local file `sdd/export-formats/verify-report` and Engram decision `#709` record an earlier `FAIL` state with `critical_findings: 2` due to untested PBR material-index alignment scenarios.
- **Discrepancy resolution**: The OpenSpec `verify-report.md` is the current, remediated report (evidence includes new alignment tests and 202 passing tests). The Engram/local entry is stale relative to the final verified state. The user override explicitly permits continuing past validation blockers; the discrepancy is logged here as an intentional archive-with-warning.
- **CRITICAL check**: The authoritative final verification artifact (`openspec/changes/export-formats/verify-report.md`) reports zero critical findings. Archive proceeded on that basis while preserving the stale Engram/local record in the audit trail.

## Delta Spec Sync

The following delta specs were synchronized into the main specs source of truth.

| Domain | Main spec path | Action | Details |
|--------|----------------|--------|---------|
| `gltf-glb-export` | `openspec/specs/gltf-glb-export/spec.md` | Created | Delta copied as the initial full spec. 8 requirements added. |
| `fbx-ascii-export` | `openspec/specs/fbx-ascii-export/spec.md` | Created | Delta copied as the initial full spec. 7 requirements added. |
| `per-palette-pbr-materials` | `openspec/specs/per-palette-pbr-materials/spec.md` | Already synced | The PBR cross-format modification and material-index-alignment addition were already merged by `sdd-apply` task 5.1; archive verified the main spec matches the delta. |

No unrelated requirements were removed or altered.

## Archive Move

The active change folder was moved to the archive with the ISO-date prefix:

```
openspec/changes/export-formats/
  → openspec/changes/archive/2026-07-20-export-formats/
```

The archive is an audit trail; no archived files were modified after the move.

## Archive Contents

After the move, the archive folder contains:

- `proposal.md` ✅
- `specs/` ✅
  - `gltf-glb-export/spec.md`
  - `fbx-ascii-export/spec.md`
  - `per-palette-pbr-materials/spec.md`
- `design.md` ✅
- `tasks.md` ✅ (28/28 tasks complete)
- `apply-progress.md` ✅
- `verify-report.md` ✅
- `exploration.md` ✅
- `archive-report.md` ✅

## README.md Changelog Update

`/mnt/dev/voxelizer-app/README.md` was updated to:

- Refresh the test badge to `202/202`.
- Add a new `export-formats` changelog entry documenting glTF/GLB export, FBX ASCII export, UI toggles, batch ZIP support, per-palette PBR preservation, and 202/202 tests.

## Blockers and Overrides Log

| Gate / Check | Blocker | Severity | How resolved |
|--------------|---------|----------|--------------|
| Review/receipt gate | No review transaction, ledger, receipt, or gate-context artifacts exist. | non-critical blocker | Logged; user override instructed to continue. |
| Verification gate | Stale Engram decision `#709` and `sdd/export-formats/verify-report` file report a prior `FAIL` with 2 critical findings. | resolved discrepancy | Current OpenSpec `verify-report.md` shows PASS with 0 critical findings and 202/202 tests; override logged and archive marked intentional-with-warnings. |

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/gltf-glb-export/spec.md`
- `openspec/specs/fbx-ascii-export/spec.md`
- `openspec/specs/per-palette-pbr-materials/spec.md`

## SDD Cycle Status

The `export-formats` change has been planned, implemented, verified, and archived. The cycle is complete with the warnings documented above. Ready for the next change.
