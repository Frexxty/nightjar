-- Spotify tracks saved in likes, playlists and history (docs/spotify.md).
-- The server can't call Spotify, so it keeps the Track the client sent. There
-- is one copy per account and track, read only for that account's likes,
-- history and playlists, so one account can't rewrite what another sees.
-- likes.track_id, history.track_id and playlists.track_ids point here with
-- "spotify:track:<id>" IDs.
CREATE TABLE track_snapshots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);
