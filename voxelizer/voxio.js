/* voxio.js — escritor MagicaVoxel .vox equivalente a sprite2voxel.py.
   - Z-up: intercambia Y<->Z para que el modelo quede de pie en MagicaVoxel.
   - Indice de color de voxel 1-based; paleta con el off-by-one estandar
     (el voxel con indice i lee la entrada RGBA[i-1]).
   Entra: result = { grid:Int16Array (-1 vacio, 0..N-1 color),
                      dims:[DX,DY,DZ], palette:[[r,g,b], ...] }
   Sale:  Uint8Array con los bytes del .vox. */
(function (root) {
  const MAX_VOX_EXPORT_BYTES = 16 * 1024 * 1024;
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

    let obj = `# Voxelizer export\nmtllib ${mtlName}\n`;
    let mtl = '# Voxelizer materials\n';
    pal.forEach((c, i) => {
      mtl += `newmtl color_${i}\nKd ${(c[0] / 255).toFixed(4)} ${(c[1] / 255).toFixed(4)} ${(c[2] / 255).toFixed(4)}\nKa 0 0 0\nKs 0 0 0\nillum 1\n\n`;
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

  root.VoxIO = { MAX_VOX_EXPORT_BYTES, VOX_FIXED_BYTES, exportVox, exportOBJ };
})(typeof window !== 'undefined' ? window : globalThis);
