// A Stratus account's Spotify sign-in, held server-side so every device shares
// it (docs/hosted-api.md, "Spotify sign-in"). Spotify rotates the refresh token
// each time it's used, which breaks if several devices each keep a copy, so
// only the server refreshes and devices get short-lived access tokens.
// Pure helpers take their dependencies as arguments so tests can run them in Node.
import { ApiError, b64url, badInput, fromB64url } from "./http.ts";

export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
/** Hand out a cached access token only if it lives at least this long. */
const MIN_TTL_MS = 5 * 60 * 1000;

export interface SpotifyProfileSnapshot {
  id: string;
  displayName: string;
  product: string | null;
  country: string | null;
  avatarUrl: string | null;
}

export interface LinkRow {
  user_id: string;
  client_id: string;
  refresh_enc: string;
  access_enc: string | null;
  access_expires_at: number | null;
  scope: string;
  profile_json: string | null;
  version: number;
  updated_at: number;
}

export const isClientId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/i.test(v);

// ---------------------------------------------------------------------------
// Encryption: AES-256-GCM, stored as base64url(iv || ciphertext).

export async function importKey(secret: string | undefined): Promise<CryptoKey> {
  const raw = secret ? fromB64url(secret.trim()) : new Uint8Array();
  if (raw.length !== 32) throw new ApiError(503, "not_configured", "Spotify sign-in isn't set up on this server.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, text: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // The user ID is authenticated data, so a row copied to another account won't decrypt.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

export async function open(key: CryptoKey, sealed: string, userId: string): Promise<string> {
  const bytes = fromB64url(sealed);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(userId) }, key, bytes.subarray(12),
  );
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// Spotify token endpoint

export interface TokenReply {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export class SpotifyGrantError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Refreshes a PKCE session. Spotify may return a new refresh token; keep the old one when it doesn't. */
export async function refreshAtSpotify(clientId: string, refreshToken: string, now: number, doFetch: Fetch = fetch): Promise<TokenReply> {
  let res: Response;
  try {
    res = await doFetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
    });
  } catch {
    throw new ApiError(502, "spotify_unreachable", "Couldn't reach Spotify. Try again in a moment.");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = typeof body?.error === "string" ? body.error : `http_${res.status}`;
    // invalid_grant: revoked or already-rotated refresh token. invalid_client: the app was deleted or the ID is wrong.
    if (code === "invalid_grant" || code === "invalid_client") throw new SpotifyGrantError(code, String(body?.error_description ?? code));
    throw new ApiError(502, "spotify_error", `Spotify refused the refresh (${code}).`);
  }
  if (typeof body?.access_token !== "string") throw new ApiError(502, "spotify_error", "Spotify didn't return an access token.");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : refreshToken,
    expiresAt: now + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

/** True when the cached access token can be handed out as is. */
export const cachedTokenUsable = (row: Pick<LinkRow, "access_enc" | "access_expires_at">, now: number, force: boolean) =>
  !force && !!row.access_enc && (row.access_expires_at ?? 0) - MIN_TTL_MS > now;

// ---------------------------------------------------------------------------
// Input checks

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"<>]{1,500}$/.test(v) ? v : null);

/** The profile the client read from Spotify's /me, trimmed to known fields. */
export function cleanProfile(v: unknown): SpotifyProfileSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const id = str(p.id, 100);
  if (!id) return null;
  return {
    id,
    displayName: str(p.displayName, 200) ?? id,
    product: str(p.product, 30),
    country: str(p.country, 4),
    avatarUrl: https(p.avatarUrl),
  };
}

export function readLinkInput(body: Record<string, unknown>) {
  if (!isClientId(body.clientId)) throw badInput("clientId must be the 32-character Client ID of your Spotify app.");
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (!refreshToken || refreshToken.length > 2000) throw badInput("Send the refreshToken from your Spotify sign-in.");
  return { clientId: body.clientId.toLowerCase(), refreshToken, profile: cleanProfile(body.profile) };
}

/** What GET /me/spotify returns. Never includes tokens. */
export function publicLink(row: LinkRow | null) {
  if (!row) return { connected: false as const };
  let profile: SpotifyProfileSnapshot | null = null;
  try {
    profile = row.profile_json ? cleanProfile(JSON.parse(row.profile_json)) : null;
  } catch {
    profile = null;
  }
  return { connected: true as const, clientId: row.client_id, scope: row.scope, profile, updatedAt: new Date(row.updated_at).toISOString() };
}
