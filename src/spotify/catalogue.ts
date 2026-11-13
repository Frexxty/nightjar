// The Spotify catalogue behind the same `Backend` interface the views already
// use, so pages dispatch with `catalogueFor(id)` instead of `api.value`.
//
// Endpoints are the ones still open to development-mode apps after Spotify's
// February 2026 changes (docs/spotify.md lists them). Gone and avoided:
// GET /artists/{id}/top-tracks, /recommendations, /browse/*, batch lookups
// (GET /tracks?ids=, /albums?ids=), GET /users/{id}, /playlists/{id}/tracks,
// PUT/DELETE /me/tracks and /me/following (now PUT/DELETE /me/library).
import { api, type Backend, type Comment, type FeedItem, type Id, type Page, type Playlist, type SearchKind, type SearchResults, type Section, type StreamInfo, type Track, type User } from "@/api";
import { useSettings } from "@/stores/settings";
import { useSpotify } from "./auth";
import { spGet, spotifyRequest, SpotifyApiError } from "./api";
import { isSpotifyId, parseSpotifyUri } from "./ids";
import {
  mapAlbum, mapArtist, mapPage, mapPlaylist, mapPlaylistItems, mapSpotifyUser, mapTrack, playlistFromSpotifyList,
  type SpAlbum, type SpAlbumRef, type SpArtist, type SpPaging, type SpPlaylist, type SpPlaylistItem, type SpTrack,
} from "./map";

/** Search answers at most 10 per type since February 2026. */
const SEARCH_LIMIT = 10;
/** Stop paging a playlist after this many tracks. */
const MAX_PLAYLIST_TRACKS = 2000;

function idOf(id: Id, kind: "track" | "artist" | "playlist" | "album" | "user"): string {
  const parsed = parseSpotifyUri(id);
  if (!parsed || parsed.kind !== kind) throw new Error(`Not a Spotify ${kind}: ${id}`);
  return parsed.id;
}

/** Reads a playlist through the embed/page reader (desktop main process, or the backend's /import/spotify). */
async function readList(url: string): Promise<SpotifyList | null> {
  if (window.stratus?.spotify) return window.stratus.spotify.fetchPlaylist(url);
  const backend = api.value;
  if (backend.importSpotify) return backend.importSpotify(url);
  return null;
}

const hasItems = (p: SpPlaylist) => {
  const list = p.items ?? p.tracks;
  return !!list && Array.isArray((list as SpPaging<SpPlaylistItem>).items);
};

export class SpotifyBackend implements Backend {
  readonly name = "Spotify";
  private artists = new Map<string, SpArtist>();

  async me(): Promise<User | null> {
    const spotify = useSpotify();
    if (!spotify.connected) return null;
    return mapSpotifyUser(await spGet("/me"));
  }

  async home(): Promise<Section[]> {
    const loaders: Promise<Section | null>[] = [
      spGet<SpPaging<{ track: SpTrack }>>("/me/player/recently-played", { limit: 30 }).then((p) => {
        const seen = new Set<string>();
        const items = p.items.map((i) => mapTrack(i.track)).filter((t) => !seen.has(t.id) && seen.add(t.id));
        return items.length ? { id: "sp-recent", title: "Recently played", kind: "tracks", items } : null;
      }),
      spGet<SpPaging<SpPlaylist>>("/me/playlists", { limit: 30 }).then((p) => {
        const items = mapPage(p, mapPlaylist).items;
        return items.length ? { id: "sp-playlists", title: "Your playlists", kind: "playlists", items } : null;
      }),
      spGet<SpPaging<SpTrack>>("/me/top/tracks", { limit: 10, time_range: "short_term" }).then((p) => {
        const items = mapPage(p, (t) => mapTrack(t)).items;
        return items.length ? { id: "sp-top", title: "Your top tracks", subtitle: "Last four weeks", kind: "tracks", display: "list", items } : null;
      }),
      spGet<SpPaging<{ album: SpAlbum }>>("/me/albums", { limit: 30 }).then((p) => {
        const items = p.items.map((i) => mapAlbum(i.album));
        return items.length ? { id: "sp-albums", title: "Saved albums", kind: "playlists", items } : null;
      }),
    ];
    const results = await Promise.allSettled(loaders);
    const sections = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    // A missing scope or an empty account still shows what loaded; only a total failure is an error.
    if (!sections.length && failed) throw failed.reason;
    return sections;
  }

  async feed(): Promise<Page<FeedItem>> {
    return { items: [], next: null };
  }

  async search(query: string): Promise<SearchResults> {
    const r = await spGet<{
      tracks?: SpPaging<SpTrack>; artists?: SpPaging<SpArtist>; playlists?: SpPaging<SpPlaylist>; albums?: SpPaging<SpAlbumRef>;
    }>("/search", { q: query, type: "track,artist,playlist,album", limit: SEARCH_LIMIT });
    const empty = { items: [], next: null };
    return {
      tracks: r.tracks ? mapPage(r.tracks, (t) => mapTrack(t)) : empty,
      users: r.artists ? mapPage(r.artists, mapArtist) : empty,
      playlists: r.playlists ? mapPage(r.playlists, mapPlaylist) : empty,
      albums: r.albums ? mapPage(r.albums, mapAlbum) : empty,
    };
  }

  async searchKind(query: string, kind: SearchKind, cursor?: string | null): Promise<Page<Track | User | Playlist>> {
    const type = { tracks: "track", users: "artist", playlists: "playlist", albums: "album" }[kind];
    const r = await spGet<Record<string, SpPaging<never>>>("/search", { q: query, type, limit: SEARCH_LIMIT, offset: cursor ?? 0 });
    const paging = r[`${type}s`];
    if (!paging) return { items: [], next: null };
    const map: (item: never) => Track | User | Playlist = kind === "tracks" ? (t) => mapTrack(t) : kind === "users" ? mapArtist : kind === "albums" ? mapAlbum : mapPlaylist;
    return mapPage(paging, map);
  }

  async track(id: Id): Promise<Track> {
    const [t, liked] = await Promise.all([spGet<SpTrack>(`/tracks/${idOf(id, "track")}`), this.contains([id]).catch(() => null)]);
    const track = mapTrack(t);
    return liked ? { ...track, liked: liked[0] } : track;
  }

  /** Which of these URIs are in the user's library (Liked Songs, saved albums, followed artists). */
  async contains(uris: string[]): Promise<boolean[]> {
    if (!uris.length) return [];
    return spGet<boolean[]>("/me/library/contains", { uris: uris.slice(0, 40).join(",") });
  }

  async trackComments(): Promise<Comment[]> {
    return [];
  }

  /**
   * Spotify's recommendations and artist top tracks are closed to new apps, so
   * "related" is the best search hits for the seed's first two artists.
   */
  async relatedTracks(id: Id): Promise<Track[]> {
    const seed = await spGet<SpTrack>(`/tracks/${idOf(id, "track")}`);
    const lists = await Promise.all(seed.artists.slice(0, 2).map((a) => this.artistHits(a.name, a.id).catch(() => [] as Track[])));
    const seen = new Set([id]);
    const out: Track[] = [];
    for (let i = 0; i < SEARCH_LIMIT; i++) {
      for (const list of lists) {
        const t = list[i];
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
    }
    return out;
  }

  async stream(_track: Track): Promise<StreamInfo> {
    throw new Error("Spotify tracks play through Spotify, not a stream URL.");
  }

  async playlist(id: Id): Promise<Playlist> {
    const parsed = parseSpotifyUri(id);
    if (parsed?.kind === "album") return this.album(parsed.id);
    const pid = idOf(id, "playlist");

    let meta: SpPlaylist | null = null;
    try {
      meta = await spGet<SpPlaylist>(`/playlists/${pid}`, { additional_types: "track" });
    } catch (err) {
      // Spotify-owned playlists (37i9…) answer 404 to apps made since November 2024.
      if (!(err instanceof SpotifyApiError) || (err.status !== 404 && err.status !== 403)) throw err;
    }

    if (meta && hasItems(meta)) {
      const playlist = mapPlaylist(meta);
      const tracks = [...(playlist.tracks ?? [])];
      const first = (meta.items ?? meta.tracks) as SpPaging<SpPlaylistItem>;
      let next = first.next;
      let offset = first.items.length;
      while (next && offset < MAX_PLAYLIST_TRACKS) {
        const page = await spGet<SpPaging<SpPlaylistItem>>(`/playlists/${pid}/items`, { limit: 50, offset, additional_types: "track" });
        tracks.push(...mapPlaylistItems(page.items));
        offset += page.items.length;
        next = page.next && page.items.length ? page.next : null;
      }
      return { ...playlist, tracks, duration: tracks.reduce((sum, t) => sum + t.duration, 0) };
    }

    // Other people's playlists come back without items; read the public page instead.
    const list = await readList(`https://open.spotify.com/playlist/${pid}`).catch((err) => {
      if (meta) return null;
      throw err;
    });
    if (!list) {
      if (!meta) throw new Error("Spotify doesn't let apps read this playlist.");
      return { ...mapPlaylist(meta), description: "Spotify only lets apps list the tracks of your own playlists, and this player can't read the public page." };
    }
    const fromReader = playlistFromSpotifyList(list);
    if (!meta) return fromReader;
    const base = mapPlaylist(meta);
    return { ...fromReader, ...base, tracks: fromReader.tracks, duration: fromReader.duration, trackCount: base.trackCount || fromReader.trackCount };
  }

  private async album(aid: string): Promise<Playlist> {
    const raw = await spGet<SpAlbum>(`/albums/${aid}`);
    const album = mapAlbum(raw);
    const tracks = [...(album.tracks ?? [])];
    let next = raw.tracks?.next ?? null;
    while (next && tracks.length < MAX_PLAYLIST_TRACKS) {
      const page = await spGet<SpPaging<SpTrack>>(`/albums/${aid}/tracks`, { limit: 50, offset: tracks.length });
      tracks.push(...page.items.map((t) => mapTrack(t, raw)));
      next = page.next && page.items.length ? page.next : null;
    }
    return { ...album, tracks, duration: tracks.reduce((sum, t) => sum + t.duration, 0) };
  }

  /**
   * Artists by URI, or by name for tracks that came from the page reader
   * ("spotify:artist:<url-encoded name>"), which knows names but not IDs.
   */
  private async resolveArtist(id: Id): Promise<SpArtist> {
    const cached = this.artists.get(id);
    if (cached) return cached;
    const parsed = parseSpotifyUri(id);
    let artist: SpArtist | undefined;
    if (parsed?.kind === "artist") artist = await spGet<SpArtist>(`/artists/${parsed.id}`);
    else if (id.startsWith("spotify:artist:")) {
      const name = decodeURIComponent(id.slice("spotify:artist:".length));
      const r = await spGet<{ artists: SpPaging<SpArtist> }>("/search", { q: name, type: "artist", limit: 1 });
      artist = r.artists.items[0];
      if (!artist) throw new Error(`Couldn't find "${name}" on Spotify.`);
    }
    if (!artist) throw new Error(`Not a Spotify artist: ${id}`);
    this.artists.set(id, artist);
    return artist;
  }

  /** The artist's best search hits, standing in for the removed top-tracks endpoint. */
  private async artistHits(name: string, artistId: string | null): Promise<Track[]> {
    const r = await spGet<{ tracks: SpPaging<SpTrack> }>("/search", { q: `artist:"${name.replace(/"/g, "")}"`, type: "track", limit: SEARCH_LIMIT });
    const items = r.tracks.items.filter((t) => t && (!artistId || t.artists.some((a) => a.id === artistId)));
    return items.map((t) => mapTrack(t));
  }

  async user(id: Id): Promise<User> {
    const parsed = parseSpotifyUri(id);
    if (parsed?.kind === "user") {
      const profile = useSpotify().profile;
      if (profile && profile.id === parsed.id) return mapSpotifyUser(await spGet("/me"));
      throw new Error("Spotify only shares your own profile with apps, not other people's.");
    }
    return mapArtist(await this.resolveArtist(id));
  }

  async userTopTracks(id: Id): Promise<Track[]> {
    if (parseSpotifyUri(id)?.kind === "user") return [];
    const artist = await this.resolveArtist(id);
    return this.artistHits(artist.name, artist.id);
  }

  /** An artist's tracks: their releases five at a time, newest first. */
  async userTracks(id: Id, cursor?: string | null): Promise<Page<Track>> {
    if (parseSpotifyUri(id)?.kind === "user") return { items: [], next: null };
    const artist = await this.resolveArtist(id);
    const offset = Number(cursor ?? 0);
    const page = await spGet<SpPaging<SpAlbumRef>>(`/artists/${artist.id}/albums`, { include_groups: "album,single", limit: 5, offset });
    const albums = await Promise.all(page.items.map((a) => spGet<SpAlbum>(`/albums/${a.id}`).catch(() => null)));
    const items = albums.flatMap((a) => (a?.tracks?.items ?? []).filter((t) => t.artists.some((x) => x.id === artist.id)).map((t) => mapTrack(t, a)));
    return { items, next: page.next ? String(offset + page.items.length) : null };
  }

  async userPlaylists(id: Id): Promise<Playlist[]> {
    const parsed = parseSpotifyUri(id);
    if (parsed?.kind === "user") return (await this.myPlaylists()).filter((p) => p.user.id === id);
    const artist = await this.resolveArtist(id);
    const page = await spGet<SpPaging<SpAlbumRef>>(`/artists/${artist.id}/albums`, { include_groups: "album,single,compilation", limit: 50 });
    return page.items.map(mapAlbum);
  }

  async userLikes(): Promise<Page<Track>> {
    return { items: [], next: null };
  }

  async likedTracks(cursor?: string | null): Promise<Page<Track>> {
    const page = await spGet<SpPaging<{ track: SpTrack }>>("/me/tracks", { limit: 50, offset: cursor ?? 0 });
    return mapPage(page, (i) => (i.track ? { ...mapTrack(i.track), liked: true } : null));
  }

  /** Saved albums. Followed playlists are already in `myPlaylists`. */
  async likedPlaylists(): Promise<Playlist[]> {
    const page = await spGet<SpPaging<{ album: SpAlbum }>>("/me/albums", { limit: 50 });
    return page.items.map((i) => ({ ...mapAlbum(i.album), tracks: undefined }));
  }

  async myPlaylists(): Promise<Playlist[]> {
    const out: Playlist[] = [];
    let offset = 0;
    for (;;) {
      const page = await spGet<SpPaging<SpPlaylist>>("/me/playlists", { limit: 50, offset });
      out.push(...mapPage(page, mapPlaylist).items);
      offset += page.items.length;
      if (!page.next || !page.items.length || offset >= 500) return out;
    }
  }

  async following(): Promise<User[]> {
    const r = await spGet<{ artists: SpPaging<SpArtist> }>("/me/following", { type: "artist", limit: 50 });
    return r.artists.items.map((a) => ({ ...mapArtist(a), following: true }));
  }

  setTrackLiked(id: Id, liked: boolean): Promise<void> {
    return spotifyRequest<void>(liked ? "PUT" : "DELETE", "/me/library", { query: { uris: id } });
  }

  async setReposted(): Promise<void> {
    throw new Error("Spotify doesn't have reposts.");
  }

  setFollowing(id: Id, following: boolean): Promise<void> {
    return spotifyRequest<void>(following ? "PUT" : "DELETE", "/me/library", { query: { uris: id } });
  }
}

export const spotifyBackend = new SpotifyBackend();

/** The backend that serves `id`: Spotify for "spotify:" IDs, otherwise the active Stratus backend. */
export function catalogueFor(id: Id | null | undefined): Backend {
  return isSpotifyId(id) ? spotifyBackend : api.value;
}

/** The backend for pages without an ID (Home, Search, Likes), following Settings > Music source. */
export function sourceCatalogue(): Backend {
  return useSettings().musicSource === "spotify" ? spotifyBackend : api.value;
}

