// Full-length Spotify lists without an account or API key.
//
// The embed page stops at 100 tracks, so for longer lists we load the normal
// open.spotify.com page in a hidden window and let Spotify's own web player
// request the first page from its internal GraphQL endpoint (pathfinder). We
// watch that request through the Chrome DevTools Protocol, keep its URL, body
// and the anonymous tokens the page generated, then replay it with a growing
// offset until we have every track.
//
// Spotify renames operations and moves fields around now and then, so the
// parsing below is pure, works off the response shape rather than operation
// names, and is covered by tests/spotify-page.test.mjs against saved fixtures.

const PATHFINDER = /^https:\/\/api-partner\.spotify\.com\/pathfinder\//;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAGE_LIMIT = { playlist: 100, album: 50 };
const PAGE_DELAY_MS = 150;

// Headers we copy when replaying. The rest (pseudo headers, content-length,
// fetch metadata, cookies) are set by the network stack or not needed.
const REPLAY_HEADERS = new Set([
  "accept", "accept-language", "app-platform", "authorization", "client-token", "content-type",
  "spotify-app-version", "user-agent",
]);

const isPathfinderUrl = (url) => PATHFINDER.test(String(url));

/** Pulls operationName/variables/extensions out of a GET query string or a POST JSON body. */
function parsePathfinderRequest({ url, method, postData }) {
  if (!isPathfinderUrl(url)) return null;
  try {
    if (String(method).toUpperCase() === "GET") {
      const q = new URL(url).searchParams;
      return {
        operationName: q.get("operationName"),
        variables: JSON.parse(q.get("variables") || "{}"),
        extensions: JSON.parse(q.get("extensions") || "{}"),
      };
    }
    const body = JSON.parse(postData || "{}");
    return { operationName: body.operationName ?? null, variables: body.variables ?? {}, extensions: body.extensions ?? {} };
  } catch {
    return null;
  }
}

function replayHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const k = key.toLowerCase();
    if (REPLAY_HEADERS.has(k) && value != null) out[k] = String(value);
  }
  return out;
}

/** Builds the next page's request from the captured one: same query, new offset and limit. */
function buildPageRequest(captured, offset, limit) {
  const parsed = parsePathfinderRequest(captured);
  if (!parsed) throw new Error("captured request is not a pathfinder query");
  const variables = { ...parsed.variables, offset, limit };
  const headers = replayHeaders(captured.headers);
  if (String(captured.method).toUpperCase() === "GET") {
    const url = new URL(captured.url);
    url.searchParams.set("variables", JSON.stringify(variables));
    return { url: url.toString(), method: "GET", headers };
  }
  const body = { ...JSON.parse(captured.postData || "{}"), variables };
  return { url: captured.url, method: "POST", headers, body: JSON.stringify(body) };
}

const biggestImage = (sources) =>
  [...(Array.isArray(sources) ? sources : [])]
    .filter((s) => s && s.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;

const artistNames = (artists) => (artists?.items ?? []).map((a) => a?.profile?.name).filter(Boolean);

function trackFrom(data) {
  if (!data || typeof data !== "object" || typeof data.name !== "string" || !data.name) return null;
  const uri = typeof data.uri === "string" ? data.uri : "";
  // Episodes and other non-music items can sit in playlists; skip them.
  if (data.__typename && data.__typename !== "Track" && !/^spotify:(track|local):/.test(uri)) return null;
  const ms = data.trackDuration?.totalMilliseconds ?? data.duration?.totalMilliseconds;
  return {
    spotifyId: uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : null,
    title: data.name,
    artists: artistNames(data.artists),
    durationMs: typeof ms === "number" ? ms : null,
    explicit: data.contentRating?.label === "EXPLICIT",
    // Playlist items carry their album's cover; album items don't (the album cover is theirs).
    artworkUrl: biggestImage(data.albumOfTrack?.coverArt?.sources),
  };
}

/**
 * Recognises a pathfinder response that holds the list we asked for and turns it
 * into a page of tracks. Returns null for anything else the web player loads.
 */
function parseListPage(json, expectedUri) {
  const data = json?.data;
  if (!data || typeof data !== "object") return null;

  const playlist = data.playlistV2;
  if (playlist && playlist.content && Array.isArray(playlist.content.items)) {
    if (expectedUri && playlist.uri && playlist.uri !== expectedUri) return null;
    const items = playlist.content.items;
    const tracks = items.map((it) => trackFrom(it?.itemV2?.data)).filter(Boolean);
    return {
      kind: "playlist",
      name: typeof playlist.name === "string" ? playlist.name : null,
      owner: playlist.ownerV2?.data?.name ?? null,
      coverUrl: biggestImage(playlist.images?.items?.[0]?.sources),
      total: Number.isFinite(playlist.content.totalCount) ? playlist.content.totalCount : null,
      offset: playlist.content.pagingInfo?.offset ?? null,
      itemCount: items.length,
      tracks,
    };
  }

  const album = data.albumUnion;
  if (album && album.tracksV2 && Array.isArray(album.tracksV2.items)) {
    if (expectedUri && album.uri && album.uri !== expectedUri) return null;
    const items = album.tracksV2.items;
    const tracks = items.map((it) => trackFrom(it?.track ?? it?.itemV2?.data)).filter(Boolean);
    return {
      kind: "album",
      name: typeof album.name === "string" ? album.name : null,
      owner: artistNames(album.artists).join(", ") || null,
      coverUrl: biggestImage(album.coverArt?.sources),
      total: Number.isFinite(album.tracksV2.totalCount) ? album.tracksV2.totalCount : null,
      offset: null,
      itemCount: items.length,
      tracks,
    };
  }
  return null;
}

/** Plain-language reason for a pathfinder error payload, if there is one. */
function pathfinderProblem(json) {
  const p = json?.data?.playlistV2 ?? json?.data?.albumUnion;
  if (p?.__typename === "NotFound") return "Spotify says this list doesn't exist or isn't public";
  if (Array.isArray(json?.errors) && json.errors.length) return `Spotify returned an error: ${String(json.errors[0]?.message ?? "unknown").slice(0, 120)}`;
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pages through the rest of a list by replaying the captured request.
 * `fetchImpl` is injectable so this can run under plain Node in tests.
 */
async function collectRemaining({ captured, first, expectedUri, fetchImpl, deadline, log = () => {} }) {
  const tracks = [...first.tracks];
  const total = first.total;
  const limit = PAGE_LIMIT[first.kind] ?? 100;
  let offset = (first.offset ?? 0) + first.itemCount;
  let stopReason = null;

  while (total != null && offset < total) {
    if (Date.now() > deadline) {
      stopReason = "it took too long";
      break;
    }
    await sleep(PAGE_DELAY_MS);
    const req = buildPageRequest(captured, offset, limit);
    let json;
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
      if (res.status === 401 || res.status === 403) {
        stopReason = "Spotify's anonymous session expired";
        break;
      }
      if (!res.ok) {
        stopReason = `Spotify answered ${res.status}`;
        break;
      }
      json = await res.json();
    } catch (err) {
      stopReason = `a request failed (${err.message})`;
      break;
    }
    const page = parseListPage(json, expectedUri);
    if (!page) {
      stopReason = pathfinderProblem(json) ?? "a page came back in a shape Nightjar doesn't recognise";
      break;
    }
    if (!page.itemCount) break;
    tracks.push(...page.tracks);
    offset += page.itemCount;
  }
  if (stopReason) log(`stopped at ${offset}/${total}: ${stopReason}`);
  return { tracks, stopReason, reached: offset };
}

/**
 * Opens the public page in a hidden, throwaway browser session and waits for
 * Spotify's web player to fetch the first page of the list. Resolves with the
 * captured request and the parsed first page. Always closes the window.
 */
function captureFirstPage(ref, { timeoutMs = 25000, log = () => {} } = {}) {
  // Required lazily so the pure functions above load under plain Node.
  const { BrowserWindow } = require("electron");
  const expectedUri = `spotify:${ref.kind}:${ref.id}`;
  const partition = `nightjar-spotify-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition, // no "persist:" prefix, so cookies and storage live in memory only
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    const dbg = wc.debugger;
    const requests = new Map();
    const extraHeaders = new Map();
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (dbg.isAttached()) dbg.detach();
      } catch {
        // Already gone with the window.
      }
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("the Spotify page didn't load the track list in time")), timeoutMs);

    wc.setAudioMuted(true);
    wc.setUserAgent(UA);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, url) => {
      if (!/^https:\/\/open\.spotify\.com\//.test(url)) event.preventDefault();
    });
    wc.on("render-process-gone", () => finish(new Error("the hidden Spotify page crashed")));

    dbg.on("detach", () => finish(new Error("lost the DevTools connection to the Spotify page")));
    dbg.on("message", async (_event, method, params) => {
      if (settled) return;
      if (method === "Network.requestWillBeSent") {
        const { url, method: verb, headers, postData } = params.request;
        if (isPathfinderUrl(url) && verb !== "OPTIONS") requests.set(params.requestId, { url, method: verb, headers, postData });
      } else if (method === "Network.requestWillBeSentExtraInfo") {
        // Carries the headers as actually sent; can arrive before or after requestWillBeSent.
        extraHeaders.set(params.requestId, params.headers);
      } else if (method === "Network.loadingFinished" && requests.has(params.requestId)) {
        const request = requests.get(params.requestId);
        requests.delete(params.requestId);
        let json;
        try {
          const { body, base64Encoded } = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
          json = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
        } catch {
          return;
        }
        if (settled) return;
        const parsedReq = parsePathfinderRequest(request);
        if (parsedReq?.variables?.uri && parsedReq.variables.uri !== expectedUri) return;
        const first = parseListPage(json, expectedUri);
        if (!first) {
          const problem = parsedReq?.variables?.uri === expectedUri ? pathfinderProblem(json) : null;
          if (problem) finish(new Error(problem));
          return;
        }
        const captured = { ...request, headers: { ...request.headers, ...(extraHeaders.get(params.requestId) ?? {}) } };
        log(`captured ${parsedReq?.operationName ?? "query"}: ${first.tracks.length} of ${first.total ?? "?"} tracks`);
        finish(null, { captured, first });
      }
    });

    try {
      dbg.attach("1.3");
    } catch (err) {
      finish(new Error(`couldn't attach DevTools: ${err.message}`));
      return;
    }
    // Don't wait for Network.enable before navigating: on a blank webContents it
    // only resolves once a navigation starts. CDP still applies it first.
    dbg.sendCommand("Network.enable").catch((err) => finish(new Error(`couldn't watch the Spotify page (${err.message})`)));
    wc.loadURL(`https://open.spotify.com/${ref.kind}/${ref.id}`).catch((err) => {
      // loadURL rejects on aborted sub-navigations too; only a real failure matters here.
      if (!settled && !/ERR_ABORTED/.test(String(err.message))) finish(new Error(`couldn't open the Spotify page (${err.message})`));
    });
  });
}

/**
 * Full list via the hidden page. Throws only if nothing at all could be read;
 * a partial result comes back with `truncated: true` and a notice.
 */
async function fetchViaPage(ref, { totalTimeoutMs = 45000, log = () => {} } = {}) {
  const { session } = require("electron");
  const started = Date.now();
  const deadline = started + totalTimeoutMs;
  const expectedUri = `spotify:${ref.kind}:${ref.id}`;
  const { captured, first } = await captureFirstPage(ref, { timeoutMs: Math.min(25000, totalTimeoutMs), log });

  // A fresh in-memory session for the follow-up requests: same network stack as
  // the hidden window, nothing written to disk.
  const ses = session.fromPartition(`nightjar-spotify-replay-${Math.random().toString(36).slice(2)}`);
  const fetchImpl = (url, init) => ses.fetch(url, init);
  try {
    const { tracks, stopReason } = await collectRemaining({ captured, first, expectedUri, fetchImpl, deadline, log });
    const truncated = first.total != null ? tracks.length < first.total && Boolean(stopReason) : false;
    return {
      kind: first.kind,
      name: first.name,
      owner: first.owner,
      coverUrl: first.coverUrl,
      total: first.total,
      tracks,
      truncated,
      notice: truncated ? `Got ${tracks.length} of ${first.total} tracks before stopping: ${stopReason}.` : null,
    };
  } finally {
    void ses.clearStorageData().catch(() => {});
  }
}

module.exports = {
  isPathfinderUrl,
  parsePathfinderRequest,
  replayHeaders,
  buildPageRequest,
  parseListPage,
  pathfinderProblem,
  collectRemaining,
  captureFirstPage,
  fetchViaPage,
};
