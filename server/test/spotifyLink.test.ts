import { test } from "node:test";
import assert from "node:assert/strict";
import { b64url } from "../src/http.ts";
import {
  SpotifyGrantError, cachedTokenUsable, importKey, open, publicLink, readLinkInput, refreshAtSpotify, seal, type LinkRow,
} from "../src/spotifyLink.ts";

const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("sealed tokens open for the same account only", async () => {
  const key = await importKey(secret);
  const sealed = await seal(key, "refresh-123", "user-a");
  assert.notEqual(sealed, await seal(key, "refresh-123", "user-a"), "fresh IV each time");
  assert.equal(await open(key, sealed, "user-a"), "refresh-123");
  await assert.rejects(open(key, sealed, "user-b"));
});

test("a missing or short key means the feature is off, not a crash", async () => {
  await assert.rejects(importKey(undefined), { code: "not_configured" });
  await assert.rejects(importKey(b64url(new Uint8Array(16))), { code: "not_configured" });
});

test("refresh keeps the old refresh token when Spotify doesn't rotate it", async () => {
  const now = 1_000_000;
  const kept = await refreshAtSpotify("a".repeat(32), "old", now, reply(200, { access_token: "acc", expires_in: 3600, scope: "streaming" }));
  assert.deepEqual(kept, { accessToken: "acc", refreshToken: "old", expiresAt: now + 3_600_000, scope: "streaming" });
  const rotated = await refreshAtSpotify("a".repeat(32), "old", now, reply(200, { access_token: "acc", refresh_token: "new" }));
  assert.equal(rotated.refreshToken, "new");
});

test("revoked sessions surface as a grant error; other failures don't", async () => {
  await assert.rejects(refreshAtSpotify("a".repeat(32), "x", 0, reply(400, { error: "invalid_grant" })), SpotifyGrantError);
  await assert.rejects(refreshAtSpotify("a".repeat(32), "x", 0, reply(400, { error: "invalid_client" })), SpotifyGrantError);
  await assert.rejects(refreshAtSpotify("a".repeat(32), "x", 0, reply(503, {})), (err: Error) => !(err instanceof SpotifyGrantError));
});

test("cached access tokens are reused only with five minutes left and no force", () => {
  const now = 10_000_000;
  const row = { access_enc: "sealed", access_expires_at: now + 10 * 60_000 };
  assert.equal(cachedTokenUsable(row, now, false), true);
  assert.equal(cachedTokenUsable(row, now, true), false);
  assert.equal(cachedTokenUsable({ ...row, access_expires_at: now + 4 * 60_000 }, now, false), false);
  assert.equal(cachedTokenUsable({ access_enc: null, access_expires_at: null }, now, false), false);
});

test("link input is validated and the profile trimmed", () => {
  assert.throws(() => readLinkInput({ clientId: "nope", refreshToken: "r" }));
  assert.throws(() => readLinkInput({ clientId: "a".repeat(32), refreshToken: "" }));
  const ok = readLinkInput({
    clientId: "ABCDEF0123456789ABCDEF0123456789", refreshToken: " r ",
    profile: { id: "me", displayName: "Me", product: "premium", avatarUrl: "javascript:alert(1)", extra: "dropped" },
  });
  assert.equal(ok.clientId, "abcdef0123456789abcdef0123456789");
  assert.equal(ok.refreshToken, "r");
  assert.deepEqual(ok.profile, { id: "me", displayName: "Me", product: "premium", country: null, avatarUrl: null });
});

test("the public view never contains tokens", () => {
  const row: LinkRow = {
    user_id: "u", client_id: "c".repeat(32), refresh_enc: "SECRET_R", access_enc: "SECRET_A", access_expires_at: 1, scope: "streaming",
    profile_json: JSON.stringify({ id: "me", displayName: "Me" }), version: 3, updated_at: 0,
  };
  const out = JSON.stringify(publicLink(row));
  assert.ok(!out.includes("SECRET"));
  assert.deepEqual(publicLink(null), { connected: false });
});
