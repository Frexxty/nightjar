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

  setTrackLiked(id: Id, liked: boolean): Promise<void>;
  setReposted(id: Id, reposted: boolean): Promise<void>;
  setFollowing(id: Id, following: boolean): Promise<void>;
  postComment?(id: Id, body: string, timestamp: number | null): Promise<Comment>;
  /** Creates a playlist on the user's account. Optional; the import page offers "Save to SoundCloud" only when it exists. */
  createPlaylist?(title: string, trackIds: Id[], isPublic: boolean): Promise<Playlist>;
}
