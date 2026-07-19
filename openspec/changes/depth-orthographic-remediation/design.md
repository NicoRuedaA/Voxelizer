# Design: Finish Depth and Orthographic Viewport Remediation

## Technical Approach

Complete the handoff as a strict RED-GREEN remediation, not a rewrite. First migrate the three obsolete API tests; the verified baseline is currently 75/78 passing, with only calls to removed `VoxelViewport` helpers failing. Then add deterministic regressions around the existing candidate implementations and change production code only where a RED test proves a defect. The proposal is authoritative; no optional delta spec exists.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Rewrite depth/camera/export/worker abstractions | Cleaner conceptual boundary but high regression risk to material-aware v3 | Reject. Preserve globals and current module responsibilities; make narrow fixes justified by tests. |
| Test browser behavior through source-text assertions | Cheap but brittle and behavior-blind | Use the existing VM loaders, fake cameras/controls/workers, and a narrow `window.__dbg` seam only where stale UI state needs observation. |
| Allocate/export or synchronously voxelize every legal grid | Maximizes capability but can exhaust memory or freeze the UI | Keep independent pre-allocation VOX and synchronous-work budgets with stable error codes. |
| Refit cameras on every update | Prevents stale bounds but destroys user orbit | Refit on reset, mode/resize changes, and material dimension changes; otherwise update clip planes without resetting orientation. |

## Data Flow

```text
selected side frame -> VoxelProfileDepth.actionState -> depth control
source/options/views -> app invalidates old evidence -> WorkerChannel
  -> worker success OR bounded fallback -> voxel result -> model + camera fit
  -> failure/oversize -> settled promise -> empty viewport/diagnostics/export disabled
voxel result -> VoxIO preflight -> exact Uint8Array OR stable budget rejection
```

## File Changes

| File | Action | Description |
|---|---|---|
| `tests/voxelizer.test.js` | Modify | Migrate obsolete calls; add profile, controller/clipping, stale-state, VOX-byte, and worker-incarnation/fallback regressions. |
| `voxelizer/profile-depth.js` | Conditional modify | Fix only proven validation, clamping, or busy-state defects. |
| `voxelizer/viewport.js` | Conditional modify | Fix only proven pose, controls, frustum, clipping, or refit defects. |
| `voxelizer/app.js` | Conditional modify | Ensure start/failure invalidates mesh, statistics, diagnostics, and export state; expose only the minimal debug test seam needed. |
| `voxelizer/voxio.js` | Conditional modify | Preserve exact pre-sized VOX layout and reject over-budget or unsupported palettes before output allocation. |
| `voxelizer/worker-channel.js` | Conditional modify | Bound fallback work and settle every job in a failed worker incarnation. |
| `voxelizer/index.html`, `.github/workflows/ci.yml` | Verify/conditional modify | Preserve script order and syntax coverage; edit only if integration checks fail. |
| `README.md`, `docs/PLAN_GENERACION_3D.md` | Modify | Correct depth, Match Profile, camera, budget, IoU, and worker-fallback guidance after behavior is green. |

## Interfaces / Contracts

- `VoxelProfileDepth.actionState(views, maximum, activity)` returns structured status, depth, source width, clamp, busy, and disabled fields; valid pixels require exact 8-bit RGBA length.
- `VoxelViewport.createCameraController(options)` retains its current methods/getters and canonical Front/Profile/Top axes; orthographic mode locks rotate/pan and Perspective restores its auto-rotate preference.
- `VoxIO.exportVox(result)` uses `1096 + 4 * occupiedVoxelCount` bytes and throws `VOX_EXPORT_BUDGET_EXCEEDED` before allocation.
- `VoxelWorkerChannel` estimates `w*h*depth`; oversized fallback rejects with `WORKER_FALLBACK_WORK_EXCEEDED` and leaves no pending jobs.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Profile policy, poses/frusta/clips, VOX chunks/bytes/budget, fallback estimate | Node `node:test` with VM-loaded globals and exact byte assertions. |
| Integration | Controller camera/control switching; worker creation/runtime/protocol failures; stale app evidence | Fake Three.js controls/cameras/workers and a focused fake-browser harness. |
| Manual | Deep-model visibility, resize/reset, failed reconstruction, export interoperability | Handoff browser smoke sequence plus HTML ID/reference/script-order checks. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and planned RED tests |
|---|---|---|
| Documentation-like paths | N/A — no executable classification | None. |
| Git repository selection | N/A — no Git invocation | None. |
| Commit state | N/A — no commit automation | None. |
| Push state | N/A — no push automation | None. |
| PR commands | N/A — no PR automation | None. |
| Browser Worker process integration | Applicable | Small jobs fall back; oversized jobs reject stably; all incarnation jobs settle. RED tests cover constructor, runtime, protocol/postMessage, concurrent pending, and oversized failures. |

## Migration / Rollout

No data migration or feature flag is required. Keep each TDD work unit green and rollbackable. Because the existing working-tree diff already exceeds the 800-line review budget, task planning must partition the full authored diff—not merely new remediation lines—into independently verified review slices, or record an explicit budget exception.

## Open Questions

None. Task planning is not blocked.
