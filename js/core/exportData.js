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
import { rubiksCubeCount, RUBIKS_COLOR_NAMES } from "./rubiks.js";
import { adaptiveColorCounts } from "./adaptive.js";
import { nearestPaintMatchesAllBrands, formatMatch, formatBestMatch } from "./paintColors.js";
import { dmcColorCounts } from "./crossstitch.js";

function csvEscape(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
export function buildPaletteCsv(grid, palette, names = []) {
  const counts = colorCounts(grid, palette, names);
  const matches = nearestPaintMatchesAllBrands(counts.map(c => c.rgb));
  const rows = counts.map((c, i) => [
    i + 1, c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.name, c.count,
    formatMatch(matches[i]["Sherwin-Williams"]),
    formatMatch(matches[i]["Behr"]),
    formatMatch(matches[i]["Krylon"]),
    formatBestMatch(matches[i].best),
  ]);
  return toCsv(["color_number", "hex", "r", "g", "b", "name", "count",
    "sherwin_williams_match", "behr_match", "krylon_match", "best_match"], rows);
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

export function buildShoppingListCsv(bricks, palette, names = []) {
  const counts = brickCounts(bricks, palette, names);
  const rows = counts.map(c => [c.footprint, c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.name, c.count]);
  return toCsv(["footprint", "hex", "r", "g", "b", "name", "count"], rows);
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

/** Adaptive mode's color shopping list -- every unique color the mosaic
 * uses, how many grid cells' worth of it are needed, and the nearest real
 * paint match in Sherwin-Williams, Behr, and Krylon -- the adaptive
 * equivalent of buildPaletteCsv. Because adaptive tile colors are
 * continuous per-tile averages rather than a small fixed palette, this
 * list is naturally longer for busy/gradient-heavy source images and
 * stays short for flat, blocky ones. */
export function buildAdaptiveShoppingListCsv(leaves) {
  const counts = adaptiveColorCounts(leaves);
  const matches = nearestPaintMatchesAllBrands(counts.map(c => c.rgb));
  const rows = counts.map((c, i) => [
    c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.count,
    formatMatch(matches[i]["Sherwin-Williams"]),
    formatMatch(matches[i]["Behr"]),
    formatMatch(matches[i]["Krylon"]),
    formatBestMatch(matches[i].best),
  ]);
  return toCsv(["hex", "r", "g", "b", "cell_count",
    "sherwin_williams_match", "behr_match", "krylon_match", "best_match"], rows);
}

/** Dice mode's shopping list -- how many dice show each face (1-6). */
export function buildDiceShoppingListCsv(pipGrid) {
  const rows = diceCounts(pipGrid).map(c => [c.pips, c.count]);
  return toCsv(["pips", "count"], rows);
}

/** Rubik's Cube mode's shopping list -- total physical cubes needed, plus
 * how many of the 9 stickers-per-cube across the whole mosaic use each of
 * the 6 fixed cube colors. */
export function buildRubiksShoppingListCsv(grid, palette, gridW, gridH) {
  const counts = colorCounts(grid, palette, RUBIKS_COLOR_NAMES);
  const cubeTotal = rubiksCubeCount(gridW, gridH);
  const lines = [
    toCsv(["cubes_needed_total", String(cubeTotal)], []),
    "",
    toCsv(["color", "hex", "sticker_count"], counts.map(c => [c.name, c.hex, c.count])),
  ];
  return lines.join("\r\n");
}

/** Cross-Stitch mode's shopping list -- every DMC floss color used, its
 * number/name, and how many stitches need it. `grid` is a flat [r,g,b]
 * array (row-major, DMC-quantized). */
export function buildCrossStitchShoppingListCsv(grid) {
  const used = dmcColorCounts(grid).filter(c => c.count > 0);
  return toCsv(["dmc_number", "color_name", "hex", "stitch_count"],
    used.map(c => [c.number, c.name, c.hex, c.count]));
}
