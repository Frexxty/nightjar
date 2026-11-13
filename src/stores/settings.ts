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
}

const KEY = "stratus.settings";
const defaults: Settings = {
  accent: "#ff5500",
  theme: "dark",
  autoplayRelated: true,
  showCommentsOnWaveform: true,
  immersiveMotion: true,
  keepPlayingInTray: true,
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
