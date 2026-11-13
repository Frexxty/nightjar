<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api";
import AppChrome from "@/components/AppChrome.vue";
import AppDrawer from "@/components/AppDrawer.vue";
import AppSidebar from "@/components/AppSidebar.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import ImmersivePlayer from "@/components/ImmersivePlayer.vue";
import MiniPlayer from "@/components/MiniPlayer.vue";
import NowPlayingSheet from "@/components/NowPlayingSheet.vue";
import PhoneHeader from "@/components/PhoneHeader.vue";
import TabBar from "@/components/TabBar.vue";
import UpdateDialog from "@/components/UpdateDialog.vue";
import WebPrompts from "@/components/WebPrompts.vue";
import { isWebBuild } from "@/lib/pwa";
import { isPhone } from "@/lib/responsive";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useUpdates } from "@/stores/updates";

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const updates = useUpdates();
const router = useRouter();
const route = useRoute();
const content = ref<HTMLElement>();
// Nothing renders until the first route resolves, so a first run goes
// straight to the welcome page without flashing the sidebar and player.
const routed = ref(false);
void router.isReady().then(() => (routed.value = true));

// Theme and accent.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(dark.matches);
dark.addEventListener("change", (e) => (systemDark.value = e.matches));
watchEffect(() => {
  const theme = settings.theme === "system" ? (systemDark.value ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#ececef" : "#101012");
  window.stratus?.window("set-theme", settings.theme);
});
watchEffect(() => window.stratus?.window("set-tray-on-close", settings.keepPlayingInTray));

watch(api, () => void library.refresh(), { immediate: true });
watch(() => route.fullPath, () => content.value?.scrollTo({ top: 0 }));

// Phone layout: the header shows the page name once its large title scrolls away,
// and pages leave room at the bottom for the mini player and tab bar.
const scrolled = ref(false);
function onScroll() {
  scrolled.value = (content.value?.scrollTop ?? 0) > 44;
}
const dock = computed(() =>
  `calc(var(--tabbar-height) + env(safe-area-inset-bottom)${player.current ? " + var(--mini-height) + 6px" : ""})`,
);

// Menu bar, dock and media-key commands from the main process.
let offCommand: (() => void) | undefined;
function onCommand(command: string, payload?: unknown) {
  switch (command) {
    case "toggle": return player.toggle();
    case "next": return void player.next();
    case "previous": return void player.prev();
    case "like": return player.current && library.toggleLike(player.current);
    case "shuffle": return player.toggleShuffle();
    case "repeat": return player.cycleRepeat();
    case "navigate": return void router.push(String(payload));
    case "back": return router.back();
    case "forward": return router.forward();
    case "focus-search": ui.immersive = false; ui.searchFocus++; return;
    case "toggle-drawer": return ui.toggleDrawer(payload === "comments" ? "comments" : "queue");
    case "immersive": ui.immersive = !ui.immersive; return;
    case "check-updates": return void updates.check();
  }
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.code === "Space") {
    e.preventDefault();
    player.toggle();
  } else if (e.key === "ArrowRight" && !e.metaKey && !e.ctrlKey) player.seek(player.currentTime + 5);
  else if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey) player.seek(player.currentTime - 5);
  else if (!window.stratus && (e.metaKey || e.ctrlKey) && e.key === "f") {
    e.preventDefault();
    ui.searchFocus++;
  }
}

onMounted(() => {
  offCommand = window.stratus?.onCommand(onCommand);
  void updates.init();
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  offCommand?.();
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <!-- First run: the welcome page has the window to itself. -->
  <div v-if="!routed" />
  <div v-else-if="route.meta.bare" class="bare">
    <div class="bare-titlebar drag" />
    <main class="bare-content">
      <RouterView />
    </main>
    <Transition name="toast">
      <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
    </Transition>
  </div>
  <div v-else class="app" :class="{ phone: isPhone }" :style="isPhone ? { '--dock': dock } : undefined">
    <AppSidebar v-if="!isPhone" />
    <div class="column">
      <AppChrome v-if="!isPhone" />
      <PhoneHeader v-else :scrolled="scrolled" :content="content" />
      <div class="panel">
        <main ref="content" class="content" @scroll.passive="onScroll">
          <RouterView v-slot="{ Component }">
            <Transition name="fade" mode="out-in">
              <component :is="Component" :key="route.fullPath" />
            </Transition>
          </RouterView>
        </main>
        <AppDrawer v-if="!isPhone" />
      </div>
      <div v-if="isPhone" class="dock">
        <MiniPlayer />
        <TabBar />
      </div>
    </div>

    <NowPlayingSheet v-if="isPhone" />
    <Transition v-else name="immersive">
      <ImmersivePlayer v-if="ui.immersive" />
    </Transition>
    <ContextMenu />
    <UpdateDialog />
    <WebPrompts v-if="isWebBuild" />
    <Transition name="toast">
      <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.bare { position: relative; height: 100dvh; display: flex; flex-direction: column; background: var(--panel); }
/* Room for the macOS traffic lights and a strip to drag the window by. */
.bare-titlebar { position: absolute; top: 0; left: 0; right: 0; height: 40px; z-index: 1; }
.bare-content { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.app { display: flex; height: 100%; }
.column { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.panel {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: var(--panel);
  border-top-left-radius: var(--radius-lg);
  box-shadow: -1px -1px 0 var(--border);
}
.content { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.14s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.immersive-enter-active, .immersive-leave-active { transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.32, 0.72, 0, 1); }
.immersive-enter-from, .immersive-leave-to { opacity: 0; transform: translateY(3%); }
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--dock, 0px) + 24px);
  transform: translateX(-50%);
  max-width: 70vw;
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--overlay);
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
  font-weight: 550;
  z-index: 200;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }

/* Phone layout: header on top, pages scroll under the floating mini player and the tab bar. */
.phone { height: 100dvh; }
.phone .column { position: relative; }
.phone .panel { border-radius: 0; box-shadow: none; background: var(--window); }
.phone .content { padding-bottom: var(--dock); overscroll-behavior-y: contain; }
.phone .toast { max-width: calc(100vw - 32px); }
.dock { position: absolute; left: 0; right: 0; bottom: 0; z-index: 10; pointer-events: none; }
.dock > * { pointer-events: auto; }
.dock :deep(.tabbar) {
  background: color-mix(in srgb, var(--window) 82%, transparent);
  backdrop-filter: blur(24px) saturate(1.8);
  box-shadow: 0 -1px 0 var(--border);
}
</style>
