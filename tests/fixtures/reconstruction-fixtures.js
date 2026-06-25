'use strict';

function makePixels(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (x + w * y) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { w, h, data };
}

function clonePixels(pixels) {
  return {
    w: pixels.w,
    h: pixels.h,
    data: new Uint8ClampedArray(pixels.data),
  };
}

const frontL = makePixels(3, 3, (x, y) => {
  if (x === 0 || y === 2) return [220, 80, 60, 255];
  return [0, 0, 0, 0];
});

const sideFullDepth = makePixels(4, 3, () => [255, 255, 255, 255]);
const topFullDepth = makePixels(3, 4, () => [255, 255, 255, 255]);

const depthMapGradient = makePixels(3, 3, (x, y) => {
  const value = (x + y) * 42;
  return [value, value, value, 255];
});

module.exports = {
  clonePixels,
  depthMapGradient,
  frontL,
  makePixels,
  sideFullDepth,
  topFullDepth,
};
