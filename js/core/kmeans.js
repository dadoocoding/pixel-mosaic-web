/**
 * kmeans.js
 * From-scratch K-means (Lloyd's algorithm + k-means++ init, weighted,
 * multiple restarts) operating on RGB points -- no external ML dependency,
 * matching this project's vanilla-JS approach.
 *
 * Ported behavior from mosaic_core.py's `_kmeans_palette` / `auto_color_count`
 * (same n_init=4 restart count, same elbow-detection auto color count), but
 * clusters *unique* colors weighted by frequency rather than every raw pixel
 * -- mathematically identical result, much faster on real photos where many
 * cells share the same downsampled color.
 */

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Collapse a flat array of [r,g,b] points into unique colors + counts. */
export function uniqueColorsWithCounts(points) {
  const map = new Map();
  for (const p of points) {
    const key = ((p[0] & 255) << 16) | ((p[1] & 255) << 8) | (p[2] & 255);
    const entry = map.get(key);
    if (entry) entry.count++;
    else map.set(key, { point: p, count: 1 });
  }
  const uniquePoints = [];
  const counts = [];
  for (const { point, count } of map.values()) {
    uniquePoints.push(point);
    counts.push(count);
  }
  return { uniquePoints, counts };
}

function weightedKmeansPlusPlusInit(points, weights, k, rng) {
  const n = points.length;
  const centers = [points[Math.floor(rng() * n)]];
  const distSq = new Float64Array(n);

  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const center of centers) {
        const d = sqDist(points[i], center);
        if (d < best) best = d;
      }
      distSq[i] = best * weights[i];
      sum += distSq[i];
    }
    let r = rng() * (sum || 1);
    let idx = 0;
    for (; idx < n; idx++) {
      r -= distSq[idx];
      if (r <= 0) break;
    }
    centers.push(points[Math.min(idx, n - 1)]);
  }
  return centers;
}

function runWeightedKmeansOnce(points, weights, k, rng, maxIter = 100) {
  const n = points.length;
  k = Math.min(k, n);
  let centers = weightedKmeansPlusPlusInit(points, weights, k, rng);
  const labels = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(points[i], centers[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }

    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const totalW = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = labels[i], w = weights[i];
      sums[c][0] += points[i][0] * w;
      sums[c][1] += points[i][1] * w;
      sums[c][2] += points[i][2] * w;
      totalW[c] += w;
    }
    centers = centers.map((old, c) =>
      totalW[c] === 0 ? old : [sums[c][0] / totalW[c], sums[c][1] / totalW[c], sums[c][2] / totalW[c]]
    );

    if (!changed && iter > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += sqDist(points[i], centers[labels[i]]) * weights[i];
  return { labels, centers, inertia, k };
}

/** Weighted K-means with multiple restarts, keeping the lowest-inertia run. */
export function weightedKmeans(points, weights, k, { nInit = 4, seed = 42 } = {}) {
  let best = null;
  for (let trial = 0; trial < nInit; trial++) {
    const rng = mulberry32(seed + trial * 7919);
    const result = runWeightedKmeansOnce(points, weights, k, rng);
    if (!best || result.inertia < best.inertia) best = result;
  }
  return best;
}

/** Elbow-method auto color count, mirroring mosaic_core.py's auto_color_count. */
export function autoColorCount(uniquePoints, counts, { kMin = 3, kMax = 24, seed = 42 } = {}) {
  kMax = Math.max(kMin, Math.min(kMax, uniquePoints.length - 1, 24));
  if (kMax <= kMin) return kMin;

  // Subsample for speed if there are a lot of unique colors.
  let samplePoints = uniquePoints, sampleWeights = counts;
  if (uniquePoints.length > 3000) {
    const rng = mulberry32(seed);
    const idx = new Set();
    while (idx.size < 3000) idx.add(Math.floor(rng() * uniquePoints.length));
    const arr = Array.from(idx);
    samplePoints = arr.map(i => uniquePoints[i]);
    sampleWeights = arr.map(i => counts[i]);
  }

  const ks = [], inertias = [];
  for (let k = kMin; k <= kMax; k++) {
    const { inertia } = weightedKmeans(samplePoints, sampleWeights, k, { nInit: 2, seed });
    ks.push(k);
    inertias.push(inertia);
  }

  const yMin = Math.min(...inertias), yMax = Math.max(...inertias);
  const xMin = ks[0], xMax = ks[ks.length - 1];
  const yRange = (yMax - yMin) || 1;
  const xRange = (xMax - xMin) || 1;

  const p1 = [0, (inertias[0] - yMin) / yRange];
  const p2 = [1, (inertias[inertias.length - 1] - yMin) / yRange];
  const lineVec = [p2[0] - p1[0], p2[1] - p1[1]];
  const lineLen = Math.hypot(...lineVec) || 1;
  const lineUnit = [lineVec[0] / lineLen, lineVec[1] / lineLen];

  let bestIdx = 0, bestDist = -1;
  for (let i = 0; i < ks.length; i++) {
    const xNorm = (ks[i] - xMin) / xRange;
    const yNorm = (inertias[i] - yMin) / yRange;
    const px = xNorm - p1[0], py = yNorm - p1[1];
    const proj = px * lineUnit[0] + py * lineUnit[1];
    const dist = Math.hypot(px - proj * lineUnit[0], py - proj * lineUnit[1]);
    if (dist > bestDist) { bestDist = dist; bestIdx = i; }
  }
  return ks[bestIdx];
}

/**
 * Quantize a flat array of [r,g,b] points (e.g. a flattened grid) down to
 * nColors (or auto-chosen if null/0). Returns { labels, palette } where
 * labels[i] indexes into palette for points[i], and palette is a list of
 * [r,g,b] (rounded to integers, like the Python version's uint8 centers).
 */
export function quantizePoints(points, nColors, { seed = 42 } = {}) {
  const { uniquePoints, counts } = uniqueColorsWithCounts(points);

  let k = nColors;
  if (!k || k <= 0) {
    k = autoColorCount(uniquePoints, counts, { seed });
  }
  k = Math.max(1, Math.min(k, uniquePoints.length));

  const { centers } = weightedKmeans(uniquePoints, counts, k, { nInit: 4, seed });
  const palette = centers.map(c => c.map(v => Math.round(Math.max(0, Math.min(255, v)))));

  // Final assignment pass over every original point (not just uniques).
  const labels = new Int32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let best = 0, bestDist = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const d = sqDist(points[i], palette[c]);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    labels[i] = best;
  }

  return { labels, palette, chosenK: k };
}
