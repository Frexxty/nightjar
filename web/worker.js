// Worker for the web player. It answers on nightjar-app.k3s.lat and on the
// old stratus-app.k3s.lat, from the same `npm run build:web` output.
//
// The new host gets the static files as they are. The old host sends people
// to the new one with a 301 that keeps the path and query, except for:
//
// - /spotify-callback: users' Spotify apps list it as a redirect URI, and a
//   sign-in that started on the old host keeps its PKCE verifier in that
//   origin's localStorage. So the app itself is served there and finishes the
//   sign-in on the old host.
// - The files that page needs to boot (/assets/…, icons, sw.js and so on).
// - /__nightjar-handoff: the new host's first visit comes here to copy the
//   old origin's localStorage across (src/lib/originHandoff.ts).
//
// The redirect also sets a short-lived cookie on k3s.lat, so the new host
// knows this browser just came from the old one.

export const OLD_HOST = "stratus-app.k3s.lat";
export const NEW_HOST = "nightjar-app.k3s.lat";
export const HANDOFF_PATH = "/__nightjar-handoff";
export const MOVED_COOKIE = "nightjar-moved";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === OLD_HOST) {
      if (url.pathname === HANDOFF_PATH) return handoffPage();
      if (!servedOnOldHost(url.pathname)) return movedPermanently(url);
    }
    return env.ASSETS.fetch(request);
  },
};

/** Paths the old host still serves instead of redirecting. */
export function servedOnOldHost(pathname) {
  if (pathname === "/spotify-callback" || pathname === "/spotify-callback/") return true;
  // Static files the callback page loads. Pages (no extension, or .html) move.
  return /\.[a-z0-9]+$/i.test(pathname) && !/\.html?$/i.test(pathname);
}

export function movedPermanently(url) {
  const headers = new Headers({
    Location: `https://${NEW_HOST}${url.pathname}${url.search}`,
    "Cache-Control": "public, max-age=3600",
  });
  headers.append("Set-Cookie", `${MOVED_COOKIE}=1; Domain=k3s.lat; Path=/; Max-Age=600; Secure; SameSite=Lax`);
  return new Response(null, { status: 301, headers });
}

// Runs on the old origin, where the old localStorage is readable. It packs
// the app's keys into window.name, which survives a top-level navigation
// between two hosts of the same site (k3s.lat), and goes back to the new
// host. Only a return address on the new host is followed.
function handoffPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Nightjar</title>
<style>html { background: #101012; color-scheme: dark; }</style>
</head>
<body>
<script>
(() => {
  const home = "https://${NEW_HOST}/";
  let target = home;
  try {
    const back = new URL(new URLSearchParams(location.search).get("return") || home);
    if (back.origin === "https://${NEW_HOST}") target = back.href;
  } catch {}
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("stratus.")) data[key] = localStorage.getItem(key);
    }
  } catch {}
  window.name = "nightjar-handoff:" + JSON.stringify(data);
  location.replace(target);
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
