#!/usr/bin/env node
// Runs the app's real import matching (src/lib/match.ts) for a Spotify list
// against the live hosted API, the same way src/stores/importSession.ts does:
// findMatches with GET /search/tracks, four tracks at a time, pick = best
// candidate when it scores at least CHECK.
//
//   node scripts/match-spotify.mjs [spotify URL or ID] [base URL]
//
// Node 22.18+ strips TypeScript types, so match.ts imports directly.
import { CHECK, findMatches, statusOf } from "../../src/lib/match.ts";

const LIST = process.argv[2] ?? "https://open.spotify.com/playlist/4CSw2rcHARwaukSYUegs3R";
const BASE = (process.argv[3] ?? process.env.NIGHTJAR_API ?? "https://nightjar-api.k3s.lat/v1").replace(/\/+$/, "");
const CONCURRENCY = 4;

async function get(path) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let searches = 0;
const searchTracks = async (query) => {
  searches++;
  const page = await get(`/search/tracks?q=${encodeURIComponent(query)}`);
  return page.items.filter((x) => "duration" in x && "streamable" in x);
};

const list = await get(`/import/spotify?url=${encodeURIComponent(LIST)}`);
console.log(`"${list.name}" by ${list.owner}: ${list.tracks.length} tracks (source ${list.source}${list.truncated ? ", truncated" : ""})\n`);

const rows = list.tracks.map((t, i) => ({ i, source: { title: t.title, artists: t.artists, durationMs: t.durationMs, spotifyId: t.spotifyId, explicit: t.explicit } }));
let next = 0;
const worker = async () => {
  while (next < rows.length) {
    const row = rows[next++];
    try {
      const found = await findMatches(row.source, searchTracks);
      row.candidates = found;
      const best = found[0] ?? null;
      row.pick = best && best.score >= CHECK ? best : null;
      row.status = row.pick ? statusOf(row.pick.score) : "none";
    } catch (err) {
      row.status = "error";
      row.error = err.message;
    }
  }
};
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const sec = (ms) => {
  if (ms == null) return "?";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`${pad("#", 3)} ${pad("Spotify", 52)} ${pad("Best SoundCloud match", 52)} ${pad("len", 11)} ${pad("score", 5)}  t/a/d/pen   status`);
for (const row of rows) {
  const s = row.source;
  const best = row.candidates?.[0];
  const spotify = `${s.title} - ${s.artists.join(", ")}`;
  if (!best) {
    console.log(`${pad(String(row.i + 1), 3)} ${pad(spotify, 52)} ${pad(row.error ?? "(no candidates)", 52)} ${pad("", 11)} ${pad("", 5)}  ${"".padEnd(10)}  ${row.status}`);
    continue;
  }
  const t = best.track;
  const match = `${t.title} [${t.user.username}]${t.preview ? " PREVIEW" : ""}`;
  const p = best.parts;
  const parts = [p.title, p.artist, p.duration, p.penalty].map((x) => (x == null ? "-" : x.toFixed(1))).join("/");
  console.log(`${pad(String(row.i + 1), 3)} ${pad(spotify, 52)} ${pad(match, 52)} ${pad(`${sec(t.duration)}/${sec(s.durationMs)}`, 11)} ${best.score.toFixed(2).padEnd(5)}  ${parts.padEnd(10)}  ${row.status}`);
  const preview = row.candidates.find((c) => c.track.preview);
  if (preview && preview !== best) {
    console.log(`${"".padEnd(56)} ↳ preview in top 5: ${pad(`${preview.track.title} [${preview.track.user.username}]`, 48)} score ${preview.score.toFixed(2)}`);
  }
}

const counts = { matched: 0, check: 0, none: 0, error: 0 };
for (const row of rows) counts[row.status]++;
const previews = rows.filter((r) => r.pick?.track.preview).length;
const withPreview = rows.filter((r) => r.candidates?.some((c) => c.track.preview)).length;
console.log(`\nmatched ${counts.matched}, check ${counts.check}, no match ${counts.none}${counts.error ? `, errors ${counts.error}` : ""}`);
console.log(`${previews} picks are 30 s previews; ${withPreview} tracks had a preview among their top 5; ${searches} searches in ${((Date.now() - started) / 1000).toFixed(1)} s`);
