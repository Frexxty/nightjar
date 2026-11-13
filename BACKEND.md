# Backend contract

Stratus never talks to SoundCloud. It talks to a server that returns JSON shaped like the types in [`src/api/types.ts`](src/api/types.ts). By default that is the hosted Stratus server, which implements everything here plus accounts; [docs/hosted-api.md](docs/hosted-api.md) describes its extra routes. To use your own server instead, pick "Custom server" in Settings, enter the base URL and an optional bearer token, and press Apply. `VITE_BACKEND_URL` at build time replaces the hosted server's URL, for example with a staging copy.

If you'd rather not run a server, write a class that implements the `Backend` interface in `src/api/types.ts` and return it from `createBackend` in `src/api/index.ts`. The UI doesn't care which one it gets. Every optional method it leaves out hides the matching feature.

## Requests

- Every request sends `Accept: application/json`. If a token is set, it also sends `Authorization: Bearer <token>`. The token is the one typed in Settings, or the one `/auth/login` returned if you signed in.
- The renderer runs from `file://` in the desktop app, from the web player's origin in a browser, and from `http://localhost:5173` in dev, so the server has to answer CORS preflights. `Access-Control-Allow-Origin: *` plus `Access-Control-Allow-Headers: Authorization, Content-Type` and `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE` is enough.
- Errors may use the JSON shape `{ "error": "message for people", "code": "short_code" }`. The UI shows `error`, and uses `code` to place messages next to the right form field (`username_taken`, `email_taken`, `weak_password`, `invalid_credentials`, and so on). Any other non-2xx response shows as an error with the status and the first 200 characters of the body.
- A 401 from `/me` means "not signed in" and isn't treated as an error. If the app had a token, it forgets it and says the session ended. A 401 from a personal route (likes, feed, playlists) shows a sign-in prompt instead of an error.
- A 501 (or `code: "not_supported"`) from `POST /tracks/{id}/comments` hides the comment box for that server from then on.
- Paged routes take `?cursor=` and return `{ "items": [...], "next": "<cursor>" | null }`. The cursor is opaque to the UI. Pass back SoundCloud's `next_href`, an offset, whatever you like.
- All durations and comment timestamps are milliseconds. Dates are ISO 8601 strings.

## Routes

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/me` | `User`, or 401 when signed out |
| GET | `/home` | `Section[]` (shelves on the Home page) |
| GET | `/feed?cursor=` | `Page<FeedItem>` (the Stream page) |
| GET | `/search?q=` | `SearchResults` (first page of each kind) |
| GET | `/search/{tracks\|users\|playlists\|albums}?q=&cursor=` | `Page<Track \| User \| Playlist>` |
| GET | `/tracks/{id}` | `Track` |
| GET | `/tracks/{id}/comments` | `Comment[]` sorted by `timestamp` |
| POST | `/tracks/{id}/comments` | `Comment`. Body: `{ "body": string, "timestamp": number \| null }` |
| GET | `/tracks/{id}/related` | `Track[]`. Also used for stations and autoplay when the queue ends |
| GET | `/tracks/{id}/stream` | `StreamInfo` |
| GET | `/playlists/{id}` | `Playlist` with `tracks` filled in |
| GET | `/users/{id}` | `User` |
| GET | `/users/{id}/top-tracks` | `Track[]` (the "Popular" list, 5 is plenty) |
| GET | `/users/{id}/tracks?cursor=` | `Page<Track>` |
| GET | `/users/{id}/playlists` | `Playlist[]` |
| GET | `/users/{id}/likes?cursor=` | `Page<Track>` |
| GET | `/me/likes/tracks?cursor=` | `Page<Track>` |
| GET | `/me/likes/playlists` | `Playlist[]` (albums and playlists, `isAlbum` tells them apart) |
| GET | `/me/playlists` | `Playlist[]` the user owns. These appear in the sidebar |
| POST | `/me/playlists` | `Playlist`. Body: `{ "title": string, "trackIds": string[], "public": boolean, "sourceUrl"?: string }`. Optional, see "Importing from Spotify" |
| GET | `/me/following` | `User[]` |
| PUT / DELETE | `/me/likes/tracks/{id}` | 204 |
| PUT / DELETE | `/me/reposts/tracks/{id}` | 204 |
| PUT / DELETE | `/me/following/{userId}` | 204 |

The like, repost and follow buttons update immediately and roll back with a toast if the request fails. When signed out of a server with accounts, they open the sign-in page instead.

### Optional routes

The app works without these. The hosted server has all of them; [docs/hosted-api.md](docs/hosted-api.md) has the bodies, error codes and validation rules.

| Method | Path | What the UI does with it | `Backend` method |
| --- | --- | --- | --- |
| POST | `/auth/signup`, `/auth/login` | The sign-in page. Both return `{ "token", "user" }`; the app keeps the token with the backend settings | `signup`, `login` |
| POST | `/auth/logout` | Sign out (the app forgets the token even if this fails) | `logout` |
| DELETE | `/me` | Delete account in Settings. Body: `{ "password": string }` | `deleteAccount` |
| PATCH | `/me/playlists/{id}` | Rename, reorder and remove tracks on playlists you own. `trackIds` replaces the whole order | `updatePlaylist` |
| DELETE | `/me/playlists/{id}` | Delete a playlist you own | `deletePlaylist` |
| POST | `/me/history` | Sent once per played track, fire and forget. Body: `{ "trackId": string }` | `addHistory` |
| GET | `/me/history?cursor=` | The History page when signed in. Without it, History shows plays recorded on this computer | `history` |
| GET | `/import/spotify?url=` | Reads a Spotify list in the browser, where the app can't read Spotify itself. Returns `SpotifyList` | `importSpotify` |

A playlist counts as yours, and gets the edit buttons, when its `user.id` matches `/me`'s `id` or its id starts with `sp_`.

## Importing from Spotify

The desktop app reads the Spotify playlist itself (see the README). In a browser it calls `GET /import/spotify?url=` instead, if the server has it. Either way Stratus then calls `GET /search/tracks?q=` for each track, usually twice: first with "artist title" and, if nothing scores well, with the title alone. It runs four searches at a time and does its own scoring, so pass the query to SoundCloud's track search unchanged. A 500-track playlist means 500 to 1,000 searches, so rate-limit or cache on your side if SoundCloud needs it.

`POST /me/playlists` is optional. If your server implements it, the import page's main button is "Save to my library", with "Save on this computer" next to it. The body is `{ "title": string, "trackIds": string[], "public": boolean, "sourceUrl"?: string }`, where `trackIds` are track `id`s your server returned and `sourceUrl` is the Spotify link. Respond with the new `Playlist`; the UI then opens it and refreshes `/me/playlists`. Settings uses the same route to upload playlists saved on this computer. With a custom `Backend` class, implement `createPlaylist(title, trackIds, isPublic, extras)` instead, or leave it out.

## Streaming

`GET /tracks/{id}/stream` returns:

```json
{ "url": "https://…/playlist.m3u8", "protocol": "hls" }
```

or `"protocol": "progressive"` for a plain MP3/AAC/Opus URL. HLS goes through hls.js (loaded on first use). Progressive URLs go straight into an `<audio>` element.

SoundCloud tracks list several transcodings. Most are HLS, and the playable URL usually expires within minutes. Resolve the transcoding when this route is called rather than caching the final URL. If the URL needs headers the browser can't send, proxy the audio through your server and return your own URL.

Set `streamable: false` on a track to grey it out. The player skips tracks whose stream request fails.

## Waveforms

`Track.waveform` is an array of peaks between 0 and 1, any length. The UI resamples it to fit. SoundCloud's `waveform_url` JSON has `samples` (integers) and `height`; divide each sample by `height`. Leave the field null and the waveform draws as a flat line.

## Comments

`Comment.timestamp` places a comment on the waveform and in the synced comment list. Use `null` for comments that aren't pinned to a time; they show at the bottom under "Other comments".

## Feed items

```json
{ "kind": "track", "createdAt": "…", "track": { … }, "repostedBy": { … } }
{ "kind": "playlist", "createdAt": "…", "playlist": { … } }
```

Leave out `repostedBy` for original posts. For playlists in the feed, including the first few `tracks` gives the inline preview.
