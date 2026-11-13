import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, errorCode, friendlyError, isNotSupported, isUnauthorized, parseApiError,
} from "../src/api/errors.ts";
import {
  backendKey, DEFAULT_CUSTOM_URL, HOSTED_URL, normalizeBackendConfig, sessionToken, withSessionToken,
} from "../src/api/config.ts";

test("parseApiError reads the hosted { error, code } shape", () => {
  const err = parseApiError(409, JSON.stringify({ error: "That username is taken.", code: "username_taken" }), "https://x/v1/auth/signup");
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 409);
  assert.equal(err.code, "username_taken");
  assert.equal(err.message, "That username is taken.");
  assert.equal(errorCode(err), "username_taken");
});

test("parseApiError keeps a code without a message, and a message without a code", () => {
  const codeOnly = parseApiError(401, '{"code":"unauthorized"}');
  assert.equal(codeOnly.code, "unauthorized");
  assert.match(codeOnly.message, /401/);
  const messageOnly = parseApiError(400, '{"error":"Bad thing"}');
  assert.equal(messageOnly.code, null);
  assert.equal(messageOnly.message, "Bad thing");
});

test("parseApiError falls back to status and body text for other servers", () => {
  const html = parseApiError(502, "<html>Bad Gateway</html>", "https://x/v1/home");
  assert.equal(html.code, null);
  assert.equal(html.message, "502 from https://x/v1/home: <html>Bad Gateway</html>");
  assert.equal(parseApiError(500, "", "u").message, "500 from u");
  assert.equal(parseApiError(500, "x".repeat(500), "u").message.length, "500 from u: ".length + 200);
  // JSON that isn't the error shape is treated as text.
  assert.equal(parseApiError(404, "[1,2]", "u").code, null);
});

test("isUnauthorized and isNotSupported", () => {
  assert.equal(isUnauthorized(parseApiError(401, '{"error":"Sign in","code":"unauthorized"}')), true);
  assert.equal(isUnauthorized(parseApiError(401, "nope")), true, "bare 401 from a custom server");
  assert.equal(isUnauthorized(parseApiError(401, '{"error":"Wrong password","code":"invalid_credentials"}')), false);
  assert.equal(isUnauthorized(new Error("401")), false);
  assert.equal(isNotSupported(parseApiError(501, '{"error":"No comments","code":"not_supported"}')), true);
  assert.equal(isNotSupported(parseApiError(501, "")), true);
  assert.equal(isNotSupported(parseApiError(500, "")), false);
});

test("friendlyError maps known codes and keeps other messages", () => {
  assert.match(friendlyError(parseApiError(401, '{"error":"x","code":"invalid_credentials"}')), /don't match/);
  assert.match(friendlyError(parseApiError(409, '{"error":"x","code":"email_taken"}')), /already an account/);
  assert.equal(friendlyError(parseApiError(400, '{"error":"Title is required","code":"invalid_input"}')), "Title is required");
  assert.match(friendlyError(new TypeError("Failed to fetch")), /Couldn't reach the server/);
  assert.equal(friendlyError(new Error("plain")), "plain");
});

test("a new install defaults to the hosted backend", () => {
  for (const raw of [null, undefined, {}, "garbage", 42]) {
    const c = normalizeBackendConfig(raw);
    assert.equal(c.kind, "hosted");
    assert.equal(c.baseUrl, DEFAULT_CUSTOM_URL);
    assert.equal(c.token, "");
    assert.equal(c.hostedToken, "");
  }
});

test("saved configs from before accounts keep working", () => {
  assert.deepEqual(normalizeBackendConfig({ kind: "mock", baseUrl: "http://localhost:8787", token: "" }), {
    kind: "mock", baseUrl: "http://localhost:8787", token: "", hostedToken: "",
  });
  assert.deepEqual(normalizeBackendConfig({ kind: "http", baseUrl: "http://192.168.1.4:8787", token: "abc" }), {
    kind: "http", baseUrl: "http://192.168.1.4:8787", token: "abc", hostedToken: "",
  });
});

test("an old http config pointing at the hosted URL becomes hosted and keeps its token", () => {
  const c = normalizeBackendConfig({ kind: "http", baseUrl: `${HOSTED_URL}/`, token: "tok" });
  assert.equal(c.kind, "hosted");
  assert.equal(c.hostedToken, "tok");
  assert.equal(c.token, "");
  assert.equal(c.baseUrl, DEFAULT_CUSTOM_URL);
  // A build with VITE_BACKEND_URL compares against that URL instead.
  assert.equal(normalizeBackendConfig({ kind: "http", baseUrl: "https://staging/v1", token: "t" }, "https://staging/v1").kind, "hosted");
});

test("unknown kinds and wrong field types fall back safely", () => {
  const c = normalizeBackendConfig({ kind: "ftp", baseUrl: 5, token: null, hostedToken: "h" });
  assert.deepEqual(c, { kind: "hosted", baseUrl: DEFAULT_CUSTOM_URL, token: "", hostedToken: "h" });
});

test("session tokens are kept per kind", () => {
  const hosted = normalizeBackendConfig({ kind: "hosted", token: "custom", hostedToken: "h1" });
  assert.equal(sessionToken(hosted), "h1");
  const signedIn = withSessionToken(hosted, "h2");
  assert.equal(signedIn.hostedToken, "h2");
  assert.equal(signedIn.token, "custom", "the custom server's token is untouched");
  const custom = withSessionToken({ ...hosted, kind: "http" }, "c2");
  assert.equal(custom.token, "c2");
  assert.equal(custom.hostedToken, "h1");
  assert.equal(sessionToken({ ...hosted, kind: "mock" }), "");
});

test("backendKey tells servers apart", () => {
  const base = normalizeBackendConfig({});
  assert.equal(backendKey(base), `hosted:${HOSTED_URL}`);
  assert.equal(backendKey({ ...base, kind: "http", baseUrl: "http://a:1/" }), "http:http://a:1");
  assert.equal(backendKey({ ...base, kind: "mock" }), "mock");
});
