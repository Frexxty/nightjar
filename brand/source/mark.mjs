// Geometry for the Stratus mark and the two concepts it beat.
// Every function returns SVG path data in its own coordinate box so callers
// can place it with a transform.

const n = (v) => +v.toFixed(3);

/**
 * "Fold S": one band that folds back on itself twice. The three horizontal
 * runs are the stratus layers, the two turns make the S.
 *
 *   t  band thickness
 *   g  gap between bands
 *   w  overall width
 *   x0, y0  top-left of the bounding box
 *   cap  "round" or "butt" terminals
 *   inset  how far the terminals stop short of the outer edge
 */
export function foldS({ t, g, w, x0 = 0, y0 = 0, cap = "round", inset = 0 }) {
  const p = t + g; // band pitch
  const Ro = (p + t) / 2; // outer turn radius
  const Ri = g / 2; // inner turn radius
  const xL = x0 + Ro; // centre x of the left turn
  const xR = x0 + w - Ro; // centre x of the right turn
  const r = t / 2;
  // Terminal positions: the top band ends on the right, the bottom on the left.
  const xa = x0 + w - inset - (cap === "round" ? r : 0);
  const xb = x0 + inset + (cap === "round" ? r : 0);
  const Y = (v) => n(y0 + v);
  const X = n;

  const d = [];
  d.push(`M${X(xa)} ${Y(0)}`);
  d.push(`L${X(xL)} ${Y(0)}`);
  d.push(`A${n(Ro)} ${n(Ro)} 0 0 0 ${X(xL)} ${Y(p + t)}`);
  d.push(`L${X(xR)} ${Y(p + t)}`);
  d.push(`A${n(Ri)} ${n(Ri)} 0 0 1 ${X(xR)} ${Y(2 * p)}`);
  d.push(`L${X(xb)} ${Y(2 * p)}`);
  if (cap === "round") d.push(`A${n(r)} ${n(r)} 0 0 0 ${X(xb)} ${Y(2 * p + t)}`);
  else d.push(`L${X(xb)} ${Y(2 * p + t)}`);
  d.push(`L${X(xR)} ${Y(2 * p + t)}`);
  d.push(`A${n(Ro)} ${n(Ro)} 0 0 0 ${X(xR)} ${Y(p)}`);
  d.push(`L${X(xL)} ${Y(p)}`);
  d.push(`A${n(Ri)} ${n(Ri)} 0 0 1 ${X(xL)} ${Y(t)}`);
  d.push(`L${X(xa)} ${Y(t)}`);
  if (cap === "round") d.push(`A${n(r)} ${n(r)} 0 0 0 ${X(xa)} ${Y(0)}`);
  d.push("Z");
  return { d: d.join(""), width: w, height: 3 * t + 2 * g };
}

/** Proportions of the master mark, as fractions of its width. */
export const MARK = { t: 90 / 612, g: 48 / 612 };
MARK.h = 3 * MARK.t + 2 * MARK.g;

/**
 * The master mark, centred on (cx, cy) at width w, split into parts:
 *   outline  the whole S as one shape
 *   runs     the three horizontal bands
 *   folds    the two half-ring turns (drawn darker so they read as the
 *            ribbon passing behind itself)
 */
export function markParts({ cx, cy, w, t = w * MARK.t, g = w * MARK.g }) {
  // t and g can be overridden to snap the mark to a pixel grid at small sizes.
  const h = 3 * t + 2 * g;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const p = t + g;
  const Ro = (p + t) / 2;
  const Ri = g / 2;
  const r = t / 2;
  const xL = x0 + Ro;
  const xR = x0 + w - Ro;
  const xa = x0 + w - r;
  const xb = x0 + r;
  const outline = foldS({ t, g, w, x0, y0 }).d;
  const runs =
    `M${n(xL)} ${n(y0)}H${n(xa)}A${n(r)} ${n(r)} 0 0 1 ${n(xa)} ${n(y0 + t)}H${n(xL)}Z` +
    `M${n(xL)} ${n(y0 + p)}H${n(xR)}V${n(y0 + p + t)}H${n(xL)}Z` +
    `M${n(xR)} ${n(y0 + 2 * p)}H${n(xb)}A${n(r)} ${n(r)} 0 0 0 ${n(xb)} ${n(y0 + 2 * p + t)}H${n(xR)}Z`;
  const folds =
    `M${n(xL)} ${n(y0)}A${n(Ro)} ${n(Ro)} 0 0 0 ${n(xL)} ${n(y0 + p + t)}V${n(y0 + p)}A${n(Ri)} ${n(Ri)} 0 0 1 ${n(xL)} ${n(y0 + t)}Z` +
    `M${n(xR)} ${n(y0 + p)}A${n(Ro)} ${n(Ro)} 0 0 1 ${n(xR)} ${n(y0 + 2 * p + t)}V${n(y0 + 2 * p)}A${n(Ri)} ${n(Ri)} 0 0 0 ${n(xR)} ${n(y0 + p + t)}Z`;
  return { outline, runs, folds, t, g, h, x0, y0, p, Ro, Ri, xL, xR };
}

/** Rounded horizontal bar (pill). */
export function pill(x, y, w, h) {
  const r = h / 2;
  return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`;
}

/**
 * Concept A, "Strata": four drifting bands whose lengths follow a waveform
 * envelope turned on its side.
 */
export function strata({ size, x0 = 0, y0 = 0 }) {
  const t = size * 0.15;
  const g = size * 0.083;
  const rows = [
    [0.34, 0.86],
    [0.1, 1.0],
    [0.0, 0.78],
    [0.22, 0.62],
  ];
  return rows
    .map(([a, b], i) => pill(x0 + a * size, y0 + i * (t + g), (b - a) * size, t))
    .join("");
}

/**
 * Concept C, "Horizon": a disc (record, sun) whose lower half breaks into
 * horizontal layers. Returns path data for the disc and the cut rectangles,
 * meant to be used with the cuts as a mask.
 */
export function horizon({ size, x0 = 0, y0 = 0 }) {
  const r = size / 2;
  const cx = x0 + r;
  const cy = y0 + r;
  const disc = `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}Z`;
  const cuts = [
    [0.5, 0.035],
    [0.64, 0.05],
    [0.78, 0.065],
  ].map(([at, h]) => `M${n(x0 - 2)} ${n(y0 + at * size)}h${n(size + 4)}v${n(h * size)}h${n(-size - 4)}Z`);
  return { disc, cuts: cuts.join("") };
}
