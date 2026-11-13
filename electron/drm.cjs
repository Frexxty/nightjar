// Widevine CDM through castlabs' Electron for Content Security (ECS).
//
// ECS installs the CDM with Chromium's component updater on first launch and
// updates it in the background afterwards. components.whenReady() resolves
// once a usable CDM is installed. Spotify's Web Playback SDK needs it, so the
// main process waits for it before opening the window, but only up to
// WAIT_MS, so a first install on a slow or offline connection can't hold up
// startup. When the wait times out the install keeps going and the status
// flips to "ready" later. The renderer hears about it through drm:status, and
// the CDM works in that same session (checked on Linux; no restart needed).
//
// Stock Electron has no components API, so `components` is undefined there.
const { BrowserWindow, ipcMain, components } = require("electron");

// A first install took 3.4 to 6.2 s on a home connection; later launches 2 to 3 ms.
const WAIT_MS = Number(process.env.STRATUS_CDM_WAIT_MS) || 5000;

let state = { widevine: components ? "updating" : "unavailable", version: null };
let waited = null;

function widevineInfo() {
  try {
    return components.status()[components.WIDEVINE_CDM_ID] ?? null;
  } catch {
    return null;
  }
}

function setState(next) {
  state = next;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("drm:status", state);
  }
}

// Starts the CDM install or update check and resolves when it's ready or
// after WAIT_MS, whichever comes first. Never rejects. Call after app ready.
function whenReady() {
  if (waited) return waited;
  if (!components) {
    console.log("[drm] stock Electron build, no Widevine CDM. Spotify playback won't work.");
    waited = Promise.resolve(state);
    return waited;
  }
  const started = Date.now();
  const install = components
    .whenReady([components.WIDEVINE_CDM_ID])
    .then(() => {
      const info = widevineInfo();
      setState({ widevine: info?.version ? "ready" : "unavailable", version: info?.version ?? null });
      console.log(`[drm] Widevine CDM ${state.widevine}, version ${state.version ?? "none"}, after ${Date.now() - started} ms`);
    })
    .catch((err) => {
      const detail = err?.errors?.map((e) => e.message || String(e)).join("; ") || err?.message || String(err);
      setState({ widevine: "unavailable", version: widevineInfo()?.version ?? null });
      console.warn(`[drm] Widevine CDM install failed after ${Date.now() - started} ms: ${detail}`);
    });
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[drm] Widevine CDM not ready after ${WAIT_MS} ms; opening the window anyway (status: ${state.widevine})`);
      resolve();
    }, WAIT_MS);
  });
  waited = Promise.race([install, timeout]).then(() => {
    clearTimeout(timer);
    return state;
  });
  return waited;
}

function status() {
  return state;
}

ipcMain.handle("drm:status", () => state);

module.exports = { whenReady, status };
