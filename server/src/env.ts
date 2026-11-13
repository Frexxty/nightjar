export interface Env {
  DB: D1Database;
  /** Cloudflare Browser Rendering, used to read Spotify lists over 100 tracks. Optional. */
  BROWSER?: Fetcher;
  /** 32 random bytes, base64url. Encrypts stored Spotify tokens (src/spotifyLink.ts). Set with `wrangler secret put`. */
  SPOTIFY_TOKEN_KEY?: string;
}
