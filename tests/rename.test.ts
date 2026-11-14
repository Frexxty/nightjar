// What the Stratus -> Nightjar rename must keep working: saved backend
// configs, the accent, and the web player's move to a new origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backendKey, canonicalHostedUrl, HOSTED_URL, LEGACY_HOSTED_URLS, normalizeBackendConfig } from "../src/api/config.ts";
import { ACCENTS, DEFAULT_ACCENT, migrateAccent } from "../src/lib/accent.ts";
import {
  appKeys, applyHandoff, DONE_KEY, handoffUrl, MOVED_COOKIE, NEW_ORIGIN, OLD_ORIGIN, readHandoff, shouldHop, WINDOW_NAME_PREFIX,
  type KeyValueStore,
} from "../src/lib/handoff.ts";

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

test("the hosted API moved to nightjar-api.k3s.lat and the old URL maps onto it", () => {
  assert.equal(HOSTED_URL, "https://nightjar-api.k3s.lat/v1");
  assert.deepEqual(LEGACY_HOSTED_URLS, ["https://stratus-api.k3s.lat/v1"]);
  assert.equal(canonicalHostedUrl("https://stratus-api.k3s.lat/v1/"), HOSTED_URL);
  assert.equal(canonicalHostedUrl("https://STRATUS-API.k3s.lat/v1"), HOSTED_URL);
  assert.equal(canonicalHostedUrl("https://nightjar-api.k3s.lat/v1/"), HOSTED_URL);
  assert.equal(canonicalHostedUrl("http://192.168.1.4:8787/"), "http://192.168.1.4:8787");
});

test("a saved custom-server config pointing at the old hosted URL becomes the hosted backend, token kept", () => {
  const c = normalizeBackendConfig({ kind: "http", baseUrl: "https://stratus-api.k3s.lat/v1", token: "tok", hostedToken: "" });
  assert.equal(c.kind, "hosted");
  assert.equal(c.hostedToken, "tok");
  assert.equal(c.token, "");
  // A build pointed at the old URL through VITE_BACKEND_URL behaves the same.
  assert.equal(normalizeBackendConfig({ kind: "http", baseUrl: HOSTED_URL, token: "t" }, "https://stratus-api.k3s.lat/v1").kind, "hosted");
});

test("a hosted config from 0.3.x keeps its session", () => {
  const saved = { kind: "hosted", baseUrl: "http://localhost:8787", token: "", hostedToken: "session-123" };
  const c = normalizeBackendConfig(saved);
  assert.equal(c.kind, "hosted");
  assert.equal(c.hostedToken, "session-123");
  assert.equal(backendKey(c), `hosted:${HOSTED_URL}`);
});

test("the old default accent becomes Ember, a chosen one stays", () => {
  assert.equal(DEFAULT_ACCENT, "#EF5035");
  assert.equal(ACCENTS[0], "#EF5035");
  assert.ok(!ACCENTS.includes("#ff5500"));
  assert.equal(migrateAccent("#ff5500"), DEFAULT_ACCENT);
  assert.equal(migrateAccent("#FF5500"), DEFAULT_ACCENT);
  assert.equal(migrateAccent("#0a84ff"), "#0a84ff");
  assert.equal(migrateAccent("#123456"), "#123456");
  assert.equal(migrateAccent(42), undefined);
});

test("the new origin hops once, only when it came from the old one or has nothing yet", () => {
  const base = { origin: NEW_ORIGIN, pathname: "/", cookie: "" };
  assert.equal(shouldHop({ ...base, store: new MemoryStore() }), true, "first visit, empty storage");
  assert.equal(shouldHop({ ...base, store: new MemoryStore({ "stratus.settings": "{}" }) }), false, "already has data");
  assert.equal(shouldHop({ ...base, cookie: `a=b; ${MOVED_COOKIE}=1`, store: new MemoryStore({ "stratus.settings": "{}" }) }), true, "just redirected");
  assert.equal(shouldHop({ ...base, store: new MemoryStore({ [DONE_KEY]: "1" }) }), false, "already done");
  assert.equal(shouldHop({ ...base, pathname: "/spotify-callback", store: new MemoryStore() }), false, "mid sign-in");
  assert.equal(shouldHop({ ...base, origin: OLD_ORIGIN, store: new MemoryStore() }), false);
  assert.equal(shouldHop({ ...base, origin: "http://localhost:5173", store: new MemoryStore() }), false);
  assert.equal(handoffUrl(`${NEW_ORIGIN}/?x=1#/library`), `${OLD_ORIGIN}/__nightjar-handoff?return=${encodeURIComponent(`${NEW_ORIGIN}/?x=1#/library`)}`);
});

test("the old origin's keys are copied without overwriting what was here before the hop", () => {
  const payload = {
    "stratus.settings": '{"accent":"#0a84ff"}',
    "stratus.backend": '{"kind":"hosted","hostedToken":"s1"}',
    "stratus.localPlaylists": "[1,2]",
    "not.ours": "x",
  };
  const name = WINDOW_NAME_PREFIX + JSON.stringify(payload);
  const data = readHandoff(name);
  assert.ok(data);
  assert.equal("not.ours" in data, false);

  // stratus.volume was here before; stratus.settings was written while the page was leaving.
  const store = new MemoryStore({ "stratus.volume": "0.4", "stratus.settings": "{}" });
  const written = applyHandoff(store, { ...data, "stratus.volume": "1" }, ["stratus.volume"]);
  assert.deepEqual(written.sort(), ["stratus.backend", "stratus.localPlaylists", "stratus.settings"]);
  assert.equal(store.getItem("stratus.settings"), '{"accent":"#0a84ff"}');
  assert.equal(store.getItem("stratus.volume"), "0.4");
  assert.deepEqual(appKeys(store).sort(), ["stratus.backend", "stratus.localPlaylists", "stratus.settings", "stratus.volume"]);

  assert.equal(readHandoff(""), null);
  assert.equal(readHandoff("someone-else"), null);
  assert.equal(readHandoff(`${WINDOW_NAME_PREFIX}{broken`), null);
  assert.equal(readHandoff(`${WINDOW_NAME_PREFIX}[1]`), null);
});
