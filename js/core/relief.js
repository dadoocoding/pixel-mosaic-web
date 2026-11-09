// Layered Relief mode: tone-banded layers stacked into a paper/board relief.
// Port of the "Layered Relief" section of python/mosaic_core.py -- integer
// math throughout so both apps produce identical pieces, heights and SVG.
import {
  stencilLuminance, stencilMedian, stencilBoxBlur, stencilLabel, stencilMaskLoops, chaikin, fmt,
} from "./stencil.js";

export const RELIEF_MIN_COLORS = 3;
export const RELIEF_MAX_COLORS = 8;
export const RELIEF_DEFAULT_COLORS = 5;
export const RELIEF_WORK_DETAIL = 300;
export const RELIEF_MIN_LEVELS = 2;
export const RELIEF_MAX_LEVELS = 8;
export const RELIEF_DEFAULT_LEVELS = 6;
export const RELIEF_MAX_STEP = 4;
export const RELIEF_HEIGHT_MODES = ["nesting", "tone"];
export const RELIEF_MAX_DOME = 3;
export const RELIEF_DEFAULT_DOME = 2;
export const RELIEF_DEFAULT_SMOOTH = 1;
export const RELIEF_DEFAULT_MIN_AREA = 12;
export const RELIEF_MATERIALS = [
  ["Cardstock (~0.3 mm)", 0.3],
  ["Heavy cardstock / poster board (~0.5 mm)", 0.5],
  ["Chipboard (~1 mm)", 1.0],
  ["Thin basswood 1/16 in (~1.6 mm)", 1.6],
  ["Craft foam (~2 mm)", 2.0],
];
export const RELIEF_BASE_MM = 3.0;
export const RELIEF_CLEARANCE_MM = 3.0;

export function reliefToneBands(lumS, n, numColors) {
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, lumS[i]))]++;
  const cum = new Array(256);
  let run = 0;
  for (let i = 0; i < 256; i++) { run += hist[i]; cum[i] = run; }
  const total = cum[255];
  const bands = new Int32Array(n);
  for (let k = 1; k < numColors; k++) {
    let t = 256;
    for (let i = 0; i < 256; i++) if (cum[i] * numColors >= k * total) { t = i; break; }
    const thr = Math.min(t, 255);
    for (let i = 0; i < n; i++) if (lumS[i] > thr) bands[i]++;
  }
  return bands;
}

/** 4-connected labelling of equal-valued neighbours (row-major first pixel order). */
export function reliefLabelSame(vals, w, h) {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  let cur = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start]) continue;
    cur++;
    const v = vals[start];
    labels[start] = cur;
    stack.length = 0;
    stack.push(start);
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % w;
      let q;
      if (x > 0) { q = p - 1; if (vals[q] === v && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (x < w - 1) { q = p + 1; if (vals[q] === v && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (p >= w) { q = p - w; if (vals[q] === v && !labels[q]) { labels[q] = cur; stack.push(q); } }
      if (p < (h - 1) * w) { q = p + w; if (vals[q] === v && !labels[q]) { labels[q] = cur; stack.push(q); } }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

export function reliefMergeSmall(bands, w, h, minArea, maxIter = 6) {
  let out = Int32Array.from(bands);
  if (minArea <= 1) return out;
  for (let it = 0; it < maxIter; it++) {
    const { labels, sizes } = reliefLabelSame(out, w, h);
    const small = sizes.map((s, i) => i > 0 && s < minArea);
    if (!small.some(Boolean)) break;
    const counts = new Map();
    const bump = (l, nb) => { const k = l * 64 + nb; counts.set(k, (counts.get(k) || 0) + 1); };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (y < h - 1) {
          const q = p + w;
          if (labels[p] !== labels[q]) {
            if (small[labels[p]]) bump(labels[p], out[q]);
            if (small[labels[q]]) bump(labels[q], out[p]);
          }
        }
        if (x < w - 1) {
          const q = p + 1;
          if (labels[p] !== labels[q]) {
            if (small[labels[p]]) bump(labels[p], out[q]);
            if (small[labels[q]]) bump(labels[q], out[p]);
          }
        }
      }
    }
    const own = new Map();
    for (let i = 0; i < w * h; i++) if (small[labels[i]] && !own.has(labels[i])) own.set(labels[i], out[i]);
    const target = new Map(); // label -> {c, d, nb}
    for (const [k, c] of counts) {
      const l = Math.floor(k / 64), nb = k % 64;
      const d = Math.abs(nb - own.get(l));
      const cur = target.get(l);
      if (!cur || c > cur.c || (c === cur.c && (d < cur.d || (d === cur.d && nb < cur.nb)))) target.set(l, { c, d, nb });
    }
    if (target.size === 0) break;
    const next = Int32Array.from(out);
    for (let i = 0; i < w * h; i++) {
      const t = target.get(labels[i]);
      if (t && small[labels[i]]) next[i] = t.nb;
    }
    out = next;
  }
  return out;
}

export function reliefBandColors(rgb, bands, n, numColors) {
  const cols = [];
  for (let b = 0; b < numColors; b++) {
    let cnt = 0, r = 0, g = 0, bl = 0;
    for (let i = 0; i < n; i++) if (bands[i] === b) { cnt++; r += rgb[i * 3]; g += rgb[i * 3 + 1]; bl += rgb[i * 3 + 2]; }
    if (cnt === 0) {
      const v = Math.floor((255 * b) / Math.max(1, numColors - 1));
      cols.push([v, v, v]);
      continue;
    }
    const h2 = Math.floor(cnt / 2);
    cols.push([Math.floor((r + h2) / cnt), Math.floor((g + h2) / cnt), Math.floor((bl + h2) / cnt)]);
  }
  return cols;
}

export function reliefRankMap(numColors, layers = null) {
  const inc = layers == null ? Array.from({ length: numColors }, (_, i) => i) : layers.map((b) => Math.trunc(b));
  if (inc.length < 2 || new Set(inc).size !== inc.length || inc.some((b) => b < 0 || b >= numColors)) {
    throw new Error("Layered Relief needs at least two distinct colours/layers.");
  }
  const m = [];
  for (let b = 0; b < numColors; b++) {
    if (inc.includes(b)) m.push(inc.indexOf(b));
    else {
      let best = inc[0];
      for (const l of inc) {
        const dl = Math.abs(l - b), db = Math.abs(best - b);
        if (dl < db || (dl === db && l < best)) best = l;
      }
      m.push(inc.indexOf(best));
    }
  }
  return { m, inc };
}

/** rgb: Uint8Array(w*h*3). */
export function reliefPrepare(rgb, w, h, numColors = RELIEF_DEFAULT_COLORS,
  smooth = RELIEF_DEFAULT_SMOOTH, minArea = RELIEF_DEFAULT_MIN_AREA) {
  if (numColors < RELIEF_MIN_COLORS || numColors > RELIEF_MAX_COLORS) {
    throw new Error(`Colours must be between ${RELIEF_MIN_COLORS} and ${RELIEF_MAX_COLORS}.`);
  }
  const lum = stencilLuminance(rgb, w, h);
  const lumS = stencilMedian(lum, w, h, Math.trunc(smooth));
  let bands = reliefToneBands(lumS, w * h, numColors);
  bands = reliefMergeSmall(bands, w, h, Math.trunc(minArea));
  return { bands, bandColors: reliefBandColors(rgb, bands, w * h, numColors), numColors, h, w };
}

export function reliefEdgeDistance(ranks, w, h) {
  const m0 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m0[i] = ranks[i] === 0 ? 1 : 0;
  const { labels } = stencilLabel(m0, w, h);
  const border = new Set();
  for (let x = 0; x < w; x++) { border.add(labels[x]); border.add(labels[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { border.add(labels[y * w]); border.add(labels[y * w + w - 1]); }
  border.delete(0);
  const big = h + w + 5;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = border.size && border.has(labels[i]) ? 0 : big;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (d[p] === 0) continue;
      const u = y > 0 ? d[p - w] : 0;
      const lf = x > 0 ? d[p - 1] : 0;
      const m = Math.min(u, lf) + 1;
      if (m < d[p]) d[p] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (d[p] === 0) continue;
      const dv = y < h - 1 ? d[p + w] : 0;
      const rt = x < w - 1 ? d[p + 1] : 0;
      const m = Math.min(dv, rt) + 1;
      if (m < d[p]) d[p] = m;
    }
  }
  return d;
}

export const reliefNodeKey = (rank, firstPixel) => `${rank}:${firstPixel}`;

export function reliefAssemble(base, layers = null, heightMode = "nesting",
  maxLevel = RELIEF_DEFAULT_LEVELS, overrides = null, dome = 0) {
  if (!RELIEF_HEIGHT_MODES.includes(heightMode)) throw new Error(`Unknown height mode: ${heightMode}`);
  overrides = overrides || {};
  const nColors = base.numColors;
  const { m: rankMap, inc } = reliefRankMap(nColors, layers);
  const nRanks = inc.length;
  const { h, w } = base;
  const N = w * h;
  const ranks = new Int32Array(N);
  for (let i = 0; i < N; i++) ranks[i] = rankMap[base.bands[i]];
  dome = heightMode === "nesting" ? Math.max(0, Math.min(RELIEF_MAX_DOME, Math.trunc(dome))) : 0;
  let edge = null, edgeMax = 1;
  if (dome) {
    edge = reliefEdgeDistance(ranks, w, h);
    let mx = 0;
    for (let i = 0; i < N; i++) if (edge[i] > mx) mx = edge[i];
    edgeMax = Math.max(1, mx);
  }
  const nodes = [];
  const rep = new Map();
  const labelsByRank = [];
  for (let r = 0; r < nRanks; r++) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = ranks[i] >= r ? 1 : 0;
    const { labels, sizes } = stencilLabel(mask, w, h);
    labelsByRank.push(labels);
    const nLab = sizes.length - 1;
    const exposed = new Array(nLab + 1).fill(0);
    const expSum = new Array(nLab + 1).fill(0);
    const first = new Array(nLab + 1).fill(N);
    const x0 = new Array(nLab + 1).fill(w), x1 = new Array(nLab + 1).fill(-1);
    const y0 = new Array(nLab + 1).fill(h), y1 = new Array(nLab + 1).fill(-1);
    for (let i = 0; i < N; i++) {
      const l = labels[i];
      if (!l) continue;
      if (ranks[i] === r) { exposed[l]++; if (dome) expSum[l] += edge[i]; }
      if (i < first[l]) first[l] = i;
      const y = Math.floor(i / w), x = i - y * w;
      if (x < x0[l]) x0[l] = x;
      if (x > x1[l]) x1[l] = x;
      if (y < y0[l]) y0[l] = y;
      if (y > y1[l]) y1[l] = y;
    }
    for (let lab = 1; lab <= nLab; lab++) {
      let parentRep = null;
      if (r > 0) parentRep = rep.get(`${r - 1}:${labelsByRank[r - 1][first[lab]]}`);
      const keep = exposed[lab] > 0 || r === 0;
      if (!keep) { rep.set(`${r}:${lab}`, parentRep); continue; }
      const nid = nodes.length;
      rep.set(`${r}:${lab}`, nid);
      const nd = {
        id: nid, rank: r, label: lab, band: inc[r], parent: parentRep,
        key: reliefNodeKey(r, first[lab]), first: first[lab], area: sizes[lab], exposed: exposed[lab],
        bbox: [x0[lab], y0[lab], x1[lab], y1[lab]], children: [], depthScore: 0,
      };
      if (dome && r > 0 && exposed[lab] > 0) {
        const ex = exposed[lab];
        nd.depthScore = Math.floor((dome * expSum[lab] * 2 + ex * edgeMax) / (2 * ex * edgeMax));
      }
      nodes.push(nd);
      if (parentRep !== null) nodes[parentRep].children.push(nid);
    }
  }
  for (const nd of nodes) {
    if (nd.parent === null) { nd.level = 0; nd.step = 0; nd.stepDefault = 0; nd.overridden = false; continue; }
    const par = nodes[nd.parent];
    const dflt = heightMode === "nesting" ? 1 + Math.max(0, nd.depthScore - par.depthScore)
      : Math.max(1, nd.rank - par.rank);
    const has = Object.prototype.hasOwnProperty.call(overrides, nd.key);
    let step = has ? Math.trunc(overrides[nd.key]) : dflt;
    step = Math.max(0, Math.min(RELIEF_MAX_STEP, step));
    const level = Math.min(par.level + step, Math.trunc(maxLevel));
    nd.stepDefault = dflt;
    nd.step = level - par.level;
    nd.level = level;
    nd.overridden = has;
  }
  const lvlLut = [], nodeLut = [];
  for (let r = 0; r < nRanks; r++) {
    let mx = 0;
    for (let i = 0; i < N; i++) if (labelsByRank[r][i] > mx) mx = labelsByRank[r][i];
    lvlLut.push(new Int32Array(mx + 1));
    nodeLut.push(new Int32Array(mx + 1).fill(-1));
  }
  for (const nd of nodes) { lvlLut[nd.rank][nd.label] = nd.level; nodeLut[nd.rank][nd.label] = nd.id; }
  const levelMap = new Int32Array(N);
  const nodeMap = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const r = ranks[i];
    levelMap[i] = lvlLut[r][labelsByRank[r][i]];
    nodeMap[i] = nodeLut[r][labelsByRank[r][i]];
  }
  const order = nodes.slice().sort((a, b) => (a.level - b.level) || (a.rank - b.rank) || (a.first - b.first));
  order.forEach((nd, i) => { nd.num = i + 1; });
  let maxL = 0;
  for (const nd of nodes) if (nd.level > maxL) maxL = nd.level;
  return {
    w, h, nodes, labels: labelsByRank, ranks, levelMap, nodeMap, layers: inc, nRanks,
    maxLevel: maxL, bandColors: base.bandColors, heightMode, levelCap: Math.trunc(maxLevel), dome,
  };
}

export function reliefPieceMask(rel, nid) {
  const nd = rel.nodes[nid];
  const [x0, y0, x1, y1] = nd.bbox;
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1;
  const mask = new Uint8Array(mw * mh);
  const lab = rel.labels[nd.rank];
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) mask[y * mw + x] = lab[(y0 + y) * rel.w + x0 + x] === nd.label ? 1 : 0;
  }
  for (const cid of nd.children) {
    const ch = rel.nodes[cid];
    if (ch.step !== 0) continue;
    const cl = rel.labels[ch.rank];
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) if (cl[(y0 + y) * rel.w + x0 + x] === ch.label) mask[y * mw + x] = 0;
    }
  }
  return { mask, x0, y0, mw, mh };
}

export function reliefLoopPoints(loop, ox = 0, oy = 0, smooth = true) {
  const n = loop.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % n];
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let k = 0; k < steps; k++) {
      pts.push([ax + Math.floor(((bx - ax) * k) / steps) + ox, ay + Math.floor(((by - ay) * k) / steps) + oy]);
    }
  }
  return smooth ? chaikin(pts, 2) : pts;
}

export function reliefPieceLoops(rel, nid, smooth = true) {
  const { mask, x0, y0, mw, mh } = reliefPieceMask(rel, nid);
  return stencilMaskLoops(mask, mw, mh).map((loop) => reliefLoopPoints(loop, x0, y0, smooth));
}

export function reliefPiecePath(rel, nid, smooth = true) {
  return reliefPieceLoops(rel, nid, smooth)
    .map((pts) => "M" + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" L") + " Z").join(" ");
}

export function reliefPieces(rel, colors = null) {
  colors = colors || rel.bandColors;
  return rel.nodes.slice().sort((a, b) => a.num - b.num).map((nd) => {
    const par = nd.parent !== null ? rel.nodes[nd.parent] : null;
    return {
      num: nd.num, id: nd.id, key: nd.key, rank: nd.rank, band: nd.band, color: colors[nd.band].slice(),
      level: nd.level, step: nd.step, supports: Math.max(0, nd.step - 1), areaPx: nd.area,
      exposedPx: nd.exposed, bbox: nd.bbox, parentNum: par ? par.num : null, overridden: !!nd.overridden,
    };
  });
}

export function reliefStats(rel, widthMm, thicknessMm, baseMm = RELIEF_BASE_MM,
  clearanceMm = RELIEF_CLEARANCE_MM, colors = null) {
  const pcs = reliefPieces(rel, colors);
  const mmPerPx = widthMm > 0 ? widthMm / rel.w : 0;
  let supports = 0;
  for (const p of pcs.slice(1)) supports += p.supports;
  let smallest = null;
  for (const p of pcs) if (p.num !== 1 && (!smallest || p.exposedPx < smallest.exposedPx)) smallest = p;
  const perColor = {};
  for (const p of pcs) perColor[p.band] = (perColor[p.band] || 0) + p.areaPx;
  const smMm = smallest && mmPerPx ? Math.sqrt((4.0 * smallest.exposedPx) / Math.PI) * mmPerPx : 0;
  const relief = rel.maxLevel * thicknessMm;
  return {
    pieces: pcs.length, supports, sheets: pcs.length + supports, levels: rel.maxLevel, reliefMm: relief,
    frameDepthMm: baseMm + relief + clearanceMm, smallestMm: smMm, areaPxByBand: perColor,
    widthMm, heightMm: rel.w ? (widthMm * rel.h) / rel.w : 0,
  };
}

export function reliefNodeAt(rel, x, y) {
  if (!(x >= 0 && x < rel.w && y >= 0 && y < rel.h)) return null;
  const n = rel.nodeMap[y * rel.w + x];
  return n < 0 ? null : n;
}

export function reliefShadowPx(thicknessMm, widthMm, workW) {
  const pxPerMm = widthMm > 0 ? workW / widthMm : 1.0;
  return Math.max(1, Math.min(5, Math.floor(thicknessMm * pxPerMm * 1.1 + 0.5)));
}

/** Int32Array(w*h*3): the unlit top-down colours. */
export function reliefFlatRgb(rel, colors = null) {
  colors = colors || rel.bandColors;
  const out = new Int32Array(rel.w * rel.h * 3);
  for (let i = 0; i < rel.w * rel.h; i++) {
    const c = colors[rel.layers[rel.ranks[i]]];
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}

/** Lit preview, Uint8ClampedArray(w*h*3) -- identical to Python relief_shade. */
export function reliefShade(rel, colors = null, shadowPx = 2, strength = 520) {
  const out = reliefFlatRgb(rel, colors);
  const { w, h } = rel;
  const lvl = rel.levelMap;
  const s = Math.max(1, Math.min(Math.trunc(shadowPx), Math.min(h, w) - 1));
  const N = w * h;
  for (let L = 1; L <= rel.maxLevel; L++) {
    const M = new Uint8Array(N);
    for (let i = 0; i < N; i++) M[i] = lvl[i] >= L ? 1 : 0;
    const sh = new Int32Array(N);
    for (let y = s; y < h; y++) {
      for (let x = s; x < w; x++) {
        const p = y * w + x;
        if (M[(y - s) * w + (x - s)] && !M[p]) sh[p] = 1000;
      }
    }
    const g = stencilBoxBlur(sh, w, h, 1, 1);
    for (let i = 0; i < N; i++) {
      if (!M[i] && g[i] > 0) {
        const f = 1000 - Math.floor((g[i] * strength) / 1000);
        for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.floor((out[i * 3 + c] * f) / 1000);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!M[p]) continue;
        const ulSet = y > 0 && x > 0 && M[p - w - 1];
        if (!ulSet) for (let c = 0; c < 3; c++) out[p * 3 + c] += Math.floor(((255 - out[p * 3 + c]) * 150) / 1000);
        const drSet = y < h - 1 && x < w - 1 && M[p + w + 1];
        if (!drSet) for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.floor((out[p * 3 + c] * 820) / 1000);
      }
    }
  }
  const res = new Uint8ClampedArray(N * 3);
  for (let i = 0; i < N * 3; i++) res[i] = Math.min(255, Math.max(0, out[i]));
  return res;
}

/** Map of node id -> [x, y] where its number is drawn. */
export function reliefLabelPoints(rel) {
  const { w, h } = rel;
  const sums = new Map(); // id -> [count, sx, sy]
  for (let i = 0; i < w * h; i++) {
    const n = rel.nodeMap[i];
    if (n < 0) continue;
    const y = Math.floor(i / w), x = i - y * w;
    let a = sums.get(n);
    if (!a) { a = [0, 0, 0]; sums.set(n, a); }
    a[0]++; a[1] += x; a[2] += y;
  }
  const best = new Map();
  for (let i = 0; i < w * h; i++) {
    const n = rel.nodeMap[i];
    if (n < 0) continue;
    const y = Math.floor(i / w), x = i - y * w;
    const a = sums.get(n);
    const cx = Math.floor(a[1] / a[0]), cy = Math.floor(a[2] / a[0]);
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const b = best.get(n);
    if (!b || d2 < b[2]) best.set(n, [x, y, d2]);
  }
  const pts = new Map();
  for (const nd of rel.nodes) {
    const b = best.get(nd.id);
    if (b) pts.set(nd.id, [b[0], b[1]]);
    else pts.set(nd.id, [Math.floor((nd.bbox[0] + nd.bbox[2]) / 2), Math.floor((nd.bbox[1] + nd.bbox[3]) / 2)]);
  }
  return pts;
}

export function reliefHex(c) {
  return "#" + c.map((v) => Math.trunc(v).toString(16).padStart(2, "0")).join("");
}

export function reliefColorName(c) {
  const [r, g, b] = c.map((v) => Math.trunc(v));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const lum = Math.floor((299 * r + 587 * g + 114 * b) / 1000);
  const tone = lum < 40 ? "Very dark" : lum < 95 ? "Dark" : lum < 160 ? "Mid" : lum < 215 ? "Light" : "Very light";
  if (mx - mn < 24) return lum > 30 && lum < 225 ? `${tone} grey` : (lum <= 30 ? "Black" : "White");
  let hue;
  if (mx === r && g >= b) hue = (g - b) * 3 < (r - b) ? "red" : (g - b) * 3 < 2 * (r - b) ? "orange" : "yellow";
  else if (mx === r) hue = (b - g) * 2 < (r - g) ? "pink" : "magenta";
  else if (mx === g) hue = b <= r ? "green" : "teal";
  else hue = r <= g ? "blue" : "purple";
  return `${tone} ${hue}`;
}

function svgHead(rel, widthMm, title) {
  const heightMm = (widthMm * rel.h) / rel.w;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthMm)}mm" `
    + `height="${fmt(heightMm)}mm" viewBox="0 0 ${rel.w} ${rel.h}">\n  <title>${title}</title>\n`;
}

export function reliefSvgPieces(rel, nids, widthMm, title, colors = null, groupByLevel = false) {
  colors = colors || rel.bandColors;
  const nodes = rel.nodes;
  const body = [];
  const byNum = (a, b) => nodes[a].num - nodes[b].num;
  const pathLine = (i, indent) => `${indent}<path id="piece-${nodes[i].num}" fill="${reliefHex(colors[nodes[i].band])}" `
    + `fill-rule="evenodd" d="${reliefPiecePath(rel, i)}"/>`;
  if (groupByLevel) {
    const levels = [...new Set(nids.map((i) => nodes[i].level))].sort((a, b) => a - b);
    for (const lv of levels) {
      body.push(`  <g id="level-${lv}">`);
      for (const i of nids.filter((i) => nodes[i].level === lv).sort(byNum)) body.push(pathLine(i, "    "));
      body.push("  </g>");
    }
  } else {
    for (const i of nids.slice().sort(byNum)) body.push(pathLine(i, "  "));
  }
  return svgHead(rel, widthMm, title) + body.join("\n") + "\n</svg>\n";
}

export function reliefSvgLabeledMap(rel, widthMm, colors = null) {
  colors = colors || rel.bandColors;
  const pts = reliefLabelPoints(rel);
  const size = Math.max(6, Math.floor(rel.w / 38));
  const parts = [];
  const sorted = rel.nodes.slice().sort((a, b) => a.num - b.num);
  for (const nd of sorted) {
    parts.push(`  <path fill="${reliefHex(colors[nd.band])}" fill-opacity="0.55" stroke="#222" `
      + `stroke-width="0.6" fill-rule="evenodd" d="${reliefPiecePath(rel, nd.id)}"/>`);
  }
  for (const nd of sorted) {
    const [x, y] = pts.get(nd.id);
    parts.push(`  <text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" `
      + `dominant-baseline="central" fill="#000" stroke="#fff" stroke-width="${fmt(size / 6)}" `
      + `paint-order="stroke">${nd.num}</text>`);
  }
  return svgHead(rel, widthMm, "Piece map (reference only - do not cut)") + parts.join("\n") + "\n</svg>\n";
}

export function reliefSupportCopies(rel) {
  const need = new Map();
  for (const nd of rel.nodes) if (nd.parent !== null) need.set(nd.id, Math.max(0, nd.step - 1));
  let most = 0;
  for (const v of need.values()) most = Math.max(most, v);
  const out = [];
  for (let k = 1; k <= most; k++) {
    out.push([k, [...need.entries()].filter(([, n]) => n >= k).map(([i]) => i).sort((a, b) => a - b)]);
  }
  return out;
}

/** [{name, text}] -- the same files as Python export_relief_svgs. */
export function reliefSvgFiles(rel, widthMm, colors = null) {
  colors = colors || rel.bandColors;
  const files = [];
  const allIds = rel.nodes.map((n) => n.id);
  files.push({ name: "relief_all_colors.svg", text: reliefSvgPieces(rel, allIds, widthMm, "Layered relief - all pieces", colors, true) });
  const byBand = new Map();
  for (const nd of rel.nodes) { if (!byBand.has(nd.band)) byBand.set(nd.band, []); byBand.get(nd.band).push(nd.id); }
  [...byBand.keys()].sort((a, b) => a - b).forEach((band, n) => {
    const nm = reliefColorName(colors[band]);
    files.push({
      name: `colour_${n + 1}_${nm.toLowerCase().replace(/ /g, "_")}.svg`,
      text: reliefSvgPieces(rel, byBand.get(band), widthMm, `Layered relief - ${nm} pieces`, colors),
    });
  });
  const wood = colors.map(() => [176, 148, 108]);
  for (const [k, ids] of reliefSupportCopies(rel)) {
    files.push({ name: `supports_${k}.svg`, text: reliefSvgPieces(rel, ids, widthMm, `Support sheets, copy ${k} (any sturdy board)`, wood) });
  }
  files.push({ name: "piece_map.svg", text: reliefSvgLabeledMap(rel, widthMm, colors) });
  return files;
}
