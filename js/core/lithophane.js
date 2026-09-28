/**
 * lithophane.js
 * Classic single-material backlit height-map, exported as a real binary
 * STL mesh for 3D printing. Thin = bright (light passes easily), thick =
 * dark (blocks light) -- the standard lithophane mapping, or the reverse
 * with invert=true. Ported from mosaic_core.py's matching functions.
 *
 * Unlike stained glass, there's no randomness anywhere in this pipeline,
 * so cross-language parity doesn't need trig-avoidance tricks: the image
 * sampling step reuses imageToGrid's box average (tolerance parity, same
 * as every other mode's image resampling), and the STL-writing step is
 * pure float32 arithmetic over a fixed nested-loop vertex order matching
 * mosaic_core.py's exactly, so it agrees with the Python side bit-for-bit
 * given the *same* heightmap input (see parity_lithophane.mjs, which
 * feeds JS the Python-computed heightmap fixture to isolate that check
 * from the image-sampling step's own tolerance-based check).
 */
import { imageToGrid } from "./grid.js";

export const LITHOPHANE_MIN_SAMPLES_ACROSS = 20;
export const LITHOPHANE_MAX_SAMPLES_ACROSS = 700;
export const LITHOPHANE_MAX_TRIANGLES = 2_000_000;

// Automatic smoothing (no UI toggle -- see smoothLithophaneLuminance)
// applied to every lithophane before it's mapped to thickness, so the
// print reads as a photographic ramp rather than a faceted/blocky
// heightmap regardless of the chosen Detail level.
export const LITHOPHANE_SMOOTH_RADIUS = 1;
export const LITHOPHANE_SMOOTH_PASSES = 2;

/** The heightmap's samplesW x samplesH, derived from the *physical*
 * width:height ratio the user chose (not the raw source image's aspect --
 * same idea as Classic mode's gridW x gridH, which is free to stretch the
 * source to fit), so the print's own proportions decide the sample
 * spacing evenly in both directions. */
export function lithophaneSampleGridSize(widthMm, heightMm, samplesAcross) {
  const samplesW = Math.max(2, Math.round(samplesAcross));
  const ratio = widthMm ? heightMm / widthMm : 1.0;
  const samplesH = Math.max(2, Math.round(samplesW * ratio));
  return [samplesW, samplesH];
}

/** Total STL triangle count for a samplesW x samplesH heightmap: 2
 * triangles per quad on the top surface, the same on the flat bottom,
 * plus 2 triangles per perimeter edge segment for the side walls that
 * close the solid. */
export function estimateLithophaneTriangleCount(samplesW, samplesH) {
  if (samplesW < 2 || samplesH < 2) return 0;
  const top = 2 * (samplesW - 1) * (samplesH - 1);
  const bottom = top;
  const walls = 2 * 2 * ((samplesW - 1) + (samplesH - 1));
  return top + bottom + walls;
}

/** Separable box blur along one axis of a row-major samplesW x samplesH
 * grid, edge-clamped (the averaging window shrinks near an edge rather
 * than reading past it). axis 0 blurs down each column (varies the
 * sample's row/j position for a fixed column/i); axis 1 blurs across
 * each row (varies i for a fixed j). A plain sum/count loop -- not any
 * built-in blur -- so it matches mosaic_core.py's
 * _lithophane_box_blur_axis bit-for-bit given the same input (window
 * sizes here are at most 3, well under where summation order could ever
 * matter for floating point). */
function boxBlurAxis(grid, samplesW, samplesH, axis, radius) {
  const out = new Float64Array(grid.length);
  if (axis === 1) {
    for (let j = 0; j < samplesH; j++) {
      const rowStart = j * samplesW;
      for (let i = 0; i < samplesW; i++) {
        const lo = Math.max(0, i - radius), hi = Math.min(samplesW - 1, i + radius);
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += grid[rowStart + k];
        out[rowStart + i] = sum / (hi - lo + 1);
      }
    }
  } else {
    for (let i = 0; i < samplesW; i++) {
      for (let j = 0; j < samplesH; j++) {
        const lo = Math.max(0, j - radius), hi = Math.min(samplesH - 1, j + radius);
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += grid[k * samplesW + i];
        out[j * samplesW + i] = sum / (hi - lo + 1);
      }
    }
  }
  return out;
}

/** Softens the hard per-sample transitions in the box-averaged luminance
 * grid before it's mapped to thickness, so the print reads as a smooth
 * photographic ramp instead of a faceted/blocky heightmap -- applied
 * automatically, no UI toggle, at every Detail setting. Two passes (by
 * default) of a radius-1 (3-sample) box blur: axis 0 (down each column)
 * then axis 1 (across each row) per pass. Mirrors
 * mosaic_core.py's smooth_lithophane_luminance exactly. */
export function smoothLithophaneLuminance(luminance, samplesW, samplesH,
  radius = LITHOPHANE_SMOOTH_RADIUS, passes = LITHOPHANE_SMOOTH_PASSES) {
  let g = luminance;
  for (let p = 0; p < passes; p++) {
    g = boxBlurAxis(g, samplesW, samplesH, 0, radius);
    g = boxBlurAxis(g, samplesW, samplesH, 1, radius);
  }
  return g;
}

/** Box-average the source image down to samplesW x samplesH (imageToGrid,
 * the same box filter every other mode uses for its own grid), convert to
 * Rec.601 luminance, smooth it (see smoothLithophaneLuminance), then map
 * to a physical thickness in mm: thin = bright (minThickness), thick =
 * dark (maxThickness), or the reverse with invert=true. Returns a
 * Float64Array of length samplesW*samplesH, row-major (row 0 first, left
 * to right within each row) -- matching mosaic_core.py's (samples_h,
 * samples_w) array flattened the same way. */
export function sampleLithophaneHeightmap(sourceCanvas, samplesW, samplesH, minThickness, maxThickness,
  invert = false) {
  if (maxThickness <= minThickness) {
    throw new Error("Max thickness must be greater than min thickness.");
  }
  const grid = imageToGrid(sourceCanvas, samplesW, samplesH);
  let luminance = new Float64Array(samplesW * samplesH);
  for (let idx = 0; idx < grid.length; idx++) {
    const [r, g, b] = grid[idx];
    luminance[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
  }
  luminance = smoothLithophaneLuminance(luminance, samplesW, samplesH);
  const heightmap = new Float64Array(samplesW * samplesH);
  const span = maxThickness - minThickness;
  for (let idx = 0; idx < luminance.length; idx++) {
    const t = invert ? luminance[idx] : (1.0 - luminance[idx]);
    heightmap[idx] = minThickness + t * span;
  }
  return heightmap;
}

/** A one-height-sample-per-pixel grayscale preview of how the print will
 * look backlit: the thinnest point (minThickness) renders brightest, the
 * thickest (maxThickness) darkest -- true regardless of the invert flag
 * used to build the heightmap, since this just re-derives the physical
 * backlit appearance from the thickness values themselves. Draws directly
 * onto a samplesW x samplesH canvas (createCanvasFn(w, h) -> canvas-like
 * object, same convention as renderStainedglassMosaic). */
export function renderLithophanePreview(heightmap, samplesW, samplesH, minThickness, maxThickness, createCanvasFn) {
  const canvas = createCanvasFn(samplesW, samplesH);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(samplesW, samplesH);
  const span = maxThickness - minThickness;
  for (let idx = 0; idx < heightmap.length; idx++) {
    const fraction = span > 0 ? (heightmap[idx] - minThickness) / span : 0;
    const display = Math.min(1, Math.max(0, 1 - fraction));
    const gray = Math.round(display * 255);
    const p = idx * 4;
    imageData.data[p] = gray;
    imageData.data[p + 1] = gray;
    imageData.data[p + 2] = gray;
    imageData.data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Triangulates a samplesW x samplesH heightmap (Float64Array/Array,
 * row-major) into a manifold, watertight solid: a top surface following
 * the thickness values, a flat bottom at z=0, and side walls closing the
 * perimeter. Returns an ArrayBuffer of binary STL bytes (little-endian:
 * 80-byte header, uint32 triangle count, then 50 bytes per triangle -- 3
 * float32 normal + 3x3 float32 vertices + a spare uint16). Vertex loop
 * order matches mosaic_core.py's build_lithophane_stl_bytes exactly, so
 * given the same heightmap input the two agree bit-for-bit. */
export function buildLithophaneStl(heightmap, samplesW, samplesH, widthMm, heightMm) {
  if (samplesW < 2 || samplesH < 2) {
    throw new Error("Heightmap must be at least 2x2 samples.");
  }
  const dx = widthMm / (samplesW - 1);
  const dy = heightMm / (samplesH - 1);
  const h = (i, j) => heightmap[j * samplesW + i];
  const top = (i, j) => [i * dx, j * dy, h(i, j)];
  const bot = (i, j) => [i * dx, j * dy, 0.0];

  const triangles = [];
  const add = (v1, v2, v3) => triangles.push([v1, v2, v3]);

  // Top surface, normal +z.
  for (let j = 0; j < samplesH - 1; j++) {
    for (let i = 0; i < samplesW - 1; i++) {
      const a = top(i, j), b = top(i + 1, j), c = top(i + 1, j + 1), d = top(i, j + 1);
      add(a, b, c);
      add(a, c, d);
    }
  }

  // Flat bottom at z=0, normal -z -- reversed winding vs the top.
  for (let j = 0; j < samplesH - 1; j++) {
    for (let i = 0; i < samplesW - 1; i++) {
      const a = bot(i, j), b = bot(i + 1, j), c = bot(i + 1, j + 1), d = bot(i, j + 1);
      add(a, c, b);
      add(a, d, c);
    }
  }

  // Side walls closing the perimeter -- outward normal on each edge.
  for (let i = 0; i < samplesW - 1; i++) { // front, j=0, normal -y
    const t0 = top(i, 0), t1 = top(i + 1, 0), b0 = bot(i, 0), b1 = bot(i + 1, 0);
    add(t0, b1, t1);
    add(t0, b0, b1);
  }
  for (let i = 0; i < samplesW - 1; i++) { // back, j=samplesH-1, normal +y
    const t0 = top(i, samplesH - 1), t1 = top(i + 1, samplesH - 1);
    const b0 = bot(i, samplesH - 1), b1 = bot(i + 1, samplesH - 1);
    add(t1, b0, t0);
    add(t1, b1, b0);
  }
  for (let j = 0; j < samplesH - 1; j++) { // left, i=0, normal -x
    const t0 = top(0, j), t1 = top(0, j + 1), b0 = bot(0, j), b1 = bot(0, j + 1);
    add(t1, b0, t0);
    add(t1, b1, b0);
  }
  for (let j = 0; j < samplesH - 1; j++) { // right, i=samplesW-1, normal +x
    const t0 = top(samplesW - 1, j), t1 = top(samplesW - 1, j + 1);
    const b0 = bot(samplesW - 1, j), b1 = bot(samplesW - 1, j + 1);
    add(t0, b1, t1);
    add(t0, b0, b1);
  }

  const headerText = "Pixel Mosaic Generator lithophane STL";
  const byteLength = 80 + 4 + triangles.length * 50;
  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  for (let k = 0; k < headerText.length; k++) bytes[k] = headerText.charCodeAt(k);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const [v1, v2, v3] of triangles) {
    const ux = v2[0] - v1[0], uy = v2[1] - v1[1], uz = v2[2] - v1[2];
    const vx = v3[0] - v1[0], vy = v3[1] - v1[1], vz = v3[2] - v1[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) { nx /= length; ny /= length; nz /= length; }
    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const v of [v1, v2, v3]) {
      view.setFloat32(offset, v[0], true); view.setFloat32(offset + 4, v[1], true); view.setFloat32(offset + 8, v[2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buf;
}
