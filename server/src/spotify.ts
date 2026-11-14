// Reads public Spotify playlists and albums without an account or API key.
// Ported from electron/spotify.cjs (embed page) and electron/spotify-page.cjs
// (pathfinder replay). Keep the parsing in step with those files; the desktop
// tests in tests/spotify*.test.mjs cover the same fixtures.
//
// Nothing here needs the Workers runtime. The Browser Rendering capture lives
// in spotify-browser.ts and is passed in as `fetchFull`.
import type { SpotifyList, SpotifyListTrack } from "./types.ts";

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const EMBED_CAP = 100;
const EMBED_TIMEOUT_MS = 15000;

export class ImportError extends Error {}

export interface SpotifyRef {
  kind: "playlist" | "album";
  id: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Accepts open.spotify.com links (with ?si=, /intl-xx/, /embed/), spotify: URIs and bare playlist IDs. */
export function parseSpotifyRef(input: unknown): SpotifyRef {
  const text = String(input ?? "").trim();
  if (!text) throw new ImportError("Paste a Spotify playlist or album link.");
  if (text.length > 500) throw new ImportError("That link is too long.");

  const uri = text.match(/^spotify:(playlist|album):([A-Za-z0-9]{22})$/);
  if (uri) return { kind: uri[1] as SpotifyRef["kind"], id: uri[2] };
  if (/^spotify:user:[^:]+:playlist:[A-Za-z0-9]{22}$/.test(text)) return { kind: "playlist", id: text.slice(-22) };
  if (/^[A-Za-z0-9]{22}$/.test(text)) return { kind: "playlist", id: text };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ImportError("That doesn't look like a Spotify link.");
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname) && url.hostname !== "spotify.link") {
    throw new ImportError("That isn't a Spotify link. It should start with https://open.spotify.com/.");
  }
  if (url.hostname === "spotify.link") {
    throw new ImportError("Short spotify.link URLs aren't supported. Open it in a browser and copy the full open.spotify.com address.");
  }
  const m = url.pathname.match(/\/(playlist|album)\/([A-Za-z0-9]{22})(?:\/|$)/);
  if (m) return { kind: m[1] as SpotifyRef["kind"], id: m[2] };
  if (/\/(track|artist|show|episode)\//.test(url.pathname)) {
    throw new ImportError("That link is to a single track, artist or podcast. Use a playlist or album link.");
  }
  throw new ImportError("Couldn't find a playlist or album ID in that link.");
}

type Source = { url?: string; width?: number | null };
const biggest = (sources: unknown): string | null =>
  [...(Array.isArray(sources) ? (sources as Source[]) : [])]
    .filter((s) => s && s.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;

/**
 * The embed joins artists with ", " (comma + no-break space), while a comma
 * inside a name ("Tyler, The Creator") is followed by a normal space. Split on
 * the joiner only; fall back to any comma for older markup.
 */
export function splitArtists(subtitle: unknown): string[] {
  const text = String(subtitle ?? "");
  const parts = text.includes(", ") ? text.split(", ") : text.split(/,\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

export interface EmbedList {
  kind: "playlist" | "album";
  name: string;
  owner: string | null;
  coverUrl: string | null;
  tracks: SpotifyListTrack[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseEmbedHtml(html: string): EmbedList {
  const m = String(html).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new ImportError("Spotify's embed page didn't include any data. Spotify may have changed it.");
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new ImportError("Couldn't read the data on Spotify's embed page.");
  }
  const props = data?.props?.pageProps;
  if (props?.status === 404) throw new ImportError("Spotify couldn't find that list. Check the link, and make sure the playlist is public.");
  const entity = props?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new ImportError("Spotify's embed page didn't include a track list. The playlist may be private.");
  }
  const tracks: SpotifyListTrack[] = entity.trackList
    .filter((t: any) => t && (t.entityType ?? "track") === "track" && t.title)
    .map((t: any) => ({
      spotifyId: typeof t.uri === "string" && t.uri.startsWith("spotify:track:") ? t.uri.slice(14) : null,
      title: String(t.title),
      artists: splitArtists(t.subtitle),
      durationMs: typeof t.duration === "number" ? t.duration : null,
      explicit: Boolean(t.isExplicit),
    }));
  return {
    kind: entity.type === "album" ? "album" : "playlist",
    name: entity.name ?? entity.title ?? "Untitled",
    owner: entity.subtitle ?? null,
    coverUrl: biggest(entity.coverArt?.sources) ?? biggest(entity.visualIdentity?.image),
    tracks,
  };
}

export async function fetchEmbed(ref: SpotifyRef, fetchImpl: FetchLike): Promise<EmbedList> {
  let res: Response;
  try {
    res = await fetchImpl(`https://open.spotify.com/embed/${ref.kind}/${ref.id}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en" },
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new ImportError("Spotify took too long to answer. Try again.");
    throw new ImportError(`Couldn't reach Spotify. (${e.message})`);
  }
  if (res.status === 404) throw new ImportError("Spotify couldn't find that list. Check the link, and make sure the playlist is public.");
  if (!res.ok) throw new ImportError(`Spotify answered ${res.status}. Try again in a minute.`);
  return parseEmbedHtml(await res.text());
}

// ---------------------------------------------------------------------------
// Pathfinder (Spotify's internal GraphQL API), used for lists over 100 tracks.

const PATHFINDER = /^https:\/\/api-partner\.spotify\.com\/pathfinder\//;
const PAGE_LIMIT = { playlist: 100, album: 50 } as const;
const PAGE_DELAY_MS = 150;
const REPLAY_HEADERS = new Set([
  "accept", "accept-language", "app-platform", "authorization", "client-token", "content-type",
  "spotify-app-version", "user-agent",
]);

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | null;
}

export const isPathfinderUrl = (url: string) => PATHFINDER.test(String(url));

export function parsePathfinderRequest({ url, method, postData }: CapturedRequest) {
  if (!isPathfinderUrl(url)) return null;
  try {
    if (String(method).toUpperCase() === "GET") {
      const q = new URL(url).searchParams;
      return {
        operationName: q.get("operationName"),
        variables: JSON.parse(q.get("variables") || "{}"),
        extensions: JSON.parse(q.get("extensions") || "{}"),
      };
    }
    const body = JSON.parse(postData || "{}");
    return { operationName: body.operationName ?? null, variables: body.variables ?? {}, extensions: body.extensions ?? {} };
  } catch {
    return null;
  }
}

export function replayHeaders(headers: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const k = key.toLowerCase();
    if (REPLAY_HEADERS.has(k) && value != null) out[k] = String(value);
  }
  return out;
}

export function buildPageRequest(captured: CapturedRequest, offset: number, limit: number) {
  const parsed = parsePathfinderRequest(captured);
  if (!parsed) throw new Error("captured request is not a pathfinder query");
  const variables = { ...parsed.variables, offset, limit };
  const headers = replayHeaders(captured.headers);
  if (String(captured.method).toUpperCase() === "GET") {
    const url = new URL(captured.url);
    url.searchParams.set("variables", JSON.stringify(variables));
    return { url: url.toString(), method: "GET", headers, body: undefined as string | undefined };
  }
  const body = { ...JSON.parse(captured.postData || "{}"), variables };
  return { url: captured.url, method: "POST", headers, body: JSON.stringify(body) };
}

const artistNames = (artists: any): string[] => (artists?.items ?? []).map((a: any) => a?.profile?.name).filter(Boolean);

function trackFrom(data: any): SpotifyListTrack | null {
  if (!data || typeof data !== "object" || typeof data.name !== "string" || !data.name) return null;
  const uri = typeof data.uri === "string" ? data.uri : "";
  if (data.__typename && data.__typename !== "Track" && !/^spotify:(track|local):/.test(uri)) return null;
  const ms = data.trackDuration?.totalMilliseconds ?? data.duration?.totalMilliseconds;
  return {
    spotifyId: uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : null,
    title: data.name,
    artists: artistNames(data.artists),
    durationMs: typeof ms === "number" ? ms : null,
    explicit: data.contentRating?.label === "EXPLICIT",
    // Playlist items carry their album's cover; album items don't (the album cover is theirs).
    artworkUrl: biggest(data.albumOfTrack?.coverArt?.sources),
  };
}

export interface ListPage {
  kind: "playlist" | "album";
  name: string | null;
  owner: string | null;
  coverUrl: string | null;
  total: number | null;
  offset: number | null;
  itemCount: number;
  tracks: SpotifyListTrack[];
}

export function parseListPage(json: any, expectedUri?: string): ListPage | null {
  const data = json?.data;
  if (!data || typeof data !== "object") return null;

  const playlist = data.playlistV2;
  if (playlist && playlist.content && Array.isArray(playlist.content.items)) {
    if (expectedUri && playlist.uri && playlist.uri !== expectedUri) return null;
    const items = playlist.content.items;
    return {
      kind: "playlist",
      name: typeof playlist.name === "string" ? playlist.name : null,
      owner: playlist.ownerV2?.data?.name ?? null,
      coverUrl: biggest(playlist.images?.items?.[0]?.sources),
      total: Number.isFinite(playlist.content.totalCount) ? playlist.content.totalCount : null,
      offset: playlist.content.pagingInfo?.offset ?? null,
      itemCount: items.length,
      tracks: items.map((it: any) => trackFrom(it?.itemV2?.data)).filter(Boolean),
    };
  }

  const album = data.albumUnion;
  if (album && album.tracksV2 && Array.isArray(album.tracksV2.items)) {
    if (expectedUri && album.uri && album.uri !== expectedUri) return null;
    const items = album.tracksV2.items;
    return {
      kind: "album",
      name: typeof album.name === "string" ? album.name : null,
      owner: artistNames(album.artists).join(", ") || null,
      coverUrl: biggest(album.coverArt?.sources),
      total: Number.isFinite(album.tracksV2.totalCount) ? album.tracksV2.totalCount : null,
      offset: null,
      itemCount: items.length,
      tracks: items.map((it: any) => trackFrom(it?.track ?? it?.itemV2?.data)).filter(Boolean),
    };
  }
  return null;
}

export function pathfinderProblem(json: any): string | null {
  const p = json?.data?.playlistV2 ?? json?.data?.albumUnion;
  if (p?.__typename === "NotFound") return "Spotify says this list doesn't exist or isn't public";
  if (Array.isArray(json?.errors) && json.errors.length) return `Spotify returned an error: ${String(json.errors[0]?.message ?? "unknown").slice(0, 120)}`;
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pages through the rest of a list by replaying the captured request with a growing offset. */
export async function collectRemaining(opts: {
  captured: CapturedRequest;
  first: ListPage;
  expectedUri: string;
  fetchImpl: FetchLike;
  deadline: number;
  log?: (msg: string) => void;
}) {
  const { captured, first, expectedUri, fetchImpl, deadline, log = () => {} } = opts;
  const tracks = [...first.tracks];
  const total = first.total;
  const limit = PAGE_LIMIT[first.kind] ?? 100;
  let offset = (first.offset ?? 0) + first.itemCount;
  let stopReason: string | null = null;

  while (total != null && offset < total) {
    if (Date.now() > deadline) {
      stopReason = "it took too long";
      break;
    }
    await sleep(PAGE_DELAY_MS);
    const req = buildPageRequest(captured, offset, limit);
    let body: unknown;
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
      if (res.status === 401 || res.status === 403) {
        stopReason = "Spotify's anonymous session expired";
        break;
      }
      if (!res.ok) {
        stopReason = `Spotify answered ${res.status}`;
        break;
      }
      body = await res.json();
    } catch (err) {
      stopReason = `a request failed (${(err as Error).message})`;
      break;
    }
    const page = parseListPage(body, expectedUri);
    if (!page) {
      stopReason = pathfinderProblem(body) ?? "a page came back in a shape Stratus doesn't recognise";
      break;
    }
    if (!page.itemCount) break;
    tracks.push(...page.tracks);
    offset += page.itemCount;
  }
  if (stopReason) log(`stopped at ${offset}/${total}: ${stopReason}`);
  return { tracks, stopReason, reached: offset };
}

export interface FullList {
  kind?: "playlist" | "album";
  name?: string | null;
  owner?: string | null;
  coverUrl?: string | null;
  total: number | null;
  tracks: SpotifyListTrack[];
  truncated: boolean;
  notice?: string | null;
}

/**
 * Embed first; the full page only when the embed hit its cap or failed. Never
 * throws for a partial result: it returns the embed's tracks with `truncated: true`.
 * `fetchFull` is optional and returns null when it isn't available.
 */
export async function fetchSpotifyList(
  input: unknown,
  deps: { fetchImpl?: FetchLike; fetchFull?: ((ref: SpotifyRef) => Promise<FullList | null>) | null; log?: (msg: string) => void } = {},
): Promise<SpotifyList> {
  const { fetchImpl = (u, i) => fetch(u, i), fetchFull = null, log = () => {} } = deps;
  const ref = parseSpotifyRef(input);
  const base = { id: ref.id, kind: ref.kind, url: `https://open.spotify.com/${ref.kind}/${ref.id}` };

  let embed: EmbedList | null = null;
  let embedError: unknown = null;
  try {
    embed = await fetchEmbed(ref, fetchImpl);
  } catch (err) {
    embedError = err;
    log(`embed failed: ${(err as Error).message}`);
  }

  if (embed && embed.tracks.length < EMBED_CAP) {
    return { ...base, ...embed, total: embed.tracks.length, truncated: false, source: "embed", notice: null };
  }

  let fullFailure: string | null = null;
  if (fetchFull) {
    try {
      const full = await fetchFull(ref);
      if (full) {
        const worseThanEmbed = full.truncated && embed && embed.tracks.length >= full.tracks.length;
        if (worseThanEmbed) log(`page capture stopped at ${full.tracks.length}; keeping the embed's ${embed!.tracks.length}`);
        if (full.tracks.length && !worseThanEmbed) {
          return {
            ...base,
            kind: full.kind ?? ref.kind,
            name: full.name ?? embed?.name ?? "Untitled",
            owner: full.owner ?? embed?.owner ?? null,
            coverUrl: full.coverUrl ?? embed?.coverUrl ?? null,
            total: full.total ?? full.tracks.length,
            tracks: full.tracks,
            truncated: full.truncated,
            source: "page",
            notice: full.notice ?? null,
          };
        }
        if (!full.tracks.length) fullFailure = "the full page returned no tracks";
      }
    } catch (err) {
      fullFailure = (err as Error).message;
      log(`page capture failed: ${fullFailure}`);
    }
  }

  if (embed) {
    return {
      ...base,
      ...embed,
      total: null,
      truncated: true,
      source: "embed",
      notice: `Spotify only gave the first ${embed.tracks.length} tracks. To import the rest, use "Paste a track list" with a CSV from Exportify.`,
    };
  }
  throw embedError ?? new ImportError("Couldn't read that list from Spotify.");
}
