/**
 * foundobject.js
 * "Found Object" mosaic mode: after the image is quantized to a small
 * palette (the same auto K-Means pipeline Classic mode uses), any one of
 * those colors can be replaced with the user's own photo of a real object
 * that color -- e.g. a photo of a blue shirt button standing in for every
 * "blue" cell. Ported from mosaic_core.py's render_found_object_mosaic
 * (same math: reuses meta.js's cover-crop + hue/lightness tint, just keyed
 * per-color instead of one shared whole-image thumbnail). A color with no
 * photo assigned renders as a plain color square, same as Classic mode.
 */
import { rgbToHsl, hslToRgb, coverThumbnail } from "./meta.js";

/** Render a Found Object mosaic. `targetGrid` is a flat [r,g,b] array,
 * row-major (as from grid.js's imageToGrid or the quantized palette
 * output), driving each cell's target color. `foundImages` is a Map from
 * "r,g,b" color key -> an already-loaded source canvas/image (the user's
 * found-object photo for that color). Colors not present in foundImages
 * fall back to a plain color square. */
export function renderFoundObjectMosaic(targetGrid, gridW, gridH, cellSize, bgColor,
                                         foundImages, tintStrength, createCanvasFn) {
  // Precompute each assigned photo's cover-cropped thumbnail once (not
  // per-cell -- every cell of the same color reuses the same thumbnail).
  const thumbCache = new Map();
  for (const [key, sourceImg] of foundImages) {
    const thumbCanvas = coverThumbnail(sourceImg, cellSize, createCanvasFn);
    const data = thumbCanvas.getContext("2d").getImageData(0, 0, cellSize, cellSize).data;
    const n = cellSize * cellSize;
    const ls = new Float64Array(n);
    let sumL = 0;
    for (let i = 0; i < n; i++) {
      const [, , l] = rgbToHsl(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      ls[i] = l;
      sumL += l;
    }
    thumbCache.set(key, { data, ls, avgL: sumL / n });
  }

  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const n = cellSize * cellSize;
  const cellImageData = ctx.createImageData(cellSize, cellSize);
  const cellPx = cellImageData.data;

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const [tr, tg, tb] = targetGrid[row * gridW + col];
      const key = `${tr},${tg},${tb}`;
      const cached = thumbCache.get(key);

      if (!cached) {
        ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        continue;
      }

      const [targetH, targetS, targetL] = rgbToHsl(tr, tg, tb);
      const lShift = targetL - cached.avgL;

      for (let i = 0; i < n; i++) {
        const tintedL = Math.min(1, Math.max(0, cached.ls[i] + lShift));
        const [tRr, tRg, tRb] = hslToRgb(targetH, targetS, tintedL);

        const origR = cached.data[i * 4], origG = cached.data[i * 4 + 1], origB = cached.data[i * 4 + 2];
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
