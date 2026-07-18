importScripts('transfer.js', 'voxel.js');

self.onmessage = function (event) {
  const { jobId, pixels, opts, views } = event.data;
  try {
    const result = self.Voxel.voxelize(pixels, opts, views || {});
    self.postMessage({ jobId, ok: true, result }, self.VoxelTransfer.buffers(result));
  } catch (error) {
    self.postMessage({
      jobId,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
