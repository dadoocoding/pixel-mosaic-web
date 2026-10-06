/**
 * screwart.js
 * Screw Art -- a 3D relief portrait built from a grid of screws driven to
 * varying depths into a wood panel (a real, established craft technique).
 * Unlike Lithophane's continuous 3D-printed mesh, the output here is a
 * discrete per-screw depth value in mm (how far the screw protrudes above
 * the panel surface) that a person drives by hand/drill -- so the
 * deliverable is a build guide, not a 3D model. Ported from
 * mosaic_core.py's "Screw Art" section.
 *
 * The depth mapping reuses Lithophane's own box-average + luminance +
 * smoothing pipeline (imageToGrid / smoothLithophaneLuminance) almost
 * exactly -- same idea, flush/shallow = bright, deep = dark (or the
 * reverse with invert=true), just renamed for this mode's own physical
 * meaning (screw protrusion rather than print thickness).
 *
 * The preview render simulates raking-light shading: a classic GIS-style
 * hillshade (surface normal from the local depth gradient, dotted with a
 * simulated light direction) blended with the base depth-derived tone, so
 * the rendered image shows the same directional shadow/highlight cues that
 * make the real wood-and-screw version read as a 3D image under angled
 * light, not just a flat grayscale photo. No randomness anywhere in this
 * pipeline (same category as Lithophane), so cross-language parity should
 * be tight.
 *
 * Grids here use the same flat, row-major array convention as grid.js's
 * imageToGrid: length screwsWide*screwsTall, index = row*screwsWide + col.
 */
import { imageToGrid } from "./grid.js";
import { smoothLithophaneLuminance } from "./lithophane.js";

export const SCREWART_MIN_SCREWS_ACROSS = 10;
export const SCREWART_MAX_SCREWS_ACROSS = 150;

// Visual defaults tuned against several sample photos for a convincing
// "metal screws in wood under raking light" read without the image becoming
// unrecognizably dark or washed out. Mirrors mosaic_core.py's constants.
export const SCREWART_BOARD_COLOR = [90, 78, 64];
export const SCREWART_SCREW_COLOR = [150, 150, 158];
export const SCREWART_LIGHT_DIR = [-1.0, -1.0, 2.2];   // upper-left, moderately steep
export const SCREWART_AMBIENT = 0.35;                   // shadow-side floor brightness (0-1)
export const SCREWART_GRADIENT_BOOST = 3.0;             // exaggerates mm-scale slopes so the
                                                         // hillshade reads clearly at normal
                                                         // screw spacing
export const SCREWART_HILLSHADE_WEIGHT = 0.45;          // how much of the final tone comes
                                                         // from directional shading vs. the
                                                         // base depth tone alone
export const SCREWART_MIN_EMBEDMENT_MM = 10.0;          // rule-of-thumb minimum thread
                                                         // engagement left in the board even
                                                         // at a screw's maximum protrusion

/** Central-difference gradient of a screwsTall x screwsWide row-major grid
 * with unit spacing, matching numpy's np.gradient(grid) (default
 * edge_order=1) exactly: interior points use (next - prev) / 2, and the
 * first/last point along each axis fall back to a plain forward/backward
 * difference. Returns [dzdy, dzdx] -- dzdy is the gradient along axis 0
 * (down each column, i.e. the row/y direction), dzdx along axis 1 (across
 * each row, i.e. the column/x direction), matching mosaic_core.py's
 * `dzdy, dzdx = np.gradient(...)` unpacking order. */
function gradient2d(grid, screwsWide, screwsTall) {
  const dzdy = new Float64Array(screwsWide * screwsTall);
  const dzdx = new Float64Array(screwsWide * screwsTall);

  for (let col = 0; col < screwsWide; col++) {
    for (let row = 0; row < screwsTall; row++) {
      const idx = row * screwsWide + col;
      if (screwsTall === 1) {
        dzdy[idx] = 0;
      } else if (row === 0) {
        dzdy[idx] = grid[(row + 1) * screwsWide + col] - grid[row * screwsWide + col];
      } else if (row === screwsTall - 1) {
        dzdy[idx] = grid[row * screwsWide + col] - grid[(row - 1) * screwsWide + col];
      } else {
        dzdy[idx] = (grid[(row + 1) * screwsWide + col] - grid[(row - 1) * screwsWide + col]) / 2;
      }
    }
  }

  for (let row = 0; row < screwsTall; row++) {
    const rowBase = row * screwsWide;
    for (let col = 0; col < screwsWide; col++) {
      const idx = rowBase + col;
      if (screwsWide === 1) {
        dzdx[idx] = 0;
      } else if (col === 0) {
        dzdx[idx] = grid[rowBase + col + 1] - grid[rowBase + col];
      } else if (col === screwsWide - 1) {
        dzdx[idx] = grid[rowBase + col] - grid[rowBase + col - 1];
      } else {
        dzdx[idx] = (grid[rowBase + col + 1] - grid[rowBase + col - 1]) / 2;
      }
    }
  }

  return [dzdy, dzdx];
}

/** Box-average the source image down to screwsWide x screwsTall (the same
 * box filter every other mode uses for its own grid), convert to Rec.601
 * luminance, smooth it (reuses Lithophane's own smoothing -- a single
 * noisy pixel shouldn't send one screw to a wildly different depth than
 * its neighbors), then map to a physical protrusion depth in mm: flush/
 * shallow = bright (minDepthMm), deep/protruding = dark (maxDepthMm), or
 * the reverse with invert=true. Returns a Float64Array of length
 * screwsWide*screwsTall, row-major. */
export function sampleScrewartDepthGrid(sourceCanvas, screwsWide, screwsTall, minDepthMm, maxDepthMm,
  invert = false) {
  if (maxDepthMm <= minDepthMm) {
    throw new Error("Max depth must be greater than min depth.");
  }
  const grid = imageToGrid(sourceCanvas, screwsWide, screwsTall);
  let luminance = new Float64Array(screwsWide * screwsTall);
  for (let idx = 0; idx < grid.length; idx++) {
    const [r, g, b] = grid[idx];
    luminance[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
  }
  luminance = smoothLithophaneLuminance(luminance, screwsWide, screwsTall);
  const depthGrid = new Float64Array(screwsWide * screwsTall);
  const span = maxDepthMm - minDepthMm;
  for (let idx = 0; idx < luminance.length; idx++) {
    const t = invert ? luminance[idx] : (1.0 - luminance[idx]);
    depthGrid[idx] = minDepthMm + t * span;
  }
  return depthGrid;
}

/** The per-screw brightness (0-1) used to shade the preview render: a base
 * tone from the screw's own depth (flush=bright, deep=dark -- the same
 * convention renderLithophanePreview uses) blended with a hillshade term
 * from the LOCAL DEPTH GRADIENT (how this screw's depth compares to its
 * neighbors), simulating a raking light source -- the same technique a GIS
 * terrain hillshade uses: surface normal from (-dz/dx, -dz/dy, 1), dotted
 * with the light direction. Pure base tone alone looks like a flat
 * grayscale photo; pure hillshade alone only shows edges -- blending the
 * two keeps the photo recognizable while still popping with directional 3D
 * shading. Mirrors mosaic_core.py's screwart_tone_grid exactly. */
export function screwartToneGrid(depthGrid, screwsWide, screwsTall, minDepthMm, maxDepthMm, options = {}) {
  const {
    lightDir = SCREWART_LIGHT_DIR, ambient = SCREWART_AMBIENT,
    gradientBoost = SCREWART_GRADIENT_BOOST, hillshadeWeight = SCREWART_HILLSHADE_WEIGHT,
  } = options;

  const n = screwsWide * screwsTall;
  const span = maxDepthMm - minDepthMm;

  const boosted = new Float64Array(n);
  for (let i = 0; i < n; i++) boosted[i] = depthGrid[i] * gradientBoost;
  const [dzdy, dzdx] = gradient2d(boosted, screwsWide, screwsTall);

  const [lx0, ly0, lz0] = lightDir;
  const llen = Math.sqrt(lx0 * lx0 + ly0 * ly0 + lz0 * lz0);
  const lx = lx0 / llen, ly = ly0 / llen, lz = lz0 / llen;

  const tone = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = span > 0 ? (depthGrid[i] - minDepthMm) / span : 0;
    const baseV = 1.0 - t;

    const nx0 = -dzdx[i], ny0 = -dzdy[i], nz0 = 1.0;
    const nlen = Math.sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0);
    const nx = nx0 / nlen, ny = ny0 / nlen, nz = nz0 / nlen;

    let dot = nx * lx + ny * ly + nz * lz;
    dot = Math.min(1, Math.max(0, dot));
    const hillshade = ambient + (1 - ambient) * dot;

    const v = baseV * ((1 - hillshadeWeight) + hillshadeWeight * hillshade);
    tone[i] = Math.min(1, Math.max(0, v));
  }
  return tone;
}

/** Render the depth grid as a grid of flat-shaded screw heads nearly
 * filling each cell (a thin board-color gap between them, like Rubik's/
 * Dice's own cell gap), each tinted by screwartToneGrid's per-screw
 * brightness -- deliberately simple flat circles (no per-screw highlight/
 * shadow decoration drawn on top) since the hillshade tone itself already
 * carries the 3D read. Mirrors mosaic_core.py's render_screwart_mosaic. */
export function renderScrewartMosaic(depthGrid, screwsWide, screwsTall, minDepthMm, maxDepthMm,
  cellSize, createCanvasFn, options = {}) {
  const { boardColor = SCREWART_BOARD_COLOR, screwColor = SCREWART_SCREW_COLOR } = options;
  const tone = screwartToneGrid(depthGrid, screwsWide, screwsTall, minDepthMm, maxDepthMm, options);

  const imgW = screwsWide * cellSize, imgH = screwsTall * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${boardColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const radius = cellSize * 0.46;
  for (let row = 0; row < screwsTall; row++) {
    for (let col = 0; col < screwsWide; col++) {
      const v = tone[row * screwsWide + col];
      // Math.trunc (not round) to match Python's int(c * v) truncation.
      const r = Math.trunc(screwColor[0] * v);
      const g = Math.trunc(screwColor[1] * v);
      const b = Math.trunc(screwColor[2] * v);
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/** Printable page 1 of the build guide: an outlined grid where every cell
 * shows its screw's target depth in mm (one decimal place), with a heavier
 * border every blockSize cells and a small "row,col" position label at
 * each block's top-left corner -- same navigation convention as Rubik's
 * 3x3-cube-block build sheet, just sized for a continuous depth value
 * instead of a letter code. Mirrors mosaic_core.py's
 * render_screwart_build_sheet. */
export function renderScrewartBuildSheet(depthGrid, screwsWide, screwsTall, cellSize, createCanvasFn,
  options = {}) {
  const {
    bgColor = [255, 255, 255], lineColor = [200, 200, 200], blockLineColor = [20, 20, 20],
    textColor = [20, 20, 20], blockSize = 10, mask = null,
  } = options;

  const imgW = screwsWide * cellSize, imgH = screwsTall * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
  ctx.lineWidth = 1;
  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = `${Math.round(cellSize * 0.30)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let row = 0; row < screwsTall; row++) {
    for (let col = 0; col < screwsWide; col++) {
      if (mask && !mask[row * screwsWide + col]) continue; // outside Crop & Shape: no screw
      const x0 = col * cellSize, y0 = row * cellSize;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cellSize, cellSize);
      const depth = depthGrid[row * screwsWide + col];
      ctx.fillText(depth.toFixed(1), x0 + cellSize / 2, y0 + cellSize / 2);
    }
  }

  const blockBorderWidth = Math.max(2, Math.round(cellSize * 0.05));
  ctx.strokeStyle = `rgb(${blockLineColor.join(",")})`;
  ctx.lineWidth = blockBorderWidth;
  ctx.fillStyle = `rgb(${blockLineColor.join(",")})`;
  ctx.font = `${Math.round(cellSize * 0.24)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let by = 0; by < screwsTall; by += blockSize) {
    for (let bx = 0; bx < screwsWide; bx += blockSize) {
      const x0 = bx * cellSize, y0 = by * cellSize;
      const x1 = Math.min(screwsWide * cellSize, x0 + blockSize * cellSize);
      const y1 = Math.min(screwsTall * cellSize, y0 + blockSize * cellSize);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillText(`${by + 1},${bx + 1}`, x0 + 4, y0 + 2);
    }
  }
  return canvas;
}

/** Page 2 of the build guide: screw count, configured depth range, and a
 * suggested screw length (max protrusion + a minimum thread-embedment
 * allowance, since a screw driven out to its maximum depth still needs
 * some threads biting into the board to hold). Mirrors mosaic_core.py's
 * render_screwart_info_page. */
export function renderScrewartInfoPage(depthGrid, screwsWide, screwsTall, minDepthMm, maxDepthMm,
  createCanvasFn, options = {}) {
  const { bgColor = [255, 255, 255], textColor = [20, 20, 20], mask = null } = options;
  let screwCount = 0;
  const suggestedLength = maxDepthMm + SCREWART_MIN_EMBEDMENT_MM;

  let actualMin = Infinity, actualMax = -Infinity;
  for (let i = 0; i < depthGrid.length; i++) {
    if (mask && !mask[i]) continue;
    screwCount++;
    if (depthGrid[i] < actualMin) actualMin = depthGrid[i];
    if (depthGrid[i] > actualMax) actualMax = depthGrid[i];
  }

  const imgW = 500, imgH = 250, pad = 20;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Screw Art Build Guide", pad, pad + 16);

  const lines = [
    `${screwCount} screws needed total (${screwsWide}×${screwsTall} grid)`,
    `Depth range: ${minDepthMm.toFixed(1)}–${maxDepthMm.toFixed(1)}mm protrusion from flush`,
    `Actual depth used: ${actualMin.toFixed(1)}–${actualMax.toFixed(1)}mm`,
    `Suggested screw length: ≥${Math.round(suggestedLength)}mm (max protrusion +`,
    `  ~${SCREWART_MIN_EMBEDMENT_MM.toFixed(0)}mm thread engagement)`,
    "",
    "Each number on the grid page is how far that screw should sit",
    "above the board surface, in millimeters.",
  ];
  ctx.font = "15px sans-serif";
  ctx.fillStyle = "rgb(90,90,90)";
  let y = pad + 38 + 15;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += 23;
  }
  return canvas;
}
