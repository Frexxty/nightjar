// First: on the web it may copy saved data over from the old address before any store reads it.
import { handingOff } from "./lib/originHandoff";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { installLongPress } from "./lib/longpress";
import { registerServiceWorker } from "./lib/pwa";
import { router } from "./router";
import { useSpotify } from "./spotify/auth";
// router.ts imports this first so the address is fixed before the router reads it.
import { spotifyCallback } from "./spotify/callback";
import "./styles/main.css";

document.documentElement.dataset.platform = window.nightjar?.platform ?? "web";

// The page is leaving for the old address and will come straight back.
if (!handingOff) start();

function start() {
  installLongPress();
  registerServiceWorker();

  const pinia = createPinia();
  createApp(App).use(pinia).use(router).mount("#app");

  const spotify = useSpotify(pinia);
  if (spotifyCallback) void spotify.completeWebCallback(spotifyCallback);
  else void spotify.init();
}
