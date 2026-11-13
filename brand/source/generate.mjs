// Builds every Stratus logo, icon and brand asset from vector source.
//
//   npm install --no-save opentype.js @fontsource/inter png-to-ico
//   node brand/source/generate.mjs
//
// Needs rsvg-convert (brew install librsvg) and, for build/icon.icns, macOS
// iconutil. All text is converted to outlines with opentype.js, so the SVGs
// render the same everywhere and need no fonts installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { markParts, foldS } from "./mark.mjs";

const require = createRequire(import.meta.url);
const opentype = require("opentype.js");
const { default: pngToIco } = require("png-to-ico");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = (...p) => path.join(root, ...p);
for (const d of ["build", "public", "brand", "src/assets"]) fs.mkdirSync(at(d), { recursive: true });
// Intermediate rasters and SVGs that don't ship go here (check.mjs reads them).
export const OUT = path.join(os.tmpdir(), "stratus-brand-out");
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- palette

export const C = {
  ember: "#FF5500",
  emberLight: "#FF7A26",
  emberDeep: "#FF4A00",
  night: "#101012",
  panel: "#161618",
  raised: "#1F1F22",
  mist: "#F4F4F6",
  paper: "#ECECEF",
  ink: "#121214",
};
const FOLD_SHADE = 0.28; // black over the ember gradient on the two turns

const emberGradient = (id = "ember") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.emberLight}"/><stop offset="1" stop-color="${C.emberDeep}"/></linearGradient>`;

// ---------------------------------------------------------------- type

const fonts = {};
for (const wt of [400, 500, 600]) {
  const buf = fs.readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${wt}-normal.woff`));
  fonts[wt] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const CAP = 1490 / 2048; // Inter cap height in em

function measure(str, size, weight = 600, track = 0) {
  const f = fonts[weight];
  let w = 0;
  const chars = [...str];
  chars.forEach((ch, i) => {
    w += (f.charToGlyph(ch).advanceWidth / f.unitsPerEm) * size;
    if (i < chars.length - 1) w += track * size;
  });
  return w;
}

/** Text as outlined path data. anchor: start | middle | end. */
function text(str, { x, y, size, weight = 600, track = 0, anchor = "start", fill = C.mist, opacity }) {
  const f = fonts[weight];
  let cx = x;
  const w = measure(str, size, weight, track);
  if (anchor === "middle") cx -= w / 2;
  if (anchor === "end") cx -= w;
  let d = "";
  for (const ch of str) {
    const g = f.charToGlyph(ch);
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth / f.unitsPerEm) * size + track * size;
  }
  const op = opacity != null ? ` fill-opacity="${opacity}"` : "";
  return `<path fill="${fill}"${op} d="${d}"/>`;
}

// ---------------------------------------------------------------- mark

/**
 * mode "ember": gradient with shaded folds.
 * mode "mono":  one colour, folds at reduced opacity.
 * mode "solid": one colour, no fold shading (tiny sizes, template images).
 */
function mark({ cx, cy, w, mode = "ember", color = C.mist, t, g, gradient = "ember" }) {
  const m = markParts({ cx, cy, w, t, g });
  if (mode === "ember")
    return `<path fill="url(#${gradient})" d="${m.outline}"/><path fill="#000" fill-opacity="${FOLD_SHADE}" d="${m.folds}"/>`;
  if (mode === "mono") return `<path fill="${color}" fill-opacity="0.5" d="${m.outline}"/><path fill="${color}" d="${m.runs}"/>`;
  return `<path fill="${color}" d="${m.outline}"/>`;
}
const markHeight = (w) => markParts({ cx: 0, cy: 0, w }).h;

/** Mark + "Stratus" on one line, vertically centred on cy. Returns { svg, width }. */
function lockup({ x, cy, markW, textFill = C.mist, mode = "ember", color }) {
  const mh = markHeight(markW);
  const size = (mh * 1.02) / CAP;
  const gap = mh * 0.5;
  const track = -0.025;
  const tw = measure("Stratus", size, 600, track);
  const svg =
    mark({ cx: x + markW / 2, cy, w: markW, mode, color }) +
    text("Stratus", { x: x + markW + gap, y: cy + (CAP * size) / 2, size, weight: 600, track, fill: textFill });
  return { svg, width: markW + gap + tw, height: mh };
}

// ---------------------------------------------------------------- docs

const svgDoc = (w, h, body, defs = "", vb = `0 0 ${w} ${h}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>\n`;

const abs = (p) => (path.isAbsolute(p) ? p : at(p));
function write(p, content) {
  fs.writeFileSync(abs(p), content);
  return abs(p);
}
function png(svgPath, out, w, h = w) {
  execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), svgPath, "-o", abs(out)]);
  return abs(out);
}

// ---------------------------------------------------------------- app icons

const MAC = { x: 100, y: 100, s: 824, r: 185.4 }; // Apple's 1024 grid

/**
 * Apple's icon tile uses continuous corners rather than circular ones. A
 * superellipse with n = 5 matches it closely (its 45 degree point sits where a
 * 185.4 px circular corner's would on an 824 px tile).
 */
function squircle(x, y, s, n = 5, steps = 256) {
  const a = s / 2;
  const cx = x + a;
  const cy = y + a;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + a * Math.sign(sn) * Math.abs(sn) ** (2 / n)]);
  }
  return "M" + pts.map(([px, py]) => `${px.toFixed(2)} ${py.toFixed(2)}`).join("L") + "Z";
}
const shadowFilter = (id = "tileShadow") =>
  `<filter id="${id}" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="14"/></filter>`;

/** The macOS tile and mark in 1024 space. */
function macIconBody({ shadow = true, gradient = "ember", filterId = "tileShadow" } = {}) {
  const { x, y, s, r } = MAC;
  return (
    (shadow ? `<path transform="translate(0 12)" d="${squircle(x, y, s)}" fill="#000" fill-opacity="0.42" filter="url(#${filterId})"/>` : "") +
    `<path d="${squircle(x, y, s)}" fill="${C.panel}"/>` +
    `<path d="${squircle(x + 1.5, y + 1.5, s - 3)}" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="3"/>` +
    mark({ cx: 512, cy: 512, w: 590, gradient })
  );
}

/** Windows / favicon tile: nearly full bleed, mark a bit larger. */
function winIconBody({ small = false } = {}) {
  const inset = small ? 0 : 24;
  const s = 1024 - inset * 2;
  const r = small ? 200 : 210;
  return (
    `<rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="${C.panel}"/>` +
    (small ? "" : `<rect x="${inset + 2}" y="${inset + 2}" width="${s - 4}" height="${s - 4}" rx="${r - 2}" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="4"/>`) +
    mark({ cx: 512, cy: 512, w: small ? 800 : 700, mode: small ? "solid" : "ember", color: "url(#ember)" })
  );
}

const iconSvg = write("build/icon.svg", svgDoc(1024, 1024, macIconBody(), emberGradient() + shadowFilter()));
const winSvg = write("brand/source/icon-windows.svg", svgDoc(1024, 1024, winIconBody(), emberGradient()));
const winSmallSvg = write("brand/source/icon-windows-small.svg", svgDoc(1024, 1024, winIconBody({ small: true }), emberGradient()));
png(iconSvg, "build/icon.png", 1024);

/**
 * Hand-hinted macOS icons for the 16 and 32 px slots: same tile grid, but the
 * mark is snapped to whole pixels and drawn a little larger so the three
 * bands stay separate. 16 px drops the fold shading.
 */
function macSmallSvg(size) {
  const k = size / 1024;
  const tile = `<path d="${squircle(MAC.x * k, MAC.y * k, MAC.s * k)}" fill="${C.panel}"/>`;
  const spec = size === 16 ? { t: 2, g: 1, w: 11, cy: 8 } : { t: 4, g: 2, w: 22, cy: 16 };
  const m = mark({ cx: size / 2, cy: spec.cy, w: spec.w, t: spec.t, g: spec.g, mode: size === 16 ? "solid" : "ember", color: "url(#ember)" });
  return write(path.join(OUT, `icon-mac-${size}.svg`), svgDoc(size, size, tile + m, emberGradient()));
}
const macSmall = { 16: macSmallSvg(16), 32: macSmallSvg(32) };

// macOS .icns
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-")) + "/icon.iconset";
  fs.mkdirSync(dir);
  const src = (px) => macSmall[px] ?? iconSvg;
  for (const base of [16, 32, 128, 256, 512]) {
    execFileSync("rsvg-convert", ["-w", String(base), "-h", String(base), src(base), "-o", `${dir}/icon_${base}x${base}.png`]);
    execFileSync("rsvg-convert", ["-w", String(base * 2), "-h", String(base * 2), src(base * 2), "-o", `${dir}/icon_${base}x${base}@2x.png`]);
  }
  execFileSync("iconutil", ["-c", "icns", dir, "-o", at("build/icon.icns")]);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}

// Windows .ico: 16 and 24 use the simplified full-bleed tile.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-ico-"));
  const files = [16, 24, 32, 48, 64, 128, 256].map((s) => {
    const f = `${dir}/${s}.png`;
    execFileSync("rsvg-convert", ["-w", String(s), "-h", String(s), s <= 24 ? winSmallSvg : winSvg, "-o", f]);
    return f;
  });
  for (const s of [16, 32, 256]) fs.copyFileSync(`${dir}/${s}.png`, path.join(OUT, `icon-windows-${s}.png`));
  fs.writeFileSync(at("build/icon.ico"), await pngToIco(files));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- tray

// Template images: black on transparent, snapped to whole pixels.
{
  const t1 = foldS({ t: 3, g: 1, w: 16, x0: 0, y0: 2 });
  const t2 = foldS({ t: 6, g: 2, w: 32, x0: 0, y0: 4 });
  const s1 = write(path.join(OUT, "trayTemplate.svg"), svgDoc(16, 16, `<path fill="#000" d="${t1.d}"/>`));
  const s2 = write(path.join(OUT, "trayTemplate@2x.svg"), svgDoc(32, 32, `<path fill="#000" d="${t2.d}"/>`));
  png(s1, "build/trayTemplate.png", 16);
  png(s2, "build/trayTemplate@2x.png", 32);
  // Windows tray, coloured, on any taskbar.
  const m = markParts({ cx: 16, cy: 15, w: 32, t: 6, g: 2 });
  const s3 = write(
    path.join(OUT, "tray.svg"),
    svgDoc(32, 32, `<path fill="url(#ember)" d="${m.outline}"/><path fill="#000" fill-opacity="${FOLD_SHADE}" d="${m.folds}"/>`, emberGradient()),
  );
  png(s3, "build/tray.png", 32);
}

// ---------------------------------------------------------------- favicon

{
  const fav = write("public/favicon.svg", svgDoc(1024, 1024, winIconBody(), emberGradient()).replace(' width="1024" height="1024"', ""));
  png(fav, "public/favicon.png", 64);
}

// ---------------------------------------------------------------- logos

function tightMark(mode, color) {
  const w = 612;
  const h = markHeight(w);
  const pad = 0;
  return svgDoc(w + pad * 2, h + pad * 2, mark({ cx: w / 2 + pad, cy: h / 2 + pad, w, mode, color }), mode === "ember" ? emberGradient() : "");
}
write("brand/logo-mark.svg", tightMark("ember"));
write(
  "src/assets/logo-mark.svg",
  tightMark("mono", "currentColor").replace(/ width="\d+(\.\d+)?" height="\d+(\.\d+)?"/, ' width="100%" height="100%"'),
);

function wordmarkDoc(textFill) {
  const markW = 300;
  const mh = markHeight(markW);
  // The letters overshoot the cap height a little, so leave room above and below.
  const pad = Math.round(mh * 0.06);
  const L = lockup({ x: 0, cy: mh / 2 + pad, markW, textFill });
  return svgDoc(Math.ceil(L.width) + 4, Math.ceil(mh) + pad * 2, L.svg, emberGradient());
}
write("brand/logo-wordmark.svg", wordmarkDoc(C.mist));
write("brand/logo-wordmark-light.svg", wordmarkDoc(C.ink));

// ---------------------------------------------------------------- atmosphere

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A dusk sky over a stratus deck: flat cloud bands, lit from below by an
 * ember horizon, with film grain. Returns { defs, body } sized w x h.
 */
function atmosphere(id, w, h, { horizon = 0.7, spread = 0.42, seed = 7, bands = 9, glow = 1 } = {}) {
  const r = rng(seed);
  const hy = h * horizon;
  let defs =
    `<linearGradient id="${id}Sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#0B0B0D"/><stop offset="${Math.max(0, horizon - spread)}" stop-color="#121013"/>` +
    `<stop offset="${horizon - 0.07}" stop-color="#341407"/><stop offset="${horizon}" stop-color="#9A3606"/>` +
    `<stop offset="${Math.min(1, horizon + 0.06)}" stop-color="#2B120A"/><stop offset="1" stop-color="#0C0A0A"/></linearGradient>` +
    `<radialGradient id="${id}Glow" cx="0.5" cy="${horizon}" r="0.6" gradientTransform="translate(0.5 ${horizon}) scale(1 0.3) translate(-0.5 ${-horizon})">` +
    `<stop offset="0" stop-color="${C.ember}" stop-opacity="${0.7 * glow}"/><stop offset="1" stop-color="${C.ember}" stop-opacity="0"/></radialGradient>` +
    `<filter id="${id}Deck" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${h * 0.02}"/></filter>` +
    `<filter id="${id}Grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.10"/></feComponentTransfer></filter>`;
  let body = `<rect width="${w}" height="${h}" fill="url(#${id}Sky)"/><rect width="${w}" height="${h}" fill="url(#${id}Glow)"/>`;
  for (let i = 0; i < bands; i++) {
    // Bands get thicker and closer together the nearer they are to the horizon.
    const k = i / Math.max(1, bands - 1);
    const y = hy - h * spread + Math.pow(k, 0.75) * h * (spread + 0.02) + (r() - 0.5) * h * 0.02;
    const th = h * (0.014 + 0.05 * k) * (0.7 + r() * 0.6);
    const len = w * (0.55 + r() * 0.6);
    const x = (r() * 1.1 - 0.45) * w;
    const lit = Math.max(0, 1 - Math.abs(y - hy) / (h * 0.3));
    const blur = Math.max(1.5, th * 0.42);
    defs += `<filter id="${id}B${i}" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter>`;
    // underside lit by the horizon, then the cloud body over its top half
    body +=
      `<rect x="${x}" y="${y + th * 0.55}" width="${len}" height="${th * 0.6}" rx="${th * 0.3}" fill="${C.emberLight}" fill-opacity="${((0.08 + 0.5 * lit) * glow).toFixed(3)}" filter="url(#${id}B${i})"/>` +
      `<rect x="${x}" y="${y}" width="${len}" height="${th}" rx="${th / 2}" fill="#0D0A0B" fill-opacity="${(0.45 + 0.45 * k).toFixed(3)}" filter="url(#${id}B${i})"/>`;
  }
  // low deck below the horizon
  body += `<rect x="${-w * 0.1}" y="${hy + h * 0.03}" width="${w * 1.2}" height="${h}" fill="#0C0A0A" fill-opacity="0.85" filter="url(#${id}Deck)"/>`;
  body += `<rect width="${w}" height="${h}" filter="url(#${id}Grain)"/>`;
  return { defs, body };
}

// ---------------------------------------------------------------- waveform

function waveform({ x, y, w, h, bar = 3, gap = 1, progress = 0.4, seed = 3, color = C.mist, opacity = 0.32, mid = false }) {
  const r = rng(seed);
  const n = Math.floor(w / (bar + gap));
  let played = "";
  let rest = "";
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const env = 0.35 + 0.45 * Math.sin(k * Math.PI * 1.1 + 0.3) ** 2 + 0.2 * Math.sin(k * 23) ** 2;
    const v = Math.min(1, Math.max(0.08, env * (0.55 + r() * 0.5)));
    const bh = v * h;
    const bx = x + i * (bar + gap);
    const by = mid ? y + (h - bh) / 2 : y + h - bh;
    const rect = `M${bx.toFixed(2)} ${by.toFixed(2)}h${bar}v${bh.toFixed(2)}h-${bar}z`;
    if (k < progress) played += rect;
    else rest += rect;
  }
  return `<path fill="url(#ember)" d="${played}"/><path fill="${color}" fill-opacity="${opacity}" d="${rest}"/>`;
}

// ---------------------------------------------------------------- DMG

{
  const W = 540;
  const H = 380;
  const a = atmosphere("dmg", W, H, { horizon: 0.95, spread: 0.2, seed: 11, bands: 5, glow: 0.5 });
  const L = lockup({ x: 0, cy: 0, markW: 34 });
  const arrow =
    `<g fill="none" stroke="${C.mist}" stroke-opacity="0.38" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M226 190H312"/><path d="M302 180l11 10-11 10"/></g>`;
  const body =
    `<rect width="${W}" height="${H}" fill="${C.night}"/>` +
    a.body +
    `<g transform="translate(${(W - L.width) / 2} 44)">${L.svg}</g>` +
    arrow +
    text("Drag Stratus into Applications", { x: W / 2, y: 318, size: 12.5, weight: 500, anchor: "middle", fill: C.mist, opacity: 0.6, track: 0.01 });
  const s = write("brand/source/dmg-background.svg", svgDoc(W, H, body, emberGradient() + a.defs));
  png(s, "build/dmg-background.png", W, H);
  png(s, "build/dmg-background@2x.png", W * 2, H * 2);
}

// ---------------------------------------------------------------- OG image

{
  const W = 1200;
  const H = 630;
  const a = atmosphere("og", W, H, { horizon: 0.8, seed: 5, bands: 11 });
  const L = lockup({ x: 0, cy: 0, markW: 132 });
  const body =
    a.body +
    `<rect width="${W}" height="${H}" fill="url(#ogShade)"/>` +
    `<g transform="translate(88 150)">${L.svg}</g>` +
    text("Hear every layer.", { x: 86, y: 318, size: 76, weight: 600, track: -0.03, fill: C.mist }) +
    text("An open-source SoundCloud player for macOS and Windows.", { x: 89, y: 372, size: 26, weight: 400, fill: C.mist, opacity: 0.62 });
  const shade = `<linearGradient id="ogShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0B0B0D" stop-opacity="0.75"/><stop offset="0.7" stop-color="#0B0B0D" stop-opacity="0"/></linearGradient>`;
  const s = write("brand/source/og-image.svg", svgDoc(W, H, body, emberGradient() + a.defs + shade));
  png(s, "brand/og-image.png", W, H);
}

// ---------------------------------------------------------------- brand board

{
  const W = 2400;
  const H = 1500;
  const M = 60;
  const G = 24;
  const PW = (W - 2 * M - 2 * G) / 3;
  const PH = (H - 2 * M - 2 * G) / 3;
  const panels = [];
  const label = (num, name, dark = false) =>
    text(num, { x: 36, y: 50, size: 15, weight: 600, fill: dark ? C.night : C.ember, track: 0.04 }) +
    text(name.toUpperCase(), { x: 66, y: 50, size: 15, weight: 500, fill: dark ? C.night : C.mist, opacity: dark ? 0.75 : 0.5, track: 0.12 });
  const bg = (fill) => `<rect width="${PW}" height="${PH}" fill="${fill}"/>`;
  let defs = emberGradient() + shadowFilter();

  // 1. Cover
  {
    const L = lockup({ x: 0, cy: 0, markW: 140 });
    panels.push(
      bg("#131315") +
        `<g transform="translate(${(PW - L.width) / 2} ${PH / 2 - 6})">${L.svg}</g>` +
        label("01", "Logo") +
        text("Brand identity", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45, track: 0.02 }) +
        text("v1.0  2026", { x: PW - 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45, anchor: "end", track: 0.02 }),
    );
  }

  // 2. Construction
  {
    const w = 360;
    const cx = PW / 2;
    const cy = PH / 2 + 4;
    const m = markParts({ cx, cy, w });
    const line = `stroke="${C.mist}" stroke-opacity="0.16" stroke-width="1.5" fill="none"`;
    const ys = [m.y0, m.y0 + m.t, m.y0 + m.p, m.y0 + m.p + m.t, m.y0 + 2 * m.p, m.y0 + 2 * m.p + m.t];
    const xs = [m.x0, m.xL, m.xR, m.x0 + w];
    let guides = ys.map((y) => `<path ${line} d="M24 ${y}H${PW - 24}"/>`).join("");
    guides += xs.map((x) => `<path ${line} d="M${x} 74V${PH - 70}"/>`).join("");
    const c1 = m.y0 + (m.p + m.t) / 2;
    const c2 = m.y0 + 1.5 * m.p + m.t / 2;
    const circ = `stroke="${C.ember}" stroke-opacity="0.75" stroke-width="1.5" fill="none"`;
    guides += `<circle ${circ} cx="${m.xL}" cy="${c1}" r="${m.Ro}"/><circle ${circ} cx="${m.xL}" cy="${c1}" r="${m.Ri}"/>`;
    guides += `<circle ${circ} cx="${m.xR}" cy="${c2}" r="${m.Ro}"/><circle ${circ} cx="${m.xR}" cy="${c2}" r="${m.Ri}"/>`;
    const tick = (x, y1, y2, s) =>
      `<path stroke="${C.mist}" stroke-opacity="0.6" stroke-width="1.5" fill="none" d="M${x} ${y1}V${y2}M${x - 5} ${y1}H${x + 5}M${x - 5} ${y2}H${x + 5}"/>` +
      text(s, { x: x + 12, y: (y1 + y2) / 2 + 5.5, size: 15, weight: 500, opacity: 0.7 });
    const dx = m.x0 + w + 44;
    panels.push(
      bg("#131315") +
        `<g opacity="0.92">${mark({ cx, cy, w })}</g>` +
        guides +
        tick(dx, m.y0, m.y0 + m.t, "t") +
        tick(dx, m.y0 + m.t, m.y0 + m.p, "g") +
        label("02", "Construction") +
        text("One band, folded twice. t : g = 15 : 8, turns on concentric circles.", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45 }),
    );
  }

  // 3. Dock and menu bar
  {
    const a = atmosphere("p3", PW, PH, { horizon: 0.62, seed: 21, bands: 8 });
    defs += a.defs;
    const n = 6;
    const icon = 78;
    const pitch = 82;
    const dw = n * pitch + 18;
    const dx = (PW - dw) / 2;
    const dy = PH - 120;
    const placeholder = (i, x, y) => {
      const s = icon * (824 / 1024);
      const o = (icon - s) / 2;
      const fills = ["#E9E9EC", "#2C2D31", "#5B5D63", "#1F2A36", "#D9D9DD", "#3A3B40"];
      const glyph = [
        `<circle cx="${x + icon / 2}" cy="${y + icon / 2}" r="${s * 0.22}" fill="#9A9AA0"/>`,
        `<rect x="${x + icon / 2 - s * 0.22}" y="${y + icon / 2 - s * 0.22}" width="${s * 0.44}" height="${s * 0.44}" rx="${s * 0.08}" fill="#6B6C72"/>`,
        `<path d="M${x + icon / 2} ${y + o + s * 0.26}L${x + icon / 2 + s * 0.24} ${y + o + s * 0.72}H${x + icon / 2 - s * 0.24}Z" fill="#9A9AA0"/>`,
        `<circle cx="${x + icon / 2}" cy="${y + icon / 2}" r="${s * 0.24}" fill="none" stroke="#7A8592" stroke-width="${s * 0.08}"/>`,
        `<rect x="${x + o + s * 0.24}" y="${y + icon / 2 - s * 0.05}" width="${s * 0.52}" height="${s * 0.1}" rx="${s * 0.05}" fill="#8E8E94"/>`,
        "",
      ][i];
      return `<rect x="${x + o}" y="${y + o}" width="${s}" height="${s}" rx="${s * 0.225}" fill="${fills[i]}"/>${glyph}`;
    };
    let dock = `<rect x="${dx}" y="${dy}" width="${dw}" height="${icon + 18}" rx="24" fill="#fff" fill-opacity="0.13" stroke="#fff" stroke-opacity="0.2" stroke-width="1"/>`;
    const order = [0, 1, 2, "S", 3, 4];
    order.forEach((k, i) => {
      const x = dx + 9 + i * pitch + (pitch - icon) / 2;
      const y = dy + 9;
      if (k === "S") {
        dock += `<g transform="translate(${x} ${y}) scale(${icon / 1024})">${macIconBody()}</g>`;
        dock += `<circle cx="${x + icon / 2}" cy="${dy + icon + 14}" r="2.5" fill="${C.mist}" fill-opacity="0.85"/>`;
        const tw = measure("Stratus", 15, 500) + 28;
        dock += `<rect x="${x + icon / 2 - tw / 2}" y="${dy - 46}" width="${tw}" height="30" rx="8" fill="#1E1E21" fill-opacity="0.92" stroke="#fff" stroke-opacity="0.12"/>`;
        dock += text("Stratus", { x: x + icon / 2, y: dy - 26, size: 15, weight: 500, anchor: "middle" });
      } else dock += placeholder(k, x, y);
    });
    // Menu bar with the template icon.
    const tray = foldS({ t: 3.4, g: 1.4, w: 19, x0: PW - 140, y0: 12 });
    const menubar =
      `<rect width="${PW}" height="36" fill="#000" fill-opacity="0.32"/>` +
      `<path fill="${C.mist}" d="${tray.d}"/>` +
      text("Fri 9:41", { x: PW - 36, y: 23.5, size: 14, weight: 500, anchor: "end" });
    panels.push(a.body + menubar + dock + `<g transform="translate(0 30)">${label("03", "Dock")}</g>`);
  }

  // 4. Promise
  {
    panels.push(
      `<rect width="${PW}" height="${PH}" fill="${C.ember}"/>` +
        label("04", "Promise", true) +
        text("Hear every", { x: 34, y: 268, size: 96, weight: 600, track: -0.035, fill: C.night }) +
        text("layer.", { x: 34, y: 366, size: 96, weight: 600, track: -0.035, fill: C.night }) +
        `<g opacity="0.9">${mark({ cx: PW - 36 - 45, cy: 366 - 26, w: 90, mode: "solid", color: C.night })}</g>`,
    );
  }

  // 5. Colour
  {
    const sw = (x, y, w, h, fill, name, hex, dark, stroke = false) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}"${stroke ? ` stroke="#fff" stroke-opacity="0.1"` : ""}/>` +
      text(name, { x: x + 16, y: y + h - 38, size: 16, weight: 600, fill: dark ? C.night : C.mist }) +
      text(hex, { x: x + 16, y: y + h - 16, size: 14, weight: 500, fill: dark ? C.night : C.mist, opacity: 0.7, track: 0.02 });
    const x0 = 36;
    const full = PW - 72;
    let s = "";
    s += sw(x0, 76, full * 0.62, 176, "url(#ember)", "Ember", "#FF5500", true);
    s += sw(x0 + full * 0.62 + 12, 76, full * 0.38 - 12, 176, C.emberLight, "Ember Light", "#FF7A26", true);
    const neutrals = [
      [C.night, "Night", "#101012", false, true],
      [C.panel, "Panel", "#161618", false, true],
      [C.raised, "Raised", "#1F1F22", false, true],
      [C.mist, "Mist", "#F4F4F6", true],
      [C.paper, "Paper", "#ECECEF", true],
    ];
    const nw = (full - 4 * 12) / 5;
    neutrals.forEach(([f, nm, hx, dark, st], i) => (s += sw(x0 + i * (nw + 12), 264, nw, 140, f, nm, hx, dark, st)));
    panels.push(bg("#131315") + label("05", "Colour") + s);
  }

  // 6. Type
  {
    panels.push(
      bg("#131315") +
        label("06", "Type") +
        text("Aa", { x: 30, y: 300, size: 220, weight: 600, track: -0.04 }) +
        text("Inter", { x: 336, y: 132, size: 46, weight: 600, track: -0.02 }) +
        text("Semibold 600, Medium 500, Regular 400", { x: 338, y: 166, size: 16, weight: 400, opacity: 0.55 }) +
        text("ABCDEFGHIJKLMNOPQRSTUVWXYZ", { x: 338, y: 232, size: 19, weight: 500, track: 0.02, opacity: 0.85 }) +
        text("abcdefghijklmnopqrstuvwxyz", { x: 338, y: 264, size: 19, weight: 400, track: 0.02, opacity: 0.85 }) +
        text("0123456789  &  ?!", { x: 338, y: 296, size: 19, weight: 400, track: 0.02, opacity: 0.85 }) +
        text("In the app: SF Pro on macOS, Segoe UI on Windows.", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45 }),
    );
  }

  // 7. Icon sizes, on dark and light, plus the menu bar template
  {
    const sizes = [128, 64, 32, 16];
    const split = 252;
    const row = (cy, shadow) => {
      let x = 40;
      let s = "";
      for (const sz of sizes) {
        s += `<g transform="translate(${x} ${cy - sz / 2}) scale(${sz / 1024})">${macIconBody({ shadow })}</g>`;
        x += sz + 40;
      }
      return s;
    };
    let labels = "";
    {
      let x = 40;
      for (const sz of sizes) {
        labels += text(`${sz}`, { x: x + sz / 2, y: split - 18, size: 13, weight: 500, anchor: "middle", opacity: 0.45 });
        x += sz + 40;
      }
    }
    const bar = (y, light) => {
      const w = 210;
      const x = PW - 36 - w;
      const fg = light ? "#000" : "#fff";
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="30" rx="8" fill="${light ? "#fff" : "#2A2A2E"}" fill-opacity="0.9"/>` +
        `<path fill="${fg}" d="${foldS({ t: 3, g: 1, w: 16, x0: x + 92, y0: y + 9.5 }).d}"/>` +
        text("Fri 9:41", { x: x + w - 14, y: y + 20, size: 13, weight: 500, anchor: "end", fill: fg })
      );
    };
    panels.push(
      bg("#131315") +
        `<rect y="${split}" width="${PW}" height="${PH - split}" fill="${C.paper}"/>` +
        label("07", "Icon") +
        row(150, true) +
        labels +
        row(split + 96, true) +
        bar(136, false) +
        bar(split + 82, true) +
        text("menu bar template", { x: PW - 36, y: split - 18, size: 13, weight: 500, anchor: "end", opacity: 0.45 }),
    );
  }

  // 8. Atmosphere
  {
    const a = atmosphere("p8", PW, PH, { horizon: 0.76, spread: 0.6, seed: 9, bands: 13 });
    defs += a.defs;
    panels.push(
      a.body +
        label("08", "Atmosphere") +
        text("Dusk over a stratus deck.", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.6 }) +
        `<g opacity="0.95">${mark({ cx: PW - 36 - 24, cy: PH - 40, w: 48, mode: "solid", color: C.mist })}</g>`,
    );
  }

  // 9. Interface
  {
    const ox = 36;
    const bw = PW - 72;
    let s = bg(C.night) + label("09", "Interface");
    // chrome bar
    s += `<rect x="${ox}" y="78" width="${bw}" height="64" rx="12" fill="${C.panel}" stroke="#fff" stroke-opacity="0.06"/>`;
    [0, 1, 2].forEach((i) => (s += `<circle cx="${ox + 22 + i * 20}" cy="110" r="6" fill="#3A3A3F"/>`));
    const tx = ox + 104;
    s += `<path fill="${C.mist}" fill-opacity="0.8" d="M${tx} 102v16l-11-8zM${tx - 12} 102h-2.5v16h2.5z"/>`;
    s += `<path fill="${C.mist}" d="M${tx + 22} 99l18 11-18 11z"/>`;
    s += `<path fill="${C.mist}" fill-opacity="0.8" d="M${tx + 54} 102v16l11-8zM${tx + 66} 102h2.5v16h-2.5z"/>`;
    const lx = ox + 210;
    const lw = 300;
    s += `<rect x="${lx}" y="86" width="${lw}" height="48" rx="9" fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.08"/>`;
    s += `<rect x="${lx}" y="86" width="48" height="48" rx="9" fill="url(#ember)"/>`;
    s += `<path fill="${C.night}" fill-opacity="0.35" d="M${lx + 9} 86h39v48h-48v-39z"/>`;
    s += text("Low Tide", { x: lx + 48 + (lw - 48) / 2, y: 104, size: 13, weight: 600, anchor: "middle" });
    s += text("Marlow", { x: lx + 48 + (lw - 48) / 2, y: 119, size: 12, weight: 400, anchor: "middle", opacity: 0.6 });
    s += waveform({ x: lx + 58, y: 123, w: lw - 68, h: 8, bar: 2, gap: 1, progress: 0.38, seed: 4 });
    [0, 1].forEach((i) => (s += `<circle cx="${ox + bw - 26 - i * 26}" cy="110" r="7" fill="none" stroke="${C.mist}" stroke-opacity="0.55" stroke-width="2"/>`));
    // big waveform with timed comments
    const wy = 180;
    s += waveform({ x: ox, y: wy, w: bw, h: 112, bar: 3, gap: 1.5, progress: 0.42, seed: 8 });
    s += `<rect x="${ox}" y="${wy + 113}" width="${bw}" height="1" fill="#fff" fill-opacity="0.08"/>`;
    const avatars = [0.12, 0.27, 0.41, 0.58, 0.79];
    avatars.forEach((k, i) => {
      const ax = ox + k * bw;
      s += `<circle cx="${ax}" cy="${wy + 128}" r="8" fill="${i === 2 ? C.ember : "#4A4A50"}" stroke="${C.night}" stroke-width="2"/>`;
    });
    const bx = ox + 0.41 * bw - 18;
    const bubble = "that drop at 1:42";
    const bwid = measure(bubble, 13, 500) + 24;
    s += `<rect x="${bx}" y="${wy + 144}" width="${bwid}" height="28" rx="14" fill="${C.raised}"/>`;
    s += text(bubble, { x: bx + 12, y: wy + 162.5, size: 13, weight: 500, opacity: 0.85 });
    // chips
    const chips = ["Timed comments", "Immersive", "Spotify import"];
    let cx = ox;
    chips.forEach((c, i) => {
      const cw = measure(c, 13, 500) + 28;
      const on = i === 0;
      s += `<rect x="${cx}" y="${PH - 66}" width="${cw}" height="30" rx="15" fill="${on ? C.ember : "#fff"}" fill-opacity="${on ? 1 : 0.07}"/>`;
      s += text(c, { x: cx + 14, y: PH - 46, size: 13, weight: 500, fill: on ? C.night : C.mist, opacity: on ? 1 : 0.8 });
      cx += cw + 10;
    });
    panels.push(s);
  }

  let body = `<rect width="${W}" height="${H}" fill="#0A0A0B"/>`;
  panels.forEach((p, i) => {
    const x = M + (i % 3) * (PW + G);
    const y = M + Math.floor(i / 3) * (PH + G);
    defs += `<clipPath id="clip${i}"><rect width="${PW}" height="${PH}" rx="18"/></clipPath>`;
    body += `<g transform="translate(${x} ${y})"><g clip-path="url(#clip${i})">${p}</g></g>`;
  });
  const s = write("brand/brand-board.svg", svgDoc(W, H, body, defs));
  png(s, "brand/brand-board.png", W, H);
}

console.log("done");
