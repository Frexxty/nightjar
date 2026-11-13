// Track-end detection for Spotify playback (src/player/spotifyEnd.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnd, newTracker, type EndTracker, type PlaybackSnapshot } from "../src/player/spotifyEnd.ts";

const URI = "spotify:track:11dFghVXANMlKmJXsNCbNl";
const OTHER = "spotify:track:6OmhkSOpvYBokMKQxpIGx2";
const DURATION = 200_000;

/** Feeds snapshots in order and returns every verdict. */
function run(snaps: (PlaybackSnapshot | null)[], tracker: EndTracker = newTracker(URI, DURATION)) {
  const verdicts: string[] = [];
  for (const snap of snaps) {
    const r = checkEnd(tracker, snap);
    tracker = r.tracker;
    verdicts.push(r.verdict);
  }
  return verdicts;
}

const at = (position: number, paused = false, extra: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  uri: URI, position, duration: DURATION, paused, ...extra,
});

test("SDK: position back to 0 and paused after playing means it ended", () => {
  assert.deepEqual(run([at(0), at(1000), at(199_500), at(0, true)]), ["none", "none", "none", "ended"]);
});

test("a paused track at 0 that never played hasn't ended", () => {
  assert.deepEqual(run([at(0, true), at(0, true)]), ["none", "none"]);
});

test("pausing mid-track isn't an end", () => {
  assert.deepEqual(run([at(500), at(60_000), at(60_100, true)]), ["none", "none", "none"]);
});

test("stopping on the last frame counts as the end", () => {
  assert.deepEqual(run([at(1000), at(199_800, true)]), ["none", "ended"]);
});

test("SDK: our track in previous_tracks means Spotify moved past it", () => {
  assert.deepEqual(run([at(1000), { uri: OTHER, position: 0, duration: 1, paused: false, previousUris: [URI] }]), ["none", "ended"]);
});

test("Connect: nothing playing any more after our track played", () => {
  assert.deepEqual(run([at(5000), null]), ["none", "ended"]);
  assert.deepEqual(run([null]), ["none"], "before it starts, an empty player is just slow");
});

test("Connect: Spotify autoplay took over near the end", () => {
  assert.deepEqual(run([at(5000), at(198_000), { uri: OTHER, position: 1000, duration: 1, paused: false }]), ["none", "none", "ended"]);
});

test("another track mid-way through ours is someone else's choice", () => {
  assert.deepEqual(run([at(5000), at(60_000), { uri: OTHER, position: 1000, duration: 1, paused: false }]), ["none", "none", "foreign"]);
});

test("the old track still showing before ours starts is ignored", () => {
  assert.deepEqual(run([{ uri: OTHER, position: 90_000, duration: 1, paused: false }, at(0), at(800)]), ["none", "none", "none"]);
});

test("seeking back to 0 while paused (engine resets `played`) isn't an end", () => {
  let tracker = newTracker(URI, DURATION);
  tracker = checkEnd(tracker, at(30_000)).tracker;
  // What the engines do on seek(0).
  tracker = { ...tracker, lastPosition: 0, played: false };
  assert.equal(checkEnd(tracker, at(0, true)).verdict, "none");
});
