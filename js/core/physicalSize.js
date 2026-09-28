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

/** Format a lithophane print's real-world size -- a single continuous
 * object, not a countW x countH grid of pieces, so this takes the
 * finished width/height/thickness directly rather than multiplying a
 * piece size out the way formatPhysicalSize does. Always in mm (the
 * universal 3D-printing unit), with width x height also shown in inches
 * for reference. Returns "" if any dimension is non-positive. Ported from
 * mosaic_core.py's format_lithophane_size. */
export function formatLithophaneSize(widthMm, heightMm, maxThicknessMm) {
  if (!(widthMm > 0) || !(heightMm > 0) || !(maxThicknessMm > 0)) return "";
  const widthIn = widthMm / 25.4;
  const heightIn = heightMm / 25.4;
  return `${formatNumber(widthMm)} × ${formatNumber(heightMm)} mm `
    + `(${formatNumber(widthIn)} × ${formatNumber(heightIn)} in), `
    + `up to ${formatNumber(maxThicknessMm)}mm thick`;
}

/** Rough seconds-per-piece hands-on assembly time, one entry per physical
 * layout mode that has a real one-piece-at-a-time build step -- dipping a
 * brush, placing a pre-made die, twisting a cube face, threading a stitch,
 * gluing a found object. This is a ballpark for planning purposes, the
 * same spirit as cross-stitch's stitchesPerSkein default: treat it as a
 * rough estimate, not a stopwatch-measured constant. Modes not listed
 * here (Adaptive, Meta, and the brick/LEGO piece-merge step, whose real
 * piece count and per-piece action differ too much from a flat per-cell
 * rate) don't get a time estimate at all. Ported from mosaic_core.py's
 * ASSEMBLY_SECONDS_PER_PIECE -- keep the two in sync. */
export const ASSEMBLY_SECONDS_PER_PIECE = {
  classic: 20,      // paint-by-number: dip brush, paint one cell
  dice: 8,           // place one pre-made die, no orientation needed
  rubiks: 90,         // twist/orient a whole cube to match its 9 stickers
  crossstitch: 30,   // one hand-sewn cross stitch
  foundobject: 15,   // glue/place one found object
  stainedglass: 45,   // cut/fit an irregular piece, then set it in lead/grout
};

/** Format a rough hands-on build-time estimate for pieceCount physical
 * pieces at about secondsPerPiece each -- e.g.
 * formatAssemblyTime(400, 20) -> "~2.2 hours". This is a ballpark for
 * planning purposes only (breaks, mistakes, and setup aren't counted),
 * never a promise -- callers should label it as a rough estimate. Returns
 * "" for a non-positive piece count or rate. Ported from
 * mosaic_core.py's format_assembly_time. */
export function formatAssemblyTime(pieceCount, secondsPerPiece) {
  if (!(pieceCount > 0) || !(secondsPerPiece > 0)) return "";
  const totalSeconds = pieceCount * secondsPerPiece;
  if (totalSeconds < 3600) {
    // Half-up rounding (never JS's occasional float-edge surprises from
    // Math.round), matching Python's floor(x*N+0.5)/N trick exactly.
    const minutes = Math.max(1, Math.floor(totalSeconds / 60 + 0.5));
    return `~${minutes} min`;
  }
  const hours = totalSeconds / 3600;
  const hoursRounded = Math.floor(hours * 10 + 0.5) / 10;
  const unit = hoursRounded === 1 ? "hour" : "hours";
  return `~${formatNumber(hoursRounded)} ${unit}`;
}
