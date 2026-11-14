// Legibility check, run after generate.mjs. Unpacks build/icon.icns and lays
// the small rasters out at 1:1 on dark and light strips, then writes:
//   /tmp/nightjar-check-x1.png   the strip at 1:1
//   /tmp/nightjar-check-x4.png   the same, 4x with hard pixels
//   /tmp/nightjar-maskable.png   the maskable PWA icon inside a circle mask
//   /tmp/nightjar-dmg-labels.png the DMG background with black and white
//                                Finder labels drawn on, as in light and dark mode
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(os.tmpdir(), "nightjar-brand-out");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-check-"));
execFileSync("iconutil", ["-c", "iconset", path.join(root, "build/icon.icns"), "-o", path.join(tmp, "icon.iconset")]);
console.log(fs.readdirSync(path.join(tmp, "icon.iconset")).sort().join("\n"));

const items = [
  [path.join(tmp, "icon.iconset/icon_16x16.png"), 16],
  [path.join(tmp, "icon.iconset/icon_32x32.png"), 32],
  [path.join(tmp, "icon.iconset/icon_32x32@2x.png"), 64],
  [path.join(tmp, "icon.iconset/icon_128x128.png"), 128],
  [path.join(out, "icon-windows-16.png"), 16],
  [path.join(out, "icon-windows-24.png"), 24],
  [path.join(out, "icon-windows-32.png"), 32],
  [path.join(out, "icon-windows-48.png"), 48],
  [path.join(root, "build/trayTemplate.png"), 16],
  [path.join(root, "build/trayTemplate@2x.png"), 32],
  [path.join(root, "build/tray.png"), 16],
  [path.join(root, "build/tray.png"), 32],
  [path.join(root, "public/favicon.png"), 16],
  [path.join(root, "public/favicon.png"), 64],
];
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
let x = 12;
const row = items
  .map(([f, s]) => {
    const img = `<image x="${x}" y="${70 - s / 2}" width="${s}" height="${s}" href="${b64(f)}"/>`;
    x += s + 14;
    return img;
  })
  .join("");
const W = x;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="280"><rect width="${W}" height="140" fill="#202024"/><rect y="140" width="${W}" height="140" fill="#f2f2f4"/>${row}<g transform="translate(0 140)">${row}</g></svg>`;
fs.writeFileSync(path.join(tmp, "sheet.svg"), svg);
execFileSync("rsvg-convert", [path.join(tmp, "sheet.svg"), "-o", "/tmp/nightjar-check-x1.png"]);
fs.writeFileSync(
  path.join(tmp, "sheet4.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${280 * 4}"><image width="${W * 4}" height="${280 * 4}" style="image-rendering:pixelated" href="${b64("/tmp/nightjar-check-x1.png")}"/></svg>`,
);
execFileSync("rsvg-convert", [path.join(tmp, "sheet4.svg"), "-o", "/tmp/nightjar-check-x4.png"]);

// Maskable icon under a circle mask (the smallest mask Android applies) and
// under a squircle, next to the unmasked file with the 80% safe circle drawn.
const mk = b64(path.join(root, "web/icons/maskable-512.png"));
fs.writeFileSync(
  path.join(tmp, "mask.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="380"><rect width="1100" height="380" fill="#e8e8ec"/>
<defs><clipPath id="c"><circle cx="180" cy="190" r="160"/></clipPath><clipPath id="s"><rect x="390" y="30" width="320" height="320" rx="72"/></clipPath></defs>
<image x="20" y="30" width="320" height="320" href="${mk}" clip-path="url(#c)"/>
<image x="390" y="30" width="320" height="320" href="${mk}" clip-path="url(#s)"/>
<image x="760" y="30" width="320" height="320" href="${mk}"/><circle cx="920" cy="190" r="128" fill="none" stroke="#fff" stroke-dasharray="6 6" stroke-width="2"/></svg>`,
);
execFileSync("rsvg-convert", [path.join(tmp, "mask.svg"), "-o", "/tmp/nightjar-maskable.png"]);

// DMG with Finder-style labels (12 px, centred under 80 px icons) in both modes.
const dmg = b64(path.join(root, "build/dmg-background.png"));
const lab = (dx, fill) =>
  `<g transform="translate(${dx} 0)"><image width="540" height="380" href="${dmg}"/>` +
  `<rect x="100" y="150" width="80" height="80" rx="18" fill="#fff" fill-opacity="0.25"/><rect x="360" y="150" width="80" height="80" rx="18" fill="#fff" fill-opacity="0.25"/>` +
  `<text x="140" y="249" font-family="Helvetica" font-size="12" text-anchor="middle" fill="${fill}">Nightjar</text>` +
  `<text x="400" y="249" font-family="Helvetica" font-size="12" text-anchor="middle" fill="${fill}">Applications</text></g>`;
fs.writeFileSync(path.join(tmp, "dmg.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="380">${lab(0, "#000")}${lab(560, "#fff")}</svg>`);
execFileSync("rsvg-convert", ["-z", "2", path.join(tmp, "dmg.svg"), "-o", "/tmp/nightjar-dmg-labels.png"]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("wrote /tmp/nightjar-check-x1.png, -x4.png, /tmp/nightjar-maskable.png, /tmp/nightjar-dmg-labels.png");
