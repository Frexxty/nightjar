// Builds every Nightjar logo, icon and brand asset from vector source.
//
//   npm install --no-save opentype.js @fontsource/inter png-to-ico clipper-lib
//   node brand/source/generate.mjs
//
// Needs rsvg-convert (brew install librsvg), cwebp (brew install webp) for the
// site's app icon and, for build/icon.icns, macOS iconutil. All text is
// converted to outlines with opentype.js, so the SVGs render the same
// everywhere and need no fonts installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fold, placement, TIP, H } from "./mark.mjs";
import { transform, toD, bbox } from "./geometry.mjs";

const require = createRequire(import.meta.url);
const opentype = require("opentype.js");
const { default: pngToIco } = require("png-to-ico");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = (...p) => path.join(root, ...p);
for (const d of ["build", "public", "brand", "src/assets", "web/icons", "site/public/img"]) fs.mkdirSync(at(d), { recursive: true });
// Intermediate rasters and SVGs that don't ship go here (check.mjs reads them).
export const OUT = path.join(os.tmpdir(), "nightjar-brand-out");
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- palette

export const C = {
  ember: "#EF5035", // the accent, in the app and in the mark
  emberLight: "#FF8A4C",
  afterglow: "#D6478A",
  dusk: "#6650E6",
  indigo: "#1E1A38", // icon tile, top
  nightfall: "#0E0D1A", // icon tile, bottom; dark brand surfaces
  night: "#101012", // app window, dark theme
  panel: "#161618",
  raised: "#1F1F22",
  mist: "#F4F4F6",
  paper: "#ECECEF",
  ink: "#121214",
};
const TONE = { violet: C.dusk, rose: C.afterglow, ember: C.ember };
const MONO_OPACITY = { violet: 0.5, rose: 0.75, ember: 1 };

// The ember leg is the only gradient: lighter where it owns its corner, deeper
// where it tucks under the afterglow leg at the tip.
const markDefs = (id = "nj") =>
  `<linearGradient id="${id}Ember" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${C.emberLight}"/><stop offset="0.75" stop-color="${C.ember}"/></linearGradient>`;
const tileGradient = (id = "njTile") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.indigo}"/><stop offset="1" stop-color="${C.nightfall}"/></linearGradient>`;
// A low ember glow at the foot of the tile, like the last light on the horizon.
const tileGlow = (id = "njGlow") =>
  `<radialGradient id="${id}" cx="0.5" cy="1.08" r="0.62"><stop offset="0" stop-color="${C.afterglow}" stop-opacity="0.22"/><stop offset="0.5" stop-color="${C.dusk}" stop-opacity="0.08"/><stop offset="1" stop-color="${C.dusk}" stop-opacity="0"/></radialGradient>`;

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
  const glyphs = [...str].map((ch) => f.charToGlyph(ch));
  glyphs.forEach((g, i) => {
    w += (g.advanceWidth / f.unitsPerEm) * size;
    if (i < glyphs.length - 1) w += track * size + (f.getKerningValue(g, glyphs[i + 1]) / f.unitsPerEm) * size;
  });
  return w;
}

// opentype.js's own toPathData() sometimes prints NaN for a valid coordinate,
// so format the commands here.
function pathData(p) {
  const n = (v) => {
    const s = (+v).toFixed(2);
    return s.replace(/0+$/, "").replace(/\.$/, "");
  };
  return p.commands
    .map((c) => {
      if (c.type === "M" || c.type === "L") return `${c.type}${n(c.x)} ${n(c.y)}`;
      if (c.type === "Q") return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
      if (c.type === "C") return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
      return "Z";
    })
    .join("");
}

/** Text as outlined path data. anchor: start | middle | end. */
function text(str, { x, y, size, weight = 600, track = 0, anchor = "start", fill = C.mist, opacity }) {
  const f = fonts[weight];
  let cx = x;
  const w = measure(str, size, weight, track);
  if (anchor === "middle") cx -= w / 2;
  if (anchor === "end") cx -= w;
  let d = "";
  const glyphs = [...str].map((ch) => f.charToGlyph(ch));
  glyphs.forEach((g, i) => {
    d += pathData(g.getPath(cx, y, size));
    let adv = (g.advanceWidth / f.unitsPerEm) * size + track * size;
    if (i < glyphs.length - 1) adv += (f.getKerningValue(g, glyphs[i + 1]) / f.unitsPerEm) * size;
    cx += adv;
  });
  const op = opacity != null ? ` fill-opacity="${opacity}"` : "";
  return `<path fill="${fill}"${op} d="${d}"/>`;
}

// ---------------------------------------------------------------- mark

// Master geometry: ribbon t = 0.215 of the mark height, gap 0.022, outer
// corners r = 0.11. The hole keeps sharp corners.
export const MASTER = { r: 110, t: 215, gap: 22, ri: 0 };
const GEO = fold(MASTER);
// Small-size variants: thicker ribbon, and below 24 px no gaps at all.
const GEO_32 = fold({ r: 120, t: 250, gap: 40, ri: 0 });
const GEO_16 = fold({ r: 130, t: 300, gap: 0, ri: 0 });
// Menu bar template at 16 pt: thick ribbon, gaps of about one pixel.
const GEO_T16 = fold({ r: 130, t: 300, gap: 75, ri: 0 });

/**
 * Mark paths for a placement {k, dx, dy}.
 * mode "color": dusk, afterglow and an ember gradient.
 * mode "mono":  one colour, legs at 50 / 75 / 100 % from dusk to ember.
 * mode "solid": one colour, every leg opaque (template images, tiny sizes).
 */
function markPaths(geo, p, { mode = "color", color = C.mist, id = "nj" } = {}) {
  return geo.layers
    .map((l) => {
      const d = toD(transform(l.shape, p.k, p.dx, p.dy));
      if (mode === "color") return `<path fill="${l.tone === "ember" ? `url(#${id}Ember)` : TONE[l.tone]}" d="${d}"/>`;
      if (mode === "mono") return `<path fill="${color}"${MONO_OPACITY[l.tone] < 1 ? ` fill-opacity="${MONO_OPACITY[l.tone]}"` : ""} d="${d}"/>`;
      return `<path fill="${color}" d="${d}"/>`;
    })
    .join("");
}
/** Optically centred on (cx, cy), h tall. */
const markCentred = (cx, cy, h, opts = {}, geo = GEO) => markPaths(geo, placement(geo.silhouette, { cx, cy, h }), opts);
/** Top-left of the bounding box at (x, y), h tall. */
function boxPlace(geo, x, y, h) {
  const b = bbox(geo.silhouette);
  const k = h / b.h;
  return { k, dx: x - b.x0 * k, dy: y - b.y0 * k, w: b.w * k };
}
const markBox = (x, y, h, opts = {}, geo = GEO) => markPaths(geo, boxPlace(geo, x, y, h), opts);
const markWidth = (h, geo = GEO) => {
  const b = bbox(geo.silhouette);
  return (b.w / b.h) * h;
};

/** Mark + "Nightjar" on one line, vertically centred on cy. */
function lockup({ x, cy, markH, textFill = C.mist, mode = "color", color, id }) {
  const size = (markH * 0.6) / CAP;
  const gap = markH * 0.34;
  const track = -0.02;
  const mw = markWidth(markH);
  const tw = measure("Nightjar", size, 600, track);
  // Inter's x-height sits a little low against a centred triangle; nudge the
  // baseline down 2% so the caps look centred on the mark.
  const svg =
    markBox(x, cy - markH / 2, markH, { mode, color, id }) +
    text("Nightjar", { x: x + mw + gap, y: cy + (CAP * size) / 2 + markH * 0.02, size, weight: 600, track, fill: textFill });
  return { svg, width: mw + gap + tw, height: markH };
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

const MAC = { x: 100, y: 100, s: 824 }; // Apple's 1024 grid
const MARK_IN_TILE = 0.6; // mark height as a share of the tile

/** Apple's continuous-corner tile, approximated by a superellipse (n = 5). */
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
const iconDefs = () => markDefs() + tileGradient() + tileGlow() + shadowFilter();

/** The macOS tile and mark in 1024 space. */
function macIconBody({ shadow = true } = {}) {
  const { x, y, s } = MAC;
  const sq = squircle(x, y, s);
  return (
    (shadow ? `<path transform="translate(0 12)" d="${sq}" fill="#000" fill-opacity="0.42" filter="url(#tileShadow)"/>` : "") +
    `<path d="${sq}" fill="url(#njTile)"/>` +
    `<path d="${sq}" fill="url(#njGlow)"/>` +
    `<path d="${squircle(x + 1.5, y + 1.5, s - 3)}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="3"/>` +
    markCentred(512, 512, s * MARK_IN_TILE)
  );
}

/** Full-bleed square tile (iOS, Android maskable); `scale` sizes the mark. */
function bleedBody(markH) {
  return `<rect width="1024" height="1024" fill="url(#njTile)"/><rect width="1024" height="1024" fill="url(#njGlow)"/>` + markCentred(512, 512, markH);
}

/** Windows / favicon tile: nearly full bleed, mark a bit larger. */
function winIconBody({ small = false } = {}) {
  const inset = small ? 0 : 24;
  const s = 1024 - inset * 2;
  const r = small ? 200 : 210;
  return (
    `<rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#njTile)"/>` +
    (small ? "" : `<rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#njGlow)"/>`) +
    (small ? "" : `<rect x="${inset + 2}" y="${inset + 2}" width="${s - 4}" height="${s - 4}" rx="${r - 2}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="4"/>`) +
    (small ? markCentred(512, 512, 700, {}, GEO_16) : markCentred(512, 512, 640))
  );
}

const iconSvg = write("build/icon.svg", svgDoc(1024, 1024, macIconBody(), iconDefs()));
const winSvg = write("brand/source/icon-windows.svg", svgDoc(1024, 1024, winIconBody(), iconDefs()));
const winSmallSvg = write("brand/source/icon-windows-small.svg", svgDoc(1024, 1024, winIconBody({ small: true }), iconDefs()));
png(iconSvg, "build/icon.png", 1024);

/**
 * Hinted macOS icons for the 16 and 32 px slots: same tile grid, but the mark
 * is larger, the ribbon thicker, and the flat back edge and the tip land on
 * whole pixels. 16 px also drops the gaps between the legs.
 */
function snappedPlace(geo, size, h, nudge = 0) {
  const b = bbox(geo.silhouette);
  const hh = Math.round(h);
  const k = hh / b.h;
  // optical centre as in placement(), then snap the flat back edge to a pixel
  const vx = (b.x0 + b.w / 2 + TIP / 3) / 2;
  const dx = Math.round(size / 2 - vx * k) - b.x0 * k + nudge;
  const dy = Math.round((size - hh) / 2) - b.y0 * k;
  return { k, dx, dy };
}
function macSmallSvg(size) {
  const k = size / 1024;
  const tile = `<path d="${squircle(MAC.x * k, MAC.y * k, MAC.s * k)}" fill="url(#njTile)"/>`;
  const geo = size === 16 ? GEO_16 : GEO_32;
  const h = size === 16 ? 10 : 20;
  const p = snappedPlace(geo, size, h);
  return write(path.join(OUT, `icon-mac-${size}.svg`), svgDoc(size, size, tile + markPaths(geo, p), markDefs() + tileGradient()));
}
const macSmall = { 16: macSmallSvg(16), 32: macSmallSvg(32) };

// macOS .icns
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-")) + "/icon.iconset";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightjar-ico-"));
  const files = [16, 24, 32, 48, 64, 128, 256].map((s) => {
    const f = `${dir}/${s}.png`;
    execFileSync("rsvg-convert", ["-w", String(s), "-h", String(s), s <= 24 ? winSmallSvg : winSvg, "-o", f]);
    return f;
  });
  for (const s of [16, 24, 32, 48, 256]) fs.copyFileSync(`${dir}/${s}.png`, path.join(OUT, `icon-windows-${s}.png`));
  fs.writeFileSync(at("build/icon.ico"), await pngToIco(files));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- tray

{
  // macOS menu bar template: black on transparent. Menu bar icons sit in a
  // 16 pt square with the glyph about 14 pt tall.
  const s1 = write(path.join(OUT, "trayTemplate.svg"), svgDoc(16, 16, markPaths(GEO_T16, snappedPlace(GEO_T16, 16, 14), { mode: "solid", color: "#000" })));
  const s2 = write(path.join(OUT, "trayTemplate@2x.svg"), svgDoc(32, 32, markPaths(GEO_32, snappedPlace(GEO_32, 32, 28), { mode: "solid", color: "#000" })));
  png(s1, "build/trayTemplate.png", 16);
  png(s2, "build/trayTemplate@2x.png", 32);
  // Windows tray, coloured, on a light or dark taskbar.
  const s3 = write(path.join(OUT, "tray.svg"), svgDoc(32, 32, markPaths(GEO_32, snappedPlace(GEO_32, 32, 30)), markDefs()));
  png(s3, "build/tray.png", 32);
}

// ---------------------------------------------------------------- favicon

{
  const fav = svgDoc(1024, 1024, winIconBody(), markDefs() + tileGradient() + tileGlow()).replace(' width="1024" height="1024"', "");
  write("public/favicon.svg", fav);
  png(at("public/favicon.svg"), "public/favicon.png", 64);
}

// ---------------------------------------------------------------- PWA icons

{
  // Android maskable: the mark has to stay inside the central 80% circle.
  // The triangle's corners are about 0.58 h from its optical centre, so
  // h = 560 keeps them inside a 410 px radius with room to spare.
  const maskable = svgDoc(1024, 1024, `<!-- Full-bleed tile for Android maskable icons. The mark stays inside the 80% safe circle. -->` + bleedBody(560), markDefs() + tileGradient() + tileGlow());
  write("web/icons/maskable.svg", maskable);
  png(at("web/icons/maskable.svg"), "web/icons/maskable-512.png", 512);
  // iOS rounds the corners itself, so the tile runs edge to edge. The mark has
  // the same size relative to the tile as in build/icon.svg.
  const touch = svgDoc(1024, 1024, `<!-- Full-bleed tile for iOS, which rounds the corners itself. Mark at the same size relative to the tile as build/icon.svg. -->` + bleedBody(1024 * MARK_IN_TILE), markDefs() + tileGradient() + tileGlow());
  write("web/icons/apple-touch-icon.svg", touch);
  png(at("web/icons/apple-touch-icon.svg"), "web/icons/apple-touch-icon.png", 180);
  png(iconSvg, "web/icons/icon-192.png", 192);
  png(iconSvg, "web/icons/icon-512.png", 512);
}

// ---------------------------------------------------------------- logos

function tightMark(mode, color) {
  const h = 600;
  const w = markWidth(h);
  return svgDoc(+w.toFixed(2), h, markBox(0, 0, h, { mode, color }), mode === "color" ? markDefs() : "");
}
write("brand/logo-mark.svg", tightMark("color"));
write(
  "src/assets/logo-mark.svg",
  tightMark("mono", "currentColor").replace(/ width="\d+(\.\d+)?" height="\d+(\.\d+)?"/, ' width="100%" height="100%"'),
);

function wordmarkDoc(textFill) {
  const markH = 300;
  // The letters overshoot the cap height a little, so leave room above and below.
  const pad = Math.round(markH * 0.04);
  const L = lockup({ x: 0, cy: markH / 2 + pad, markH, textFill });
  return svgDoc(Math.ceil(L.width) + 4, markH + pad * 2, L.svg, markDefs());
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
 * Dusk: an indigo sky that warms through afterglow to an ember horizon, a few
 * early stars, a low dark ridge, and film grain. Returns { defs, body }.
 */
function atmosphere(id, w, h, { horizon = 0.72, seed = 7, stars = 40, glow = 1, ridge = true, grain = true } = {}) {
  const r = rng(seed);
  const hy = h * horizon;
  let defs =
    `<linearGradient id="${id}Sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#090811"/>` +
    `<stop offset="${(horizon * 0.45).toFixed(3)}" stop-color="#14112A"/>` +
    `<stop offset="${(horizon * 0.78).toFixed(3)}" stop-color="#2E1D4D"/>` +
    `<stop offset="${(horizon * 0.93).toFixed(3)}" stop-color="#7A2E5E"/>` +
    `<stop offset="${horizon.toFixed(3)}" stop-color="#D2523E"/>` +
    `<stop offset="${Math.min(1, horizon + 0.001).toFixed(3)}" stop-color="#120E1A"/>` +
    `<stop offset="1" stop-color="#0A0910"/></linearGradient>` +
    `<radialGradient id="${id}Glow" gradientUnits="userSpaceOnUse" cx="${w * 0.5}" cy="${hy}" r="${w * 0.55}" gradientTransform="translate(0 ${hy}) scale(1 ${0.32}) translate(0 ${-hy})">` +
    `<stop offset="0" stop-color="${C.emberLight}" stop-opacity="${0.55 * glow}"/><stop offset="0.5" stop-color="${C.afterglow}" stop-opacity="${0.16 * glow}"/><stop offset="1" stop-color="${C.dusk}" stop-opacity="0"/></radialGradient>`;
  if (grain)
    defs +=
      `<filter id="${id}Grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.09"/></feComponentTransfer></filter>`;
  let body = `<rect width="${w}" height="${h}" fill="url(#${id}Sky)"/>`;
  // stars, densest and brightest high up
  let st = "";
  for (let i = 0; i < stars; i++) {
    const sy = Math.pow(r(), 1.7) * hy * 0.7;
    const sx = r() * w;
    const big = r() > 0.88;
    st += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(big ? 1.3 : 0.7) * Math.max(1, w / 1200)}" fill="#fff" fill-opacity="${(0.25 + r() * 0.55 * (1 - sy / hy)).toFixed(2)}"/>`;
  }
  body += st;
  body += `<rect width="${w}" height="${h}" fill="url(#${id}Glow)"/>`;
  if (ridge) {
    // a low ridge line along the horizon
    const pts = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const y = hy - h * (0.012 + 0.03 * Math.abs(Math.sin(i * 0.7 + seed)) * (0.4 + r() * 0.6));
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    body += `<path fill="#0B0910" d="M0 ${h}L${pts.join("L")}L${w} ${h}Z"/>`;
  }
  if (grain) body += `<rect width="${w}" height="${h}" filter="url(#${id}Grain)"/>`;
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
  return `<path fill="${C.ember}" d="${played}"/><path fill="${color}" fill-opacity="${opacity}" d="${rest}"/>`;
}

// ---------------------------------------------------------------- DMG

{
  // Finder draws the icon labels in black in light mode and white in dark
  // mode, on top of this picture. The band behind the labels (y 228 to 262)
  // is a mid-tone mauve with a luminance near 0.16, where both black and
  // white text get better than 4:1 contrast.
  const W = 540;
  const H2 = 380;
  const id = "dmg";
  const defs =
    markDefs() +
    `<linearGradient id="${id}Sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#0D0B18"/><stop offset="0.32" stop-color="#1C1736"/>` +
    `<stop offset="0.55" stop-color="#5A4A7E"/><stop offset="0.6" stop-color="#76618F"/><stop offset="0.69" stop-color="#7A6290"/>` +
    `<stop offset="0.8" stop-color="#9A5A79"/><stop offset="0.92" stop-color="#D9674A"/><stop offset="1" stop-color="#E9794A"/></linearGradient>` +
    `<filter id="${id}Grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.06"/></feComponentTransfer></filter>`;
  const r = rng(11);
  let stars = "";
  for (let i = 0; i < 26; i++) {
    const sy = Math.pow(r(), 1.6) * 120 + 6;
    stars += `<circle cx="${(r() * W).toFixed(1)}" cy="${sy.toFixed(1)}" r="${r() > 0.85 ? 1 : 0.6}" fill="#fff" fill-opacity="${(0.3 + r() * 0.5 * (1 - sy / 130)).toFixed(2)}"/>`;
  }
  const L = lockup({ x: 0, cy: 0, markH: 30, id: "nj" });
  const arrow =
    `<g fill="none" stroke="${C.mist}" stroke-opacity="0.7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M228 190H310"/><path d="M300 180l11 10-11 10"/></g>`;
  const body =
    `<rect width="${W}" height="${H2}" fill="url(#${id}Sky)"/>` +
    stars +
    `<rect width="${W}" height="${H2}" filter="url(#${id}Grain)"/>` +
    `<g transform="translate(${((W - L.width) / 2).toFixed(2)} 52)">${L.svg}</g>` +
    arrow +
    text("Drag Nightjar into Applications", { x: W / 2, y: 336, size: 12.5, weight: 500, anchor: "middle", fill: "#1A0E14", opacity: 0.72, track: 0.01 });
  const s = write("brand/source/dmg-background.svg", svgDoc(W, H2, body, defs));
  png(s, "build/dmg-background.png", W, H2);
  png(s, "build/dmg-background@2x.png", W * 2, H2 * 2);
}

// ---------------------------------------------------------------- OG image

{
  const W = 1200;
  const H2 = 630;
  const a = atmosphere("og", W, H2, { horizon: 0.84, seed: 5, stars: 70 });
  const L = lockup({ x: 0, cy: 0, markH: 128 });
  const shade = `<linearGradient id="ogShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#07060D" stop-opacity="0.6"/><stop offset="0.75" stop-color="#07060D" stop-opacity="0"/></linearGradient>`;
  const body =
    a.body +
    `<rect width="${W}" height="${H2}" fill="url(#ogShade)"/>` +
    `<g transform="translate(92 236)">${L.svg}</g>` +
    text("A free desktop and web music player", { x: 94, y: 382, size: 40, weight: 500, track: -0.015, fill: C.mist, opacity: 0.92 }) +
    text("for SoundCloud and Spotify.", { x: 94, y: 432, size: 40, weight: 500, track: -0.015, fill: C.mist, opacity: 0.6 });
  const s = write("brand/source/og-image.svg", svgDoc(W, H2, body, markDefs() + a.defs + shade));
  png(s, "brand/og-image.png", W, H2);
}

// ---------------------------------------------------------------- brand board

{
  const W = 2400;
  const H2 = 1500;
  const M = 60;
  const G = 24;
  const PW = (W - 2 * M - 2 * G) / 3;
  const PH = (H2 - 2 * M - 2 * G) / 3;
  const panels = [];
  const label = (num, name, dark = false) =>
    text(num, { x: 36, y: 50, size: 15, weight: 600, fill: dark ? C.nightfall : C.ember, track: 0.04 }) +
    text(name.toUpperCase(), { x: 66, y: 50, size: 15, weight: 500, fill: dark ? C.nightfall : C.mist, opacity: dark ? 0.75 : 0.5, track: 0.12 });
  const bg = (fill) => `<rect width="${PW}" height="${PH}" fill="${fill}"/>`;
  const PANEL = "#131220";
  let defs = iconDefs();

  // 1. Cover
  {
    const L = lockup({ x: 0, cy: 0, markH: 132 });
    panels.push(
      bg(PANEL) +
        `<g transform="translate(${((PW - L.width) / 2).toFixed(2)} ${PH / 2 - 4})">${L.svg}</g>` +
        label("01", "Logo") +
        text("Brand identity", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45, track: 0.02 }) +
        text("v2.0  2026", { x: PW - 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45, anchor: "end", track: 0.02 }),
    );
  }

  // 2. Construction
  {
    const h = 205;
    const p = placement(GEO.silhouette, { cx: PW / 2 - 90, cy: PH / 2 - 20, h });
    const tr = (s) => toD(transform(s, p.k, p.dx, p.dy));
    const line = `stroke="${C.mist}" stroke-opacity="0.22" stroke-width="1.5" fill="none"`;
    // the rounded outline, the hole (dashed) and the sharp triangle it is cut from
    let g = `<path ${line} d="${tr(GEO.T)}"/><path ${line} stroke-dasharray="5 6" d="${tr(GEO.hole)}"/>`;
    const sharp = [[0, 0], [TIP, H / 2], [0, H]].map(([x, y]) => [x * p.k + p.dx, y * p.k + p.dy]);
    g += `<path stroke="${C.ember}" stroke-opacity="0.7" stroke-width="1.5" fill="none" d="M${sharp.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join("L")}Z"/>`;
    // ribbon width, measured on the back leg under the mark
    const x0 = p.dx;
    const t = MASTER.t * p.k;
    const yT = sharp[2][1] + 18;
    const tick = (xa, xb, y, s) =>
      `<path stroke="${C.mist}" stroke-opacity="0.7" stroke-width="1.5" fill="none" d="M${xa} ${y}H${xb}M${xa} ${y - 5}V${y + 5}M${xb} ${y - 5}V${y + 5}"/>` +
      text(s, { x: (xa + xb) / 2, y: y + 21, size: 15, weight: 500, opacity: 0.75, anchor: "middle" });
    const legend = (y, color, s) => `<rect x="${PW - 250}" y="${y - 11}" width="14" height="14" rx="3" fill="${color}"/>` + text(s, { x: PW - 226, y, size: 14, weight: 500, opacity: 0.7 });
    panels.push(
      bg(PANEL) +
        `<g opacity="0.9">${markPaths(GEO, p)}</g>` +
        g +
        tick(x0, x0 + t, yT, "t") +
        legend(110, C.dusk, "1  back edge, owns top") +
        legend(136, C.afterglow, "2  upper edge, owns tip") +
        legend(162, C.ember, "3  lower edge, owns base") +
        label("02", "Construction") +
        text("One ribbon, three legs. Each leg passes over the next. t = 0.215 h, gap = 0.022 h.", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.45 }),
    );
  }

  // 3. Dock and menu bar
  {
    const a = atmosphere("p3", PW, PH, { horizon: 0.66, seed: 21, stars: 50, grain: false });
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
        `<circle cx="${x + icon / 2}" cy="${y + icon / 2}" r="${s * 0.2}" fill="none" stroke="#9A9AA0" stroke-width="${s * 0.07}"/>`,
        `<circle cx="${x + icon / 2}" cy="${y + icon / 2}" r="${s * 0.24}" fill="none" stroke="#7A8592" stroke-width="${s * 0.08}"/>`,
        `<rect x="${x + o + s * 0.24}" y="${y + icon / 2 - s * 0.05}" width="${s * 0.52}" height="${s * 0.1}" rx="${s * 0.05}" fill="#8E8E94"/>`,
        "",
      ][i];
      return `<rect x="${x + o}" y="${y + o}" width="${s}" height="${s}" rx="${s * 0.225}" fill="${fills[i]}"/>${glyph}`;
    };
    let dock = `<rect x="${dx}" y="${dy}" width="${dw}" height="${icon + 18}" rx="24" fill="#fff" fill-opacity="0.13" stroke="#fff" stroke-opacity="0.2" stroke-width="1"/>`;
    const order = [0, 1, 2, "N", 3, 4];
    order.forEach((k, i) => {
      const x = dx + 9 + i * pitch + (pitch - icon) / 2;
      const y = dy + 9;
      if (k === "N") {
        dock += `<g transform="translate(${x} ${y}) scale(${icon / 1024})">${macIconBody()}</g>`;
        dock += `<circle cx="${x + icon / 2}" cy="${dy + icon + 14}" r="2.5" fill="${C.mist}" fill-opacity="0.85"/>`;
        const tw = measure("Nightjar", 15, 500) + 28;
        dock += `<rect x="${x + icon / 2 - tw / 2}" y="${dy - 46}" width="${tw}" height="30" rx="8" fill="#1E1C2A" fill-opacity="0.92" stroke="#fff" stroke-opacity="0.12"/>`;
        dock += text("Nightjar", { x: x + icon / 2, y: dy - 26, size: 15, weight: 500, anchor: "middle" });
      } else dock += placeholder(k, x, y);
    });
    const menubar =
      `<rect width="${PW}" height="36" fill="#000" fill-opacity="0.32"/>` +
      markBox(PW - 152, 10, 16, { mode: "solid", color: C.mist }, GEO_T16) +
      text("Fri 9:41", { x: PW - 36, y: 23.5, size: 14, weight: 500, anchor: "end" });
    panels.push(a.body + menubar + dock + `<g transform="translate(0 30)">${label("03", "Dock")}</g>`);
  }

  // 4. Promise
  {
    defs += `<linearGradient id="promise" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${C.ember}"/><stop offset="1" stop-color="#E2453A"/></linearGradient>`;
    panels.push(
      `<rect width="${PW}" height="${PH}" fill="url(#promise)"/>` +
        label("04", "Promise", true) +
        text("Sings after", { x: 34, y: 268, size: 96, weight: 600, track: -0.035, fill: C.nightfall }) +
        text("dark.", { x: 34, y: 366, size: 96, weight: 600, track: -0.035, fill: C.nightfall }) +
        `<g opacity="0.92">${markBox(PW - 36 - markWidth(84), 366 - 72, 84, { mode: "solid", color: C.nightfall })}</g>`,
    );
  }

  // 5. Colour
  {
    const sw = (x, y, w, h, fill, name, hex, dark, stroke = false) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}"${stroke ? ` stroke="#fff" stroke-opacity="0.1"` : ""}/>` +
      text(name, { x: x + 16, y: y + h - 38, size: 16, weight: 600, fill: dark ? C.nightfall : C.mist }) +
      text(hex, { x: x + 16, y: y + h - 16, size: 14, weight: 500, fill: dark ? C.nightfall : C.mist, opacity: 0.7, track: 0.02 });
    const x0 = 36;
    const full = PW - 72;
    let s = "";
    const top = [
      [C.ember, "Ember", C.ember, true, 0.4],
      [C.afterglow, "Afterglow", C.afterglow, true, 0.3],
      [C.dusk, "Dusk", C.dusk, false, 0.3],
    ];
    let x = x0;
    top.forEach(([f, nm, hx, dark, share]) => {
      const w = full * share - (share === 0.3 ? 8 : 8);
      s += sw(x, 76, w, 176, f, nm, hx.toUpperCase(), dark);
      x += w + 12;
    });
    const neutrals = [
      [C.nightfall, "Nightfall", C.nightfall, false, true],
      [C.indigo, "Indigo", C.indigo, false, true],
      [C.night, "Night", C.night, false, true],
      [C.mist, "Mist", C.mist, true],
      [C.paper, "Paper", C.paper, true],
    ];
    const nw = (full - 4 * 12) / 5;
    neutrals.forEach(([f, nm, hx, dark, st], i) => (s += sw(x0 + i * (nw + 12), 264, nw, 140, f, nm, hx.toUpperCase(), dark, st)));
    panels.push(bg(PANEL) + label("05", "Colour") + s);
  }

  // 6. Type
  {
    panels.push(
      bg(PANEL) +
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
    const smallImg = (sz, x, y) => {
      if (sz > 32) return `<g transform="translate(${x} ${y}) scale(${sz / 1024})">${macIconBody()}</g>`;
      // the hinted rasters, embedded as they ship
      const f = path.join(OUT, `icon-mac-${sz}.png`);
      png(macSmall[sz], f, sz);
      return `<image x="${x}" y="${y}" width="${sz}" height="${sz}" href="data:image/png;base64,${fs.readFileSync(f).toString("base64")}"/>`;
    };
    const row = (cy) => {
      let x = 40;
      let s = "";
      for (const sz of sizes) {
        s += smallImg(sz, x, cy - sz / 2);
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
      const tpl = path.join(OUT, "tray-board.png");
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="30" rx="8" fill="${light ? "#fff" : "#2A2A2E"}" fill-opacity="0.9"/>` +
        markBox(x + 90, y + 7, 16, { mode: "solid", color: fg }, GEO_T16) +
        text("Fri 9:41", { x: x + w - 14, y: y + 20, size: 13, weight: 500, anchor: "end", fill: fg }) +
        (void tpl, "")
      );
    };
    panels.push(
      bg(PANEL) +
        `<rect y="${split}" width="${PW}" height="${PH - split}" fill="${C.paper}"/>` +
        label("07", "Icon") +
        row(150) +
        labels +
        row(split + 96) +
        bar(136, false) +
        bar(split + 82, true) +
        text("menu bar template", { x: PW - 36, y: split - 18, size: 13, weight: 500, anchor: "end", opacity: 0.45 }),
    );
  }

  // 8. Atmosphere
  {
    const a = atmosphere("p8", PW, PH, { horizon: 0.78, seed: 9, stars: 90 });
    defs += a.defs;
    panels.push(
      a.body +
        label("08", "Atmosphere") +
        text("Dusk, when the nightjar starts to sing.", { x: 36, y: PH - 34, size: 15, weight: 500, opacity: 0.7 }) +
        `<g opacity="0.95">${markBox(PW - 36 - markWidth(44), PH - 40 - 30, 44, { mode: "solid", color: C.mist })}</g>`,
    );
  }

  // 9. Interface
  {
    const ox = 36;
    const bw = PW - 72;
    let s = bg(C.night) + label("09", "Interface");
    s += `<rect x="${ox}" y="78" width="${bw}" height="64" rx="12" fill="${C.panel}" stroke="#fff" stroke-opacity="0.06"/>`;
    [0, 1, 2].forEach((i) => (s += `<circle cx="${ox + 22 + i * 20}" cy="110" r="6" fill="#3A3A3F"/>`));
    const tx = ox + 104;
    s += `<path fill="${C.mist}" fill-opacity="0.8" d="M${tx} 102v16l-11-8zM${tx - 12} 102h-2.5v16h2.5z"/>`;
    s += `<path fill="${C.mist}" d="M${tx + 22} 99l18 11-18 11z"/>`;
    s += `<path fill="${C.mist}" fill-opacity="0.8" d="M${tx + 54} 102v16l11-8zM${tx + 66} 102h2.5v16h-2.5z"/>`;
    const lx = ox + 210;
    const lw = 300;
    s += `<rect x="${lx}" y="86" width="${lw}" height="48" rx="9" fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.08"/>`;
    defs += `<linearGradient id="art" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E1D4D"/><stop offset="0.7" stop-color="#7A2E5E"/><stop offset="1" stop-color="#D2523E"/></linearGradient>`;
    s += `<rect x="${lx}" y="86" width="48" height="48" rx="9" fill="url(#art)"/>`;
    s += text("Low Tide", { x: lx + 48 + (lw - 48) / 2, y: 104, size: 13, weight: 600, anchor: "middle" });
    s += text("Marlow", { x: lx + 48 + (lw - 48) / 2, y: 119, size: 12, weight: 400, anchor: "middle", opacity: 0.6 });
    s += waveform({ x: lx + 58, y: 123, w: lw - 68, h: 8, bar: 2, gap: 1, progress: 0.38, seed: 4 });
    [0, 1].forEach((i) => (s += `<circle cx="${ox + bw - 26 - i * 26}" cy="110" r="7" fill="none" stroke="${C.mist}" stroke-opacity="0.55" stroke-width="2"/>`));
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
    const chips = ["Timed comments", "Immersive", "Spotify import"];
    let cx = ox;
    chips.forEach((c, i) => {
      const cw = measure(c, 13, 500) + 28;
      const on = i === 0;
      s += `<rect x="${cx}" y="${PH - 66}" width="${cw}" height="30" rx="15" fill="${on ? C.ember : "#fff"}" fill-opacity="${on ? 1 : 0.07}"/>`;
      s += text(c, { x: cx + 14, y: PH - 46, size: 13, weight: 500, fill: on ? "#fff" : C.mist, opacity: on ? 1 : 0.8 });
      cx += cw + 10;
    });
    panels.push(s);
  }

  let body = `<rect width="${W}" height="${H2}" fill="#09080F"/>`;
  panels.forEach((p, i) => {
    const x = M + (i % 3) * (PW + G);
    const y = M + Math.floor(i / 3) * (PH + G);
    defs += `<clipPath id="clip${i}"><rect width="${PW}" height="${PH}" rx="18"/></clipPath>`;
    body += `<g transform="translate(${x} ${y})"><g clip-path="url(#clip${i})">${p}</g></g>`;
  });
  const s = write("brand/brand-board.svg", svgDoc(W, H2, body, defs));
  png(s, "brand/brand-board.png", W, H2);
}

// ---------------------------------------------------------------- site copies

// The marketing site only serves site/public, so it keeps its own copies.
{
  fs.copyFileSync(at("brand/logo-mark.svg"), at("site/public/logo-mark.svg"));
  fs.copyFileSync(at("brand/logo-wordmark.svg"), at("site/public/logo-wordmark.svg"));
  fs.copyFileSync(at("brand/og-image.png"), at("site/public/og-image.png"));
  fs.copyFileSync(at("public/favicon.svg"), at("site/public/favicon.svg"));
  fs.copyFileSync(at("public/favicon.png"), at("site/public/favicon.png"));
  fs.copyFileSync(at("web/icons/apple-touch-icon.png"), at("site/public/apple-touch-icon.png"));
  const tmp = path.join(OUT, "app-icon-256.png");
  png(iconSvg, tmp, 256);
  execFileSync("cwebp", ["-quiet", "-q", "92", "-alpha_q", "100", tmp, "-o", at("site/public/img/app-icon.webp")]);
}

console.log("done");
