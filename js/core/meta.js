/**
 * meta.js
 * "Meta" mosaic mode: every cell shows the same whole-source-image
 * thumbnail, tinted so its average color reads as that cell's target
 * mosaic color -- a mosaic built out of tiny copies of itself. Ported
 * from mosaic_core.py's _rgb_to_hsl / _hsl_to_rgb / _cover_thumbnail /
 * render_meta_mosaic (same math: hue+saturation replaced with the
 * target's, lightness shifted by a constant so the thumbnail's *average*
 * lightness lands on the target -- preserves the thumbnail's own
 * contrast/detail, like a color-tinted photo).
 */

/** RGB (0-255) -> HSL (h, s, l each 0-1). */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-12) return [0, 0, l];

  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** HSL (each 0-1) -> RGB (0-255, not rounded). */
function hslToRgb(h, s, l) {
  if (s < 1e-12) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hueToRgb(h + 1 / 3) * 255, hueToRgb(h) * 255, hueToRgb(h - 1 / 3) * 255];
}

/** Scale-to-fill + center-crop `sourceCanvas` into a size x size square
 *  (like CSS background-size:cover) -- the same whole-image thumbnail
 *  every cell in a meta mosaic reuses. */
export function coverThumbnail(sourceCanvas, size, createCanvasFn) {
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const scale = Math.max(size / sw, size / sh);
  const cropW = size / scale, cropH = size / scale;
  const sx = (sw - cropW) / 2, sy = (sh - cropH) / 2;

  const canvas = createCanvasFn(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceCanvas, sx, sy, cropW, cropH, 0, 0, size, size);
  return canvas;
}

/** Render a meta mosaic. `targetGrid` is a flat [r,g,b] array, row-major
 *  (as from grid.js's imageToGrid) driving each cell's target color;
 *  every cell is filled with `sourceCanvas`'s own whole-image thumbnail,
 *  tinted toward that cell's target color. tintStrength is 0-1: a linear
 *  blend between the thumbnail's own original pixel and the fully-tinted
 *  one (0 = untouched thumbnail in every cell, 1 = fully tinted). */
export function renderMetaMosaic(sourceCanvas, targetGrid, gridW, gridH, cellSize, tintStrength, createCanvasFn) {
  const thumbCanvas = coverThumbnail(sourceCanvas, cellSize, createCanvasFn);
  const thumbCtx = thumbCanvas.getContext("2d");
  const thumbData = thumbCtx.getImageData(0, 0, cellSize, cellSize).data;
  const n = cellSize * cellSize;

  const thumbL = new Float64Array(n);
  let sumL = 0;
  for (let i = 0; i < n; i++) {
    const [, , l] = rgbToHsl(thumbData[i * 4], thumbData[i * 4 + 1], thumbData[i * 4 + 2]);
    thumbL[i] = l;
    sumL += l;
  }
  const thumbAvgL = sumL / n;

  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  const cellImageData = ctx.createImageData(cellSize, cellSize);
  const cellPx = cellImageData.data;

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const [tr, tg, tb] = targetGrid[row * gridW + col];
      const [targetH, targetS, targetL] = rgbToHsl(tr, tg, tb);
      const lShift = targetL - thumbAvgL;

      for (let i = 0; i < n; i++) {
        const tintedL = Math.min(1, Math.max(0, thumbL[i] + lShift));
        const [tRr, tRg, tRb] = hslToRgb(targetH, targetS, tintedL);

        const origR = thumbData[i * 4], origG = thumbData[i * 4 + 1], origB = thumbData[i * 4 + 2];
        cellPx[i * 4] = Math.round(origR * (1 - tintStrength) + tRr * tintStrength);
        cellPx[i * 4 + 1] = Math.round(origG * (1 - tintStrength) + tRg * tintStrength);
        cellPx[i * 4 + 2] = Math.round(origB * (1 - tintStrength) + tRb * tintStrength);
        cellPx[i * 4 + 3] = 255;
      }
      ctx.putImageData(cellImageData, col * cellSize, row * cellSize);
    }
  }
  return canvas;
}
