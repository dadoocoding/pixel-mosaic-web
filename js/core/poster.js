/**
 * poster.js
 * Multi-page poster export -- splits the full-resolution rendered mosaic
 * across several sheets of ordinary paper, printable at "actual size"
 * (100%, no printer scaling) so that taping the pages together reproduces
 * the mosaic at exactly the real-world size the Piece Size field already
 * describes. Rather than a separate DPI/scale input, the print DPI is
 * *derived* from Piece Size (dpi = image_px_width / (gridW * pieceSize)),
 * so the poster is always WYSIWYG with the on-screen preview -- no
 * re-rendering or extra settings to keep in sync. Ported from
 * mosaic_core.py's render_poster_pages (same math, same page-tiling
 * convention, same page-count/DPI safety caps).
 */

// [widthIn, heightIn], portrait orientation.
export const POSTER_PAPER_SIZES = {
  Letter: [8.5, 11.0],
  A4: [8.27, 11.69],
};

// Defensive cap on the page grid a poster export will produce -- a tiny
// piece size (e.g. a few mm) combined with a large grid could otherwise
// imply an enormous, slow-to-render, unusable PDF.
const POSTER_MAX_PAGES = 300;

function pageCount(total, printable, stride) {
  if (total <= printable) return 1;
  return Math.ceil((total - printable) / stride) + 1;
}

/**
 * Split `canvas` (the full-resolution rendered mosaic) into a grid of
 * overlapping print-ready pages sized to `paperSize`.
 *
 * Each page after the first re-shows `overlapIn` of the previous page's
 * edge, so pages can be aligned/trimmed when taping them together. A thin
 * border and a small "Row R, Col C" label are drawn in each page's margin
 * for assembly reference.
 *
 * Returns { pages, cols, rows, dpi }: `pages` is an array of canvases (one
 * per printed sheet, in reading order -- left-to-right, top-to-bottom),
 * `cols` x `rows` is the page grid (so a caller can report e.g. "6 pages
 * (3 x 2)"), and `dpi` is the resolution each page must be embedded at for
 * the poster to come out true to size.
 *
 * Throws an Error (with a user-facing message) if pieceSize isn't a usable
 * positive number, if there's nothing generated yet (canvas/grid has no
 * real size), or if the implied page count or DPI is unreasonably large.
 */
export function renderPosterPages(canvas, gridW, gridH, pieceSize, unit, paperSize,
                                   createCanvasFn, options = {}) {
  const { marginIn = 0.25, overlapIn = 0.3 } = options;

  if (!(pieceSize > 0)) {
    throw new Error("Set a piece size before exporting a poster.");
  }
  if (!(gridW > 0) || !(gridH > 0) || !canvas || !canvas.width || !canvas.height) {
    throw new Error("Generate a mosaic before exporting a poster.");
  }

  const unitToIn = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54 };
  const pieceSizeIn = pieceSize * (unitToIn[unit] ?? 1);
  const totalWIn = gridW * pieceSizeIn;
  // Derive the DPI (and from it, the poster's total height) from the
  // canvas's own pixel size and aspect ratio, rather than computing
  // totalHIn as a separate gridH * pieceSizeIn -- a few layouts (hexagon,
  // the circle/diamond interlock packings) don't render at an exact
  // gridH x pieceSize pixel height, so this keeps the poster's proportions
  // matching what's actually on screen.
  const dpi = canvas.width / totalWIn;
  if (dpi > 2400) {
    throw new Error(
      `That piece size implies an unreasonably high print resolution (${Math.round(dpi)} DPI) ` +
      "for this image -- increase the piece size, or increase the mosaic's cell size " +
      "(output resolution), and try again.");
  }
  const totalHIn = canvas.height / dpi;

  const [paperWIn, paperHIn] = POSTER_PAPER_SIZES[paperSize] || POSTER_PAPER_SIZES.Letter;
  const printableWIn = Math.max(1.0, paperWIn - 2 * marginIn);
  const printableHIn = Math.max(1.0, paperHIn - 2 * marginIn);
  const strideWIn = Math.max(0.5, printableWIn - overlapIn);
  const strideHIn = Math.max(0.5, printableHIn - overlapIn);

  const cols = pageCount(totalWIn, printableWIn, strideWIn);
  const rows = pageCount(totalHIn, printableHIn, strideHIn);
  if (cols * rows > POSTER_MAX_PAGES) {
    throw new Error(
      `That would print as ${cols * rows} pages (${cols} x ${rows}) -- increase the piece ` +
      "size, or use a smaller grid/cell size, to bring the poster down to a manageable page count.");
  }

  const paperWPx = Math.round(paperWIn * dpi);
  const paperHPx = Math.round(paperHIn * dpi);
  const marginPx = Math.round(marginIn * dpi);
  const printableWPx = Math.round(printableWIn * dpi);
  const printableHPx = Math.round(printableHIn * dpi);
  const strideWPx = Math.round(strideWIn * dpi);
  const strideHPx = Math.round(strideHIn * dpi);
  const fontPx = Math.max(10, Math.round(dpi * 0.11));

  const pages = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Clamp each tile's source origin so the last row/column reads right
      // up to the canvas's edge instead of running off it (the last
      // page's overlap with its neighbor shrinks slightly rather than the
      // page showing blank space).
      const srcX0 = Math.min(col * strideWPx, Math.max(0, canvas.width - printableWPx));
      const srcY0 = Math.min(row * strideHPx, Math.max(0, canvas.height - printableHPx));
      const srcX1 = Math.min(canvas.width, srcX0 + printableWPx);
      const srcY1 = Math.min(canvas.height, srcY0 + printableHPx);
      const tileW = srcX1 - srcX0, tileH = srcY1 - srcY0;

      const page = createCanvasFn(paperWPx, paperHPx);
      const ctx = page.getContext("2d");
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.fillRect(0, 0, paperWPx, paperHPx);
      ctx.drawImage(canvas, srcX0, srcY0, tileW, tileH, marginPx, marginPx, tileW, tileH);

      ctx.strokeStyle = "rgb(180,180,180)";
      ctx.lineWidth = 1;
      ctx.strokeRect(marginPx + 0.5, marginPx + 0.5, tileW - 1, tileH - 1);

      ctx.fillStyle = "rgb(140,140,140)";
      ctx.font = `${fontPx}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const label = `Row ${row + 1}, Col ${col + 1}  (of ${rows} x ${cols})`;
      const labelY = Math.max(fontPx, marginPx - 2);
      ctx.fillText(label, marginPx, labelY);

      pages.push(page);
    }
  }

  return { pages, cols, rows, dpi };
}
