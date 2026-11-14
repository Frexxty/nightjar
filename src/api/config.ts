// Which backend to use, and how a saved choice from an older version maps onto
// today's kinds. No imports, so `node --test` can load this file directly.

export const HOSTED_URL = "https://nightjar-api.k3s.lat/v1";

/**
 * Where the hosted backend lived before the rename to Nightjar. The same
 * Worker still answers there, so 0.3.x apps keep working, but saved configs
 * that name it are moved to HOSTED_URL.
 */
export const LEGACY_HOSTED_URLS = ["https://stratus-api.k3s.lat/v1"];

/** "hosted": the Nightjar account server. "http": a server you run. "mock": demo data. */
export type BackendKind = "hosted" | "http" | "mock";

export interface BackendConfig {
  kind: BackendKind;
  /** Custom server URL, used when `kind` is "http". */
  baseUrl: string;
  /** Bearer token for the custom server, typed in Settings or set by signing in there. */
  token: string;
  /** Session token for the Nightjar account on the hosted backend. */
  hostedToken: string;
}

export const DEFAULT_CUSTOM_URL = "http://localhost:8787";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");

/** Maps the hosted backend's old address to its current one. Other URLs come back trimmed. */
export function canonicalHostedUrl(url: string): string {
  const trimmed = trimSlash(url);
  return LEGACY_HOSTED_URLS.some((old) => trimSlash(old).toLowerCase() === trimmed.toLowerCase()) ? HOSTED_URL : trimmed;
}

/**
 * Turns whatever is in localStorage into a full config. Nothing saved means a
 * new install, which gets the hosted backend. Older versions saved
 * `{ kind: "mock" | "http", baseUrl, token }`. Their "mock" becomes "hosted"
 * (demo data was simply the old default), "http" keeps working, and an "http"
 * entry that points at the hosted URL, old or new, becomes "hosted" with its
 * token.
 */
export function normalizeBackendConfig(raw: unknown, hostedUrl = HOSTED_URL): BackendConfig {
  const saved = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: BackendConfig = {
    kind: "hosted",
    baseUrl: str(saved.baseUrl) || DEFAULT_CUSTOM_URL,
    token: str(saved.token),
    hostedToken: str(saved.hostedToken),
  };
  // 0.1.0 had no accounts and demo data was its default, so a saved "mock"
  // from then (no hostedToken key) moves to the hosted backend. A "mock"
  // picked in today's Settings is saved with hostedToken and stays.
  if (saved.kind === "mock" && "hostedToken" in saved) config.kind = "mock";
  else if (saved.kind === "http") {
    const url = canonicalHostedUrl(config.baseUrl);
    if (url === canonicalHostedUrl(hostedUrl)) {
      config.kind = "hosted";
      config.hostedToken ||= config.token;
      config.token = "";
      config.baseUrl = DEFAULT_CUSTOM_URL;
    } else config.kind = "http";
  }
  return config;
}

/** The session token the current kind uses. */
export function sessionToken(config: BackendConfig): string {
  if (config.kind === "hosted") return config.hostedToken;
  if (config.kind === "http") return config.token;
  return "";
}

/** A copy of `config` with the current kind's session token replaced. */
export function withSessionToken(config: BackendConfig, token: string): BackendConfig {
  if (config.kind === "hosted") return { ...config, hostedToken: token };
  if (config.kind === "http") return { ...config, token };
  return { ...config };
}

/** Identifies a backend for things remembered per server, like missing features. */
export function backendKey(config: BackendConfig, hostedUrl = HOSTED_URL): string {
  if (config.kind === "hosted") return `hosted:${trimSlash(hostedUrl)}`;
  if (config.kind === "http") return `http:${trimSlash(config.baseUrl)}`;
  return "mock";
}
