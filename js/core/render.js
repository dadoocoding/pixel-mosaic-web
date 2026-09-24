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

import { hexCorners, diamondCorners, estimateOutputDimensions, interlockRowHeightFactor, HEX_SIZE_RATIO } from "./shapes.js";
import { rgbToHex, contrastTextColor } from "./color.js";

export { estimateOutputDimensions };

/**
 * options.circleInterlock (default false, only meaningful when
 * shape === "circle"): instead of circles stacked directly on top of each
 * other, alternating rows are shifted over by half a cell and packed
 * closer together vertically so each row nests into the gap of the row
 * below it (like coins/rivets), rather than lining up in a plain grid.
 *
 * options.diamondInterlock (default false, only meaningful when
 * shape === "diamond"): the same idea, but diamonds pack edge-to-edge with
 * zero gaps (a gapless argyle/harlequin lattice) since a diamond's corners
 * can meet its neighbors' corners exactly.
 */
export function renderMosaic(quantizedGrid, gridW, gridH, shape, cellSize, bgColor, createCanvasFn,
                              options = {}) {
  const {
    circleInterlock = false, diamondInterlock = false,
  } = options;
  const [imgW, imgH] = estimateOutputDimensions(gridW, gridH, shape, cellSize, circleInterlock, diamondInterlock);
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const cellAt = (row, col) => quantizedGrid[row * gridW + col];

  if (shape === "hexagon") {
    // Flat-top hexagons: columns get the bigger spacing (1.5x size) and
    // alternating *columns* are offset vertically by half a row so each
    // hex nests cleanly into the notch of its neighbors instead of
    // overlapping them (a hexagon this shape is 2x as wide as it is tall
    // relative to its own height, so columns -- not rows -- need the
    // wider spacing).
    const hexSize = cellSize * HEX_SIZE_RATIO;
    const colW = 1.5 * hexSize;
    const rowH = Math.sqrt(3) * hexSize;
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const [r, g, b] = cellAt(row, col);
        const colOffset = col % 2 === 1 ? rowH / 2 : 0;
        const cx = colW * col + cellSize / 2;
        const cy = rowH * row + colOffset + cellSize / 2;
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

  if (shape === "circle" && circleInterlock) {
    const colW = cellSize;
    const rowH = cellSize * (Math.sqrt(3) / 2);
    const pad = cellSize * 0.04;
    const r = cellSize / 2 - pad;
    for (let row = 0; row < gridH; row++) {
      const rowOffset = row % 2 === 1 ? colW / 2 : 0;
      for (let col = 0; col < gridW; col++) {
        const [cr, cg, cb] = cellAt(row, col);
        const cx = colW * col + rowOffset + cellSize / 2;
        const cy = rowH * row + cellSize / 2;
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas;
  }

  if (shape === "diamond" && diamondInterlock) {
    const colW = cellSize;
    const rowH = cellSize * interlockRowHeightFactor("diamond", true);
    const pad = cellSize * 0.04;
    for (let row = 0; row < gridH; row++) {
      const rowOffset = row % 2 === 1 ? colW / 2 : 0;
      for (let col = 0; col < gridW; col++) {
        const [cr, cg, cb] = cellAt(row, col);
        const cx = colW * col + rowOffset + cellSize / 2;
        const cy = rowH * row + cellSize / 2;
        const corners = diamondCorners(cx - cellSize / 2, cy - cellSize / 2,
                                        cx + cellSize / 2, cy + cellSize / 2, pad);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
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
      } else if (shape === "diamond") {
        const pad = cellSize * 0.04;
        const corners = diamondCorners(x0, y0, x0 + cellSize, y0 + cellSize, pad);
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
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

// ---------------------------------------------------------------------------
// Paint-by-number rendering
// ---------------------------------------------------------------------------
// A printable alternative to the full-color render: page 1 shows an
// outlined grid with every cell's palette-color *number* instead of its
// actual color (so it can be printed in black & white and filled in by
// hand); page 2 is the color key that explains what each number means.
// Ported from mosaic_core.py's render_paint_by_number / render_color_key.

/**
 * Render page 1: an outlined grid where every cell shows the number of its
 * palette color (1-indexed -- "Color #1", matching the numbering used
 * everywhere else in the app) instead of the color itself. Uses the same
 * square/circle/diamond/hexagon layout geometry as renderMosaic so the
 * sheet lines up with the full-color render.
 */
export function renderPaintByNumber(quantizedGrid, gridW, gridH, palette, shape, cellSize,
                                     createCanvasFn, options = {}) {
  const {
    bgColor = [255, 255, 255], lineColor = [90, 90, 90], textColor = [20, 20, 20],
    circleInterlock = false, diamondInterlock = false,
  } = options;
  const [imgW, imgH] = estimateOutputDimensions(gridW, gridH, shape, cellSize, circleInterlock, diamondInterlock);
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);
  ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = Math.max(9, Math.round(cellSize * 0.42));
  ctx.font = `bold ${fontSize}px sans-serif`;

  const numberLookup = new Map(palette.map((rgb, i) => [rgbToHex(rgb), i + 1]));
  const cellAt = (row, col) => quantizedGrid[row * gridW + col];

  if (shape === "hexagon") {
    const hexSize = cellSize * HEX_SIZE_RATIO;
    const colW = 1.5 * hexSize;
    const rowH = Math.sqrt(3) * hexSize;
    ctx.lineWidth = 1.5;
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const rgb = cellAt(row, col);
        const colOffset = col % 2 === 1 ? rowH / 2 : 0;
        const cx = colW * col + cellSize / 2;
        const cy = rowH * row + colOffset + cellSize / 2;
        const corners = hexCorners(cx, cy, hexSize);
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        const number = numberLookup.get(rgbToHex(rgb));
        if (number !== undefined) ctx.fillText(String(number), cx, cy);
      }
    }
    return canvas;
  }

  if (shape === "circle" && circleInterlock) {
    const colW = cellSize;
    const rowH = cellSize * (Math.sqrt(3) / 2);
    const r = cellSize / 2 - cellSize * 0.04;
    ctx.lineWidth = 1;
    for (let row = 0; row < gridH; row++) {
      const rowOffset = row % 2 === 1 ? colW / 2 : 0;
      for (let col = 0; col < gridW; col++) {
        const rgb = cellAt(row, col);
        const cx = colW * col + rowOffset + cellSize / 2;
        const cy = rowH * row + cellSize / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
        ctx.stroke();
        const number = numberLookup.get(rgbToHex(rgb));
        if (number !== undefined) ctx.fillText(String(number), cx, cy);
      }
    }
    return canvas;
  }

  if (shape === "diamond" && diamondInterlock) {
    const colW = cellSize;
    const rowH = cellSize * interlockRowHeightFactor("diamond", true);
    const pad = cellSize * 0.04;
    ctx.lineWidth = 1;
    for (let row = 0; row < gridH; row++) {
      const rowOffset = row % 2 === 1 ? colW / 2 : 0;
      for (let col = 0; col < gridW; col++) {
        const rgb = cellAt(row, col);
        const cx = colW * col + rowOffset + cellSize / 2;
        const cy = rowH * row + cellSize / 2;
        const corners = diamondCorners(cx - cellSize / 2, cy - cellSize / 2,
                                        cx + cellSize / 2, cy + cellSize / 2, pad);
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        const number = numberLookup.get(rgbToHex(rgb));
        if (number !== undefined) ctx.fillText(String(number), cx, cy);
      }
    }
    return canvas;
  }

  // square, circle (stacked) & diamond (stacked) share a plain grid layout
  // for the printable sheet too -- the outline is always a plain square
  // box (the actual tile shape doesn't matter for a fill-in-the-number
  // sheet)
  ctx.lineWidth = 1;
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const rgb = cellAt(row, col);
      const x0 = col * cellSize, y0 = row * cellSize;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cellSize - 1, cellSize - 1);
      const number = numberLookup.get(rgbToHex(rgb));
      if (number !== undefined) ctx.fillText(String(number), x0 + cellSize / 2, y0 + cellSize / 2);
    }
  }
  return canvas;
}

/**
 * Render page 2: the color key/legend that explains what each number on
 * page 1 means -- swatch, number, name (if any), hex code, and (when
 * `counts` is given) how many cells use that color.
 */
export function renderColorKey(palette, names, counts, createCanvasFn, options = {}) {
  const {
    swatchSize = 50, bgColor = [255, 255, 255],
    textColor = [20, 20, 20], lineColor = [210, 210, 210],
  } = options;
  const pad = 20;
  const rowH = swatchSize + 14;
  const imgW = 480;
  const imgH = pad * 2 + 40 + rowH * palette.length;

  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Color Key", pad, pad + 22);

  let y = pad + 40;
  palette.forEach((rgb, i) => {
    const x0 = pad, y0 = y;
    ctx.fillStyle = `rgb(${rgb.join(",")})`;
    ctx.fillRect(x0, y0, swatchSize, swatchSize);
    ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, swatchSize - 1, swatchSize - 1);

    ctx.fillStyle = contrastTextColor(rgb);
    ctx.font = `bold ${Math.round(swatchSize * 0.4)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x0 + swatchSize / 2, y0 + swatchSize / 2);

    const labelX = x0 + swatchSize + 16;
    ctx.fillStyle = `rgb(${textColor.join(",")})`;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const name = names[i] || "";
    ctx.fillText(name ? `#${i + 1}  ${name}` : `#${i + 1}`, labelX, y0 + 20);

    ctx.fillStyle = "rgb(120,120,120)";
    ctx.font = "13px sans-serif";
    const bits = [rgbToHex(rgb)];
    if (counts) bits.push(`${counts[i].count} cells`);
    ctx.fillText(bits.join("  •  "), labelX, y0 + 40);

    y += rowH;
  });

  return canvas;
}
