# Tasks: Depth and Orthographic Viewport Remediation

## Review Workload Forecast

Est. changed lines: ~1840 (1535 modified + 307 new). Worktree already exceeds 800-line budget per design; partition into review slices.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| # | Goal | PR | Focused test | Runtime | Rollback |
|---|------|----|--------------|---------|----------|
| A | voxel.js v3 + fixtures + invariants | 1 | `node --test` + `node --check voxelizer/voxel.js` | N/A (VM) | voxel.js + fixtures |
| B | obsolete API tests + profile-depth | 2 | `node --test` + `node --check voxelizer/profile-depth.js` | N/A (fakes) | profile-depth.js + tests |
| C | viewport + app stale-state | 3 | `node --test` + `node --check voxelizer/{viewport,app}.js` | N/A (fake Three) | viewport.js + app.js + tests |
| D | bounded VOX + worker fallback | 4 | `node --test` + `node --check voxelizer/{voxio,worker-channel}.js` | N/A (fake workers) | voxio.js + worker-channel.js + tests |
| E | index.html + docs + CI + handoff + smoke | 5 | handoff commands below | Browser smoke | docs + CI + index.html + HANDOFF |

## Phase 1: Foundation (voxel.js v3)
- [x] 1.1 RED: voxel.js v3 invariants from `tests/fixtures/reconstruction-fixtures.js`
- [x] 1.2 GREEN: place `voxelizer/voxel.js` + fixtures; confirm ≥75/78 baseline; `node --check voxelizer/voxel.js`

## Phase 2: Tests Baseline + Profile Depth
- [x] 2.1 RED: migrate obsolete `VoxelViewport` tests at `tests/voxelizer.test.js:254,265,301`
- [x] 2.2 GREEN: replace with current-API equivalents; suite green
- [x] 2.3 RED: profile-depth — width 300 → depth 256; invalid bytes → disabled; busy → disabled
- [x] 2.4 GREEN: `voxelizer/profile-depth.js` `actionState` honors clamp+disabled; fix proven defects only

## Phase 3: Camera Modes and Stale-State Invalidation
- [x] 3.1 RED: traverse Perspective/Front/Profile/Top restores preference; 1×1×256 fits frustum/clip across reset/resize/material
- [x] 3.2 GREEN: `voxelizer/viewport.js` `createCameraController` canonical axes, ortho locks rotate/pan, refit on reset/resize/material only
- [x] 3.3 RED: failed reconstruction clears mesh/wireframe/stats/diagnostics, disables export; success replaces stale without losing material
- [x] 3.4 GREEN: `voxelizer/app.js` start/failure invalidation; minimal `window.__dbg` seam if needed

## Phase 4: Bounded VOX + Worker Fallback
- [x] 4.1 RED: VOX within budget = SIZE/XYZI/RGBA total 1096+4*N; over throws `VOX_EXPORT_BUDGET_EXCEEDED` pre-allocation; bad palette rejects
- [x] 4.2 GREEN: `voxelizer/voxio.js` exact pre-sized layout, preflight before allocation; fix proven defects
- [x] 4.3 RED (threat-matrix Browser Worker): constructor/runtime/postMessage failures, concurrent pending, oversized rejects `WORKER_FALLBACK_WORK_EXCEEDED` non-blocking; all incarnation jobs settle once
- [x] 4.4 GREEN: `voxelizer/worker-channel.js` estimates `w*h*depth`, bounds sync fallback, settles all pending jobs

## Phase 5: Wiring, Docs, CI, Final Smoke
- [x] 5.1 Verify `voxelizer/index.html` script order/syntax; edit only if integration fails
- [x] 5.2 Update `README.md`, `docs/PLAN_GENERACION_3D.md` (depth, Match Profile, camera, budget, IoU, worker-fallback)
- [x] 5.3 Add `docs/HANDOFF_DEPTH_ORTHOGRAPHIC_REMEDIATION.md`; update `.github/workflows/ci.yml` only if required
- [x] 5.4 Handoff whitespace check: `! grep -nE '[[:blank:]]+$' voxelizer/{profile-depth,viewport,voxio,worker-channel,app,voxel}.js tests/voxelizer.test.js`
- [x] 5.5 Manual browser smoke: 1×1×256 visibility, resize/reset, failed reconstruction, export
- [x] 5.6 Final acceptance: Node suite + syntax + `git diff --check` + handoff commands pass