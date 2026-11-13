import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/http.ts";
import { MAX_SNAPSHOT_BYTES, chunkJson, cleanSnapshot, isSpotifyTrackId, isTrackRef, mergeInOrder, readTrackList } from "../src/snapshot.ts";
import type { Track } from "../src/types.ts";

const ID = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";

function spotify(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    title: "Never Gonna Give You Up",
    user: { id: "spotify:artist:0gxyHStUsqpMadRV0Di1Qt", username: "Rick Astley", avatarUrl: null },
    artworkUrl: "https://i.scdn.co/image/ab67616d0000b273abc",
    duration: 213573,
    createdAt: "1987-07-27T00:00:00.000Z",
    playbackCount: 0,
    likesCount: 0,
    repostsCount: 0,
    commentCount: 0,
    streamable: true,
    source: "spotify",
    uri: ID,
    album: { id: "spotify:album:6N9PS4QXF1D0OWPk0Sxtb4", title: "Whenever You Need Somebody", artworkUrl: "https://i.scdn.co/image/x" },
    ...extra,
  };
}

const sc = (id: string): Track => ({
  id, title: `sc ${id}`, user: { id: "1", username: "u", avatarUrl: null }, artworkUrl: null, duration: 1000, createdAt: "2020-01-01T00:00:00Z",
  playbackCount: 0, likesCount: 0, repostsCount: 0, commentCount: 0, streamable: true,
});

const invalid = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.status === 400 && err.code === "invalid_input" && pattern.test(err.message));

test("track ID checks", () => {
  assert.ok(isSpotifyTrackId(ID));
  assert.ok(!isSpotifyTrackId("spotify:album:4uLU6hMCjMI75M1A2tKUQC"));
  assert.ok(!isSpotifyTrackId("spotify:track:"));
  assert.ok(!isSpotifyTrackId("spotify:track:abc/../x"));
  assert.ok(isTrackRef("248639197") && isTrackRef(ID));
  assert.ok(!isTrackRef("sp_abc") && !isTrackRef(42));
});

test("cleanSnapshot keeps known fields and drops the rest", () => {
  const out = cleanSnapshot(spotify({ liked: true, reposted: true, evil: "<script>", waveform: [1, 2, 3], tags: ["x"] }), ID);
  assert.equal(out.id, ID);
  assert.equal(out.uri, ID);
  assert.equal(out.source, "spotify");
  assert.equal(out.title, "Never Gonna Give You Up");
  assert.equal(out.user.username, "Rick Astley");
  assert.equal(out.album?.title, "Whenever You Need Somebody");
  assert.equal(out.waveform, null);
  for (const key of ["liked", "reposted", "evil", "tags"]) assert.ok(!(key in out), key);
});

test("cleanSnapshot requires the referenced Spotify ID", () => {
  invalid(() => cleanSnapshot(spotify(), "248639197"), /only for Spotify/);
  invalid(() => cleanSnapshot(spotify({ id: "spotify:track:other" }), ID), /must be spotify:track:/);
  invalid(() => cleanSnapshot(null, ID), /as an object/);
  invalid(() => cleanSnapshot([spotify()], ID), /as an object/);
  invalid(() => cleanSnapshot(spotify({ title: "  " }), ID), /needs a title/);
});

test("cleanSnapshot keeps https URLs only and caps strings", () => {
  const out = cleanSnapshot(spotify({
    artworkUrl: "http://i.scdn.co/image/x",
    permalinkUrl: "javascript:alert(1)",
    title: "x".repeat(1000),
    user: { id: "spotify:artist:a", username: "y".repeat(1000), avatarUrl: "data:image/png;base64,AAAA" },
    album: { id: "spotify:album:a", title: "Album", artworkUrl: "ftp://x" },
  }), ID);
  assert.equal(out.artworkUrl, null);
  assert.equal(out.permalinkUrl, null);
  assert.equal(out.user.avatarUrl, null);
  assert.equal(out.album?.artworkUrl, null);
  assert.equal(out.title.length, 300);
  assert.equal(out.user.username.length, 200);
  assert.ok(JSON.stringify(out).length <= MAX_SNAPSHOT_BYTES);
});

test("cleanSnapshot fills gaps with safe defaults", () => {
  const out = cleanSnapshot({ id: ID, title: "Only a title", duration: -5, playbackCount: "lots", createdAt: "not a date" }, ID);
  assert.equal(out.user.id, "spotify:artist:unknown");
  assert.equal(out.user.username, "Unknown artist");
  assert.equal(out.duration, 0);
  assert.equal(out.playbackCount, 0);
  assert.equal(out.createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(out.streamable, true);
  assert.equal(out.album, null);
  // The fields annotate() looks for, so liked flags still get set.
  assert.ok("streamable" in out && "playbackCount" in out);
});

test("readTrackList keeps order, takes bare SoundCloud entries and dedupes snapshots", () => {
  const list = readTrackList([{ id: "1" }, spotify(), { id: 2 }, spotify({ title: "Second copy" })], 10);
  assert.deepEqual(list.ids, ["1", ID, "2", ID]);
  assert.equal(list.snapshots.length, 1);
  assert.equal(list.snapshots[0].title, "Second copy");
  invalid(() => readTrackList("nope", 10), /must be an array/);
  invalid(() => readTrackList([{ id: "1" }, { id: "2" }], 1), /at most 1/);
  invalid(() => readTrackList([{ id: "sp_x" }], 10), /SoundCloud track ID or a spotify:track: ID/);
  invalid(() => readTrackList([{ id: ID }], 10), /needs a title/);
});

test("mergeInOrder mixes hydrated and stored tracks in saved order", () => {
  const snap = cleanSnapshot(spotify(), ID);
  const out = mergeInOrder(["1", ID, "gone", "2", ID], [sc("2"), sc("1")], new Map([[ID, snap]]));
  assert.deepEqual(out.map((t) => t.id), ["1", ID, "2", ID]);
  // Copies, so flags set on one entry don't leak into the other.
  assert.notEqual(out[1], out[3]);
});

test("chunkJson splits into valid JSON arrays under the limit", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i, pad: "x".repeat(100) }));
  const chunks = chunkJson(items, 1000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, String(c.length));
  assert.deepEqual(chunks.flatMap((c) => JSON.parse(c)), items);
  assert.deepEqual(chunkJson([]), []);
});
