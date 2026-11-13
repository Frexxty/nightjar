-- Accounts. Emails are stored lower-cased; username_lower enforces
-- case-insensitive uniqueness while `username` keeps the chosen casing.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Only the SHA-256 of a session token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- SoundCloud track IDs the account liked or reposted.
CREATE TABLE likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX likes_recent ON likes(user_id, created_at DESC);

CREATE TABLE reposts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX reposts_recent ON reposts(user_id, created_at DESC);

-- SoundCloud user IDs the account follows.
CREATE TABLE follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sc_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, sc_user_id)
);
CREATE INDEX follows_recent ON follows(user_id, created_at DESC);

-- Playlists saved to the account. track_ids is a JSON array of SoundCloud
-- track IDs in order. artwork_url and duration_ms are filled in when the
-- list is written so the sidebar list doesn't need SoundCloud.
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  track_ids TEXT NOT NULL DEFAULT '[]',
  track_count INTEGER NOT NULL DEFAULT 0,
  artwork_url TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX playlists_user ON playlists(user_id, created_at DESC);

-- One row per (account, track); replaying a track moves it to the top.
CREATE TABLE history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX history_recent ON history(user_id, played_at DESC);

-- Fixed-window counters for per-IP rate limits. key = scope:ip:window.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expires ON rate_limits(expires_at);

-- Small server state, such as the cached SoundCloud client_id.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
