// Exercises the macOS swap without starting Electron. A `sleep` process
// stands in for the running app, so the script's wait-for-exit path runs too.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const core = require("../electron/update-core.cjs");
const mac = require("../electron/mac-install.cjs");

const posix = process.platform !== "win32";

function fakeBundle(dir, name, version) {
  const app = path.join(dir, `${name}.app`);
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "version.txt"), version);
  return app;
}

function standIn() {
  return spawn("sleep", ["30"], { stdio: "ignore" });
}

async function waitFor(check, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("swap script waits for the app to exit, then replaces it", { skip: !posix }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-swap-"));
  const app = fakeBundle(dir, "Stratus", "0.1.0");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-swap-work-"));
  const newApp = fakeBundle(work, "Stratus", "0.1.1");
  const running = standIn();
  const log = path.join(dir, "swap.log");

  // ditto only exists on macOS; elsewhere copy the stub by hand.
  if (process.platform === "darwin") {
    await mac.stageAndSwap({ bundle: app, newApp, work, version: "0.1.1", pid: running.pid, launch: "none", logFile: log });
  } else {
    const staged = path.join(dir, ".Stratus-0.1.1.update.app");
    fs.cpSync(newApp, staged, { recursive: true });
    spawn("/bin/sh", ["-c", mac.SWAP_SCRIPT, "t", String(running.pid), app, staged, path.join(dir, ".old.app"), work, "none"], { stdio: "ignore" });
  }

  await new Promise((r) => setTimeout(r, 600));
  assert.equal(fs.readFileSync(path.join(app, "Contents", "version.txt"), "utf8"), "0.1.0", "must not swap while the app runs");
  running.kill();
  assert.ok(await waitFor(() => fs.readFileSync(path.join(app, "Contents", "version.txt"), "utf8") === "0.1.1"));
  assert.ok(await waitFor(() => !fs.existsSync(work)), "work dir cleaned up");
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".app")), ["Stratus.app"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("swap script puts the old app back when the new one is missing", { skip: !posix }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-swap-"));
  const app = fakeBundle(dir, "Stratus", "0.1.0");
  const child = spawn("/bin/sh", ["-c", mac.SWAP_SCRIPT, "t", "999999", app, path.join(dir, "missing.app"), path.join(dir, ".old.app"), path.join(dir, "nowork"), "none"], { stdio: "ignore" });
  await new Promise((r) => child.on("exit", r));
  assert.equal(fs.readFileSync(path.join(app, "Contents", "version.txt"), "utf8"), "0.1.0");
  assert.equal(fs.existsSync(path.join(dir, ".old.app")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("canReplaceBundle refuses DMG mounts, translocated and read-only locations", { skip: !posix }, () => {
  assert.equal(mac.canReplaceBundle(null), false);
  assert.equal(mac.canReplaceBundle("/Volumes/Stratus/Stratus.app"), false);
  assert.equal(mac.canReplaceBundle("/private/var/folders/x/AppTranslocation/y/d/Stratus.app"), false);
  assert.equal(mac.canReplaceBundle("/System/Applications/Music.app"), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-swap-"));
  assert.equal(mac.canReplaceBundle(fakeBundle(dir, "Stratus", "0")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// End to end with real builds, opt-in because it needs two electron-builder
// outputs:
//   STRATUS_TEST_OLD_APP=release/mac-arm64/Stratus.app
//   STRATUS_TEST_FEED_DIR=<folder with latest-mac.yml and the newer zip>
// It serves the feed over HTTP, runs the same download/verify/extract/swap
// code the app runs, and checks the bundle on disk. Electron is never started.
const oldApp = process.env.STRATUS_TEST_OLD_APP;
const feedDir = process.env.STRATUS_TEST_FEED_DIR;
test("update a real 0.1.0 bundle from a local feed", { skip: process.platform !== "darwin" || !oldApp || !feedDir, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-update-test-"));
  const app = path.join(root, "Stratus.app");
  execFileSync("/usr/bin/ditto", [oldApp, app]);
  const plist = path.join(app, "Contents", "Info.plist");
  const version = () => execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleShortVersionString", plist], { encoding: "utf8" }).trim();
  const current = version();

  const server = http.createServer((req, res) => {
    const file = path.join(feedDir, path.basename(decodeURIComponent(req.url)));
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  try {
    const info = core.parseUpdateInfo(await (await fetch(`${base}latest-mac.yml`)).text());
    assert.ok(core.isNewer(info.version, current), `${info.version} should be newer than ${current}`);

    const progress = [];
    const { work, newApp } = await mac.downloadAndExtract({ fetchImpl: fetch, info, baseUrl: base, arch: process.arch, onProgress: (p) => progress.push(p) });
    assert.equal(progress.at(-1), 100);
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp]);

    const running = standIn();
    const log = path.join(root, "swap.log");
    await mac.stageAndSwap({ bundle: app, newApp, work, version: info.version, pid: running.pid, launch: "none", logFile: log });
    running.kill();
    assert.ok(await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("installed")), fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "no log");

    assert.equal(version(), info.version);
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    assert.deepEqual(fs.readdirSync(root).filter((n) => n.endsWith(".app")), ["Stratus.app"]);
    assert.equal(fs.existsSync(work), false);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupted download is rejected before anything is unpacked", { skip: process.platform !== "darwin" || !feedDir, timeout: 120000 }, async () => {
  const info = core.parseUpdateInfo(fs.readFileSync(path.join(feedDir, "latest-mac.yml"), "utf8"));
  const tampered = { ...info, files: info.files.map((f) => ({ ...f, sha512: Buffer.alloc(64).toString("base64") })) };
  // Serve the real zip straight from disk.
  const fromDisk = async (url) => new Response(Readable.toWeb(fs.createReadStream(path.join(feedDir, path.basename(new URL(url).pathname)))));
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("stratus-update-")).length;
  await assert.rejects(mac.downloadAndExtract({ fetchImpl: fromDisk, info: tampered, baseUrl: "http://feed/", arch: process.arch }), /checksum/);
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("stratus-update-")).length;
  assert.equal(after, before, "temp folder removed after a failed check");
});
