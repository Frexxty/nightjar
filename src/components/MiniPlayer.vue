<script setup lang="ts">
// Phone layout: the now-playing strip above the tab bar. Tapping it opens the
// now-playing sheet; the buttons work without opening it.
import { Loader2, Pause, Play, SkipForward } from "lucide-vue-next";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const player = usePlayer();
const ui = useUi();
</script>

<template>
  <Transition name="mini">
    <div v-if="player.current" class="mini" role="button" aria-label="Open Now Playing" @click="ui.immersive = true">
      <Artwork :src="player.current.artworkUrl" :size="42" :radius="7" />
      <div class="meta">
        <div class="t ellipsis">{{ player.current.title }}</div>
        <div class="a ellipsis">{{ player.current.user.username }}</div>
      </div>
      <button class="ctl" :title="player.playing ? 'Pause' : 'Play'" @click.stop="player.toggle()">
        <Loader2 v-if="player.state === 'loading'" class="spin" :size="22" />
        <Pause v-else-if="player.playing" :size="24" fill="currentColor" />
        <Play v-else :size="24" fill="currentColor" />
      </button>
      <button class="ctl" title="Next" @click.stop="player.next()"><SkipForward :size="22" fill="currentColor" /></button>
      <div class="track"><div class="fill" :style="{ transform: `scaleX(${player.progress})` }" /></div>
    </div>
  </Transition>
</template>

<style scoped>
.mini {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--mini-height);
  margin: 0 max(8px, env(safe-area-inset-right)) 6px max(8px, env(safe-area-inset-left));
  padding: 0 4px 0 8px;
  border-radius: 14px;
  overflow: hidden;
  background: color-mix(in srgb, var(--raised) 86%, transparent);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), inset 0 0 0 1px var(--border);
  cursor: pointer;
  transition: transform 0.12s ease-out;
}
.mini:active { transform: scale(0.985); }
.meta { flex: 1; min-width: 0; line-height: 1.25; }
.t { font-size: 14px; font-weight: 600; }
.a { font-size: 12.5px; color: var(--text-2); }
.ctl {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  color: var(--text);
}
.ctl:active { background: var(--hover); }
.track { position: absolute; left: 12px; right: 12px; bottom: 0; height: 2px; border-radius: 1px; background: var(--hover); overflow: hidden; }
.fill { height: 100%; background: var(--accent); transform-origin: left; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.mini-enter-active, .mini-leave-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.32, 0.72, 0, 1); }
.mini-enter-from, .mini-leave-to { opacity: 0; transform: translateY(20px); }
</style>
