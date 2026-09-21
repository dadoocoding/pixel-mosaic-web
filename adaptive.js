/**
 * adaptive.js
 * Quadtree-based adaptive mosaic: splits the grid into variable-size tiles
 * based on local luminance variance -- flat regions (a plain background)
 * merge into one big tile, busy regions (edges, texture) keep subdividing
 * down to a single grid cell. Ported from mosaic_core.py's build_quadtree
 * (same luminance weights, same sensitivity -> threshold mapping) and
 * render_adaptive_mosaic (rounded-square leaf tiles with a small gap).
 *
 * Unlike the fixed grid/shape modes, there's no separate "max tile" size --
 * grid_w/grid_h and cellSize keep their normal meaning (finest possible
 * tile count / output px per finest cell), and the largest a tile can grow
 * is bounded naturally by the whole grid.
 */

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * grid: flat [r,g,b] array from imageToGrid (grid.js), row-major, length
 * gridW*gridH. Returns a flat list of leaf tiles: { x, y, w, h, rgb } in
 * grid CELL units (multiply by cellSize to get output pixels, same
 * convention as every other render function in this project).
 */
export function buildQuadtree(grid, gridW, gridH, sensitivity = 55) {
  const n = gridW * gridH;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = grid[i];
    lum[i] = luminance(r, g, b);
  }

  let sum = 0;
  for (let i = 0; i < n; i++) sum += lum[i];
  const mean = sum / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = lum[i] - mean;
    sqDiff += d * d;
  }
  const globalVariance = sqDiff / n || 1;

  const clamped = Math.max(0, Math.min(100, sensitivity));
  const threshold = globalVariance * Math.pow((100 - clamped) / 100, 2);

  const leaves = [];

  function regionVariance(x, y, w, h) {
    const count = w * h;
    let s = 0;
    for (let ry = y; ry < y + h; ry++) {
      const base = ry * gridW;
      for (let rx = x; rx < x + w; rx++) s += lum[base + rx];
    }
    const m = s / count;
    let sq = 0;
    for (let ry = y; ry < y + h; ry++) {
      const base = ry * gridW;
      for (let rx = x; rx < x + w; rx++) {
        const d = lum[base + rx] - m;
        sq += d * d;
      }
    }
    return sq / count;
  }

  function makeLeaf(x, y, w, h) {
    const count = w * h;
    let rs = 0, gs = 0, bs = 0;
    for (let ry = y; ry < y + h; ry++) {
      const base = ry * gridW;
      for (let rx = x; rx < x + w; rx++) {
        const [r, g, b] = grid[base + rx];
        rs += r; gs += g; bs += b;
      }
    }
    leaves.push({
      x, y, w, h,
      rgb: [Math.round(rs / count), Math.round(gs / count), Math.round(bs / count)],
    });
  }

  function split(x, y, w, h) {
    if (w <= 1 && h <= 1) { makeLeaf(x, y, w, h); return; }
    if (regionVariance(x, y, w, h) <= threshold) { makeLeaf(x, y, w, h); return; }
    if (w > 1 && h > 1) {
      const w1 = w >> 1, h1 = h >> 1;
      split(x, y, w1, h1);
      split(x + w1, y, w - w1, h1);
      split(x, y + h1, w1, h - h1);
      split(x + w1, y + h1, w - w1, h - h1);
    } else if (w > 1) {
      const w1 = w >> 1;
      split(x, y, w1, h);
      split(x + w1, y, w - w1, h);
    } else {
      const h1 = h >> 1;
      split(x, y, w, h1);
      split(x, y + h1, w, h - h1);
    }
  }

  split(0, 0, gridW, gridH);
  return leaves;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Render quadtree leaf tiles (see buildQuadtree) as rounded squares, sized
 * to each tile's own footprint, with a small gap between tiles. */
export function renderAdaptiveMosaic(leaves, gridW, gridH, cellSize, bgColor, createCanvasFn,
                                      options = {}) {
  const { padFrac = 0.06, cornerRadiusFrac = 0.16 } = options;
  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  for (const leaf of leaves) {
    const x0 = leaf.x * cellSize, y0 = leaf.y * cellSize;
    const wPx = leaf.w * cellSize, hPx = leaf.h * cellSize;
    const pad = Math.min(wPx, hPx) * padFrac;
    const radius = Math.max(1, Math.min(wPx, hPx) * cornerRadiusFrac);
    roundedRectPath(ctx, x0 + pad, y0 + pad, wPx - 2 * pad, hPx - 2 * pad, radius);
    ctx.fillStyle = `rgb(${leaf.rgb.join(",")})`;
    ctx.fill();
  }
  return canvas;
}
