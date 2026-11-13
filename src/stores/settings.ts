import { defineStore } from "pinia";
import { reactive, toRefs, watch } from "vue";

export type MusicSource = "soundcloud" | "spotify";

export interface Settings {
  accent: string;
  theme: "dark" | "light" | "system";
  autoplayRelated: boolean;
  showCommentsOnWaveform: boolean;
  immersiveMotion: boolean;
  /** Windows: closing the window hides it to the tray instead of quitting. */
  keepPlayingInTray: boolean;
  /** Where music comes from. Null until chosen on /welcome (docs/spotify.md). */
  musicSource: MusicSource | null;
  /** Spotify tracks: play inside Stratus, or remote-control the user's Spotify app. */
  spotifyPlayback: "this-device" | "remote";
  /** Connect target for "remote", from GET /me/player/devices. Null picks the active device. */
  spotifyDeviceId: string | null;
}

const KEY = "stratus.settings";

/**
 * Phone and tablet browsers can't run Spotify's in-page player, so the web
 * player there starts out controlling the Spotify app instead.
 */
export function defaultSpotifyPlayback(): Settings["spotifyPlayback"] {
  if (window.stratus) return "this-device";
  return window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches ? "remote" : "this-device";
}

const defaults: Settings = {
  accent: "#ff5500",
  theme: "dark",
  autoplayRelated: true,
  showCommentsOnWaveform: true,
  immersiveMotion: true,
  keepPlayingInTray: true,
  musicSource: null,
  spotifyPlayback: defaultSpotifyPlayback(),
  spotifyDeviceId: null,
};

export const useSettings = defineStore("settings", () => {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    // Fall back to defaults.
  }
  const settings = reactive<Settings>({ ...defaults, ...saved });

  watch(settings, (value) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Ignore; settings still apply for this session.
    }
  });

  // Refs, not the reactive object itself: Pinia copies plain values out of a
  // returned reactive, so writes through the store never reached `settings`
  // and nothing was saved.
  return toRefs(settings);
});
