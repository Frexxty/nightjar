// Full-length Spotify lists through Cloudflare Browser Rendering. Same idea as
// electron/spotify-page.cjs: load the public page in a headless browser, wait
// for Spotify's web player to request the first page from pathfinder, keep
// that request, then replay it with a growing offset from the Worker.
import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./env.ts";
import {
  UA, collectRemaining, isPathfinderUrl, parseListPage, parsePathfinderRequest, pathfinderProblem,
  type CapturedRequest, type FullList, type ListPage, type SpotifyRef,
} from "./spotify.ts";

const CAPTURE_TIMEOUT_MS = 25000;
const TOTAL_TIMEOUT_MS = 50000;

async function captureFirstPage(env: Env, ref: SpotifyRef, log: (m: string) => void): Promise<{ captured: CapturedRequest; first: ListPage }> {
  const expectedUri = `spotify:${ref.kind}:${ref.id}`;
  const browser = await puppeteer.launch(env.BROWSER as Fetcher, { keep_alive: 60000 });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      // Images and media aren't needed. Stylesheets and fonts are: without them
      // the web player shows "Something went wrong" and never calls pathfinder.
      if (type === "image" || type === "media") void req.abort();
      else void req.continue();
    });

    const result = new Promise<{ captured: CapturedRequest; first: ListPage }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the Spotify page didn't load the track list in time")), CAPTURE_TIMEOUT_MS);
      page.on("response", async (res) => {
        const req = res.request();
        const url = req.url();
        if (!isPathfinderUrl(url) || req.method() === "OPTIONS") return;
        const request: CapturedRequest = { url, method: req.method(), headers: req.headers(), postData: req.postData() ?? null };
        const parsedReq = parsePathfinderRequest(request);
        if (parsedReq?.variables?.uri && parsedReq.variables.uri !== expectedUri) return;
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          return;
        }
        const first = parseListPage(body, expectedUri);
        if (!first) {
          const problem = parsedReq?.variables?.uri === expectedUri ? pathfinderProblem(body) : null;
          if (problem) {
            clearTimeout(timer);
            reject(new Error(problem));
          }
          return;
        }
        clearTimeout(timer);
        log(`captured ${parsedReq?.operationName ?? "query"}: ${first.tracks.length} of ${first.total ?? "?"} tracks`);
        resolve({ captured: request, first });
      });
    });
    await page.goto(`https://open.spotify.com/${ref.kind}/${ref.id}`, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS }).catch(() => {});
    return await result;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Returns null when the account has no Browser Rendering binding. */
export async function fetchViaBrowser(env: Env, ref: SpotifyRef, log: (m: string) => void = () => {}): Promise<FullList | null> {
  if (!env.BROWSER) return null;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const expectedUri = `spotify:${ref.kind}:${ref.id}`;
  const { captured, first } = await captureFirstPage(env, ref, log);
  const { tracks, stopReason } = await collectRemaining({
    captured, first, expectedUri, deadline, log,
    fetchImpl: (url, init) => fetch(url, init),
  });
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
}
