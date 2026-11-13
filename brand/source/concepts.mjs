// Renders the three concept tiles to brand/source/concepts/*.svg plus a
// comparison sheet, concepts/sheet.png. B was refined into the final mark.
// node brand/source/concepts.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldS, strata, horizon } from "./mark.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "concepts");
fs.mkdirSync(out, { recursive: true });

const tile = (inner, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ff7a26"/><stop offset="1" stop-color="#ff4a00"/>
</linearGradient>
${defs}
</defs>
<rect x="100" y="100" width="824" height="824" rx="185.4" fill="#151517"/>
${inner}
</svg>`;

// A: strata
const sizeA = 500;
fs.writeFileSync(path.join(out, "a-strata.svg"), tile(`<path fill="url(#ember)" d="${strata({ size: sizeA, x0: 512 - sizeA / 2, y0: 512 - (4 * 0.15 + 3 * 0.083) * sizeA / 2 })}"/>`));

// B: fold S
const s = foldS({ t: 118, g: 42, w: 540, x0: 512 - 270, y0: 0 });
const yB = 512 - s.height / 2;
const sB = foldS({ t: 118, g: 42, w: 540, x0: 512 - 270, y0: yB });
fs.writeFileSync(path.join(out, "b-fold-s.svg"), tile(`<path fill="url(#ember)" d="${sB.d}"/>`));

// C: horizon
const h = horizon({ size: 520, x0: 512 - 260, y0: 512 - 260 });
fs.writeFileSync(
  path.join(out, "c-horizon.svg"),
  tile(
    `<path fill="url(#ember)" mask="url(#cuts)" d="${h.disc}"/>`,
    `<mask id="cuts" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="${h.cuts}" fill="#000"/></mask>`,
  ),
);
// Comparison sheet: each concept at 190, 64, 32 and 16 px on dark and light.
// The per-size rasters are intermediates and stay in a temp dir.
import { execFileSync } from "node:child_process";
import os from "node:os";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-concepts-"));
const names = ["a-strata", "b-fold-s", "c-horizon"];
for (const c of names)
  for (const s of [256, 64, 32, 16])
    execFileSync("rsvg-convert", ["-w", s, "-h", s, path.join(out, `${c}.svg`), "-o", path.join(tmp, `${c}-${s}.png`)].map(String));
const row = names
  .map((c, i) => {
    const x = 20 + i * 300;
    return `<image x="${x}" y="10" width="190" height="190" href="${c}-256.png"/>
<image x="${x + 196}" y="20" width="64" height="64" href="${c}-64.png"/>
<image x="${x + 196}" y="100" width="32" height="32" href="${c}-32.png"/>
<image x="${x + 240}" y="108" width="16" height="16" href="${c}-16.png"/>`;
  })
  .join("\n");
fs.writeFileSync(
  path.join(tmp, "sheet.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="420">
<rect width="920" height="210" fill="#2a2a2e"/><rect y="210" width="920" height="210" fill="#e9e9ec"/>
<g>${row}</g><g transform="translate(0 210)">${row}</g></svg>`,
);
execFileSync("rsvg-convert", [path.join(tmp, "sheet.svg"), "-o", path.join(out, "sheet.png")]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("wrote", fs.readdirSync(out).length, "files");
