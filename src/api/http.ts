import type {
  Backend, Comment, FeedItem, Id, Page, Playlist, SearchKind, SearchResults, Section, StreamInfo, Track, User,
} from "./types";

export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`${status} from ${url}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

/** Talks to a REST server that follows the routes in BACKEND.md. */
export class HttpBackend implements Backend {
  readonly name = "HTTP";

  constructor(private baseUrl: string, private token?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
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
    if (!res.ok) throw new HttpError(res.status, url.toString(), await res.text().catch(() => ""));
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private get<T>(path: string, query?: Record<string, string | null | undefined>) {
    return this.request<T>("GET", path, query);
  }

  async me() {
    try {
      return await this.get<User>("/me");
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return null;
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

  setTrackLiked(id: Id, liked: boolean) {
    return this.request<void>(liked ? "PUT" : "DELETE", `/me/likes/tracks/${encodeURIComponent(id)}`);
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
  createPlaylist(title: string, trackIds: Id[], isPublic: boolean) {
    return this.request<Playlist>("POST", "/me/playlists", undefined, { title, trackIds, public: isPublic });
  }
}
