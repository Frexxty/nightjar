import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotsFor, trackSnapshot } from "../src/api/snapshot.ts";
import type { SpotifyList, Track } from "../src/api/types.ts";
import { spotifyImport, UNKNOWN_ARTIST_ID } from "../src/lib/spotifyImport.ts";

const list: SpotifyList = {
  id: "4CSw2rcHARwaukSYUegs3R",
  kind: "playlist",
  url: "https://open.spotify.com/playlist/4CSw2rcHARwaukSYUegs3R",
  name: "Transition Pro Max",
  owner: "Dagoduhatbednite",
  coverUrl: "https://image-cdn-ak.spotifycdn.com/image/cover",
  total: 3,
  truncated: false,
  source: "embed",
  notice: null,
  tracks: [
    { spotifyId: "4Ed0jvJEwqlVpNRU8fvYbb", title: "No Lie", artists: ["Sean Paul", "Dua Lipa"], durationMs: 221176, explicit: false },
    { spotifyId: null, title: "my_demo.mp3", artists: [], durationMs: 60000, explicit: false },
    { spotifyId: "0VjIjW4GlUZAMYd2vXMi3b", title: "Blinding Lights", artists: ["The Weeknd"], durationMs: null, explicit: false },
  ],
};

test("spotifyImport makes Spotify tracks and skips local files", () => {
  const { tracks, skipped } = spotifyImport(list);
  assert.equal(tracks.length, 2);
  assert.deepEqual(skipped.map((t) => t.title), ["my_demo.mp3"]);
  const [noLie, blinding] = tracks;
  assert.equal(noLie.id, "spotify:track:4Ed0jvJEwqlVpNRU8fvYbb");
  assert.equal(noLie.uri, noLie.id);
  assert.equal(noLie.source, "spotify");
  assert.equal(noLie.user.username, "Sean Paul");
  assert.equal(noLie.user.id, UNKNOWN_ARTIST_ID);
  assert.equal(noLie.artworkUrl, list.coverUrl);
  assert.equal(noLie.duration, 221176);
  assert.equal(noLie.streamable, true);
  assert.equal(noLie.waveform, null);
  assert.equal(noLie.permalinkUrl, "https://open.spotify.com/track/4Ed0jvJEwqlVpNRU8fvYbb");
  assert.equal(blinding.duration, 0);
});

test("snapshotsFor leaves SoundCloud-only lists alone", () => {
  const sc: Track = {
    id: "248639197", title: "x", user: { id: "1", username: "u", avatarUrl: null }, artworkUrl: null, duration: 1, createdAt: "2020-01-01T00:00:00Z",
    playbackCount: 5, likesCount: 0, repostsCount: 0, commentCount: 0, streamable: true, waveform: [0.1, 0.2],
  };
  assert.equal(snapshotsFor([sc]), undefined);
  assert.equal(snapshotsFor(undefined), undefined);
  const mixed = snapshotsFor([sc, ...spotifyImport(list).tracks]);
  assert.equal(mixed?.length, 3);
  assert.equal(mixed?.[0].waveform, null);
});

test("trackSnapshot drops per-user flags and bulky fields", () => {
  const t = { ...spotifyImport(list).tracks[0], liked: true, reposted: true, description: "long", tags: ["a"], waveform: [1] };
  const snap = trackSnapshot(t);
  for (const key of ["liked", "reposted", "description", "tags", "waveform"]) assert.ok(!(key in snap), key);
  assert.equal(snap.id, t.id);
  assert.equal(snap.uri, t.id);
  assert.equal(snap.source, "spotify");
});
