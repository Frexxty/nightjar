// Spotify track snapshots (docs/spotify.md). The server can't call Spotify, so
// for `spotify:` IDs the client sends the Track it has and the server keeps a
// cleaned copy. Pure: no Workers APIs, so `node --test` loads it directly.
import { badInput, isScId } from "./http.ts";
import type { Track, UserSummary } from "./types.ts";

/** "spotify:track:" plus Spotify's base62 ID (22 characters today; some slack for the future). */
export const isSpotifyTrackId = (id: unknown): id is string => typeof id === "string" && /^spotify:track:[A-Za-z0-9]{1,64}$/.test(id);

/** A playlist, like or history entry: a SoundCloud track ID or a Spotify track URI. */
export const isTrackRef = (id: unknown): id is string => typeof id === "string" && (isScId(id) || isSpotifyTrackId(id));

/** Largest snapshot kept, as stored JSON. A real one is about 600 bytes. */
export const MAX_SNAPSHOT_BYTES = 4096;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0;

function isoDate(v: unknown): string {
  if (typeof v === "string" && v.length <= 40) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Checks a snapshot sent for `expectedId` and returns the copy to store: only
 * known Track fields, strings capped, URLs https only, and no per-user flags
 * (`liked` and `reposted` are worked out for whoever reads it).
 * Throws 400 `invalid_input` when it can't be used.
 */
export function cleanSnapshot(raw: unknown, expectedId: string): Track {
  if (!isSpotifyTrackId(expectedId)) throw badInput("Snapshots are only for Spotify tracks (spotify:track:…).");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badInput(`Send the track for ${expectedId} as an object.`);
  const t = raw as Record<string, unknown>;
  if (t.id !== expectedId) throw badInput(`The track snapshot's id must be ${expectedId}.`);
  const title = text(t.title, 300);
  if (!title) throw badInput(`The track snapshot for ${expectedId} needs a title.`);

  const u = t.user && typeof t.user === "object" && !Array.isArray(t.user) ? (t.user as Record<string, unknown>) : {};
  const user: UserSummary = {
    id: text(u.id, 100) ?? "spotify:artist:unknown",
    username: text(u.username, 200) ?? "Unknown artist",
    avatarUrl: httpsUrl(u.avatarUrl),
  };
  if (u.verified === true) user.verified = true;

  const a = t.album && typeof t.album === "object" && !Array.isArray(t.album) ? (t.album as Record<string, unknown>) : null;
  const albumId = a ? text(a.id, 100) : null;
  const albumTitle = a ? text(a.title, 300) : null;

  const out: Track = {
    id: expectedId,
    title,
    user,
    artworkUrl: httpsUrl(t.artworkUrl),
    duration: count(t.duration, 24 * 3600_000),
    createdAt: isoDate(t.createdAt),
    playbackCount: count(t.playbackCount),
    likesCount: count(t.likesCount),
    repostsCount: count(t.repostsCount),
    commentCount: count(t.commentCount),
    waveform: null,
    permalinkUrl: httpsUrl(t.permalinkUrl),
    streamable: t.streamable !== false,
    source: "spotify",
    uri: expectedId,
    album: albumId && albumTitle ? { id: albumId, title: albumTitle, artworkUrl: a ? httpsUrl(a.artworkUrl) : null } : null,
  };
  const genre = text(t.genre, 100);
  if (genre) out.genre = genre;
  if (t.preview === true) out.preview = true;
  if (JSON.stringify(out).length > MAX_SNAPSHOT_BYTES) throw badInput(`The track snapshot for ${expectedId} is too large.`);
  return out;
}

/**
 * Reads a playlist's `tracks` (or anything shaped like it): returns the IDs in
 * order and the cleaned Spotify snapshots. SoundCloud entries only need `id`.
 */
export function readTrackList(value: unknown, max: number): { ids: string[]; snapshots: Track[] } {
  if (!Array.isArray(value)) throw badInput("tracks must be an array of tracks.");
  if (value.length > max) throw badInput(`Playlists can hold at most ${max} tracks.`);
  const ids: string[] = [];
  const snapshots = new Map<string, Track>();
  for (const entry of value) {
    const id = entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined;
    const sid = typeof id === "number" ? String(id) : id;
    if (!isTrackRef(sid)) throw badInput("Every track needs a SoundCloud track ID or a spotify:track: ID.");
    if (isSpotifyTrackId(sid)) snapshots.set(sid, cleanSnapshot(entry, sid));
    ids.push(sid);
  }
  return { ids, snapshots: [...snapshots.values()] };
}

/**
 * Puts tracks back in saved order: SoundCloud ones from `hydrated`, Spotify
 * ones from `snapshots`. IDs found in neither (deleted uploads) are skipped.
 */
export function mergeInOrder(ids: string[], hydrated: Track[], snapshots: Map<string, Track>): Track[] {
  const sc = new Map(hydrated.map((t) => [t.id, t]));
  const out: Track[] = [];
  for (const id of ids) {
    const t = isSpotifyTrackId(id) ? snapshots.get(id) : sc.get(id);
    if (t) out.push(isSpotifyTrackId(id) ? { ...t } : t);
  }
  return out;
}

/** Splits snapshots into JSON arrays of at most `maxBytes`, one D1 parameter each. */
export function chunkJson(items: unknown[], maxBytes = 512 * 1024): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const s = JSON.stringify(item);
    if (current.length && size + s.length + 1 > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(s);
    size += s.length + 1;
  }
  if (current.length) chunks.push(`[${current.join(",")}]`);
  return chunks;
}
