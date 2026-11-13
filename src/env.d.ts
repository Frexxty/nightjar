/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
}

interface SpotifyListTrack {
  /** Null for local files in a playlist. */
  spotifyId: string | null;
  title: string;
  artists: string[];
  durationMs: number | null;
  explicit: boolean;
}

interface SpotifyList {
  id: string;
  kind: "playlist" | "album";
  url: string;
  name: string;
  owner: string | null;
  coverUrl: string | null;
  /** Track count Spotify reports, or null when only the first 100 could be read. */
  total: number | null;
  /** True when `tracks` is missing part of the list. */
  truncated: boolean;
  /** "embed": the 100-track embed page. "page": the full web page, read in a hidden window. */
  source: "embed" | "page";
  /** Why the list is incomplete, in plain words. */
  notice: string | null;
  tracks: SpotifyListTrack[];
}

interface StratusBridge {
  platform: string;
  spotify: {
    /** Accepts playlist or album links, spotify: URIs and bare playlist IDs. Rejects with a readable message. */
    fetchPlaylist(url: string): Promise<SpotifyList>;
  };
  reportPlayback(state: {
    state: "stopped" | "playing" | "paused";
    track: { id: string; title: string; artist: string } | null;
    liked: boolean;
  }): void;
  window(action: "toggle-fullscreen" | "set-fullscreen" | "set-theme" | "open-external", value?: unknown): void;
  onCommand(handler: (command: string, payload?: unknown) => void): () => void;
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
