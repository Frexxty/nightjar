<script setup lang="ts">
// Popover on an import row: choose another SoundCloud candidate, search with
// your own words, or skip the track.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Ban, Check, Search, Undo2 } from "lucide-vue-next";
import { duration } from "@/lib/format";
import { searchQueries, statusOf } from "@/lib/match";
import type { ImportRow } from "@/stores/importSession";
import Artwork from "./Artwork.vue";

const props = defineProps<{ row: ImportRow; anchor: DOMRect }>();
const emit = defineEmits<{ close: []; search: [query: string]; choose: [index: number]; skip: [skipped: boolean] }>();

const query = ref(searchQueries(props.row.source)[0] ?? "");
const panel = ref<HTMLElement>();
const width = 400;

const style = computed(() => {
  const left = Math.max(8, Math.min(props.anchor.right - width, window.innerWidth - width - 8));
  const below = props.anchor.bottom + 6;
  const fitsBelow = below + 380 < window.innerHeight;
  return fitsBelow
    ? { left: `${left}px`, top: `${below}px`, width: `${width}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - props.anchor.top + 6}px`, width: `${width}px` };
});

function onDown(e: MouseEvent) {
  if (panel.value && !panel.value.contains(e.target as Node)) emit("close");
}
const onKey = (e: KeyboardEvent) => e.key === "Escape" && emit("close");
onMounted(() => {
  // Defer so the click that opened the picker doesn't close it.
  setTimeout(() => window.addEventListener("mousedown", onDown));
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDown);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <Teleport to="body">
    <div ref="panel" class="picker" :style="style" role="dialog" aria-label="Choose a SoundCloud match">
      <form class="search" @submit.prevent="emit('search', query)">
        <input v-model="query" type="search" placeholder="Search SoundCloud" spellcheck="false" />
        <button class="btn" type="submit" :disabled="row.state === 'searching'"><Search :size="14" /> Search</button>
      </form>

      <div class="list">
        <div v-if="row.state === 'searching'" class="note faint">Searching…</div>
        <div v-else-if="!row.candidates.length" class="note faint">No results. Try different words.</div>
        <template v-else>
          <button
            v-for="(c, i) in row.candidates"
            :key="c.track.id"
            class="cand"
            :class="{ current: row.pick === c }"
            @click="emit('choose', i)"
          >
            <Artwork :src="c.track.artworkUrl" :size="34" :radius="4" />
            <span class="text">
              <span class="name ellipsis">{{ c.track.title }}</span>
              <span class="by ellipsis">{{ c.track.user.username }} · {{ duration(c.track.duration) }}</span>
            </span>
            <span class="pill" :class="statusOf(c.score)">{{ Math.round(c.score * 100) }}%</span>
            <Check v-if="row.pick === c" :size="15" class="tick" />
          </button>
        </template>
      </div>

      <div class="foot">
        <button v-if="row.skipped" class="btn" @click="emit('skip', false)"><Undo2 :size="14" /> Don't skip</button>
        <button v-else class="btn" @click="emit('skip', true)"><Ban :size="14" /> Skip this track</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.picker {
  position: fixed;
  z-index: 120;
  display: flex;
  flex-direction: column;
  max-height: 380px;
  padding: 8px;
  border-radius: 12px;
  background: var(--overlay);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
  animation: pop 0.12s ease-out;
}
.search { display: flex; gap: 6px; }
.search input { flex: 1; min-width: 0; height: 32px; }
.list { flex: 1; min-height: 0; overflow-y: auto; margin: 8px 0; }
.note { padding: 18px 8px; text-align: center; }
.cand {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px;
  border-radius: 8px;
  text-align: left;
}
.cand:hover { background: var(--hover); }
.cand.current { background: var(--accent-soft); }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.name { font-weight: 600; }
.by { font-size: 12px; color: var(--text-2); }
.tick { color: var(--accent); flex: none; }
.foot { display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 8px; }
.pill { flex: none; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; }
.pill.matched { background: color-mix(in srgb, #30d158 22%, transparent); color: #30d158; }
.pill.check { background: color-mix(in srgb, #ffb340 22%, transparent); color: #ffb340; }
.pill.none { background: var(--hover); color: var(--text-3); }
@keyframes pop { from { opacity: 0; transform: scale(0.97); } }
</style>
