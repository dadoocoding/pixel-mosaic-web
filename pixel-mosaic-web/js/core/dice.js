/**
 * dice.js
 * Dice/pip mosaic: grayscale-downsample the source image, contrast-stretch
 * it onto the die/pip color scheme's actual achievable brightness range,
 * Floyd-Steinberg dither it down to 6 discrete pip levels, and render each
 * cell as a die face. Ported from mosaic_core.py's pip_level_brightness /
 * dither_to_pips / _stretch_to_range / render_dice_mosaic / dice_counts /
 * render_dice_key (same weights, same formulas, same standard Western dice
 * pip-layout convention).
 *
 * Pip/gray grids use the same flat, row-major convention as every other
 * grid in this project (e.g. edges.js's edgeMask): length gridW*gridH,
 * index = row*gridW + col.
 */

// Standard Western dice pip layout: one fixed orientation per "handed"
// value (2 and 3 share a top-left-to-bottom-right diagonal; 6 is two
// vertical columns of 3). 1, 4, 5 are rotation-symmetric so orientation
// doesn't matter for them. Coordinates are fractions of the face's own
// bounding box (0,0 = top-left corner, 1,1 = bottom-right).
export const PIP_LAYOUTS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.18], [0.25, 0.5], [0.25, 0.82], [0.75, 0.18], [0.75, 0.5], [0.75, 0.82]],
};

// Rough perceptual coverage of a die face's total area taken up by its
// pips, increasing with pip count -- not a literal geometry model, just
// enough of an approximation that predicted brightness genuinely orders
// 1..6 by how much of the face's color a viewer would see, whatever
// die/pip colors are chosen.
const PIP_COVERAGE = [0.05, 0.10, 0.16, 0.22, 0.27, 0.32];

function srgbLuminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Predicted at-a-distance brightness of each die face (pip count 1-6),
 * blending dieColor and pipColor by each face's estimated pip coverage --
 * the dithering quantization targets. This is what makes the dithered
 * pattern's aggregate density track the source image's brightness
 * regardless of which die/pip colors are picked. */
export function pipLevelBrightness(dieColor, pipColor) {
  const dieLum = srgbLuminance(dieColor);
  const pipLum = srgbLuminance(pipColor);
  return PIP_COVERAGE.map(c => dieLum * (1 - c) + pipLum * c);
}

/**
 * grayGrid: flat Float64Array/Array of length gridW*gridH (see
 * imageToGrayGrid). Floyd-Steinberg error-diffusion dither down to the 6
 * brightness levels in levelBrightness (index i -> pip count i+1). Returns
 * a flat Uint8Array of pip counts (1-6), same length/layout as grayGrid.
 */
export function ditherToPips(grayGrid, gridW, gridH, levelBrightness) {
  const work = Float64Array.from(grayGrid);
  const pipGrid = new Uint8Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      const oldVal = work[i];
      let bestIdx = 0, bestDist = Infinity;
      for (let k = 0; k < levelBrightness.length; k++) {
        const dist = Math.abs(levelBrightness[k] - oldVal);
        if (dist < bestDist) { bestDist = dist; bestIdx = k; }
      }
      pipGrid[i] = bestIdx + 1;
      const error = oldVal - levelBrightness[bestIdx];
      if (x + 1 < gridW) work[i + 1] += error * 7 / 16;
      if (y + 1 < gridH) {
        if (x - 1 >= 0) work[i + gridW - 1] += error * 3 / 16;
        work[i + gridW] += error * 5 / 16;
        if (x + 1 < gridW) work[i + gridW + 1] += error * 1 / 16;
      }
    }
  }
  return pipGrid;
}

function percentile(sortedValues, pct) {
  const n = sortedValues.length;
  if (n === 1) return sortedValues[0];
  // Linear-interpolation percentile, matching numpy.percentile's default.
  const rank = (pct / 100) * (n - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo === hi) return sortedValues[lo];
  const frac = rank - lo;
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}

/**
 * Contrast-stretch grayGrid so its (lowPct, highPct) percentiles map onto
 * [targetMin, targetMax], clipping beyond that. Without this, most real
 * photos -- which span close to the full 0-255 range -- would clip almost
 * entirely to the darkest/lightest pip level, since a die's actual
 * achievable brightness range (blending dieColor and pipColor) is usually
 * much narrower than 0-255. Percentile-based (not literal min/max) so a
 * handful of outlier pixels can't compress the useful range.
 */
export function stretchToRange(grayGrid, targetMin, targetMax, lowPct = 2.0, highPct = 98.0) {
  const sorted = Float64Array.from(grayGrid).sort();
  const lo = percentile(sorted, lowPct);
  const hi = percentile(sorted, highPct);
  const out = new Float64Array(grayGrid.length);
  if (hi - lo < 1e-6) {
    out.fill((targetMin + targetMax) / 2);
    return out;
  }
  for (let i = 0; i < grayGrid.length; i++) {
    const normalized = Math.min(1, Math.max(0, (grayGrid[i] - lo) / (hi - lo)));
    out[i] = targetMin + normalized * (targetMax - targetMin);
  }
  return out;
}

/** Downsample sourceCanvas to a flat gridW*gridH grayscale grid (box-filter
 * average of per-pixel luminance, same weights/averaging convention as
 * grid.js's imageToGrid) -- the grayscale equivalent of imageToGrid, for
 * dice mode's dithering input. */
export function imageToGrayGrid(sourceCanvas, gridW, gridH) {
  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const src = ctx.getImageData(0, 0, sw, sh).data;

  const sums = new Float64Array(gridW * gridH);
  const counts = new Float64Array(gridW * gridH);

  for (let y = 0; y < sh; y++) {
    const gy = Math.min(gridH - 1, Math.floor((y / sh) * gridH));
    const rowBase = gy * gridW;
    for (let x = 0; x < sw; x++) {
      const gx = Math.min(gridW - 1, Math.floor((x / sw) * gridW));
      const cell = rowBase + gx;
      const srcIdx = (y * sw + x) * 4;
      sums[cell] += 0.299 * src[srcIdx] + 0.587 * src[srcIdx + 1] + 0.114 * src[srcIdx + 2];
      counts[cell]++;
    }
  }

  const grid = new Float64Array(gridW * gridH);
  for (let i = 0; i < grid.length; i++) grid[i] = sums[i] / (counts[i] || 1);
  return grid;
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

/**
 * Render a pip-count grid (see ditherToPips) as die faces. When
 * outlineColor is given, each face also gets a thin border -- used for the
 * print build guide, where faces are rendered white-on-white and need a
 * visible boundary.
 */
export function renderDiceMosaic(pipGrid, gridW, gridH, cellSize, dieColor, pipColor, bgColor,
                                  createCanvasFn, options = {}) {
  const {
    gapFrac = 0.08, cornerRadiusFrac = 0.15, pipRadiusFrac = 0.09, outlineColor = null,
  } = options;
  const imgW = gridW * cellSize, imgH = gridH * cellSize;
  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  const gap = cellSize * gapFrac;
  const radius = Math.max(1, cellSize * cornerRadiusFrac);
  const pipR = Math.max(1, cellSize * pipRadiusFrac);

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const x0 = col * cellSize, y0 = row * cellSize;
      const fx0 = x0 + gap, fy0 = y0 + gap;
      const faceW = cellSize - 2 * gap, faceH = cellSize - 2 * gap;
      roundedRectPath(ctx, fx0, fy0, faceW, faceH, radius);
      ctx.fillStyle = `rgb(${dieColor.join(",")})`;
      ctx.fill();
      if (outlineColor) {
        ctx.strokeStyle = `rgb(${outlineColor.join(",")})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const k = pipGrid[row * gridW + col];
      ctx.fillStyle = `rgb(${pipColor.join(",")})`;
      for (const [fx, fy] of PIP_LAYOUTS[k]) {
        const cx = fx0 + fx * faceW, cy = fy0 + fy * faceH;
        ctx.beginPath();
        ctx.ellipse(cx, cy, pipR, pipR, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

/** How many cells use each pip value (1-6) -- the dice shopping list. */
export function diceCounts(pipGrid) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pipGrid.length; i++) counts[pipGrid[i] - 1]++;
  return counts.map((count, i) => ({ pips: i + 1, count }));
}

/** Legend/shopping-list page: one row per pip value, a rendered face
 * glyph, and how many of that face the build needs. */
export function renderDiceKey(pipGrid, dieColor, pipColor, createCanvasFn, options = {}) {
  const {
    bgColor = [255, 255, 255], textColor = [20, 20, 20], lineColor = [210, 210, 210],
    swatchSize = 60,
  } = options;
  const counts = new Map(diceCounts(pipGrid).map(c => [c.pips, c.count]));
  const pad = 20;
  const rowH = swatchSize + 14;
  const imgW = 420;
  const imgH = pad * 2 + 40 + rowH * 6;

  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Dice Key / Shopping List", pad, pad + 22);

  let y = pad + 40;
  for (let k = 1; k <= 6; k++) {
    const x0 = pad, y0 = y;
    const faceW = swatchSize, faceH = swatchSize;
    roundedRectPath(ctx, x0, y0, faceW, faceH, swatchSize * 0.15);
    ctx.fillStyle = `rgb(${dieColor.join(",")})`;
    ctx.fill();
    ctx.strokeStyle = `rgb(${lineColor.join(",")})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const pipR = Math.max(1, swatchSize * 0.09);
    ctx.fillStyle = `rgb(${pipColor.join(",")})`;
    for (const [fx, fy] of PIP_LAYOUTS[k]) {
      const cx = x0 + fx * faceW, cy = y0 + fy * faceH;
      ctx.beginPath();
      ctx.ellipse(cx, cy, pipR, pipR, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const labelX = x0 + faceW + 16;
    ctx.fillStyle = `rgb(${textColor.join(",")})`;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`Face #${k}`, labelX, y0 + 2 + 16);

    ctx.fillStyle = "rgb(120,120,120)";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${counts.get(k) || 0} dice needed`, labelX, y0 + 24 + 13);

    y += rowH;
  }

  return canvas;
}
