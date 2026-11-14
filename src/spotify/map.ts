// Spotify Web API objects -> Stratus types. Pure functions with no Vue or DOM
// imports so `node --test` can run them (tests/spotifyMap.test.ts).
// Field notes: since February 2026 dev-mode apps get no `popularity`,
// `followers`, `available_markets` or `label`, and playlists carry `items`
// (each with `item`) instead of `tracks` (each with `track`). Both shapes are read.
import type { Page, Playlist, SpotifyList, Track, User, UserSummary } from "../api/types";

export interface SpImage { url: string; width?: number | null; height?: number | null }
export interface SpArtistRef { id: string | null; name: string; uri?: string; external_urls?: { spotify?: string } }
export interface SpArtist extends SpArtistRef { images?: SpImage[]; followers?: { total: number } | null; genres?: string[] }
export interface SpAlbumRef {
  id: string;
  name: string;
  uri?: string;
  images?: SpImage[];
  release_date?: string | null;
  artists?: SpArtistRef[];
  album_type?: string;
  total_tracks?: number;
  external_urls?: { spotify?: string };
}
export interface SpTrack {
  id: string | null;
  name: string;
  uri?: string | null;
  type?: string;
  duration_ms: number;
  explicit?: boolean;
  is_local?: boolean;
  is_playable?: boolean;
  artists: SpArtistRef[];
  album?: SpAlbumRef | null;
  external_urls?: { spotify?: string };
}
export interface SpPaging<T> { items: T[]; next: string | null; offset?: number; limit?: number; total?: number; cursors?: { after?: string | null; before?: string | null } }
export interface SpAlbum extends SpAlbumRef { tracks?: SpPaging<SpTrack>; genres?: string[] }
export interface SpPlaylistItem { added_at?: string | null; is_local?: boolean; item?: SpTrack | null; track?: SpTrack | null }
export interface SpPlaylist {
  id: string;
  name: string;
  uri?: string;
  description?: string | null;
  images?: SpImage[] | null;
  owner?: { id: string; display_name?: string | null; uri?: string } | null;
  external_urls?: { spotify?: string };
  /** February 2026 shape: only present for playlists the user owns or collaborates on. */
  items?: SpPaging<SpPlaylistItem> | { total?: number; href?: string } | null;
  /** Older shape, still sent by some responses. */
  tracks?: SpPaging<SpPlaylistItem> | { total?: number; href?: string } | null;
}
export interface SpUser { id: string; display_name?: string | null; images?: SpImage[]; product?: string; country?: string; email?: string; external_urls?: { spotify?: string } }

const OPEN = "https://open.spotify.com";

/** The largest image, or null. Spotify lists them widest first, but don't count on it. */
export function largestImage(images: SpImage[] | null | undefined): string | null {
  if (!images?.length) return null;
  let best = images[0];
  for (const img of images) if ((img.width ?? 0) * (img.height ?? 0) > (best.width ?? 0) * (best.height ?? 0)) best = img;
  return best.url ?? null;
}

/** "1981", "1981-12" or "1981-12-04" -> an ISO date string; "" when unknown. */
export function releaseDate(value: string | null | undefined): string {
  if (!value) return "";
  const [y, m = "01", d = "01"] = value.split("-");
  if (!/^\d{4}$/.test(y)) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00.000Z`;
}

/** Spotify playlist descriptions are HTML-escaped and may contain links. */
export function plainDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
  return text || null;
}

const link = (kind: string, id: string | null | undefined, given?: string) => given ?? (id ? `${OPEN}/${kind}/${id}` : null);

export function mapArtistSummary(a: SpArtistRef | undefined, avatarUrl: string | null = null): UserSummary {
  if (!a) return { id: "spotify:artist:unknown", username: "Unknown artist", avatarUrl: null };
  return { id: a.uri ?? (a.id ? `spotify:artist:${a.id}` : `spotify:artist:${encodeURIComponent(a.name)}`), username: a.name, avatarUrl };
}

/** A track's "user" is its first artist; the name shows every artist, as Spotify does. */
function trackArtist(artists: SpArtistRef[]): UserSummary {
  const first = mapArtistSummary(artists[0]);
  return artists.length > 1 ? { ...first, username: artists.map((a) => a.name).join(", ") } : first;
}

export function mapTrack(t: SpTrack, albumFallback?: SpAlbumRef | null): Track {
  const album = t.album ?? albumFallback ?? null;
  const art = largestImage(album?.images);
  const uri = t.uri ?? (t.id ? `spotify:track:${t.id}` : `spotify:local:${encodeURIComponent(t.name)}`);
  return {
    id: uri,
    title: t.name,
    user: trackArtist(t.artists ?? []),
    artworkUrl: art,
    duration: t.duration_ms ?? 0,
    genre: null,
    createdAt: releaseDate(album?.release_date),
    playbackCount: 0,
    likesCount: 0,
    repostsCount: 0,
    commentCount: 0,
    waveform: null,
    permalinkUrl: link("track", t.id, t.external_urls?.spotify),
    streamable: !t.is_local && t.is_playable !== false && !!t.id,
    source: "spotify",
    uri,
    album: album ? { id: album.uri ?? `spotify:album:${album.id}`, title: album.name, artworkUrl: art } : null,
  };
}

export function mapArtist(a: SpArtist): User {
  return {
    ...mapArtistSummary(a, largestImage(a.images)),
    followersCount: a.followers?.total ?? 0,
    followingsCount: 0,
    trackCount: 0,
    description: a.genres?.length ? a.genres.join(", ") : null,
    permalinkUrl: link("artist", a.id, a.external_urls?.spotify),
  };
}

/** The signed-in Spotify user, for playlist owners and the account row. */
export function mapSpotifyUser(u: SpUser): User {
  return {
    id: `spotify:user:${u.id}`,
    username: u.display_name || u.id,
    avatarUrl: largestImage(u.images),
    followersCount: 0,
    followingsCount: 0,
    trackCount: 0,
    permalinkUrl: link("user", u.id, u.external_urls?.spotify),
  };
}

export function mapAlbum(a: SpAlbum): Playlist {
  const tracks = a.tracks?.items?.map((t) => mapTrack(t, a));
  return {
    id: a.uri ?? `spotify:album:${a.id}`,
    title: a.name,
    user: mapArtistSummary(a.artists?.[0]),
    artworkUrl: largestImage(a.images),
    description: null,
    isAlbum: true,
    trackCount: a.total_tracks ?? tracks?.length ?? 0,
    duration: tracks ? tracks.reduce((sum, t) => sum + t.duration, 0) : 0,
    createdAt: releaseDate(a.release_date),
    likesCount: 0,
    tracks,
    permalinkUrl: link("album", a.id, a.external_urls?.spotify),
  };
}

/** Tracks from playlist items, skipping episodes, removed tracks and nulls. */
export function mapPlaylistItems(items: SpPlaylistItem[]): Track[] {
  const out: Track[] = [];
  for (const entry of items) {
    const t = entry.item ?? entry.track;
    if (!t || (t.type && t.type !== "track")) continue;
    out.push(mapTrack(entry.is_local ? { ...t, is_local: true } : t));
  }
  return out;
}

const isPaging = <T>(p: unknown): p is SpPaging<T> => !!p && Array.isArray((p as SpPaging<T>).items);

export function mapPlaylist(p: SpPlaylist): Playlist {
  const list = p.items ?? p.tracks ?? null;
  const tracks = isPaging<SpPlaylistItem>(list) ? mapPlaylistItems(list.items) : undefined;
  return {
    id: p.uri ?? `spotify:playlist:${p.id}`,
    title: p.name,
    user: p.owner
      ? { id: `spotify:user:${p.owner.id}`, username: p.owner.display_name || p.owner.id, avatarUrl: null }
      : { id: "spotify:user:unknown", username: "Spotify", avatarUrl: null },
    artworkUrl: largestImage(p.images),
    description: plainDescription(p.description),
    isAlbum: false,
    trackCount: list?.total ?? tracks?.length ?? 0,
    duration: tracks ? tracks.reduce((sum, t) => sum + t.duration, 0) : 0,
    createdAt: "",
    likesCount: 0,
    tracks,
    permalinkUrl: link("playlist", p.id, p.external_urls?.spotify),
  };
}

/** Offset paging -> a Stratus page whose cursor is the next offset. */
export function mapPage<S, T>(paging: SpPaging<S>, map: (item: S) => T | null): Page<T> {
  const items: T[] = [];
  for (const item of paging.items) {
    const mapped = item == null ? null : map(item);
    if (mapped != null) items.push(mapped);
  }
  const offset = paging.offset ?? 0;
  const next = paging.next ? String(offset + (paging.limit ?? paging.items.length)) : null;
  return { items, next };
}

/**
 * Tracks read by the embed/page reader (the only way to list Spotify-owned
 * `37i9…` playlists and other people's playlists since 2026) as Spotify tracks.
 * Titles and artists are all the reader has; artwork and album are filled in
 * when the track's own page loads.
 */
export function tracksFromSpotifyList(list: SpotifyList): Track[] {
  return list.tracks.map((t, i) => {
    const uri = t.spotifyId ? `spotify:track:${t.spotifyId}` : `spotify:local:${i}`;
    return {
      id: uri,
      title: t.title,
      user: { id: `spotify:artist:${encodeURIComponent(t.artists[0] ?? "unknown")}`, username: t.artists.join(", ") || "Unknown artist", avatarUrl: null },
      artworkUrl: t.artworkUrl ?? null,
      duration: t.durationMs ?? 0,
      createdAt: "",
      playbackCount: 0,
      likesCount: 0,
      repostsCount: 0,
      commentCount: 0,
      waveform: null,
      permalinkUrl: t.spotifyId ? `${OPEN}/track/${t.spotifyId}` : null,
      streamable: !!t.spotifyId,
      source: "spotify",
      uri,
      album: null,
    };
  });
}

/** The playlist itself, from the reader's list. */
export function playlistFromSpotifyList(list: SpotifyList): Playlist {
  const tracks = tracksFromSpotifyList(list);
  return {
    id: `spotify:${list.kind}:${list.id}`,
    title: list.name,
    user: { id: "spotify:user:unknown", username: list.owner ?? "Spotify", avatarUrl: null },
    artworkUrl: list.coverUrl,
    description: list.notice,
    isAlbum: list.kind === "album",
    trackCount: list.total ?? tracks.length,
    duration: tracks.reduce((sum, t) => sum + t.duration, 0),
    createdAt: "",
    likesCount: 0,
    tracks,
    permalinkUrl: list.url,
  };
}
