// The Worker's port of the Spotify readers, checked against the same fixtures
// as the desktop tests in ../tests/spotify.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPageRequest, collectRemaining, fetchSpotifyList, parseEmbedHtml, parseListPage, parseSpotifyRef, splitArtists, type CapturedRequest, type ListPage,
} from "../src/spotify.ts";

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../tests/fixtures/spotify/${name}`, import.meta.url), "utf8"));
const embedHtml = (data: unknown) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
const fakeFetch = (html: string) => async () => new Response(html, { status: 200 });

test("parseSpotifyRef accepts links, URIs and bare IDs", () => {
  const id = "4CSw2rcHARwaukSYUegs3R";
  for (const input of [`https://open.spotify.com/playlist/${id}?si=abc`, `open.spotify.com/intl-de/playlist/${id}`, `spotify:playlist:${id}`, id]) {
    assert.deepEqual(parseSpotifyRef(input), { kind: "playlist", id }, input);
  }
  assert.deepEqual(parseSpotifyRef("https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj"), { kind: "album", id: "4yP0hdKOZPNshxUOjY0cZj" });
  assert.throws(() => parseSpotifyRef("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b"), /single track/);
  assert.throws(() => parseSpotifyRef("https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), /isn't a Spotify link/);
});

test("splitArtists splits on the embed's comma + no-break space only", () => {
  assert.deepEqual(splitArtists("Sean Paul, Dua Lipa"), ["Sean Paul", "Dua Lipa"]);
  assert.deepEqual(splitArtists("Tyler, The Creator, Kali Uchis"), ["Tyler, The Creator", "Kali Uchis"]);
  assert.deepEqual(splitArtists("A, B"), ["A", "B"]);
});

test("parseEmbedHtml reads a playlist embed", () => {
  const list = parseEmbedHtml(embedHtml(fixture("embed-playlist.json")));
  assert.equal(list.kind, "playlist");
  assert.equal(list.tracks.length, 3);
  assert.deepEqual(list.tracks[0], { spotifyId: "3h5T5JypYU7huFiVYhv1dr", title: "BbY WOW", artists: ["KAROL G", "Judeline", "rusowsky"], durationMs: 225834, explicit: false });
  assert.throws(() => parseEmbedHtml("<html></html>"), /didn't include any data/);
});

test("parseListPage reads pathfinder pages", () => {
  const first = parseListPage(fixture("pathfinder-playlist.json"), "spotify:playlist:2YRe7HRKNRvXdJBp9nXFza")!;
  assert.equal(first.total, 1223);
  assert.equal(first.tracks[0].title, "Blinding Lights");
  assert.equal(first.tracks[0].artworkUrl, "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36");
  assert.equal(parseListPage(fixture("pathfinder-album.json"), "spotify:album:4yP0hdKOZPNshxUOjY0cZj")!.kind, "album");
});

test("buildPageRequest keeps only the replay headers", () => {
  const post = buildPageRequest(fixture("pathfinder-request.json"), 125, 100);
  assert.equal(JSON.parse(post.body!).variables.offset, 125);
  assert.equal(post.headers.authorization, "Bearer TEST_TOKEN");
  assert.equal(post.headers["content-length"], undefined);
});

test("collectRemaining pages until totalCount", async () => {
  const captured = fixture("pathfinder-request.json") as CapturedRequest;
  const calls: number[] = [];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init!.body));
    calls.push(variables.offset);
    const count = Math.max(0, Math.min(variables.limit, 260 - variables.offset));
    const items = Array.from({ length: count }, (_, i) => ({ itemV2: { data: { __typename: "Track", name: `T${variables.offset + i}`, uri: "spotify:track:x", artists: { items: [] } } } }));
    return Response.json({ data: { playlistV2: { uri: "spotify:playlist:p", content: { totalCount: 260, pagingInfo: { offset: variables.offset }, items } } } });
  };
  const first: ListPage = { kind: "playlist", name: null, owner: null, coverUrl: null, total: 260, offset: 0, itemCount: 25, tracks: Array.from({ length: 25 }, () => ({ spotifyId: null, title: "x", artists: [], durationMs: null, explicit: false })) };
  const result = await collectRemaining({ captured, first, expectedUri: "spotify:playlist:p", fetchImpl, deadline: Date.now() + 10000 });
  assert.equal(result.tracks.length, 260);
  assert.deepEqual(calls, [25, 125, 225]);
});

function hundredTrackEmbed() {
  const data = fixture("embed-playlist.json");
  const base = data.props.pageProps.state.data.entity.trackList[0];
  data.props.pageProps.state.data.entity.trackList = Array.from({ length: 100 }, (_, i) => ({ ...base, uri: `spotify:track:${i}` }));
  return embedHtml(data);
}

test("fetchSpotifyList: embed alone under 100 tracks", async () => {
  let fullCalled = false;
  const r = await fetchSpotifyList("37i9dQZF1DXcBWIGoYBM5M", {
    fetchImpl: fakeFetch(embedHtml(fixture("embed-playlist.json"))),
    fetchFull: async () => {
      fullCalled = true;
      return null;
    },
  });
  assert.equal(fullCalled, false);
  assert.deepEqual([r.source, r.truncated, r.total, r.notice], ["embed", false, 3, null]);
});

test("fetchSpotifyList: full page at the cap, embed fallback when unavailable or failing", async () => {
  const full = await fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", {
    fetchImpl: fakeFetch(hundredTrackEmbed()),
    fetchFull: async () => ({ kind: "playlist", total: 150, truncated: false, tracks: Array(150).fill({ title: "x", artists: [], spotifyId: null, durationMs: null, explicit: false }) }),
  });
  assert.deepEqual([full.source, full.tracks.length, full.truncated], ["page", 150, false]);

  for (const fetchFull of [async () => null, async () => { throw new Error("no browser"); }]) {
    const r = await fetchSpotifyList("2YRe7HRKNRvXdJBp9nXFza", { fetchImpl: fakeFetch(hundredTrackEmbed()), fetchFull });
    assert.deepEqual([r.source, r.tracks.length, r.truncated, r.total], ["embed", 100, true, null]);
    assert.match(r.notice!, /first 100 tracks/);
  }
});
