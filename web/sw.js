// Service worker for the Stratus web player. web/pwa.ts fills in BUILD and
// PRECACHE when it copies this file into dist-web/.
//
// - The app shell (index.html, hashed JS/CSS, icons) is cached on install.
// - Pages are network-first, so a deploy shows up on the next load; offline
//   they fall back to the cached index.html.
// - Hashed /assets/ files never change, so they're served from the cache.
// - Nothing from another origin is touched: API calls, artwork and audio go
//   straight to the network and are never cached here.
// - A new worker waits until the page asks it to take over (the "New version
//   available" toast), so a running session never mixes old and new files.

const BUILD = "__BUILD__";
const PRECACHE = ["__PRECACHE__"];
const CACHE = `stratus-shell-${BUILD}`;
const INDEX = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("stratus-shell-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") event.respondWith(page(req));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(req));
  else if (PRECACHE.includes(url.pathname)) event.respondWith(networkFirst(req));
});

async function page(req) {
  try {
    return await fetch(req);
  } catch {
    // The cached page matches the assets this worker cached, so it always boots.
    return (await caches.match(INDEX)) || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}
