/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
}

interface StratusBridge {
  platform: string;
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
