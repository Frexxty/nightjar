// Desktop Spotify sign-in loopback (electron/spotify-auth.cjs). `openExternal`
// is a stub that plays the browser's part, so no browser opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { authorize, checkAuthorizeUrl, REDIRECT_URI } = require("../electron/spotify-auth.cjs");

const authUrl = (state = "s1", redirect = REDIRECT_URI) =>
  `https://accounts.spotify.com/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;

test("checkAuthorizeUrl only accepts Spotify's authorize URL with the loopback redirect", () => {
  assert.ok(checkAuthorizeUrl(authUrl()));
  assert.throws(() => checkAuthorizeUrl("https://evil.example/authorize?state=s"), /isn't a Spotify sign-in link/);
  assert.throws(() => checkAuthorizeUrl(authUrl("s1", "http://127.0.0.1:9999/cb")), /redirect URI must be/);
  assert.throws(() => checkAuthorizeUrl(authUrl("")), /no state/);
});

test("resolves with the code, ignores a wrong state, and frees the port", async () => {
  const reply = await authorize(authUrl("good"), {
    openExternal: async () => {
      const stale = await fetch(`${REDIRECT_URI}?code=old&state=bad`);
      assert.equal(stale.status, 400);
      const ok = await fetch(`${REDIRECT_URI}?code=abc&state=good`);
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /Connected to Spotify/);
    },
  });
  assert.deepEqual(reply, { code: "abc", state: "good" });
  // The server is closed: the next sign-in can listen again.
  const again = await authorize(authUrl("two"), { openExternal: () => fetch(`${REDIRECT_URI}?error=access_denied&state=two`) });
  assert.deepEqual(again, { error: "access_denied", state: "two" });
});

test("times out", async () => {
  await assert.rejects(authorize(authUrl("t"), { openExternal: async () => {}, timeoutMs: 50 }), /timeout/);
});
