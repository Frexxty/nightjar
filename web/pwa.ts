// Vite plugin for the web build (`vite build --mode web`). It adds what makes
// the player installable: the manifest, home-screen icons, the iOS meta tags,
// the service worker with this build's file list, and the Cloudflare _headers
// file. The Electron build doesn't load this plugin.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const THEME = "#101012";

const manifest = {
  id: "/",
  name: "Nightjar",
  short_name: "Nightjar",
  description: "A SoundCloud player modelled on Cider.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: THEME,
  theme_color: THEME,
  categories: ["music"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const ICONS = ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"];

// Hashed assets never change. Everything that names them must be revalidated.
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache
  Content-Type: application/manifest+json

/icons/*
  Cache-Control: public, max-age=86400
`;

export function pwa(): Plugin {
  return {
    name: "nightjar-pwa",
    apply: "build",
    enforce: "post",
    transformIndexHtml() {
      return [
        { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: "Nightjar" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }, injectTo: "head" },
      ];
    },
    generateBundle(_, bundle) {
      const emit = (fileName: string, source: string | Uint8Array) => this.emitFile({ type: "asset", fileName, source });

      emit("manifest.webmanifest", `${JSON.stringify(manifest, null, 2)}\n`);
      for (const name of ICONS) emit(`icons/${name}`, readFileSync(here(`./icons/${name}`)));
      emit("_headers", HEADERS);

      // Everything the app needs to boot offline: the bundle, public/ (favicons) and the icons.
      // The build id changes whenever any of it does, which is what makes browsers install a new worker.
      // "/" rather than "/index.html": Cloudflare redirects the latter, and a redirected
      // response can't answer a navigation.
      const files = new Set<string>(["/", "/manifest.webmanifest"]);
      const hash = createHash("sha256");
      for (const [name, file] of Object.entries(bundle)) {
        if (name === "_headers" || name === "index.html") continue; // _headers is read by Cloudflare, not served
        files.add(`/${name}`);
        hash.update(name).update(file.type === "chunk" ? file.code : file.source);
      }
      for (const name of readdirSync(here("../public"))) if (!name.startsWith(".")) files.add(`/${name}`);
      for (const name of ICONS) files.add(`/icons/${name}`);
      const precache = [...files].sort();
      const build = hash.update(precache.join("\n")).digest("hex").slice(0, 12);

      const sw = readFileSync(here("./sw.js"), "utf8")
        .replace('"__BUILD__"', JSON.stringify(build))
        .replace('["__PRECACHE__"]', JSON.stringify(precache));
      emit("sw.js", sw);
    },
  };
}
