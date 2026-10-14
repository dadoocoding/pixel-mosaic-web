/**
 * halftone.js
 * Halftone Dots: equally spaced dots whose DIAMETER varies with tone (a
 * perforated-panel portrait). Ported from mosaic_core.py's "Halftone Dots"
 * section -- keep in sync (parity_halftone.*).
 * Grids are flat row-major arrays: index = row*dotsWide + col.
 */
import { imageToGrid } from "./grid.js";

export const HALFTONE_MIN_DOTS_ACROSS = 10;
export const HALFTONE_MAX_DOTS_ACROSS = 200;
export const HALFTONE_DEFAULT_DOT_COLOR = [30, 30, 30];
export const HALFTONE_DEFAULT_BG_COLOR = [245, 245, 240];

/** Darkness grid t in [0,1] (dark = 1 unless invert). */
export function sampleHalftoneToneGrid(sourceCanvas, dotsW, dotsH, invert = false, contrast = 1.0) {
  const grid = imageToGrid(sourceCanvas, dotsW, dotsH);
  const t = new Float64Array(dotsW * dotsH);
  for (let i = 0; i < t.length; i++) {
    const [r, g, b] = grid[i];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
    let v = invert ? lum : 1.0 - lum;
    if (contrast !== 1.0) v = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
    t[i] = v;
  }
  return t;
}

/** Dot diameter as a fraction of pitch: fmin + (fmax-fmin)*sqrt(t), with the
 *  sqrt term optionally snapped to `steps` evenly spaced sizes. */
export function halftoneDiameterGrid(tone, minPct = 0, maxPct = 90, steps = 0) {
  if (maxPct <= minPct) throw new Error("Largest dot must be bigger than the smallest dot.");
  const fmin = minPct / 100.0, fmax = maxPct / 100.0;
  const out = new Float64Array(tone.length);
  for (let i = 0; i < tone.length; i++) {
    let s = Math.sqrt(Math.min(1, Math.max(0, tone[i])));
    if (steps && steps >= 2) {
      if (fmin <= 0) { out[i] = fmax * Math.floor(s * steps + 0.5) / steps; continue; }
      s = Math.floor(s * (steps - 1) + 0.5) / (steps - 1);
    }
    out[i] = fmin + (fmax - fmin) * s;
  }
  return out;
}

export function renderHalftone(diam, dotsW, dotsH, cellSize, createCanvasFn, options = {}) {
  const { dotColor = HALFTONE_DEFAULT_DOT_COLOR, bgColor = HALFTONE_DEFAULT_BG_COLOR, mask = null } = options;
  const canvas = createCanvasFn(dotsW * cellSize, dotsH * cellSize);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `rgb(${dotColor.join(",")})`;
  for (let row = 0; row < dotsH; row++) {
    for (let col = 0; col < dotsW; col++) {
      const i = row * dotsW + col;
      if (mask && !mask[i]) continue;
      const r = diam[i] * cellSize / 2;
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.arc((col + 0.5) * cellSize, (row + 0.5) * cellSize, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/** [[fraction, count, mmOrNull], ...] largest first, zero-size skipped. */
export function halftoneSizeCounts(diam, mask = null, pitchMm = 0) {
  const counts = new Map();
  for (let i = 0; i < diam.length; i++) {
    if (mask && !mask[i]) continue;
    const f = Math.floor(diam[i] * 1000 + 0.5) / 1000;
    if (f <= 0) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => b - a)
    .map((f) => [f, counts.get(f), pitchMm > 0 ? f * pitchMm : null]);
}

function fmt(v) {
  const n = Math.floor(v * 100 + 0.5);
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

export function halftoneCsvText(diam, dotsW, dotsH, pitchMm = 0, mask = null) {
  let total = 0;
  for (let i = 0; i < diam.length; i++) if ((!mask || mask[i]) && diam[i] > 0) total++;
  const lines = [`dots_total,${total}`];
  if (pitchMm > 0) lines.push(`pitch_mm,${fmt(pitchMm)}`);
  lines.push("");
  lines.push("row,col,diameter_pct" + (pitchMm > 0 ? ",diameter_mm" : ""));
  for (let row = 0; row < dotsH; row++) {
    for (let col = 0; col < dotsW; col++) {
      const i = row * dotsW + col;
      if (mask && !mask[i]) continue;
      if (diam[i] <= 0) continue;
      const n10 = Math.floor(diam[i] * 1000 + 0.5);
      let line = `${row + 1},${col + 1},${Math.floor(n10 / 10)}.${n10 % 10}`;
      if (pitchMm > 0) line += `,${fmt(diam[i] * pitchMm)}`;
      lines.push(line);
    }
  }
  return lines.join("\r\n") + "\r\n";
}

export function halftoneSvgText(diam, dotsW, dotsH, pitchMm = 0, mask = null,
  dotColor = HALFTONE_DEFAULT_DOT_COLOR) {
  const unit = pitchMm > 0 ? pitchMm : 100.0;
  const hex = "#" + dotColor.map((c) => c.toString(16).padStart(2, "0")).join("");
  const size = pitchMm > 0 ? ` width="${fmt(dotsW * unit)}mm" height="${fmt(dotsH * unit)}mm"` : "";
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${fmt(dotsW * unit)} ${fmt(dotsH * unit)}">`,
    `<g fill="${hex}">`];
  for (let row = 0; row < dotsH; row++) {
    for (let col = 0; col < dotsW; col++) {
      const i = row * dotsW + col;
      if (mask && !mask[i]) continue;
      if (diam[i] <= 0) continue;
      parts.push(`<circle cx="${fmt((col + 0.5) * unit)}" cy="${fmt((row + 0.5) * unit)}" r="${fmt(diam[i] * unit / 2)}"/>`);
    }
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}

export const HALFTONE_PRINT_DPI = 150;

/** One white page (Letter, orientation to suit the grid) with every dot as
 *  an open circle at its relative size -- print and colour in by hand. */
export function renderHalftonePrintable(diam, dotsW, dotsH, createCanvasFn, options = {}) {
  const { mask = null, paperIn = [8.5, 11], marginIn = 0.5, dpi = HALFTONE_PRINT_DPI } = options;
  let [pw, ph] = paperIn;
  if ((dotsW >= dotsH) !== (pw >= ph)) [pw, ph] = [ph, pw];
  const W = Math.round(pw * dpi), H = Math.round(ph * dpi), m = Math.round(marginIn * dpi);
  const pitch = Math.min((W - 2 * m) / dotsW, (H - 2 * m) / dotsH);
  const ox = (W - pitch * dotsW) / 2, oy = (H - pitch * dotsH) / 2;
  const canvas = createCanvasFn(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1, dpi / 100);
  for (let row = 0; row < dotsH; row++) {
    for (let col = 0; col < dotsW; col++) {
      const i = row * dotsW + col;
      if (mask && !mask[i]) continue;
      const r = diam[i] * pitch / 2;
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.arc(ox + (col + 0.5) * pitch, oy + (row + 0.5) * pitch, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return canvas;
}

/** Real-size tiling plan; mirrors mosaic_core.halftone_tile_layout. */
export function halftoneTileLayout(gridW, gridH, pitchIn, paperIn = [8.5, 11], marginIn = 0.5) {
  if (!(pitchIn > 0)) throw new Error("Set a dot spacing (Piece size) greater than 0.");
  let best = null;
  const lo = Math.min(...paperIn), hi = Math.max(...paperIn);
  for (const [pw, ph] of [[lo, hi], [hi, lo]]) {
    const cols = Math.floor((pw - 2 * marginIn) / pitchIn + 1e-9);
    const rows = Math.floor((ph - 2 * marginIn) / pitchIn + 1e-9);
    if (cols < 1 || rows < 1) continue;
    const across = Math.ceil(gridW / cols), down = Math.ceil(gridH / rows);
    if (!best || across * down < best.across * best.down) best = { pw, ph, cols, rows, across, down };
  }
  if (!best) throw new Error("The dot spacing is larger than a printable page; use a smaller Piece size.");
  return best;
}

/** Array of page canvases, real size, open circles, labelled. */
export function renderHalftonePrintablePages(diam, dotsW, dotsH, pitchIn, createCanvasFn, options = {}) {
  const { mask = null, paperIn = [8.5, 11], marginIn = 0.5, dpi = HALFTONE_PRINT_DPI } = options;
  const L = halftoneTileLayout(dotsW, dotsH, pitchIn, paperIn, marginIn);
  const W = Math.round(L.pw * dpi), H = Math.round(L.ph * dpi);
  const m = marginIn * dpi, pitch = pitchIn * dpi;
  const pages = [];
  for (let pr = 0; pr < L.down; pr++) {
    for (let pc = 0; pc < L.across; pc++) {
      const r0 = pr * L.rows, c0 = pc * L.cols;
      const r1 = Math.min(dotsH, r0 + L.rows), c1 = Math.min(dotsW, c0 + L.cols);
      const canvas = createCanvasFn(W, H);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#000000"; ctx.lineWidth = Math.max(1, dpi / 100);
      for (let row = r0; row < r1; row++) {
        for (let col = c0; col < c1; col++) {
          const i = row * dotsW + col;
          if (mask && !mask[i]) continue;
          const r = diam[i] * pitch / 2;
          if (r <= 0) continue;
          ctx.beginPath();
          ctx.arc(m + (col - c0 + 0.5) * pitch, m + (row - r0 + 0.5) * pitch, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#5a5a5a";
      ctx.font = `${Math.max(10, Math.round(dpi / 10))}px sans-serif`;
      ctx.fillText(`Page ${pr * L.across + pc + 1} of ${L.across * L.down}  (row ${pr + 1}, column ${pc + 1})`
        + `  -  dots rows ${r0 + 1}-${r1}, columns ${c0 + 1}-${c1}`, m, H - m * 0.6);
      pages.push(canvas);
    }
  }
  return pages;
}

export function parseDrillSizes(text) {
  const out = new Set();
  for (const tok of String(text).trim().split(/[,;\s]+/)) {
    if (!tok) continue;
    const v = Number(tok);
    if (!(v >= 0) || !Number.isFinite(v)) throw new Error(`Drill size '${tok}' must be a number of mm, 0 or more.`);
    out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

function fmtNum(n) {
  const t = (Math.floor(n * 100 + 0.5) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return t || "0";
}

/** Exactly the user's bits plus a "no dot" level; tone picks a level by equal
 *  steps of sqrt(tone). Mirrors mosaic_core.halftone_grid_from_bits. */
export function halftoneGridFromBits(tone, bitsMm, pitchMm) {
  if (!(pitchMm > 0)) throw new Error("Set a dot spacing (Piece size) to use your own drill sizes.");
  const bits = [...new Set(bitsMm.filter((b) => b > 0))].sort((a, b) => a - b);
  if (bits.length === 0) throw new Error("Enter at least one drill size in mm.");
  for (const b of bits) {
    if (b >= pitchMm) throw new Error(`Drill size ${fmtNum(b)} mm is as big as the dot spacing (${fmtNum(pitchMm)} mm); use smaller bits or a bigger spacing.`);
  }
  const levels = [0, ...bits];
  const n = bits.length;
  const out = new Float64Array(tone.length);
  for (let i = 0; i < tone.length; i++) {
    const s = Math.sqrt(Math.min(1, Math.max(0, tone[i])));
    out[i] = levels[Math.floor(s * n + 0.5)] / pitchMm;
  }
  return out;
}

export function halftoneSuggestBits(pitchMm, minPct, maxPct, steps) {
  steps = Math.max(2, Math.floor(steps));
  const sizes = new Set();
  for (let i = 0; i < steps; i++) {
    const f = (minPct <= 0 ? maxPct * (i + 1) / steps : minPct + (maxPct - minPct) * i / (steps - 1)) / 100;
    const v = Math.floor(f * pitchMm * 10 + 0.5) / 10;
    if (v > 0) sizes.add(v);
  }
  return [...sizes].sort((a, b) => a - b);
}
