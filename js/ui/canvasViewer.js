/**
 * canvasViewer.js
 * Zoomable/pannable canvas display for the browser (mouse wheel to zoom,
 * drag to pan, click to sample). Browser-native equivalent of the desktop
 * app's ZoomableImageCanvas -- draws directly via Canvas drawImage rather
 * than pre-rendering scaled bitmaps, so it stays fast at any zoom level.
 */

export class CanvasViewer {
  constructor(canvasEl, { onClick, onTransformChange } = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onClick = onClick;
    // Fired whenever scale/offset (or the container size backing "fit")
    // changes, so callers can react -- e.g. app.js uses this to hide the
    // mobile save-overlay <img> whenever the view isn't at its default fit,
    // since that overlay always mirrors the full un-zoomed image and would
    // otherwise sit on top of (and visually hide) the live-zoomed canvas.
    this.onTransformChange = onTransformChange;
    this.image = null; // an HTMLCanvasElement/OffscreenCanvas holding the full-res image
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.minScale = 0.01;
    this.maxScale = 16;
    this._placeholder = "";

    this._bindEvents();
    this._resizeObserver = new ResizeObserver(() => { this._draw(); this.onTransformChange?.(); });
    this._resizeObserver.observe(this.canvas.parentElement);
    this._draw();
  }

  setImage(imageCanvas, { resetView = true } = {}) {
    this.image = imageCanvas;
    this._placeholder = "";
    if (resetView) this._fitToView();
    this._draw();
    this.onTransformChange?.();
  }

  showPlaceholder(text) {
    this.image = null;
    this._placeholder = text || "";
    this._draw();
  }

  zoomIn() { this._zoomAtCenter(1.25); }
  zoomOut() { this._zoomAtCenter(1 / 1.25); }
  zoomReset() { this._fitToView(); this._draw(); this.onTransformChange?.(); }

  // True when the current scale/offset matches (within a small tolerance)
  // what _fitToView() would compute right now -- i.e. the view is at its
  // default "fit to container" state, not interactively zoomed or panned.
  isAtDefaultFit() {
    if (!this.image) return true;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const iw = this.image.width, ih = this.image.height;
    if (rect.width < 2 || rect.height < 2 || iw === 0 || ih === 0) return true;
    const fitScale = Math.min(rect.width / iw, rect.height / ih);
    const fitOffsetX = (rect.width - iw * fitScale) / 2;
    const fitOffsetY = (rect.height - ih * fitScale) / 2;
    return Math.abs(this.scale - fitScale) < fitScale * 0.01
        && Math.abs(this.offsetX - fitOffsetX) < 1
        && Math.abs(this.offsetY - fitOffsetY) < 1;
  }

  _fitToView() {
    if (!this.image) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const iw = this.image.width, ih = this.image.height;
    if (rect.width < 2 || rect.height < 2 || iw === 0 || ih === 0) return;
    this.scale = Math.min(rect.width / iw, rect.height / ih);
    this.offsetX = (rect.width - iw * this.scale) / 2;
    this.offsetY = (rect.height - ih * this.scale) / 2;
  }

  _zoomAtCenter(factor) {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this._zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  _zoomAt(mx, my, factor) {
    if (!this.image) return;
    const ix = (mx - this.offsetX) / this.scale;
    const iy = (my - this.offsetY) / this.scale;
    this.scale = Math.max(this.minScale, Math.min(this.scale * factor, this.maxScale));
    this.offsetX = mx - ix * this.scale;
    this.offsetY = my - iy * this.scale;
    this._draw();
    this.onTransformChange?.();
  }

  _bindEvents() {
    this.canvas.addEventListener("wheel", (e) => {
      if (!this.image) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0, moved = false;
    this.canvas.addEventListener("mousedown", (e) => {
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      this.offsetX += dx; this.offsetY += dy;
      lastX = e.clientX; lastY = e.clientY;
      this._draw();
      this.onTransformChange?.();
    });
    window.addEventListener("mouseup", (e) => {
      if (dragging && !moved && this.image && this.onClick) {
        const rect = this.canvas.getBoundingClientRect();
        const ix = (e.clientX - rect.left - this.offsetX) / this.scale;
        const iy = (e.clientY - rect.top - this.offsetY) / this.scale;
        if (ix >= 0 && iy >= 0 && ix < this.image.width && iy < this.image.height) {
          this.onClick(ix, iy);
        }
      }
      dragging = false;
    });
  }

  _draw() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (this.image) {
      ctx.imageSmoothingEnabled = this.scale < 1;
      ctx.drawImage(this.image, this.offsetX, this.offsetY,
                     this.image.width * this.scale, this.image.height * this.scale);
    } else if (this._placeholder) {
      ctx.fillStyle = "#889099";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxWidth = rect.width - 40;
      wrapText(ctx, this._placeholder, rect.width / 2, rect.height / 2, maxWidth, 18);
    }
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
