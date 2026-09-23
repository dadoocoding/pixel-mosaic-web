/**
 * rubiks.js
 * Rubik's Cube mosaic: quantize an image down to the 6 sticker colors a
 * standard cube actually comes in, group the grid into 3x3 blocks (each
 * block is exactly the 9 stickers you'd set on one cube's visible face),
 * and render it as glossy stickers with a wider gap between cube blocks
 * than between the 9 stickers within one. Ported from mosaic_core.py's
 * "Rubik's Cube mosaic" section (same palette, same geometry, same
 * highlight/bezel approximation, same letter-coded build sheet).
 *
 * Grids here use the same flat, row-major [r,g,b]-per-cell convention as
 * grid.js's imageToGrid: length gridW*gridH, index = row*gridW + col.
 * "Cubes wide" x "cubes tall" in the UI is the grid size in cube units;
 * app.js is responsible for turning that into a (cubesTall*3, cubesWide*3)
 * cell grid before calling quantizeToFixedPalette against RUBIKS_PALETTE.
 */

import { rgbToHex } from "./color.js";
import { colorCounts } from "./colorCounts.js";

// The 6 sticker colors a standard Rubik's Cube actually comes in. Values are
// the "official" cube sticker colors as documented in the brand's EU
// trademark filing (Pantone-derived), compiled via community color
// references (e.g. schemecolor.com) -- not independently measured off a
// physical cube, so treat them as a solid starting point rather than a
// guaranteed match to your specific set.
export const RUBIKS_CUBE_COLORS = [
  { name: "White", rgb: [255, 255, 255] },
  { name: "Red", rgb: [186, 12, 47] },
  { name: "Orange", rgb: [254, 80, 0] },
  { name: "Yellow", rgb: [255, 215, 0] },
  { name: "Green", rgb: [0, 154, 68] },
  { name: "Blue", rgb: [0, 61, 165] },
];
export const RUBIKS_PALETTE = RUBIKS_CUBE_COLORS.map(c => c.rgb);
export const RUBIKS_COLOR_NAMES = RUBIKS_CUBE_COLORS.map(c => c.name);
// First letter of each name is unique (W/R/O/Y/G/B) -- used as the printable
// build-sheet label instead of a palette number, since with only six fixed
// colors a single letter is more mnemonic than "Color #3". Keyed by hex
// since JS can't key a Map/object by an array the way Python keys a dict by
// an RGB tuple.
const RUBIKS_COLOR_LETTERS = new Map(
  RUBIKS_CUBE_COLORS.map(c => [rgbToHex(c.rgb), c.name[0]])
);

function blendRgb([r, g, b], [or_, og, ob], t) {
  return [
    Math.round(r + (or_ - r) * t),
    Math.round(g + (og - g) * t),
    Math.round(b + (ob - b) * t),
  ];
}

/** Pixel origin of cell `index` along one axis, adding one cubeGap for every
 * completed group of 3 cells before it -- this is what creates the wider
 * seam between whole cube blocks vs. the thin gap between the 9 stickers
 * within one cube. */
function rubiksCellOrigin(index, cellSize, cubeGap) {
  return index * cellSize + Math.floor(index / 3) * cubeGap;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Draw one Rubik's-cube sticker: a rounded rect in `color`, a soft lighter
 * highlight ellipse in the upper-left (fake glossy-plastic sheen), and a
 * darker thin outline (fake bezel) -- cheap enough to draw per-cell at any
 * grid size, no per-pixel gradient/compositing needed. */
function drawGlossySticker(ctx, x0, y0, w, h, color, radius, outlineWidth) {
  const highlight = blendRgb(color, [255, 255, 255], 0.45);
  const shadow = blendRgb(color, [0, 0, 0], 0.35);

  roundedRectPath(ctx, x0, y0, w, h, radius);
  ctx.fillStyle = `rgb(${color.join(",")})`;
  ctx.fill();

  // Soft highlight: an ellipse comfortably inside the sticker's upper-left
  // so it never pokes past the rounded corners.
  ctx.fillStyle = `rgb(${highlight.join(",")})`;
  ctx.beginPath();
  ctx.ellipse(x0 + w * 0.35, y0 + h * 0.30, w * 0.27, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  roundedRectPath(ctx, x0, y0, w, h, radius);
  ctx.strokeStyle = `rgb(${shadow.join(",")})`;
  ctx.lineWidth = Math.max(1, outlineWidth);
  ctx.stroke();
}

/** Render a Rubik's-cube-palette grid (flat [r,g,b] per cell) as glossy
 * stickers, grouped into 3x3 cube blocks with a wider gap between blocks
 * than between the stickers within one (see rubiksCellOrigin). */
export function renderRubiksMosaic(grid, gridW, gridH, cellSize, createCanvasFn, options = {}) {
  const {
    stickerGapFrac = 0.07, cubeGapFrac = 0.34, cornerRadiusFrac = 0.16,
    bgColor = [12, 12, 14],
  } = options;
  const cubeGap = cellSize * cubeGapFrac;
  const stickerGap = cellSize * stickerGapFrac;
  const radius = Math.max(1, cellSize * cornerRadiusFrac);
  const outlineW = Math.max(1, cellSize * 0.03);

  const imgW = Math.round(rubiksCellOrigin(gridW, cellSize, cubeGap));
  const imgH = Math.round(rubiksCellOrigin(gridH, cellSize, cubeGap));
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  for (let row = 0; row < gridH; row++) {
    const y0 = rubiksCellOrigin(row, cellSize, cubeGap);
    for (let col = 0; col < gridW; col++) {
      const x0 = rubiksCellOrigin(col, cellSize, cubeGap);
      const color = grid[row * gridW + col];
      drawGlossySticker(
        ctx,
        x0 + stickerGap, y0 + stickerGap,
        cellSize - 2 * stickerGap, cellSize - 2 * stickerGap,
        color, radius, outlineW,
      );
    }
  }
  return canvas;
}

/** How many physical cubes this mosaic needs -- one per 3x3 block. */
export function rubiksCubeCount(gridW, gridH) {
  return Math.floor(gridH / 3) * Math.floor(gridW / 3);
}

/** Apply a {cube color name: replacement rgb} reassignment (e.g.
 * { Green: [0, 61, 165] } to show blue wherever the mosaic called for
 * green) to a Rubik's-quantized grid. `baseGrid` must be the *original*
 * fixed-6-color quantized grid (never itself already remapped) -- every
 * cell is matched by which of the 6 RUBIKS_CUBE_COLORS it started out as,
 * then swapped to that color's current assignment in colorMap (or left
 * alone if that name isn't in colorMap, or maps to its own default color).
 * Ported from mosaic_core.py's remap_rubiks_colors.
 *
 * Always working from the pristine base grid, rather than composing
 * successive swaps against an already-remapped grid, means re-opening the
 * recolor dialog and changing selections can never cascade incorrectly --
 * e.g. assigning Green -> Blue and then, separately, Blue -> Red must not
 * turn the original green stickers red. Every downstream Rubik's export
 * (glossy render, build-sheet letters, color key/shopping list) keys off a
 * cell's actual current RGB, so this remapped grid is all any of them
 * need -- no other code has to know a reassignment happened. */
export function remapRubiksColors(baseGrid, colorMap) {
  const swap = new Map();
  for (const { name, rgb } of RUBIKS_CUBE_COLORS) {
    const newRgb = colorMap[name] || rgb;
    if (rgbToHex(newRgb) !== rgbToHex(rgb)) swap.set(rgbToHex(rgb), newRgb);
  }
  if (swap.size === 0) return baseGrid;
  return baseGrid.map(cell => swap.get(rgbToHex(cell)) || cell);
}

/** Printable page 1 of the build guide: an outlined grid where every
 * sticker shows its color's *letter* (W/R/O/Y/G/B) instead of the color
 * itself, with a heavier border around every 3x3 cube block and a small
 * "row,col" position label (1-indexed, in cube units) in its top-left
 * corner -- so it doubles as a per-cube instruction sheet: read the nine
 * letters inside one heavy-bordered block, set that cube's face to match,
 * move to the next block. */
export function renderRubiksBuildSheet(grid, gridW, gridH, cellSize, createCanvasFn, options = {}) {
  const { bgColor = [255, 255, 255], lineColor = [90, 90, 90], cubeLineColor = [20, 20, 20],
          textColor = [20, 20, 20] } = options;

  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
  ctx.lineWidth = 1;
  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = `bold ${Math.round(cellSize * 0.42)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const x0 = col * cellSize, y0 = row * cellSize;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cellSize, cellSize);
      const rgb = grid[row * gridW + col];
      const letter = RUBIKS_COLOR_LETTERS.get(rgbToHex(rgb)) || "?";
      ctx.fillText(letter, x0 + cellSize / 2, y0 + cellSize / 2);
    }
  }

  // Heavier lines around every 3x3 cube block, plus a small position label.
  const cubeW = Math.max(1, Math.floor(gridW / 3));
  const cubeH = Math.max(1, Math.floor(gridH / 3));
  const blockBorderWidth = Math.max(2, Math.round(cellSize * 0.06));
  ctx.strokeStyle = `rgb(${cubeLineColor.join(",")})`;
  ctx.lineWidth = blockBorderWidth;
  ctx.fillStyle = `rgb(${cubeLineColor.join(",")})`;
  ctx.font = `${Math.round(cellSize * 0.32)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let cr = 0; cr < cubeH; cr++) {
    for (let cc = 0; cc < cubeW; cc++) {
      const x0 = cc * 3 * cellSize, y0 = cr * 3 * cellSize;
      ctx.strokeRect(x0 + blockBorderWidth / 2, y0 + blockBorderWidth / 2,
        3 * cellSize - blockBorderWidth, 3 * cellSize - blockBorderWidth);
      ctx.fillText(`${cr + 1},${cc + 1}`, x0 + 4, y0 + 2);
    }
  }
  return canvas;
}

/** Page 2 of the build guide: color key (letter, swatch, name, hex, sticker
 * count) plus the total physical cube count. */
export function renderRubiksKey(grid, palette, gridW, gridH, createCanvasFn, options = {}) {
  const { swatchSize = 50, bgColor = [255, 255, 255], textColor = [20, 20, 20],
          lineColor = [210, 210, 210] } = options;
  const counts = colorCounts(grid, palette, RUBIKS_COLOR_NAMES);
  const cubeTotal = rubiksCubeCount(gridW, gridH);

  const pad = 20;
  const rowH = swatchSize + 14;
  const imgW = 460;
  const imgH = pad * 2 + 70 + rowH * palette.length;

  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Rubik's Cube Key / Shopping List", pad, pad + 20);

  ctx.font = "15px sans-serif";
  ctx.fillStyle = "rgb(90,90,90)";
  ctx.fillText(`${cubeTotal} cubes needed total`, pad, pad + 28 + 14);

  let y = pad + 60;
  for (const c of counts) {
    const rgb = c.rgb;
    const x0 = pad, y0 = y;
    roundedRectPath(ctx, x0, y0, swatchSize, swatchSize, 0);
    ctx.fillStyle = `rgb(${rgb.join(",")})`;
    ctx.fill();
    ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const letter = RUBIKS_COLOR_LETTERS.get(rgbToHex(rgb)) || "?";
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    ctx.fillStyle = luminance > 0.55 ? "#000000" : "#ffffff";
    ctx.font = `bold ${Math.round(swatchSize * 0.42)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, x0 + swatchSize / 2, y0 + swatchSize / 2);

    const labelX = x0 + swatchSize + 16;
    ctx.fillStyle = `rgb(${textColor.join(",")})`;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(c.name, labelX, y0 + 2 + 16);

    ctx.fillStyle = "rgb(120,120,120)";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${c.hex}  •  ${c.count} stickers`, labelX, y0 + 24 + 13);

    y += rowH;
  }

  return canvas;
}
