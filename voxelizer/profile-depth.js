/* Pure side-view depth policy. User-facing copy belongs in app.js. */
(function (root) {
  'use strict';

  const STATUS = Object.freeze({
    READY: 'ready',
    CLAMPED: 'clamped',
    NO_SIDE_VIEW: 'no-side-view',
    INVALID_SIDE_PIXELS: 'invalid-side-pixels',
  });

  function clampDepth(value, maximum) {
    const limit = Math.max(1, Math.floor(Number(maximum) || 1));
    const number = Math.floor(Number(value));
    return Math.min(limit, Math.max(1, Number.isFinite(number) ? number : 1));
  }

  function validRgbaPixels(pixels) {
    if (!pixels || typeof pixels !== 'object') return false;
    const { w, h, data } = pixels;
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0) return false;
    if (w > Math.floor(Number.MAX_SAFE_INTEGER / h) || w * h > Math.floor(Number.MAX_SAFE_INTEGER / 4)) return false;
    const typed = ArrayBuffer.isView(data) && !(data instanceof DataView)
      && data.BYTES_PER_ELEMENT === 1
      && (data.constructor.name === 'Uint8Array' || data.constructor.name === 'Uint8ClampedArray');
    return typed && data.length === w * h * 4;
  }

  function matchSideDepth(views, maximum) {
    const descriptors = views && Array.isArray(views.views) ? views.views : [];
    const side = descriptors.find(view => view && view.role === 'side');
    if (!side) return { enabled: false, depth: null, sourceWidth: null, clamped: false, status: STATUS.NO_SIDE_VIEW };
    if (!validRgbaPixels(side.pixels)) {
      return { enabled: false, depth: null, sourceWidth: null, clamped: false, status: STATUS.INVALID_SIDE_PIXELS };
    }
    const depth = clampDepth(side.pixels.w, maximum);
    const clamped = depth !== side.pixels.w;
    return {
      enabled: true,
      depth,
      sourceWidth: side.pixels.w,
      clamped,
      status: clamped ? STATUS.CLAMPED : STATUS.READY,
    };
  }

  function actionState(views, maximum, activity) {
    const match = matchSideDepth(views, maximum);
    const busy = !!(activity && (activity.previewBusy || activity.batchBusy));
    return { ...match, busy, disabled: busy || !match.enabled };
  }

  root.VoxelProfileDepth = { STATUS, actionState, clampDepth, matchSideDepth, validRgbaPixels };
})(typeof window !== 'undefined' ? window : globalThis);
