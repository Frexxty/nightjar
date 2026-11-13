// Dynamic routes for stratus.k3s.lat. Everything else is served from
// ./public by Workers Static Assets before this script runs.

// GITHUB_REPO can be set as a var to point at another repo (handy for testing).
const DEFAULT_REPO = "Frexxty/stratus";
const repoOf = (env) => env.GITHUB_REPO || DEFAULT_REPO;
const releasesPage = (env) => `https://github.com/${repoOf(env)}/releases`;
const latestDownload = (env) => `https://github.com/${repoOf(env)}/releases/latest/download`;

const ASSETS = {
  mac: "Stratus-mac-arm64.dmg",
  "mac-intel": "Stratus-mac-x64.dmg",
  windows: "Stratus-Setup-x64.exe",
  linux: "Stratus-linux-x86_64.AppImage",
};

const CACHE_OK = 600; // seconds, when GitHub answered with a release
const CACHE_MISS = 60; // seconds, when there is no release or GitHub failed

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    if (url.pathname === "/api/latest" || url.pathname === "/api/latest/") {
      const { body, maxAge } = await getLatest(env, ctx, url);
      return json(body, maxAge);
    }

    const m = url.pathname.match(/^\/download\/([a-z-]+)\/?$/);
    if (m) return download(m[1], env, ctx, url);

    // Anything else under run_worker_first paths falls through to static assets.
    return env.ASSETS.fetch(request);
  },
};

async function download(platform, env, ctx, url) {
  const asset = ASSETS[platform];
  if (!asset) {
    const page = await env.ASSETS.fetch(new Request(new URL("/404", url)));
    return new Response(page.body, { status: 404, headers: page.headers });
  }

  const { body } = await getLatest(env, ctx, url);
  if (!body.version) return comingSoon(platform, env);

  // The release exists but this platform's file isn't attached yet.
  if (!body._assets.includes(asset)) return redirect(body.url || releasesPage(env));

  return redirect(`${latestDownload(env)}/${asset}`);
}

// Returns { body, maxAge }. Uses the Cache API so GitHub sees at most one
// request per colo every 10 minutes, or every minute while there's no release.
async function getLatest(env, ctx, url) {
  const cache = caches.default;
  const key = new Request(`${url.origin}/__cache/github-latest/${repoOf(env)}`);

  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.json();
    return { body, maxAge: body.version ? CACHE_OK : CACHE_MISS };
  }

  const body = await fetchLatest(env);
  const maxAge = body.version ? CACHE_OK : CACHE_MISS;
  const stored = new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
  });
  ctx.waitUntil(cache.put(key, stored));
  return { body, maxAge };
}

async function fetchLatest(env) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "stratus-site (+https://stratus.k3s.lat)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repoOf(env)}/releases/latest`, { headers });
  } catch (err) {
    return (await fromUpdateFeeds(env)) ?? empty(env, `network: ${err.message}`);
  }
  // 404: repo missing or no published release. 403/429: rate limited, which
  // happens often because Workers share outgoing IPs; the update feeds still work.
  if (!res.ok) return (await fromUpdateFeeds(env)) ?? empty(env, `github ${res.status}`);

  let rel;
  try {
    rel = await res.json();
  } catch {
    return empty(env, "github returned invalid JSON");
  }
  if (!rel || !rel.tag_name) return empty(env, "release has no tag");

  const names = (rel.assets || []).map((a) => a.name);
  const link = (name) => (names.includes(name) ? `${latestDownload(env)}/${name}` : null);

  return {
    version: rel.tag_name.replace(/^v/i, ""),
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    publishedAt: rel.published_at,
    notes: (rel.body || "").slice(0, 8000),
    url: rel.html_url,
    downloads: {
      mac: link(ASSETS.mac),
      macIntel: link(ASSETS["mac-intel"]),
      windows: link(ASSETS.windows),
      linux: link(ASSETS.linux),
    },
    _assets: names,
  };
}

// Fallback when the GitHub API refuses: read the electron-updater feeds that
// every release attaches (latest.yml for Windows, latest-mac.yml for macOS).
// They are plain release downloads, so the API rate limit doesn't apply.
async function fromUpdateFeeds(env) {
  const read = async (name) => {
    try {
      const res = await fetch(`${latestDownload(env)}/${name}`, { headers: { "User-Agent": "stratus-site (+https://stratus.k3s.lat)" } });
      return res.ok ? await res.text() : "";
    } catch {
      return "";
    }
  };
  const [win, mac, linux] = await Promise.all([read("latest.yml"), read("latest-mac.yml"), read("latest-linux.yml")]);
  const version = (mac || win).match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  if (!version) return null;

  const names = [...`${win}\n${mac}\n${linux}`.matchAll(/^\s*-?\s*(?:url|path):\s*['"]?([^\s'"]+)/gm)].map((m) => m[1]);
  const link = (name) => (names.includes(name) ? `${latestDownload(env)}/${name}` : null);
  // releaseNotes is a YAML block scalar: indented lines after "releaseNotes: |".
  const notes = (mac || win).match(/^releaseNotes:\s*\|-?\n((?:[ \t]+.*\n?|\n)*)/m)?.[1]
    ?.split("\n").map((line) => line.replace(/^ {2}/, "")).join("\n").trim() ?? null;
  const tag = `v${version}`;

  return {
    version,
    tag,
    name: `Stratus ${version}`,
    publishedAt: (mac || win).match(/^releaseDate:\s*['"]?([^'"\n]+)/m)?.[1] ?? null,
    notes: notes ? notes.slice(0, 8000) : null,
    url: `https://github.com/${repoOf(env)}/releases/tag/${tag}`,
    downloads: {
      mac: link(ASSETS.mac),
      macIntel: link(ASSETS["mac-intel"]),
      windows: link(ASSETS.windows),
      linux: link(ASSETS.linux),
    },
    _assets: names,
  };
}

function empty(env, reason) {
  return {
    version: null,
    publishedAt: null,
    notes: null,
    url: releasesPage(env),
    downloads: { mac: null, macIntel: null, windows: null, linux: null },
    reason,
    _assets: [],
  };
}

function json(body, maxAge) {
  const { _assets, ...pub } = body;
  return new Response(JSON.stringify(pub, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function comingSoon(platform, env) {
  const label = { mac: "macOS (Apple Silicon)", "mac-intel": "macOS (Intel)", windows: "Windows" }[platform];
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>First release coming soon · Stratus</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101012; color: #f4f4f6;
    font: 16px/1.55 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 440px; text-align: center; }
  img { width: 64px; height: auto; }
  h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.025em; margin: 18px 0 8px; }
  p { color: #a1a1aa; margin: 0 0 22px; }
  a { color: #fff; }
  .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 11px 18px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .primary { background: #ff5500; color: #fff; }
  .ghost { background: #1f1f22; color: #f4f4f6; }
</style>
</head>
<body>
<main>
  <img src="/logo-mark.svg" alt="">
  <h1>The first release is on its way</h1>
  <p>There's no ${label} build to download yet. Builds will show up on GitHub Releases as soon as v0.1.0 is tagged, and this link will start working on its own.</p>
  <div class="row">
    <a class="btn primary" href="${releasesPage(env)}">Check GitHub Releases</a>
    <a class="btn ghost" href="/">Back to the site</a>
  </div>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_MISS}` },
  });
}
