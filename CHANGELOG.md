# Changelog

Each release's section becomes its GitHub release notes and the notes shown in the in-app update dialog. Add a section before tagging.

## 0.2.0

Stratus now works with real SoundCloud music out of the box, and your library follows you between the Mac, Windows and your phone.

- Stratus accounts. Sign up in the app to keep likes, follows, history and playlists on the hosted backend at stratus-api.k3s.lat. New installs use it by default; Demo data and custom servers are still in Settings.
- Spotify import matches against real SoundCloud search and saves straight to your library. Matching is stricter: mashups, sing-offs, 8D and no-autotune uploads, wrong-length rips and 30-second previews are flagged for you to check instead of being accepted.
- Web player at stratus-app.k3s.lat with a phone layout (tab bar, mini player, swipe-down now playing). On iPhone, open it in Safari and use Share, Add to Home Screen.
- Tracks that only have a 30-second preview are labelled "Preview".
- Lower CPU and memory use, especially with the window hidden and in the immersive player.

## 0.1.0

First release.

- Cider-style layout: vibrancy sidebar, top bar with transport controls and an LCD now-playing display, a right-hand drawer, and a full-window immersive player.
- Import public Spotify playlists and albums with no Spotify account or API key: every track is matched on SoundCloud, you review the matches, then save the playlist locally or to your backend. Long playlists are read in full; a paste or Exportify CSV option covers the rest.
- Timed comments drawer synced to playback, Up Next queue with drag-to-reorder, and related-track autoplay when the queue runs out.
- Pluggable backend over HTTP (see `BACKEND.md`), with a built-in mock so everything works without a server.
- Installers for macOS (Apple silicon and Intel) and Windows.
- Windows tray icon with playback controls.
- Automatic updates from GitHub Releases, with an optional beta channel in Settings.
