// Product Kit: branded sellable PDF + Etsy listing images + listing text + ZIP.
// Mirrors python/product_kit.py. Text logic is pure (node-testable);
// rendering uses canvas and is browser-only.
import { KIT_CONTENT } from "./kitContent.js";
import { ASSEMBLY_SECONDS_PER_PIECE, formatAssemblyTime } from "./physicalSize.js";

export const KIT_DPI = 200;
export const PAGE_SIZES = { letter: [1700, 2200], a4: [1654, 2339] };
export const PAGE_LABELS = { letter: "Letter", a4: "A4" };
export const DEFAULT_ACCENT = [47, 58, 74];
export const LISTING_SIZE = [2000, 1500];
export const MAX_TITLE = 140;
export const MAX_TAGS = 13;
export const MAX_TAG_LEN = 20;
export const MAX_UPSCALE = 2.5;
export const LANDSCAPE_ASPECT = 1.25;
export const KEY_MODES = ["classic", "dice", "rubiks", "crossstitch", "foundobject"]; // last pattern page is a key/legend
export const SUPPORTED_MODES = ["classic", "dice", "rubiks", "crossstitch", "foundobject", "screwart", "stringart", "stencil", "halftone"];

const cpLen = (s) => Array.from(s).length;
const cpSlice = (s, a, b) => Array.from(s).slice(a, b).join("");

// ---------------------------------------------------------------- templating
export function fill(template, ctx) {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    if (v === undefined || v === null || String(v).trim() === "") { missing = true; return ""; }
    return String(v);
  });
  return missing ? null : out;
}
const SHAPE_TEXT = { rect: "Rectangle", rectangle: "Rectangle", oval: "Oval", circle: "Circle", round: "Circle", grid: "Nail grid", none: "" };

/** Which wording block to use: String Art on a nail grid has its own
 * ("stringart_grid"); every other mode uses its own key. */
export function contentMode(mode, stats) {
  if (mode === "stringart" && String((stats && stats.shape) || "").toLowerCase() === "grid") return "stringart_grid";
  return mode;
}

export function buildContext(mode, stats) {
  const mc = KIT_CONTENT.modes[contentMode(mode, stats)];
  const ctx = Object.assign({}, stats || {});
  const shape = String(ctx.shape == null ? "" : ctx.shape).toLowerCase();
  if (!("shape_text" in ctx)) {
    ctx.shape_text = shape in SHAPE_TEXT ? SHAPE_TEXT[shape] : (shape ? shape[0].toUpperCase() + shape.slice(1) : "");
  }
  ctx.difficulty = mc.difficulty;
  ctx.time = mc.time;
  const rate = ASSEMBLY_SECONDS_PER_PIECE[mode];
  const pieces = parseInt(ctx.pieces, 10) || 0;
  if (rate && pieces > 0) {
    const est = formatAssemblyTime(pieces, rate);
    if (est) ctx.time = est + " (rough estimate)";
  }
  return ctx;
}
const fillList = (items, ctx) => items.map((i) => fill(i, ctx)).filter((s) => s);

export function kitText(mode, stats) {
  const mc = KIT_CONTENT.modes[contentMode(mode, stats)];
  const ctx = buildContext(mode, stats);
  const steps = [];
  for (const [t, b] of mc.steps) {
    const tt = fill(t, ctx), bb = fill(b, ctx);
    if (tt && bb) steps.push([tt, bb]);
  }
  const glance = [];
  for (const [label, val] of mc.glance) {
    const v = fill(val, ctx);
    if (v) glance.push([label, v]);
  }
  return {
    label: mc.label, title: fill(mc.title, ctx) || mc.label, subtitle: fill(mc.subtitle, ctx) || "",
    tagline: mc.tagline, chips: fillList(mc.chips, ctx), glance, supplies: fillList(mc.supplies, ctx),
    steps, tips: fillList(mc.tips, ctx), blurb: mc.blurb, tags: mc.tags.slice(),
    difficulty: mc.difficulty, time: ctx.time,
    variant_label: mc.variant_label || "", variant_line: mc.variant_line || "",
  };
}

// ------------------------------------------------------------------ branding
export function normalizeBranding(d) {
  d = d || {};
  const s = (v) => String(v == null ? "" : v).trim();
  let acc = Array.isArray(d.accent) ? d.accent.slice(0, 3).map((c) => Math.max(0, Math.min(255, Math.trunc(Number(c))))) : DEFAULT_ACCENT.slice();
  if (acc.length !== 3 || acc.some((c) => Number.isNaN(c))) acc = DEFAULT_ACCENT.slice();
  return { shop_name: s(d.shop_name), website: s(d.website), copyright: s(d.copyright), license_text: s(d.license_text),
    thank_you: s(d.thank_you), accent: acc, logo: d.logo || null };
}
export const brandingIsBlank = (b) => !(b.shop_name || b.website || b.copyright || b.license_text || b.thank_you || b.logo);
export function licenseShown(b) {
  if (!(b.shop_name || b.license_text)) return "";
  return b.license_text.trim() || KIT_CONTENT.common.default_license;
}
export const footerLine = (b) => [b.shop_name, b.website].filter((p) => p).join("  ·  ");
export function parseHexColor(s, def = DEFAULT_ACCENT) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((s || "").trim());
  if (!m) return def.slice();
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const BRAND_KEY = "pixelMosaicBranding";
export function loadBranding() {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function saveBranding(d) {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
}

// ------------------------------------------------------------- listing text
export function slugify(s) {
  s = s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  s = s.slice(0, 60);
  return s || "Pattern";
}
export function makeTitle(title, subtitle) {
  const parts = [title];
  if (subtitle) parts.push(subtitle);
  parts.push("Printable PDF, Instant Digital Download");
  let cur = "";
  for (const p of parts) {
    const cand = cur ? cur + " | " + p : p;
    if (cpLen(cand) <= MAX_TITLE) cur = cand; else break;
  }
  return cur ? cpSlice(cur, 0, MAX_TITLE).replace(/\s+$/, "") : cpSlice(title, 0, MAX_TITLE);
}
export function makeTags(kt) {
  const seen = new Set(), out = [];
  for (let t of kt.tags.concat([kt.label], KIT_CONTENT.common.generic_tags)) {
    t = t.trim().toLowerCase();
    if (!t || cpLen(t) > MAX_TAG_LEN || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
export function listingText(brand, kt, title, subtitle, dataNote, variants) {
  const com = KIT_CONTENT.common;
  const t = makeTitle(title, subtitle);
  const tags = makeTags(kt);
  let desc = [kt.blurb, "", com.listing_intro, "", "WHAT YOU GET"];
  const items = com.included.slice();
  if (dataNote) items.push(com.included_extra_data);
  desc = desc.concat(items.map((i) => "- " + i));
  const multi = !!variants && variants.length > 1;
  if (multi) {
    desc = desc.concat(["", "VERSIONS INCLUDED", com.variant_intro.replace("{n}", String(variants.length))],
      variants.map(([lab, line]) => "- " + lab + ": " + line));
  }
  desc = desc.concat(["", "AT A GLANCE"], kt.glance.map(([k, v]) => "- " + k + ": " + v));
  if (kt.supplies.length) desc = desc.concat(["", "WHAT YOU'LL NEED"], kt.supplies.map((s) => "- " + s));
  if (kt.steps.length) desc = desc.concat(["", "HOW IT WORKS"], kt.steps.map(([a], i) => (i + 1) + ". " + a));
  const notes = com.listing_notes.concat(multi ? [com.variant_disclaimer] : []);
  desc = desc.concat(["", "PLEASE NOTE"], notes.map((n) => "- " + n));
  const lic = licenseShown(brand);
  if (lic) desc = desc.concat(["", "LICENSE", lic]);
  if (brand.copyright) desc = desc.concat(["", brand.copyright]);
  const d = desc.join("\n");
  return { title: t, tags, description: d,
    text: "TITLE\n" + t + "\n\nTAGS (" + tags.length + ")\n" + tags.join(", ") + "\n\nDESCRIPTION\n" + d + "\n" };
}

// ---------------------------------------------------------------- rendering
const FONT_FAMILY = '"DejaVu Sans", "Segoe UI", Arial, Helvetica, sans-serif';
const fnt = (size, bold) => (bold ? "bold " : "") + Math.round(size) + "px " + FONT_FAMILY;
const lineH = (size) => Math.trunc(size * 1.35);
const tint = (c, t) => c.map((v) => Math.trunc(v + (255 - v) * t));
const rgb = (c) => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
function inkOn(c) {
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return lum < 150 ? [255, 255, 255] : [30, 30, 30];
}
function mkCanvas(w, h, bg = [255, 255, 255]) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = rgb(bg); g.fillRect(0, 0, w, h);
  g.textBaseline = "top";
  return [c, g];
}
function tw(g, size, bold, s) { g.font = fnt(size, bold); return g.measureText(s).width; }
function wrapText(g, text, size, bold, maxw) {
  g.font = fnt(size, bold);
  const lines = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter((w) => w);
    if (!words.length) { lines.push(""); continue; }
    let cur = words[0];
    for (const w of words.slice(1)) {
      if (g.measureText(cur + " " + w).width <= maxw) cur += " " + w; else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines;
}
function text(g, s, x, y, size, bold, color, align) {
  g.font = fnt(size, bold); g.fillStyle = rgb(color);
  g.textAlign = align || "left";
  g.fillText(s, x, y);
  g.textAlign = "left";
}
function ellipsize(g, s, size, bold, maxw) {
  let v = s;
  while (tw(g, size, bold, v) > maxw && v.length > 4) v = v.slice(0, -2);
  return v !== s ? v.replace(/\s+$/, "") + "…" : v;
}
function rrect(g, x, y, w, h, r, fillC, strokeC, lw) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  if (fillC) { g.fillStyle = rgb(fillC); g.fill(); }
  if (strokeC) { g.strokeStyle = rgb(strokeC); g.lineWidth = lw || 2; g.stroke(); }
}
function fitSize(sw, sh, w, h, allowUp = true) {
  let s = Math.min(w / sw, h / sh);
  s = allowUp ? Math.min(s, MAX_UPSCALE) : Math.min(s, 1);
  return [Math.max(1, Math.trunc(sw * s)), Math.max(1, Math.trunc(sh * s)), s];
}
function drawFit(g, src, x, y, w, h) { // draw src fitted in the box (x,y,w,h), centred; returns [dx,dy,dw,dh]
  const [dw, dh, s] = fitSize(src.width, src.height, w, h);
  const dx = x + Math.trunc((w - dw) / 2), dy = y + Math.trunc((h - dh) / 2);
  g.imageSmoothingEnabled = s < 1.5 ? true : false;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, dx, dy, dw, dh);
  g.imageSmoothingEnabled = true;
  return [dx, dy, dw, dh];
}
function drawLogo(g, logo, x, y, maxw, maxh) {
  if (!logo) return [0, 0];
  const s = Math.min(maxw / logo.width, maxh / logo.height, 1);
  const w = Math.max(1, Math.trunc(logo.width * s)), h = Math.max(1, Math.trunc(logo.height * s));
  g.drawImage(logo, x, y, w, h);
  return [w, h];
}
function drawHeader(g, W, hh, accent, title, margin) {
  g.fillStyle = rgb(accent); g.fillRect(0, 0, W, hh);
  const size = Math.trunc(hh * 0.38);
  text(g, ellipsize(g, title, size, true, W - 2 * margin), margin, hh / 2 - size * 0.6, size, true, inkOn(accent));
}

class Flow {
  constructor(size, brand, title) {
    [this.W, this.H] = size; this.brand = brand; this.title = title; this.accent = brand.accent;
    this.margin = Math.trunc(this.W * 0.085);
    this.headerH = Math.trunc(this.H * 0.06);
    this.footerH = Math.trunc(this.H * 0.05);
    this.pages = [];
    this.newPage();
  }
  newPage() {
    [this.c, this.g] = mkCanvas(this.W, this.H);
    drawHeader(this.g, this.W, this.headerH, this.accent, this.title, this.margin);
    this.pages.push(this.c);
    this.y = this.headerH + Math.trunc(this.margin * 0.6);
    this.limit = this.H - this.footerH - Math.trunc(this.margin * 0.3);
  }
  need(h) { if (this.y + h > this.limit) this.newPage(); }
  heading(t, keep = 220) {
    this.need(lineH(52) + 30 + keep);
    text(this.g, t, this.margin, this.y, 52, true, this.accent);
    this.y += lineH(52);
    this.g.strokeStyle = rgb(tint(this.accent, 0.6)); this.g.lineWidth = 3;
    this.g.beginPath(); this.g.moveTo(this.margin, this.y); this.g.lineTo(this.W - this.margin, this.y); this.g.stroke();
    this.y += 26;
  }
  bullet(t) {
    const ind = 54;
    const lines = wrapText(this.g, t, 34, false, this.W - 2 * this.margin - ind);
    this.need(lineH(34) * lines.length + 10);
    const cy = this.y + Math.trunc(lineH(34) / 2) - 2;
    this.g.fillStyle = rgb(this.accent);
    this.g.beginPath(); this.g.arc(this.margin + 12, cy, 8, 0, 2 * Math.PI); this.g.fill();
    for (const ln of lines) { text(this.g, ln, this.margin + ind, this.y, 34, false, [55, 55, 55]); this.y += lineH(34); }
    this.y += 10;
  }
  step(n, title, body) {
    const ind = 100;
    const bl = wrapText(this.g, body, 33, false, this.W - 2 * this.margin - ind);
    const h = lineH(38) + lineH(33) * bl.length + 24;
    this.need(h);
    const r = 34, cx = this.margin + r, cy = this.y + r;
    this.g.fillStyle = rgb(this.accent);
    this.g.beginPath(); this.g.arc(cx, cy, r, 0, 2 * Math.PI); this.g.fill();
    text(this.g, String(n), cx, cy - 36 * 0.62, 36, true, inkOn(this.accent), "center");
    text(this.g, title, this.margin + ind, this.y, 38, true, [30, 30, 30]);
    let yy = this.y + lineH(38);
    for (const ln of bl) { text(this.g, ln, this.margin + ind, yy, 33, false, [75, 75, 75]); yy += lineH(33); }
    this.y += h;
  }
  table(rows) {
    const rh = lineH(34) + 22;
    rows.forEach(([k, v], i) => {
      this.need(rh);
      if (i % 2 === 0) { this.g.fillStyle = rgb(tint(this.accent, 0.92)); this.g.fillRect(this.margin, this.y, this.W - 2 * this.margin, rh); }
      text(this.g, k, this.margin + 20, this.y + 11, 34, true, [40, 40, 40]);
      const vl = ellipsize(this.g, v, 34, false, (this.W - 2 * this.margin) * 0.55);
      text(this.g, vl, this.W - this.margin - 20, this.y + 11, 34, false, [60, 60, 60], "right");
      this.y += rh;
    });
    this.y += 24;
  }
}
export function flowPages(size, brand, kt) {
  const fl = new Flow(size, brand, kt.title);
  if (kt.glance.length) { fl.heading("At a glance", 300); fl.table(kt.glance); }
  if (kt.supplies.length) { fl.heading("What you'll need", 100); kt.supplies.forEach((s) => fl.bullet(s)); fl.y += 20; }
  if (kt.steps.length) { fl.heading("How to build it", 200); kt.steps.forEach(([t, b], i) => fl.step(i + 1, t, b)); fl.y += 10; }
  if (kt.tips.length) { fl.heading("Tips for success", 100); kt.tips.forEach((s) => fl.bullet(s)); }
  return fl.pages;
}

export function coverPage(size, brand, kt, preview, title, subtitle) {
  const [W, H] = size, acc = brand.accent, ink = inkOn(acc);
  const [c, g] = mkCanvas(W, H);
  const m = Math.trunc(W * 0.085), bandH = Math.trunc(H * 0.27);
  g.fillStyle = rgb(acc); g.fillRect(0, 0, W, bandH);
  text(g, kt.tagline.toUpperCase(), m, Math.trunc(bandH * 0.12), 34, true, ink[0] > 200 ? tint(acc, 0.7) : [90, 90, 90]);
  let size2 = 88, lines = wrapText(g, title, size2, true, W - 2 * m);
  while (lines.length > 3 && size2 > 56) { size2 -= 8; lines = wrapText(g, title, size2, true, W - 2 * m); }
  let y = Math.trunc(bandH * 0.12) + 70;
  for (const ln of lines.slice(0, 3)) { text(g, ln, m, y, size2, true, ink); y += lineH(size2); }
  if (subtitle) text(g, subtitle, m, y + 6, 40, false, ink);
  const top = bandH + Math.trunc(H * 0.04), chipsH = 150, foot = Math.trunc(H * 0.09);
  const areaH = H - top - chipsH - foot, areaW = W - 2 * m;
  const [dw, dh] = fitSize(preview.width, preview.height, areaW - 40, areaH - 40);
  const fx = Math.trunc((W - dw) / 2), fy = top + Math.trunc((areaH - dh) / 2);
  g.fillStyle = "#fff"; g.fillRect(fx - 18, fy - 18, dw + 36, dh + 36);
  g.strokeStyle = rgb(tint(acc, 0.5)); g.lineWidth = 4; g.strokeRect(fx - 18, fy - 18, dw + 36, dh + 36);
  g.strokeStyle = "rgb(210,210,210)"; g.lineWidth = 2; g.strokeRect(fx - 8, fy - 8, dw + 16, dh + 16);
  drawFit(g, preview, fx, fy, dw, dh);
  let x = m, cy = H - foot - chipsH + 40;
  for (const ch of kt.chips) {
    const w = Math.trunc(tw(g, 32, true, ch)) + 56;
    if (x + w > W - m) { x = m; cy += 78; }
    rrect(g, x, cy, w, 62, 31, tint(acc, 0.88), acc, 2);
    text(g, ch, x + 28, cy + 12, 32, true, acc);
    x += w + 18;
  }
  const by = H - foot + 20;
  let bx = m;
  if (brand.logo) { const [lw] = drawLogo(g, brand.logo, m, by - 6, 220, foot - 20); bx = m + lw + 24; }
  const fl = footerLine(brand);
  if (fl) text(g, fl, bx, by + 8, 34, true, [80, 80, 80]);
  return c;
}

export function patternPage(size, brand, title, im, idx, n) {
  let [W, H] = size;
  if (im.width / Math.max(1, im.height) > LANDSCAPE_ASPECT) [W, H] = [H, W];
  const [c, g] = mkCanvas(W, H);
  const m = Math.trunc(W * 0.05), hh = Math.trunc(Math.min(W, H) * 0.075);
  drawHeader(g, W, hh, brand.accent, n > 1 ? title + "  —  Pattern " + idx + " of " + n : title, m);
  const foot = Math.trunc(Math.min(W, H) * 0.06);
  drawFit(g, im, m, hh + m, W - 2 * m, H - hh - foot - 2 * m);
  return c;
}
export function addFooters(pages, brand) {
  const n = pages.length, fl = footerLine(brand);
  pages.forEach((p, i) => {
    if (i === 0 || i === n - 1) return;
    const g = p.getContext("2d");
    const W = p.width, H = p.height, m = Math.trunc(W * 0.05), size = Math.trunc(Math.min(W, H) * 0.017);
    const y = H - Math.trunc(Math.min(W, H) * 0.045);
    g.strokeStyle = "rgb(215,215,215)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(m, y - 10); g.lineTo(W - m, y - 10); g.stroke();
    if (fl) text(g, fl, m, y, size, false, [120, 120, 120]);
    text(g, "Page " + (i + 1) + " of " + n, W - m, y, size, false, [120, 120, 120], "right");
  });
}
export function thanksPage(size, brand) {
  const [W, H] = size, com = KIT_CONTENT.common, acc = brand.accent;
  const [c, g] = mkCanvas(W, H);
  g.fillStyle = rgb(acc);
  g.fillRect(0, 0, W, Math.trunc(H * 0.06)); g.fillRect(0, H - Math.trunc(H * 0.06), W, Math.trunc(H * 0.06));
  const m = Math.trunc(W * 0.12);
  let y = Math.trunc(H * 0.22);
  if (brand.logo) { const [, lh] = drawLogo(g, brand.logo, Math.trunc((W - 320) / 2), y, 320, 320); y += lh + 50; }
  const msg = brand.thank_you || (brand.shop_name ? com.thank_you : com.no_brand_thank_you);
  for (const ln of wrapText(g, msg, 64, true, W - 2 * m)) { text(g, ln, W / 2, y, 64, true, acc, "center"); y += lineH(64); }
  y += 30;
  if (brand.shop_name) { text(g, brand.shop_name, W / 2, y, 46, true, [50, 50, 50], "center"); y += lineH(46); }
  if (brand.website) { text(g, brand.website, W / 2, y, 36, false, [90, 90, 90], "center"); y += lineH(36); }
  const lic = licenseShown(brand);
  const blocks = [];
  if (brand.copyright) blocks.push(brand.copyright);
  if (lic) blocks.push(lic);
  let lines = [];
  for (const b of blocks) lines = lines.concat(wrapText(g, b, 28, false, W - 2 * m), [""]);
  let ly = H - Math.trunc(H * 0.06) - 60 - lineH(28) * lines.length;
  for (const ln of lines) { text(g, ln, m, ly, 28, false, [110, 110, 110]); ly += lineH(28); }
  return c;
}
export function buildPatternPages(paper, brand, kt, preview, patternImages, title, subtitle) {
  const size = PAGE_SIZES[paper];
  const pages = [coverPage(size, brand, kt, preview, title, subtitle)];
  const k2 = Object.assign({}, kt, { title });
  pages.push(...flowPages(size, brand, k2));
  patternImages.forEach((im, i) => pages.push(patternPage(size, brand, title, im, i + 1, patternImages.length)));
  pages.push(thanksPage(size, brand));
  addFooters(pages, brand);
  return pages;
}

function pagesToPdfBlob(pages, paper) {
  const { jsPDF } = globalThis.jspdf;
  const [pw, ph] = paper === "a4" ? [595.28, 841.89] : [612, 792];
  let pdf = null;
  for (const p of pages) {
    const land = p.width > p.height;
    const w = land ? ph : pw, h = land ? pw : ph;
    const fmt = [w, h], ori = land ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: fmt, orientation: ori }); else pdf.addPage(fmt, ori);
    pdf.addImage(p.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
  }
  return pdf.output("blob");
}

export function listingImages(brand, kt, preview, pages, title, subtitle, dataNote, patternImages, hasKey, variantLabels) {
  const [W, H] = LISTING_SIZE, acc = brand.accent, com = KIT_CONTENT.common, out = [];
  const bar = (g, t) => {
    g.fillStyle = rgb(acc); g.fillRect(0, 0, W, 190);
    let s = 78;
    while (tw(g, s, true, t) > W - 160 && s > 40) s -= 4;
    text(g, t, 80, 95 - s * 0.6, s, true, inkOn(acc));
  };
  const foot = (g) => {
    let x = 80;
    if (brand.logo) { const [lw] = drawLogo(g, brand.logo, x, H - 110, 200, 80); x += lw + 20; }
    const fl = footerLine(brand);
    if (fl) text(g, fl, x, H - 90, 40, true, [110, 110, 110]);
  };
  // 1 hero
  let [c, g] = mkCanvas(W, H, tint(acc, 0.94));
  const [pdw, pdh] = fitSize(preview.width, preview.height, 1100, 1100);
  const px = 90, py = Math.trunc((H - pdh) / 2);
  g.fillStyle = "#fff"; g.fillRect(px - 18, py - 18, pdw + 36, pdh + 36);
  g.strokeStyle = rgb(tint(acc, 0.5)); g.lineWidth = 4; g.strokeRect(px - 18, py - 18, pdw + 36, pdh + 36);
  drawFit(g, preview, px, py, pdw, pdh);
  const tx = 1300;
  let fs = 78, lines = wrapText(g, title, fs, true, W - tx - 80);
  while (lines.length > 5 && fs > 44) { fs -= 6; lines = wrapText(g, title, fs, true, W - tx - 80); }
  let y = 210;
  for (const ln of lines) { text(g, ln, tx, y, fs, true, acc); y += lineH(fs); }
  if (subtitle) for (const ln of wrapText(g, subtitle, 40, false, W - tx - 80)) { text(g, ln, tx, y + 14, 40, false, [90, 90, 90]); y += lineH(40); }
  y += 60;
  for (const ch of kt.chips) {
    const w = Math.trunc(tw(g, 36, true, ch)) + 60;
    rrect(g, tx, y, w, 66, 33, [255, 255, 255], acc, 3);
    text(g, ch, tx + 30, y + 14, 36, true, acc);
    y += 90;
  }
  text(g, "PRINTABLE PDF", tx, H - 250, 40, true, acc);
  text(g, "INSTANT DOWNLOAD", tx, H - 195, 40, true, acc);
  foot(g);
  out.push(["01_hero.png", c]);
  // 2 included
  [c, g] = mkCanvas(W, H); bar(g, "What's included");
  const items = com.included.slice();
  if (dataNote) items.push(com.included_extra_data);
  if (variantLabels && variantLabels.length > 1) items.push(variantLabels.length + " versions: " + variantLabels.join(" \u00b7 "));
  y = 290;
  for (const it of items) {
    g.fillStyle = rgb(acc); g.beginPath(); g.arc(128, y + 32, 18, 0, 2 * Math.PI); g.fill();
    text(g, it, 180, y, 52, false, [50, 50, 50]);
    y += 130;
  }
  foot(g); out.push(["02_included.png", c]);
  // 3 glance
  [c, g] = mkCanvas(W, H); bar(g, "At a glance");
  const rows = kt.glance.slice(0, 8), rh = Math.min(140, Math.trunc(1000 / Math.max(1, rows.length)));
  y = 250;
  rows.forEach(([k, v], i) => {
    if (i % 2 === 0) { g.fillStyle = rgb(tint(acc, 0.92)); g.fillRect(80, y, W - 160, rh); }
    text(g, k, 120, y + Math.trunc(rh / 2) - 32, 50, true, [40, 40, 40]);
    text(g, ellipsize(g, v, 50, false, 1000), W - 120, y + Math.trunc(rh / 2) - 32, 50, false, [70, 70, 70], "right");
    y += rh;
  });
  foot(g); out.push(["03_glance.png", c]);
  // 4 sample of the real pattern (+ the key where the mode has one)
  [c, g] = mkCanvas(W, H);
  const pats = patternImages && patternImages.length ? patternImages : [preview];
  const two = hasKey && pats.length >= 2;
  bar(g, "Sample of the pattern" + (two ? " and key" : ""));
  const first = pats[0];
  const cw = Math.max(8, Math.trunc(first.width * 0.55)), ch = Math.max(8, Math.trunc(first.height * 0.55));
  const boxW = two ? 1100 : W - 160, boxH = H - 190 - 150 - 90, top = 190 + 50;
  const panel = (src, sx, sy, sw, sh, x, w, caption) => {
    const [dw, dh] = fitSize(sw, sh, w, boxH);
    const px = x + Math.trunc((w - dw) / 2), py = top + Math.trunc((boxH - dh) / 2);
    g.strokeStyle = rgb(tint(acc, 0.4)); g.lineWidth = 4; g.strokeRect(px - 4, py - 4, dw + 8, dh + 8);
    g.imageSmoothingEnabled = dw / sw < 1.5; g.imageSmoothingQuality = "high";
    g.drawImage(src, sx, sy, sw, sh, px, py, dw, dh);
    g.imageSmoothingEnabled = true;
    text(g, caption, x + w / 2, top + boxH + 25, 40, true, acc, "center");
  };
  panel(first, 0, 0, cw, ch, 80, boxW, "A section of the pattern, shown close up");
  if (two) { const k = pats[pats.length - 1]; panel(k, 0, 0, k.width, k.height, 1240, 680, "The key / legend"); }
  foot(g);
  out.push(["04_sample.png", c]);
  // 5 inside
  [c, g] = mkCanvas(W, H); bar(g, "Inside the PDF");
  const idx = [];
  for (const i of [0, 1, pages.length - 2, pages.length - 1]) if (i >= 0 && i < pages.length && !idx.includes(i)) idx.push(i);
  const pick = idx.map((i) => pages[i]), n = pick.length, gap = 60;
  let t = 560;
  if (n * t + (n - 1) * gap > W - 160) t = Math.trunc((W - 160 - (n - 1) * gap) / n);
  let x = Math.trunc((W - (n * t + (n - 1) * gap)) / 2);
  for (const p of pick) {
    let w = t, h = Math.max(1, Math.trunc(p.height * t / p.width));
    if (h > 1000) { w = Math.trunc(w * 1000 / h); h = 1000; }
    const yy = 270 + Math.trunc((1000 - h) / 2);
    g.strokeStyle = "rgb(200,200,200)"; g.lineWidth = 3; g.strokeRect(x - 3, yy - 3, w + 6, h + 6);
    g.imageSmoothingQuality = "high"; g.drawImage(p, x, yy, w, h);
    x += t + gap;
  }
  text(g, pages.length + "-page printable PDF", 80, 1330, 46, true, acc);
  foot(g); out.push(["05_inside.png", c]);
  return out;
}

const canvasBlob = (c, type = "image/png") => new Promise((res) => c.toBlob(res, type));

export async function buildKitZip(opts) {
  const { mode, stats, preview, patternImages, dataFiles = {} } = opts;
  if (!SUPPORTED_MODES.includes(mode)) throw new Error("Product Kit is not available for this mode yet.");
  const brand = normalizeBranding(opts.brand);
  if (opts.brand && opts.brand.logo) brand.logo = opts.brand.logo;
  const kt = kitText(mode, stats);
  const title = (opts.title || "").trim() || kt.title;
  const subtitle = opts.subtitle == null ? kt.subtitle : String(opts.subtitle).trim();
  const papers = opts.papers || ["letter", "a4"];
  const slug = slugify(title);
  const extra = opts.variants || [];
  const versions = [{ mode, stats, preview, pages: patternImages, data: dataFiles }].concat(
    extra.map((v) => ({ mode: v.mode, stats: v.stats, preview: v.preview, pages: v.pages, data: v.data || {} })));
  const multi = versions.length > 1;
  const kts = [kt].concat(extra.map((v) => kitText(v.mode, v.stats)));
  const labels = kts.map((k) => k.variant_label || k.label);
  const hasData = versions.some((v) => Object.keys(v.data).length > 0);
  const zip = new (opts.JSZip || globalThis.JSZip)();
  const dir = zip.folder(slug);
  const written = [];
  const put = (name, data) => { dir.file(name, data); written.push(name); };
  let first = null;
  for (let idx = 0; idx < versions.length; idx++) {
    const v = versions[idx], kv = kts[idx], label = labels[idx];
    const folder = multi ? slugify(label) + "/" : "";
    const vtitle = multi ? `${title} \u2014 ${label} Edition` : title;
    const vsub = idx === 0 ? subtitle : kv.subtitle;
    for (const paper of papers) {
      const pages = buildPatternPages(paper, brand, kv, v.preview, v.pages, vtitle, vsub);
      if (!first) first = pages;
      const fname = multi ? `${slug}_${slugify(label)}_${PAGE_LABELS[paper]}.pdf` : `${slug}_Pattern_${PAGE_LABELS[paper]}.pdf`;
      put(folder + fname, pagesToPdfBlob(pages, paper));
    }
    if (idx === 0 && !first) first = buildPatternPages("letter", brand, kv, v.preview, v.pages, vtitle, vsub);
    put(folder + "preview.png", await canvasBlob(v.preview));
    for (const [name, data] of Object.entries(v.data)) put(folder + "data/" + name, data);
  }
  if (opts.images !== false) {
    for (const [name, c] of listingImages(brand, kt, preview, first, title, subtitle, hasData, patternImages,
      KEY_MODES.includes(mode), multi ? labels : null)) put("listing_images/" + name, await canvasBlob(c));
  }
  if (opts.listing !== false) {
    put("listing.txt", listingText(brand, kt, title, subtitle, hasData,
      multi ? kts.map((k, i) => [labels[i], k.variant_line]) : null).text);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, slug, files: written, pages: first.length };
}
