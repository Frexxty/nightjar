const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("../electron/update-core.cjs");

// Shaped like what electron-builder writes for a two-arch mac build.
const MAC_YML = `version: 0.1.1
files:
  - url: Nightjar-mac-x64.zip
    sha512: xHash==
    size: 101
  - url: Nightjar-mac-x64.dmg
    sha512: xDmg==
    size: 102
  - url: Nightjar-mac-arm64.zip
    sha512: aHash==
    size: 103
  - url: Nightjar-mac-arm64.dmg
    sha512: aDmg==
    size: 104
path: Nightjar-mac-x64.zip
sha512: xHash==
releaseDate: '2026-11-13T10:00:00.000Z'
releaseNotes: |
  ## Fixes
  - Queue no longer skips
`;

test("parseUpdateInfo reads electron-builder's mac feed", () => {
  const info = core.parseUpdateInfo(MAC_YML);
  assert.equal(info.version, "0.1.1");
  assert.equal(info.files.length, 4);
  assert.deepEqual(info.files[2], { url: "Nightjar-mac-arm64.zip", sha512: "aHash==", size: 103 });
  assert.equal(info.releaseDate, "2026-11-13T10:00:00.000Z");
  assert.match(info.releaseNotes, /## Fixes/);
});

test("parseUpdateInfo falls back to the top-level path for old feeds", () => {
  const info = core.parseUpdateInfo("version: 1.0.0\npath: Nightjar-Setup-x64.exe\nsha512: abc==\n");
  assert.deepEqual(info.files, [{ url: "Nightjar-Setup-x64.exe", sha512: "abc==", size: undefined }]);
});

test("parseUpdateInfo rejects broken feeds", () => {
  assert.throws(() => core.parseUpdateInfo(""), /empty/);
  assert.throws(() => core.parseUpdateInfo("version: banana\nfiles: []"), /invalid version/);
  assert.throws(() => core.parseUpdateInfo("version: 1.0.0\nfiles: []"), /no files/);
  // JSON_SCHEMA keeps yaml from building arbitrary types out of tags.
  assert.throws(() => core.parseUpdateInfo("version: !!js/function 'x'"));
});

test("normalizeNotes flattens arrays and strips Atom-feed HTML", () => {
  assert.equal(core.normalizeNotes(undefined), "");
  assert.equal(core.normalizeNotes("<p>Hello &amp; bye</p><ul><li>one</li></ul>"), "Hello & bye\n- one");
  assert.equal(core.normalizeNotes([{ version: "1.0.0", note: "<p>fixed</p>" }]), "## 1.0.0\n\nfixed");
});

test("isNewer follows semver and keeps prereleases off the stable channel", () => {
  assert.equal(core.isNewer("0.1.1", "0.1.0"), true);
  assert.equal(core.isNewer("0.1.0", "0.1.0"), false);
  assert.equal(core.isNewer("0.0.9", "0.1.0"), false);
  assert.equal(core.isNewer("0.10.0", "0.9.0"), true);
  assert.equal(core.isNewer("0.2.0-beta.1", "0.1.0"), false);
  assert.equal(core.isNewer("0.2.0-beta.1", "0.1.0", { allowPrerelease: true }), true);
  assert.equal(core.isNewer("0.2.0", "0.2.0-beta.1", { allowPrerelease: true }), true);
  assert.equal(core.isNewer("0.2.0", "0.2.0-beta.1"), true);
  assert.equal(core.isNewer("nope", "0.1.0"), false);
});

test("pickMacZip picks the zip for the running arch", () => {
  const { files } = core.parseUpdateInfo(MAC_YML);
  assert.equal(core.pickMacZip(files, "arm64").url, "Nightjar-mac-arm64.zip");
  assert.equal(core.pickMacZip(files, "x64").url, "Nightjar-mac-x64.zip");
  assert.equal(core.pickMacDmg(files, "arm64").url, "Nightjar-mac-arm64.dmg");
  assert.equal(core.pickMacZip(files.filter((f) => !f.url.includes("arm64")), "arm64"), null);
  assert.equal(core.pickMacZip([{ url: "Nightjar-mac-universal.zip", sha512: "u" }], "arm64").url, "Nightjar-mac-universal.zip");
});

test("resolveFileUrl joins feed-relative names", () => {
  assert.equal(core.resolveFileUrl("http://127.0.0.1:8080/", "Nightjar-mac-arm64.zip"), "http://127.0.0.1:8080/Nightjar-mac-arm64.zip");
  assert.equal(core.resolveFileUrl("http://127.0.0.1:8080/feed", "a b.zip"), "http://127.0.0.1:8080/feed/a%20b.zip");
  assert.equal(core.resolveFileUrl("https://x/", "https://cdn/y.zip"), "https://cdn/y.zip");
});

test("pickNewestRelease skips drafts and, off beta, prereleases", () => {
  const asset = (tag) => [{ name: "latest-mac.yml", browser_download_url: `https://dl/${tag}/latest-mac.yml` }];
  const releases = [
    { tag_name: "v0.3.0", draft: true, prerelease: false, assets: asset("v0.3.0") },
    { tag_name: "v0.2.1-beta.2", draft: false, prerelease: true, assets: asset("v0.2.1-beta.2") },
    { tag_name: "v0.2.0", draft: false, prerelease: false, assets: asset("v0.2.0"), html_url: "https://gh/v0.2.0" },
    { tag_name: "v0.4.0", draft: false, prerelease: false, assets: [] },
    { tag_name: "v0.1.0", draft: false, prerelease: false, assets: asset("v0.1.0") },
  ];
  assert.equal(core.pickNewestRelease(releases, "latest-mac.yml").version, "0.2.0");
  const beta = core.pickNewestRelease(releases, "latest-mac.yml", { allowPrerelease: true });
  assert.equal(beta.version, "0.2.1-beta.2");
  assert.equal(beta.tag, "v0.2.1-beta.2");
  assert.equal(core.pickNewestRelease([], "latest-mac.yml"), null);
});

test("verifySha512 accepts base64 and hex digests and rejects others", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-test-"));
  const file = path.join(dir, "blob.bin");
  const data = crypto.randomBytes(300_000);
  fs.writeFileSync(file, data);
  const digest = crypto.createHash("sha512").update(data).digest();
  assert.equal(await core.sha512File(file), digest.toString("base64"));
  assert.equal(await core.verifySha512(file, digest.toString("base64")), true);
  assert.equal(await core.verifySha512(file, digest.toString("hex")), true);
  assert.equal(await core.verifySha512(file, "AAAA"), false);
  fs.writeFileSync(file, Buffer.concat([data, Buffer.from("x")]));
  assert.equal(await core.verifySha512(file, digest.toString("base64")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appBundleFromExe finds the .app around the executable", () => {
  assert.equal(core.appBundleFromExe("/Applications/Nightjar.app/Contents/MacOS/Nightjar"), "/Applications/Nightjar.app");
  assert.equal(core.appBundleFromExe("/tmp/x/Nightjar.app/Contents/MacOS/Nightjar"), "/tmp/x/Nightjar.app");
  // A 0.3.x install that its own updater moved to this version.
  assert.equal(core.appBundleFromExe("/Applications/Stratus.app/Contents/MacOS/Nightjar"), "/Applications/Stratus.app");
  assert.equal(core.appBundleFromExe("C:\\Program Files\\Nightjar\\Nightjar.exe"), null);
});

test("renamedBundlePath only renames the pre-rename bundle name", () => {
  assert.equal(core.renamedBundlePath("/Applications/Stratus.app"), "/Applications/Nightjar.app");
  assert.equal(core.renamedBundlePath("/Users/me/Applications/Stratus.app/"), "/Users/me/Applications/Nightjar.app");
  assert.equal(core.renamedBundlePath("/Applications/Nightjar.app"), null);
  assert.equal(core.renamedBundlePath("/Applications/My Stratus.app"), null);
  assert.equal(core.renamedBundlePath("/Applications/stratus.app"), null);
  assert.equal(core.renamedBundlePath(null), null);
});

test("the 0.3.x feed and release names still parse and pick", () => {
  const yml = MAC_YML.replaceAll("Nightjar-", "Stratus-");
  const { files } = core.parseUpdateInfo(yml);
  assert.equal(core.pickMacZip(files, "arm64").url, "Stratus-mac-arm64.zip");
});

test("the updater reads releases from the renamed repo", () => {
  assert.equal(core.GITHUB_RELEASES, "https://github.com/Frexxty/nightjar/releases");
});
