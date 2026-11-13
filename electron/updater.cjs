// Auto-updates from GitHub Releases.
//
// Windows uses electron-updater's NSIS flow. macOS reads latest-mac.yml
// itself and swaps the .app in place (see mac-install.cjs for why Squirrel.Mac
// is out).
const { app, ipcMain, net, shell, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./update-core.cjs");
const mac = require("./mac-install.cjs");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const feedOverride = process.env.STRATUS_UPDATE_FEED || "";
const autoInstall = process.env.STRATUS_UPDATE_AUTOINSTALL === "1";
const FIRST_CHECK_DELAY = 10_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

const enabled = (isMac || isWin) && (app.isPackaged || Boolean(feedOverride));

let state = { status: "idle" };
let prefs = { beta: false, skippedVersion: null, lastChecked: null };
let hooks = { beforeQuit: () => {} };
let checking = null;
// macOS only: what we found and what we downloaded.
let macRelease = null;
let macStaged = null;
let winUpdater = null;

const prefsFile = () => path.join(app.getPath("userData"), "updates.json");

function loadPrefs() {
  try {
    prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), "utf8")) };
  } catch {
    // First run or unreadable; defaults are fine.
  }
}

function savePrefs() {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs));
  } catch (err) {
    console.warn("[updater] could not save prefs:", err.message);
  }
}

function setState(next) {
  state = next;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("update:state", state);
  }
  if (process.env.STRATUS_UPDATE_LOG) console.log("[updater]", JSON.stringify({ ...state, notes: undefined }));
}

function fail(err, extra = {}) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[updater]", message);
  setState({ ...extra, status: "error", error: message });
}

function info() {
  return {
    enabled,
    currentVersion: app.getVersion(),
    beta: prefs.beta,
    skippedVersion: prefs.skippedVersion,
    lastChecked: prefs.lastChecked,
    state,
  };
}

// ---------- Windows: electron-updater ----------

function getWinUpdater() {
  if (winUpdater) return winUpdater;
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = prefs.beta;
  autoUpdater.logger = null;
  if (feedOverride) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: "generic", url: feedOverride });
  }

  let current = {};
  autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
  autoUpdater.on("update-available", (u) => {
    current = { version: u.version, notes: core.normalizeNotes(u.releaseNotes) };
    // electron-updater picks prereleases on its own when allowPrerelease is
    // set; apply the same "stable only" rule as macOS just in case.
    if (!core.isNewer(u.version, app.getVersion(), { allowPrerelease: prefs.beta })) {
      setState({ status: "not-available" });
      return;
    }
    setState({ status: "available", ...current });
    if (autoInstall) void download();
  });
  autoUpdater.on("update-not-available", () => setState({ status: "not-available" }));
  autoUpdater.on("download-progress", (p) => setState({ status: "downloading", ...current, progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", () => {
    setState({ status: "downloaded", ...current });
    if (autoInstall) install();
  });
  autoUpdater.on("error", (err) => fail(err, current));
  winUpdater = autoUpdater;
  return winUpdater;
}

// ---------- macOS: our own feed reader and installer ----------

async function fetchText(url) {
  const res = await net.fetch(url, { headers: { "Cache-Control": "no-cache", "User-Agent": `Stratus/${app.getVersion()}` } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// Returns { info, baseUrl, pageUrl } for the newest release on our channel.
async function fetchMacFeed() {
  if (feedOverride) {
    const base = feedOverride.endsWith("/") ? feedOverride : `${feedOverride}/`;
    return { info: core.parseUpdateInfo(await fetchText(`${base}latest-mac.yml`)), baseUrl: base, pageUrl: base };
  }
  if (!prefs.beta) {
    // /releases/latest skips drafts and prereleases, which is exactly the stable channel.
    const info = core.parseUpdateInfo(await fetchText(`${core.GITHUB_RELEASES}/latest/download/latest-mac.yml`));
    const tag = `v${info.version}`;
    return { info, baseUrl: `${core.GITHUB_RELEASES}/download/${tag}/`, pageUrl: `${core.GITHUB_RELEASES}/tag/${tag}` };
  }
  const releases = JSON.parse(await fetchText(`${core.GITHUB_API_RELEASES}?per_page=20`));
  const best = core.pickNewestRelease(releases, "latest-mac.yml", { allowPrerelease: true });
  if (!best) throw new Error("No release with a macOS update feed was found");
  return {
    info: core.parseUpdateInfo(await fetchText(best.feedUrl)),
    baseUrl: `${core.GITHUB_RELEASES}/download/${best.tag}/`,
    pageUrl: best.htmlUrl,
  };
}

async function checkMac() {
  setState({ status: "checking" });
  const feed = await fetchMacFeed();
  const { info: remote } = feed;
  if (!core.isNewer(remote.version, app.getVersion(), { allowPrerelease: prefs.beta })) {
    macRelease = null;
    setState({ status: "not-available" });
    return;
  }
  macRelease = feed;
  setState({ status: "available", version: remote.version, notes: remote.releaseNotes });
  if (autoInstall) void download();
}

function runningBundle() {
  return core.appBundleFromExe(app.getPath("exe"));
}

const fetchWithAgent = (url) => net.fetch(url, { headers: { "User-Agent": `Stratus/${app.getVersion()}` } });

async function downloadMac() {
  if (!macRelease) throw new Error("No update to download");
  const { info: remote, baseUrl, pageUrl } = macRelease;
  const meta = { version: remote.version, notes: remote.releaseNotes };
  const bundle = runningBundle();

  if (!mac.canReplaceBundle(bundle)) {
    // Let the browser fetch the dmg instead; the user drags the app over.
    const dmg = core.pickMacDmg(remote.files, process.arch);
    void shell.openExternal(dmg ? core.resolveFileUrl(baseUrl, dmg.url) : pageUrl);
    fail(
      `Stratus can't replace itself in ${bundle ? path.dirname(bundle) : "its current folder"}. ` +
        "The installer is downloading in your browser. Open it and drag Stratus to Applications.",
      meta,
    );
    return;
  }

  setState({ status: "downloading", ...meta, progress: 0 });
  const { work, newApp } = await mac.downloadAndExtract({
    fetchImpl: fetchWithAgent,
    info: remote,
    baseUrl,
    arch: process.arch,
    onProgress: (progress) => setState({ status: "downloading", ...meta, progress }),
  });
  macStaged = { work, newApp, version: remote.version };
  setState({ status: "downloaded", ...meta });
  if (autoInstall) install();
}

async function installMac() {
  if (!macStaged) throw new Error("No downloaded update to install");
  await mac.stageAndSwap({
    bundle: runningBundle(),
    ...macStaged,
    pid: process.pid,
    // Test mode relaunches the binary directly so the new copy inherits
    // STRATUS_HEADLESS_TEST and stays hidden; `open` would start it fresh.
    launch: process.env.STRATUS_HEADLESS_TEST === "1" ? "exec" : "open",
  });
  hooks.beforeQuit();
  app.quit();
}

// ---------- shared ----------

async function check() {
  if (!enabled) return info();
  if (checking) return checking;
  // A periodic check mustn't knock a pending download back to "available".
  if (state.status === "downloading" || state.status === "downloaded") return info();
  checking = (async () => {
    try {
      if (isWin) {
        const updater = getWinUpdater();
        updater.allowPrerelease = prefs.beta;
        await updater.checkForUpdates();
      } else {
        await checkMac();
      }
    } catch (err) {
      fail(err);
    } finally {
      prefs.lastChecked = Date.now();
      savePrefs();
      checking = null;
    }
    return info();
  })();
  return checking;
}

async function download() {
  if (!enabled || state.status === "downloading") return;
  try {
    if (isWin) {
      setState({ ...state, status: "downloading", progress: 0 });
      await getWinUpdater().downloadUpdate();
    } else {
      await downloadMac();
    }
  } catch (err) {
    fail(err, { version: state.version, notes: state.notes });
  }
}

function install() {
  if (state.status !== "downloaded") return;
  if (isWin) {
    hooks.beforeQuit();
    // Silent install, then relaunch the app.
    getWinUpdater().quitAndInstall(true, true);
  } else {
    installMac().catch((err) => fail(err, { version: state.version, notes: state.notes }));
  }
}

function init(options = {}) {
  hooks = { ...hooks, ...options };
  loadPrefs();

  ipcMain.handle("update:get-info", () => info());
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:download", () => download());
  ipcMain.handle("update:install", () => install());
  ipcMain.handle("update:skip", (_event, version) => {
    prefs.skippedVersion = typeof version === "string" ? version : null;
    savePrefs();
    return info();
  });
  ipcMain.handle("update:set-beta", (_event, beta) => {
    prefs.beta = Boolean(beta);
    savePrefs();
    return info();
  });

  if (!enabled) return;
  setTimeout(() => void check(), autoInstall ? 1000 : FIRST_CHECK_DELAY);
  setInterval(() => void check(), CHECK_INTERVAL).unref();
}

module.exports = { init, check, enabled: () => enabled };
