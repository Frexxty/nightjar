# Hosted backend

The official hosted backend. It implements every route in [BACKEND.md](../BACKEND.md) plus accounts, account playlists and a Spotify import endpoint, so the desktop app and the web player (PWA) share one library.

- Base URL: `https://nightjar-api.k3s.lat/v1`. All BACKEND.md routes live under it (`/v1/home`, `/v1/me`, …). The address from before the rename, `https://stratus-api.k3s.lat/v1`, is the same Worker and keeps working; 0.3.x apps use it. Sessions are valid on both.
- Runs as the Cloudflare Worker `stratus-api` with a D1 database (both named before the rename). Source lives in `server/`.
- Web player: `https://nightjar-app.k3s.lat` (Worker `stratus-app`, static build of the same Vue app). The old `https://stratus-app.k3s.lat` redirects there.

## Where data comes from

- SoundCloud catalogue (search, tracks, users, playlists, comments, related tracks, waveforms, stream URLs) comes from SoundCloud's public `api-v2` with the web client's `client_id`, which the server reads from soundcloud.com's script bundles and refreshes when SoundCloud rejects it.
- Everything personal (account, likes, reposts, follows, saved playlists, history) is stored in D1. Nightjar accounts are not SoundCloud accounts; nothing is written to SoundCloud.

## IDs

- SoundCloud objects keep SoundCloud's numeric IDs as strings: tracks `"248639197"`, users `"1234"`, SoundCloud playlists `"987"`.
- Playlists saved to a Nightjar account use IDs prefixed `sp_` (e.g. `sp_k3j2…`). `GET /v1/playlists/{id}` serves both kinds.
- Spotify tracks use their URI as the ID (`spotify:track:4uLU6hMCjMI75M1A2tKUQC`). Likes, playlists and history accept them alongside SoundCloud IDs; see [Spotify tracks](#spotify-tracks). Escape the colons in paths (`/v1/me/likes/tracks/spotify%3Atrack%3A4uLU…`).

## Accounts

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/auth/signup` | `{ "username": string, "email": string, "password": string }` | `{ "token": string, "user": User }` (201) |
| POST | `/v1/auth/login` | `{ "login": string, "password": string }` (`login` is email or username) | `{ "token": string, "user": User }` |
| POST | `/v1/auth/logout` | none, uses the bearer token | 204 |
| DELETE | `/v1/me` | `{ "password": string }` | 204, deletes the account and all its data |

- Send the token as `Authorization: Bearer <token>` on every request. Tokens last 90 days and are stored server-side as a hash.
- Usernames: 3 to 30 characters, letters, digits, `_`, `-`, `.`; unique, case-insensitive. Passwords: at least 8 characters.
- Errors are JSON `{ "error": "human readable message", "code": "short_code" }`. Codes include `invalid_credentials` (401), `username_taken` and `email_taken` (409), `weak_password` and `invalid_input` (400), `rate_limited` (429, with `Retry-After`), `unauthorized` (401) and `not_found` (404). Server-side failures use `not_supported` (501), `not_streamable` (403), `import_failed` (422), `upstream_rate_limited` (503 with `Retry-After`, when SoundCloud answers 429), `upstream_error` (502) and `internal` (500).
- Signup, login and account deletion are limited to 10 requests a minute per IP. Spotify imports are limited to 10 a minute per IP; a list read in the last 10 minutes comes from the cache and doesn't count.
- `/v1/me`, `/v1/me/*`, `/v1/feed`, likes/reposts/follows and comment posting require a token. Signed out they return 401 `{ "code": "unauthorized" }`. Catalogue routes work signed out. With a token, every `Track` in a response carries `liked` and `reposted`, and every SoundCloud `User` carries `following`.
- `User` for the signed-in account: `id` is `"me:<uuid>"`-style opaque string, `username`, `avatarUrl: null`, counts from D1. `GET /v1/users/me:<uuid>` serves the same user to anyone, `/v1/users/me:<uuid>/playlists` lists that account's public playlists, and its tracks, likes and top tracks are empty.
- Nightjar can't post to SoundCloud, so `POST /v1/tracks/{id}/comments` answers 501 `{ "code": "not_supported" }` (401 when signed out). Clients should hide the comment box when they see that code. `GET /v1/me/likes/playlists` returns `[]`, because there is no route to like a playlist.

## Account playlists

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/me/playlists` | `{ "title": string, "trackIds": string[], "tracks"?: Track[], "public": boolean, "description"?: string, "sourceUrl"?: string }` | `Playlist` (201) |
| PATCH | `/v1/me/playlists/{id}` | any of `{ "title", "description", "public", "trackIds", "tracks" }` (`trackIds` or `tracks` replaces the whole order) | `Playlist` |
| DELETE | `/v1/me/playlists/{id}` | none | 204 |

`GET /v1/me/playlists` lists them (newest first). Track IDs are SoundCloud track IDs or Spotify track URIs. On read the server hydrates SoundCloud IDs into full `Track` objects and fills Spotify ones from stored snapshots, in the saved order, skipping tracks SoundCloud no longer has. Send `tracks` instead of (or with) `trackIds` when the list holds Spotify tracks; see [Spotify tracks](#spotify-tracks). The list leaves out `tracks` and reports `trackCount`, `duration` and `artworkUrl` as of the last write. A playlist holds at most 5,000 tracks and an account at most 500 playlists. `GET /v1/playlists/sp_…` returns a private playlist only to its owner and a public one to anyone.

## History

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/me/history` | `{ "trackId": string, "track"?: Track }` (`track` required for Spotify IDs) | 204 |
| GET | `/v1/me/history?cursor=` | | `Page<Track>`, most recent first, one entry per track |

The server keeps the 500 most recent tracks per account.

## Spotify tracks

People who pick Spotify as their music source save Spotify tracks in their Nightjar account (docs/spotify.md). The server has no Spotify token and can't look tracks up, so the client sends a snapshot of each Spotify `Track` and the server stores it.

| Where | What to send |
| --- | --- |
| `PUT /v1/me/likes/tracks/spotify%3Atrack%3A{id}` | Body `{ "track": Track }`. Required. `DELETE` needs no body. |
| `POST /v1/me/playlists`, `PATCH /v1/me/playlists/{id}` | `tracks: Track[]` in the new order. Spotify entries are full snapshots; SoundCloud entries only need `{ "id" }`. `tracks` wins over `trackIds` when both are sent. A `PATCH` with only `trackIds` (a reorder) works when the account already has a snapshot for every Spotify ID in it. |
| `POST /v1/me/history` | `{ "trackId": "spotify:track:…", "track": Track }`. |

Checks on every snapshot (400 `invalid_input` when one fails):

- Its `id` must equal the ID it's saved under, and look like `spotify:track:<base62>`.
- Only `Track` fields are kept: `id`, `title`, `user` (`id`, `username`, `avatarUrl`, `verified`), `artworkUrl`, `duration`, `genre`, `createdAt`, the four counts, `permalinkUrl`, `streamable`, `preview` and `album` (`id`, `title`, `artworkUrl`). `source` becomes `"spotify"`, `uri` becomes the ID, `waveform` becomes null, and anything else, including `liked` and `reposted`, is dropped.
- Strings are trimmed and capped (titles 300 characters, names 200, IDs 100). URLs that aren't `https:` become null. Counts must be non-negative numbers, otherwise 0. A cleaned snapshot is at most 4 KB.
- Like and history bodies are limited to 16 KB, playlist bodies to 6 MB.

Storage: table `track_snapshots(user_id, track_id, json, updated_at)` with one row per account and track, written again on every save. Snapshots aren't shared between accounts, so nothing one account sends shows up in another account's lists. A public playlist shows its owner's snapshots to everyone who opens it. Rows that no like, history entry or playlist uses any more are deleted when the account unlikes, edits or deletes a playlist, and now and then after a play.

Reads (`/v1/me/likes/tracks`, `/v1/me/history`, playlists) return the stored snapshot for Spotify IDs, in order with hydrated SoundCloud tracks, and set `liked` and `reposted` the same way for both. Reposts and follows stay SoundCloud-only. "Because you liked …" on Home uses the latest SoundCloud like.

## Spotify import

`GET /v1/import/spotify?url=<playlist or album URL, spotify: URI or bare ID>` returns the same `SpotifyList` shape the desktop app's local reader returns (see `src/env.d.ts`):

```json
{ "id": "…", "kind": "playlist", "url": "…", "name": "…", "owner": "…", "coverUrl": "…",
  "total": 33, "truncated": false, "source": "embed", "notice": null,
  "tracks": [{ "spotifyId": "…", "title": "…", "artists": ["…"], "durationMs": 225834, "explicit": false }] }
```

Tracks read from the full page (`source: "page"`) also carry `artworkUrl`, the 640 px cover of the track's album. The embed page has no per-track images, so embed lists leave it out and the client looks covers up through Spotify's oEmbed endpoint (`src/spotify/artwork.ts`).

The desktop app keeps reading Spotify itself (full playlists through a hidden window). The web player has no such window, so it calls this endpoint. The server reads the embed page (up to 100 tracks) and, for lists that hit that cap, loads the full page in Cloudflare Browser Rendering and replays Spotify's own paging request, so `source` is `"page"`. A 1,223-track playlist takes about 15 seconds. If the browser step fails you get the embed's 100 tracks with `truncated: true` and a `notice`. Links that aren't Spotify playlists or albums get 400 `invalid_input`; private or missing lists get 422 `import_failed` with a readable `error`. Matching against SoundCloud still happens in the client through `/v1/search/tracks`.

## Streams

`GET /v1/tracks/{id}/stream` resolves a transcoding to a short-lived URL and returns `StreamInfo`. It prefers unencrypted HLS (`protocol: "hls"`, AAC) and falls back to progressive MP3. SoundCloud's CDN sends `Access-Control-Allow-Origin: *` on both the playlist and its segments, so clients play it directly; the server never proxies audio. Tracks that only have a 30-second preview (`policy: SNIP`) come back with `streamable: true` but a `duration` of 30000 and a `preview: true` flag on `Track`; the UI labels them. Tracks with `policy: BLOCK` or only encrypted transcodings have `streamable: false`, and their stream route answers 403 `not_streamable`. Stream responses are `Cache-Control: no-store`.

## Home and feed

- `/v1/home` signed out: "Trending on SoundCloud" (`/charts?kind=trending`, all genres), the "Curated by SoundCloud", "Trending by genre" and "Artists to watch out for" playlist shelves from `/mixed-selections`, and "Artists in the charts". These are cached for 30 minutes. Signed in, "Because you liked …" (related tracks of the latest like) and "New from artists you follow" go first, and the list stops at six sections.
- "Trending by genre" playlists have IDs like `soundcloud:system-playlists:trending-by-genre:trap`. `GET /v1/playlists/{id}` accepts them.
- `/v1/feed` merges the latest 30 uploads of each followed user (up to 50 users), newest first, 20 per page. SoundCloud's public API has no reposts feed, so there is no `repostedBy`.

## Caching

The server caches SoundCloud responses with the Cache API: search 5 minutes, tracks, users and related tracks 1 hour, comments and user track lists 10 minutes, waveforms a day. Personal routes and streams aren't cached.

## CORS

`Access-Control-Allow-Origin: *`, allowed headers `Authorization, Content-Type`, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`. No cookies are used.

## Spotify sign-in

A Nightjar account can keep the user's Spotify sign-in so every device signed in to the account is connected after one sign-in (docs/spotify.md). Spotify rotates the refresh token every time it's used, so devices never keep their own copy: the server holds it, refreshes it, and hands out access tokens.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/v1/me/spotify` | | `{ "connected": false }` or `{ "connected": true, "clientId", "scope", "profile", "updatedAt" }`. Never contains tokens. |
| PUT | `/v1/me/spotify` | `{ "clientId": string, "refreshToken": string, "profile"?: { id, displayName, product, country, avatarUrl } }` | The link plus `{ "accessToken", "expiresAt" }`. The server refreshes once immediately, which checks the token and rotates it, so the device's copy is spent. 400 `spotify_rejected` if Spotify refuses it. |
| POST | `/v1/me/spotify/token` | `{ "force"?: boolean }` | `{ "accessToken", "expiresAt" }`. Reuses the cached token while it has 5 or more minutes left; `force` after a 401 from Spotify. 404 `spotify_not_linked`, 409 `spotify_reauth` (revoked; the link is removed and the user connects again), 503 `spotify_busy` with `Retry-After` in the rare case another device's refresh is still running. |
| PATCH | `/v1/me/spotify` | `{ "profile": … }` | The link. Updates the stored profile shown on other devices. |
| DELETE | `/v1/me/spotify` | | 204. Disconnects every device on the account. |

- Tokens are encrypted with AES-256-GCM using the Worker secret `SPOTIFY_TOKEN_KEY` (32 random bytes, base64url, set with `wrangler secret put SPOTIFY_TOKEN_KEY`), with the account ID as authenticated data. Without the secret these routes answer 503 `not_configured`.
- Refreshes take a 20-second per-account lock, so two devices asking at the same moment don't spend the same refresh token twice; the second one waits for the first one's result.
- Deleting the account deletes the link.
