// Host routing in the web player and landing site Workers: the new hosts are
// served, the old ones redirect, and the web player's old host still serves
// the Spotify callback. Runs the Worker modules with a fake ASSETS binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import webWorker, { servedOnOldHost } from "../web/worker.js";
import siteWorker from "../site/src/worker.js";

const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(`asset ${url.pathname}`, { status: 200, headers: { "Content-Type": "text/plain" } });
  },
};
const env = { ASSETS: assets };
const ctx = { waitUntil() {} };

const get = (worker, url) => worker.fetch(new Request(url), env, ctx);

test("web player: the new host serves the app", async () => {
  const res = await get(webWorker, "https://nightjar-app.k3s.lat/");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "asset /");
});

test("web player: the old host redirects, keeping path and query, and marks the move", async () => {
  const res = await get(webWorker, "https://stratus-app.k3s.lat/some/page?x=1&y=2");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://nightjar-app.k3s.lat/some/page?x=1&y=2");
  assert.match(res.headers.get("Set-Cookie"), /^nightjar-moved=1; Domain=k3s\.lat; Path=\/; Max-Age=600; Secure; SameSite=Lax$/);
  for (const page of ["/", "/index.html", "/welcome"]) {
    assert.equal((await get(webWorker, `https://stratus-app.k3s.lat${page}`)).status, 301, page);
  }
});

test("web player: the old host still serves the Spotify callback and what it loads", async () => {
  const cb = await get(webWorker, "https://stratus-app.k3s.lat/spotify-callback?code=x&state=y");
  assert.equal(cb.status, 200);
  assert.equal(await cb.text(), "asset /spotify-callback");
  for (const file of ["/assets/index-abc123.js", "/assets/index-abc.css", "/favicon.svg", "/icons/icon-192.png", "/sw.js", "/manifest.webmanifest"]) {
    assert.equal(servedOnOldHost(file), true, file);
    assert.equal((await get(webWorker, `https://stratus-app.k3s.lat${file}`)).status, 200, file);
  }
});

test("web player: the old host's hand-off page only returns to the new host", async () => {
  const res = await get(webWorker, "https://stratus-app.k3s.lat/__nightjar-handoff?return=https%3A%2F%2Fnightjar-app.k3s.lat%2F");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const html = await res.text();
  assert.match(html, /startsWith\("stratus\."\)/);
  assert.match(html, /back\.origin === "https:\/\/nightjar-app\.k3s\.lat"/);
  assert.match(html, /window\.name = "nightjar-handoff:"/);
});

test("site: the new host is served and the old host redirects with path and query", async () => {
  const ok = await get(siteWorker, "https://nightjar.k3s.lat/");
  assert.equal(ok.status, 200);
  const res = await get(siteWorker, "https://stratus.k3s.lat/download/mac?ref=x");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://nightjar.k3s.lat/download/mac?ref=x");
});

test("site: an unknown download platform is a 404, even one named like an Object method", async () => {
  for (const name of ["beos", "constructor"]) {
    const res = await get(siteWorker, `https://nightjar.k3s.lat/download/${name}`);
    assert.equal(res.status, 404, name);
  }
});
