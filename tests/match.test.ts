import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MATCHED,
  variantsOf,
  artistScore, cleanTitle, durationSimilarity, findMatches, normalize, rankCandidates, scoreCandidate, searchQueries,
  splitArtists, splitUploadTitle, statusOf, stripDecorations, titleSimilarity, variantPenalty, type SourceTrack,
} from "../src/lib/match.ts";
import type { Track } from "../src/api/types.ts";

function sc(title: string, username: string, seconds: number, extra: Partial<Track> = {}): Track {
  return {
    id: `${username}:${title}:${seconds}`, title, user: { id: username, username, avatarUrl: null }, artworkUrl: null,
    duration: seconds * 1000, createdAt: "2024-01-01T00:00:00Z", playbackCount: 0, likesCount: 0, repostsCount: 0,
    commentCount: 0, streamable: true, ...extra,
  };
}
const sp = (title: string, artists: string[], seconds: number | null): SourceTrack => ({
  title, artists, durationMs: seconds == null ? null : seconds * 1000,
});

test("normalize strips accents, case, apostrophes and punctuation", () => {
  assert.equal(normalize("Beyoncé's  HITS!!"), "beyonces hits");
  assert.equal(normalize("Sigur Rós – Hoppípolla"), "sigur ros hoppipolla");
  assert.equal(normalize("Simon & Garfunkel"), "simon and garfunkel");
  assert.equal(normalize("Don’t Stop"), "dont stop");
});

test("stripDecorations removes upload noise and collects featured artists", () => {
  assert.deepEqual(stripDecorations("Song (feat. A & B) [Official Video]"), { text: "Song", featured: ["A", "B"] });
  assert.deepEqual(stripDecorations("Song ft. Someone"), { text: "Song", featured: ["Someone"] });
  assert.equal(stripDecorations("Song (Lyrics) (HD)").text, "Song");
  assert.equal(stripDecorations("Song (prod. by Someone)").text, "Song");
  assert.equal(stripDecorations("Song (Radio Edit)").text, "Song");
  assert.equal(stripDecorations("Song (Tiesto Remix)").text, "Song (Tiesto Remix)");
  assert.equal(stripDecorations("Song (Live at Wembley)").text, "Song (Live at Wembley)");
});

test("cleanTitle drops noise suffixes but keeps variant suffixes", () => {
  assert.equal(cleanTitle("There Is a Light That Never Goes Out - 2011 Remaster"), "There Is a Light That Never Goes Out");
  assert.equal(cleanTitle("Song - Remastered 2011"), "Song");
  assert.equal(cleanTitle("Song - Radio Edit"), "Song");
  assert.equal(cleanTitle('Song - From "Some Film"'), "Song");
  assert.equal(cleanTitle("Song - Acoustic"), "Song - Acoustic");
  assert.equal(cleanTitle("Talk To You (ft. 54 Ultra)"), "Talk To You");
});

test("splitUploadTitle and splitArtists", () => {
  assert.deepEqual(splitUploadTitle("The Weeknd - Blinding Lights (Official Audio)"), { artist: "The Weeknd", title: "Blinding Lights", featured: [] });
  assert.deepEqual(splitUploadTitle("Just A Title"), { artist: null, title: "Just A Title", featured: [] });
  assert.deepEqual(splitArtists("A, B & C x D feat. E"), ["A", "B", "C", "D", "E"]);
});

test("titleSimilarity", () => {
  assert.equal(titleSimilarity("Hey Ya!", "hey ya"), 1);
  assert.equal(titleSimilarity("HeyYa", "Hey Ya"), 1);
  assert.ok(titleSimilarity("Love", "Love Story") < 0.75);
  assert.equal(titleSimilarity("Love", "Hate"), 0);
});

test("durationSimilarity", () => {
  assert.equal(durationSimilarity(200000, 202000), 1);
  assert.ok(durationSimilarity(200000, 209000) >= 0.6);
  assert.ok(durationSimilarity(200000, 260000) < 0.3);
  // 10% of a 10-minute track is a minute; still counts as close.
  assert.ok(durationSimilarity(600000, 650000) >= 0.6);
});

test("variantPenalty only fires when the source lacks the marker", () => {
  assert.ok(variantPenalty("Song", "Song (Sped Up)") >= 0.3);
  assert.ok(variantPenalty("Song", "Song - Nightcore Remix") > 0.3);
  assert.equal(variantPenalty("Song - Tiesto Remix", "Song (Tiesto Remix)"), 0);
  assert.equal(variantPenalty("Song", "Song"), 0);
  assert.ok(variantPenalty("Song - Live", "Song") > 0);
});

test("artistScore uses the uploader and artists named in the title", () => {
  assert.equal(artistScore(["The Weeknd"], sc("Blinding Lights", "theweeknd", 200)), 1);
  assert.ok(artistScore(["The Weeknd"], sc("Blinding Lights", "The Weeknd Official", 200))! >= 0.9);
  assert.equal(artistScore(["The Weeknd"], sc("The Weeknd - Blinding Lights", "XO Records", 200)), 1);
  assert.ok(artistScore(["KAROL G", "Judeline"], sc("BbY WOW (feat. Judeline)", "someone", 225))! >= 0.85);
  assert.equal(artistScore([], sc("x", "y", 1)), null);
  assert.ok(artistScore(["Taylor Swift"], sc("Random", "dj mixer", 200))! < 0.3);
});

test("an official upload is matched", () => {
  const s = scoreCandidate(sp("Blinding Lights", ["The Weeknd"], 200), sc("Blinding Lights", "The Weeknd", 201));
  assert.ok(s.score >= 0.95, String(s.score));
  assert.equal(statusOf(s.score), "matched");
});

test("a re-upload by another account with the right title and length needs checking", () => {
  const s = scoreCandidate(sp("Blinding Lights", ["The Weeknd"], 200), sc("blinding lights", "music fan 99", 200));
  assert.equal(statusOf(s.score), "check");
});

test("sped up and slowed versions drop out of matched", () => {
  const s = scoreCandidate(sp("Blinding Lights", ["The Weeknd"], 200), sc("The Weeknd - Blinding Lights (sped up)", "edits", 160));
  assert.notEqual(statusOf(s.score), "matched");
  const same = scoreCandidate(sp("Blinding Lights - Sped Up", ["The Weeknd"], 160), sc("Blinding Lights (Sped Up)", "The Weeknd", 160));
  assert.equal(statusOf(same.score), "matched");
});

test("a 30 second preview is suspicious", () => {
  const s = scoreCandidate(sp("Song", ["Artist"], 210), sc("Song", "Artist", 30));
  assert.notEqual(statusOf(s.score), "matched");
});

test("the right artist with a different song is no match", () => {
  const s = scoreCandidate(sp("Save Your Tears", ["The Weeknd"], 215), sc("Blinding Lights", "The Weeknd", 215));
  assert.equal(statusOf(s.score), "none");
});

test("title-only sources never count as a sure match", () => {
  const s = scoreCandidate(sp("Neon Rooms", [], null), sc("Neon Rooms", "Moth Choir", 60));
  assert.equal(statusOf(s.score), "check");
});

test("rankCandidates skips non-streamable uploads and duplicates", () => {
  const good = sc("Song", "Artist", 200);
  const ranked = rankCandidates(sp("Song", ["Artist"], 200), [sc("Song", "Artist", 200, { id: "x", streamable: false }), good, good]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].track, good);
});

test("searchQueries and findMatches fall back to the bare title", async () => {
  assert.deepEqual(searchQueries(sp("Song (feat. X) - Remastered 2011", ["Artist"], 1)), ["Artist Song", "Song"]);
  assert.deepEqual(searchQueries(sp("Song", [], null)), ["Song"]);
  const asked: string[] = [];
  const result = await findMatches(sp("Neon Rooms", ["Moth Choir"], 61), async (q) => {
    asked.push(q);
    return q === "Neon Rooms" ? [sc("Neon Rooms", "Moth Choir", 60)] : [];
  });
  assert.deepEqual(asked, ["Moth Choir Neon Rooms", "Neon Rooms"]);
  assert.equal(statusOf(result[0].score), "matched");
});

// Cases from a real 33-track import against live SoundCloud search.
test("a mashup that names the song after a dash is not a sure match", () => {
  const into = sp("Into You", ["Ariana Grande"], 244);
  const mashup = scoreCandidate(into, sc("WHAT I NEED (w/ Ariana Grande - Into You)", "Darby", 243));
  assert.ok(mashup.score < MATCHED, `mashup scored ${mashup.score}`);
  const real = scoreCandidate(into, sc("Ariana Grande - Into You", "someone", 244));
  assert.ok(real.score > mashup.score);
});

test("right title and artist at the wrong length is only worth checking", () => {
  const s = scoreCandidate(sp("Pray For Me", ["The Weeknd", "Kendrick Lamar"], 211), sc("The Weeknd, Kendrick Lamar - Pray For Me", "Connor", 146));
  assert.equal(statusOf(s.score), "check");
});

test("a 30 s preview ranks below a full-length upload of the same song", () => {
  const src = sp("24K Magic", ["Bruno Mars"], 226);
  const preview = scoreCandidate(src, sc("24K Magic", "brunomars", 30, { preview: true }));
  const full = scoreCandidate(src, sc("Bruno Mars - 24K Magic", "fan", 228));
  assert.ok(preview.score <= 0.6);
  assert.ok(full.score > preview.score);
  const offLength = scoreCandidate(src, sc("Bruno Mars - 24K Magic", "fan", 150));
  assert.ok(offLength.score > preview.score, "a wrong-length full upload still beats a preview");
});

test("sing-offs and no-autotune versions count as different recordings", () => {
  assert.ok(variantsOf("Conor Maynard SING OFF Vs. Alex Aiono (Bruno Mars - 24K Magic)").has("sing off"));
  assert.ok(variantsOf("Britney Spears - Womanizer (No Autotune)").has("edit"));
  assert.ok(variantsOf("WHAT I NEED (w/ Ariana Grande - Into You)").has("mashup"));
  assert.ok(!variantsOf("Kesha - Die Young (Stem Edit)").has("edit"));
});
