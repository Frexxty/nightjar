// Electron main process. Mirrors the shape of Cider's shell: one frameless
// window, persisted window state, an app menu and dock menu that follow the
// renderer's playback state, and commands sent back to the renderer over IPC.
const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isMac = process.platform === "darwin";
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
// Performance harness hook (scripts/measure.mjs); inert unless the env var is set.
const measure = process.env.STRATUS_MEASURE === "1" ? require("./measure.cjs") : null;

let win = null;
let quitting = false;
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
  win.show();
  win.webContents.send("command", command, payload);
}

function createWindow() {
  const saved = readWindowState();
  win = new BrowserWindow({
    width: saved.width ?? 1280,
    height: saved.height ?? 780,
    x: saved.x,
    y: saved.y,
    minWidth: 960,
    minHeight: 600,
    title: "Stratus",
    show: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: isMac ? false : { color: "#00000000", symbolColor: "#ffffff", height: 52 },
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

  win.once("ready-to-show", () => win.show());
  measure?.attach(win);
  win.on("resize", saveWindowState);
  win.on("move", saveWindowState);

  // macOS convention: closing the window hides it and playback continues.
  win.on("close", (event) => {
    if (isMac && !quitting) {
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
  if (changed) buildMenus();
  if (win && !win.isDestroyed()) {
    win.setTitle(next.track ? `${next.track.title} — ${next.track.artist}` : "Stratus");
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
      break;
    case "open-external":
      if (/^https?:/.test(value)) shell.openExternal(value);
      break;
  }
});

ipcMain.handle("platform", () => process.platform);

app.on("before-quit", () => {
  quitting = true;
});

app.on("activate", () => {
  if (win) win.show();
  else createWindow();
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.whenReady().then(() => {
  buildMenus();
  createWindow();
});
