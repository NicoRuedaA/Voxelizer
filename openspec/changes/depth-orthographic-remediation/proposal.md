# Proposal: Apply the change in `/home/nico/dev/voxelizer-app/docs/HANDOFF_DEPTH_ORTHOGRAPHIC_REMEDIATION.md`

## Intent

Complete the partially applied depth and orthographic viewport remediation described by the handoff. The change will turn the existing implementation into a verified, regression-safe slice while preserving material-aware v3 behavior.

## Scope

### In Scope
- Migrate the three obsolete API tests and establish the current baseline.
- Add focused deterministic regressions for profile depth/action state, viewport cameras and clipping, stale-preview cleanup, VOX bytes/budget, worker failure settlement, and bounded synchronous fallback.
- Fix implementation only when a failing test demonstrates a defect; then complete documentation, syntax/HTML checks, and manual browser smoke verification.

### Out of Scope / Non-goals
- No broad rewrite of depth, camera, export, or worker abstractions.
- No per-part elliptical/superellipse reconstruction design or implementation.
- No removal or regression of existing material-aware v3 behavior.

## Capabilities

### New Capabilities
- `depth-orthographic-remediation`: Verified profile-depth policy, orthographic/perspective viewport fitting, stale-state invalidation, bounded VOX export, and bounded worker fallback.

### Modified Capabilities
- None identified in `openspec/specs/`; the capability is currently represented by the handoff and existing code rather than a main spec.

## Approach

Use narrow TDD work units: obsolete tests first, then viewport/profile, VOX, worker, and stale-state regressions. Preserve current public APIs and fake browser dependencies in tests. Finish with documentation and the handoff’s exact verification commands, including the intentionally negated whitespace check.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `tests/voxelizer.test.js` | Modified | Tests and obsolete API migration. |
| `voxelizer/{profile-depth,viewport,app,voxio,worker-channel}.js` | Modified | Only proven defects and integration coverage. |
| `voxelizer/index.html`, `README.md`, `docs/PLAN_GENERACION_3D.md` | Modified | Integration/documentation verification. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Deep models clip or overflow | Med | Test `1×1×256`, clip planes, and export budget before allocation. |
| Failed workers leave stale UI/pending jobs | Med | Regression-test settlement and sequence invalidation. |
| Scope threatens material-aware v3 | Low | Preserve existing implementation; reject broad rewrite. |

## Rollback Plan

Revert only the discrete remediation work units (tests, implementation fixes, then docs), leaving the pre-existing material-aware v3 work untouched. Stop at the last green work unit if a later slice fails.

## Dependencies

- Existing static browser JavaScript, Node `node:test`, and manual browser smoke capability.

## Success Criteria

- [ ] Obsolete tests are migrated and the full test suite passes.
- [ ] Focused regressions cover all handoff acceptance gates, including deep dimensions, worker fallback, VOX budget, and stale-state cleanup.
- [ ] Syntax, HTML, documentation, and manual smoke checks pass within the 800-line review budget.
