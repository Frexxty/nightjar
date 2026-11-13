import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { installLongPress } from "./lib/longpress";
import { registerServiceWorker } from "./lib/pwa";
import { router } from "./router";
import "./styles/main.css";

document.documentElement.dataset.platform = window.stratus?.platform ?? "web";

installLongPress();
registerServiceWorker();

createApp(App).use(createPinia()).use(router).mount("#app");
