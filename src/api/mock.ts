import { ApiError } from "./errors";
import { arrange, artwork, hash, renderWav, rng, waveformFor, type Arrangement } from "./synth";
import type {
  AuthSession, Backend, Comment, FeedItem, Id, NewPlaylistExtras, Page, Playlist, PlaylistPatch, SearchKind, SearchResults,
  Section, SpotifyList, StreamInfo, Track, User, UserSummary,
} from "./types";

// Invented artists and titles. Nothing here refers to real SoundCloud accounts.
const ARTISTS: [string, string, string][] = [
  ["Moth Choir", "Leeds", "GB"], ["Halcyon Tape", "Berlin", "DE"], ["Lumen Drift", "Montréal", "CA"],
  ["Static Orchard", "Portland", "US"], ["Kōri", "Osaka", "JP"], ["Velvet Ordnance", "London", "GB"],
  ["Paper Satellites", "Melbourne", "AU"], ["Nadia Sol", "Lisbon", "PT"], ["Gloam", "Reykjavík", "IS"],
  ["Rooftop Weather", "Brooklyn", "US"], ["Marrow & Moss", "Glasgow", "GB"], ["Unit 404", "Detroit", "US"],
  ["Celeste Varga", "Budapest", "HU"], ["Low Tide Club", "Cape Town", "ZA"],
];
const GENRES: [string, number][] = [
  ["Electronic", 124], ["Deep House", 122], ["Lo-fi", 84], ["Ambient", 90], ["Drum & Bass", 172],
  ["Techno", 130], ["Hip-hop", 92], ["Indie", 110], ["Synthwave", 100], ["Garage", 132],
];
const WORDS_A = ["Neon", "Quiet", "Paper", "Glass", "Velvet", "Hollow", "Silver", "Late", "Northern", "Electric", "Soft", "Golden", "Broken", "Midnight", "Distant", "Lucid"];
const WORDS_B = ["Rooms", "Signals", "Weather", "Tides", "Static", "Gardens", "Hours", "Lights", "Motel", "Orbit", "Machines", "Rain", "Satellites", "Mirrors", "Fever", "Echoes"];
const COMMENTS = [
  "this drop 🔥", "the bassline here", "absolutely unreal", "on repeat all week", "who else is here from the mix?",
  "chills every time", "THIS PART", "underrated", "need this on vinyl", "perfect late-night track",
  "the pads are so warm", "ID?", "saw this live last month, insane", "production is so clean", "ok this is my favourite bit",
  "goosebumps", "love the switch-up", "masterpiece honestly", "pure vibes", "can't stop playing this",
];

const day = 86400000;
const NOW = Date.UTC(2026, 10, 13);

interface MockTrack extends Track { arrangement: Arrangement }

function summary(u: User): UserSummary {
  return { id: u.id, username: u.username, avatarUrl: u.avatarUrl, verified: u.verified };
}

function page<T>(all: T[], cursor: string | null | undefined, size = 20): Page<T> {
  const start = cursor ? Number(cursor) : 0;
  const end = start + size;
  return { items: all.slice(start, end), next: end < all.length ? String(end) : null };
}

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms + Math.random() * 120));
const LIKES_KEY = "stratus.mock.likes";
const FOLLOW_KEY = "stratus.mock.following";
const REPOST_KEY = "stratus.mock.reposts";
const HISTORY_KEY = "stratus.mock.history";
const ACCOUNT_KEY = "stratus.mock.account";
const AUDIO_CACHE = 3;

/**
 * The demo's fake account, kept in localStorage. It starts signed in as "you"
 * with no password so the demo works straight away. Signing up sets a password
 * (stored as a non-cryptographic hash; this is demo data, not security).
 */
interface MockAccount {
  username: string;
  email: string;
  passwordHash: number | null;
  signedIn: boolean;
}
const DEFAULT_ACCOUNT: MockAccount = { username: "you", email: "you@example.com", passwordHash: null, signedIn: true };
const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/;

function loadAccount(): MockAccount {
  try {
    return { ...DEFAULT_ACCOUNT, ...JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_ACCOUNT };
  }
}

function loadSet(key: string, fallback: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : fallback);
  } catch {
    return new Set(fallback);
  }
}
function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Storage can be unavailable; the mock still works for this session.
  }
}

/** In-memory SoundCloud lookalike with generated art, waveforms, comments and audio. */
export class MockBackend implements Backend {
  readonly name = "Demo data";
  private users: User[] = [];
  private tracks: MockTrack[] = [];
  private playlists: Playlist[] = [];
  private comments = new Map<Id, Comment[]>();
  private audio = new Map<Id, string>();
  private meUser: User;
  private likes: Set<string>;
  private follows: Set<string>;
  private reposts: Set<string>;
  private account: MockAccount = loadAccount();
  private playedIds: string[];

  constructor() {
    const r = rng(42);

    this.users = ARTISTS.map(([name, city, country], i) => {
      const seed = hash(name);
      return {
        id: `u${i + 1}`,
        username: name,
        avatarUrl: artwork(seed + 7),
        bannerUrl: artwork(seed + 99),
        city, country,
        description: `${name} makes music somewhere between the club and the bedroom. Based in ${city}.`,
        followersCount: Math.floor(1200 + r() * 480000),
        followingsCount: Math.floor(40 + r() * 600),
        trackCount: 0,
        verified: r() < 0.4,
        permalinkUrl: null,
      };
    });

    for (let i = 0; i < 72; i++) {
      const user = this.users[i % this.users.length];
      const [genre, bpm] = GENRES[Math.floor(r() * GENRES.length)];
      const title = `${WORDS_A[Math.floor(r() * WORDS_A.length)]} ${WORDS_B[Math.floor(r() * WORDS_B.length)]}${r() < 0.15 ? " (Extended Mix)" : r() < 0.12 ? " (Edit)" : ""}`;
      const seed = hash(title + i);
      const arrangement = arrange(seed, bpm, 40 + r() * 60);
      const plays = Math.floor(r() ** 2 * 3_000_000 + 900);
      this.tracks.push({
        id: `t${i + 1}`,
        title,
        user: summary(user),
        artworkUrl: r() < 0.9 ? artwork(seed) : null,
        duration: Math.round(arrangement.seconds * 1000),
        genre,
        tags: [genre.toLowerCase(), r() < 0.5 ? "late night" : "summer"],
        description: r() < 0.6 ? `Out now. Mixed and mastered in ${user.city}.\n\nFree download for followers.` : null,
        createdAt: new Date(NOW - Math.floor(r() * 400) * day).toISOString(),
        playbackCount: plays,
        likesCount: Math.floor(plays * (0.01 + r() * 0.04)),
        repostsCount: Math.floor(plays * (0.001 + r() * 0.004)),
        commentCount: 0,
        waveform: waveformFor(arrangement),
        streamable: true,
        // A few Go+ style 30-second previews so the "Preview" label shows in the demo.
        preview: i % 13 === 6 || undefined,
        arrangement,
      });
      user.trackCount++;
    }

    for (const track of this.tracks) {
      const tr = rng(hash(track.id));
      const count = 4 + Math.floor(tr() * 22);
      const list: Comment[] = [];
      for (let c = 0; c < count; c++) {
        const by = this.users[Math.floor(tr() * this.users.length)];
        list.push({
          id: `${track.id}c${c}`,
          user: summary(by),
          body: COMMENTS[Math.floor(tr() * COMMENTS.length)],
          timestamp: tr() < 0.9 ? Math.floor(tr() * track.duration) : null,
          createdAt: new Date(NOW - Math.floor(tr() * 60) * day).toISOString(),
        });
      }
      list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      this.comments.set(track.id, list);
      track.commentCount = list.length;
    }

    const playlistNames = [
      "After Hours", "Sunday Reset", "Night Drive", "Warehouse Tools", "Focus Mode", "Coastline",
      "Basement Tapes", "First Light", "Low Ceiling EP", "Weather Systems", "Satellite Hearts LP", "Cold Front",
    ];
    playlistNames.forEach((title, i) => {
      const owner = i < 4 ? null : this.users[i % this.users.length];
      const isAlbum = /EP|LP/.test(title) || i % 5 === 4;
      const source = isAlbum && owner ? this.tracks.filter((t) => t.user.id === owner.id) : this.tracks;
      const pr = rng(hash(title));
      const tracks = [...source].sort(() => pr() - 0.5).slice(0, isAlbum ? Math.min(source.length, 6) : 10 + Math.floor(pr() * 14));
      this.playlists.push({
        id: `p${i + 1}`,
        title,
        user: owner ? summary(owner) : { id: "me", username: "you", avatarUrl: null },
        artworkUrl: artwork(hash(title), title),
        description: isAlbum ? `${title} by ${owner?.username}.` : "Hand-picked.",
        isAlbum,
        trackCount: tracks.length,
        duration: tracks.reduce((sum, t) => sum + t.duration, 0),
        createdAt: new Date(NOW - Math.floor(pr() * 300) * day).toISOString(),
        likesCount: Math.floor(pr() * 40000),
        tracks: tracks.map(strip),
      });
    });

    this.meUser = {
      id: "me",
      username: "you",
      avatarUrl: artwork(1234),
      followersCount: 128,
      followingsCount: 6,
      trackCount: 0,
      playlistCount: 4,
      description: "Demo account. Switch to a Stratus account or your own server in Settings.",
    };
    this.applyAccount();

    this.likes = loadSet(LIKES_KEY, this.tracks.filter((_, i) => i % 5 === 0).map((t) => t.id));
    this.follows = loadSet(FOLLOW_KEY, this.users.slice(0, 6).map((u) => u.id));
    this.reposts = loadSet(REPOST_KEY, []);
    this.playedIds = [...loadSet(HISTORY_KEY, [])];
  }

  private decorate = (t: MockTrack | Track): Track => {
    const signedIn = this.account.signedIn;
    return { ...strip(t), liked: signedIn && this.likes.has(t.id), reposted: signedIn && this.reposts.has(t.id) };
  };
  private userOut = (u: User): User => ({ ...u, following: this.account.signedIn && this.follows.has(u.id) });
  private trackById(id: Id) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) throw new Error(`No track ${id}`);
    return t;
  }

  // Account. Behaves like the hosted backend: personal routes answer 401
  // `unauthorized` when signed out, and bad input gets the same error codes.

  private applyAccount() {
    this.meUser.username = this.account.username;
    this.meUser.email = this.account.email;
    for (const p of this.playlists) if (p.user.id === "me") p.user = summary(this.meUser);
  }

  private saveAccount() {
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
    } catch {
      // The demo account lasts for this session.
    }
    this.applyAccount();
  }

  private requireAccount() {
    if (!this.account.signedIn) throw new ApiError(401, "unauthorized", "Sign in to do that.");
  }

  private session(): AuthSession {
    return { token: `demo-${Date.now().toString(36)}`, user: this.meUser };
  }

  async me() { await delay(40); return this.account.signedIn ? this.meUser : null; }

  async signup(username: string, email: string, password: string) {
    await delay(200);
    if (!USERNAME.test(username)) {
      throw new ApiError(400, "invalid_input", "Usernames are 3 to 30 letters, digits, _, - or .");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "invalid_input", "That email address doesn't look right.");
    if (password.length < 8) throw new ApiError(400, "weak_password", "Passwords need at least 8 characters.");
    if (this.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new ApiError(409, "username_taken", "That username is taken.");
    }
    this.account = { username, email, passwordHash: hash(password), signedIn: true };
    this.saveAccount();
    return this.session();
  }

  async login(login: string, password: string) {
    await delay(200);
    const a = this.account;
    const known = [a.username, a.email].some((x) => x.toLowerCase() === login.trim().toLowerCase());
    const passwordOk = a.passwordHash == null ? password.length >= 8 : hash(password) === a.passwordHash;
    if (!known || !passwordOk) throw new ApiError(401, "invalid_credentials", "Wrong username, email or password.");
    this.account = { ...a, signedIn: true };
    this.saveAccount();
    return this.session();
  }

  async logout() {
    await delay(60);
    this.account = { ...this.account, signedIn: false };
    this.saveAccount();
  }

  async deleteAccount(password: string) {
    await delay(200);
    this.requireAccount();
    const a = this.account;
    if (a.passwordHash != null ? hash(password) !== a.passwordHash : password.length < 8) {
      throw new ApiError(401, "invalid_credentials", "That password is wrong.");
    }
    for (const key of [LIKES_KEY, FOLLOW_KEY, REPOST_KEY, HISTORY_KEY]) localStorage.removeItem(key);
    this.likes.clear();
    this.follows.clear();
    this.reposts.clear();
    this.playedIds = [];
    this.account = { ...DEFAULT_ACCOUNT, signedIn: false };
    this.saveAccount();
  }

  async home(): Promise<Section[]> {
    await delay();
    const r = rng(Math.floor(Date.now() / 3_600_000));
    const shuffled = <T,>(list: T[]) => [...list].sort(() => r() - 0.5);
    const byPlays = [...this.tracks].sort((a, b) => b.playbackCount - a.playbackCount);
    const genre = GENRES[Math.floor(r() * GENRES.length)][0];
    return [
      { id: "more", title: "More of what you like", subtitle: "Based on your likes", kind: "tracks", items: shuffled(this.tracks).slice(0, 12).map(this.decorate) },
      { id: "mixes", title: "Mixed for you", kind: "playlists", items: this.playlists.filter((p) => !p.isAlbum) },
      { id: "charts", title: "Charts: Top 50", subtitle: "The most played tracks on Stratus this week", kind: "tracks", display: "list", items: byPlays.slice(0, 10).map(this.decorate) },
      { id: "artists", title: "Artists to watch", kind: "users", items: shuffled(this.users).slice(0, 10).map(this.userOut) },
      { id: "genre", title: `Trending in ${genre}`, kind: "tracks", items: shuffled(this.tracks).slice(0, 12).map(this.decorate) },
      { id: "albums", title: "New albums & EPs", kind: "playlists", items: this.playlists.filter((p) => p.isAlbum) },
    ];
  }

  async feed(cursor?: string | null): Promise<Page<FeedItem>> {
    await delay();
    this.requireAccount();
    const items: FeedItem[] = [];
    const r = rng(7);
    for (const t of this.tracks) {
      const followed = this.follows.has(t.user.id);
      if (followed) items.push({ kind: "track", createdAt: t.createdAt, track: this.decorate(t) });
      else if (r() < 0.25) {
        const by = this.users.filter((u) => this.follows.has(u.id))[Math.floor(r() * this.follows.size)];
        if (by) items.push({ kind: "track", createdAt: new Date(Date.parse(t.createdAt) + day).toISOString(), track: this.decorate(t), repostedBy: summary(by) });
      }
    }
    for (const p of this.playlists.filter((x) => x.isAlbum)) items.push({ kind: "playlist", createdAt: p.createdAt, playlist: p });
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return page(items, cursor, 15);
  }

  private match(q: string) {
    const needle = q.trim().toLowerCase();
    const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);
    return {
      tracks: this.tracks.filter((t) => has(t.title) || has(t.user.username) || has(t.genre)).map(this.decorate),
      users: this.users.filter((u) => has(u.username) || has(u.city)).map(this.userOut),
      playlists: this.playlists.filter((p) => !p.isAlbum && (has(p.title) || has(p.user.username))),
      albums: this.playlists.filter((p) => p.isAlbum && (has(p.title) || has(p.user.username))),
    };
  }

  async search(q: string): Promise<SearchResults> {
    await delay();
    const m = this.match(q);
    return { tracks: page(m.tracks, null), users: page(m.users, null), playlists: page(m.playlists, null), albums: page(m.albums, null) };
  }

  async searchKind(q: string, kind: SearchKind, cursor?: string | null) {
    await delay();
    return page<Track | User | Playlist>(this.match(q)[kind], cursor, 30);
  }

  async track(id: Id) { await delay(60); return this.decorate(this.trackById(id)); }
  async trackComments(id: Id) { await delay(60); return this.comments.get(id) ?? []; }
  async relatedTracks(id: Id) {
    await delay();
    const t = this.trackById(id);
    return this.tracks.filter((x) => x.id !== id && (x.genre === t.genre || x.user.id === t.user.id)).slice(0, 12).map(this.decorate);
  }

  async stream(track: Track): Promise<StreamInfo> {
    let url = this.audio.get(track.id);
    if (url) this.audio.delete(track.id);
    else url = URL.createObjectURL(renderWav(this.trackById(track.id).arrangement));
    // Each WAV is 2-4 MB held by the browser process until revoked. Keep the few
    // most recent (Map order is recency) so previous/next stay instant, and
    // never the one just requested, which is the one about to play.
    this.audio.set(track.id, url);
    for (const [id, old] of this.audio) {
      if (this.audio.size <= AUDIO_CACHE) break;
      URL.revokeObjectURL(old);
      this.audio.delete(id);
    }
    return { url, protocol: "progressive", mimeType: "audio/wav" };
  }

  async playlist(id: Id) {
    await delay();
    const p = this.playlists.find((x) => x.id === id);
    if (!p) throw new Error(`No playlist ${id}`);
    return { ...p, tracks: p.tracks?.map((t) => this.decorate(t)) };
  }

  async user(id: Id) {
    await delay(60);
    if (id === "me") return this.meUser;
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error(`No user ${id}`);
    return this.userOut(u);
  }
  async userTopTracks(id: Id) {
    await delay();
    return this.tracks.filter((t) => t.user.id === id).sort((a, b) => b.playbackCount - a.playbackCount).slice(0, 5).map(this.decorate);
  }
  async userTracks(id: Id, cursor?: string | null) {
    await delay();
    const list = this.tracks.filter((t) => t.user.id === id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return page(list.map(this.decorate), cursor);
  }
  async userPlaylists(id: Id) { await delay(); return this.playlists.filter((p) => p.user.id === id); }
  async userLikes(id: Id, cursor?: string | null) {
    await delay();
    const r = rng(hash(id));
    return page(this.tracks.filter(() => r() < 0.2).map(this.decorate), cursor);
  }

  async likedTracks(cursor?: string | null) {
    await delay();
    this.requireAccount();
    return page(this.tracks.filter((t) => this.likes.has(t.id)).map(this.decorate), cursor, 50);
  }
  async likedPlaylists() { await delay(); this.requireAccount(); return this.playlists.filter((p) => p.isAlbum); }
  async myPlaylists() {
    await delay();
    this.requireAccount();
    return this.playlists.filter((p) => p.user.id === "me").map((p) => this.playlistOut(p));
  }
  async following() { await delay(); this.requireAccount(); return this.users.filter((u) => this.follows.has(u.id)).map(this.userOut); }

  async setTrackLiked(id: Id, liked: boolean) {
    await delay(80);
    this.requireAccount();
    if (liked) this.likes.add(id);
    else this.likes.delete(id);
    saveSet(LIKES_KEY, this.likes);
  }
  async setReposted(id: Id, reposted: boolean) {
    await delay(80);
    this.requireAccount();
    if (reposted) this.reposts.add(id);
    else this.reposts.delete(id);
    saveSet(REPOST_KEY, this.reposts);
  }
  async setFollowing(id: Id, following: boolean) {
    await delay(80);
    this.requireAccount();
    if (following) this.follows.add(id);
    else this.follows.delete(id);
    saveSet(FOLLOW_KEY, this.follows);
  }
  async postComment(id: Id, body: string, timestamp: number | null) {
    await delay(80);
    this.requireAccount();
    const comment: Comment = { id: `${id}c${Date.now()}`, user: summary(this.meUser), body, timestamp, createdAt: new Date().toISOString() };
    const list = this.comments.get(id) ?? [];
    list.push(comment);
    list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    this.comments.set(id, list);
    return comment;
  }

  // Account playlists.

  private playlistOut(p: Playlist): Playlist {
    return { ...p, tracks: p.tracks?.map((t) => this.decorate(t)) };
  }

  private ownPlaylist(id: Id) {
    this.requireAccount();
    const p = this.playlists.find((x) => x.id === id && x.user.id === "me");
    if (!p) throw new ApiError(404, "not_found", "That playlist doesn't exist.");
    return p;
  }

  /** `given` supplies tracks the demo catalogue doesn't have, such as imported Spotify ones. */
  private setTracks(p: Playlist, trackIds: Id[], given: Track[] = []) {
    const tracks = trackIds
      .map((id) => this.tracks.find((t) => t.id === id) ?? given.find((t) => t.id === id))
      .filter((t): t is MockTrack | Track => !!t);
    p.tracks = tracks.map(strip);
    p.trackCount = tracks.length;
    p.duration = tracks.reduce((sum, t) => sum + t.duration, 0);
  }

  async createPlaylist(title: string, trackIds: Id[], _isPublic: boolean, extras: NewPlaylistExtras = {}) {
    await delay(200);
    this.requireAccount();
    const playlist: Playlist = {
      id: `p-${Date.now().toString(36)}`,
      title,
      user: summary(this.meUser),
      artworkUrl: artwork(hash(title), title),
      description: extras.description ?? null,
      isAlbum: false,
      trackCount: 0,
      duration: 0,
      createdAt: new Date().toISOString(),
      likesCount: 0,
    };
    this.setTracks(playlist, trackIds, extras.tracks);
    this.playlists.unshift(playlist);
    return this.playlistOut(playlist);
  }

  async updatePlaylist(id: Id, patch: PlaylistPatch) {
    await delay(120);
    const p = this.ownPlaylist(id);
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new ApiError(400, "invalid_input", "Playlists need a title.");
      p.title = patch.title.trim();
    }
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.trackIds) this.setTracks(p, patch.trackIds, patch.tracks);
    return this.playlistOut(p);
  }

  async deletePlaylist(id: Id) {
    await delay(120);
    const p = this.ownPlaylist(id);
    this.playlists = this.playlists.filter((x) => x !== p);
  }

  // History.

  async addHistory(trackId: Id) {
    this.requireAccount();
    this.playedIds = [trackId, ...this.playedIds.filter((id) => id !== trackId)].slice(0, 200);
    saveSet(HISTORY_KEY, new Set(this.playedIds));
  }

  async history(cursor?: string | null) {
    await delay();
    this.requireAccount();
    const tracks = this.playedIds.map((id) => this.tracks.find((t) => t.id === id)).filter((t): t is MockTrack => !!t);
    return page(tracks.map(this.decorate), cursor, 50);
  }

  /**
   * A made-up Spotify playlist for the import page: mostly demo tracks with
   * their titles written the way Spotify writes them, plus two songs the demo
   * catalogue doesn't have, so every match state shows up.
   */
  async importSpotify(url: string): Promise<SpotifyList> {
    await delay(400);
    if (!/spotify/i.test(url) && !/^[A-Za-z0-9]{22}$/.test(url.trim())) {
      throw new ApiError(400, "invalid_input", "That isn't a Spotify playlist or album link.");
    }
    const r = rng(hash(url));
    const picks = [...this.tracks].sort(() => r() - 0.5).slice(0, 14);
    const tracks = picks.map((t, i) => ({
      spotifyId: `demo${i}`,
      title: i % 4 === 1 ? `${t.title} - Remastered 2021` : t.title,
      artists: [t.user.username],
      durationMs: t.duration + Math.round((r() - 0.5) * 4000),
      explicit: false,
    }));
    tracks.push(
      { spotifyId: "demo-x1", title: "Song That Isn't Here", artists: ["Nobody Known"], durationMs: 201000, explicit: false },
      { spotifyId: "demo-x2", title: "Another Missing One", artists: ["Unknown Band"], durationMs: 187000, explicit: true },
    );
    return {
      id: "demo",
      kind: "playlist",
      url: url.trim(),
      name: "Demo Spotify playlist",
      owner: "Demo",
      coverUrl: artwork(hash(url), "Demo"),
      total: tracks.length,
      truncated: false,
      source: "embed",
      notice: null,
      tracks,
    };
  }
}

function strip(t: MockTrack | Track): Track {
  const { arrangement: _drop, ...rest } = t as MockTrack;
  return rest;
}
