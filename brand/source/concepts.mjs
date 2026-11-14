// Renders the three play-shape concepts to brand/source/concepts/*.svg plus a
// comparison sheet, concepts/sheet.png: each concept as an app icon at 1024
// (shown at 256), 128, 32 and 16 px, on a dark and a light page.
//   node brand/source/concepts.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prism, fold, wing, placement } from "./mark.mjs";
import { transform, toD } from "./geometry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "concepts");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const TONE = { violet: "#6650E6", rose: "#D6478A", ember: "#EF5035" };

function tile(concept) {
  const m = concept;
  const p = placement(m.silhouette, { cx: 512, cy: 512, h: 500 });
  const body = m.layers
    .map((l) => `<path fill="${TONE[l.tone]}"${l.opacity ? ` fill-opacity="${l.opacity}"` : ""} d="${toD(transform(l.shape, p.k, p.dx, p.dy))}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E1A38"/><stop offset="1" stop-color="#0E0D1A"/></linearGradient></defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)"/>${body}</svg>`;
}

const concepts = { "a-prism": prism(), "b-fold": fold(), "c-wing": wing() };
for (const [name, c] of Object.entries(concepts)) fs.writeFileSync(path.join(out, `${name}.svg`), tile(c));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-concepts-"));
const names = Object.keys(concepts);
for (const c of names)
  for (const s of [1024, 128, 32, 16])
    execFileSync("rsvg-convert", ["-w", s, "-h", s, path.join(out, `${c}.svg`), "-o", path.join(tmp, `${c}-${s}.png`)].map(String));
const row = names
  .map((c, i) => {
    const x = 24 + i * 470;
    return `<image x="${x}" y="22" width="256" height="256" href="${c}-1024.png"/>
<image x="${x + 270}" y="22" width="128" height="128" href="${c}-128.png"/>
<image x="${x + 270}" y="170" width="32" height="32" href="${c}-32.png"/>
<image x="${x + 320}" y="178" width="16" height="16" href="${c}-16.png"/>`;
  })
  .join("\n");
const W = 24 + names.length * 470;
fs.writeFileSync(
  path.join(tmp, "sheet.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="600">
<rect width="${W}" height="300" fill="#0C0B12"/><rect y="300" width="${W}" height="300" fill="#F2F2F5"/>
<g>${row}</g><g transform="translate(0 300)">${row}</g></svg>`,
);
execFileSync("rsvg-convert", [path.join(tmp, "sheet.svg"), "-o", path.join(out, "sheet.png")]);
// 1:1 small-size strip blown up 4x with hard pixels, for judging 16 and 32 px.
const small = names
  .map((c, i) => `<image x="${8 + i * 64}" y="8" width="32" height="32" href="${c}-32.png"/><image x="${44 + i * 64}" y="16" width="16" height="16" href="${c}-16.png"/>`)
  .join("");
const sw = 8 + names.length * 64;
fs.writeFileSync(path.join(tmp, "small.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="96"><rect width="${sw}" height="48" fill="#0C0B12"/><rect y="48" width="${sw}" height="48" fill="#F2F2F5"/>${small}<g transform="translate(0 48)">${small}</g></svg>`);
execFileSync("rsvg-convert", [path.join(tmp, "small.svg"), "-o", path.join(tmp, "small1x.png")]);
fs.writeFileSync(path.join(tmp, "small4.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${sw * 6}" height="${96 * 6}"><image width="${sw * 6}" height="${96 * 6}" style="image-rendering:pixelated" href="small1x.png"/></svg>`);
execFileSync("rsvg-convert", [path.join(tmp, "small4.svg"), "-o", path.join(out, "sheet-small.png")]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("wrote", fs.readdirSync(out).join(", "));
