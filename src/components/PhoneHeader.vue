<script setup lang="ts">
// Phone layout: a compact bar with a back button. The page keeps its large
// title; once that scrolls away, its name fades into the bar, like iOS.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft } from "lucide-vue-next";

const props = defineProps<{ scrolled: boolean; content?: HTMLElement }>();
const route = useRoute();
const router = useRouter();

const ROOTS = new Set(["home", "stream", "browse", "search", "library"]);
const LABELS: Record<string, string> = {
  home: "Home", stream: "Stream", browse: "Browse", search: "Search", library: "Library", import: "Import",
  likes: "Likes", playlists: "Playlists", albums: "Albums", following: "Following", history: "History", settings: "Settings",
};

const isRoot = computed(() => ROOTS.has(String(route.name)));
const hasHistory = ref(false);
watch(() => route.fullPath, () => (hasHistory.value = window.history.state?.back != null), { immediate: true });

// Detail pages are named by their heading, read when it scrolls out of view.
const pageTitle = ref("");
watch(() => [props.scrolled, route.fullPath], () => {
  if (props.scrolled) pageTitle.value = props.content?.querySelector("h1")?.textContent?.trim() ?? "";
});
const title = computed(() => LABELS[String(route.name)] ?? pageTitle.value);

function back() {
  if (hasHistory.value) router.back();
  else router.push(route.path.startsWith("/library/") || route.path === "/import" ? "/library" : route.path.startsWith("/browse/") ? "/browse" : "/");
}
</script>

<template>
  <header class="phone-header" :class="{ scrolled }">
    <button v-if="!isRoot" class="back" title="Back" @click="back"><ChevronLeft :size="28" :stroke-width="2.2" /></button>
    <span v-else />
    <div class="title ellipsis">{{ title }}</div>
    <span />
  </header>
</template>

<style scoped>
.phone-header {
  position: relative;
  flex-shrink: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 52px;
  align-items: center;
  height: calc(44px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) max(4px, env(safe-area-inset-right)) 0 max(4px, env(safe-area-inset-left));
  background: var(--window);
  box-shadow: 0 1px 0 transparent;
  transition: box-shadow 0.2s;
}
.phone-header.scrolled { box-shadow: 0 1px 0 var(--border); }
.back {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--accent);
  border-radius: 22px;
}
.back:active { background: var(--hover); }
.title {
  text-align: center;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.2s, transform 0.2s;
}
.scrolled .title { opacity: 1; transform: none; }
</style>
