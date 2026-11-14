#!/usr/bin/env node
// End-to-end smoke test against a running copy of the hosted API (Worker stratus-api).
//
//   node scripts/smoke.mjs [base URL]     (default https://nightjar-api.k3s.lat/v1)
//
// Creates a throwaway account, exercises every route group, then deletes the
// account. It asks for a stream URL but never downloads any audio.

const BASE = (process.argv[2] ?? process.env.NIGHTJAR_API ?? "https://nightjar-api.k3s.lat/v1").replace(/\/+$/, "");
const SPOTIFY_PLAYLIST = "https://open.spotify.com/playlist/4CSw2rcHARwaukSYUegs3R";

let failures = 0;
let token = null;

async function call(method, path, { body, auth = true, expect } = {}) {
  const headers = { Accept: "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const started = Date.now();
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const ms = Date.now() - started;
  if (expect != null && res.status !== expect) {
    throw new Error(`${method} ${path} -> ${res.status} (wanted ${expect}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, data, ms, headers: res.headers };
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ""}  (${Date.now() - started} ms)`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}  ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const name = `smoke_${Math.random().toString(36).slice(2, 10)}`;
const password = `pw-${crypto.randomUUID()}`;
const ctx = {};

console.log(`nightjar-api smoke test against ${BASE}\n`);

await step("CORS preflight", async () => {
  const res = await fetch(`${BASE}/me/playlists`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "PATCH" } });
  assert(res.status === 204, `status ${res.status}`);
  assert(res.headers.get("access-control-allow-origin") === "*", "no allow-origin *");
  assert(/PATCH/.test(res.headers.get("access-control-allow-methods") ?? ""), "PATCH not allowed");
  assert(/Authorization/.test(res.headers.get("access-control-allow-headers") ?? ""), "Authorization not allowed");
});

await step("signed out: /me is 401", async () => {
  const r = await call("GET", "/me", { auth: false, expect: 401 });
  assert(r.data.code === "unauthorized", JSON.stringify(r.data));
});

await step("signup rejects a weak password", async () => {
  const r = await call("POST", "/auth/signup", { body: { username: name, email: `${name}@example.com`, password: "short" }, expect: 400 });
  assert(r.data.code === "weak_password", r.data.code);
});

await step("signup", async () => {
  const r = await call("POST", "/auth/signup", { body: { username: name, email: `${name.toUpperCase()}@Example.com`, password }, expect: 201 });
  assert(typeof r.data.token === "string" && r.data.token.length >= 40, "no token");
  assert(r.data.user.username === name && r.data.user.id.startsWith("me:"), JSON.stringify(r.data.user));
  token = r.data.token;
  ctx.userId = r.data.user.id;
  return `${name} ${r.data.user.id}`;
});

await step("signup rejects a taken username (any case)", async () => {
  const r = await call("POST", "/auth/signup", { auth: false, body: { username: name.toUpperCase(), email: `other_${name}@example.com`, password }, expect: 409 });
  assert(r.data.code === "username_taken", r.data.code);
});

await step("login with email (lower-cased) and username", async () => {
  const byEmail = await call("POST", "/auth/login", { auth: false, body: { login: `${name}@example.com`, password }, expect: 200 });
  const byName = await call("POST", "/auth/login", { auth: false, body: { login: name.toUpperCase(), password }, expect: 200 });
  assert(byEmail.data.token && byName.data.token && byEmail.data.token !== byName.data.token, "tokens");
  const bad = await call("POST", "/auth/login", { auth: false, body: { login: name, password: "wrong-password" }, expect: 401 });
  assert(bad.data.code === "invalid_credentials", bad.data.code);
  token = byName.data.token;
});

await step("GET /me", async () => {
  const r = await call("GET", "/me", { expect: 200 });
  assert(r.data.username === name && r.data.avatarUrl === null && r.data.followersCount === 0, JSON.stringify(r.data));
});

await step("search all kinds", async () => {
  const r = await call("GET", "/search?q=kendrick%20lamar", { expect: 200 });
  for (const k of ["tracks", "users", "playlists", "albums"]) assert(Array.isArray(r.data[k]?.items) && "next" in r.data[k], `missing ${k}`);
  assert(r.data.tracks.items.length > 0, "no tracks");
  ctx.scPlaylistId = r.data.playlists.items[0]?.id;
  ctx.albumId = r.data.albums.items[0]?.id;
  return `${r.data.tracks.items.length} tracks, ${r.data.users.items.length} users, ${r.data.playlists.items.length} playlists, ${r.data.albums.items.length} albums`;
});

await step("search tracks + next page", async () => {
  const r = await call("GET", "/search/tracks?q=Young%20Zerka%20Like%20Rihanna", { expect: 200 });
  const items = r.data.items;
  assert(items.length > 0, "no results");
  const preview = items.find((t) => t.preview);
  const full = items.find((t) => t.streamable && !t.preview);
  assert(full, "no full-length streamable track");
  ctx.trackIds = items.filter((t) => t.streamable).map((t) => t.id);
  ctx.track = full;
  assert(r.data.next, "no next cursor");
  const p2 = await call("GET", `/search/tracks?q=Young%20Zerka%20Like%20Rihanna&cursor=${encodeURIComponent(r.data.next)}`, { expect: 200 });
  assert(p2.data.items.length > 0 && p2.data.items[0].id !== items[0].id, "page 2 repeats page 1");
  return `${items.length} results; top "${items[0].title}" by ${items[0].user.username}; preview: ${preview ? `${preview.id} (${preview.duration} ms)` : "none"}`;
});

await step("GET /tracks/{id} with waveform", async () => {
  const r = await call("GET", `/tracks/${ctx.track.id}`, { expect: 200 });
  assert(r.data.id === ctx.track.id && r.data.title, "wrong track");
  assert(Array.isArray(r.data.waveform) && r.data.waveform.length > 50, "no waveform");
  assert(r.data.waveform.every((x) => x >= 0 && x <= 1), "waveform out of range");
  assert(r.data.liked === false, "liked flag missing");
  return `"${r.data.title}" ${r.data.duration} ms, ${r.data.waveform.length} peaks`;
});

await step("GET /tracks/{id}/stream (URL only, no download)", async () => {
  const r = await call("GET", `/tracks/${ctx.track.id}/stream`, { expect: 200 });
  assert(["hls", "progressive"].includes(r.data.protocol), r.data.protocol);
  const u = new URL(r.data.url);
  assert(/\.(m3u8|mp3)$/.test(u.pathname) || /m3u8|mp3/.test(r.data.url), `unexpected URL ${u.host}${u.pathname}`);
  assert(r.headers.get("cache-control") === "no-store", "stream response is cacheable");
  return `${r.data.protocol} ${r.data.mimeType} ${u.host}${u.pathname.replace(/^(.{40}).*(.{20})$/, "$1…$2")}`;
});

await step("unknown track is 404", async () => {
  const r = await call("GET", "/tracks/1", { expect: 404 });
  assert(r.data.code === "not_found", r.data.code);
});

await step("comments", async () => {
  const r = await call("GET", `/tracks/${ctx.track.id}/comments`, { expect: 200 });
  assert(Array.isArray(r.data), "not an array");
  const timed = r.data.filter((c) => c.timestamp != null).map((c) => c.timestamp);
  assert(timed.every((t, i) => i === 0 || timed[i - 1] <= t), "not sorted by timestamp");
  return `${r.data.length} comments, ${timed.length} timed`;
});

await step("posting a comment is 501 not_supported", async () => {
  const r = await call("POST", `/tracks/${ctx.track.id}/comments`, { body: { body: "hi", timestamp: 1000 }, expect: 501 });
  assert(r.data.code === "not_supported", r.data.code);
});

await step("related", async () => {
  const r = await call("GET", `/tracks/${ctx.track.id}/related`, { expect: 200 });
  assert(Array.isArray(r.data) && r.data.length > 0, "no related tracks");
  ctx.related = r.data;
  return `${r.data.length} tracks`;
});

await step("like / unlike", async () => {
  await call("PUT", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  const list = await call("GET", "/me/likes/tracks", { expect: 200 });
  assert(list.data.items[0]?.id === ctx.track.id && list.data.items[0].liked === true, "like not listed");
  const t = await call("GET", `/tracks/${ctx.track.id}`, { expect: 200 });
  assert(t.data.liked === true, "track not flagged liked");
  await call("DELETE", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  const after = await call("GET", "/me/likes/tracks", { expect: 200 });
  assert(after.data.items.length === 0, "like still listed");
});

await step("repost / unrepost", async () => {
  await call("PUT", `/me/reposts/tracks/${ctx.track.id}`, { expect: 204 });
  const t = await call("GET", `/tracks/${ctx.track.id}`, { expect: 200 });
  assert(t.data.reposted === true, "not flagged reposted");
  await call("DELETE", `/me/reposts/tracks/${ctx.track.id}`, { expect: 204 });
});

await step("user pages", async () => {
  const uid = ctx.track.user.id;
  const [u, top, tracks, playlists, likes] = await Promise.all([
    call("GET", `/users/${uid}`, { expect: 200 }),
    call("GET", `/users/${uid}/top-tracks`, { expect: 200 }),
    call("GET", `/users/${uid}/tracks`, { expect: 200 }),
    call("GET", `/users/${uid}/playlists`, { expect: 200 }),
    call("GET", `/users/${uid}/likes`, { expect: 200 }),
  ]);
  assert(u.data.id === uid && typeof u.data.followersCount === "number", "bad user");
  assert(Array.isArray(top.data) && Array.isArray(tracks.data.items) && Array.isArray(playlists.data) && Array.isArray(likes.data.items), "bad lists");
  return `${u.data.username}: ${top.data.length} top, ${tracks.data.items.length} tracks, ${playlists.data.length} playlists, ${likes.data.items.length} likes`;
});

await step("follow, feed, home, unfollow", async () => {
  const kendrick = (await call("GET", "/search/users?q=kendrick%20lamar", { expect: 200 })).data.items.find((u) => u.verified) ?? null;
  const ids = [ctx.track.user.id, kendrick?.id].filter(Boolean);
  for (const id of ids) await call("PUT", `/me/following/${id}`, { expect: 204 });
  const following = await call("GET", "/me/following", { expect: 200 });
  assert(following.data.length === ids.length && following.data.every((u) => u.following === true), "following list");
  const feed = await call("GET", "/feed", { expect: 200 });
  assert(feed.data.items.length > 0 && feed.data.items[0].kind === "track", "empty feed");
  const dates = feed.data.items.map((i) => i.createdAt);
  assert(dates.every((d, i) => i === 0 || dates[i - 1] >= d), "feed not newest first");
  if (feed.data.next) {
    const p2 = await call("GET", `/feed?cursor=${encodeURIComponent(feed.data.next)}`, { expect: 200 });
    assert(p2.data.items[0]?.createdAt <= dates.at(-1), "feed page 2 out of order");
  }
  await call("PUT", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  const home = await call("GET", "/home", { expect: 200 });
  const titles = home.data.map((s) => s.title);
  assert(titles.some((t) => t.startsWith("Because you liked")), `no "Because you liked": ${titles.join(" / ")}`);
  assert(home.data.length >= 4 && home.data.length <= 6, `${home.data.length} sections`);
  await call("DELETE", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  for (const id of ids) await call("DELETE", `/me/following/${id}`, { expect: 204 });
  return `feed ${feed.data.items.length} items; home: ${titles.join(" / ")}`;
});

await step("signed-out home", async () => {
  const r = await call("GET", "/home", { auth: false, expect: 200 });
  assert(r.data.length >= 4, `${r.data.length} sections`);
  return r.data.map((s) => `${s.title} (${s.kind}, ${s.items.length})`).join(" / ");
});

await step("feed is 401 signed out", async () => {
  await call("GET", "/feed", { auth: false, expect: 401 });
});

await step("SoundCloud playlist with hydrated tracks", async () => {
  assert(ctx.scPlaylistId, "no playlist from search");
  const r = await call("GET", `/playlists/${ctx.scPlaylistId}`, { expect: 200 });
  assert(Array.isArray(r.data.tracks), "no tracks");
  assert(r.data.tracks.every((t) => t.title && t.user), "stub tracks left");
  const album = ctx.albumId ? (await call("GET", `/playlists/${ctx.albumId}`, { expect: 200 })).data : null;
  return `"${r.data.title}" ${r.data.tracks.length}/${r.data.trackCount} tracks${album ? `; album "${album.title}" isAlbum=${album.isAlbum}` : ""}`;
});

await step("account playlist: create, read, rename, reorder, delete", async () => {
  const ids = [ctx.track.id, ...ctx.related.slice(0, 2).map((t) => t.id)];
  const created = await call("POST", "/me/playlists", { body: { title: "Smoke test", trackIds: ids, public: false, description: "temp" }, expect: 201 });
  const p = created.data;
  assert(p.id.startsWith("sp_") && p.tracks.length === 3 && p.trackCount === 3 && !p.isAlbum, JSON.stringify(p).slice(0, 200));
  const read = await call("GET", `/playlists/${p.id}`, { expect: 200 });
  assert(read.data.tracks.map((t) => t.id).join() === ids.join(), "order");
  const outsider = await call("GET", `/playlists/${p.id}`, { auth: false, expect: 404 });
  assert(outsider.data.code === "not_found", "private playlist visible signed out");
  const patched = await call("PATCH", `/me/playlists/${p.id}`, { body: { title: "Smoke test renamed", trackIds: [...ids].reverse(), public: true }, expect: 200 });
  assert(patched.data.title === "Smoke test renamed" && patched.data.tracks[0].id === ids[2], "patch");
  const pub = await call("GET", `/playlists/${p.id}`, { auth: false, expect: 200 });
  assert(pub.data.tracks.length === 3, "public read");
  const mine = await call("GET", "/me/playlists", { expect: 200 });
  assert(mine.data[0]?.id === p.id && mine.data[0].trackCount === 3 && mine.data[0].duration > 0, "list");
  await call("DELETE", `/me/playlists/${p.id}`, { expect: 204 });
  await call("GET", `/playlists/${p.id}`, { expect: 404 });
  return `${p.id}`;
});

await step("history", async () => {
  await call("POST", "/me/history", { body: { trackId: ctx.related[0].id }, expect: 204 });
  await call("POST", "/me/history", { body: { trackId: ctx.track.id }, expect: 204 });
  await call("POST", "/me/history", { body: { trackId: ctx.related[0].id }, expect: 204 });
  const r = await call("GET", "/me/history", { expect: 200 });
  assert(r.data.items.length === 2 && r.data.items[0].id === ctx.related[0].id, r.data.items.map((t) => t.id).join());
});

await step("Spotify import (the user's 33-track playlist)", async () => {
  const r = await call("GET", `/import/spotify?url=${encodeURIComponent(SPOTIFY_PLAYLIST)}`, { expect: 200 });
  assert(r.data.tracks.length === 33 && r.data.truncated === false && r.data.source === "embed", JSON.stringify({ ...r.data, tracks: r.data.tracks.length }));
  const noLie = r.data.tracks.find((t) => t.title === "No Lie");
  assert(noLie && noLie.artists.length === 2, `artist split: ${JSON.stringify(noLie)}`);
  ctx.spotifyList = r.data;
  return `"${r.data.name}" by ${r.data.owner}: ${r.data.tracks.length} tracks; "${noLie.title}" -> ${noLie.artists.join(" + ")}`;
});

// Spotify tracks are saved as snapshots the client sends (docs/spotify.md).
// These build them from the imported list the way the app's import does.
function spotifyTrack(t, extra = {}) {
  const id = `spotify:track:${t.spotifyId}`;
  return {
    id, uri: id, source: "spotify", title: t.title,
    user: { id: "spotify:artist:unknown", username: t.artists[0] ?? "Unknown artist", avatarUrl: null },
    artworkUrl: ctx.spotifyList?.coverUrl ?? null, duration: t.durationMs ?? 0, createdAt: new Date(0).toISOString(),
    playbackCount: 0, likesCount: 0, repostsCount: 0, commentCount: 0, streamable: true, album: null, ...extra,
  };
}
const spotifyTracks = () => (ctx.spotifyList?.tracks ?? []).filter((t) => t.spotifyId).map((t) => spotifyTrack(t));
const enc = encodeURIComponent;

await step("Spotify like: snapshot required, checked, stored, listed", async () => {
  const [a, b] = spotifyTracks();
  assert(a && b, "no Spotify tracks from the import step");
  const none = await call("PUT", `/me/likes/tracks/${enc(a.id)}`, { expect: 400 });
  assert(none.data.code === "invalid_input", none.data.code);
  await call("PUT", `/me/likes/tracks/${enc(a.id)}`, { body: { track: b }, expect: 400 });
  await call("PUT", `/me/likes/tracks/${enc("spotify:album:4CSw2rcHARwaukSYUegs3R")}`, { body: { track: a }, expect: 400 });
  const sneaky = { ...a, liked: false, evil: "x", artworkUrl: "http://insecure.example/a.jpg", permalinkUrl: "javascript:alert(1)" };
  await call("PUT", `/me/likes/tracks/${enc(a.id)}`, { body: { track: sneaky }, expect: 204 });
  await call("PUT", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  const list = await call("GET", "/me/likes/tracks", { expect: 200 });
  const ids = list.data.items.map((t) => t.id);
  assert(ids.join() === [ctx.track.id, a.id].join(), `likes order: ${ids.join()}`);
  const got = list.data.items[1];
  assert(got.title === a.title && got.source === "spotify" && got.uri === a.id && got.liked === true, JSON.stringify(got).slice(0, 300));
  assert(got.artworkUrl === null && got.permalinkUrl === null && !("evil" in got), `not cleaned: ${JSON.stringify(got).slice(0, 300)}`);
  await call("DELETE", `/me/likes/tracks/${enc(a.id)}`, { expect: 204 });
  await call("DELETE", `/me/likes/tracks/${ctx.track.id}`, { expect: 204 });
  const after = await call("GET", "/me/likes/tracks", { expect: 200 });
  assert(after.data.items.length === 0, "likes left");
  return `"${got.title}" by ${got.user.username}`;
});

await step("playlist mixing SoundCloud and Spotify tracks", async () => {
  const [a, b, c] = spotifyTracks();
  const sc1 = ctx.track;
  const sc2 = ctx.related[0];
  // SoundCloud entries only need their id; Spotify ones are full snapshots.
  const tracks = [{ id: sc1.id }, a, { id: sc2.id }, b];
  const ids = tracks.map((t) => t.id);
  const created = await call("POST", "/me/playlists", { body: { title: "Smoke mixed", trackIds: ids, tracks, public: false }, expect: 201 });
  const p = created.data;
  assert(p.tracks.map((t) => t.id).join() === ids.join(), `create order: ${p.tracks.map((t) => t.id).join()}`);
  assert(p.trackCount === 4 && p.tracks[1].source === "spotify" && p.tracks[1].title === a.title && p.tracks[0].title === sc1.title, "create tracks");
  const read = await call("GET", `/playlists/${p.id}`, { expect: 200 });
  assert(read.data.tracks.map((t) => t.id).join() === ids.join(), "read order");
  assert(read.data.tracks.every((t) => t.liked === false), "liked flags missing");
  // A reorder that only sends IDs works for snapshots the account already has.
  const reversed = [...ids].reverse();
  const reorder = await call("PATCH", `/me/playlists/${p.id}`, { body: { trackIds: reversed, public: true }, expect: 200 });
  assert(reorder.data.tracks.map((t) => t.id).join() === reversed.join(), "reorder");
  const outsider = await call("GET", `/playlists/${p.id}`, { auth: false, expect: 200 });
  assert(outsider.data.tracks[0].title === b.title, "public read of a snapshot");
  const unknown = await call("PATCH", `/me/playlists/${p.id}`, { body: { trackIds: [...ids, c.id] }, expect: 400 });
  assert(/snapshot/.test(unknown.data.error), unknown.data.error);
  const swapped = await call("PATCH", `/me/playlists/${p.id}`, { body: { tracks: [c, { id: sc1.id }] }, expect: 200 });
  assert(swapped.data.tracks.map((t) => t.id).join() === [c.id, sc1.id].join() && swapped.data.trackCount === 2, "replace with tracks");
  const mine = await call("GET", "/me/playlists", { expect: 200 });
  const listed = mine.data.find((x) => x.id === p.id);
  assert(listed && listed.trackCount === 2 && listed.duration === c.duration + sc1.duration, `list summary ${JSON.stringify(listed)}`);
  const bad = await call("POST", "/me/playlists", { body: { title: "Bad", tracks: [{ ...a, id: "spotify:track:../../x" }] }, expect: 400 });
  assert(bad.data.code === "invalid_input", bad.data.code);
  await call("DELETE", `/me/playlists/${p.id}`, { expect: 204 });
  return `${p.id}: ${p.tracks.map((t) => `${t.source ?? "soundcloud"}:${t.title}`).join(" / ").slice(0, 160)}`;
});

await step("Spotify history", async () => {
  const [a] = spotifyTracks();
  await call("POST", "/me/history", { body: { trackId: a.id }, expect: 400 });
  await call("POST", "/me/history", { body: { trackId: a.id, track: a }, expect: 204 });
  const r = await call("GET", "/me/history", { expect: 200 });
  const ids = r.data.items.map((t) => t.id);
  assert(ids[0] === a.id && r.data.items[0].source === "spotify" && r.data.items[0].title === a.title, ids.join());
  assert(ids.length === 3, `${ids.length} entries`);
  return ids.join(", ");
});

await step("logout revokes the token", async () => {
  const old = token;
  await call("POST", "/auth/logout", { expect: 204 });
  token = old;
  await call("GET", "/me", { expect: 401 });
});

await step("delete account", async () => {
  token = (await call("POST", "/auth/login", { auth: false, body: { login: name, password }, expect: 200 })).data.token;
  await call("DELETE", "/me", { body: { password: "wrong-password" }, expect: 401 });
  await call("DELETE", "/me", { body: { password }, expect: 204 });
  await call("POST", "/auth/login", { auth: false, body: { login: name, password }, expect: 401 });
  await call("GET", "/me", { expect: 401 });
});

console.log(failures ? `\n${failures} step(s) failed` : "\nAll steps passed");
process.exit(failures ? 1 : 0);
