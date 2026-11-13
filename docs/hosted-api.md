# Hosted backend (stratus-api)

The official hosted backend. It implements every route in [BACKEND.md](../BACKEND.md) plus accounts, account playlists and a Spotify import endpoint, so the desktop app and the web player (PWA) share one library.

- Base URL: `https://stratus-api.k3s.lat/v1`. All BACKEND.md routes live under it (`/v1/home`, `/v1/me`, …).
- Runs as the Cloudflare Worker `stratus-api` with a D1 database. Source lives in `server/`.
- Web player: `https://stratus-app.k3s.lat` (Worker `stratus-app`, static build of the same Vue app).

## Where data comes from

- SoundCloud catalogue (search, tracks, users, playlists, comments, related tracks, waveforms, stream URLs) comes from SoundCloud's public `api-v2` with the web client's `client_id`, which the server reads from soundcloud.com's script bundles and refreshes when SoundCloud rejects it.
- Everything personal (account, likes, reposts, follows, saved playlists, history) is stored in D1. Stratus accounts are not SoundCloud accounts; nothing is written to SoundCloud.

## IDs

- SoundCloud objects keep SoundCloud's numeric IDs as strings: tracks `"248639197"`, users `"1234"`, SoundCloud playlists `"987"`.
- Playlists saved to a Stratus account use IDs prefixed `sp_` (e.g. `sp_k3j2…`). `GET /v1/playlists/{id}` serves both kinds.

## Accounts

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/auth/signup` | `{ "username": string, "email": string, "password": string }` | `{ "token": string, "user": User }` (201) |
| POST | `/v1/auth/login` | `{ "login": string, "password": string }` (`login` is email or username) | `{ "token": string, "user": User }` |
| POST | `/v1/auth/logout` | none, uses the bearer token | 204 |
| DELETE | `/v1/me` | `{ "password": string }` | 204, deletes the account and all its data |

- Send the token as `Authorization: Bearer <token>` on every request. Tokens last 90 days and are stored server-side as a hash.
- Usernames: 3 to 30 characters, letters, digits, `_`, `-`, `.`; unique, case-insensitive. Passwords: at least 8 characters.
- Errors are JSON `{ "error": "human readable message", "code": "short_code" }` with a 4xx status. Codes include `invalid_credentials`, `username_taken`, `email_taken`, `weak_password`, `invalid_input`, `rate_limited`, `unauthorized`.
- `/v1/me`, `/v1/me/*`, `/v1/feed`, likes/reposts/follows and comment posting require a token. Signed out they return 401 `{ "code": "unauthorized" }`. Catalogue routes work signed out.
- `User` for the signed-in account: `id` is `"me:<uuid>"`-style opaque string, `username`, `avatarUrl: null`, counts from D1.

## Account playlists

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/me/playlists` | `{ "title": string, "trackIds": string[], "public": boolean, "description"?: string, "sourceUrl"?: string }` | `Playlist` (201) |
| PATCH | `/v1/me/playlists/{id}` | any of `{ "title", "description", "public", "trackIds" }` (`trackIds` replaces the whole order) | `Playlist` |
| DELETE | `/v1/me/playlists/{id}` | none | 204 |

`GET /v1/me/playlists` lists them (newest first). Track IDs are SoundCloud track IDs; the server hydrates them into full `Track` objects on read, in the saved order, skipping tracks SoundCloud no longer has.

## History

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/me/history` | `{ "trackId": string }` | 204 |
| GET | `/v1/me/history?cursor=` | | `Page<Track>`, most recent first, one entry per track |

## Spotify import

`GET /v1/import/spotify?url=<playlist or album URL, spotify: URI or bare ID>` returns the same `SpotifyList` shape the desktop app's local reader returns (see `src/env.d.ts`):

```json
{ "id": "…", "kind": "playlist", "url": "…", "name": "…", "owner": "…", "coverUrl": "…",
  "total": 33, "truncated": false, "source": "embed", "notice": null,
  "tracks": [{ "spotifyId": "…", "title": "…", "artists": ["…"], "durationMs": 225834, "explicit": false }] }
```

The desktop app keeps reading Spotify itself (full playlists through a hidden window). The web player has no such window, so it calls this endpoint. The server reads the embed page (up to 100 tracks) and, when Cloudflare Browser Rendering is available, the full page for longer lists. Matching against SoundCloud still happens in the client through `/v1/search/tracks`.

## Streams

`GET /v1/tracks/{id}/stream` resolves a transcoding to a short-lived URL and returns `StreamInfo`. It prefers unencrypted HLS (`protocol: "hls"`, AAC) and falls back to progressive MP3. SoundCloud's CDN sends `Access-Control-Allow-Origin: *` on both the playlist and its segments, so clients play it directly; the server never proxies audio. Tracks that only have a 30-second preview (`policy: SNIP`) come back with `streamable: true` but a `duration` of 30000 and a `preview: true` flag on `Track`; the UI labels them.

## CORS

`Access-Control-Allow-Origin: *`, allowed headers `Authorization, Content-Type`, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`. No cookies are used.
