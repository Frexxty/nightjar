# Stratus

A desktop SoundCloud player modelled on Cider's layout: vibrancy sidebar, a top bar with the transport controls and an "LCD" now-playing display, a right-hand drawer, and a full-window immersive player. It's only the UI. Data comes from a backend you write, described in [BACKEND.md](BACKEND.md). Until then it runs against a built-in mock with generated artwork, waveforms, comments and synthesized audio, so everything is clickable on day one.

Electron 45, Vue 3, Pinia, Vite. No code or assets come from Cider. Its license is "All Rights Reserved", so this is a fresh implementation of the same structure.

## Run it

```sh
npm install
npm run dev        # Vite + Electron with hot reload
npm run build      # typecheck and build the renderer into dist/
npm start          # run Electron against dist/
npm test           # unit tests (node --test)
npm run dist       # Stratus.app in release/mac-arm64 via electron-builder (not notarized)
npm run dist:mac   # dmg and zip for Apple silicon and Intel in release/
npm run dist:win   # Stratus-Setup-x64.exe in release/ (builds on macOS too, no Wine needed)
```

## What's in it

| Cider | Stratus |
| --- | --- |
| Top chrome with controls and LCD | Same, with a scrubbable mini waveform as the progress bar |
| Lyrics drawer, synced to playback | Timed comments drawer, synced to playback, with a box to post at the current time |
| Queue drawer | Up Next with drag-to-reorder, remove, clear, and a History tab |
| Immersive mode | Blurred drifting artwork, big waveform with comment avatars, comments or queue on the side |
| Listen Now / Browse | Home (shelves from `/home`) and Stream (the SoundCloud feed with reposts and inline waveforms) |
| Library | Likes (with filter), Playlists, Albums, Following, History |
| Album / artist pages | Track, playlist/album and user pages with play, shuffle, like, repost, follow, station |
| Menu bar, dock menu, media keys | App menu with Controls and View shortcuts, dock menu with now playing, media keys and Now Playing via the Media Session API |

Shortcuts: Space play/pause, ←/→ seek 5s, ⌘←/⌘→ previous/next, ⌘L like, ⌘F search, ⌘1–5 sections, ⌘U queue, ⌘K comments, ⇧⌘F immersive, ⌘[ / ⌘] back/forward.

When the queue runs out it keeps going with `/tracks/{id}/related`, like SoundCloud's autoplay. You can turn that off in Settings, along with comments on waveforms and the immersive background animation. Settings also has theme (dark, light, system) and accent colour.

## Importing from Spotify

Library > Import from Spotify (or View > Import from Spotify…) takes a link to a public Spotify playlist or album. It needs no Spotify account and no API key.

Stratus reads the list in the main process. It first fetches Spotify's embed page, which carries the track list as JSON but stops at 100 tracks. If the list has 100 tracks or the embed fails, it opens the normal open.spotify.com page in a hidden, muted window with a throwaway in-memory session. It waits for Spotify's own web player to request the first page from its internal API, copies that request, and asks for the rest 100 tracks at a time. A 1,223-track playlist takes about ten seconds. That internal API isn't public and Spotify changes it now and then. When it breaks, you still get the first 100 tracks and a message saying so. The hidden window is closed as soon as the first page arrives, and nothing from it is written to disk.

For each track, Stratus searches your backend with "first artist + title", then with the title alone. It scores each result from 0 to 1:

- Title similarity (half the score), after stripping things like "(Official Video)", "feat. X", "- Remastered 2011" and "(Radio Edit)", plus accents and punctuation.
- Artist overlap (30%), checked against the uploader name and any artist written in the upload title ("Artist - Title").
- Length (20%). Within 3 seconds counts fully. More than 10 seconds and 10% off counts for little. A 30-second upload of a full-length song is treated as a SoundCloud preview and marked down.
- Remixes, covers, sped up, slowed, nightcore, 8D, instrumental, karaoke and live versions lose points unless the Spotify title says the same thing. Uploads that can't be streamed are ignored.

A score of 0.75 or more is "Matched" and 0.5 to 0.75 is "Check". Anything lower is "No match" and is left out unless you pick something. A list with titles only and no artists never scores above "Check". In the review table you can pick another candidate, search with your own words, skip a track, or double-click a match to hear it.

If a playlist can't be read in full, the "Paste a track list" tab takes `Artist - Title` lines or a CSV with "Track Name" and "Artist Name(s)" columns, such as an [Exportify](https://exportify.net) export. That tab also works in a plain browser during `vite` development; reading links needs the desktop app.

Imported playlists are saved locally (in `localStorage`, with full track data so they show without a network) and appear under "Your playlists". You can rename or delete them, and remove or move tracks from the track menu. If your backend implements `createPlaylist`, the import page also offers "Save to SoundCloud".

`npm test` runs the matcher, list parser and Spotify parsing tests. The Spotify tests run against trimmed real responses in `tests/fixtures/spotify`.

## Layout

```
electron/main.cjs        window, menus, dock, IPC
electron/preload.cjs     the window.stratus bridge (context-isolated, sandboxed)
electron/spotify*.cjs    reads public Spotify playlists and albums for the import page
src/lib/match.ts         scores SoundCloud results against Spotify tracks
electron/updater.cjs     update checks and installs, wired to the update dialog
electron/mac-install.cjs macOS download, checksum and in-place app swap
electron/tray.cjs        Windows tray icon with playback controls
src/api/types.ts         the backend contract
src/api/http.ts          REST client for BACKEND.md
src/api/mock.ts          mock backend
src/api/synth.ts         audio and artwork generator for the mock
src/stores/player.ts     queue, shuffle, repeat, audio/HLS, media session
src/stores/library.ts    likes, reposts, follows, history
src/components/          chrome, LCD, waveform, drawer, immersive player, lists, cards
src/views/               one file per route
server/                  the hosted backend (Cloudflare Worker + D1) at stratus-api.k3s.lat, see server/README.md
```

The window uses `contextIsolation`, `sandbox` and no `nodeIntegration`. The renderer can only send playback state and a few window actions to the main process. Cider runs with `webSecurity: false` and `nodeIntegration: true`, which I didn't copy.

## Updates

Stratus checks GitHub Releases 10 seconds after launch and every 6 hours after that. You can also use Check for Updates in the app menu (Help menu on Windows) or the Updates section in Settings, which also has a beta toggle for pre-releases. An update shows its release notes and asks before downloading.

On Windows it uses electron-updater's NSIS flow. macOS builds are ad-hoc signed, not notarized, and Squirrel.Mac rejects an ad-hoc signed update because the signature changes with every build. So on macOS Stratus downloads the zip for your Mac's architecture, checks its sha512 against `latest-mac.yml`, and swaps the app bundle in place after it quits. If it can't write to the folder the app lives in, it opens the dmg download in your browser instead.

To try an update locally, point a build at a folder served over HTTP that holds `latest-mac.yml` (or `latest.yml`) and the files it lists:

```sh
STRATUS_UPDATE_FEED=http://127.0.0.1:8080/ /path/to/Stratus.app/Contents/MacOS/Stratus
```

`STRATUS_UPDATE_AUTOINSTALL=1` accepts the update without asking, and `STRATUS_HEADLESS_TEST=1` keeps the window and Dock icon hidden. `node --test` covers the feed parsing, version rules and checksum check. With `STRATUS_TEST_OLD_APP` and `STRATUS_TEST_FEED_DIR` set, it also updates a real built app from a local feed without starting it.

## Releasing

1. Add a section for the new version to `CHANGELOG.md`. It becomes the release notes on GitHub and in the update dialog.
2. Bump the version: `npm version 0.2.0 --no-git-tag-version`. Use a suffix like `0.2.0-beta.1` for a pre-release, which only reaches people with beta updates turned on.
3. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The Release workflow does the rest. It checks the tag matches `package.json`, creates a draft release, builds the macOS dmg and zip for both architectures and the Windows installer, uploads them, and publishes the release once every file is there. The download links on the latest release keep the same names between versions:

- `https://github.com/Frexxty/stratus/releases/latest/download/Stratus-mac-arm64.dmg`
- `https://github.com/Frexxty/stratus/releases/latest/download/Stratus-mac-x64.dmg`
- `https://github.com/Frexxty/stratus/releases/latest/download/Stratus-Setup-x64.exe`

Nothing is signed with a paid certificate. macOS users need to right-click the app and choose Open the first time, and Windows SmartScreen will warn about an unknown publisher.

## License

MIT. See [LICENSE](LICENSE).
