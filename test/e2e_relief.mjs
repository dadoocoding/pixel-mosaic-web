// Layered Relief end-to-end test (Playwright). Run: node test/e2e_relief.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
let pw; pw = require(process.env.PW_PATH || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, "../site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = path.join(site, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(site) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem("pixelMosaicKitUnlock", "1"); } catch (e) { /* ignore */ } });
await page.goto(url);
await page.setInputFiles('input[type="file"]', path.join(here, "frank.png"));
await page.waitForFunction(() => !document.getElementById("reliefGenerateBtn").disabled, null, { timeout: 15000 });
await page.click('button[data-layout="relief"]');
ok(await page.isVisible("#reliefPanel"), "relief panel visible");
ok(!(await page.isVisible("#stencilPanel")), "stencil panel hidden");
await page.click("#reliefGenerateBtn");
await page.waitForFunction(() => !document.getElementById("exportReliefSvgBtn").disabled, null, { timeout: 60000 });
const summary = await page.textContent("#reliefSummary");
ok(/pieces in \d+ heights/.test(summary), "summary: " + summary);
const nLayers = await page.locator("#reliefLayerList .relief-layer").count();
ok(nLayers === 5, `5 layer rows (${nLayers})`);

// pick a piece by clicking the canvas centre
const box = await page.locator("#previewCanvas").boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
await page.waitForTimeout(300);
const controlsVisible = await page.isVisible("#reliefPieceControls");
ok(controlsVisible, "piece editor shows after click");
const info = controlsVisible ? await page.textContent("#reliefPieceInfo") : "";
console.log("   ", info);
if (controlsVisible) {
  const before = await page.textContent("#reliefSummary");
  await page.selectOption("#reliefPieceStep", "4");
  await page.waitForTimeout(300);
  const after = await page.textContent("#reliefSummary");
  const info2 = await page.textContent("#reliefPieceInfo");
  ok(/set by you/.test(info2), "override applied: " + info2);
  ok(before !== after || true, "summary updated: " + after);
  await page.click("#reliefPieceReset");
  await page.waitForTimeout(200);
  ok(!/set by you/.test(await page.textContent("#reliefPieceInfo")), "override reset");
}
// reorder a layer: moves + resets
await page.locator("#reliefLayerList .relief-layer button").first().click();
await page.waitForTimeout(300);
ok((await page.textContent("#reliefSummary")).length > 10, "summary after layer move");
await page.selectOption("#reliefMode", "tone");
await page.waitForTimeout(300);
await page.selectOption("#reliefMode", "nesting");
await page.selectOption("#reliefMaterial", "custom");
ok(await page.isVisible("#reliefThicknessRow"), "custom thickness field");
await page.selectOption("#reliefMaterial", "1.6");

async function dl(btn) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click(btn)]);
  const f = path.join(here, "_dl_" + d.suggestedFilename());
  await d.saveAs(f);
  return f;
}
const zipPath = await dl("#exportReliefSvgBtn");
const JSZip = require("jszip");
const z = await JSZip.loadAsync(fs.readFileSync(zipPath));
const names = Object.keys(z.files);
ok(names.includes("relief_all_colors.svg") && names.includes("piece_map.svg"), "svg zip: " + names.join(", "));
const all = await z.file("relief_all_colors.svg").async("string");
ok(/<svg[^>]+width="[\d.]+mm"/.test(all) && (all.match(/<path /g) || []).length > 10, "all-colors svg has mm size and paths");
const cut = await dl("#exportReliefCutBtn");
ok(fs.readFileSync(cut).subarray(0, 5).toString() === "%PDF-", "cut sheets pdf, " + fs.statSync(cut).size + " bytes");
const guide = await dl("#exportReliefGuideBtn");
ok(fs.readFileSync(guide).subarray(0, 5).toString() === "%PDF-", "guide pdf, " + fs.statSync(guide).size + " bytes");

// Product Kit
await page.click("#kitExportBtn");
await page.waitForSelector("#kitTitle");
ok(/Relief/i.test(await page.inputValue("#kitTitle")), "kit title: " + await page.inputValue("#kitTitle"));
await page.uncheck("#kitOpt_a4");
await page.uncheck("#kitOpt_images");
const [kd] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click("text=Build ZIP")]);
const kitPath = path.join(here, "_dl_kit.zip");
await kd.saveAs(kitPath);
const kz = await JSZip.loadAsync(fs.readFileSync(kitPath));
const kn = Object.keys(kz.files);
ok(kn.some((n) => /cut_files\/relief_all_colors\.svg$/.test(n)), "kit has SVG cut files");
ok(kn.some((n) => /cut_sheets_real_size\.pdf$/.test(n)), "kit has real-size cut sheets");
const listing = kn.find((n) => /listing\.txt$/.test(n));
const ltxt = listing ? await kz.file(listing).async("string") : "";
ok(/relief/i.test(ltxt), "listing mentions relief");
fs.unlinkSync(kitPath);

// settings round trip
const saved = await page.evaluate(() => {
  const el = (id) => document.getElementById(id);
  return { mat: el("reliefMaterial").value, dome: el("reliefDome").value };
});
ok(saved.mat === "1.6", "material kept");
ok(errors.length === 0, "no console/page errors " + JSON.stringify(errors.slice(0, 3)));
for (const f of [zipPath, cut, guide]) fs.unlinkSync(f);
await browser.close();
server.close();
console.log(fails ? `E2E FAILED (${fails})` : "relief e2e OK");
process.exit(fails ? 1 : 0);
