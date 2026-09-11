/**
 * shapes.js
 * Hexagon layout geometry (corners, output sizing, click hit-testing).
 * Ported from mosaic_core.py's hexagon branch of render_mosaic and
 * mosaic_gui.py's _hex_hit_test -- same formulas, so a click maps to the
 * exact same cell the render placed there.
 */

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}

/** [width, height] in px that renderMosaic will produce for these settings. */
export function estimateOutputDimensions(gridW, gridH, shape, cellSize) {
  if (shape === "hexagon") {
    const hexSize = cellSize * 0.58;
    const hexW = Math.sqrt(3) * hexSize;
    const hexH = 1.5 * hexSize;
    return [
      Math.floor(hexW * (gridW + 0.5) + cellSize),
      Math.floor(hexH * gridH + cellSize),
    ];
  }
  return [gridW * cellSize, gridH * cellSize];
}

/** Find the (row, col) of the hexagon nearest (x, y). Mirrors the desktop
 *  app's windowed nearest-neighbor search (verified equivalent to a full
 *  brute-force search over the whole grid). Uses Math.trunc (not
 *  Math.floor) to match Python's int() truncate-toward-zero semantics --
 *  they differ for negative approxRow/approxCol near the top/left edges,
 *  which otherwise silently narrows the search window and misses the
 *  true nearest hexagon there. */
export function hexHitTest(x, y, gridW, gridH, cellSize) {
  const hexSize = cellSize * 0.58;
  const hexW = Math.sqrt(3) * hexSize;
  const hexH = 1.5 * hexSize;

  const approxRow = (y - cellSize / 2) / hexH;
  const approxRowT = Math.trunc(approxRow);
  const rowStart = Math.max(0, approxRowT - 1);
  const rowEnd = Math.min(gridH - 1, approxRowT + 1);

  let best = null, bestDist = Infinity;
  for (let row = rowStart; row <= rowEnd; row++) {
    const rowOffset = row % 2 === 1 ? hexW / 2 : 0;
    const approxCol = (x - cellSize / 2 - rowOffset) / hexW;
    const approxColT = Math.trunc(approxCol);
    const colStart = Math.max(0, approxColT - 1);
    const colEnd = Math.min(gridW - 1, approxColT + 1);
    for (let col = colStart; col <= colEnd; col++) {
      const cx = hexW * col + rowOffset + cellSize / 2;
      const cy = hexH * row + cellSize / 2;
      const dist = (cx - x) ** 2 + (cy - y) ** 2;
      if (dist < bestDist) { bestDist = dist; best = [row, col]; }
    }
  }
  return best;
}
