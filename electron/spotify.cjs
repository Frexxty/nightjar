// Reads public Spotify playlists and albums for the import page. No account,
// no API key. Two sources:
//
// 1. The embed page (open.spotify.com/embed/...), which ships the list as JSON
//    in __NEXT_DATA__. Fast, but stops at 100 tracks.
// 2. The full web page in a hidden window (spotify-page.cjs), used only when
//    the embed hit its cap or failed.
//
// Everything that doesn't need Electron takes an injectable fetch so the
// module also runs under plain Node.

const page = require("./spotify-page.cjs");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const EMBED_CAP = 100;
const EMBED_TIMEOUT_MS = 15000;

class ImportError extends Error {}

/**
 * Accepts open.spotify.com links (with ?si=, /intl-xx/, /embed/), spotify: URIs
 * and bare playlist IDs. Returns { kind: "playlist" | "album", id }.
 */
function parseSpotifyRef(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new ImportError("Paste a Spotify playlist or album link.");

  const uri = text.match(/^spotify:(playlist|album):([A-Za-z0-9]{22})$/);
  if (uri) return { kind: uri[1], id: uri[2] };
  if (/^spotify:user:[^:]+:playlist:[A-Za-z0-9]{22}$/.test(text)) return { kind: "playlist", id: text.slice(-22) };
  if (/^[A-Za-z0-9]{22}$/.test(text)) return { kind: "playlist", id: text };

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ImportError("That doesn't look like a Spotify link.");
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname) && url.hostname !== "spotify.link") {
    throw new ImportError("That isn't a Spotify link. It should start with https://open.spotify.com/.");
  }
  if (url.hostname === "spotify.link") {
    throw new ImportError("Short spotify.link URLs aren't supported. Open it in a browser and copy the full open.spotify.com address.");
  }
  const m = url.pathname.match(/\/(playlist|album)\/([A-Za-z0-9]{22})(?:\/|$)/);
  if (m) return { kind: m[1], id: m[2] };
  if (/\/(track|artist|show|episode)\//.test(url.pathname)) {
    throw new ImportError("That link is to a single track, artist or podcast. Use a playlist or album link.");
  }
  throw new ImportError("Couldn't find a playlist or album ID in that link.");
}

const biggest = (sources) =>
  [...(Array.isArray(sources) ? sources : [])]
    .filter((s) => s && s.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;

/** Parses the embed page HTML. Throws ImportError with a reason when the list isn't there. */
function parseEmbedHtml(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new ImportError("Spotify's embed page didn't include any data. Spotify may have changed it.");
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new ImportError("Couldn't read the data on Spotify's embed page.");
  }
  const props = data?.props?.pageProps;
  if (props?.status === 404) throw new ImportError("Spotify couldn't find that list. Check the link, and make sure the playlist is public.");
  const entity = props?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new ImportError("Spotify's embed page didn't include a track list. The playlist may be private.");
  }
  const tracks = entity.trackList
    .filter((t) => t && (t.entityType ?? "track") === "track" && t.title)
    .map((t) => ({
      spotifyId: typeof t.uri === "string" && t.uri.startsWith("spotify:track:") ? t.uri.slice(14) : null,
      title: String(t.title),
      // The embed only gives a joined string. Artists with a comma in their
      // name ("Tyler, The Creator") get split; the matcher tolerates that.
      artists: String(t.subtitle ?? "").split(/,\s+/).map((s) => s.trim()).filter(Boolean),
      durationMs: typeof t.duration === "number" ? t.duration : null,
      explicit: Boolean(t.isExplicit),
    }));
  return {
    kind: entity.type === "album" ? "album" : "playlist",
    name: entity.name ?? entity.title ?? "Untitled",
    owner: entity.subtitle ?? null,
    coverUrl: biggest(entity.coverArt?.sources) ?? biggest(entity.visualIdentity?.image),
    tracks,
  };
}

async function fetchEmbed(ref, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`https://open.spotify.com/embed/${ref.kind}/${ref.id}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new ImportError("Spotify took too long to answer. Try again.");
    throw new ImportError(`Couldn't reach Spotify. Check your connection. (${err.message})`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new ImportError("Spotify couldn't find that list. Check the link, and make sure the playlist is public.");
  if (!res.ok) throw new ImportError(`Spotify answered ${res.status}. Try again in a minute.`);
  return parseEmbedHtml(await res.text());
}

/**
 * Fetches a playlist or album. Never throws for a partial result: if the full
 * list can't be read it returns what the embed had with `truncated: true`.
 *
 * deps.fetchImpl  fetch used for the embed (net.fetch in Electron, global fetch elsewhere)
 * deps.fetchFull  optional (ref) => full list; omitted outside Electron
 */
async function fetchSpotifyList(input, { fetchImpl = globalThis.fetch, fetchFull = null, log = () => {} } = {}) {
  const ref = parseSpotifyRef(input);
  const base = { id: ref.id, kind: ref.kind, url: `https://open.spotify.com/${ref.kind}/${ref.id}` };

  let embed = null;
  let embedError = null;
  try {
    embed = await fetchEmbed(ref, fetchImpl);
  } catch (err) {
    embedError = err;
    log(`embed failed: ${err.message}`);
  }

  if (embed && embed.tracks.length < EMBED_CAP) {
    return { ...base, ...embed, total: embed.tracks.length, truncated: false, source: "embed", notice: null };
  }

  if (fetchFull) {
    try {
      const full = await fetchFull(ref);
      // A capture that stopped early can have fewer tracks than the embed did.
      const worseThanEmbed = full.truncated && embed && embed.tracks.length >= full.tracks.length;
      if (worseThanEmbed) log(`page capture stopped at ${full.tracks.length}; keeping the embed's ${embed.tracks.length}`);
      if (full.tracks.length && !worseThanEmbed) {
        return {
          ...base,
          kind: full.kind ?? ref.kind,
          name: full.name ?? embed?.name ?? "Untitled",
          owner: full.owner ?? embed?.owner ?? null,
          coverUrl: full.coverUrl ?? embed?.coverUrl ?? null,
          total: full.total ?? full.tracks.length,
          tracks: full.tracks,
          truncated: full.truncated,
          source: "page",
          notice: full.notice ?? null,
        };
      }
      log("page capture returned no tracks");
    } catch (err) {
      log(`page capture failed: ${err.message}`);
    }
  }

  if (embed) {
    return {
      ...base,
      ...embed,
      total: null,
      truncated: true,
      source: "embed",
      notice: `Spotify only gave the first ${embed.tracks.length} tracks. To import the rest, use "Paste a track list" with a CSV from Exportify.`,
    };
  }
  throw embedError ?? new ImportError("Couldn't read that list from Spotify.");
}

/** Wires the IPC handler. Results are wrapped so the renderer gets clean messages. */
function registerSpotifyIpc(ipcMain) {
  const { net } = require("electron");
  const log = (msg) => console.warn(`[spotify] ${msg}`);
  ipcMain.handle("spotify:fetch", async (_event, input) => {
    try {
      const result = await fetchSpotifyList(input, {
        fetchImpl: (url, init) => net.fetch(url, init),
        fetchFull: (ref) => page.fetchViaPage(ref, { log }),
        log,
      });
      return { ok: true, result };
    } catch (err) {
      if (!(err instanceof ImportError)) log(`unexpected: ${err.stack ?? err}`);
      return { ok: false, error: err instanceof ImportError ? err.message : `Import failed: ${err.message}` };
    }
  });
}

module.exports = { ImportError, parseSpotifyRef, parseEmbedHtml, fetchEmbed, fetchSpotifyList, registerSpotifyIpc, EMBED_CAP };
