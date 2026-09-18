/**
 * exportData.js
 * Build JSON/CSV strings (for client-side download, no filesystem access)
 * matching mosaic_core.py's export_json / export_csv / export_palette_csv /
 * export_bricks_json / export_bricks_csv / export_brick_shopping_list_csv.
 */

import { rgbToHex } from "./color.js";
import { colorCounts } from "./colorCounts.js";
import { footprintLabel, brickCounts } from "./bricks.js";

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

export function buildPaletteCsv(grid, palette, names = []) {
  const counts = colorCounts(grid, palette, names);
  const rows = counts.map((c, i) => [i + 1, c.hex, c.rgb[0], c.rgb[1], c.rgb[2], c.name, c.count]);
  return toCsv(["color_number", "hex", "r", "g", "b", "name", "count"], rows);
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
