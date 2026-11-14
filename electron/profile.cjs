// Which folder the app keeps its data in, across the Stratus -> Nightjar
// rename. Kept free of Electron so test/profile.test.cjs can run it.
//
// Electron names the userData folder after the app, so a build called
// Nightjar would look in <appData>/Nightjar and start empty. Versions up to
// 0.3.x were called Stratus and wrote <appData>/Stratus: window state, the
// encrypted Spotify tokens, and the renderer's localStorage and IndexedDB
// (settings, account session, local playlists, history).
//
// When that old profile exists and no Nightjar profile does, we keep using
// the old folder where it is instead of moving it. Moving means copying a
// live Chromium profile (locks, LevelDB files) and can fail halfway, and a
// 0.3.x build started afterwards (a downgrade, or a second copy of the app)
// would find nothing. Leaving it in place can't lose anything, and the
// single-instance lock, which lives in this folder, keeps working between old
// and new builds.
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "Nightjar";
const LEGACY_APP_NAME = "Stratus";

// Chromium writes "Local State" into every folder it has used as userData.
// Checking for real profile files, not just the folder, means a stray empty
// <appData>/Nightjar can't hide the old profile.
const PROFILE_FILES = ["Local State", "Local Storage", "window-state.json"];

function isProfile(dir, exists = fs.existsSync) {
  return PROFILE_FILES.some((name) => exists(path.join(dir, name)));
}

/** Returns `{ dir, legacy }`: the userData folder to use, and whether it's the old Stratus one. */
function resolveUserData(appData, { exists = fs.existsSync } = {}) {
  const current = path.join(appData, APP_NAME);
  const legacy = path.join(appData, LEGACY_APP_NAME);
  if (!isProfile(current, exists) && isProfile(legacy, exists)) return { dir: legacy, legacy: true };
  return { dir: current, legacy: false };
}

module.exports = { APP_NAME, LEGACY_APP_NAME, isProfile, resolveUserData };
