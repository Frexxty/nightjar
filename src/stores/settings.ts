import { defineStore } from "pinia";
import { reactive, watch } from "vue";

export interface Settings {
  accent: string;
  theme: "dark" | "light" | "system";
  autoplayRelated: boolean;
  showCommentsOnWaveform: boolean;
  immersiveMotion: boolean;
  /** Windows: closing the window hides it to the tray instead of quitting. */
  keepPlayingInTray: boolean;
  /** Where catalogue pages (Home, Search, Likes) come from. Null until chosen; treated as SoundCloud. See docs/spotify.md. */
  musicSource: "soundcloud" | "spotify" | null;
  /** Spotify tracks: play inside Stratus (Web Playback SDK) or remote-control another Spotify device (Connect). */
  spotifyPlayback: "this-device" | "remote";
  /** Connect target for "remote", from GET /me/player/devices. Null picks the active device. */
  spotifyDeviceId: string | null;
}

// iOS suspends the Web Playback SDK when the screen locks or the tab is in the
// background, so phones default to controlling the Spotify app instead.
const isMobileBrowser = !window.stratus && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const KEY = "stratus.settings";
const defaults: Settings = {
  accent: "#ff5500",
  theme: "dark",
  autoplayRelated: true,
  showCommentsOnWaveform: true,
  immersiveMotion: true,
  keepPlayingInTray: true,
  musicSource: null,
  spotifyPlayback: isMobileBrowser ? "remote" : "this-device",
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

  return settings;
});
