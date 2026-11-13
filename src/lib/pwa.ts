// Web build only: service worker registration, the "new version" prompt and
// the iOS "Add to Home Screen" hint. Electron never calls any of this.
import { ref } from "vue";

/** True when the web target was built (`vite build --mode web`). */
export const isWebBuild = import.meta.env.VITE_TARGET === "web";

/** Set when a new service worker is installed and waiting to take over. */
export const updateReady = ref(false);
let waiting: ServiceWorker | null = null;

export function registerServiceWorker() {
  if (!isWebBuild || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (err) {
      console.warn("Service worker registration failed", err);
      return;
    }
    const offer = (sw: ServiceWorker | null) => {
      // Without a controller this is the first install, not an update.
      if (!sw || !navigator.serviceWorker.controller) return;
      waiting = sw;
      updateReady.value = true;
    };
    offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => {
        if (sw.state === "installed") offer(sw);
      });
    });
    // Home-screen apps can stay open for days, so look for updates when they come back.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void reg.update().catch(() => {});
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!waiting || reloading) return;
    reloading = true;
    location.reload();
  });
}

/** Activates the waiting service worker; the page reloads once it takes control. */
export function applyUpdate() {
  if (waiting) waiting.postMessage({ type: "skip-waiting" });
  else location.reload();
}

const HINT_KEY = "stratus.installHint";

/** iOS Safari in a normal tab, where Add to Home Screen is the only way to install. */
export function shouldShowInstallHint() {
  if (!isWebBuild) return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!ios || standalone) return false;
  try {
    return localStorage.getItem(HINT_KEY) !== "dismissed";
  } catch {
    return true;
  }
}

export function dismissInstallHint() {
  try {
    localStorage.setItem(HINT_KEY, "dismissed");
  } catch {
    // The banner just comes back next visit.
  }
}
