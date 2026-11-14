# stratus.k3s.lat

The landing page and download API for Stratus. It's one Cloudflare Worker named `stratus-site`. Static files in `public/` go out through Workers Static Assets, and `src/worker.js` handles the two dynamic paths. There's no build step and no framework, just HTML, CSS and a bit of vanilla JS.

## Layout

```
public/index.html      the page
public/styles.css      all styles
public/main.js         OS detection, version label, scroll reveals, waveform demo
public/404.html        served for unknown paths
public/_headers        security headers and image caching
public/img/            WebP screenshots of the app (full size and 680/720px versions)
public/logo-*.svg      wordmark and mark (see below)
public/favicon.*       favicons
public/og-image.png    1200x630 social preview
src/worker.js          /api/* and /download/*
wrangler.jsonc         Worker config
```

## Logo and icons

The brand files come from `brand/`, `public/` and `web/icons/` in the main repo and are copied here, because the site only serves what's inside `site/public/`. `node brand/source/generate.mjs` writes these copies. The HTML only refers to them by path.

| File | Source in the repo | Used for |
| --- | --- | --- |
| `public/logo-wordmark.svg` | `brand/logo-wordmark.svg` | Nav and footer |
| `public/logo-mark.svg` | `brand/logo-mark.svg` | 404 and "coming soon" pages |
| `public/og-image.png` | `brand/og-image.png` | Social preview |
| `public/favicon.svg`, `public/favicon.png` | `public/favicon.*` | Favicon |
| `public/apple-touch-icon.png` | `web/icons/apple-touch-icon.png` (full bleed, 180 px) | iOS home screen |
| `public/img/app-icon.webp` | `build/icon.svg`, rendered at 256 px | Open source section |

Colours and type follow `brand/README.md`: Ember `#FF5500` as the only accent, Night `#101012` for the page, Panel and Raised for surfaces, Mist for text, and Inter at 400, 500 and 600.

## Routes

`GET /api/latest` returns the latest GitHub release of `Frexxty/stratus` as JSON:

```json
{
  "version": "0.1.0",
  "tag": "v0.1.0",
  "name": "v0.1.0",
  "publishedAt": "2026-11-20T12:00:00Z",
  "notes": "release notes in Markdown",
  "url": "https://github.com/Frexxty/stratus/releases/tag/v0.1.0",
  "downloads": { "mac": "https://…", "macIntel": "https://…", "windows": "https://…" }
}
```

A download entry is null when that file isn't attached to the release. If the repo doesn't exist, has no release yet, or GitHub rate-limits the request, the response is still a 200 with `version: null` and a `reason` field. The Worker caches the GitHub answer with the Cache API for 10 minutes when there's a release and 1 minute when there isn't. The response has `Access-Control-Allow-Origin: *`, so the app or anything else can call it.

`GET /download/mac`, `/download/mac-intel` and `/download/windows` redirect (302) to `https://github.com/Frexxty/stratus/releases/latest/download/<file>`, where the file is `Stratus-mac-arm64.dmg`, `Stratus-mac-x64.dmg` or `Stratus-Setup-x64.exe`. Before there's a release, these return a short "first release is on its way" page instead. If a release exists but the file for that platform is missing, they redirect to the release page on GitHub. Any other `/download/...` path gets the 404 page.

The page calls `/api/latest` on load and shows the version under the download button. When the version is null, the label stays hidden.

## Local development

```sh
cd site
npx wrangler@latest dev
```

That serves the site and the Worker on http://localhost:8787. To test the API against a repo that already has releases, override the repo:

```sh
npx wrangler@latest dev --var GITHUB_REPO:sharkdp/bat
```

## Deploying

```sh
cd site
npx wrangler@latest deploy
```

`wrangler.jsonc` attaches the Worker to `stratus.k3s.lat` as a Custom Domain, so Cloudflare creates and manages the DNS record. It also stays reachable at `stratus-site.frexty.workers.dev`.

The GitHub API allows 60 unauthenticated requests per hour per IP. The cache keeps the Worker well under that, but if you want more headroom, add a token. It only needs read access to public repos:

```sh
npx wrangler@latest secret put GITHUB_TOKEN
```

The Worker uses the token when it's set and works fine without it.
