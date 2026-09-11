/**
 * bricks.js
 * Greedily merge adjacent same-color cells into larger rectangular
 * footprints (fewer, bigger physical pieces) -- e.g. real LEGO plates.
 * Ported from mosaic_core.py's compute_brick_layout / brick_counts.
 */

import { rgbToHex } from "./color.js";

export const LEGO_BRICK_SIZES = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8],
  [2, 2], [2, 3], [2, 4], [2, 6], [2, 8],
  [4, 4], [4, 6], [4, 8],
  [6, 6], [8, 8],
];

export function footprintLabel(w, h) {
  return `${w}x${h}`;
}

export function footprintKey(w, h) {
  const [lo, hi] = [w, h].sort((a, b) => a - b);
  return `${lo}x${hi}`;
}

/**
 * quantizedGrid: flat array of [r,g,b], row-major, length gridW*gridH.
 * allowedSizes: array of [w, h] pairs (grid cells). Both orientations of
 * each size are tried automatically. 1x1 is always available as a final
 * fallback, so every cell gets covered even if (1,1) isn't in allowedSizes.
 * Returns a list of { row, col, width, height, rgb }.
 */
export function computeBrickLayout(quantizedGrid, gridW, gridH, allowedSizes) {
  const covered = new Uint8Array(gridW * gridH);
  const at = (row, col) => quantizedGrid[row * gridW + col];

  const candSet = new Map(); // key "wxh" -> [w,h], de-duplicated
  for (const [bw, bh] of allowedSizes) {
    if (bw >= 1 && bh >= 1) {
      candSet.set(`${bw}x${bh}`, [bw, bh]);
      candSet.set(`${bh}x${bw}`, [bh, bw]);
    }
  }
  candSet.delete("1x1");
  const candidates = Array.from(candSet.values())
    .sort((a, b) => (b[0] * b[1] - a[0] * a[1]) || (Math.max(...b) - Math.max(...a)));

  const bricks = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      if (covered[row * gridW + col]) continue;
      const color = at(row, col);
      let placed = false;

      for (const [bw, bh] of candidates) {
        const rEnd = row + bh, cEnd = col + bw;
        if (rEnd > gridH || cEnd > gridW) continue;

        let fits = true;
        outer:
        for (let r = row; r < rEnd; r++) {
          for (let c = col; c < cEnd; c++) {
            if (covered[r * gridW + c]) { fits = false; break outer; }
            const px = at(r, c);
            if (px[0] !== color[0] || px[1] !== color[1] || px[2] !== color[2]) {
              fits = false;
              break outer;
            }
          }
        }
        if (!fits) continue;

        for (let r = row; r < rEnd; r++) {
          for (let c = col; c < cEnd; c++) covered[r * gridW + c] = 1;
        }
        bricks.push({ row, col, width: bw, height: bh, rgb: color });
        placed = true;
        break;
      }

      if (!placed) {
        covered[row * gridW + col] = 1;
        bricks.push({ row, col, width: 1, height: 1, rgb: color });
      }
    }
  }
  return bricks;
}

/** Orientation-independent "how many of each physical piece to buy" list. */
export function brickCounts(bricks, palette = null, names = []) {
  const nameLookup = new Map();
  if (palette) {
    palette.forEach((rgb, i) => {
      if (names[i]) nameLookup.set(rgbToHex(rgb), names[i]);
    });
  }

  const tally = new Map();
  for (const b of bricks) {
    const key = footprintKey(b.width, b.height) + "|" + rgbToHex(b.rgb);
    const entry = tally.get(key);
    if (entry) entry.count++;
    else tally.set(key, {
      footprint: footprintKey(b.width, b.height),
      hex: rgbToHex(b.rgb), rgb: b.rgb,
      name: nameLookup.get(rgbToHex(b.rgb)) || "",
      count: 1,
    });
  }

  const result = Array.from(tally.values());
  result.sort((a, b) => {
    const [aw, ah] = a.footprint.split("x").map(Number);
    const [bw, bh] = b.footprint.split("x").map(Number);
    return (bw * bh - aw * ah) || (b.count - a.count);
  });
  return result;
}
