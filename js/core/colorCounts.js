/**
 * colorCounts.js
 * Count how many cells of a grid use each palette color -- always reports
 * against the full palette (0 for absent colors) so numbering/names line
 * up whether called on a whole mosaic or a single panel slice of it.
 * Ported from mosaic_core.py's color_counts.
 */

import { rgbToHex } from "./color.js";

/** grid: flat array of [r,g,b]. palette: array of [r,g,b]. names: optional
 *  array of strings, same length as palette. */
export function colorCounts(grid, palette, names = []) {
  const counts = new Array(palette.length).fill(0);
  const paletteKeys = palette.map(rgbToHex);
  const keyToIdx = new Map(paletteKeys.map((k, i) => [k, i]));

  for (const [r, g, b] of grid) {
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
