// Which userData folder the app picks across the Stratus -> Nightjar rename.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = require("../electron/profile.cjs");

function appData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-profile-"));
}

function seed(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of files) {
    if (name.endsWith("/")) fs.mkdirSync(path.join(dir, name), { recursive: true });
    else fs.writeFileSync(path.join(dir, name), "{}");
  }
}

test("a new install uses <appData>/Nightjar", () => {
  const root = appData();
  assert.deepEqual(profile.resolveUserData(root), { dir: path.join(root, "Nightjar"), legacy: false });
  fs.rmSync(root, { recursive: true });
});

test("an install from before the rename keeps <appData>/Stratus where it is", () => {
  const root = appData();
  const old = path.join(root, "Stratus");
  seed(old, ["Local State", "Local Storage/", "window-state.json", "spotify-tokens.bin"]);
  assert.deepEqual(profile.resolveUserData(root), { dir: old, legacy: true });
  // Nothing is moved or copied.
  assert.equal(fs.existsSync(path.join(root, "Nightjar")), false);
  assert.ok(fs.existsSync(path.join(old, "spotify-tokens.bin")));
  fs.rmSync(root, { recursive: true });
});

test("a window-state.json alone is enough to count as the old profile", () => {
  const root = appData();
  seed(path.join(root, "Stratus"), ["window-state.json"]);
  assert.equal(profile.resolveUserData(root).legacy, true);
  fs.rmSync(root, { recursive: true });
});

test("an empty Nightjar folder doesn't hide the old profile", () => {
  const root = appData();
  seed(path.join(root, "Stratus"), ["Local State"]);
  fs.mkdirSync(path.join(root, "Nightjar"));
  assert.equal(profile.resolveUserData(root).dir, path.join(root, "Stratus"));
  fs.rmSync(root, { recursive: true });
});

test("once a Nightjar profile exists it wins", () => {
  const root = appData();
  seed(path.join(root, "Stratus"), ["Local State"]);
  seed(path.join(root, "Nightjar"), ["Local State"]);
  assert.deepEqual(profile.resolveUserData(root), { dir: path.join(root, "Nightjar"), legacy: false });
  fs.rmSync(root, { recursive: true });
});

test("an empty or unrelated Stratus folder isn't treated as a profile", () => {
  const root = appData();
  seed(path.join(root, "Stratus"), ["notes.txt"]);
  assert.equal(profile.resolveUserData(root).legacy, false);
  fs.rmSync(root, { recursive: true });
});
