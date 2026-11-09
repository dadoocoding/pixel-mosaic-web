// Compares the JS Layered Relief engine with python/test/_parity_relief_python_output.json.
// Run: (cd python && python3 test/parity_relief.py) && (cd web && node test/parity_relief.mjs)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../site/js/core/relief.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const py = JSON.parse(fs.readFileSync(path.join(here, "../../python/test/_parity_relief_python_output.json"), "utf8"));
const W = 96, H = 120;

// same synthetic picture as parity_relief.py (integer math)
function synth(seed) {
  const rgb = new Uint8Array(W * H * 3);
  const cx = W >> 1, cy = H >> 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 40 + ((x * 3 + y * 2 + seed * 17) % 40);
    const d2 = ((x - cx) * 3) ** 2 + (y - cy) ** 2;
    if (d2 < 2800) v = 150 + ((x * 7 + y * 3 + seed) % 30);
    if ((x - 40) ** 2 + (y - 50) ** 2 < 60) v = 235;
    if ((x - 62) ** 2 + (y - 48) ** 2 < 25) v = 20;
    if ((x - 48) ** 2 + (y - 72) ** 2 < 90) v = 90;
    if (x > 8 && x < 14 && y > 5 && y < 40) v = 200;
    const c = [v, Math.floor((v * 9) / 10) + (x % 7), Math.floor((v * 8) / 10) + (y % 5)];
    for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.min(255, Math.max(0, c[k]));
  }
  return rgb;
}
const sha = (arr) => {
  const b = Buffer.alloc(arr.length * 8);
  for (let i = 0; i < arr.length; i++) b.writeBigInt64LE(BigInt(arr[i]), i * 8);
  return crypto.createHash("sha256").update(b).digest("hex");
};
const sha256 = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

let fails = 0, checks = 0;
const eq = (name, a, b) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log("MISMATCH", name, "\n js:", JSON.stringify(a).slice(0, 300), "\n py:", JSON.stringify(b).slice(0, 300)); }
};

for (const [name, exp] of Object.entries(py)) {
  const c = exp.case;
  const rgb = synth(c.seed);
  const base = R.reliefPrepare(rgb, W, H, c.n, c.smooth, c.minArea);
  const rel = R.reliefAssemble(base, c.layers, c.mode, c.cap, exp.overrides, c.dome);
  eq(`${name} bandColors`, base.bandColors, exp.bandColors);
  eq(`${name} bands`, sha(base.bands), exp.bandsHash);
  eq(`${name} nodes`, rel.nodes.map((n) => [n.id, n.rank, n.band, n.parent, n.key, n.area, n.exposed, n.bbox,
    n.depthScore, n.level, n.step, n.stepDefault, n.num, n.children]), exp.nodes);
  eq(`${name} levelMap`, sha(rel.levelMap), exp.levelHash);
  eq(`${name} nodeMap`, sha(rel.nodeMap), exp.nodeHash);
  eq(`${name} shade`, sha(R.reliefShade(rel, null, R.reliefShadowPx(1.0, 200.0, W))), exp.shadeHash);
  const st = R.reliefStats(rel, 200.0, 1.0);
  const e = exp.stats;
  eq(`${name} stats`, [st.pieces, st.supports, st.sheets, st.levels, st.reliefMm, st.frameDepthMm, st.smallestMm.toFixed(6), st.widthMm, st.heightMm],
    [e.pieces, e.supports, e.sheets, e.levels, e.relief_mm, e.frame_depth_mm, e.smallest_mm.toFixed(6), e.width_mm, e.height_mm]);
  const pts = {};
  for (const [k, v] of R.reliefLabelPoints(rel)) pts[k] = v;
  eq(`${name} labelPoints`, pts, exp.labelPoints);
  eq(`${name} supports`, R.reliefSupportCopies(rel), exp.supports);
  const svgs = {};
  for (const f of R.reliefSvgFiles(rel, 200.0)) svgs[f.name] = sha256(f.text);
  eq(`${name} svgs`, svgs, exp.svgHashes);
}
console.log(fails ? `FAILED ${fails}/${checks}` : `relief parity OK (${checks} checks)`);
process.exit(fails ? 1 : 0);
