// Polygon helpers for the Nightjar mark. Shapes are arrays of rings, each ring
// an array of [x, y] points. Rounding, gaps and overlaps are done with real
// boolean and offset operations (clipper-lib), so every exported SVG is plain
// filled paths that render the same in any viewer and can take currentColor.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ClipperLib = require("clipper-lib");

const SCALE = 1000; // clipper works on integers
const ARC_TOL = 0.04 * SCALE;

const toC = (shape) => shape.map((ring) => ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })));
const fromC = (paths) => paths.map((ring) => ring.map((p) => [p.X / SCALE, p.Y / SCALE]));

export function offset(shape, d) {
  if (!shape.length) return [];
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL);
  co.AddPaths(toC(shape), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * SCALE);
  return fromC(out);
}

function bool(type, a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toC(a), ClipperLib.PolyType.ptSubject, true);
  if (b && b.length) c.AddPaths(toC(b), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromC(out);
}
export const union = (a, b = []) => bool(ClipperLib.ClipType.ctUnion, a, b);
export const subtract = (a, b) => bool(ClipperLib.ClipType.ctDifference, a, b);
export const intersect = (a, b) => bool(ClipperLib.ClipType.ctIntersection, a, b);

/** Round convex corners with radius r (open), then concave ones with rc (close). */
export function round(shape, r, rc = 0) {
  let s = r > 0 ? offset(offset(shape, -r), r) : shape;
  if (rc > 0) s = offset(offset(s, rc), -rc);
  return s;
}

/** Ring sampled along a circular arc from angle a0 to a1 (radians). */
export function arcPoints(cx, cy, r, a0, a1, steps = 96) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Quadratic Bezier sampled to points (excluding nothing). */
export function quadPoints(p0, p1, p2, steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return pts;
}

export function bbox(shape) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of shape)
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export const transform = (shape, k, dx, dy) => shape.map((ring) => ring.map(([x, y]) => [x * k + dx, y * k + dy]));

/** SVG path data. Drops points closer than `eps` to keep files small. */
export function toD(shape, digits = 2) {
  const eps = 10 ** -digits * 4;
  let d = "";
  for (const ring of shape) {
    if (ring.length < 3) continue;
    let last = null;
    let seg = "";
    for (const [x, y] of ring) {
      if (last && Math.hypot(x - last[0], y - last[1]) < eps) continue;
      seg += `${seg ? "L" : "M"}${+x.toFixed(digits)} ${+y.toFixed(digits)}`;
      last = [x, y];
    }
    d += seg + "Z";
  }
  return d;
}
