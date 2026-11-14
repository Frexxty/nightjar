// Per-track cover art for Spotify tracks read from public pages.
//
// The embed page lists a playlist's tracks without their images, so imports
// used to give every track the playlist cover (Spotify's 2x2 mosaic). Spotify's
// oEmbed endpoint needs no sign-in, allows any origin, and returns a 300 px
// cover per track; the same image id with another prefix is the 640 px one.
//
// Lookups are cached (memory plus a capped localStorage map), run six at a
// time, time out, and never throw: a cover that can't be read comes back null.
// Type imports only, so `node --test` can load this file directly.
import type { Track } from "@/api";

const OEMBED = "https://open.spotify.com/oembed?url=https://open.spotify.com/track/";
const STORE_KEY = "stratus.spotifyArtwork";
const STORE_CAP = 2000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;

// Album art ids are a 16-character size prefix and a 24-character hash.
const ALBUM_640 = "ab67616d0000b273";
const ALBUM_SMALLER = /\/ab67616d0000(?:1e02|4851)(?=[0-9a-f]{24}$)/;
// Playlist images: ab67706c (uploaded by the owner), ab67706f (Spotify's editorial ones).
const PLAYLIST_IMAGE = /^ab67706[cf]/;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const lastSegment = (url: string) => {
  try {
    const u = new URL(url);
    return { host: u.hostname, id: u.pathname.split("/").filter(Boolean).pop() ?? "" };
  } catch {
    return null;
  }
};

/**
 * True for Spotify's playlist mosaics: `mosaic.scdn.co` URLs, or an image path
 * made of several album ids glued together, which the newer CDN hosts use.
 */
export function isMosaicUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const p = lastSegment(url);
  if (!p) return false;
  if (p.host === "mosaic.scdn.co") return true;
  return /^[0-9a-f]+$/i.test(p.id) && p.id.length >= 80;
}

/** True for a Spotify playlist's own image (a mosaic or one the owner uploaded), which is never a track's cover. */
export function isPlaylistCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isMosaicUrl(url)) return true;
  const p = lastSegment(url);
  return !!p && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(p.host) && PLAYLIST_IMAGE.test(p.id);
}

/** The 640 px version of a Spotify album image. Other URLs come back unchanged. */
export function largeSpotifyImage(url: string): string {
  return url.replace(ALBUM_SMALLER, `/${ALBUM_640}`);
}

/** "spotify:track:abc" -> "abc"; null for anything else (SoundCloud ids, local files). */
export function spotifyTrackId(id: string | null | undefined): string | null {
  const m = /^spotify:track:([A-Za-z0-9]{10,40})$/.exec(id ?? "");
  return m ? m[1] : null;
}

/**
 * Covers that more than half of a list's Spotify tracks share (at least three
 * of them), plus the list's own cover. A playlist's tracks only share one when
 * the import copied the playlist cover onto them.
 */
export function suspectCovers(tracks: readonly Track[], listCover?: string | null): Set<string> {
  const out = new Set<string>();
  if (listCover) out.add(listCover);
  const counts = new Map<string, number>();
  let spotify = 0;
  for (const t of tracks) {
    if (!spotifyTrackId(t.id)) continue;
    spotify++;
    if (t.artworkUrl) counts.set(t.artworkUrl, (counts.get(t.artworkUrl) ?? 0) + 1);
  }
  for (const [url, n] of counts) if (n >= 3 && n > spotify / 2) out.add(url);
  return out;
}

/** Whether a track should get its own cover looked up. */
export function needsArtwork(t: Track, suspects: ReadonlySet<string> = new Set()): boolean {
  if (!spotifyTrackId(t.id)) return false;
  const url = t.artworkUrl;
  return !url || isPlaylistCoverUrl(url) || suspects.has(url);
}

/**
 * Indexes of the tracks that need a cover. `listCover` is the playlist image an
 * import may have copied. `missingOnly` skips the shared-cover check, for lists
 * where a shared cover is right (a fresh album import).
 */
export function tracksNeedingArtwork(tracks: readonly Track[], listCover?: string | null, missingOnly = false): number[] {
  const suspects = missingOnly ? new Set<string>() : suspectCovers(tracks, listCover);
  const out: number[] = [];
  tracks.forEach((t, i) => {
    if (needsArtwork(t, suspects)) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Cache and lookups.

const memory = new Map<string, string>();
/** Tracks Spotify said don't exist, for this session only. */
const gone = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(storage()?.getItem(STORE_KEY) ?? "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [id, url] of Object.entries(raw)) if (typeof url === "string") memory.set(id, url);
    }
  } catch {
    // A broken entry just means lookups start cold.
  }
}

function saveStore() {
  saveTimer = null;
  // Oldest first in insertion order; keep the newest STORE_CAP.
  while (memory.size > STORE_CAP) memory.delete(memory.keys().next().value!);
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch {
    // Quota or private mode: the memory copy still works for this session.
  }
}

function remember(id: string, url: string) {
  memory.delete(id);
  memory.set(id, url);
  if (!saveTimer) saveTimer = setTimeout(saveStore, 400);
}

/** Writes pending cache changes now. */
export function flushArtworkCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveStore();
}

/** Forgets everything, including what is stored. For tests. */
export function resetArtworkCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  memory.clear();
  gone.clear();
  inflight.clear();
  loaded = false;
}

/** A cached cover, without asking Spotify. */
export function cachedTrackArtwork(spotifyId: string): string | null {
  loadStore();
  return memory.get(spotifyId) ?? null;
}

let running = 0;
const waiting: Array<() => void> = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function lookup(spotifyId: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OEMBED + encodeURIComponent(spotifyId), { signal: controller.signal });
    if (res.status === 404) gone.add(spotifyId);
    if (!res.ok) return null;
    const body = (await res.json()) as { thumbnail_url?: unknown } | null;
    const thumb = body?.thumbnail_url;
    if (typeof thumb !== "string" || !thumb.startsWith("https://")) return null;
    const url = largeSpotifyImage(thumb);
    remember(spotifyId, url);
    return url;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ArtworkOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

/** The 640 px cover of a Spotify track, or null if it can't be read. Never throws. */
export function spotifyTrackArtwork(spotifyId: string, opts: ArtworkOptions = {}): Promise<string | null> {
  loadStore();
  const hit = memory.get(spotifyId);
  if (hit) return Promise.resolve(hit);
  if (gone.has(spotifyId) || !/^[A-Za-z0-9]{10,40}$/.test(spotifyId)) return Promise.resolve(null);
  const pending = inflight.get(spotifyId);
  if (pending) return pending;
  const p = limited(() => lookup(spotifyId, opts.fetch ?? defaultFetch, opts.timeoutMs ?? TIMEOUT_MS)).finally(() => inflight.delete(spotifyId));
  inflight.set(spotifyId, p);
  return p;
}

export interface ArtworkProgress {
  index: number;
  /** The track as it is now, with its new cover if one was found. */
  track: Track;
  found: boolean;
  /** What the lookup returned; null when the cover couldn't be read. */
  url: string | null;
  done: number;
  total: number;
}

/**
 * A copy of `tracks` where every Spotify track that has no cover, a playlist
 * image, or the cover most of the list shares, gets its own. Tracks whose cover
 * can't be read keep what they had. `onProgress` fires as each lookup ends.
 */
export async function withTrackArtwork(
  tracks: readonly Track[],
  onProgress?: (p: ArtworkProgress) => void,
  opts: ArtworkOptions & { listCover?: string | null; missingOnly?: boolean } = {},
): Promise<Track[]> {
  const out = [...tracks];
  const todo = tracksNeedingArtwork(tracks, opts.listCover, opts.missingOnly);
  let done = 0;
  await Promise.all(
    todo.map(async (index) => {
      const t = tracks[index];
      const url = await spotifyTrackArtwork(spotifyTrackId(t.id)!, opts);
      done++;
      const found = !!url && url !== t.artworkUrl;
      if (found) out[index] = { ...t, artworkUrl: url };
      onProgress?.({ index, track: out[index], found, url, done, total: todo.length });
    }),
  );
  return out;
}

/** Up to four distinct track covers, in list order, for a playlist header. Playlist images are left out. */
export function distinctCovers(tracks: readonly Track[], max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const url = t.artworkUrl;
    if (!url || isPlaylistCoverUrl(url)) continue;
    // The 300 and 640 px versions of one cover count once.
    const key = largeSpotifyImage(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length === max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repairing saved playlists.
//
// Playlists imported before covers were looked up carry the playlist mosaic on
// every Spotify track. Opening one looks the covers up once in the background;
// the caller saves them. A playlist is tried again only if lookups or the save
// failed (up to three times), or if its track count changed.

const REPAIR_KEY = "stratus.artworkRepair";
export const REPAIR_ATTEMPTS = 3;

interface RepairMemo {
  /** Track count at the last run. */
  n: number;
  attempts: number;
  done: boolean;
}

function readMemos(): Record<string, RepairMemo> {
  try {
    const raw = JSON.parse(storage()?.getItem(REPAIR_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeMemo(id: string, memo: RepairMemo) {
  const all = readMemos();
  all[id] = memo;
  try {
    storage()?.setItem(REPAIR_KEY, JSON.stringify(all));
  } catch {
    // Without storage the repair runs again next time, which is harmless.
  }
}

/** Whether opening this playlist should look up covers. */
export function shouldRepairArtwork(id: string, tracks: readonly Track[]): boolean {
  const memo = readMemos()[id];
  if (memo && memo.n === tracks.length && (memo.done || memo.attempts >= REPAIR_ATTEMPTS)) return false;
  return tracksNeedingArtwork(tracks).length > 0;
}

export interface RepairResult {
  /** New covers by track id. Empty when nothing changed. */
  covers: Map<string, string>;
  /** Lookups that failed this time. */
  failed: number;
  /** True when this run used up the last attempt; worth telling the user. */
  gaveUp: boolean;
}

/** Records a failed run (lookups or the save). Returns true when that was the last allowed attempt. */
export function artworkRepairFailed(id: string, trackCount: number): boolean {
  const memo = readMemos()[id];
  const attempts = (memo && memo.n === trackCount ? memo.attempts : 0) + 1;
  writeMemo(id, { n: trackCount, attempts, done: false });
  return attempts === REPAIR_ATTEMPTS;
}

/**
 * Looks up covers for a saved playlist's Spotify tracks that need them. Returns
 * null when there's nothing to do (already repaired, or every cover is fine).
 */
export async function repairPlaylistArtwork(id: string, tracks: readonly Track[], opts: ArtworkOptions = {}): Promise<RepairResult | null> {
  if (!shouldRepairArtwork(id, tracks)) return null;
  const covers = new Map<string, string>();
  let failed = 0;
  await withTrackArtwork(
    tracks,
    ({ track, found, url }) => {
      if (found && track.artworkUrl) covers.set(track.id, track.artworkUrl);
      else if (!url) failed++;
    },
    opts,
  );
  const gaveUp = failed ? artworkRepairFailed(id, tracks.length) : false;
  if (!failed) writeMemo(id, { n: tracks.length, attempts: 0, done: true });
  return { covers, failed, gaveUp };
}
