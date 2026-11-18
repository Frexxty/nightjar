// Response shapes. These mirror src/api/types.ts in the app field for field;
// keep the two in sync.

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
  duration: number;
  genre?: string | null;
  tags?: string[];
  description?: string | null;
  createdAt: string;
  playbackCount: number;
  likesCount: number;
  repostsCount: number;
  commentCount: number;
  waveform?: number[] | null;
  permalinkUrl?: string | null;
  streamable: boolean;
  preview?: boolean;
  /** Missing means "soundcloud". Spotify tracks are stored snapshots (docs/spotify.md). */
  source?: "soundcloud" | "spotify";
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
  duration: number;
  createdAt: string;
  likesCount: number;
  tracks?: Track[];
  permalinkUrl?: string | null;
  /** Account playlists only: whether people other than the owner can open it. */
  public?: boolean;
}

export interface Comment {
  id: Id;
  user: UserSummary;
  body: string;
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
  next: string | null;
}

export interface StreamInfo {
  url: string;
  protocol: "progressive" | "hls";
  mimeType?: string;
}

export interface SearchResults {
  tracks: Page<Track>;
  users: Page<User>;
  playlists: Page<Playlist>;
  albums: Page<Playlist>;
}

export interface SpotifyListTrack {
  spotifyId: string | null;
  title: string;
  artists: string[];
  durationMs: number | null;
  explicit: boolean;
  /** The track's own cover. Only the full-page reader has it; embed lists leave it out. */
  artworkUrl?: string | null;
}

export interface SpotifyList {
  id: string;
  kind: "playlist" | "album";
  url: string;
  name: string;
  owner: string | null;
  coverUrl: string | null;
  total: number | null;
  truncated: boolean;
  source: "embed" | "page";
  notice: string | null;
  tracks: SpotifyListTrack[];
}

// The parts of SoundCloud's api-v2 objects we read. Everything is optional
// because SoundCloud trims objects in some lists (playlist stubs carry only an id).
export interface ScUser {
  id: number;
  username?: string;
  avatar_url?: string | null;
  verified?: boolean;
  city?: string | null;
  country_code?: string | null;
  description?: string | null;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  playlist_count?: number;
  permalink_url?: string | null;
  visuals?: { visuals?: { visual_url?: string }[] } | null;
}

export interface ScTranscoding {
  url: string;
  preset?: string;
  duration?: number;
  snipped?: boolean;
  quality?: string;
  format: { protocol: string; mime_type: string };
}

export interface ScTrack {
  id: number;
  kind?: string;
  title?: string;
  user?: ScUser;
  artwork_url?: string | null;
  duration?: number;
  full_duration?: number;
  genre?: string | null;
  tag_list?: string | null;
  description?: string | null;
  created_at?: string;
  display_date?: string;
  playback_count?: number | null;
  likes_count?: number | null;
  reposts_count?: number | null;
  comment_count?: number | null;
  waveform_url?: string | null;
  permalink_url?: string | null;
  streamable?: boolean;
  policy?: string;
  track_authorization?: string;
  media?: { transcodings?: ScTranscoding[] };
}

export interface ScPlaylist {
  id: number | string;
  urn?: string;
  kind?: string;
  title?: string;
  user?: ScUser;
  artwork_url?: string | null;
  calculated_artwork_url?: string | null;
  description?: string | null;
  set_type?: string | null;
  is_album?: boolean;
  track_count?: number;
  duration?: number;
  created_at?: string;
  published_at?: string | null;
  last_updated?: string;
  likes_count?: number | null;
  tracks?: ScTrack[];
  permalink_url?: string | null;
}

export interface ScComment {
  id: number;
  body?: string;
  timestamp?: number | null;
  created_at?: string;
  user?: ScUser;
}

export interface ScCollection<T> {
  collection: T[];
  next_href?: string | null;
}
