// Which backend to use, and how a saved choice from an older version maps onto
// today's kinds. No imports, so `node --test` can load this file directly.

export const HOSTED_URL = "https://stratus-api.k3s.lat/v1";

/** "hosted": the Stratus account server. "http": a server you run. "mock": demo data. */
export type BackendKind = "hosted" | "http" | "mock";

export interface BackendConfig {
  kind: BackendKind;
  /** Custom server URL, used when `kind` is "http". */
  baseUrl: string;
  /** Bearer token for the custom server, typed in Settings or set by signing in there. */
  token: string;
  /** Session token for the Stratus account on the hosted backend. */
  hostedToken: string;
}

export const DEFAULT_CUSTOM_URL = "http://localhost:8787";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");

/**
 * Turns whatever is in localStorage into a full config. Nothing saved means a
 * new install, which gets the hosted backend. Older versions saved
 * `{ kind: "mock" | "http", baseUrl, token }`; those keep working, and an
 * "http" entry that points at the hosted URL becomes "hosted" with its token.
 */
export function normalizeBackendConfig(raw: unknown, hostedUrl = HOSTED_URL): BackendConfig {
  const saved = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: BackendConfig = {
    kind: "hosted",
    baseUrl: str(saved.baseUrl) || DEFAULT_CUSTOM_URL,
    token: str(saved.token),
    hostedToken: str(saved.hostedToken),
  };
  if (saved.kind === "mock") config.kind = "mock";
  else if (saved.kind === "http") {
    if (trimSlash(config.baseUrl) === trimSlash(hostedUrl)) {
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
