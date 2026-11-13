import { ApiError, isUnauthorized, parseApiError } from "./errors";
import type {
  AuthSession, Backend, Comment, FeedItem, Id, NewPlaylistExtras, Page, Playlist, PlaylistPatch, SearchKind, SearchResults,
  Section, SpotifyAccessToken, SpotifyAccountLink, SpotifyLinkProfile, SpotifyList, StreamInfo, Track, User,
} from "./types";
import { isSpotifyTrackId, snapshotsFor, trackSnapshot } from "./snapshot";

/** Spotify entries go as snapshots; SoundCloud entries only need their ID, the server hydrates them. */
function wireTracks(tracks: Track[] | undefined): Array<Track | { id: Id }> | undefined {
  return snapshotsFor(tracks)?.map((t) => (isSpotifyTrackId(t.id) ? t : { id: t.id }));
}

export interface HttpBackendOptions {
  name?: string;
  /** Called when `/me` rejects the token, so the app can forget an expired session. */
  onUnauthorized?: () => void;
}

/** Talks to a REST server that follows BACKEND.md, plus the account routes in docs/hosted-api.md. */
export class HttpBackend implements Backend {
  readonly name: string;
  private baseUrl: string;
  private token: string | undefined;
  private onUnauthorized: (() => void) | undefined;

  constructor(baseUrl: string, token?: string, options: HttpBackendOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token || undefined;
    this.name = options.name ?? "Custom server";
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(method: string, path: string, query?: Record<string, string | null | undefined>, body?: unknown): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null && value !== "") url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw parseApiError(res.status, await res.text().catch(() => ""), url.toString());
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private get<T>(path: string, query?: Record<string, string | null | undefined>) {
    return this.request<T>("GET", path, query);
  }

  async me() {
    try {
      return await this.get<User>("/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // With a token, a 401 means the session expired or was revoked.
        if (this.token && isUnauthorized(err)) this.onUnauthorized?.();
        return null;
      }
      throw err;
    }
  }

  home() { return this.get<Section[]>("/home"); }
  feed(cursor?: string | null) { return this.get<Page<FeedItem>>("/feed", { cursor }); }
  search(q: string) { return this.get<SearchResults>("/search", { q }); }
  searchKind(q: string, kind: SearchKind, cursor?: string | null) {
    return this.get<Page<Track | User | Playlist>>(`/search/${kind}`, { q, cursor });
  }

  track(id: Id) { return this.get<Track>(`/tracks/${encodeURIComponent(id)}`); }
  trackComments(id: Id) { return this.get<Comment[]>(`/tracks/${encodeURIComponent(id)}/comments`); }
  relatedTracks(id: Id) { return this.get<Track[]>(`/tracks/${encodeURIComponent(id)}/related`); }
  stream(track: Track) { return this.get<StreamInfo>(`/tracks/${encodeURIComponent(track.id)}/stream`); }

  playlist(id: Id) { return this.get<Playlist>(`/playlists/${encodeURIComponent(id)}`); }

  user(id: Id) { return this.get<User>(`/users/${encodeURIComponent(id)}`); }
  userTopTracks(id: Id) { return this.get<Track[]>(`/users/${encodeURIComponent(id)}/top-tracks`); }
  userTracks(id: Id, cursor?: string | null) { return this.get<Page<Track>>(`/users/${encodeURIComponent(id)}/tracks`, { cursor }); }
  userPlaylists(id: Id) { return this.get<Playlist[]>(`/users/${encodeURIComponent(id)}/playlists`); }
  userLikes(id: Id, cursor?: string | null) { return this.get<Page<Track>>(`/users/${encodeURIComponent(id)}/likes`, { cursor }); }

  likedTracks(cursor?: string | null) { return this.get<Page<Track>>("/me/likes/tracks", { cursor }); }
  likedPlaylists() { return this.get<Playlist[]>("/me/likes/playlists"); }
  myPlaylists() { return this.get<Playlist[]>("/me/playlists"); }
  following() { return this.get<User[]>("/me/following"); }

  setTrackLiked(id: Id, liked: boolean, track?: Track) {
    const body = liked && track && isSpotifyTrackId(id) ? { track: trackSnapshot(track) } : undefined;
    return this.request<void>(liked ? "PUT" : "DELETE", `/me/likes/tracks/${encodeURIComponent(id)}`, undefined, body);
  }
  setReposted(id: Id, reposted: boolean) {
    return this.request<void>(reposted ? "PUT" : "DELETE", `/me/reposts/tracks/${encodeURIComponent(id)}`);
  }
  setFollowing(id: Id, following: boolean) {
    return this.request<void>(following ? "PUT" : "DELETE", `/me/following/${encodeURIComponent(id)}`);
  }
  postComment(id: Id, body: string, timestamp: number | null) {
    return this.request<Comment>("POST", `/tracks/${encodeURIComponent(id)}/comments`, undefined, { body, timestamp });
  }

  signup(username: string, email: string, password: string) {
    return this.request<AuthSession>("POST", "/auth/signup", undefined, { username, email, password });
  }
  login(login: string, password: string) {
    return this.request<AuthSession>("POST", "/auth/login", undefined, { login, password });
  }
  logout() {
    return this.request<void>("POST", "/auth/logout");
  }
  deleteAccount(password: string) {
    return this.request<void>("DELETE", "/me", undefined, { password });
  }

  createPlaylist(title: string, trackIds: Id[], isPublic: boolean, extras: NewPlaylistExtras = {}) {
    const { tracks, ...rest } = extras;
    return this.request<Playlist>("POST", "/me/playlists", undefined, { title, trackIds, public: isPublic, ...rest, tracks: wireTracks(tracks) });
  }
  updatePlaylist(id: Id, patch: PlaylistPatch) {
    const { tracks, ...rest } = patch;
    return this.request<Playlist>("PATCH", `/me/playlists/${encodeURIComponent(id)}`, undefined, { ...rest, tracks: wireTracks(tracks) });
  }
  deletePlaylist(id: Id) {
    return this.request<void>("DELETE", `/me/playlists/${encodeURIComponent(id)}`);
  }

  addHistory(trackId: Id, track?: Track) {
    const snapshot = track && isSpotifyTrackId(trackId) ? trackSnapshot(track) : undefined;
    return this.request<void>("POST", "/me/history", undefined, { trackId, track: snapshot });
  }
  history(cursor?: string | null) { return this.get<Page<Track>>("/me/history", { cursor }); }

  importSpotify(url: string) { return this.get<SpotifyList>("/import/spotify", { url }); }

  spotifyLink() { return this.get<SpotifyAccountLink>("/me/spotify"); }
  linkSpotify(input: { clientId: string; refreshToken: string; profile?: SpotifyLinkProfile | null }) {
    return this.request<SpotifyAccountLink & SpotifyAccessToken>("PUT", "/me/spotify", undefined, input);
  }
  spotifyToken(force = false) { return this.request<SpotifyAccessToken>("POST", "/me/spotify/token", undefined, { force }); }
  updateSpotifyProfile(profile: SpotifyLinkProfile) { return this.request<SpotifyAccountLink>("PATCH", "/me/spotify", undefined, { profile }); }
  unlinkSpotify() { return this.request<void>("DELETE", "/me/spotify"); }
}
