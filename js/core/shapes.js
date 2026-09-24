/**
 * shapes.js
 * Hexagon and interlocked-circle layout geometry (corners, output sizing,
 * click hit-testing). Ported from mosaic_core.py's hexagon/circle-interlock
 * branches of render_mosaic and mosaic_gui.py's _hex_hit_test /
 * _circle_interlock_hit_test -- same formulas, so a click maps to the exact
 * same cell the render placed there.
 */

// Flat-top hexagon center-to-corner radius, as a fraction of cellSize.
// Shared by estimateOutputDimensions, hexHitTest, and
// shapeColumnWidthFactor/interlockRowHeightFactor (and render.js's own
// copy) so they all stay in lockstep -- see render.js's hexagon branch for
// the geometry.
export const HEX_SIZE_RATIO = 0.58;

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

/** rowH / cellSize for the given shape+interlock combination -- 1 for a
 *  plain grid (rows spaced a full cell apart), less than 1 when
 *  interlocking packs rows closer together.
 *
 *  Circle interlock (nested like coins/rivets) uses the classic
 *  hexagonal-packing row height of sqrt(3)/2 (~0.866) of a cell. Diamond
 *  interlock packs rows at *half* a cell (0.5): a diamond is a square
 *  rotated 45 degrees, so offsetting alternating rows by half a cell both
 *  ways makes each diamond's corner meet its neighbors' corners exactly,
 *  tiling edge-to-edge with no gaps (the classic argyle/harlequin lattice)
 *  -- tighter packing than circles ever achieve, since circles can't fully
 *  close the gaps between them the way diamonds can.
 *
 *  Hexagon always packs in its own honeycomb lattice -- there's no
 *  separate interlock toggle for it, `interlock` is ignored for this
 *  shape -- with a row height of sqrt(3) * HEX_SIZE_RATIO (~1.004) of a
 *  cell; see shapeColumnWidthFactor for hexagon's column-width side of the
 *  same geometry.
 *
 *  Used both to size the rendered output (estimateOutputDimensions,
 *  renderMosaic) and, in app.js, to work out how many grid rows are needed
 *  to keep the *output image* at the source photo's aspect ratio once
 *  interlocking (or, for hexagon, its fixed honeycomb packing) changes
 *  each row's vertical spacing. */
export function interlockRowHeightFactor(shape, interlock) {
  if (shape === "hexagon") return Math.sqrt(3) * HEX_SIZE_RATIO;
  if (shape === "circle" && interlock) return Math.sqrt(3) / 2;
  if (shape === "diamond" && interlock) return 0.5;
  return 1;
}

/** colW / cellSize for the given shape -- 1 for every shape except
 *  hexagon. Circle/diamond interlock only ever change *row* spacing (see
 *  interlockRowHeightFactor); hexagon's flat-top honeycomb lattice is the
 *  only layout that also narrows the *column* spacing, to
 *  1.5 * HEX_SIZE_RATIO (~0.87) of a cell (see render.js's hexagon
 *  branch).
 *
 *  Paired with interlockRowHeightFactor in app.js's aspect-lock
 *  calculation (syncHeightToAspect) so hexagon's narrower columns are
 *  accounted for alongside its taller rows, instead of only the row side
 *  getting adjusted the way circle/diamond interlock do. */
export function shapeColumnWidthFactor(shape) {
  if (shape === "hexagon") return 1.5 * HEX_SIZE_RATIO;
  return 1;
}

/** [width, height] in px that renderMosaic will produce for these settings.
 *  circleInterlock only matters when shape === "circle";
 *  diamondInterlock only matters when shape === "diamond". */
export function estimateOutputDimensions(gridW, gridH, shape, cellSize,
                                          circleInterlock = false, diamondInterlock = false) {
  if (shape === "hexagon") {
    // Flat-top hexagons: columns get the bigger spacing (1.5x size) and
    // alternating *columns* are offset vertically by half a row -- see
    // render.js's hexagon branch for the full explanation.
    const hexSize = cellSize * HEX_SIZE_RATIO;
    const colW = 1.5 * hexSize;
    const rowH = Math.sqrt(3) * hexSize;
    return [
      Math.floor(colW * (gridW + 0.5) + cellSize),
      Math.floor(rowH * (gridH + 0.5) + cellSize),
    ];
  }
  const interlock = (shape === "circle" && circleInterlock) || (shape === "diamond" && diamondInterlock);
  if (interlock) {
    const rowH = cellSize * interlockRowHeightFactor(shape, true);
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
  const hexSize = cellSize * HEX_SIZE_RATIO;
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

/** Find the (row, col) of the interlocked diamond nearest (x, y). Same
 *  windowed nearest-neighbor approach as circleInterlockHitTest, mirroring
 *  the desktop app's _diamond_interlock_hit_test. Only used when
 *  shape === "diamond" and diamondInterlock is on. */
export function diamondInterlockHitTest(x, y, gridW, gridH, cellSize) {
  const colW = cellSize;
  const rowH = cellSize * interlockRowHeightFactor("diamond", true);

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
