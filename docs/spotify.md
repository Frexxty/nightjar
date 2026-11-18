# Spotify playback (Premium)

Nightjar can play music from two sources:

- **SoundCloud** (free). Catalogue and streams through the Nightjar backend. Imported Spotify playlists are matched against SoundCloud uploads; many songs aren't on SoundCloud.
- **Spotify** (Premium). The user signs in with their Spotify account and Nightjar plays Spotify's own audio through the official [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk), or remote-controls their Spotify app through the Web API's Connect endpoints. Imported Spotify playlists play as-is, no matching.

The user picks one on first run (`/welcome`) and can change it in Settings.

## Why each user brings a Client ID

Since February 2026 a Spotify developer app in Development Mode must be owned by a Premium account and allows 5 users; more users need a registered business with 250k MAU. An open-source app therefore can't ship one shared Client ID. Each user creates their own app at https://developer.spotify.com/dashboard (free with their Premium account), adds the redirect URIs below, and pastes the Client ID into Nightjar. Only the Client ID is used (Authorization Code with PKCE); there is no client secret anywhere.

Redirect URIs the user adds to their Spotify app:

- Desktop: `http://127.0.0.1:43821/callback`
- Web player: `https://nightjar-app.k3s.lat/spotify-callback`

Spotify apps set up before the rename list `https://stratus-app.k3s.lat/spotify-callback`. It stays valid: the old host still serves the app on that path, so a sign-in started there finishes there. Sign-ins from nightjar-app.k3s.lat need the new URI added to the Spotify app.

Scopes: `streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-follow-read`.

## One sign-in for all devices

When the user is signed in to a Nightjar account on the hosted backend, connecting Spotify hands the refresh token to the account (`PUT /v1/me/spotify`) and the device keeps only short-lived access tokens, fetched from `POST /v1/me/spotify/token`. Every other device signed in to the same account is connected without signing in to Spotify, and a new device skips the source question. A sign-in made while signed out stays on that device and moves to the account the first time the user signs in. Disconnecting while signed in disconnects all devices. See docs/hosted-api.md, "Spotify sign-in".

## Shared types and IDs

`Track` (src/api/types.ts) gains:

- `source?: "soundcloud" | "spotify"`. Missing means `"soundcloud"`.
- `uri?: string | null`. Spotify URI, e.g. `spotify:track:4uLU6hMCjMI75M1A2tKUQC`.
- `album?: { id: Id; title: string; artworkUrl: string | null } | null`.

IDs of Spotify objects are their URIs, so they never collide with SoundCloud's numeric IDs and routes can tell them apart by prefix:

| Kind | `id` | Route |
| --- | --- | --- |
| Track | `spotify:track:<id>` | `/track/spotify:track:<id>` |
| Artist (a `User` in Nightjar terms) | `spotify:artist:<id>` | `/user/spotify:artist:<id>` |
| Playlist | `spotify:playlist:<id>` | `/playlist/spotify:playlist:<id>` |
| Album (a `Playlist` with `isAlbum: true`) | `spotify:album:<id>` | `/playlist/spotify:album:<id>` |

Helper: `isSpotifyId(id)` in `src/spotify/ids.ts`.

Spotify has no waveform data (audio-analysis is deprecated), so `waveform` is null for Spotify tracks; the UI draws its flat line. Comments don't exist on Spotify; the comments drawer says so for Spotify tracks.

## Modules

| Path | Owns |
| --- | --- |
| `src/spotify/ids.ts` | `isSpotifyId`, URI parsing |
| `src/spotify/auth.ts` | Pinia store `useSpotify()`: `clientId`, `status` (`"disconnected" \| "connecting" \| "connected" \| "error"`), `profile` (`{ id, displayName, product, country }`), `isPremium`, `connect()`, `disconnect()`, `accessToken(): Promise<string>` (refreshes when needed). Tokens persist (Electron: main-process `safeStorage`; web: localStorage). |
| `electron/spotify-auth.cjs` | Desktop OAuth: IPC `spotify-auth:authorize(authorizeUrl)` opens the system browser and listens once on `127.0.0.1:43821/callback`, resolves `{ code, state }` or an error, closes the server, times out after 5 minutes. |
| `src/spotify/api.ts` | Web API client: bearer from `accessToken()`, retries once on 401 after refresh, honours 429 `Retry-After`. |
| `src/spotify/catalogue.ts` | Maps Spotify objects to Nightjar types and serves: search (tracks, artists, playlists, albums), track, album, playlist (paged items), artist (+ top tracks, albums), the user's saved tracks ("Liked Songs"), the user's playlists, save/unsave track, and recommendations. Recommendations seed from Liked Songs, `/me/top/tracks` and `/me/player/recently-played`; each seed's related tracks are a search for its first artist; `/me/library/contains` drops tracks already liked. That is at most 3 + 5 + 1 + 2 requests. Browse genre pages search with `genre:"…"`. |
| `src/player/engines.ts` | `PlaybackEngine` interface used by the player store: `load(track, { autoplay, startAt })`, `play()`, `pause()`, `seek(seconds)`, `setVolume(0..1)`, `destroy()`, events for time, duration, state, ended, error. `HtmlAudioEngine` (today's `<audio>` + hls.js), `SpotifySdkEngine` (Web Playback SDK device inside Nightjar), `SpotifyConnectEngine` (controls another Spotify device: the phone's Spotify app). The player store picks the engine from `track.source` and settings. |
| `src/views/WelcomeView.vue` | First-run source choice and Spotify setup guide. |

Queue, shuffle, repeat and autoplay stay in Nightjar's player store for both sources. For Spotify tracks the engine plays one URI at a time (`PUT /me/player/play` with `uris: [uri]` on the SDK device) and reports `ended` from the SDK state, so mixed SoundCloud and Spotify queues work.

## Settings

`settings.musicSource: "soundcloud" | "spotify" | null`. `null` means not chosen yet and sends the user to `/welcome` on launch. `settings.spotifyPlayback: "this-device" | "remote"` (web player on phones defaults to `"remote"`, desktop to `"this-device"`).

## Saving Spotify tracks in a Nightjar account

The hosted backend can't call Spotify (it has no user token), so for IDs starting with `spotify:` the client sends a snapshot of the `Track` and the server stores it as-is:

- `POST /v1/me/playlists` and `PATCH /v1/me/playlists/{id}` accept `tracks: Track[]` (snapshots) in addition to `trackIds`. Order is the order of `tracks` when given. Entries with `spotify:` IDs are stored as snapshots; SoundCloud IDs are still hydrated live.
- `PUT /v1/me/likes/tracks/{id}` accepts an optional JSON body `{ "track": Track }`, required when `id` starts with `spotify:`.
- `POST /v1/me/history` accepts `{ "trackId", "track"? }`, `track` required for `spotify:` IDs.
- Reads return the stored snapshot for Spotify IDs, mixed in order with hydrated SoundCloud tracks.

## Desktop Widevine

Spotify's audio is DRM-protected (Widevine). Stock Electron has no Widevine CDM, so Nightjar uses castlabs' Electron for Content Security (ECS), the same approach Cider uses for Apple Music. `package.json` pins `electron` to `github:castlabs/electron-releases#v45.2.1+wvcus`, and electron-builder downloads the matching castlabs zips through `build.electronDownload.mirror`. To move to a newer ECS release, change the tag in `package.json` and run `npm install`.

ECS doesn't ship the CDM. Chromium's component updater downloads it from Google on first launch (about 3 to 6 s on a home connection) and keeps it updated. `electron/drm.cjs` calls `components.whenReady()` before the window opens and waits at most 5 s (`NIGHTJAR_CDM_WAIT_MS` overrides it). Once the CDM is installed the wait takes a few milliseconds. If the first install is still running when the wait ends, the window opens anyway and the status changes to `"ready"` when the install finishes. The CDM then works in that same session, with no restart needed (checked on Linux).

The renderer reads the status through the preload bridge:

```ts
const drm = await window.nightjar?.drm.status();
// { widevine: "ready" | "updating" | "unavailable", version: "4.10.3112.0" | null }
const stop = window.nightjar?.drm.onStatus((s) => { /* e.g. "updating" -> "ready" */ });
```

- `"ready"`: the CDM is installed and `navigator.requestMediaKeySystemAccess("com.widevine.alpha", ...)` resolves.
- `"updating"`: the first install hasn't finished yet. Show "Getting Spotify playback ready…" and wait for `onStatus`.
- `"unavailable"`: the install failed (for example offline on first launch), or the app runs on stock Electron. Show "Spotify playback needs Widevine" and offer SoundCloud or remote playback (`spotifyPlayback: "remote"`).

`window.nightjar` is undefined in the web player, where the browser brings its own Widevine.

VMP (Verified Media Path) is Widevine's check that the app binary is untampered. Linux has no VMP. On macOS and Windows, ECS ships with a development VMP signature only, and Spotify's licence server may refuse it. Release builds get a production signature from castlabs EVS in the Release workflow when the `EVS_ACCOUNT_NAME` and `EVS_PASSWD` secrets are set (README, Releasing). Local and fork builds skip that step with a warning. To check what a build gets, open castlabs' [VMP Lab](https://castlabs.github.io/wv-vmp-lab/) inside the app: `PLATFORM_SOFTWARE_VERIFIED` is good, `PLATFORM_TAMPERED` means a broken signature.

If the mac build is ever notarized with the hardened runtime, it needs the `com.apple.security.cs.disable-library-validation` entitlement, or macOS refuses to load the CDM.
