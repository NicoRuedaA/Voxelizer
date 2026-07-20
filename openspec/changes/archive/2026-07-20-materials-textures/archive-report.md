# Archive Report: materials-textures

## Archive Metadata

| Field | Value |
|-------|-------|
| **Change** | `materials-textures` — Per-palette PBR material properties and preview lighting |
| **Archive date** | 2026-07-20 |
| **Artifact store mode** | `hybrid` (Engram observations + OpenSpec files) |
| **Preflight / delivery context** | `auto-chain`, `feature-branch-chain`, 800-line budget, skip validation blockers |
| **Action context** | `repo-local`, workspaceRoot `/mnt/dev/voxelizer-app`, allowedEditRoots `[/mnt/dev/voxelizer-app]` |
| **Archive destination** | `openspec/changes/archive/2026-07-20-materials-textures/` |
| **Archive status** | `intentional-with-warnings` |

## Blocker Log

This archive was performed with explicit user override to continue past two blockers. Both are recorded below.

### 1. Task Completion Gate — stale checkbox

- **Artifact**: `openspec/changes/materials-textures/tasks.md` and Engram `sdd/materials-textures/tasks` (#698).
- **Finding**: Task `4.3 Manual browser check: emissive glow, metallic specular response, default palette flat-path regression.` remained unchecked (`- [ ]`). All other 17 implementation tasks were checked.
- **Proof of completion**: `apply-progress.md` and `verify-report.md` confirm that all automated work (Phases 1–3 and verification tasks 4.1–4.2) is complete. Task 4.3 is a manual browser check; the project has no automated browser harness.
- **Resolution**: Reconciled as an archive-time stale checkbox per the orchestrator/user override. The unchecked task is left as-is in the archived `tasks.md` to preserve the audit trail, but it is marked as intentionally incomplete due to lack of automated harness.

### 2. Review Receipt Gate — missing review artifacts

- **Expected artifacts**: `reviews/{transaction,ledger,receipt,chain-bundle,gate-context}.json` (OpenSpec) and `sdd/materials-textures/review/{transaction,ledger,receipt,gate-context}` (Engram).
- **Finding**: No review artifacts exist in either store. Native `gentle-ai sdd-status` reported all review artifacts as `missing` and `reviewGate` absent.
- **Resolution**: Archived without a review receipt per the orchestrator/user override. This is recorded as an intentional-with-warning archive.

## Artifact Inventory

| Artifact | OpenSpec Path | Engram Observation | Status |
|----------|---------------|-------------------|--------|
| Proposal | `openspec/changes/materials-textures/proposal.md` | `#694` `sdd/materials-textures/proposal` | ✅ present |
| Spec (per-palette-pbr-materials) | `openspec/changes/materials-textures/specs/per-palette-pbr-materials/spec.md` | included in `#695` `sdd/materials-textures/spec` | ✅ present |
| Spec (advanced-palette-editor delta) | `openspec/changes/materials-textures/specs/advanced-palette-editor/spec.md` | included in `#695` `sdd/materials-textures/spec` | ✅ present |
| Spec+design combined note | — | `#697` (supplementary project memory) | ✅ present |
| Design | `openspec/changes/materials-textures/design.md` | `#696` `sdd/materials-textures/design` | ✅ present |
| Tasks | `openspec/changes/materials-textures/tasks.md` | `#698` `sdd/materials-textures/tasks` | ⚠️ present, 1 stale unchecked task (4.3) |
| Apply Progress | `openspec/changes/materials-textures/apply-progress.md` | `#699` `sdd/materials-textures/apply-progress` | ✅ present |
| Verify Report | `openspec/changes/materials-textures/verify-report.md` | `#700` `sdd/materials-textures/verify-report` | ✅ present |
| Review Transaction | — | missing | ⚠️ missing |
| Review Ledger | — | missing | ⚠️ missing |
| Review Receipt | — | missing | ⚠️ missing |
| Review Gate Context | — | missing | ⚠️ missing |

## Spec Sync Summary

Delta specs were merged into the main specs source of truth.

| Domain | Action | Added | Modified | Removed | Renamed |
|--------|--------|-------|----------|---------|---------|
| `advanced-palette-editor` | Updated existing `openspec/specs/advanced-palette-editor/spec.md` | 1 | 6 | 0 | 0 |
| `per-palette-pbr-materials` | Created new `openspec/specs/per-palette-pbr-materials/spec.md` | 6 | 0 | 0 | 0 |

### Details

**`advanced-palette-editor`**

- **Added**: `Requirement: Edit surface materials` (4 scenarios: edit metallic, edit roughness, edit emissive, clamp out-of-range values).
- **Modified**:
  - `Requirement: Immediate preview` — remap now applies to both palette colors and surface materials.
  - `Requirement: Reset edits` — reset now restores original palette and surface materials.
  - `Requirement: Import .gpl palettes` — preserves surface materials of untouched swatches.
  - `Requirement: Import JASC-.pal palettes` — preserves surface materials of untouched swatches.
  - `Requirement: Reorder colors` — remap also applies to surface materials.
  - `Requirement: Merge colors` — merged source surface material discarded, target surface material used.
- Preserved unchanged: `Export palettes`, `Edit colors`.

**`per-palette-pbr-materials`**

- New full spec copied from delta with 6 requirements:
  1. Surface material table
  2. PBR preview path
  3. Preview lighting
  4. OBJ PBR export
  5. Palette editor surface material controls
  6. Material index remapping

## README CHANGELOG Update

Updated `/mnt/dev/voxelizer-app/README.md`:

- Test badge updated from `160/160` to `178/178`.
- Regression test count updated from 160 to 178.
- Added new CHANGELOG section `materials-textures — Per-palette PBR Materials (2026-07-20)` above the existing `advanced-palette` entry.
- New section documents `surfaceMaterials` table, conditional PBR preview path, lighting rig, OBJ `.mtl` PBR extensions (`Pm`, `Pr`, `Ke`), per-swatch M/R/E inputs, material index remapping, and changed files.

## Verification Summary

| Metric | Value |
|--------|-------|
| Verdict | `pass_with_warnings` |
| Blockers | 0 |
| Critical findings | 0 |
| Requirements covered | 13/13 |
| Scenarios covered | 28/28 |
| Tests | 178 passed / 0 failed / 0 skipped |
| Build / syntax checks | All passed (`node --check` on modified scripts) |

The verification report explicitly notes task 4.3 (manual browser check) as a warning because no automated browser harness exists in the project.

## Risks / Intentional-With-Warnings Note

1. **Manual browser check outstanding**: Task 4.3 (emissive glow, metallic specular response, default palette flat-path regression) was not executed automatically. The project lacks a browser harness; this must be done manually before release if visual regression confidence is required.
2. **No review receipt**: The change was archived without a native review gate transaction, ledger, or receipt. Future releases or PRs that require review validation will need to either supply a retroactive receipt or treat this change as pre-review-era.
3. **Spec destructive potential**: None. The merge was additive/modificatory only; no requirements were removed or renamed.

## Cycle Closure

The SDD cycle for `materials-textures` is closed with the above warnings. All automated verification passed, all delta specs are synced to the main specs, the README is updated, and the change folder is moved to the archive.
