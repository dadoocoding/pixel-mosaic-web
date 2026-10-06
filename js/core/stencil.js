/**
 * stencil.js
 * Stencil mode: photo -> 3-6 cut-and-paint stencil layers. Ported from
 * mosaic_core.py's "Stencil mode" section -- keep the two in sync
 * (parity_stencil.*). Everything from the luminance array onward is
 * integer math so both implementations agree exactly.
 *
 * Layer 1 is the whole subject silhouette in the darkest colour; every
 * later layer is a lighter tone band painted over it ("overlap"), or only
 * its own band ("separated"). Layers are Uint8Array(w*h), 1 = paint/cut.
 */

export const STENCIL_MIN_LAYERS = 3;
export const STENCIL_MAX_LAYERS = 6;
export const STENCIL_DEFAULT_COLORS = [[20, 20, 20], [178, 34, 34], [230, 180, 70],
  [240, 240, 235], [120, 170, 210], [90, 140, 80]];
export const STENCIL_DEFAULT_BG = [168, 207, 230];
export const STENCIL_PANEL_COLOR = [221, 225, 227];
export const STENCIL_WORK_DETAIL = 320;

/** Canvas -> {rgb: Uint8Array(w*h*3), w, h}: alpha flattened onto white,
 *  long side resized to `detail` px. */
export function stencilPrepareRgb(canvas, detail, createCanvasFn) {
  const scale = detail / Math.max(canvas.width, canvas.height);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const c = createCanvasFn(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
  }
  return { rgb, w, h };
}

export function stencilLuminance(rgb, w, h) {
  const out = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = Math.floor((299 * rgb[i * 3] + 587 * rgb[i * 3 + 1] + 114 * rgb[i * 3 + 2] + 500) / 1000);
  }
  return out;
}

function blurAxis(a, w, h, radius, horizontal) {
  if (radius <= 0) return a;
  const out = new Int32Array(w * h);
  const k = 2 * radius + 1;
  const lines = horizontal ? h : w;
  const n = horizontal ? w : h;
  const idx = (line, i) => (horizontal ? line * w + i : i * w + line);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += a[idx(line, Math.min(n - 1, Math.max(0, j)))];
    for (let i = 0; i < n; i++) {
      out[idx(line, i)] = Math.floor((2 * sum + k) / (2 * k));
      sum += a[idx(line, Math.min(n - 1, i + radius + 1))] - a[idx(line, Math.max(0, i - radius))];
    }
  }
  return out;
}

export function stencilBoxBlur(a, w, h, radius, passes = 1) {
  let out = Int32Array.from(a);
  for (let p = 0; p < Math.max(0, passes); p++) {
    out = blurAxis(blurAxis(out, w, h, radius, true), w, h, radius, false);
  }
  return out;
}

/** 4-connected labelling in row-major first-pixel order. */
export function stencilLabel(mask, w, h) {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  let cur = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    cur++;
    labels[start] = cur;
    stack.length = 0;
    stack.push(start);
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % w;
      let q;
      if (x > 0) { q = p - 1; if (mask[q] && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (x < w - 1) { q = p + 1; if (mask[q] && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (p >= w) { q = p - w; if (mask[q] && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (p < (h - 1) * w) { q = p + w; if (mask[q] && !labels[q]) { labels[q] = cur; stack.push(q); } }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

export function stencilCleanup(mask, w, h, minArea) {
  const out = Uint8Array.from(mask);
  if (minArea <= 1) return out;
  let { labels, sizes } = stencilLabel(out, w, h);
  for (let i = 0; i < w * h; i++) if (out[i] && sizes[labels[i]] < minArea) out[i] = 0;
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = out[i] ? 0 : 1;
  ({ labels, sizes } = stencilLabel(inv, w, h));
  for (let i = 0; i < w * h; i++) if (!out[i] && sizes[labels[i]] < minArea) out[i] = 1;
  return out;
}

export function stencilBackgroundMask(rgb, w, h, tolerance) {
  const ch = [0, 1, 2].map((c) => {
    const plane = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) plane[i] = rgb[i * 3 + c];
    return stencilBoxBlur(plane, w, h, 2, 1);
  });
  const med = ch.map((plane) => {
    const vals = [];
    for (let x = 0; x < w; x++) vals.push(plane[x]);
    for (let x = 0; x < w; x++) vals.push(plane[(h - 1) * w + x]);
    for (let y = 1; y < h - 1; y++) vals.push(plane[y * w]);
    for (let y = 1; y < h - 1; y++) vals.push(plane[y * w + w - 1]);
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  });
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(Math.abs(ch[0][i] - med[0]), Math.abs(ch[1][i] - med[1]), Math.abs(ch[2][i] - med[2]));
    ok[i] = d <= tolerance ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (ok[p] && !seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < (h - 1) * w) push(p + w);
  }
  return seen;
}

export function stencilThresholds(lum, subject, nLayers) {
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let i = 0; i < lum.length; i++) if (subject[i]) { hist[lum[i]]++; total++; }
  const ts = [];
  for (let k = 1; k < nLayers; k++) {
    let cum = 0, t = 255;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum * nLayers >= total * k) { t = v; break; }
    }
    ts.push(t);
  }
  return ts;
}

export function stencilAddBridges(mask, w, h, width, maxIter = 8) {
  const m = Uint8Array.from(mask);
  if (width <= 0) return m;
  const half = Math.floor(width / 2);
  for (let iter = 0; iter < maxIter; iter++) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = m[i] ? 0 : 1;
    const { labels, sizes } = stencilLabel(inv, w, h);
    const border = new Set();
    for (let x = 0; x < w; x++) { border.add(labels[x]); border.add(labels[(h - 1) * w + x]); }
    for (let y = 0; y < h; y++) { border.add(labels[y * w]); border.add(labels[y * w + w - 1]); }
    const island = new Set();
    for (let l = 1; l < sizes.length; l++) if (!border.has(l)) island.add(l);
    if (island.size === 0) break;
    const top = new Map(), bottom = new Map(), left = new Map(), right = new Map();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = labels[y * w + x];
        if (!island.has(l)) continue;
        if (!top.has(l)) top.set(l, [x, y]);
        bottom.set(l, [x, y]);
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const l = labels[y * w + x];
        if (!island.has(l)) continue;
        if (!left.has(l)) left.set(l, [x, y]);
        right.set(l, [x, y]);
      }
    }
    const carves = [];
    for (const l of [...island].sort((a, b) => a - b)) {
      let best = null;
      const dirs = [[0, -1, top.get(l)], [0, 1, bottom.get(l)], [-1, 0, left.get(l)], [1, 0, right.get(l)]];
      for (const [dx, dy, anchor] of dirs) {
        let [x, y] = anchor;
        let steps = 0, hit = false;
        for (;;) {
          x += dx; y += dy;
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          steps++;
          const lab = labels[y * w + x];
          if (lab > 0 && lab !== l) { hit = true; break; }
        }
        if (hit && (best === null || steps < best[0])) best = [steps, dx, dy, anchor];
      }
      if (best) carves.push(best);
    }
    if (carves.length === 0) break;
    for (const [steps, dx, dy, [ax, ay]] of carves) {
      for (let s = 1; s < steps; s++) {
        const cx = ax + dx * s, cy = ay + dy * s;
        for (let o = -half; o < -half + width; o++) {
          const px = dx === 0 ? cx + o : cx;
          const py = dx === 0 ? cy : cy + o;
          if (px >= 0 && px < w && py >= 0 && py < h) m[py * w + px] = 0;
        }
      }
    }
  }
  return m;
}

/** rgb: Uint8Array(w*h*3). shapeMask: optional Uint8Array(w*h). */
export function buildStencilLayers(rgb, w, h, options = {}) {
  const {
    numLayers = 4, smooth = 3, removeBg = true, bgTolerance = 40, minArea = 12,
    bridgeWidth = 0, overlap = true, shapeMask = null,
  } = options;
  const n = Math.max(STENCIL_MIN_LAYERS, Math.min(STENCIL_MAX_LAYERS, Math.floor(numLayers)));
  let lum = stencilLuminance(rgb, w, h);
  if (smooth > 0) lum = stencilBoxBlur(lum, w, h, Math.floor(smooth), 2);
  const bg = removeBg ? stencilBackgroundMask(rgb, w, h, Math.floor(bgTolerance)) : new Uint8Array(w * h);
  let subject = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) subject[i] = (!bg[i] && (!shapeMask || shapeMask[i])) ? 1 : 0;
  subject = stencilCleanup(subject, w, h, Math.floor(minArea));
  if (shapeMask) for (let i = 0; i < w * h; i++) if (!shapeMask[i]) subject[i] = 0;
  const ts = stencilThresholds(lum, subject, n);
  const layers = [];
  for (let k = 0; k < n; k++) {
    let m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!subject[i]) continue;
      let on;
      if (k === 0) on = overlap ? true : lum[i] <= ts[0];
      else {
        on = lum[i] > ts[k - 1];
        if (!overlap && k < n - 1) on = on && lum[i] <= ts[k];
      }
      m[i] = on ? 1 : 0;
    }
    m = stencilCleanup(m, w, h, Math.floor(minArea));
    for (let i = 0; i < w * h; i++) if (!subject[i]) m[i] = 0;
    if (bridgeWidth > 0) m = stencilAddBridges(m, w, h, Math.floor(bridgeWidth));
    layers.push(m);
  }
  return { layers, subject, thresholds: ts, w, h };
}

export function stencilLayerStats(layers) {
  const total = layers[0].length;
  return layers.map((m, i) => {
    let px = 0;
    for (let j = 0; j < m.length; j++) px += m[j];
    return { layer: i + 1, pixels: px, percent: Math.round((1000 * px) / total) / 10 };
  });
}

// --- Vector outlines (SVG) --------------------------------------------------

export function stencilMaskLoops(mask, w, h) {
  const edges = new Map(); // start vertex -> [{end, used, dir}]
  const order = [];
  const W1 = w + 1;
  const add = (x0, y0, x1, y1) => {
    const k = y0 * W1 + x0;
    const e = { end: x1 + y1 * W1, used: false, dir: [x1 - x0, y1 - y0], key: k };
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(e);
    order.push(e);
  };
  const on = (x, y) => mask[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (y === 0 || !on(x, y - 1)) add(x, y, x + 1, y);
      if (x === w - 1 || !on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (y === h - 1 || !on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !on(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const e0 of order) {
    if (e0.used) continue;
    const pts = [];
    let e = e0;
    for (;;) {
      e.used = true;
      pts.push([e.key % W1, Math.floor(e.key / W1)]);
      const nk = e.end;
      const dIn = e.dir;
      const cands = (edges.get(nk) || []).filter((c) => !c.used);
      if (cands.length === 0) break;
      let next;
      if (cands.length > 1) {
        const prefs = [[-dIn[1], dIn[0]], dIn, [dIn[1], -dIn[0]]];
        next = null;
        for (const p of prefs) {
          next = cands.find((c) => c.dir[0] === p[0] && c.dir[1] === p[1]) || null;
          if (next) break;
        }
        if (!next) next = cands[0];
      } else next = cands[0];
      e = next;
      if (e === e0) break;
    }
    const n = pts.length;
    const keep = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) keep.push(b);
    }
    loops.push(keep.length >= 3 ? keep : pts);
  }
  return loops;
}

function chaikin(pts, iterations = 2) {
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    pts = out;
  }
  return pts;
}

/** 2-decimal, round-half-up (matches Python's _stencil_fmt). */
function fmt(v) {
  const n = Math.floor(v * 100 + 0.5);
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

export function stencilSvgPathData(mask, w, h, smooth = true) {
  return stencilMaskLoops(mask, w, h).map((loop) => {
    const pts = smooth ? chaikin(loop, 2) : loop;
    return "M" + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" L") + " Z";
  }).join(" ");
}

export function stencilSvgText(mask, w, h, index, total, widthIn, color = [0, 0, 0]) {
  const heightIn = (widthIn * h) / w;
  const hex = "#" + color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
  const d = stencilSvgPathData(mask, w, h);
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${widthIn.toFixed(3)}in" height="${heightIn.toFixed(3)}in" viewBox="0 0 ${w} ${h}">\n`
    + `  <title>Stencil ${index} of ${total} (cut out the filled shapes)</title>\n`
    + `  <path id="stencil-${index}" fill="${hex}" fill-rule="evenodd" d="${d}"/>\n</svg>\n`;
}

// --- Rendering (canvas) -----------------------------------------------------

/** Smoothly resample a 0/1 mask to outW x outH (bilinear, 50% cut). */
function scaledMask(mask, w, h, outW, outH, createCanvasFn) {
  const src = createCanvasFn(w, h);
  const sctx = src.getContext("2d");
  const id = sctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = mask[i] ? 255 : 0;
    id.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  const dst = createCanvasFn(outW, outH);
  const dctx = dst.getContext("2d");
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src, 0, 0, outW, outH);
  const d = dctx.getImageData(0, 0, outW, outH).data;
  const out = new Uint8Array(outW * outH);
  for (let i = 0; i < outW * outH; i++) out[i] = d[i * 4] >= 128 ? 1 : 0;
  return out;
}

function paintMasks(outW, outH, base, paints, createCanvasFn) {
  const canvas = createCanvasFn(outW, outH);
  const ctx = canvas.getContext("2d");
  const id = ctx.createImageData(outW, outH);
  for (let i = 0; i < outW * outH; i++) {
    id.data[i * 4] = base[0]; id.data[i * 4 + 1] = base[1]; id.data[i * 4 + 2] = base[2]; id.data[i * 4 + 3] = 255;
  }
  for (const { mask, color } of paints) {
    for (let i = 0; i < outW * outH; i++) {
      if (mask[i]) { id.data[i * 4] = color[0]; id.data[i * 4 + 1] = color[1]; id.data[i * 4 + 2] = color[2]; }
    }
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

export function renderStencilComposite(layers, w, h, colors, bgColor, outWidth, createCanvasFn) {
  const outH = Math.max(1, Math.round((outWidth * h) / w));
  const paints = layers.map((m, k) => ({
    mask: scaledMask(m, w, h, outWidth, outH, createCanvasFn), color: colors[k % colors.length],
  }));
  return paintMasks(outWidth, outH, bgColor, paints, createCanvasFn);
}

export function renderStencilSheet(mask, w, h, index, color, outWidth, createCanvasFn,
  panelColor = STENCIL_PANEL_COLOR) {
  const outH = Math.max(1, Math.round((outWidth * h) / w));
  const canvas = paintMasks(outWidth, outH, panelColor,
    [{ mask: scaledMask(mask, w, h, outWidth, outH, createCanvasFn), color }], createCanvasFn);
  const ctx = canvas.getContext("2d");
  const b = Math.max(2, Math.floor(outWidth / 120));
  ctx.strokeStyle = "rgb(50,50,50)";
  ctx.lineWidth = b;
  ctx.strokeRect(b / 2, b / 2, outWidth - b, outH - b);
  const fs = Math.max(16, Math.floor(outWidth / 8));
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const label = String(index);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = `rgb(${panelColor.join(",")})`;
  ctx.fillRect(outWidth - b - 8 - tw - 6, b + 4 - 2, tw + 12, fs + 8);
  ctx.fillStyle = "rgb(20,20,20)";
  ctx.fillText(label, outWidth - b - 8, b + 4);
  return canvas;
}

/** Real-size cutting template: black = cut out, white = stays. */
export function renderStencilPrintPage(mask, w, h, index, total, widthIn, createCanvasFn,
  dpi = 150, marginIn = 0.6) {
  const heightIn = (widthIn * h) / w;
  const sw = Math.max(1, Math.round(widthIn * dpi)), sh = Math.max(1, Math.round(heightIn * dpi));
  const m = Math.round(marginIn * dpi);
  const body = paintMasks(sw, sh, [255, 255, 255],
    [{ mask: scaledMask(mask, w, h, sw, sh, createCanvasFn), color: [0, 0, 0] }], createCanvasFn);
  const page = createCanvasFn(sw + 2 * m, sh + 2 * m);
  const ctx = page.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.drawImage(body, m, m);
  ctx.strokeStyle = "rgb(150,150,150)";
  ctx.lineWidth = 1;
  ctx.strokeRect(m + 0.5, m + 0.5, sw - 1, sh - 1);
  const arm = Math.max(6, Math.floor(m / 3));
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  for (const [cx, cy] of [[m / 2, m / 2], [m + sw + m / 2, m / 2], [m / 2, m + sh + m / 2], [m + sw + m / 2, m + sh + m / 2]]) {
    ctx.beginPath(); ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, arm / 2, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#000";
  ctx.font = `${Math.max(12, Math.floor(m / 3))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`Stencil ${index} of ${total} — cut out the BLACK areas`, m + sw / 2, m / 2);
  return page;
}
