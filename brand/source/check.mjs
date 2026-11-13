// Legibility check, run after generate.mjs: unpacks build/icon.icns and lays every small raster out at 1:1 on
// dark and light strips, so legibility can be checked by eye.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-check-"));
execFileSync("iconutil", ["-c", "iconset", path.join(root, "build/icon.icns"), "-o", path.join(tmp, "icon.iconset")]);
const listing = fs.readdirSync(path.join(tmp, "icon.iconset")).sort();
console.log(listing.join("\n"));

const items = [
  ["icon.iconset/icon_16x16.png", 16],
  ["icon.iconset/icon_32x32.png", 32],
  ["icon.iconset/icon_32x32@2x.png", 64],
  ["icon.iconset/icon_128x128.png", 128],
  [path.join(os.tmpdir(), "stratus-brand-out/icon-windows-16.png"), 16],
  [path.join(os.tmpdir(), "stratus-brand-out/icon-windows-32.png"), 32],
  [path.join(root, "build/trayTemplate.png"), 16],
  [path.join(root, "build/trayTemplate@2x.png"), 32],
  [path.join(root, "build/tray.png"), 32],
  [path.join(root, "public/favicon.png"), 64],
];
let x = 12;
const imgs = items.map(([f, s]) => {
  let src = path.isAbsolute(f) ? f : path.join(tmp, f);
  if (path.isAbsolute(f)) {
    const copy = path.join(tmp, f.replace(/[\/@]/g, "_"));
    fs.copyFileSync(f, copy);
    src = copy;
  }
  const out = `<image x="${x}" y="${70 - s / 2}" width="${s}" height="${s}" href="${src}"/>`;
  x += s + 14;
  return out;
});
const row = imgs.join("");
const W = x;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="280"><rect width="${W}" height="140" fill="#2a2a2e"/><rect y="140" width="${W}" height="140" fill="#f2f2f4"/>${row}<g transform="translate(0 140)">${row}</g></svg>`;
fs.writeFileSync(path.join(tmp, "sheet.svg"), svg);
execFileSync("rsvg-convert", [path.join(tmp, "sheet.svg"), "-o", path.join(tmp, "sheet1x.png")]);
// Nearest-neighbour upscale via sips is not available for x4, so embed again with a 4x transform.
fs.writeFileSync(
  path.join(tmp, "sheet4.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${280 * 4}"><image width="${W * 4}" height="${280 * 4}" style="image-rendering:pixelated" href="${path.join(tmp, "sheet1x.png")}"/></svg>`,
);
execFileSync("rsvg-convert", [path.join(tmp, "sheet4.svg"), "-o", "/tmp/stratus-check-x4.png"]);
fs.copyFileSync(path.join(tmp, "sheet1x.png"), "/tmp/stratus-check-x1.png");
console.log(tmp);
