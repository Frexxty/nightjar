// Moving a browser's data from the old web player origin to the new one.
// No imports, so `node --test` can load this file directly. The side effects
// live in originHandoff.ts; the old origin's half is in web/worker.js.
//
// localStorage belongs to an origin, so a visitor redirected from
// stratus-app.k3s.lat to nightjar-app.k3s.lat would arrive with no settings,
// no session and no local playlists. On the first visit the new origin hops
// once to the old one, which packs its "stratus.*" keys into window.name and
// comes straight back. The two hosts are on the same site (k3s.lat), so
// window.name survives the trip.

export const OLD_ORIGIN = "https://stratus-app.k3s.lat";
export const NEW_ORIGIN = "https://nightjar-app.k3s.lat";
export const HANDOFF_PATH = "/__nightjar-handoff";
export const WINDOW_NAME_PREFIX = "nightjar-handoff:";
export const MOVED_COOKIE = "nightjar-moved";
/** Set once this browser has done the hop, whatever came back. */
export const DONE_KEY = "nightjar.handoffDone";
/** sessionStorage: the keys that were already here when the hop started. */
export const BEFORE_KEY = "nightjar.handoffBefore";
const PREFIX = "stratus.";

export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function appKeys(store: KeyValueStore): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * Whether this page load should hop to the old origin. Only on the new
 * origin, only once per browser, never in the middle of a Spotify sign-in,
 * and only when the browser just came from the old host (the cookie) or
 * has nothing of its own yet.
 */
export function shouldHop(opts: { origin: string; pathname: string; cookie: string; store: KeyValueStore }): boolean {
  if (opts.origin !== NEW_ORIGIN) return false;
  if (opts.pathname.startsWith("/spotify-callback")) return false;
  if (opts.store.getItem(DONE_KEY)) return false;
  const moved = opts.cookie.split(/;\s*/).includes(`${MOVED_COOKIE}=1`);
  return moved || appKeys(opts.store).length === 0;
}

export function handoffUrl(returnTo: string): string {
  return `${OLD_ORIGIN}${HANDOFF_PATH}?return=${encodeURIComponent(returnTo)}`;
}

/** Reads what the old origin left in window.name. Null when it isn't ours or doesn't parse. */
export function readHandoff(windowName: string): Record<string, string> | null {
  if (!windowName.startsWith(WINDOW_NAME_PREFIX)) return null;
  try {
    const data: unknown = JSON.parse(windowName.slice(WINDOW_NAME_PREFIX.length));
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(PREFIX) && typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Writes the old origin's keys. A key that this origin already had before the
 * hop (`before`) wins; anything else is taken from the old origin, including
 * values this page wrote while it was leaving. Returns the keys written.
 */
export function applyHandoff(store: KeyValueStore, data: Record<string, string>, before: string[]): string[] {
  const keep = new Set(before);
  const written: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (keep.has(key)) continue;
    try {
      store.setItem(key, value);
      written.push(key);
    } catch {
      // Out of space: skip this one, the rest may still fit.
    }
  }
  return written;
}
