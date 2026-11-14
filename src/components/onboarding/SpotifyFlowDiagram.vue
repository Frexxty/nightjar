<script setup lang="ts">
import { ArrowRight, Play } from "lucide-vue-next";
import AppMark from "./AppMark.vue";
import DiagramFrame from "./DiagramFrame.vue";

/** Spotify as the source: every song in a Spotify playlist arrives in the app and plays. */
const rows = [
  { top: 34, mix: "90%" },
  { top: 56, mix: "60%" },
  { top: 78, mix: "75%" },
  { top: 100, mix: "45%" },
];
</script>

<template>
  <DiagramFrame label="Diagram: every song in your Spotify playlist moves into the app and plays with Spotify's own audio.">
    <div class="dg-stage stage">
      <div class="dg-panel side left">
        <span class="dg-label head"><span class="dg-dot" style="--c: var(--dg-spotify)" />Spotify</span>
      </div>
      <div v-for="(r, i) in rows" :key="`src-${i}`" class="dg-row src" :style="{ top: `${r.top}px`, '--c': `color-mix(in srgb, var(--dg-spotify) ${r.mix}, var(--text-3))` }">
        <span class="dg-art" /><span class="dg-lines" />
      </div>

      <ArrowRight class="arrow" :size="18" :stroke-width="2.2" />

      <div class="dg-panel side right">
        <span class="head app-head"><span class="dg-chrome"><i /><i /><i /></span><AppMark class="mark" /></span>
      </div>

      <!-- In flight, then landed as a playable row. -->
      <div
        v-for="(r, i) in rows"
        :key="`fly-${i}`"
        class="dg-card fly"
        :style="{ top: `${r.top - 3}px`, '--i': i, '--c': `color-mix(in srgb, var(--dg-spotify) ${r.mix}, var(--text-3))` }"
      >
        <span class="dg-art" /><span class="dg-lines" />
      </div>
      <div
        v-for="(r, i) in rows"
        :key="`dst-${i}`"
        class="dg-card dst"
        :style="{ top: `${r.top - 3}px`, '--i': i, '--c': `color-mix(in srgb, var(--dg-spotify) ${r.mix}, var(--text-3))` }"
      >
        <span class="dg-art" /><span class="dg-lines" />
        <span class="play"><Play :size="7" fill="currentColor" :stroke-width="0" /><span class="pulse" /></span>
      </div>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.stage { width: 296px; height: 124px; }
.side { top: 0; width: 116px; height: 124px; }
.left { left: 0; }
.right { left: 180px; }
.head { position: absolute; top: 11px; left: 10px; }
.app-head { display: flex; align-items: center; gap: 7px; }
.mark { height: 9px; }
.src { left: 10px; width: 96px; }
.arrow { position: absolute; left: 139px; top: 61px; color: var(--text-3); }

.dg-card { left: 6px; width: 104px; }
.dst { left: 186px; }
.play {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
}
.play svg { margin-left: 1px; }
.pulse { position: absolute; inset: -1px; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--accent); opacity: 0; }

/* One 5.2 s loop; each row starts 0.35 s after the one above. Base styles are the still frame. */
.fly { opacity: 0; animation: fly 5.2s var(--dg-ease) calc(var(--i) * 0.35s) infinite both; }
.dst { animation: land 5.2s linear calc(var(--i) * 0.35s) infinite both; }
.pulse { animation: pulse 5.2s ease-out calc(var(--i) * 0.35s) infinite both; }

@keyframes fly {
  0% { opacity: 0; transform: translateX(0); }
  4% { opacity: 1; transform: translateX(0); }
  21% { opacity: 1; transform: translateX(180px); }
  23%, 100% { opacity: 0; transform: translateX(180px); }
}
@keyframes land {
  0%, 20% { opacity: 0; }
  22%, 86% { opacity: 1; }
  94%, 100% { opacity: 0; }
}
@keyframes pulse {
  0%, 22% { opacity: 0; transform: scale(0.8); }
  24% { opacity: 0.9; transform: scale(1); }
  38%, 100% { opacity: 0; transform: scale(2.1); }
}
</style>
