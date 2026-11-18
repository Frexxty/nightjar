// Recommendation scoring shared by the hosted server (server/src/recommendations.ts),
// the demo backend and the Spotify catalogue. Pure, with type-only imports, so
// the Worker can bundle it and `node --test` can load it directly
// (tests/recommend.test.ts, server/test/recommendations.test.ts).
import type { Section, Track, UserSummary } from "../api/types";

/** Where a seed came from. "top" is a most-played track, "play" a recent one. */
export type SeedKind = "like" | "top" | "play" | "playlist";

export interface SeedSignal {
  id: string;
  kind: SeedKind;
  /** When it was liked, played or added (ms since epoch), if known. */
  at?: number | null;
  /** Play count, for "top" seeds. */
  plays?: number;
}

export interface Seed extends SeedSignal {
  weight: number;
}

/** Each list is in priority order: newest likes, most-played tracks, newest plays, newest playlist additions. */
export interface Signals {
  likes: SeedSignal[];
  topPlays: SeedSignal[];
  recentPlays?: SeedSignal[];
  playlistTracks?: SeedSignal[];
}

/** At most this many seeds, so one recommendation costs at most this many related-track lookups. */
export const MAX_SEEDS = 6;

const BASE_WEIGHT: Record<SeedKind, number> = { like: 1, top: 0.95, play: 0.8, playlist: 0.7 };
/** How many seeds of each kind come first, before the rest fill up. */
const QUOTA: [SeedKind, number][] = [["like", 3], ["top", 2], ["playlist", 1]];
const DAY = 86_400_000;
/** A seed's weight halves every 45 days, down to a floor of 0.35. */
const HALF_LIFE_DAYS = 45;

function ageFactor(at: number | null | undefined, now: number): number {
  if (!at || at > now) return 1;
  return Math.max(0.35, 0.5 ** ((now - at) / DAY / HALF_LIFE_DAYS));
}

/**
 * Up to `max` distinct seeds: the 3 newest likes, the 2 most-played tracks and
 * the newest playlist addition, then whatever is left in the same order.
 * Weights fall with age and with position inside each list.
 */
export function pickSeeds(signals: Signals, options: { max?: number; now?: number } = {}): Seed[] {
  const max = options.max ?? MAX_SEEDS;
  const now = options.now ?? Date.now();
  const lists: Record<SeedKind, SeedSignal[]> = {
    like: signals.likes,
    top: signals.topPlays,
    play: signals.recentPlays ?? [],
    playlist: signals.playlistTracks ?? [],
  };
  const used = new Set<string>();
  const taken: Record<SeedKind, number> = { like: 0, top: 0, play: 0, playlist: 0 };
  const cursor: Record<SeedKind, number> = { like: 0, top: 0, play: 0, playlist: 0 };
  const out: Seed[] = [];

  const takeFrom = (kind: SeedKind): boolean => {
    const list = lists[kind];
    while (cursor[kind] < list.length) {
      const s = list[cursor[kind]++];
      if (!s?.id || used.has(s.id)) continue;
      used.add(s.id);
      const rank = 0.92 ** taken[kind]++;
      const playBoost = kind === "top" && s.plays && s.plays > 1 ? Math.min(1.3, 1 + Math.log2(s.plays) / 10) : 1;
      out.push({ ...s, kind, weight: BASE_WEIGHT[kind] * rank * playBoost * ageFactor(s.at, now) });
      return true;
    }
    return false;
  };

  for (const [kind, quota] of QUOTA) {
    for (let i = 0; i < quota && out.length < max; i++) if (!takeFrom(kind)) break;
  }
  // Fill the rest round-robin so one long list can't crowd out the others.
  const order: SeedKind[] = ["like", "top", "play", "playlist"];
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (const kind of order) {
      if (out.length >= max) break;
      if (takeFrom(kind)) progressed = true;
    }
  }
  return out;
}

/** A seed with its own track (for titles) and the tracks related to it, best first. */
export interface SeedResult {
  seed: Seed;
  track: Track | null;
  related: Track[];
}

export interface ScoreOptions {
  /** Track IDs to leave out: liked tracks and recent plays. Seeds are always left out. */
  exclude?: Iterable<string>;
  /** Songs to leave out by `titleKey`, so another upload of a song already shown doesn't come back. */
  excludeKeys?: Iterable<string>;
  /** Artist (user) IDs to rank higher, such as followed artists. */
  boostArtists?: Iterable<string>;
  /** At most this many tracks by one artist. Default 2. */
  perArtist?: number;
  /** Default 30. */
  limit?: number;
  /**
   * 30-second previews only fill in when there aren't `minFill` full tracks.
   * Default 8. Unplayable tracks are always dropped.
   */
  minFill?: number;
}

export interface Scored {
  track: Track;
  score: number;
  /** IDs of the seeds that suggested it. */
  seeds: string[];
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[([{].*?[)\]}]/g, " ")
    .replace(/\b(feat|ft|featuring|prod)\b\.?.*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Lower-cased title and artist with brackets, "feat." credits and punctuation removed, to catch re-uploads. */
export function titleKey(t: Pick<Track, "title" | "user">): string {
  return `${clean(t.user?.username ?? "")}|${clean(t.title ?? "")}`;
}

// Fan-made versions of someone else's song, usually uploaded by another account.
const VERSION = /(?:^|[^\p{L}\p{N}])(slowed|reverb|sped[\s_-]*up|speed[\s_-]*up|nightcore|8d|bass[\s_-]*boosted)(?=$|[^\p{L}\p{N}])/giu;

/**
 * The title without version words ("slowed", "sped up", "nightcore", "8D",
 * "reverb", "bass boosted"), and whether it had any. Artist-independent, so a
 * slowed re-upload by another account matches the original.
 */
export function songVersion(title: string): { base: string; version: boolean } {
  const stripped = title.replace(VERSION, " ");
  return { base: clean(stripped), version: stripped !== title };
}

/** Drops fan-made versions of a song when the list already has the song or another version of it. */
function dropVersions<T extends { track: Track }>(list: T[]): T[] {
  const originals = new Set<string>();
  for (const x of list) {
    const v = songVersion(x.track.title ?? "");
    if (!v.version && v.base) originals.add(v.base);
  }
  const versions = new Set<string>();
  return list.filter((x) => {
    const v = songVersion(x.track.title ?? "");
    if (!v.version || !v.base) return true;
    if (originals.has(v.base) || versions.has(v.base)) return false;
    versions.add(v.base);
    return true;
  });
}

/** Keeps at most `n` tracks per artist, in order. */
export function capPerArtist<T extends { user: UserSummary }>(tracks: T[], n: number): T[] {
  const counts = new Map<string, number>();
  return tracks.filter((t) => {
    const c = counts.get(t.user.id) ?? 0;
    if (c >= n) return false;
    counts.set(t.user.id, c + 1);
    return true;
  });
}

/**
 * Merges the related lists of several seeds into one ranked list. A track's
 * score is the sum over the seeds that suggested it of the seed's weight,
 * discounted by how far down that seed's list it sat; tracks several seeds
 * agree on get a further bonus, and followed artists a small one. Then
 * duplicates (same ID or same title and artist) are merged, excluded and
 * unplayable tracks dropped, and each artist capped.
 */
export function scoreCandidates(results: SeedResult[], options: ScoreOptions = {}): Scored[] {
  const limit = options.limit ?? 30;
  const perArtist = options.perArtist ?? 2;
  const minFill = options.minFill ?? 8;
  const exclude = new Set(options.exclude ?? []);
  const boost = new Set(options.boostArtists ?? []);
  const seedKeys = new Set<string>(options.excludeKeys ?? []);
  for (const r of results) {
    exclude.add(r.seed.id);
    if (r.track) seedKeys.add(titleKey(r.track));
  }

  interface Acc { track: Track; sum: number; seeds: Set<string>; first: number }
  const byKey = new Map<string, Acc>();
  const keyOfId = new Map<string, string>();
  let order = 0;
  for (const r of results) {
    r.related.forEach((t, rank) => {
      if (!t || !t.id || exclude.has(t.id) || t.streamable === false) return;
      const key = keyOfId.get(t.id) ?? titleKey(t);
      if (seedKeys.has(key)) return;
      keyOfId.set(t.id, key);
      const contribution = r.seed.weight / (1 + 0.12 * rank);
      const acc = byKey.get(key);
      if (!acc) {
        byKey.set(key, { track: t, sum: contribution, seeds: new Set([r.seed.id]), first: order++ });
        return;
      }
      // A seed listing the same song twice (two uploads) counts once, at its best rank.
      if (acc.seeds.has(r.seed.id)) return;
      acc.sum += contribution;
      acc.seeds.add(r.seed.id);
      // Prefer the full upload over a preview of the same song.
      if (acc.track.preview && !t.preview) acc.track = t;
    });
  }

  const scored = [...byKey.values()]
    .map((a) => {
      const agreement = 1 + 0.35 * (a.seeds.size - 1);
      const followed = boost.has(a.track.user.id) ? 1.25 : 1;
      return { track: a.track, score: a.sum * agreement * followed, seeds: [...a.seeds], first: a.first };
    })
    .sort((a, b) => b.score - a.score || a.first - b.first);

  const capped = capPerArtist(dropVersions(scored).map((s) => ({ ...s, user: s.track.user })), perArtist);
  const full = capped.filter((s) => !s.track.preview);
  const previews = capped.filter((s) => s.track.preview);
  const picked = full.length >= Math.min(minFill, limit) ? full : [...full, ...previews.slice(0, Math.min(minFill, limit) - full.length)];
  return picked.slice(0, limit).map(({ track, score, seeds }) => ({ track, score: Math.round(score * 1000) / 1000, seeds }));
}

export interface RecommendationInput {
  results: SeedResult[];
  /** Popular tracks of the artists the user plays most, one list per artist. */
  artistTracks?: { artist: UserSummary; tracks: Track[] }[];
  exclude?: Iterable<string>;
  boostArtists?: Iterable<string>;
}

/** Section IDs this module produces. Home uses them to avoid showing a shelf twice. */
export const FOR_YOU_ID = "for-you";
export const ARTISTS_YOU_PLAY_ID = "artists-you-play";
export const isRecommendationSection = (id: string) => id === FOR_YOU_ID || id === ARTISTS_YOU_PLAY_ID || id.startsWith("because-");

const MIN_SHELF = 4;

/**
 * "Recommended for you" (every seed mixed), "Because you liked <title>" for
 * up to three seeds, and "More from artists you play". Shelves that come out
 * with fewer than 4 tracks are left out.
 */
export function recommendationSections(input: RecommendationInput): Section[] {
  const exclude = [...(input.exclude ?? [])];
  const boostArtists = [...(input.boostArtists ?? [])];
  const sections: Section[] = [];

  const mix = scoreCandidates(input.results, { exclude, boostArtists, limit: 30 });
  if (mix.length >= MIN_SHELF) {
    const n = input.results.length;
    sections.push({
      id: FOR_YOU_ID,
      title: "Recommended for you",
      subtitle: `Picked from ${n} track${n === 1 ? "" : "s"} you like and play`,
      kind: "tracks",
      display: "shelf",
      items: mix.map((s) => s.track),
    });
  }

  // The first tracks of the mix are already on screen; the per-seed shelves skip them.
  const shown = mix.slice(0, 10).map((s) => s.track);
  const shownIds = shown.map((t) => t.id);
  const shownKeys = shown.map(titleKey);
  const likes = input.results.filter((r) => r.track && r.seed.kind === "like");
  const others = input.results.filter((r) => r.track && r.seed.kind !== "like");
  const becauseSeeds = (likes.length >= 2 ? likes : [...likes, ...others]).slice(0, 3);
  for (const r of becauseSeeds) {
    const items = scoreCandidates([r], { exclude: [...exclude, ...shownIds], excludeKeys: shownKeys, boostArtists, limit: 12, minFill: 6 }).map((s) => s.track);
    if (items.length < MIN_SHELF) continue;
    const verb = r.seed.kind === "like" ? "liked" : "played";
    sections.push({ id: `because-${r.seed.id}`, title: `Because you ${verb} ${r.track!.title}`, kind: "tracks", display: "shelf", items });
  }

  if (input.artistTracks?.length) {
    const excluded = new Set(exclude);
    const lists = input.artistTracks.map((a) => a.tracks.filter((t) => t.streamable !== false && !excluded.has(t.id) && !t.preview));
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      for (const list of lists) {
        const t = list[i];
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          merged.push(t);
        }
      }
    }
    const items = capPerArtist(merged, 6).slice(0, 16);
    if (items.length >= MIN_SHELF) {
      const names = input.artistTracks.map((a) => a.artist.username);
      sections.push({ id: ARTISTS_YOU_PLAY_ID, title: "More from artists you play", subtitle: names.join(", "), kind: "tracks", display: "shelf", items });
    }
  }
  return sections;
}

/**
 * The artists that come up most in `tracks` (likes and plays), at least
 * `minCount` times each, most frequent first. `weights` counts some tracks
 * more, such as play counts.
 */
export function topArtists(tracks: Track[], options: { max?: number; minCount?: number; weights?: Map<string, number> } = {}): UserSummary[] {
  const max = options.max ?? 2;
  const minCount = options.minCount ?? 2;
  const counts = new Map<string, { user: UserSummary; n: number; first: number }>();
  tracks.forEach((t, i) => {
    if (!t?.user?.id) return;
    const w = options.weights?.get(t.id) ?? 1;
    const c = counts.get(t.user.id);
    if (c) c.n += w;
    else counts.set(t.user.id, { user: t.user, n: w, first: i });
  });
  return [...counts.values()]
    .filter((c) => c.n >= minCount)
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, max)
    .map((c) => c.user);
}
