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

  // Standalone opaque bounds (duplicated from voxel.js to avoid dependency)
  function _opaqueBounds(pixels, alphaThreshold) {
    if (!pixels || !pixels.w || !pixels.h) return null;
    const thresh = alphaThreshold || 40;
    let minX = pixels.w, minY = pixels.h, maxX = -1, maxY = -1;
    for (let y = 0; y < pixels.h; y++) {
      for (let x = 0; x < pixels.w; x++) {
        const alpha = pixels.data[(x + y * pixels.w) * 4 + 3];
        if (alpha > thresh) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function matchSideDepth(views, maximum, useSilhouetteDepth) {
    const descriptors = views && Array.isArray(views.views) ? views.views : [];
    const side = descriptors.find(view => view && view.role === 'side');
    if (!side) return { enabled: false, depth: null, sourceWidth: null, clamped: false, status: STATUS.NO_SIDE_VIEW };
    if (!validRgbaPixels(side.pixels)) {
      return { enabled: false, depth: null, sourceWidth: null, clamped: false, status: STATUS.INVALID_SIDE_PIXELS };
    }
    // Calculate opaque silhouette width
    const bounds = _opaqueBounds(side.pixels, 40);
    const opaqueWidth = bounds ? bounds.width : null;
    // Use opaque silhouette width when available and useSilhouetteDepth is true
    const effectiveWidth = (opaqueWidth != null && useSilhouetteDepth !== false) ? opaqueWidth : side.pixels.w;
    const depth = clampDepth(effectiveWidth, maximum);
    const clamped = depth !== effectiveWidth;
    return {
      enabled: true,
      depth,
      sourceWidth: side.pixels.w,
      opaqueWidth,
      clamped,
      status: clamped ? STATUS.CLAMPED : STATUS.READY,
    };
  }

  function actionState(views, maximum, activity, useSilhouetteDepth) {
    const match = matchSideDepth(views, maximum, useSilhouetteDepth);
    const busy = !!(activity && (activity.previewBusy || activity.batchBusy));
    return { ...match, busy, disabled: busy || !match.enabled };
  }

  root.VoxelProfileDepth = { STATUS, actionState, clampDepth, matchSideDepth, validRgbaPixels };
})(typeof window !== 'undefined' ? window : globalThis);
