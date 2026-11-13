export interface Env {
  DB: D1Database;
  /** Cloudflare Browser Rendering, used to read Spotify lists over 100 tracks. Optional. */
  BROWSER?: Fetcher;
}
