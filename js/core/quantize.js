/**
 * quantize.js
 * Fixed-palette nearest-color matching (perceptual, CIE Lab distance) and
 * the monochrome black-to-color-to-white ramp builder. Ported from
 * mosaic_core.py's quantize_grid_fixed_palette / build_monochrome_palette.
 */

import { rgbToLab, labToRgb } from "./color.js";

/**
 * Match every point in `points` (array of [r,g,b]) to its nearest color in
 * `palette` (array of [r,g,b]), using Lab-space distance. Returns
 * { labels, palette } where labels[i] indexes into palette. `palette` is
 * returned unchanged/untouched so numbering matches what was passed in,
 * even for colors that end up unused (0 matches).
 */
export function quantizeToFixedPalette(points, palette) {
  const labPoints = points.map(rgbToLab);
  const labPalette = palette.map(rgbToLab);

  const labels = new Int32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let best = 0, bestDist = Infinity;
    const p = labPoints[i];
    for (let c = 0; c < labPalette.length; c++) {
      const q = labPalette[c];
      const dl = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2];
      const d = dl * dl + da * da + db * db;
      if (d < bestDist) { bestDist = d; best = c; }
    }
    labels[i] = best;
  }
  return { labels, palette };
}

/**
 * Build a perceptually smooth ramp of nShades colors running from black,
 * through baseRgb at the midpoint, to white -- interpolated in Lab space
 * so it doesn't muddy through gray the way a plain RGB blend would.
 */
export function buildMonochromePalette(baseRgb, nShades = 12) {
  nShades = Math.max(3, nShades);
  const blackLab = rgbToLab([0, 0, 0]);
  const baseLab = rgbToLab(baseRgb);
  const whiteLab = rgbToLab([255, 255, 255]);

  const colors = [];
  for (let i = 0; i < nShades; i++) {
    const t = i / (nShades - 1);
    let lab;
    if (t <= 0.5) {
      const lt = t / 0.5;
      lab = blackLab.map((v, idx) => v + (baseLab[idx] - v) * lt);
    } else {
      const lt = (t - 0.5) / 0.5;
      lab = baseLab.map((v, idx) => v + (whiteLab[idx] - v) * lt);
    }
    const rgb = labToRgb(lab).map(v => Math.round(Math.max(0, Math.min(255, v))));
    colors.push(rgb);
  }
  return colors;
}
