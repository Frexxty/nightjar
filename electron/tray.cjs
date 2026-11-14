// Notification-area icon for Windows (and Linux): playback controls plus Show
// and Quit, so the app can keep playing with its window closed.
const { app, Menu, Tray, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Packaged builds get the icons through extraResources; in dev they're read
// straight from build/. The branding files may be missing in a fresh
// checkout, in which case we skip the tray instead of showing a blank square.
function iconPath() {
  const name = "tray.png";
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, name)]
    : [path.join(__dirname, "..", "build", name)];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let tray = null;
let handlers = null;

function menuFor(playback) {
  const active = playback.state !== "stopped";
  return Menu.buildFromTemplate([
    ...(playback.track ? [{ label: `${playback.track.title} — ${playback.track.artist}`.slice(0, 120), enabled: false }, { type: "separator" }] : []),
    { label: playback.state === "playing" ? "Pause" : "Play", enabled: active, click: () => handlers.command("toggle") },
    { label: "Next", enabled: active, click: () => handlers.command("next") },
    { label: "Previous", enabled: active, click: () => handlers.command("previous") },
    { type: "separator" },
    { label: "Show Nightjar", click: () => handlers.show() },
    { label: "Quit", click: () => handlers.quit() },
  ]);
}

// Returns true when the tray exists, which is what decides whether closing
// the window can hide it instead of quitting.
function createTray(options) {
  handlers = options;
  const icon = iconPath();
  if (!icon || tray) return Boolean(tray);
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip("Nightjar");
  tray.on("click", () => handlers.show());
  updateTray({ state: "stopped", track: null });
  return true;
}

function updateTray(playback) {
  if (!tray) return;
  tray.setContextMenu(menuFor(playback));
  tray.setToolTip(playback.track ? `${playback.track.title} — ${playback.track.artist}`.slice(0, 127) : "Nightjar");
}

module.exports = { createTray, updateTray, hasTray: () => Boolean(tray) };
