/* palette-io.js — pure palette parsers/serializers and index remapping.
   No DOM, no Three.js. Works in browser and in Node vm tests. */
(function (root) {
  'use strict';

  function exportError(code, message) {
    const error = new RangeError(message);
    error.code = code;
    return error;
  }

  function parseGpl(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length || lines[0].trim() !== 'GIMP Palette') {
      throw exportError('GPL_INVALID_HEADER', 'GIMP Palette header missing');
    }
    let name = null;
    let inColors = false;
    const colors = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      if (trimmed === '#') {
        inColors = true;
        continue;
      }
      if (!inColors) {
        if (trimmed.startsWith('Name:')) {
          name = trimmed.slice(5).trim();
        }
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        throw exportError('GPL_INVALID_COLOR', `Invalid color line: ${trimmed}`);
      }
      colors.push([r & 255, g & 255, b & 255]);
    }
    return { name, colors };
  }

  function serializeGpl(name, colors) {
    const paletteName = (name || 'Untitled').replace(/\n/g, ' ');
    let out = 'GIMP Palette\n';
    out += `Name: ${paletteName}\n`;
    out += 'Columns: 1\n';
    out += '#\n';
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      out += `${c[0] & 255} ${c[1] & 255} ${c[2] & 255} color_${i}\n`;
    }
    return out;
  }

  function parseJascPal(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(line => line.trim() !== '');
    if (!lines.length || lines[0].trim() !== 'JASC-PAL') {
      throw exportError('JASC_INVALID_HEADER', 'JASC-PAL header missing');
    }
    if (lines.length < 3) {
      throw exportError('JASC_TRUNCATED', 'JASC-PAL file too short');
    }
    const version = lines[1].trim();
    if (version !== '0100') {
      throw exportError('JASC_UNSUPPORTED_VERSION', `JASC-PAL version ${version} not supported`);
    }
    const count = parseInt(lines[2].trim(), 10);
    if (Number.isNaN(count) || count < 0) {
      throw exportError('JASC_INVALID_COUNT', 'JASC-PAL color count invalid');
    }
    if (lines.length < 3 + count) {
      throw exportError('JASC_TRUNCATED_COLORS', `JASC-PAL expected ${count} colors, found ${lines.length - 3}`);
    }
    const colors = [];
    for (let i = 0; i < count; i++) {
      const parts = lines[3 + i].trim().split(/\s+/);
      if (parts.length < 3) {
        throw exportError('JASC_INVALID_COLOR', `Invalid JASC color line: ${lines[3 + i]}`);
      }
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        throw exportError('JASC_INVALID_COLOR', `Invalid JASC color line: ${lines[3 + i]}`);
      }
      colors.push([r & 255, g & 255, b & 255]);
    }
    return { colors };
  }

  function serializeJascPal(colors) {
    let out = 'JASC-PAL\n0100\n';
    out += `${colors.length}\n`;
    for (const c of colors) {
      out += `${c[0] & 255} ${c[1] & 255} ${c[2] & 255}\n`;
    }
    return out;
  }

  function applyRemap(result, editedPalette, indexMap) {
    if (!Array.isArray(editedPalette) || !Array.isArray(indexMap)) {
      throw exportError('REMAP_INVALID_INPUT', 'applyRemap expects editedPalette and indexMap arrays');
    }
    const paletteLength = editedPalette.length;
    const mapLength = indexMap.length;
    const out = { ...result };
    out.palette = editedPalette.slice();

    if (result.surfaceMaterials && Array.isArray(result.surfaceMaterials)) {
      if (result.surfaceMaterials.length !== mapLength) {
        throw exportError('REMAP_MATERIAL_LENGTH_MISMATCH', `surfaceMaterials length ${result.surfaceMaterials.length} must match indexMap length ${mapLength}`);
      }
      out.surfaceMaterials = new Array(paletteLength);
      const fixed = new Uint8Array(paletteLength);
      for (let i = 0; i < paletteLength; i++) {
        out.surfaceMaterials[i] = { metallic: 0, roughness: 0, emissive: 0 };
      }
      for (let i = 0; i < mapLength; i++) {
        const target = indexMap[i];
        if (target !== i) continue;
        if (target < 0 || target >= paletteLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `remapped surfaceMaterial index ${target} out of range for editedPalette [0, ${paletteLength})`);
        }
        out.surfaceMaterials[target] = { ...result.surfaceMaterials[i] };
        fixed[target] = 1;
      }
      for (let i = 0; i < mapLength; i++) {
        const target = indexMap[i];
        if (target === i || fixed[target]) continue;
        if (target < 0 || target >= paletteLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `remapped surfaceMaterial index ${target} out of range for editedPalette [0, ${paletteLength})`);
        }
        out.surfaceMaterials[target] = { ...result.surfaceMaterials[i] };
      }
    }

    if (result.grid && ArrayBuffer.isView(result.grid)) {
      const src = result.grid;
      const dst = new (src.constructor)(src.length);
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        if (v < 0) {
          dst[i] = v;
          continue;
        }
        if (v < 0 || v >= mapLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `grid index ${v} out of range for indexMap [0, ${mapLength})`);
        }
        const nv = indexMap[v];
        if (nv < 0 || nv >= paletteLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `remapped index ${nv} out of range for editedPalette [0, ${paletteLength})`);
        }
        dst[i] = nv;
      }
      out.grid = dst;
    }

    function remapFaces(listName) {
      const list = result[listName];
      if (!Array.isArray(list)) return;
      out[listName] = list.map(face => {
        const v = face.color;
        if (v < 0 || v >= mapLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `${listName} color ${v} out of range for indexMap [0, ${mapLength})`);
        }
        const nv = indexMap[v];
        if (nv < 0 || nv >= paletteLength) {
          throw exportError('REMAP_INDEX_OUT_OF_RANGE', `remapped ${listName} color ${nv} out of range for editedPalette [0, ${paletteLength})`);
        }
        return { ...face, color: nv };
      });
    }

    remapFaces('greedyFacesList');
    remapFaces('naiveFacesList');

    return out;
  }

  root.PaletteIO = { parseGpl, serializeGpl, parseJascPal, serializeJascPal, applyRemap };
})(typeof window !== 'undefined' ? window : globalThis);
