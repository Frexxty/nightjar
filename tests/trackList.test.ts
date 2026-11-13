import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseTrackList } from "../src/lib/trackList.ts";

test("parseCsv handles quotes, doubled quotes, commas and newlines in fields", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line\nbreak"\n\n1,,3');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "line\nbreak"], ["1", "", "3"]]);
});

test("Exportify CSV", () => {
  const csv = [
    '"Track URI","Track Name","Album Name","Artist Name(s)","Release Date","Duration (ms)"',
    '"spotify:track:0VjIjW4GlUZAMYd2vXMi3b","Blinding Lights","After Hours","The Weeknd","2020-03-20","200040"',
    '"spotify:track:abc","Song, With Comma","Album","Artist A,Artist B","2020","123456"',
    '"spotify:local:x","","","","",""',
  ].join("\n");
  const list = parseTrackList(csv);
  assert.equal(list.format, "csv");
  assert.equal(list.skipped, 1);
  assert.deepEqual(list.tracks[0], { title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200040, spotifyId: "0VjIjW4GlUZAMYd2vXMi3b" });
  assert.deepEqual(list.tracks[1].artists, ["Artist A", "Artist B"]);
  assert.equal(list.tracks[1].title, "Song, With Comma");
});

test("Artist - Title lines with numbering and durations", () => {
  const list = parseTrackList("1. The Weeknd - Blinding Lights (3:20)\n\n# comment\nDaft Punk – One More Time\nJust A Title\nA - B - C 4:05");
  assert.equal(list.format, "lines");
  assert.deepEqual(list.tracks, [
    { title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200000 },
    { title: "One More Time", artists: ["Daft Punk"], durationMs: null },
    { title: "Just A Title", artists: [], durationMs: null },
    { title: "B - C", artists: ["A"], durationMs: 245000 },
  ]);
});
