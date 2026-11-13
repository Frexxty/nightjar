// Web Spotify sign-in comes back to /spotify-callback?code=…&state=…. This
// module reads that and puts the address back to the app. main.ts imports it
// first: the hash router takes its base from the address when router.ts is
// evaluated, so this has to run before that import.
import { parseCallback, WEB_CALLBACK_PATH, type CallbackResult } from "./pkce";

const PENDING_KEY = "stratus.spotify.pending";

function returnTo(): string {
  try {
    const hash = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null")?.returnTo;
    return typeof hash === "string" && hash.startsWith("#/") ? hash : "#/";
  } catch {
    return "#/";
  }
}

/** The callback's result, or null when this page load isn't a Spotify redirect. */
export const spotifyCallback: CallbackResult | null =
  !window.stratus && location.pathname === WEB_CALLBACK_PATH ? parseCallback(location.search) : null;

// Replacing the entry keeps the code out of the address bar and the back stack.
if (spotifyCallback) history.replaceState(null, "", `/${returnTo()}`);
