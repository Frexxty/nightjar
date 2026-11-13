// stratus-api: the hosted backend for Stratus. The contract is docs/hosted-api.md
// plus every route in BACKEND.md, all under /v1.
import { checkEmail, checkPassword, checkUsername, hashPassword, needsRehash, PBKDF2_ITERATIONS, verifyPassword } from "./auth.ts";
import * as cat from "./catalogue.ts";
import {
  type Account, accountUser, accountUserId, createSession, deleteSession, loadSnapshots, pruneSnapshots, rateLimit, sessionAccount, snapshotWrites,
} from "./db.ts";
import type { Env } from "./env.ts";
import {
  ApiError, CORS_HEADERS, b64url, badInput, encodeCursor, errorResponse, intOffset, isScId, json, noContent, notFound, unauthorized,
} from "./http.ts";
import { mapTrack } from "./map.ts";
import { cleanSnapshot, isSpotifyTrackId, isTrackRef, mergeInOrder, readTrackList } from "./snapshot.ts";
import { cachedJson, hydrateTracks } from "./soundcloud.ts";
import { ImportError, fetchSpotifyList, parseSpotifyRef } from "./spotify.ts";
import { fetchViaBrowser } from "./spotify-browser.ts";
import type { Playlist, Section, Track, UserSummary } from "./types.ts";

interface Req {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  params: Record<string, string>;
  account: Account | null;
}

type Handler = (r: Req) => Promise<unknown>;

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth?: boolean }[] = [];

function route(method: string, path: string, handler: Handler, auth = false) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:(\w+)/g, (_m, k: string) => {
      keys.push(k);
      return "([^/]+)";
    }) + "/?$",
  );
  routes.push({ method, pattern, keys, handler, auth });
}

const c = (r: Req): cat.Ctx => ({ env: r.env, ctx: r.ctx });
const me = (r: Req): Account => {
  if (!r.account) throw unauthorized();
  return r.account;
};

async function readJson(request: Request, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > maxBytes) throw new ApiError(413, "invalid_input", "Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError(413, "invalid_input", "Request body is too large.");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw badInput("Send a JSON object.");
  }
}

// ---------------------------------------------------------------------------
// Accounts

route("POST", "/auth/signup", async (r) => {
  await rateLimit(r.env, r.request, "signup", 10);
  const body = await readJson(r.request, 4096);
  const username = checkUsername(body.username);
  const email = checkEmail(body.email);
  const password = checkPassword(body.password);

  const clash = await r.env.DB.prepare("SELECT username_lower = ?1 AS name, email = ?2 AS mail FROM users WHERE username_lower = ?1 OR email = ?2 LIMIT 1")
    .bind(username.toLowerCase(), email).first<{ name: number; mail: number }>();
  if (clash?.name) throw new ApiError(409, "username_taken", "That username is taken.");
  if (clash?.mail) throw new ApiError(409, "email_taken", "There's already an account with that email.");

  const pw = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    await r.env.DB.prepare(
      "INSERT INTO users (id, username, username_lower, email, pw_hash, pw_salt, pw_iterations, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    ).bind(id, username, username.toLowerCase(), email, pw.hash, pw.salt, pw.iterations, Date.now()).run();
  } catch (err) {
    const msg = String((err as Error).message);
    if (/UNIQUE.*username_lower/i.test(msg)) throw new ApiError(409, "username_taken", "That username is taken.");
    if (/UNIQUE.*email/i.test(msg)) throw new ApiError(409, "email_taken", "There's already an account with that email.");
    throw err;
  }
  const token = await createSession(r.env, id);
  return json({ token, user: await accountUser(r.env, { id, username }) }, 201);
});

// Spent on unknown logins so they take as long as wrong passwords.
const DUMMY_HASH = { hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", salt: "AAAAAAAAAAAAAAAAAAAAAA", iterations: PBKDF2_ITERATIONS };

route("POST", "/auth/login", async (r) => {
  await rateLimit(r.env, r.request, "login", 10);
  const body = await readJson(r.request, 4096);
  const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!login || login.length > 254 || !password || password.length > 200) throw badInput("Enter your email or username and your password.");

  const account = await r.env.DB.prepare(`SELECT * FROM users WHERE ${login.includes("@") ? "email" : "username_lower"} = ?1`)
    .bind(login).first<Account>();
  const stored = account ? { hash: account.pw_hash, salt: account.pw_salt, iterations: account.pw_iterations } : DUMMY_HASH;
  const ok = await verifyPassword(password, stored);
  if (!account || !ok) throw new ApiError(401, "invalid_credentials", "Wrong email, username or password.");

  if (needsRehash(stored)) {
    const pw = await hashPassword(password);
    await r.env.DB.prepare("UPDATE users SET pw_hash = ?1, pw_salt = ?2, pw_iterations = ?3 WHERE id = ?4")
      .bind(pw.hash, pw.salt, pw.iterations, account.id).run();
  }
  // Expired sessions are dead weight; drop this user's while we're here.
  await r.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND expires_at < ?2").bind(account.id, Date.now()).run();
  const token = await createSession(r.env, account.id);
  return json({ token, user: await accountUser(r.env, account) });
});

route("POST", "/auth/logout", async (r) => {
  await deleteSession(r.env, r.request);
  return noContent();
});

route("GET", "/me", async (r) => accountUser(r.env, me(r)), true);

route("DELETE", "/me", async (r) => {
  const account = me(r);
  await rateLimit(r.env, r.request, "login", 10);
  const body = await readJson(r.request, 4096);
  const password = typeof body.password === "string" ? body.password : "";
  const ok = password && (await verifyPassword(password, { hash: account.pw_hash, salt: account.pw_salt, iterations: account.pw_iterations }));
  if (!ok) throw new ApiError(401, "invalid_credentials", "That password isn't right.");
  const db = r.env.DB;
  await db.batch(["sessions", "likes", "reposts", "follows", "playlists", "history", "track_snapshots"].map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(account.id))
    .concat(db.prepare("DELETE FROM users WHERE id = ?1").bind(account.id)));
  return noContent();
}, true);

// ---------------------------------------------------------------------------
// Catalogue

route("GET", "/home", async (r) => {
  const publicSections = await cat.publicHome(c(r));
  if (!r.account) return publicSections;
  const [like, follows] = await Promise.all([
    r.env.DB.prepare("SELECT track_id FROM likes WHERE user_id = ?1 AND track_id NOT LIKE 'spotify:%' ORDER BY created_at DESC LIMIT 1").bind(r.account.id).first<{ track_id: string }>(),
    followIds(r, 50),
  ]);
  const personal = await cat.personalHome(c(r), like?.track_id ?? null, follows);
  const out: Section[] = [...personal, ...publicSections];
  return out.slice(0, 6);
});

async function followIds(r: Req, limit: number): Promise<string[]> {
  const rows = await r.env.DB.prepare("SELECT sc_user_id FROM follows WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2")
    .bind(me(r).id, limit).all<{ sc_user_id: string }>();
  return rows.results.map((x) => x.sc_user_id);
}

route("GET", "/feed", async (r) => cat.feed(c(r), await followIds(r, 50), r.url.searchParams.get("cursor")), true);

route("GET", "/search", async (r) => cat.searchAll(c(r), cat.checkQuery(r.url.searchParams.get("q"))));
route("GET", "/search/:kind", async (r) =>
  cat.searchKind(c(r), cat.checkQuery(r.url.searchParams.get("q")), r.params.kind, r.url.searchParams.get("cursor")));

route("GET", "/tracks/:id", async (r) => cat.track(c(r), r.params.id));
route("GET", "/tracks/:id/comments", async (r) => cat.trackComments(c(r), r.params.id));
route("POST", "/tracks/:id/comments", async () => {
  throw new ApiError(501, "not_supported", "Stratus accounts can't post comments to SoundCloud.");
}, true);
route("GET", "/tracks/:id/related", async (r) => cat.relatedTracks(c(r), r.params.id));
route("GET", "/tracks/:id/stream", async (r) => json(await cat.stream(c(r), r.params.id), 200, { "Cache-Control": "no-store" }));

route("GET", "/playlists/:id", async (r) => {
  const id = r.params.id;
  if (id.startsWith("sp_")) return accountPlaylist(r, id, true);
  return cat.scPlaylist(c(r), id);
});

// Stratus accounts show up as users too (owner links on saved playlists).
const accountId = (id: string) => (/^me:[0-9a-f-]{36}$/.test(id) ? id.slice(3) : null);
async function publicAccount(r: Req, id: string) {
  const row = await r.env.DB.prepare("SELECT id, username FROM users WHERE id = ?1").bind(id).first<{ id: string; username: string }>();
  if (!row) throw notFound("That user doesn't exist.");
  return row;
}

route("GET", "/users/:id", async (r) => {
  const aid = accountId(r.params.id);
  if (aid) return accountUser(r.env, await publicAccount(r, aid), r.account?.id !== aid);
  return cat.user(c(r), r.params.id);
});
route("GET", "/users/:id/top-tracks", async (r) => (accountId(r.params.id) ? [] : cat.userTopTracks(c(r), r.params.id)));
route("GET", "/users/:id/tracks", async (r) =>
  accountId(r.params.id) ? { items: [], next: null } : cat.userTracks(c(r), r.params.id, r.url.searchParams.get("cursor")));
route("GET", "/users/:id/likes", async (r) =>
  accountId(r.params.id) ? { items: [], next: null } : cat.userLikes(c(r), r.params.id, r.url.searchParams.get("cursor")));
route("GET", "/users/:id/playlists", async (r) => {
  const aid = accountId(r.params.id);
  if (!aid) return cat.userPlaylists(c(r), r.params.id);
  const owner = await publicAccount(r, aid);
  return listAccountPlaylists(r, owner, r.account?.id !== aid);
});

// ---------------------------------------------------------------------------
// Likes, reposts, follows

const PAGE = 30;

/**
 * Full tracks for saved IDs, in order: SoundCloud IDs hydrated live, Spotify
 * IDs from `ownerId`'s stored snapshots. Tracks that are gone are skipped.
 */
async function savedTracks(r: Req, ownerId: string, ids: string[]): Promise<Track[]> {
  const [hydrated, snapshots] = await Promise.all([
    hydrateTracks(r.env, r.ctx, ids.filter((id) => !isSpotifyTrackId(id))),
    loadSnapshots(r.env, ownerId, ids),
  ]);
  return mergeInOrder(ids, hydrated.map(mapTrack), snapshots);
}

async function trackPage(r: Req, table: "likes" | "history", orderCol: string): Promise<{ items: Track[]; next: string | null }> {
  const offset = intOffset(r.url.searchParams.get("cursor"));
  const account = me(r);
  const rows = await r.env.DB.prepare(`SELECT track_id FROM ${table} WHERE user_id = ?1 ORDER BY ${orderCol} DESC LIMIT ?2 OFFSET ?3`)
    .bind(account.id, PAGE + 1, offset).all<{ track_id: string }>();
  const ids = rows.results.slice(0, PAGE).map((x) => x.track_id);
  const items = await savedTracks(r, account.id, ids);
  return { items, next: rows.results.length > PAGE ? encodeCursor({ o: offset + PAGE }) : null };
}

route("GET", "/me/likes/tracks", async (r) => trackPage(r, "likes", "created_at"), true);
route("GET", "/me/likes/playlists", async () => [], true);
route("GET", "/me/following", async (r) => cat.usersById(c(r), await followIds(r, 200)), true);

function toggle(table: "likes" | "reposts" | "follows", col: "track_id" | "sc_user_id") {
  const handler = (on: boolean): Handler => async (r) => {
    const account = me(r);
    const id = r.params.id;
    const db = r.env.DB;
    // Likes also take Spotify tracks, with a snapshot of the track in the body.
    const spotify = table === "likes" && isSpotifyTrackId(id);
    if (!spotify && !isScId(id)) throw badInput(table === "likes" ? "That isn't a SoundCloud or spotify:track: ID." : "That isn't a SoundCloud ID.");
    if (on) {
      const insert = db.prepare(`INSERT INTO ${table} (user_id, ${col}, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`)
        .bind(account.id, id, Date.now());
      if (spotify) {
        const body = await readJson(r.request, 16 * 1024);
        if (body.track === undefined) throw badInput("Liking a Spotify track needs { \"track\": Track } in the body.");
        await db.batch([...snapshotWrites(r.env, account.id, [cleanSnapshot(body.track, id)]), insert]);
      } else await insert.run();
    } else {
      const remove = db.prepare(`DELETE FROM ${table} WHERE user_id = ?1 AND ${col} = ?2`).bind(account.id, id);
      if (spotify) await db.batch([remove, pruneSnapshots(r.env, account.id)]);
      else await remove.run();
    }
    return noContent();
  };
  return { on: handler(true), off: handler(false) };
}
const likes = toggle("likes", "track_id");
const reposts = toggle("reposts", "track_id");
const follows = toggle("follows", "sc_user_id");
route("PUT", "/me/likes/tracks/:id", likes.on, true);
route("DELETE", "/me/likes/tracks/:id", likes.off, true);
route("PUT", "/me/reposts/tracks/:id", reposts.on, true);
route("DELETE", "/me/reposts/tracks/:id", reposts.off, true);
route("PUT", "/me/following/:id", follows.on, true);
route("DELETE", "/me/following/:id", follows.off, true);

// ---------------------------------------------------------------------------
// History

const HISTORY_KEEP = 500;

route("POST", "/me/history", async (r) => {
  const account = me(r);
  const body = await readJson(r.request, 16 * 1024);
  const trackId = typeof body.trackId === "string" ? body.trackId : typeof body.trackId === "number" ? String(body.trackId) : "";
  if (!isTrackRef(trackId)) throw badInput("Send { \"trackId\": \"<SoundCloud track ID or spotify:track: ID>\" }.");
  const spotify = isSpotifyTrackId(trackId);
  if (spotify && body.track === undefined) throw badInput("Spotify plays need { \"trackId\", \"track\": Track } in the body.");
  const db = r.env.DB;
  await db.batch([
    ...(spotify ? snapshotWrites(r.env, account.id, [cleanSnapshot(body.track, trackId)]) : []),
    db.prepare("INSERT INTO history (user_id, track_id, played_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, track_id) DO UPDATE SET played_at = ?3")
      .bind(account.id, trackId, Date.now()),
    db.prepare(
      `DELETE FROM history WHERE user_id = ?1 AND track_id NOT IN
        (SELECT track_id FROM history WHERE user_id = ?1 ORDER BY played_at DESC LIMIT ${HISTORY_KEEP})`,
    ).bind(account.id),
  ]);
  // Plays that fell off the end of the history can leave snapshots behind.
  if (spotify && Math.random() < 0.05) await pruneSnapshots(r.env, account.id).run();
  return noContent();
}, true);
route("GET", "/me/history", async (r) => trackPage(r, "history", "played_at"), true);

// ---------------------------------------------------------------------------
// Account playlists

interface PlaylistRow {
  id: string;
  user_id: string;
  username: string;
  title: string;
  description: string | null;
  public: number;
  source_url: string | null;
  track_ids: string;
  track_count: number;
  artwork_url: string | null;
  duration_ms: number;
  created_at: number;
}

const MAX_PLAYLIST_TRACKS = 5000;

function playlistFromRow(row: PlaylistRow, tracks?: Track[]): Playlist {
  const owner: UserSummary = { id: accountUserId(row.user_id), username: row.username, avatarUrl: null };
  const out: Playlist = {
    id: row.id,
    title: row.title,
    user: owner,
    artworkUrl: tracks ? (tracks.find((t) => t.artworkUrl)?.artworkUrl ?? null) : row.artwork_url,
    description: row.description,
    isAlbum: false,
    trackCount: tracks ? tracks.length : row.track_count,
    duration: tracks ? tracks.reduce((s, t) => s + t.duration, 0) : row.duration_ms,
    createdAt: new Date(row.created_at).toISOString(),
    likesCount: 0,
    permalinkUrl: null,
  };
  if (tracks) out.tracks = tracks;
  return out;
}

const PLAYLIST_SELECT = "SELECT p.*, u.username FROM playlists p JOIN users u ON u.id = p.user_id";

async function accountPlaylist(r: Req, id: string, publicView: boolean): Promise<Playlist> {
  const row = await r.env.DB.prepare(`${PLAYLIST_SELECT} WHERE p.id = ?1`).bind(id).first<PlaylistRow>();
  const mine = row && r.account?.id === row.user_id;
  if (!row || (!mine && !(publicView && row.public))) throw notFound("That playlist doesn't exist or isn't public.");
  const tracks = await savedTracks(r, row.user_id, JSON.parse(row.track_ids) as string[]);
  return playlistFromRow(row, tracks);
}

async function listAccountPlaylists(r: Req, owner: { id: string }, publicOnly: boolean): Promise<Playlist[]> {
  const rows = await r.env.DB.prepare(`${PLAYLIST_SELECT} WHERE p.user_id = ?1 ${publicOnly ? "AND p.public = 1" : ""} ORDER BY p.created_at DESC LIMIT 500`)
    .bind(owner.id).all<PlaylistRow>();
  return rows.results.map((row) => playlistFromRow(row));
}

function checkTrackIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw badInput("trackIds must be an array of SoundCloud track IDs.");
  if (value.length > MAX_PLAYLIST_TRACKS) throw badInput(`Playlists can hold at most ${MAX_PLAYLIST_TRACKS} tracks.`);
  const ids = value.map((v) => (typeof v === "number" ? String(v) : v));
  if (!ids.every(isTrackRef)) throw badInput("trackIds must be SoundCloud track IDs or spotify:track: IDs.");
  return ids as string[];
}

/** Playlist bodies can carry thousands of snapshots. */
const PLAYLIST_BODY_BYTES = 6 * 1024 * 1024;

/**
 * The new track order from a playlist body, and the snapshots to store.
 * `tracks` wins over `trackIds` when both are sent. Spotify IDs in `trackIds`
 * alone must already have a snapshot on this account (a reorder of a saved list).
 */
async function playlistTracks(r: Req, body: Record<string, unknown>): Promise<{ ids: string[]; snapshots: Track[] } | null> {
  if (body.tracks !== undefined) return readTrackList(body.tracks, MAX_PLAYLIST_TRACKS);
  if (body.trackIds === undefined) return null;
  const ids = checkTrackIds(body.trackIds);
  const spotify = ids.filter(isSpotifyTrackId);
  if (spotify.length) {
    const known = await loadSnapshots(r.env, me(r).id, spotify);
    const missing = spotify.find((id) => !known.has(id));
    if (missing) throw badInput(`Send "tracks" with a snapshot for ${missing}; this account has none saved.`);
  }
  return { ids, snapshots: [] };
}

function checkTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) throw badInput("Give the playlist a title.");
  if (title.length > 100) throw badInput("Playlist titles can be at most 100 characters.");
  return title;
}

function checkDescription(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2000) throw badInput("Descriptions are text, at most 2000 characters.");
  return value;
}

function checkSourceUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 500 || !/^https:\/\//.test(value)) throw badInput("sourceUrl must be an https URL.");
  return value;
}

/**
 * Resolves the IDs once at write time so lists can show artwork and length
 * without SoundCloud. `fresh` are snapshots sent with this request; they win
 * over stored ones and are written only once the whole request checks out.
 */
async function summarize(r: Req, ids: string[], fresh: Track[] = []) {
  const freshIds = new Set(fresh.map((t) => t.id));
  const [hydrated, stored] = await Promise.all([
    hydrateTracks(r.env, r.ctx, ids.filter((id) => !isSpotifyTrackId(id))),
    loadSnapshots(r.env, me(r).id, ids.filter((id) => !freshIds.has(id))),
  ]);
  for (const t of fresh) stored.set(t.id, t);
  const tracks = mergeInOrder(ids, hydrated.map(mapTrack), stored);
  return {
    tracks,
    artwork: tracks.find((t) => t.artworkUrl)?.artworkUrl ?? null,
    duration: tracks.reduce((s, t) => s + t.duration, 0),
  };
}

route("GET", "/me/playlists", async (r) => listAccountPlaylists(r, me(r), false), true);

route("POST", "/me/playlists", async (r) => {
  const account = me(r);
  const body = await readJson(r.request, PLAYLIST_BODY_BYTES);
  const title = checkTitle(body.title);
  const { ids, snapshots } = (await playlistTracks(r, body)) ?? { ids: [], snapshots: [] };
  if (body.public !== undefined && typeof body.public !== "boolean") throw badInput("public must be true or false.");
  const isPublic = body.public === true;
  const description = checkDescription(body.description);
  const sourceUrl = checkSourceUrl(body.sourceUrl);
  const count = await r.env.DB.prepare("SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?1").bind(account.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 500) throw badInput("You have 500 playlists, which is the limit.");

  const { tracks, artwork, duration } = await summarize(r, ids, snapshots);
  const id = `sp_${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const now = Date.now();
  await r.env.DB.batch([
    ...snapshotWrites(r.env, account.id, snapshots, now),
    r.env.DB.prepare(
      `INSERT INTO playlists (id, user_id, title, description, public, source_url, track_ids, track_count, artwork_url, duration_ms, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    ).bind(id, account.id, title, description, isPublic ? 1 : 0, sourceUrl, JSON.stringify(ids), ids.length, artwork, duration, now),
  ]);
  const row: PlaylistRow = {
    id, user_id: account.id, username: account.username, title, description, public: isPublic ? 1 : 0, source_url: sourceUrl,
    track_ids: "[]", track_count: ids.length, artwork_url: artwork, duration_ms: duration, created_at: now,
  };
  return json(playlistFromRow(row, tracks), 201);
}, true);

route("PATCH", "/me/playlists/:id", async (r) => {
  const account = me(r);
  const row = await r.env.DB.prepare(`${PLAYLIST_SELECT} WHERE p.id = ?1 AND p.user_id = ?2`).bind(r.params.id, account.id).first<PlaylistRow>();
  if (!row) throw notFound("That playlist doesn't exist.");
  const body = await readJson(r.request, PLAYLIST_BODY_BYTES);
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    values.push(v);
    sets.push(`${col} = ?${values.length}`);
  };
  if ("title" in body) set("title", (row.title = checkTitle(body.title)));
  if ("description" in body) set("description", (row.description = checkDescription(body.description)));
  if ("public" in body) {
    if (typeof body.public !== "boolean") throw badInput("public must be true or false.");
    set("public", (row.public = body.public ? 1 : 0));
  }
  let tracks: Track[] | undefined;
  let snapshots: Track[] = [];
  const order = await playlistTracks(r, body);
  if (order) {
    const s = await summarize(r, order.ids, order.snapshots);
    tracks = s.tracks;
    snapshots = order.snapshots;
    set("track_ids", JSON.stringify(order.ids));
    set("track_count", order.ids.length);
    set("artwork_url", s.artwork);
    set("duration_ms", s.duration);
  }
  if (sets.length) {
    const now = Date.now();
    set("updated_at", now);
    values.push(row.id);
    await r.env.DB.batch([
      ...snapshotWrites(r.env, account.id, snapshots, now),
      r.env.DB.prepare(`UPDATE playlists SET ${sets.join(", ")} WHERE id = ?${values.length}`).bind(...values),
      // Spotify tracks dropped from the list may not be needed any more.
      ...(order && row.track_ids.includes("spotify:") ? [pruneSnapshots(r.env, account.id)] : []),
    ]);
  }
  tracks ??= await savedTracks(r, account.id, JSON.parse(row.track_ids) as string[]);
  return playlistFromRow(row, tracks);
}, true);

route("DELETE", "/me/playlists/:id", async (r) => {
  const account = me(r);
  const [res] = await r.env.DB.batch([
    r.env.DB.prepare("DELETE FROM playlists WHERE id = ?1 AND user_id = ?2").bind(r.params.id, account.id),
    pruneSnapshots(r.env, account.id),
  ]);
  if (!res.meta.changes) throw notFound("That playlist doesn't exist.");
  return noContent();
}, true);

// ---------------------------------------------------------------------------
// Spotify import

route("GET", "/import/spotify", async (r) => {
  const input = r.url.searchParams.get("url");
  let ref;
  try {
    ref = parseSpotifyRef(input);
  } catch (err) {
    throw new ApiError(400, "invalid_input", (err as Error).message);
  }
  const log = (m: string) => console.log(`[spotify ${ref.kind}/${ref.id}] ${m}`);
  try {
    // Same list within 10 minutes comes from the cache, so retries don't start another browser.
    return await cachedJson(r.ctx, `spotify/${ref.kind}/${ref.id}`, 600, async () => {
      await rateLimit(r.env, r.request, "import", 10);
      return fetchSpotifyList(`spotify:${ref.kind}:${ref.id}`, { fetchFull: (x) => fetchViaBrowser(r.env, x, log), log });
    });
  } catch (err) {
    if (err instanceof ImportError) throw new ApiError(422, "import_failed", err.message);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Signed-in flags

async function annotate(r: Req, data: unknown): Promise<void> {
  if (!r.account || !data || typeof data !== "object") return;
  const db = r.env.DB;
  const [l, rp, f] = await db.batch<{ id: string }>([
    db.prepare("SELECT track_id AS id FROM likes WHERE user_id = ?1").bind(r.account.id),
    db.prepare("SELECT track_id AS id FROM reposts WHERE user_id = ?1").bind(r.account.id),
    db.prepare("SELECT sc_user_id AS id FROM follows WHERE user_id = ?1").bind(r.account.id),
  ]);
  const liked = new Set(l.results.map((x) => x.id));
  const reposted = new Set(rp.results.map((x) => x.id));
  const following = new Set(f.results.map((x) => x.id));
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && "streamable" in o && "playbackCount" in o) {
      o.liked = liked.has(o.id);
      o.reposted = reposted.has(o.id);
    } else if (typeof o.id === "string" && "followersCount" in o && !o.id.startsWith("me:")) {
      o.following = following.has(o.id);
    }
    for (const value of Object.values(o)) if (value && typeof value === "object") walk(value);
  };
  walk(data);
}

// ---------------------------------------------------------------------------

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/") {
    return json({ name: "stratus-api", docs: "https://github.com/Frexxty/stratus/blob/main/docs/hosted-api.md" });
  }
  if (!url.pathname.startsWith("/v1/")) throw notFound();
  const path = url.pathname.slice(3);
  let methodMismatch = false;
  for (const rt of routes) {
    const m = path.match(rt.pattern);
    if (!m) continue;
    if (rt.method !== request.method && !(request.method === "HEAD" && rt.method === "GET")) {
      methodMismatch = true;
      continue;
    }
    const params: Record<string, string> = {};
    rt.keys.forEach((k, i) => {
      try {
        params[k] = decodeURIComponent(m[i + 1]);
      } catch {
        throw badInput("Bad URL encoding.");
      }
    });
    const account = rt.auth || request.headers.has("Authorization") ? await sessionAccount(env, request) : null;
    if (rt.auth && !account) throw unauthorized();
    const r: Req = { request, env, ctx, url, params, account };
    const result = await rt.handler(r);
    if (result instanceof Response) {
      if (account && (result.status === 200 || result.status === 201)) {
        // Responses built by the handler (status codes, headers) still get flags.
        const data = await result.clone().json().catch(() => null);
        if (data) {
          await annotate(r, data);
          return json(data, result.status, Object.fromEntries([...result.headers].filter(([k]) => k.toLowerCase() === "cache-control")));
        }
      }
      return result;
    }
    await annotate(r, result);
    return json(result);
  }
  if (methodMismatch) throw new ApiError(405, "method_not_allowed", `${request.method} isn't supported here.`);
  throw notFound();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err);
      // Messages only; request bodies and headers (passwords, tokens) are never logged.
      console.error(`unhandled: ${(err as Error)?.message ?? err}`);
      return errorResponse(new ApiError(500, "internal", "Something went wrong on our side."));
    }
  },
} satisfies ExportedHandler<Env>;
