// PKCE helpers and callback parsing for Spotify sign-in (src/spotify/pkce.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeUrl, base64url, callbackErrorMessage, challengeFor, isClientId, needsRefresh, parseCallback, randomState, randomVerifier,
  readTokenReply, SPOTIFY_SCOPES, tokenErrorMessage, DESKTOP_REDIRECT_URI,
} from "../src/spotify/pkce.ts";

test("RFC 7636 appendix B: verifier octets encode to the documented verifier", () => {
  const octets = new Uint8Array([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
  ]);
  assert.equal(base64url(octets), "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
});

test("RFC 7636 appendix B: S256 challenge of the test verifier", async () => {
  assert.equal(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("randomVerifier uses only unreserved characters and respects the length limits", () => {
  for (const length of [43, 64, 128]) {
    const v = randomVerifier(length);
    assert.equal(v.length, length);
    assert.match(v, /^[A-Za-z0-9\-._~]+$/);
  }
  assert.notEqual(randomVerifier(), randomVerifier());
  assert.throws(() => randomVerifier(42), RangeError);
  assert.throws(() => randomVerifier(129), RangeError);
  assert.match(randomState(), /^[A-Za-z0-9_-]{22}$/);
});

test("authorizeUrl builds Spotify's PKCE authorize request", () => {
  const url = new URL(authorizeUrl({ clientId: "0123456789abcdef0123456789abcdef", redirectUri: DESKTOP_REDIRECT_URI, challenge: "abc", state: "xyz" }));
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "0123456789abcdef0123456789abcdef");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:43821/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "abc");
  assert.equal(url.searchParams.get("state"), "xyz");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), SPOTIFY_SCOPES);
  assert.ok(SPOTIFY_SCOPES.includes("streaming"));
});

test("parseCallback reads code, error and missing pieces", () => {
  assert.deepEqual(parseCallback("?code=c1&state=s1"), { code: "c1", state: "s1" });
  assert.deepEqual(parseCallback("https://stratus-app.k3s.lat/spotify-callback?code=c1&state=s1"), { code: "c1", state: "s1" });
  assert.deepEqual(parseCallback("error=access_denied&state=s1"), { error: "access_denied", state: "s1" });
  assert.deepEqual(parseCallback("state=s1"), { error: "missing_code", state: "s1" });
  assert.deepEqual(parseCallback("code=c1"), { error: "missing_state", state: null });
  assert.match(callbackErrorMessage("access_denied"), /cancelled/);
  assert.match(callbackErrorMessage("state_mismatch"), /didn't match/);
});

test("token replies, refresh timing and errors", () => {
  const t = readTokenReply({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "streaming" }, 1000);
  assert.deepEqual(t, { accessToken: "a", refreshToken: "r", expiresAt: 3_601_000, scope: "streaming" });
  // Refresh replies may leave out the refresh token; the old one stays.
  assert.equal(readTokenReply({ access_token: "b", expires_in: 3600 }, 0, "r").refreshToken, "r");
  assert.throws(() => readTokenReply({}, 0), /access token/);
  assert.equal(needsRefresh(null, 0), true);
  assert.equal(needsRefresh(t, 3_601_000 - 120_000), false);
  assert.equal(needsRefresh(t, 3_601_000 - 30_000), true);
  assert.match(tokenErrorMessage(400, { error: "invalid_client" }), /Client ID/);
  assert.match(tokenErrorMessage(400, { error: "invalid_grant", error_description: "Invalid redirect URI" }), /redirect URI/);
  assert.match(tokenErrorMessage(400, { error: "invalid_grant", error_description: "Invalid authorization code" }), /Connect again/);
});

test("isClientId", () => {
  assert.equal(isClientId("0123456789abcdef0123456789ABCDEF"), true);
  assert.equal(isClientId(" 0123456789abcdef0123456789abcdef "), true);
  assert.equal(isClientId("0123456789abcdef"), false);
  assert.equal(isClientId("0123456789abcdef0123456789abcdeg"), false);
});
