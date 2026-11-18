// GET /v1/me/recommendations: signals read from a fake D1, related tracks
// served from fixtures through the same SoundCloud mapping the Worker uses.
// No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mapTrack } from "../src/map.ts";
import { buildRecommendations, loadSignals, RECENT_PLAYS_EXCLUDED, signalsKey, type RecDeps, type UserSignals } from "../src/recommendations.ts";
import type { ScTrack, Section, Track } from "../src/types.ts";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/recommendations.json", import.meta.url), "utf8")) as {
  tracks: Record<string, ScTrack>;
  related: Record<string, string[]>;
  topTracks: Record<string, string[]>;
};

const NOW = Date.UTC(2026, 10, 18);
const DAY = 86_400_000;

function deps(calls: string[] = []): RecDeps {
  const get = (id: string) => (fx.tracks[id] ? mapTrack(fx.tracks[id]) : null);
  const list = (ids: string[] | undefined) => (ids ?? []).map(get).filter((t): t is Track => !!t);
  return {
    tracks: async (ids) => {
      calls.push(`tracks:${ids.length}`);
      return list(ids);
    },
    related: async (id) => {
      calls.push(`related:${id}`);
      return list(fx.related[id]);
    },
    topTracks: async (id) => {
      calls.push(`top:${id}`);
      return list(fx.topTracks[id]);
    },
  };
}

const signals: UserSignals = {
  likes: [
    { id: "1001", at: NOW - 1 * DAY },
    { id: "1002", at: NOW - 2 * DAY },
    { id: "1003", at: NOW - 3 * DAY },
    { id: "1004", at: NOW - 200 * DAY },
    { id: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", at: NOW - 4 * DAY },
  ],
  history: [
    { id: "2003", at: NOW - 1000, plays: 1 },
    { id: "2001", at: NOW - 2 * DAY, plays: 5 },
    { id: "1001", at: NOW - 3 * DAY, plays: 2 },
    { id: "2002", at: NOW - 4 * DAY, plays: 3 },
  ],
  playlistTracks: [{ id: "3001", at: NOW - 5 * DAY }],
  follows: ["400"],
};

const ids = (s: Section | undefined) => (s?.items ?? []).map((x) => x.id);
const byId = (sections: Section[], id: string) => sections.find((s) => s.id === id);

test("seeds from likes, most-played tracks and playlists, at most 6 related lookups", async () => {
  const calls: string[] = [];
  await buildRecommendations(signals, deps(calls), NOW);
  const related = calls.filter((c) => c.startsWith("related:")).map((c) => c.slice(8));
  assert.deepEqual(related, ["1001", "1002", "1003", "2001", "2002", "3001"]);
  assert.equal(calls.filter((c) => c.startsWith("tracks:")).length, 1, "one batched track lookup");
  assert.ok(calls.filter((c) => c.startsWith("top:")).length <= 2);
});

test("the mix ranks tracks several seeds agree on first and drops what it should", async () => {
  const sections = await buildRecommendations(signals, deps(), NOW);
  const mix = byId(sections, "for-you");
  assert.ok(mix, "has Recommended for you");
  assert.equal(mix.title, "Recommended for you");
  const list = ids(mix);
  assert.equal(list[0], "5001", "suggested by three seeds");
  for (const gone of ["5010", "5020", "1004", "2003", "1001", "2001", "3001"]) assert.ok(!list.includes(gone), `${gone} is left out`);
  assert.equal(new Set(list).size, list.length, "no duplicate IDs");
  assert.equal(list.filter((id) => id === "5040" || id === "5041").length, 1, "two uploads of one song count once");
  const perArtist = new Map<string, number>();
  for (const t of mix.items as Track[]) perArtist.set(t.user.id, (perArtist.get(t.user.id) ?? 0) + 1);
  assert.ok(Math.max(...perArtist.values()) <= 2, "at most two per artist");
  assert.ok(list.indexOf("5050") >= 0 && list.indexOf("5050") < 6, "followed artist ranks high");
  assert.ok((mix.items as Track[]).every((t) => t.streamable && !t.preview));
});

test("Because you liked shelves for the newest liked seeds, and artists you play", async () => {
  const sections = await buildRecommendations(signals, deps(), NOW);
  const because = sections.filter((s) => s.id.startsWith("because-"));
  assert.deepEqual(because.map((s) => s.title), ["Because you liked Liked One", "Because you liked Liked Two", "Because you liked Liked Three"]);
  const mixTop = ids(byId(sections, "for-you")).slice(0, 10);
  for (const s of because) {
    assert.ok(s.items.length >= 4);
    assert.ok(ids(s).every((id) => !mixTop.includes(id)), "skips what the mix already shows first");
    assert.ok(!(mixTop.includes("5040") && ids(s).includes("5041")), "and other uploads of those songs");
  }
  const artists = byId(sections, "artists-you-play");
  assert.ok(artists);
  assert.equal(artists.subtitle, "Most Played C, Seed Artist A");
  assert.ok(!ids(artists).includes("2001") && !ids(artists).includes("1001"), "already played or liked");
  assert.equal(ids(artists)[0], "6001");
});

test("nothing to go on gives no sections, so the route falls back to trending", async () => {
  const calls: string[] = [];
  const empty: UserSignals = { likes: [], history: [], playlistTracks: [], follows: [] };
  assert.deepEqual(await buildRecommendations(empty, deps(calls), NOW), []);
  assert.deepEqual(calls, []);
  const spotifyOnly: UserSignals = { ...empty, likes: [{ id: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", at: NOW }] };
  assert.deepEqual(await buildRecommendations(spotifyOnly, deps(calls), NOW), []);
});

test("an upstream failure on one seed still returns the rest", async () => {
  const d = deps();
  const flaky: RecDeps = { ...d, related: async (id) => (id === "1001" ? Promise.reject(new Error("429")) : d.related(id)) };
  const sections = await buildRecommendations(signals, flaky, NOW);
  assert.ok(byId(sections, "for-you"));
  assert.ok(!byId(sections, "because-1001"));
});

/** Answers the four queries loadSignals sends, in order, from canned rows. */
function fakeDb(rows: unknown[][]) {
  const sent: { sql: string; values: unknown[] }[] = [];
  return {
    sent,
    prepare(sql: string) {
      return { bind: (...values: unknown[]) => (sent.push({ sql, values }), { sql }) };
    },
    async batch<T>(statements: unknown[]) {
      return statements.map((_, i) => ({ results: rows[i] as T[] }));
    },
  };
}

test("loadSignals reads likes, history with play counts, playlists and follows in one batch", async () => {
  const db = fakeDb([
    [{ track_id: "1001", created_at: 5 }],
    [{ track_id: "2001", played_at: 9, play_count: 4 }, { track_id: "2002", played_at: 8, play_count: null }],
    [{ track_ids: JSON.stringify(["a", "b", "c", "d", "e"]), updated_at: 7 }, { track_ids: "not json", updated_at: 6 }],
    [{ sc_user_id: "400" }],
  ]);
  const s = await loadSignals(db, "user-1");
  assert.equal(db.sent.length, 4);
  assert.ok(db.sent.every((q) => q.values[0] === "user-1"));
  assert.match(db.sent[1].sql, /play_count/);
  assert.deepEqual(s.likes, [{ id: "1001", at: 5 }]);
  assert.deepEqual(s.history, [{ id: "2001", at: 9, plays: 4 }, { id: "2002", at: 8, plays: 1 }]);
  assert.deepEqual(s.playlistTracks.map((p) => p.id), ["e", "d", "c", "b"], "newest additions of each playlist");
  assert.deepEqual(s.follows, ["400"]);
});

test("signalsKey changes with a new like or play and not otherwise", async () => {
  const a = await signalsKey(signals);
  assert.equal(a, await signalsKey(structuredClone(signals)));
  assert.notEqual(a, await signalsKey({ ...signals, likes: [{ id: "9", at: NOW }, ...signals.likes] }));
  assert.notEqual(a, await signalsKey({ ...signals, history: [{ ...signals.history[0], plays: 2 }, ...signals.history.slice(1)] }));
  assert.equal(RECENT_PLAYS_EXCLUDED, 50);
});
