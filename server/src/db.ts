// D1 access for accounts, sessions and rate limits.
import { ApiError } from "./http.ts";
import { SESSION_DAYS, bearerToken, newToken, sha256 } from "./auth.ts";
import type { Env } from "./env.ts";
import type { User } from "./types.ts";

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

/** The `User` for a Stratus account. Counts come from D1. */
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
