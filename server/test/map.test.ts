import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  bigImage, mapComment, mapPlaylist, mapTrack, mapUser, normalizeWaveform, parseTagList, pickTranscoding, sortComments, waveformJsonUrl,
} from "../src/map.ts";
import type { ScComment, ScPlaylist, ScTrack, ScTranscoding } from "../src/types.ts";

// Trimmed real api-v2 objects (track_authorization redacted, commenter names replaced).
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/soundcloud.json", import.meta.url), "utf8")) as {
  allow: ScTrack;
  snip: ScTrack;
  comments: ScComment[];
  waveform: unknown;
};

const tc = (protocol: string, mime: string, preset: string, extra: Partial<ScTranscoding> = {}): ScTranscoding => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/x/stream/${protocol}`,
  preset,
  format: { protocol, mime_type: mime },
  ...extra,
});

test("bigImage swaps SoundCloud's 100px size for 500px", () => {
  assert.equal(bigImage("https://i1.sndcdn.com/artworks-000205419980-1z48ee-large.jpg"), "https://i1.sndcdn.com/artworks-000205419980-1z48ee-t500x500.jpg");
  assert.equal(bigImage("https://i1.sndcdn.com/avatars-abc-large.png?x=1"), "https://i1.sndcdn.com/avatars-abc-t500x500.png?x=1");
  assert.equal(bigImage(null), null);
});

test("parseTagList keeps quoted tags together", () => {
  assert.deepEqual(parseTagList('rap "hip hop" trap rap'), ["rap", "hip hop", "trap"]);
  assert.deepEqual(parseTagList(""), []);
});

test("mapTrack maps a full-length track field for field", () => {
  const t = mapTrack(fx.allow);
  assert.equal(t.id, "305234029");
  assert.equal(t.title, "Like Rihanna");
  assert.equal(t.duration, 174311);
  assert.equal(t.streamable, true);
  assert.equal(t.preview, undefined);
  assert.equal(t.user.id, String(fx.allow.user!.id));
  assert.match(t.artworkUrl ?? "", /t500x500/);
  assert.equal(t.createdAt, fx.allow.created_at);
  assert.equal(typeof t.playbackCount, "number");
  assert.equal(t.waveform, null);
  assert.deepEqual(Object.keys(t).sort(), [
    "artworkUrl", "commentCount", "createdAt", "description", "duration", "genre", "id", "likesCount", "permalinkUrl",
    "playbackCount", "repostsCount", "streamable", "tags", "title", "user", "waveform",
  ]);
});

test("mapTrack marks SNIP tracks as 30-second previews", () => {
  const t = mapTrack(fx.snip);
  assert.equal(fx.snip.policy, "SNIP");
  assert.equal(t.preview, true);
  assert.equal(t.duration, 30000);
  assert.equal(t.streamable, true);
  assert.equal(t.user.username, "Young Zerka");
});

test("mapTrack greys out blocked tracks and tracks with only encrypted streams", () => {
  assert.equal(mapTrack({ ...fx.allow, policy: "BLOCK" }).streamable, false);
  const encrypted = { ...fx.allow, media: { transcodings: [tc("ctr-encrypted-hls", "audio/mp4", "aac_160k"), tc("hls", "audio/mp4", "aac_drm")] } };
  assert.equal(mapTrack(encrypted).streamable, false);
});

test("pickTranscoding prefers clear AAC HLS, then MP3 HLS, then progressive", () => {
  const list = [
    tc("progressive", "audio/mpeg", "mp3_0_0"),
    tc("hls", "audio/mpegurl", "abr_sq"),
    tc("hls", "audio/mp4; codecs=\"mp4a.40.2\"", "aac_96k"),
    tc("hls", "audio/mp4; codecs=\"mp4a.40.2\"", "aac_160k"),
    tc("cbc-encrypted-hls", "audio/mp4", "aac_256k"),
    tc("hls", "audio/mpeg", "mp3_0_0"),
  ];
  assert.equal(pickTranscoding(list)?.preset, "aac_160k");
  assert.equal(pickTranscoding(list.filter((t) => !t.preset!.startsWith("aac")))?.format.mime_type, "audio/mpeg");
  assert.equal(pickTranscoding(list.filter((t) => !t.preset!.startsWith("aac")))?.format.protocol, "hls");
  assert.equal(pickTranscoding([list[0], list[1]])?.format.protocol, "progressive");
  assert.equal(pickTranscoding([list[1], list[4]]), null);
  assert.equal(pickTranscoding(undefined), null);
});

test("mapUser fills counts and drops empty strings", () => {
  const u = mapUser({ id: 7, username: "x", avatar_url: null, city: "", country_code: "DE", followers_count: 3, visuals: { visuals: [{ visual_url: "https://i1.sndcdn.com/visuals-1.jpg" }] } });
  assert.deepEqual(u, {
    id: "7", username: "x", avatarUrl: null, verified: false, bannerUrl: "https://i1.sndcdn.com/visuals-1.jpg", city: null, country: "DE",
    description: null, followersCount: 3, followingsCount: 0, trackCount: 0, playlistCount: 0, permalinkUrl: null,
  });
});

test("mapPlaylist tells albums from playlists and handles system playlists", () => {
  const base: ScPlaylist = { id: 5, title: "P", user: { id: 1, username: "u" }, track_count: 2, duration: 1000, created_at: "2024-01-01T00:00:00Z" };
  assert.equal(mapPlaylist({ ...base, set_type: "album" }).isAlbum, true);
  assert.equal(mapPlaylist({ ...base, set_type: "" }).isAlbum, false);
  assert.equal(mapPlaylist(base).tracks, undefined);
  const sys = mapPlaylist({ id: "soundcloud:system-playlists:trending-by-genre:trap", urn: "soundcloud:system-playlists:trending-by-genre:trap", kind: "system-playlist", title: "Trap", tracks: [{ id: 1 }, { id: 2 }], last_updated: "2026-01-01T00:00:00Z", calculated_artwork_url: "https://i1.sndcdn.com/artworks-x-large.png" });
  assert.equal(sys.id, "soundcloud:system-playlists:trending-by-genre:trap");
  assert.equal(sys.trackCount, 2);
  assert.equal(sys.createdAt, "2026-01-01T00:00:00Z");
  assert.match(sys.artworkUrl ?? "", /t500x500/);
  const withTracks = mapPlaylist({ ...base, duration: 0 }, [mapTrack(fx.allow)]);
  assert.equal(withTracks.tracks?.length, 1);
  assert.equal(withTracks.duration, 174311);
});

test("mapComment keeps the timestamp and sortComments puts unpinned last", () => {
  const mapped = fx.comments.map(mapComment);
  assert.equal(mapped[0].timestamp, fx.comments[0].timestamp);
  assert.equal(mapped[0].user.username, "listener");
  const loose = mapComment({ id: 9, body: "hi", timestamp: null, created_at: "2020-01-01T00:00:00Z", user: { id: 1, username: "a" } });
  const sorted = sortComments([loose, { ...mapped[0], timestamp: 5000 }, { ...mapped[1], timestamp: 1000 }]);
  assert.deepEqual(sorted.map((x) => x.timestamp), [1000, 5000, null]);
});

test("normalizeWaveform scales to 0..1 and max-pools", () => {
  const peaks = normalizeWaveform(fx.waveform, 6)!;
  assert.equal(peaks.length, 6);
  assert.deepEqual(peaks, [0.057, 1, 0.5, 0.1, 0.4, 1]);
  assert.equal(normalizeWaveform({ samples: [] }), null);
  assert.equal(normalizeWaveform(null), null);
  assert.equal(waveformJsonUrl("https://wave.sndcdn.com/abc_m.png"), "https://wave.sndcdn.com/abc_m.json");
  assert.equal(waveformJsonUrl("https://evil.example/abc.png"), null);
});
