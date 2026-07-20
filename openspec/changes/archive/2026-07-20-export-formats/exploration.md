## Exploration: export-formats

### Current State

`voxelizer/voxio.js` is the dedicated export module. It exposes two pure-JavaScript serializers:

- `exportOBJ(result, opts)` — writes `.obj` + `.mtl` from `result.greedyFacesList`, with optional baked vertex colors + AO or per-palette PBR material blocks.
- `exportVox(result)` — writes MagicaVoxel `.vox` 150 from `result.grid` and `result.palette`.

`voxelizer/app.js` wires the UI and download plumbing:

- Format toggles `fmtVox` / `fmtObj` (HTML buttons).
- `collectResultFiles(base, result, wantObj, wantVox, opts)` calls `VoxIO.exportOBJ` / `VoxIO.exportVox` and returns `{ name, data, type }` files.
- `exportResultFiles(...)` downloads the files individually; `exportBatch()` aggregates the same files into a ZIP via `window.ZipUtil.createZip`.
- `download()` / `downloadBlob()` use `Blob` + `URL.createObjectURL` to trigger browser saves.

The project is a static browser app: `voxelizer/index.html` loads `vendor/three.min.js` and `vendor/OrbitControls.js` via `<script>` tags. There is **no `package.json` or npm workflow**. Tests run in Node's `vm` context and only load `voxel.js` + `voxio.js` (`tests/voxelizer.test.js`).

`result.greedyFacesList` is an array of `{ corners: [[x,y,z]×4], normal: [nx,ny,nz], color: paletteIndex }`, with an optional `ao: [4]` after `Voxel.annotateAO()`. `result.palette` is an array of `[r,g,b]`. `result.surfaceMaterials` maps each palette index to `{ metallic, roughness, emissive }`.

### Affected Areas

- `voxelizer/voxio.js` — add `exportGLB` (and later `exportFBX`) alongside `exportOBJ`/`exportVox`.
- `voxelizer/app.js` — add `wantGlb`/`wantFbx` checks, extend `collectResultFiles`, wire new format toggles, update batch export, and add download logic.
- `voxelizer/index.html` — add `fmtGlb` and `fmtFbx` checkboxes to the Exportar group.
- `voxelizer/zip.js` — no changes unless new output needs ZIP metadata; already supports arbitrary bytes via `createZip(archiveFiles)`.
- `tests/voxelizer.test.js` — add unit tests for `exportGLB` parsing in Node's `vm` context (no DOM required).
- `docs/` or `README.md` — optional update to list supported formats.

### Approaches

1. **Pure JavaScript serializers (recommended first slice)**
   - Description: Implement glTF 2.0 JSON + GLB binary serializer directly in `voxio.js`, reusing the same `result.greedyFacesList` / `palette` / `surfaceMaterials` data already used by `exportOBJ`. Add a small FBX ASCII serializer as a second slice.
   - Pros:
     - No external dependencies; fits the project's static, no-build architecture.
     - Deterministic and testable in Node's `vm` context (like existing `exportOBJ`/`exportVox` tests).
     - Avoids Three.js addon version lock-in and runtime issues inside the worker/UI split.
     - Full control over coordinate systems, vertex colors, and PBR material mapping.
   - Cons:
     - More code to write and maintain than delegating to a library.
     - Must correctly implement glTF 2.0 accessor/bufferView/buffer alignment and chunk layout.
     - FBX binary spec is proprietary; ASCII FBX is easier but produces larger files.
   - Effort: Medium

2. **Leverage Three.js GLTFExporter / FBXExporter**
   - Description: Add `vendor/GLTFExporter.js` (and a compatible `FBXExporter.js` if available) from the Three.js examples matching the existing `vendor/three.min.js` version. Build a `THREE.Scene` / `THREE.BufferGeometry` from the face data and call `GLTFExporter.parse()` / `FBXExporter.parse()`.
   - Pros:
     - GLTFExporter is battle-tested and supports PBR, animations, and extensions.
     - Less serialization code inside the project.
   - Cons:
     - `GLTFExporter` is **not** in the existing `vendor/three.min.js`; it lives in `examples/jsm/exporters/GLTFExporter.js` and must be vendored or imported separately.
     - `FBXExporter` is **not** an official Three.js exporter; there is no maintained `FBXExporter` in `three.js/examples`. The only realistic path is a custom serializer or a third-party library, which conflicts with the no-build/no-package policy.
     - Three.js exporters assume a browser environment (`Blob`, `URL.createObjectURL`, `document`) and cannot run in the Node test harness without shims.
     - Tightly couples export correctness to the vendored Three.js revision (r128-r134 era based on the license header), making upgrades harder.
     - Requires creating a temporary `THREE.Scene` and meshing the face data, which duplicates the logic already in `app.js` `buildModel()`.
   - Effort: High

### Recommendation

Use **Approach 1: pure JavaScript serializers**.

Rationale: the project deliberately avoids package managers and build steps; the test suite already validates pure-JS export logic; and the current Three.js bundle does not include the required exporters. A custom glTF serializer is the only path that preserves the existing architecture, runs in tests, and keeps the UI and batch export deterministic.

**First slice: `.glb` / `.gltf` export**

- Add `exportGLB(result, opts)` to `voxio.js` that returns a binary `Uint8Array` for `.glb`.
- Use the same per-palette material mapping already used in `exportOBJ` (PBR flags from `surfaceMaterials` or defaults).
- Emit vertex colors when `opts.ao` is true or when requested, otherwise emit one material per palette index.
- Coordinate system: keep the current Y-up convention (glTF 2.0 default is Y-up), center the model by subtracting `DX/2, DY/2, DZ/2`, and apply `opts.scale` like `exportOBJ`.
- Limit to static meshes first (no animations, no skins); the app has no animated voxel output yet.

**Second slice: `.fbx` ASCII export**

- Add `exportFBX(result, opts)` to `voxio.js` that returns a string.
- Use FBX ASCII 7.x format with `Geometry` + `Model` nodes, per-palette materials, and Y-up axis.
- This is a string-only serializer, so it reuses `download(name, text)` and needs no binary blob handling.

### Risks

- **Coordinate and winding conventions**: glTF and FBX both expect specific triangle winding and axis orientation. Reuse the existing `fixWinding()` pattern and convert quads to two triangles.
- **Material semantics**: glTF PBR uses `metallicFactor`/`roughnessFactor` + `baseColorFactor`; FBX uses different material properties. Map the current `{ metallic, roughness, emissive }` to each format carefully.
- **Large model memory**: GLB requires a single contiguous binary buffer. A large voxel model can produce a large `ArrayBuffer`; respect the existing `MAX_*` budgets and consider streaming if necessary.
- **Testability**: The Node test harness lacks `Blob` and `URL` in a realistic way. Keep serializers pure (return `Uint8Array` / string) and test the returned bytes, not the download UI.
- **No Three.js exporter for FBX**: Three.js does not ship an official FBX exporter, so any FBX support must be custom. This is manageable for ASCII FBX but not for binary FBX.
- **Version drift**: If we later add Three.js GLTFExporter, we would have to keep it in sync with `vendor/three.min.js` on every Three.js update. Pure JS avoids this.

### Ready for Proposal

**Yes.** The exploration recommends adding a pure-JS `.glb` exporter as the first slice, followed by a pure-JS `.fbx` ASCII exporter. The orchestrator should tell the user that the next step is `sdd-propose` for `export-formats`, with the scope limited to glTF/GLB in slice 1 and FBX in slice 2, and that we will not depend on Three.js exporters due to the project's no-build/testable constraints.
