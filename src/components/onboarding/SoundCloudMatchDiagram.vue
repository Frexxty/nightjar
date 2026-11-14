<script setup lang="ts">
import { Check, Search } from "lucide-vue-next";
import DiagramFrame from "./DiagramFrame.vue";

/** SoundCloud as the source: songs from a Spotify playlist are looked up on SoundCloud and most aren't there. */
const rows = [
  { top: 30, mix: "90%", found: true },
  { top: 48, mix: "60%", found: false },
  { top: 66, mix: "75%", found: false },
  { top: 84, mix: "45%", found: true },
  { top: 102, mix: "65%", found: false },
];
const found = rows.filter((r) => r.found).length;
const art = (mix: string) => `color-mix(in srgb, var(--dg-spotify) ${mix}, var(--text-3))`;
</script>

<template>
  <DiagramFrame
    :label="`Diagram: songs from a Spotify playlist are searched on SoundCloud. Only ${found} of ${rows.length} are found; the rest are missing.`"
  >
    <div class="dg-stage stage">
      <div class="dg-panel side left">
        <span class="dg-label head"><span class="dg-dot" style="--c: var(--dg-spotify)" />Spotify</span>
      </div>
      <div v-for="(r, i) in rows" :key="`src-${i}`" class="dg-row src" :style="{ top: `${r.top}px`, '--c': art(r.mix) }">
        <span class="dg-art" /><span class="dg-lines" />
      </div>

      <span class="lens"><Search :size="14" :stroke-width="2.2" /></span>
      <span class="tally">{{ found }}/{{ rows.length }} found</span>

      <div class="dg-panel side right">
        <span class="dg-label head"><span class="dg-dot" style="--c: var(--dg-soundcloud)" />SoundCloud</span>
      </div>

      <template v-for="(r, i) in rows" :key="`res-${i}`">
        <div v-if="r.found" class="dg-card hit" :style="{ top: `${r.top - 2}px`, '--i': i, '--c': 'var(--dg-soundcloud)' }">
          <span class="dg-art" /><span class="dg-lines" />
          <span class="tick"><Check :size="8" :stroke-width="3.5" /></span>
        </div>
        <div v-else class="gap" :style="{ top: `${r.top - 2}px`, '--i': i }" />
        <div class="dg-card fly" :class="{ lost: !r.found }" :style="{ top: `${r.top - 2}px`, '--i': i, '--c': art(r.mix) }">
          <span class="dg-art" /><span class="dg-lines" />
        </div>
      </template>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.stage { width: 296px; height: 124px; }
.side { top: 0; width: 116px; height: 124px; }
.left { left: 0; }
.right { left: 180px; }
.head { position: absolute; top: 10px; left: 10px; }
/* In the gap between the panels, level with the headers, where no song passes. */
.tally {
  position: absolute;
  top: 10px;
  left: 116px;
  width: 64px;
  text-align: center;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--dg-soundcloud);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.src { left: 10px; width: 96px; }
.lens {
  position: absolute;
  left: 134px;
  top: 48px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--hover);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text-2);
}

.dg-card { left: 6px; width: 104px; height: 18px; }
.hit { left: 186px; }
.gap {
  position: absolute;
  left: 186px;
  width: 104px;
  height: 18px;
  border-radius: 6px;
  border: 1.5px dashed var(--text-3);
  opacity: 0.8;
}
.tick {
  flex: none;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dg-soundcloud);
  color: #fff;
}

/* 6 s loop, one row every 0.4 s. Base styles are the still frame: results shown, nothing in flight. */
.fly { opacity: 0; animation: fly 6s var(--dg-ease) calc(var(--i) * 0.4s) infinite both; }
.fly.lost { animation-name: fly-lost; }
.hit, .gap { animation: appear 6s linear calc(var(--i) * 0.4s) infinite both; }
.tick { animation: tick 6s var(--dg-ease) calc(var(--i) * 0.4s) infinite both; }
.lens { animation: scan 6s ease-in-out infinite both; }

@keyframes fly {
  0% { opacity: 0; transform: translateX(0); }
  3% { opacity: 1; transform: translateX(0); }
  18% { opacity: 1; transform: translateX(180px); }
  20%, 100% { opacity: 0; transform: translateX(180px); }
}
/* Not found: it reaches the SoundCloud side and fades away, leaving an empty slot. */
@keyframes fly-lost {
  0% { opacity: 0; transform: translateX(0); }
  3% { opacity: 1; transform: translateX(0); }
  18% { opacity: 1; transform: translateX(180px) scale(1); }
  26%, 100% { opacity: 0; transform: translateX(180px) scale(0.86); }
}
@keyframes appear {
  0%, 17% { opacity: 0; }
  21%, 84% { opacity: 1; }
  92%, 100% { opacity: 0; }
}
@keyframes tick {
  0%, 18% { transform: scale(0); }
  23% { transform: scale(1.25); }
  27%, 100% { transform: scale(1); }
}
@keyframes scan {
  0%, 52%, 100% { transform: rotate(0); }
  10%, 30% { transform: rotate(-14deg); }
  20%, 40% { transform: rotate(14deg); }
}
</style>
