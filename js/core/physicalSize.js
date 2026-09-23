/**
 * physicalSize.js
 * "Piece size" -- purely informational, real-world size of the finished
 * object if built as a physical piece for every grid cell (or, for
 * Rubik's Cube mode, one whole cube). Has no effect on rendering. Ported
 * from mosaic_core.py's format_physical_size (same formatting, same
 * feet-and-inches breakdown for large inch measurements).
 */

export const PIECE_SIZE_UNITS = ["in", "mm", "cm"];

/** Trim a number to at most 2 decimal places, dropping trailing zeros (and
 *  a trailing decimal point) -- 20 -> "20", 15.5 -> "15.5". */
function formatNumber(n) {
  const s = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

/** 20.5 -> `1'8.5"` -- used to give large inch measurements a more
 *  readable feet-and-inches form alongside the raw inch total. */
function formatFeetInches(totalInches) {
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return `${feet}'${formatNumber(inches)}"`;
}

/** Format the real-world size of a countW x countH grid of physical
 * pieces, each pieceSize `unit` (see PIECE_SIZE_UNITS) across, as a
 * human-readable string -- e.g. formatPhysicalSize(20, 15, 1, "in") ->
 * `20 × 15 in (1'8" × 1'3")`. Returns "" for a non-positive piece size
 * (nothing to show) or a non-positive grid (nothing built yet).
 *
 * This only multiplies out the *count* of pieces across each axis by the
 * piece size -- it doesn't care whether individual pieces get merged into
 * bigger visual groups downstream (e.g. Adaptive mode's leaves, or a
 * brick layout), so the same formula is correct for every mode: the
 * finished object is always countW x countH pieces across, wide. */
export function formatPhysicalSize(countW, countH, pieceSize, unit) {
  if (!(pieceSize > 0) || !(countW > 0) || !(countH > 0)) return "";
  const totalW = countW * pieceSize;
  const totalH = countH * pieceSize;
  const u = PIECE_SIZE_UNITS.includes(unit) ? unit : "in";

  let text = `${formatNumber(totalW)} × ${formatNumber(totalH)} ${u}`;
  if (u === "in" && (totalW >= 12 || totalH >= 12)) {
    text += `  (${formatFeetInches(totalW)} × ${formatFeetInches(totalH)})`;
  }
  return text;
}
