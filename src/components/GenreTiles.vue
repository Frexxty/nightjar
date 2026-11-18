<script setup lang="ts">
// Genre and mood tiles for Browse, or a row of chips (`chips`) for the empty Search page.
import { computed } from "vue";
import { GENRES } from "@/lib/genres";

const props = defineProps<{ chips?: boolean; exclude?: string }>();
const genres = computed(() => GENRES.filter((g) => !g.mood && g.id !== props.exclude));
const moods = computed(() => GENRES.filter((g) => g.mood && g.id !== props.exclude));
const style = (hue: number) => ({ "--h": String(hue) });
</script>

<template>
  <div v-if="chips" class="chips">
    <RouterLink v-for="g in [...genres, ...moods]" :key="g.id" :to="`/browse/${g.id}`" class="chip" :style="style(g.hue)">{{ g.label }}</RouterLink>
  </div>
  <template v-else>
    <h2 class="section-title">Genres</h2>
    <div class="tiles">
      <RouterLink v-for="g in genres" :key="g.id" :to="`/browse/${g.id}`" class="tile" :style="style(g.hue)">{{ g.label }}</RouterLink>
    </div>
    <h2 class="section-title">Moods</h2>
    <div class="tiles">
      <RouterLink v-for="g in moods" :key="g.id" :to="`/browse/${g.id}`" class="tile" :style="style(g.hue)">{{ g.label }}</RouterLink>
    </div>
  </template>
</template>

<style scoped>
.section-title { margin-bottom: 12px; }
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
  margin-bottom: 32px;
}
.tile {
  position: relative;
  display: flex;
  align-items: flex-end;
  aspect-ratio: 16 / 9;
  padding: 12px 14px;
  border-radius: var(--radius);
  overflow: hidden;
  background: linear-gradient(135deg, hsl(var(--h) 62% 46%), hsl(calc(var(--h) + 34) 58% 26%));
  color: #fff;
  font-size: 17px;
  font-weight: 750;
  letter-spacing: -0.01em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: transform 0.15s ease, filter 0.15s;
}
.tile:hover { text-decoration: none; filter: brightness(1.08); }
.tile:active { transform: scale(0.98); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 7px 14px;
  border-radius: 999px;
  background: hsl(var(--h) 55% 45% / 0.18);
  box-shadow: inset 0 0 0 1px hsl(var(--h) 60% 55% / 0.35);
  font-weight: 600;
  font-size: 13.5px;
}
.chip:hover { text-decoration: none; background: hsl(var(--h) 55% 45% / 0.3); }
@media (max-width: 760px) {
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tile { font-size: 16px; }
  .chip { padding: 9px 15px; font-size: 14.5px; }
}
</style>
