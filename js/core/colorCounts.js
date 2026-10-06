/**
 * colorCounts.js
 * Count how many cells of a grid use each palette color -- always reports
 * against the full palette (0 for absent colors) so numbering/names line
 * up whether called on a whole mosaic or a single panel slice of it.
 * Ported from mosaic_core.py's color_counts.
 */

import { rgbToHex } from "./color.js";

/** grid: flat array of [r,g,b]. palette: array of [r,g,b]. names: optional
 *  array of strings, same length as palette. mask: optional Uint8Array the
 *  same length as grid -- cells with mask 0 are omitted from the build
 *  (Crop & Shape oval/circle) and not counted. */
export function colorCounts(grid, palette, names = [], mask = null) {
  const counts = new Array(palette.length).fill(0);
  const paletteKeys = palette.map(rgbToHex);
  const keyToIdx = new Map(paletteKeys.map((k, i) => [k, i]));

  for (let i = 0; i < grid.length; i++) {
    if (mask && !mask[i]) continue;
    const [r, g, b] = grid[i];
    const key = rgbToHex([r, g, b]);
    const idx = keyToIdx.get(key);
    if (idx !== undefined) counts[idx]++;
  }

  return palette.map((rgb, i) => ({
    hex: paletteKeys[i],
    rgb,
    name: names[i] || "",
    count: counts[i],
  }));
}
