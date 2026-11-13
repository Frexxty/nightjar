# Cumulus

A desktop SoundCloud player modelled on Cider's layout: vibrancy sidebar, a top bar with the transport controls and an "LCD" now-playing display, a right-hand drawer, and a full-window immersive player. It's only the UI. Data comes from a backend you write, described in [BACKEND.md](BACKEND.md). Until then it runs against a built-in mock with generated artwork, waveforms, comments and synthesized audio, so everything is clickable on day one.

Electron 45, Vue 3, Pinia, Vite. No code or assets come from Cider. Its license is "All Rights Reserved", so this is a fresh implementation of the same structure.

## Run it

```sh
npm install
npm run dev        # Vite + Electron with hot reload
npm run build      # typecheck and build the renderer into dist/
npm start          # run Electron against dist/
npm run dist       # Cumulus.app in release/mac-arm64 via electron-builder (not notarized)
```

## What's in it

| Cider | Cumulus |
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

## Layout

```
electron/main.cjs        window, menus, dock, IPC
electron/preload.cjs     the window.cumulus bridge (context-isolated, sandboxed)
src/api/types.ts         the backend contract
src/api/http.ts          REST client for BACKEND.md
src/api/mock.ts          mock backend
src/api/synth.ts         audio and artwork generator for the mock
src/stores/player.ts     queue, shuffle, repeat, audio/HLS, media session
src/stores/library.ts    likes, reposts, follows, history
src/components/          chrome, LCD, waveform, drawer, immersive player, lists, cards
src/views/               one file per route
```

The window uses `contextIsolation`, `sandbox` and no `nodeIntegration`. The renderer can only send playback state and a few window actions to the main process. Cider runs with `webSecurity: false` and `nodeIntegration: true`, which I didn't copy.
