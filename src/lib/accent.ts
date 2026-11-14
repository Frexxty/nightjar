// Accent colours. No imports, so `node --test` can load this file directly.

/** Ember, the Nightjar accent (brand/README.md). Also `--accent` in main.css. */
export const DEFAULT_ACCENT = "#EF5035";

/** The swatches in Settings. Ember first, then the system-style colours. */
export const ACCENTS = [DEFAULT_ACCENT, "#ff2d55", "#bf5af2", "#0a84ff", "#30d158", "#ffd60a", "#e5e5ea"];

/**
 * SoundCloud orange, the default and first swatch before the rename. Settings
 * are saved whole, so every install that never touched the accent has it
 * stored. Ember took its place in the swatch row, so it maps to Ember.
 */
const LEGACY_DEFAULT_ACCENT = "#ff5500";

export function migrateAccent(accent: unknown): string | undefined {
  if (typeof accent !== "string") return undefined;
  return accent.trim().toLowerCase() === LEGACY_DEFAULT_ACCENT ? DEFAULT_ACCENT : accent;
}
