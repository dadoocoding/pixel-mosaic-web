# Pixel Mosaic Generator — Web Version

Browser port of the desktop Pixel Mosaic app. Pure client-side JS (no build
step, no server) — matches your existing dadoolabs.com plan of vanilla
HTML/CSS/JS on GitHub Pages. Live at pixel.dadoolabs.com.

## Test it locally first

ES modules need to be served over `http://`, not opened directly as a
`file://` URL (browsers block module imports from disk). From this folder:

```bash
python -m http.server 8000
```

then open **http://localhost:8000** in Chrome or Edge (recommended for full
feature support — see limitations below). Ctrl+C to stop the server.

If you use VS Code, the "Live Server" extension works the same way.

## What's implemented (feature parity with the desktop app)

- Image load: file picker, drag-and-drop (including dragging an image *from
  another browser tab* — more reliable here than on desktop), clipboard
  paste (button or Ctrl+V), and a "Try a Sample Image" picker with 5 bundled
  public domain/CC0 images for visitors who don't have one handy
- Grid width/height with aspect-lock, live output-size estimate
- Color source: Auto (K-Means), Fixed Palette (built-in LEGO Solid Colors or
  import your own CSV/JSON), Monochrome ramp
- Square/circle/hexagon tiles, background color, cell size
- Zoomable/pannable preview with click-to-sample (hex, RGB, row/col, palette
  index and name)
- Color palette editor (recolor/rename after generating)
- Brick/plate optimization with a size checklist, Bricks preview view
- Sub-structure panel export (zipped, with manifest.json + per-panel JSON/CSV)
- Exports: PNG, JSON, CSV (grid + color counts), brick list (JSON/CSV),
  shopping list (CSV)

All the core algorithms (K-Means, Lab-space color matching, the monochrome
ramp, hex geometry, panel splitting, the brick-merging algorithm) are
independent from-scratch ports, each verified against the same correctness
checks used for the Python version (round-trip accuracy, brute-force
hit-testing, zero-overlap/full-coverage panel and brick reconstruction) —
see the "how this was tested" note at the end.

## Sample images (`samples/`)

Five bundled images, picked for variety in color range and detail level, all
genuinely public domain or CC0 (not just "free to use" — verified license per
image, sourced from scikit-image's bundled sample data, which documents
provenance for each one):

| File | Subject | Credit |
|---|---|---|
| `astronaut.jpg` | Portrait (Eileen Collins) | NASA — public domain |
| `hubble_deep_field.jpg` | Deep space field | NASA — public domain |
| `rocket.jpg` | Falcon 9 launch, twilight | SpaceX — public domain |
| `coffee.jpg` | Still life | Rachel Michetti — CC0 |
| `horse.png` | Graphic silhouette | Andreas Preuss — CC0 |

Total payload ~350KB. Swap these out any time by editing the `SAMPLE_IMAGES`
array near the top of `js/app.js` and dropping matching files in `samples/`.

## Two real platform differences from the desktop app

1. **Multi-file exports are zipped.** The desktop version writes a folder
   full of files; a browser can only trigger single-file downloads, so the
   panel export bundles everything into one `panels.zip` (via JSZip) instead.

2. **Dropping/pasting an image from a URL is CORS-limited.** Dragging a file
   from your own machine or another tab works great. Dragging an image
   *from a webpage* triggers a `fetch()` of that image's URL, which the
   image's server may block for cross-origin requests — this is a browser
   security rule, not something fixable client-side. If a URL-drop fails,
   paste works around it (right-click the image → Copy Image → Paste from
   Clipboard button, or Ctrl+V) — or use one of the bundled sample images,
   which load with no such restriction since they're same-origin.

Clipboard read/write needs a "secure context" (HTTPS, or `localhost` — both
your local test server and the pixel.dadoolabs.com deployment qualify).

## How this was tested

Since this sandbox has no real browser, testing split into two layers:

- **Core algorithms** (color/Lab math, K-Means, palette matching, grid
  downsampling, hex geometry, panel splitting, brick optimization, export
  builders) — tested with Node + the `node-canvas` package for real pixel-
  level rendering checks. One real bug was caught this way: the hex
  click-to-select math used `Math.floor` where the Python original relied on
  `int()`'s truncate-toward-zero behavior, which silently missed the correct
  hexagon near the top/left edges. Fixed and re-verified at 200,000 random
  sample points with zero mismatches.
- **The app itself** (`app.js` against the real `index.html`) — smoke-tested
  with jsdom to confirm it initializes cleanly with no undefined-element or
  runtime errors, including opening the sample-image picker dialog.

What automated testing can't cover here: actual mouse drag/wheel-zoom feel,
real file-drag-from-tab behavior, and cross-browser quirks (Safari/Firefox
clipboard support in particular) — that's what your local/live test passes
are for.
