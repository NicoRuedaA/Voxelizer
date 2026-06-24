/* voxio.js — escritor MagicaVoxel .vox equivalente a sprite2voxel.py.
   - Z-up: intercambia Y<->Z para que el modelo quede de pie en MagicaVoxel.
   - Indice de color de voxel 1-based; paleta con el off-by-one estandar
     (el voxel con indice i lee la entrada RGBA[i-1]).
   Entra: result = { grid:Int16Array (-1 vacio, 0..N-1 color),
                      dims:[DX,DY,DZ], palette:[[r,g,b], ...] }
   Sale:  Uint8Array con los bytes del .vox. */
(function (root) {
  function pushU32(a, v) { a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); }
  function pushStr(a, s) { for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); }

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

  function makeChunk(id, content, children) {
    const out = [];
    pushStr(out, id);
    pushU32(out, content.length);
    pushU32(out, children ? children.length : 0);
    for (let i = 0; i < content.length; i++) out.push(content[i]);
    if (children) for (let i = 0; i < children.length; i++) out.push(children[i]);
    return out;
  }

  function exportVox(result) {
    const [DX, DY, DZ] = result.dims;
    if (Math.max(DX, DY, DZ) > 256)
      throw new Error(`MagicaVoxel limita a 256^3 (modelo ${DX}x${DY}x${DZ})`);
    const grid = result.grid, pal = result.palette;

    // voxels en orden x,y,z (igual que numpy.argwhere sobre un array (W,H,D))
    const body = [];
    let count = 0;
    for (let x = 0; x < DX; x++)
      for (let y = 0; y < DY; y++)
        for (let z = 0; z < DZ; z++) {
          const ci = grid[x + DX * (y + DY * z)];
          if (ci < 0) continue;
          body.push(x & 255, z & 255, y & 255, (ci + 1) & 255); // Y<->Z, color 1-based
          count++;
        }

    const sizeContent = [];
    pushU32(sizeContent, DX); pushU32(sizeContent, DZ); pushU32(sizeContent, DY); // W,D,H
    const size = makeChunk('SIZE', sizeContent);

    const xyziContent = [];
    pushU32(xyziContent, count);
    const xyzi = makeChunk('XYZI', xyziContent.concat(body));

    const rgbaContent = [];
    for (let i = 0; i < 256; i++) {
      const c = i < pal.length ? pal[i] : [0, 0, 0];
      rgbaContent.push(c[0] & 255, c[1] & 255, c[2] & 255, 255);
    }
    const rgba = makeChunk('RGBA', rgbaContent);

    const main = makeChunk('MAIN', [], size.concat(xyzi).concat(rgba));
    const header = [0x56, 0x4F, 0x58, 0x20]; // 'VOX '
    pushU32(header, 150);                      // version
    return new Uint8Array(header.concat(main));
  }

  root.VoxIO = { exportVox, exportOBJ };
})(typeof window !== 'undefined' ? window : globalThis);
