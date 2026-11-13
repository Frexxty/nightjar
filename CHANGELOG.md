# Changelog

Each release's section becomes its GitHub release notes and the notes shown in the in-app update dialog. Add a section before tagging.

## 0.3.0

Stratus can now play Spotify's own audio with a Spotify Premium account, so imported playlists play complete instead of being matched on SoundCloud.

- First launch asks where your music should come from: Spotify (Premium) or SoundCloud (free). With SoundCloud, imported Spotify playlists are matched to SoundCloud uploads, and most songs from a typical playlist won't be there. You can switch in Settings.
- Spotify sign-in with your own free Spotify developer app (Spotify allows 5 accounts per app, so everyone creates one). The setup guide walks through it, including the redirect URIs to copy.
- With Spotify as the source, Home, Search and Likes show your Spotify library, imports play as they are, and Spotify tracks can sit in the same queue as SoundCloud tracks.
- Spotify plays inside Stratus on the desktop, or Stratus can work as a remote for your Spotify app. The web player on phones starts in remote mode, since phone browsers stop in-page Spotify audio when the screen locks.
- Likes, playlists and history in your Stratus account can hold Spotify tracks.
- The desktop app now runs on castlabs' Electron, which includes the Widevine module Spotify's audio needs. It downloads on first launch.
- Linux build (AppImage).

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
