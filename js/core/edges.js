/**
 * edges.js
 * Detect strong edges in the source image and downsample them to a
 * gridW x gridH boolean mask -- used by the 'artistic' render style to
 * trace outlines (fork tines, glasses, collar lines, fence rails, etc.)
 * the way a hand-drawn pixel-art piece would, rather than letting those
 * boundaries blend into the surrounding average color. Ported from
 * mosaic_core.py's compute_edge_mask (same luminance formula,
 * central-difference gradient, and percentile-based threshold).
 */

/**
 * Returns a flat Uint8Array of length gridW*gridH (1 = edge cell, 0 = not),
 * row-major, matching quantizedGrid's own layout.
 *
 * sensitivity: 0-100. Higher marks more cells as edges (more outlining,
 * can get noisy on busy images); lower marks fewer (cleaner, may miss soft
 * boundaries). Internally maps to a percentile threshold that marks at
 * most ~25% of cells even at sensitivity=100, since a photo's strongest
 * gradients concentrate on real edges -- this stays selective rather than
 * outlining everything.
 */
export function computeEdgeMask(sourceCanvas, gridW, gridH, sensitivity = 55) {
  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const src = ctx.getImageData(0, 0, sw, sh).data;

  // Luminance (same ITU-R 601-2 weights as PIL's "L" conversion).
  const gray = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      gray[y * sw + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }

  // Gradient magnitude via central differences (mirrors numpy.gradient,
  // falling back to a one-sided difference at the image edges).
  const mag = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const yUp = Math.max(0, y - 1), yDn = Math.min(sh - 1, y + 1);
    const yStep = yDn - yUp || 1;
    for (let x = 0; x < sw; x++) {
      const xL = Math.max(0, x - 1), xR = Math.min(sw - 1, x + 1);
      const xStep = xR - xL || 1;
      const gy = (gray[yDn * sw + x] - gray[yUp * sw + x]) / yStep;
      const gx = (gray[y * sw + xR] - gray[y * sw + xL]) / xStep;
      mag[y * sw + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Downsample the same box-average way imageToGrid downsamples color, so
  // an "edge cell" lines up with the same source-pixel region that was
  // averaged into that cell's color.
  const sums = new Float64Array(gridW * gridH);
  const counts = new Float64Array(gridW * gridH);
  for (let y = 0; y < sh; y++) {
    const gy = Math.min(gridH - 1, Math.floor((y / sh) * gridH));
    const rowBase = gy * gridW;
    for (let x = 0; x < sw; x++) {
      const gx = Math.min(gridW - 1, Math.floor((x / sw) * gridW));
      const cell = rowBase + gx;
      sums[cell] += mag[y * sw + x];
      counts[cell]++;
    }
  }
  const downsampled = new Float64Array(gridW * gridH);
  for (let i = 0; i < downsampled.length; i++) downsampled[i] = sums[i] / (counts[i] || 1);

  const clampedSensitivity = Math.max(0, Math.min(100, sensitivity));
  const fraction = (clampedSensitivity / 100) * 0.25;
  const sorted = Float64Array.from(downsampled).sort();
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - fraction) * sorted.length)));
  const threshold = sorted[idx];

  const mask = new Uint8Array(gridW * gridH);
  for (let i = 0; i < mask.length; i++) mask[i] = downsampled[i] >= threshold ? 1 : 0;
  return mask;
}
