// Electron main process. Mirrors the shape of Cider's shell: one frameless
// window, persisted window state, an app menu and dock menu that follow the
// renderer's playback state, and commands sent back to the renderer over IPC.
const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const profile = require("./profile.cjs");

// First, before anything reads userData: an install from when the app was
// called Stratus keeps its old profile folder (see profile.cjs).
const userData = profile.resolveUserData(app.getPath("appData"));
app.setPath("userData", userData.dir);
// safeStorage keeps its key in a macOS keychain item named "<app name> Safe
// Storage", and Linux keyrings file it under the app name too. Electron reads
// the name for that once, after this script's first pass and before "ready".
// An old profile's Spotify tokens and cookies were encrypted under "Stratus",
// so with that profile the app answers to the old name until then, and
// switches back in whenReady before any menu or window shows it.
if (userData.legacy) app.setName(profile.LEGACY_APP_NAME);

const { registerSpotifyIpc } = require("./spotify.cjs");
const { registerSpotifyAuthIpc } = require("./spotify-auth.cjs");
const updater = require("./updater.cjs");
const updateCore = require("./update-core.cjs");
const macInstall = require("./mac-install.cjs");
const { createTray, updateTray, hasTray } = require("./tray.cjs");
const drm = require("./drm.cjs");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
// Test mode for the updater: never show a window or a Dock icon.
const headless = process.env.NIGHTJAR_HEADLESS_TEST === "1";
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
// Performance harness hook (scripts/measure.mjs); inert unless the env var is set.
const measure = process.env.NIGHTJAR_MEASURE === "1" ? require("./measure.cjs") : null;

let win = null;
let quitting = false;
let keepPlayingInTray = true;
let playback = { state: "stopped", track: null, liked: false };

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

let saveTimer = null;
function saveWindowState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!win || win.isDestroyed()) return;
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    fs.writeFileSync(stateFile(), JSON.stringify({ width, height, x, y }));
  }, 1000);
}

function send(command, payload) {
  if (!win || win.isDestroyed()) return;
  if (!headless) win.show();
  win.webContents.send("command", command, payload);
}

function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (headless) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Windows draws its caption buttons over our content; keep their colour in
// step with the app theme.
function syncTitleBarOverlay() {
  if (isMac || !win || win.isDestroyed()) return;
  const symbolColor = nativeTheme.shouldUseDarkColors ? "#ffffff" : "#121214";
  try {
    win.setTitleBarOverlay({ color: "#00000000", symbolColor, height: 52 });
  } catch {
    // Not available on every Linux window manager.
  }
}

function createWindow() {
  const saved = readWindowState();
  win = new BrowserWindow({
    width: saved.width ?? 1280,
    height: saved.height ?? 780,
    x: saved.x,
    y: saved.y,
    // Narrow windows use the compact navigation and player below 760px.
    minWidth: 420,
    minHeight: 480,
    title: profile.APP_NAME,
    show: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: isMac ? false : { color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#121214", height: 52 },
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: "active",
    backgroundColor: isMac ? "#00000000" : "#141416",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Background throttling stays on: Chromium never throttles a page that's
      // playing audio, and a hidden window then stops painting entirely.
      spellcheck: false,
      ...measure?.webPreferences,
    },
  });

  win.once("ready-to-show", () => {
    if (!headless) win.show();
  });
  measure?.attach(win);
  win.on("resize", saveWindowState);
  win.on("move", saveWindowState);

  // macOS convention: closing the window hides it and playback continues.
  win.on("close", (event) => {
    if (isMac && !quitting) {
      event.preventDefault();
      win.hide();
    } else if (!isMac && !quitting && keepPlayingInTray && hasTray()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (devServerUrl) win.loadURL(devServerUrl);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}

function buildMenus() {
  const active = playback.state !== "stopped";
  const playing = playback.state === "playing";
  const go = (route) => () => send("navigate", route);

  const controls = [
    { label: playing ? "Pause" : "Play", accelerator: "Space", registerAccelerator: false, enabled: active, click: () => send("toggle") },
    { label: "Next", accelerator: "CmdOrCtrl+Right", enabled: active, click: () => send("next") },
    { label: "Previous", accelerator: "CmdOrCtrl+Left", enabled: active, click: () => send("previous") },
    { type: "separator" },
    { label: playback.liked ? "Unlike" : "Like", accelerator: "CmdOrCtrl+L", enabled: active, click: () => send("like") },
    { label: "Shuffle", click: () => send("shuffle") },
    { label: "Repeat", click: () => send("repeat") },
  ];

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { label: "Check for Updates…", enabled: updater.enabled(), click: () => send("check-updates") },
            { type: "separator" },
            { label: "Settings…", accelerator: "CmdOrCtrl+,", click: go("/settings") },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => send("back") },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => send("forward") },
        { label: "Search", accelerator: "CmdOrCtrl+F", click: () => send("focus-search") },
        { type: "separator" },
        { label: "Home", accelerator: "CmdOrCtrl+1", click: go("/") },
        { label: "Stream", accelerator: "CmdOrCtrl+2", click: go("/stream") },
        { label: "Likes", accelerator: "CmdOrCtrl+3", click: go("/library/likes") },
        { label: "Playlists", accelerator: "CmdOrCtrl+4", click: go("/library/playlists") },
        { label: "History", accelerator: "CmdOrCtrl+5", click: go("/library/history") },
        { label: "Import from Spotify…", click: go("/import") },
        { type: "separator" },
        { label: "Toggle Queue", accelerator: "CmdOrCtrl+U", click: () => send("toggle-drawer", "queue") },
        { label: "Toggle Comments", accelerator: "CmdOrCtrl+K", click: () => send("toggle-drawer", "comments") },
        { label: "Immersive Player", accelerator: "CmdOrCtrl+Shift+F", click: () => send("immersive") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Controls", submenu: controls },
    { role: "windowMenu" },
    ...(isMac
      ? []
      : [{
          role: "help",
          submenu: [{ label: "Check for Updates…", enabled: updater.enabled(), click: () => send("check-updates") }],
        }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (isMac && app.dock) {
    const nowPlaying = playback.track
      ? [{ label: `${playback.track.title} — ${playback.track.artist}`, enabled: false }, { type: "separator" }]
      : [];
    app.dock.setMenu(Menu.buildFromTemplate([...nowPlaying, ...controls.slice(0, 3)]));
  }
}

ipcMain.on("playback", (_event, next) => {
  const changed = next.state !== playback.state || next.track?.id !== playback.track?.id || next.liked !== playback.liked;
  playback = next;
  if (changed) {
    buildMenus();
    updateTray(playback);
  }
  if (win && !win.isDestroyed()) {
    win.setTitle(next.track ? `${next.track.title} — ${next.track.artist}` : profile.APP_NAME);
  }
});

ipcMain.on("window", (_event, action, value) => {
  if (!win) return;
  switch (action) {
    case "toggle-fullscreen":
      win.setFullScreen(!win.isFullScreen());
      break;
    case "set-fullscreen":
      win.setFullScreen(Boolean(value));
      break;
    case "set-theme":
      nativeTheme.themeSource = value;
      syncTitleBarOverlay();
      break;
    case "set-tray-on-close":
      keepPlayingInTray = Boolean(value);
      break;
    case "open-external":
      if (/^https?:/.test(value)) shell.openExternal(value);
      break;
  }
});

ipcMain.handle("platform", () => process.platform);
registerSpotifyIpc(ipcMain);
registerSpotifyAuthIpc(ipcMain, { app, shell, safeStorage });

app.on("before-quit", () => {
  quitting = true;
});

app.on("activate", () => {
  if (win) showWindow();
  else createWindow();
});

nativeTheme.on("updated", syncTitleBarOverlay);

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

// macOS: 0.3.x installed /Applications/Stratus.app, and its updater put this
// build into that same path. Rename it to Nightjar.app once: quit, let a
// script rename the bundle, and come back from the new path. The marker in
// userData makes it a single attempt, so a rename that keeps failing can't
// turn into a relaunch loop.
function renameLegacyBundle() {
  if (!isMac || !app.isPackaged) return false;
  const marker = path.join(app.getPath("userData"), "bundle-rename.json");
  if (fs.existsSync(marker)) return false;
  const bundle = updateCore.appBundleFromExe(app.getPath("exe"));
  if (!updateCore.renamedBundlePath(bundle)) return false;
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ from: bundle, version: app.getVersion(), at: Date.now() }));
  } catch {
    return false;
  }
  // Test mode relaunches the binary directly so it inherits NIGHTJAR_HEADLESS_TEST.
  return Boolean(macInstall.renameLegacyBundle({ bundle, pid: process.pid, launch: headless ? "exec" : "open" }));
}

// One instance per user. A second launch focuses the existing window instead.
const primary = app.requestSingleInstanceLock() && !renameLegacyBundle();
if (!primary) app.exit(0);
app.on("second-instance", () => showWindow());

// Taskbar grouping and notifications on Windows key off this ID. It's the
// appId from package.json, which keeps its pre-rename value on purpose: the
// installer's uninstall key and pinned shortcuts are tied to it.
if (isWin) app.setAppUserModelId("dev.stratus.app");

app.whenReady().then(async () => {
  if (userData.legacy) app.setName(profile.APP_NAME);
  if (!primary) return;
  if (headless && app.dock) app.dock.hide();
  updater.init({ beforeQuit: () => (quitting = true) });
  buildMenus();
  // Spotify's player needs the Widevine CDM. Wait for it (bounded, see drm.cjs)
  // so the renderer doesn't start out with a missing CDM.
  await drm.whenReady();
  // A Dock click or second launch during the wait may have opened it already.
  if (!win) createWindow();
  if (!isMac) {
    createTray({
      command: (name) => win && !win.isDestroyed() && win.webContents.send("command", name),
      show: showWindow,
      quit: () => app.quit(),
    });
  }
});
