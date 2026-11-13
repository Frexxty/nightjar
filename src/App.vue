<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api";
import AppChrome from "@/components/AppChrome.vue";
import AppDrawer from "@/components/AppDrawer.vue";
import AppSidebar from "@/components/AppSidebar.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import ImmersivePlayer from "@/components/ImmersivePlayer.vue";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const router = useRouter();
const route = useRoute();
const content = ref<HTMLElement>();

// Theme and accent.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(dark.matches);
dark.addEventListener("change", (e) => (systemDark.value = e.matches));
watchEffect(() => {
  const theme = settings.theme === "system" ? (systemDark.value ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  window.stratus?.window("set-theme", settings.theme);
});

watch(api, () => void library.refresh(), { immediate: true });
watch(() => route.fullPath, () => content.value?.scrollTo({ top: 0 }));

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
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  offCommand?.();
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="app">
    <AppSidebar />
    <div class="column">
      <AppChrome />
      <div class="panel">
        <main ref="content" class="content">
          <RouterView v-slot="{ Component }">
            <Transition name="fade" mode="out-in">
              <component :is="Component" :key="route.fullPath" />
            </Transition>
          </RouterView>
        </main>
        <AppDrawer />
      </div>
    </div>

    <Transition name="immersive">
      <ImmersivePlayer v-if="ui.immersive" />
    </Transition>
    <ContextMenu />
    <Transition name="toast">
      <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
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
  bottom: 24px;
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
</style>
