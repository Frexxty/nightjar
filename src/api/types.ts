// The contract between the UI and whatever serves SoundCloud data.
// Implement `Backend` (or serve the REST routes in BACKEND.md) and the UI works unchanged.

export type Id = string;

export interface UserSummary {
  id: Id;
  username: string;
  avatarUrl: string | null;
  verified?: boolean;
}

export interface User extends UserSummary {
  bannerUrl?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  followersCount: number;
  followingsCount: number;
  trackCount: number;
  playlistCount?: number;
  permalinkUrl?: string | null;
  following?: boolean;
  /** Only on the signed-in account, and only if the backend shares it. */
  email?: string | null;
}

export interface Track {
  id: Id;
  title: string;
  user: UserSummary;
  artworkUrl: string | null;
  /** Milliseconds. */
  duration: number;
  genre?: string | null;
  tags?: string[];
  description?: string | null;
  createdAt: string;
  playbackCount: number;
  likesCount: number;
  repostsCount: number;
  commentCount: number;
  /** Peak samples normalized to 0..1, any length. The UI resamples. */
  waveform?: number[] | null;
  permalinkUrl?: string | null;
  /** False for tracks the backend can't stream (Go+ only, region blocked, etc). */
  streamable: boolean;
  /** True when only a 30-second preview can be played (SoundCloud Go+ tracks). */
  preview?: boolean;
  /** Where the audio comes from. Missing means "soundcloud". See docs/spotify.md. */
  source?: "soundcloud" | "spotify";
  /** Spotify URI for Spotify tracks, e.g. "spotify:track:…". */
  uri?: string | null;
  album?: { id: Id; title: string; artworkUrl: string | null } | null;
  liked?: boolean;
  reposted?: boolean;
}

export interface Playlist {
  id: Id;
  title: string;
  user: UserSummary;
  artworkUrl: string | null;
  description?: string | null;
  isAlbum: boolean;
  trackCount: number;
  /** Milliseconds. */
  duration: number;
  createdAt: string;
  likesCount: number;
  /** Present on detail responses, may be omitted in lists. */
  tracks?: Track[];
  permalinkUrl?: string | null;
  /** Playlists on the signed-in account: whether other people can open it. */
  public?: boolean;
}

export interface Comment {
  id: Id;
  user: UserSummary;
  body: string;
  /** Position in the track in milliseconds, or null for comments not pinned to a time. */
  timestamp: number | null;
  createdAt: string;
}

export type FeedItem =
  | { kind: "track"; createdAt: string; track: Track; repostedBy?: UserSummary }
  | { kind: "playlist"; createdAt: string; playlist: Playlist; repostedBy?: UserSummary };

export type Section =
  | { id: string; title: string; subtitle?: string; kind: "tracks"; display?: "shelf" | "list"; items: Track[] }
  | { id: string; title: string; subtitle?: string; kind: "playlists"; items: Playlist[] }
  | { id: string; title: string; subtitle?: string; kind: "users"; items: User[] };

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when there are no more. */
  next: string | null;
}

export interface StreamInfo {
  url: string;
  /** "hls" plays through hls.js, "progressive" sets the URL on an <audio> element. */
  protocol: "progressive" | "hls";
  mimeType?: string;
}

export type SearchKind = "tracks" | "users" | "playlists" | "albums";

export interface SearchResults {
  tracks: Page<Track>;
  users: Page<User>;
  playlists: Page<Playlist>;
  albums: Page<Playlist>;
}

export interface Backend {
  readonly name: string;

  me(): Promise<User | null>;
  home(): Promise<Section[]>;
  feed(cursor?: string | null): Promise<Page<FeedItem>>;
  search(query: string, cursor?: string | null): Promise<SearchResults>;
  searchKind(query: string, kind: SearchKind, cursor?: string | null): Promise<Page<Track | User | Playlist>>;

  track(id: Id): Promise<Track>;
  trackComments(id: Id): Promise<Comment[]>;
  relatedTracks(id: Id): Promise<Track[]>;
  stream(track: Track): Promise<StreamInfo>;

  playlist(id: Id): Promise<Playlist>;

  user(id: Id): Promise<User>;
  userTopTracks(id: Id): Promise<Track[]>;
  userTracks(id: Id, cursor?: string | null): Promise<Page<Track>>;
  userPlaylists(id: Id): Promise<Playlist[]>;
  userLikes(id: Id, cursor?: string | null): Promise<Page<Track>>;

  likedTracks(cursor?: string | null): Promise<Page<Track>>;
  likedPlaylists(): Promise<Playlist[]>;
  myPlaylists(): Promise<Playlist[]>;
  following(): Promise<User[]>;

  /** `track` is the snapshot a server stores for Spotify IDs (docs/spotify.md); SoundCloud backends can ignore it. */
  setTrackLiked(id: Id, liked: boolean, track?: Track): Promise<void>;
  setReposted(id: Id, reposted: boolean): Promise<void>;
  setFollowing(id: Id, following: boolean): Promise<void>;
  /** Backends may answer 501 `not_supported`; the comment box then hides itself for that backend. */
  postComment?(id: Id, body: string, timestamp: number | null): Promise<Comment>;

  // Everything below is optional. The UI hides what a backend leaves out.

  /** Accounts (docs/hosted-api.md). The UI keeps the returned token and rebuilds the backend with it. */
  signup?(username: string, email: string, password: string): Promise<AuthSession>;
  /** `login` is a username or an email address. */
  login?(login: string, password: string): Promise<AuthSession>;
  logout?(): Promise<void>;
  deleteAccount?(password: string): Promise<void>;

  /** Creates a playlist on the user's account. The import page offers "Save to my library" only when it exists. */
  createPlaylist?(title: string, trackIds: Id[], isPublic: boolean, extras?: NewPlaylistExtras): Promise<Playlist>;
  updatePlaylist?(id: Id, patch: PlaylistPatch): Promise<Playlist>;
  deletePlaylist?(id: Id): Promise<void>;

  /**
   * Personal shelves: "Recommended for you" (id `for-you`), "Because you liked …"
   * (`because-<id>`) and "More from artists you play" (`artists-you-play`).
   * Signed out it may return trending tracks instead. Home shows these first.
   */
  recommendations?(): Promise<Section[]>;

  /** Records a play. Called fire and forget. `track` is a snapshot, sent for Spotify IDs (docs/spotify.md). */
  addHistory?(trackId: Id, track?: Track): Promise<void>;
  /** Listening history, most recent first, one entry per track. */
  history?(cursor?: string | null): Promise<Page<Track>>;

  /** Reads a Spotify playlist or album server-side, for browsers that can't read Spotify pages themselves. */
  importSpotify?(url: string): Promise<SpotifyList>;

  // Spotify sign-in kept in the account, shared by all its devices (docs/hosted-api.md).
  spotifyLink?(): Promise<SpotifyAccountLink>;
  linkSpotify?(input: { clientId: string; refreshToken: string; profile?: SpotifyLinkProfile | null }): Promise<SpotifyAccountLink & SpotifyAccessToken>;
  spotifyToken?(force?: boolean): Promise<SpotifyAccessToken>;
  updateSpotifyProfile?(profile: SpotifyLinkProfile): Promise<SpotifyAccountLink>;
  unlinkSpotify?(): Promise<void>;
}

export interface SpotifyLinkProfile {
  id: string;
  displayName: string;
  product: string | null;
  country: string | null;
  avatarUrl: string | null;
}

/** Whether the account holds a Spotify sign-in. Never carries tokens. */
export type SpotifyAccountLink =
  | { connected: false }
  | { connected: true; clientId: string; scope: string; profile: SpotifyLinkProfile | null; updatedAt: string };

export interface SpotifyAccessToken {
  accessToken: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** A Spotify track as read from a playlist or album page. */
export interface SpotifyListTrack {
  /** Null for local files in a playlist. */
  spotifyId: string | null;
  title: string;
  artists: string[];
  durationMs: number | null;
  explicit: boolean;
  /** The track's own cover. Only the full-page reader has it; embed lists leave it out. */
  artworkUrl?: string | null;
}

/** A Spotify playlist or album, from the desktop app's reader or `GET /import/spotify`. */
export interface SpotifyList {
  id: string;
  kind: "playlist" | "album";
  url: string;
  name: string;
  owner: string | null;
  coverUrl: string | null;
  /** Track count Spotify reports, or null when only the first 100 could be read. */
  total: number | null;
  /** True when `tracks` is missing part of the list. */
  truncated: boolean;
  /** "embed": the 100-track embed page. "page": the full web page. */
  source: "embed" | "page";
  /** Why the list is incomplete, in plain words. */
  notice: string | null;
  tracks: SpotifyListTrack[];
}

/** What signing up or in returns. */
export interface AuthSession {
  token: string;
  user: User;
}

export interface PlaylistPatch {
  title?: string;
  description?: string | null;
  public?: boolean;
  /** Replaces the whole track order. */
  trackIds?: Id[];
  /**
   * The same list as full tracks. Backends that store Spotify snapshots
   * (docs/spotify.md) send them when the list holds any Spotify track.
   */
  tracks?: Track[];
}

export interface NewPlaylistExtras {
  description?: string;
  /** Where the tracks came from, such as a Spotify link. */
  sourceUrl?: string;
  /** The tracks behind `trackIds`, for Spotify snapshots. See `PlaylistPatch.tracks`. */
  tracks?: Track[];
}
