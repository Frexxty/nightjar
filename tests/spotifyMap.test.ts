// Spotify ID parsing and Web API -> Nightjar mappers, against trimmed examples
// from Spotify's Web API reference in tests/fixtures/spotify-api.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSpotifyId, parseSpotifyUri, spotifyUri, spotifyWebUrl } from "../src/spotify/ids.ts";
import {
  largestImage, mapAlbum, mapArtist, mapPage, mapPlaylist, mapTrack, plainDescription, playlistFromSpotifyList, releaseDate,
} from "../src/spotify/map.ts";

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/spotify-api/${name}`, import.meta.url), "utf8"));

test("Spotify IDs", () => {
  assert.equal(isSpotifyId("spotify:track:11dFghVXANMlKmJXsNCbNl"), true);
  assert.equal(isSpotifyId("123456"), false);
  assert.equal(isSpotifyId(null), false);
  assert.deepEqual(parseSpotifyUri("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"), { kind: "album", id: "4aawyAB9vmqN3uQ7FjRGTy" });
  assert.deepEqual(parseSpotifyUri("spotify:user:jmperezperez"), { kind: "user", id: "jmperezperez" });
  assert.equal(parseSpotifyUri("spotify:episode:abc"), null);
  assert.equal(parseSpotifyUri("spotify:artist:Some%20Name"), null);
  assert.equal(parseSpotifyUri("spotify:local:a:b:c:180"), null);
  assert.equal(spotifyUri("playlist", "x1"), "spotify:playlist:x1");
  assert.equal(spotifyWebUrl("spotify:track:11dFghVXANMlKmJXsNCbNl"), "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl");
  assert.equal(spotifyWebUrl("spotify:local:x"), null);
});

test("helpers: largest image, release dates, playlist descriptions", () => {
  assert.equal(largestImage([{ url: "s", width: 64, height: 64 }, { url: "l", width: 640, height: 640 }]), "l");
  assert.equal(largestImage([{ url: "only", width: null, height: null }]), "only");
  assert.equal(largestImage([]), null);
  assert.equal(releaseDate("2017-05-26"), "2017-05-26T00:00:00.000Z");
  assert.equal(releaseDate("1981-12"), "1981-12-01T00:00:00.000Z");
  assert.equal(releaseDate("1981"), "1981-01-01T00:00:00.000Z");
  assert.equal(releaseDate("0000"), "0000-01-01T00:00:00.000Z");
  assert.equal(releaseDate(null), "");
  assert.equal(plainDescription('Mix &amp; match &#x27;n&#x27; <a href="x">this</a>'), "Mix & match 'n' this");
  assert.equal(plainDescription(""), null);
});

test("mapTrack", () => {
  const t = mapTrack(fixture("track.json"));
  assert.equal(t.id, "spotify:track:11dFghVXANMlKmJXsNCbNl");
  assert.equal(t.uri, t.id);
  assert.equal(t.source, "spotify");
  assert.equal(t.title, "Cut To The Feeling");
  assert.deepEqual(t.user, { id: "spotify:artist:6sFIWsNpZYqfjUpaCgueju", username: "Carly Rae Jepsen", avatarUrl: null });
  assert.equal(t.artworkUrl, "https://i.scdn.co/image/ab67616d0000b273e1b8a9b1a6d4d2b12f0f3b5d");
  assert.deepEqual(t.album, { id: "spotify:album:0tGPJ0bkWOUmH7MEOR77qc", title: "Cut To The Feeling", artworkUrl: t.artworkUrl });
  assert.equal(t.duration, 207959);
  assert.equal(t.createdAt, "2017-05-26T00:00:00.000Z");
  assert.equal(t.permalinkUrl, "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl");
  assert.equal(t.streamable, true);
  assert.equal(t.waveform, null);
  assert.deepEqual([t.playbackCount, t.likesCount, t.repostsCount, t.commentCount], [0, 0, 0, 0]);
});

test("mapAlbum: an album is a Playlist with isAlbum, tracks carry the album's art", () => {
  const a = mapAlbum(fixture("album.json"));
  assert.equal(a.id, "spotify:album:4aawyAB9vmqN3uQ7FjRGTy");
  assert.equal(a.isAlbum, true);
  assert.equal(a.trackCount, 18);
  assert.equal(a.user.username, "Pitbull");
  assert.equal(a.artworkUrl, "https://i.scdn.co/image/ab67616d0000b2732c5b24ecfa39523a75c993c4");
  assert.equal(a.tracks?.length, 2);
  const [first, second] = a.tracks!;
  assert.equal(first.user.username, "Pitbull, Sensato");
  assert.equal(first.user.id, "spotify:artist:0TnOYISbd1XYRBk9myaseg");
  assert.equal(first.artworkUrl, a.artworkUrl);
  assert.equal(first.album?.id, a.id);
  assert.equal(second.streamable, false, "is_playable: false");
  assert.equal(a.duration, 85400 + 206120);
});

test("mapPlaylist reads the February 2026 `items`/`item` shape and the older `track` key, skipping episodes and nulls", () => {
  const p = mapPlaylist(fixture("playlist.json"));
  assert.equal(p.id, "spotify:playlist:3cEYpjA9oz9GiPac4AsH4n");
  assert.equal(p.isAlbum, false);
  assert.equal(p.user.username, "JMPerez²");
  assert.equal(p.user.id, "spotify:user:jmperezperez");
  assert.equal(p.description, 'A playlist for testing pourposes & the "Web API" docs');
  assert.equal(p.trackCount, 4);
  assert.deepEqual(p.tracks?.map((t) => t.title), ["Api", "Is", "My demo.mp3"]);
  const local = p.tracks![2];
  assert.equal(local.streamable, false);
  assert.equal(local.id, "spotify:local:Local+Artist::My+demo:180");
});

test("mapPlaylist without items (someone else's playlist) has no tracks", () => {
  const raw = fixture("playlist.json");
  delete raw.items;
  raw.items = { href: "x", total: 12 };
  const p = mapPlaylist(raw);
  assert.equal(p.tracks, undefined);
  assert.equal(p.trackCount, 12);
});

test("mapArtist", () => {
  const u = mapArtist(fixture("artist.json"));
  assert.equal(u.id, "spotify:artist:0TnOYISbd1XYRBk9myaseg");
  assert.equal(u.username, "Pitbull");
  assert.equal(u.avatarUrl, "https://i.scdn.co/image/ab6761610000e5eb4051627b19277613e0e62a34");
  assert.equal(u.followersCount, 0, "followers are gone for dev-mode apps");
  assert.equal(u.description, "dance pop, miami hip hop, pop");
});

test("mapPage turns offset paging into a cursor and drops nulls", () => {
  const page = mapPage({ items: [{ n: 1 }, null as never, { n: 2 }], next: "https://api.spotify.com/v1/x?offset=12", offset: 10, limit: 2 }, (x: { n: number }) => x.n);
  assert.deepEqual(page, { items: [1, 2], next: "12" });
  assert.deepEqual(mapPage({ items: [], next: null }, (x) => x), { items: [], next: null });
});

test("playlistFromSpotifyList builds Spotify tracks from the page reader", () => {
  const p = playlistFromSpotifyList({
    id: "37i9dQZF1DXcBWIGoYBM5M", kind: "playlist", url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    name: "Today's Top Hits", owner: "Spotify", coverUrl: "https://i.scdn.co/image/x", total: 50, truncated: false, source: "embed", notice: null,
    tracks: [
      { spotifyId: "3h5T5JypYU7huFiVYhv1dr", title: "BbY WOW", artists: ["KAROL G", "Judeline"], durationMs: 225834, explicit: false },
      { spotifyId: null, title: "Local", artists: [], durationMs: null, explicit: false },
    ],
  });
  assert.equal(p.id, "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
  assert.equal(p.trackCount, 50);
  const [t, local] = p.tracks!;
  assert.equal(t.id, "spotify:track:3h5T5JypYU7huFiVYhv1dr");
  assert.equal(t.uri, t.id);
  assert.equal(t.source, "spotify");
  assert.equal(t.user.username, "KAROL G, Judeline");
  assert.equal(t.streamable, true);
  assert.equal(local.streamable, false);
});
