// Spotify Web API client: bearer token from useSpotify(), one retry after a
// refresh on 401, and waits out 429 Retry-After. Errors carry Spotify's
// `reason` (PREMIUM_REQUIRED, NO_ACTIVE_DEVICE...) and a message in plain words.
import { useSpotify } from "./auth";

export const API_BASE = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  status: number;
  reason: string | null;
  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.reason = reason;
  }
}

/** Plain words for a Web API error. */
export function spotifyErrorMessage(status: number, reason: string | null, message: string): string {
  if (reason === "PREMIUM_REQUIRED") return "Playing Spotify needs Spotify Premium.";
  if (reason === "NO_ACTIVE_DEVICE" || (status === 404 && /device/i.test(message))) {
    return "No active Spotify device. Open Spotify on your phone or computer, play something, then try again.";
  }
  if (status === 401) return "Your Spotify session expired. Reconnect Spotify in Settings.";
  if (status === 403 && /user may not be registered|not registered/i.test(message)) {
    return "This Spotify account isn't on your app's user list. Add it under User Management in the Spotify developer dashboard.";
  }
  if (status === 403) return `Spotify refused this${message ? `: ${message}` : "."}`;
  if (status === 404) return "Spotify couldn't find that.";
  if (status === 429) return "Spotify is rate-limiting Nightjar. Wait a moment and try again.";
  if (status >= 500) return "Spotify is having trouble right now. Try again in a moment.";
  return message || `Spotify error ${status}`;
}

type Query = Record<string, string | number | boolean | null | undefined>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls the Web API. `path` starts with "/" (relative to /v1) or is a full `next` URL from a paging object. */
export async function spotifyRequest<T>(method: string, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
  const auth = useSpotify();
  const url = new URL(path.startsWith("http") ? path : API_BASE + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }

  let forced = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await auth.accessToken(forced);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch {
      throw new SpotifyApiError("Couldn't reach Spotify. Check your connection.", 0);
    }

    if (res.status === 401 && !forced) {
      forced = true;
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(30, Number(res.headers.get("Retry-After")) || 2);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = body?.error;
      const reason = typeof err?.reason === "string" ? err.reason : null;
      const message = typeof err?.message === "string" ? err.message : typeof err === "string" ? err : "";
      throw new SpotifyApiError(spotifyErrorMessage(res.status, reason, message), res.status, reason);
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  throw new SpotifyApiError(spotifyErrorMessage(429, null, ""), 429);
}

export const spGet = <T>(path: string, query?: Query) => spotifyRequest<T>("GET", path, { query });
