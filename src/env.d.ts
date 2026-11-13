/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
}

// Defined in src/api/types.ts so the backend's Spotify import can share them.
// Import types keep this file a global script (a top-level import would not).
type SpotifyListTrack = import("./api/types").SpotifyListTrack;
type SpotifyList = import("./api/types").SpotifyList;

interface UpdateState {
  status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  /** Release notes as markdown. */
  notes?: string;
  /** 0-100 while downloading. */
  progress?: number;
  error?: string;
}

interface UpdateInfo {
  /** False in dev builds without STRATUS_UPDATE_FEED, and on Linux. */
  enabled: boolean;
  currentVersion: string;
  beta: boolean;
  skippedVersion: string | null;
  /** Epoch ms of the last finished check. */
  lastChecked: number | null;
  state: UpdateState;
}

interface DrmStatus {
  /**
   * "ready": the Widevine CDM is installed and Spotify can play.
   * "updating": the first install is still downloading.
   * "unavailable": no CDM (stock Electron build, or the install failed).
   */
  widevine: "ready" | "unavailable" | "updating";
  /** Installed CDM version, e.g. "4.10.2934.0", or null. */
  version: string | null;
}

interface StratusBridge {
  platform: string;
  drm: {
    status(): Promise<DrmStatus>;
    /** Fires when the status changes, e.g. a first install finishing after the window opened. */
    onStatus(handler: (status: DrmStatus) => void): () => void;
  };
  spotify: {
    /** Accepts playlist or album links, spotify: URIs and bare playlist IDs. Rejects with a readable message. */
    fetchPlaylist(url: string): Promise<SpotifyList>;
  };
  reportPlayback(state: {
    state: "stopped" | "playing" | "paused";
    track: { id: string; title: string; artist: string } | null;
    liked: boolean;
  }): void;
  window(action: "toggle-fullscreen" | "set-fullscreen" | "set-theme" | "open-external" | "set-tray-on-close", value?: unknown): void;
  onCommand(handler: (command: string, payload?: unknown) => void): () => void;
  updates: {
    getInfo(): Promise<UpdateInfo>;
    check(): Promise<UpdateInfo>;
    download(): Promise<void>;
    install(): Promise<void>;
    skip(version: string | null): Promise<UpdateInfo>;
    setBeta(beta: boolean): Promise<UpdateInfo>;
    onState(handler: (state: UpdateState) => void): () => void;
  };
}

interface Window {
  /** Present when running inside Electron; undefined in a plain browser. */
  stratus?: StratusBridge;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
