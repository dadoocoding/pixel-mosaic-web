/**
 * recentProjects.js
 *
 * Local "Recent Projects" store for the web app: an IndexedDB database
 * holding a snapshot of each loaded photo (a copy of the image itself,
 * plus its settings and a small thumbnail of the last render), so a
 * previous project can be reopened without the user re-finding the file.
 * Ported from the desktop app's recent_projects.py -- same record shape
 * and one-entry-per-loaded-photo (not per-click) update behavior, but
 * backed by IndexedDB instead of a JSON file + cache folder, since the
 * browser has no filesystem to write to (and localStorage's ~5MB
 * string-only quota is a poor fit for storing multiple images).
 *
 * One record = one *loaded source image*, not one generate click. The app
 * passes the same projectId back in on every re-generate of the same
 * photo (see app.js's snapshotRecentProject), so tweaking sliders and
 * re-generating repeatedly updates one entry -- bumping it to the top of
 * the recency order -- rather than spawning a new entry every time. A
 * genuinely new entry is only created when a new photo is loaded
 * (projectId is null).
 *
 * Batch Mode (app.js's createBatch/openBatchMode) builds directly on this
 * store: uploading a batch registers each photo as a *pending* record via
 * createPending() -- same shape, but mode/settings are null until the user
 * opens it and generates for the first time, which calls saveSnapshot()
 * exactly as a normal single-image generate would. Export All (app.js's
 * batchExportAll) zips up each item's already-persisted outputBlob -- the
 * full-resolution rendered image, stored alongside (not instead of) the
 * small thumbnailBlob, ported from the desktop app's outputs/<id>.png.
 */

const DB_NAME = "pixel-mosaic-recent-projects";
const DB_VERSION = 1;
const STORE_NAME = "projects";

// Oldest entries beyond this count are evicted every time a snapshot is
// saved, so the database can't grow without bound. Kept in sync with
// recent_projects.py's MAX_RECENT_PROJECTS.
export const MAX_RECENT_PROJECTS = 30;

// Thumbnails are downsized to fit within this box (aspect ratio preserved)
// -- matches recent_projects.py's THUMBNAIL_BOX.
const THUMBNAIL_BOX = [240, 240];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All recent-project records, most-recently-updated first. Resolves to []
 * rather than rejecting on a database error -- a broken Recent Projects
 * list should never block the rest of the app. */
export async function loadIndex() {
  try {
    const store = await tx("readonly");
    const records = await requestToPromise(store.getAll());
    records.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return records;
  } catch {
    return [];
  }
}

/** Downscale a canvas into a PNG Blob no larger than THUMBNAIL_BOX
 * (aspect ratio preserved), for use as a project thumbnail. */
function makeThumbnailBlob(sourceCanvas) {
  const [maxW, maxH] = THUMBNAIL_BOX;
  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const w = Math.max(1, Math.round(sourceCanvas.width * scale));
  const h = Math.max(1, Math.round(sourceCanvas.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(sourceCanvas, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Register a Batch Mode item that hasn't been generated yet -- same
 * record shape saveSnapshot() produces, but mode/settings are null until
 * the user opens it and generates for the first time, which calls
 * saveSnapshot() with this same id and fills those in (and swaps the
 * thumbnail for one made from the real output). sourceCanvas is the
 * loaded source photo (used both as a placeholder thumbnail and as the
 * cached source, same as saveSnapshot's first-save branch).
 *
 * Returns the new project id. */
export async function createPending(defaultName, sourceCanvas, sourceFileName) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Same transaction-lifetime reasoning as saveSnapshot below: every Blob
  // is produced before the transaction opens.
  const thumbnailBlob = await makeThumbnailBlob(sourceCanvas);
  const sourceBlob = await new Promise((resolve) => sourceCanvas.toBlob((blob) => resolve(blob), "image/png"));

  const store = await tx("readwrite");
  await requestToPromise(store.put({
    id,
    name: defaultName,
    createdAt: now,
    updatedAt: now,
    mode: null,
    sourceFileName,
    sourceBlob,
    thumbnailBlob,
    outputBlob: null,
    settings: null,
  }));
  return id;
}

/** Create or update a recent-project record.
 *
 * outputCanvas is the freshly rendered mosaic -- a downsized copy becomes
 * the thumbnail, and the full canvas is stored as outputBlob so Batch
 * Mode's Export All can bundle up real, full-size images later without
 * re-rendering anything (mirrors the desktop app's outputs/<id>.png).
 * sourceCanvas is the loaded photo (stored as a PNG Blob so the project
 * can be reopened later, even after the page is closed). defaultName and
 * sourceFileName are only used the first time this project is saved (a
 * later rename via renameProject() is never overwritten by this call).
 *
 * Returns the project id: a new crypto.randomUUID() if projectId was
 * null, otherwise the same id passed in (including reused for what
 * createPending() started, turning a pending batch item into a real one). */
export async function saveSnapshot(projectId, defaultName, mode, sourceCanvas, sourceFileName,
                                    settings, outputCanvas) {
  const now = new Date().toISOString();
  const isNew = projectId == null;
  const id = isNew ? crypto.randomUUID() : projectId;

  // canvas.toBlob() resolves as a task, not a microtask -- awaiting it
  // *inside* an open IndexedDB transaction would let the transaction
  // auto-commit out from under us before the next request is made. So
  // every Blob this snapshot needs is produced first, before the
  // transaction below opens; everything after that point is a tight,
  // uninterrupted chain of IDB requests only.
  const thumbnailBlob = await makeThumbnailBlob(outputCanvas);
  const outputBlob = await new Promise((resolve) => outputCanvas.toBlob((blob) => resolve(blob), "image/png"));
  const sourceBlob = isNew
    ? await new Promise((resolve) => sourceCanvas.toBlob((blob) => resolve(blob), "image/png"))
    : null;

  const store = await tx("readwrite");
  let record = isNew ? null : await requestToPromise(store.get(id));
  if (!record) {
    record = {
      id,
      name: defaultName,
      createdAt: now,
      updatedAt: now,
      mode,
      sourceFileName,
      sourceBlob,
      thumbnailBlob,
      outputBlob,
      settings,
    };
  } else {
    record.updatedAt = now;
    record.mode = mode;
    record.settings = settings;
    record.thumbnailBlob = thumbnailBlob;
    record.outputBlob = outputBlob;
  }
  await requestToPromise(store.put(record));

  // Eviction: keep only the MAX_RECENT_PROJECTS most-recently-updated.
  const all = await requestToPromise(store.getAll());
  if (all.length > MAX_RECENT_PROJECTS) {
    all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    for (const stale of all.slice(MAX_RECENT_PROJECTS)) {
      await requestToPromise(store.delete(stale.id));
    }
  }

  return id;
}

export async function deleteProject(id) {
  const store = await tx("readwrite");
  store.delete(id);
}

export async function renameProject(id, newName) {
  const store = await tx("readwrite");
  const record = await requestToPromise(store.get(id));
  if (record) {
    record.name = newName;
    store.put(record);
  }
}
