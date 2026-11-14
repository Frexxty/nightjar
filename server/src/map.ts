// Turns SoundCloud api-v2 objects into the Nightjar shapes in types.ts.
// Pure functions only, so `node --test` can import this file directly.
import type {
  Comment, Playlist, ScComment, ScPlaylist, ScTrack, ScTranscoding, ScUser, Track, User, UserSummary,
} from "./types.ts";

const EPOCH = "1970-01-01T00:00:00Z";
export const PREVIEW_MS = 30000;

/** SoundCloud image URLs end in "-large.jpg" (100px). "-t500x500" is the biggest size every image has. */
export function bigImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/-(large|t\d+x\d+|crop|small|badge|tiny|mini)\.(jpg|png|jpeg)(\?.*)?$/i, "-t500x500.$2$3");
}

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const str = (s: unknown) => (typeof s === "string" && s.trim() ? s : null);

/** `rap "hip hop" trap` -> ["rap", "hip hop", "trap"]. */
export function parseTagList(tagList: string | null | undefined): string[] {
  if (!tagList) return [];
  const tags: string[] = [];
  for (const m of tagList.matchAll(/"([^"]+)"|(\S+)/g)) {
    const tag = (m[1] ?? m[2]).trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function mapUserSummary(u: ScUser | null | undefined): UserSummary {
  if (!u) return { id: "0", username: "Unknown", avatarUrl: null };
  const out: UserSummary = { id: String(u.id), username: u.username ?? "Unknown", avatarUrl: bigImage(u.avatar_url) };
  if (u.verified) out.verified = true;
  return out;
}

export function mapUser(u: ScUser): User {
  return {
    ...mapUserSummary(u),
    verified: Boolean(u.verified),
    bannerUrl: u.visuals?.visuals?.[0]?.visual_url ?? null,
    city: str(u.city),
    country: str(u.country_code),
    description: str(u.description),
    followersCount: num(u.followers_count),
    followingsCount: num(u.followings_count),
    trackCount: num(u.track_count),
    playlistCount: num(u.playlist_count),
    permalinkUrl: u.permalink_url ?? null,
  };
}

const isEncrypted = (t: ScTranscoding) =>
  /encrypted/i.test(t.format?.protocol ?? "") || /encrypted|drm|ctr|cbc/i.test(t.preset ?? "");

/**
 * The transcoding to play: unencrypted HLS with AAC first (higher bitrate first),
 * then HLS MP3, then progressive. Skips encrypted and DRM transcodings and the
 * adaptive "abr" master playlists. Returns null when nothing is playable.
 */
export function pickTranscoding(transcodings: ScTranscoding[] | null | undefined): ScTranscoding | null {
  const usable = (transcodings ?? []).filter((t) => t && t.url && t.format && !isEncrypted(t));
  const rank = (t: ScTranscoding): number => {
    const mime = t.format.mime_type ?? "";
    const proto = t.format.protocol;
    const bitrate = Number((t.preset ?? "").match(/(\d+)k/)?.[1] ?? 0);
    if (proto === "hls" && /^audio\/mp4/.test(mime)) return 400 + Math.min(bitrate, 99);
    if (proto === "hls" && /^audio\/mpeg$/.test(mime)) return 300;
    if (proto === "progressive") return 200;
    if (proto === "hls" && /^audio\/(ogg|opus)/.test(mime)) return 100;
    return -1;
  };
  const best = usable.map((t) => [rank(t), t] as const).filter(([r]) => r >= 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

export function isPreview(t: ScTrack): boolean {
  if (t.policy === "SNIP") return true;
  const tcs = t.media?.transcodings ?? [];
  return tcs.length > 0 && tcs.every((x) => x.snipped);
}

/** False for stubs (only `id`), which need hydrating before they can be mapped. */
export function isFullTrack(t: ScTrack | null | undefined): t is ScTrack {
  return Boolean(t && typeof t.id === "number" && typeof t.title === "string" && t.user);
}

export function mapTrack(t: ScTrack): Track {
  const preview = isPreview(t);
  const snippet = (t.media?.transcodings ?? []).find((x) => x.snipped)?.duration;
  const duration = preview ? Math.min(num(snippet) || PREVIEW_MS, num(t.duration) || PREVIEW_MS) : num(t.duration) || num(t.full_duration);
  const streamable = t.streamable !== false && t.policy !== "BLOCK" && pickTranscoding(t.media?.transcodings) !== null;
  const track: Track = {
    id: String(t.id),
    title: t.title ?? "Untitled",
    user: mapUserSummary(t.user),
    artworkUrl: bigImage(t.artwork_url) ?? bigImage(t.user?.avatar_url),
    duration,
    genre: str(t.genre),
    tags: parseTagList(t.tag_list),
    description: str(t.description),
    createdAt: t.created_at ?? t.display_date ?? EPOCH,
    playbackCount: num(t.playback_count),
    likesCount: num(t.likes_count),
    repostsCount: num(t.reposts_count),
    commentCount: num(t.comment_count),
    waveform: null,
    permalinkUrl: t.permalink_url ?? null,
    streamable,
  };
  if (preview) track.preview = true;
  return track;
}

/** Maps a playlist. Pass `tracks` (already hydrated and mapped) for detail responses. */
export function mapPlaylist(p: ScPlaylist, tracks?: Track[]): Playlist {
  const isSystem = typeof p.id === "string" || p.kind === "system-playlist";
  const firstArt = (p.tracks ?? []).find((t) => isFullTrack(t) && t.artwork_url)?.artwork_url;
  const out: Playlist = {
    id: isSystem ? String(p.urn ?? p.id) : String(p.id),
    title: p.title ?? "Untitled",
    user: mapUserSummary(p.user),
    artworkUrl: bigImage(p.artwork_url ?? p.calculated_artwork_url ?? firstArt) ?? bigImage(p.user?.avatar_url),
    description: str(p.description),
    isAlbum: p.set_type === "album" || p.is_album === true,
    trackCount: num(p.track_count) || (p.tracks?.length ?? 0),
    duration: num(p.duration) || (tracks ? tracks.reduce((s, t) => s + t.duration, 0) : 0),
    createdAt: p.created_at ?? p.published_at ?? p.last_updated ?? EPOCH,
    likesCount: num(p.likes_count),
    permalinkUrl: p.permalink_url ?? null,
  };
  if (tracks) out.tracks = tracks;
  return out;
}

export function mapComment(c: ScComment): Comment {
  return {
    id: String(c.id),
    user: mapUserSummary(c.user),
    body: c.body ?? "",
    timestamp: typeof c.timestamp === "number" && c.timestamp >= 0 ? c.timestamp : null,
    createdAt: c.created_at ?? EPOCH,
  };
}

/** Timed comments by position, then unpinned ones by date. */
export function sortComments(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => {
    if (a.timestamp == null && b.timestamp == null) return a.createdAt.localeCompare(b.createdAt);
    if (a.timestamp == null) return 1;
    if (b.timestamp == null) return -1;
    return a.timestamp - b.timestamp;
  });
}

/**
 * SoundCloud's waveform JSON is { width, height, samples: int[] } with ~1800
 * samples. Returns peaks in 0..1, max-pooled down to at most `points`.
 */
export function normalizeWaveform(json: unknown, points = 400): number[] | null {
  const w = json as { height?: number; samples?: unknown };
  if (!w || !Array.isArray(w.samples) || !w.samples.length) return null;
  const samples = w.samples.filter((s): s is number => typeof s === "number");
  if (!samples.length) return null;
  const height = typeof w.height === "number" && w.height > 0 ? w.height : Math.max(...samples, 1);
  const n = Math.min(points, samples.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * samples.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / n));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, samples[j]);
    out.push(Math.round(Math.min(1, peak / height) * 1000) / 1000);
  }
  return out;
}

export function waveformJsonUrl(waveformUrl: string | null | undefined): string | null {
  if (!waveformUrl || !/^https:\/\/wave\.sndcdn\.com\//.test(waveformUrl)) return null;
  return waveformUrl.replace(/\.png(\?.*)?$/, ".json");
}
