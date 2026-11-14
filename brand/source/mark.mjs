// Geometry for the Nightjar mark and the two concepts it was compared with.
// Everything is built in a 1000-unit box: a play triangle with its flat side
// on the left (x = 0, y = 0..1000) and its tip at (866, 500).
// Each concept returns { layers: [{ shape, tone }], silhouette } where tone is
// a palette key and layers are listed back to front.
import { round, union, subtract, intersect, offset, bbox, quadPoints } from "./geometry.mjs";

export const H = 1000;
export const TIP = (Math.sqrt(3) / 2) * H;
const A = [0, 0];
const B = [0, H];
const C = [TIP, H / 2];
export const triangle = (r) => round([[A, C, B]], r);

const unit = (x, y) => {
  const l = Math.hypot(x, y);
  return [x / l, y / l];
};

/** Long band along the line p->q, `t` wide, on the side of the normal n. */
function strip(p, q, t, n) {
  const [ux, uy] = unit(q[0] - p[0], q[1] - p[1]);
  const L = 4000;
  const a = [p[0] - ux * L, p[1] - uy * L];
  const b = [q[0] + ux * L, q[1] + uy * L];
  return [[a, b, [b[0] + n[0] * t, b[1] + n[1] * t], [a[0] + n[0] * t, a[1] + n[1] * t]]];
}
// inward normals of the three edges
const N_LEFT = [1, 0];
const N_TOP = unit(C[1] - A[1], -(C[0] - A[0])).map((v) => -v);
const N_BOT = unit(C[1] - B[1], -(C[0] - B[0]));

/**
 * A, "Prism": three translucent ribbons, one along each edge. Where two cross
 * at a corner they mix, which gives the triangle bright vertices and a small
 * open centre.
 */
export function prism({ r = 120, t = 200, ri = 30 } = {}) {
  const T = triangle(r);
  const left = round(intersect(T, strip(A, B, t, N_LEFT)), ri);
  const top = round(intersect(T, strip(A, C, t, N_TOP)), ri);
  const bot = round(intersect(T, strip(B, C, t, N_BOT)), ri);
  return {
    layers: [
      { shape: left, tone: "violet", opacity: 0.92 },
      { shape: top, tone: "rose", opacity: 0.8 },
      { shape: bot, tone: "ember", opacity: 0.8 },
    ],
    silhouette: union(union(left, top), bot),
  };
}

/**
 * B, "Fold": one ribbon wound round the three edges. Each corner belongs to
 * one leg, which passes over the next with a hairline gap, so the loop reads
 * as a single band tucked under itself. The colour steps from violet to ember
 * along its length.
 */
export function fold({ r = 110, t = 220, gap = 22, ri = 0 } = {}) {
  const T = triangle(r);
  const hole = round(offset(T, -t), ri);
  const ring = subtract(T, hole);
  // Each band is exactly t wide, so its inner edge lies on the hole's edge.
  const band = (p, q, n) => intersect(ring, strip(p, q, t, n));
  const L = band(A, B, N_LEFT);
  const Tp = band(A, C, N_TOP);
  const Bt = band(B, C, N_BOT);
  // left owns corner A, top owns the tip, bottom owns corner B
  const g = (s) => (gap > 0 ? offset(s, gap) : s);
  const left = subtract(L, g(Bt));
  const top = subtract(Tp, g(left));
  const bot = subtract(Bt, g(top));
  return {
    layers: [
      { shape: bot, tone: "ember" },
      { shape: top, tone: "rose" },
      { shape: left, tone: "violet" },
    ],
    silhouette: T,
    hole,
    T,
    params: { r, t, gap, ri },
  };
}

/**
 * C, "Wing": a violet play shape with an ember crescent along its underside.
 * The crescent runs out past the back corner into a short pointed tail, so
 * the outline hints at a bird gliding right.
 */
export function wing({ r = 120, thick = 0.13, tail = [-60, 40], gap = 24, tipInset = 40 } = {}) {
  const T = triangle(r);
  const [ux, uy] = unit(C[0] - B[0], C[1] - B[1]);
  const p0 = [B[0] + tail[0], B[1] + tail[1]];
  const p2 = [C[0] - ux * tipInset, C[1] - uy * tipInset];
  const mid = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
  const n = N_BOT; // points into the triangle
  const inner = quadPoints(p0, [mid[0] + n[0] * thick * H * 2, mid[1] + n[1] * thick * H * 2], p2, 96);
  const outer = quadPoints(p0, [mid[0] - n[0] * 30, mid[1] - n[1] * 30], p2, 96);
  const cres = [[...outer, ...inner.reverse()]];
  const crescent = round(cres, 14);
  const body = subtract(T, offset(crescent, gap));
  return {
    layers: [
      { shape: body, tone: "violet" },
      { shape: crescent, tone: "ember" },
    ],
    silhouette: union(T, crescent),
  };
}

/** Place a shape so the play triangle looks centred on (cx, cy) at height h. */
export function placement(silhouette, { cx, cy, h }) {
  const b = bbox(silhouette);
  const k = h / b.h;
  // A triangle looks left-heavy when its box is centred. Put the point halfway
  // between the box centre and the centroid on the centre instead.
  const vx = (b.x0 + b.w / 2 + TIP / 3) / 2;
  return { k, dx: cx - vx * k, dy: cy - (b.y0 + b.h / 2) * k, b };
}
