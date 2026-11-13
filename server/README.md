# stratus-api

The hosted backend for Stratus, live at `https://stratus-api.k3s.lat/v1`. It's a Cloudflare Worker with a D1 database. It serves every route in [BACKEND.md](../BACKEND.md) plus accounts, account playlists, history and a Spotify import endpoint, as described in [docs/hosted-api.md](../docs/hosted-api.md).

## Layout

```
src/index.ts            router, accounts, likes/reposts/follows, account playlists, history, Spotify route
src/catalogue.ts        search, tracks, users, SoundCloud playlists, home and feed
src/soundcloud.ts       api-v2 client: client_id discovery, retries, Cache API, track hydration, waveforms
src/map.ts              api-v2 objects to Stratus types (pure)
src/auth.ts             PBKDF2 hashing, session tokens, input checks (pure)
src/http.ts             JSON responses, errors, CORS, cursors (pure)
src/spotify.ts          Spotify embed and pathfinder parsing, ported from electron/spotify*.cjs (pure)
src/spotify-browser.ts  full-length Spotify lists through Browser Rendering
src/db.ts               sessions, account users, per-IP rate limits
migrations/             D1 schema
test/                   unit tests for the pure modules
scripts/smoke.mjs       end-to-end test against a deployed URL
scripts/match-spotify.mjs  runs the app's matcher for a Spotify list against a deployed URL
```

The files marked pure import nothing from the Workers runtime, so `node --test` loads them as they are.

## Run it locally

```sh
cd server
npm install
npm run migrate:local    # creates the local D1 database in .wrangler/
npm run dev              # wrangler dev on http://localhost:8787
```

Local mode uses a local D1 file and the Cache API does nothing, so every request goes to SoundCloud. The Spotify import still works for lists under 100 tracks. Longer lists need Browser Rendering, which `wrangler dev` only reaches with `--remote`.

Point the app at it with Settings > HTTP server and `http://localhost:8787/v1`, or run the checks:

```sh
npm test                                         # unit tests, no network
npm run typecheck
node scripts/smoke.mjs http://localhost:8787/v1  # creates and deletes a throwaway account
```

## Deploy

The Worker is called `stratus-api`, the D1 database `stratus`, and `wrangler.jsonc` attaches the custom domain `stratus-api.k3s.lat`.

```sh
npm run migrate:remote   # wrangler d1 migrations apply stratus --remote
npm run deploy           # wrangler deploy
node scripts/smoke.mjs   # against https://stratus-api.k3s.lat/v1
```

New schema changes go in a new numbered file in `migrations/`. Apply them before deploying code that needs them.

## Passwords and sessions

Passwords are hashed with PBKDF2-SHA256 through WebCrypto, with a random 16-byte salt per user and 100,000 iterations. That's the most the Workers runtime allows: it rejects anything above 100,000 with `NotSupportedError`. Each user row stores its own iteration count, and `needsRehash` in `src/auth.ts` rehashes on the next successful login if the default goes up.

Session tokens are 32 random bytes in base64url. Only their SHA-256 is stored, and they expire after 90 days. Signup, login and account deletion are limited to 10 requests a minute per IP, counted in D1. Passwords and tokens are never logged.

## About SoundCloud's client_id

There's no public SoundCloud API key involved. The server uses SoundCloud's web API (`api-v2.soundcloud.com`) the way soundcloud.com does in a browser, with the `client_id` the website ships in its JavaScript. On first use the Worker loads soundcloud.com, reads the script bundles, takes the `client_id`, and keeps it in memory and in the D1 `settings` table. When api-v2 answers 401 or 403 it fetches a new one and retries once.

That arrangement can break without notice. SoundCloud can rotate the id, change how the website embeds it, rate limit or block Cloudflare's IP ranges, or change api-v2 itself. If SoundCloud answers 429, the API returns 503 `upstream_rate_limited` with a `Retry-After` header. Audio is never proxied: the stream route returns SoundCloud's own short-lived HLS or MP3 URL and the client plays it from SoundCloud's CDN.
