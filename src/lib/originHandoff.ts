// Web build: the one-time hop that brings localStorage over from the old
// web player origin (see handoff.ts). main.ts imports this before anything
// else, so the stores read the copied values when they load.
import {
  appKeys, applyHandoff, BEFORE_KEY, DONE_KEY, handoffUrl, MOVED_COOKIE, readHandoff, shouldHop, WINDOW_NAME_PREFIX,
} from "./handoff";

/** True while the page is on its way to the old origin; main.ts doesn't start the app then. */
export let handingOff = false;

function run() {
  if (import.meta.env.VITE_TARGET !== "web" || window.nightjar) return;
  let store: Storage;
  try {
    store = localStorage;
    store.getItem(DONE_KEY);
  } catch {
    return; // No storage, nothing to move.
  }

  if (window.name.startsWith(WINDOW_NAME_PREFIX)) {
    const data = readHandoff(window.name);
    window.name = "";
    let before: string[] = [];
    try {
      before = JSON.parse(sessionStorage.getItem(BEFORE_KEY) ?? "[]");
      sessionStorage.removeItem(BEFORE_KEY);
    } catch {
      // Treat everything as new.
    }
    const written = data ? applyHandoff(store, data, before) : [];
    store.setItem(DONE_KEY, String(Date.now()));
    document.cookie = `${MOVED_COOKIE}=; Domain=k3s.lat; Path=/; Max-Age=0; Secure; SameSite=Lax`;
    if (written.length) console.info(`Moved ${written.length} saved items from the old Stratus address`);
    return;
  }

  if (!shouldHop({ origin: location.origin, pathname: location.pathname, cookie: document.cookie, store })) return;
  try {
    sessionStorage.setItem(BEFORE_KEY, JSON.stringify(appKeys(store)));
  } catch {
    // Without it, keys already here may be overwritten by the old ones. Fine for a first visit.
  }
  // Mark it first: whatever happens on the way, this only runs once.
  store.setItem(DONE_KEY, "pending");
  handingOff = true;
  location.replace(handoffUrl(location.href));
}

run();
