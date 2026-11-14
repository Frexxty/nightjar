import { reactive, shallowRef, triggerRef } from "vue";
import { backendKey, canonicalHostedUrl, HOSTED_URL, normalizeBackendConfig, sessionToken, withSessionToken, type BackendConfig } from "./config";
import { HttpBackend } from "./http";
import { MockBackend } from "./mock";
import type { Backend } from "./types";

export * from "./types";
export * from "./errors";
export { sessionToken, type BackendConfig, type BackendKind } from "./config";

/** The hosted backend's base URL. `VITE_BACKEND_URL` points builds at another copy of it. */
export const HOSTED_BASE_URL = canonicalHostedUrl(import.meta.env.VITE_BACKEND_URL || HOSTED_URL);

// localStorage keys keep the "stratus." prefix from before the rename, so
// existing installs and browsers keep their settings, sessions and library.
const KEY = "stratus.backend";

export function loadBackendConfig(): BackendConfig {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    // Corrupt or unavailable storage counts as a new install.
  }
  return normalizeBackendConfig(raw, HOSTED_BASE_URL);
}

function saveBackendConfig(config: BackendConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Not fatal; the choice lasts for this session.
  }
}

const expiredHandlers = new Set<() => void>();

/** Runs `handler` when the server rejects the saved session. Returns an unsubscribe function. */
export function onSessionExpired(handler: () => void) {
  expiredHandlers.add(handler);
  return () => expiredHandlers.delete(handler);
}

function expireSession() {
  if (!sessionToken(backendConfig.value)) return;
  setSessionToken("");
  for (const handler of expiredHandlers) handler();
}


// One demo backend per window. It is slow to build, and signing in or out of
// the demo account should keep its state.
let mock: MockBackend | null = null;

export function createBackend(config: BackendConfig): Backend {
  const onUnauthorized = () => queueMicrotask(expireSession);
  if (config.kind === "hosted") return new HttpBackend(HOSTED_BASE_URL, config.hostedToken, { name: "Nightjar", onUnauthorized });
  if (config.kind === "http") return new HttpBackend(config.baseUrl, config.token, { name: "Custom server", onUnauthorized });
  return (mock ??= new MockBackend());
}

/** The saved config the active backend was built from. */
export const backendConfig = shallowRef<BackendConfig>(loadBackendConfig());

/** The active backend. Views read `api.value`; Settings and sign-in swap it. */
export const api = shallowRef<Backend>(createBackend(backendConfig.value));

export function useBackend(config: BackendConfig) {
  saveBackendConfig(config);
  backendConfig.value = { ...config };
  api.value = createBackend(config);
  // The demo backend is a single instance, so assigning it again changes
  // nothing; trigger anyway so views reload as if it were new.
  triggerRef(api);
}

/** Stores (or with "" clears) the session token for the current backend and rebuilds it. */
export function setSessionToken(token: string) {
  useBackend(withSessionToken(loadBackendConfig(), token));
}

// Features a backend turned out not to support (it answered 501), remembered
// per backend so the UI hides them instead of failing every time.
const UNSUPPORTED_KEY = "stratus.unsupported";
export type OptionalFeature = "comments";

const unsupported = reactive<Record<string, OptionalFeature[]>>(loadUnsupported());

function loadUnsupported(): Record<string, OptionalFeature[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(UNSUPPORTED_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function isUnsupported(feature: OptionalFeature) {
  return unsupported[backendKey(backendConfig.value, HOSTED_BASE_URL)]?.includes(feature) ?? false;
}

export function markUnsupported(feature: OptionalFeature) {
  const key = backendKey(backendConfig.value, HOSTED_BASE_URL);
  if (unsupported[key]?.includes(feature)) return;
  unsupported[key] = [...(unsupported[key] ?? []), feature];
  try {
    localStorage.setItem(UNSUPPORTED_KEY, JSON.stringify(unsupported));
  } catch {
    // Still hidden for this session.
  }
}
