-- A Stratus account's Spotify sign-in (docs/hosted-api.md, "Spotify sign-in").
-- Spotify rotates refresh tokens on every use, so one copy per account lives
-- here and every device asks the server for access tokens instead of keeping
-- its own refresh token. Tokens are AES-GCM encrypted with the Worker secret
-- SPOTIFY_TOKEN_KEY. Only the request holding `lock_until` talks to Spotify,
-- so two devices refreshing at the same moment can't spend the same refresh
-- token twice; `version` goes up on every refresh so waiters see the new token.
CREATE TABLE spotify_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  refresh_enc TEXT NOT NULL,
  access_enc TEXT,
  access_expires_at INTEGER,
  scope TEXT NOT NULL DEFAULT '',
  profile_json TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER,
  updated_at INTEGER NOT NULL
);
