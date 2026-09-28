/**
 * worker.js
 * Runs the CPU-heavy steps (K-Means/fixed-palette quantization, brick
 * layout) off the main thread, mirroring the desktop app's use of
 * background threads to keep the UI responsive during generation.
 */

import { quantizePoints } from "./core/kmeans.js";
import { quantizeToFixedPalette } from "./core/quantize.js";
import { computeBrickLayout } from "./core/bricks.js";
import { generateStringartSequence } from "./core/stringart.js";

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    let result;
    if (type === "quantize-auto") {
      const { points, nColors } = payload;
      const { labels, palette, chosenK } = quantizePoints(points, nColors);
      result = { labels, palette, chosenK };
    } else if (type === "quantize-fixed") {
      const { points, palette } = payload;
      const { labels } = quantizeToFixedPalette(points, palette);
      result = { labels, palette };
    } else if (type === "bricks") {
      const { grid, gridW, gridH, allowedSizes } = payload;
      const bricks = computeBrickLayout(grid, gridW, gridH, allowedSizes);
      result = { bricks };
    } else if (type === "stringart") {
      // The greedy loop is the one genuinely slow step in this app that
      // isn't already backed by a fast vectorized library (K-Means/fixed-
      // palette quantization are still routed through the worker mostly
      // for consistency) -- at the top of the pin/line sliders' range this
      // can take several seconds, so it runs here to keep the tab
      // responsive instead of freezing the main thread.
      const { target, shape, numPins, numLines } = payload;
      const { sequence, canvas } = generateStringartSequence(target, shape, numPins, numLines);
      result = { sequence, canvas };
    } else {
      throw new Error(`Unknown worker task type: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
