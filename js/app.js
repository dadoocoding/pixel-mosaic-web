/**
 * app.js
 * Main application controller: wires the DOM to the core modules.
 */

import { rgbToHex, hexToRgb, contrastTextColor } from "./core/color.js";
import { buildMonochromePalette } from "./core/quantize.js";
import { imageToGrid } from "./core/grid.js";
import { renderMosaic, renderBrickMosaic, estimateOutputDimensions } from "./core/render.js";
import { hexHitTest } from "./core/shapes.js";
import { splitIntoPanels } from "./core/panels.js";
import { LEGO_BRICK_SIZES, footprintLabel } from "./core/bricks.js";
import { colorCounts } from "./core/colorCounts.js";
import { LEGO_SOLID_COLORS, parsePaletteFile } from "./core/palettes.js";
import {
  buildGridJson, buildGridCsv, buildPaletteCsv,
  buildBricksJson, buildBricksCsv, buildShoppingListCsv,
} from "./core/exportData.js";
import { CanvasViewer } from "./ui/canvasViewer.js";

const GRID_MAX_CELLS = 240;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  sourceCanvas: null,
  sourceFileName: "",
  gridW: 40,
  gridH: 40,
  quantizedGrid: null,   // flat [r,g,b] array, row-major
  palette: null,
  colorNames: [],
  renderedShape: "square",
  renderedCellSize: 36,
  outputCanvas: null,
  bgColor: [18, 18, 20],
  monochromeBaseColor: [40, 70, 170],
  colorSourceMode: "auto",
  fixedPalette: null,
  fixedPaletteNames: null,
  shape: "square",
  brickLayout: null,
  brickCanvas: null,
  sampledHex: null,
  viewMode: "source",
};

const brickSizeSelections = new Map(LEGO_BRICK_SIZES.map(([w, h]) => [`${w}x${h}`, true]));

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  dropZone: $("dropZone"), dropLabel: $("dropLabel"),
  browseBtn: $("browseBtn"), pasteBtn: $("pasteBtn"), fileInput: $("fileInput"),
  gridWidth: $("gridWidth"), gridWidthVal: $("gridWidthVal"),
  gridHeight: $("gridHeight"), gridHeightVal: $("gridHeightVal"),
  lockAspect: $("lockAspect"), sizeEstimate: $("sizeEstimate"),
  colorSourceSeg: $("colorSourceSeg"), colorsLabel: $("colorsLabel"),
  numColors: $("numColors"), numColorsVal: $("numColorsVal"),
  fixedPaletteLabel: $("fixedPaletteLabel"), choosePaletteBtn: $("choosePaletteBtn"),
  monoColorBtn: $("monoColorBtn"), monoColorPicker: $("monoColorPicker"),
  cellSize: $("cellSize"), cellSizeVal: $("cellSizeVal"),
  shapeSeg: $("shapeSeg"),
  bgColorBtn: $("bgColorBtn"), bgColorPicker: $("bgColorPicker"),
  generateBtn: $("generateBtn"), paletteBtn: $("paletteBtn"),
  optimizeBricksBtn: $("optimizeBricksBtn"), brickSummary: $("brickSummary"),
  exportBricksJsonBtn: $("exportBricksJsonBtn"), exportBricksCsvBtn: $("exportBricksCsvBtn"),
  exportShoppingListBtn: $("exportShoppingListBtn"),
  panelWidth: $("panelWidth"), panelWidthVal: $("panelWidthVal"),
  panelHeight: $("panelHeight"), panelHeightVal: $("panelHeightVal"),
  panelEstimate: $("panelEstimate"), exportPanelsBtn: $("exportPanelsBtn"),
  exportPngBtn: $("exportPngBtn"), exportJsonBtn: $("exportJsonBtn"), exportCsvBtn: $("exportCsvBtn"),
  viewToggle: $("viewToggle"),
  zoomInBtn: $("zoomInBtn"), zoomOutBtn: $("zoomOutBtn"), zoomFitBtn: $("zoomFitBtn"),
  previewCanvas: $("previewCanvas"),
  sampleSwatch: $("sampleSwatch"), sampleInfo: $("sampleInfo"), copyHexBtn: $("copyHexBtn"),
  statusLine: $("statusLine"),
  dialogRoot: $("dialogRoot"),
};

// ---------------------------------------------------------------------------
// Worker (keeps K-Means / brick-layout compute off the UI thread)
// ---------------------------------------------------------------------------

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, ok, result, error } = e.data;
  const resolver = pending.get(id);
  if (!resolver) return;
  pending.delete(id);
  ok ? resolver.resolve(result) : resolver.reject(new Error(error));
};
function callWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function setStatus(text) {
  el.statusLine.textContent = text;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadText(text, filename, mime) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function setSwatchButton(btn, rgb) {
  const hex = rgbToHex(rgb);
  btn.textContent = hex;
  btn.style.background = hex;
  btn.style.color = contrastTextColor(rgb);
}

// ---------------------------------------------------------------------------
// Preview viewer
// ---------------------------------------------------------------------------

const viewer = new CanvasViewer(el.previewCanvas, { onClick: onCanvasClick });

function refreshPreview(resetView = true) {
  if (state.viewMode === "source") {
    state.sourceCanvas
      ? viewer.setImage(state.sourceCanvas, { resetView })
      : viewer.showPlaceholder("Load an image to get started");
  } else if (state.viewMode === "bricks") {
    state.brickCanvas
      ? viewer.setImage(state.brickCanvas, { resetView })
      : viewer.showPlaceholder("Optimize into bricks first (see the left panel)");
  } else {
    state.outputCanvas
      ? viewer.setImage(state.outputCanvas, { resetView })
      : viewer.showPlaceholder("Generate a mosaic to see the output here");
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  [...el.viewToggle.children].forEach(b => b.classList.toggle("active", b.dataset.view === mode));
  refreshPreview();
}

el.viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) setViewMode(btn.dataset.view);
});

el.zoomInBtn.addEventListener("click", () => viewer.zoomIn());
el.zoomOutBtn.addEventListener("click", () => viewer.zoomOut());
el.zoomFitBtn.addEventListener("click", () => viewer.zoomReset());

// ---------------------------------------------------------------------------
// Color sampling (click on the preview)
// ---------------------------------------------------------------------------

function onCanvasClick(x, y) {
  if (state.viewMode === "source") sampleSourcePixel(x, y);
  else if (state.viewMode === "bricks") sampleBrickCell(x, y);
  else sampleOutputCell(x, y);
}

function sampleSourcePixel(x, y) {
  if (!state.sourceCanvas) return;
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= state.sourceCanvas.width || iy >= state.sourceCanvas.height) return;
  const data = state.sourceCanvas.getContext("2d").getImageData(ix, iy, 1, 1).data;
  showSampledColor([data[0], data[1], data[2]], `Source pixel (${ix}, ${iy})`);
}

function sampleOutputCell(x, y) {
  if (!state.quantizedGrid) return;
  const { gridW, gridH, renderedShape, renderedCellSize } = state;
  let rc;
  if (renderedShape === "hexagon") {
    rc = hexHitTest(x, y, gridW, gridH, renderedCellSize);
  } else {
    const col = Math.floor(x / renderedCellSize), row = Math.floor(y / renderedCellSize);
    rc = (row >= 0 && row < gridH && col >= 0 && col < gridW) ? [row, col] : null;
  }
  if (!rc) return;
  const [row, col] = rc;
  const rgb = state.quantizedGrid[row * gridW + col];
  const bits = [`Row ${row}, Col ${col}`];
  const idx = paletteIndexFor(rgb);
  if (idx !== null) {
    bits.push(`Color #${idx + 1}`);
    if (state.colorNames[idx]) bits.push(state.colorNames[idx]);
  }
  showSampledColor(rgb, bits.join(" \u2022 "));
}

function sampleBrickCell(x, y) {
  if (!state.brickLayout) return;
  const cellSize = state.renderedCellSize;
  const col = Math.floor(x / cellSize), row = Math.floor(y / cellSize);
  const brick = state.brickLayout.find(b =>
    row >= b.row && row < b.row + b.height && col >= b.col && col < b.col + b.width);
  if (!brick) return;
  const bits = [`Row ${brick.row}, Col ${brick.col}`, `${footprintLabel(brick.width, brick.height)} piece`];
  const idx = paletteIndexFor(brick.rgb);
  if (idx !== null) {
    bits.push(`Color #${idx + 1}`);
    if (state.colorNames[idx]) bits.push(state.colorNames[idx]);
  }
  showSampledColor(brick.rgb, bits.join(" \u2022 "));
}

function paletteIndexFor(rgb) {
  if (!state.palette) return null;
  for (let i = 0; i < state.palette.length; i++) {
    const p = state.palette[i];
    if (p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]) return i;
  }
  return null;
}

function showSampledColor(rgb, extra) {
  const hex = rgbToHex(rgb);
  state.sampledHex = hex;
  el.sampleSwatch.style.background = hex;
  el.sampleInfo.textContent = `${hex}   rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` + (extra ? `\n${extra}` : "");
  el.copyHexBtn.disabled = false;
}

function resetSampleDisplay() {
  state.sampledHex = null;
  el.sampleSwatch.style.background = "#26262b";
  el.sampleInfo.textContent = "Click the image to sample a color";
  el.copyHexBtn.disabled = true;
}

el.copyHexBtn.addEventListener("click", async () => {
  if (!state.sampledHex) return;
  try {
    await navigator.clipboard.writeText(state.sampledHex);
    setStatus(`Copied ${state.sampledHex} to clipboard.`);
  } catch {
    setStatus("Couldn't copy \u2014 your browser may need a permission prompt.");
  }
});

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

async function loadImageFromBlob(blob, displayName) {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    applyLoadedImage(canvas, displayName || "image");
  } catch (err) {
    setStatus(`Couldn't open that file: ${err.message}`);
  }
}

function loadImageFromFile(file) {
  return loadImageFromBlob(file, file.name);
}

async function loadImageFromURL(url) {
  setStatus("Downloading image from browser...");
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get("Content-Type") || "";
    const looksLikeImage = contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(url);
    if (!looksLikeImage) throw new Error(`that link doesn't look like an image (${contentType || "unknown type"})`);
    const blob = await resp.blob();
    const displayName = decodeURIComponent((url.split("/").pop() || "image").split("?")[0]) || "image from browser";
    await loadImageFromBlob(blob, displayName);
  } catch (err) {
    setStatus(`Couldn't load image from browser: ${err.message} \u2014 cross-origin images are sometimes blocked; try Paste from Clipboard instead.`);
  }
}

function applyLoadedImage(canvas, displayName) {
  state.sourceCanvas = canvas;
  state.sourceFileName = displayName;
  el.dropLabel.textContent = `Loaded: ${displayName}\n(${canvas.width}\u00d7${canvas.height})`;

  state.quantizedGrid = null;
  state.palette = null;
  state.colorNames = [];
  state.outputCanvas = null;
  clearBrickLayout();
  disableGenerationDependentButtons();
  el.generateBtn.disabled = false;
  resetSampleDisplay();

  if (el.lockAspect.checked) syncHeightToAspect();

  setViewMode("source");
  updateSizeEstimate();
  updatePanelEstimate();
  setStatus("Image loaded. Adjust settings and click Generate.");
}

el.browseBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files[0];
  if (file) loadImageFromFile(file);
  el.fileInput.value = "";
});

el.dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.dropZone.classList.add("dragover");
});
el.dropZone.addEventListener("dragleave", () => el.dropZone.classList.remove("dragover"));
el.dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  el.dropZone.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    await loadImageFromFile(e.dataTransfer.files[0]);
    return;
  }
  const url = extractUrlFromDragData(e.dataTransfer);
  if (url) await loadImageFromURL(url);
  else setStatus("Couldn't find an image in what was dropped.");
});

function extractUrlFromDragData(dt) {
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const line = uriList.split("\n").map(s => s.trim()).find(l => l && !l.startsWith("#"));
    if (line) return line;
  }
  const plain = dt.getData("text/plain");
  if (plain && /^https?:\/\//i.test(plain.trim())) return plain.trim();
  const html = dt.getData("text/html");
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) return m[1];
  }
  return null;
}

async function pasteFromClipboardButton() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith("image/"));
      if (imageType) {
        const blob = await item.getType(imageType);
        await loadImageFromBlob(blob, "Pasted image");
        return;
      }
    }
    setStatus('Clipboard has no image. In your browser, right-click the image and choose "Copy image", then try again.');
  } catch (err) {
    setStatus(`Couldn't read the clipboard: ${err.message}`);
  }
}
el.pasteBtn.addEventListener("click", pasteFromClipboardButton);

document.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) await loadImageFromBlob(blob, "Pasted image");
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Slider / control wiring
// ---------------------------------------------------------------------------

function syncHeightToAspect() {
  const w = parseInt(el.gridWidth.value, 10);
  const aspect = state.sourceCanvas.height / state.sourceCanvas.width;
  let h = Math.max(4, Math.round(w * aspect));
  h = Math.min(h, GRID_MAX_CELLS);
  el.gridHeight.value = h;
  el.gridHeightVal.textContent = h;
}

function updateSizeEstimate() {
  const gw = parseInt(el.gridWidth.value, 10);
  const gh = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const [w, h] = estimateOutputDimensions(gw, gh, state.shape, cellSize);
  const mp = (w * h) / 1e6;
  const mb = (w * h * 3) / 1e6;
  let text = `Output image: ~${w.toLocaleString()}\u00d7${h.toLocaleString()}px (${mp.toFixed(0)}MP)`;
  if (mb > 300) {
    text += "  \u26a0 large \u2014 generating will take a while";
    el.sizeEstimate.style.color = "#e0a030";
  } else {
    el.sizeEstimate.style.color = "";
  }
  el.sizeEstimate.textContent = text;
}

function updatePanelEstimate() {
  const pw = parseInt(el.panelWidth.value, 10);
  const ph = parseInt(el.panelHeight.value, 10);
  const gw = parseInt(el.gridWidth.value, 10);
  const gh = parseInt(el.gridHeight.value, 10);
  const nCols = Math.ceil(gw / pw), nRows = Math.ceil(gh / ph);
  const even = gw % pw === 0 && gh % ph === 0;
  el.panelEstimate.textContent =
    `\u2192 ${nCols} cols \u00d7 ${nRows} rows = ${nCols * nRows} panels` + (even ? " (even)" : " (edge panels smaller)");
}

el.gridWidth.addEventListener("input", () => {
  el.gridWidthVal.textContent = el.gridWidth.value;
  if (el.lockAspect.checked && state.sourceCanvas) syncHeightToAspect();
  updateSizeEstimate(); updatePanelEstimate();
});
el.gridHeight.addEventListener("input", () => {
  el.gridHeightVal.textContent = el.gridHeight.value;
  updateSizeEstimate(); updatePanelEstimate();
});
el.lockAspect.addEventListener("change", () => {
  if (el.lockAspect.checked && state.sourceCanvas) { syncHeightToAspect(); updateSizeEstimate(); updatePanelEstimate(); }
});
el.numColors.addEventListener("input", () => { el.numColorsVal.textContent = el.numColors.value; });
el.cellSize.addEventListener("input", () => {
  el.cellSizeVal.textContent = el.cellSize.value;
  updateSizeEstimate();
});
el.panelWidth.addEventListener("input", () => { el.panelWidthVal.textContent = el.panelWidth.value; updatePanelEstimate(); });
el.panelHeight.addEventListener("input", () => { el.panelHeightVal.textContent = el.panelHeight.value; updatePanelEstimate(); });

el.colorSourceSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  [...el.colorSourceSeg.children].forEach(b => b.classList.toggle("active", b === btn));
  state.colorSourceMode = btn.dataset.mode;
  updateColorSourceUI();
});

function updateColorSourceUI() {
  const mode = state.colorSourceMode;
  el.choosePaletteBtn.disabled = mode !== "fixed";
  el.monoColorBtn.disabled = mode !== "monochrome";
  el.numColors.disabled = mode === "fixed";
  if (mode === "monochrome") el.colorsLabel.textContent = "Number of shades (0 = default 12)";
  else if (mode === "fixed") el.colorsLabel.textContent = "Number of colors (set by chosen palette)";
  else el.colorsLabel.textContent = "Number of colors (0 = auto)";
}

el.shapeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-shape]");
  if (!btn) return;
  [...el.shapeSeg.children].forEach(b => b.classList.toggle("active", b === btn));
  state.shape = btn.dataset.shape;
  updateSizeEstimate();
});

el.bgColorBtn.addEventListener("click", () => el.bgColorPicker.click());
el.bgColorPicker.addEventListener("input", () => {
  state.bgColor = hexToRgb(el.bgColorPicker.value);
  setSwatchButton(el.bgColorBtn, state.bgColor);
  if (state.quantizedGrid) {
    state.outputCanvas = renderMosaic(state.quantizedGrid, state.gridW, state.gridH,
      state.renderedShape, state.renderedCellSize, state.bgColor, makeCanvas);
    if (state.viewMode === "output") refreshPreview(false);
  }
});

el.monoColorBtn.addEventListener("click", () => el.monoColorPicker.click());
el.monoColorPicker.addEventListener("input", () => {
  state.monochromeBaseColor = hexToRgb(el.monoColorPicker.value);
  setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
});

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

el.generateBtn.addEventListener("click", generateMosaic);

async function generateMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const mode = state.colorSourceMode;
  if (mode === "fixed" && !state.fixedPalette) {
    setStatus("Choose a fixed palette first, or switch back to Auto (K-Means).");
    return;
  }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const numColors = parseInt(el.numColors.value, 10) || null;
  const cellSize = parseInt(el.cellSize.value, 10);
  const shape = state.shape;
  const bgColor = state.bgColor;

  el.generateBtn.disabled = true;
  el.generateBtn.textContent = "Generating...";
  setStatus("Crunching colors, this can take a few seconds for larger grids...");

  try {
    const grid = imageToGrid(state.sourceCanvas, gridW, gridH);

    let palette, quantizedFlat, chosenN, names;
    if (mode === "fixed") {
      const result = await callWorker("quantize-fixed", { points: grid, palette: state.fixedPalette });
      palette = result.palette;
      quantizedFlat = Array.from(result.labels).map(l => palette[l]);
      chosenN = palette.length;
      names = state.fixedPaletteNames ? [...state.fixedPaletteNames] : null;
    } else if (mode === "monochrome") {
      const nShades = parseInt(el.numColors.value, 10) || 12;
      const ramp = buildMonochromePalette(state.monochromeBaseColor, nShades);
      const result = await callWorker("quantize-fixed", { points: grid, palette: ramp });
      palette = result.palette;
      quantizedFlat = Array.from(result.labels).map(l => palette[l]);
      chosenN = palette.length;
      names = ramp.map((_, i) => `Shade ${i + 1}`);
    } else {
      const result = await callWorker("quantize-auto", { points: grid, nColors: numColors });
      palette = result.palette;
      quantizedFlat = Array.from(result.labels).map(l => palette[l]);
      chosenN = result.chosenK;
      names = null;
    }

    const outputCanvas = renderMosaic(quantizedFlat, gridW, gridH, shape, cellSize, bgColor, makeCanvas);

    state.gridW = gridW;
    state.gridH = gridH;
    state.quantizedGrid = quantizedFlat;
    state.palette = palette;
    state.colorNames = names ? [...names] : palette.map(() => "");
    state.renderedShape = shape;
    state.renderedCellSize = cellSize;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportJsonBtn.disabled = false;
    el.exportCsvBtn.disabled = false;
    el.paletteBtn.disabled = false;
    el.exportPanelsBtn.disabled = false;
    updatePanelEstimate();

    clearBrickLayout();
    if (shape === "square") {
      el.optimizeBricksBtn.disabled = false;
    } else {
      el.optimizeBricksBtn.disabled = true;
      el.brickSummary.textContent = "(needs Square tile shape)";
    }

    setViewMode("output");

    if (mode === "fixed" || mode === "monochrome") {
      const used = colorCounts(quantizedFlat, palette).filter(c => c.count > 0).length;
      const label = mode === "fixed" ? "palette colors" : "shades";
      setStatus(`Done \u2014 ${used} of ${chosenN} ${label} used, ${gridW}\u00d7${gridH} grid.`);
    } else {
      setStatus(`Done \u2014 ${chosenN} colors, ${gridW}\u00d7${gridH} grid.`);
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.generateBtn.disabled = false;
    el.generateBtn.textContent = "Generate Mosaic";
  }
}

function disableGenerationDependentButtons() {
  el.exportPngBtn.disabled = true;
  el.exportJsonBtn.disabled = true;
  el.exportCsvBtn.disabled = true;
  el.paletteBtn.disabled = true;
  el.exportPanelsBtn.disabled = true;
  el.optimizeBricksBtn.disabled = true;
}

function clearBrickLayout() {
  state.brickLayout = null;
  state.brickCanvas = null;
  el.brickSummary.textContent = "";
  el.exportBricksJsonBtn.disabled = true;
  el.exportBricksCsvBtn.disabled = true;
  el.exportShoppingListBtn.disabled = true;
}

// ---------------------------------------------------------------------------
// Dialog helper
// ---------------------------------------------------------------------------

function showDialog({ title, desc, bodyEl, actions }) {
  el.dialogRoot.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const box = document.createElement("div");
  box.className = "dialog-box";

  const h2 = document.createElement("h2");
  h2.textContent = title;
  box.appendChild(h2);

  if (desc) {
    const p = document.createElement("p");
    p.className = "dialog-desc";
    p.textContent = desc;
    box.appendChild(p);
  }

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "dialog-body";
  bodyWrap.appendChild(bodyEl);
  box.appendChild(bodyWrap);

  const actionsRow = document.createElement("div");
  actionsRow.className = "dialog-actions";
  const buttons = actions.map(a => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
    if (a.primary) btn.classList.add("primary");
    if (a.disabled) btn.disabled = true;
    btn.addEventListener("click", a.onClick);
    actionsRow.appendChild(btn);
    return btn;
  });
  box.appendChild(actionsRow);

  overlay.appendChild(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDialog(); });
  el.dialogRoot.appendChild(overlay);
  return buttons;
}

function closeDialog() {
  el.dialogRoot.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Palette editor (post-generation rename/recolor)
// ---------------------------------------------------------------------------

el.paletteBtn.addEventListener("click", openPaletteEditor);

function openPaletteEditor() {
  if (!state.palette) return;
  const body = document.createElement("div");
  state.palette.forEach((rgb, i) => {
    const row = document.createElement("div");
    row.className = "swatch-row";

    const idxLabel = document.createElement("span");
    idxLabel.className = "idx-label";
    idxLabel.textContent = `#${i + 1}`;

    const swatch = document.createElement("div");
    swatch.className = "mini-swatch";
    swatch.style.background = rgbToHex(rgb);
    swatch.title = "Click to change color";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rgbToHex(rgb);
    colorInput.hidden = true;
    swatch.addEventListener("click", () => colorInput.click());
    colorInput.addEventListener("input", () => {
      const newRgb = hexToRgb(colorInput.value);
      editPaletteColor(i, newRgb);
      swatch.style.background = colorInput.value;
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Paint name (optional)";
    nameInput.value = state.colorNames[i] || "";
    nameInput.addEventListener("input", () => { state.colorNames[i] = nameInput.value; });

    row.append(idxLabel, swatch, colorInput, nameInput);
    body.appendChild(row);
  });

  showDialog({
    title: "Edit Color Palette",
    desc: `${state.palette.length} colors \u2014 click a swatch to edit, type a name to label it`,
    bodyEl: body,
    actions: [{ label: "Close", primary: true, onClick: closeDialog }],
  });
}

function editPaletteColor(idx, newRgb) {
  const oldRgb = state.palette[idx];
  for (let i = 0; i < state.quantizedGrid.length; i++) {
    const c = state.quantizedGrid[i];
    if (c[0] === oldRgb[0] && c[1] === oldRgb[1] && c[2] === oldRgb[2]) state.quantizedGrid[i] = newRgb;
  }
  state.palette[idx] = newRgb;
  state.outputCanvas = renderMosaic(state.quantizedGrid, state.gridW, state.gridH,
    state.renderedShape, state.renderedCellSize, state.bgColor, makeCanvas);
  if (state.viewMode === "output") refreshPreview(false);
  setStatus(`Updated Color #${idx + 1} to ${rgbToHex(newRgb)}.`);
}

// ---------------------------------------------------------------------------
// Fixed palette chooser
// ---------------------------------------------------------------------------

el.choosePaletteBtn.addEventListener("click", openPaletteChooser);

function openPaletteChooser() {
  const body = document.createElement("div");

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.marginBottom = "10px";
  const legoBtn = document.createElement("button");
  legoBtn.type = "button"; legoBtn.textContent = "LEGO Solid Colors";
  const importBtn = document.createElement("button");
  importBtn.type = "button"; importBtn.textContent = "Import from File...";
  const importInput = document.createElement("input");
  importInput.type = "file"; importInput.accept = ".csv,.json"; importInput.hidden = true;
  btnRow.append(legoBtn, importBtn);

  const previewList = document.createElement("div");

  let pendingEntries = null, pendingLabel = "";
  let buttons;

  function renderPreview(entries, label) {
    pendingEntries = entries; pendingLabel = label;
    previewList.innerHTML = "";
    entries.forEach(({ name, rgb }) => {
      const row = document.createElement("div");
      row.className = "swatch-row";
      const sw = document.createElement("div");
      sw.className = "mini-swatch";
      sw.style.background = rgbToHex(rgb);
      const lbl = document.createElement("span");
      lbl.textContent = name || rgbToHex(rgb);
      row.append(sw, lbl);
      previewList.appendChild(row);
    });
    if (buttons) buttons[0].disabled = false;
  }

  legoBtn.addEventListener("click", () =>
    renderPreview(LEGO_SOLID_COLORS.map(c => ({ name: c.name, rgb: c.rgb })),
                  `LEGO Solid Colors (${LEGO_SOLID_COLORS.length} colors)`));
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const entries = parsePaletteFile(text, file.name);
      if (!entries.length) { setStatus("That file didn't contain any usable colors."); return; }
      renderPreview(entries, `${file.name.replace(/\.[^.]+$/, "")} (${entries.length} colors)`);
    } catch (err) {
      setStatus(`Couldn't load palette: ${err.message}`);
    }
  });

  body.append(btnRow, importInput, previewList);

  buttons = showDialog({
    title: "Choose Fixed Palette",
    desc: "Constrain colors to a fixed palette. Each cell is matched to the nearest color in the list below (perceptual match, not just closest RGB). Good for real materials with a fixed color set \u2014 LEGO, Perler beads, a specific paint line.",
    bodyEl: body,
    actions: [
      {
        label: "Use This Palette", primary: true, disabled: true, onClick: () => {
          if (pendingEntries) {
            state.fixedPalette = pendingEntries.map(e => e.rgb);
            state.fixedPaletteNames = pendingEntries.map(e => e.name);
            el.fixedPaletteLabel.textContent = `Using: ${pendingLabel}`;
          }
          closeDialog();
        },
      },
      { label: "Cancel", onClick: closeDialog },
    ],
  });

  if (state.fixedPalette) {
    const names = state.fixedPaletteNames || state.fixedPalette.map(() => "");
    renderPreview(state.fixedPalette.map((rgb, i) => ({ name: names[i], rgb })),
                  el.fixedPaletteLabel.textContent.replace("Using: ", ""));
  }
}

// ---------------------------------------------------------------------------
// Brick optimization
// ---------------------------------------------------------------------------

el.optimizeBricksBtn.addEventListener("click", openBrickSizeChooser);

function openBrickSizeChooser() {
  if (!state.quantizedGrid) return;
  const body = document.createElement("div");

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex"; btnRow.style.gap = "8px"; btnRow.style.marginBottom = "10px";
  const checkAllBtn = document.createElement("button");
  checkAllBtn.type = "button"; checkAllBtn.textContent = "Check All";
  const uncheckAllBtn = document.createElement("button");
  uncheckAllBtn.type = "button"; uncheckAllBtn.textContent = "Uncheck All";
  btnRow.append(checkAllBtn, uncheckAllBtn);

  const grid = document.createElement("div");
  grid.className = "checklist-grid";
  const checkboxes = [];
  LEGO_BRICK_SIZES.forEach(([w, h]) => {
    const key = `${w}x${h}`;
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = brickSizeSelections.get(key) !== false;
    cb.addEventListener("change", () => brickSizeSelections.set(key, cb.checked));
    label.append(cb, document.createTextNode(`${w}\u00d7${h}`));
    grid.appendChild(label);
    checkboxes.push(cb);
  });
  checkAllBtn.addEventListener("click", () =>
    checkboxes.forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event("change")); }));
  uncheckAllBtn.addEventListener("click", () =>
    checkboxes.forEach(cb => { cb.checked = false; cb.dispatchEvent(new Event("change")); }));

  const statusP = document.createElement("p");
  statusP.className = "hint";

  body.append(btnRow, grid, statusP);

  const buttons = showDialog({
    title: "Choose Brick/Plate Sizes",
    desc: "Pick which footprints are OK to use. The app tries the largest checked size first at each spot, falling back to smaller ones \u2014 and finally single 1\u00d71 pieces \u2014 wherever a bigger piece won't fit.",
    bodyEl: body,
    actions: [
      { label: "Compute Brick Layout", primary: true, onClick: () => runBrickOptimization(statusP, buttons) },
      { label: "Cancel", onClick: closeDialog },
    ],
  });
}

async function runBrickOptimization(statusP, buttons) {
  const selected = LEGO_BRICK_SIZES.filter(([w, h]) => brickSizeSelections.get(`${w}x${h}`) !== false);
  buttons[0].disabled = true;
  buttons[0].textContent = "Computing...";
  statusP.textContent = "Computing brick layout, this can take a few seconds...";

  try {
    const { bricks } = await callWorker("bricks", {
      grid: state.quantizedGrid, gridW: state.gridW, gridH: state.gridH, allowedSizes: selected,
    });
    state.brickLayout = bricks;
    state.brickCanvas = renderBrickMosaic(bricks, state.renderedCellSize, state.bgColor, makeCanvas);

    const totalCells = bricks.reduce((s, b) => s + b.width * b.height, 0);
    const avg = bricks.length ? totalCells / bricks.length : 0;
    el.brickSummary.textContent = `${bricks.length} pieces for ${totalCells} cells (${avg.toFixed(1)} cells/piece avg)`;

    el.exportBricksJsonBtn.disabled = false;
    el.exportBricksCsvBtn.disabled = false;
    el.exportShoppingListBtn.disabled = false;

    closeDialog();
    setViewMode("bricks");
    setStatus(`Brick layout ready \u2014 ${bricks.length} pieces (was ${totalCells} cells).`);
  } catch (err) {
    statusP.textContent = `Error: ${err.message}`;
    buttons[0].disabled = false;
    buttons[0].textContent = "Compute Brick Layout";
  }
}

el.exportBricksJsonBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  const json = buildBricksJson(state.brickLayout, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  downloadText(json, "bricks.json", "application/json");
  setStatus("Saved bricks.json");
});
el.exportBricksCsvBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  downloadText(buildBricksCsv(state.brickLayout, state.palette, state.colorNames), "bricks.csv", "text/csv");
  setStatus("Saved bricks.csv");
});
el.exportShoppingListBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  downloadText(buildShoppingListCsv(state.brickLayout, state.palette, state.colorNames), "shopping_list.csv", "text/csv");
  setStatus("Saved shopping_list.csv");
});

// ---------------------------------------------------------------------------
// Sub-structure panel export (zipped)
// ---------------------------------------------------------------------------

el.exportPanelsBtn.addEventListener("click", exportPanels);

async function exportPanels() {
  if (!state.quantizedGrid) return;
  const pw = parseInt(el.panelWidth.value, 10);
  const ph = parseInt(el.panelHeight.value, 10);

  setStatus("Splitting into panels and building zip...");
  el.exportPanelsBtn.disabled = true;
  try {
    const panels = splitIntoPanels(state.quantizedGrid, state.gridW, state.gridH, pw, ph);
    const zip = new JSZip();

    for (const p of panels) {
      const stem = `panel_r${p.panelRow + 1}_c${p.panelCol + 1}`;
      const extraMeta = {
        panel_row: p.panelRow + 1, panel_col: p.panelCol + 1,
        global_row_start: p.rowStart, global_row_end: p.rowEnd,
        global_col_start: p.colStart, global_col_end: p.colEnd,
      };
      const json = buildGridJson(p.grid, p.width, p.height, state.palette, state.renderedShape, {
        sourceName: state.sourceFileName, names: state.colorNames,
        rowOffset: p.rowStart, colOffset: p.colStart, includeGlobalCoords: true, extraMeta,
      });
      const csv = buildGridCsv(p.grid, p.width, p.height, state.palette, state.colorNames, {
        rowOffset: p.rowStart, colOffset: p.colStart, includeGlobalCoords: true,
      });
      zip.file(`${stem}.json`, json);
      zip.file(`${stem}.csv`, csv);
      zip.file(`${stem}_colors.csv`, buildPaletteCsv(p.grid, state.palette, state.colorNames));
    }

    const manifest = {
      source_image: state.sourceFileName,
      shape: state.renderedShape,
      panel_grid_cols: Math.max(...panels.map(p => p.panelCol)) + 1,
      panel_grid_rows: Math.max(...panels.map(p => p.panelRow)) + 1,
      panel_count: panels.length,
      panels: panels.map(p => ({
        panel_row: p.panelRow + 1, panel_col: p.panelCol + 1,
        global_row_start: p.rowStart, global_row_end: p.rowEnd,
        global_col_start: p.colStart, global_col_end: p.colEnd,
        width: p.width, height: p.height,
        json_file: `panel_r${p.panelRow + 1}_c${p.panelCol + 1}.json`,
        csv_file: `panel_r${p.panelRow + 1}_c${p.panelCol + 1}.csv`,
        colors_file: `panel_r${p.panelRow + 1}_c${p.panelCol + 1}_colors.csv`,
      })),
      full_mosaic_colors_file: "full_mosaic_colors.csv",
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("full_mosaic_colors.csv", buildPaletteCsv(state.quantizedGrid, state.palette, state.colorNames));

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "panels.zip");
    setStatus(`Exported ${panels.length} panels (JSON + CSV + color counts each) as panels.zip`);
  } catch (err) {
    setStatus(`Error exporting panels: ${err.message}`);
  } finally {
    el.exportPanelsBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Single-file export
// ---------------------------------------------------------------------------

el.exportPngBtn.addEventListener("click", () => {
  if (!state.outputCanvas) return;
  state.outputCanvas.toBlob(blob => downloadBlob(blob, "mosaic.png"), "image/png");
});

el.exportJsonBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  const json = buildGridJson(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  downloadText(json, "mosaic.json", "application/json");
  setStatus("Saved mosaic.json");
});

el.exportCsvBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  downloadText(buildGridCsv(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.colorNames),
    "mosaic.csv", "text/csv");
  downloadText(buildPaletteCsv(state.quantizedGrid, state.palette, state.colorNames),
    "mosaic_colors.csv", "text/csv");
  setStatus("Saved mosaic.csv and mosaic_colors.csv");
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setSwatchButton(el.bgColorBtn, state.bgColor);
setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
updateColorSourceUI();
updateSizeEstimate();
updatePanelEstimate();
refreshPreview();
