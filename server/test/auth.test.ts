import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PBKDF2_ITERATIONS, bearerToken, checkEmail, checkPassword, checkUsername, hashPassword, needsRehash, newToken, sha256, timingSafeEqual, verifyPassword,
} from "../src/auth.ts";
import { ApiError, cursorFromNextHref, decodeCursor, encodeCursor, intOffset, offsetFromCursor } from "../src/http.ts";

test("hashPassword salts every hash and verifyPassword checks it", async () => {
  const a = await hashPassword("correct horse", 1000);
  const b = await hashPassword("correct horse", 1000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.iterations, 1000);
  assert.equal(await verifyPassword("correct horse", a), true);
  assert.equal(await verifyPassword("correct horsf", a), false);
  assert.equal(await verifyPassword("correct horse", { ...a, iterations: 999 }), false);
});

test("the default iteration count is the Workers maximum and old hashes get flagged", async () => {
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  assert.equal(needsRehash({ hash: "", salt: "", iterations: 50_000 }), true);
  assert.equal(needsRehash({ hash: "", salt: "", iterations: PBKDF2_ITERATIONS }), false);
});

test("timingSafeEqual compares bytes", () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])), false);
});

test("tokens are 32 random bytes in base64url and hash to a fixed length", async () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(t, newToken());
  assert.equal((await sha256(t)).length, 43);
  assert.equal(bearerToken(`Bearer ${t}`), t);
  assert.equal(bearerToken("Bearer short"), null);
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken(null), null);
});

test("input checks", () => {
  assert.equal(checkUsername("  Some_User.1 "), "Some_User.1");
  assert.throws(() => checkUsername("ab"), ApiError);
  assert.throws(() => checkUsername("has space"), ApiError);
  assert.throws(() => checkUsername("x".repeat(31)), ApiError);
  assert.equal(checkEmail(" Me@Example.COM "), "me@example.com");
  assert.throws(() => checkEmail("nope"), ApiError);
  assert.throws(() => checkPassword("short"), (e: ApiError) => e.code === "weak_password");
  assert.equal(checkPassword("longenough"), "longenough");
  assert.throws(() => checkPassword("x".repeat(201)), ApiError);
});

test("cursors round-trip and reject junk", () => {
  const c = encodeCursor({ o: 40 });
  assert.match(c, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(c), { o: 40 });
  assert.equal(intOffset(c), 40);
  assert.equal(intOffset(null), 0);
  assert.throws(() => decodeCursor("not a cursor!"), ApiError);
  assert.throws(() => intOffset(encodeCursor({ o: -1 })), ApiError);
  const href = "https://api-v2.soundcloud.com/users/1/tracks?offset=2017-01-30T13%3A01%3A36.000Z%2Ctracks%2C00000000000305234265&limit=2";
  const next = cursorFromNextHref(href)!;
  assert.equal(offsetFromCursor(next), "2017-01-30T13:01:36.000Z,tracks,00000000000305234265");
  assert.equal(cursorFromNextHref(null), null);
  assert.throws(() => offsetFromCursor(encodeCursor({ o: "x&client_id=evil" })), ApiError);
});
