/**
 * shape.js
 * Crop + Shape tools shared by every mode. Ported from mosaic_core.py's
 * "Crop + Shape tools" section -- keep the two in sync (parity_shape.*).
 *
 * A "box" is [x0, y0, x1, y1] as FRACTIONS (0-1) of the image it applies
 * to; null means the whole image. The crop box is relative to the ORIGINAL
 * image, the shape box to the already-cropped image. oval/circle also mask
 * out cells outside the ellipse inscribed in the final region.
 */

export const SHAPE_CHOICES = ["none", "rect", "oval", "circle"];
export const SHAPE_LABELS = { none: "None", rect: "Rectangle", oval: "Oval", circle: "Circle" };

/** Round-half-up (matches Python's math.floor(x + 0.5) helper). */
export function halfUp(x) {
  return Math.floor(x + 0.5);
}

export function normalizeBox(box) {
  if (!box) return null;
  const c = (v) => Math.min(1, Math.max(0, Number(v)));
  let [x0, y0, x1, y1] = box.map(c);
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  return [x0, y0, x1, y1];
}

/** Fractional box -> integer pixel rect, at least 1px each way. */
export function boxToPixels(box, width, height) {
  if (!box) return [0, 0, width, height];
  const [x0f, y0f, x1f, y1f] = normalizeBox(box);
  const x0 = Math.min(width - 1, halfUp(x0f * width));
  const y0 = Math.min(height - 1, halfUp(y0f * height));
  const x1 = Math.max(x0 + 1, Math.min(width, halfUp(x1f * width)));
  const y1 = Math.max(y0 + 1, Math.min(height, halfUp(y1f * height)));
  return [x0, y0, x1, y1];
}

/** Final pixel rect in ORIGINAL-image coordinates (crop, then shape box). */
export function regionPixelRect(width, height, cropBox = null, shapeBox = null) {
  const [cx0, cy0, cx1, cy1] = boxToPixels(cropBox, width, height);
  const [sx0, sy0, sx1, sy1] = boxToPixels(shapeBox, cx1 - cx0, cy1 - cy0);
  return [cx0 + sx0, cy0 + sy0, cx0 + sx1, cy0 + sy1];
}

/** New canvas holding just the final region of `canvas`. */
export function applyCropAndShape(canvas, createCanvasFn, cropBox = null, shapeBox = null) {
  const [x0, y0, x1, y1] = regionPixelRect(canvas.width, canvas.height, cropBox, shapeBox);
  const out = createCanvasFn(x1 - x0, y1 - y0);
  out.getContext("2d").drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return out;
}

/** Row-major Uint8Array(gridW*gridH), 1 = cell is part of the build. */
export function shapeMaskGrid(shape, gridW, gridH) {
  const n = Math.max(0, gridW) * Math.max(0, gridH);
  const out = new Uint8Array(n);
  if ((shape !== "oval" && shape !== "circle") || gridW < 1 || gridH < 1) {
    out.fill(1);
    return out;
  }
  for (let y = 0; y < gridH; y++) {
    const ny = ((y + 0.5) / gridH - 0.5) / 0.5;
    for (let x = 0; x < gridW; x++) {
      const nx = ((x + 0.5) / gridW - 0.5) / 0.5;
      out[y * gridW + x] = nx * nx + ny * ny <= 1 ? 1 : 0;
    }
  }
  return out;
}

/** Make a rendered preview canvas transparent outside oval/circle, in place. */
export function applyShapeToCanvas(canvas, shape) {
  if (shape !== "oval" && shape !== "circle") return canvas;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h);
  const mask = shapeMaskGrid(shape, w, h);
  for (let i = 0; i < mask.length; i++) if (!mask[i]) img.data[i * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function shapePieceCount(shape, gridW, gridH) {
  const m = shapeMaskGrid(shape, gridW, gridH);
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

/** 'Circle ⌀ 20 in' / 'Oval 20 × 15 in'; '' for none/rect. */
export function shapeLabelSuffix(shape, widthText, heightText, unit) {
  if (shape === "circle") return `Circle ⌀ ${widthText} ${unit}`;
  if (shape === "oval") return `Oval ${widthText} × ${heightText} ${unit}`;
  return "";
}
