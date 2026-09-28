/**
 * radial.js
 * Rings of pie-slice/annular-sector cells around a center point, instead of
 * a rectangular grid. Ring 0 (the innermost) is `baseSegments` true pie
 * wedges meeting at the center point; each ring further out has more
 * segments than the ring before it, so cells stay roughly the same
 * physical size ring-to-ring instead of the wedges getting wider and wider
 * the way a fixed segment count would. Ported from mosaic_core.py's
 * radial_ring_segments / radial_cell_count / sample_radial_colors /
 * render_radial_mosaic (same formulas, same cell ordering).
 */

// Comparable headroom to the rectangular grid's GRID_MAX_CELLS-based
// ceiling (400x400), while still bounding sample/quantize/render time.
export const RADIAL_MAX_CELLS = 20000;

/** Segment count for `ring` (0-indexed, 0 = the innermost ring of true pie
 * wedges meeting at the center). Scales linearly with ring so every ring's
 * wedges stay roughly the same physical width as the ring before it,
 * rather than a fixed segment count (which would make outer wedges look
 * progressively wider as the ring's circumference grows). */
export function radialRingSegments(ring, baseSegments) {
  return baseSegments * (ring + 1);
}

/** Total cell count across all rings: baseSegments * (1 + 2 + ... + rings)
 *  = baseSegments * rings * (rings + 1) / 2 (a triangular number) --
 *  rings*(rings+1) is always even, so this divides exactly. */
export function radialCellCount(rings, baseSegments) {
  return (baseSegments * rings * (rings + 1)) / 2;
}

/**
 * Average the source image's pixels into each ring/segment cell.
 *
 * Maps the unit disk onto the image's full bounding box (independent x/y
 * scaling -- the photo is stretched to fill a centered square exactly the
 * way imageToGrid stretches a photo to fill a rectangular grid) and
 * buckets every source pixel into whichever polar cell its mapped
 * (radius, angle) falls into, in one pass over the whole image -- the same
 * box-downsample-by-averaging approach imageToGrid uses for the
 * rectangular grid, rather than a single point-sample per cell.
 *
 * Returns a flat array of length radialCellCount(rings, baseSegments),
 * each entry [r, g, b] (floats), ring-major then segment (ring 0's wedges
 * first, then ring 1's, ...) -- the same order renderRadialMosaic and
 * buildRadialCellsJson iterate in.
 */
export function sampleRadialColors(sourceCanvas, rings, baseSegments) {
  if (rings <= 0 || baseSegments <= 0) {
    throw new Error("Rings and base segments must both be positive.");
  }
  const nCells = radialCellCount(rings, baseSegments);
  if (nCells > RADIAL_MAX_CELLS) {
    throw new Error(
      `That's ${nCells.toLocaleString()} cells -- reduce rings or base segments ` +
      `to bring it under ${RADIAL_MAX_CELLS.toLocaleString()}.`);
  }

  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  if (sw <= 0 || sh <= 0) {
    throw new Error("Image has no pixels to sample.");
  }
  const src = ctx.getImageData(0, 0, sw, sh).data;

  const sums = new Float64Array(nCells * 3);
  const counts = new Float64Array(nCells);
  let sumR = 0, sumG = 0, sumB = 0;

  for (let y = 0; y < sh; y++) {
    const uy = ((y + 0.5) / sh) * 2.0 - 1.0;
    for (let x = 0; x < sw; x++) {
      const ux = ((x + 0.5) / sw) * 2.0 - 1.0;
      const r = Math.sqrt(ux * ux + uy * uy);
      let theta = Math.atan2(uy, ux);
      if (theta < 0) theta += 2 * Math.PI;

      const ring = Math.min(Math.floor(r * rings), rings - 1);
      const segsInRing = baseSegments * (ring + 1);
      const seg = Math.min(Math.floor((theta / (2 * Math.PI)) * segsInRing), segsInRing - 1);
      // cellsBefore(ring) is the same triangular-number formula as
      // radialCellCount, truncated to `ring` rings.
      const cellsBefore = (baseSegments * ring * (ring + 1)) / 2;
      const idx = cellsBefore + seg;

      const srcIdx = (y * sw + x) * 4;
      const rr = src[srcIdx], gg = src[srcIdx + 1], bb = src[srcIdx + 2];
      sums[idx * 3] += rr; sums[idx * 3 + 1] += gg; sums[idx * 3 + 2] += bb;
      counts[idx]++;
      sumR += rr; sumG += gg; sumB += bb;
    }
  }

  const totalPixels = sw * sh;
  const overallAvg = [sumR / totalPixels, sumG / totalPixels, sumB / totalPixels];

  // A cell with zero pixels landing in it (possible for a very fine grid
  // over a small source image) falls back to the image's overall average
  // color rather than black, so a sparse pixel-hit doesn't punch a hole in
  // the mosaic.
  const colors = new Array(nCells);
  for (let i = 0; i < nCells; i++) {
    colors[i] = counts[i] > 0
      ? [sums[i * 3] / counts[i], sums[i * 3 + 1] / counts[i], sums[i * 3 + 2] / counts[i]]
      : overallAvg;
  }
  return colors;
}

/** Corner points for one ring/segment's cell, centered at (cx, cy), each
 * ring cellSize px thick. Ring 0 degenerates to a true pie-slice wedge (a
 * center point plus an outer arc); every other ring is an annular sector
 * between two arcs. Curved edges are approximated with a handful of
 * points (about one every 10 degrees) rather than a single straight
 * chord, so they still read as round rather than faceted -- mirrors the
 * spirit of shapes.js's hexCorners' corner-point generation. Returns an
 * array of [x, y] pairs, usable directly by a canvas path or (joined with
 * a space) as an SVG polygon's points attribute. */
export function radialCellPolygon(cx, cy, ring, seg, baseSegments, cellSize) {
  const nSegs = radialRingSegments(ring, baseSegments);
  const theta0 = (seg / nSegs) * 2 * Math.PI;
  const theta1 = ((seg + 1) / nSegs) * 2 * Math.PI;
  const rOuter = (ring + 1) * cellSize;
  const steps = Math.max(1, Math.round((theta1 - theta0) / (Math.PI / 18)));

  const outerArc = [];
  for (let i = 0; i <= steps; i++) {
    const t = theta0 + (theta1 - theta0) * (i / steps);
    outerArc.push([cx + rOuter * Math.cos(t), cy + rOuter * Math.sin(t)]);
  }
  if (ring === 0) {
    return [[cx, cy], ...outerArc];
  }

  const rInner = ring * cellSize;
  const innerArc = [];
  for (let i = 0; i <= steps; i++) {
    const t = theta1 - (theta1 - theta0) * (i / steps);
    innerArc.push([cx + rInner * Math.cos(t), cy + rInner * Math.sin(t)]);
  }
  return [...outerArc, ...innerArc];
}

/**
 * Render ring/segment cells (see sampleRadialColors, or a quantized
 * version of them) as an annular-sector mosaic: ring 0 as baseSegments
 * true pie wedges from the center, each ring out adding
 * radialRingSegments(ring, baseSegments) more, wider wedges. Canvas is a
 * square, 2*rings*cellSize px across, with the full circle inscribed and
 * centered -- bgColor fills the square's corners outside the circle.
 *
 * colors: flat array of length radialCellCount(rings, baseSegments), same
 * ring-major-then-segment order sampleRadialColors returns.
 */
export function renderRadialMosaic(colors, rings, baseSegments, cellSize, bgColor, createCanvasFn) {
  const size = 2 * rings * cellSize;
  const canvas = createCanvasFn(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  let idx = 0;
  for (let ring = 0; ring < rings; ring++) {
    const nSegs = radialRingSegments(ring, baseSegments);
    for (let seg = 0; seg < nSegs; seg++) {
      const pts = radialCellPolygon(cx, cy, ring, seg, baseSegments, cellSize);
      const [r, g, b] = colors[idx];
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      idx++;
    }
  }
  return canvas;
}
