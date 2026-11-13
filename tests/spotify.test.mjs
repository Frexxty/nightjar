// Parsing for the main-process Spotify fetcher, against trimmed real responses
// in tests/fixtures/spotify (tokens replaced, user names anonymized).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const spotify = require("../electron/spotify.cjs");
const page = require("../electron/spotify-page.cjs");
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/spotify/${name}`, import.meta.url), "utf8"));
const embedHtml = (data) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;

test("parseSpotifyRef accepts the usual link shapes", () => {
  const id = "37i9dQZF1DXcBWIGoYBM5M";
  for (const input of [
    `https://open.spotify.com/playlist/${id}?si=abc123`,
    `open.spotify.com/intl-de/playlist/${id}`,
    `https://open.spotify.com/embed/playlist/${id}`,
    `spotify:playlist:${id}`,
    `spotify:user:someone:playlist:${id}`,
    `  ${id}  `,
  ]) assert.deepEqual(spotify.parseSpotifyRef(input), { kind: "playlist", id }, input);
  assert.deepEqual(spotify.parseSpotifyRef("https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj"), { kind: "album", id: "4yP0hdKOZPNshxUOjY0cZj" });
  assert.throws(() => spotify.parseSpotifyRef("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b"), /single track/);
  assert.throws(() => spotify.parseSpotifyRef("https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), /isn't a Spotify link/);
  assert.throws(() => spotify.parseSpotifyRef(""), /Paste/);
});

test("parseEmbedHtml reads a playlist embed", () => {
  const list = spotify.parseEmbedHtml(embedHtml(fixture("embed-playlist.json")));
  assert.equal(list.kind, "playlist");
  assert.equal(list.name, "Today’s Top Hits");
  assert.equal(list.owner, "Spotify");
  assert.match(list.coverUrl, /^https:\/\//);
  assert.equal(list.tracks.length, 3);
  assert.deepEqual(list.tracks[0], { spotifyId: "3h5T5JypYU7huFiVYhv1dr", title: "BbY WOW", artists: ["KAROL G", "Judeline", "rusowsky"], durationMs: 225834, explicit: false });
});

test("parseEmbedHtml reads an album embed, whose cover sits in visualIdentity", () => {
  const list = spotify.parseEmbedHtml(embedHtml(fixture("embed-album.json")));
  assert.equal(list.kind, "album");
  assert.equal(list.owner, "The Weeknd");
  assert.match(list.coverUrl, /^https:\/\//);
  assert.equal(list.tracks[0].explicit, true);
});

test("parseEmbedHtml explains missing data", () => {
  assert.throws(() => spotify.parseEmbedHtml("<html></html>"), /didn't include any data/);
  assert.throws(() => spotify.parseEmbedHtml(embedHtml({ props: { pageProps: { status: 404 } } })), /couldn't find/);
  assert.throws(() => spotify.parseEmbedHtml(embedHtml({ props: { pageProps: {} } })), /didn't include a track list/);
});

test("parseListPage reads a pathfinder playlist page", () => {
  const first = page.parseListPage(fixture("pathfinder-playlist.json"), "spotify:playlist:2YRe7HRKNRvXdJBp9nXFza");
  assert.equal(first.kind, "playlist");
  assert.equal(first.total, 1223);
  assert.equal(first.offset, 0);
  assert.equal(first.itemCount, 3);
  assert.equal(first.owner, "Example User");
  assert.deepEqual(first.tracks[0], { spotifyId: "0VjIjW4GlUZAMYd2vXMi3b", title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200040, explicit: false });
  // Another playlist's response (the page loads several) is ignored.
  assert.equal(page.parseListPage(fixture("pathfinder-playlist.json"), "spotify:playlist:somethingelse0000000000"), null);
});

test("parseListPage reads a pathfinder album page", () => {
  const first = page.parseListPage(fixture("pathfinder-album.json"), "spotify:album:4yP0hdKOZPNshxUOjY0cZj");
  assert.equal(first.kind, "album");
  assert.equal(first.total, 14);
  assert.equal(first.owner, "The Weeknd");
  assert.equal(first.tracks[0].title, "Alone Again");
  assert.equal(first.tracks[0].explicit, true);
});

test("parseListPage skips episodes and empty slots, and reports NotFound", () => {
  const json = fixture("pathfinder-playlist.json");
  json.data.playlistV2.content.items.push(
    { itemV2: { __typename: "EpisodeResponseWrapper", data: { __typename: "Episode", name: "A podcast", uri: "spotify:episode:x" } } },
    { itemV2: { __typename: "TrackResponseWrapper", data: null } },
  );
  const parsed = page.parseListPage(json, null);
  assert.equal(parsed.itemCount, 5);
  assert.equal(parsed.tracks.length, 3);
  assert.equal(page.parseListPage(fixture("pathfinder-notfound.json"), null), null);
  assert.match(page.pathfinderProblem(fixture("pathfinder-notfound.json")), /doesn't exist/);
});

test("buildPageRequest replays POST and GET queries with a new offset", () => {
  const captured = fixture("pathfinder-request.json");
  const post = page.buildPageRequest(captured, 125, 100);
  const body = JSON.parse(post.body);
  assert.equal(body.operationName, "fetchPlaylist");
  assert.equal(body.variables.offset, 125);
  assert.equal(body.variables.limit, 100);
  assert.equal(body.variables.uri, "spotify:playlist:2YRe7HRKNRvXdJBp9nXFza");
  assert.equal(post.headers.authorization, "Bearer TEST_TOKEN");
  assert.equal(post.headers["client-token"], "TEST_CLIENT_TOKEN");
  assert.equal(post.headers[":path"], undefined);
  assert.equal(post.headers["content-length"], undefined);

  const parsed = page.parsePathfinderRequest(captured);
  const url = new URL(captured.url);
  url.searchParams.set("operationName", parsed.operationName);
  url.searchParams.set("variables", JSON.stringify(parsed.variables));
  url.searchParams.set("extensions", JSON.stringify(parsed.extensions));
  const get = page.buildPageRequest({ url: url.toString(), method: "GET", headers: captured.headers }, 25, 50);
  const vars = JSON.parse(new URL(get.url).searchParams.get("variables"));
  assert.equal(get.method, "GET");
  assert.deepEqual([vars.offset, vars.limit], [25, 50]);
});

// A fake pathfinder that serves a playlist of `total` tracks.
function fakePathfinder(total, { failAt = null } = {}) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    calls.push([variables.offset, variables.limit]);
    if (failAt != null && variables.offset >= failAt) return { ok: false, status: 401, json: async () => ({}) };
    const count = Math.max(0, Math.min(variables.limit, total - variables.offset));
    const items = Array.from({ length: count }, (_, i) => ({
      itemV2: { data: { __typename: "Track", name: `T${variables.offset + i}`, uri: `spotify:track:${variables.offset + i}`, artists: { items: [] }, trackDuration: { totalMilliseconds: 1000 } } },
    }));
    return { ok: true, status: 200, json: async () => ({ data: { playlistV2: { uri: "spotify:playlist:p", content: { totalCount: total, pagingInfo: { offset: variables.offset }, items } } } }) };
  };
  return { fetchImpl, calls };
}

test("collectRemaining pages until totalCount", async () => {
  const captured = fixture("pathfinder-request.json");
  const { fetchImpl, calls } = fakePathfinder(260);
  const first = { kind: "playlist", total: 260, offset: 0, itemCount: 25, tracks: Array.from({ length: 25 }, (_, i) => ({ title: `T${i}` })) };
  const result = await page.collectRemaining({ captured, first, expectedUri: "spotify:playlist:p", fetchImpl, deadline: Date.now() + 10000 });
  assert.equal(result.tracks.length, 260);
  assert.equal(result.stopReason, null);
  assert.deepEqual(calls, [[25, 100], [125, 100], [225, 100]]);
});

test("collectRemaining keeps what it has when the token expires", async () => {
  const captured = fixture("pathfinder-request.json");
  const { fetchImpl } = fakePathfinder(400, { failAt: 125 });
  const first = { kind: "playlist", total: 400, offset: 0, itemCount: 25, tracks: Array.from({ length: 25 }, (_, i) => ({ title: `T${i}` })) };
  const result = await page.collectRemaining({ captured, first, expectedUri: "spotify:playlist:p", fetchImpl, deadline: Date.now() + 10000 });
  assert.equal(result.tracks.length, 125);
  assert.match(result.stopReason, /expired/);
});

test("fetchSpotifyList uses the embed alone when it has fewer than 100 tracks", async () => {
  let fullCalled = false;
  const result = await spotify.fetchSpotifyList("37i9dQZF1DXcBWIGoYBM5M", {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => embedHtml(fixture("embed-playlist.json")) }),
    fetchFull: async () => {
      fullCalled = true;
      return null;
    },
  });
  assert.equal(fullCalled, false);
  assert.equal(result.source, "embed");
  assert.equal(result.truncated, false);
  assert.equal(result.total, 3);
});

function hundredTrackEmbed() {
  const data = fixture("embed-playlist.json");
  const base = data.props.pageProps.state.data.entity.trackList[0];
  data.props.pageProps.state.data.entity.trackList = Array.from({ length: 100 }, (_, i) => ({ ...base, uri: `spotify:track:${i}` }));
  return embedHtml(data);
}

test("fetchSpotifyList switches to the full page at the 100-track cap", async () => {
  const result = await spotify.fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => hundredTrackEmbed() }),
    fetchFull: async () => ({ kind: "playlist", name: "Full", owner: "o", coverUrl: null, total: 150, truncated: false, notice: null, tracks: Array(150).fill({ title: "x" }) }),
  });
  assert.equal(result.source, "page");
  assert.equal(result.tracks.length, 150);
  assert.equal(result.truncated, false);
});

test("fetchSpotifyList falls back to the embed's 100 when the page capture fails", async () => {
  const logs = [];
  const result = await spotify.fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => hundredTrackEmbed() }),
    fetchFull: async () => {
      throw new Error("blocked");
    },
    log: (m) => logs.push(m),
  });
  assert.equal(result.source, "embed");
  assert.equal(result.tracks.length, 100);
  assert.equal(result.truncated, true);
  assert.match(result.notice, /Paste a track list/);
  assert.match(logs.join("\n"), /blocked/);
});

test("fetchSpotifyList keeps the embed's 100 when the page capture stopped short of that", async () => {
  const result = await spotify.fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => hundredTrackEmbed() }),
    fetchFull: async () => ({ kind: "playlist", total: 500, truncated: true, notice: "stopped", tracks: Array(25).fill({ title: "x" }) }),
  });
  assert.equal(result.source, "embed");
  assert.equal(result.tracks.length, 100);
  assert.equal(result.truncated, true);
});

test("fetchSpotifyList reports a friendly error when nothing works", async () => {
  await assert.rejects(
    spotify.fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", {
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
      fetchFull: async () => {
        throw new Error("no network");
      },
    }),
    /Couldn't reach Spotify/,
  );
});

test("splitArtists keeps commas inside artist names", () => {
  assert.deepEqual(spotify.splitArtists("Tyler, The Creator, Kali Uchis"), ["Tyler, The Creator", "Kali Uchis"]);
  assert.deepEqual(spotify.splitArtists("KAROL G, Judeline, rusowsky"), ["KAROL G", "Judeline", "rusowsky"]);
  assert.deepEqual(spotify.splitArtists("Solo Artist"), ["Solo Artist"]);
});
