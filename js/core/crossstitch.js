/**
 * crossstitch.js
 * Counted Cross-Stitch mode: quantizes the image to the built-in DMC floss
 * palette (dmc.js) and renders an on-screen preview that looks like the
 * actual stitched piece -- an "X" stitch per cell on a fabric-colored
 * background, with the standard every-10-count heavier gridlines used on
 * real counted-cross-stitch charts. Ported from mosaic_core.py's
 * quantize_grid_dmc / dmc_color_counts / cross_stitch_symbol_map /
 * render_cross_stitch_mosaic (same colors, same symbol assignment order,
 * same stitch/gridline geometry).
 */

import { rgbToHex } from "./color.js";
import { colorCounts } from "./colorCounts.js";
import { DMC_RGB_PALETTE, DMC_COLOR_NAMES, DMC_COLOR_NUMBERS } from "./dmc.js";

/** Blend rgb toward white -- used for the pattern chart's per-cell
 *  background, so the color still reads as a hint at a glance but stays
 *  pale enough that a black symbol drawn on top stays legible everywhere. */
function pastelBlend([r, g, b], whiteFrac = 0.72) {
  return [
    Math.round(r + (255 - r) * whiteFrac),
    Math.round(g + (255 - g) * whiteFrac),
    Math.round(b + (255 - b) * whiteFrac),
  ];
}

// A light, warm off-white "Aida cloth" tone -- the standard cross-stitch
// fabric color -- used as the on-screen preview's background.
export const CROSS_STITCH_FABRIC_COLOR = [237, 230, 211];
export const CROSS_STITCH_GRID_LINE_COLOR = [208, 199, 176];
export const CROSS_STITCH_COUNT_LINE_COLOR = [150, 138, 108];

// Printable pattern-chart symbols, cycled through in order for however many
// distinct DMC colors a given piece actually uses. Mixes shapes and glyphs
// that stay visually distinct from each other at small print size and in
// black & white.
export const CROSS_STITCH_SYMBOLS = Array.from(
  "■●▲◆★▼✚◇"
  + "△○✖▶◀✦◐◑"
  + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  + "0123456789"
);

/** The dmccolorchart.com page for a given DMC floss number, e.g. 310 ->
 *  "https://dmccolorchart.com/color/310". */
export function dmcColorUrl(dmcNumber) {
  return `https://dmccolorchart.com/color/${dmcNumber}`;
}

/** Like colorCounts, but against the built-in DMC palette and with each
 *  entry's DMC floss number (and dmccolorchart.com link) attached -- used
 *  for Cross-Stitch mode's pattern legend and shopping list. `grid` is a
 *  flat [r,g,b] array. */
export function dmcColorCounts(grid) {
  const counts = colorCounts(grid, DMC_RGB_PALETTE, DMC_COLOR_NAMES);
  return counts.map((c, i) => ({ ...c, number: DMC_COLOR_NUMBERS[i], url: dmcColorUrl(DMC_COLOR_NUMBERS[i]) }));
}

/** Assign a printable symbol to each DMC color actually used in `grid`
 *  (flat [r,g,b] array), keyed by hex string. Assigned in DMC_RGB_PALETTE
 *  order for a stable, reproducible chart across re-generates of the same
 *  image/settings. */
export function crossStitchSymbolMap(grid) {
  const usedHex = new Set(grid.map(rgbToHex));
  const symbolMap = new Map();
  let i = 0;
  for (const rgb of DMC_RGB_PALETTE) {
    const hex = rgbToHex(rgb);
    if (usedHex.has(hex)) {
      symbolMap.set(hex, CROSS_STITCH_SYMBOLS[i % CROSS_STITCH_SYMBOLS.length]);
      i++;
    }
  }
  return symbolMap;
}

/** Render a DMC-quantized grid (flat [r,g,b] array, row-major) as it would
 *  actually look stitched. `createCanvasFn(w, h)` returns a canvas-like
 *  object (HTMLCanvasElement in the browser, node-canvas's Canvas in
 *  tests). */
export function renderCrossStitchMosaic(grid, gridW, gridH, cellSize, createCanvasFn, options = {}) {
  const {
    fabricColor = CROSS_STITCH_FABRIC_COLOR,
    stitchPadFrac = 0.16,
    stitchWidthFrac = 0.16,
  } = options;

  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${fabricColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const pad = cellSize * stitchPadFrac;
  const stitchWidth = Math.max(1, Math.round(cellSize * stitchWidthFrac));
  ctx.lineWidth = stitchWidth;
  ctx.lineCap = "round";

  for (let row = 0; row < gridH; row++) {
    const y0 = row * cellSize;
    for (let col = 0; col < gridW; col++) {
      const x0 = col * cellSize;
      const [r, g, b] = grid[row * gridW + col];
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.moveTo(x0 + pad, y0 + pad);
      ctx.lineTo(x0 + cellSize - pad, y0 + cellSize - pad);
      ctx.moveTo(x0 + cellSize - pad, y0 + pad);
      ctx.lineTo(x0 + pad, y0 + cellSize - pad);
      ctx.stroke();
    }
  }

  // Light per-cell gridlines, then heavier count-lines every 10 cells (the
  // convention on printed cross-stitch charts) drawn on top.
  ctx.strokeStyle = `rgb(${CROSS_STITCH_GRID_LINE_COLOR.join(",")})`;
  ctx.lineWidth = 1;
  for (let col = 0; col <= gridW; col++) {
    const x = col * cellSize + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, imgH); ctx.stroke();
  }
  for (let row = 0; row <= gridH; row++) {
    const y = row * cellSize + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(imgW, y); ctx.stroke();
  }

  ctx.strokeStyle = `rgb(${CROSS_STITCH_COUNT_LINE_COLOR.join(",")})`;
  ctx.lineWidth = 2;
  for (let col = 0; col <= gridW; col += 10) {
    const x = col * cellSize;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, imgH); ctx.stroke();
  }
  for (let row = 0; row <= gridH; row += 10) {
    const y = row * cellSize;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(imgW, y); ctx.stroke();
  }

  return canvas;
}

/** Render one printable page of a cross-stitch pattern chart: a pale
 *  color-tinted grid with each cell's DMC symbol drawn on top (readable in
 *  black & white too), heavier gridlines + stitch-count numbers every 10
 *  cells, counting in *global* pattern coordinates (rowOffset/colOffset)
 *  even when this is one page of a larger multi-page pattern. `gridSlice`
 *  is a flat [r,g,b] array (row-major, this page's own w x h). Ported from
 *  mosaic_core.py's render_cross_stitch_pattern_page. */
export function renderCrossStitchPatternPage(gridSlice, w, h, symbolMap, rowOffset, colOffset,
                                              pageLabel, cellSize, createCanvasFn) {
  const marginTop = 50, marginLeft = 34;
  const imgW = marginLeft + w * cellSize + 10;
  const imgH = marginTop + h * cellSize + 10;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgW, imgH);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (pageLabel) {
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#141414";
    ctx.fillText(pageLabel, marginLeft, 15);
    ctx.textAlign = "center";
  }

  const gx0 = marginLeft, gy0 = marginTop;
  ctx.font = `${Math.round(cellSize * 0.6)}px sans-serif`;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const rgb = gridSlice[row * w + col];
      const x0 = gx0 + col * cellSize, y0 = gy0 + row * cellSize;
      const [pr, pg, pb] = pastelBlend(rgb);
      ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
      ctx.fillRect(x0, y0, cellSize, cellSize);
      const symbol = symbolMap.get(rgbToHex(rgb)) || "?";
      ctx.fillStyle = "#141414";
      ctx.fillText(symbol, x0 + cellSize / 2, y0 + cellSize / 2 + 1);
    }
  }

  ctx.strokeStyle = "rgb(215,215,215)";
  ctx.lineWidth = 1;
  for (let col = 0; col <= w; col++) {
    const x = gx0 + col * cellSize + 0.5;
    ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy0 + h * cellSize); ctx.stroke();
  }
  for (let row = 0; row <= h; row++) {
    const y = gy0 + row * cellSize + 0.5;
    ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx0 + w * cellSize, y); ctx.stroke();
  }

  ctx.strokeStyle = "rgb(60,60,60)";
  ctx.fillStyle = "#141414";
  ctx.lineWidth = 2;
  ctx.font = "11px sans-serif";
  for (let col = 0; col <= w; col += 10) {
    const x = gx0 + col * cellSize;
    ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy0 + h * cellSize); ctx.stroke();
    if (col > 0 && col < w) ctx.fillText(String(colOffset + col), x, gy0 - 12);
  }
  for (let row = 0; row <= h; row += 10) {
    const y = gy0 + row * cellSize;
    ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx0 + w * cellSize, y); ctx.stroke();
    if (row > 0 && row < h) ctx.fillText(String(rowOffset + row), gx0 - 16, y);
  }
  ctx.strokeRect(gx0, gy0, w * cellSize, h * cellSize);

  return canvas;
}

/** Render the final page of a cross-stitch pattern PDF: a legend mapping
 *  every symbol used to its DMC number, name, swatch, and stitch count --
 *  sorted by stitch count (most-used first). Ported from
 *  mosaic_core.py's render_cross_stitch_legend_page. */
export function renderCrossStitchLegendPage(dmcCounts, symbolMap, createCanvasFn, swatchSize = 34) {
  const used = dmcCounts.filter(c => c.count > 0).slice().sort((a, b) => b.count - a.count);

  const pad = 20, rowH = swatchSize + 10, imgW = 560;
  const imgH = pad * 2 + 44 + rowH * used.length;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = "#141414";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Color Key", pad, pad + 18);

  let y = pad + 44;
  ctx.textBaseline = "middle";
  for (const c of used) {
    const [pr, pg, pb] = pastelBlend(c.rgb);
    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    ctx.fillRect(pad, y, swatchSize, swatchSize);
    ctx.strokeStyle = "rgb(210,210,210)";
    ctx.strokeRect(pad, y, swatchSize, swatchSize);

    ctx.fillStyle = "#141414";
    ctx.font = `${Math.round(swatchSize * 0.55)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(symbolMap.get(c.hex) || "?", pad + swatchSize / 2, y + swatchSize / 2 + 1);

    ctx.textAlign = "left";
    ctx.font = "15px sans-serif";
    ctx.fillText(`DMC ${c.number} — ${c.name}  (${c.count} stitches)`,
      pad + swatchSize + 16, y + swatchSize / 2);
    y += rowH;
  }
  return canvas;
}
