// SoundCloud api-v2 client: client_id discovery, retries, caching and errors.
import { ApiError, notFound } from "./http.ts";
import type { Env } from "./env.ts";
import { normalizeWaveform, waveformJsonUrl } from "./map.ts";
import type { ScTrack } from "./types.ts";

const API = "https://api-v2.soundcloud.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CACHE_ORIGIN = "https://cache.stratus-api.internal";

// Module scope survives between requests on a warm isolate. D1 keeps it across
// cold starts so a new isolate doesn't scrape soundcloud.com every time.
let clientId: string | null = null;
let refreshing: Promise<string> | null = null;

/** Finds the web client's client_id in soundcloud.com's script bundles, last bundle first. */
export async function scrapeClientId(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://soundcloud.com/", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
  });
  if (!res.ok) throw new ApiError(502, "upstream_error", `soundcloud.com answered ${res.status} while looking for a client_id.`);
  const html = await res.text();
  const scripts = [...new Set([...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\s]+\.js/g)].map((m) => m[0]))];
  for (const src of scripts.reverse()) {
    const js = await (await fetchImpl(src, { headers: { "User-Agent": UA } })).text();
    const m = js.match(/client_id\s*:\s*"([A-Za-z0-9]{32})"/);
    if (m) return m[1];
  }
  throw new ApiError(502, "upstream_error", "Couldn't find SoundCloud's client_id.");
}

async function loadClientId(env: Env): Promise<string> {
  if (clientId) return clientId;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'sc_client_id'").first<{ value: string }>();
  if (row?.value) return (clientId = row.value);
  return refreshClientId(env, null);
}

async function refreshClientId(env: Env, rejected: string | null): Promise<string> {
  // Another request may already have replaced the rejected id.
  if (clientId && clientId !== rejected) return clientId;
  refreshing ??= (async () => {
    try {
      const id = await scrapeClientId();
      clientId = id;
      await env.DB.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES ('sc_client_id', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2",
      ).bind(id, Date.now()).run();
      return id;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface ScGetOptions {
  /** Seconds to keep the response in the Cache API. 0 skips the cache. */
  ttl?: number;
  /** Return null instead of throwing on 404. */
  allow404?: boolean;
}

function upstreamError(status: number, retryAfter: string | null): ApiError {
  if (status === 429) {
    return new ApiError(503, "upstream_rate_limited", "SoundCloud is rate limiting us. Try again shortly.", { "Retry-After": retryAfter && /^\d+$/.test(retryAfter) ? retryAfter : "30" });
  }
  if (status === 404) return notFound();
  return new ApiError(502, "upstream_error", `SoundCloud answered ${status}.`);
}

async function rawGet(env: Env, pathAndQuery: string): Promise<Response> {
  let id = await loadClientId(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `${API}${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}client_id=${id}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Origin: "https://soundcloud.com", Referer: "https://soundcloud.com/" },
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      id = await refreshClientId(env, id);
      continue;
    }
    return res;
  }
  throw new ApiError(502, "upstream_error", "SoundCloud rejected our client_id.");
}

/**
 * GET from api-v2. `pathAndQuery` must not include client_id. Cached by path
 * when `ttl` is set, so the cache key never holds the client_id.
 */
export async function scGet<T>(env: Env, ctx: ExecutionContext, pathAndQuery: string, opts: ScGetOptions & { allow404: true }): Promise<T | null>;
export async function scGet<T>(env: Env, ctx: ExecutionContext, pathAndQuery: string, opts?: ScGetOptions): Promise<T>;
export async function scGet<T>(env: Env, ctx: ExecutionContext, pathAndQuery: string, opts: ScGetOptions = {}): Promise<T | null> {
  const ttl = opts.ttl ?? 0;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${CACHE_ORIGIN}/sc${pathAndQuery}`);
  if (ttl > 0) {
    const hit = await cache.match(key);
    if (hit) return hit.status === 404 ? null : ((await hit.json()) as T);
  }
  const res = await rawGet(env, pathAndQuery);
  if (res.status === 404 && opts.allow404) {
    if (ttl > 0) ctx.waitUntil(cache.put(key, new Response("{}", { status: 404, headers: { "Cache-Control": `max-age=${Math.min(ttl, 600)}` } })));
    return null;
  }
  if (!res.ok) throw upstreamError(res.status, res.headers.get("Retry-After"));
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new ApiError(502, "upstream_error", "SoundCloud sent something that isn't JSON.");
  }
  if (ttl > 0) {
    ctx.waitUntil(cache.put(key, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } })));
  }
  return data;
}

/** Resolves a transcoding to its short-lived media URL. Never cached. */
export async function resolveTranscoding(env: Env, transcodingUrl: string, trackAuthorization: string | undefined): Promise<string> {
  if (!transcodingUrl.startsWith(`${API}/media/`)) throw new ApiError(502, "upstream_error", "Unexpected transcoding URL from SoundCloud.");
  const path = transcodingUrl.slice(API.length);
  const q = trackAuthorization ? `?track_authorization=${encodeURIComponent(trackAuthorization)}` : "";
  const res = await rawGet(env, path + q);
  if (!res.ok) throw upstreamError(res.status, res.headers.get("Retry-After"));
  const body = (await res.json()) as { url?: string };
  if (!body.url) throw new ApiError(502, "upstream_error", "SoundCloud didn't return a stream URL.");
  return body.url;
}

/**
 * Fetches tracks by ID in batches of 50 and returns them in the order asked,
 * skipping IDs SoundCloud doesn't return (deleted or private).
 */
export async function hydrateTracks(env: Env, ctx: ExecutionContext, ids: (string | number)[], ttl = 3600): Promise<ScTrack[]> {
  const unique = [...new Set(ids.map(String))].filter((id) => /^\d{1,19}$/.test(id));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) batches.push(unique.slice(i, i + 50));
  const byId = new Map<string, ScTrack>();
  const CONCURRENCY = 6;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const results = await Promise.all(
      batches.slice(i, i + CONCURRENCY).map((b) => scGet<ScTrack[]>(env, ctx, `/tracks?ids=${b.join(",")}`, { ttl })),
    );
    for (const list of results) for (const t of list ?? []) byId.set(String(t.id), t);
  }
  return ids.map((id) => byId.get(String(id))).filter((t): t is ScTrack => Boolean(t));
}

/** Waveform peaks for a track, cached for a day. Null when SoundCloud has none. */
export async function fetchWaveform(ctx: ExecutionContext, waveformUrl: string | null | undefined): Promise<number[] | null> {
  const url = waveformJsonUrl(waveformUrl);
  if (!url) return null;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${CACHE_ORIGIN}/wave/${encodeURIComponent(url)}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as number[] | null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const peaks = res.ok ? normalizeWaveform(await res.json()) : null;
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(peaks), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=86400" } })));
    return peaks;
  } catch {
    return null;
  }
}

/** Generic Cache API wrapper for computed JSON (home sections and the like). */
export async function cachedJson<T>(ctx: ExecutionContext, key: string, ttl: number, produce: () => Promise<T>): Promise<T> {
  const cache = (caches as unknown as { default: Cache }).default;
  const req = new Request(`${CACHE_ORIGIN}/computed/${key}`);
  const hit = await cache.match(req);
  if (hit) return (await hit.json()) as T;
  const value = await produce();
  ctx.waitUntil(cache.put(req, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } })));
  return value;
}
