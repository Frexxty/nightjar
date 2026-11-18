// GET /v1/me/recommendations and the personal shelves on /v1/home.
//
// Seeds come from D1 (recent likes, most-played and recent history, tracks in
// the account's playlists); related tracks come from SoundCloud through the
// deps the caller passes in, so tests can serve fixtures instead. Scoring is
// the app's own src/lib/recommend.ts, bundled into the Worker.
import {
  MAX_SEEDS, pickSeeds, recommendationSections, topArtists, type SeedResult, type SeedSignal,
} from "../../src/lib/recommend.ts";
import { isScId } from "./http.ts";
import type { Section, Track } from "./types.ts";

export interface UserSignals {
  /** Newest first. Every like, so they can all be left out of recommendations. */
  likes: { id: string; at: number }[];
  /** Newest first, at most 200. */
  history: { id: string; at: number; plays: number }[];
  /** Tracks from the account's most recently changed playlists, newest additions first. */
  playlistTracks: { id: string; at: number }[];
  /** Followed SoundCloud user IDs. */
  follows: string[];
}

export interface RecDeps {
  /** Full tracks for SoundCloud IDs, in the order asked, skipping missing ones. */
  tracks(ids: string[]): Promise<Track[]>;
  related(id: string): Promise<Track[]>;
  topTracks(userId: string): Promise<Track[]>;
}

/** Recent plays that recommendations leave out. */
export const RECENT_PLAYS_EXCLUDED = 50;
const LIKES_READ = 1000;
const HISTORY_READ = 200;

interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch<T = unknown>(statements: unknown[]): Promise<{ results: T[] }[]>;
}

/** Reads everything recommendations need in one D1 round trip. */
export async function loadSignals(db: D1Like, userId: string): Promise<UserSignals> {
  const [likes, history, playlists, follows] = await db.batch([
    db.prepare("SELECT track_id, created_at FROM likes WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2").bind(userId, LIKES_READ),
    db.prepare("SELECT track_id, played_at, play_count FROM history WHERE user_id = ?1 ORDER BY played_at DESC LIMIT ?2").bind(userId, HISTORY_READ),
    db.prepare("SELECT track_ids, updated_at FROM playlists WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 5").bind(userId),
    db.prepare("SELECT sc_user_id FROM follows WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 200").bind(userId),
  ]);
  const playlistTracks: { id: string; at: number }[] = [];
  // The last few tracks of each recent playlist: the ones added most recently.
  for (const row of playlists.results as { track_ids: string; updated_at: number }[]) {
    let ids: unknown;
    try {
      ids = JSON.parse(row.track_ids);
    } catch {
      continue;
    }
    if (!Array.isArray(ids)) continue;
    for (const id of ids.slice(-4).reverse()) if (typeof id === "string") playlistTracks.push({ id, at: row.updated_at });
  }
  return {
    likes: (likes.results as { track_id: string; created_at: number }[]).map((x) => ({ id: x.track_id, at: x.created_at })),
    history: (history.results as { track_id: string; played_at: number; play_count: number | null }[])
      .map((x) => ({ id: x.track_id, at: x.played_at, plays: x.play_count ?? 1 })),
    playlistTracks,
    follows: (follows.results as { sc_user_id: string }[]).map((x) => x.sc_user_id),
  };
}

/**
 * A short, stable key for the inputs that change recommendations. Results are
 * cached under it, so a new like or play gives fresh ones and nothing else does.
 */
export async function signalsKey(s: UserSignals): Promise<string> {
  const text = JSON.stringify([
    s.likes.slice(0, 20).map((x) => x.id),
    s.likes.length,
    s.history.slice(0, RECENT_PLAYS_EXCLUDED).map((x) => `${x.id}:${x.plays}`),
    s.playlistTracks.map((x) => x.id),
    s.follows.length,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Recommendation shelves for one account (docs/hosted-api.md). At most
 * MAX_SEEDS related-track lookups and two artist lookups go upstream, plus one
 * batched track lookup. Spotify tracks can't seed: the server can't ask Spotify
 * for related tracks.
 */
export async function buildRecommendations(s: UserSignals, deps: RecDeps, now = Date.now()): Promise<Section[]> {
  const sc = <T extends { id: string }>(list: T[]) => list.filter((x) => isScId(x.id));
  const likes = sc(s.likes);
  const history = sc(s.history);
  const topPlays: SeedSignal[] = [...history]
    .filter((h) => h.plays > 1)
    .sort((a, b) => b.plays - a.plays || b.at - a.at)
    .map((h) => ({ id: h.id, kind: "top", at: h.at, plays: h.plays }));
  const seeds = pickSeeds({
    likes: likes.slice(0, 20).map((l) => ({ id: l.id, kind: "like", at: l.at })),
    topPlays,
    recentPlays: history.slice(0, 20).map((h) => ({ id: h.id, kind: "play", at: h.at, plays: h.plays })),
    playlistTracks: sc(s.playlistTracks).map((p) => ({ id: p.id, kind: "playlist", at: p.at })),
  }, { max: MAX_SEEDS, now });
  if (!seeds.length) return [];

  // One batched lookup covers the seeds' titles and the tracks used to find the artists you play.
  const profileIds = [...likes.slice(0, 20).map((l) => l.id), ...history.slice(0, 30).map((h) => h.id)];
  const known = await deps.tracks([...new Set([...seeds.map((x) => x.id), ...profileIds])].slice(0, 50)).catch(() => [] as Track[]);
  const byId = new Map(known.map((t) => [t.id, t]));
  const plays = new Map(history.map((h) => [h.id, h.plays]));
  const artists = topArtists(profileIds.map((id) => byId.get(id)).filter((t): t is Track => !!t), { max: 2, minCount: 2, weights: plays });

  const [related, artistLists] = await Promise.all([
    Promise.all(seeds.map((seed) => deps.related(seed.id).catch(() => [] as Track[]))),
    Promise.all(artists.map((a) => deps.topTracks(a.id).catch(() => [] as Track[]))),
  ]);
  const results: SeedResult[] = seeds.map((seed, i) => ({ seed, track: byId.get(seed.id) ?? null, related: related[i] }));
  const exclude = [...s.likes.map((l) => l.id), ...s.history.slice(0, RECENT_PLAYS_EXCLUDED).map((h) => h.id)];
  return recommendationSections({
    results,
    artistTracks: artists.map((artist, i) => ({ artist, tracks: artistLists[i] })),
    exclude,
    boostArtists: s.follows,
  }) as Section[];
}
