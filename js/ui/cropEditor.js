/**
 * cropEditor.js
 * The Crop & Shape editor: a draggable/resizable box over the image, with
 * numeric fields, aspect presets and a shape picker. Two tabs share one
 * canvas -- "Crop" edits a rectangle on the ORIGINAL image; "Shape" edits a
 * second box (rectangle / oval / circle) on the already-cropped image.
 * The geometry lives in pure functions (exported for tests); the DOM part
 * is openCropEditor().
 */
import { applyCropAndShape, boxToPixels, SHAPE_LABELS } from "../core/shape.js";

const MIN_PX = 8;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const ASPECT_PRESETS = [
  { key: "free", label: "Free", ratio: null },
  { key: "original", label: "Same as image", ratio: "original" },
  { key: "1:1", label: "1:1 (square)", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:4", label: "3:4", ratio: 3 / 4 },
  { key: "3:2", label: "3:2", ratio: 3 / 2 },
  { key: "2:3", label: "2:3", ratio: 2 / 3 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
];

/** Fractional box (or null) -> {x,y,w,h} in a baseW x baseH pixel space. */
export function boxToRect(box, baseW, baseH) {
  const [x0, y0, x1, y1] = boxToPixels(box, baseW, baseH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** {x,y,w,h} -> fractional box, or null when it covers the whole base. */
export function rectToBox(r, baseW, baseH) {
  const box = [r.x / baseW, r.y / baseH, (r.x + r.w) / baseW, (r.y + r.h) / baseH];
  const full = box[0] <= 0 && box[1] <= 0 && box[2] >= 1 && box[3] >= 1;
  return full ? null : box;
}

/** Largest rect of aspect `ratio` (w/h) that fits, centered, in baseW x baseH. */
export function largestCenteredRect(baseW, baseH, ratio) {
  let w = baseW, h = baseW / ratio;
  if (h > baseH) { h = baseH; w = baseH * ratio; }
  return { x: (baseW - w) / 2, y: (baseH - h) / 2, w, h };
}

/** Shrink/grow `r` to aspect `ratio` keeping its center, staying in bounds. */
export function fitRectToRatio(r, ratio, baseW, baseH) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = r.w, h = w / ratio;
  if (h > r.h) { h = r.h; w = h * ratio; }
  w = Math.max(MIN_PX, w); h = Math.max(MIN_PX, w / ratio);
  const maxW = 2 * Math.min(cx, baseW - cx), maxH = 2 * Math.min(cy, baseH - cy);
  if (w > maxW) { w = maxW; h = w / ratio; }
  if (h > maxH) { h = maxH; w = h * ratio; }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Apply a drag of `handle` by (dx, dy) pixels to rect `r0` (the rect at
 * drag start). `ratio` (w/h) locks the aspect: only corner handles resize
 * then (edge handles are ignored). Always returns an in-bounds rect of at
 * least MIN_PX in each direction.
 */
export function dragRect(r0, handle, dx, dy, baseW, baseH, ratio = null) {
  if (handle === "move") {
    const x = Math.min(baseW - r0.w, Math.max(0, r0.x + dx));
    const y = Math.min(baseH - r0.h, Math.max(0, r0.y + dy));
    return { x, y, w: r0.w, h: r0.h };
  }
  const left = handle.includes("w"), right = handle.includes("e");
  const top = handle.includes("n"), bottom = handle.includes("s");

  if (ratio) {
    if (!((left || right) && (top || bottom))) return { ...r0 };
    const ax = left ? r0.x + r0.w : r0.x;       // anchor = opposite corner
    const ay = top ? r0.y + r0.h : r0.y;
    const px = (left ? r0.x : r0.x + r0.w) + dx;
    const py = (top ? r0.y : r0.y + r0.h) + dy;
    const sx = px >= ax ? 1 : -1, sy = py >= ay ? 1 : -1;
    let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * ratio);
    const maxW = Math.min(sx > 0 ? baseW - ax : ax, (sy > 0 ? baseH - ay : ay) * ratio);
    w = Math.max(MIN_PX, Math.min(w, maxW));
    const h = w / ratio;
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
  }

  let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
  if (left) x0 = Math.min(x1 - MIN_PX, Math.max(0, x0 + dx));
  if (right) x1 = Math.max(x0 + MIN_PX, Math.min(baseW, x1 + dx));
  if (top) y0 = Math.min(y1 - MIN_PX, Math.max(0, y0 + dy));
  if (bottom) y1 = Math.max(y0 + MIN_PX, Math.min(baseH, y1 + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function handlePositions(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, x1 = r.x + r.w, y1 = r.y + r.h;
  return { nw: [r.x, r.y], n: [cx, r.y], ne: [x1, r.y], e: [x1, cy],
           se: [x1, y1], s: [cx, y1], sw: [r.x, y1], w: [r.x, cy] };
}

/**
 * Open the editor. `ctx` = { originalCanvas, cropBox, shapeBox, shapeType,
 * createCanvasFn }; `onApply({cropBox, shapeBox, shapeType})` is called when
 * the user confirms. `showDialog`/`closeDialog` are app.js's dialog helpers.
 */
export function openCropEditor({ originalCanvas, cropBox, shapeBox, shapeType, createCanvasFn,
                                 showDialog, closeDialog, onApply }) {
  const draft = { cropBox: cropBox || null, shapeBox: shapeBox || null,
                  shapeType: shapeType || "none", tab: "crop", aspect: { crop: "free", shape: "free" } };

  const body = document.createElement("div");
  body.className = "crop-editor";

  const tabs = document.createElement("div");
  tabs.className = "segmented";
  const tabCrop = document.createElement("button");
  const tabShape = document.createElement("button");
  [tabCrop, tabShape].forEach(b => { b.type = "button"; tabs.appendChild(b); });
  tabCrop.textContent = "Crop";
  tabShape.textContent = "Shape";
  body.appendChild(tabs);

  const stage = document.createElement("div");
  stage.className = "crop-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "crop-canvas";
  stage.appendChild(canvas);
  body.appendChild(stage);

  const controls = document.createElement("div");
  controls.className = "crop-controls";
  body.appendChild(controls);

  // Shape picker (Shape tab only)
  const shapeRow = document.createElement("label");
  shapeRow.textContent = "Shape ";
  const shapeSel = document.createElement("select");
  shapeSel.id = "cropShapeSelect";
  for (const key of ["none", "rect", "oval", "circle"]) {
    const o = document.createElement("option");
    o.value = key; o.textContent = SHAPE_LABELS[key];
    shapeSel.appendChild(o);
  }
  shapeRow.appendChild(shapeSel);
  controls.appendChild(shapeRow);

  const aspectRow = document.createElement("label");
  aspectRow.textContent = "Aspect ";
  const aspectSel = document.createElement("select");
  aspectSel.id = "cropAspectSelect";
  for (const p of ASPECT_PRESETS) {
    const o = document.createElement("option");
    o.value = p.key; o.textContent = p.label;
    aspectSel.appendChild(o);
  }
  aspectRow.appendChild(aspectSel);
  controls.appendChild(aspectRow);

  const numRow = document.createElement("div");
  numRow.className = "crop-numbers";
  const nums = {};
  for (const [key, label] of [["x", "X %"], ["y", "Y %"], ["w", "W %"], ["h", "H %"]]) {
    const l = document.createElement("label");
    l.textContent = label + " ";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "0"; inp.max = "100"; inp.step = "0.1";
    inp.id = `crop_${key}`;
    l.appendChild(inp);
    numRow.appendChild(l);
    nums[key] = inp;
  }
  controls.appendChild(numRow);

  const info = document.createElement("p");
  info.className = "hint";
  controls.appendChild(info);

  // --- geometry helpers ---------------------------------------------------
  const MAXW = 560, MAXH = 380;
  let base = originalCanvas;                 // what's displayed this tab
  let scale = 1;
  let rect = { x: 0, y: 0, w: 1, h: 1 };     // active box in base pixels

  function croppedBase() {
    return draft.cropBox ? applyCropAndShape(originalCanvas, createCanvasFn, draft.cropBox, null) : originalCanvas;
  }
  function activeBoxKey() { return draft.tab === "crop" ? "cropBox" : "shapeBox"; }
  function activeRatio() {
    if (draft.tab === "shape" && draft.shapeType === "circle") return 1;
    const key = draft.aspect[draft.tab];
    const p = ASPECT_PRESETS.find(a => a.key === key);
    if (!p || p.ratio === null) return null;
    return p.ratio === "original" ? base.width / base.height : p.ratio;
  }
  function commitRect() { draft[activeBoxKey()] = rectToBox(rect, base.width, base.height); }

  function loadTab() {
    base = draft.tab === "crop" ? originalCanvas : croppedBase();
    scale = Math.min(MAXW / base.width, MAXH / base.height, 1);
    canvas.width = Math.max(1, Math.round(base.width * scale));
    canvas.height = Math.max(1, Math.round(base.height * scale));
    rect = boxToRect(draft[activeBoxKey()], base.width, base.height);
    const ratio = activeRatio();
    if (ratio) rect = fitRectToRatio(rect, ratio, base.width, base.height);
    tabCrop.classList.toggle("active", draft.tab === "crop");
    tabShape.classList.toggle("active", draft.tab === "shape");
    shapeRow.hidden = draft.tab !== "shape";
    aspectSel.value = draft.aspect[draft.tab];
    aspectSel.disabled = draft.tab === "shape" && draft.shapeType === "circle";
    const boxDisabled = draft.tab === "shape" && draft.shapeType === "none";
    stage.classList.toggle("disabled", boxDisabled);
    numRow.hidden = boxDisabled;
    aspectRow.hidden = boxDisabled;
    commitRect();
    redraw();
  }

  function syncNumbers() {
    nums.x.value = (rect.x / base.width * 100).toFixed(1);
    nums.y.value = (rect.y / base.height * 100).toFixed(1);
    nums.w.value = (rect.w / base.width * 100).toFixed(1);
    nums.h.value = (rect.h / base.height * 100).toFixed(1);
    const px = (v) => Math.round(v);
    const final = applyCropAndShape(originalCanvas, createCanvasFn, draft.cropBox,
      draft.shapeType === "none" ? null : draft.shapeBox);
    info.textContent = `Result: ${final.width} × ${final.height} px`
      + (draft.shapeType === "oval" || draft.shapeType === "circle" ? ` — ${SHAPE_LABELS[draft.shapeType].toLowerCase()} mask` : "")
      + `  (box ${px(rect.w)} × ${px(rect.h)} of ${base.width} × ${base.height})`;
  }

  function redraw() {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    const disabled = draft.tab === "shape" && draft.shapeType === "none";
    if (!disabled) {
      const r = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale };
      const elliptical = draft.tab === "shape" && (draft.shapeType === "oval" || draft.shapeType === "circle");
      // dim everything outside the box (or outside the ellipse)
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      if (elliptical) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill("evenodd");
      ctx.restore();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (elliptical) {
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const ratioLocked = !!activeRatio();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#222";
      const hp = handlePositions(r);
      for (const name of HANDLES) {
        if (ratioLocked && name.length === 1) continue;
        const [hx, hy] = hp[name];
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }
    syncNumbers();
  }

  function hitTest(px, py) {
    if (draft.tab === "shape" && draft.shapeType === "none") return null;
    const hp = handlePositions({ x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale });
    const ratioLocked = !!activeRatio();
    for (const name of HANDLES) {
      if (ratioLocked && name.length === 1) continue;
      const [hx, hy] = hp[name];
      if (Math.abs(px - hx) <= 8 && Math.abs(py - hy) <= 8) return name;
    }
    if (px >= rect.x * scale && px <= (rect.x + rect.w) * scale
        && py >= rect.y * scale && py <= (rect.y + rect.h) * scale) return "move";
    return null;
  }

  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
                    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move" };
  let drag = null;
  function localPoint(e) {
    const b = canvas.getBoundingClientRect();
    return [(e.clientX - b.left) * (canvas.width / b.width), (e.clientY - b.top) * (canvas.height / b.height)];
  }
  canvas.addEventListener("pointerdown", (e) => {
    const [px, py] = localPoint(e);
    const handle = hitTest(px, py);
    if (!handle) return;
    drag = { handle, px, py, r0: { ...rect } };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    const [px, py] = localPoint(e);
    if (!drag) { const h = hitTest(px, py); canvas.style.cursor = h ? CURSORS[h] : "default"; return; }
    rect = dragRect(drag.r0, drag.handle, (px - drag.px) / scale, (py - drag.py) / scale,
      base.width, base.height, activeRatio());
    commitRect();
    redraw();
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function onNumberInput() {
    const pct = (inp) => Math.min(100, Math.max(0, parseFloat(inp.value) || 0)) / 100;
    let r = {
      x: pct(nums.x) * base.width, y: pct(nums.y) * base.height,
      w: Math.max(MIN_PX, pct(nums.w) * base.width), h: Math.max(MIN_PX, pct(nums.h) * base.height),
    };
    r.w = Math.min(r.w, base.width - r.x); r.h = Math.min(r.h, base.height - r.y);
    const ratio = activeRatio();
    if (ratio) r = fitRectToRatio({ ...r }, ratio, base.width, base.height);
    rect = r;
    commitRect();
    // redraw without clobbering the field being typed in
    const keep = document.activeElement;
    const saved = keep && keep.tagName === "INPUT" ? keep.value : null;
    redraw();
    if (saved !== null) keep.value = saved;
  }
  Object.values(nums).forEach(i => i.addEventListener("input", onNumberInput));

  tabCrop.addEventListener("click", () => { draft.tab = "crop"; loadTab(); });
  tabShape.addEventListener("click", () => { draft.tab = "shape"; loadTab(); });
  shapeSel.addEventListener("change", () => {
    draft.shapeType = shapeSel.value;
    if (draft.shapeType === "none") draft.shapeBox = null;
    else if (draft.shapeType === "circle") {
      const b = croppedBase();
      draft.shapeBox = rectToBox(largestCenteredRect(b.width, b.height, 1), b.width, b.height);
    }
    loadTab();
  });
  aspectSel.addEventListener("change", () => {
    draft.aspect[draft.tab] = aspectSel.value;
    const ratio = activeRatio();
    if (ratio) rect = largestCenteredRect(base.width, base.height, ratio);
    commitRect();
    redraw();
  });

  shapeSel.value = draft.shapeType;
  loadTab();

  showDialog({
    title: "Crop & Shape",
    desc: "Crop picks the part of the photo to use. Shape then cuts that part to a "
      + "rectangle, oval or circle — handy for a round frame. Cells outside an oval/circle "
      + "are left out of the build. Both can be changed any time, before or after generating.",
    bodyEl: body,
    wide: true,
    actions: [
      { label: "Reset", onClick: () => {
          draft.cropBox = null; draft.shapeBox = null; draft.shapeType = "none";
          shapeSel.value = "none"; draft.aspect = { crop: "free", shape: "free" };
          loadTab();
        } },
      { label: "Cancel", onClick: closeDialog },
      { label: "Apply", primary: true, onClick: () => {
          closeDialog();
          onApply({ cropBox: draft.cropBox, shapeBox: draft.shapeType === "none" ? null : draft.shapeBox,
                    shapeType: draft.shapeType });
        } },
    ],
  });
}
