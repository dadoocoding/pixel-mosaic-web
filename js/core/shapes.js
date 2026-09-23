/**
 * shapes.js
 * Hexagon and interlocked-circle layout geometry (corners, output sizing,
 * click hit-testing). Ported from mosaic_core.py's hexagon/circle-interlock
 * branches of render_mosaic and mosaic_gui.py's _hex_hit_test /
 * _circle_interlock_hit_test -- same formulas, so a click maps to the exact
 * same cell the render placed there.
 */

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}

/** Corners of a square rotated 45 degrees (a diamond), inscribed in the
 *  cell box (x0, y0, x1, y1) inset by pad on every side. */
export function diamondCorners(x0, y0, x1, y1, pad) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ix0 = x0 + pad, iy0 = y0 + pad, ix1 = x1 - pad, iy1 = y1 - pad;
  return [[cx, iy0], [ix1, cy], [cx, iy1], [ix0, cy]];
}

/** [width, height] in px that renderMosaic will produce for these settings.
 *  circleInterlock only matters when shape === "circle". */
export function estimateOutputDimensions(gridW, gridH, shape, cellSize, circleInterlock = false) {
  if (shape === "hexagon") {
    // Flat-top hexagons: columns get the bigger spacing (1.5x size) and
    // alternating *columns* are offset vertically by half a row -- see
    // render.js's hexagon branch for the full explanation.
    const hexSize = cellSize * 0.58;
    const colW = 1.5 * hexSize;
    const rowH = Math.sqrt(3) * hexSize;
    return [
      Math.floor(colW * (gridW + 0.5) + cellSize),
      Math.floor(rowH * (gridH + 0.5) + cellSize),
    ];
  }
  if (shape === "circle" && circleInterlock) {
    const rowH = cellSize * (Math.sqrt(3) / 2);
    const imgW = Math.floor(cellSize * gridW + cellSize / 2);
    const imgH = gridH > 0 ? Math.floor(rowH * (gridH - 1) + cellSize) : cellSize;
    return [imgW, imgH];
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
  const colW = 1.5 * hexSize;
  const rowH = Math.sqrt(3) * hexSize;

  const approxCol = (x - cellSize / 2) / colW;
  const approxColT = Math.trunc(approxCol);
  const colStart = Math.max(0, approxColT - 1);
  const colEnd = Math.min(gridW - 1, approxColT + 1);

  let best = null, bestDist = Infinity;
  for (let col = colStart; col <= colEnd; col++) {
    const colOffset = col % 2 === 1 ? rowH / 2 : 0;
    const approxRow = (y - cellSize / 2 - colOffset) / rowH;
    const approxRowT = Math.trunc(approxRow);
    const rowStart = Math.max(0, approxRowT - 1);
    const rowEnd = Math.min(gridH - 1, approxRowT + 1);
    for (let row = rowStart; row <= rowEnd; row++) {
      const cx = colW * col + cellSize / 2;
      const cy = rowH * row + colOffset + cellSize / 2;
      const dist = (cx - x) ** 2 + (cy - y) ** 2;
      if (dist < bestDist) { bestDist = dist; best = [row, col]; }
    }
  }
  return best;
}

/** Find the (row, col) of the interlocked circle nearest (x, y). Same
 *  windowed nearest-neighbor approach as hexHitTest, mirroring the desktop
 *  app's _circle_interlock_hit_test. Only used when shape === "circle" and
 *  circleInterlock is on -- the plain stacked-grid case still uses simple
 *  division in app.js/mosaic_gui.py. */
export function circleInterlockHitTest(x, y, gridW, gridH, cellSize) {
  const colW = cellSize;
  const rowH = cellSize * (Math.sqrt(3) / 2);

  const approxRow = (y - cellSize / 2) / rowH;
  const approxRowT = Math.trunc(approxRow);
  const rowStart = Math.max(0, approxRowT - 1);
  const rowEnd = Math.min(gridH - 1, approxRowT + 1);

  let best = null, bestDist = Infinity;
  for (let row = rowStart; row <= rowEnd; row++) {
    const rowOffset = row % 2 === 1 ? colW / 2 : 0;
    const approxCol = (x - cellSize / 2 - rowOffset) / colW;
    const approxColT = Math.trunc(approxCol);
    const colStart = Math.max(0, approxColT - 1);
    const colEnd = Math.min(gridW - 1, approxColT + 1);
    for (let col = colStart; col <= colEnd; col++) {
      const cx = colW * col + rowOffset + cellSize / 2;
      const cy = rowH * row + cellSize / 2;
      const dist = (cx - x) ** 2 + (cy - y) ** 2;
      if (dist < bestDist) { bestDist = dist; best = [row, col]; }
    }
  }
  return best;
}
