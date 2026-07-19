## Exploration: finish depth and orthographic viewport remediation

### Current State
The repository is a static browser JavaScript application with a deterministic voxelization core, UI integration, viewport helpers, worker transport, and OBJ/VOX export. The handoff describes a partially applied, uncommitted remediation. The current working tree already contains profile-depth policy (`VoxelProfileDepth`), a camera controller (`VoxelViewport`), stale-preview invalidation, bounded VOX serialization, and bounded synchronous worker fallback. The handoff records a baseline of 78 tests with 75 passing and three obsolete API test failures.

`VoxelProfileDepth` validates complete 8-bit RGBA payloads, matches the selected `side` view width, clamps depth to the configured maximum, and exposes busy-aware action state. `VoxelViewport` derives perspective distance, orthographic frusta, and near/far planes from model dimensions; its controller switches the active camera and disables rotation/pan/auto-rotate in orthographic modes. `app.js` clears model, readout, alignment, and diagnostics state before preview rebuilds and gates Match Profile and export actions on activity/result state. `VoxIO.exportVox` preflights a bounded direct binary allocation, while `VoxelWorkerChannel` estimates synchronous fallback work and rejects oversized fallback jobs.

### Affected Areas
- `docs/HANDOFF_DEPTH_ORTHOGRAPHIC_REMEDIATION.md` — execution contract, acceptance criteria, known obsolete tests, and verification commands.
- `tests/voxelizer.test.js` — migrate three obsolete API calls and add controller, profile action, VOX binary/budget, fallback, and stale-state regressions.
- `voxelizer/profile-depth.js` — source-of-truth validation and selected-side-frame depth policy; currently structurally complete but lightly covered.
- `voxelizer/viewport.js` — orthographic poses/frusta, perspective fitting, clip planes, and camera-controller transitions.
- `voxelizer/app.js` — camera/UI wiring, busy-state action gating, stale evidence clearing, and export integration.
- `voxelizer/voxio.js` — bounded VOX writer, palette-index mapping, chunk layout, and export budget error boundary.
- `voxelizer/worker-channel.js` — worker incarnation failure settlement and bounded main-thread fallback.
- `voxelizer/index.html` — camera/depth controls and script dependency order; requires HTML integration checks.
- `README.md`, `docs/PLAN_GENERACION_3D.md` — documentation updates after behavior is green.
- `.github/workflows/ci.yml` — existing syntax-check capability for helper scripts.

### Approaches
1. **Test-first completion of the existing remediation** — repair the three known tests, add focused deterministic regressions around public helper APIs and fake camera/control/worker objects, and change candidate implementation only when a failing test demonstrates a defect.
   - Pros: preserves material-aware v3 and existing partial work; minimizes blast radius; aligns with strict TDD and the handoff’s explicit contract.
   - Cons: browser smoke verification remains manual; controller and worker fakes need careful contract modeling.
   - Effort: Medium

2. **Replace the remediation with a broad rewrite** — redesign depth, camera, export, and fallback together.
   - Pros: potentially simpler unified abstractions.
   - Cons: high regression risk, unnecessary because implementations already exist, threatens preserved material-aware behavior, and exceeds the review budget’s intended first slice.
   - Effort: High

### Recommendation
Use the existing implementation and proceed in narrow TDD slices. First migrate the three obsolete tests and rerun the suite; then add viewport-controller tests, profile action-state cases, VOX byte/budget tests, and worker failure/fallback tests. Only fix implementation defects exposed by those tests. Finish with documentation, syntax/diff/HTML checks, and manual browser smoke coverage. Keep per-part elliptical/superellipse reconstruction explicitly deferred.

### Risks
- A legal `1×1×256` logical model can produce very deep world dimensions; any fixed orthographic far plane or incomplete perspective fitting will clip it.
- Worker failure paths must settle every pending job and reject oversized synchronous fallback without freezing the UI.
- VOX output must preserve exact chunk sizes, axis mapping, one-based palette indices, and reject the independent export-byte budget before allocation.
- Stale geometry and diagnostics can misrepresent a failed or superseded reconstruction unless sequence invalidation and cleanup remain synchronized.
- The handoff’s whitespace command is intentionally negated (`! grep`) and should be preserved when verifying; browser smoke tests are not automated by the current test capability.
- The requested review budget is 800 changed lines, so implementation should remain a focused first slice rather than adding deferred reconstruction design.

### Ready for Proposal
Yes. The scope, affected modules, existing public APIs, baseline failures, acceptance gates, testing command, and deferred work are sufficiently explicit for `sdd-propose`. The proposal should preserve the current material-aware v3 work, require rollback by reverting only the new remediation work units, and keep the first implementation slice within the review budget.
