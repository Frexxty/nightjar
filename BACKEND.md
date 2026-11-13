# Backend contract

Cumulus never talks to SoundCloud. It talks to your server, which returns JSON shaped like the types in [`src/api/types.ts`](src/api/types.ts). Pick "HTTP server" in Settings, enter the base URL and an optional bearer token, and press Apply. You can also set `VITE_BACKEND_URL` at build time to make HTTP the default.

If you'd rather not run a server, write a class that implements the `Backend` interface in `src/api/types.ts` and return it from `createBackend` in `src/api/index.ts`. The UI doesn't care which one it gets.

## Requests

- Every request sends `Accept: application/json`. If a token is set, it also sends `Authorization: Bearer <token>`.
- The renderer runs from `file://` in production and `http://localhost:5173` in dev, so the server has to answer CORS preflights. `Access-Control-Allow-Origin: *` plus `Access-Control-Allow-Headers: Authorization, Content-Type` and `Access-Control-Allow-Methods: GET, POST, PUT, DELETE` is enough.
- Any non-2xx response shows as an error in the UI with the status and the first 200 characters of the body. A 401 from `/me` means "not signed in" and isn't treated as an error.
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
| GET | `/me/following` | `User[]` |
| PUT / DELETE | `/me/likes/tracks/{id}` | 204 |
| PUT / DELETE | `/me/reposts/tracks/{id}` | 204 |
| PUT / DELETE | `/me/following/{userId}` | 204 |

The like, repost and follow buttons update immediately and roll back with a toast if the request fails.

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
