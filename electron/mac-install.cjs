// macOS self-replacement, kept free of Electron so test/mac-install.test.cjs
// can run the same steps against a real zip with plain Node.
//
// Squirrel.Mac rejects our updates: the builds are ad-hoc signed, so the
// designated requirement changes on every build. Instead we download the zip,
// check its sha512, unpack it with ditto, and after we exit a detached shell
// script renames the new bundle over the old one and relaunches it.
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");
const core = require("./update-core.cjs");

const run = promisify(execFile);

// We rename the bundle and create a sibling next to it. Apps running from a
// DMG, from App Translocation, or from a folder we can't write to can't do that.
function canReplaceBundle(bundle) {
  if (!bundle || bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// `fetchImpl` is Electron's net.fetch in the app (system proxy, redirects)
// and the global fetch in tests.
async function downloadFile(fetchImpl, url, dest, onProgress = () => {}) {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  let lastReported = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct !== lastReported) {
      lastReported = pct;
      onProgress(pct);
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
}

// Downloads and unpacks the zip for this arch. Returns { work, newApp }.
async function downloadAndExtract({ fetchImpl, info, baseUrl, arch, onProgress }) {
  const zip = core.pickMacZip(info.files, arch);
  if (!zip) throw new Error(`The update has no zip for ${arch}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-update-"));
  try {
    const zipPath = path.join(work, path.basename(zip.url));
    await downloadFile(fetchImpl, core.resolveFileUrl(baseUrl, zip.url), zipPath, onProgress);
    if (!(await core.verifySha512(zipPath, zip.sha512))) {
      throw new Error("The download didn't match its checksum. Try again later.");
    }
    const extractDir = path.join(work, "extracted");
    fs.mkdirSync(extractDir);
    // ditto keeps the symlinks and signatures inside Electron's frameworks; unzip doesn't.
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, extractDir]);
    fs.rmSync(zipPath, { force: true });
    const entry = fs.readdirSync(extractDir).find((name) => name.endsWith(".app"));
    if (!entry) throw new Error("The update archive doesn't contain an app");
    const newApp = path.join(extractDir, entry);
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", newApp]).catch(() => {});
    return { work, newApp };
  } catch (err) {
    fs.rmSync(work, { recursive: true, force: true });
    throw err;
  }
}

// Wait for the app's PID to exit, move the old bundle aside, move the new one
// in (restoring the old one if that fails), then relaunch. Paths arrive as
// positional arguments so nothing needs shell quoting.
const SWAP_SCRIPT = `
pid="$1"; app="$2"; staged="$3"; old="$4"; work="$5"; launch="$6"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then kill -9 "$pid" 2>/dev/null; sleep 1; break; fi
  sleep 0.1
done
if mv "$app" "$old"; then
  if mv "$staged" "$app"; then
    rm -rf "$old"
    echo "stratus-update: installed"
  else
    echo "stratus-update: moving the new app into place failed, restoring" >&2
    mv "$old" "$app"
  fi
else
  echo "stratus-update: could not move the old app aside" >&2
fi
rm -rf "$staged" "$work"
/usr/bin/xattr -dr com.apple.quarantine "$app" 2>/dev/null
case "$launch" in
  open) /usr/bin/open "$app" ;;
  exec)
    exe=$(/usr/bin/defaults read "$app/Contents/Info" CFBundleExecutable)
    "$app/Contents/MacOS/$exe" >/dev/null 2>&1 &
    ;;
esac
`;

// Copies the new bundle next to the running one, then hands off to the swap
// script. Copying first means the final step is two renames on one volume
// instead of a copy that could fail halfway. The caller quits right after.
async function stageAndSwap({ bundle, newApp, work, version, pid, launch = "open", logFile }) {
  const parent = path.dirname(bundle);
  const base = path.basename(bundle, ".app");
  const staged = path.join(parent, `.${base}-${version}.update.app`);
  const old = path.join(parent, `.${base}.old-${Date.now()}.app`);
  fs.rmSync(staged, { recursive: true, force: true });
  await run("/usr/bin/ditto", [newApp, staged]);

  const log = fs.openSync(logFile ?? path.join(os.tmpdir(), "stratus-update.log"), "a");
  const child = spawn("/bin/sh", ["-c", SWAP_SCRIPT, "stratus-update", String(pid), bundle, staged, old, work, launch], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.closeSync(log);
  return child;
}

module.exports = { canReplaceBundle, downloadFile, downloadAndExtract, stageAndSwap, SWAP_SCRIPT };
