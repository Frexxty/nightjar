import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Track } from "../src/api/types.ts";

// An in-memory localStorage, installed before the module first reads it.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

const art = await import("../src/spotify/artwork.ts");
const {
  cachedTrackArtwork, distinctCovers, flushArtworkCache, isMosaicUrl, isPlaylistCoverUrl, largeSpotifyImage, needsArtwork,
  repairPlaylistArtwork, resetArtworkCache, shouldRepairArtwork, spotifyTrackArtwork, suspectCovers, tracksNeedingArtwork,
  withTrackArtwork, REPAIR_ATTEMPTS,
} = art;

const MOSAIC =
  "https://mosaic.scdn.co/640/ab67616d00001e022d564195ed3dd7b70d64862cab67616d00001e026e2a4bcec7ce799fb6921162ab67616d00001e02caf82abb2338880577e472beab67616d00001e02e2a0a166493a2bde5480a420";
const hash = (n: number) => n.toString(16).padStart(24, "0");
const small = (n: number) => `https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02${hash(n)}`;
const large = (n: number) => `https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273${hash(n)}`;
const sid = (n: number) => `track${String(n).padStart(17, "0")}`;

function track(n: number, artworkUrl: string | null, id = `spotify:track:${sid(n)}`): Track {
  return {
    id, title: `T${n}`, user: { id: "u", username: "A", avatarUrl: null }, artworkUrl, duration: 1, createdAt: "",
    playbackCount: 0, likesCount: 0, repostsCount: 0, commentCount: 0, waveform: null, streamable: true,
  };
}

/** A fake oEmbed: thumbnail n for track sid(n); counts calls; `fail` ids answer 500, `missing` 404. */
function fakeOembed(opts: { fail?: Set<string>; missing?: Set<string>; delayMs?: number } = {}) {
  const calls: string[] = [];
  let active = 0;
  let peak = 0;
  const fetch = async (url: string) => {
    const id = decodeURIComponent(url.split("/track/")[1]);
    calls.push(id);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 1));
    active--;
    if (opts.missing?.has(id)) return { ok: false, status: 404, json: async () => ({}) };
    if (opts.fail?.has(id)) return { ok: false, status: 500, json: async () => ({}) };
    const n = Number(id.replace("track", ""));
    return { ok: true, status: 200, json: async () => ({ thumbnail_url: small(n), thumbnail_width: 300 }) };
  };
  return { fetch, calls, peak: () => peak };
}

beforeEach(() => {
  store.clear();
  resetArtworkCache();
});

test("isMosaicUrl spots playlist mosaics on both CDNs", () => {
  assert.equal(isMosaicUrl(MOSAIC), true);
  const glued = "https://image-cdn-fa.spotifycdn.com/image/" + MOSAIC.split("/640/")[1];
  assert.equal(isMosaicUrl(glued), true);
  assert.equal(isMosaicUrl(small(1)), false);
  assert.equal(isMosaicUrl("https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36"), false);
  assert.equal(isMosaicUrl(null), false);
  assert.equal(isMosaicUrl("not a url"), false);
  // Uploaded and editorial playlist images aren't mosaics but aren't track art either.
  const uploaded = "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84" + hash(7);
  assert.equal(isMosaicUrl(uploaded), false);
  assert.equal(isPlaylistCoverUrl(uploaded), true);
  assert.equal(isPlaylistCoverUrl("https://i.scdn.co/image/ab67706f00000002f04528c743e20039ac4eff07"), true);
  assert.equal(isPlaylistCoverUrl(MOSAIC), true);
  assert.equal(isPlaylistCoverUrl(large(1)), false);
});

test("largeSpotifyImage upgrades 300 and 64 px album art to 640 px", () => {
  assert.equal(largeSpotifyImage(small(5)), large(5));
  assert.equal(largeSpotifyImage(`https://i.scdn.co/image/ab67616d00004851${hash(5)}`), `https://i.scdn.co/image/ab67616d0000b273${hash(5)}`);
  assert.equal(largeSpotifyImage(large(5)), large(5));
  assert.equal(largeSpotifyImage(MOSAIC), MOSAIC);
  assert.equal(largeSpotifyImage("https://i1.sndcdn.com/artworks-x-t500x500.jpg"), "https://i1.sndcdn.com/artworks-x-t500x500.jpg");
});

test("enrichment picks only Spotify tracks without their own cover", () => {
  const sc = track(9, null, "248639197");
  const tracks = [track(1, MOSAIC), track(2, large(2)), track(3, null), sc, track(4, MOSAIC), track(5, large(5))];
  assert.deepEqual(tracksNeedingArtwork(tracks), [0, 2, 4]);
  assert.equal(needsArtwork(sc), false);
  // A cover most of the list shares is the playlist cover copied onto each track.
  const copied = large(99);
  const shared = [1, 2, 3, 4].map((n) => track(n, copied)).concat(track(5, large(5)));
  assert.ok(suspectCovers(shared).has(copied));
  assert.deepEqual(tracksNeedingArtwork(shared), [0, 1, 2, 3]);
  assert.deepEqual(tracksNeedingArtwork(shared, null, true), []);
  // The list's own cover, passed in, counts too, even on one track.
  assert.deepEqual(tracksNeedingArtwork([track(1, copied), track(2, large(2))], copied), [0]);
  // Two tracks sharing an album cover is normal.
  assert.deepEqual(tracksNeedingArtwork([track(1, large(7)), track(2, large(7)), track(3, large(3))]), []);
});

test("withTrackArtwork fills covers at 640 px and reports progress", async () => {
  const oembed = fakeOembed();
  const tracks = [track(1, MOSAIC), track(2, large(2)), track(3, null)];
  const seen: number[] = [];
  const out = await withTrackArtwork(tracks, (p) => seen.push(p.index), { fetch: oembed.fetch });
  assert.equal(out[0].artworkUrl, large(1));
  assert.equal(out[1], tracks[1]);
  assert.equal(out[2].artworkUrl, large(3));
  assert.deepEqual(seen.sort(), [0, 2]);
  assert.deepEqual(oembed.calls.sort(), [sid(1), sid(3)]);
  // The input is left alone.
  assert.equal(tracks[0].artworkUrl, MOSAIC);
});

test("lookups are cached in memory and in localStorage, and shared while in flight", async () => {
  const oembed = fakeOembed();
  const [a, b] = await Promise.all([spotifyTrackArtwork(sid(1), { fetch: oembed.fetch }), spotifyTrackArtwork(sid(1), { fetch: oembed.fetch })]);
  assert.equal(a, large(1));
  assert.equal(b, large(1));
  assert.equal(oembed.calls.length, 1);
  assert.equal(await spotifyTrackArtwork(sid(1), { fetch: oembed.fetch }), large(1));
  assert.equal(oembed.calls.length, 1);

  flushArtworkCache();
  assert.equal(JSON.parse(store.get("stratus.spotifyArtwork")!)[sid(1)], large(1));
  // A fresh start (new session) reads the stored copy without asking Spotify.
  const saved = store.get("stratus.spotifyArtwork")!;
  resetArtworkCache();
  store.set("stratus.spotifyArtwork", saved);
  assert.equal(cachedTrackArtwork(sid(1)), large(1));
  assert.equal(await spotifyTrackArtwork(sid(1), { fetch: oembed.fetch }), large(1));
  assert.equal(oembed.calls.length, 1);
});

test("failures come back null without throwing, and only 404s are remembered", async () => {
  const oembed = fakeOembed({ fail: new Set([sid(1)]), missing: new Set([sid(2)]) });
  assert.equal(await spotifyTrackArtwork(sid(1), { fetch: oembed.fetch }), null);
  assert.equal(await spotifyTrackArtwork(sid(2), { fetch: oembed.fetch }), null);
  const throwing = async () => {
    throw new Error("offline");
  };
  assert.equal(await spotifyTrackArtwork(sid(3), { fetch: throwing }), null);
  const hanging = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal(await spotifyTrackArtwork(sid(4), { fetch: hanging, timeoutMs: 20 }), null);
  assert.equal(await spotifyTrackArtwork("bad id!", { fetch: oembed.fetch }), null);

  await spotifyTrackArtwork(sid(1), { fetch: oembed.fetch });
  await spotifyTrackArtwork(sid(2), { fetch: oembed.fetch });
  assert.deepEqual(oembed.calls, [sid(1), sid(2), sid(1)]);
});

test("at most six lookups run at once", async () => {
  const oembed = fakeOembed({ delayMs: 5 });
  const tracks = Array.from({ length: 20 }, (_, i) => track(i + 1, null));
  const out = await withTrackArtwork(tracks, undefined, { fetch: oembed.fetch });
  assert.equal(oembed.calls.length, 20);
  assert.ok(oembed.peak() <= 6, `peak ${oembed.peak()}`);
  assert.ok(out.every((t, i) => t.artworkUrl === large(i + 1)));
});

test("the header takes the first four distinct covers, skipping playlist images", () => {
  const tracks = [track(1, MOSAIC), track(2, small(2)), track(3, large(2)), track(4, large(4)), track(5, null), track(6, large(6)), track(7, large(7)), track(8, large(8))];
  assert.deepEqual(distinctCovers(tracks), [small(2), large(4), large(6), large(7)]);
  assert.deepEqual(distinctCovers([track(1, MOSAIC)]), []);
});

test("repair runs once per playlist and retries a limited number of times after failures", async () => {
  const broken = [track(1, MOSAIC), track(2, MOSAIC), track(3, MOSAIC)];
  const ok = fakeOembed();
  const first = await repairPlaylistArtwork("local:abc", broken, { fetch: ok.fetch });
  assert.deepEqual([...first!.covers.entries()], broken.map((t, i) => [t.id, large(i + 1)]));
  assert.equal(first!.failed, 0);
  // Done: opening it again does nothing, even with the old tracks.
  assert.equal(shouldRepairArtwork("local:abc", broken), false);
  assert.equal(await repairPlaylistArtwork("local:abc", broken, { fetch: ok.fetch }), null);
  // Unless tracks were added.
  assert.equal(shouldRepairArtwork("local:abc", [...broken, track(4, MOSAIC)]), true);

  const down = fakeOembed({ fail: new Set([sid(1), sid(2), sid(3)]) });
  const results = [];
  for (let i = 0; i < REPAIR_ATTEMPTS; i++) {
    resetArtworkCache();
    results.push(await repairPlaylistArtwork("sp_xyz", broken, { fetch: down.fetch }));
  }
  assert.deepEqual(results.map((r) => r!.gaveUp), [false, false, true]);
  assert.equal(await repairPlaylistArtwork("sp_xyz", broken, { fetch: down.fetch }), null);

  // A playlist whose covers are already right is left alone.
  assert.equal(await repairPlaylistArtwork("local:fine", [track(1, large(1)), track(2, large(2))], { fetch: ok.fetch }), null);
});
