/**
 * stringart.js
 * Pins around a circular or rectangular frame, connected by one continuous
 * thread whose crossings approximate the source photo in grayscale.
 * Monochrome thread only, for now -- multi-color (several layered passes)
 * is a possible future sub-mode, not built here. Ported from
 * mosaic_core.py's matching functions.
 *
 * The greedy "darkest-improvement" algorithm is chaotic/cascading under
 * tiny floating-point divergence (unlike, say, Lithophane's one-shot
 * deterministic STL geometry), so cross-language parity for this mode is
 * tolerance-based, not bit-exact -- see parity_stringart.mjs, which feeds
 * JS the same Python-computed target array + pin positions to eliminate
 * resize/trig divergence, then compares final coverage canvases within a
 * tolerance rather than asserting an identical pin sequence.
 */

export const STRINGART_MIN_PINS = 60;
export const STRINGART_MAX_PINS = 360; // one pin per degree at the circular frame's max
export const STRINGART_MIN_LINES = 50;
export const STRINGART_MAX_LINES = 3000;
// Both sliders independently bound the compute cost (unlike Lithophane's
// width/height, whose *ratio* could blow the triangle count past either
// slider's own max) -- pins x lines is the whole cost of the greedy loop,
// so there's no oversized-combination case that needs its own
// friendly-error guard the way Lithophane's aspect ratio did.
export const STRINGART_WORKING_SIZE = 350; // px, internal square working canvas both frame shapes sample onto
export const STRINGART_LINE_WEIGHT = 18.0; // 0-255 darkness removed from every pixel a thread line crosses
export const STRINGART_SKIP_ADJACENT = 3; // candidate pins within this many indices of the current pin are skipped

/** Pin [x, y] positions around the frame, index 0..numPins-1, evenly
 * spaced. Circular: pin 0 at the top (12 o'clock), going clockwise.
 * Rectangular: pin 0 at the top-left corner, going clockwise around the
 * perimeter (top edge, right edge, bottom edge, left edge) -- evenly
 * spaced by arc length along the total perimeter (not by count-per-side),
 * so pin spacing stays visually consistent even on a tall/narrow frame. */
export function stringartPinPositions(shape, numPins, size = STRINGART_WORKING_SIZE) {
  if (numPins < 2) throw new Error("Need at least 2 pins.");
  const positions = [];
  if (shape === "circle") {
    const cx = size / 2.0, cy = size / 2.0;
    const r = size / 2.0 - 1.0;
    for (let i = 0; i < numPins; i++) {
      const theta = -Math.PI / 2 + (2 * Math.PI * i) / numPins;
      positions.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
    }
  } else if (shape === "rect") {
    const margin = 1.0;
    const w = size - 2 * margin, h = size - 2 * margin;
    const perim = 2 * (w + h);
    for (let i = 0; i < numPins; i++) {
      const t = ((perim * i) / numPins) % perim;
      if (t < w) {
        positions.push([margin + t, margin]);
      } else if (t < w + h) {
        positions.push([margin + w, margin + (t - w)]);
      } else if (t < 2 * w + h) {
        positions.push([margin + w - (t - w - h), margin + h]);
      } else {
        positions.push([margin, margin + h - (t - 2 * w - h)]);
      }
    }
  } else {
    throw new Error(`Unknown string art frame shape: ${shape}`);
  }
  return positions;
}

/** Flat (row-major, y*size+x) pixel indices crossed by the segment from
 * (x0,y0) to (x1,y1): one evenly spaced sample per pixel of the line's
 * length (parametric sampling, not integer-stepping Bresenham -- simpler
 * to port exactly between languages), de-duplicated and clamped to the
 * canvas. Rounds half-up (floor(x+0.5)) rather than JS's Math.round, which
 * itself rounds half-up for positive numbers but diverges from Python's
 * round-half-to-even on a value exactly on a .5 boundary -- using the same
 * floor(x+0.5) formula on both sides avoids that divergence entirely. */
function stringartLinePixelIndices(x0, y0, x1, y1, size) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(dist));
  const seen = new Set();
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    let x = Math.floor(x0 + (x1 - x0) * t + 0.5);
    let y = Math.floor(y0 + (y1 - y0) * t + 0.5);
    x = Math.min(size - 1, Math.max(0, x));
    y = Math.min(size - 1, Math.max(0, y));
    seen.add(y * size + x);
  }
  return Uint32Array.from(seen);
}

/** Box-resample (stretch, independent x/y scale -- the same "fill the
 * frame" convention every other mode's grid/heightmap sampling uses) the
 * source canvas to a size x size grayscale working canvas, flattened
 * row-major. Values run 0 (black) to 255 (white), the same Rec.601
 * luminance formula as every other mode.
 *
 * Unlike grid.js's imageToGrid (which maps forward from every SOURCE pixel
 * to the one grid cell it falls in -- perfect for downsampling, but leaves
 * most cells untouched, and hence pure black, when the grid is *larger*
 * than the source image), this maps backward from every DESTINATION pixel
 * to the source pixel range it should average over, so it stays a real
 * box filter in both directions. STRINGART_WORKING_SIZE is a fixed 350px
 * regardless of the source photo's own resolution, so upsampling a
 * smaller-than-350px source is a real case this mode has to get right,
 * not just a downsampling convenience like every other mode's own grid. */
export function sampleStringartTarget(sourceCanvas, size = STRINGART_WORKING_SIZE) {
  const ctx = sourceCanvas.getContext("2d");
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const src = ctx.getImageData(0, 0, sw, sh).data;
  const target = new Float64Array(size * size);

  for (let gy = 0; gy < size; gy++) {
    const y0 = Math.floor((gy / size) * sh);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor(((gy + 1) / size) * sh)));
    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor((gx / size) * sw);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor(((gx + 1) / size) * sw)));
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * sw + x) * 4;
          sumR += src[idx]; sumG += src[idx + 1]; sumB += src[idx + 2];
          count++;
        }
      }
      const r = sumR / count, g = sumG / count, b = sumB / count;
      target[gy * size + gx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return target;
}

/** The greedy string art algorithm: starting from pin 0, repeatedly picks
 * whichever remaining candidate pin's straight-line thread crossing
 * reduces the total squared error against `target` the most, "draws" it
 * (subtracting lineWeight from every pixel it crosses, clamped at 0), and
 * moves there -- up to numLines lines, stopping early if no candidate
 * would improve the picture at all (further thread would just be wasted,
 * so it's never forced to hit numLines exactly). Returns { sequence,
 * canvas }: sequence is the ordered list of pin indices visited (length =
 * lines drawn + 1, since it includes the starting pin), canvas is the
 * final size*size darkness array (same scale as target: 255 =
 * untouched/white, lower = more thread crossed it). */
export function generateStringartSequence(target, shape, numPins, numLines,
  size = STRINGART_WORKING_SIZE, lineWeight = STRINGART_LINE_WEIGHT) {
  if (numPins < 2) throw new Error("Need at least 2 pins.");
  const positions = stringartPinPositions(shape, numPins, size);
  const canvas = new Float64Array(size * size).fill(255.0);

  // Precompute every pin pair's line rasterization once -- reused across
  // every step of the greedy loop below (each step only re-evaluates the
  // numPins-ish candidates leaving the *current* pin, not all pairs).
  const lineCache = new Map();
  for (let i = 0; i < numPins; i++) {
    for (let j = i + 1; j < numPins; j++) {
      const [x0, y0] = positions[i], [x1, y1] = positions[j];
      lineCache.set(i * numPins + j, stringartLinePixelIndices(x0, y0, x1, y1, size));
    }
  }
  const keyFor = (a, b) => (a < b ? a * numPins + b : b * numPins + a);

  let current = 0;
  const sequence = [0];
  for (let step = 0; step < numLines; step++) {
    let bestJ = null, bestScore = 0.0, bestIdx = null;
    for (let j = 0; j < numPins; j++) {
      if (j === current) continue;
      const d = Math.min(((j - current) % numPins + numPins) % numPins, ((current - j) % numPins + numPins) % numPins);
      if (d < STRINGART_SKIP_ADJACENT) continue;
      const idx = lineCache.get(keyFor(current, j));
      let score = 0.0;
      for (let k = 0; k < idx.length; k++) {
        const px = idx[k];
        const before = canvas[px];
        const after = Math.max(0.0, before - lineWeight);
        const tgt = target[px];
        score += (before - tgt) ** 2 - (after - tgt) ** 2;
      }
      if (score > bestScore) { bestJ = j; bestScore = score; bestIdx = idx; }
    }
    if (bestJ === null) break;
    for (let k = 0; k < bestIdx.length; k++) {
      canvas[bestIdx[k]] = Math.max(0.0, canvas[bestIdx[k]] - lineWeight);
    }
    current = bestJ;
    sequence.push(current);
  }

  return { sequence, canvas };
}

/** Turns the darkness canvas into a color preview: a pixel's coverage (how
 * much thread crossed it) blends linearly from bgColor (no thread) to
 * threadColor (fully covered). For a circular frame, pixels outside the
 * inscribed circle (never reachable by any chord between pins that all sit
 * ON the circle) are drawn as flat bgColor -- there's no real board there,
 * thread physically can't reach it. Draws directly onto a size x size
 * canvas (createCanvasFn(w, h) -> canvas-like object, same convention as
 * renderLithophanePreview). */
export function renderStringartPreview(canvas, shape, size, threadColor, bgColor, createCanvasFn) {
  const out = createCanvasFn(size, size);
  const ctx = out.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  const cx = (size - 1) / 2.0, cy = (size - 1) / 2.0;
  const r = size / 2.0 - 1.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const coverage = Math.min(1.0, Math.max(0.0, 1.0 - canvas[idx] / 255.0));
      let rr = bgColor[0] + (threadColor[0] - bgColor[0]) * coverage;
      let gg = bgColor[1] + (threadColor[1] - bgColor[1]) * coverage;
      let bb = bgColor[2] + (threadColor[2] - bgColor[2]) * coverage;
      if (shape === "circle" && ((x - cx) ** 2 + (y - cy) ** 2 > r * r)) {
        rr = bgColor[0]; gg = bgColor[1]; bb = bgColor[2];
      }
      const p = idx * 4;
      imageData.data[p] = Math.min(255, Math.max(0, Math.round(rr)));
      imageData.data[p + 1] = Math.min(255, Math.max(0, Math.round(gg)));
      imageData.data[p + 2] = Math.min(255, Math.max(0, Math.round(bb)));
      imageData.data[p + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

/** Total thread length in the same physical unit as frameSize: sums the
 * pixel-space distance between every consecutive pin in `sequence` and
 * scales by frameSize / (the working canvas's real-world span) -- the same
 * scale factor for either frame shape, since both use the same size x size
 * working canvas (diameter for circle, side length for rect). */
export function estimateStringartThreadLength(sequence, positions, frameSize, size = STRINGART_WORKING_SIZE) {
  if (frameSize <= 0 || sequence.length < 2) return 0.0;
  let pxTotal = 0.0;
  for (let i = 0; i < sequence.length - 1; i++) {
    const [x0, y0] = positions[sequence[i]], [x1, y1] = positions[sequence[i + 1]];
    pxTotal += Math.hypot(x1 - x0, y1 - y0);
  }
  const scale = frameSize / (size - 2.0);
  return pxTotal * scale;
}

const PIECE_SIZE_UNITS = ["in", "mm", "cm"];

/** Formats a number the same way mosaic_core.py's `_format_number` does --
 * up to 2 decimal places, trailing zeros/decimal point trimmed. */
function formatNumber(n) {
  return (Math.round(n * 100) / 100).toString();
}

/** e.g. formatStringartFrameSize('circle', 12, 'in') -> 'Diameter: 12 in'. */
export function formatStringartFrameSize(shape, frameSize, unit) {
  if (frameSize <= 0) return "";
  const u = PIECE_SIZE_UNITS.includes(unit) ? unit : "in";
  const label = shape === "circle" ? "Diameter" : "Frame size";
  return `${label}: ${formatNumber(frameSize)} ${u}`;
}

/** e.g. formatStringartThreadLength(452.7, 'in') -> '~453 in of thread'. */
export function formatStringartThreadLength(length, unit) {
  if (length <= 0) return "";
  const u = PIECE_SIZE_UNITS.includes(unit) ? unit : "in";
  return `~${formatNumber(length)} ${u} of thread`;
}

/** A print page showing the pins numbered around the frame outline -- the
 * physical layout reference a build works from before following the
 * thread-sequence pages. Every pin gets a dot, but only every Kth pin gets
 * a text label (K chosen to keep ~36 labels on the page regardless of pin
 * count) -- labeling all 360 pins at a legible size would just overlap
 * into an unreadable smear, and a build only needs enough labeled
 * reference points to count a few dots over from the nearest one. */
export function renderStringartPinMap(positions, shape, createCanvasFn, options = {}) {
  const { scale = 3, threadColor = [20, 20, 20], bgColor = [255, 255, 255] } = options;
  const size = STRINGART_WORKING_SIZE;
  const contentSize = size * scale;
  // Side/bottom padding wide enough for a label pushed outward from the
  // frame outline to always land fully inside the canvas, even for a pin
  // sitting right at the left/right/bottom edge.
  const pad = 40;
  const topMargin = 50;
  const imgW = contentSize + pad * 2;
  const imgH = contentSize + topMargin + pad * 2;

  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = "rgb(20,20,20)";
  ctx.font = "22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`String Art Pin Map — ${positions.length} pins (${shape})`, 20, 16);

  const ox = pad, oy = pad + topMargin;
  ctx.strokeStyle = "rgb(180,180,180)";
  ctx.lineWidth = 1;
  if (shape === "circle") {
    const ccx = ox + contentSize / 2.0, ccy = oy + contentSize / 2.0;
    const r = contentSize / 2.0 - scale;
    ctx.beginPath();
    ctx.ellipse(ccx, ccy, r, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const m = scale;
    ctx.strokeRect(ox + m, oy + m, contentSize - 2 * m, contentSize - 2 * m);
  }

  const targetLabels = 36;
  const labelStep = Math.max(1, Math.round(positions.length / targetLabels));
  const cx = ox + contentSize / 2.0, cy = oy + contentSize / 2.0;
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "rgb(70,70,70)";
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = positions[i];
    const px = ox + x * scale, py = oy + y * scale;
    const r = 3;
    ctx.fillStyle = `rgb(${threadColor.join(",")})`;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r, 0, 0, Math.PI * 2);
    ctx.fill();
    if (i % labelStep !== 0) continue;
    const dx = px - cx, dy = py - cy;
    const dlen = Math.hypot(dx, dy) || 1.0;
    const lx = px + (dx / dlen) * 16 - 8;
    const ly = py + (dy / dlen) * 16 - 7;
    ctx.fillStyle = "rgb(70,70,70)";
    ctx.fillText(String(i), lx, ly);
  }
  return canvas;
}

/** One page of the ordered pin sequence, wrapped into a grid of 'step: pin'
 * entries -- printable as a checklist to follow while stringing the
 * thread, pin map in hand. */
export function renderStringartSequencePage(sequence, pageStart, pageEnd, pageLabel, createCanvasFn, options = {}) {
  const { cols = 12, bgColor = [255, 255, 255], textColor = [20, 20, 20] } = options;
  const entries = sequence.slice(pageStart, pageEnd);
  const rows = Math.ceil(entries.length / cols);
  const cellW = 62, cellH = 26;
  const pad = 20;
  const imgW = pad * 2 + cols * cellW;
  const imgH = pad * 2 + 40 + rows * cellH;

  const canvas = createCanvasFn(imgW, imgH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${bgColor.join(",")})`;
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.fillStyle = `rgb(${textColor.join(",")})`;
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(pageLabel, pad, pad);

  const y0 = pad + 32;
  ctx.font = "12px sans-serif";
  for (let k = 0; k < entries.length; k++) {
    const row = Math.floor(k / cols), col = k % cols;
    const x = pad + col * cellW;
    const y = y0 + row * cellH;
    const step = pageStart + k;
    ctx.fillText(`${step}: ${entries[k]}`, x, y);
  }
  return canvas;
}
