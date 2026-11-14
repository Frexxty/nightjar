// Catalogue routes backed by SoundCloud: search, tracks, users, playlists,
// home and the feed.
import { ApiError, badInput, cursorFromNextHref, intOffset, isScId, notFound, offsetFromCursor, encodeCursor } from "./http.ts";
import type { Env } from "./env.ts";
import { isFullTrack, mapComment, mapPlaylist, mapTrack, mapUser, pickTranscoding, sortComments } from "./map.ts";
import { cachedJson, fetchWaveform, hydrateTracks, resolveTranscoding, scGet } from "./soundcloud.ts";
import type {
  Comment, FeedItem, Page, Playlist, ScCollection, ScComment, ScPlaylist, ScTrack, ScUser, SearchResults, Section, StreamInfo, Track, User,
} from "./types.ts";

export interface Ctx {
  env: Env;
  ctx: ExecutionContext;
}

const TTL = { search: 300, track: 3600, user: 3600, comments: 600, list: 600, home: 1800 };

const q = (s: string) => encodeURIComponent(s);
const withOffset = (path: string, offset: string | null) => (offset ? `${path}&offset=${q(offset)}` : path);

export function checkQuery(raw: string | null): string {
  const query = (raw ?? "").trim();
  if (!query) throw badInput("Add a search query with ?q=.");
  if (query.length > 200) throw badInput("Search queries can be at most 200 characters.");
  return query;
}

export function checkScId(id: string, what = "ID"): string {
  if (!isScId(id)) throw notFound(`No such ${what}.`);
  return id;
}

const fullTracks = (list: ScTrack[] | undefined) => (list ?? []).filter(isFullTrack).map(mapTrack);

// ---------------------------------------------------------------------------
// Search

const SEARCH_PATHS = {
  tracks: "/search/tracks",
  users: "/search/users",
  playlists: "/search/playlists_without_albums",
  albums: "/search/albums",
} as const;
type SearchKind = keyof typeof SEARCH_PATHS;

export async function searchKind(c: Ctx, query: string, kind: string, cursor: string | null, limit = 20): Promise<Page<Track | User | Playlist>> {
  if (!(kind in SEARCH_PATHS)) throw notFound("Search kinds are tracks, users, playlists and albums.");
  const offset = offsetFromCursor(cursor);
  const path = withOffset(`${SEARCH_PATHS[kind as SearchKind]}?q=${q(query)}&limit=${limit}`, offset);
  const res = await scGet<ScCollection<ScTrack & ScUser & ScPlaylist>>(c.env, c.ctx, path, { ttl: TTL.search });
  const items =
    kind === "tracks" ? fullTracks(res.collection)
    : kind === "users" ? res.collection.map(mapUser)
    : res.collection.map((p) => mapPlaylist(p));
  return { items, next: res.collection.length ? cursorFromNextHref(res.next_href) : null };
}

export async function searchAll(c: Ctx, query: string): Promise<SearchResults> {
  const [tracks, users, playlists, albums] = await Promise.all([
    searchKind(c, query, "tracks", null, 20),
    searchKind(c, query, "users", null, 10),
    searchKind(c, query, "playlists", null, 10),
    searchKind(c, query, "albums", null, 10),
  ]);
  return { tracks: tracks as Page<Track>, users: users as Page<User>, playlists: playlists as Page<Playlist>, albums: albums as Page<Playlist> };
}

// ---------------------------------------------------------------------------
// Tracks

export async function scTrack(c: Ctx, id: string, ttl = TTL.track): Promise<ScTrack> {
  const t = await scGet<ScTrack>(c.env, c.ctx, `/tracks/${checkScId(id, "track")}`, { ttl, allow404: true });
  if (!t || !isFullTrack(t)) throw notFound("That track doesn't exist or isn't public.");
  return t;
}

export async function track(c: Ctx, id: string): Promise<Track> {
  const t = await scTrack(c, id);
  const out = mapTrack(t);
  out.waveform = await fetchWaveform(c.ctx, t.waveform_url);
  return out;
}

export async function trackComments(c: Ctx, id: string): Promise<Comment[]> {
  const res = await scGet<ScCollection<ScComment>>(
    c.env, c.ctx, `/tracks/${checkScId(id, "track")}/comments?threaded=0&filter_replies=1&limit=200`, { ttl: TTL.comments, allow404: true },
  );
  if (!res) throw notFound("That track doesn't exist or isn't public.");
  return sortComments(res.collection.map(mapComment));
}

export async function relatedTracks(c: Ctx, id: string, limit = 20): Promise<Track[]> {
  const res = await scGet<ScCollection<ScTrack>>(c.env, c.ctx, `/tracks/${checkScId(id, "track")}/related?limit=${limit}`, { ttl: TTL.track, allow404: true });
  if (!res) throw notFound("That track doesn't exist or isn't public.");
  return fullTracks(res.collection);
}

export async function stream(c: Ctx, id: string): Promise<StreamInfo> {
  // Fresh copy: track_authorization is short-lived, so this one is never cached.
  const t = await scTrack(c, id, 0);
  if (t.policy === "BLOCK" || t.streamable === false) throw new ApiError(403, "not_streamable", "SoundCloud doesn't allow streaming this track here.");
  const tc = pickTranscoding(t.media?.transcodings);
  if (!tc) throw new ApiError(403, "not_streamable", "This track has no stream Nightjar can play.");
  const url = await resolveTranscoding(c.env, tc.url, t.track_authorization);
  const protocol = tc.format.protocol === "progressive" ? "progressive" : "hls";
  return { url, protocol, mimeType: tc.format.mime_type };
}

// ---------------------------------------------------------------------------
// Playlists

/** A SoundCloud playlist or system playlist with every track filled in, in order. */
export async function scPlaylist(c: Ctx, id: string): Promise<Playlist> {
  let p: ScPlaylist | null;
  if (/^soundcloud:system-playlists:[\w:.-]{1,150}$/.test(id)) {
    p = await scGet<ScPlaylist>(c.env, c.ctx, `/system-playlists/${q(id)}`, { ttl: TTL.home, allow404: true });
    // SoundCloud answers {} for system playlists it doesn't know.
    if (p && !p.title) p = null;
  } else {
    p = await scGet<ScPlaylist>(c.env, c.ctx, `/playlists/${checkScId(id, "playlist")}`, { ttl: TTL.track, allow404: true });
  }
  if (!p) throw notFound("That playlist doesn't exist or isn't public.");
  const entries = p.tracks ?? [];
  const missing = entries.filter((t) => !isFullTrack(t)).map((t) => (t as ScTrack).id);
  const hydrated = new Map((missing.length ? await hydrateTracks(c.env, c.ctx, missing) : []).map((t) => [t.id, t]));
  const tracks = entries
    .map((t) => (isFullTrack(t) ? t : hydrated.get((t as ScTrack).id)))
    .filter((t): t is ScTrack => Boolean(t))
    .map(mapTrack);
  return mapPlaylist(p, tracks);
}

// ---------------------------------------------------------------------------
// Users

export async function user(c: Ctx, id: string): Promise<User> {
  const u = await scGet<ScUser>(c.env, c.ctx, `/users/${checkScId(id, "user")}`, { ttl: TTL.user, allow404: true });
  if (!u || !u.username) throw notFound("That user doesn't exist.");
  return mapUser(u);
}

export async function userTopTracks(c: Ctx, id: string): Promise<Track[]> {
  const res = await scGet<ScCollection<ScTrack>>(c.env, c.ctx, `/users/${checkScId(id, "user")}/toptracks?limit=10`, { ttl: TTL.user, allow404: true });
  if (!res) throw notFound("That user doesn't exist.");
  // SoundCloud ignores `limit` here and can send 30.
  return fullTracks(res.collection).slice(0, 10);
}

export async function userTracks(c: Ctx, id: string, cursor: string | null, limit = 20): Promise<Page<Track>> {
  const path = withOffset(`/users/${checkScId(id, "user")}/tracks?limit=${limit}`, offsetFromCursor(cursor));
  const res = await scGet<ScCollection<ScTrack>>(c.env, c.ctx, path, { ttl: TTL.list, allow404: true });
  if (!res) throw notFound("That user doesn't exist.");
  return { items: fullTracks(res.collection), next: res.collection.length ? cursorFromNextHref(res.next_href) : null };
}

export async function userPlaylists(c: Ctx, id: string): Promise<Playlist[]> {
  checkScId(id, "user");
  const [lists, albums] = await Promise.all([
    scGet<ScCollection<ScPlaylist>>(c.env, c.ctx, `/users/${id}/playlists_without_albums?limit=50`, { ttl: TTL.home, allow404: true }),
    scGet<ScCollection<ScPlaylist>>(c.env, c.ctx, `/users/${id}/albums?limit=50`, { ttl: TTL.home, allow404: true }),
  ]);
  if (!lists && !albums) throw notFound("That user doesn't exist.");
  const all = [...(albums?.collection ?? []), ...(lists?.collection ?? [])].map((p) => mapPlaylist(p));
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function userLikes(c: Ctx, id: string, cursor: string | null): Promise<Page<Track>> {
  const path = withOffset(`/users/${checkScId(id, "user")}/likes?limit=24`, offsetFromCursor(cursor));
  const res = await scGet<ScCollection<{ track?: ScTrack }>>(c.env, c.ctx, path, { ttl: TTL.list, allow404: true });
  if (!res) throw notFound("That user doesn't exist.");
  const items = res.collection.map((x) => x.track).filter(isFullTrack).map(mapTrack);
  return { items, next: res.collection.length ? cursorFromNextHref(res.next_href) : null };
}

/** Full users for a list of SoundCloud user IDs, skipping ones that are gone. */
export async function usersById(c: Ctx, ids: string[]): Promise<User[]> {
  const out: (User | null)[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    out.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => user(c, id).catch(() => null)))));
  }
  return out.filter((u): u is User => Boolean(u));
}

// ---------------------------------------------------------------------------
// Feed

const FEED_PAGE = 20;

/**
 * Latest uploads from the given SoundCloud users, newest first. Each user's
 * first 30 tracks are fetched (cached 10 minutes), merged by date, and the
 * cursor is an offset into that merged list.
 */
export async function feed(c: Ctx, followIds: string[], cursor: string | null, pageSize = FEED_PAGE, withWaveforms = true): Promise<Page<FeedItem>> {
  const offset = intOffset(cursor, 5000);
  const lists: ScTrack[][] = [];
  for (let i = 0; i < followIds.length; i += 10) {
    lists.push(...(await Promise.all(followIds.slice(i, i + 10).map((id) =>
      scGet<ScCollection<ScTrack>>(c.env, c.ctx, `/users/${id}/tracks?limit=30`, { ttl: TTL.list, allow404: true })
        .then((r) => r?.collection ?? [])
        .catch(() => [] as ScTrack[]),
    ))));
  }
  const merged = lists.flat().filter(isFullTrack).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const slice = merged.slice(offset, offset + pageSize);
  const items: FeedItem[] = await Promise.all(slice.map(async (t) => {
    const track = mapTrack(t);
    if (withWaveforms) track.waveform = await fetchWaveform(c.ctx, t.waveform_url);
    return { kind: "track" as const, createdAt: track.createdAt, track };
  }));
  const next = offset + pageSize < merged.length ? encodeCursor({ o: offset + pageSize }) : null;
  return { items, next };
}

// ---------------------------------------------------------------------------
// Home

interface Selection {
  urn?: string;
  title?: string;
  items?: { collection?: ScPlaylist[] };
}

const SELECTIONS: [string, string, string][] = [
  ["soundcloud:selections:personalised-curated-global", "curated", "Curated by SoundCloud"],
  ["soundcloud:selections:trending-by-genre-playlists", "trending-genres", "Trending by genre"],
  ["soundcloud:selections:buzzing", "buzzing", "Artists to watch out for"],
];

/** Sections that are the same for everyone. Cached for 30 minutes. */
export function publicHome(c: Ctx): Promise<Section[]> {
  return cachedJson(c.ctx, "home-public-v1", TTL.home, async () => {
    const [charts, mixed] = await Promise.all([
      scGet<ScCollection<{ track?: ScTrack }>>(c.env, c.ctx, "/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&limit=30", { ttl: TTL.home })
        .catch(() => null),
      scGet<ScCollection<Selection>>(c.env, c.ctx, "/mixed-selections?limit=10", { ttl: TTL.home }).catch(() => null),
    ]);
    const sections: Section[] = [];
    const trending = (charts?.collection ?? []).map((x) => x.track).filter(isFullTrack).map(mapTrack);
    if (trending.length) {
      sections.push({ id: "trending", title: "Trending on SoundCloud", subtitle: "All genres, updated through the day", kind: "tracks", display: "shelf", items: trending.slice(0, 20) });
    }
    for (const [urn, id, fallbackTitle] of SELECTIONS) {
      const sel = mixed?.collection.find((s) => s.urn === urn);
      const items = (sel?.items?.collection ?? []).filter((p) => p && p.title).map((p) => mapPlaylist(p));
      if (items.length) sections.push({ id, title: sel?.title || fallbackTitle, kind: "playlists", items });
    }
    const artists = new Map<string, User>();
    for (const x of charts?.collection ?? []) {
      const u = x.track?.user;
      if (u?.username && !artists.has(String(u.id))) artists.set(String(u.id), mapUser(u));
    }
    if (artists.size >= 4) sections.push({ id: "chart-artists", title: "Artists in the charts", kind: "users", items: [...artists.values()].slice(0, 12) });
    return sections;
  });
}

/** "Because you liked X" and "New from artists you follow" for a signed-in account. */
export async function personalHome(c: Ctx, recentLike: string | null, followIds: string[]): Promise<Section[]> {
  const sections: Section[] = [];
  const [liked, fresh] = await Promise.all([
    recentLike
      ? Promise.all([scTrack(c, recentLike), relatedTracks(c, recentLike, 12)]).catch(() => null)
      : Promise.resolve(null),
    followIds.length ? feed(c, followIds, null, 12, false).catch(() => null) : Promise.resolve(null),
  ]);
  if (liked && liked[1].length) {
    sections.push({ id: `because-${recentLike}`, title: `Because you liked ${liked[0].title}`, kind: "tracks", display: "shelf", items: liked[1] });
  }
  const freshTracks = (fresh?.items ?? []).flatMap((i) => (i.kind === "track" ? [i.track] : []));
  if (freshTracks.length) {
    sections.push({ id: "following-new", title: "New from artists you follow", kind: "tracks", display: "list", items: freshTracks });
  }
  return sections;
}
