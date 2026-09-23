/**
 * app.js
 * Main application controller: wires the DOM to the core modules.
 */

import { rgbToHex, hexToRgb, contrastTextColor } from "./core/color.js";
import { buildMonochromePalette } from "./core/quantize.js";
import { imageToGrid } from "./core/grid.js";
import { renderMosaic, renderBrickMosaic, estimateOutputDimensions, renderPaintByNumber, renderColorKey } from "./core/render.js";
import { hexHitTest, circleInterlockHitTest } from "./core/shapes.js";
import { computeEdgeMask } from "./core/edges.js";
import { splitIntoPanels } from "./core/panels.js";
import { LEGO_BRICK_SIZES, footprintLabel } from "./core/bricks.js";
import { colorCounts } from "./core/colorCounts.js";
import { LEGO_SOLID_COLORS, parsePaletteFile } from "./core/palettes.js";
import { buildQuadtree, renderAdaptiveMosaic } from "./core/adaptive.js";
import {
  imageToGrayGrid, stretchToRange, ditherToPips, pipLevelBrightness,
  renderDiceMosaic, renderDiceKey,
} from "./core/dice.js";
import {
  RUBIKS_CUBE_COLORS, RUBIKS_PALETTE, RUBIKS_COLOR_NAMES, renderRubiksMosaic, renderRubiksBuildSheet,
  renderRubiksKey, rubiksCubeCount, remapRubiksColors,
} from "./core/rubiks.js";
import { renderMetaMosaic } from "./core/meta.js";
import { renderFoundObjectMosaic } from "./core/foundobject.js";
import { PIECE_SIZE_UNITS, formatPhysicalSize } from "./core/physicalSize.js";
import { DMC_RGB_PALETTE } from "./core/dmc.js";
import {
  dmcColorCounts, crossStitchSymbolMap, renderCrossStitchMosaic,
  renderCrossStitchPatternPage, renderCrossStitchLegendPage,
} from "./core/crossstitch.js";
import {
  buildGridJson, buildGridCsv, buildPaletteCsv,
  buildBricksJson, buildBricksCsv, buildShoppingListCsv,
  buildAdaptiveTilesJson, buildAdaptiveShoppingListCsv, buildDiceShoppingListCsv,
  buildRubiksShoppingListCsv, buildCrossStitchShoppingListCsv,
} from "./core/exportData.js";
import { CanvasViewer } from "./ui/canvasViewer.js";
import { nearestPaintMatchesAllBrands, formatBestMatch } from "./core/paintColors.js";

// Raised from 240 for Counted Cross-Stitch mode's higher-resolution
// patterns; applies to every mode since they share these sliders.
const GRID_MAX_CELLS = 400;

const SAMPLE_IMAGES = [
  { file: "astronaut.jpg", title: "Astronaut", credit: "NASA \u2014 public domain" },
  { file: "hubble_deep_field.jpg", title: "Hubble Deep Field", credit: "NASA \u2014 public domain" },
  { file: "rocket.jpg", title: "Rocket Launch", credit: "SpaceX \u2014 public domain" },
  { file: "coffee.jpg", title: "Coffee Cup", credit: "Rachel Michetti \u2014 CC0" },
  { file: "horse.png", title: "Horse Silhouette", credit: "Andreas Preuss \u2014 CC0" },
];

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
  renderedCircleInterlock: false,
  outputCanvas: null,
  bgColor: [18, 18, 20],
  monochromeBaseColor: [40, 70, 170],
  colorSourceMode: "auto",
  fixedPalette: null,
  fixedPaletteNames: null,
  fixedPaletteLabel: null,
  shape: "square",
  circleInterlock: false, // "circle" shape only: alternating rows offset +
                           // packed tighter so circles nest instead of stack
  artistic: false,
  edgeSensitivity: 55,
  edgeMask: null,
  brickLayout: null,
  brickCanvas: null,
  sampledHex: null,
  viewMode: "source",

  // Layout mode (Classic Grid / Adaptive / Dice) -- see _on_layout_mode_change
  // in the desktop app for the equivalent. renderedMode tracks what's
  // actually on screen right now (kept separate from layoutMode, the
  // currently-selected tab, so switching tabs without regenerating doesn't
  // change what a background-color/die-color tweak re-renders).
  layoutMode: "classic",
  renderedMode: "classic",
  renderedGridW: 40,
  renderedGridH: 40,
  adaptiveSensitivity: 55,
  adaptiveRectangles: false, // true = split on one axis at a time (elongated
                              // rectangular tiles) instead of always quartering
  adaptiveLeaves: null,
  dieColor: [20, 20, 24],
  pipColor: [235, 235, 235],
  dicePipGrid: null,

  cubesWide: 20,
  cubesTall: 15,
  rubiksGrid: null,      // flat [r,g,b] array, row-major (gridW=cubesWide*3, gridH=cubesTall*3)
  rubiksBaseGrid: null,  // the pristine just-quantized 6-color grid, before any recolor reassignment
  rubiksColorMap: {},    // { cube color name: replacement rgb } -- see remapRubiksColors

  tintStrength: 85,      // 0-100; Meta mode's hue/tint overlay strength

  crossStitchGrid: null, // flat [r,g,b] array, row-major, DMC-quantized

  // Found Object mode: quantizes like Classic mode, then lets any one of
  // the resulting palette colors be replaced with a user-uploaded photo.
  // foundObjectImages/-Names are keyed by "r,g,b" color string.
  foundObjectNumColors: 12,
  foundObjectTintStrength: 60,  // 0-100, same meaning as tintStrength above
  foundObjectQuantizedGrid: null,
  foundObjectPalette: null,
  foundObjectImages: new Map(),  // "r,g,b" -> source canvas (the uploaded photo)
  foundObjectImageNames: new Map(), // "r,g,b" -> uploaded file name, for the summary
};

const brickSizeSelections = new Map(LEGO_BRICK_SIZES.map(([w, h]) => [`${w}x${h}`, true]));

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  dropZone: $("dropZone"), dropLabel: $("dropLabel"),
  browseBtn: $("browseBtn"), pasteBtn: $("pasteBtn"), fileInput: $("fileInput"),
  sampleImageBtn: $("sampleImageBtn"),
  exportSettingsBtn: $("exportSettingsBtn"), importSettingsBtn: $("importSettingsBtn"),
  settingsFileInput: $("settingsFileInput"),
  sharedGridSizeControls: $("sharedGridSizeControls"),
  gridWidth: $("gridWidth"), gridWidthVal: $("gridWidthVal"),
  gridHeight: $("gridHeight"), gridHeightVal: $("gridHeightVal"),
  lockAspect: $("lockAspect"), sizeEstimate: $("sizeEstimate"),
  cellSize: $("cellSize"), cellSizeVal: $("cellSizeVal"),
  pieceSize: $("pieceSize"), pieceSizeUnit: $("pieceSizeUnit"), physicalSizeEstimate: $("physicalSizeEstimate"),
  bgColorBtn: $("bgColorBtn"), bgColorPicker: $("bgColorPicker"),
  layoutModeSeg: $("layoutModeSeg"),
  classicPanel: $("classicPanel"), adaptivePanel: $("adaptivePanel"), dicePanel: $("dicePanel"),
  rubiksPanel: $("rubiksPanel"), metaPanel: $("metaPanel"), foundobjectPanel: $("foundobjectPanel"),
  colorSourceSeg: $("colorSourceSeg"), colorsLabel: $("colorsLabel"),
  numColors: $("numColors"), numColorsVal: $("numColorsVal"),
  fixedPaletteLabel: $("fixedPaletteLabel"), choosePaletteBtn: $("choosePaletteBtn"),
  monoColorBtn: $("monoColorBtn"), monoColorPicker: $("monoColorPicker"),
  shapeSeg: $("shapeSeg"),
  circleInterlock: $("circleInterlock"), circleInterlockLabel: $("circleInterlockLabel"),
  artisticStyle: $("artisticStyle"),
  edgeSensitivity: $("edgeSensitivity"), edgeSensitivityVal: $("edgeSensitivityVal"),
  generateBtn: $("generateBtn"), paletteBtn: $("paletteBtn"), sampleSheetBtn: $("sampleSheetBtn"),
  adaptiveSensitivity: $("adaptiveSensitivity"), adaptiveSensitivityVal: $("adaptiveSensitivityVal"),
  adaptiveRectangles: $("adaptiveRectangles"),
  adaptiveGenerateBtn: $("adaptiveGenerateBtn"), exportAdaptiveTilesBtn: $("exportAdaptiveTilesBtn"),
  exportAdaptiveShoppingBtn: $("exportAdaptiveShoppingBtn"),
  dieColorBtn: $("dieColorBtn"), dieColorPicker: $("dieColorPicker"),
  pipColorBtn: $("pipColorBtn"), pipColorPicker: $("pipColorPicker"),
  diceGenerateBtn: $("diceGenerateBtn"),
  exportDiceGuideBtn: $("exportDiceGuideBtn"), exportDiceShoppingBtn: $("exportDiceShoppingBtn"),
  cubesWide: $("cubesWide"), cubesWideVal: $("cubesWideVal"),
  cubesTall: $("cubesTall"), cubesTallVal: $("cubesTallVal"),
  lockAspectRubiks: $("lockAspectRubiks"),
  rubiksSizeEstimate: $("rubiksSizeEstimate"),
  rubiksGenerateBtn: $("rubiksGenerateBtn"), rubiksRecolorBtn: $("rubiksRecolorBtn"),
  exportRubiksGuideBtn: $("exportRubiksGuideBtn"), exportRubiksShoppingBtn: $("exportRubiksShoppingBtn"),
  tintStrength: $("tintStrength"), tintStrengthVal: $("tintStrengthVal"), metaGenerateBtn: $("metaGenerateBtn"),
  crossstitchPanel: $("crossstitchPanel"), crossstitchGenerateBtn: $("crossstitchGenerateBtn"),
  crossstitchMaxColors: $("crossstitchMaxColors"), crossstitchMaxColorsVal: $("crossstitchMaxColorsVal"),
  exportCrossStitchPatternBtn: $("exportCrossStitchPatternBtn"),
  exportCrossStitchShoppingBtn: $("exportCrossStitchShoppingBtn"),
  foundObjectNumColors: $("foundObjectNumColors"), foundObjectNumColorsVal: $("foundObjectNumColorsVal"),
  foundObjectTintStrength: $("foundObjectTintStrength"), foundObjectTintStrengthVal: $("foundObjectTintStrengthVal"),
  foundObjectGenerateBtn: $("foundObjectGenerateBtn"),
  foundObjectLibraryBtn: $("foundObjectLibraryBtn"), foundObjectSummary: $("foundObjectSummary"),
  optimizeBricksBtn: $("optimizeBricksBtn"), brickSummary: $("brickSummary"),
  exportBricksJsonBtn: $("exportBricksJsonBtn"), exportBricksCsvBtn: $("exportBricksCsvBtn"),
  exportShoppingListBtn: $("exportShoppingListBtn"),
  panelWidth: $("panelWidth"), panelWidthVal: $("panelWidthVal"),
  panelHeight: $("panelHeight"), panelHeightVal: $("panelHeightVal"),
  panelEstimate: $("panelEstimate"), exportPanelsBtn: $("exportPanelsBtn"),
  exportPreviewBtn: $("exportPreviewBtn"),
  exportPngBtn: $("exportPngBtn"), exportJsonBtn: $("exportJsonBtn"), exportCsvBtn: $("exportCsvBtn"),
  exportPaintByNumberBtn: $("exportPaintByNumberBtn"),
  viewToggle: $("viewToggle"),
  zoomInBtn: $("zoomInBtn"), zoomOutBtn: $("zoomOutBtn"), zoomFitBtn: $("zoomFitBtn"),
  previewCanvas: $("previewCanvas"), previewSaveOverlay: $("previewSaveOverlay"),
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

const viewer = new CanvasViewer(el.previewCanvas, {
  onClick: onCanvasClick,
  onTransformChange: () => syncOverlayVisibility(),
});

function refreshPreview(resetView = true) {
  let shown = null;
  if (state.viewMode === "source") {
    if (state.sourceCanvas) { viewer.setImage(state.sourceCanvas, { resetView }); shown = state.sourceCanvas; }
    else viewer.showPlaceholder("Load an image to get started");
  } else if (state.viewMode === "bricks") {
    if (state.brickCanvas) { viewer.setImage(state.brickCanvas, { resetView }); shown = state.brickCanvas; }
    else viewer.showPlaceholder("Optimize into bricks first (see the left panel)");
  } else {
    if (state.outputCanvas) { viewer.setImage(state.outputCanvas, { resetView }); shown = state.outputCanvas; }
    else viewer.showPlaceholder("Generate a mosaic to see the output here");
  }
  updateSaveOverlay(shown);
}

// Mirrors whatever's currently shown into a real <img> (see the CSS
// comment on #previewSaveOverlay) so mobile browsers offer a native
// "Save Image" / "Add to Photos" long-press menu, which canvas elements
// never get. Only needs refreshing when the shown canvas's content
// actually changes (generate, view toggle, bg-color/palette edits, brick
// optimize) -- not on every pan/zoom frame, since the overlay always shows
// the full, un-cropped image regardless of the canvas's current zoom.
//
// Because of that last point, the overlay only visually lines up with the
// canvas while the canvas is at its default "fit to view" scale/position --
// see syncOverlayVisibility(), which hides it (without touching its
// content) whenever the user zooms or pans away from that, so it doesn't
// sit on top of and block the live-zoomed canvas underneath.
let overlayHasContent = false;

function updateSaveOverlay(canvasEl) {
  overlayHasContent = !!canvasEl;
  if (!canvasEl) {
    el.previewSaveOverlay.hidden = true;
    el.previewSaveOverlay.removeAttribute("src");
    return;
  }
  try {
    el.previewSaveOverlay.src = canvasEl.toDataURL("image/png");
    syncOverlayVisibility();
  } catch (err) {
    // Defensive only -- every canvas here is drawn from same-origin/local
    // or CORS-fetched-as-blob image data, so this shouldn't actually taint,
    // but never let a save-overlay hiccup break the rest of the preview.
    overlayHasContent = false;
    el.previewSaveOverlay.hidden = true;
    console.warn("Couldn't update mobile save overlay:", err);
  }
}

function syncOverlayVisibility() {
  el.previewSaveOverlay.hidden = !overlayHasContent || !viewer.isAtDefaultFit();
}

// On touch-primary devices the overlay intercepts taps (see the CSS media
// query), so forward a plain tap (not a drag, not a long-press) to the
// same sample-a-color handler the canvas's own click uses. Coordinates are
// mapped through the overlay's object-fit:contain box since the overlay
// always shows the full image regardless of the canvas's zoom/pan state.
let overlayTapStart = null;
el.previewSaveOverlay.addEventListener("pointerdown", (e) => {
  overlayTapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
});
el.previewSaveOverlay.addEventListener("pointerup", (e) => {
  if (!overlayTapStart) return;
  const { x, y, t } = overlayTapStart;
  overlayTapStart = null;
  const dx = e.clientX - x, dy = e.clientY - y;
  // A long-press (the OS's save-image gesture) or a drag shouldn't also
  // fire a sample click -- only a quick, mostly-stationary tap does.
  if (Math.hypot(dx, dy) > 8 || Date.now() - t > 600) return;
  const coords = overlayTapToImageCoords(e.clientX, e.clientY);
  if (coords) onCanvasClick(coords[0], coords[1]);
});

function overlayTapToImageCoords(clientX, clientY) {
  const img = el.previewSaveOverlay;
  const rect = img.getBoundingClientRect();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih || rect.width === 0 || rect.height === 0) return null;
  const scale = Math.min(rect.width / iw, rect.height / ih);
  const dispW = iw * scale, dispH = ih * scale;
  const offsetX = (rect.width - dispW) / 2;
  const offsetY = (rect.height - dispH) / 2;
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX >= dispW || localY >= dispH) return null;
  return [localX / scale, localY / scale];
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
  const { gridW, gridH, renderedShape, renderedCellSize, renderedCircleInterlock } = state;
  let rc;
  if (renderedShape === "hexagon") {
    rc = hexHitTest(x, y, gridW, gridH, renderedCellSize);
  } else if (renderedShape === "circle" && renderedCircleInterlock) {
    rc = circleInterlockHitTest(x, y, gridW, gridH, renderedCellSize);
  } else {
    const col = Math.floor(x / renderedCellSize), row = Math.floor(y / renderedCellSize);
    rc = (row >= 0 && row < gridH && col >= 0 && col < gridW) ? [row, col] : null;
  }
  if (!rc) return;
  const [row, col] = rc;
  const rgb = state.quantizedGrid[row * gridW + col];
  // 1-indexed for display -- there's no "row 0" on a physical build.
  const bits = [`Row ${row + 1}, Col ${col + 1}`];
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
  // 1-indexed for display -- there's no "row 0" on a physical build.
  const bits = [`Row ${brick.row + 1}, Col ${brick.col + 1}`, `${footprintLabel(brick.width, brick.height)} piece`];
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
  state.edgeMask = null;
  state.adaptiveLeaves = null;
  state.dicePipGrid = null;
  state.rubiksGrid = null;
  state.rubiksBaseGrid = null;
  state.rubiksColorMap = {};
  state.crossStitchGrid = null;
  state.foundObjectQuantizedGrid = null;
  state.foundObjectPalette = null;
  state.foundObjectImages = new Map();
  state.foundObjectImageNames = new Map();
  el.foundObjectSummary.textContent = "";
  state.renderedMode = state.layoutMode;
  clearBrickLayout();
  disableGenerationDependentButtons();
  el.generateBtn.disabled = false;
  el.adaptiveGenerateBtn.disabled = false;
  el.diceGenerateBtn.disabled = false;
  el.rubiksGenerateBtn.disabled = false;
  el.metaGenerateBtn.disabled = false;
  el.crossstitchGenerateBtn.disabled = false;
  el.foundObjectGenerateBtn.disabled = false;
  resetSampleDisplay();

  if (el.lockAspect.checked) syncHeightToAspect();
  if (el.lockAspectRubiks.checked) syncCubesTallToAspect();

  setViewMode("source");
  updateSizeEstimate();
  updatePanelEstimate();
  updateRubiksSizeEstimate();
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
// Sample images (bundled, public domain/CC0 -- for trying the tool with no
// image of your own on hand)
// ---------------------------------------------------------------------------

el.sampleImageBtn.addEventListener("click", openSamplePicker);

function openSamplePicker() {
  const grid = document.createElement("div");
  grid.className = "sample-grid";

  SAMPLE_IMAGES.forEach((sample) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "sample-tile";

    const img = document.createElement("img");
    img.src = `samples/${sample.file}`;
    img.alt = sample.title;
    img.loading = "lazy";

    const caption = document.createElement("div");
    caption.className = "sample-caption";
    const title = document.createElement("div");
    title.className = "sample-title";
    title.textContent = sample.title;
    const credit = document.createElement("div");
    credit.className = "sample-credit";
    credit.textContent = sample.credit;
    caption.append(title, credit);

    tile.append(img, caption);
    tile.addEventListener("click", async () => {
      closeDialog();
      setStatus(`Loading ${sample.title}...`);
      try {
        const resp = await fetch(`samples/${sample.file}`);
        const blob = await resp.blob();
        await loadImageFromBlob(blob, sample.title);
      } catch (err) {
        setStatus(`Couldn't load sample image: ${err.message}`);
      }
    });

    grid.appendChild(tile);
  });

  showDialog({
    title: "Try a Sample Image",
    desc: "A few public domain / CC0 images picked to show off different color ranges and detail levels \u2014 click one to load it.",
    bodyEl: grid,
    actions: [{ label: "Cancel", onClick: closeDialog }],
  });
}

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
  const [w, h] = estimateOutputDimensions(gw, gh, state.shape, cellSize, state.circleInterlock);
  const mp = (w * h) / 1e6;
  const mb = (w * h * 3) / 1e6;
  const totalCells = gw * gh;
  let text = `Output image: ~${w.toLocaleString()}\u00d7${h.toLocaleString()}px (${mp.toFixed(0)}MP) `
    + `\u2022 ${totalCells.toLocaleString()} total cells/tiles`;
  if (mb > 300) {
    text += "  \u26a0 large \u2014 generating will take a while";
    el.sizeEstimate.style.color = "#e0a030";
  } else {
    el.sizeEstimate.style.color = "";
  }
  el.sizeEstimate.textContent = text;
  updatePhysicalSizeEstimate();
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

function syncCubesTallToAspect() {
  const w = parseInt(el.cubesWide.value, 10);
  const aspect = state.sourceCanvas.height / state.sourceCanvas.width;
  let h = Math.max(2, Math.round(w * aspect));
  h = Math.min(h, 80);
  el.cubesTall.value = h;
  el.cubesTallVal.textContent = h;
}

function updateRubiksSizeEstimate() {
  const cubesWide = parseInt(el.cubesWide.value, 10);
  const cubesTall = parseInt(el.cubesTall.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const totalCubes = cubesWide * cubesTall;
  // Rough output size: cellSize per sticker, plus a ~34%-of-cellSize gap
  // between cube blocks (see rubiks.js's cubeGapFrac) -- close enough for a
  // size hint without importing the exact render geometry here.
  const w = Math.round(cubesWide * 3 * cellSize + (cubesWide - 1) * cellSize * 0.34);
  const h = Math.round(cubesTall * 3 * cellSize + (cubesTall - 1) * cellSize * 0.34);
  const mp = (w * h) / 1e6;
  el.rubiksSizeEstimate.textContent =
    `Output image: ~${w.toLocaleString()}\u00d7${h.toLocaleString()}px (${mp.toFixed(0)}MP) `
    + `\u2022 ${totalCubes.toLocaleString()} cubes total`;
  updatePhysicalSizeEstimate();
}

/** Real-world size of the finished object, purely informational -- has no
 * effect on generation. The count basis depends on the current mode:
 * Rubik's Cube sizes itself in whole cubes (cubesWide x cubesTall); every
 * other mode's physical piece is one grid cell (gridWidth x gridHeight),
 * regardless of whether individual pieces later get merged into bigger
 * visual groups (bricks, adaptive leaves, etc) -- the finished object is
 * always that many pieces across, wide. */
function updatePhysicalSizeEstimate() {
  const pieceSize = parseFloat(el.pieceSize.value) || 0;
  const unit = el.pieceSizeUnit.value;

  let countW, countH, pieceWord;
  if (state.layoutMode === "rubiks") {
    countW = parseInt(el.cubesWide.value, 10);
    countH = parseInt(el.cubesTall.value, 10);
    pieceWord = "cube";
  } else {
    countW = parseInt(el.gridWidth.value, 10);
    countH = parseInt(el.gridHeight.value, 10);
    pieceWord = "piece";
  }

  const formatted = formatPhysicalSize(countW, countH, pieceSize, unit);
  if (formatted) {
    const plural = countW * countH !== 1 ? "s" : "";
    el.physicalSizeEstimate.textContent =
      `Physical size: ${formatted}  (${countW}\u00d7${countH} ${pieceWord}${plural})`;
  } else {
    el.physicalSizeEstimate.textContent = "";
  }
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
el.crossstitchMaxColors.addEventListener("input", () => {
  el.crossstitchMaxColorsVal.textContent = el.crossstitchMaxColors.value;
});
el.cellSize.addEventListener("input", () => {
  el.cellSizeVal.textContent = el.cellSize.value;
  updateSizeEstimate();
  updateRubiksSizeEstimate();
});
el.pieceSize.addEventListener("input", updatePhysicalSizeEstimate);
el.pieceSizeUnit.addEventListener("change", updatePhysicalSizeEstimate);
el.panelWidth.addEventListener("input", () => { el.panelWidthVal.textContent = el.panelWidth.value; updatePanelEstimate(); });
el.panelHeight.addEventListener("input", () => { el.panelHeightVal.textContent = el.panelHeight.value; updatePanelEstimate(); });

el.cubesWide.addEventListener("input", () => {
  el.cubesWideVal.textContent = el.cubesWide.value;
  if (el.lockAspectRubiks.checked && state.sourceCanvas) syncCubesTallToAspect();
  updateRubiksSizeEstimate();
});
el.cubesTall.addEventListener("input", () => {
  el.cubesTallVal.textContent = el.cubesTall.value;
  updateRubiksSizeEstimate();
});
el.lockAspectRubiks.addEventListener("change", () => {
  if (el.lockAspectRubiks.checked && state.sourceCanvas) { syncCubesTallToAspect(); updateRubiksSizeEstimate(); }
});

el.colorSourceSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  setColorSourceMode(btn.dataset.mode);
});

// Factored out of the click handler above so importSettings() (see Settings
// export/import) can drive the same UI update programmatically, without
// synthesizing a click event.
function setColorSourceMode(mode) {
  state.colorSourceMode = mode;
  [...el.colorSourceSeg.children].forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  updateColorSourceUI();
}

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
  setShape(btn.dataset.shape);
});

function setShape(shape) {
  state.shape = shape;
  [...el.shapeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.shape === shape));
  el.circleInterlockLabel.hidden = shape !== "circle";
  updateSizeEstimate();
}

// ---------------------------------------------------------------------------
// Re-render (no re-quantize/re-split/re-dither) whatever mode is currently
// on screen -- for tweaks that only affect the render, not the underlying
// pipeline (background color always; die/pip color only affects how a face
// is drawn, not the dithered pattern itself, which is fixed by the source
// image + grid). Mirrors the desktop app's _rerender_current. No-ops if
// nothing's been generated yet in the currently-*rendered* mode (which can
// briefly differ from the selected Layout tab -- see state.renderedMode).
// ---------------------------------------------------------------------------

function rerenderCurrent(resetView = true) {
  if (state.renderedMode === "classic" && state.quantizedGrid) {
    state.outputCanvas = renderMosaic(state.quantizedGrid, state.renderedGridW, state.renderedGridH,
      state.renderedShape, state.renderedCellSize, state.bgColor, makeCanvas,
      { artistic: state.artistic, edgeMask: state.edgeMask, circleInterlock: state.renderedCircleInterlock });
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "adaptive" && state.adaptiveLeaves) {
    state.outputCanvas = renderAdaptiveMosaic(state.adaptiveLeaves, state.renderedGridW, state.renderedGridH,
      state.renderedCellSize, state.bgColor, makeCanvas);
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "dice" && state.dicePipGrid) {
    state.outputCanvas = renderDiceMosaic(state.dicePipGrid, state.renderedGridW, state.renderedGridH,
      state.renderedCellSize, state.dieColor, state.pipColor, state.bgColor, makeCanvas);
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "rubiks" && state.rubiksGrid) {
    state.outputCanvas = renderRubiksMosaic(state.rubiksGrid, state.renderedGridW, state.renderedGridH,
      state.renderedCellSize, makeCanvas, { bgColor: state.bgColor });
    if (state.viewMode === "output") refreshPreview(resetView);
  }
}

el.bgColorBtn.addEventListener("click", () => el.bgColorPicker.click());
el.bgColorPicker.addEventListener("input", () => {
  state.bgColor = hexToRgb(el.bgColorPicker.value);
  setSwatchButton(el.bgColorBtn, state.bgColor);
  rerenderCurrent(false);
});

// ---------------------------------------------------------------------------
// Layout mode (Classic Grid / Adaptive / Dice)
// ---------------------------------------------------------------------------

el.layoutModeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-layout]");
  if (!btn) return;
  setLayoutMode(btn.dataset.layout);
});

function setLayoutMode(mode) {
  state.layoutMode = mode;
  [...el.layoutModeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.layout === mode));
  el.classicPanel.hidden = mode !== "classic";
  el.adaptivePanel.hidden = mode !== "adaptive";
  el.dicePanel.hidden = mode !== "dice";
  el.rubiksPanel.hidden = mode !== "rubiks";
  el.metaPanel.hidden = mode !== "meta";
  el.crossstitchPanel.hidden = mode !== "crossstitch";
  el.foundobjectPanel.hidden = mode !== "foundobject";
  // Rubik's Cube mode sizes itself in cube units (cubesWide/cubesTall)
  // rather than the shared cell-based Grid width/height sliders every
  // other mode uses -- hide those to avoid showing two unrelated size
  // controls at once.
  el.sharedGridSizeControls.hidden = mode === "rubiks";
  // Piece size's "physical size" line depends on which count basis
  // applies (cube count for Rubik's, cell count for everything else), so
  // it needs a recompute on every mode switch too, not just when the
  // grid/cube sliders themselves move.
  updatePhysicalSizeEstimate();
}

el.artisticStyle.addEventListener("change", () => {
  state.artistic = el.artisticStyle.checked;
});
el.edgeSensitivity.addEventListener("input", () => {
  el.edgeSensitivityVal.textContent = el.edgeSensitivity.value;
  state.edgeSensitivity = parseInt(el.edgeSensitivity.value, 10);
});

el.monoColorBtn.addEventListener("click", () => el.monoColorPicker.click());
el.monoColorPicker.addEventListener("input", () => {
  state.monochromeBaseColor = hexToRgb(el.monoColorPicker.value);
  setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
});

el.adaptiveSensitivity.addEventListener("input", () => {
  el.adaptiveSensitivityVal.textContent = el.adaptiveSensitivity.value;
  state.adaptiveSensitivity = parseInt(el.adaptiveSensitivity.value, 10);
});
el.adaptiveRectangles.addEventListener("change", () => {
  state.adaptiveRectangles = el.adaptiveRectangles.checked;
});

el.circleInterlock.addEventListener("change", () => {
  state.circleInterlock = el.circleInterlock.checked;
  updateSizeEstimate();
});

el.foundObjectNumColors.addEventListener("input", () => {
  el.foundObjectNumColorsVal.textContent = el.foundObjectNumColors.value;
  state.foundObjectNumColors = parseInt(el.foundObjectNumColors.value, 10);
});
el.foundObjectTintStrength.addEventListener("input", () => {
  el.foundObjectTintStrengthVal.textContent = el.foundObjectTintStrength.value;
  state.foundObjectTintStrength = parseInt(el.foundObjectTintStrength.value, 10);
  if (state.foundObjectQuantizedGrid) rerenderFoundObjectMosaic();
});

el.dieColorBtn.addEventListener("click", () => el.dieColorPicker.click());
el.dieColorPicker.addEventListener("input", () => {
  state.dieColor = hexToRgb(el.dieColorPicker.value);
  setSwatchButton(el.dieColorBtn, state.dieColor);
  rerenderCurrent(false);
});

el.pipColorBtn.addEventListener("click", () => el.pipColorPicker.click());
el.pipColorPicker.addEventListener("input", () => {
  state.pipColor = hexToRgb(el.pipColorPicker.value);
  setSwatchButton(el.pipColorBtn, state.pipColor);
  rerenderCurrent(false);
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
  const circleInterlock = state.circleInterlock;
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

    const artistic = state.artistic;
    const edgeMask = artistic
      ? computeEdgeMask(state.sourceCanvas, gridW, gridH, state.edgeSensitivity)
      : null;
    const outputCanvas = renderMosaic(quantizedFlat, gridW, gridH, shape, cellSize, bgColor, makeCanvas,
      { artistic, edgeMask, circleInterlock });

    state.gridW = gridW;
    state.gridH = gridH;
    state.quantizedGrid = quantizedFlat;
    state.palette = palette;
    state.colorNames = names ? [...names] : palette.map(() => "");
    state.renderedShape = shape;
    state.renderedCellSize = cellSize;
    state.renderedCircleInterlock = circleInterlock;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.renderedMode = "classic";
    state.outputCanvas = outputCanvas;
    state.edgeMask = edgeMask;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportJsonBtn.disabled = false;
    el.exportCsvBtn.disabled = false;
    el.exportPaintByNumberBtn.disabled = false;
    el.paletteBtn.disabled = false;
    el.sampleSheetBtn.disabled = false;
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
  el.exportPreviewBtn.disabled = true;
  el.exportJsonBtn.disabled = true;
  el.exportCsvBtn.disabled = true;
  el.exportPaintByNumberBtn.disabled = true;
  el.paletteBtn.disabled = true;
  el.sampleSheetBtn.disabled = true;
  el.exportPanelsBtn.disabled = true;
  el.optimizeBricksBtn.disabled = true;
  el.exportAdaptiveTilesBtn.disabled = true;
  el.exportAdaptiveShoppingBtn.disabled = true;
  el.exportDiceGuideBtn.disabled = true;
  el.exportDiceShoppingBtn.disabled = true;
  el.exportRubiksGuideBtn.disabled = true;
  el.exportRubiksShoppingBtn.disabled = true;
  el.rubiksRecolorBtn.disabled = true;
  el.exportCrossStitchPatternBtn.disabled = true;
  el.exportCrossStitchShoppingBtn.disabled = true;
  el.foundObjectLibraryBtn.disabled = true;
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
// Generate -- Adaptive (quadtree)
// ---------------------------------------------------------------------------

el.adaptiveGenerateBtn.addEventListener("click", generateAdaptiveMosaic);

async function generateAdaptiveMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const sensitivity = state.adaptiveSensitivity;
  const allowRectangles = state.adaptiveRectangles;

  el.adaptiveGenerateBtn.disabled = true;
  el.adaptiveGenerateBtn.textContent = "Generating...";
  setStatus("Splitting into tiles, this can take a few seconds for larger grids...");

  try {
    const grid = imageToGrid(state.sourceCanvas, gridW, gridH);
    const leaves = buildQuadtree(grid, gridW, gridH, sensitivity, allowRectangles);
    const outputCanvas = renderAdaptiveMosaic(leaves, gridW, gridH, cellSize, state.bgColor, makeCanvas);

    state.adaptiveLeaves = leaves;
    state.renderedMode = "adaptive";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportAdaptiveTilesBtn.disabled = false;
    el.exportAdaptiveShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${leaves.length} tiles, ${gridW}×${gridH} finest grid.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.adaptiveGenerateBtn.disabled = false;
    el.adaptiveGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportAdaptiveTilesBtn.addEventListener("click", () => {
  if (!state.adaptiveLeaves) return;
  const json = buildAdaptiveTilesJson(state.adaptiveLeaves, state.renderedGridW, state.renderedGridH,
    { sourceName: state.sourceFileName });
  downloadText(json, "adaptive_tiles.json", "application/json");
  setStatus("Saved adaptive_tiles.json");
});

el.exportAdaptiveShoppingBtn.addEventListener("click", () => {
  if (!state.adaptiveLeaves) return;
  const csv = buildAdaptiveShoppingListCsv(state.adaptiveLeaves);
  downloadText(csv, "adaptive_shopping_list.csv", "text/csv");
  setStatus("Saved adaptive_shopping_list.csv");
});

// ---------------------------------------------------------------------------
// Generate -- Dice (grayscale + Floyd-Steinberg dither to pip counts)
// ---------------------------------------------------------------------------

el.diceGenerateBtn.addEventListener("click", generateDiceMosaic);

async function generateDiceMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const dieColor = state.dieColor;
  const pipColor = state.pipColor;

  el.diceGenerateBtn.disabled = true;
  el.diceGenerateBtn.textContent = "Generating...";
  setStatus("Dithering to dice faces, this can take a few seconds for larger grids...");

  try {
    const grayGrid = imageToGrayGrid(state.sourceCanvas, gridW, gridH);
    const levels = pipLevelBrightness(dieColor, pipColor);
    const stretched = stretchToRange(grayGrid, Math.min(...levels), Math.max(...levels));
    const pipGrid = ditherToPips(stretched, gridW, gridH, levels);
    const outputCanvas = renderDiceMosaic(pipGrid, gridW, gridH, cellSize, dieColor, pipColor,
      state.bgColor, makeCanvas);

    state.dicePipGrid = pipGrid;
    state.renderedMode = "dice";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportDiceGuideBtn.disabled = false;
    el.exportDiceShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${gridW * gridH} dice, ${gridW}×${gridH} grid.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.diceGenerateBtn.disabled = false;
    el.diceGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportDiceGuideBtn.addEventListener("click", exportDiceBuildGuide);

function exportDiceBuildGuide() {
  if (!state.dicePipGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
    // Print-ready convention (same as the paint-by-number PDF): white faces
    // with black pips and a thin outline, regardless of the on-screen
    // die/pip colors, so the guide is usable printed in black & white.
    const page1 = renderDiceMosaic(state.dicePipGrid, gridW, gridH, cellSize,
      [255, 255, 255], [20, 20, 20], [255, 255, 255], makeCanvas,
      { outlineColor: [150, 150, 150] });
    const page2 = renderDiceKey(state.dicePipGrid, [255, 255, 255], [20, 20, 20], makeCanvas);

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [page1.width, page1.height],
      orientation: page1.width >= page1.height ? "landscape" : "portrait",
    });
    doc.addImage(page1.toDataURL("image/png"), "PNG", 0, 0, page1.width, page1.height);
    doc.addPage([page2.width, page2.height], page2.width >= page2.height ? "landscape" : "portrait");
    doc.addImage(page2.toDataURL("image/png"), "PNG", 0, 0, page2.width, page2.height);
    doc.save("dice_build_guide.pdf");
    setStatus("Saved dice_build_guide.pdf (2 pages)");
  } catch (err) {
    setStatus(`Error building dice build guide PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportDiceShoppingBtn.addEventListener("click", () => {
  if (!state.dicePipGrid) return;
  downloadText(buildDiceShoppingListCsv(state.dicePipGrid), "dice_shopping_list.csv", "text/csv");
  setStatus("Saved dice_shopping_list.csv");
});

// ---------------------------------------------------------------------------
// Generate -- Rubik's Cube (fixed 6-color palette, grouped into 3x3 blocks)
// ---------------------------------------------------------------------------

el.rubiksGenerateBtn.addEventListener("click", generateRubiksMosaic);

async function generateRubiksMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const cubesWide = parseInt(el.cubesWide.value, 10);
  const cubesTall = parseInt(el.cubesTall.value, 10);
  const gridW = cubesWide * 3;
  const gridH = cubesTall * 3;
  const cellSize = parseInt(el.cellSize.value, 10);

  el.rubiksGenerateBtn.disabled = true;
  el.rubiksGenerateBtn.textContent = "Generating...";
  setStatus("Matching to cube colors, this can take a few seconds for larger grids...");

  try {
    const grid = imageToGrid(state.sourceCanvas, gridW, gridH);
    const result = await callWorker("quantize-fixed", { points: grid, palette: RUBIKS_PALETTE });
    const quantizedFlat = Array.from(result.labels).map(l => RUBIKS_PALETTE[l]);
    const outputCanvas = renderRubiksMosaic(quantizedFlat, gridW, gridH, cellSize, makeCanvas,
      { bgColor: state.bgColor });

    state.rubiksBaseGrid = quantizedFlat;
    state.rubiksColorMap = {};
    state.rubiksGrid = quantizedFlat;
    state.renderedMode = "rubiks";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportRubiksGuideBtn.disabled = false;
    el.exportRubiksShoppingBtn.disabled = false;
    el.rubiksRecolorBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${rubiksCubeCount(gridW, gridH)} cubes, ${cubesWide}×${cubesTall} cubes (${gridW}×${gridH} grid).`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.rubiksGenerateBtn.disabled = false;
    el.rubiksGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportRubiksGuideBtn.addEventListener("click", exportRubiksBuildGuide);

function exportRubiksBuildGuide() {
  if (!state.rubiksGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
    const page1 = renderRubiksBuildSheet(state.rubiksGrid, gridW, gridH, cellSize, makeCanvas);
    const page2 = renderRubiksKey(state.rubiksGrid, RUBIKS_PALETTE, gridW, gridH, makeCanvas);

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [page1.width, page1.height],
      orientation: page1.width >= page1.height ? "landscape" : "portrait",
    });
    doc.addImage(page1.toDataURL("image/png"), "PNG", 0, 0, page1.width, page1.height);
    doc.addPage([page2.width, page2.height], page2.width >= page2.height ? "landscape" : "portrait");
    doc.addImage(page2.toDataURL("image/png"), "PNG", 0, 0, page2.width, page2.height);
    doc.save("rubiks_cube_build_guide.pdf");
    setStatus("Saved rubiks_cube_build_guide.pdf (2 pages)");
  } catch (err) {
    setStatus(`Error building Rubik's Cube build guide PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportRubiksShoppingBtn.addEventListener("click", () => {
  if (!state.rubiksGrid) return;
  const csv = buildRubiksShoppingListCsv(state.rubiksGrid, RUBIKS_PALETTE, state.renderedGridW, state.renderedGridH);
  downloadText(csv, "rubiks_cube_shopping_list.csv", "text/csv");
  setStatus("Saved rubiks_cube_shopping_list.csv");
});

// Recolor Cubes -- reassign any of the 6 fixed cube colors to display as a
// different one of the 6 (e.g. "show blue wherever the mosaic called for
// green"), via a dropdown per color rather than a free color-picker, since
// a real cube sticker can only be one of the 6 colors it actually ships
// with. Always recomputed fresh from state.rubiksBaseGrid (see
// remapRubiksColors) so changing selections can never cascade incorrectly.
el.rubiksRecolorBtn.addEventListener("click", openRubiksRecolorDialog);

function openRubiksRecolorDialog() {
  if (!state.rubiksBaseGrid) return;
  const body = document.createElement("div");

  for (const { name, rgb } of RUBIKS_CUBE_COLORS) {
    const row = document.createElement("div");
    row.className = "swatch-row";

    const swatch = document.createElement("div");
    swatch.className = "mini-swatch";
    swatch.style.background = rgbToHex(rgb);
    swatch.style.cursor = "default";

    const label = document.createElement("span");
    label.className = "recolor-label";
    label.textContent = name;

    const select = document.createElement("select");
    for (const opt of RUBIKS_CUBE_COLORS) {
      const optionEl = document.createElement("option");
      optionEl.value = opt.name;
      optionEl.textContent = opt.name;
      select.appendChild(optionEl);
    }
    const currentRgb = state.rubiksColorMap[name] || rgb;
    const currentMatch = RUBIKS_CUBE_COLORS.find(c => rgbToHex(c.rgb) === rgbToHex(currentRgb));
    select.value = currentMatch ? currentMatch.name : name;
    select.addEventListener("change", () => {
      const chosen = RUBIKS_CUBE_COLORS.find(c => c.name === select.value);
      state.rubiksColorMap[name] = chosen.rgb;
      applyRubiksRecolor();
    });

    row.append(swatch, label, select);
    body.appendChild(row);
  }

  showDialog({
    title: "Recolor Cubes",
    desc: "Choose what color each cube face should show as — e.g. set "
      + "Green to Blue if you'd rather have a blue cube wherever the mosaic called for green.",
    bodyEl: body,
    actions: [
      {
        label: "Reset to Defaults", onClick: () => {
          state.rubiksColorMap = {};
          applyRubiksRecolor();
          closeDialog();
          openRubiksRecolorDialog();
        },
      },
      { label: "Close", primary: true, onClick: closeDialog },
    ],
  });
}

function applyRubiksRecolor() {
  if (!state.rubiksBaseGrid) return;
  state.rubiksGrid = remapRubiksColors(state.rubiksBaseGrid, state.rubiksColorMap);
  state.outputCanvas = renderRubiksMosaic(state.rubiksGrid, state.renderedGridW, state.renderedGridH,
    state.renderedCellSize, makeCanvas, { bgColor: state.bgColor });
  if (state.viewMode === "output") refreshPreview(false);
  setStatus("Updated cube colors.");
}

// ---------------------------------------------------------------------------
// Generate -- Meta (every cell is a tinted copy of the whole source photo)
// ---------------------------------------------------------------------------

el.tintStrength.addEventListener("input", () => {
  el.tintStrengthVal.textContent = el.tintStrength.value;
  state.tintStrength = parseInt(el.tintStrength.value, 10);
});

el.metaGenerateBtn.addEventListener("click", generateMetaMosaic);

async function generateMetaMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const tintStrength = parseInt(el.tintStrength.value, 10) / 100;

  el.metaGenerateBtn.disabled = true;
  el.metaGenerateBtn.textContent = "Generating...";
  setStatus("Tinting thumbnails, this can take a few seconds for larger grids...");

  try {
    const targetGrid = imageToGrid(state.sourceCanvas, gridW, gridH);
    const outputCanvas = renderMetaMosaic(
      state.sourceCanvas, targetGrid, gridW, gridH, cellSize, tintStrength, makeCanvas);

    state.renderedMode = "meta";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${gridW}×${gridH} grid, ${cellSize}px cells.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.metaGenerateBtn.disabled = false;
    el.metaGenerateBtn.textContent = "Generate Mosaic";
  }
}

// ---------------------------------------------------------------------------
// Generate -- Counted Cross-Stitch (quantize to real DMC floss colors)
// ---------------------------------------------------------------------------

el.crossstitchGenerateBtn.addEventListener("click", generateCrossStitchMosaic);

async function generateCrossStitchMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const maxColors = parseInt(el.crossstitchMaxColors.value, 10) || null;

  el.crossstitchGenerateBtn.disabled = true;
  el.crossstitchGenerateBtn.textContent = "Generating...";
  setStatus("Matching to DMC floss colors, this can take a few seconds for larger grids...");

  try {
    let grid = imageToGrid(state.sourceCanvas, gridW, gridH);
    if (maxColors) {
      // Pre-cluster to at most maxColors representative shades before DMC
      // matching, so a busy/gradient-heavy photo can't DMC-match nearly
      // every cell to its own nearby floss color -- reuses Classic mode's
      // own K-Means "Number of colors" step (quantize-auto), just run
      // ahead of the DMC match rather than as the final quantization.
      const pre = await callWorker("quantize-auto", { points: grid, nColors: maxColors });
      grid = Array.from(pre.labels).map(l => pre.palette[l]);
    }
    const result = await callWorker("quantize-fixed", { points: grid, palette: DMC_RGB_PALETTE });
    const quantizedFlat = Array.from(result.labels).map(l => DMC_RGB_PALETTE[l]);
    const outputCanvas = renderCrossStitchMosaic(quantizedFlat, gridW, gridH, cellSize, makeCanvas);

    state.crossStitchGrid = quantizedFlat;
    state.renderedMode = "crossstitch";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportCrossStitchPatternBtn.disabled = false;
    el.exportCrossStitchShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    const used = dmcColorCounts(quantizedFlat).filter(c => c.count > 0).length;
    setStatus(`Done — ${used} DMC colors, ${gridW}×${gridH} grid.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.crossstitchGenerateBtn.disabled = false;
    el.crossstitchGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportCrossStitchPatternBtn.addEventListener("click", exportCrossStitchPattern);

function exportCrossStitchPattern() {
  if (!state.crossStitchGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH } = state;
    const patternCellSize = 22;
    const maxStitchesPerPage = 50;

    const symbolMap = crossStitchSymbolMap(state.crossStitchGrid);
    const panels = splitIntoPanels(state.crossStitchGrid, gridW, gridH, maxStitchesPerPage, maxStitchesPerPage);
    const nPanelRows = Math.max(...panels.map(p => p.panelRow)) + 1;
    const nPanelCols = Math.max(...panels.map(p => p.panelCol)) + 1;

    const pages = panels.map(p => {
      const label = `Page ${p.panelRow + 1},${p.panelCol + 1} of ${nPanelRows}x${nPanelCols}  `
        + `(stitches ${p.colStart + 1}-${p.colEnd} x ${p.rowStart + 1}-${p.rowEnd})`;
      return renderCrossStitchPatternPage(p.grid, p.width, p.height, symbolMap,
        p.rowStart, p.colStart, label, patternCellSize, makeCanvas);
    });

    const counts = dmcColorCounts(state.crossStitchGrid);
    pages.push(renderCrossStitchLegendPage(counts, symbolMap, makeCanvas));

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [pages[0].width, pages[0].height],
      orientation: pages[0].width >= pages[0].height ? "landscape" : "portrait",
    });
    pages.forEach((page, i) => {
      if (i > 0) doc.addPage([page.width, page.height], page.width >= page.height ? "landscape" : "portrait");
      doc.addImage(page.toDataURL("image/png"), "PNG", 0, 0, page.width, page.height);
    });

    // The legend page is a flat raster (addImage above), so give each
    // swatch row a real clickable link out to that color's dmccolorchart.com
    // page as a separate annotation, positioned at the same pixel geometry
    // renderCrossStitchLegendPage used to draw that row (pad/swatchSize/rowH).
    const legendPage = pages[pages.length - 1];
    const usedSorted = counts.filter(c => c.count > 0).slice().sort((a, b) => b.count - a.count);
    const legendPad = 20, legendRowH = 44;
    doc.setPage(pages.length);
    let linkY = legendPad + 44;
    for (const c of usedSorted) {
      doc.link(legendPad, linkY, legendPage.width - legendPad * 2, legendRowH, { url: c.url });
      linkY += legendRowH;
    }

    doc.save("cross_stitch_pattern.pdf");
    setStatus(`Saved cross_stitch_pattern.pdf (${pages.length} pages)`);
  } catch (err) {
    setStatus(`Error building cross-stitch pattern PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportCrossStitchShoppingBtn.addEventListener("click", () => {
  if (!state.crossStitchGrid) return;
  downloadText(buildCrossStitchShoppingListCsv(state.crossStitchGrid),
    "cross_stitch_shopping_list.csv", "text/csv");
  setStatus("Saved cross_stitch_shopping_list.csv");
});

// ---------------------------------------------------------------------------
// Generate -- Found Object (quantize, then swap any color for a user photo)
// ---------------------------------------------------------------------------

el.foundObjectGenerateBtn.addEventListener("click", generateFoundObjectMosaic);

async function generateFoundObjectMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const gridW = parseInt(el.gridWidth.value, 10);
  const gridH = parseInt(el.gridHeight.value, 10);
  const numColors = parseInt(el.foundObjectNumColors.value, 10) || null;
  const cellSize = parseInt(el.cellSize.value, 10);

  el.foundObjectGenerateBtn.disabled = true;
  el.foundObjectGenerateBtn.textContent = "Generating...";
  setStatus("Crunching colors, this can take a few seconds for larger grids...");

  try {
    const grid = imageToGrid(state.sourceCanvas, gridW, gridH);
    const result = await callWorker("quantize-auto", { points: grid, nColors: numColors });
    const palette = result.palette;
    const quantizedFlat = Array.from(result.labels).map(l => palette[l]);

    // A fresh generate (new grid size/color count) invalidates any photo
    // assignments from a previous palette -- those keys almost certainly
    // don't match the new palette's colors, so start the library over
    // rather than silently keeping stale, invisible assignments around.
    state.foundObjectImages = new Map();
    state.foundObjectImageNames = new Map();

    state.gridW = gridW;
    state.gridH = gridH;
    state.foundObjectQuantizedGrid = quantizedFlat;
    state.foundObjectPalette = palette;
    state.renderedMode = "foundobject";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    resetSampleDisplay();

    rerenderFoundObjectMosaic();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.foundObjectLibraryBtn.disabled = false;
    updateFoundObjectSummary();
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${palette.length} colors, ${gridW}×${gridH} grid. Assign photos to colors below.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.foundObjectGenerateBtn.disabled = false;
    el.foundObjectGenerateBtn.textContent = "Generate Mosaic";
  }
}

/** Re-composite the Found Object output canvas from the current quantized
 * grid + whatever photos are currently assigned -- called after Generate,
 * after any photo is assigned/cleared, and when the tint-strength slider
 * moves. Cheap enough to run on every change, same as Classic mode's
 * palette-edit re-render. */
function rerenderFoundObjectMosaic() {
  if (!state.foundObjectQuantizedGrid) return;
  const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
  const tintStrength = state.foundObjectTintStrength / 100;
  state.outputCanvas = renderFoundObjectMosaic(
    state.foundObjectQuantizedGrid, gridW, gridH, cellSize, state.bgColor,
    state.foundObjectImages, tintStrength, makeCanvas);
  if (state.viewMode === "output") refreshPreview(false);
}

function updateFoundObjectSummary() {
  const n = state.foundObjectImages.size;
  const total = state.foundObjectPalette ? state.foundObjectPalette.length : 0;
  el.foundObjectSummary.textContent = n === 0
    ? `No photos assigned yet — all ${total} colors show as plain squares.`
    : `${n} of ${total} colors have an assigned photo.`;
}

el.foundObjectLibraryBtn.addEventListener("click", openFoundObjectLibrary);

function openFoundObjectLibrary() {
  if (!state.foundObjectPalette) return;
  const body = document.createElement("div");

  state.foundObjectPalette.forEach((rgb, i) => {
    const key = rgb.join(",");
    const row = document.createElement("div");
    row.className = "swatch-row";

    const idxLabel = document.createElement("span");
    idxLabel.className = "idx-label";
    idxLabel.textContent = `#${i + 1}`;

    const swatch = document.createElement("div");
    swatch.className = "mini-swatch";
    swatch.style.background = rgbToHex(rgb);
    swatch.title = rgbToHex(rgb);

    const thumb = document.createElement("img");
    thumb.className = "fo-thumb";
    const existingCanvas = state.foundObjectImages.get(key);
    if (existingCanvas) thumb.src = existingCanvas.toDataURL("image/png");

    const label = document.createElement("span");
    label.className = "fo-label";
    label.textContent = state.foundObjectImageNames.get(key) || "No photo assigned";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "fo-upload";
    uploadBtn.textContent = "Upload...";
    uploadBtn.addEventListener("click", () => fileInput.click());

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "fo-clear";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = !existingCanvas;
    clearBtn.addEventListener("click", () => {
      state.foundObjectImages.delete(key);
      state.foundObjectImageNames.delete(key);
      thumb.removeAttribute("src");
      label.textContent = "No photo assigned";
      clearBtn.disabled = true;
      rerenderFoundObjectMosaic();
      updateFoundObjectSummary();
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = makeCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        state.foundObjectImages.set(key, canvas);
        state.foundObjectImageNames.set(key, file.name);
        thumb.src = canvas.toDataURL("image/png");
        label.textContent = file.name;
        clearBtn.disabled = false;
        rerenderFoundObjectMosaic();
        updateFoundObjectSummary();
      } catch (err) {
        setStatus(`Couldn't open that photo: ${err.message}`);
      }
    });

    row.append(idxLabel, swatch, thumb, label, uploadBtn, clearBtn, fileInput);
    body.appendChild(row);
  });

  showDialog({
    title: "Assign Photos to Colors",
    desc: `${state.foundObjectPalette.length} colors — upload a photo of a real `
      + "object that color to use it in place of the flat square, or leave it blank.",
    bodyEl: body,
    actions: [{ label: "Close", primary: true, onClick: closeDialog }],
    wide: true,
  });
}

// ---------------------------------------------------------------------------
// Dialog helper
// ---------------------------------------------------------------------------

function showDialog({ title, desc, bodyEl, actions, wide = false }) {
  el.dialogRoot.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const box = document.createElement("div");
  box.className = wide ? "dialog-box wide" : "dialog-box";

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
    state.renderedShape, state.renderedCellSize, state.bgColor, makeCanvas,
    { artistic: state.artistic, edgeMask: state.edgeMask });
  if (state.viewMode === "output") refreshPreview(false);
  setStatus(`Updated Color #${idx + 1} to ${rgbToHex(newRgb)}.`);
}

// ---------------------------------------------------------------------------
// Sample Sheet -- browse the palette, then hold a full-screen solid patch of
// any color up against a paint chip in the store. The grid step reuses the
// dialog system; the full-screen color view is a separate fixed overlay
// (appended straight to <body>, above the dialog) so it can go true
// edge-to-edge and isn't constrained by the dialog box's padding/width.
// ---------------------------------------------------------------------------

el.sampleSheetBtn.addEventListener("click", openSampleSheet);

function openSampleSheet() {
  if (!state.palette || !state.palette.length) return;

  const matches = nearestPaintMatchesAllBrands(state.palette);
  const body = document.createElement("div");
  body.className = "sheet-grid";

  state.palette.forEach((rgb, i) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "sheet-swatch";

    const swatch = document.createElement("div");
    swatch.className = "sheet-swatch-color";
    swatch.style.background = rgbToHex(rgb);

    const label = document.createElement("div");
    label.className = "sheet-swatch-label";
    const nameEl = document.createElement("div");
    nameEl.className = "sheet-swatch-name";
    nameEl.textContent = state.colorNames[i] || `Color #${i + 1}`;
    const hexEl = document.createElement("div");
    hexEl.className = "sheet-swatch-hex";
    hexEl.textContent = rgbToHex(rgb);
    label.append(nameEl, hexEl);

    tile.append(swatch, label);
    tile.addEventListener("click", () => openSampleFullscreen(state.palette, state.colorNames, matches, i));
    body.appendChild(tile);
  });

  showDialog({
    title: "Sample Sheet",
    desc: "Tap a color for a full-screen patch to hold up against paint chips in the store.",
    bodyEl: body,
    actions: [{ label: "Close", primary: true, onClick: closeDialog }],
    wide: true,
  });
}

function openSampleFullscreen(palette, names, matches, startIndex) {
  let index = startIndex;

  const overlay = document.createElement("div");
  overlay.className = "sheet-fullscreen";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sheet-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);

  const position = document.createElement("div");
  position.className = "sheet-position";

  const navLeft = document.createElement("div");
  navLeft.className = "sheet-nav-zone left";
  navLeft.addEventListener("click", () => step(-1));

  const navRight = document.createElement("div");
  navRight.className = "sheet-nav-zone right";
  navRight.addEventListener("click", () => step(1));

  const label = document.createElement("div");
  label.className = "sheet-label";
  label.addEventListener("click", () => label.classList.toggle("hidden"));

  overlay.append(closeBtn, position, navLeft, navRight, label);
  document.body.appendChild(overlay);

  function render() {
    const rgb = palette[index];
    overlay.style.background = rgbToHex(rgb);
    position.textContent = `${index + 1} / ${palette.length}`;

    const nameText = names[index] || `Color #${index + 1}`;
    const best = matches[index] && matches[index].best;
    label.innerHTML = "";
    const nameEl = document.createElement("div");
    nameEl.className = "sheet-label-name";
    nameEl.textContent = nameText;
    const hexEl = document.createElement("div");
    hexEl.className = "sheet-label-hex";
    hexEl.textContent = rgbToHex(rgb);
    label.append(nameEl, hexEl);
    if (best) {
      const matchEl = document.createElement("div");
      matchEl.className = "sheet-label-match";
      matchEl.textContent = `Nearest paint: ${formatBestMatch(best)}`;
      label.appendChild(matchEl);
    }
  }

  function step(dir) {
    index = (index + dir + palette.length) % palette.length;
    render();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  }

  let touchStartX = null;
  function onTouchStart(e) { touchStartX = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) < 40) return;
    step(dx < 0 ? 1 : -1);
  }

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.removeEventListener("touchstart", onTouchStart);
    overlay.removeEventListener("touchend", onTouchEnd);
    overlay.remove();
  }

  document.addEventListener("keydown", onKey);
  overlay.addEventListener("touchstart", onTouchStart, { passive: true });
  overlay.addEventListener("touchend", onTouchEnd, { passive: true });

  render();
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
            state.fixedPaletteLabel = pendingLabel;
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
      // global_row_start/global_col_start are 1-indexed (matches the
      // per-cell global_row/global_col below); global_row_end/
      // global_col_end are the 0-indexed exclusive end (rowEnd - 1) which,
      // written as-is, is already the correct 1-indexed *inclusive* last
      // row/col -- so only the start needs the +1.
      const extraMeta = {
        panel_row: p.panelRow + 1, panel_col: p.panelCol + 1,
        global_row_start: p.rowStart + 1, global_row_end: p.rowEnd,
        global_col_start: p.colStart + 1, global_col_end: p.colEnd,
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
        global_row_start: p.rowStart + 1, global_row_end: p.rowEnd,
        global_col_start: p.colStart + 1, global_col_end: p.colEnd,
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

// Lets the user look the full output over -- at its real size, not the
// zoomed/panned view the main canvas happens to be sitting at -- before
// deciding to save it, with the same Save action available right there.
el.exportPreviewBtn.addEventListener("click", openExportPreviewDialog);

function openExportPreviewDialog() {
  if (!state.outputCanvas) return;
  const body = document.createElement("div");
  body.className = "export-preview-body";
  const img = document.createElement("img");
  img.className = "export-preview-img";
  img.alt = "Mosaic output preview";
  img.src = state.outputCanvas.toDataURL("image/png");
  body.appendChild(img);

  showDialog({
    title: "Preview Export",
    desc: `${state.outputCanvas.width}×${state.outputCanvas.height}px`,
    bodyEl: body,
    wide: true,
    actions: [
      { label: "Close", onClick: closeDialog },
      {
        label: "Save Image (PNG)...", primary: true, onClick: () => {
          state.outputCanvas.toBlob(blob => downloadBlob(blob, "mosaic.png"), "image/png");
          closeDialog();
        },
      },
    ],
  });
}

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

el.exportPaintByNumberBtn.addEventListener("click", exportPaintByNumber);

function exportPaintByNumber() {
  if (!state.quantizedGrid) return;
  try {
    const page1 = renderPaintByNumber(state.quantizedGrid, state.gridW, state.gridH,
      state.palette, state.renderedShape, state.renderedCellSize, makeCanvas,
      { circleInterlock: state.renderedCircleInterlock });
    const counts = colorCounts(state.quantizedGrid, state.palette, state.colorNames);
    const page2 = renderColorKey(state.palette, state.colorNames, counts, makeCanvas);

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [page1.width, page1.height],
      orientation: page1.width >= page1.height ? "landscape" : "portrait",
    });
    doc.addImage(page1.toDataURL("image/png"), "PNG", 0, 0, page1.width, page1.height);
    doc.addPage([page2.width, page2.height], page2.width >= page2.height ? "landscape" : "portrait");
    doc.addImage(page2.toDataURL("image/png"), "PNG", 0, 0, page2.width, page2.height);
    doc.save("paint_by_number.pdf");
    setStatus("Saved paint_by_number.pdf (2 pages)");
  } catch (err) {
    setStatus(`Error building paint-by-number PDF: ${err.message}`);
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Settings export/import -- every control's current value, as JSON, so a
// session can be saved and picked back up later instead of starting from
// scratch. Deliberately excludes the loaded image and any already-generated
// output (those aren't "settings" -- they're re-created by loading an image
// and clicking Generate again after importing).
// ---------------------------------------------------------------------------

const SETTINGS_FORMAT_VERSION = 1;

function collectSettings() {
  return {
    app: "pixel-mosaic-generator",
    settingsVersion: SETTINGS_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      gridWidth: parseInt(el.gridWidth.value, 10),
      gridHeight: parseInt(el.gridHeight.value, 10),
      lockAspect: el.lockAspect.checked,
      cellSize: parseInt(el.cellSize.value, 10),
      pieceSize: parseFloat(el.pieceSize.value) || 0,
      pieceSizeUnit: el.pieceSizeUnit.value,
      bgColor: rgbToHex(state.bgColor),
      layoutMode: state.layoutMode,

      colorSourceMode: state.colorSourceMode,
      numColors: parseInt(el.numColors.value, 10),
      fixedPalette: state.fixedPalette,
      fixedPaletteNames: state.fixedPaletteNames,
      fixedPaletteLabel: state.fixedPaletteLabel,
      monochromeBaseColor: rgbToHex(state.monochromeBaseColor),
      shape: state.shape,
      circleInterlock: el.circleInterlock.checked,
      artistic: el.artisticStyle.checked,
      edgeSensitivity: parseInt(el.edgeSensitivity.value, 10),

      panelWidth: parseInt(el.panelWidth.value, 10),
      panelHeight: parseInt(el.panelHeight.value, 10),
      brickSizeSelections: Object.fromEntries(brickSizeSelections),

      adaptiveSensitivity: parseInt(el.adaptiveSensitivity.value, 10),
      adaptiveRectangles: el.adaptiveRectangles.checked,

      dieColor: rgbToHex(state.dieColor),
      pipColor: rgbToHex(state.pipColor),

      cubesWide: parseInt(el.cubesWide.value, 10),
      cubesTall: parseInt(el.cubesTall.value, 10),
      lockAspectRubiks: el.lockAspectRubiks.checked,
      rubiksColorMap: Object.fromEntries(
        Object.entries(state.rubiksColorMap).map(([name, rgb]) => [name, rgbToHex(rgb)])),

      tintStrength: parseInt(el.tintStrength.value, 10),

      crossstitchMaxColors: parseInt(el.crossstitchMaxColors.value, 10),

      // Found Object mode's per-color photo assignments aren't included --
      // they're uploaded image files, not JSON-friendly data -- so only
      // its two sliders round-trip; re-assign photos after importing.
      foundObjectNumColors: parseInt(el.foundObjectNumColors.value, 10),
      foundObjectTintStrength: parseInt(el.foundObjectTintStrength.value, 10),
    },
  };
}

/** Write a settings object (as collectSettings() shapes it) back into every
 * control -- the reverse of collectSettings(). Missing keys are left as
 * whatever the control already had, so an older or hand-edited settings
 * file with only some fields set still applies the rest safely. */
function applySettings(data) {
  const s = (data && typeof data === "object" && data.settings) || {};

  if (Number.isFinite(s.gridWidth)) { el.gridWidth.value = s.gridWidth; el.gridWidthVal.textContent = s.gridWidth; }
  if (Number.isFinite(s.gridHeight)) { el.gridHeight.value = s.gridHeight; el.gridHeightVal.textContent = s.gridHeight; }
  if (typeof s.lockAspect === "boolean") el.lockAspect.checked = s.lockAspect;
  if (Number.isFinite(s.cellSize)) { el.cellSize.value = s.cellSize; el.cellSizeVal.textContent = s.cellSize; }
  if (Number.isFinite(s.pieceSize)) el.pieceSize.value = s.pieceSize;
  if (PIECE_SIZE_UNITS.includes(s.pieceSizeUnit)) el.pieceSizeUnit.value = s.pieceSizeUnit;
  if (s.bgColor) { state.bgColor = hexToRgb(s.bgColor); setSwatchButton(el.bgColorBtn, state.bgColor); el.bgColorPicker.value = s.bgColor; }

  if (s.colorSourceMode) setColorSourceMode(s.colorSourceMode);
  if (Number.isFinite(s.numColors)) { el.numColors.value = s.numColors; el.numColorsVal.textContent = s.numColors; }
  if ("fixedPalette" in s) state.fixedPalette = s.fixedPalette || null;
  if ("fixedPaletteNames" in s) state.fixedPaletteNames = s.fixedPaletteNames || null;
  if (s.fixedPaletteLabel) {
    state.fixedPaletteLabel = s.fixedPaletteLabel;
    el.fixedPaletteLabel.textContent = `Using: ${s.fixedPaletteLabel}`;
  } else if ("fixedPalette" in s && !s.fixedPalette) {
    state.fixedPaletteLabel = null;
    el.fixedPaletteLabel.textContent = "No palette chosen";
  }
  if (s.monochromeBaseColor) {
    state.monochromeBaseColor = hexToRgb(s.monochromeBaseColor);
    setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
    el.monoColorPicker.value = s.monochromeBaseColor;
  }
  if (s.shape) setShape(s.shape);
  if (typeof s.circleInterlock === "boolean") { el.circleInterlock.checked = s.circleInterlock; state.circleInterlock = s.circleInterlock; }
  if (typeof s.artistic === "boolean") { el.artisticStyle.checked = s.artistic; state.artistic = s.artistic; }
  if (Number.isFinite(s.edgeSensitivity)) {
    el.edgeSensitivity.value = s.edgeSensitivity;
    el.edgeSensitivityVal.textContent = s.edgeSensitivity;
    state.edgeSensitivity = s.edgeSensitivity;
  }

  if (Number.isFinite(s.panelWidth)) { el.panelWidth.value = s.panelWidth; el.panelWidthVal.textContent = s.panelWidth; }
  if (Number.isFinite(s.panelHeight)) { el.panelHeight.value = s.panelHeight; el.panelHeightVal.textContent = s.panelHeight; }
  if (s.brickSizeSelections && typeof s.brickSizeSelections === "object") {
    brickSizeSelections.clear();
    for (const [key, checked] of Object.entries(s.brickSizeSelections)) brickSizeSelections.set(key, !!checked);
  }

  if (Number.isFinite(s.adaptiveSensitivity)) {
    el.adaptiveSensitivity.value = s.adaptiveSensitivity;
    el.adaptiveSensitivityVal.textContent = s.adaptiveSensitivity;
    state.adaptiveSensitivity = s.adaptiveSensitivity;
  }
  if (typeof s.adaptiveRectangles === "boolean") {
    el.adaptiveRectangles.checked = s.adaptiveRectangles;
    state.adaptiveRectangles = s.adaptiveRectangles;
  }

  if (s.dieColor) { state.dieColor = hexToRgb(s.dieColor); setSwatchButton(el.dieColorBtn, state.dieColor); el.dieColorPicker.value = s.dieColor; }
  if (s.pipColor) { state.pipColor = hexToRgb(s.pipColor); setSwatchButton(el.pipColorBtn, state.pipColor); el.pipColorPicker.value = s.pipColor; }

  if (Number.isFinite(s.cubesWide)) { el.cubesWide.value = s.cubesWide; el.cubesWideVal.textContent = s.cubesWide; }
  if (Number.isFinite(s.cubesTall)) { el.cubesTall.value = s.cubesTall; el.cubesTallVal.textContent = s.cubesTall; }
  if (typeof s.lockAspectRubiks === "boolean") el.lockAspectRubiks.checked = s.lockAspectRubiks;
  if (s.rubiksColorMap && typeof s.rubiksColorMap === "object") {
    state.rubiksColorMap = Object.fromEntries(
      Object.entries(s.rubiksColorMap).map(([name, hex]) => [name, hexToRgb(hex)]));
    if (state.rubiksBaseGrid) applyRubiksRecolor();
  }

  if (Number.isFinite(s.tintStrength)) {
    el.tintStrength.value = s.tintStrength;
    el.tintStrengthVal.textContent = s.tintStrength;
    state.tintStrength = s.tintStrength;
  }

  if (Number.isFinite(s.crossstitchMaxColors)) {
    el.crossstitchMaxColors.value = s.crossstitchMaxColors;
    el.crossstitchMaxColorsVal.textContent = s.crossstitchMaxColors;
  }

  if (Number.isFinite(s.foundObjectNumColors)) {
    el.foundObjectNumColors.value = s.foundObjectNumColors;
    el.foundObjectNumColorsVal.textContent = s.foundObjectNumColors;
    state.foundObjectNumColors = s.foundObjectNumColors;
  }
  if (Number.isFinite(s.foundObjectTintStrength)) {
    el.foundObjectTintStrength.value = s.foundObjectTintStrength;
    el.foundObjectTintStrengthVal.textContent = s.foundObjectTintStrength;
    state.foundObjectTintStrength = s.foundObjectTintStrength;
  }

  // Layout mode last, once every mode's own controls are already in place.
  if (s.layoutMode) setLayoutMode(s.layoutMode);

  updateColorSourceUI();
  updateSizeEstimate();
  updatePanelEstimate();
  updateRubiksSizeEstimate();
}

el.exportSettingsBtn.addEventListener("click", () => {
  downloadText(JSON.stringify(collectSettings(), null, 2), "pixel_mosaic_settings.json", "application/json");
  setStatus("Saved pixel_mosaic_settings.json");
});

el.importSettingsBtn.addEventListener("click", () => el.settingsFileInput.click());

el.settingsFileInput.addEventListener("change", async () => {
  const file = el.settingsFileInput.files[0];
  el.settingsFileInput.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    setStatus(`Couldn't read that settings file: ${err.message}`);
    return;
  }

  const body = document.createElement("p");
  body.textContent = "This will overwrite all of your current settings with the ones from "
    + `"${file.name}". This can't be undone. Your loaded image and any already-generated `
    + "output won't be affected.";

  showDialog({
    title: "Import settings?",
    bodyEl: body,
    actions: [
      {
        label: "Import and Overwrite", primary: true, onClick: () => {
          applySettings(data);
          closeDialog();
          setStatus(`Imported settings from ${file.name}.`);
        },
      },
      { label: "Cancel", onClick: closeDialog },
    ],
  });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setSwatchButton(el.bgColorBtn, state.bgColor);
setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
setSwatchButton(el.dieColorBtn, state.dieColor);
setSwatchButton(el.pipColorBtn, state.pipColor);
updateColorSourceUI();
updateSizeEstimate();
updatePanelEstimate();
updateRubiksSizeEstimate();
refreshPreview();
