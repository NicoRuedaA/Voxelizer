/* Shared structured-clone and transferable-buffer helpers for app/worker. */
(function (root) {
  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }

  function buffers(value) {
    const out = [], seen = new Set();
    function visit(item) {
      if (!item || typeof item !== 'object') return;
      if (ArrayBuffer.isView(item) && item.buffer && !seen.has(item.buffer)) {
        seen.add(item.buffer); out.push(item.buffer); return;
      }
      if (Array.isArray(item)) item.forEach(visit);
      else Object.values(item).forEach(visit);
    }
    visit(value);
    return out;
  }

  root.VoxelTransfer = { clone, buffers };
})(typeof window !== 'undefined' ? window : globalThis);
