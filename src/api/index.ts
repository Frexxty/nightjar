import { shallowRef } from "vue";
import { HttpBackend } from "./http";
import { MockBackend } from "./mock";
import type { Backend } from "./types";

export * from "./types";

export interface BackendConfig {
  kind: "mock" | "http";
  baseUrl: string;
  token: string;
}

const KEY = "stratus.backend";

export function loadBackendConfig(): BackendConfig {
  const fallback: BackendConfig = {
    kind: import.meta.env.VITE_BACKEND_URL ? "http" : "mock",
    baseUrl: import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787",
    token: "",
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

export function createBackend(config: BackendConfig): Backend {
  return config.kind === "http" ? new HttpBackend(config.baseUrl, config.token || undefined) : new MockBackend();
}

/** The active backend. Views read `api.value`; Settings swaps it. */
export const api = shallowRef<Backend>(createBackend(loadBackendConfig()));

export function useBackend(config: BackendConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Not fatal; the choice lasts for this session.
  }
  api.value = createBackend(config);
}
