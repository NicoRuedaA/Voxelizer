# Proposal: Add glTF/GLB and FBX ASCII Export Formats

## Intent

Users currently export voxelized models only as `.obj` (+ `.mtl`) or `.vox`. glTF/GLB is the modern web/3D pipeline standard, and FBX ASCII remains widely used for DCC tool interchange. Adding both formats lets users drop exports directly into Blender, game engines, and viewers without manual conversion.

## Scope

### In Scope
- **Slice 1 — glTF/GLB**: Pure-JavaScript `.glb` serializer in `voxelizer/voxio.js`, UI toggle, batch/ZIP support, and Node tests.
- **Slice 2 — FBX ASCII**: Pure-JavaScript `.fbx` ASCII serializer, UI toggle, batch/ZIP support, and Node tests.
- Reuse existing `result.greedyFacesList`, `palette`, and `surfaceMaterials` data.
- Preserve per-palette PBR mapping (`metallic`, `roughness`, `emissive`) in both formats.
- Center and scale models consistently with `exportOBJ`.

### Out of Scope
- `.gltf` separate JSON + bin files (GLB only).
- FBX binary format.
- Three.js `GLTFExporter` or external exporter libraries.
- Animations, skins, morph targets, lights, or cameras.
- Streaming/chunked binary buffers beyond existing memory budgets.

## Capabilities

### New Capabilities
- `gltf-glb-export`: Serialize voxel results to glTF 2.0 binary `.glb` with static mesh, optional vertex colors + AO, and per-palette PBR materials.
- `fbx-ascii-export`: Serialize voxel results to FBX ASCII 7.x `.fbx` with static mesh and per-palette materials.

### Modified Capabilities
- `per-palette-pbr-materials`: Extend PBR export coverage from `.mtl` only to also include glTF/GLB and FBX ASCII.

## Approach

Implement pure-JavaScript serializers in `voxelizer/voxio.js` next to `exportOBJ`/`exportVox`. Convert greedy faces to indexed triangle meshes, reuse `fixWinding()`, apply the existing Y-up centered coordinate system, and map `surfaceMaterials` to each format's PBR properties. Keep serializers deterministic and testable in Node's `vm` harness. Wire new format toggles in `voxelizer/index.html`, update `collectResultFiles`/`exportResultFiles`/`exportBatch` in `voxelizer/app.js`, and add unit tests in `tests/voxelizer.test.js`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `voxelizer/voxio.js` | New | Add `exportGLB()` and `exportFBX()` serializers. |
| `voxelizer/app.js` | Modified | Add `wantGlb`/`wantFbx`, extend file collection/batch export. |
| `voxelizer/index.html` | Modified | Add `fmtGlb`/`fmtFbx` toggles. |
| `tests/voxelizer.test.js` | Modified | Parse and validate GLB/FBX output. |
| `openspec/specs/per-palette-pbr-materials/spec.md` | Modified | Add glTF/GLB and FBX PBR export requirements. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Incorrect triangle winding / axis orientation | Med | Reuse `fixWinding()` and validate in Three.js/Babylon.js viewers. |
| Large contiguous GLB buffer exceeds memory | Med | Respect existing `MAX_*` budgets; validate in tests. |
| FBX ASCII loader compatibility | Med | Test imports in Blender/Unity; document known limitations. |
| PBR semantic mismatch across formats | Low | Map `metallic`/`roughness`/`emissive` explicitly per spec. |

## Rollback Plan

1. Revert `voxelizer/voxio.js`, `voxelizer/app.js`, and `voxelizer/index.html` to pre-change revisions.
2. Remove new tests and spec deltas.
3. Verify existing `.obj` and `.vox` exports still pass.

## Dependencies

- None. Pure-JavaScript implementation; no new packages or vendor scripts.

## Success Criteria

- [ ] `exportGLB()` returns a valid GLB 2.0 binary parseable by standard loaders.
- [ ] `exportFBX()` returns a valid FBX ASCII 7.x file importable by Blender.
- [ ] Both formats respect `opts.scale`, centering, and per-palette PBR materials.
- [ ] New UI toggles trigger individual downloads and appear in batch ZIP exports.
- [ ] All existing `.obj`/`.vox` tests continue to pass.
- [ ] New Node tests validate GLB chunk structure and FBX node presence.
