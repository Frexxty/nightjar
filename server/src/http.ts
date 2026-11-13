// Responses, errors, CORS and cursors. No Workers-only APIs, so tests can import it.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export class ApiError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const badInput = (message: string) => new ApiError(400, "invalid_input", message);
export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message);
export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in to do that.");

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...headers },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function errorResponse(err: ApiError): Response {
  return json({ error: err.message, code: err.code }, err.status, err.headers);
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
export { b64url, fromB64url };

/** Cursors are base64url JSON so clients treat them as opaque. */
export function encodeCursor(value: Record<string, string | number>): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw badInput("That cursor isn't valid.");
  try {
    const v = JSON.parse(new TextDecoder().decode(fromB64url(cursor)));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw badInput("That cursor isn't valid.");
  }
}

/** Reads SoundCloud's `offset` out of a `next_href` and wraps it as a cursor. */
export function cursorFromNextHref(nextHref: string | null | undefined): string | null {
  if (!nextHref) return null;
  try {
    const offset = new URL(nextHref).searchParams.get("offset");
    return offset ? encodeCursor({ o: offset }) : null;
  } catch {
    return null;
  }
}

/** The SoundCloud offset a cursor carries, validated so it can go back into a URL. */
export function offsetFromCursor(cursor: string | null | undefined): string | null {
  const v = decodeCursor(cursor);
  if (!v) return null;
  const o = v.o;
  if (typeof o === "number" && Number.isInteger(o) && o >= 0) return String(o);
  if (typeof o === "string" && o.length <= 200 && /^[\w.:,%-]+$/.test(o)) return o;
  throw badInput("That cursor isn't valid.");
}

/** Integer offset for cursors over our own lists (D1, merged feeds). */
export function intOffset(cursor: string | null | undefined, max = 100000): number {
  const v = decodeCursor(cursor);
  if (!v) return 0;
  const o = Number(v.o);
  if (!Number.isInteger(o) || o < 0 || o > max) throw badInput("That cursor isn't valid.");
  return o;
}

export const isScId = (id: string) => /^\d{1,19}$/.test(id);
