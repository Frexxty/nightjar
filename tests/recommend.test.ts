import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capPerArtist, isRecommendationSection, pickSeeds, recommendationSections, scoreCandidates, titleKey, topArtists, type Seed, type SeedResult,
} from "../src/lib/recommend.ts";
import type { Track } from "../src/api/types.ts";

const NOW = Date.UTC(2026, 10, 18);
const DAY = 86_400_000;

function tr(id: string, artist = `a-${id}`, extra: Partial<Track> = {}): Track {
  return {
    id, title: `Song ${id}`, user: { id: artist, username: `Artist ${artist}`, avatarUrl: null }, artworkUrl: null, duration: 200000,
    createdAt: "2026-01-01T00:00:00Z", playbackCount: 0, likesCount: 0, repostsCount: 0, commentCount: 0, streamable: true, ...extra,
  };
}
const seed = (id: string, weight = 1, kind: Seed["kind"] = "like"): Seed => ({ id, kind, weight });
const result = (s: Seed, related: Track[], track: Track | null = tr(s.id)): SeedResult => ({ seed: s, track, related });

test("pickSeeds takes 3 likes, 2 most-played and 1 playlist track, then fills", () => {
  const seeds = pickSeeds({
    likes: ["l1", "l2", "l3", "l4", "l5"].map((id) => ({ id, kind: "like" as const })),
    topPlays: [{ id: "p1", kind: "top", plays: 9 }, { id: "l1", kind: "top", plays: 4 }, { id: "p2", kind: "top", plays: 3 }],
    playlistTracks: [{ id: "x1", kind: "playlist" }],
  }, { now: NOW });
  assert.deepEqual(seeds.map((s) => s.id), ["l1", "l2", "l3", "p1", "p2", "x1"], "a track that is both liked and most played is one seed");
  assert.equal(pickSeeds({ likes: [{ id: "a", kind: "like" }], topPlays: [] }).length, 1);
  assert.equal(pickSeeds({ likes: [], topPlays: [] }).length, 0);
  const many = pickSeeds({ likes: Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, kind: "like" as const })), topPlays: [] });
  assert.equal(many.length, 6);
});

test("pickSeeds weights fall with age and position", () => {
  const [fresh, second, old] = pickSeeds({
    likes: [{ id: "a", kind: "like", at: NOW - DAY }, { id: "b", kind: "like", at: NOW - DAY }, { id: "c", kind: "like", at: NOW - 400 * DAY }],
    topPlays: [],
  }, { now: NOW });
  assert.ok(fresh.weight > second.weight);
  assert.ok(second.weight > old.weight);
  assert.ok(old.weight >= 0.35 * 0.92 ** 2 - 1e-9, "never below the floor");
});

test("scoreCandidates: agreement across seeds beats a single high rank", () => {
  const shared = tr("shared");
  const out = scoreCandidates([
    result(seed("s1"), [tr("only1"), shared]),
    result(seed("s2"), [tr("only2"), shared]),
  ]);
  assert.equal(out[0].track.id, "shared");
  assert.deepEqual(out[0].seeds.sort(), ["s1", "s2"]);
});

test("scoreCandidates drops excluded, seed, unplayable and duplicate tracks", () => {
  const out = scoreCandidates([
    result(seed("s1"), [
      tr("s2"), tr("liked"), tr("blocked", "x", { streamable: false }), tr("a1", "dup"), tr("a2", "dup", { title: "Song a1 (Official Video)" }), tr("ok"),
    ]),
    result(seed("s2"), [tr("ok")]),
  ], { exclude: ["liked"] });
  const ids = out.map((s) => s.track.id);
  assert.ok(!ids.includes("s2") && !ids.includes("liked") && !ids.includes("blocked"));
  assert.equal(ids.filter((id) => id === "a1" || id === "a2").length, 1);
  assert.equal(ids[0], "ok");
});

test("scoreCandidates caps artists and keeps previews only as filler", () => {
  const many = Array.from({ length: 5 }, (_, i) => tr(`p${i}`, "same"));
  assert.equal(scoreCandidates([result(seed("s"), many)]).length, 2);
  assert.equal(scoreCandidates([result(seed("s"), many)], { perArtist: 3 }).length, 3);

  const full = Array.from({ length: 10 }, (_, i) => tr(`f${i}`));
  const previews = [tr("pv1", "pv1", { preview: true }), tr("pv2", "pv2", { preview: true })];
  assert.ok(scoreCandidates([result(seed("s"), [...previews, ...full])]).every((s) => !s.track.preview), "enough full tracks");
  const few = scoreCandidates([result(seed("s"), [...previews, tr("f")])]);
  assert.deepEqual(few.map((s) => s.track.id), ["f", "pv1", "pv2"], "previews fill in after full tracks");
});

test("scoreCandidates boosts followed artists", () => {
  const out = scoreCandidates([result(seed("s"), [tr("first", "x"), tr("second", "followed")])], { boostArtists: ["followed"] });
  assert.equal(out[0].track.id, "second");
});

test("titleKey ignores brackets, feat. credits, case and accents", () => {
  assert.equal(titleKey(tr("1", "a", { title: "Café Nights (Official Audio)" })), titleKey(tr("2", "a", { title: "cafe nights feat. Someone" })));
  assert.notEqual(titleKey(tr("1", "a")), titleKey(tr("1", "b")));
});

test("recommendationSections builds the mix, Because you liked and artist shelves", () => {
  const related = (prefix: string) => Array.from({ length: 14 }, (_, i) => tr(`${prefix}${i}`));
  const sections = recommendationSections({
    results: [
      result(seed("l1"), related("a"), tr("l1", "x", { title: "First Like" })),
      result(seed("l2", 0.9), related("b"), tr("l2", "y", { title: "Second Like" })),
      result(seed("p1", 0.8, "top"), related("c"), tr("p1", "z", { title: "Most Played" })),
    ],
    artistTracks: [{ artist: { id: "z", username: "Zed", avatarUrl: null }, tracks: Array.from({ length: 6 }, (_, i) => tr(`z${i}`, "z")) }],
  });
  assert.deepEqual(sections.map((s) => s.id), ["for-you", "because-l1", "because-l2", "artists-you-play"]);
  assert.equal(sections[1].title, "Because you liked First Like");
  assert.equal(sections[0].subtitle, "Picked from 3 tracks you like and play");
  assert.ok(sections.every((s) => isRecommendationSection(s.id)));
  assert.ok(!isRecommendationSection("trending"));
});

test("with one like, played seeds fill the Because shelves", () => {
  const related = (prefix: string) => Array.from({ length: 30 }, (_, i) => tr(`${prefix}${i}`));
  const sections = recommendationSections({
    results: [result(seed("l1"), related("a"), tr("l1", "x", { title: "Like" })), result(seed("p1", 0.8, "play"), related("b"), tr("p1", "y", { title: "Play" }))],
  });
  assert.deepEqual(sections.filter((s) => s.id.startsWith("because-")).map((s) => s.title), ["Because you liked Like", "Because you played Play"]);
});

test("small helpers", () => {
  assert.deepEqual(capPerArtist([tr("1", "a"), tr("2", "a"), tr("3", "b"), tr("4", "a")], 2).map((t) => t.id), ["1", "2", "3"]);
  const played = [tr("1", "a"), tr("2", "b"), tr("3", "a"), tr("4", "c"), tr("5", "c")];
  assert.deepEqual(topArtists(played).map((u) => u.id), ["a", "c"]);
  assert.deepEqual(topArtists(played, { weights: new Map([["2", 5]]) }).map((u) => u.id), ["b", "a"]);
});
