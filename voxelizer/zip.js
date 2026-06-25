(function (root) {
  'use strict';

  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function textBytes(text) {
    if (encoder) return encoder.encode(text);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xFF;
    return out;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return textBytes(String(value));
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosStamp(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
    return offset + 2;
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
    return offset + 4;
  }

  function createZip(files, now) {
    const stamp = dosStamp(now || new Date());
    const entries = files.map(file => {
      const nameBytes = textBytes(file.name);
      const data = toBytes(file.data);
      return {
        nameBytes,
        data,
        crc: crc32(data),
      };
    });

    let localSize = 0;
    let centralSize = 0;
    entries.forEach(entry => {
      localSize += 30 + entry.nameBytes.length + entry.data.length;
      centralSize += 46 + entry.nameBytes.length;
    });

    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let offset = 0;
    const centralOffsets = [];

    entries.forEach(entry => {
      const localOffset = offset;
      centralOffsets.push(localOffset);

      offset = writeU32(view, offset, 0x04034B50);
      offset = writeU16(view, offset, 20);
      offset = writeU16(view, offset, 0x0800);
      offset = writeU16(view, offset, 0);
      offset = writeU16(view, offset, stamp.time);
      offset = writeU16(view, offset, stamp.date);
      offset = writeU32(view, offset, entry.crc);
      offset = writeU32(view, offset, entry.data.length);
      offset = writeU32(view, offset, entry.data.length);
      offset = writeU16(view, offset, entry.nameBytes.length);
      offset = writeU16(view, offset, 0);
      out.set(entry.nameBytes, offset);
      offset += entry.nameBytes.length;
      out.set(entry.data, offset);
      offset += entry.data.length;
    });

    const centralOffset = offset;
    entries.forEach((entry, index) => {
      offset = writeU32(view, offset, 0x02014B50);
      offset = writeU16(view, offset, 20);
      offset = writeU16(view, offset, 20);
      offset = writeU16(view, offset, 0x0800);
      offset = writeU16(view, offset, 0);
      offset = writeU16(view, offset, stamp.time);
      offset = writeU16(view, offset, stamp.date);
      offset = writeU32(view, offset, entry.crc);
      offset = writeU32(view, offset, entry.data.length);
      offset = writeU32(view, offset, entry.data.length);
      offset = writeU16(view, offset, entry.nameBytes.length);
      offset = writeU16(view, offset, 0);
      offset = writeU16(view, offset, 0);
      offset = writeU16(view, offset, 0);
      offset = writeU16(view, offset, 0);
      offset = writeU32(view, offset, 0);
      offset = writeU32(view, offset, centralOffsets[index]);
      out.set(entry.nameBytes, offset);
      offset += entry.nameBytes.length;
    });

    const centralBytes = offset - centralOffset;
    offset = writeU32(view, offset, 0x06054B50);
    offset = writeU16(view, offset, 0);
    offset = writeU16(view, offset, 0);
    offset = writeU16(view, offset, entries.length);
    offset = writeU16(view, offset, entries.length);
    offset = writeU32(view, offset, centralBytes);
    offset = writeU32(view, offset, centralOffset);
    writeU16(view, offset, 0);

    return out;
  }

  root.ZipUtil = { createZip, toBytes };
})(typeof window !== 'undefined' ? window : globalThis);
