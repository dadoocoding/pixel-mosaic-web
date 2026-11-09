// Layered Relief: canvas renderers (preview, true-size cut sheets, build guide).
// Mirrors python render_relief_* (layout is the same; pixels are not parity-tested).
import { POSTER_PAPER_SIZES } from "./poster.js";
import {
  reliefShade, reliefShadowPx, reliefFlatRgb, reliefPieceLoops, reliefPieces, reliefStats, reliefLabelPoints,
  reliefSupportCopies, reliefHex, reliefColorName, RELIEF_BASE_MM, RELIEF_CLEARANCE_MM,
} from "./relief.js";

const FONT = "sans-serif";

/** Shaded (or flat) preview canvas, outWidth px wide. */
export function renderReliefPreview(rel, colors, thicknessMm, widthMm, outWidth, shaded, createCanvasFn) {
  let rgb;
  if (shaded) rgb = reliefShade(rel, colors, reliefShadowPx(thicknessMm, widthMm, rel.w));
  else {
    const f = reliefFlatRgb(rel, colors);
    rgb = new Uint8ClampedArray(f.length);
    for (let i = 0; i < f.length; i++) rgb[i] = f[i];
  }
  const src = createCanvasFn(rel.w, rel.h);
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(rel.w, rel.h);
  for (let i = 0; i < rel.w * rel.h; i++) {
    img.data[i * 4] = rgb[i * 3]; img.data[i * 4 + 1] = rgb[i * 3 + 1]; img.data[i * 4 + 2] = rgb[i * 3 + 2];
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const outH = Math.max(1, Math.round((outWidth * rel.h) / rel.w));
  const out = createCanvasFn(outWidth, outH);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = !!shaded;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, outWidth, outH);
  return out;
}

function tracePath(ctx, loops, sx, sy, ox, oy) {
  ctx.beginPath();
  for (const pts of loops) {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * sx, oy + y * sy) : ctx.moveTo(ox + x * sx, oy + y * sy)));
    ctx.closePath();
  }
}

function label(ctx, text, x, y, size) {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, size / 4); ctx.strokeStyle = "#fff"; ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#000";
  ctx.fillText(text, x, y);
}

function textAt(ctx, text, x, y, size, color = "#000", bold = false, align = "left") {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function page(createCanvasFn, W, H) {
  const c = createCanvasFn(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  return [c, ctx];
}

/** True-size cut sheets: one per paper colour + one per support copy, tiled
 *  across Letter/A4 pages with overlap. */
export function renderReliefCutPages(rel, widthIn, colors, paper, createCanvasFn, dpi = 150) {
  colors = colors || rel.bandColors;
  const pts = reliefLabelPoints(rel);
  const [pwIn, phIn] = POSTER_PAPER_SIZES[paper] || POSTER_PAPER_SIZES.Letter;
  const artW = Math.max(1, Math.round(widthIn * dpi));
  const artH = Math.max(1, Math.round(((widthIn * rel.h) / rel.w) * dpi));
  const sx = artW / rel.w, sy = artH / rel.h;
  const titleH = Math.floor(0.35 * dpi), m = Math.floor(0.4 * dpi), overlap = Math.floor(0.3 * dpi);
  const pw = Math.floor(pwIn * dpi), ph = Math.floor(phIn * dpi);
  const usableW = pw - 2 * m, usableH = ph - 2 * m - titleH;
  const sheets = [];
  const byBand = new Map();
  for (const nd of rel.nodes) { if (!byBand.has(nd.band)) byBand.set(nd.band, []); byBand.get(nd.band).push(nd.id); }
  [...byBand.keys()].sort((a, b) => a - b).forEach((band, n) => {
    sheets.push([`Colour ${n + 1}: ${reliefColorName(colors[band])}  ${reliefHex(colors[band])}`, byBand.get(band)]);
  });
  for (const [k, ids] of reliefSupportCopies(rel)) sheets.push([`Support sheets, copy ${k} (any sturdy board)`, ids]);
  const pages = [];
  for (const [title, ids] of sheets) {
    const [sheet, d] = page(createCanvasFn, artW, artH);
    d.strokeStyle = "#000"; d.lineWidth = 2; d.lineJoin = "round";
    for (const i of ids) { tracePath(d, reliefPieceLoops(rel, i), sx, sy, 0, 0); d.stroke(); }
    for (const i of ids) { const [x, y] = pts.get(i); label(d, String(rel.nodes[i].num), x * sx, y * sy, Math.max(12, Math.floor(dpi * 0.11))); }
    d.strokeStyle = "#aaa"; d.lineWidth = 1; d.strokeRect(0.5, 0.5, artW - 1, artH - 1);
    const stepW = usableW - overlap, stepH = usableH - overlap;
    const cols = artW <= usableW ? 1 : 1 + Math.ceil((artW - usableW) / stepW);
    const rows = artH <= usableH ? 1 : 1 + Math.ceil((artH - usableH) / stepH);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * stepW, y0 = r * stepH;
        const tw = Math.min(artW, x0 + usableW) - x0, th = Math.min(artH, y0 + usableH) - y0;
        const [pg, pd] = page(createCanvasFn, pw, ph);
        pd.drawImage(sheet, x0, y0, tw, th, m, m + titleH, tw, th);
        const tag = rows * cols > 1 ? `   (sheet ${r * cols + c + 1} of ${rows * cols}, row ${r + 1} col ${c + 1})` : "";
        textAt(pd, title + tag, m, Math.floor(m / 2 + titleH / 4), Math.floor(dpi * 0.15));
        textAt(pd, `Print at 100% / Actual size. Art size ${widthIn.toFixed(2)} x ${((widthIn * rel.h) / rel.w).toFixed(2)} in. `
          + "Cut along the lines; the number is the piece number (see the build guide).", m, ph - Math.floor(m / 2), Math.floor(dpi * 0.1), "#5a5a5a");
        pages.push(pg);
      }
    }
  }
  return pages;
}

function wrap(ctx, text, x, y, maxW, lineH, size) {
  ctx.font = `${size}px ${FONT}`;
  let line = "";
  for (const wd of text.split(" ")) {
    const test = (line + " " + wd).trim();
    if (ctx.measureText(test).width > maxW) { textAt(ctx, line, x, y, size); y += lineH; line = wd; } else line = test;
  }
  textAt(ctx, line, x, y, size);
  return y;
}

export function renderReliefGuidePages(rel, widthIn, thicknessMm, colors, paper, createCanvasFn, opts = {}) {
  colors = colors || rel.bandColors;
  const { materialName = "", title = "Layered Relief Art", baseMm = RELIEF_BASE_MM, clearanceMm = RELIEF_CLEARANCE_MM, dpi = 150 } = opts;
  const widthMm = widthIn * 25.4;
  const stats = reliefStats(rel, widthMm, thicknessMm, baseMm, clearanceMm, colors);
  const pcs = reliefPieces(rel, colors);
  const pts = reliefLabelPoints(rel);
  const [pwIn, phIn] = POSTER_PAPER_SIZES[paper] || POSTER_PAPER_SIZES.Letter;
  const W = Math.floor(pwIn * dpi), H = Math.floor(phIn * dpi), m = Math.floor(0.6 * dpi);
  const heightIn = (widthIn * rel.h) / rel.w;
  const unit = (mm) => `${mm.toFixed(1)} mm (${(mm / 25.4).toFixed(2)} in)`;
  const D = (f) => Math.floor(dpi * f);
  const pages = [];

  // 1. overview
  let [pg, d] = page(createCanvasFn, W, H);
  textAt(d, title, m, m, D(0.3), "#000", true);
  textAt(d, "Build guide", m, m + D(0.42), D(0.19), "#6e6e6e", true);
  const shotW = 1100;
  const shot = renderReliefPreview(rel, colors, thicknessMm, widthMm, shotW, true, createCanvasFn);
  const sc = Math.min((W - 2 * m) / shot.width, (H * 0.52) / shot.height);
  const sw = Math.floor(shot.width * sc), sh = Math.floor(shot.height * sc);
  d.imageSmoothingQuality = "high";
  d.drawImage(shot, Math.floor((W - sw) / 2), m + D(0.85), sw, sh);
  let y = m + D(0.85) + sh + D(0.25) + D(0.1);
  const rows = [
    ["Finished size", `${widthIn.toFixed(2)} x ${heightIn.toFixed(2)} in  (${widthMm.toFixed(0)} x ${((widthMm * rel.h) / rel.w).toFixed(0)} mm)`],
    ["Paper colours", String(new Set(pcs.map((p) => p.band)).size)],
    ["Pieces to cut", `${stats.pieces}` + (stats.supports ? `  + ${stats.supports} support sheets` : "")],
    ["Heights (levels)", `${stats.levels} above the backing`],
    ["Sheet material", `${materialName || "custom"}  -  ${thicknessMm} mm per layer`],
    ["Relief height", unit(stats.reliefMm)],
    ["Minimum frame depth", unit(stats.frameDepthMm) + `  (backing ${baseMm} mm + relief + ${clearanceMm} mm clearance)`],
    ["Smallest piece", `about ${stats.smallestMm.toFixed(1)} mm across`],
  ];
  for (const [a, b] of rows) { textAt(d, a, m, y, D(0.13), "#5a5a5a", true); textAt(d, b, m + D(2.2), y, D(0.13), "#000", true); y += D(0.22); }
  pages.push(pg);

  // 2. materials
  [pg, d] = page(createCanvasFn, W, H);
  textAt(d, "Materials & cut list", m, m, D(0.19), "#000", true);
  y = m + D(0.45);
  const pxIn2 = (widthIn / rel.w) ** 2;
  const byBand = new Map();
  for (const p of pcs) { if (!byBand.has(p.band)) byBand.set(p.band, []); byBand.get(p.band).push(p); }
  [...byBand.keys()].sort((a, b) => a - b).forEach((band, n) => {
    const ps = byBand.get(band);
    const area = ps.reduce((s, p) => s + p.areaPx, 0) * pxIn2;
    d.fillStyle = reliefHex(colors[band]); d.fillRect(m, y - D(0.1), D(0.4), D(0.3));
    d.strokeStyle = "#000"; d.lineWidth = 1; d.strokeRect(m, y - D(0.1), D(0.4), D(0.3));
    textAt(d, `Colour ${n + 1}: ${reliefColorName(colors[band])} ${reliefHex(colors[band])}  -  ${ps.length} piece(s)`, m + D(0.55), y, D(0.13));
    let nums = ps.map((p) => p.num).join(", ");
    if (nums.length > 150) nums = nums.slice(0, 150) + "...";
    textAt(d, `~${area.toFixed(0)} sq in of paper needed (+ trim).  Pieces: ${nums}`, m + D(0.55), y + D(0.17), D(0.1), "#5a5a5a");
    y += D(0.5);
  });
  const sup = pcs.filter((p) => p.supports);
  if (sup.length) {
    const nSup = sup.reduce((s, p) => s + p.supports, 0);
    textAt(d, `Support sheets: ${nSup} copies (pieces ${sup.map((p) => `${p.num}x${p.supports}`).join(", ").slice(0, 140)})`, m, y, D(0.13));
    textAt(d, "Any sturdy board in the same thickness. Each is cut to the same shape as the piece it lifts.", m, y + D(0.17), D(0.1), "#5a5a5a");
    y += D(0.5);
  }
  y += D(0.1);
  for (const line of [
    `Backing board: ${widthIn.toFixed(2)} x ${heightIn.toFixed(2)} in (piece 1 is the backing; cut it from the first colour).`,
    "Adhesive: PVA / tacky glue in thin dots, double-sided tape, or foam dots for extra depth.",
    "Tools: craft knife or scissors, cutting mat, tweezers, ruler, pencil.",
    `Frame: needs at least ${unit(stats.frameDepthMm)} of inner depth (a shadow box).`,
  ]) { textAt(d, line, m, y, D(0.13)); y += D(0.24); }
  pages.push(pg);

  // 3. stack
  [pg, d] = page(createCanvasFn, W, H);
  textAt(d, "Stack order (bottom to top)", m, m, D(0.19), "#000", true);
  y = m + D(0.5);
  for (let lv = 0; lv <= stats.levels; lv++) {
    const ps = pcs.filter((p) => p.level === lv);
    if (!ps.length) continue;
    textAt(d, `Level ${lv}` + (lv === 0 ? " - backing" : `  (+${(lv * thicknessMm).toFixed(1)} mm)`), m, y + D(0.1), D(0.13));
    let x = m + D(1.9);
    for (const p of ps.slice(0, 26)) {
      d.fillStyle = reliefHex(p.color); d.fillRect(x, y, D(0.2), D(0.2));
      d.strokeStyle = "#000"; d.strokeRect(x, y, D(0.2), D(0.2));
      textAt(d, String(p.num), x + D(0.24), y + D(0.1), D(0.1));
      x += D(0.62);
      if (x > W - m - D(0.4)) break;
    }
    if (ps.length > 26) textAt(d, `+${ps.length - 26} more`, x, y + D(0.1), D(0.1), "#5a5a5a");
    y += D(0.36);
  }
  y += D(0.2);
  textAt(d, "Side view (not to scale)", m, y, D(0.1), "#5a5a5a");
  y += D(0.3);
  for (let lv = stats.levels; lv >= 0; lv--) {
    const shade = 235 - 18 * lv;
    d.fillStyle = `rgb(${shade},${shade},${shade})`;
    d.fillRect(m + Math.floor(lv * dpi * 0.25), y, W - 2 * m - 2 * Math.floor(lv * dpi * 0.25), D(0.12));
    d.strokeStyle = "#3c3c3c"; d.strokeRect(m + Math.floor(lv * dpi * 0.25), y, W - 2 * m - 2 * Math.floor(lv * dpi * 0.25), D(0.12));
    textAt(d, `level ${lv}`, W / 2, y + D(0.06), D(0.1), "#000", false, "center");
    y += D(0.16);
  }
  pages.push(pg);

  // 4. placement map per level
  const flat = reliefFlatRgb(rel, colors);
  for (let lv = 1; lv <= stats.levels; lv++) {
    const ps = pcs.filter((p) => p.level === lv);
    if (!ps.length) continue;
    [pg, d] = page(createCanvasFn, W, H);
    textAt(d, `Level ${lv}: place these pieces`, m, m, D(0.19), "#000", true);
    textAt(d, "Faded = already placed on lower levels. Glue each numbered piece inside its outline.", m, m + D(0.3), D(0.1), "#6e6e6e");
    const boxW = W - 2 * m, boxH = H - 2 * m - D(1.1);
    const s = Math.min(boxW / rel.w, boxH / rel.h);
    const mw = Math.floor(rel.w * s), mh = Math.floor(rel.h * s);
    const ox = Math.floor((W - mw) / 2), oy = m + D(0.65);
    const small = createCanvasFn(rel.w, rel.h);
    const sctx = small.getContext("2d");
    const im = sctx.createImageData(rel.w, rel.h);
    for (let i = 0; i < rel.w * rel.h; i++) {
      const low = rel.levelMap[i] < lv;
      for (let c = 0; c < 3; c++) im.data[i * 4 + c] = low ? 255 - Math.floor((255 - flat[i * 3 + c]) / 4) : 255;
      im.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(im, 0, 0);
    d.imageSmoothingEnabled = false;
    d.drawImage(small, ox, oy, mw, mh);
    d.strokeStyle = "#969696"; d.lineWidth = 1; d.strokeRect(ox, oy, mw - 1, mh - 1);
    for (const p of ps) {
      tracePath(d, reliefPieceLoops(rel, p.id), s, s, ox, oy);
      d.fillStyle = reliefHex(p.color); d.fill("evenodd");
    }
    d.strokeStyle = "#000"; d.lineWidth = 2; d.lineJoin = "round";
    for (const p of ps) { tracePath(d, reliefPieceLoops(rel, p.id), s, s, ox, oy); d.stroke(); }
    for (const p of ps) { const [x, yy] = pts.get(p.id); label(d, String(p.num), ox + x * s, oy + yy * s, Math.max(12, D(0.12))); }
    let note = `${ps.length} piece(s) at level ${lv}`;
    const supHere = ps.filter((p) => p.supports);
    if (supHere.length) note += "  -  first stack support sheets under: " + supHere.map((p) => `#${p.num} (x${p.supports})`).join(", ");
    textAt(d, note.slice(0, 150), m, oy + mh + D(0.15), D(0.1));
    pages.push(pg);
  }

  // 5. assembly
  [pg, d] = page(createCanvasFn, W, H);
  textAt(d, "Assembly", m, m, D(0.19), "#000", true);
  y = m + D(0.5);
  const steps = [
    "Print the cut sheets at 100% (Actual size). Print on the matching coloured paper, or on plain paper and trace.",
    "Cut every piece along its outline. Keep each piece with its number (pencil it on the back).",
    "Cut the support sheets, if any, and glue them under the pieces that need them (the map shows which).",
    "Glue piece 1, the backing, into the frame.",
    "Work up one level at a time, from level 1 to the top: glue each piece inside its outline on the map.",
    "Dry-fit before gluing. Tweezers help with small pieces, and thin dots of glue keep edges from lifting.",
    "Let it dry flat. Frame with at least the depth shown on page 1.",
  ];
  steps.forEach((t, i) => {
    textAt(d, `${i + 1}.`, m, y, D(0.13));
    y = wrap(d, t, m + D(0.35), y, W - m - (m + D(0.35)), D(0.2), D(0.13)) + D(0.32);
  });
  textAt(d, "Tip: thicker material (chipboard, foam, thin wood) gives deeper shadows and a stronger relief; use the shaded preview in the app to compare.",
    m, y + D(0.2), D(0.1), "#5a5a5a");
  pages.push(pg);
  return pages;
}
