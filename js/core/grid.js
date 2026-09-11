/**
 * grid.js
 * Downsample a full-resolution image to a gridW x gridH array of average
 * colors -- a manual box-filter average (every source pixel contributes to
 * exactly one grid cell, weighted equally), matching the visual behavior of
 * mosaic_core.py's image_to_grid (PIL's Image.Resampling.BOX).
 *
 * Works with any canvas-like object exposing getContext("2d") and
 * width/height -- an HTMLCanvasElement in the browser, or node-canvas's
 * Canvas in tests.
 */

/** Returns a flat array of length gridW*gridH, each entry [r, g, b]
 *  (floats), row-major (row 0 first, left to right within each row). */
export function imageToGrid(sourceCanvas, gridW, gridH) {
  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const src = ctx.getImageData(0, 0, sw, sh).data;

  const sums = new Float64Array(gridW * gridH * 3);
  const counts = new Float64Array(gridW * gridH);

  for (let y = 0; y < sh; y++) {
    const gy = Math.min(gridH - 1, Math.floor((y / sh) * gridH));
    const rowBase = gy * gridW;
    for (let x = 0; x < sw; x++) {
      const gx = Math.min(gridW - 1, Math.floor((x / sw) * gridW));
      const cell = rowBase + gx;
      const srcIdx = (y * sw + x) * 4;
      sums[cell * 3] += src[srcIdx];
      sums[cell * 3 + 1] += src[srcIdx + 1];
      sums[cell * 3 + 2] += src[srcIdx + 2];
      counts[cell]++;
    }
  }

  const grid = new Array(gridW * gridH);
  for (let i = 0; i < grid.length; i++) {
    const c = counts[i] || 1;
    grid[i] = [sums[i * 3] / c, sums[i * 3 + 1] / c, sums[i * 3 + 2] / c];
  }
  return grid;
}
