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

document.documentElement.dataset.platform = window.stratus?.platform ?? "web";

installLongPress();
registerServiceWorker();

const pinia = createPinia();
createApp(App).use(pinia).use(router).mount("#app");

const spotify = useSpotify(pinia);
if (spotifyCallback) void spotify.completeWebCallback(spotifyCallback);
else void spotify.init();
