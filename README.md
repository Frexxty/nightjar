# Nightjar

Nightjar was called Stratus up to version 0.3.1. [Renamed from Stratus](#renamed-from-stratus) lists what kept the old name and why.

A desktop SoundCloud player modelled on Cider's layout: vibrancy sidebar, a top bar with the transport controls and an "LCD" now-playing display, a right-hand drawer, and a full-window immersive player. Out of the box it uses the hosted Nightjar server, where you can make a free Nightjar account for your likes, playlists, follows and history. You can also point it at a server you run, described in [BACKEND.md](BACKEND.md), or at built-in demo data with generated artwork, waveforms, comments and synthesized audio.

Electron 45 ([castlabs' Widevine build](https://github.com/castlabs/electron-releases), so Spotify's protected audio can play), Vue 3, Pinia, Vite. No code or assets come from Cider. Its license is "All Rights Reserved", so this is a fresh implementation of the same structure.

## Run it

```sh
npm install
npm run dev        # Vite + Electron with hot reload
npm run build      # typecheck and build the renderer into dist/
npm start          # run Electron against dist/
npm test           # unit tests (node --test)
npm run dist       # Nightjar.app in release/mac-arm64 via electron-builder (not notarized)
npm run dist:mac   # dmg and zip for Apple silicon and Intel in release/
npm run dist:win   # Nightjar-Setup-x64.exe in release/ (builds on macOS too, no Wine needed)
npm run dist:linux # Nightjar-linux-x86_64.AppImage in release/ (build it on Linux)
npm run dev:web    # the web player in a browser, against the hosted backend
npm run build:web  # typecheck and build the web player into dist-web/
npm run deploy:web # build:web, then deploy it to nightjar-app.k3s.lat
```

## What's in it

| Cider | Nightjar |
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

## Spotify or SoundCloud

On first launch Nightjar asks where your music should come from. Installs from before this choice existed get the same question once. You can switch later in Settings > Music source.

**SoundCloud** is free and needs nothing else. It plays what people have uploaded to SoundCloud. When you import a Spotify playlist, Nightjar searches SoundCloud for each song and shows you the closest uploads. Some will be the right song, but most songs from a typical playlist won't be on SoundCloud at all, or only as covers, remixes and 30-second previews. The import page says so and lets you check every match before saving.

**Spotify** plays Spotify's own audio, so imported playlists play as they are, with nothing to match. It needs two things:

- Spotify Premium. Spotify only lets Premium accounts play music in other apps.
- Your own Spotify developer app, made once at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard). Since February 2026 a Spotify developer app works for its owner and up to 5 accounts they invite, and opening it to more people requires a registered business. So Nightjar can't ship one app for everyone, and each person makes their own. It's free and takes about 5 minutes.

The welcome page walks through it. Create an app with any name, tick "Web API" and "Web Playback SDK", add the redirect URIs it shows (`http://127.0.0.1:43821/callback` for the desktop app, `https://nightjar-app.k3s.lat/spotify-callback` for the web player; Spotify apps set up before the rename may list `https://stratus-app.k3s.lat/spotify-callback`, which still works for sign-ins started there), then paste the app's Client ID into Nightjar and connect. Nightjar only uses the Client ID. It signs in with PKCE and never asks for the Client secret. After connecting, the page shows your Spotify name and whether the account has Premium. If it doesn't, Spotify songs won't play, and the page offers SoundCloud instead.

Settings > Music source shows who you're connected as, the Client ID (partly hidden), and buttons to reconnect, disconnect or change the Client ID. It also sets how Spotify songs play. "Play on this device" plays them inside Nightjar. "Control my Spotify app" leaves the audio to your Spotify app and uses Nightjar as the remote. Phone browsers can't play Spotify audio inside a web page, so the web player on phones starts with "Control my Spotify app". [docs/spotify.md](docs/spotify.md) has the details.

With a Nightjar account, liked Spotify songs, playlists with Spotify songs and Spotify plays in your history are saved in the account like SoundCloud ones. The server can't look Spotify songs up, so the app sends the song's title, artist, length and artwork along and the server keeps that copy ([docs/hosted-api.md](docs/hosted-api.md#spotify-tracks)).

## Accounts and backends

Settings > Backend has three choices:

- **Nightjar account** (the default for new installs). The hosted server at `https://nightjar-api.k3s.lat/v1`, documented in [docs/hosted-api.md](docs/hosted-api.md). Catalogue pages work signed out. Likes, reposts, follows, the Stream page, account playlists and synced history need an account.
- **Custom server**. Any server that follows [BACKEND.md](BACKEND.md), with an optional bearer token. If it also has the account routes, the same sign-in page works with it.
- **Demo data**. Made-up artists and tracks with generated audio. It has a fake account so the sign-in flows can be tried offline: you start signed in as "you", and any password of 8 or more characters signs you back in.

Sign in from the sidebar footer, from Settings > Account, or from any button that needs an account (like, follow, repost, save to library). Signed out, those buttons open the sign-in page and bring you back afterwards, and the Stream, Likes, Playlists and Following pages show a sign-in prompt instead of an error. Nightjar accounts are separate from SoundCloud accounts, and nothing is posted to SoundCloud.

The session token is saved with the backend choice (in `localStorage`, which Electron keeps in your user data folder). If the server rejects it later, Nightjar forgets it and asks you to sign in again. Settings > Account also has Sign out, Delete account (asks for your password), and a button that uploads playlists saved on this computer to your account and then offers to remove the local copies.

History is recorded on this computer either way. Signed in to a server with history, plays are also sent to the account and the History page shows the account's list.

Builds can point "Nightjar account" at another copy of the server with `VITE_BACKEND_URL=https://… npm run build`. Settings saved by older versions keep working: "Mock data" becomes Demo data, and an HTTP server setting stays a custom server unless its URL is the hosted one (`https://stratus-api.k3s.lat/v1` counts too and moves to the new address). The old API address keeps answering for 0.3.x apps.

## Importing from Spotify

Library > Import from Spotify (or View > Import from Spotify…) takes a link to a public Spotify playlist or album. It needs no Spotify account and no API key.

Nightjar reads the list in the main process. It first fetches Spotify's embed page, which carries the track list as JSON but stops at 100 tracks. If the list has 100 tracks or the embed fails, it opens the normal open.spotify.com page in a hidden, muted window with a throwaway in-memory session. It waits for Spotify's own web player to request the first page from its internal API, copies that request, and asks for the rest 100 tracks at a time. A 1,223-track playlist takes about ten seconds. That internal API isn't public and Spotify changes it now and then. When it breaks, you still get the first 100 tracks and a message saying so. The hidden window is closed as soon as the first page arrives, and nothing from it is written to disk.

With Spotify as your music source, the list becomes a playlist of Spotify tracks straight away: the import page shows how many are ready, lists local files from the playlist owner's computer as skipped (Spotify can't play those), and goes to saving. "Match on SoundCloud instead" switches that list to the matching flow below.

With SoundCloud as your music source, Nightjar searches your backend for each track with "first artist + title", then with the title alone. It scores each result from 0 to 1:

- Title similarity (half the score), after stripping things like "(Official Video)", "feat. X", "- Remastered 2011" and "(Radio Edit)", plus accents and punctuation.
- Artist overlap (30%), checked against the uploader name and any artist written in the upload title ("Artist - Title").
- Length (20%). Within 3 seconds counts fully. More than 10 seconds and 10% off counts for little. A 30-second upload of a full-length song is treated as a SoundCloud preview and marked down.
- Remixes, covers, sped up, slowed, nightcore, 8D, instrumental, karaoke and live versions lose points unless the Spotify title says the same thing. Uploads that can't be streamed are ignored.

A score of 0.75 or more is "Matched" and 0.5 to 0.75 is "Check". Anything lower is "No match" and is left out unless you pick something. A list with titles only and no artists never scores above "Check". In the review table you can pick another candidate, search with your own words, skip a track, or double-click a match to hear it.

If a playlist can't be read in full, the "Paste a track list" tab takes `Artist - Title` lines or a CSV with "Track Name" and "Artist Name(s)" columns, such as an [Exportify](https://exportify.net) export.

In a browser there is no main process to read Spotify with, so the import page asks the backend instead (`GET /import/spotify`). The hosted server reads the embed page, which covers the first 100 tracks, and sometimes the full page. If the backend can't read links either, the page says so and the paste tab still works.

Signed in, "Save to my library" saves the matches as a playlist in your account, where you can rename it, delete it, drag tracks to reorder them, or remove them from the track menu. Signed out, the same button opens the sign-in page and the import waits for you to come back. "Save on this computer" keeps the playlist in `localStorage` instead, with full track data so it shows without a network. Those appear under "On this computer" in the sidebar and can be edited the same way.

Tracks where only SoundCloud's 30-second Go+ preview can be played carry a "Preview" label in lists, cards, the stream, the now-playing display and the import review.

`npm test` runs the matcher, list parser and Spotify parsing tests. The Spotify tests run against trimmed real responses in `tests/fixtures/spotify`.

## Web player

The same renderer also ships as a web app at [nightjar-app.k3s.lat](https://nightjar-app.k3s.lat). `npm run build:web` runs Vite with `--mode web`, which reads `.env.web`: it sets `VITE_TARGET=web` and points the default backend at the hosted API (`https://nightjar-api.k3s.lat/v1`, see [docs/hosted-api.md](docs/hosted-api.md)), so the web build never starts on the mock. The output goes to `dist-web/` with absolute paths (`base: "/"`). Everything that needs Electron checks for `window.nightjar` and stays out of the way in a browser: there are no update checks, menus or tray, and the macOS vibrancy rules don't apply because the platform attribute is `web`.

Below 760px wide the layout switches to a phone layout. The sidebar becomes a tab bar (Home, Stream, Search, Library, Import), the top bar becomes a back button and a title, and a mini player sits above the tab bar. Tapping the mini player opens the now-playing sheet, which you close by swiping it down or with the chevron. Queue and comments open as a second sheet on top of it. Track lists turn into compact rows where a tap plays and the menu button or a long press opens an action sheet. The Electron window can't get narrower than 960px, so the desktop app never sees this layout.

### Installing on iPhone

Open nightjar-app.k3s.lat in Safari, tap Share, then Add to Home Screen. Safari shows a banner with the same hint until you dismiss it. The installed app opens full screen with the status bar over its own header, and the lock screen shows the track with play, pause, skip and a scrubber through the Media Session API. iOS plays SoundCloud's HLS streams natively. Lock-screen artwork needs a real https image, so tracks from the mock backend show without artwork there.

Android Chrome offers Install app from its menu, using the same manifest and a maskable icon.

### How it works offline

`web/pwa.ts` is a small Vite plugin that only runs for the web build. It adds the manifest, the home-screen icons from `web/icons/` and the iOS meta tags, and writes `sw.js` from `web/sw.js` with this build's file list. The service worker caches the app shell (index page, hashed JS and CSS, icons) and serves hashed files from the cache. Pages go to the network first and fall back to the cached shell when offline. It never touches requests to other origins, so API responses, artwork and audio are not cached. When a deploy lands, the new worker waits and the app shows "New version available" with a Reload button.

The icons are rendered from the mark in `build/icon.svg`. To redo them:

```sh
rsvg-convert -w 192 -h 192 build/icon.svg -o web/icons/icon-192.png
rsvg-convert -w 512 -h 512 build/icon.svg -o web/icons/icon-512.png
rsvg-convert -w 512 -h 512 web/icons/maskable.svg -o web/icons/maskable-512.png
rsvg-convert -w 180 -h 180 web/icons/apple-touch-icon.svg -o web/icons/apple-touch-icon.png
```

### Deploying the web player

It runs as a Cloudflare Worker named `stratus-app` (`web/wrangler.jsonc`, the name is from before the rename) on the custom domains nightjar-app.k3s.lat and stratus-app.k3s.lat. Workers Static Assets serves `dist-web/` and answers unknown paths with the app. The build also writes a `_headers` file: hashed files under `/assets/` are cached for a year as immutable, while `index.html`, `sw.js` and `manifest.webmanifest` are sent with `no-cache` so a deploy shows up on the next load.

`web/worker.js` sees every request first. On stratus-app.k3s.lat it answers pages with a 301 to the same path and query on nightjar-app.k3s.lat. It still serves `/spotify-callback` there (and the files that page loads), because people's Spotify apps list that redirect URI and a sign-in that started on the old address keeps its PKCE verifier in that origin's storage. localStorage belongs to an origin, so on a browser's first visit the new address hops once to `stratus-app.k3s.lat/__nightjar-handoff`, which copies the `stratus.*` keys back over in `window.name` (both hosts are on k3s.lat, so the name survives the trip). `src/lib/handoff.ts` has the details. Home-screen apps installed from the old address open the redirect in a browser sheet, so iPhone users should add the new address to the Home Screen again.

To deploy by hand, log in once with `npx wrangler@latest login` and run `npm run deploy:web`.

The Deploy web player workflow (`.github/workflows/deploy-web.yml`) does the same on every push to main that changes `src/`, `public/`, `index.html`, `web/` or the build config. It needs two repository secrets, which you add under Settings, Secrets and variables, Actions:

- `CLOUDFLARE_API_TOKEN`: an API token with Workers Scripts edit on the account, and Workers Routes edit and DNS edit on the k3s.lat zone. The "Edit Cloudflare Workers" template covers it.
- `CLOUDFLARE_ACCOUNT_ID`: `f2cf5d525fceb6c6c5fccbbd10a94bb4`.

## Layout

```
electron/main.cjs        window, menus, dock, IPC
electron/drm.cjs         Widevine CDM install and status (castlabs components API)
scripts/vmp-sign*.cjs    Widevine VMP signing hooks for electron-builder
electron/preload.cjs     the window.nightjar bridge (context-isolated, sandboxed)
electron/spotify*.cjs    reads public Spotify playlists and albums for the import page
src/lib/match.ts         scores SoundCloud results against Spotify tracks
electron/updater.cjs     update checks and installs, wired to the update dialog
electron/mac-install.cjs macOS download, checksum and in-place app swap
electron/tray.cjs        Windows tray icon with playback controls
src/api/types.ts         the backend contract
src/api/http.ts          REST client for BACKEND.md and the hosted account routes
src/api/config.ts        backend choice, saved settings and their migration
src/api/errors.ts        the { error, code } error shape and friendly messages
src/api/mock.ts          demo backend, with a fake account
src/api/synth.ts         audio and artwork generator for the mock
src/stores/player.ts     queue, shuffle, repeat, audio/HLS, media session
src/stores/library.ts    signed-in user, likes, reposts, follows, history
src/stores/account.ts    sign up, sign in, sign out, delete account
src/components/          chrome, LCD, waveform, drawer, immersive player, lists, cards
src/views/               one file per route
server/                  the hosted backend (Cloudflare Worker + D1) at nightjar-api.k3s.lat, see server/README.md
src/lib/sheet.ts         drag-to-dismiss for the phone sheets
src/lib/longpress.ts     long press opens context menus on touch screens
src/lib/pwa.ts           service worker registration and the install hint (web only)
web/                     web player: Vite plugin, service worker, icons, Worker config
```

The window uses `contextIsolation`, `sandbox` and no `nodeIntegration`. The renderer can only send playback state and a few window actions to the main process. Cider runs with `webSecurity: false` and `nodeIntegration: true`, which I didn't copy.

## Updates

Nightjar checks GitHub Releases 10 seconds after launch and every 6 hours after that. You can also use Check for Updates in the app menu (Help menu on Windows) or the Updates section in Settings, which also has a beta toggle for pre-releases. An update shows its release notes and asks before downloading.

On Windows it uses electron-updater's NSIS flow. macOS builds are ad-hoc signed, not notarized, and Squirrel.Mac rejects an ad-hoc signed update because the signature changes with every build. So on macOS Nightjar downloads the zip for your Mac's architecture, checks its sha512 against `latest-mac.yml`, and swaps the app bundle in place after it quits. If it can't write to the folder the app lives in, it opens the dmg download in your browser instead.

To try an update locally, point a build at a folder served over HTTP that holds `latest-mac.yml` (or `latest.yml`) and the files it lists:

```sh
NIGHTJAR_UPDATE_FEED=http://127.0.0.1:8080/ /path/to/Nightjar.app/Contents/MacOS/Nightjar
```

`NIGHTJAR_UPDATE_AUTOINSTALL=1` accepts the update without asking, and `NIGHTJAR_HEADLESS_TEST=1` keeps the window and Dock icon hidden. `node --test` covers the feed parsing, version rules and checksum check. With `NIGHTJAR_TEST_OLD_APP` and `NIGHTJAR_TEST_FEED_DIR` set, it also updates a real built app from a local feed without starting it. Add `NIGHTJAR_TEST_OLD_INSTALLER` (a folder with an older `mac-install.cjs` and `update-core.cjs`, e.g. from `git show v0.3.1:electron/mac-install.cjs`) to run the old version's updater, as a 0.3.1 install would. If the bundle is still called `Stratus.app` afterwards, the test also runs the first-launch rename and checks `Nightjar.app` with `codesign --verify --deep --strict`.

## Renamed from Stratus

The app, the site and the web player are called Nightjar from 0.4.0 on. Some things kept the old name on purpose, so existing installs carry on:

- The appId stays `dev.stratus.app`. Windows derives the installer's uninstall key from it, so 0.4.0 installs over 0.3.x instead of next to it, and on macOS it's the bundle id that preferences and permissions follow.
- The user data folder. Electron names it after the app, so a renamed build would start empty. `electron/profile.cjs` keeps using `<appData>/Stratus` when that folder holds a profile and `<appData>/Nightjar` doesn't; new installs get `<appData>/Nightjar`. Nothing is moved or copied. With the old folder, the app also answers to "Stratus" until it's ready, because safeStorage's keychain item (macOS) and keyring entry (Linux) are named after the app and the saved Spotify tokens were encrypted under that name.
- localStorage keys keep their `stratus.` prefix.
- On macOS, 0.3.x's updater swaps the new build into the path it was running from, so the bundle stays `Stratus.app`. The first launch of 0.4.0 from a bundle called `Stratus.app` quits, renames it to `Nightjar.app` and starts again from there (once; `bundle-rename.json` in the user data folder records the attempt).
- On Windows, 0.3.x's electron-updater installs `Nightjar-Setup-x64.exe` over the old install: same appId, same uninstall key, same install folder (the one in the registry, so `...\Programs\Stratus` for existing installs). The Stratus shortcuts are removed and Nightjar ones are created. A taskbar pin to the old `Stratus.exe` has to be pinned again.
- The Cloudflare Workers (`stratus-app`, `stratus-site`, `stratus-api`) and the D1 database `stratus` keep their names. Each answers on its new host and its old one: stratus-api.k3s.lat keeps serving the API, stratus.k3s.lat redirects to nightjar.k3s.lat, and stratus-app.k3s.lat redirects to nightjar-app.k3s.lat except for `/spotify-callback`.
- The GitHub repo moves from Frexxty/stratus to Frexxty/nightjar. GitHub redirects the old name, which is how 0.3.x finds the 0.4.0 release.

## Releasing

1. Add a section for the new version to `CHANGELOG.md`. It becomes the release notes on GitHub and in the update dialog.
2. Bump the version: `npm version 0.2.0 --no-git-tag-version`. Use a suffix like `0.2.0-beta.1` for a pre-release, which only reaches people with beta updates turned on.
3. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The Release workflow does the rest. It checks the tag matches `package.json`, creates a draft release, builds the macOS dmg and zip for both architectures and the Windows installer, uploads them, and publishes the release once every file is there. The download links on the latest release keep the same names between versions:

- `https://github.com/Frexxty/nightjar/releases/latest/download/Nightjar-mac-arm64.dmg`
- `https://github.com/Frexxty/nightjar/releases/latest/download/Nightjar-mac-x64.dmg`
- `https://github.com/Frexxty/nightjar/releases/latest/download/Nightjar-Setup-x64.exe`

A Linux AppImage (`Nightjar-linux-x86_64.AppImage`, plus `latest-linux.yml`) is built too, but on a best-effort basis: if that job fails the release still goes out without it, with a warning. The in-app updater doesn't handle Linux yet.

Nothing is signed with a paid certificate. macOS users need to right-click the app and choose Open the first time, and Windows SmartScreen will warn about an unknown publisher.

### Widevine VMP signing

Spotify playback needs Widevine, which comes from castlabs' Electron build. On macOS and Windows, Widevine also checks a VMP signature on the app. castlabs' builds only carry a development one, so release builds should get a production signature from castlabs' free EVS service. The Release workflow does this when two repository secrets are set. Without them it still builds and publishes, unsigned for VMP, and the build log says so. Forks and local builds work the same way.

One-time setup for the maintainer:

1. Create a free EVS account. It asks for an e-mail address, name, account name and password, then mails a confirmation code:

   ```sh
   python3 -m pip install --upgrade castlabs-evs
   python3 -m castlabs_evs.account signup
   ```

2. In the repository's Settings > Secrets and variables > Actions, add `EVS_ACCOUNT_NAME` (the account name, not the e-mail) and `EVS_PASSWD`.

That's it. On the next tag the mac and Windows jobs install `castlabs-evs` and sign: macOS in electron-builder's `afterPack` hook, before codesign, because the signature file sits inside the code-signed bundle; Windows in `afterSign`, after electron-builder has edited the exe's resources and before the NSIS installer is built (castlabs requires VMP signing after Authenticode on Windows). The job then runs `codesign --verify --deep --strict` and `castlabs_evs.vmp verify-pkg`, and a failed check leaves the release a draft. A wrong password fails the build rather than shipping unsigned. To sign a local build, export the same two variables before `npm run dist:mac` or `dist:win`; `EVS_PYTHON` picks the Python that has `castlabs-evs` if it isn't `python3`. If you're locked out, reset the password with `python3 -m castlabs_evs.account reset` rather than signing up again, as castlabs asks.

## License

MIT. See [LICENSE](LICENSE).
