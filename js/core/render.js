/**
 * render.js
 * Draw a flat row-major quantized grid ([r,g,b] per cell) as a mosaic --
 * squares, circles, or hexagons -- onto a canvas. Ported from
 * mosaic_core.py's render_mosaic (same padding/sizing formulas).
 *
 * `createCanvasFn(w, h)` is injected so this same code works with the
 * browser's `document.createElement('canvas')` and with node-canvas in
 * tests -- no browser-only globals referenced directly.
 */

import { hexCorners, estimateOutputDimensions } from "./shapes.js";

export { estimateOutputDimensions };

export function renderMosaic(quantizedGrid, gridW, gridH, shape, cellSize, bgColor, createCanvasFn) {
  const [imgW, imgH] = estimateOutputDimensions(gridW, gridH, shape, cellSize);
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const cellAt = (row, col) => quantizedGrid[row * gridW + col];

  if (shape === "hexagon") {
    const hexSize = cellSize * 0.58;
    const hexW = Math.sqrt(3) * hexSize;
    const hexH = 1.5 * hexSize;
    for (let row = 0; row < gridH; row++) {
      const rowOffset = row % 2 === 1 ? hexW / 2 : 0;
      for (let col = 0; col < gridW; col++) {
        const [r, g, b] = cellAt(row, col);
        const cx = hexW * col + rowOffset + cellSize / 2;
        const cy = hexH * row + cellSize / 2;
        const corners = hexCorners(cx, cy, hexSize);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
    }
    return canvas;
  }

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const [r, g, b] = cellAt(row, col);
      const x0 = col * cellSize, y0 = row * cellSize;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      if (shape === "circle") {
        const pad = cellSize * 0.04;
        ctx.beginPath();
        ctx.ellipse(x0 + cellSize / 2, y0 + cellSize / 2,
                     cellSize / 2 - pad, cellSize / 2 - pad, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x0, y0, cellSize, cellSize);
      }
    }
  }
  return canvas;
}

/**
 * Render a brick layout (from bricks.js computeBrickLayout) as outlined
 * rectangles, so piece boundaries are visible even between two adjacent
 * same-color bricks. Ported from mosaic_core.py's render_brick_mosaic.
 */
export function renderBrickMosaic(bricks, cellSize, bgColor, createCanvasFn,
                                   outlineColor = [15, 15, 17], outlineWidth = 2) {
  if (!bricks.length) {
    const canvas = createCanvasFn(cellSize, cellSize);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
    ctx.fillRect(0, 0, cellSize, cellSize);
    return canvas;
  }

  const maxRow = Math.max(...bricks.map(b => b.row + b.height));
  const maxCol = Math.max(...bricks.map(b => b.col + b.width));
  const canvas = createCanvasFn(maxCol * cellSize, maxRow * cellSize);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = `rgb(${outlineColor[0]},${outlineColor[1]},${outlineColor[2]})`;

  for (const b of bricks) {
    const x0 = b.col * cellSize, y0 = b.row * cellSize;
    const w = b.width * cellSize, h = b.height * cellSize;
    ctx.fillStyle = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0 + outlineWidth / 2, y0 + outlineWidth / 2,
                    w - outlineWidth, h - outlineWidth);
  }
  return canvas;
}
