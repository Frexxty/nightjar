// D1 access for accounts, sessions and rate limits.
import { ApiError } from "./http.ts";
import { SESSION_DAYS, bearerToken, newToken, sha256 } from "./auth.ts";
import type { Env } from "./env.ts";
import { chunkJson, isSpotifyTrackId } from "./snapshot.ts";
import type { Track, User } from "./types.ts";

export interface Account {
  id: string;
  username: string;
  email: string;
  pw_hash: string;
  pw_salt: string;
  pw_iterations: number;
  created_at: number;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * 86400_000)
    .run();
  return token;
}

/** The signed-in account for this request, or null. Expired sessions count as signed out. */
export async function sessionAccount(env: Env, request: Request): Promise<Account | null> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  ).bind(await sha256(token), Date.now()).first<Account>();
  return row ?? null;
}

export async function deleteSession(env: Env, request: Request): Promise<void> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
}

export const accountUserId = (id: string) => `me:${id}`;

/** The `User` for a Nightjar account. Counts come from D1. */
export async function accountUser(env: Env, account: Pick<Account, "id" | "username">, publicOnly = false): Promise<User> {
  const counts = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM follows WHERE user_id = ?1) AS followings,
      (SELECT COUNT(*) FROM playlists WHERE user_id = ?1 ${publicOnly ? "AND public = 1" : ""}) AS playlists`,
  ).bind(account.id).first<{ followings: number; playlists: number }>();
  return {
    id: accountUserId(account.id),
    username: account.username,
    avatarUrl: null,
    followersCount: 0,
    followingsCount: counts?.followings ?? 0,
    trackCount: 0,
    playlistCount: counts?.playlists ?? 0,
    permalinkUrl: null,
  };
}

/**
 * Fixed-window counter per IP. Throws 429 with Retry-After once `limit`
 * requests have been made in the current `windowSec` window.
 */
export async function rateLimit(env: Env, request: Request, scope: string, limit: number, windowSec = 60): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const now = Date.now();
  const window = Math.floor(now / (windowSec * 1000));
  const expires = (window + 1) * windowSec * 1000;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`,
  ).bind(`${scope}:${ip}:${window}`, expires).first<{ count: number }>();
  // Old windows are useless; sweep them now and then.
  if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(now).run();
  if ((row?.count ?? 0) > limit) {
    const retry = Math.max(1, Math.ceil((expires - now) / 1000));
    throw new ApiError(429, "rate_limited", "Too many attempts. Wait a minute and try again.", { "Retry-After": String(retry) });
  }
}

// ---------------------------------------------------------------------------
// Spotify track snapshots (migrations/0002_track_snapshots.sql)

/**
 * Statements that store or replace snapshots for an account. Each chunk is one
 * JSON parameter expanded with json_each, so a 5,000-track playlist takes a
 * handful of statements instead of one per track.
 */
export function snapshotWrites(env: Env, userId: string, snapshots: Track[], now = Date.now()): D1PreparedStatement[] {
  return chunkJson(snapshots).map((chunk) =>
    env.DB.prepare(
      `INSERT INTO track_snapshots (user_id, track_id, json, updated_at)
       SELECT ?1, json_extract(value, '$.id'), value, ?2 FROM json_each(?3) WHERE true
       ON CONFLICT(user_id, track_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    ).bind(userId, now, chunk),
  );
}

/** The account's snapshots for whichever of `ids` are Spotify tracks. */
export async function loadSnapshots(env: Env, userId: string, ids: string[]): Promise<Map<string, Track>> {
  const wanted = [...new Set(ids.filter(isSpotifyTrackId))];
  const out = new Map<string, Track>();
  if (!wanted.length) return out;
  const results = await env.DB.batch<{ track_id: string; json: string }>(
    chunkJson(wanted).map((chunk) =>
      env.DB.prepare("SELECT track_id, json FROM track_snapshots WHERE user_id = ?1 AND track_id IN (SELECT value FROM json_each(?2))")
        .bind(userId, chunk),
    ),
  );
  for (const res of results) {
    for (const row of res.results) {
      try {
        out.set(row.track_id, JSON.parse(row.json) as Track);
      } catch {
        // A broken row reads as a missing track.
      }
    }
  }
  return out;
}

/** Deletes the account's snapshots that no like, history entry or playlist points at any more. */
export function pruneSnapshots(env: Env, userId: string): D1PreparedStatement {
  return env.DB.prepare(
    `DELETE FROM track_snapshots WHERE user_id = ?1
       AND track_id NOT IN (SELECT track_id FROM likes WHERE user_id = ?1)
       AND track_id NOT IN (SELECT track_id FROM history WHERE user_id = ?1)
       AND track_id NOT IN (SELECT j.value FROM playlists p, json_each(p.track_ids) j WHERE p.user_id = ?1)`,
  ).bind(userId);
}
