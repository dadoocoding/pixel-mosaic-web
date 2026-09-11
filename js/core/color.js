/**
 * color.js
 * RGB <-> hex <-> CIE Lab conversion utilities.
 * Ported from mosaic_core.py's color-math section (same formulas, same
 * D65 white point) so fixed-palette matching and the monochrome ramp
 * behave identically to the desktop app.
 */

export function rgbToHex([r, g, b]) {
  const c = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToRgb(hex) {
  hex = hex.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map(ch => ch + ch).join("");
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

export function contrastTextColor([r, g, b]) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#000000" : "#ffffff";
}

function srgbToLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  c = Math.max(c, 0);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const D65 = { xn: 0.95047, yn: 1.0, zn: 1.08883 };
const DELTA = 6 / 29;

/** [r,g,b] (0-255) -> [L,a,b] (CIE Lab, D65) */
export function rgbToLab([r, g, b]) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  let z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  x /= D65.xn;
  y /= D65.yn;
  z /= D65.zn;

  const f = t => (t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29);
  const fx = f(x), fy = f(y), fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** [L,a,b] -> [r,g,b] (0-255, clamped) */
export function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const fInv = t => (t > DELTA ? t ** 3 : 3 * DELTA ** 2 * (t - 4 / 29));
  const x = fInv(fx) * D65.xn;
  const y = fInv(fy) * D65.yn;
  const z = fInv(fz) * D65.zn;

  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bch = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  r = linearToSrgb(r);
  g = linearToSrgb(g);
  bch = linearToSrgb(bch);

  const clamp255 = v => Math.min(255, Math.max(0, v * 255));
  return [clamp255(r), clamp255(g), clamp255(bch)];
}
