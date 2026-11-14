// Prints the release notes for a version: its section of CHANGELOG.md, or the
// annotated tag's message when the changelog has no section for it.
//   node scripts/release-notes.mjs 0.1.0 [--out file]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const version = (args[0] ?? "").replace(/^v/, "");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : null;
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version> [--out file]");
  process.exit(2);
}

function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`).test(l));
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

function tagMessage(tag) {
  try {
    // Lightweight tags have no message; git falls back to the commit subject.
    const type = execFileSync("git", ["cat-file", "-t", tag], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (type !== "tag") return "";
    return execFileSync("git", ["tag", "-l", "--format=%(contents)", tag], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

let notes = "";
try {
  notes = changelogSection(readFileSync("CHANGELOG.md", "utf8"), version);
} catch {
  // No changelog; try the tag.
}
notes ||= tagMessage(`v${version}`);
notes ||= `Nightjar ${version}`;

if (out) writeFileSync(out, `${notes}\n`);
else process.stdout.write(`${notes}\n`);
