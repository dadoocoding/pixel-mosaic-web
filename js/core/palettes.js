/**
 * palettes.js
 * Built-in LEGO solid-color palette and custom palette file parsing
 * (CSV/JSON), ported from mosaic_core.py's LEGO_SOLID_COLORS and
 * load_palette_file / save_palette_file.
 *
 * Community-referenced approximate colors for LEGO's common "solid" brick
 * colors. LEGO doesn't publish official RGB values, so treat these as a
 * solid starting point, not a guaranteed match -- for exact colors,
 * cross-check against BrickLink/Rebrickable or your own bricks, or import
 * your own values via "Import from File".
 */

export const LEGO_SOLID_COLORS = [
  { name: "White", rgb: [244, 244, 244] },
  { name: "Black", rgb: [5, 19, 29] },
  { name: "Bright Red", rgb: [201, 26, 9] },
  { name: "Dark Red", rgb: [114, 14, 15] },
  { name: "Bright Orange", rgb: [254, 138, 24] },
  { name: "Dark Orange", rgb: [169, 85, 0] },
  { name: "Bright Yellow", rgb: [242, 205, 55] },
  { name: "Bright Light Yellow", rgb: [255, 240, 58] },
  { name: "Tan", rgb: [228, 205, 158] },
  { name: "Dark Tan", rgb: [149, 138, 115] },
  { name: "Reddish Brown", rgb: [88, 42, 18] },
  { name: "Dark Brown", rgb: [53, 33, 0] },
  { name: "Nougat", rgb: [208, 145, 104] },
  { name: "Medium Nougat", rgb: [170, 125, 85] },
  { name: "Light Nougat", rgb: [246, 215, 179] },
  { name: "Bright Green", rgb: [75, 159, 74] },
  { name: "Dark Green", rgb: [35, 120, 65] },
  { name: "Bright Yellowish Green", rgb: [165, 202, 24] },
  { name: "Sand Green", rgb: [160, 188, 172] },
  { name: "Olive Green", rgb: [155, 154, 90] },
  { name: "Bright Blue", rgb: [0, 85, 191] },
  { name: "Dark Blue", rgb: [10, 52, 99] },
  { name: "Medium Blue", rgb: [90, 147, 219] },
  { name: "Bright Light Blue", rgb: [159, 195, 233] },
  { name: "Sand Blue", rgb: [96, 116, 161] },
  { name: "Dark Azure", rgb: [7, 139, 201] },
  { name: "Medium Azure", rgb: [54, 174, 191] },
  { name: "Dark Turquoise", rgb: [0, 143, 155] },
  { name: "Bright Purple", rgb: [129, 0, 123] },
  { name: "Dark Purple", rgb: [63, 54, 145] },
  { name: "Medium Lavender", rgb: [172, 120, 186] },
  { name: "Lavender", rgb: [225, 213, 237] },
  { name: "Magenta", rgb: [146, 57, 120] },
  { name: "Bright Pink", rgb: [228, 173, 200] },
  { name: "Light Bluish Gray", rgb: [160, 165, 169] },
  { name: "Dark Bluish Gray", rgb: [108, 110, 104] },
];

function hexToRgbLocal(hex) {
  hex = hex.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Parse a very small CSV (no quoted-comma support needed for this format). */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(c => c.trim());
    const row = {};
    headers.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a custom palette from CSV text (columns: name,hex OR name,r,g,b) or
 * JSON text (list of {"name":.., "hex":..} or {"name":.., "rgb":[r,g,b]}).
 * Returns a list of {name, rgb}.
 */
export function parsePaletteFile(text, filename = "") {
  const isJson = filename.toLowerCase().endsWith(".json") || text.trim().startsWith("[");
  const entries = [];

  if (isJson) {
    const data = JSON.parse(text);
    for (const item of data) {
      let rgb = null;
      if (item.hex) rgb = hexToRgbLocal(item.hex);
      else if (item.rgb) rgb = item.rgb.map(Number);
      if (rgb) entries.push({ name: item.name || "", rgb });
    }
  } else {
    const rows = parseCsv(text);
    for (const row of rows) {
      let rgb = null;
      if (row.hex) rgb = hexToRgbLocal(row.hex);
      else if (row.r !== undefined && row.g !== undefined && row.b !== undefined
               && row.r !== "" && row.g !== "" && row.b !== "") {
        rgb = [Number(row.r), Number(row.g), Number(row.b)];
      }
      if (rgb) entries.push({ name: row.name || "", rgb });
    }
  }
  return entries;
}
