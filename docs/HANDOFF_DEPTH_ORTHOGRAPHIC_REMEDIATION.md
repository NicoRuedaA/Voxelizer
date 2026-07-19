# Handoff: finish depth and orthographic viewport remediation

This document is the execution contract for finishing the current **partially applied, uncommitted** depth/profile/camera remediation. It is intentionally explicit so a lower-cost model can continue without reconstructing the project history.

## Outcome

Finish and verify these user-visible behaviors:

1. Depth is configurable from `1` to `256` and can match the selected side-view frame width.
2. Front, Profile, and Top use real orthographic cameras with canonical axes.
3. Perspective and orthographic cameras fit every legal model without clipping.
4. High-depth VOX export and worker fallback remain memory/UI safe.
5. Failed reconstruction never leaves stale geometry or diagnostics on screen.

Do **not** start over. Most implementation code already exists in the working tree.

## Workspace guard

Repository:

```text
/mnt/dev/voxelizer-app
```

Before editing:

```bash
cd /mnt/dev/voxelizer-app
git status --short
git diff --stat
```

Rules:

- Do not run `git reset`, `git checkout -- .`, `git clean`, or any equivalent destructive command.
- Do not modify or commit `.atl/` or `.codegraph/`.
- Do not remove the existing material-aware v3 reconstruction.
- Do not create commits or push unless the user explicitly requests it.
- Never add `Co-Authored-By` or AI attribution.
- Keep technical artifacts and code in English.

## Current state

The working tree already contains:

- Material-aware strict/weighted multiview reconstruction.
- Configuration v3 with exact v1/v2 migration.
- Depth range raised toward `256`.
- `Match profile` behavior and profile-resolution diagnostics.
- Real Perspective/Front/Profile/Top camera modes.
- Partial camera safety, VOX allocation, fallback, and stale-state remediation.

The interrupted remediation modified:

| File | Current responsibility |
|---|---|
| `voxelizer/profile-depth.js` | Profile-depth policy, validation, and action states |
| `voxelizer/viewport.js` | Camera geometry and testable camera controller |
| `voxelizer/app.js` | Camera/UI integration, stale-state clearing, Match Profile gating |
| `voxelizer/index.html` | Camera and depth controls plus script loading |
| `voxelizer/voxio.js` | Bounded typed-array VOX serialization |
| `voxelizer/worker-channel.js` | Bounded synchronous fallback policy |
| `tests/voxelizer.test.js` | Partially migrated/new tests |
| `.github/workflows/ci.yml` | Syntax checks for new helpers |

Existing changes in `README.md`, `docs/PLAN_GENERACION_3D.md`, `voxelizer/voxel.js`, and the reconstruction fixtures predate the interrupted remediation and must be preserved.

Already implemented—test before changing:

- `MAX_DEPTH_LAYERS` and the UI depth maximum are `256`.
- Profile-depth policy is separated into `profile-depth.js`.
- Dynamic camera/controller, stale-preview invalidation, direct bounded VOX writing, and bounded synchronous fallback have candidate implementations in the working tree.

Still pending:

- Migrate the three obsolete tests below.
- Add the missing controller, export-boundary, and fallback regressions.
- Change candidate code only when a focused test proves a defect.
- Update README/plan, run browser verification, and obtain final fresh review.

## Baseline verification

At interruption time:

```text
78 tests
75 passed
3 failed
```

All syntax checks passed for:

```text
voxelizer/profile-depth.js
voxelizer/viewport.js
voxelizer/app.js
voxelizer/voxio.js
voxelizer/worker-channel.js
```

The three known failures are obsolete API calls, not algorithm failures:

1. `Match profile usa el ancho de la frame lateral ya cortada del spritesheet`
   - `tests/voxelizer.test.js:254`
   - Use the existing `loadProfileDepthRuntime()` helper.
   - Replace `{ w: 300 }` with a valid `makePixels(300, 1, ...)` payload because the new API validates complete typed RGBA data.
   - Replace `Viewport.matchProfileDepth()` with `ProfileDepth.matchSideDepth()`.
2. `Match profile queda deshabilitado sin vista lateral y no infiere desde frontal`
   - `tests/voxelizer.test.js:265`
   - Use `ProfileDepth.actionState(views, 256, {})` and assert `status === ProfileDepth.STATUS.NO_SIDE_VIEW`, `enabled === false`, `disabled === true`, and `depth === null`.
   - Do not retain the obsolete `match.reason` assertion.
3. `poses ortograficas respetan los ejes canonicos frontal perfil y cenital`
   - `tests/voxelizer.test.js:301`
   - Replace every `cameraPose()` call on the local `Viewport` runtime with `Viewport.orthographicPose()`.

Fix these tests first, rerun the suite, and only then address any newly exposed failure.

## Current public helper APIs

### `VoxelProfileDepth`

```text
STATUS
actionState
clampDepth
matchSideDepth
validRgbaPixels
```

Expected behavior:

- Use `side` internally; reserve “Profile” for UI copy.
- A valid side payload requires positive safe-integer `w` and `h`, plus `data` as `Uint8Array` or `Uint8ClampedArray` with exactly `w*h*4` bytes.
- Match the selected, explicitly sliced side-frame width—not the full spritesheet width.
- Clamp to the supported depth range.
- Return structured status/data. Render human-facing copy in `app.js`, not in this domain helper.
- Disable the action when there is no valid side view or when preview/batch work is active.

### `VoxelViewport`

```text
CAMERA_MODES
boundingSphere
cameraClipPlanes
cameraMode
createCameraController
dimensionsMateriallyChanged
normalizeDimensions
orthographicFrustum
orthographicPose
perspectiveFitDistance
perspectivePose
```

Controller methods/getters:

```text
reset
resize
setAutoRotate
setDimensions
setMode
activeCamera
aspect
autoRotatePreference
dimensions
mode
```

Canonical screen axes:

| Mode | Screen horizontal | Screen vertical | View direction |
|---|---|---|---|
| Front | `+X` | `+Y` | `+Z → -Z` |
| Profile | `+Z` | `+Y` | `-X → +X` |
| Top | `+X` | `+Z` | `+Y → -Y` |

Orthographic modes must lock rotation and effective auto-rotate. Returning to Perspective must restore the stored Perspective auto-rotate preference.

## Required completion tasks

### 1. Repair and expand tests

Migrate the three obsolete calls listed above.

Add deterministic tests for:

- Perspective → Front → Profile → Top → Perspective switching.
- Correct active camera and OrbitControls object.
- Orthographic rotation/pan/auto-rotate flags.
- Perspective auto-rotate preference restoration.
- Reset behavior in every mode.
- Resize/aspect/frustum refit.
- Model dimension changes and perspective refit.
- `1×1×256` model visibility without clipping.
- Match Profile with no side view, busy preview, busy batch, static side, and selected side-sheet frame.
- Strict invalid side payload rejection.

Prefer fake camera/control objects through `createCameraController()` over brittle source-text assertions.

### 2. Confirm camera clipping and fitting

The previous implementation used a fixed orthographic `far=5000`. A legal `1×1×256` model can scale to world dimensions near `[44,44,11264]` and be placed more than `22000` units away, so a fixed plane clips the entire model.

Acceptance criteria:

- Near/far planes derive from pose distance plus model bounds or bounding sphere.
- Planes update after model rebuild, camera-mode change, reset, and relevant resize.
- Perspective distance derives from bounding dimensions, vertical FOV, and aspect.
- Deep models remain fully visible in Perspective and all orthographic modes.
- Ordinary user orbit is not reset on every recompute; refit only when dimensions materially change or the user requests reset.

### 3. Confirm stale-state and action behavior

On reconstruction start or failure:

- Dispose/remove the previous mesh and wireframe.
- Clear or mark voxel/face statistics unavailable.
- Clear profile-resolution and reconstruction diagnostics.
- Disable export until a valid result exists.
- Never show an old model as if it represented the failed depth value.

`Match profile` must be disabled while `state.busy || state.batchBusy`.

### 4. Finish bounded VOX serialization

`exportVox()` must not build millions of JavaScript numbers and repeatedly copy them through `concat()`.

The direct binary layout can be pre-sized:

```text
total bytes = 1096 + 4 * occupiedVoxelCount
```

This covers the VOX header, MAIN/SIZE/XYZI/RGBA chunks, and XYZI records.

Acceptance criteria:

- Write directly into a pre-sized `Uint8Array`/`DataView` or equally bounded chunks.
- Preflight peak/export bytes before allocation.
- Preserve palette indices `1..255`; reject unsupported color counts rather than corrupting output.
- Preserve exact SIZE, XYZI, and RGBA chunk lengths.
- Test one successful bounded export and an otherwise legal large/full solid grid that rejects with `VOX_EXPORT_BUDGET_EXCEEDED`.
- Do not require every legal logical grid to be exportable; `MAX_VOX_EXPORT_BYTES` is an independent safety boundary.
- Verify output bytes, not only output length.

Relevant exports:

```text
VoxIO.MAX_VOX_EXPORT_BYTES
VoxIO.VOX_FIXED_BYTES
VoxIO.exportVox
VoxIO.exportOBJ
```

### 5. Finish bounded synchronous worker fallback

Small jobs may fall back to the main thread. Large logical grids must not silently freeze the UI when worker creation/runtime fails.

Relevant API:

```text
VoxelWorkerChannel.DEFAULT_MAX_SYNCHRONOUS_WORK
VoxelWorkerChannel.create
VoxelWorkerChannel.fallbackWork
```

Acceptance criteria:

- Estimate fallback work deterministically from normalized dimensions/depth.
- Small jobs still execute through the current fallback path.
- Oversized jobs reject with a structured, stable error code such as `WORKER_FALLBACK_WORK_EXCEEDED`.
- All pending jobs in the failed worker incarnation are settled.
- Add fake-worker tests for creation failure, runtime failure, and oversized fallback rejection.

### 6. Update documentation

Update `README.md` and `docs/PLAN_GENERACION_3D.md` after behavior is green.

Document:

- Depth range and existing grid/mesh/export budgets.
- Match Profile means one depth layer per selected side-frame source pixel before alignment/resampling.
- It improves source sampling but does **not** guarantee anatomically correct 3D geometry.
- Grid IoU compares the prepared grid projection; it is not original-source fidelity or semantic correctness.
- Orthographic modes are validation views; Perspective is the artistic inspection mode.
- Large jobs may require a working worker instead of synchronous fallback.

Remove exact real-PNG voxel counts unless the PNG fixtures and assertions are committed to the repository.

## Verification commands

Run after every work unit:

```bash
node --test --test-reporter=spec tests/voxelizer.test.js
for file in voxelizer/*.js; do node --check "$file"; done
git diff --check
git status --short
! grep -nE '[[:blank:]]+$' voxelizer/profile-depth.js voxelizer/viewport.js \
  docs/HANDOFF_DEPTH_ORTHOGRAPHIC_REMEDIATION.md
```

`git diff --check` does not inspect untracked files, which is why the explicit whitespace check is required.

Also verify HTML integration:

- Every `id` is unique.
- Every literal `$('id')` reference resolves.
- Every local `<script src>` exists and loads in dependency order.
- `profile-depth.js` and `viewport.js` load before `app.js`.

Browser smoke test:

1. Serve `voxelizer/` over HTTP:

   ```bash
   python3 -m http.server 8765 --directory voxelizer
   ```

2. Confirm no console exceptions.
3. Load a 64×64 front and side pair.
4. Match depth to the side profile.
5. Switch through Perspective, Front, Profile, and Top.
6. Resize the browser and reset each camera mode.
7. Force a reconstruction-budget failure and confirm stale geometry disappears.
8. Simulate worker failure for a small and a large job.
9. Export VOX and reopen/inspect its chunks or load it in a compatible viewer.

## Final review gate

Do not report completion until all are true:

- Full Node suite passes with zero skipped remediation tests.
- All syntax and HTML integration checks pass.
- `git diff --check` passes.
- The legal `1×1×256` camera probe is visible in all modes.
- Perspective fits depth `128` and `256` models.
- Large VOX export stays within the documented peak budget.
- Oversized synchronous fallback rejects without blocking.
- A failed reconstruction clears stale viewport evidence.
- A fresh reliability/risk review finds no Critical or High issue.

## Deferred feature: per-part elliptical sections

This is the previously discussed “section 3.” It is **not** part of the remediation above.

The current visual hull works row by row. For a height `y`, let:

- `F_y` be the allowed X interval(s) from the front view.
- `S_y` be the allowed Z interval(s) from the side view.

The current hull effectively fills the Cartesian product:

```text
F_y × S_y
```

If the front says a body is 20 voxels wide and the side says it is 14 voxels deep, the current cross-section becomes a filled `20×14` rectangle. Both projections are correct, but the body looks boxy.

A superelliptical prior would center and normalize each matched part:

```text
nx = (x - centerX) / radiusX
nz = (z - centerZ) / radiusZ

accept when |nx|^p + |nz|^p <= 1
```

- `p = 2` gives an ellipse.
- Larger `p` becomes boxier.
- Smaller valid `p` becomes more pointed/diamond-like.

This preserves the extreme X/Z projections while removing unsupported rectangle corners. It must be applied **per matched part/material**, not once across the whole character; otherwise a staff, body, hood, and face may be blended into one section.

Implementing it safely requires:

1. Matching parts across views using material, shared height, adjacency, and optional landmarks.
2. Building a section prior for each matched part.
3. Falling back to the current visual hull when correspondence confidence is low.
4. Using a top view or semantic anchors when same-colored parts remain ambiguous.

Keep this deferred until the depth/camera/export remediation is green and independently reviewed.
