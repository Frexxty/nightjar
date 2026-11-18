import { test } from "node:test";
import assert from "node:assert/strict";
import { addMessage, moveItem, planAdd, playlistTitleError } from "../src/lib/playlistEdit.ts";
import { GENRES, genreById, soundcloudGenrePlaylistId, spotifyGenreQuery } from "../src/lib/genres.ts";
import type { Track } from "../src/api/types.ts";

const tr = (id: string, title = `Song ${id}`): Track => ({
  id, title, user: { id: "u", username: "U", avatarUrl: null }, artworkUrl: null, duration: 1000, createdAt: "", playbackCount: 0,
  likesCount: 0, repostsCount: 0, commentCount: 0, streamable: true,
});

test("planAdd appends new tracks and skips ones already there or repeated", () => {
  const plan = planAdd([tr("1"), tr("2")], [tr("2"), tr("3"), tr("3"), tr("4")]);
  assert.deepEqual(plan.next.map((t) => t.id), ["1", "2", "3", "4"]);
  assert.deepEqual(plan.added.map((t) => t.id), ["3", "4"]);
  assert.deepEqual(plan.duplicates.map((t) => t.id), ["2", "3"]);
});

test("planAdd works on Spotify and SoundCloud IDs alike and accepts bare IDs", () => {
  const plan = planAdd([{ id: "spotify:track:abc" }], [tr("spotify:track:abc"), tr("123")]);
  assert.deepEqual(plan.added.map((t) => t.id), ["123"]);
  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(planAdd([], []).next, []);
});

test("addMessage", () => {
  assert.equal(addMessage("Mix", { added: [tr("1", "Blue")], duplicates: [] }), 'Added "Blue" to "Mix"');
  assert.equal(addMessage("Mix", { added: [], duplicates: [tr("1")] }), 'Already in "Mix"');
  assert.equal(addMessage("Mix", { added: [], duplicates: [tr("1"), tr("2")] }), 'All 2 tracks are already in "Mix"');
  assert.equal(addMessage("Mix", { added: [tr("1"), tr("2"), tr("3")], duplicates: [] }), 'Added 3 tracks to "Mix"');
  assert.equal(addMessage("Mix", { added: [tr("1")], duplicates: [tr("2"), tr("3")] }), 'Added 1 track to "Mix" (2 were already there)');
  assert.equal(addMessage("Mix", { added: [], duplicates: [] }), 'Nothing to add to "Mix"');
});

test("moveItem", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, 5), ["a", "b"]);
});

test("playlistTitleError matches the server's rules", () => {
  assert.ok(playlistTitleError("   "));
  assert.ok(playlistTitleError("x".repeat(101)));
  assert.equal(playlistTitleError(" Road trip "), null);
});

test("genres: unique IDs, SoundCloud playlist IDs and Spotify queries", () => {
  assert.equal(new Set(GENRES.map((g) => g.id)).size, GENRES.length);
  for (const label of ["Hip Hop", "Electronic", "House", "Techno", "Lo-fi", "Pop", "Rock", "Indie", "R&B", "Jazz", "Ambient", "Drum & Bass", "Chill", "Workout", "Focus"]) {
    assert.ok(GENRES.some((g) => g.label === label), label);
  }
  assert.equal(soundcloudGenrePlaylistId(genreById("hip-hop")!), "soundcloud:system-playlists:trending-by-genre:hip-hop");
  assert.equal(soundcloudGenrePlaylistId(genreById("drum-and-bass")!), null);
  assert.equal(spotifyGenreQuery(genreById("r-n-b")!), 'genre:"r-n-b"');
  assert.equal(spotifyGenreQuery(genreById("focus")!), "focus music");
  assert.equal(genreById("nope"), null);
});
