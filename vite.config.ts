import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { pwa } from "./web/pwa";

// `--mode web` (npm run build:web) builds the installable web player into
// dist-web/ and reads .env.web. Everything else is the Electron renderer.
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    base: web ? "/" : "./",
    plugins: [vue(), ...(web ? [pwa()] : [])],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: { outDir: web ? "dist-web" : "dist", emptyOutDir: true, chunkSizeWarningLimit: 700 },
  };
});
