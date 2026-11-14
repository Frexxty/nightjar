// Pure helpers for the updater: feed parsing, version rules, file picking and
// checksum verification. Nothing here touches Electron, so `node --test` can
// cover it directly (see test/update-core.test.cjs).
const crypto = require("node:crypto");
const fs = require("node:fs");
const semver = require("semver");
const yaml = require("js-yaml");

const GITHUB_OWNER = "Frexxty";
// The repo was Frexxty/stratus before the rename. GitHub redirects the old
// name, which is how 0.3.x installs still find releases published here.
const GITHUB_REPO = "nightjar";
const GITHUB_RELEASES = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const GITHUB_API_RELEASES = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

// Parses electron-builder's latest.yml / latest-mac.yml. Throws on anything
// that can't drive an update, so a broken feed shows up as an error instead
// of a silent "up to date".
function parseUpdateInfo(text) {
  const doc = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (!doc || typeof doc !== "object") throw new Error("Update feed is empty");
  const version = semver.valid(String(doc.version ?? ""));
  if (!version) throw new Error(`Update feed has an invalid version: ${doc.version}`);
  let files = Array.isArray(doc.files) ? doc.files : [];
  // Very old feeds only have the top-level path/sha512 pair.
  if (files.length === 0 && doc.path) files = [{ url: doc.path, sha512: doc.sha512, size: doc.size }];
  files = files
    .filter((f) => f && typeof f.url === "string" && typeof f.sha512 === "string")
    .map((f) => ({ url: f.url, sha512: f.sha512, size: typeof f.size === "number" ? f.size : undefined }));
  if (files.length === 0) throw new Error("Update feed lists no files");
  return {
    version,
    files,
    releaseNotes: normalizeNotes(doc.releaseNotes),
    releaseDate: doc.releaseDate ? String(doc.releaseDate) : undefined,
  };
}

// electron-updater hands notes over as a string, an array of {version, note},
// or HTML from GitHub's Atom feed. The renderer only shows plain markdown.
function normalizeNotes(notes) {
  if (notes == null) return "";
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === "string" ? n : `## ${n.version}\n\n${htmlToText(String(n.note ?? ""))}`))
      .join("\n\n")
      .trim();
  }
  return htmlToText(String(notes)).trim();
}

function htmlToText(text) {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h\d|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n");
}

// True when `remote` should be offered to someone running `current`.
// Prereleases are only offered on the beta channel.
function isNewer(remote, current, { allowPrerelease = false } = {}) {
  const r = semver.valid(remote);
  const c = semver.valid(current);
  if (!r || !c) return false;
  if (!allowPrerelease && semver.prerelease(r)) return false;
  return semver.gt(r, c);
}

// The mac feed lists the dmg and zip for every arch. We install from the zip.
function pickMacZip(files, arch) {
  const zips = files.filter((f) => /\.zip$/i.test(f.url));
  const isArm = (f) => /arm64/i.test(f.url);
  if (arch === "arm64") {
    return zips.find(isArm) ?? zips.find((f) => /universal/i.test(f.url)) ?? null;
  }
  return zips.find((f) => !isArm(f)) ?? null;
}

function pickMacDmg(files, arch) {
  const dmgs = files.filter((f) => /\.dmg$/i.test(f.url));
  const isArm = (f) => /arm64/i.test(f.url);
  return (arch === "arm64" ? dmgs.find(isArm) : dmgs.find((f) => !isArm(f))) ?? dmgs[0] ?? null;
}

// Feed file names are relative to the folder the yml came from.
function resolveFileUrl(base, url) {
  if (/^https?:\/\//i.test(url)) return url;
  const dir = base.endsWith("/") ? base : `${base}/`;
  return new URL(url.split("/").map(encodeURIComponent).join("/"), dir).toString();
}

// Out of a GitHub /releases listing, the newest published release that has
// the given feed file attached.
function pickNewestRelease(releases, feedName, { allowPrerelease = false } = {}) {
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft) continue;
    if (release.prerelease && !allowPrerelease) continue;
    const version = semver.valid(semver.clean(String(release.tag_name ?? "")) ?? "");
    if (!version) continue;
    if (semver.prerelease(version) && !allowPrerelease) continue;
    const asset = (release.assets ?? []).find((a) => a.name === feedName);
    if (!asset) continue;
    if (!best || semver.gt(version, best.version)) {
      best = { version, tag: release.tag_name, feedUrl: asset.browser_download_url, htmlUrl: release.html_url };
    }
  }
  return best;
}

function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("base64")));
  });
}

// electron-builder writes base64 sha512. Older feeds used hex; accept both.
async function verifySha512(file, expected) {
  const actual = await sha512File(file);
  const want = String(expected ?? "").trim();
  if (actual === want) return true;
  if (/^[0-9a-f]{128}$/i.test(want)) return Buffer.from(actual, "base64").toString("hex") === want.toLowerCase();
  return false;
}

// /Applications/Nightjar.app/Contents/MacOS/Nightjar -> /Applications/Nightjar.app
function appBundleFromExe(exe) {
  const match = /^(.*?\.app)(?:\/|$)/.exec(exe);
  return match ? match[1] : null;
}

const BUNDLE_NAME = "Nightjar.app";
const LEGACY_BUNDLE_NAME = "Stratus.app";

// /Applications/Stratus.app -> /Applications/Nightjar.app. Null for any other
// name, so a bundle the user renamed themselves stays as they named it.
function renamedBundlePath(bundle) {
  if (!bundle) return null;
  const trimmed = bundle.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (trimmed.slice(slash + 1) !== LEGACY_BUNDLE_NAME) return null;
  return `${trimmed.slice(0, slash + 1)}${BUNDLE_NAME}`;
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_RELEASES,
  GITHUB_API_RELEASES,
  parseUpdateInfo,
  normalizeNotes,
  htmlToText,
  isNewer,
  pickMacZip,
  pickMacDmg,
  resolveFileUrl,
  pickNewestRelease,
  sha512File,
  verifySha512,
  appBundleFromExe,
  BUNDLE_NAME,
  LEGACY_BUNDLE_NAME,
  renamedBundlePath,
};
