// Authorization Code with PKCE (RFC 7636) for Spotify sign-in. See docs/spotify.md.
// No imports, so `node --test` can load this file directly (tests/spotifyAuth.test.ts).

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-library-modify",
  "user-follow-read",
  // Not in the contract's original list: Home's "Recently played" and "Your top tracks" shelves need these.
  "user-read-recently-played",
  "user-top-read",
];

export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const DESKTOP_REDIRECT_URI = "http://127.0.0.1:43821/callback";
export const WEB_CALLBACK_PATH = "/spotify-callback";

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A random string of unreserved characters, 43 to 128 long (RFC 7636 section 4.1). */
export function randomVerifier(length = 64): string {
  if (length < 43 || length > 128) throw new RangeError("A PKCE verifier is 43 to 128 characters long");
  // 66 characters: bytes of 198 and up are dropped so `% 66` stays uniform.
  const limit = UNRESERVED.length * Math.floor(256 / UNRESERVED.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += UNRESERVED[b % UNRESERVED.length];
    }
  }
  return out;
}

/** S256 challenge: base64url(sha256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const randomState = () => base64url(crypto.getRandomValues(new Uint8Array(16)));

/** Spotify Client IDs are 32 hex characters. */
export const isClientId = (value: string) => /^[0-9a-f]{32}$/i.test(value.trim());

export function authorizeUrl(options: { clientId: string; redirectUri: string; challenge: string; state: string; scopes?: string[] }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("state", options.state);
  url.searchParams.set("scope", (options.scopes ?? SPOTIFY_SCOPES).join(" "));
  return url.toString();
}

export type CallbackResult = { code: string; state: string } | { error: string; state: string | null };

/** Reads `?code=&state=` or `?error=&state=` from a redirect URL or its query string. */
export function parseCallback(query: string | URLSearchParams): CallbackResult {
  const params = typeof query === "string" ? new URLSearchParams(query.includes("?") ? query.slice(query.indexOf("?") + 1) : query) : query;
  const state = params.get("state");
  const error = params.get("error");
  const code = params.get("code");
  if (error) return { error, state };
  if (!code) return { error: "missing_code", state };
  if (!state) return { error: "missing_state", state: null };
  return { code, state };
}

/** Plain words for the `error` Spotify puts on the redirect. */
export function callbackErrorMessage(error: string): string {
  switch (error) {
    case "access_denied": return "Spotify sign-in was cancelled.";
    case "missing_code": return "Spotify didn't send a sign-in code back.";
    case "missing_state":
    case "state_mismatch": return "The Spotify sign-in reply didn't match this request. Try connecting again.";
    case "timeout": return "Spotify sign-in timed out. Try connecting again.";
    default: return `Spotify sign-in failed (${error}).`;
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

/** Turns a token endpoint reply into a TokenSet. Spotify may omit `refresh_token` on refresh; keep the old one then. */
export function readTokenReply(body: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }, now: number, previousRefresh: string | null = null): TokenSet {
  if (!body.access_token) throw new Error("Spotify didn't return an access token.");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? previousRefresh,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    scope: body.scope ?? "",
  };
}

/** True when the token is missing or expires within `marginMs`. */
export const needsRefresh = (tokens: TokenSet | null, now: number, marginMs = 60_000) => !tokens || tokens.expiresAt - marginMs <= now;

/** Plain words for a token endpoint error body (`{ error, error_description }`). */
export function tokenErrorMessage(status: number, body: { error?: string; error_description?: string } | null): string {
  const code = body?.error ?? "";
  const description = body?.error_description ?? "";
  if (code === "invalid_client") return "Spotify doesn't recognise that Client ID. Check it in your Spotify developer dashboard.";
  if (code === "invalid_grant" && /redirect/i.test(description)) return "The redirect URI isn't registered in your Spotify app. Add it in the Spotify developer dashboard.";
  if (code === "invalid_grant") return "Spotify rejected the sign-in code or the saved session. Connect again.";
  return `Spotify sign-in failed (${status}${code ? `, ${code}` : ""}${description ? `: ${description}` : ""}).`;
}
