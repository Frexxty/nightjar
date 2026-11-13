// Widevine VMP signing with castlabs EVS, run from electron-builder hooks.
//
// castlabs' ECS builds carry a development VMP signature only. Spotify's
// licence servers want a production one on macOS and Windows, which EVS
// issues for free per account. The order relative to code signing matters
// (https://github.com/castlabs/electron-releases/wiki/EVS):
//
// - macOS: VMP-sign BEFORE code signing. The signature lands in
//   "Electron Framework.framework/.../Resources/Electron Framework.sig", which
//   the code signature seals, so this runs from afterPack and electron-builder
//   codesigns the result afterwards.
// - Windows: VMP-sign AFTER code signing. electron-builder edits the exe's
//   resources (icon, version info) and Authenticode-signs it in its signing
//   step, so this runs from afterSign (scripts/vmp-sign-win.cjs). We have no
//   Authenticode certificate, but afterSign still fires after the resource
//   edit, and before the NSIS installer is built from win-unpacked.
// - Linux: the Widevine CDM there doesn't do VMP, nothing to sign.
//
// Credentials come from EVS_ACCOUNT_NAME and EVS_PASSWD (the EVS client reads
// them from the environment). Without them the build goes on unsigned with a
// warning, so local builds and forks keep working. With them, a failed
// signing fails the build.
//
// The EVS client is a Python module: python3 -m pip install castlabs-evs.
// EVS_PYTHON picks the interpreter; otherwise python3, python and py are tried.
const { spawnSync } = require("node:child_process");

function findPython() {
  const candidates = process.env.EVS_PYTHON
    ? [[process.env.EVS_PYTHON]]
    : process.platform === "win32"
      ? [["python"], ["py", "-3"], ["python3"]]
      : [["python3"], ["python"]];
  for (const [cmd, ...pre] of candidates) {
    const probe = spawnSync(cmd, [...pre, "-c", "import castlabs_evs"], { stdio: "ignore" });
    if (probe.status === 0) return [cmd, ...pre];
  }
  return null;
}

async function vmpSign(context, platform) {
  if (context.electronPlatformName !== platform) return;
  const { appOutDir } = context;
  if (!process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWD) {
    console.warn(
      `  • skipped VMP signing of ${appOutDir}: EVS_ACCOUNT_NAME and EVS_PASSWD aren't set. ` +
        "The app only has castlabs' development VMP signature, so Spotify playback may be refused. " +
        "See README, Releasing.",
    );
    return;
  }
  const python = findPython();
  if (!python) {
    throw new Error(
      "VMP signing: EVS credentials are set but no Python with castlabs-evs was found. " +
        "Run `python3 -m pip install --upgrade castlabs-evs` or set EVS_PYTHON.",
    );
  }
  const [cmd, ...pre] = python;
  const name = context.packager.appInfo.productFilename;
  console.log(`  • VMP signing  appOutDir=${appOutDir} name=${name}`);
  // --no-ask: fail instead of prompting when a credential is missing or wrong.
  // The password stays in the environment so it never shows up in a process list.
  const result = spawnSync(
    cmd,
    [...pre, "-m", "castlabs_evs.vmp", "--no-ask", "sign-pkg", "--name-hint", name, appOutDir],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`VMP signing failed for ${appOutDir} (exit ${result.status ?? result.signal})`);
  }
}

// afterPack hook: macOS only, before electron-builder codesigns the app.
exports.default = (context) => vmpSign(context, "darwin");
exports.vmpSign = vmpSign;
