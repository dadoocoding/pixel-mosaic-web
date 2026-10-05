/**
 * leadedglass.js
 * Traditional leaded/stained-glass windows: a square or arch-topped frame
 * (pointed Gothic or rounded Romanesque), filled by one of three selectable
 * generation approaches (LEADEDGLASS_GENERATION_MODES):
 *
 *   boldPieces      Tile Mosaic's own Poisson-disc + Voronoi pipeline
 *                    (stainedglass.js), reused directly, just recalibrated
 *                    to a much lower piece count for bigger, calmer panes,
 *                    and constrained to the chosen frame's silhouette.
 *   panelGrid       An evenly spaced grid of 45-degree "quarry" diamond
 *                    panes -- the single most iconic traditional
 *                    leaded-window motif.
 *   latticeSubject  A low-piece-count Voronoi zone for a bold subject,
 *                    inscribed in a centered ellipse, surrounded by a
 *                    radiating sunburst of ring/wedge panes reusing
 *                    Radial mode's ring-count math (radial.js).
 *
 * All three sit inside the same frame shape and share the same two
 * building blocks: leadedglassInsideFrame (the arch silhouette test) and
 * renderLeadedglassFromOwner (a single owner-index-array renderer that
 * draws piece-to-piece leading AND the frame's own outer border in one
 * unified boundary-detection pass, by treating "outside the frame" as just
 * another distinct owner value). Ported from mosaic_core.py's Leaded Glass
 * section -- same formulas, same function split, op for op where it
 * matters for parity (the frame-shape math and the Poisson-disc's
 * boundsTest-gated point placement); the nearest-seed lookup and the
 * ring/diamond owner assignment used for sampling/rendering, like Tile
 * Mosaic's own Voronoi lookup, don't need to match bit-for-bit, only by
 * tolerance (see stainedglass.js's module docstring for why).
 */

import {
  poissonDiscPoints, poissonDiscPointsVariable, buildSeedIndex, nearestSeed, dilateCross,
  sampleStainedglassColors, stainedglassCanvasSize, estimateStainedglassPieceCount,
  STAINEDGLASS_PACKING_FACTOR, makeMulberry32,
} from "./stainedglass.js";
import { radialRingSegments, radialCellCount } from "./radial.js";

export const LEADEDGLASS_FRAME_SHAPES = ["rect", "pointed", "rounded"];
export const LEADEDGLASS_FRAME_SHAPE_LABELS = {
  rect: "Rectangle",
  pointed: "Pointed arch",
  rounded: "Rounded arch",
};

export const LEADEDGLASS_GENERATION_MODES = ["lattice_subject", "bold_pieces", "panel_grid"];
export const LEADEDGLASS_GENERATION_MODE_LABELS = {
  lattice_subject: "Geometric lattice + bold subject",
  bold_pieces: "Bigger, calmer organic pieces",
  panel_grid: "Traditional panel grid",
};

// Deliberately much lower than Tile Mosaic's/Radial's 20,000-cell headroom
// -- see mosaic_core.py's LEADEDGLASS_MAX_CELLS for why.
export const LEADEDGLASS_MAX_CELLS = 4000;

export const LEADEDGLASS_MIN_PIECES = 6;
export const LEADEDGLASS_MAX_PIECES = 150;
export const LEADEDGLASS_DEFAULT_PIECES = 40;

export const LEADEDGLASS_MIN_DIST = 10.0;
export const LEADEDGLASS_MAX_DIST = 150.0;
export const LEADEDGLASS_DEFAULT_DIST = 40.0;

// Decorative border (Bold Pieces + "rect" frame shape only -- see
// generateLeadedglassMosaic-equivalent wiring in app.js's
// generateLeadedglassMosaic). Ported from mosaic_core.py's
// LEADEDGLASS_BORDER_* constants.
export const LEADEDGLASS_BORDER_WIDTH_FRACTION = 0.09;
export const LEADEDGLASS_BORDER_MIN_WIDTH = 8;
export const LEADEDGLASS_BORDER_MAX_WIDTH = 80;
export const LEADEDGLASS_BORDER_DEFAULT_COLOR = [200, 140, 60];
export const LEADEDGLASS_BORDER_DEFAULT_ACCENT_COLOR = [150, 40, 40];
export const LEADEDGLASS_BORDER_TILE_JITTER = 14; // +/- per RGB channel -- a hand-mixed-glass look, not flat plastic

export const LEADEDGLASS_SUBJECT_RX_FRACTION = 0.36;
export const LEADEDGLASS_SUBJECT_RY_FRACTION = 0.40;

export const LEADEDGLASS_MIN_SUBJECT_PIECES = 6;
export const LEADEDGLASS_MAX_SUBJECT_PIECES = 60;
export const LEADEDGLASS_DEFAULT_SUBJECT_PIECES = 16;

export const LEADEDGLASS_MIN_SUNBURST_RINGS = 2;
export const LEADEDGLASS_MAX_SUNBURST_RINGS = 10;
export const LEADEDGLASS_DEFAULT_SUNBURST_RINGS = 4;

export const LEADEDGLASS_MIN_SUNBURST_WEDGES = 6;
export const LEADEDGLASS_MAX_SUNBURST_WEDGES = 32;
export const LEADEDGLASS_DEFAULT_SUNBURST_WEDGES = 12;

export const LEADEDGLASS_MIN_BODY_WIDTH = 200;
export const LEADEDGLASS_MAX_BODY_WIDTH = 1200;
export const LEADEDGLASS_DEFAULT_BODY_WIDTH = 480;

export const LEADEDGLASS_MIN_GRID_CELL = 20;
export const LEADEDGLASS_MAX_GRID_CELL = 200;
export const LEADEDGLASS_DEFAULT_GRID_CELL = 60;

export const LEADEDGLASS_MIN_GRID_COLS = 4;
export const LEADEDGLASS_MAX_GRID_COLS = 60;
export const LEADEDGLASS_DEFAULT_GRID_COLS = 12;

// --- Frame shape -------------------------------------------------------

/** Extra height the arch cap adds above the plain rectangular body, for a
 * panel of the given width -- see mosaic_core.py's leadedglass_arch_height
 * for the derivation (apex at width*sqrt(3)/2 for a pointed Gothic arch,
 * width/2 for a rounded Romanesque one). */
export function leadedglassArchHeight(shape, width) {
  if (shape === "pointed") return width * Math.sqrt(3) / 2.0;
  if (shape === "rounded") return width / 2.0;
  return 0.0;
}

/** [canvasWidth, canvasHeight] for a panel of the given plain rectangular
 * body width/height, plus whatever arch cap the shape adds on top. Always
 * returns plain (rounded) integers -- every caller ultimately needs an
 * integer pixel canvas, and rounding once here means every downstream
 * sample/render/mask function can assume integer width/height. */
export function leadedglassFrameSize(shape, width, bodyHeight) {
  const canvasW = Math.round(width);
  const canvasH = Math.round(bodyHeight + leadedglassArchHeight(shape, width));
  return [canvasW, canvasH];
}

/** True if the point (x, y) -- canvas pixel coordinates, (0, 0) at the
 * top-left of the full width x height canvas -- lies within the panel's
 * silhouette. See mosaic_core.py's leadedglass_inside_frame for the full
 * derivation; ported op for op (same sqrt-only formulas, no trig). */
export function leadedglassInsideFrame(shape, x, y, width, height) {
  const archH = leadedglassArchHeight(shape, width);
  if (shape === "rect" || archH <= 0 || y >= archH) return true;
  const dy = archH - y;
  if (shape === "pointed") {
    const d = Math.max(x, width - x);
    if (d > width) return false;
    const cap = Math.sqrt(Math.max(0, width * width - d * d));
    return dy <= cap;
  } else if (shape === "rounded") {
    const r = width / 2.0;
    const d = x - r;
    if (Math.abs(d) > r) return false;
    const cap = Math.sqrt(Math.max(0, r * r - d * d));
    return dy <= cap;
  }
  return true;
}

// --- Color quantization default (Leaded Glass's own "no quantize" case) -

/**
 * Unlike Tile Mosaic/Radial (which reuse the shared K-Means quantize-auto
 * worker step the same way, but *want* a small shared palette -- that's
 * what makes their output a buildable set of physical tiles), Leaded
 * Glass pieces are meant to read as individually mixed stained glass:
 * real leaded windows use dozens of subtly different glass colors, not a
 * handful repeated everywhere. So here, "no explicit color count" means
 * "keep each piece's own sampled color" -- not "auto-pick a tiny shared
 * palette" the way quantize-auto's k=null/0 behaves for every other mode.
 * Returns { flat, palette, chosenN }: flat is colors rounded to integer
 * [r,g,b] (unchanged per-piece), palette is the deduped+sorted set of
 * distinct colors actually used, chosenN is palette.length. An explicit
 * numColors still goes through the normal K-Means quantize-auto worker
 * path unchanged (see app.js's generateLeadedglassMosaic) -- this
 * function only covers the n_colors<=0 case. Ported from
 * mosaic_core.py's quantize_leadedglass_colors (the n_colors is None/<=0
 * branch; pure round+dedupe+sort, no PRNG, so this needs to match Python
 * exactly, unlike this module's PRNG-seeded border-tile coloring).
 */
export function quantizeLeadedglassColorsDefault(colors) {
  const flat = colors.map(c => c.map(v => Math.round(v)));
  const seen = new Map();
  for (const c of flat) seen.set(`${c[0]},${c[1]},${c[2]}`, c);
  const palette = [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return { flat, palette, chosenN: palette.length };
}

// --- Shared owner-array renderer + color accumulator --------------------

/**
 * Shared low-level renderer for all three Leaded Glass sub-modes: every
 * canvas pixel is already assigned an owner cell index (or -1 for "no
 * piece here"), and this (1) masks every pixel outside the frame's
 * silhouette to the -1 sentinel too; (2) paints each owned pixel its
 * cell's color, and every -1 pixel bgColor; (3) runs the same
 * boundary-detection-and-dilate leading pass stainedglass.js's
 * renderStainedglassMosaic uses between adjacent pieces -- except here
 * "outside" is just another distinct owner value, so the very same pass
 * also draws the lead/came line along the frame's own outer silhouette,
 * for free, in one unified step. Ported from mosaic_core.py's
 * _render_leadedglass_from_owner.
 */
export function renderLeadedglassFromOwner(owner, colors, shape, width, height,
                                            leadWidth, leadColor, bgColor, createCanvasFn) {
  const canvas = createCanvasFn(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const inside = new Uint8Array(width * height);
  const maskedOwner = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const isIn = leadedglassInsideFrame(shape, x + 0.5, y + 0.5, width, height);
      inside[i] = isIn ? 1 : 0;
      maskedOwner[i] = isIn ? owner[i] : -1;
    }
  }

  let boundary = null;
  if (leadWidth > 0) {
    boundary = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const o = maskedOwner[i];
        if (x < width - 1 && maskedOwner[i + 1] !== o) { boundary[i] = 1; boundary[i + 1] = 1; }
        if (y < height - 1 && maskedOwner[i + width] !== o) { boundary[i] = 1; boundary[i + width] = 1; }
      }
    }
    const extraIterations = Math.max(0, leadWidth - 1);
    if (extraIterations > 0) {
      boundary = dilateCross(boundary, width, height, extraIterations);
    }
    // Keep the leading inside the frame silhouette only, so it never bleeds
    // leadColor out past the arch into the flat background.
    for (let i = 0; i < boundary.length; i++) {
      if (boundary[i] && !inside[i]) boundary[i] = 0;
    }
  }

  for (let i = 0; i < width * height; i++) {
    let r, g, b;
    if (boundary && boundary[i]) {
      [r, g, b] = leadColor;
    } else if (maskedOwner[i] >= 0) {
      [r, g, b] = colors[maskedOwner[i]];
    } else {
      [r, g, b] = bgColor;
    }
    data[i * 4] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Shared reducer for Panel Grid and Lattice + Subject's color sampling
 * (Bold Pieces reuses stainedglass.js's sampleStainedglassColors directly
 * instead, matching mosaic_core.py's own direct reuse there): loops every
 * source pixel, maps it into canvasW x canvasH space, asks
 * ownerForCanvasXY(cx, cy) which cell it belongs to (-1 for none), and
 * averages. A cell that got zero pixels falls back to the overall average,
 * matching every other mode's zero-pixel-cell convention. Ported from
 * mosaic_core.py's _accumulate_owner_colors, restructured for JS's
 * per-pixel-loop sampling style (no numpy vectorization to mirror here).
 */
export function accumulateOwnerColors(sourceCanvas, canvasW, canvasH, nCells, ownerForCanvasXY) {
  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  if (sw <= 0 || sh <= 0) {
    throw new Error("Image has no pixels to sample.");
  }
  const src = ctx.getImageData(0, 0, sw, sh).data;
  const sums = new Float64Array(nCells * 3);
  const counts = new Float64Array(nCells);
  let sumR = 0, sumG = 0, sumB = 0;

  for (let y = 0; y < sh; y++) {
    const cy = ((y + 0.5) / sh) * canvasH;
    for (let x = 0; x < sw; x++) {
      const cx = ((x + 0.5) / sw) * canvasW;
      const idx = ownerForCanvasXY(cx, cy);
      const srcIdx = (y * sw + x) * 4;
      const rr = src[srcIdx], gg = src[srcIdx + 1], bb = src[srcIdx + 2];
      sumR += rr; sumG += gg; sumB += bb;
      if (idx >= 0) {
        sums[idx * 3] += rr; sums[idx * 3 + 1] += gg; sums[idx * 3 + 2] += bb;
        counts[idx]++;
      }
    }
  }

  const totalPixels = sw * sh;
  const overallAvg = [sumR / totalPixels, sumG / totalPixels, sumB / totalPixels];
  const colors = new Array(nCells);
  for (let i = 0; i < nCells; i++) {
    colors[i] = counts[i] > 0
      ? [sums[i * 3] / counts[i], sums[i * 3 + 1] / counts[i], sums[i * 3 + 2] / counts[i]]
      : overallAvg;
  }
  return colors;
}

// --- Sub-mode: Bold Pieces (direct Poisson-disc/Voronoi reuse) ---------

/** [canvasW, canvasH] for the Bold Pieces sub-mode: the body is sized by
 * stainedglassCanvasSize's existing aspect-preserving piece-count formula
 * (direct, unchanged reuse), then the frame shape's arch cap (if any) is
 * added on top. */
export function leadedglassBoldPiecesCanvasSize(imageW, imageH, shape, targetCount, minDist) {
  const [bodyW, bodyH] = stainedglassCanvasSize(imageW, imageH, targetCount, minDist);
  return leadedglassFrameSize(shape, bodyW, bodyH);
}

// --- Bold Pieces piece-SIZE variation (density-adaptive Poisson-disc) ----
// Bold Pieces' piece SIZE varies with local image detail by default (see
// generateLeadedglassBoldPieces): sparse, big pieces in smooth flat-color
// areas (a clear sky), dense, small pieces in busy/textured/high-contrast
// ones (foliage, machinery, fine edges) -- the size/shape contrast a real
// leaded-glass window uses, rather than one uniform spacing everywhere.
// Ported from mosaic_core.py's leadedglass_bold_density_map /
// leadedglass_bold_min_dist_lookup. Like poissonDiscPointsVariable (see its
// docstring), this is NOT held to bit-identical cross-language parity: it
// uses a summed-area-table box filter in place of scipy.ndimage.
// uniform_filter, which is close but not numerically identical -- mainly at
// the image's edges, where scipy's mode="nearest" replicates the border
// pixel outward while this clamps the window to the valid region and
// divides by the smaller, truncated count instead. Only stylistic/
// statistical similarity is expected between the two languages' output.
export const LEADEDGLASS_BOLD_DENSITY_WINDOW = 9; // odd, px, box-filter window (image-pixel space) for local detail
export const LEADEDGLASS_BOLD_DENSITY_SMALL_FACTOR = 0.55; // busiest regions: spacing this fraction of the base
export const LEADEDGLASS_BOLD_DENSITY_BIG_FACTOR = 1.9;    // smoothest regions: spacing this multiple of the base

function leadedglassBoldPercentile(sortedArr, p) {
  const n = sortedArr.length;
  if (n === 0) return 0;
  if (n === 1) return sortedArr[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
}

/** Per-source-pixel [0, 1] "local detail" score used to vary Bold Pieces'
 * piece spacing -- near 0 in smooth, flat-color regions, near 1 in
 * busy/textured/high-contrast ones -- from a local-standard-deviation pass
 * over the image's luminance in a LEADEDGLASS_BOLD_DENSITY_WINDOW-px window,
 * normalized against a 5th/95th percentile range so a handful of extreme
 * pixels don't wash out the whole map. Computed once per generate, at the
 * source image's own resolution (not the output canvas's) so it isn't tied
 * to any particular piece count or frame shape. Returns { data, w, h } --
 * a flat Float64Array plus the grid it's shaped for. See
 * leadedglassBoldMinDistLookup for how this becomes actual per-point
 * spacing. */
export function leadedglassBoldDensityMap(sourceCanvas) {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const img = sourceCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  // ITU-R 601-2 luma, matching PIL's Image.convert("L").
  const gray = new Float64Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * img[p] + 0.587 * img[p + 1] + 0.114 * img[p + 2];
  }

  // Summed-area tables (integral images) of gray and gray^2, one row/col of
  // padding so a box sum is a plain 4-lookup difference -- JS has no
  // equivalent to scipy.ndimage.uniform_filter, so this stands in for it.
  const stride = w + 1;
  const sum = new Float64Array(stride * (h + 1));
  const sumSq = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      sum[(y + 1) * stride + (x + 1)] =
        sum[y * stride + (x + 1)] + sum[(y + 1) * stride + x] - sum[y * stride + x] + v;
      sumSq[(y + 1) * stride + (x + 1)] =
        sumSq[y * stride + (x + 1)] + sumSq[(y + 1) * stride + x] - sumSq[y * stride + x] + v * v;
    }
  }
  // Caller guarantees 0 <= x0 <= x1 <= w-1, 0 <= y0 <= y1 <= h-1 -- clamping
  // happens once, at the call site below.
  const boxSum = (table, x0, y0, x1, y1) =>
    table[(y1 + 1) * stride + (x1 + 1)] - table[y0 * stride + (x1 + 1)] -
    table[(y1 + 1) * stride + x0] + table[y0 * stride + x0];

  const half = Math.floor(LEADEDGLASS_BOLD_DENSITY_WINDOW / 2);
  const std = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const cy0 = Math.max(0, y - half), cy1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const cx0 = Math.max(0, x - half), cx1 = Math.min(w - 1, x + half);
      const count = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
      const mean = boxSum(sum, cx0, cy0, cx1, cy1) / count;
      const meanSq = boxSum(sumSq, cx0, cy0, cx1, cy1) / count;
      const variance = Math.max(0, meanSq - mean * mean);
      std[y * w + x] = Math.sqrt(variance);
    }
  }

  const sorted = Float64Array.from(std).sort();
  const lo = leadedglassBoldPercentile(sorted, 5.0);
  const hi = leadedglassBoldPercentile(sorted, 95.0);
  const data = new Float64Array(w * h);
  if (hi > lo) {
    for (let i = 0; i < std.length; i++) {
      data[i] = Math.min(1, Math.max(0, (std[i] - lo) / (hi - lo)));
    }
  }
  return { data, w, h };
}

/** Wraps leadedglassBoldDensityMap's per-image-pixel [0, 1] detail score
 * into { minDistFn, minDistMin, minDistMax } for poissonDiscPointsVariable.
 * minDistFn(cx, cy) maps a canvas-space point into the density map's
 * image-pixel space (the same linear scale sampleStainedglassColors uses in
 * the other direction) and returns the piece spacing that location calls
 * for: LEADEDGLASS_BOLD_DENSITY_BIG_FACTOR x baseMinDist in the smoothest
 * areas (big, sparse pieces), LEADEDGLASS_BOLD_DENSITY_SMALL_FACTOR x
 * baseMinDist in the busiest (small, dense pieces), linearly interpolated
 * in between. */
export function leadedglassBoldMinDistLookup(densityMap, canvasW, canvasH, baseMinDist) {
  const { data, w: imgW, h: imgH } = densityMap;
  const big = baseMinDist * LEADEDGLASS_BOLD_DENSITY_BIG_FACTOR;
  const small = baseMinDist * LEADEDGLASS_BOLD_DENSITY_SMALL_FACTOR;

  function minDistFn(cx, cy) {
    const ix = Math.min(imgW - 1, Math.max(0, Math.floor((cx / canvasW) * imgW)));
    const iy = Math.min(imgH - 1, Math.max(0, Math.floor((cy / canvasH) * imgH)));
    const d = data[iy * imgW + ix];
    return big + (small - big) * d;
  }

  return { minDistFn, minDistMin: small, minDistMax: big };
}

/** Sub-mode B: the existing Tile Mosaic Poisson-disc + nearest-seed
 * pipeline, recalibrated to a much lower default piece count and
 * constrained to the chosen frame's silhouette (points rejected outside it
 * during generation via the boundsTest). Piece SIZE also varies with local
 * image detail by default (leadedglassBoldDensityMap +
 * leadedglassBoldMinDistLookup, fed into poissonDiscPointsVariable instead
 * of the plain fixed-spacing poissonDiscPoints) -- minDist is the base
 * (average) spacing the piece-count slider and canvas-size estimate are
 * still built from, not a spacing every piece now gets exactly.
 * Returns { points, canvasW, canvasH, colors }. */
export function generateLeadedglassBoldPieces(sourceCanvas, shape, targetCount, minDist, seed) {
  if (targetCount <= 0 || minDist <= 0) {
    throw new Error("Piece count and piece spacing must both be positive.");
  }
  if (targetCount > LEADEDGLASS_MAX_CELLS) {
    throw new Error(`That's a target of ${targetCount.toLocaleString()} pieces -- reduce the piece ` +
      `count to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
  }
  const [canvasW, canvasH] = leadedglassBoldPiecesCanvasSize(
    sourceCanvas.width, sourceCanvas.height, shape, targetCount, minDist);
  const boundsTest = (x, y) => leadedglassInsideFrame(shape, x, y, canvasW, canvasH);
  const densityMap = leadedglassBoldDensityMap(sourceCanvas);
  const { minDistFn, minDistMin, minDistMax } = leadedglassBoldMinDistLookup(
    densityMap, canvasW, canvasH, minDist);
  const points = poissonDiscPointsVariable(canvasW, canvasH, minDistFn, minDistMin, minDistMax,
    seed, 30, 200, boundsTest);
  if (points.length > LEADEDGLASS_MAX_CELLS) {
    throw new Error(`That layout came out to ${points.length.toLocaleString()} pieces -- reduce the piece ` +
      `count to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
  }
  const colors = sampleStainedglassColors(sourceCanvas, points, canvasW, canvasH, minDist);
  return { points, canvasW, canvasH, colors };
}

/** Same nearest-seed rasterization renderStainedglassMosaic uses, handed
 * off to the shared frame-aware renderer instead of drawing its own
 * leading/border pass. */
export function renderLeadedglassBoldPieces(colors, points, shape, canvasW, canvasH, minDist,
                                             leadWidth, leadColor, bgColor, createCanvasFn) {
  const index = buildSeedIndex(points, canvasW, canvasH, minDist);
  const owner = new Int32Array(canvasW * canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      owner[y * canvasW + x] = nearestSeed(index, points, x + 0.5, y + 0.5);
    }
  }
  return renderLeadedglassFromOwner(owner, colors, shape, canvasW, canvasH,
                                     leadWidth, leadColor, bgColor, createCanvasFn);
}

/** Live pre-generate estimate for the Bold Pieces sub-mode -- same "~"
 * caveat as estimateStainedglassPieceCount. */
export function estimateLeadedglassBoldPieceCount(imageW, imageH, targetCount, minDist) {
  const [bodyW, bodyH] = stainedglassCanvasSize(imageW, imageH, targetCount, minDist);
  return estimateStainedglassPieceCount(bodyW, bodyH, minDist);
}

// --- Decorative border (Bold Pieces + "rect" only) ----------------------

/** Default border band thickness: a fraction of the inner picture's
 * shorter side, clamped so it reads as a picture frame at both small
 * preview sizes and large export sizes without ever swallowing a small
 * picture whole. Ported from mosaic_core.py's leadedglass_border_width. */
export function leadedglassBorderWidth(bodyW, bodyH) {
  const raw = Math.round(Math.min(bodyW, bodyH) * LEADEDGLASS_BORDER_WIDTH_FRACTION);
  return Math.max(LEADEDGLASS_BORDER_MIN_WIDTH, Math.min(LEADEDGLASS_BORDER_MAX_WIDTH, raw));
}

/** Owner-index raster ({owner, nTiles, isCorner}, owner a flat outerW*outerH
 * Int32Array, -1 inside the picture area this border surrounds) for a
 * decorative picture-frame border of borderWidth px running around all
 * four edges of an outerW x outerH canvas: four borderWidth-square corner
 * tiles (laid down first so they're never subdivided), then evenly spaced
 * roughly-square tiles filling the remaining top/bottom/left/right bands
 * between them. isCorner flags which of the nTiles owner indices are
 * corner tiles, so the caller can color them with a separate accent, the
 * way every reference leaded-glass border does. Ported from
 * mosaic_core.py's leadedglass_border_tiles (same tile layout; the exact
 * owner-index numbering order only needs to match leadedglassBorderTileColors
 * within this same JS module, not the Python side -- see this module's
 * header for why the geometry, not the PRNG-driven coloring, is what needs
 * cross-language parity). */
export function leadedglassBorderTiles(outerW, outerH, borderWidth) {
  const bw = borderWidth;
  const owner = new Int32Array(outerW * outerH).fill(-1);
  const isCorner = [];
  let nextId = 0;

  const fillRect = (x0, y0, x1, y1, id) => {
    for (let y = y0; y < y1; y++) {
      const rowOff = y * outerW;
      for (let x = x0; x < x1; x++) owner[rowOff + x] = id;
    }
  };

  const cornerRects = [
    [0, 0, bw, bw],
    [outerW - bw, 0, outerW, bw],
    [0, outerH - bw, bw, outerH],
    [outerW - bw, outerH - bw, outerW, outerH],
  ];
  for (const [x0, y0, x1, y1] of cornerRects) {
    fillRect(x0, y0, x1, y1, nextId);
    isCorner.push(true);
    nextId++;
  }

  const edgeTiles = (along0, along1, across0, across1, horizontal) => {
    const span = along1 - along0;
    const n = Math.max(1, Math.round(span / (bw * 1.6)));
    const step = span / n;
    for (let i = 0; i < n; i++) {
      const a0 = along0 + Math.round(i * step);
      const a1 = along0 + Math.round((i + 1) * step);
      if (horizontal) fillRect(a0, across0, a1, across1, nextId);
      else fillRect(across0, a0, across1, a1, nextId);
      isCorner.push(false);
      nextId++;
    }
  };

  edgeTiles(bw, outerW - bw, 0, bw, true);                  // top band
  edgeTiles(bw, outerW - bw, outerH - bw, outerH, true);    // bottom band
  edgeTiles(bw, outerH - bw, 0, bw, false);                 // left band
  edgeTiles(bw, outerH - bw, outerW - bw, outerW, false);   // right band

  return { owner, nTiles: nextId, isCorner };
}

/** borderColor for edge tiles, accentColor for the four corner tiles, each
 * with a small deterministic per-tile jitter so the border reads as
 * individually mixed glass rather than flat repeated color -- seeded, so
 * the same borderSeed always reproduces the same border. Uses this
 * module's own bit-identical-with-Python makeMulberry32 stream (imported
 * from stainedglass.js) rather than porting numpy's RandomState/randint;
 * that means a given seed's exact jitter values won't match the Python
 * app's pixel-for-pixel, only the *style* of the result -- the same
 * tolerance this module already applies to nearest-seed/ring-cell
 * assignment, not the PRNG-bit-identical bar Poisson-disc placement needs. */
export function leadedglassBorderTileColors(nTiles, isCorner, borderColor, accentColor, seed = 1) {
  const rng = makeMulberry32(seed);
  const colors = [];
  for (let i = 0; i < nTiles; i++) {
    const base = isCorner[i] ? accentColor : borderColor;
    const jittered = base.map(c => {
      const j = Math.floor(rng() * (2 * LEADEDGLASS_BORDER_TILE_JITTER + 1)) - LEADEDGLASS_BORDER_TILE_JITTER;
      return Math.round(Math.max(0, Math.min(255, c + j)));
    });
    colors.push(jittered);
  }
  return colors;
}

/** A reasonable bucket-size hint for buildSeedIndex's uniform grid over the
 * Bold Pieces points, once they're already offset into a bordered outer
 * canvas -- same "perf hint only, any reasonable value still finds the
 * correct nearest seed" reasoning as this module's own
 * _leadedglassSubjectIndexHintDist, recomputed from the body area (outer
 * canvas minus the border band) and point count alone so the caller
 * doesn't need to thread the real minDist through a cached/re-rendered
 * layout. */
function _leadedglassBoldIndexHintDist(outerW, outerH, borderWidth, nPoints) {
  if (nPoints <= 0) return 1;
  const bodyArea = Math.max(1, (outerW - 2 * borderWidth) * (outerH - 2 * borderWidth));
  return Math.max(2.0, Math.sqrt(bodyArea / (nPoints * STAINEDGLASS_PACKING_FACTOR)));
}

/** Bold Pieces render, wrapped in a decorative picture-frame border band.
 * points are already positioned in the *outer* (bordered) canvas -- i.e.
 * already offset by borderWidth from generateLeadedglassBoldPieces' own
 * unmodified output -- and outerW/outerH is that full bordered canvas
 * size; see app.js's generateLeadedglassMosaic for where that offset
 * happens the first time, and its cheap re-render path for how the same
 * offset points are reused on a lead/color-only tweak without redoing
 * Poisson-disc. This never touches how the inner picture is generated or
 * sampled, only adds a border band of extra owner cells around it and
 * reuses renderLeadedglassFromOwner's single boundary-detection pass for
 * the seam between border and picture, exactly like every other seam in
 * this module. Ported from mosaic_core.py's
 * render_leadedglass_bold_pieces_with_border. */
export function renderLeadedglassBoldPiecesWithBorder(colors, points, outerW, outerH, borderWidth,
                                                        borderColor, borderAccentColor, borderSeed,
                                                        leadWidth, leadColor, bgColor, createCanvasFn) {
  const bw = borderWidth;
  const hintDist = _leadedglassBoldIndexHintDist(outerW, outerH, bw, points.length);
  const index = buildSeedIndex(points, outerW, outerH, hintDist);

  const innerOwner = new Int32Array(outerW * outerH);
  for (let y = 0; y < outerH; y++) {
    const inY = y >= bw && y < outerH - bw;
    for (let x = 0; x < outerW; x++) {
      const inside = inY && x >= bw && x < outerW - bw;
      innerOwner[y * outerW + x] = inside ? nearestSeed(index, points, x + 0.5, y + 0.5) : -1;
    }
  }

  const { owner: borderOwner, nTiles, isCorner } = leadedglassBorderTiles(outerW, outerH, bw);
  const borderColors = leadedglassBorderTileColors(nTiles, isCorner, borderColor, borderAccentColor, borderSeed);

  const nPoints = points.length;
  const combinedOwner = new Int32Array(outerW * outerH);
  for (let i = 0; i < combinedOwner.length; i++) {
    const bo = borderOwner[i];
    combinedOwner[i] = bo >= 0 ? bo + nPoints : innerOwner[i];
  }
  const combinedColors = colors.concat(borderColors);

  return renderLeadedglassFromOwner(combinedOwner, combinedColors, "rect", outerW, outerH,
                                     leadWidth, leadColor, bgColor, createCanvasFn);
}

// --- Sub-mode: Panel Grid (diamond "quarry" tiling) ---------------------

/** [canvasW, canvasH] for the Panel Grid sub-mode: cols evenly spaced
 * cellSize-px columns span the body width; body height preserves the
 * source image's aspect ratio; the frame shape's arch cap (if any) is
 * added on top. */
export function leadedglassPanelGridCanvasSize(imageW, imageH, shape, cols, cellSize) {
  const bodyW = cols * cellSize;
  const aspect = imageH ? imageW / imageH : 1.0;
  const bodyH = Math.max(cellSize, Math.round(bodyW / aspect));
  return leadedglassFrameSize(shape, bodyW, bodyH);
}

/** [colMin, colsN, rowMin, rowsN]: the range of diamond-grid indices (see
 * leadedglassDiamondOwner) that can intersect a canvasW x canvasH canvas.
 * The diamond grid is a plain square grid of side D = 2*cellSize, rotated
 * 45 degrees -- col indexes the a = x+y axis, row indexes the
 * perpendicular b = x-y axis -- so it fully tiles the plane with no gaps
 * between diamonds (unlike a diamond merely inscribed in an axis-aligned
 * square cell, which only covers half that cell's area). Because the
 * (x,y) -> (a,b) map is linear, the canvas rectangle's own four corners
 * bound every (col, row) the canvas can touch -- found here once and
 * reused by both the sampling pass (source-image resolution) and the
 * render pass (canvas resolution) so they agree on the exact same finite
 * index range. Ported from mosaic_core.py's _leadedglass_diamond_grid_bounds. */
export function leadedglassDiamondGridBounds(cellSize, canvasW, canvasH) {
  const d = 2.0 * cellSize;
  const cornersA = [], cornersB = [];
  for (const cx of [0.0, canvasW]) {
    for (const cy of [0.0, canvasH]) {
      cornersA.push(cx + cy);
      cornersB.push(cx - cy);
    }
  }
  const colMin = Math.floor(Math.min(...cornersA) / d);
  const colMax = Math.floor(Math.max(...cornersA) / d);
  const rowMin = Math.floor(Math.min(...cornersB) / d);
  const rowMax = Math.floor(Math.max(...cornersB) / d);
  return [colMin, colMax - colMin + 1, rowMin, rowMax - rowMin + 1];
}

/** Owner-cell index (row-major over the colsN x rowsN index range from
 * leadedglassDiamondGridBounds) for a single canvas-space point (x, y),
 * under the Panel Grid sub-mode's diamond "quarry" tiling -- see
 * leadedglassDiamondGridBounds for the full derivation. Every point
 * belongs to exactly one diamond, so a lead line only ever appears at a
 * true diamond edge (where the shared renderLeadedglassFromOwner boundary
 * pass finds two different diamonds meeting), not at some baked-in gap. */
export function leadedglassDiamondOwner(x, y, cellSize, colMin, colsN, rowMin, rowsN) {
  const d = 2.0 * cellSize;
  const a = x + y, b = x - y;
  let col = Math.floor(a / d) - colMin;
  let row = Math.floor(b / d) - rowMin;
  const inGrid = col >= 0 && col < colsN && row >= 0 && row < rowsN;
  col = Math.min(Math.max(col, 0), colsN - 1);
  row = Math.min(Math.max(row, 0), rowsN - 1);
  return inGrid ? row * colsN + col : -1;
}

/** Average the source image's pixels into each diamond pane. */
export function sampleLeadedglassPanelGridColors(sourceCanvas, canvasW, canvasH, cellSize,
                                                  colMin, colsN, rowMin, rowsN) {
  return accumulateOwnerColors(sourceCanvas, canvasW, canvasH, colsN * rowsN,
    (cx, cy) => leadedglassDiamondOwner(cx, cy, cellSize, colMin, colsN, rowMin, rowsN));
}

export function renderLeadedglassPanelGrid(colors, shape, canvasW, canvasH, cellSize,
                                            colMin, colsN, rowMin, rowsN,
                                            leadWidth, leadColor, bgColor, createCanvasFn) {
  const owner = new Int32Array(canvasW * canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      owner[y * canvasW + x] = leadedglassDiamondOwner(x + 0.5, y + 0.5, cellSize, colMin, colsN, rowMin, rowsN);
    }
  }
  return renderLeadedglassFromOwner(owner, colors, shape, canvasW, canvasH,
                                     leadWidth, leadColor, bgColor, createCanvasFn);
}

// --- Sub-mode: Lattice + Subject (ellipse Voronoi + polar sunburst) -----

/** [canvasW, canvasH, ecx, ecy, erx, ery] for the Lattice + Subject
 * sub-mode: bodyW is caller-chosen, bodyH preserves the source image's
 * aspect ratio, and the frame shape's arch cap (if any) is added on top.
 * The subject ellipse sits centered in the rectangular body, below the
 * springing line, sized as a fraction of the body. */
export function leadedglassLatticeCanvasSize(imageW, imageH, shape, bodyW) {
  const aspect = imageH ? imageW / imageH : 1.0;
  const bodyH = Math.max(40, Math.round(bodyW / aspect));
  const [canvasW, canvasH] = leadedglassFrameSize(shape, bodyW, bodyH);
  const archH = canvasH - bodyH;
  const ecx = bodyW / 2.0;
  const ecy = archH + bodyH / 2.0;
  const erx = LEADEDGLASS_SUBJECT_RX_FRACTION * bodyW;
  const ery = LEADEDGLASS_SUBJECT_RY_FRACTION * bodyH;
  return [canvasW, canvasH, ecx, ecy, erx, ery];
}

/** Analytic (not scanned) upper bound on the ellipse-normalized radius r
 * reached anywhere in the width x height canvas -- see mosaic_core.py's
 * _leadedglass_sunburst_r_max for why this uses the plain bounding
 * rectangle's four corners (a deliberate, harmless simplification) rather
 * than scanning the rendered grid. */
export function leadedglassSunburstRMax(ecx, ecy, erx, ery, width, height) {
  let rMax = 0.0;
  for (const cx of [0.0, width]) {
    for (const cy of [0.0, height]) {
      const ux = (cx - ecx) / erx;
      const uy = (cy - ecy) / ery;
      rMax = Math.max(rMax, Math.sqrt(ux * ux + uy * uy));
    }
  }
  return Math.max(rMax, 1.0 + 1e-6);
}

/** Owner-cell index for a single canvas-space point (x, y) under the
 * Lattice + Subject sub-mode: inside the ellipse (r <= 1, ellipse-
 * normalized), the nearest subject seed point's index; outside it, a
 * ring/wedge index (offset by nSubject) using the same ring-count math as
 * Radial mode (radialCellCount/radialRingSegments), re-centered and
 * re-normalized on the ellipse, with the ring band remapped from
 * [1, rMax] so the innermost sunburst ring starts right at the ellipse's
 * own edge. */
export function leadedglassLatticeOwner(x, y, ecx, ecy, erx, ery, rMax, rings, baseSegments,
                                         subjectIndex, subjectPoints, nSubject) {
  const ux = (x - ecx) / erx;
  const uy = (y - ecy) / ery;
  const r = Math.sqrt(ux * ux + uy * uy);

  if (r <= 1.0) {
    if (nSubject > 0 && subjectIndex) {
      return nearestSeed(subjectIndex, subjectPoints, x, y);
    }
    return -1;
  }

  let theta = Math.atan2(uy, ux);
  if (theta < 0) theta += 2 * Math.PI;
  const rClamped = Math.min(r, rMax);
  let ring = Math.floor(((rClamped - 1.0) / (rMax - 1.0)) * rings);
  ring = Math.min(Math.max(ring, 0), rings - 1);
  const segsPerRing = baseSegments * (ring + 1);
  let seg = Math.floor((theta / (2 * Math.PI)) * segsPerRing);
  seg = Math.min(Math.max(seg, 0), segsPerRing - 1);
  const cellsBefore = (baseSegments * ring * (ring + 1)) / 2;
  return nSubject + cellsBefore + seg;
}

/** Sub-mode A: a low-piece-count Poisson-disc/Voronoi zone confined to a
 * centered ellipse (the "bold subject"), surrounded by a radiating
 * ring/wedge sunburst reusing Radial mode's ring-count formulas for the
 * background. Returns { subjectPoints, canvasW, canvasH, ecx, ecy, erx,
 * ery, colors }. */
export function generateLeadedglassLatticeSubject(sourceCanvas, shape, bodyW, subjectCount, seed,
                                                    rings, baseSegments) {
  if (bodyW <= 0) throw new Error("Panel width must be positive.");
  if (subjectCount <= 0 || rings <= 0 || baseSegments <= 0) {
    throw new Error("Subject piece count, sunburst rings, and sunburst wedges must all be positive.");
  }
  const nBurst = radialCellCount(rings, baseSegments);
  if (subjectCount + nBurst > LEADEDGLASS_MAX_CELLS) {
    throw new Error(`That's ${(subjectCount + nBurst).toLocaleString()} pieces total -- reduce the ` +
      `subject piece count, rings, or wedges to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
  }

  const [canvasW, canvasH, ecx, ecy, erx, ery] = leadedglassLatticeCanvasSize(
    sourceCanvas.width, sourceCanvas.height, shape, bodyW);

  const ellipseArea = Math.PI * erx * ery;
  const minDist = Math.max(2.0, Math.sqrt(ellipseArea / (subjectCount * STAINEDGLASS_PACKING_FACTOR)));

  const ellipseBoundsTest = (lx, ly) => {
    const ux = (lx - erx) / erx;
    const uy = (ly - ery) / ery;
    return (ux * ux + uy * uy) <= 1.0;
  };

  const localPoints = poissonDiscPoints(2 * erx, 2 * ery, minDist, seed, 30, 200, ellipseBoundsTest);
  const subjectPoints = localPoints.map(([px, py]) => [px + ecx - erx, py + ecy - ery]);
  if (subjectPoints.length + nBurst > LEADEDGLASS_MAX_CELLS) {
    throw new Error(`That layout came out to ${(subjectPoints.length + nBurst).toLocaleString()} pieces ` +
      `-- reduce the subject piece count, rings, or wedges to bring it under ` +
      `${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
  }

  const colors = sampleLeadedglassLatticeColors(sourceCanvas, canvasW, canvasH, ecx, ecy, erx, ery,
                                                 subjectPoints, rings, baseSegments);
  return { subjectPoints, canvasW, canvasH, ecx, ecy, erx, ery, colors };
}

/** A reasonable bucket-size hint for buildSeedIndex's uniform grid over
 * the subject ellipse's points -- the same packing-factor estimate
 * generateLeadedglassLatticeSubject inverts to pick the Poisson-disc's
 * own minDist, recomputed here from erx/ery/nSubject alone so sampling
 * and rendering don't need the caller to thread the real minDist through
 * (it's only a perf hint for the spatial index's bucket size, not part of
 * the piece layout itself -- any reasonable value finds the correct
 * nearest seed, just faster or slower to build). */
function _leadedglassSubjectIndexHintDist(erx, ery, nSubject) {
  if (nSubject <= 0) return 1;
  const ellipseArea = Math.PI * erx * ery;
  return Math.max(2.0, Math.sqrt(ellipseArea / (nSubject * STAINEDGLASS_PACKING_FACTOR)));
}

export function sampleLeadedglassLatticeColors(sourceCanvas, canvasW, canvasH, ecx, ecy, erx, ery,
                                                subjectPoints, rings, baseSegments) {
  const rMax = leadedglassSunburstRMax(ecx, ecy, erx, ery, canvasW, canvasH);
  const nSubject = subjectPoints.length;
  const hintDist = _leadedglassSubjectIndexHintDist(erx, ery, nSubject);
  const subjectIndex = nSubject > 0 ? buildSeedIndex(subjectPoints, canvasW, canvasH, hintDist) : null;
  const nCells = nSubject + radialCellCount(rings, baseSegments);
  return accumulateOwnerColors(sourceCanvas, canvasW, canvasH, nCells,
    (cx, cy) => leadedglassLatticeOwner(cx, cy, ecx, ecy, erx, ery, rMax, rings, baseSegments,
                                         subjectIndex, subjectPoints, nSubject));
}

export function renderLeadedglassLattice(colors, shape, canvasW, canvasH, ecx, ecy, erx, ery,
                                          subjectPoints, rings, baseSegments,
                                          leadWidth, leadColor, bgColor, createCanvasFn) {
  const rMax = leadedglassSunburstRMax(ecx, ecy, erx, ery, canvasW, canvasH);
  const nSubject = subjectPoints.length;
  const hintDist = _leadedglassSubjectIndexHintDist(erx, ery, nSubject);
  const subjectIndex = nSubject > 0 ? buildSeedIndex(subjectPoints, canvasW, canvasH, hintDist) : null;
  const owner = new Int32Array(canvasW * canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      owner[y * canvasW + x] = leadedglassLatticeOwner(x + 0.5, y + 0.5, ecx, ecy, erx, ery, rMax,
                                                         rings, baseSegments, subjectIndex, subjectPoints, nSubject);
    }
  }
  return renderLeadedglassFromOwner(owner, colors, shape, canvasW, canvasH,
                                     leadWidth, leadColor, bgColor, createCanvasFn);
}

/** Total piece count for the Lattice + Subject sub-mode: the sunburst's
 * ring/wedge count is exact, so only the subject half of this total
 * carries Poisson-disc's usual "~" uncertainty. */
export function estimateLeadedglassLatticePieceCount(subjectCount, rings, baseSegments) {
  return subjectCount + radialCellCount(rings, baseSegments);
}
