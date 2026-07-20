/* voxio.js — escritor MagicaVoxel .vox equivalente a sprite2voxel.py.
   - Z-up: intercambia Y<->Z para que el modelo quede de pie en MagicaVoxel.
   - Indice de color de voxel 1-based; paleta con el off-by-one estandar
     (el voxel con indice i lee la entrada RGBA[i-1]).
   Entra: result = { grid:Int16Array (-1 vacio, 0..N-1 color),
                      dims:[DX,DY,DZ], palette:[[r,g,b], ...] }
   Sale:  Uint8Array con los bytes del .vox. */
(function (root) {
  const MAX_VOX_EXPORT_BYTES = 16 * 1024 * 1024;
  const MAX_FBX_EXPORT_BYTES = 16 * 1024 * 1024;
  const VOX_FIXED_BYTES = 1096;

  function exportError(code, message) {
    const error = new RangeError(message);
    error.code = code;
    return error;
  }

  function writeId(bytes, offset, id) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = id.charCodeAt(i);
    return offset + 4;
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value, true);
    return offset + 4;
  }

  function writeChunkHeader(bytes, view, offset, id, contentBytes, childrenBytes) {
    offset = writeId(bytes, offset, id);
    offset = writeU32(view, offset, contentBytes);
    return writeU32(view, offset, childrenBytes);
  }

  function fixWinding(face) {
    let cs = face.corners, ao = face.ao || [1, 1, 1, 1];
    const a = cs[0], b = cs[1], c = cs[2];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * face.normal[0] + cr[1] * face.normal[1] + cr[2] * face.normal[2] < 0) {
      cs = [cs[0], cs[3], cs[2], cs[1]];
      ao = [ao[0], ao[3], ao[2], ao[1]];
    }
    return { cs, ao };
  }

  function exportOBJ(result, opts) {
    const options = opts || {};
    const scale = options.scale == null ? 1 : options.scale;
    const useAO = !!options.useAO;
    const aoStrength = options.aoStrength == null ? 0.8 : options.aoStrength;
    const annotateAO = options.annotateAO;
    const mtlName = options.mtlName || 'model.mtl';
    const faces = result.greedyFacesList;
    const pal = result.palette;
    const [DX, DY, DZ] = result.dims;
    if (useAO && result.grid && typeof annotateAO === 'function') {
      annotateAO(faces, result.grid, result.dims, aoStrength);
    }
    const V = c => `${((c[0] - DX / 2) * scale).toFixed(3)} ${((c[1] - DY / 2) * scale).toFixed(3)} ${((c[2] - DZ / 2) * scale).toFixed(3)}`;

    if (useAO) {
      let obj = `# Voxelizer export (vertex colors + AO)\nmtllib ${mtlName}\nusemtl voxel\n`;
      const mtl = 'newmtl voxel\nKd 1 1 1\nKa 0 0 0\nKs 0 0 0\nillum 1\n';
      let v = 0;
      for (const face of faces) {
        const { cs, ao } = fixWinding(face);
        const rgb = pal[face.color] || [200, 200, 200];
        for (let i = 0; i < 4; i++) {
          const a = ao[i];
          obj += `v ${V(cs[i])} ${(rgb[0] / 255 * a).toFixed(4)} ${(rgb[1] / 255 * a).toFixed(4)} ${(rgb[2] / 255 * a).toFixed(4)}\n`;
        }
        obj += `f ${v + 1} ${v + 2} ${v + 3} ${v + 4}\n`;
        v += 4;
      }
      return { obj, mtl };
    }

    const surfaceMaterials = result.surfaceMaterials || pal.map(() => ({ metallic: 0, roughness: 0, emissive: 0 }));
    let obj = `# Voxelizer export\nmtllib ${mtlName}\n`;
    let mtl = '# Voxelizer materials\n';
    pal.forEach((c, i) => {
      const mat = surfaceMaterials[i] || { metallic: 0, roughness: 0, emissive: 0 };
      const hasPBR = mat.metallic > 0 || mat.roughness > 0 || mat.emissive > 0;
      mtl += `newmtl color_${i}\n`;
      mtl += `Kd ${(c[0] / 255).toFixed(4)} ${(c[1] / 255).toFixed(4)} ${(c[2] / 255).toFixed(4)}\n`;
      mtl += `Ka 0 0 0\n`;
      mtl += `Ks ${hasPBR ? '1 1 1' : '0 0 0'}\n`;
      if (hasPBR) {
        mtl += `Pm ${mat.metallic.toFixed(4)}\n`;
        mtl += `Pr ${mat.roughness.toFixed(4)}\n`;
        mtl += `Ke ${((c[0] / 255) * mat.emissive).toFixed(4)} ${((c[1] / 255) * mat.emissive).toFixed(4)} ${((c[2] / 255) * mat.emissive).toFixed(4)}\n`;
        mtl += `illum 3\n`;
      } else {
        mtl += `illum 1\n`;
      }
      mtl += `\n`;
    });
    const byColor = new Map();
    faces.forEach(face => {
      if (!byColor.has(face.color)) byColor.set(face.color, []);
      byColor.get(face.color).push(face);
    });
    let vcount = 0;
    byColor.forEach((group, color) => {
      obj += `usemtl color_${color}\n`;
      for (const face of group) {
        const { cs } = fixWinding(face);
        for (const corner of cs) obj += `v ${V(corner)}\n`;
        obj += `f ${vcount + 1} ${vcount + 2} ${vcount + 3} ${vcount + 4}\n`;
        vcount += 4;
      }
    });
    return { obj, mtl };
  }

  function exportVox(result) {
    const [DX, DY, DZ] = result.dims;
    if (Math.max(DX, DY, DZ) > 256)
      throw new Error(`MagicaVoxel limita a 256^3 (modelo ${DX}x${DY}x${DZ})`);
    const grid = result.grid, pal = result.palette;
    if (!Number.isSafeInteger(DX) || !Number.isSafeInteger(DY) || !Number.isSafeInteger(DZ) || DX <= 0 || DY <= 0 || DZ <= 0)
      throw exportError('VOX_DIMENSIONS_INVALID', 'VOX dimensions must be positive safe integers');
    if (!ArrayBuffer.isView(grid) || grid instanceof DataView || grid.length !== DX * DY * DZ)
      throw exportError('VOX_GRID_INVALID', 'VOX grid length must equal width*height*depth');
    const colorIndexByKey = new Map(), exportColors = [], indexByInternal = new Map();
    let count = 0;
    for (let i = 0; i < grid.length; i++) {
      const ci = grid[i];
      if (ci < 0) continue;
      count++;
      if (indexByInternal.has(ci)) continue;
      const color = pal[ci];
      if (!color) throw new Error(`Missing palette color ${ci}`);
      const key = `${color[0] & 255},${color[1] & 255},${color[2] & 255}`;
      let exportIndex = colorIndexByKey.get(key);
      if (exportIndex == null) {
        if (exportColors.length >= 255) throw new Error('VOX supports at most 255 distinct used colors');
        exportColors.push(color);
        exportIndex = exportColors.length; // 1-based, zero is reserved
        colorIndexByKey.set(key, exportIndex);
      }
      indexByInternal.set(ci, exportIndex);
    }

    const outputBytes = VOX_FIXED_BYTES + count * 4;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > MAX_VOX_EXPORT_BYTES) {
      throw exportError('VOX_EXPORT_BUDGET_EXCEEDED', `VOX output requires ${outputBytes} bytes; maximum is ${MAX_VOX_EXPORT_BYTES}`);
    }

    // One exact output allocation plus bounded palette maps; no number arrays or concat copies.
    const bytes = new Uint8Array(outputBytes);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    offset = writeId(bytes, offset, 'VOX ');
    offset = writeU32(view, offset, 150);
    offset = writeChunkHeader(bytes, view, offset, 'MAIN', 0, outputBytes - 20);
    offset = writeChunkHeader(bytes, view, offset, 'SIZE', 12, 0);
    offset = writeU32(view, offset, DX);
    offset = writeU32(view, offset, DZ);
    offset = writeU32(view, offset, DY);
    offset = writeChunkHeader(bytes, view, offset, 'XYZI', 4 + count * 4, 0);
    offset = writeU32(view, offset, count);

    // voxels en orden x,y,z (igual que numpy.argwhere sobre un array (W,H,D))
    for (let x = 0; x < DX; x++)
      for (let y = 0; y < DY; y++)
        for (let z = 0; z < DZ; z++) {
          const ci = grid[x + DX * (y + DY * z)];
          if (ci < 0) continue;
          bytes[offset++] = x & 255;
          bytes[offset++] = z & 255;
          bytes[offset++] = y & 255;
          bytes[offset++] = indexByInternal.get(ci); // Y<->Z, color 1-based
        }
    offset = writeChunkHeader(bytes, view, offset, 'RGBA', 1024, 0);
    for (let i = 0; i < 256; i++) {
      const c = i < exportColors.length ? exportColors[i] : [0, 0, 0];
      bytes[offset++] = c[0] & 255;
      bytes[offset++] = c[1] & 255;
      bytes[offset++] = c[2] & 255;
      bytes[offset++] = 255;
    }
    if (offset !== outputBytes) throw new Error(`VOX writer size mismatch: ${offset} !== ${outputBytes}`);
    return bytes;
  }

  const GLB_MAGIC = 0x46546C67; // 'glTF'
  const GLB_VERSION = 2;
  const CHUNK_JSON = 0x4E4F534A;
  const CHUNK_BIN = 0x004E4942;
  const GLTF_FLOAT = 5126;
  const GLTF_UNSIGNED_SHORT = 5123;
  const GLTF_UNSIGNED_INT = 5125;
  const GLTF_TRIANGLES = 4;

  function buildIndexedMesh(result, opts) {
    const options = opts || {};
    const scale = options.scale == null ? 1 : options.scale;
    const useAO = !!options.useAO;
    const aoStrength = options.aoStrength == null ? 0.8 : options.aoStrength;
    const annotateAO = options.annotateAO;
    const vertexColors = !!options.vertexColors;
    const faces = result.greedyFacesList;
    const pal = result.palette;
    const [DX, DY, DZ] = result.dims;

    if (useAO && result.grid && typeof annotateAO === 'function') {
      annotateAO(faces, result.grid, result.dims, aoStrength);
    }

    const positions = [];
    const normals = [];
    const colors = [];
    const groups = new Map();
    let vertexOffset = 0;

    for (const face of faces) {
      const { cs, ao } = fixWinding(face);
      const rgb = pal[face.color] || [200, 200, 200];
      const matIndex = face.color;
      if (!groups.has(matIndex)) groups.set(matIndex, []);
      const group = groups.get(matIndex);

      for (let i = 0; i < 4; i++) {
        positions.push((cs[i][0] - DX / 2) * scale);
        positions.push((cs[i][1] - DY / 2) * scale);
        positions.push((cs[i][2] - DZ / 2) * scale);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
        if (vertexColors) {
          const a = ao[i];
          colors.push((rgb[0] / 255) * a);
          colors.push((rgb[1] / 255) * a);
          colors.push((rgb[2] / 255) * a);
        }
      }

      group.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      group.push(vertexOffset, vertexOffset + 2, vertexOffset + 3);
      vertexOffset += 4;
    }

    const totalIndices = faces.length * 6;
    const IndexArray = totalIndices > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(totalIndices);
    const groupsDesc = [];
    let idxOffset = 0;
    for (const [matIndex, groupIndices] of groups) {
      for (let i = 0; i < groupIndices.length; i++) {
        indices[idxOffset + i] = groupIndices[i];
      }
      groupsDesc.push({ material: matIndex, start: idxOffset, count: groupIndices.length });
      idxOffset += groupIndices.length;
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: vertexColors ? new Float32Array(colors) : null,
      indices,
      groups: groupsDesc,
      vertexCount: vertexOffset,
    };
  }

  function exportGLB(result, opts) {
    const options = opts || {};
    const faces = result.greedyFacesList;
    if (!faces || faces.length === 0) {
      throw new RangeError('Cannot export GLB: greedyFacesList is empty');
    }

    const mesh = buildIndexedMesh(result, options);
    const vertexCount = mesh.vertexCount;
    const indexComponentType = mesh.indices instanceof Uint32Array ? GLTF_UNSIGNED_INT : GLTF_UNSIGNED_SHORT;
    const indexBytesPerElement = mesh.indices instanceof Uint32Array ? 4 : 2;
    const indexBytes = mesh.indices.length * indexBytesPerElement;

    let offset = 0;
    const posOffset = 0;
    const posLength = mesh.positions.byteLength;
    offset += posLength;
    offset += (4 - (offset % 4)) % 4;

    const normalOffset = offset;
    const normalLength = mesh.normals.byteLength;
    offset += normalLength;
    offset += (4 - (offset % 4)) % 4;

    const colorOffset = mesh.colors ? offset : 0;
    const colorLength = mesh.colors ? mesh.colors.byteLength : 0;
    if (mesh.colors) {
      offset += colorLength;
      offset += (4 - (offset % 4)) % 4;
    }

    const indexOffset = offset;
    offset += indexBytes;
    const dataLength = offset;
    const bufferLength = dataLength + (4 - (dataLength % 4)) % 4;

    const buffer = new ArrayBuffer(bufferLength);
    new Float32Array(buffer, posOffset, mesh.positions.length).set(mesh.positions);
    new Float32Array(buffer, normalOffset, mesh.normals.length).set(mesh.normals);
    if (mesh.colors) {
      new Float32Array(buffer, colorOffset, mesh.colors.length).set(mesh.colors);
    }
    const indexView = indexComponentType === 5125
      ? new Uint32Array(buffer, indexOffset, mesh.indices.length)
      : new Uint16Array(buffer, indexOffset, mesh.indices.length);
    indexView.set(mesh.indices);

    const posMin = [Infinity, Infinity, Infinity];
    const posMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      posMin[0] = Math.min(posMin[0], x); posMax[0] = Math.max(posMax[0], x);
      posMin[1] = Math.min(posMin[1], y); posMax[1] = Math.max(posMax[1], y);
      posMin[2] = Math.min(posMin[2], z); posMax[2] = Math.max(posMax[2], z);
    }

    const pal = result.palette || [];
    const surfaceMaterials = result.surfaceMaterials || pal.map(() => ({ metallic: 0, roughness: 0, emissive: 0 }));

    const materials = pal.map((c, i) => {
      const mat = surfaceMaterials[i] || { metallic: 0, roughness: 0, emissive: 0 };
      return {
        pbrMetallicRoughness: {
          baseColorFactor: [c[0] / 255, c[1] / 255, c[2] / 255, 1],
          metallicFactor: mat.metallic,
          roughnessFactor: mat.roughness,
        },
        emissiveFactor: [(c[0] / 255) * mat.emissive, (c[1] / 255) * mat.emissive, (c[2] / 255) * mat.emissive],
        alphaMode: 'OPAQUE',
      };
    });

    const bufferViews = [];
    const accessors = [];

    bufferViews.push({ buffer: 0, byteOffset: posOffset, byteLength: posLength });
    accessors.push({ bufferView: 0, componentType: GLTF_FLOAT, count: vertexCount, type: 'VEC3', min: posMin, max: posMax });

    bufferViews.push({ buffer: 0, byteOffset: normalOffset, byteLength: normalLength });
    accessors.push({ bufferView: 1, componentType: GLTF_FLOAT, count: vertexCount, type: 'VEC3' });

    let colorAccessorIndex = -1;
    if (mesh.colors) {
      bufferViews.push({ buffer: 0, byteOffset: colorOffset, byteLength: colorLength });
      accessors.push({ bufferView: 2, componentType: GLTF_FLOAT, count: vertexCount, type: 'VEC3' });
      colorAccessorIndex = 2;
    }

    const indexBufferViewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: indexOffset, byteLength: indexBytes });

    const primitives = mesh.groups.map((group) => {
      const accessorIndex = accessors.length;
      accessors.push({
        bufferView: indexBufferViewIndex,
        componentType: indexComponentType,
        count: group.count,
        type: 'SCALAR',
        byteOffset: group.start * indexBytesPerElement,
      });
      const attributes = { POSITION: 0, NORMAL: 1 };
      if (colorAccessorIndex >= 0) attributes.COLOR_0 = colorAccessorIndex;
      return {
        attributes,
        indices: accessorIndex,
        material: group.material,
        mode: GLTF_TRIANGLES,
      };
    });

    const gltf = {
      asset: { version: '2.0', generator: 'voxelizer' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives }],
      materials,
      buffers: [{ byteLength: bufferLength }],
      bufferViews,
      accessors,
    };

    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(gltf));
    const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
    const binPadding = bufferLength - dataLength;
    const totalLength = 12 + 8 + jsonBytes.length + jsonPadding + 8 + bufferLength;

    const glb = new Uint8Array(totalLength);
    const view = new DataView(glb.buffer);
    let o = 0;
    view.setUint32(o, GLB_MAGIC, true); o += 4;
    view.setUint32(o, GLB_VERSION, true); o += 4;
    view.setUint32(o, totalLength, true); o += 4;

    view.setUint32(o, jsonBytes.length, true); o += 4;
    view.setUint32(o, CHUNK_JSON, true); o += 4;
    glb.set(jsonBytes, o); o += jsonBytes.length;
    for (let i = 0; i < jsonPadding; i++) glb[o++] = 0x20;

    view.setUint32(o, bufferLength, true); o += 4;
    view.setUint32(o, CHUNK_BIN, true); o += 4;
    glb.set(new Uint8Array(buffer), o); o += bufferLength;
    for (let i = 0; i < binPadding; i++) glb[o++] = 0;

    return glb;
  }

  function exportFBX(result, opts) {
    const options = opts || {};
    const faces = result.greedyFacesList;
    if (!faces || faces.length === 0) {
      throw new RangeError('Cannot export FBX: greedyFacesList is empty');
    }

    const mesh = buildIndexedMesh(result, { scale: options.scale });
    const pal = result.palette || [];
    const surfaceMaterials = result.surfaceMaterials || pal.map(() => ({ metallic: 0, roughness: 0, emissive: 0 }));

    // Build polygon data from grouped indices so each triangle is a separate polygon.
    const polygonVertexIndex = [];
    const normalValues = [];
    const materialIndices = [];
    let polygonCount = 0;
    for (const group of mesh.groups) {
      const matIndex = group.material;
      for (let i = 0; i < group.count; i += 6) {
        const base = group.start + i;
        const a = mesh.indices[base];
        const b = mesh.indices[base + 1];
        const c = mesh.indices[base + 2];
        const d = mesh.indices[base + 3];
        const e = mesh.indices[base + 4];
        const f = mesh.indices[base + 5];
        polygonVertexIndex.push(a, b, -(c + 1));
        polygonVertexIndex.push(d, e, -(f + 1));
        const nx = mesh.normals[a * 3];
        const ny = mesh.normals[a * 3 + 1];
        const nz = mesh.normals[a * 3 + 2];
        for (let v = 0; v < 6; v++) {
          normalValues.push(nx, ny, nz);
        }
        materialIndices.push(matIndex, matIndex);
        polygonCount += 2;
      }
    }

    // Memory budget guard: estimate ASCII size before materializing the full string.
    const estimatedBytes = 5000 + mesh.vertexCount * 40 + polygonCount * 130 + pal.length * 600;
    if (estimatedBytes > MAX_FBX_EXPORT_BYTES) {
      throw exportError('FBX_EXPORT_BUDGET_EXCEEDED', `FBX output estimated ${estimatedBytes} bytes; maximum is ${MAX_FBX_EXPORT_BYTES}`);
    }

    const modelId = 1000000000;
    const geometryId = 1000000001;
    const materialIds = pal.map((_, i) => 1000000002 + i);

    function f(num) { return num.toFixed(6); }
    function arrayLine(label, values, formatter) {
      const fmt = formatter || f;
      return `${label}: *${values.length} { a: ${values.map(fmt).join(',')} }`;
    }
    function intLine(label, values) {
      return arrayLine(label, values, String);
    }

    const vertices = [];
    for (let i = 0; i < mesh.positions.length; i++) vertices.push(mesh.positions[i]);

    const materialsBlock = [];
    pal.forEach((color, i) => {
      const mat = surfaceMaterials[i] || { metallic: 0, roughness: 0, emissive: 0 };
      const hasPBR = mat.metallic > 0 || mat.roughness > 0 || mat.emissive > 0;
      const r = color[0] / 255;
      const g = color[1] / 255;
      const b = color[2] / 255;
      const er = r * mat.emissive;
      const eg = g * mat.emissive;
      const eb = b * mat.emissive;
      materialsBlock.push(`    Material: ${materialIds[i]}, "Material::color_${i}", "" {`);
      materialsBlock.push('        Version: 102');
      materialsBlock.push('        ShadingModel: "Phong"');
      materialsBlock.push('        MultiLayer: 0');
      materialsBlock.push('        Properties70:  {');
      materialsBlock.push('            P: "ShadingModel", "KString", "", "", "Phong"');
      materialsBlock.push(`            P: "AmbientColor", "Color", "", "A",${f(0)},${f(0)},${f(0)}`);
      materialsBlock.push(`            P: "DiffuseColor", "Color", "", "D",${f(r)},${f(g)},${f(b)}`);
      materialsBlock.push(`            P: "SpecularColor", "Color", "", "S",${hasPBR ? '1,1,1' : '0,0,0'}`);
      materialsBlock.push(`            P: "EmissiveColor", "Color", "", "E",${f(er)},${f(eg)},${f(eb)}`);
      materialsBlock.push(`            P: "AmbientFactor", "double", "Number", "",${f(0)}`);
      materialsBlock.push(`            P: "DiffuseFactor", "double", "Number", "",${f(1)}`);
      materialsBlock.push(`            P: "SpecularFactor", "double", "Number", "",${hasPBR ? 1 : 0}`);
      materialsBlock.push(`            P: "Shininess", "double", "Number", "",${f(0)}`);
      materialsBlock.push(`            P: "ReflectionFactor", "double", "Number", "",${f(mat.metallic)}`);
      materialsBlock.push(`            P: "Metallic", "double", "Number", "",${f(mat.metallic)}`);
      materialsBlock.push(`            P: "Roughness", "double", "Number", "",${f(mat.roughness)}`);
      materialsBlock.push(`            P: "EmissiveFactor", "double", "Number", "",${f(mat.emissive)}`);
      materialsBlock.push('        }');
      materialsBlock.push('    }');
    });

    const out = [];
    out.push('; FBX 7.5.0 project project');
    out.push('; FBX SDK version 2020.2.1, Release (0.0.0)');
    out.push('; ----------------------------------------------------');
    out.push('');
    out.push('FBXHeaderExtension:  {');
    out.push('    FBXHeaderVersion: 1003');
    out.push('    FBXVersion: 7500');
    out.push('    CreationTimeStamp:  {');
    out.push('        Version: 1000');
    out.push('        Year: 2026');
    out.push('        Month: 7');
    out.push('        Day: 20');
    out.push('        Hour: 0');
    out.push('        Minute: 0');
    out.push('        Second: 0');
    out.push('        Millisecond: 0');
    out.push('    }');
    out.push('    Creator: "voxelizer"');
    out.push('}');
    out.push('');
    out.push('GlobalSettings:  {');
    out.push('    Version: 1000');
    out.push('    Properties70:  {');
    out.push('        P: "UpAxis", "int", "Integer", "",1');
    out.push('        P: "UpAxisSign", "int", "Integer", "",1');
    out.push('        P: "FrontAxis", "int", "Integer", "",2');
    out.push('        P: "FrontAxisSign", "int", "Integer", "",1');
    out.push('        P: "CoordSystem", "int", "Integer", "",0');
    out.push('        P: "CoordSystemSign", "int", "Integer", "",1');
    out.push('        P: "OriginalUpAxis", "int", "Integer", "",-1');
    out.push('        P: "OriginalUpAxisSign", "int", "Integer", "",1');
    out.push('        P: "UnitScaleFactor", "double", "Number", "",1');
    out.push('        P: "AmbientColor", "ColorRGB", "Color", "",0,0,0');
    out.push('        P: "DefaultCamera", "KString", "", "", "Producer Perspective"');
    out.push('    }');
    out.push('}');
    out.push('');
    out.push('Documents:  {');
    out.push('    Count: 1');
    out.push('    Document: 2000000000, "", "Scene" {');
    out.push('        Properties70:  {');
    out.push('            P: "SourceObject", "object", "", ""');
    out.push('        }');
    out.push('        RootNode: 0');
    out.push('    }');
    out.push('}');
    out.push('');
    out.push('References:  {');
    out.push('}');
    out.push('');
    out.push('Definitions:  {');
    out.push('    Version: 100');
    out.push(`    Count: ${3 + (pal.length > 0 ? 1 : 0)}`);
    out.push('    ObjectType: "GlobalSettings" {');
    out.push('        Count: 1');
    out.push('    }');
    out.push('    ObjectType: "Model" {');
    out.push('        Count: 1');
    out.push('    }');
    out.push('    ObjectType: "Geometry" {');
    out.push('        Count: 1');
    out.push('    }');
    if (pal.length > 0) {
      out.push('    ObjectType: "Material" {');
      out.push(`        Count: ${pal.length}`);
      out.push('    }');
    }
    out.push('}');
    out.push('');
    out.push('Objects:  {');
    out.push(`    Model: ${modelId}, "Model::Mesh", "Mesh" {`);
    out.push('        Version: 232');
    out.push('        Properties70:  {');
    out.push('            P: "InheritType", "enum", "Integer", "",0');
    out.push('            P: "GeometricTranslation", "Vector3D", "Vector", "",0,0,0');
    out.push('            P: "GeometricRotation", "Vector3D", "Vector", "",0,0,0');
    out.push('            P: "GeometricScaling", "Vector3D", "Vector", "",1,1,1');
    out.push('        }');
    out.push('        Shading: Y');
    out.push('        Culling: "CullingOff"');
    out.push('    }');
    out.push(`    Geometry: ${geometryId}, "Geometry::Mesh", "Mesh" {`);
    out.push(`        ${arrayLine('Vertices', vertices)}`);
    out.push(`        ${intLine('PolygonVertexIndex', polygonVertexIndex)}`);
    out.push('        GeometryVersion: 124');
    out.push('        LayerElementNormal: 0 {');
    out.push('            Version: 101');
    out.push('            Name: ""');
    out.push('            MappingInformationType: "ByPolygonVertex"');
    out.push('            ReferenceInformationType: "Direct"');
    out.push(`            ${arrayLine('Normals', normalValues)}`);
    out.push('        }');
    out.push('        LayerElementMaterial: 0 {');
    out.push('            Version: 101');
    out.push('            Name: ""');
    out.push('            MappingInformationType: "ByPolygon"');
    out.push('            ReferenceInformationType: "IndexToDirect"');
    out.push(`            ${intLine('Materials', materialIndices)}`);
    out.push('        }');
    out.push('    }');
    out.push(...materialsBlock);
    out.push('}');
    out.push('');
    out.push('Connections:  {');
    out.push(`    C: "OO",${geometryId},${modelId}`);
    for (const matId of materialIds) {
      out.push(`    C: "OO",${matId},${geometryId}`);
    }
    out.push('}');
    out.push('');

    return out.join('\n');
  }

  root.VoxIO = { MAX_VOX_EXPORT_BYTES, VOX_FIXED_BYTES, exportVox, exportOBJ, buildIndexedMesh, exportGLB, exportFBX };
})(typeof window !== 'undefined' ? window : globalThis);
