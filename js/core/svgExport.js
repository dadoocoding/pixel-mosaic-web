/**
 * svgExport.js
 * Color-separated SVG export -- a vector alternative to the raster PNG
 * export, for opening the mosaic in a vector editor (Illustrator, Inkscape,
 * Cricut Design Space, a laser cutter's software...) and working with one
 * color at a time. Every cell is placed with the exact same per-shape
 * geometry renderMosaic uses (same coordinates, same pixel scale -- 1 SVG
 * unit = 1 output pixel), grouped into one <g> layer per palette color, so
 * a single color's cells can be selected, hidden, recolored, or
 * cut/printed as their own pass without hand-picking shapes one at a time.
 * Ported from mosaic_core.py's export_color_separated_svg (same math, same
 * per-color-layer grouping, same duplicate-palette-entry dedup).
 */

import { hexCorners, diamondCorners, estimateOutputDimensions, interlockRowHeightFactor, HEX_SIZE_RATIO } from "./shapes.js";
import { rgbToHex } from "./color.js";

function svgEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The SVG element (<rect>/<circle>/<polygon>, no fill attribute -- the
 * enclosing <g> carries the color) for one grid cell, using the exact same
 * per-shape coordinate math as renderMosaic's four layout branches (plain
 * grid, hexagon, circle-interlock, diamond-interlock) so the SVG lines up
 * pixel-for-pixel with the app's own raster preview. */
function svgCellShape(shape, row, col, cellSize, circleInterlock, diamondInterlock) {
  if (shape === "hexagon") {
    const hexSize = cellSize * HEX_SIZE_RATIO;
    const colW = 1.5 * hexSize;
    const rowH = Math.sqrt(3) * hexSize;
    const cx = colW * col + cellSize / 2;
    const cy = rowH * row + (col % 2 === 1 ? rowH / 2 : 0) + cellSize / 2;
    const pts = hexCorners(cx, cy, hexSize).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return `<polygon points="${pts}"/>`;
  }

  if (shape === "circle" && circleInterlock) {
    const colW = cellSize;
    const rowH = cellSize * (Math.sqrt(3) / 2);
    const pad = cellSize * 0.04;
    const r = cellSize / 2 - pad;
    const rowOffset = row % 2 === 1 ? colW / 2 : 0;
    const cx = colW * col + rowOffset + cellSize / 2;
    const cy = rowH * row + cellSize / 2;
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`;
  }

  if (shape === "diamond" && diamondInterlock) {
    const colW = cellSize;
    const rowH = cellSize * interlockRowHeightFactor("diamond", true);
    const pad = cellSize * 0.04;
    const rowOffset = row % 2 === 1 ? colW / 2 : 0;
    const cx = colW * col + rowOffset + cellSize / 2;
    const cy = rowH * row + cellSize / 2;
    const pts = diamondCorners(cx - cellSize / 2, cy - cellSize / 2, cx + cellSize / 2, cy + cellSize / 2, pad)
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return `<polygon points="${pts}"/>`;
  }

  const x0 = col * cellSize, y0 = row * cellSize;
  if (shape === "circle") {
    const pad = cellSize * 0.04;
    const cx = x0 + cellSize / 2, cy = y0 + cellSize / 2;
    const r = cellSize / 2 - pad;
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`;
  }
  if (shape === "diamond") {
    const pad = cellSize * 0.04;
    const pts = diamondCorners(x0, y0, x0 + cellSize, y0 + cellSize, pad)
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return `<polygon points="${pts}"/>`;
  }
  return `<rect x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}"/>`;
}

/**
 * Build an SVG string where every cell is grouped into a <g> layer by its
 * palette color -- one non-empty layer per *distinct* color actually used
 * (a palette with duplicate RGB entries, e.g. from a K-Means run asked for
 * more colors than the image has, still gets exactly one layer per real
 * color), each tagged with that color's hex/name/cell-count as data-*
 * attributes and an id like "color-3" (matching the paint-by-number
 * sheet's 1-based numbering, by the color's first position in `palette`).
 * Colors absent from this particular grid get no layer.
 *
 * grid: flat array of [r,g,b], row-major (index = row*gridW+col), the same
 * convention every grid in this project uses.
 *
 * bgColor, if given ([r,g,b]), is drawn as a full-canvas background rect
 * first -- useful for shapes with gaps between cells (hexagon, the
 * interlock layouts, non-interlocked circle/diamond) so those gaps show
 * something other than a transparent hole when opened outside a vector
 * editor.
 *
 * Returns { svg, layerCount }.
 */
export function buildColorSeparatedSvg(grid, gridW, gridH, palette, shape, cellSize, options = {}) {
  const { names = [], circleInterlock = false, diamondInterlock = false, bgColor = null } = options;
  const [imgW, imgH] = estimateOutputDimensions(gridW, gridH, shape, cellSize, circleInterlock, diamondInterlock);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${imgW} ${imgH}">`,
  ];
  if (bgColor) lines.push(`  <rect width="100%" height="100%" fill="${rgbToHex(bgColor)}"/>`);

  // A quantization palette can contain the same RGB value more than once
  // -- e.g. K-Means asked for more colors than the image actually has ends
  // up with duplicate cluster centers. Without deduping, every cell of a
  // repeated color would get drawn once per palette slot that shares it,
  // breaking the "every cell belongs to exactly one layer" guarantee this
  // export exists for (a laser cutter/vinyl cutter would cut those cells
  // twice). Keep only the first palette index for each distinct color.
  const seenRgb = new Set();
  let layerCount = 0;
  palette.forEach((rgb, i) => {
    const hexcode = rgbToHex(rgb);
    if (seenRgb.has(hexcode)) return;
    seenRgb.add(hexcode);

    const cells = [];
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const cell = grid[row * gridW + col];
        if (rgbToHex(cell) === hexcode) cells.push([row, col]);
      }
    }
    if (cells.length === 0) return;
    layerCount++;
    const name = names[i] || "";
    lines.push(
      `  <g id="color-${i + 1}" fill="${hexcode}" data-hex="${hexcode}" ` +
      `data-name="${svgEscape(name)}" data-count="${cells.length}">`);
    for (const [row, col] of cells) {
      lines.push("    " + svgCellShape(shape, row, col, cellSize, circleInterlock, diamondInterlock));
    }
    lines.push("  </g>");
  });

  lines.push("</svg>");
  return { svg: lines.join("\n") + "\n", layerCount };
}
