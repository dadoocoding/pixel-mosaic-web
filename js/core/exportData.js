/**
 * exportData.js
 * Build JSON/CSV strings (for client-side download, no filesystem access)
 * matching mosaic_core.py's export_json / export_csv / export_palette_csv /
 * export_bricks_json / export_bricks_csv / export_brick_shopping_list_csv /
 * export_adaptive_tiles_json / export_dice_shopping_list_csv.
 */

import { rgbToHex } from "./color.js";
import { colorCounts } from "./colorCounts.js";
import { footprintLabel, brickCounts } from "./bricks.js";
import { diceCounts } from "./dice.js";
import { rubiksCubeCount, rubiksNamesForPalette } from "./rubiks.js";
import { adaptiveColorCounts } from "./adaptive.js";
import { radialRingSegments } from "./radial.js";
import { nearestPaintMatchesAllBrands, formatMatch, formatBestMatch } from "./paintColors.js";
import { dmcColorCounts } from "./crossstitch.js";

function csvEscape(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Round to the nearest cent, half rounding up -- matches Python's
 * `_round_money` (`math.floor(x * 100 + 0.5) / 100`) exactly, so CSV cost
 * output is byte-identical between the two apps. */
function roundMoney(x) {
  return Math.floor(x * 100 + 0.5) / 100;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

function buildNameLookup(palette, names) {
  const lookup = new Map();
  palette.forEach((rgb, i) => {
    if (names[i]) lookup.set(rgbToHex(rgb), names[i]);
  });
  return lookup;
}

export function buildGridJson(grid, gridW, gridH, palette, shape, options = {}) {
  const { sourceName = "", names = [], rowOffset = 0, colOffset = 0,
          includeGlobalCoords = false, extraMeta = null } = options;
  const nameLookup = buildNameLookup(palette, names);

  // row/col are reported 1-indexed (row 1, col 1 = top-left) so they read
  // naturally as a real-world build reference -- there's no "row 0" on a
  // physical grid.
  const cells = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const rgb = grid[row * gridW + col];
      const hex = rgbToHex(rgb);
      const cell = { row: row + 1, col: col + 1, rgb, hex, name: nameLookup.get(hex) || "" };
      if (includeGlobalCoords) {
        cell.global_row = row + rowOffset + 1;
        cell.global_col = col + colOffset + 1;
      }
      cells.push(cell);
    }
  }

  const data = {
    source_image: sourceName,
    shape,
    grid_width: gridW,
    grid_height: gridH,
    num_colors: palette.length,
    palette: colorCounts(grid, palette, names),
    cells,
  };
  return JSON.stringify(extraMeta ? { ...extraMeta, ...data } : data, null, 2);
}

export function buildGridCsv(grid, gridW, gridH, palette = null, names = [], options = {}) {
  const { rowOffset = 0, colOffset = 0, includeGlobalCoords = false } = options;
  const nameLookup = palette ? buildNameLookup(palette, names) : new Map();

  const headers = ["row", "col"];
  if (includeGlobalCoords) headers.push("global_row", "global_col");
  headers.push("r", "g", "b", "hex", "name");

  // 1-indexed (row 1, col 1 = top-left) -- a real-world build reference has
  // no "row 0".
  const rows = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const [r, g, b] = grid[row * gridW + col];
      const hex = rgbToHex([r, g, b]);
      const rowData = [row + 1, col + 1];
      if (includeGlobalCoords) rowData.push(row + rowOffset + 1, col + colOffset + 1);
      rowData.push(r, g, b, hex, nameLookup.get(hex) || "");
      rows.push(rowData);
    }
  }
  return toCsv(headers, rows);
}

/** The color-count "shopping list" CSV, plus -- for each color -- the
 * nearest real paint match in Sherwin-Williams, Behr, and Krylon (see
 * paintColors.js), and which of the three is the single closest match
 * overall. Handy if you're planning to actually paint the piece rather
 * than just tally what colors it uses. */
/** unitPrice, if given, is a rough price per single cell/piece (e.g. per
 * bead or per brick) -- appends "unit_price"/"cost" columns and a trailing
 * TOTAL row. Left undefined, the CSV is unchanged from before this option
 * existed. */
export function buildPaletteCsv(grid, palette, names = [], unitPrice = null) {
  const counts = colorCounts(grid, palette, names);
  const matches = nearestPaintMatchesAllBrands(counts.map(c => c.rgb));
  const headers = ["color_number", "hex", "r", "g", "b", "name", "count",
    "sherwin_williams_match", "behr_match", "krylon_match", "best_match"];
  if (unitPrice !== null) headers.push("unit_price", "cost");
  let totalCost = 0;
  const rows = counts.map((c, i) => {
    const row = [
      i + 1, c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.name, c.count,
      formatMatch(matches[i]["Sherwin-Williams"]),
      formatMatch(matches[i]["Behr"]),
      formatMatch(matches[i]["Krylon"]),
      formatBestMatch(matches[i].best),
    ];
    if (unitPrice !== null) {
      const cost = roundMoney(c.count * unitPrice);
      totalCost += cost;
      row.push(unitPrice.toFixed(2), cost.toFixed(2));
    }
    return row;
  });
  if (unitPrice !== null) {
    rows.push(["TOTAL", "", "", "", "", "", "", "", "", "", "", "", roundMoney(totalCost).toFixed(2)]);
  }
  return toCsv(headers, rows);
}

export function buildBricksJson(bricks, palette, shape, options = {}) {
  const { sourceName = "", names = [] } = options;
  const nameLookup = buildNameLookup(palette, names);

  // 1-indexed -- a real-world build reference has no "row 0".
  const brickList = bricks.map(b => {
    const hex = rgbToHex(b.rgb);
    return {
      row: b.row + 1, col: b.col + 1, width: b.width, height: b.height,
      footprint: footprintLabel(b.width, b.height),
      rgb: b.rgb, hex, name: nameLookup.get(hex) || "",
    };
  });

  const data = {
    source_image: sourceName,
    shape,
    brick_count: bricks.length,
    cell_count: bricks.reduce((s, b) => s + b.width * b.height, 0),
    shopping_list: brickCounts(bricks, palette, names),
    bricks: brickList,
  };
  return JSON.stringify(data, null, 2);
}

export function buildBricksCsv(bricks, palette = null, names = []) {
  const nameLookup = palette ? buildNameLookup(palette, names) : new Map();
  const rows = bricks.map(b => {
    const hex = rgbToHex(b.rgb);
    return [b.row + 1, b.col + 1, b.width, b.height, footprintLabel(b.width, b.height),
            b.rgb[0], b.rgb[1], b.rgb[2], hex, nameLookup.get(hex) || ""];
  });
  return toCsv(["row", "col", "width", "height", "footprint", "r", "g", "b", "hex", "name"], rows);
}

/** unitPrice, if given, is a rough flat price per brick/plate piece (piece
 * size isn't factored in -- treat it as a ballpark, not a precise
 * per-footprint price), appending "unit_price"/"cost" columns and a
 * trailing TOTAL row. */
export function buildShoppingListCsv(bricks, palette, names = [], unitPrice = null) {
  const counts = brickCounts(bricks, palette, names);
  const headers = ["footprint", "hex", "r", "g", "b", "name", "count"];
  if (unitPrice !== null) headers.push("unit_price", "cost");
  let totalCost = 0;
  const rows = counts.map(c => {
    const row = [c.footprint, c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.name, c.count];
    if (unitPrice !== null) {
      const cost = roundMoney(c.count * unitPrice);
      totalCost += cost;
      row.push(unitPrice.toFixed(2), cost.toFixed(2));
    }
    return row;
  });
  if (unitPrice !== null) {
    rows.push(["TOTAL", "", "", "", "", "", "", "", roundMoney(totalCost).toFixed(2)]);
  }
  return toCsv(headers, rows);
}

/** Adaptive mode's tile list -- each quadtree leaf's grid-cell rect and
 * average color. There's no fixed palette in adaptive mode (colors are
 * continuous per-tile averages, not quantized), so this is the adaptive
 * equivalent of buildGridJson/buildBricksJson rather than a drop-in
 * replacement for either. */
export function buildAdaptiveTilesJson(leaves, gridW, gridH, options = {}) {
  const { sourceName = "" } = options;
  const tiles = [...leaves]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(leaf => ({
      row: leaf.y + 1, col: leaf.x + 1,
      width: leaf.w, height: leaf.h,
      rgb: leaf.rgb, hex: rgbToHex(leaf.rgb),
    }));
  const data = {
    source_image: sourceName,
    grid_width: gridW, grid_height: gridH,
    tile_count: tiles.length,
    tiles,
  };
  return JSON.stringify(data, null, 2);
}

/** Radial mode's ring/segment cell list -- each cell's ring index, segment
 * index within its ring, and quantized color. There's no row/col in a
 * radial layout, so this is the radial equivalent of buildGridJson,
 * structured as a physical-assembly reference: build ring 1 first, then
 * ring 2 around it, and so on. `colors`: flat array of length
 * radialCellCount(rings, baseSegments), ring-major then segment (see
 * radial.js's sampleRadialColors). */
export function buildRadialCellsJson(colors, rings, baseSegments, options = {}) {
  const { sourceName = "" } = options;
  const cells = [];
  let idx = 0;
  for (let ring = 0; ring < rings; ring++) {
    const nSegs = radialRingSegments(ring, baseSegments);
    for (let seg = 0; seg < nSegs; seg++) {
      const rgb = colors[idx];
      cells.push({
        ring: ring + 1, segment: seg + 1, segments_in_ring: nSegs,
        rgb, hex: rgbToHex(rgb),
      });
      idx++;
    }
  }
  const data = {
    source_image: sourceName,
    rings, base_segments: baseSegments,
    cell_count: cells.length,
    cells,
  };
  return JSON.stringify(data, null, 2);
}

/** Stained Glass mode's piece list -- every seed's canvas position and
 * quantized color, as JSON. There's no natural build order (unlike
 * Radial's ring-by-ring or Classic's row/col), so pieces are listed with
 * their (x, y) center position as the physical-assembly reference: lay
 * each piece at its position on a canvasW x canvasH grid. `points`: array
 * of [x, y] pairs from stainedglass.js's poissonDiscPoints, same order as
 * `colors`. */
export function buildStainedglassCellsJson(colors, points, canvasW, canvasH, options = {}) {
  const { sourceName = "" } = options;
  const cells = points.map(([x, y], i) => {
    const rgb = colors[i];
    return {
      index: i + 1, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      rgb, hex: rgbToHex(rgb),
    };
  });
  const data = {
    source_image: sourceName,
    canvas_width: canvasW, canvas_height: canvasH,
    cell_count: cells.length,
    cells,
  };
  return JSON.stringify(data, null, 2);
}

/** Leaded Glass mode's piece list, matching mosaic_core.py's
 * export_leadedglass_cells_json -- schema depends on layout.kind (see
 * leadedglass.js's generate/render functions), since each sub-mode's
 * pieces carry different natural build-reference geometry (a seed
 * position for Voronoi pieces, a row/col for grid diamonds). Every cell
 * always gets a piece_type field so one build guide can tell them apart
 * even when Lattice + Subject mixes two piece_types (subject_voronoi and
 * sunburst_wedge) in a single export.
 *
 * `layout`: { kind: "bold_pieces", points, canvasW, canvasH }
 *        or { kind: "panel_grid", canvasW, canvasH, cols, rows }
 *        or { kind: "lattice_subject", canvasW, canvasH, subjectPoints, rings, baseSegments } */
export function buildLeadedglassCellsJson(quantizedColors, layout, frameShape, generationMode, options = {}) {
  const { sourceName = "" } = options;
  const cells = [];

  if (layout.kind === "bold_pieces") {
    layout.points.forEach(([x, y], i) => {
      const rgb = quantizedColors[i];
      cells.push({
        index: i + 1, piece_type: "voronoi",
        x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
        rgb, hex: rgbToHex(rgb),
      });
    });
  } else if (layout.kind === "panel_grid") {
    const { cols, rows } = layout;
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const rgb = quantizedColors[idx];
        cells.push({ index: idx + 1, piece_type: "diamond", row: row + 1, col: col + 1, rgb, hex: rgbToHex(rgb) });
        idx++;
      }
    }
  } else { // lattice_subject
    const { subjectPoints, rings, baseSegments } = layout;
    let idx = 0;
    for (const [x, y] of subjectPoints) {
      const rgb = quantizedColors[idx];
      cells.push({
        index: idx + 1, piece_type: "subject_voronoi",
        x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
        rgb, hex: rgbToHex(rgb),
      });
      idx++;
    }
    for (let ring = 0; ring < rings; ring++) {
      const nSegs = radialRingSegments(ring, baseSegments);
      for (let seg = 0; seg < nSegs; seg++) {
        const rgb = quantizedColors[idx];
        cells.push({
          index: idx + 1, piece_type: "sunburst_wedge",
          ring: ring + 1, segment: seg + 1, segments_in_ring: nSegs,
          rgb, hex: rgbToHex(rgb),
        });
        idx++;
      }
    }
  }

  const data = {
    source_image: sourceName,
    generation_mode: generationMode, frame_shape: frameShape,
    canvas_width: layout.canvasW, canvas_height: layout.canvasH,
    cell_count: cells.length,
    cells,
  };
  return JSON.stringify(data, null, 2);
}

/** String Art mode's pin sequence -- the thread order plus every pin's
 * (x, y) position, matching mosaic_core.py's export_stringart_sequence_json
 * exactly (x/y rounded to 2 decimal places, thread length to 2 decimal
 * places). This is the file a build actually follows: pin map in hand,
 * string the pins in `sequence` order. */
export function buildStringartSequenceJson(sequence, positions, shape, numPins, frameSize, frameSizeUnit,
  threadLength, options = {}) {
  const { sourceName = null } = options;
  const data = {
    source_image: sourceName,
    frame_shape: shape,
    pin_count: numPins,
    line_count: sequence.length - 1,
    frame_size: frameSize,
    frame_size_unit: frameSizeUnit,
    estimated_thread_length: Math.round(threadLength * 100) / 100,
    pins: positions.map(([x, y], i) => ({
      index: i, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
    })),
    sequence: Array.from(sequence),
  };
  return JSON.stringify(data, null, 2);
}

/** String Art mode's shopping list -- pins/nails (unpriced, usually cheap
 * hardware already on hand) plus the estimated thread length. unitPrice,
 * if given, is a rough price per unit length of thread -- appends
 * "unit_price"/"cost" columns to the thread row only (mirrors
 * mosaic_core.py's export_stringart_shopping_list_csv exactly, including
 * its lack of a trailing TOTAL row). */
export function buildStringartShoppingListCsv(numPins, threadLength, frameSizeUnit, unitPrice = null) {
  const headers = ["item", "quantity", "unit"];
  if (unitPrice !== null) headers.push("unit_price", "cost");
  const pinRow = ["Pins/nails", numPins, "each"];
  if (unitPrice !== null) pinRow.push("", "");
  const threadRow = ["Thread (approx.)", Math.round(threadLength * 10) / 10, frameSizeUnit];
  if (unitPrice !== null) {
    const cost = roundMoney(threadLength * unitPrice);
    threadRow.push(unitPrice.toFixed(2), cost.toFixed(2));
  }
  return toCsv(headers, [pinRow, threadRow]);
}

/** Adaptive mode's color shopping list -- every unique color the mosaic
 * uses, how many grid cells' worth of it are needed, and the nearest real
 * paint match in Sherwin-Williams, Behr, and Krylon -- the adaptive
 * equivalent of buildPaletteCsv. Because adaptive tile colors are
 * continuous per-tile averages rather than a small fixed palette, this
 * list is naturally longer for busy/gradient-heavy source images and
 * stays short for flat, blocky ones. */
/** unitPrice, if given, is a rough price per cell -- appends
 * "unit_price"/"cost" columns and a trailing TOTAL row. */
export function buildAdaptiveShoppingListCsv(leaves, unitPrice = null) {
  const counts = adaptiveColorCounts(leaves);
  const matches = nearestPaintMatchesAllBrands(counts.map(c => c.rgb));
  const headers = ["hex", "r", "g", "b", "cell_count",
    "sherwin_williams_match", "behr_match", "krylon_match", "best_match"];
  if (unitPrice !== null) headers.push("unit_price", "cost");
  let totalCost = 0;
  const rows = counts.map((c, i) => {
    const row = [
      c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.count,
      formatMatch(matches[i]["Sherwin-Williams"]),
      formatMatch(matches[i]["Behr"]),
      formatMatch(matches[i]["Krylon"]),
      formatBestMatch(matches[i].best),
    ];
    if (unitPrice !== null) {
      const cost = roundMoney(c.count * unitPrice);
      totalCost += cost;
      row.push(unitPrice.toFixed(2), cost.toFixed(2));
    }
    return row;
  });
  if (unitPrice !== null) {
    rows.push(["TOTAL", "", "", "", "", "", "", "", "", "", roundMoney(totalCost).toFixed(2)]);
  }
  return toCsv(headers, rows);
}

/** Dice mode's shopping list -- how many dice show each face (1-6).
 * unitPrice, if given, is a rough price per die -- appends
 * "unit_price"/"cost" columns and a trailing TOTAL row. */
export function buildDiceShoppingListCsv(pipGrid, unitPrice = null) {
  const headers = ["pips", "count"];
  if (unitPrice !== null) headers.push("unit_price", "cost");
  let totalCost = 0;
  const rows = diceCounts(pipGrid).map(c => {
    const row = [c.pips, c.count];
    if (unitPrice !== null) {
      const cost = roundMoney(c.count * unitPrice);
      totalCost += cost;
      row.push(unitPrice.toFixed(2), cost.toFixed(2));
    }
    return row;
  });
  if (unitPrice !== null) {
    rows.push(["TOTAL", "", "", roundMoney(totalCost).toFixed(2)]);
  }
  return toCsv(headers, rows);
}

/** Rubik's Cube mode's shopping list -- total physical cubes needed, plus
 * how many of the 9 stickers-per-cube across the whole mosaic use each
 * palette color. `palette` may be the plain 6-color RUBIKS_PALETTE or the
 * 7-color includeBlack variant (see rubiks.js's rubiksActivePalette) --
 * names are derived from each entry's own RGB, so either length works.
 * unitPrice, if given, is a rough price per cube -- appends an
 * "estimated_cost" line under the cube total (stickers usually come with
 * the cube, so no per-sticker cost is computed). */
export function buildRubiksShoppingListCsv(grid, palette, gridW, gridH, unitPrice = null) {
  const counts = colorCounts(grid, palette, rubiksNamesForPalette(palette));
  const cubeTotal = rubiksCubeCount(gridW, gridH);
  const lines = [toCsv(["cubes_needed_total", String(cubeTotal)], [])];
  if (unitPrice !== null) {
    lines.push(toCsv(["unit_price", unitPrice.toFixed(2)], []));
    lines.push(toCsv(["estimated_cost", roundMoney(cubeTotal * unitPrice).toFixed(2)], []));
  }
  lines.push("");
  lines.push(toCsv(["color", "hex", "sticker_count"], counts.map(c => [c.name, c.hex, c.count])));
  return lines.join("\r\n");
}

/** Screw Art mode's depth list -- a flat per-screw CSV: row, col
 * (1-indexed), depth_mm -- a direct instruction list (one row per screw)
 * rather than a count-per-category shopping list, since depth here is a
 * continuous value with no discrete categories the way Dice's pip counts
 * or Rubik's sticker colors are. `depthGrid` is a flat Float64Array/Array
 * (row-major, length screwsWide*screwsTall). Mirrors mosaic_core.py's
 * export_screwart_depth_csv. */
export function buildScrewartDepthCsv(depthGrid, screwsWide, screwsTall) {
  const lines = [toCsv(["screws_needed_total", String(screwsWide * screwsTall)], [])];
  lines.push("");
  const rows = [];
  for (let row = 0; row < screwsTall; row++) {
    for (let col = 0; col < screwsWide; col++) {
      rows.push([row + 1, col + 1, depthGrid[row * screwsWide + col].toFixed(2)]);
    }
  }
  lines.push(toCsv(["row", "col", "depth_mm"], rows));
  return lines.join("\r\n");
}

/** Cross-Stitch mode's shopping list -- every DMC floss color used, its
 * number/name, and how many stitches need it. `grid` is a flat [r,g,b]
 * array (row-major, DMC-quantized).
 *
 * unitPrice, if given, is a rough price per skein of floss. Floss is
 * bought by the skein, not the stitch, so this first estimates
 * skeinsNeeded = ceil(stitchCount / stitchesPerSkein) -- 800 stitches is a
 * commonly-cited rule of thumb for one skein on 14-count Aida with two
 * strands, but actual yield varies with fabric count and stitch coverage,
 * so treat this as a ballpark, not a precise order quantity. Appends
 * "skeins_needed"/"unit_price"/"cost" columns and a trailing TOTAL row. */
export function buildCrossStitchShoppingListCsv(grid, unitPrice = null, stitchesPerSkein = 800) {
  const used = dmcColorCounts(grid).filter(c => c.count > 0);
  const headers = ["dmc_number", "color_name", "hex", "stitch_count", "dmc_url"];
  if (unitPrice !== null) headers.push("skeins_needed", "unit_price", "cost");
  let totalCost = 0;
  const rows = used.map(c => {
    const row = [c.number, c.name, c.hex, c.count, c.url];
    if (unitPrice !== null) {
      const skeins = Math.ceil(c.count / stitchesPerSkein);
      const cost = roundMoney(skeins * unitPrice);
      totalCost += cost;
      row.push(skeins, unitPrice.toFixed(2), cost.toFixed(2));
    }
    return row;
  });
  if (unitPrice !== null) {
    rows.push(["TOTAL", "", "", "", "", "", "", roundMoney(totalCost).toFixed(2)]);
  }
  return toCsv(headers, rows);
}
