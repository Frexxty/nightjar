# Changelog

Each release's section becomes its GitHub release notes and the notes shown in the in-app update dialog. Add a section before tagging.

## 0.1.0

First release.

- Cider-style layout: vibrancy sidebar, top bar with transport controls and an LCD now-playing display, a right-hand drawer, and a full-window immersive player.
- Import public Spotify playlists and albums with no Spotify account or API key: every track is matched on SoundCloud, you review the matches, then save the playlist locally or to your backend. Long playlists are read in full; a paste or Exportify CSV option covers the rest.
- Timed comments drawer synced to playback, Up Next queue with drag-to-reorder, and related-track autoplay when the queue runs out.
- Pluggable backend over HTTP (see `BACKEND.md`), with a built-in mock so everything works without a server.
- Installers for macOS (Apple silicon and Intel) and Windows, with in-app updates from GitHub Releases.
- Windows tray icon with playback controls.
- Automatic updates from GitHub Releases, with an optional beta channel in Settings.
