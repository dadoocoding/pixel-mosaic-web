/**
 * app.js
 * Main application controller: wires the DOM to the core modules.
 */

import { rgbToHex, hexToRgb, contrastTextColor } from "./core/color.js";
import { buildMonochromePalette } from "./core/quantize.js";
import { imageToGrid } from "./core/grid.js";
import { renderMosaic, renderBrickMosaic, estimateOutputDimensions, renderPaintByNumber, renderColorKey } from "./core/render.js";
import { hexHitTest, circleInterlockHitTest, diamondInterlockHitTest, interlockRowHeightFactor, shapeColumnWidthFactor } from "./core/shapes.js";
import { splitIntoPanels } from "./core/panels.js";
import { LEGO_BRICK_SIZES, footprintLabel } from "./core/bricks.js";
import { colorCounts } from "./core/colorCounts.js";
import { LEGO_SOLID_COLORS, PERLER_BEAD_COLORS, HAMA_BEAD_COLORS, ARTKAL_BEAD_COLORS, parsePaletteFile } from "./core/palettes.js";
import { buildQuadtree, renderAdaptiveMosaic } from "./core/adaptive.js";
import {
  imageToGrayGrid, stretchToRange, ditherToPips, pipLevelBrightness,
  renderDiceMosaic, renderDiceKey,
} from "./core/dice.js";
import {
  RUBIKS_CUBE_COLORS, RUBIKS_PALETTE, RUBIKS_BLACK_NAME, RUBIKS_BLACK_RGB,
  RUBIKS_LUMA_ORDER, quantizeGridLumaRanked,
  rubiksActivePalette, renderRubiksMosaic, renderRubiksBuildSheet,
  renderRubiksKey, rubiksCubeCount, remapRubiksColors,
} from "./core/rubiks.js";
import { renderMetaMosaic } from "./core/meta.js";
import { renderFoundObjectMosaic } from "./core/foundobject.js";
import { PIECE_SIZE_UNITS, formatPhysicalSize, ASSEMBLY_SECONDS_PER_PIECE, formatAssemblyTime, formatLithophaneSize } from "./core/physicalSize.js";
import { POSTER_PAPER_SIZES, renderPosterPages } from "./core/poster.js";
import { buildColorSeparatedSvg } from "./core/svgExport.js";
import * as recentProjects from "./core/recentProjects.js";
import { DMC_RGB_PALETTE } from "./core/dmc.js";
import {
  dmcColorCounts, crossStitchSymbolMap, renderCrossStitchMosaic,
  renderCrossStitchPatternPage, renderCrossStitchLegendPage,
} from "./core/crossstitch.js";
import {
  buildGridJson, buildGridCsv, buildPaletteCsv,
  buildBricksJson, buildBricksCsv, buildShoppingListCsv,
  buildAdaptiveTilesJson, buildAdaptiveShoppingListCsv, buildDiceShoppingListCsv,
  buildRubiksShoppingListCsv, buildCrossStitchShoppingListCsv, buildRadialCellsJson,
  buildStainedglassCellsJson, buildStringartSequenceJson, buildStringartShoppingListCsv,
  buildLeadedglassCellsJson, buildScrewartDepthCsv,
} from "./core/exportData.js";
import { CanvasViewer } from "./ui/canvasViewer.js";
import { nearestPaintMatchesAllBrands, formatBestMatch } from "./core/paintColors.js";
import { RADIAL_MAX_CELLS, radialRingSegments, radialCellCount, sampleRadialColors, renderRadialMosaic } from "./core/radial.js";
import {
  STAINEDGLASS_MAX_CELLS, poissonDiscPoints, estimateStainedglassPieceCount,
  stainedglassCanvasSize, sampleStainedglassColors, renderStainedglassMosaic,
} from "./core/stainedglass.js";
import {
  LEADEDGLASS_MAX_CELLS, leadedglassFrameSize,
  generateLeadedglassBoldPieces, renderLeadedglassBoldPieces, estimateLeadedglassBoldPieceCount,
  leadedglassPanelGridCanvasSize, leadedglassDiamondGridBounds,
  sampleLeadedglassPanelGridColors, renderLeadedglassPanelGrid,
  leadedglassLatticeCanvasSize, generateLeadedglassLatticeSubject, renderLeadedglassLattice,
  estimateLeadedglassLatticePieceCount,
  leadedglassBorderWidth, renderLeadedglassBoldPiecesWithBorder,
  LEADEDGLASS_BORDER_DEFAULT_COLOR, LEADEDGLASS_BORDER_DEFAULT_ACCENT_COLOR,
  quantizeLeadedglassColorsDefault,
} from "./core/leadedglass.js";
import {
  LITHOPHANE_MIN_SAMPLES_ACROSS, LITHOPHANE_MAX_SAMPLES_ACROSS, LITHOPHANE_MAX_TRIANGLES,
  lithophaneSampleGridSize, estimateLithophaneTriangleCount, sampleLithophaneHeightmap,
  renderLithophanePreview, buildLithophaneStl,
} from "./core/lithophane.js";
import {
  STRINGART_MIN_PINS, STRINGART_MAX_PINS, STRINGART_MIN_LINES, STRINGART_MAX_LINES,
  STRINGART_WORKING_SIZE, stringartPinPositions, sampleStringartTarget, renderStringartPreview,
  estimateStringartThreadLength, formatStringartFrameSize, formatStringartThreadLength,
  renderStringartPinMap, renderStringartSequencePage,
} from "./core/stringart.js";
import {
  SCREWART_MIN_SCREWS_ACROSS, SCREWART_MAX_SCREWS_ACROSS,
  sampleScrewartDepthGrid, renderScrewartMosaic, renderScrewartBuildSheet, renderScrewartInfoPage,
} from "./core/screwart.js";

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
  // Recent Projects: null until the first successful generate after a photo
  // is loaded, at which point it's the id of that project's record in
  // IndexedDB (see js/core/recentProjects.js) -- every later re-generate of
  // the *same* loaded photo passes this id back in so it updates one entry
  // instead of spawning a new one each time. Cleared whenever a new photo
  // is loaded (applyLoadedImage). Mirrors the desktop app's
  // self._current_project_id.
  currentProjectId: null,
  // Batch Mode: an ephemeral (session-only, not persisted to IndexedDB
  // across page reloads) ordered list of Recent Projects ids currently in
  // the active batch. Uploading a batch registers each photo as a
  // *pending* record (see recentProjects.createPending) and stores the
  // resulting ids here; uploading a new batch replaces it. Mirrors the
  // desktop app's self._current_batch_ids.
  currentBatchIds: [],
  gridW: 40,
  gridH: 40,
  quantizedGrid: null,   // flat [r,g,b] array, row-major
  palette: null,
  colorNames: [],
  renderedShape: "square",
  renderedCellSize: 36,
  renderedCircleInterlock: false,
  renderedDiamondInterlock: false,
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
  diamondInterlock: false, // "diamond" shape only: same idea, but diamonds
                            // pack edge-to-edge with zero gaps
  brickLayout: null,
  brickCanvas: null,
  sampledHex: null,
  viewMode: "source",
  // Before/After compare view: 0-1 fraction, mirrors the desktop app's
  // self._compare_fraction -- see renderCompare() for what it means.
  compareFraction: 0.5,

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
  rubiksBaseGrid: null,  // the pristine just-quantized grid, before any recolor reassignment
  rubiksColorMap: {},    // { cube color name: replacement rgb } -- see remapRubiksColors
  // Which palette (6 or 7 colors) that base grid was actually quantized
  // against, and whether includeBlack was on, as of the last Generate
  // click -- exports and the recolor dialog key off these, not the
  // checkbox's current (possibly since-changed) value.
  rubiksPalette: RUBIKS_PALETTE,
  rubiksIncludeBlack: false,
  // "nearest" (default, matches actual hue) or "ramp" (ignores hue,
  // colors purely by brightness rank -- see RUBIKS_COLOR_MODES).
  rubiksColorMode: "nearest",

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

  // Radial mode: rings of pie-slice/annular-sector cells instead of a
  // rectangular grid -- no quantizedGrid 2D shape to reuse, so its
  // quantized colors are kept as their own flat list (see
  // core/radial.js's sampleRadialColors/renderRadialMosaic). renderedGridW/
  // renderedGridH double as 2*rings (see posterGridCounts) so Poster
  // export's DPI derivation works unchanged for this mode too.
  radialRings: 10,
  radialBaseSegments: 6,
  radialNumColors: 0,
  radialQuantized: null,
  renderedRadialRings: null,
  renderedRadialBaseSegments: null,

  // Stained Glass mode: irregular Voronoi-cell pieces from a blue-noise
  // scatter of seed points -- like Radial, no 2D grid shape to reuse, so
  // quantized colors/seed points are kept as their own flat lists (see
  // core/stainedglass.js). renderedGridW/renderedGridH double as a nominal
  // "pieces across/down" at the actual average piece spacing (see
  // posterGridCounts), same trick Radial uses, so Poster export's DPI
  // derivation works unchanged for this mode too. renderedStainedglassMinDist
  // is the piece spacing the *rendered* output actually used, kept separate
  // from the live Cell Size slider so a cheap lead-line-only re-render or a
  // physical-size estimate never silently mixes in a since-changed slider
  // value before the next full Generate.
  stainedglassPieceCount: 150,
  stainedglassNumColors: 0,
  stainedglassLeadWidth: 3,
  stainedglassLeadColor: [20, 20, 20],
  stainedglassSeed: 1,
  stainedglassPoints: null,
  stainedglassQuantized: null,
  stainedglassCanvasW: null,
  stainedglassCanvasH: null,
  stainedglassActualCellCount: null,
  renderedStainedglassMinDist: null,

  // Leaded Glass mode (displayed as "Stained Glass", taking over that name
  // from the mode above which is now "Tile Mosaic"): traditional
  // leaded-glass window panels. Three orthogonal axes -- frame shape (rect/
  // pointed/rounded arch) x generation style (lattice_subject/bold_pieces/
  // panel_grid) -- sharing one owner-array renderer/color-accumulator (see
  // core/leadedglass.js). leadedglassLayout mirrors mosaic_gui.py's `layout`
  // dict: whichever geometry fields the current style's render function
  // needs (points/minDist for bold_pieces; cellSize/colMin/colsN/rowMin/
  // rowsN for panel_grid; ecx/ecy/erx/ery/subjectPoints/rings/baseSegments
  // for lattice_subject), plus canvasW/canvasH shared by all three -- so a
  // cheap re-render (came-line width/color change) never needs a second
  // dispatch on which fields exist.
  leadedglassShape: "rect",
  leadedglassStyle: "lattice_subject",
  leadedglassLeadWidth: 3,
  leadedglassLeadColor: [20, 20, 20],
  leadedglassBgColor: [250, 248, 240],
  leadedglassNumColors: 0,
  leadedglassBoldPieceCount: 40,
  leadedglassBoldSpacing: 40,
  leadedglassBoldSeed: 1,
  leadedglassGridCols: 12,
  leadedglassGridCellSize: 60,
  leadedglassBodyWidth: 480,
  leadedglassSubjectPieces: 16,
  leadedglassRings: 4,
  leadedglassWedges: 12,
  leadedglassLatticeSeed: 1,
  leadedglassQuantized: null,
  leadedglassLayout: null,
  renderedLeadedglassShape: null,
  renderedLeadedglassStyle: null,

  // Decorative border (Bold Pieces + "rect" frame shape only -- see
  // core/leadedglass.js's renderLeadedglassBoldPiecesWithBorder). Mirrors
  // mosaic_gui.py's leadedglass_border_var/leadedglass_border_color/
  // leadedglass_border_accent_color.
  leadedglassBorderEnabled: false,
  leadedglassBorderColor: LEADEDGLASS_BORDER_DEFAULT_COLOR,
  leadedglassBorderAccentColor: LEADEDGLASS_BORDER_DEFAULT_ACCENT_COLOR,

  // Lithophane mode: a single continuous backlit height-map, exported as
  // a real STL mesh -- no 2D palette/grid at all, so most of the shared
  // state (palette, colorNames, renderedGridW/H) simply doesn't apply.
  // lithophaneHeightmap is the thickness-in-mm array the last successful
  // Generate produced (what Save STL exports), kept separate from the
  // live width/height/thickness fields so a stale Generate's export never
  // silently picks up settings changed since.
  lithophaneWidthMm: 100,
  lithophaneHeightMm: 75,
  lithophaneLockAspect: true,
  lithophaneDetail: 150,
  lithophaneMinThickness: 0.8,
  lithophaneMaxThickness: 3.2,
  lithophaneInvert: false,
  lithophaneHeightmap: null,
  lithophaneSamplesW: null,
  lithophaneSamplesH: null,
  lithophaneRenderedWidthMm: null,
  lithophaneRenderedHeightMm: null,

  // String Art mode: pins around a circular or rectangular frame,
  // connected by one continuous thread. stringartSequence/-Positions/
  // -Canvas are the last successful Generate's greedy-algorithm output
  // (thread order, pin (x,y) positions, and the raw darkness canvas),
  // kept separate from the live shape/pin/line controls so a stale
  // Generate's export or cheap thread/bg-color re-render never silently
  // picks up settings changed since. stringartCanvas is what
  // rerenderCurrent re-colors cheaply -- changing thread/bg color never
  // re-runs the greedy algorithm.
  stringartThreadColor: [20, 20, 20],
  stringartBgColor: [250, 250, 245],
  stringartSequence: null,
  stringartPositions: null,
  stringartCanvas: null,
  stringartShape: "circle",
  stringartNumPins: null,
  stringartFrameSize: null,
  stringartFrameSizeUnit: "in",
  stringartThreadLength: null,

  // Screw Art mode: a grid of screws driven to varying depths into a wood
  // panel (mm from flush), sized in "screws wide/tall" like Rubik's Cube's
  // own cube-unit sliders rather than the shared cell-based Grid width/
  // height sliders. screwartDepthGrid is the last successful Generate's
  // per-screw depth array in mm (what the build guide PDF / depth CSV
  // export read), kept separate from the live sliders/depth entries so a
  // stale Generate's export never silently picks up settings changed
  // since.
  screwsWide: 60,
  screwsTall: 60,
  screwartMinDepthMm: 0,
  screwartMaxDepthMm: 12,
  screwartInvert: false,
  screwartDepthGrid: null,
  screwartRenderedMinDepthMm: null,
  screwartRenderedMaxDepthMm: null,
};

const brickSizeSelections = new Map(LEGO_BRICK_SIZES.map(([w, h]) => [`${w}x${h}`, true]));

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  sidebar: $("panel"),
  dropZone: $("dropZone"), dropLabel: $("dropLabel"),
  browseBtn: $("browseBtn"), pasteBtn: $("pasteBtn"), fileInput: $("fileInput"),
  sampleImageBtn: $("sampleImageBtn"),
  exportSettingsBtn: $("exportSettingsBtn"), previewSettingsBtn: $("previewSettingsBtn"),
  importSettingsBtn: $("importSettingsBtn"),
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
  radialPanel: $("radialPanel"), stainedglassPanel: $("stainedglassPanel"),
  leadedglassPanel: $("leadedglassPanel"),
  lithophanePanel: $("lithophanePanel"), stringartPanel: $("stringartPanel"),
  screwartPanel: $("screwartPanel"),
  colorSourceSeg: $("colorSourceSeg"), colorsLabel: $("colorsLabel"),
  numColors: $("numColors"), numColorsVal: $("numColorsVal"),
  fixedPaletteLabel: $("fixedPaletteLabel"), choosePaletteBtn: $("choosePaletteBtn"),
  monoColorBtn: $("monoColorBtn"), monoColorPicker: $("monoColorPicker"),
  shapeSeg: $("shapeSeg"),
  circleInterlock: $("circleInterlock"), circleInterlockLabel: $("circleInterlockLabel"),
  diamondInterlock: $("diamondInterlock"), diamondInterlockLabel: $("diamondInterlockLabel"),
  generateBtn: $("generateBtn"), paletteBtn: $("paletteBtn"), sampleSheetBtn: $("sampleSheetBtn"),
  adaptiveSensitivity: $("adaptiveSensitivity"), adaptiveSensitivityVal: $("adaptiveSensitivityVal"),
  adaptiveRectangles: $("adaptiveRectangles"),
  adaptiveGenerateBtn: $("adaptiveGenerateBtn"), exportAdaptiveTilesBtn: $("exportAdaptiveTilesBtn"),
  previewAdaptiveTilesBtn: $("previewAdaptiveTilesBtn"),
  exportAdaptiveShoppingBtn: $("exportAdaptiveShoppingBtn"), previewAdaptiveShoppingBtn: $("previewAdaptiveShoppingBtn"),
  dieColorBtn: $("dieColorBtn"), dieColorPicker: $("dieColorPicker"),
  pipColorBtn: $("pipColorBtn"), pipColorPicker: $("pipColorPicker"),
  diceGenerateBtn: $("diceGenerateBtn"),
  exportDiceGuideBtn: $("exportDiceGuideBtn"), previewDiceGuideBtn: $("previewDiceGuideBtn"),
  exportDiceShoppingBtn: $("exportDiceShoppingBtn"), previewDiceShoppingBtn: $("previewDiceShoppingBtn"),
  cubesWide: $("cubesWide"), cubesWideVal: $("cubesWideVal"),
  cubesTall: $("cubesTall"), cubesTallVal: $("cubesTallVal"),
  lockAspectRubiks: $("lockAspectRubiks"),
  rubiksColorModeSeg: $("rubiksColorModeSeg"), rubiksBlackGroup: $("rubiksBlackGroup"),
  rubiksIncludeBlack: $("rubiksIncludeBlack"),
  rubiksSizeEstimate: $("rubiksSizeEstimate"),
  rubiksGenerateBtn: $("rubiksGenerateBtn"), rubiksRecolorBtn: $("rubiksRecolorBtn"),
  exportRubiksGuideBtn: $("exportRubiksGuideBtn"), previewRubiksGuideBtn: $("previewRubiksGuideBtn"),
  exportRubiksShoppingBtn: $("exportRubiksShoppingBtn"), previewRubiksShoppingBtn: $("previewRubiksShoppingBtn"),
  tintStrength: $("tintStrength"), tintStrengthVal: $("tintStrengthVal"), metaGenerateBtn: $("metaGenerateBtn"),
  crossstitchPanel: $("crossstitchPanel"), crossstitchGenerateBtn: $("crossstitchGenerateBtn"),
  crossstitchMaxColors: $("crossstitchMaxColors"), crossstitchMaxColorsVal: $("crossstitchMaxColorsVal"),
  exportCrossStitchPatternBtn: $("exportCrossStitchPatternBtn"),
  previewCrossStitchPatternBtn: $("previewCrossStitchPatternBtn"),
  exportCrossStitchShoppingBtn: $("exportCrossStitchShoppingBtn"),
  previewCrossStitchShoppingBtn: $("previewCrossStitchShoppingBtn"),
  foundObjectNumColors: $("foundObjectNumColors"), foundObjectNumColorsVal: $("foundObjectNumColorsVal"),
  foundObjectTintStrength: $("foundObjectTintStrength"), foundObjectTintStrengthVal: $("foundObjectTintStrengthVal"),
  foundObjectGenerateBtn: $("foundObjectGenerateBtn"),
  foundObjectLibraryBtn: $("foundObjectLibraryBtn"), foundObjectSummary: $("foundObjectSummary"),
  exportFoundObjectJsonBtn: $("exportFoundObjectJsonBtn"), previewFoundObjectJsonBtn: $("previewFoundObjectJsonBtn"),
  exportFoundObjectCsvBtn: $("exportFoundObjectCsvBtn"), previewFoundObjectCsvBtn: $("previewFoundObjectCsvBtn"),
  exportFoundObjectPdfBtn: $("exportFoundObjectPdfBtn"), previewFoundObjectPdfBtn: $("previewFoundObjectPdfBtn"),
  optimizeBricksBtn: $("optimizeBricksBtn"), brickSummary: $("brickSummary"),
  exportBricksJsonBtn: $("exportBricksJsonBtn"), previewBricksJsonBtn: $("previewBricksJsonBtn"),
  exportBricksCsvBtn: $("exportBricksCsvBtn"), previewBricksCsvBtn: $("previewBricksCsvBtn"),
  exportShoppingListBtn: $("exportShoppingListBtn"), previewShoppingListBtn: $("previewShoppingListBtn"),
  panelWidth: $("panelWidth"), panelWidthVal: $("panelWidthVal"),
  panelHeight: $("panelHeight"), panelHeightVal: $("panelHeightVal"),
  panelEstimate: $("panelEstimate"), exportPanelsBtn: $("exportPanelsBtn"),
  exportPreviewBtn: $("exportPreviewBtn"),
  exportPngBtn: $("exportPngBtn"), exportJsonBtn: $("exportJsonBtn"), previewJsonBtn: $("previewJsonBtn"),
  posterPaper: $("posterPaper"), exportPosterBtn: $("exportPosterBtn"), previewPosterBtn: $("previewPosterBtn"),
  exportCsvBtn: $("exportCsvBtn"), previewCsvBtn: $("previewCsvBtn"),
  exportPaintByNumberBtn: $("exportPaintByNumberBtn"), previewPaintByNumberBtn: $("previewPaintByNumberBtn"),
  exportSvgBtn: $("exportSvgBtn"), previewSvgBtn: $("previewSvgBtn"),
  viewToggle: $("viewToggle"),
  compareRow: $("compareRow"), compareSlider: $("compareSlider"),
  zoomInBtn: $("zoomInBtn"), zoomOutBtn: $("zoomOutBtn"), zoomFitBtn: $("zoomFitBtn"),
  previewCanvas: $("previewCanvas"), previewSaveOverlay: $("previewSaveOverlay"),
  sampleSwatch: $("sampleSwatch"), sampleInfo: $("sampleInfo"), copyHexBtn: $("copyHexBtn"),
  statusLine: $("statusLine"),
  dialogRoot: $("dialogRoot"),
  brickPrice: $("brickPrice"), classicPrice: $("classicPrice"),
  adaptivePrice: $("adaptivePrice"), dicePrice: $("dicePrice"),
  rubiksPrice: $("rubiksPrice"), crossstitchPrice: $("crossstitchPrice"),
  foundobjectPrice: $("foundobjectPrice"),
  radialRings: $("radialRings"), radialRingsVal: $("radialRingsVal"),
  radialBaseSegments: $("radialBaseSegments"), radialBaseSegmentsVal: $("radialBaseSegmentsVal"),
  radialCellEstimate: $("radialCellEstimate"),
  radialNumColors: $("radialNumColors"), radialNumColorsVal: $("radialNumColorsVal"),
  radialGenerateBtn: $("radialGenerateBtn"), radialPrice: $("radialPrice"),
  exportRadialCellsBtn: $("exportRadialCellsBtn"), previewRadialCellsBtn: $("previewRadialCellsBtn"),
  exportRadialShoppingBtn: $("exportRadialShoppingBtn"), previewRadialShoppingBtn: $("previewRadialShoppingBtn"),
  stainedglassPieceCount: $("stainedglassPieceCount"), stainedglassPieceCountVal: $("stainedglassPieceCountVal"),
  stainedglassPieceEstimate: $("stainedglassPieceEstimate"),
  stainedglassNumColors: $("stainedglassNumColors"), stainedglassNumColorsVal: $("stainedglassNumColorsVal"),
  stainedglassLeadWidth: $("stainedglassLeadWidth"), stainedglassLeadWidthVal: $("stainedglassLeadWidthVal"),
  stainedglassLeadColorBtn: $("stainedglassLeadColorBtn"), stainedglassLeadColorPicker: $("stainedglassLeadColorPicker"),
  stainedglassSeed: $("stainedglassSeed"), stainedglassNewLayoutBtn: $("stainedglassNewLayoutBtn"),
  stainedglassGenerateBtn: $("stainedglassGenerateBtn"), stainedglassPrice: $("stainedglassPrice"),
  exportStainedglassCellsBtn: $("exportStainedglassCellsBtn"), previewStainedglassCellsBtn: $("previewStainedglassCellsBtn"),
  exportStainedglassShoppingBtn: $("exportStainedglassShoppingBtn"), previewStainedglassShoppingBtn: $("previewStainedglassShoppingBtn"),
  leadedglassShapeSeg: $("leadedglassShapeSeg"), leadedglassStyleSeg: $("leadedglassStyleSeg"),
  leadedglassLatticePanel: $("leadedglassLatticePanel"), leadedglassBoldPanel: $("leadedglassBoldPanel"),
  leadedglassGridPanel: $("leadedglassGridPanel"),
  leadedglassBodyWidth: $("leadedglassBodyWidth"), leadedglassBodyWidthVal: $("leadedglassBodyWidthVal"),
  leadedglassSubjectPieces: $("leadedglassSubjectPieces"), leadedglassSubjectPiecesVal: $("leadedglassSubjectPiecesVal"),
  leadedglassRings: $("leadedglassRings"), leadedglassRingsVal: $("leadedglassRingsVal"),
  leadedglassWedges: $("leadedglassWedges"), leadedglassWedgesVal: $("leadedglassWedgesVal"),
  leadedglassLatticeSeed: $("leadedglassLatticeSeed"), leadedglassLatticeNewLayoutBtn: $("leadedglassLatticeNewLayoutBtn"),
  leadedglassBoldPieceCount: $("leadedglassBoldPieceCount"), leadedglassBoldPieceCountVal: $("leadedglassBoldPieceCountVal"),
  leadedglassBoldSpacing: $("leadedglassBoldSpacing"), leadedglassBoldSpacingVal: $("leadedglassBoldSpacingVal"),
  leadedglassBoldSeed: $("leadedglassBoldSeed"), leadedglassBoldNewLayoutBtn: $("leadedglassBoldNewLayoutBtn"),
  leadedglassBorderEnabled: $("leadedglassBorderEnabled"),
  leadedglassBorderColorBtn: $("leadedglassBorderColorBtn"), leadedglassBorderColorPicker: $("leadedglassBorderColorPicker"),
  leadedglassBorderAccentBtn: $("leadedglassBorderAccentBtn"), leadedglassBorderAccentPicker: $("leadedglassBorderAccentPicker"),
  leadedglassGridCols: $("leadedglassGridCols"), leadedglassGridColsVal: $("leadedglassGridColsVal"),
  leadedglassGridCellSize: $("leadedglassGridCellSize"), leadedglassGridCellSizeVal: $("leadedglassGridCellSizeVal"),
  leadedglassEstimate: $("leadedglassEstimate"),
  leadedglassLeadWidth: $("leadedglassLeadWidth"), leadedglassLeadWidthVal: $("leadedglassLeadWidthVal"),
  leadedglassLeadColorBtn: $("leadedglassLeadColorBtn"), leadedglassLeadColorPicker: $("leadedglassLeadColorPicker"),
  leadedglassBgColorBtn: $("leadedglassBgColorBtn"), leadedglassBgColorPicker: $("leadedglassBgColorPicker"),
  leadedglassNumColors: $("leadedglassNumColors"), leadedglassNumColorsVal: $("leadedglassNumColorsVal"),
  leadedglassGenerateBtn: $("leadedglassGenerateBtn"), leadedglassPrice: $("leadedglassPrice"),
  exportLeadedglassCellsBtn: $("exportLeadedglassCellsBtn"), previewLeadedglassCellsBtn: $("previewLeadedglassCellsBtn"),
  exportLeadedglassShoppingBtn: $("exportLeadedglassShoppingBtn"), previewLeadedglassShoppingBtn: $("previewLeadedglassShoppingBtn"),
  lithophaneWidth: $("lithophaneWidth"), lithophaneHeight: $("lithophaneHeight"),
  lithophaneLockAspect: $("lithophaneLockAspect"),
  lithophaneDetail: $("lithophaneDetail"), lithophaneDetailVal: $("lithophaneDetailVal"),
  lithophaneEstimate: $("lithophaneEstimate"),
  lithophaneMinThickness: $("lithophaneMinThickness"), lithophaneMaxThickness: $("lithophaneMaxThickness"),
  lithophaneInvert: $("lithophaneInvert"), lithophaneGenerateBtn: $("lithophaneGenerateBtn"),
  exportLithophaneStlBtn: $("exportLithophaneStlBtn"),
  screwsWide: $("screwsWide"), screwsWideVal: $("screwsWideVal"),
  screwsTall: $("screwsTall"), screwsTallVal: $("screwsTallVal"),
  screwartMinDepth: $("screwartMinDepth"), screwartMaxDepth: $("screwartMaxDepth"),
  screwartInvert: $("screwartInvert"), screwartSizeEstimate: $("screwartSizeEstimate"),
  screwartGenerateBtn: $("screwartGenerateBtn"),
  previewScrewartGuideBtn: $("previewScrewartGuideBtn"), exportScrewartGuideBtn: $("exportScrewartGuideBtn"),
  previewScrewartCsvBtn: $("previewScrewartCsvBtn"), exportScrewartCsvBtn: $("exportScrewartCsvBtn"),
  stringartShapeSeg: $("stringartShapeSeg"),
  stringartPins: $("stringartPins"), stringartPinsVal: $("stringartPinsVal"),
  stringartLines: $("stringartLines"), stringartLinesVal: $("stringartLinesVal"),
  stringartEstimate: $("stringartEstimate"),
  stringartFrameSize: $("stringartFrameSize"), stringartFrameSizeUnit: $("stringartFrameSizeUnit"),
  stringartThreadColorBtn: $("stringartThreadColorBtn"), stringartThreadColorPicker: $("stringartThreadColorPicker"),
  stringartBgColorBtn: $("stringartBgColorBtn"), stringartBgColorPicker: $("stringartBgColorPicker"),
  stringartGenerateBtn: $("stringartGenerateBtn"), stringartPrice: $("stringartPrice"),
  exportStringartGuideBtn: $("exportStringartGuideBtn"), previewStringartGuideBtn: $("previewStringartGuideBtn"),
  exportStringartSequenceBtn: $("exportStringartSequenceBtn"), previewStringartSequenceBtn: $("previewStringartSequenceBtn"),
  exportStringartShoppingBtn: $("exportStringartShoppingBtn"), previewStringartShoppingBtn: $("previewStringartShoppingBtn"),
  recentProjectsBtn: $("recentProjectsBtn"),
  batchUploadBtn: $("batchUploadBtn"), batchFileInput: $("batchFileInput"),
  batchModeBtn: $("batchModeBtn"),
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

// Parses an optional "$ price per X" input's text as a non-negative price,
// or null if it's blank/unparsable -- mirrors Python's _get_price exactly,
// so a blank/invalid field just means "no cost estimate", never an error.
function getPrice(inputEl) {
  const text = inputEl.value.trim();
  if (!text) return null;
  const value = parseFloat(text);
  if (Number.isNaN(value) || value < 0) return null;
  return value;
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
  // The compare slider row only makes sense (and is only shown) while
  // "Compare" is the active view -- toggled here since every view switch
  // and every re-generate routes through this one function.
  el.compareRow.hidden = state.viewMode !== "compare";

  let shown = null;
  if (state.viewMode === "source") {
    if (state.sourceCanvas) { viewer.setImage(state.sourceCanvas, { resetView }); shown = state.sourceCanvas; }
    else viewer.showPlaceholder("Load an image to get started");
  } else if (state.viewMode === "bricks") {
    if (state.brickCanvas) { viewer.setImage(state.brickCanvas, { resetView }); shown = state.brickCanvas; }
    else viewer.showPlaceholder("Optimize into bricks first (see the left panel)");
  } else if (state.viewMode === "compare") {
    if (state.sourceCanvas && state.outputCanvas) {
      shown = renderCompare(resetView);
    } else {
      viewer.showPlaceholder("Generate a mosaic, then drag the slider above to compare it with the original");
    }
  } else {
    if (state.outputCanvas) { viewer.setImage(state.outputCanvas, { resetView }); shown = state.outputCanvas; }
    else viewer.showPlaceholder("Generate a mosaic to see the output here");
  }
  updateSaveOverlay(shown);
}

// Before/After compare -- see the desktop app's _render_compare for the
// full reasoning; ported here 1:1. The slider is a reveal control, not a
// static left/right split: at 0 ("Before" end) the composite is 100% the
// original photo; at 1 ("After" end) it's 100% the mosaic; in between, the
// mosaic is revealed starting from the left edge, growing rightward.
let compareCache = { canvas: null, w: 0, h: 0, source: null };

function buildCompareBeforeCanvas(outW, outH) {
  if (compareCache.canvas && compareCache.w === outW && compareCache.h === outH
      && compareCache.source === state.sourceCanvas) {
    return compareCache.canvas;
  }
  const c = makeCanvas(outW, outH);
  c.getContext("2d").drawImage(state.sourceCanvas, 0, 0, outW, outH);
  compareCache = { canvas: c, w: outW, h: outH, source: state.sourceCanvas };
  return c;
}

function renderCompare(resetView) {
  const outW = state.outputCanvas.width, outH = state.outputCanvas.height;
  const before = buildCompareBeforeCanvas(outW, outH);
  const composite = makeCanvas(outW, outH);
  const ctx = composite.getContext("2d");
  ctx.drawImage(before, 0, 0);
  const dividerX = Math.max(0, Math.min(outW, Math.round(outW * state.compareFraction)));
  if (dividerX > 0) {
    ctx.drawImage(state.outputCanvas, 0, 0, dividerX, outH, 0, 0, dividerX, outH);
  }
  if (dividerX > 0 && dividerX < outW) {
    const lineW = Math.max(2, Math.round(outW / 300));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.max(0, dividerX - lineW / 2), 0, lineW, outH);
  }
  viewer.setImage(composite, { resetView });
  return composite;
}

el.compareSlider.addEventListener("input", () => {
  state.compareFraction = parseInt(el.compareSlider.value, 10) / 100;
  // Mirrors refreshPreview()'s shown-canvas -> save-overlay hookup (see its
  // comment) -- renderCompare() alone only repaints the zoomable canvas,
  // not the mobile save overlay, which would otherwise go stale on drag.
  if (state.viewMode === "compare") updateSaveOverlay(renderCompare(false));
});

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
  else if (state.viewMode === "compare") return; // composite mixes two coordinate spaces -- no meaningful sample
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
  const { gridW, gridH, renderedShape, renderedCellSize, renderedCircleInterlock, renderedDiamondInterlock } = state;
  let rc;
  if (renderedShape === "hexagon") {
    rc = hexHitTest(x, y, gridW, gridH, renderedCellSize);
  } else if (renderedShape === "circle" && renderedCircleInterlock) {
    rc = circleInterlockHitTest(x, y, gridW, gridH, renderedCellSize);
  } else if (renderedShape === "diamond" && renderedDiamondInterlock) {
    rc = diamondInterlockHitTest(x, y, gridW, gridH, renderedCellSize);
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
  state.currentProjectId = null;  // new photo -> next generate starts a new Recent Projects entry
  el.dropLabel.textContent = `Loaded: ${displayName}\n(${canvas.width}\u00d7${canvas.height})`;

  state.quantizedGrid = null;
  state.palette = null;
  state.colorNames = [];
  state.outputCanvas = null;
  state.adaptiveLeaves = null;
  state.dicePipGrid = null;
  state.rubiksGrid = null;
  state.rubiksBaseGrid = null;
  state.rubiksColorMap = {};
  state.rubiksPalette = RUBIKS_PALETTE;
  state.rubiksIncludeBlack = false;
  el.rubiksIncludeBlack.checked = false;
  setRubiksColorMode("nearest");
  state.crossStitchGrid = null;
  state.foundObjectQuantizedGrid = null;
  state.foundObjectPalette = null;
  state.foundObjectImages = new Map();
  state.foundObjectImageNames = new Map();
  el.foundObjectSummary.textContent = "";
  state.radialQuantized = null;
  state.stainedglassPoints = null;
  state.stainedglassQuantized = null;
  state.stainedglassCanvasW = null;
  state.stainedglassCanvasH = null;
  state.stainedglassActualCellCount = null;
  state.renderedStainedglassMinDist = null;
  state.leadedglassQuantized = null;
  state.leadedglassLayout = null;
  state.renderedLeadedglassShape = null;
  state.renderedLeadedglassStyle = null;
  state.lithophaneHeightmap = null;
  state.lithophaneSamplesW = null;
  state.lithophaneSamplesH = null;
  state.lithophaneRenderedWidthMm = null;
  state.lithophaneRenderedHeightMm = null;
  state.stringartSequence = null;
  state.stringartPositions = null;
  state.stringartCanvas = null;
  state.stringartNumPins = null;
  state.stringartFrameSize = null;
  state.stringartThreadLength = null;
  state.screwartDepthGrid = null;
  state.screwartRenderedMinDepthMm = null;
  state.screwartRenderedMaxDepthMm = null;
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
  el.radialGenerateBtn.disabled = false;
  el.stainedglassGenerateBtn.disabled = false;
  el.leadedglassGenerateBtn.disabled = false;
  el.lithophaneGenerateBtn.disabled = false;
  el.stringartGenerateBtn.disabled = false;
  el.screwartGenerateBtn.disabled = false;
  resetSampleDisplay();

  if (el.lockAspect.checked) syncHeightToAspect();
  if (el.lockAspectRubiks.checked) syncCubesTallToAspect();
  if (el.lithophaneLockAspect.checked) onLithophaneWidthChange();

  setViewMode("source");
  updateSizeEstimate();
  updatePanelEstimate();
  updateRubiksSizeEstimate();
  updateRadialCellEstimate();
  updateStainedglassPieceEstimate();
  updateLeadedglassEstimate();
  updateLithophaneEstimate();
  updateStringartEstimate();
  updateScrewartSizeEstimate();
  setStatus("Image loaded. Adjust settings and click Generate.");
}

el.browseBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files[0];
  if (file) loadImageFromFile(file);
  el.fileInput.value = "";
});

// Upload a Batch: a separate, multi-file control (deliberately not folded
// into the single-file browse/drop/paste flows above, to avoid regression
// risk there) that starts a new Batch Mode session -- see the Batch Mode
// section near the bottom of this file for createBatch() and friends.
el.batchUploadBtn.addEventListener("click", () => el.batchFileInput.click());
el.batchFileInput.addEventListener("change", () => {
  const files = Array.from(el.batchFileInput.files || []);
  el.batchFileInput.value = "";
  if (files.length) createBatch(files);
});
// Reopens the dialog for whatever batch is currently active (or shows its
// "no batch active" empty state) -- the only other way back into it once
// closed is Generate All finishing, which reopens it automatically.
el.batchModeBtn.addEventListener("click", openBatchMode);

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
  // Circle/diamond interlock pack rows closer together than a plain grid
  // (see shapes.js's interlockRowHeightFactor), which flattens the
  // *output image* relative to a naive gridHeight = gridWidth * aspect --
  // dividing by the row factor adds back the extra rows interlocking needs
  // to land on the same image aspect ratio as the source photo. Hexagon's
  // honeycomb lattice additionally narrows *column* spacing
  // (shapes.js's shapeColumnWidthFactor), which a row-only adjustment
  // would miss -- multiplying by the column factor accounts for that too,
  // so hexagon's Lock Aspect result matches the photo instead of coming
  // out taller/narrower than intended.
  const interlock = (state.shape === "circle" && state.circleInterlock)
    || (state.shape === "diamond" && state.diamondInterlock);
  const rowFactor = interlockRowHeightFactor(state.shape, interlock);
  const colFactor = shapeColumnWidthFactor(state.shape);
  let h = Math.max(4, Math.round((w * aspect * colFactor) / rowFactor));
  h = Math.min(h, GRID_MAX_CELLS);
  el.gridHeight.value = h;
  el.gridHeightVal.textContent = h;
}

function updateSizeEstimate() {
  const gw = parseInt(el.gridWidth.value, 10);
  const gh = parseInt(el.gridHeight.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const [w, h] = estimateOutputDimensions(gw, gh, state.shape, cellSize, state.circleInterlock, state.diamondInterlock);
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

function updateScrewartSizeEstimate() {
  if (!el.screwartSizeEstimate || !el.screwsWide || !el.screwsTall) return;
  const screwsWide = parseInt(el.screwsWide.value, 10);
  const screwsTall = parseInt(el.screwsTall.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const totalScrews = screwsWide * screwsTall;
  // Screw Art's cells nearly fill the grid (no inter-block gap the way
  // Rubik's 3x3 cube blocks have) -- see renderScrewartMosaic -- so the
  // output size is just the plain grid x cellSize product.
  const w = screwsWide * cellSize;
  const h = screwsTall * cellSize;
  const mp = (w * h) / 1e6;
  el.screwartSizeEstimate.textContent =
    `Output image: ~${w.toLocaleString()}\u00d7${h.toLocaleString()}px (${mp.toFixed(0)}MP) `
    + `\u2022 ${totalScrews.toLocaleString()} screws total`;
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
  if (state.layoutMode === "radial") {
    // Rings/segments has no natural width x height rectangle to size
    // against the piece-size unit the way every other mode's grid does --
    // skip the physical-size estimate rather than reusing an unrelated
    // pair of sliders for a misleading number.
    el.physicalSizeEstimate.textContent = "";
    return;
  }

  if (state.layoutMode === "stainedglass") {
    // Unlike Radial, blue-noise spacing between pieces IS a real, fairly
    // consistent physical measurement (that's the point of choosing blue
    // noise over pure-random scatter), so a nominal "pieces across the
    // canvas at this spacing" count stands in for width x height here --
    // exact once something's actually been generated (from the rendered
    // canvas size), an estimate (marked "~") from the live piece-count
    // slider before that, same formula the live piece-estimate label uses.
    const pieceSizeSg = parseFloat(el.pieceSize.value) || 0;
    const unitSg = el.pieceSizeUnit.value;
    const minDist = parseInt(el.cellSize.value, 10);
    let countW, countH, actualCount, approx;
    if (state.renderedMode === "stainedglass" && state.stainedglassCanvasW !== null) {
      countW = state.renderedGridW; countH = state.renderedGridH;
      actualCount = state.stainedglassActualCellCount || (countW * countH);
      approx = "";
    } else {
      const targetCount = parseInt(el.stainedglassPieceCount.value, 10);
      const aspect = state.sourceCanvas ? state.sourceCanvas.width / state.sourceCanvas.height : 1.0;
      const [canvasW, canvasH] = stainedglassCanvasSize(Math.round(aspect * 1000), 1000, targetCount, minDist);
      countW = Math.max(1, Math.round(canvasW / minDist));
      countH = Math.max(1, Math.round(canvasH / minDist));
      actualCount = estimateStainedglassPieceCount(canvasW, canvasH, minDist);
      approx = "~";
    }
    const formattedSg = formatPhysicalSize(countW, countH, pieceSizeSg, unitSg);
    const partsSg = [];
    if (formattedSg) {
      partsSg.push(`Physical size: ${approx}${formattedSg}  (≈${countW}×${countH} pieces across)`);
    }
    const secondsPerPieceSg = ASSEMBLY_SECONDS_PER_PIECE.stainedglass;
    if (secondsPerPieceSg) {
      const timeTextSg = formatAssemblyTime(actualCount, secondsPerPieceSg);
      if (timeTextSg) {
        partsSg.push(`Assembly time: ${approx}${timeTextSg} (rough estimate, ~${secondsPerPieceSg}s/piece)`);
      }
    }
    el.physicalSizeEstimate.textContent = partsSg.join("   •   ");
    return;
  }

  if (state.layoutMode === "leadedglass") {
    // Same reasoning as Radial: three very differently-shaped sub-modes
    // (Voronoi spacing, diamond grid cells, an ellipse + sunburst) with no
    // single width x height basis in common to size against the shared
    // Piece Size field -- skip rather than reusing an unrelated pair of
    // sliders for a misleading number. Mirrors mosaic_gui.py's
    // MosaicApp._update_physical_size_estimate leadedglass branch exactly.
    el.physicalSizeEstimate.textContent = "";
    return;
  }

  if (state.layoutMode === "stringart") {
    // A single continuous thread path around a frame, not a countW x
    // countH grid of pieces, so this shows the mode's own frame size plus
    // an estimated thread length directly (formatStringartFrameSize/
    // formatStringartThreadLength) rather than formatPhysicalSize's
    // piece-count multiplication -- mirrors mosaic_gui.py's
    // MosaicApp._update_physical_size_estimate stringart branch exactly.
    // No Assembly time either, same reasoning as Lithophane: there's no
    // per-piece build step, just following the pin sequence.
    const frameSize = parseFloat(el.stringartFrameSize.value) || 0;
    const unit = el.stringartFrameSizeUnit.value;
    const shape = [...el.stringartShapeSeg.children].find(b => b.classList.contains("active")).dataset.shape;
    const formatted = formatStringartFrameSize(shape, frameSize, unit);
    const parts = [];
    if (formatted) parts.push(formatted);
    if (state.renderedMode === "stringart" && state.stringartThreadLength !== null) {
      const lengthText = formatStringartThreadLength(state.stringartThreadLength, state.stringartFrameSizeUnit);
      if (lengthText) parts.push(lengthText);
      parts.push(`${state.stringartSequence.length - 1} thread lines / ${state.stringartNumPins} pins`);
    }
    el.physicalSizeEstimate.textContent = parts.join("   •   ");
    return;
  }

  if (state.layoutMode === "lithophane") {
    // A lithophane is a single continuous printed object sized directly in
    // mm (width/height/thickness), not a countW x countH grid of pieces,
    // so it gets its own formatter (formatLithophaneSize) rather than
    // formatPhysicalSize's piece-count multiplication -- mirrors
    // mosaic_gui.py's MosaicApp._update_physical_size_estimate lithophane
    // branch exactly.
    const widthMm = getLithophaneFloat(el.lithophaneWidth, 100);
    const heightMm = getLithophaneFloat(el.lithophaneHeight, 75);
    const maxThickness = getLithophaneFloat(el.lithophaneMaxThickness, 3.2);
    const formatted = formatLithophaneSize(widthMm, heightMm, maxThickness);
    const partsLi = [];
    if (formatted) partsLi.push(`Print size: ${formatted}`);
    if (state.renderedMode === "lithophane" && state.lithophaneSamplesW !== null) {
      partsLi.push(`${state.lithophaneSamplesW}×${state.lithophaneSamplesH} height samples`);
    }
    el.physicalSizeEstimate.textContent = partsLi.join("   •   ");
    return;
  }

  const pieceSize = parseFloat(el.pieceSize.value) || 0;
  const unit = el.pieceSizeUnit.value;

  let countW, countH, pieceWord;
  if (state.layoutMode === "rubiks") {
    countW = parseInt(el.cubesWide.value, 10);
    countH = parseInt(el.cubesTall.value, 10);
    pieceWord = "cube";
  } else if (state.layoutMode === "screwart") {
    countW = parseInt(el.screwsWide.value, 10);
    countH = parseInt(el.screwsTall.value, 10);
    pieceWord = "screw";
  } else {
    countW = parseInt(el.gridWidth.value, 10);
    countH = parseInt(el.gridHeight.value, 10);
    pieceWord = "piece";
  }

  const formatted = formatPhysicalSize(countW, countH, pieceSize, unit);
  const parts = [];
  if (formatted) {
    const plural = countW * countH !== 1 ? "s" : "";
    parts.push(`Physical size: ${formatted}  (${countW}\u00d7${countH} ${pieceWord}${plural})`);
  }

  const secondsPerPiece = ASSEMBLY_SECONDS_PER_PIECE[state.layoutMode];
  if (secondsPerPiece) {
    const timeText = formatAssemblyTime(countW * countH, secondsPerPiece);
    if (timeText) {
      parts.push(`Assembly time: ${timeText} (rough estimate, ~${secondsPerPiece}s/${pieceWord})`);
    }
  }

  el.physicalSizeEstimate.textContent = parts.join("   \u2022   ");
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
  updateStainedglassPieceEstimate();
  updateScrewartSizeEstimate();
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

el.screwsWide.addEventListener("input", () => {
  el.screwsWideVal.textContent = el.screwsWide.value;
  updateScrewartSizeEstimate();
});
el.screwsTall.addEventListener("input", () => {
  el.screwsTallVal.textContent = el.screwsTall.value;
  updateScrewartSizeEstimate();
});
el.screwartMinDepth.addEventListener("input", updatePhysicalSizeEstimate);
el.screwartMaxDepth.addEventListener("input", updatePhysicalSizeEstimate);

el.rubiksColorModeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  setRubiksColorMode(btn.dataset.mode);
});

// Factored out of the click handler above so importSettings() can drive the
// same UI update programmatically, without synthesizing a click event.
function setRubiksColorMode(mode) {
  state.rubiksColorMode = mode;
  [...el.rubiksColorModeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  // Include-black only applies to "nearest" -- in "ramp" the full
  // brightness range (including a dark band) is already covered by the 6
  // real stickers, so the checkbox and its hint are hidden rather than
  // left showing but inert.
  el.rubiksBlackGroup.hidden = mode === "ramp";
}

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
  onShapeChange(btn.dataset.shape);
});

/** The pure UI-mutation part of a shape change (toggle the active segment,
 *  show/hide the interlock checkboxes, refresh the size estimate). Shared
 *  by the live shape-selector callback (onShapeChange) and by settings
 *  import, which needs this without the aspect-ratio resync onShapeChange
 *  also does -- see onShapeChange's comment. */
function applyShapeUI(shape) {
  state.shape = shape;
  [...el.shapeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.shape === shape));
  el.circleInterlockLabel.hidden = shape !== "circle";
  el.diamondInterlockLabel.hidden = shape !== "diamond";
  updateSizeEstimate();
}

function onShapeChange(shape) {
  // Live shape-selector callback: different shapes pack cells at different
  // effective widths/heights (hexagon's honeycomb lattice especially --
  // see shapes.js's shapeColumnWidthFactor/interlockRowHeightFactor), so
  // with Lock Aspect on, switching shape needs the same grid-height resync
  // interlock toggling already gets (onInterlockChange) or the output
  // image drifts from the source photo's aspect ratio. Not called during
  // settings import (which calls applyShapeUI directly): there, gridHeight
  // is already an explicit, deliberately-saved value that this recompute
  // would silently clobber.
  applyShapeUI(shape);
  if (el.lockAspect.checked && state.sourceCanvas) syncHeightToAspect();
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
      { circleInterlock: state.renderedCircleInterlock,
        diamondInterlock: state.renderedDiamondInterlock });
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
  } else if (state.renderedMode === "radial" && state.radialQuantized) {
    state.outputCanvas = renderRadialMosaic(state.radialQuantized, state.renderedRadialRings,
      state.renderedRadialBaseSegments, state.renderedCellSize, state.bgColor, makeCanvas);
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "stainedglass" && state.stainedglassQuantized) {
    const leadWidth = parseInt(el.stainedglassLeadWidth.value, 10);
    state.outputCanvas = renderStainedglassMosaic(
      state.stainedglassQuantized, state.stainedglassPoints,
      state.stainedglassCanvasW, state.stainedglassCanvasH, state.renderedStainedglassMinDist,
      leadWidth, state.stainedglassLeadColor, makeCanvas);
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "leadedglass" && state.leadedglassQuantized) {
    const leadWidth = parseInt(el.leadedglassLeadWidth.value, 10);
    const layout = state.leadedglassLayout;
    const shape = state.renderedLeadedglassShape;
    if (state.renderedLeadedglassStyle === "bold_pieces") {
      if (layout.borderWidth) {
        // Cached geometry already has a border baked in (points are
        // pre-offset into the outer canvas -- see generateLeadedglassMosaic);
        // a came-width/color or border-color tweak can reuse it directly
        // without redoing Poisson-disc placement.
        state.outputCanvas = renderLeadedglassBoldPiecesWithBorder(
          state.leadedglassQuantized, layout.points, layout.canvasW, layout.canvasH, layout.borderWidth,
          state.leadedglassBorderColor, state.leadedglassBorderAccentColor, layout.borderSeed ?? 1,
          leadWidth, state.leadedglassLeadColor, state.leadedglassBgColor, makeCanvas);
      } else {
        state.outputCanvas = renderLeadedglassBoldPieces(
          state.leadedglassQuantized, layout.points, shape, layout.canvasW, layout.canvasH, layout.minDist,
          leadWidth, state.leadedglassLeadColor, state.leadedglassBgColor, makeCanvas);
      }
    } else if (state.renderedLeadedglassStyle === "panel_grid") {
      state.outputCanvas = renderLeadedglassPanelGrid(
        state.leadedglassQuantized, shape, layout.canvasW, layout.canvasH, layout.cellSize,
        layout.colMin, layout.colsN, layout.rowMin, layout.rowsN,
        leadWidth, state.leadedglassLeadColor, state.leadedglassBgColor, makeCanvas);
    } else {
      state.outputCanvas = renderLeadedglassLattice(
        state.leadedglassQuantized, shape, layout.canvasW, layout.canvasH,
        layout.ecx, layout.ecy, layout.erx, layout.ery, layout.subjectPoints,
        layout.rings, layout.baseSegments,
        leadWidth, state.leadedglassLeadColor, state.leadedglassBgColor, makeCanvas);
    }
    if (state.viewMode === "output") refreshPreview(resetView);
  } else if (state.renderedMode === "stringart" && state.stringartCanvas) {
    state.outputCanvas = renderStringartPreview(
      state.stringartCanvas, state.stringartShape, STRINGART_WORKING_SIZE,
      state.stringartThreadColor, state.stringartBgColor, makeCanvas);
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
  el.radialPanel.hidden = mode !== "radial";
  el.stainedglassPanel.hidden = mode !== "stainedglass";
  el.leadedglassPanel.hidden = mode !== "leadedglass";
  el.lithophanePanel.hidden = mode !== "lithophane";
  el.stringartPanel.hidden = mode !== "stringart";
  el.screwartPanel.hidden = mode !== "screwart";
  // Rubik's Cube mode sizes itself in cube units (cubesWide/cubesTall),
  // Radial mode in rings/base segments (radialRings/radialBaseSegments),
  // Stained Glass in a target piece count (stainedglassPieceCount),
  // the new leaded-glass Stained Glass mode in its own three sub-mode
  // sliders, Lithophane in a physical width/height in mm plus a detail
  // slider, and String Art in its own pin/line-count sliders plus a
  // frame-size field, rather than the shared cell-based Grid width/height
  // sliders every other mode uses -- hide those to avoid showing two
  // unrelated size controls at once.
  el.sharedGridSizeControls.hidden =
    mode === "rubiks" || mode === "radial" || mode === "stainedglass" || mode === "lithophane"
    || mode === "stringart" || mode === "leadedglass" || mode === "screwart";
  // Each mode's panel has a very different height (Classic's is long,
  // Cross-Stitch's is short, etc.), but they all share one scrolling
  // sidebar. Without this, the sidebar's scroll offset carries over
  // unchanged across a mode switch -- so scrolling down to reach Classic's
  // export buttons and then switching to a shorter panel like Cross-Stitch
  // can leave you scrolled past its Generate button entirely (and it stays
  // that way switching back, since the offset is still valid there too).
  // Reset to the top so every mode always starts from its own beginning.
  el.sidebar.scrollTop = 0;
  // Piece size's "physical size" line depends on which count basis
  // applies (cube count for Rubik's, cell count for everything else), so
  // it needs a recompute on every mode switch too, not just when the
  // grid/cube sliders themselves move.
  updatePhysicalSizeEstimate();
}

el.monoColorBtn.addEventListener("click", () => el.monoColorPicker.click());
el.monoColorPicker.addEventListener("input", () => {
  state.monochromeBaseColor = hexToRgb(el.monoColorPicker.value);
  setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
});

el.adaptiveSensitivity.addEventListener("input", () => {
  el.adaptiveSensitivityVal.textContent = el.adaptiveSensitivity.value;
  state.adaptiveSensitivity = parseInt(el.adaptiveSensitivity.value, 10);
});

el.radialRings.addEventListener("input", () => {
  el.radialRingsVal.textContent = el.radialRings.value;
  updateRadialCellEstimate();
});
el.radialBaseSegments.addEventListener("input", () => {
  el.radialBaseSegmentsVal.textContent = el.radialBaseSegments.value;
  updateRadialCellEstimate();
});
el.radialNumColors.addEventListener("input", () => {
  el.radialNumColorsVal.textContent = el.radialNumColors.value;
});

/** Live "-> N cells total" hint below the Rings/Base segments sliders,
 * mirroring updatePanelEstimate's live-recompute pattern. */
function updateRadialCellEstimate() {
  if (!el.radialCellEstimate || !el.radialRings || !el.radialBaseSegments) return;
  const rings = parseInt(el.radialRings.value, 10);
  const baseSegments = parseInt(el.radialBaseSegments.value, 10);
  const cellCount = radialCellCount(rings, baseSegments);
  const outerSegments = radialRingSegments(rings - 1, baseSegments);
  let text = `→ ${cellCount.toLocaleString()} cells total (${outerSegments} segments in the outermost ring)`;
  if (cellCount > RADIAL_MAX_CELLS) {
    text += ` — over the ${RADIAL_MAX_CELLS.toLocaleString()} limit, reduce rings/segments`;
  }
  el.radialCellEstimate.textContent = text;
}

el.stainedglassPieceCount.addEventListener("input", () => {
  el.stainedglassPieceCountVal.textContent = el.stainedglassPieceCount.value;
  updateStainedglassPieceEstimate();
});
el.stainedglassNumColors.addEventListener("input", () => {
  el.stainedglassNumColorsVal.textContent = el.stainedglassNumColors.value;
});
el.stainedglassLeadWidth.addEventListener("input", () => {
  el.stainedglassLeadWidthVal.textContent = el.stainedglassLeadWidth.value;
  // Lead width only affects *rendering* (the boundary-dilation pass), not
  // which pixels belong to which seed -- same cheap-re-render reasoning as
  // die/pip color, not a full pipeline re-run.
  rerenderCurrent(false);
});
el.stainedglassLeadColorBtn.addEventListener("click", () => el.stainedglassLeadColorPicker.click());
el.stainedglassLeadColorPicker.addEventListener("input", () => {
  state.stainedglassLeadColor = hexToRgb(el.stainedglassLeadColorPicker.value);
  setSwatchButton(el.stainedglassLeadColorBtn, state.stainedglassLeadColor);
  rerenderCurrent(false);
});
el.stainedglassNewLayoutBtn.addEventListener("click", () => {
  el.stainedglassSeed.value = String(randomStainedglassSeed());
  if (state.sourceCanvas && state.layoutMode === "stainedglass") generateStainedglassMosaic();
});

function randomStainedglassSeed() {
  return Math.floor(Math.random() * 2147483647);
}

/** Parses the seed field as a non-negative integer. An unparsable or
 * missing value is treated the same way a fresh "New Layout" click is --
 * a new random seed is picked and written back into the field -- rather
 * than silently falling back to some fixed constant, since a blank/garbled
 * seed field was never a deliberate choice to preserve. */
function getStainedglassSeed() {
  const value = parseInt(el.stainedglassSeed.value, 10);
  if (Number.isFinite(value) && value >= 0) return value;
  const newSeed = randomStainedglassSeed();
  el.stainedglassSeed.value = String(newSeed);
  return newSeed;
}

/** Live "≈ N pieces at this spacing" hint below the piece-count slider,
 * mirroring updateRadialCellEstimate's live-recompute pattern. */
function updateStainedglassPieceEstimate() {
  if (!el.stainedglassPieceEstimate || !el.stainedglassPieceCount || !el.cellSize) return;
  const targetCount = parseInt(el.stainedglassPieceCount.value, 10);
  const minDist = parseInt(el.cellSize.value, 10);
  const aspect = state.sourceCanvas ? state.sourceCanvas.width / state.sourceCanvas.height : 1.0;
  const [canvasW, canvasH] = stainedglassCanvasSize(Math.round(aspect * 1000), 1000, targetCount, minDist);
  const est = estimateStainedglassPieceCount(canvasW, canvasH, minDist);
  let text = `≈ ${est.toLocaleString()} pieces at this spacing (${canvasW}×${canvasH}px canvas)`;
  if (targetCount > STAINEDGLASS_MAX_CELLS) {
    text += ` — over the ${STAINEDGLASS_MAX_CELLS.toLocaleString()} limit, reduce piece count`;
  }
  el.stainedglassPieceEstimate.textContent = text;
}

// ---------------------------------------------------------------------------
// Lithophane mode -- lock-aspect handling and the live Detail-slider
// estimate, mirroring mosaic_gui.py's _lithophane_float/_on_lithophane_
// width_change/_update_lithophane_estimate.
// ---------------------------------------------------------------------------

/** Parses a lithophane numeric field, falling back to `defaultVal` for a
 * blank, unparsable, or non-positive value -- mirrors mosaic_gui.py's
 * MosaicApp._lithophane_float exactly. */
function getLithophaneFloat(inputEl, defaultVal) {
  const value = parseFloat(inputEl.value);
  return Number.isFinite(value) && value > 0 ? value : defaultVal;
}

/** When Lock Aspect is on and an image is loaded, recompute the Height
 * field from the Width field using the source image's aspect ratio, so the
 * print stays undistorted -- mirrors _on_lithophane_width_change. */
function onLithophaneWidthChange() {
  if (el.lithophaneLockAspect.checked && state.sourceCanvas) {
    const widthMm = getLithophaneFloat(el.lithophaneWidth, 100);
    const aspect = state.sourceCanvas.width ? state.sourceCanvas.height / state.sourceCanvas.width : 1.0;
    const heightMm = Math.max(1, Math.round(widthMm * aspect * 10) / 10);
    el.lithophaneHeight.value = heightMm;
  }
  updateLithophaneEstimate();
}

/** Live "-> W x H height samples, ~N triangles" hint below the Detail
 * slider, mirroring updateRadialCellEstimate/updateStainedglassPieceEstimate's
 * live-recompute pattern -- mirrors _update_lithophane_estimate. Also
 * refreshes the shared physical-size line, since its rendered-sample-count
 * suffix depends on nothing here but its "Print size" prefix does. */
function updateLithophaneEstimate() {
  if (!el.lithophaneEstimate || !el.lithophaneWidth || !el.lithophaneHeight || !el.lithophaneDetail) return;
  const widthMm = getLithophaneFloat(el.lithophaneWidth, 100);
  const heightMm = getLithophaneFloat(el.lithophaneHeight, 75);
  const samplesAcross = parseInt(el.lithophaneDetail.value, 10);
  const [samplesW, samplesH] = lithophaneSampleGridSize(widthMm, heightMm, samplesAcross);
  const triCount = estimateLithophaneTriangleCount(samplesW, samplesH);
  const approxBytes = 84 + triCount * 50; // 80-byte header + uint32 count + 50 bytes/triangle
  const sizeText = approxBytes >= 1024 * 1024
    ? `${(approxBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(approxBytes / 1024))} KB`;
  let text = `→ ${samplesW}×${samplesH} height samples, ~${triCount.toLocaleString()} triangles (~${sizeText} STL)`;
  if (triCount > LITHOPHANE_MAX_TRIANGLES) {
    text += ` — over the ${LITHOPHANE_MAX_TRIANGLES.toLocaleString()} triangle limit, reduce detail or print size`;
  }
  el.lithophaneEstimate.textContent = text;
  updatePhysicalSizeEstimate();
}

el.lithophaneWidth.addEventListener("input", onLithophaneWidthChange);
el.lithophaneHeight.addEventListener("input", updateLithophaneEstimate);
el.lithophaneLockAspect.addEventListener("change", () => {
  if (el.lithophaneLockAspect.checked && state.sourceCanvas) onLithophaneWidthChange();
});
el.lithophaneDetail.addEventListener("input", () => {
  el.lithophaneDetailVal.textContent = el.lithophaneDetail.value;
  updateLithophaneEstimate();
});
el.lithophaneMinThickness.addEventListener("input", updatePhysicalSizeEstimate);
el.lithophaneMaxThickness.addEventListener("input", updatePhysicalSizeEstimate);

// ---------------------------------------------------------------------------
// String Art mode -- frame-shape toggle and the live pin/line-count
// estimate, mirroring mosaic_gui.py's _on_stringart_shape_change/
// _update_stringart_estimate.
// ---------------------------------------------------------------------------

el.stringartShapeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-shape]");
  if (!btn) return;
  [...el.stringartShapeSeg.children].forEach(b => b.classList.toggle("active", b === btn));
  updatePhysicalSizeEstimate();
});

/** Live "N pins, up to M thread lines" hint below the line-count slider,
 * mirroring updateLithophaneEstimate's live-recompute pattern -- mirrors
 * _update_stringart_estimate. */
function updateStringartEstimate() {
  if (!el.stringartEstimate || !el.stringartPins || !el.stringartLines) return;
  const numPins = parseInt(el.stringartPins.value, 10);
  const numLines = parseInt(el.stringartLines.value, 10);
  let text = `${numPins} pins, up to ${numLines.toLocaleString()} thread lines`;
  if (numPins >= 250 && numLines >= 2000) {
    text += " — higher settings take longer to generate (several seconds)";
  }
  el.stringartEstimate.textContent = text;
  updatePhysicalSizeEstimate();
}

el.stringartPins.addEventListener("input", () => {
  el.stringartPinsVal.textContent = el.stringartPins.value;
  updateStringartEstimate();
});
el.stringartLines.addEventListener("input", () => {
  el.stringartLinesVal.textContent = el.stringartLines.value;
  updateStringartEstimate();
});
el.stringartFrameSize.addEventListener("input", updatePhysicalSizeEstimate);
el.stringartFrameSizeUnit.addEventListener("change", updatePhysicalSizeEstimate);

el.stringartThreadColorBtn.addEventListener("click", () => el.stringartThreadColorPicker.click());
el.stringartThreadColorPicker.addEventListener("input", () => {
  state.stringartThreadColor = hexToRgb(el.stringartThreadColorPicker.value);
  setSwatchButton(el.stringartThreadColorBtn, state.stringartThreadColor);
  // Thread/background color only affect *rendering* (renderStringartPreview
  // re-colors the stored darkness canvas), not the thread sequence itself,
  // so this is a cheap re-render, unlike re-running the greedy algorithm.
  rerenderCurrent(false);
});
el.stringartBgColorBtn.addEventListener("click", () => el.stringartBgColorPicker.click());
el.stringartBgColorPicker.addEventListener("input", () => {
  state.stringartBgColor = hexToRgb(el.stringartBgColorPicker.value);
  setSwatchButton(el.stringartBgColorBtn, state.stringartBgColor);
  rerenderCurrent(false);
});

el.adaptiveRectangles.addEventListener("change", () => {
  state.adaptiveRectangles = el.adaptiveRectangles.checked;
});

el.circleInterlock.addEventListener("change", () => {
  state.circleInterlock = el.circleInterlock.checked;
  onInterlockChange();
});
el.diamondInterlock.addEventListener("change", () => {
  state.diamondInterlock = el.diamondInterlock.checked;
  onInterlockChange();
});

function onInterlockChange() {
  // Toggling either interlock checkbox changes how many rows are needed
  // to keep the *output image* at the source photo's aspect ratio (see
  // syncHeightToAspect) -- interlocking packs rows closer together, so
  // more rows are needed to reach the same height. This resync also
  // happens on a live shape change (onShapeChange) for the same reason;
  // settings import uses applyShapeUI directly to skip it, since
  // gridHeight there is already an explicit, deliberately-saved value
  // this recompute would silently clobber.
  if (el.lockAspect.checked && state.sourceCanvas) syncHeightToAspect();
  updateSizeEstimate();
}

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
  const diamondInterlock = state.diamondInterlock;
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

    const outputCanvas = renderMosaic(quantizedFlat, gridW, gridH, shape, cellSize, bgColor, makeCanvas,
      { circleInterlock, diamondInterlock });

    state.gridW = gridW;
    state.gridH = gridH;
    state.quantizedGrid = quantizedFlat;
    state.palette = palette;
    state.colorNames = names ? [...names] : palette.map(() => "");
    state.renderedShape = shape;
    state.renderedCellSize = cellSize;
    state.renderedCircleInterlock = circleInterlock;
    state.renderedDiamondInterlock = diamondInterlock;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.renderedMode = "classic";
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportJsonBtn.disabled = false;
    el.previewJsonBtn.disabled = false;
    el.exportCsvBtn.disabled = false;
    el.previewCsvBtn.disabled = false;
    el.exportPaintByNumberBtn.disabled = false;
    el.previewPaintByNumberBtn.disabled = false;
    el.exportSvgBtn.disabled = false;
    el.previewSvgBtn.disabled = false;
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
    await snapshotRecentProject();
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
  el.exportPosterBtn.disabled = true;
  el.previewPosterBtn.disabled = true;
  el.exportJsonBtn.disabled = true;
  el.previewJsonBtn.disabled = true;
  el.exportCsvBtn.disabled = true;
  el.previewCsvBtn.disabled = true;
  el.exportPaintByNumberBtn.disabled = true;
  el.previewPaintByNumberBtn.disabled = true;
  el.exportSvgBtn.disabled = true;
  el.previewSvgBtn.disabled = true;
  el.paletteBtn.disabled = true;
  el.sampleSheetBtn.disabled = true;
  el.exportPanelsBtn.disabled = true;
  el.optimizeBricksBtn.disabled = true;
  el.exportAdaptiveTilesBtn.disabled = true;
  el.previewAdaptiveTilesBtn.disabled = true;
  el.exportAdaptiveShoppingBtn.disabled = true;
  el.previewAdaptiveShoppingBtn.disabled = true;
  el.exportDiceGuideBtn.disabled = true;
  el.previewDiceGuideBtn.disabled = true;
  el.exportDiceShoppingBtn.disabled = true;
  el.previewDiceShoppingBtn.disabled = true;
  el.exportRubiksGuideBtn.disabled = true;
  el.previewRubiksGuideBtn.disabled = true;
  el.exportRubiksShoppingBtn.disabled = true;
  el.previewRubiksShoppingBtn.disabled = true;
  el.rubiksRecolorBtn.disabled = true;
  el.exportCrossStitchPatternBtn.disabled = true;
  el.previewCrossStitchPatternBtn.disabled = true;
  el.exportCrossStitchShoppingBtn.disabled = true;
  el.previewCrossStitchShoppingBtn.disabled = true;
  el.foundObjectLibraryBtn.disabled = true;
  el.exportFoundObjectJsonBtn.disabled = true;
  el.previewFoundObjectJsonBtn.disabled = true;
  el.exportFoundObjectCsvBtn.disabled = true;
  el.previewFoundObjectCsvBtn.disabled = true;
  el.exportFoundObjectPdfBtn.disabled = true;
  el.previewFoundObjectPdfBtn.disabled = true;
  el.exportRadialCellsBtn.disabled = true;
  el.previewRadialCellsBtn.disabled = true;
  el.exportRadialShoppingBtn.disabled = true;
  el.previewRadialShoppingBtn.disabled = true;
  el.exportStainedglassCellsBtn.disabled = true;
  el.previewStainedglassCellsBtn.disabled = true;
  el.exportStainedglassShoppingBtn.disabled = true;
  el.previewStainedglassShoppingBtn.disabled = true;
  el.exportLeadedglassCellsBtn.disabled = true;
  el.previewLeadedglassCellsBtn.disabled = true;
  el.exportLeadedglassShoppingBtn.disabled = true;
  el.previewLeadedglassShoppingBtn.disabled = true;
  el.exportLithophaneStlBtn.disabled = true;
  el.exportStringartGuideBtn.disabled = true;
  el.previewStringartGuideBtn.disabled = true;
  el.exportStringartSequenceBtn.disabled = true;
  el.previewStringartSequenceBtn.disabled = true;
  el.exportStringartShoppingBtn.disabled = true;
  el.previewStringartShoppingBtn.disabled = true;
  el.exportScrewartGuideBtn.disabled = true;
  el.previewScrewartGuideBtn.disabled = true;
  el.exportScrewartCsvBtn.disabled = true;
  el.previewScrewartCsvBtn.disabled = true;
}

function clearBrickLayout() {
  state.brickLayout = null;
  state.brickCanvas = null;
  el.brickSummary.textContent = "";
  el.exportBricksJsonBtn.disabled = true;
  el.previewBricksJsonBtn.disabled = true;
  el.exportBricksCsvBtn.disabled = true;
  el.previewBricksCsvBtn.disabled = true;
  el.exportShoppingListBtn.disabled = true;
  el.previewShoppingListBtn.disabled = true;
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
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportAdaptiveTilesBtn.disabled = false;
    el.previewAdaptiveTilesBtn.disabled = false;
    el.exportAdaptiveShoppingBtn.disabled = false;
    el.previewAdaptiveShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${leaves.length} tiles, ${gridW}×${gridH} finest grid.`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.adaptiveGenerateBtn.disabled = false;
    el.adaptiveGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportAdaptiveTilesBtn.addEventListener("click", exportAdaptiveTiles);
el.previewAdaptiveTilesBtn.addEventListener("click", () => {
  if (!state.adaptiveLeaves) return;
  const json = buildAdaptiveTilesJson(state.adaptiveLeaves, state.renderedGridW, state.renderedGridH,
    { sourceName: state.sourceFileName });
  openTextExportPreviewDialog("Preview: Tile List (JSON)", json, exportAdaptiveTiles);
});

function exportAdaptiveTiles() {
  if (!state.adaptiveLeaves) return;
  const json = buildAdaptiveTilesJson(state.adaptiveLeaves, state.renderedGridW, state.renderedGridH,
    { sourceName: state.sourceFileName });
  downloadText(json, "adaptive_tiles.json", "application/json");
  setStatus("Saved adaptive_tiles.json");
}

el.exportAdaptiveShoppingBtn.addEventListener("click", exportAdaptiveShoppingList);
el.previewAdaptiveShoppingBtn.addEventListener("click", () => {
  if (!state.adaptiveLeaves) return;
  openTextExportPreviewDialog("Preview: Color Shopping List (CSV)",
    buildAdaptiveShoppingListCsv(state.adaptiveLeaves, getPrice(el.adaptivePrice)), exportAdaptiveShoppingList);
});

function exportAdaptiveShoppingList() {
  if (!state.adaptiveLeaves) return;
  const csv = buildAdaptiveShoppingListCsv(state.adaptiveLeaves, getPrice(el.adaptivePrice));
  downloadText(csv, "adaptive_shopping_list.csv", "text/csv");
  setStatus("Saved adaptive_shopping_list.csv");
}

// ---------------------------------------------------------------------------
// Generate -- Radial (concentric rings of pie-slice cells)
// ---------------------------------------------------------------------------

el.radialGenerateBtn.addEventListener("click", generateRadialMosaic);

async function generateRadialMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const rings = parseInt(el.radialRings.value, 10);
  const baseSegments = parseInt(el.radialBaseSegments.value, 10);
  const numColors = parseInt(el.radialNumColors.value, 10) || null;
  const cellSize = parseInt(el.cellSize.value, 10);
  const bgColor = state.bgColor;

  const cellCount = radialCellCount(rings, baseSegments);
  if (cellCount > RADIAL_MAX_CELLS) {
    setStatus(`That's ${cellCount.toLocaleString()} cells -- reduce rings or base segments ` +
      `to bring it under ${RADIAL_MAX_CELLS.toLocaleString()}.`);
    return;
  }

  el.radialGenerateBtn.disabled = true;
  el.radialGenerateBtn.textContent = "Generating...";
  setStatus("Sampling rings, this can take a few seconds for larger grids...");

  try {
    const sampled = sampleRadialColors(state.sourceCanvas, rings, baseSegments);
    const result = await callWorker("quantize-auto", { points: sampled, nColors: numColors });
    const palette = result.palette;
    const quantized = Array.from(result.labels).map(l => palette[l]);
    const chosenN = result.chosenK;

    const outputCanvas = renderRadialMosaic(quantized, rings, baseSegments, cellSize, bgColor, makeCanvas);

    state.radialQuantized = quantized;
    state.palette = palette;
    state.colorNames = palette.map(() => "");
    state.renderedMode = "radial";
    state.renderedCellSize = cellSize;
    state.renderedRadialRings = rings;
    state.renderedRadialBaseSegments = baseSegments;
    // No natural width x height rectangle for a ring/segment layout -- a
    // square canvas 2*rings cells across (see renderRadialMosaic) stands
    // in for gridW/gridH everywhere that expects one (Poster export's DPI
    // derivation via posterGridCounts, in particular), so those "just
    // work" for this mode too with no code of their own.
    state.renderedGridW = 2 * rings;
    state.renderedGridH = 2 * rings;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportRadialCellsBtn.disabled = false;
    el.previewRadialCellsBtn.disabled = false;
    el.exportRadialShoppingBtn.disabled = false;
    el.previewRadialShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${chosenN} colors, ${cellCount} cells across ${rings} rings.`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.radialGenerateBtn.disabled = false;
    el.radialGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportRadialCellsBtn.addEventListener("click", exportRadialCells);
el.previewRadialCellsBtn.addEventListener("click", () => {
  if (!state.radialQuantized) return;
  const json = buildRadialCellsJson(state.radialQuantized, state.renderedRadialRings,
    state.renderedRadialBaseSegments, { sourceName: state.sourceFileName });
  openTextExportPreviewDialog("Preview: Cell List (JSON)", json, exportRadialCells);
});

function exportRadialCells() {
  if (!state.radialQuantized) return;
  const json = buildRadialCellsJson(state.radialQuantized, state.renderedRadialRings,
    state.renderedRadialBaseSegments, { sourceName: state.sourceFileName });
  downloadText(json, "radial_cells.json", "application/json");
  setStatus("Saved radial_cells.json");
}

el.exportRadialShoppingBtn.addEventListener("click", exportRadialShoppingList);
el.previewRadialShoppingBtn.addEventListener("click", () => {
  if (!state.radialQuantized) return;
  openTextExportPreviewDialog("Preview: Color Shopping List (CSV)",
    buildPaletteCsv(state.radialQuantized, state.palette, state.colorNames, getPrice(el.radialPrice)),
    exportRadialShoppingList);
});

function exportRadialShoppingList() {
  if (!state.radialQuantized) return;
  const csv = buildPaletteCsv(state.radialQuantized, state.palette, state.colorNames, getPrice(el.radialPrice));
  downloadText(csv, "radial_shopping_list.csv", "text/csv");
  setStatus("Saved radial_shopping_list.csv");
}

el.stainedglassGenerateBtn.addEventListener("click", generateStainedglassMosaic);

async function generateStainedglassMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const targetCount = parseInt(el.stainedglassPieceCount.value, 10);
  const minDist = parseInt(el.cellSize.value, 10);
  const numColors = parseInt(el.stainedglassNumColors.value, 10) || null;
  const leadWidth = parseInt(el.stainedglassLeadWidth.value, 10);
  const leadColor = state.stainedglassLeadColor;
  const seed = getStainedglassSeed();

  if (targetCount > STAINEDGLASS_MAX_CELLS) {
    setStatus(`That's a target of ${targetCount.toLocaleString()} pieces -- reduce the piece count ` +
      `to bring it under ${STAINEDGLASS_MAX_CELLS.toLocaleString()}.`);
    return;
  }

  el.stainedglassGenerateBtn.disabled = true;
  el.stainedglassGenerateBtn.textContent = "Generating...";
  setStatus("Scattering pieces, this can take a few seconds for larger counts...");

  try {
    const [canvasW, canvasH] = stainedglassCanvasSize(
      state.sourceCanvas.width, state.sourceCanvas.height, targetCount, minDist);
    const points = poissonDiscPoints(canvasW, canvasH, minDist, seed);
    if (points.length > STAINEDGLASS_MAX_CELLS) {
      setStatus(`That layout came out to ${points.length.toLocaleString()} pieces -- reduce the piece count ` +
        `to bring it under ${STAINEDGLASS_MAX_CELLS.toLocaleString()}.`);
      return;
    }
    const sampled = sampleStainedglassColors(state.sourceCanvas, points, canvasW, canvasH, minDist);
    const result = await callWorker("quantize-auto", { points: sampled, nColors: numColors });
    const palette = result.palette;
    const quantized = Array.from(result.labels).map(l => palette[l]);
    const chosenN = result.chosenK;

    const outputCanvas = renderStainedglassMosaic(
      quantized, points, canvasW, canvasH, minDist, leadWidth, leadColor, makeCanvas);

    state.stainedglassPoints = points;
    state.stainedglassQuantized = quantized;
    state.stainedglassCanvasW = canvasW;
    state.stainedglassCanvasH = canvasH;
    state.stainedglassActualCellCount = points.length;
    state.renderedStainedglassMinDist = minDist;
    state.palette = palette;
    state.colorNames = palette.map(() => "");
    state.renderedMode = "stainedglass";
    state.renderedCellSize = minDist;
    // No natural width x height rectangle here either (irregular Voronoi
    // cells, not a grid) -- a nominal "pieces across/down" at the actual
    // average piece spacing stands in for gridW/gridH, same trick Radial
    // uses, so Poster export's DPI derivation (via posterGridCounts) and
    // the physical-size estimate both "just work" with no code of their
    // own.
    state.renderedGridW = Math.max(1, Math.round(canvasW / minDist));
    state.renderedGridH = Math.max(1, Math.round(canvasH / minDist));
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportStainedglassCellsBtn.disabled = false;
    el.previewStainedglassCellsBtn.disabled = false;
    el.exportStainedglassShoppingBtn.disabled = false;
    el.previewStainedglassShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    updatePhysicalSizeEstimate();
    setStatus(`Done — ${chosenN} colors, ${points.length} pieces (${canvasW}×${canvasH}px canvas).`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.stainedglassGenerateBtn.disabled = false;
    el.stainedglassGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportStainedglassCellsBtn.addEventListener("click", exportStainedglassCells);
el.previewStainedglassCellsBtn.addEventListener("click", () => {
  if (!state.stainedglassQuantized) return;
  const json = buildStainedglassCellsJson(state.stainedglassQuantized, state.stainedglassPoints,
    state.stainedglassCanvasW, state.stainedglassCanvasH, { sourceName: state.sourceFileName });
  openTextExportPreviewDialog("Preview: Cell List (JSON)", json, exportStainedglassCells);
});

function exportStainedglassCells() {
  if (!state.stainedglassQuantized) return;
  const json = buildStainedglassCellsJson(state.stainedglassQuantized, state.stainedglassPoints,
    state.stainedglassCanvasW, state.stainedglassCanvasH, { sourceName: state.sourceFileName });
  downloadText(json, "stainedglass_cells.json", "application/json");
  setStatus("Saved stainedglass_cells.json");
}

// ---------------------------------------------------------------------------
// Generate -- Leaded Glass (displayed as "Stained Glass"; see the leadedglass
// state block's comment for why the internal name and display name differ).
// Three orthogonal axes -- frame shape x generation style -- mirroring
// mosaic_gui.py's Python GUI wiring exactly (_leadedglass_style_key/
// _leadedglass_shape_key, _on_leadedglass_style_change/_on_leadedglass_
// shape_change, _update_leadedglass_estimate, _on_generate_leadedglass).
// No unified dispatcher here by design (unlike mosaic_core.py's
// generate_leadedglass_mosaic) -- app.js orchestrates the three sub-modes'
// generate/sample/render calls directly, the same way it already does for
// every other mode's own generate function.
// ---------------------------------------------------------------------------

function leadedglassShapeKey() {
  const btn = [...el.leadedglassShapeSeg.children].find(b => b.classList.contains("active"));
  return btn ? btn.dataset.shape : "rect";
}

function leadedglassStyleKey() {
  const btn = [...el.leadedglassStyleSeg.children].find(b => b.classList.contains("active"));
  return btn ? btn.dataset.style : "lattice_subject";
}

el.leadedglassShapeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-shape]");
  if (!btn) return;
  [...el.leadedglassShapeSeg.children].forEach(b => b.classList.toggle("active", b === btn));
  onLeadedglassShapeChange();
  updateLeadedglassEstimate();
});

/** The decorative border is rectangle-only for now (see
 * core/leadedglass.js's renderLeadedglassBoldPiecesWithBorder) -- force
 * it off and disable the checkbox itself for any other frame shape, so
 * the UI never offers a toggle that would silently do nothing. Mirrors
 * mosaic_gui.py's _on_leadedglass_shape_change. */
function onLeadedglassShapeChange() {
  const isRect = leadedglassShapeKey() === "rect";
  el.leadedglassBorderEnabled.disabled = !isRect;
  if (!isRect && el.leadedglassBorderEnabled.checked) {
    el.leadedglassBorderEnabled.checked = false;
    onLeadedglassBorderToggle();
  }
}

el.leadedglassStyleSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-style]");
  if (!btn) return;
  [...el.leadedglassStyleSeg.children].forEach(b => b.classList.toggle("active", b === btn));
  const style = btn.dataset.style;
  el.leadedglassLatticePanel.hidden = style !== "lattice_subject";
  el.leadedglassBoldPanel.hidden = style !== "bold_pieces";
  el.leadedglassGridPanel.hidden = style !== "panel_grid";
  updateLeadedglassEstimate();
});

function randomLeadedglassSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function getLeadedglassBoldSeed() {
  const value = parseInt(el.leadedglassBoldSeed.value, 10);
  if (Number.isFinite(value) && value >= 0) return value;
  const newSeed = randomLeadedglassSeed();
  el.leadedglassBoldSeed.value = String(newSeed);
  return newSeed;
}

el.leadedglassBoldNewLayoutBtn.addEventListener("click", () => {
  el.leadedglassBoldSeed.value = String(randomLeadedglassSeed());
  if (state.sourceCanvas && state.layoutMode === "leadedglass" && leadedglassStyleKey() === "bold_pieces") {
    generateLeadedglassMosaic();
  }
});

function getLeadedglassLatticeSeed() {
  const value = parseInt(el.leadedglassLatticeSeed.value, 10);
  if (Number.isFinite(value) && value >= 0) return value;
  const newSeed = randomLeadedglassSeed();
  el.leadedglassLatticeSeed.value = String(newSeed);
  return newSeed;
}

el.leadedglassLatticeNewLayoutBtn.addEventListener("click", () => {
  el.leadedglassLatticeSeed.value = String(randomLeadedglassSeed());
  if (state.sourceCanvas && state.layoutMode === "leadedglass" && leadedglassStyleKey() === "lattice_subject") {
    generateLeadedglassMosaic();
  }
});

el.leadedglassLeadColorBtn.addEventListener("click", () => el.leadedglassLeadColorPicker.click());
el.leadedglassLeadColorPicker.addEventListener("input", () => {
  state.leadedglassLeadColor = hexToRgb(el.leadedglassLeadColorPicker.value);
  setSwatchButton(el.leadedglassLeadColorBtn, state.leadedglassLeadColor);
  rerenderCurrent(false);
});
el.leadedglassBgColorBtn.addEventListener("click", () => el.leadedglassBgColorPicker.click());
el.leadedglassBgColorPicker.addEventListener("input", () => {
  state.leadedglassBgColor = hexToRgb(el.leadedglassBgColorPicker.value);
  setSwatchButton(el.leadedglassBgColorBtn, state.leadedglassBgColor);
  rerenderCurrent(false);
});
el.leadedglassLeadWidth.addEventListener("input", () => {
  el.leadedglassLeadWidthVal.textContent = el.leadedglassLeadWidth.value;
  // Came width only affects *rendering* (the boundary-dilation pass), not
  // which pixels belong to which piece -- same cheap-re-render reasoning
  // as Tile Mosaic's own lead-width slider.
  rerenderCurrent(false);
});

/** Checking/unchecking changes the canvas geometry (the picture shrinks
 * to make room for the border band, or grows back to fill it), so --
 * like the piece-count/spacing sliders -- this doesn't re-render on its
 * own; it takes effect on the next "Generate Mosaic" click. Only the two
 * color swatches enable/disable here. Mirrors mosaic_gui.py's
 * _on_leadedglass_border_toggle. */
function onLeadedglassBorderToggle() {
  state.leadedglassBorderEnabled = el.leadedglassBorderEnabled.checked;
  el.leadedglassBorderColorBtn.disabled = !state.leadedglassBorderEnabled;
  el.leadedglassBorderAccentBtn.disabled = !state.leadedglassBorderEnabled;
}
el.leadedglassBorderEnabled.addEventListener("change", onLeadedglassBorderToggle);

el.leadedglassBorderColorBtn.addEventListener("click", () => el.leadedglassBorderColorPicker.click());
el.leadedglassBorderColorPicker.addEventListener("input", () => {
  state.leadedglassBorderColor = hexToRgb(el.leadedglassBorderColorPicker.value);
  setSwatchButton(el.leadedglassBorderColorBtn, state.leadedglassBorderColor);
  rerenderCurrent(false);
});
el.leadedglassBorderAccentBtn.addEventListener("click", () => el.leadedglassBorderAccentPicker.click());
el.leadedglassBorderAccentPicker.addEventListener("input", () => {
  state.leadedglassBorderAccentColor = hexToRgb(el.leadedglassBorderAccentPicker.value);
  setSwatchButton(el.leadedglassBorderAccentBtn, state.leadedglassBorderAccentColor);
  rerenderCurrent(false);
});
el.leadedglassNumColors.addEventListener("input", () => {
  el.leadedglassNumColorsVal.textContent = el.leadedglassNumColors.value;
});

for (const [slider, valEl] of [
  [el.leadedglassBodyWidth, el.leadedglassBodyWidthVal],
  [el.leadedglassSubjectPieces, el.leadedglassSubjectPiecesVal],
  [el.leadedglassRings, el.leadedglassRingsVal],
  [el.leadedglassWedges, el.leadedglassWedgesVal],
  [el.leadedglassBoldPieceCount, el.leadedglassBoldPieceCountVal],
  [el.leadedglassBoldSpacing, el.leadedglassBoldSpacingVal],
  [el.leadedglassGridCols, el.leadedglassGridColsVal],
  [el.leadedglassGridCellSize, el.leadedglassGridCellSizeVal],
]) {
  slider.addEventListener("input", () => {
    valEl.textContent = slider.value;
    updateLeadedglassEstimate();
  });
}

/** Live piece-count hint below the sub-mode's own sliders, mirroring
 * mosaic_gui.py's MosaicApp._update_leadedglass_estimate -- the estimate
 * basis differs entirely by style, same as the generate function itself. */
function updateLeadedglassEstimate() {
  if (!el.leadedglassEstimate || !el.leadedglassStyleSeg || !el.leadedglassShapeSeg) return;
  const style = leadedglassStyleKey();

  if (style === "bold_pieces") {
    const count = parseInt(el.leadedglassBoldPieceCount.value, 10);
    const minDist = parseFloat(el.leadedglassBoldSpacing.value);
    const est = state.sourceCanvas
      ? estimateLeadedglassBoldPieceCount(state.sourceCanvas.width, state.sourceCanvas.height, count, minDist)
      : count;
    let text = `≈ ${est.toLocaleString()} pieces at this spacing`;
    if (count > LEADEDGLASS_MAX_CELLS) {
      text += ` — over the ${LEADEDGLASS_MAX_CELLS.toLocaleString()} limit, reduce piece count`;
    }
    el.leadedglassEstimate.textContent = text;
  } else if (style === "panel_grid") {
    const cols = parseInt(el.leadedglassGridCols.value, 10);
    const cell = parseFloat(el.leadedglassGridCellSize.value);
    if (state.sourceCanvas) {
      const shape = leadedglassShapeKey();
      const [canvasW, canvasH] = leadedglassPanelGridCanvasSize(
        state.sourceCanvas.width, state.sourceCanvas.height, shape, cols, cell);
      const [, colsN, , rowsN] = leadedglassDiamondGridBounds(cell, canvasW, canvasH);
      const total = colsN * rowsN;
      let text = `${colsN}×${rowsN} = ${total.toLocaleString()} diamond panes (${canvasW}×${canvasH}px canvas)`;
      if (total > LEADEDGLASS_MAX_CELLS) {
        text += ` — over the ${LEADEDGLASS_MAX_CELLS.toLocaleString()} limit, reduce the grid density`;
      }
      el.leadedglassEstimate.textContent = text;
    } else {
      el.leadedglassEstimate.textContent = "Load an image to see the exact grid size.";
    }
  } else {
    const subject = parseInt(el.leadedglassSubjectPieces.value, 10);
    const rings = parseInt(el.leadedglassRings.value, 10);
    const wedges = parseInt(el.leadedglassWedges.value, 10);
    const total = estimateLeadedglassLatticePieceCount(subject, rings, wedges);
    let text = `≈ ${total.toLocaleString()} pieces total (${subject} subject + ${total - subject} sunburst)`;
    if (total > LEADEDGLASS_MAX_CELLS) {
      text += ` — over the ${LEADEDGLASS_MAX_CELLS.toLocaleString()} limit, reduce piece/ring/wedge counts`;
    }
    el.leadedglassEstimate.textContent = text;
  }
}

el.leadedglassGenerateBtn.addEventListener("click", generateLeadedglassMosaic);

async function generateLeadedglassMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const shape = leadedglassShapeKey();
  const style = leadedglassStyleKey();
  const numColors = parseInt(el.leadedglassNumColors.value, 10) || null;
  const leadWidth = parseInt(el.leadedglassLeadWidth.value, 10);
  const leadColor = state.leadedglassLeadColor;
  const bgColor = state.leadedglassBgColor;

  if (style === "bold_pieces") {
    const targetCount = parseInt(el.leadedglassBoldPieceCount.value, 10);
    if (targetCount > LEADEDGLASS_MAX_CELLS) {
      setStatus(`That's a target of ${targetCount.toLocaleString()} pieces -- reduce the piece count ` +
        `to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
      return;
    }
  } else if (style === "lattice_subject") {
    const subjectCount = parseInt(el.leadedglassSubjectPieces.value, 10);
    const rings = parseInt(el.leadedglassRings.value, 10);
    const wedges = parseInt(el.leadedglassWedges.value, 10);
    const total = estimateLeadedglassLatticePieceCount(subjectCount, rings, wedges);
    if (total > LEADEDGLASS_MAX_CELLS) {
      setStatus(`That's ${total.toLocaleString()} pieces total -- reduce the subject piece count, rings, ` +
        `or wedges to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
      return;
    }
  }

  el.leadedglassGenerateBtn.disabled = true;
  el.leadedglassGenerateBtn.textContent = "Generating...";
  setStatus("Building the panel, this can take a few seconds...");

  try {
    let canvasW, canvasH, colors, layout;

    if (style === "bold_pieces") {
      const targetCount = parseInt(el.leadedglassBoldPieceCount.value, 10);
      const minDist = parseFloat(el.leadedglassBoldSpacing.value);
      const seed = getLeadedglassBoldSeed();
      const result = generateLeadedglassBoldPieces(state.sourceCanvas, shape, targetCount, minDist, seed);
      canvasW = result.canvasW; canvasH = result.canvasH; colors = result.colors;
      let points = result.points;

      const useBorder = shape === "rect" && state.leadedglassBorderEnabled;
      if (useBorder) {
        const bw = leadedglassBorderWidth(canvasW, canvasH);
        const outerW = canvasW + 2 * bw, outerH = canvasH + 2 * bw;
        // Offset points into the bigger outer (bordered) canvas first --
        // renderLeadedglassBoldPiecesWithBorder expects points already in
        // outer-canvas coordinates, and this same offset list is what gets
        // cached in layout.points below, so the cheap re-render path
        // (came-line width/color/border-color tweaks without regenerating
        // geometry, see rerenderCurrent) can hand it straight back in.
        points = points.map(([x, y]) => [x + bw, y + bw]);
        canvasW = outerW; canvasH = outerH;
        layout = { kind: "bold_pieces", points, canvasW, canvasH, minDist,
          borderWidth: bw, borderColor: state.leadedglassBorderColor,
          borderAccentColor: state.leadedglassBorderAccentColor, borderSeed: seed };
      } else {
        layout = { kind: "bold_pieces", points, canvasW, canvasH, minDist };
      }
    } else if (style === "panel_grid") {
      const cols = parseInt(el.leadedglassGridCols.value, 10);
      const cellSize = parseFloat(el.leadedglassGridCellSize.value);
      [canvasW, canvasH] = leadedglassPanelGridCanvasSize(
        state.sourceCanvas.width, state.sourceCanvas.height, shape, cols, cellSize);
      const [colMin, colsN, rowMin, rowsN] = leadedglassDiamondGridBounds(cellSize, canvasW, canvasH);
      if (colsN * rowsN > LEADEDGLASS_MAX_CELLS) {
        setStatus(`That's a ${colsN}×${rowsN} grid (${(colsN * rowsN).toLocaleString()} panes) -- reduce ` +
          `the grid density to bring it under ${LEADEDGLASS_MAX_CELLS.toLocaleString()}.`);
        return;
      }
      colors = sampleLeadedglassPanelGridColors(state.sourceCanvas, canvasW, canvasH, cellSize,
        colMin, colsN, rowMin, rowsN);
      layout = { kind: "panel_grid", canvasW, canvasH, cellSize, colMin, colsN, rowMin, rowsN };
    } else {
      const bodyW = parseInt(el.leadedglassBodyWidth.value, 10);
      const subjectCount = parseInt(el.leadedglassSubjectPieces.value, 10);
      const rings = parseInt(el.leadedglassRings.value, 10);
      const baseSegments = parseInt(el.leadedglassWedges.value, 10);
      const seed = getLeadedglassLatticeSeed();
      const result = generateLeadedglassLatticeSubject(
        state.sourceCanvas, shape, bodyW, subjectCount, seed, rings, baseSegments);
      canvasW = result.canvasW; canvasH = result.canvasH; colors = result.colors;
      layout = { kind: "lattice_subject", canvasW, canvasH,
        ecx: result.ecx, ecy: result.ecy, erx: result.erx, ery: result.ery,
        subjectPoints: result.subjectPoints, rings, baseSegments };
    }

    // Unlike Tile Mosaic/Radial (which *want* a small shared palette --
    // that's what makes their output a buildable set of physical tiles),
    // Leaded Glass pieces are meant to read as individually mixed stained
    // glass, so "no explicit color count" means "keep each piece's own
    // sampled color" rather than auto-picking a tiny shared palette the
    // way quantize-auto's k=null/0 behaves for every other mode. An
    // explicit numColors still goes through the normal K-Means worker
    // path unchanged. Mirrors mosaic_core.py's quantize_leadedglass_colors.
    let palette, quantized, chosenN;
    if (!numColors || numColors <= 0) {
      const result = quantizeLeadedglassColorsDefault(colors);
      quantized = result.flat;
      palette = result.palette;
      chosenN = result.chosenN;
    } else {
      const quantResult = await callWorker("quantize-auto", { points: colors, nColors: numColors });
      palette = quantResult.palette;
      quantized = Array.from(quantResult.labels).map(l => palette[l]);
      chosenN = quantResult.chosenK;
    }

    let outputCanvas;
    if (style === "bold_pieces") {
      if (layout.borderWidth) {
        outputCanvas = renderLeadedglassBoldPiecesWithBorder(
          quantized, layout.points, canvasW, canvasH, layout.borderWidth,
          layout.borderColor, layout.borderAccentColor, layout.borderSeed,
          leadWidth, leadColor, bgColor, makeCanvas);
      } else {
        outputCanvas = renderLeadedglassBoldPieces(
          quantized, layout.points, shape, canvasW, canvasH, layout.minDist,
          leadWidth, leadColor, bgColor, makeCanvas);
      }
    } else if (style === "panel_grid") {
      outputCanvas = renderLeadedglassPanelGrid(
        quantized, shape, canvasW, canvasH, layout.cellSize,
        layout.colMin, layout.colsN, layout.rowMin, layout.rowsN,
        leadWidth, leadColor, bgColor, makeCanvas);
    } else {
      outputCanvas = renderLeadedglassLattice(
        quantized, shape, canvasW, canvasH, layout.ecx, layout.ecy, layout.erx, layout.ery,
        layout.subjectPoints, layout.rings, layout.baseSegments,
        leadWidth, leadColor, bgColor, makeCanvas);
    }

    state.leadedglassQuantized = quantized;
    state.leadedglassLayout = layout;
    state.renderedLeadedglassShape = shape;
    state.renderedLeadedglassStyle = style;
    state.palette = palette;
    state.colorNames = palette.map(() => "");
    state.renderedMode = "leadedglass";
    // Nominal "pieces across/down" grid, same trick Tile Mosaic/Radial use,
    // so Poster export's DPI derivation (via posterGridCounts) has
    // something to divide by -- based on a flat 40px nominal spacing
    // regardless of sub-mode, since no single spacing constant fits all
    // three. The physical-size estimate itself is skipped entirely for
    // this mode (see updatePhysicalSizeEstimate), so this nominal grid
    // only feeds Poster export, not anything the user reads as a real
    // measurement. Mirrors mosaic_gui.py's _generate_leadedglass_done.
    const nominalSpacing = 40;
    state.renderedGridW = Math.max(1, Math.round(canvasW / nominalSpacing));
    state.renderedGridH = Math.max(1, Math.round(canvasH / nominalSpacing));
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportLeadedglassCellsBtn.disabled = false;
    el.previewLeadedglassCellsBtn.disabled = false;
    el.exportLeadedglassShoppingBtn.disabled = false;
    el.previewLeadedglassShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    updatePhysicalSizeEstimate();
    setStatus(`Done — ${chosenN} colors, ${quantized.length} pieces (${canvasW}×${canvasH}px canvas).`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.leadedglassGenerateBtn.disabled = false;
    el.leadedglassGenerateBtn.textContent = "Generate Mosaic";
  }
}

/** Adapts state.leadedglassLayout's render-oriented field names (colMin/
 * colsN/rowMin/rowsN for panel_grid) to buildLeadedglassCellsJson's
 * export-oriented ones (cols/rows) -- see that function's own doc comment
 * for the three layout.kind shapes it expects. bold_pieces and
 * lattice_subject already match field-for-field, so this only remaps
 * panel_grid. */
function leadedglassExportLayout() {
  const layout = state.leadedglassLayout;
  if (layout.kind === "panel_grid") {
    return { kind: "panel_grid", canvasW: layout.canvasW, canvasH: layout.canvasH,
      cols: layout.colsN, rows: layout.rowsN };
  }
  return layout;
}

el.exportLeadedglassCellsBtn.addEventListener("click", exportLeadedglassCells);
el.previewLeadedglassCellsBtn.addEventListener("click", () => {
  if (!state.leadedglassQuantized) return;
  const json = buildLeadedglassCellsJson(state.leadedglassQuantized, leadedglassExportLayout(),
    state.renderedLeadedglassShape, state.renderedLeadedglassStyle, { sourceName: state.sourceFileName });
  openTextExportPreviewDialog("Preview: Cell List (JSON)", json, exportLeadedglassCells);
});

function exportLeadedglassCells() {
  if (!state.leadedglassQuantized) return;
  const json = buildLeadedglassCellsJson(state.leadedglassQuantized, leadedglassExportLayout(),
    state.renderedLeadedglassShape, state.renderedLeadedglassStyle, { sourceName: state.sourceFileName });
  downloadText(json, "leadedglass_cells.json", "application/json");
  setStatus("Saved leadedglass_cells.json");
}

// ---------------------------------------------------------------------------
// Generate -- Lithophane (classic single-material, exported as a real STL)
// ---------------------------------------------------------------------------
// Deliberately no cheap re-render path (unlike Stained Glass's lead-width/
// color or Dice/Rubik's die-color): sampling and geometry are tightly
// coupled here, with no separable "just re-render with new colors" step,
// so every settings change needs a full Generate click -- mirrors
// mosaic_gui.py's equivalent scope decision. Poster export is deliberately
// not enabled either (Poster's DPI scale comes from the shared Piece Size
// field, which has no meaning for Lithophane's own width/height controls),
// and there's no preview-dialog button since a binary STL doesn't fit the
// text-preview pattern -- the grayscale PNG preview (shared exportPreviewBtn)
// serves as the visual check before printing.

el.lithophaneGenerateBtn.addEventListener("click", generateLithophaneMosaic);

async function generateLithophaneMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const widthMm = getLithophaneFloat(el.lithophaneWidth, 100);
  const heightMm = getLithophaneFloat(el.lithophaneHeight, 75);
  const samplesAcross = parseInt(el.lithophaneDetail.value, 10);
  const minThickness = getLithophaneFloat(el.lithophaneMinThickness, 0.8);
  const maxThickness = getLithophaneFloat(el.lithophaneMaxThickness, 3.2);
  const invert = el.lithophaneInvert.checked;

  if (maxThickness <= minThickness) {
    setStatus("Max thickness must be greater than min thickness.");
    return;
  }

  const [samplesW, samplesH] = lithophaneSampleGridSize(widthMm, heightMm, samplesAcross);
  const triCount = estimateLithophaneTriangleCount(samplesW, samplesH);
  if (triCount > LITHOPHANE_MAX_TRIANGLES) {
    setStatus(`That's about ${triCount.toLocaleString()} triangles -- reduce the detail level ` +
      `to bring it under ${LITHOPHANE_MAX_TRIANGLES.toLocaleString()}.`);
    return;
  }

  el.lithophaneGenerateBtn.disabled = true;
  el.lithophaneGenerateBtn.textContent = "Generating...";
  setStatus("Sampling height map, this can take a moment for higher detail...");

  try {
    const heightmap = sampleLithophaneHeightmap(
      state.sourceCanvas, samplesW, samplesH, minThickness, maxThickness, invert);
    const outputCanvas = renderLithophanePreview(
      heightmap, samplesW, samplesH, minThickness, maxThickness, makeCanvas);

    state.lithophaneHeightmap = heightmap;
    state.lithophaneSamplesW = samplesW;
    state.lithophaneSamplesH = samplesH;
    state.lithophaneRenderedWidthMm = widthMm;
    state.lithophaneRenderedHeightMm = heightMm;
    state.palette = null;
    state.colorNames = [];
    state.renderedMode = "lithophane";
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportLithophaneStlBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    updatePhysicalSizeEstimate();
    setStatus(`Done — ${samplesW}×${samplesH} height samples (${widthMm}×${heightMm}mm print).`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.lithophaneGenerateBtn.disabled = false;
    el.lithophaneGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportLithophaneStlBtn.addEventListener("click", exportLithophaneStl);

function exportLithophaneStl() {
  if (!state.lithophaneHeightmap) return;
  const stlBuffer = buildLithophaneStl(state.lithophaneHeightmap, state.lithophaneSamplesW, state.lithophaneSamplesH,
    state.lithophaneRenderedWidthMm, state.lithophaneRenderedHeightMm);
  downloadBlob(new Blob([stlBuffer], { type: "model/stl" }), "lithophane.stl");
  setStatus("Saved lithophane.stl");
}

// ---------------------------------------------------------------------------
// Generate -- Screw Art (a grid of screws driven to varying depths into a
// wood panel; sizes itself in "screws wide/tall" like Rubik's Cube's own
// cube-unit sliders, so Poster export is enabled the same way Rubik's own
// is -- see posterGridCounts, which falls through to the default
// renderedGridW/renderedGridH branch for this mode, same as every non-
// Rubik's grid-based mode.)
// ---------------------------------------------------------------------------

el.screwartGenerateBtn.addEventListener("click", generateScrewartMosaic);

function getScrewartFloat(inputEl, defaultVal) {
  const value = parseFloat(inputEl.value);
  return Number.isFinite(value) && value > 0 ? value : defaultVal;
}

async function generateScrewartMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const screwsWide = parseInt(el.screwsWide.value, 10);
  const screwsTall = parseInt(el.screwsTall.value, 10);
  const cellSize = parseInt(el.cellSize.value, 10);
  const minDepth = getScrewartFloat(el.screwartMinDepth, 0);
  const maxDepth = getScrewartFloat(el.screwartMaxDepth, 12);
  const invert = el.screwartInvert.checked;

  if (maxDepth <= minDepth) {
    setStatus("Max depth must be greater than min depth.");
    return;
  }

  el.screwartGenerateBtn.disabled = true;
  el.screwartGenerateBtn.textContent = "Generating...";
  setStatus("Sampling screw depths, this can take a few seconds for larger grids...");

  try {
    const depthGrid = sampleScrewartDepthGrid(
      state.sourceCanvas, screwsWide, screwsTall, minDepth, maxDepth, invert);
    const outputCanvas = renderScrewartMosaic(
      depthGrid, screwsWide, screwsTall, minDepth, maxDepth, cellSize, makeCanvas);

    state.screwartDepthGrid = depthGrid;
    state.screwartRenderedMinDepthMm = minDepth;
    state.screwartRenderedMaxDepthMm = maxDepth;
    state.palette = null;
    state.colorNames = [];
    state.renderedMode = "screwart";
    state.renderedCellSize = cellSize;
    state.renderedGridW = screwsWide;
    state.renderedGridH = screwsTall;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportScrewartGuideBtn.disabled = false;
    el.previewScrewartGuideBtn.disabled = false;
    el.exportScrewartCsvBtn.disabled = false;
    el.previewScrewartCsvBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${screwsWide}×${screwsTall} screws (${(screwsWide * screwsTall).toLocaleString()} total).`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.screwartGenerateBtn.disabled = false;
    el.screwartGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportScrewartGuideBtn.addEventListener("click", exportScrewartBuildGuide);
el.previewScrewartGuideBtn.addEventListener("click", () => {
  if (!state.screwartDepthGrid) return;
  try {
    const { renderedGridW: screwsWide, renderedGridH: screwsTall, renderedCellSize: cellSize,
      screwartRenderedMinDepthMm: minDepth, screwartRenderedMaxDepthMm: maxDepth } = state;
    const page1 = renderScrewartBuildSheet(state.screwartDepthGrid, screwsWide, screwsTall, cellSize, makeCanvas);
    const page2 = renderScrewartInfoPage(state.screwartDepthGrid, screwsWide, screwsTall, minDepth, maxDepth, makeCanvas);
    openPdfExportPreviewDialog("Preview: Screw Art Build Guide (PDF)", [page1, page2], exportScrewartBuildGuide);
  } catch (err) {
    setStatus(`Error building Screw Art build guide preview: ${err.message}`);
    console.error(err);
  }
});

function exportScrewartBuildGuide() {
  if (!state.screwartDepthGrid) return;
  try {
    const { renderedGridW: screwsWide, renderedGridH: screwsTall, renderedCellSize: cellSize,
      screwartRenderedMinDepthMm: minDepth, screwartRenderedMaxDepthMm: maxDepth } = state;
    const page1 = renderScrewartBuildSheet(state.screwartDepthGrid, screwsWide, screwsTall, cellSize, makeCanvas);
    const page2 = renderScrewartInfoPage(state.screwartDepthGrid, screwsWide, screwsTall, minDepth, maxDepth, makeCanvas);

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [page1.width, page1.height],
      orientation: page1.width >= page1.height ? "landscape" : "portrait",
    });
    doc.addImage(page1.toDataURL("image/png"), "PNG", 0, 0, page1.width, page1.height);
    doc.addPage([page2.width, page2.height], page2.width >= page2.height ? "landscape" : "portrait");
    doc.addImage(page2.toDataURL("image/png"), "PNG", 0, 0, page2.width, page2.height);
    doc.save("screw_art_build_guide.pdf");
    setStatus("Saved screw_art_build_guide.pdf (2 pages)");
  } catch (err) {
    setStatus(`Error building Screw Art build guide PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportScrewartCsvBtn.addEventListener("click", exportScrewartDepthCsv);
el.previewScrewartCsvBtn.addEventListener("click", () => {
  if (!state.screwartDepthGrid) return;
  const csv = buildScrewartDepthCsv(state.screwartDepthGrid, state.renderedGridW, state.renderedGridH);
  openTextExportPreviewDialog("Preview: Screw Art Depth List (CSV)", csv, exportScrewartDepthCsv);
});

function exportScrewartDepthCsv() {
  if (!state.screwartDepthGrid) return;
  const csv = buildScrewartDepthCsv(state.screwartDepthGrid, state.renderedGridW, state.renderedGridH);
  downloadText(csv, "screw_art_depth_list.csv", "text/csv");
  setStatus("Saved screw_art_depth_list.csv");
}

// ---------------------------------------------------------------------------
// Generate -- String Art (pins around a circular/rectangular frame,
// connected by one continuous thread; the greedy sequencing loop runs in
// the worker to keep the tab responsive at higher pin/line counts)
// ---------------------------------------------------------------------------

el.stringartGenerateBtn.addEventListener("click", generateStringartMosaic);

async function generateStringartMosaic() {
  if (!state.sourceCanvas) { setStatus("Load an image first."); return; }

  const shape = [...el.stringartShapeSeg.children].find(b => b.classList.contains("active")).dataset.shape;
  const numPins = parseInt(el.stringartPins.value, 10);
  const numLines = parseInt(el.stringartLines.value, 10);
  const frameSize = parseFloat(el.stringartFrameSize.value) || 0;
  const frameSizeUnit = el.stringartFrameSizeUnit.value;
  const threadColor = state.stringartThreadColor;
  const bgColor = state.stringartBgColor;

  el.stringartGenerateBtn.disabled = true;
  el.stringartGenerateBtn.textContent = "Generating...";
  setStatus("Stringing the thread path, this can take a few seconds for higher pin/line counts...");

  try {
    const target = sampleStringartTarget(state.sourceCanvas);
    const { sequence, canvas } = await callWorker("stringart", { target, shape, numPins, numLines });
    const positions = stringartPinPositions(shape, numPins);
    const outputCanvas = renderStringartPreview(
      canvas, shape, STRINGART_WORKING_SIZE, threadColor, bgColor, makeCanvas);
    const threadLength = estimateStringartThreadLength(sequence, positions, frameSize);

    state.stringartSequence = sequence;
    state.stringartCanvas = canvas;
    state.stringartPositions = positions;
    state.stringartShape = shape;
    state.stringartNumPins = numPins;
    state.stringartFrameSize = frameSize;
    state.stringartFrameSizeUnit = frameSizeUnit;
    state.stringartThreadLength = threadLength;
    state.palette = null;
    state.colorNames = [];
    state.renderedMode = "stringart";
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportStringartGuideBtn.disabled = false;
    el.previewStringartGuideBtn.disabled = false;
    el.exportStringartSequenceBtn.disabled = false;
    el.previewStringartSequenceBtn.disabled = false;
    el.exportStringartShoppingBtn.disabled = false;
    el.previewStringartShoppingBtn.disabled = false;
    // Poster export is left alone (not enabled) -- its real-world scale is
    // derived from the shared Piece Size field, which has no meaning for
    // String Art's own frame-size field, same reasoning as Lithophane.
    clearBrickLayout();

    setViewMode("output");
    updatePhysicalSizeEstimate();
    setStatus(`Done — ${sequence.length - 1} thread lines across ${numPins} pins.`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.stringartGenerateBtn.disabled = false;
    el.stringartGenerateBtn.textContent = "Generate Mosaic";
  }
}

/** Builds the Build Guide's pages (pin map + as many wrapped thread-
 * sequence pages as needed) -- shared by the preview dialog and the real
 * Save so both render byte-for-byte the same pages, mirroring
 * mosaic_core.py's export_stringart_build_guide_pdf exactly. */
function buildStringartGuidePages() {
  const entriesPerPage = 400;
  const pages = [renderStringartPinMap(state.stringartPositions, state.stringartShape, makeCanvas,
    { threadColor: state.stringartThreadColor })];
  const total = state.stringartSequence.length;
  const nPages = Math.ceil(total / entriesPerPage);
  for (let p = 0; p < nPages; p++) {
    const start = p * entriesPerPage;
    const end = Math.min(total, start + entriesPerPage);
    const label = `Thread sequence, steps ${start}-${end - 1} of ${total - 1} (page ${p + 1} of ${nPages})`;
    pages.push(renderStringartSequencePage(state.stringartSequence, start, end, label, makeCanvas));
  }
  return pages;
}

el.exportStringartGuideBtn.addEventListener("click", exportStringartGuide);
el.previewStringartGuideBtn.addEventListener("click", () => {
  if (!state.stringartSequence) return;
  try {
    openPdfExportPreviewDialog("Preview: String Art Build Guide (PDF)", buildStringartGuidePages(),
      exportStringartGuide);
  } catch (err) {
    setStatus(`Error building string art build guide preview: ${err.message}`);
    console.error(err);
  }
});

function exportStringartGuide() {
  if (!state.stringartSequence) return;
  try {
    const pages = buildStringartGuidePages();
    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [pages[0].width, pages[0].height],
      orientation: pages[0].width >= pages[0].height ? "landscape" : "portrait",
    });
    doc.addImage(pages[0].toDataURL("image/png"), "PNG", 0, 0, pages[0].width, pages[0].height);
    for (let i = 1; i < pages.length; i++) {
      doc.addPage([pages[i].width, pages[i].height], pages[i].width >= pages[i].height ? "landscape" : "portrait");
      doc.addImage(pages[i].toDataURL("image/png"), "PNG", 0, 0, pages[i].width, pages[i].height);
    }
    doc.save("stringart_build_guide.pdf");
    setStatus(`Saved stringart_build_guide.pdf (${pages.length} pages)`);
  } catch (err) {
    setStatus(`Error building string art build guide PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportStringartSequenceBtn.addEventListener("click", exportStringartSequence);
el.previewStringartSequenceBtn.addEventListener("click", () => {
  if (!state.stringartSequence) return;
  const json = buildStringartSequenceJson(state.stringartSequence, state.stringartPositions, state.stringartShape,
    state.stringartNumPins, state.stringartFrameSize, state.stringartFrameSizeUnit,
    state.stringartThreadLength, { sourceName: state.sourceFileName });
  openTextExportPreviewDialog("Preview: Pin Sequence (JSON)", json, exportStringartSequence);
});

function exportStringartSequence() {
  if (!state.stringartSequence) return;
  const json = buildStringartSequenceJson(state.stringartSequence, state.stringartPositions, state.stringartShape,
    state.stringartNumPins, state.stringartFrameSize, state.stringartFrameSizeUnit,
    state.stringartThreadLength, { sourceName: state.sourceFileName });
  downloadText(json, "stringart_sequence.json", "application/json");
  setStatus("Saved stringart_sequence.json");
}

el.exportStringartShoppingBtn.addEventListener("click", exportStringartShoppingList);
el.previewStringartShoppingBtn.addEventListener("click", () => {
  if (!state.stringartSequence) return;
  const csv = buildStringartShoppingListCsv(state.stringartNumPins, state.stringartThreadLength,
    state.stringartFrameSizeUnit, getPrice(el.stringartPrice));
  openTextExportPreviewDialog("Preview: String Art Shopping List (CSV)", csv, exportStringartShoppingList);
});

function exportStringartShoppingList() {
  if (!state.stringartSequence) return;
  const csv = buildStringartShoppingListCsv(state.stringartNumPins, state.stringartThreadLength,
    state.stringartFrameSizeUnit, getPrice(el.stringartPrice));
  downloadText(csv, "stringart_shopping_list.csv", "text/csv");
  setStatus("Saved stringart_shopping_list.csv");
}

el.exportStainedglassShoppingBtn.addEventListener("click", exportStainedglassShoppingList);
el.previewStainedglassShoppingBtn.addEventListener("click", () => {
  if (!state.stainedglassQuantized) return;
  openTextExportPreviewDialog("Preview: Color Shopping List (CSV)",
    buildPaletteCsv(state.stainedglassQuantized, state.palette, state.colorNames, getPrice(el.stainedglassPrice)),
    exportStainedglassShoppingList);
});

function exportStainedglassShoppingList() {
  if (!state.stainedglassQuantized) return;
  const csv = buildPaletteCsv(state.stainedglassQuantized, state.palette, state.colorNames, getPrice(el.stainedglassPrice));
  downloadText(csv, "stainedglass_shopping_list.csv", "text/csv");
  setStatus("Saved stainedglass_shopping_list.csv");
}

el.exportLeadedglassShoppingBtn.addEventListener("click", exportLeadedglassShoppingList);
el.previewLeadedglassShoppingBtn.addEventListener("click", () => {
  if (!state.leadedglassQuantized) return;
  openTextExportPreviewDialog("Preview: Color Shopping List (CSV)",
    buildPaletteCsv(state.leadedglassQuantized, state.palette, state.colorNames, getPrice(el.leadedglassPrice)),
    exportLeadedglassShoppingList);
});

function exportLeadedglassShoppingList() {
  if (!state.leadedglassQuantized) return;
  const csv = buildPaletteCsv(state.leadedglassQuantized, state.palette, state.colorNames, getPrice(el.leadedglassPrice));
  downloadText(csv, "leadedglass_shopping_list.csv", "text/csv");
  setStatus("Saved leadedglass_shopping_list.csv");
}

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
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportDiceGuideBtn.disabled = false;
    el.previewDiceGuideBtn.disabled = false;
    el.exportDiceShoppingBtn.disabled = false;
    el.previewDiceShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${gridW * gridH} dice, ${gridW}×${gridH} grid.`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.diceGenerateBtn.disabled = false;
    el.diceGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportDiceGuideBtn.addEventListener("click", exportDiceBuildGuide);
el.previewDiceGuideBtn.addEventListener("click", () => {
  if (!state.dicePipGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
    const page1 = renderDiceMosaic(state.dicePipGrid, gridW, gridH, cellSize,
      [255, 255, 255], [20, 20, 20], [255, 255, 255], makeCanvas,
      { outlineColor: [150, 150, 150] });
    const page2 = renderDiceKey(state.dicePipGrid, [255, 255, 255], [20, 20, 20], makeCanvas);
    openPdfExportPreviewDialog("Preview: Dice Build Guide (PDF)", [page1, page2], exportDiceBuildGuide);
  } catch (err) {
    setStatus(`Error building dice build guide preview: ${err.message}`);
    console.error(err);
  }
});

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

el.exportDiceShoppingBtn.addEventListener("click", exportDiceShoppingList);
el.previewDiceShoppingBtn.addEventListener("click", () => {
  if (!state.dicePipGrid) return;
  openTextExportPreviewDialog("Preview: Dice Shopping List (CSV)",
    buildDiceShoppingListCsv(state.dicePipGrid, getPrice(el.dicePrice)), exportDiceShoppingList);
});

function exportDiceShoppingList() {
  if (!state.dicePipGrid) return;
  downloadText(buildDiceShoppingListCsv(state.dicePipGrid, getPrice(el.dicePrice)), "dice_shopping_list.csv", "text/csv");
  setStatus("Saved dice_shopping_list.csv");
}

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
  const colorMode = state.rubiksColorMode;
  // includeBlack only applies to "nearest" -- force it off for "ramp"
  // regardless of the (possibly stale/hidden) checkbox value, so the two
  // options can never silently combine.
  const includeBlack = colorMode === "nearest" ? el.rubiksIncludeBlack.checked : false;

  el.rubiksGenerateBtn.disabled = true;
  el.rubiksGenerateBtn.textContent = "Generating...";
  setStatus("Matching to cube colors, this can take a few seconds for larger grids...");

  try {
    const grid = imageToGrid(state.sourceCanvas, gridW, gridH);
    let quantizedFlat, activePalette;
    if (colorMode === "ramp") {
      activePalette = RUBIKS_LUMA_ORDER.map(c => c.rgb);
      quantizedFlat = quantizeGridLumaRanked(grid, RUBIKS_LUMA_ORDER);
    } else {
      ({ palette: activePalette } = rubiksActivePalette(includeBlack));
      const result = await callWorker("quantize-fixed", { points: grid, palette: activePalette });
      quantizedFlat = Array.from(result.labels).map(l => activePalette[l]);
    }
    const outputCanvas = renderRubiksMosaic(quantizedFlat, gridW, gridH, cellSize, makeCanvas,
      { bgColor: state.bgColor });

    state.rubiksBaseGrid = quantizedFlat;
    state.rubiksColorMap = {};
    state.rubiksGrid = quantizedFlat;
    state.rubiksPalette = activePalette;
    state.rubiksIncludeBlack = includeBlack;
    state.rubiksColorMode = colorMode;
    state.renderedMode = "rubiks";
    state.renderedCellSize = cellSize;
    state.renderedGridW = gridW;
    state.renderedGridH = gridH;
    state.outputCanvas = outputCanvas;
    resetSampleDisplay();

    el.exportPngBtn.disabled = false;
    el.exportPreviewBtn.disabled = false;
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportRubiksGuideBtn.disabled = false;
    el.previewRubiksGuideBtn.disabled = false;
    el.exportRubiksShoppingBtn.disabled = false;
    el.previewRubiksShoppingBtn.disabled = false;
    el.rubiksRecolorBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${rubiksCubeCount(gridW, gridH)} cubes, ${cubesWide}×${cubesTall} cubes (${gridW}×${gridH} grid).`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.rubiksGenerateBtn.disabled = false;
    el.rubiksGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportRubiksGuideBtn.addEventListener("click", exportRubiksBuildGuide);
el.previewRubiksGuideBtn.addEventListener("click", () => {
  if (!state.rubiksGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
    const page1 = renderRubiksBuildSheet(state.rubiksGrid, gridW, gridH, cellSize, makeCanvas);
    const page2 = renderRubiksKey(state.rubiksGrid, state.rubiksPalette, gridW, gridH, makeCanvas);
    openPdfExportPreviewDialog("Preview: Cube Build Guide (PDF)", [page1, page2], exportRubiksBuildGuide);
  } catch (err) {
    setStatus(`Error building Rubik's Cube build guide preview: ${err.message}`);
    console.error(err);
  }
});

function exportRubiksBuildGuide() {
  if (!state.rubiksGrid) return;
  try {
    const { renderedGridW: gridW, renderedGridH: gridH, renderedCellSize: cellSize } = state;
    const page1 = renderRubiksBuildSheet(state.rubiksGrid, gridW, gridH, cellSize, makeCanvas);
    const page2 = renderRubiksKey(state.rubiksGrid, state.rubiksPalette, gridW, gridH, makeCanvas);

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

el.exportRubiksShoppingBtn.addEventListener("click", exportRubiksShoppingList);
el.previewRubiksShoppingBtn.addEventListener("click", () => {
  if (!state.rubiksGrid) return;
  const csv = buildRubiksShoppingListCsv(state.rubiksGrid, state.rubiksPalette, state.renderedGridW, state.renderedGridH,
    getPrice(el.rubiksPrice));
  openTextExportPreviewDialog("Preview: Cube Shopping List (CSV)", csv, exportRubiksShoppingList);
});

function exportRubiksShoppingList() {
  if (!state.rubiksGrid) return;
  const csv = buildRubiksShoppingListCsv(state.rubiksGrid, state.rubiksPalette, state.renderedGridW, state.renderedGridH,
    getPrice(el.rubiksPrice));
  downloadText(csv, "rubiks_cube_shopping_list.csv", "text/csv");
  setStatus("Saved rubiks_cube_shopping_list.csv");
}

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

  // Offer the cube-body "black" tile as a 7th row/destination only when
  // the last Generate actually used it (see state.rubiksIncludeBlack) --
  // otherwise the grid has no black cells to remap and offering it as a
  // destination would just be a confusing dead end.
  const colors = state.rubiksIncludeBlack
    ? [...RUBIKS_CUBE_COLORS, { name: RUBIKS_BLACK_NAME, rgb: RUBIKS_BLACK_RGB }]
    : RUBIKS_CUBE_COLORS;

  for (const { name, rgb } of colors) {
    const row = document.createElement("div");
    row.className = "swatch-row";

    const swatch = document.createElement("div");
    swatch.className = "mini-swatch";
    swatch.style.background = rgbToHex(rgb);
    swatch.style.cursor = "default";

    const label = document.createElement("span");
    label.className = "recolor-label";
    // "Black (cube body)" is too long for this narrow label -- show plain
    // "Black" here (the full name still appears in the dropdown options
    // below, and is still the real key used in state.rubiksColorMap).
    label.textContent = name === RUBIKS_BLACK_NAME ? "Black" : name;

    const select = document.createElement("select");
    for (const opt of colors) {
      const optionEl = document.createElement("option");
      optionEl.value = opt.name;
      optionEl.textContent = opt.name;
      select.appendChild(optionEl);
    }
    const currentRgb = state.rubiksColorMap[name] || rgb;
    const currentMatch = colors.find(c => rgbToHex(c.rgb) === rgbToHex(currentRgb));
    select.value = currentMatch ? currentMatch.name : name;
    select.addEventListener("change", () => {
      const chosen = colors.find(c => c.name === select.value);
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
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${gridW}×${gridH} grid, ${cellSize}px cells.`);
    await snapshotRecentProject();
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
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.exportCrossStitchPatternBtn.disabled = false;
    el.previewCrossStitchPatternBtn.disabled = false;
    el.exportCrossStitchShoppingBtn.disabled = false;
    el.previewCrossStitchShoppingBtn.disabled = false;
    clearBrickLayout();

    setViewMode("output");
    const used = dmcColorCounts(quantizedFlat).filter(c => c.count > 0).length;
    setStatus(`Done — ${used} DMC colors, ${gridW}×${gridH} grid.`);
    await snapshotRecentProject();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    el.crossstitchGenerateBtn.disabled = false;
    el.crossstitchGenerateBtn.textContent = "Generate Mosaic";
  }
}

el.exportCrossStitchPatternBtn.addEventListener("click", exportCrossStitchPattern);
el.previewCrossStitchPatternBtn.addEventListener("click", () => {
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

    openPdfExportPreviewDialog("Preview: Pattern Chart (PDF)", pages, exportCrossStitchPattern);
  } catch (err) {
    setStatus(`Error building cross-stitch pattern preview: ${err.message}`);
    console.error(err);
  }
});

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

el.exportCrossStitchShoppingBtn.addEventListener("click", exportCrossStitchShoppingList);
el.previewCrossStitchShoppingBtn.addEventListener("click", () => {
  if (!state.crossStitchGrid) return;
  openTextExportPreviewDialog("Preview: Floss Shopping List (CSV)",
    buildCrossStitchShoppingListCsv(state.crossStitchGrid, getPrice(el.crossstitchPrice)), exportCrossStitchShoppingList);
});

function exportCrossStitchShoppingList() {
  if (!state.crossStitchGrid) return;
  downloadText(buildCrossStitchShoppingListCsv(state.crossStitchGrid, getPrice(el.crossstitchPrice)),
    "cross_stitch_shopping_list.csv", "text/csv");
  setStatus("Saved cross_stitch_shopping_list.csv");
}

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
    el.exportPosterBtn.disabled = false;
    el.previewPosterBtn.disabled = false;
    el.foundObjectLibraryBtn.disabled = false;
    el.exportFoundObjectJsonBtn.disabled = false;
    el.previewFoundObjectJsonBtn.disabled = false;
    el.exportFoundObjectCsvBtn.disabled = false;
    el.previewFoundObjectCsvBtn.disabled = false;
    el.exportFoundObjectPdfBtn.disabled = false;
    el.previewFoundObjectPdfBtn.disabled = false;
    updateFoundObjectSummary();
    clearBrickLayout();

    setViewMode("output");
    setStatus(`Done — ${palette.length} colors, ${gridW}×${gridH} grid. Assign photos to colors below.`);
    await snapshotRecentProject();
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
// Found Object exports -- JSON/CSV/PDF, same shape as Classic mode's (see
// exportJson/exportCsv/exportPaintByNumber above) but reporting each
// color's assigned found-object photo filename via foundObjectColorNames()
// instead of a hand-typed paint nickname. Found Object mode always renders
// a plain square grid (no shape selector, no interlock), so "square" is
// hardcoded wherever these functions need a shape.
// ---------------------------------------------------------------------------

/** An array parallel to state.foundObjectPalette, giving each color's
 * assigned found-object photo filename (or "" if that color has no photo
 * assigned) -- the same shape buildGridJson/buildGridCsv/renderColorKey
 * already expect for `names` (a plain array of paint nicknames in Classic
 * mode), so Found Object mode's exports can reuse those functions
 * unmodified and get each color's photo filename in place of a paint
 * name. */
function foundObjectColorNames() {
  if (!state.foundObjectPalette) return [];
  return state.foundObjectPalette.map(rgb => state.foundObjectImageNames.get(rgb.join(",")) || "");
}

el.exportFoundObjectJsonBtn.addEventListener("click", exportFoundObjectJson);
el.previewFoundObjectJsonBtn.addEventListener("click", () => {
  if (!state.foundObjectQuantizedGrid) return;
  const json = buildGridJson(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
    state.foundObjectPalette, "square",
    { sourceName: state.sourceFileName, names: foundObjectColorNames(), extraMeta: { mode: "found_object" } });
  openTextExportPreviewDialog("Preview: Object Data (JSON)", json, exportFoundObjectJson);
});

function exportFoundObjectJson() {
  if (!state.foundObjectQuantizedGrid) return;
  const json = buildGridJson(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
    state.foundObjectPalette, "square",
    { sourceName: state.sourceFileName, names: foundObjectColorNames(), extraMeta: { mode: "found_object" } });
  downloadText(json, "found_object_data.json", "application/json");
  setStatus("Saved found_object_data.json");
}

el.exportFoundObjectCsvBtn.addEventListener("click", exportFoundObjectCsv);
el.previewFoundObjectCsvBtn.addEventListener("click", () => {
  if (!state.foundObjectQuantizedGrid) return;
  const names = foundObjectColorNames();
  const gridCsv = buildGridCsv(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
    state.foundObjectPalette, names);
  const colorsCsv = buildPaletteCsv(state.foundObjectQuantizedGrid, state.foundObjectPalette, names,
    getPrice(el.foundobjectPrice));
  const content = `--- found_object_data.csv (per-cell grid) ---\n${gridCsv}\n`
    + `--- found_object_data_colors.csv (object totals) ---\n${colorsCsv}`;
  openTextExportPreviewDialog("Preview: Object Data (CSV)", content, exportFoundObjectCsv);
});

function exportFoundObjectCsv() {
  if (!state.foundObjectQuantizedGrid) return;
  const names = foundObjectColorNames();
  downloadText(buildGridCsv(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
    state.foundObjectPalette, names), "found_object_data.csv", "text/csv");
  downloadText(buildPaletteCsv(state.foundObjectQuantizedGrid, state.foundObjectPalette, names,
    getPrice(el.foundobjectPrice)), "found_object_data_colors.csv", "text/csv");
  setStatus("Saved found_object_data.csv and found_object_data_colors.csv");
}

el.exportFoundObjectPdfBtn.addEventListener("click", exportFoundObjectPdf);
el.previewFoundObjectPdfBtn.addEventListener("click", () => {
  if (!state.foundObjectQuantizedGrid) return;
  try {
    const page1 = renderPaintByNumber(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
      state.foundObjectPalette, "square", state.renderedCellSize, makeCanvas);
    const names = foundObjectColorNames();
    const counts = colorCounts(state.foundObjectQuantizedGrid, state.foundObjectPalette, names);
    const page2 = renderColorKey(state.foundObjectPalette, names, counts, makeCanvas);
    openPdfExportPreviewDialog("Preview: Build Guide (PDF)", [page1, page2], exportFoundObjectPdf);
  } catch (err) {
    setStatus(`Error building object build guide preview: ${err.message}`);
    console.error(err);
  }
});

function exportFoundObjectPdf() {
  if (!state.foundObjectQuantizedGrid) return;
  try {
    const page1 = renderPaintByNumber(state.foundObjectQuantizedGrid, state.gridW, state.gridH,
      state.foundObjectPalette, "square", state.renderedCellSize, makeCanvas);
    const names = foundObjectColorNames();
    const counts = colorCounts(state.foundObjectQuantizedGrid, state.foundObjectPalette, names);
    const page2 = renderColorKey(state.foundObjectPalette, names, counts, makeCanvas);

    const doc = new jspdf.jsPDF({
      unit: "px",
      format: [page1.width, page1.height],
      orientation: page1.width >= page1.height ? "landscape" : "portrait",
    });
    doc.addImage(page1.toDataURL("image/png"), "PNG", 0, 0, page1.width, page1.height);
    doc.addPage([page2.width, page2.height], page2.width >= page2.height ? "landscape" : "portrait");
    doc.addImage(page2.toDataURL("image/png"), "PNG", 0, 0, page2.width, page2.height);
    doc.save("found_object_build_guide.pdf");
    setStatus("Saved found_object_build_guide.pdf (2 pages)");
  } catch (err) {
    setStatus(`Error building object build guide PDF: ${err.message}`);
    console.error(err);
  }
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
    { circleInterlock: state.renderedCircleInterlock,
      diamondInterlock: state.renderedDiamondInterlock });
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
  btnRow.style.flexWrap = "wrap";
  btnRow.style.gap = "8px";
  btnRow.style.marginBottom = "10px";
  const legoBtn = document.createElement("button");
  legoBtn.type = "button"; legoBtn.textContent = "LEGO";
  const perlerBtn = document.createElement("button");
  perlerBtn.type = "button"; perlerBtn.textContent = "Perler";
  const hamaBtn = document.createElement("button");
  hamaBtn.type = "button"; hamaBtn.textContent = "Hama";
  const artkalBtn = document.createElement("button");
  artkalBtn.type = "button"; artkalBtn.textContent = "Artkal";
  const importBtn = document.createElement("button");
  importBtn.type = "button"; importBtn.textContent = "Import from File...";
  const importInput = document.createElement("input");
  importInput.type = "file"; importInput.accept = ".csv,.json"; importInput.hidden = true;
  btnRow.append(legoBtn, perlerBtn, hamaBtn, artkalBtn, importBtn);

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
  perlerBtn.addEventListener("click", () =>
    renderPreview(PERLER_BEAD_COLORS.map(c => ({ name: c.name, rgb: c.rgb })),
                  `Perler Beads (${PERLER_BEAD_COLORS.length} colors)`));
  hamaBtn.addEventListener("click", () =>
    renderPreview(HAMA_BEAD_COLORS.map(c => ({ name: c.name, rgb: c.rgb })),
                  `Hama Beads (${HAMA_BEAD_COLORS.length} colors)`));
  artkalBtn.addEventListener("click", () =>
    renderPreview(ARTKAL_BEAD_COLORS.map(c => ({ name: c.name, rgb: c.rgb })),
                  `Artkal Beads (${ARTKAL_BEAD_COLORS.length} colors)`));
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
    desc: "Constrain colors to a fixed palette. Each cell is matched to the nearest color in the list below (perceptual match, not just closest RGB). Good for real materials with a fixed color set \u2014 LEGO, fuse beads, a specific paint line.",
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
    el.previewBricksJsonBtn.disabled = false;
    el.exportBricksCsvBtn.disabled = false;
    el.previewBricksCsvBtn.disabled = false;
    el.exportShoppingListBtn.disabled = false;
    el.previewShoppingListBtn.disabled = false;

    closeDialog();
    setViewMode("bricks");
    setStatus(`Brick layout ready \u2014 ${bricks.length} pieces (was ${totalCells} cells).`);
  } catch (err) {
    statusP.textContent = `Error: ${err.message}`;
    buttons[0].disabled = false;
    buttons[0].textContent = "Compute Brick Layout";
  }
}

el.exportBricksJsonBtn.addEventListener("click", exportBricksJson);
el.previewBricksJsonBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  const json = buildBricksJson(state.brickLayout, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  openTextExportPreviewDialog("Preview: Brick List (JSON)", json, exportBricksJson);
});

function exportBricksJson() {
  if (!state.brickLayout) return;
  const json = buildBricksJson(state.brickLayout, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  downloadText(json, "bricks.json", "application/json");
  setStatus("Saved bricks.json");
}

el.exportBricksCsvBtn.addEventListener("click", exportBricksCsv);
el.previewBricksCsvBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  openTextExportPreviewDialog("Preview: Brick List (CSV)",
    buildBricksCsv(state.brickLayout, state.palette, state.colorNames), exportBricksCsv);
});

function exportBricksCsv() {
  if (!state.brickLayout) return;
  downloadText(buildBricksCsv(state.brickLayout, state.palette, state.colorNames), "bricks.csv", "text/csv");
  setStatus("Saved bricks.csv");
}

el.exportShoppingListBtn.addEventListener("click", exportBricksShoppingList);
el.previewShoppingListBtn.addEventListener("click", () => {
  if (!state.brickLayout) return;
  openTextExportPreviewDialog("Preview: Shopping List (CSV)",
    buildShoppingListCsv(state.brickLayout, state.palette, state.colorNames, getPrice(el.brickPrice)),
    exportBricksShoppingList);
});

function exportBricksShoppingList() {
  if (!state.brickLayout) return;
  downloadText(buildShoppingListCsv(state.brickLayout, state.palette, state.colorNames, getPrice(el.brickPrice)),
    "shopping_list.csv", "text/csv");
  setStatus("Saved shopping_list.csv");
}

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

// ---------------------------------------------------------------------------
// Poster / multi-page print export -- shared by every layout mode, tiles
// the current output across several sheets of ordinary paper at the DPI
// implied by the Piece Size setting (see core/poster.js's renderPosterPages
// for the full reasoning: no separate scale/DPI input, the poster is
// always WYSIWYG with the on-screen output).
// ---------------------------------------------------------------------------

/** [gridW, gridH] in the same "piece" units updatePhysicalSizeEstimate uses
 * for the Piece Size feature -- whole cubes for Rubik's Cube, grid cells
 * for every other mode -- based on what was actually rendered
 * (state.renderedMode/renderedGridW/renderedGridH), not whatever the
 * mode/grid controls currently show (which may have changed since the
 * last Generate). */
function posterGridCounts() {
  if (state.renderedMode === "rubiks") {
    return [state.renderedGridW / 3, state.renderedGridH / 3];
  }
  return [state.renderedGridW, state.renderedGridH];
}

/** Shared by previewPoster/exportPoster: builds the poster's pages from
 * the current output and settings. Returns { pages, cols, rows, dpi }, or
 * null (with a friendly status message already set) if a poster can't be
 * built right now -- no output yet, no piece size set, or settings that
 * imply an unworkable page count/DPI. */
function buildPosterPages() {
  if (!state.outputCanvas) return null;
  const pieceSize = parseFloat(el.pieceSize.value) || 0;
  if (!(pieceSize > 0)) {
    setStatus("Set a piece size above before making a poster.");
    return null;
  }
  const unit = el.pieceSizeUnit.value;
  const paperSize = el.posterPaper.value;
  const [gridW, gridH] = posterGridCounts();
  try {
    return renderPosterPages(state.outputCanvas, gridW, gridH, pieceSize, unit, paperSize, makeCanvas);
  } catch (err) {
    setStatus(err.message);
    return null;
  }
}

function exportPoster() {
  const result = buildPosterPages();
  if (!result) return;
  const { pages, cols, rows, dpi } = result;
  const paperSize = el.posterPaper.value;
  const [paperWIn, paperHIn] = POSTER_PAPER_SIZES[paperSize] || POSTER_PAPER_SIZES.Letter;
  try {
    const doc = new jspdf.jsPDF({ unit: "in", format: [paperWIn, paperHIn], orientation: "portrait" });
    pages.forEach((page, i) => {
      if (i > 0) doc.addPage([paperWIn, paperHIn], "portrait");
      doc.addImage(page.toDataURL("image/png"), "PNG", 0, 0, paperWIn, paperHIn);
    });
    doc.save("mosaic_poster.pdf");
    setStatus(`Saved mosaic_poster.pdf (${cols * rows} pages, ${cols}×${rows}, ${paperSize}, ${Math.round(dpi)} DPI)`);
  } catch (err) {
    setStatus(`Error building poster PDF: ${err.message}`);
    console.error(err);
  }
}

el.exportPosterBtn.addEventListener("click", exportPoster);
el.previewPosterBtn.addEventListener("click", () => {
  const result = buildPosterPages();
  if (!result) return;
  const { pages, cols, rows } = result;
  openPdfExportPreviewDialog(`Preview: Poster (${cols * rows} pages, ${cols} × ${rows})`, pages, exportPoster);
});

// Generic text (CSV/JSON) export preview: shows exactly the text a Save
// button would write, with the same Save action available right there --
// mirrors openExportPreviewDialog's image pattern for text output.
function openTextExportPreviewDialog(title, content, onSave) {
  const body = document.createElement("div");
  const pre = document.createElement("pre");
  pre.className = "export-preview-text";
  pre.textContent = content;
  body.appendChild(pre);

  showDialog({
    title,
    bodyEl: body,
    wide: true,
    actions: [
      { label: "Close", onClick: closeDialog },
      { label: "Save...", primary: true, onClick: () => { onSave(); closeDialog(); } },
    ],
  });
}

// Generic PDF-pages export preview: `pages` is an array of already-rendered
// canvases (the same render calls the real export makes, so what's shown is
// byte-for-byte what Save would produce), with Prev/Next paging for
// multi-page guides and the same Save action as the real export button.
function openPdfExportPreviewDialog(title, pages, onSave) {
  const body = document.createElement("div");
  body.className = "export-preview-pages";
  const img = document.createElement("img");
  img.className = "export-preview-img";
  img.alt = `${title} preview`;
  body.appendChild(img);

  let pageIdx = 0;
  let nav = null, label = null, prevBtn = null, nextBtn = null;
  if (pages.length > 1) {
    nav = document.createElement("div");
    nav.className = "export-preview-page-nav";
    prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "< Prev";
    label = document.createElement("span");
    nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "Next >";
    nav.append(prevBtn, label, nextBtn);
    body.appendChild(nav);
  }

  function showPage(i) {
    pageIdx = i;
    img.src = pages[i].toDataURL("image/png");
    if (label) label.textContent = `Page ${i + 1} of ${pages.length}`;
    if (prevBtn) prevBtn.disabled = i === 0;
    if (nextBtn) nextBtn.disabled = i === pages.length - 1;
  }
  if (prevBtn) prevBtn.addEventListener("click", () => showPage(Math.max(0, pageIdx - 1)));
  if (nextBtn) nextBtn.addEventListener("click", () => showPage(Math.min(pages.length - 1, pageIdx + 1)));
  showPage(0);

  showDialog({
    title,
    bodyEl: body,
    wide: true,
    actions: [
      { label: "Close", onClick: closeDialog },
      { label: "Save PDF...", primary: true, onClick: () => { onSave(); closeDialog(); } },
    ],
  });
}

el.exportJsonBtn.addEventListener("click", exportJson);
el.previewJsonBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  const json = buildGridJson(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  openTextExportPreviewDialog("Preview: Grid Data (JSON)", json, exportJson);
});

function exportJson() {
  if (!state.quantizedGrid) return;
  const json = buildGridJson(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.renderedShape,
    { sourceName: state.sourceFileName, names: state.colorNames });
  downloadText(json, "mosaic.json", "application/json");
  setStatus("Saved mosaic.json");
}

el.exportCsvBtn.addEventListener("click", exportCsv);
el.previewCsvBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  const gridCsv = buildGridCsv(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.colorNames);
  const colorsCsv = buildPaletteCsv(state.quantizedGrid, state.palette, state.colorNames, getPrice(el.classicPrice));
  const content = `--- mosaic.csv (per-cell grid) ---\n${gridCsv}\n`
    + `--- mosaic_colors.csv (color totals) ---\n${colorsCsv}`;
  openTextExportPreviewDialog("Preview: Grid Data (CSV)", content, exportCsv);
});

function exportCsv() {
  if (!state.quantizedGrid) return;
  downloadText(buildGridCsv(state.quantizedGrid, state.gridW, state.gridH, state.palette, state.colorNames),
    "mosaic.csv", "text/csv");
  downloadText(buildPaletteCsv(state.quantizedGrid, state.palette, state.colorNames, getPrice(el.classicPrice)),
    "mosaic_colors.csv", "text/csv");
  setStatus("Saved mosaic.csv and mosaic_colors.csv");
}

el.exportPaintByNumberBtn.addEventListener("click", exportPaintByNumber);
el.previewPaintByNumberBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  try {
    const page1 = renderPaintByNumber(state.quantizedGrid, state.gridW, state.gridH,
      state.palette, state.renderedShape, state.renderedCellSize, makeCanvas,
      { circleInterlock: state.renderedCircleInterlock, diamondInterlock: state.renderedDiamondInterlock });
    const counts = colorCounts(state.quantizedGrid, state.palette, state.colorNames);
    const page2 = renderColorKey(state.palette, state.colorNames, counts, makeCanvas);
    openPdfExportPreviewDialog("Preview: Paint-by-Number (PDF)", [page1, page2], exportPaintByNumber);
  } catch (err) {
    setStatus(`Error building paint-by-number preview: ${err.message}`);
    console.error(err);
  }
});

function exportPaintByNumber() {
  if (!state.quantizedGrid) return;
  try {
    const page1 = renderPaintByNumber(state.quantizedGrid, state.gridW, state.gridH,
      state.palette, state.renderedShape, state.renderedCellSize, makeCanvas,
      { circleInterlock: state.renderedCircleInterlock, diamondInterlock: state.renderedDiamondInterlock });
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

// Color-separated SVG -- one <g> layer per palette color actually used
// (see core/svgExport.js's buildColorSeparatedSvg for the full reasoning:
// a vector export for opening in Illustrator/Inkscape/a cutter's software
// and working with a single color's cells at a time).
function buildSvgForCurrentGrid() {
  return buildColorSeparatedSvg(
    state.quantizedGrid, state.gridW, state.gridH, state.palette, state.renderedShape,
    state.renderedCellSize,
    {
      names: state.colorNames, circleInterlock: state.renderedCircleInterlock,
      diamondInterlock: state.renderedDiamondInterlock, bgColor: state.bgColor,
    });
}

el.exportSvgBtn.addEventListener("click", exportColorSvg);
el.previewSvgBtn.addEventListener("click", () => {
  if (!state.quantizedGrid) return;
  const { svg } = buildSvgForCurrentGrid();
  openTextExportPreviewDialog("Preview: Color-Separated (SVG)", svg, exportColorSvg);
});

function exportColorSvg() {
  if (!state.quantizedGrid) return;
  const { svg, layerCount } = buildSvgForCurrentGrid();
  downloadText(svg, "mosaic_colors.svg", "image/svg+xml");
  setStatus(`Saved mosaic_colors.svg (${layerCount} color layers)`);
}

// ---------------------------------------------------------------------------
// Recent Projects -- snapshot the loaded photo + current settings + a
// thumbnail of the just-rendered output after every successful generate, so
// it can be reopened later from the Recent Projects dialog. See
// js/core/recentProjects.js for the storage format and the
// one-entry-per-loaded-photo (not per-click) update behavior.
// ---------------------------------------------------------------------------

async function snapshotRecentProject() {
  if (!state.sourceCanvas || !state.outputCanvas) return;
  try {
    const defaultName = (state.sourceFileName || "Untitled").replace(/\.[^./\\]+$/, "");
    state.currentProjectId = await recentProjects.saveSnapshot(
      state.currentProjectId, defaultName, state.renderedMode, state.sourceCanvas,
      state.sourceFileName, collectSettings(), state.outputCanvas);
  } catch (err) {
    // Recent Projects is a convenience, never a reason to interrupt a
    // successful generate -- just note it in the status bar.
    setStatus(`Generated (Recent Projects snapshot failed: ${err.message})`);
  }
}

el.recentProjectsBtn.addEventListener("click", openRecentProjects);

async function openRecentProjects() {
  const records = await recentProjects.loadIndex();
  const body = document.createElement("div");

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rp-empty";
    empty.textContent = "No recent projects yet — generate a mosaic to create one.";
    body.appendChild(empty);
  }

  const objectUrls = [];
  for (const record of records) {
    const row = document.createElement("div");
    row.className = "rp-row";

    const thumb = document.createElement("img");
    thumb.className = "rp-thumb";
    if (record.thumbnailBlob) {
      const url = URL.createObjectURL(record.thumbnailBlob);
      objectUrls.push(url);
      thumb.src = url;
    }

    const info = document.createElement("div");
    info.className = "rp-info";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "rp-name";
    nameInput.value = record.name || record.sourceFileName || "Untitled";
    const commitRename = () => {
      const value = nameInput.value.trim();
      if (value) recentProjects.renameProject(record.id, value);
    };
    nameInput.addEventListener("blur", commitRename);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

    const meta = document.createElement("div");
    meta.className = "rp-meta";
    meta.textContent = `${layoutModeLabel(record.mode)} • ${formatRecentTimestamp(record.updatedAt)}`;

    info.append(nameInput, meta);

    const actions = document.createElement("div");
    actions.className = "rp-actions";
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => loadRecentProject(record));
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "rp-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteRecentProject(record.id, record.name));
    actions.append(loadBtn, deleteBtn);

    row.append(thumb, info, actions);
    body.appendChild(row);
  }

  showDialog({
    title: "Recent Projects",
    desc: `Reopen a previously loaded photo with its settings. Keeps the most recent ${recentProjects.MAX_RECENT_PROJECTS}.`,
    bodyEl: body,
    actions: [{ label: "Close", onClick: closeDialog }],
    wide: true,
  });
  // The dialog owns these object URLs for its lifetime; revoke them once
  // it's closed (dialogRoot cleared) rather than leaking blob: URLs.
  const revokeOnClose = () => {
    if (!el.dialogRoot.contains(body)) {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    } else {
      requestAnimationFrame(revokeOnClose);
    }
  };
  requestAnimationFrame(revokeOnClose);
}

function layoutModeLabel(mode) {
  const btn = el.layoutModeSeg.querySelector(`button[data-layout="${mode}"]`);
  return btn ? btn.textContent : mode;
}

function formatRecentTimestamp(isoText) {
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

async function loadRecentProject(record) {
  if (!record.sourceBlob) {
    setStatus(`Couldn't reopen — the cached photo for “${record.name}” is missing.`);
    return;
  }
  await loadImageFromBlob(record.sourceBlob, record.sourceFileName);
  // applyLoadedImage() clears state.currentProjectId (a fresh load always
  // looks like a brand-new project) -- restore it here so the next
  // generate updates this same entry instead of creating a duplicate.
  state.currentProjectId = record.id;
  applySettings(record.settings);
  closeDialog();
  setStatus(`Reopened “${record.name}” — click Generate to render it.`);
}

function deleteRecentProject(id, name) {
  const body = document.createElement("p");
  body.textContent = `Remove "${name}" from Recent Projects? This only removes the cached copy `
    + "and thumbnail — it doesn't touch the original photo.";

  showDialog({
    title: "Delete Recent Project?",
    bodyEl: body,
    actions: [
      {
        label: "Delete", primary: true, onClick: async () => {
          await recentProjects.deleteProject(id);
          if (state.currentProjectId === id) state.currentProjectId = null;
          openRecentProjects();
        },
      },
      { label: "Cancel", onClick: closeDialog },
    ],
  });
}

// ---------------------------------------------------------------------------
// Batch Mode -- an ephemeral (session-only) ordered list of Recent Projects
// ids, built by uploading several photos at once. Ties directly into
// Recent Projects: each uploaded photo becomes a *pending* record
// (recentProjects.createPending), "Open" loads one item into the main
// editor just like Recent Projects' own Load button (restoring its
// settings if it's been generated before), and Generate All / Export All
// operate on the whole batch at once. See js/core/recentProjects.js's
// module docstring for the storage-side half of this.
// ---------------------------------------------------------------------------

async function createBatch(files) {
  const ids = [];
  const failed = [];
  for (const file of files) {
    let canvas;
    try {
      const bitmap = await createImageBitmap(file);
      canvas = makeCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
    } catch {
      failed.push(file.name);
      continue;
    }
    try {
      const defaultName = file.name.replace(/\.[^./\\]+$/, "");
      ids.push(await recentProjects.createPending(defaultName, canvas, file.name));
    } catch {
      failed.push(file.name);
    }
  }

  if (ids.length === 0) {
    setStatus("Couldn't start a batch — none of the chosen files could be opened.");
    return;
  }

  state.currentBatchIds = ids;
  let msg = `Batch started — ${ids.length} photo(s) added.`;
  if (failed.length) {
    const shown = failed.slice(0, 3).join(", ") + (failed.length > 3 ? "..." : "");
    msg += ` (${failed.length} skipped: ${shown})`;
  }
  setStatus(msg);
  await openBatchMode();
}

async function openBatchMode() {
  const records = await recentProjects.loadIndex();
  const byId = new Map(records.map(r => [r.id, r]));
  const body = document.createElement("div");

  if (state.currentBatchIds.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rp-empty";
    empty.textContent = "No batch active — use “Upload a Batch...” to start one.";
    body.appendChild(empty);
  }

  const objectUrls = [];
  for (const id of state.currentBatchIds) {
    const record = byId.get(id);
    if (record) body.appendChild(buildBatchItemRow(record, objectUrls));
  }

  showDialog({
    title: "Batch Mode",
    desc: "Open a photo to adjust its own settings, or use Generate All / Export All below to "
      + "run the whole batch with the settings currently on the panel. The batch isn't saved "
      + "between sessions — uploading a new one replaces it.",
    bodyEl: body,
    actions: [
      { label: "Generate All", primary: true, onClick: batchGenerateAll },
      { label: "Export All...", onClick: batchExportAll },
      { label: "Close", onClick: closeDialog },
    ],
    wide: true,
  });
  // Same object-URL lifetime handling as openRecentProjects() above.
  const revokeOnClose = () => {
    if (!el.dialogRoot.contains(body)) {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    } else {
      requestAnimationFrame(revokeOnClose);
    }
  };
  requestAnimationFrame(revokeOnClose);
}

function buildBatchItemRow(record, objectUrls) {
  const row = document.createElement("div");
  row.className = "rp-row";

  const thumb = document.createElement("img");
  thumb.className = "rp-thumb";
  if (record.thumbnailBlob) {
    const url = URL.createObjectURL(record.thumbnailBlob);
    objectUrls.push(url);
    thumb.src = url;
  }

  const info = document.createElement("div");
  info.className = "rp-info";
  const title = document.createElement("div");
  title.textContent = record.name || record.sourceFileName || "Untitled";
  const status = document.createElement("div");
  status.className = record.mode ? "rp-status rp-status-done" : "rp-status rp-status-pending";
  status.textContent = record.mode
    ? `Generated — ${layoutModeLabel(record.mode)}`
    : "Pending — not generated yet";
  info.append(title, status);

  const actions = document.createElement("div");
  actions.className = "rp-actions";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", () => openBatchItem(record));
  actions.appendChild(openBtn);

  row.append(thumb, info, actions);
  return row;
}

async function openBatchItem(record) {
  if (!record.sourceBlob) {
    setStatus(`Couldn't open — the cached photo for "${record.name}" is missing.`);
    return;
  }
  await loadImageFromBlob(record.sourceBlob, record.sourceFileName);
  // applyLoadedImage() clears state.currentProjectId -- restore it here so
  // the next generate updates this same batch item instead of creating a
  // duplicate Recent Projects entry.
  state.currentProjectId = record.id;
  if (record.settings) applySettings(record.settings);
  closeDialog();
  setStatus(`Opened "${record.name}" from the batch — adjust settings and click Generate.`);
}

// There's no single shared entry point the way the desktop app's
// _on_generate() dispatches internally to whichever per-mode handler is
// current -- each mode's Generate button here calls its own generate
// function directly. This small wrapper gives Batch Mode's Generate All
// the same "dispatch to the current mode" behavior without duplicating any
// per-mode generate logic.
function generateForCurrentMode() {
  switch (state.layoutMode) {
    case "adaptive": return generateAdaptiveMosaic();
    case "dice": return generateDiceMosaic();
    case "rubiks": return generateRubiksMosaic();
    case "meta": return generateMetaMosaic();
    case "crossstitch": return generateCrossStitchMosaic();
    case "foundobject": return generateFoundObjectMosaic();
    case "radial": return generateRadialMosaic();
    case "stainedglass": return generateStainedglassMosaic();
    case "lithophane": return generateLithophaneMosaic();
    case "stringart": return generateStringartMosaic();
    case "screwart": return generateScrewartMosaic();
    default: return generateMosaic();
  }
}

async function batchGenerateAll() {
  if (state.currentBatchIds.length === 0) {
    setStatus("No items in the current batch.");
    return;
  }
  closeDialog();
  setStatus(`Batch: generating ${state.currentBatchIds.length} item(s)...`);

  const records = await recentProjects.loadIndex();
  const byId = new Map(records.map(r => [r.id, r]));
  let done = 0;
  // Every item is generated with whatever settings are currently on the
  // panel (not each item's own previously-saved settings, if any) --
  // Generate All runs the whole batch through one shared configuration;
  // opening an item individually (openBatchItem, above) is how a single
  // photo gets its own settings.
  for (const id of state.currentBatchIds) {
    const record = byId.get(id);
    if (!record || !record.sourceBlob) {
      setStatus(`Batch: skipping "${record ? record.name : id}" — cached photo missing.`);
      continue;
    }
    await loadImageFromBlob(record.sourceBlob, record.sourceFileName);
    state.currentProjectId = id;
    await generateForCurrentMode();
    done++;
  }

  setStatus(`Batch complete — ${done} of ${state.currentBatchIds.length} item(s) generated.`);
  await openBatchMode();
}

async function batchExportAll() {
  if (state.currentBatchIds.length === 0) {
    setStatus("No items in the current batch.");
    return;
  }
  const records = await recentProjects.loadIndex();
  const byId = new Map(records.map(r => [r.id, r]));

  const zip = new JSZip();
  const usedNames = new Set();
  let included = 0;
  for (const id of state.currentBatchIds) {
    const record = byId.get(id);
    if (!record || !record.outputBlob) continue;
    const safeName = (record.name || id).replace(/[^\w\-. ]/g, "_").trim() || id;
    let arcname = `${safeName}.png`;
    let n = 2;
    while (usedNames.has(arcname)) {
      arcname = `${safeName} (${n}).png`;
      n++;
    }
    usedNames.add(arcname);
    zip.file(arcname, record.outputBlob);
    included++;
  }

  const total = state.currentBatchIds.length;
  if (included === 0) {
    setStatus("Nothing to export yet — generate at least one batch item first.");
    return;
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "batch_export.zip");
  const note = included === total ? "" : " (the rest haven't been generated yet)";
  setStatus(`Exported ${included} of ${total} batch item(s) to batch_export.zip${note}.`);
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
      diamondInterlock: el.diamondInterlock.checked,

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
      rubiksIncludeBlack: el.rubiksIncludeBlack.checked,
      rubiksColorMode: state.rubiksColorMode,
      rubiksColorMap: Object.fromEntries(
        Object.entries(state.rubiksColorMap).map(([name, rgb]) => [name, rgbToHex(rgb)])),

      tintStrength: parseInt(el.tintStrength.value, 10),

      crossstitchMaxColors: parseInt(el.crossstitchMaxColors.value, 10),

      // Found Object mode's per-color photo assignments aren't included --
      // they're uploaded image files, not JSON-friendly data -- so only
      // its two sliders round-trip; re-assign photos after importing.
      foundObjectNumColors: parseInt(el.foundObjectNumColors.value, 10),
      foundObjectTintStrength: parseInt(el.foundObjectTintStrength.value, 10),

      radialRings: parseInt(el.radialRings.value, 10),
      radialBaseSegments: parseInt(el.radialBaseSegments.value, 10),
      radialNumColors: parseInt(el.radialNumColors.value, 10),

      // The seed rounds out this mode's settings so re-importing (or
      // reloading a Recent Project) reproduces the *exact* same piece
      // layout, not just the same piece count/spacing.
      stainedglassPieceCount: parseInt(el.stainedglassPieceCount.value, 10),
      stainedglassNumColors: parseInt(el.stainedglassNumColors.value, 10),
      stainedglassLeadWidth: parseInt(el.stainedglassLeadWidth.value, 10),
      stainedglassLeadColor: rgbToHex(state.stainedglassLeadColor),
      stainedglassSeed: getStainedglassSeed(),

      lithophaneWidthMm: getLithophaneFloat(el.lithophaneWidth, 100),
      lithophaneHeightMm: getLithophaneFloat(el.lithophaneHeight, 75),
      lithophaneLockAspect: el.lithophaneLockAspect.checked,
      lithophaneDetail: parseInt(el.lithophaneDetail.value, 10),
      lithophaneMinThickness: getLithophaneFloat(el.lithophaneMinThickness, 0.8),
      lithophaneMaxThickness: getLithophaneFloat(el.lithophaneMaxThickness, 3.2),
      lithophaneInvert: el.lithophaneInvert.checked,

      screwsWide: parseInt(el.screwsWide.value, 10),
      screwsTall: parseInt(el.screwsTall.value, 10),
      screwartMinDepthMm: getScrewartFloat(el.screwartMinDepth, 0),
      screwartMaxDepthMm: getScrewartFloat(el.screwartMaxDepth, 12),
      screwartInvert: el.screwartInvert.checked,

      stringartShape: [...el.stringartShapeSeg.children].find(b => b.classList.contains("active")).dataset.shape,
      stringartNumPins: parseInt(el.stringartPins.value, 10),
      stringartNumLines: parseInt(el.stringartLines.value, 10),
      stringartFrameSize: parseFloat(el.stringartFrameSize.value) || 0,
      stringartFrameSizeUnit: el.stringartFrameSizeUnit.value,
      stringartThreadColor: rgbToHex(state.stringartThreadColor),
      stringartBgColor: rgbToHex(state.stringartBgColor),

      leadedglassShape: leadedglassShapeKey(),
      leadedglassStyle: leadedglassStyleKey(),
      leadedglassLeadWidth: parseInt(el.leadedglassLeadWidth.value, 10),
      leadedglassLeadColor: rgbToHex(state.leadedglassLeadColor),
      leadedglassBgColor: rgbToHex(state.leadedglassBgColor),
      leadedglassNumColors: parseInt(el.leadedglassNumColors.value, 10),
      leadedglassBoldPieceCount: parseInt(el.leadedglassBoldPieceCount.value, 10),
      leadedglassBoldSpacing: parseFloat(el.leadedglassBoldSpacing.value),
      leadedglassBoldSeed: getLeadedglassBoldSeed(),
      leadedglassGridCols: parseInt(el.leadedglassGridCols.value, 10),
      leadedglassGridCellSize: parseFloat(el.leadedglassGridCellSize.value),
      leadedglassBodyWidth: parseInt(el.leadedglassBodyWidth.value, 10),
      leadedglassSubjectPieces: parseInt(el.leadedglassSubjectPieces.value, 10),
      leadedglassRings: parseInt(el.leadedglassRings.value, 10),
      leadedglassWedges: parseInt(el.leadedglassWedges.value, 10),
      leadedglassLatticeSeed: getLeadedglassLatticeSeed(),
      leadedglassBorderEnabled: !!state.leadedglassBorderEnabled,
      leadedglassBorderColor: rgbToHex(state.leadedglassBorderColor),
      leadedglassBorderAccentColor: rgbToHex(state.leadedglassBorderAccentColor),
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
  if (s.shape) applyShapeUI(s.shape);
  if (typeof s.circleInterlock === "boolean") { el.circleInterlock.checked = s.circleInterlock; state.circleInterlock = s.circleInterlock; }
  if (typeof s.diamondInterlock === "boolean") { el.diamondInterlock.checked = s.diamondInterlock; state.diamondInterlock = s.diamondInterlock; }

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
  if (typeof s.rubiksIncludeBlack === "boolean") el.rubiksIncludeBlack.checked = s.rubiksIncludeBlack;
  if (s.rubiksColorMode === "ramp" || s.rubiksColorMode === "nearest") setRubiksColorMode(s.rubiksColorMode);
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

  if (Number.isFinite(s.radialRings)) { el.radialRings.value = s.radialRings; el.radialRingsVal.textContent = s.radialRings; }
  if (Number.isFinite(s.radialBaseSegments)) {
    el.radialBaseSegments.value = s.radialBaseSegments;
    el.radialBaseSegmentsVal.textContent = s.radialBaseSegments;
  }
  if (Number.isFinite(s.radialNumColors)) { el.radialNumColors.value = s.radialNumColors; el.radialNumColorsVal.textContent = s.radialNumColors; }
  updateRadialCellEstimate();

  if (Number.isFinite(s.stainedglassPieceCount)) {
    el.stainedglassPieceCount.value = s.stainedglassPieceCount;
    el.stainedglassPieceCountVal.textContent = s.stainedglassPieceCount;
  }
  if (Number.isFinite(s.stainedglassNumColors)) {
    el.stainedglassNumColors.value = s.stainedglassNumColors;
    el.stainedglassNumColorsVal.textContent = s.stainedglassNumColors;
  }
  if (Number.isFinite(s.stainedglassLeadWidth)) {
    el.stainedglassLeadWidth.value = s.stainedglassLeadWidth;
    el.stainedglassLeadWidthVal.textContent = s.stainedglassLeadWidth;
  }
  if (s.stainedglassLeadColor) {
    state.stainedglassLeadColor = hexToRgb(s.stainedglassLeadColor);
    setSwatchButton(el.stainedglassLeadColorBtn, state.stainedglassLeadColor);
    el.stainedglassLeadColorPicker.value = s.stainedglassLeadColor;
  }
  if (Number.isFinite(s.stainedglassSeed)) el.stainedglassSeed.value = s.stainedglassSeed;
  updateStainedglassPieceEstimate();

  if (Number.isFinite(s.lithophaneWidthMm)) el.lithophaneWidth.value = s.lithophaneWidthMm;
  if (Number.isFinite(s.lithophaneHeightMm)) el.lithophaneHeight.value = s.lithophaneHeightMm;
  if (typeof s.lithophaneLockAspect === "boolean") el.lithophaneLockAspect.checked = s.lithophaneLockAspect;
  if (Number.isFinite(s.lithophaneDetail)) {
    el.lithophaneDetail.value = s.lithophaneDetail;
    el.lithophaneDetailVal.textContent = s.lithophaneDetail;
  }
  if (Number.isFinite(s.lithophaneMinThickness)) el.lithophaneMinThickness.value = s.lithophaneMinThickness;
  if (Number.isFinite(s.lithophaneMaxThickness)) el.lithophaneMaxThickness.value = s.lithophaneMaxThickness;
  if (typeof s.lithophaneInvert === "boolean") el.lithophaneInvert.checked = s.lithophaneInvert;
  updateLithophaneEstimate();

  if (Number.isFinite(s.screwsWide)) {
    el.screwsWide.value = s.screwsWide;
    el.screwsWideVal.textContent = s.screwsWide;
  }
  if (Number.isFinite(s.screwsTall)) {
    el.screwsTall.value = s.screwsTall;
    el.screwsTallVal.textContent = s.screwsTall;
  }
  if (Number.isFinite(s.screwartMinDepthMm)) el.screwartMinDepth.value = s.screwartMinDepthMm;
  if (Number.isFinite(s.screwartMaxDepthMm)) el.screwartMaxDepth.value = s.screwartMaxDepthMm;
  if (typeof s.screwartInvert === "boolean") el.screwartInvert.checked = s.screwartInvert;
  updateScrewartSizeEstimate();

  if (s.stringartShape === "circle" || s.stringartShape === "rect") {
    [...el.stringartShapeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.shape === s.stringartShape));
  }
  if (Number.isFinite(s.stringartNumPins)) {
    el.stringartPins.value = s.stringartNumPins;
    el.stringartPinsVal.textContent = s.stringartNumPins;
  }
  if (Number.isFinite(s.stringartNumLines)) {
    el.stringartLines.value = s.stringartNumLines;
    el.stringartLinesVal.textContent = s.stringartNumLines;
  }
  if (Number.isFinite(s.stringartFrameSize)) el.stringartFrameSize.value = s.stringartFrameSize;
  if (PIECE_SIZE_UNITS.includes(s.stringartFrameSizeUnit)) el.stringartFrameSizeUnit.value = s.stringartFrameSizeUnit;
  if (s.stringartThreadColor) {
    state.stringartThreadColor = hexToRgb(s.stringartThreadColor);
    setSwatchButton(el.stringartThreadColorBtn, state.stringartThreadColor);
    el.stringartThreadColorPicker.value = s.stringartThreadColor;
  }
  if (s.stringartBgColor) {
    state.stringartBgColor = hexToRgb(s.stringartBgColor);
    setSwatchButton(el.stringartBgColorBtn, state.stringartBgColor);
    el.stringartBgColorPicker.value = s.stringartBgColor;
  }
  updateStringartEstimate();

  if (["rect", "pointed", "rounded"].includes(s.leadedglassShape)) {
    [...el.leadedglassShapeSeg.children].forEach(b => b.classList.toggle("active", b.dataset.shape === s.leadedglassShape));
    onLeadedglassShapeChange();
  }
  if (["lattice_subject", "bold_pieces", "panel_grid"].includes(s.leadedglassStyle)) {
    [...el.leadedglassStyleSeg.children].forEach(b => b.classList.toggle("active", b.dataset.style === s.leadedglassStyle));
    el.leadedglassLatticePanel.hidden = s.leadedglassStyle !== "lattice_subject";
    el.leadedglassBoldPanel.hidden = s.leadedglassStyle !== "bold_pieces";
    el.leadedglassGridPanel.hidden = s.leadedglassStyle !== "panel_grid";
  }
  if (Number.isFinite(s.leadedglassLeadWidth)) {
    el.leadedglassLeadWidth.value = s.leadedglassLeadWidth;
    el.leadedglassLeadWidthVal.textContent = s.leadedglassLeadWidth;
  }
  if (s.leadedglassLeadColor) {
    state.leadedglassLeadColor = hexToRgb(s.leadedglassLeadColor);
    setSwatchButton(el.leadedglassLeadColorBtn, state.leadedglassLeadColor);
    el.leadedglassLeadColorPicker.value = s.leadedglassLeadColor;
  }
  if (s.leadedglassBgColor) {
    state.leadedglassBgColor = hexToRgb(s.leadedglassBgColor);
    setSwatchButton(el.leadedglassBgColorBtn, state.leadedglassBgColor);
    el.leadedglassBgColorPicker.value = s.leadedglassBgColor;
  }
  if (Number.isFinite(s.leadedglassNumColors)) {
    el.leadedglassNumColors.value = s.leadedglassNumColors;
    el.leadedglassNumColorsVal.textContent = s.leadedglassNumColors;
  }
  if (Number.isFinite(s.leadedglassBoldPieceCount)) {
    el.leadedglassBoldPieceCount.value = s.leadedglassBoldPieceCount;
    el.leadedglassBoldPieceCountVal.textContent = s.leadedglassBoldPieceCount;
  }
  if (Number.isFinite(s.leadedglassBoldSpacing)) {
    el.leadedglassBoldSpacing.value = s.leadedglassBoldSpacing;
    el.leadedglassBoldSpacingVal.textContent = s.leadedglassBoldSpacing;
  }
  if (Number.isFinite(s.leadedglassBoldSeed)) el.leadedglassBoldSeed.value = s.leadedglassBoldSeed;
  if (Number.isFinite(s.leadedglassGridCols)) {
    el.leadedglassGridCols.value = s.leadedglassGridCols;
    el.leadedglassGridColsVal.textContent = s.leadedglassGridCols;
  }
  if (Number.isFinite(s.leadedglassGridCellSize)) {
    el.leadedglassGridCellSize.value = s.leadedglassGridCellSize;
    el.leadedglassGridCellSizeVal.textContent = s.leadedglassGridCellSize;
  }
  if (Number.isFinite(s.leadedglassBodyWidth)) {
    el.leadedglassBodyWidth.value = s.leadedglassBodyWidth;
    el.leadedglassBodyWidthVal.textContent = s.leadedglassBodyWidth;
  }
  if (Number.isFinite(s.leadedglassSubjectPieces)) {
    el.leadedglassSubjectPieces.value = s.leadedglassSubjectPieces;
    el.leadedglassSubjectPiecesVal.textContent = s.leadedglassSubjectPieces;
  }
  if (Number.isFinite(s.leadedglassRings)) {
    el.leadedglassRings.value = s.leadedglassRings;
    el.leadedglassRingsVal.textContent = s.leadedglassRings;
  }
  if (Number.isFinite(s.leadedglassWedges)) {
    el.leadedglassWedges.value = s.leadedglassWedges;
    el.leadedglassWedgesVal.textContent = s.leadedglassWedges;
  }
  if (Number.isFinite(s.leadedglassLatticeSeed)) el.leadedglassLatticeSeed.value = s.leadedglassLatticeSeed;
  if (s.leadedglassBorderColor) {
    state.leadedglassBorderColor = hexToRgb(s.leadedglassBorderColor);
    setSwatchButton(el.leadedglassBorderColorBtn, state.leadedglassBorderColor);
    el.leadedglassBorderColorPicker.value = s.leadedglassBorderColor;
  }
  if (s.leadedglassBorderAccentColor) {
    state.leadedglassBorderAccentColor = hexToRgb(s.leadedglassBorderAccentColor);
    setSwatchButton(el.leadedglassBorderAccentBtn, state.leadedglassBorderAccentColor);
    el.leadedglassBorderAccentPicker.value = s.leadedglassBorderAccentColor;
  }
  // Border is rect-only -- onLeadedglassShapeChange above already forced
  // the checkbox off for any other shape, so only honor a saved "enabled"
  // flag when the restored shape is still "rect".
  if (s.leadedglassBorderEnabled && leadedglassShapeKey() === "rect") {
    el.leadedglassBorderEnabled.checked = true;
    onLeadedglassBorderToggle();
  }
  updateLeadedglassEstimate();

  // Layout mode last, once every mode's own controls are already in place.
  if (s.layoutMode) setLayoutMode(s.layoutMode);

  updateColorSourceUI();
  updateSizeEstimate();
  updatePanelEstimate();
  updateRubiksSizeEstimate();
}

el.exportSettingsBtn.addEventListener("click", exportSettings);
el.previewSettingsBtn.addEventListener("click", () => {
  openTextExportPreviewDialog("Preview: Settings (JSON)", JSON.stringify(collectSettings(), null, 2), exportSettings);
});

function exportSettings() {
  downloadText(JSON.stringify(collectSettings(), null, 2), "pixel_mosaic_settings.json", "application/json");
  setStatus("Saved pixel_mosaic_settings.json");
}

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
// Slider fine-adjustment: +/- buttons and consistent mouse-wheel support
// ---------------------------------------------------------------------------

// Every slider in the app shares the same markup shape (a .slider-row
// wrapping the <input type="range"> plus a trailing .slider-val readout),
// so this one pass enhances all of them at once rather than wiring each
// slider by hand -- same idea as the desktop app's single _make_slider
// factory.
//
// Mouse-wheel-over-a-slider previously did nothing consistent: native
// <input type="range"> wheel handling is a Firefox-only behavior (Chrome,
// Safari and Edge never adjust a range input on wheel at all), so
// scrolling over a slider would silently do nothing in most browsers, or
// -- worse -- just scroll the whole Settings sidebar underneath it, since
// nothing was stopping that scroll from bubbling up to #panel. That's this
// app's actual "works on some sliders but not others" bug: it's really
// "works only in Firefox, and only there because the browser itself
// happens to implement it, not because the app does." Explicitly wiring
// wheel support here, uniformly, on every slider fixes that everywhere.
function enhanceSliders() {
  document.querySelectorAll(".slider-row").forEach((row) => {
    const input = row.querySelector('input[type="range"]');
    if (!input) return;

    const lo = Number(input.min);
    const hi = Number(input.max);
    const step = Number(input.step) || 1;

    function fireInput() {
      // A real user drag dispatches both -- match that exactly so every
      // existing "input" listener (live readouts, aspect-lock sync, size
      // estimates, ...) keeps working unchanged, plus "change" for any
      // listener that only cares about the settled final value.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function stepBy(delta) {
      if (input.disabled) return;
      const next = Math.min(hi, Math.max(lo, Number(input.value) + delta * step));
      if (next === Number(input.value)) return;
      input.value = String(next);
      fireInput();
    }

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "slider-step-btn";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Decrease");
    minusBtn.addEventListener("click", () => stepBy(-1));

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "slider-step-btn";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Increase");
    plusBtn.addEventListener("click", () => stepBy(1));

    // Click-and-hold auto-repeat: the "click" listeners above already
    // handle a single click (fires once, on a completed press+release), so
    // holding the button down just needs to keep calling stepBy on a timer
    // until released, instead of making the user click repeatedly for a
    // big change. Mirrors the desktop app's equivalent binding in
    // mosaic_gui.py's _make_slider (initial delay, then a fixed repeat
    // interval).
    function bindHoldRepeat(button, delta) {
      const INITIAL_DELAY = 400, REPEAT_INTERVAL = 70;
      let timeoutId = null, intervalId = null;
      function stop() {
        if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      }
      button.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // left button only
        stop();
        timeoutId = setTimeout(() => {
          timeoutId = null;
          intervalId = setInterval(() => stepBy(delta), REPEAT_INTERVAL);
        }, INITIAL_DELAY);
      });
      button.addEventListener("mouseup", stop);
      button.addEventListener("mouseleave", stop);
      // Also stop on a mouseup anywhere: the mouse can be dragged off the
      // button (and released elsewhere) while still held down, which
      // wouldn't otherwise fire this button's own mouseup/mouseleave.
      window.addEventListener("mouseup", stop);
    }
    bindHoldRepeat(minusBtn, -1);
    bindHoldRepeat(plusBtn, 1);

    row.insertBefore(minusBtn, input);
    input.after(plusBtn);

    // Wheel: bind on the whole row (not just the <input>) so it works
    // whether the pointer is over the track, the +/- buttons, or the
    // value readout -- and always preventDefault so this never also
    // scrolls the Settings sidebar underneath, on any browser.
    row.addEventListener("wheel", (e) => {
      e.preventDefault();
      stepBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

enhanceSliders();
setSwatchButton(el.bgColorBtn, state.bgColor);
setSwatchButton(el.monoColorBtn, state.monochromeBaseColor);
setSwatchButton(el.dieColorBtn, state.dieColor);
setSwatchButton(el.pipColorBtn, state.pipColor);
updateColorSourceUI();
el.stainedglassSeed.value = String(randomStainedglassSeed());
el.leadedglassBoldSeed.value = String(randomLeadedglassSeed());
el.leadedglassLatticeSeed.value = String(randomLeadedglassSeed());
updateSizeEstimate();
updatePanelEstimate();
updateRubiksSizeEstimate();
updateRadialCellEstimate();
updateStainedglassPieceEstimate();
updateLeadedglassEstimate();
refreshPreview();
