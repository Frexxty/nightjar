<script setup lang="ts">
import { computed } from "vue";
import { Check, CircleCheck, Link2, Save, ScanSearch, Search } from "lucide-vue-next";
import DiagramFrame from "./DiagramFrame.vue";

export type ImportStage = "idle" | "reading" | "matching" | "review" | "saved";

/**
 * Link → read → match (or "ready" for Spotify tracks) → save, with the step
 * the import is on highlighted. Only the current step moves.
 */
const props = defineProps<{
  stage: ImportStage;
  /** Spotify tracks saved as they are: the third step is "Ready", not "Match". */
  direct: boolean;
  /** Stratus is working on the current step (reading, searching), not waiting for you. */
  busy: boolean;
}>();

const steps = computed(() => [
  { icon: Link2, label: "Link" },
  { icon: ScanSearch, label: "Read" },
  props.direct ? { icon: CircleCheck, label: "Ready" } : { icon: Search, label: "Match" },
  { icon: Save, label: "Save" },
]);

const order: Record<ImportStage, number> = { idle: 0, reading: 1, matching: 2, review: 3, saved: 4 };
const current = computed(() => order[props.stage]);

const label = computed(() => {
  const names = steps.value.map((s) => s.label.toLowerCase()).join(", then ");
  const now = steps.value[current.value]?.label.toLowerCase();
  return `Import steps: ${names}. ${now ? `Current step: ${now}.` : "All done."}`;
});
</script>

<template>
  <!-- Moves only while Stratus is working; when it waits for you it holds still. -->
  <DiagramFrame :label="label" :still="!busy" class="flow-frame">
    <ol class="flow-steps">
      <template v-for="(s, i) in steps" :key="i">
        <li v-if="i > 0" class="seg" :class="{ filled: i <= current, into: i === current }" aria-hidden="true">
          <span class="seg-fill" /><span class="seg-dot" />
        </li>
        <li class="node" :class="{ done: i < current, now: i === current }">
          <span class="disc">
            <span class="ring" />
            <component :is="s.icon" v-if="i >= current" :size="16" />
            <Check v-else :size="15" :stroke-width="3" />
          </span>
          <span class="name">{{ s.label }}</span>
        </li>
      </template>
    </ol>
  </DiagramFrame>
</template>

<style scoped>
.flow-frame { width: 100%; max-width: 520px; }
.flow-steps { list-style: none; margin: 0; padding: 0; display: flex; align-items: flex-start; }
.node { flex: none; display: flex; flex-direction: column; align-items: center; gap: 5px; width: 44px; }
.disc {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--hover);
  color: var(--text-3);
}
.node.done .disc { background: var(--accent-soft); color: var(--accent); }
.node.now .disc { background: var(--accent); color: var(--accent-text); }
.ring { position: absolute; inset: -4px; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--accent); opacity: 0; }
.name { font-size: 11px; font-weight: 650; color: var(--text-3); white-space: nowrap; }
.node.done .name { color: var(--text-2); }
.node.now .name { color: var(--text); }

.seg { position: relative; flex: 1; min-width: 16px; height: 3px; margin: 15.5px 4px 0; border-radius: 2px; background: var(--hover); overflow: hidden; }
.seg-fill { position: absolute; inset: 0; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform 0.45s var(--dg-ease); }
.seg.filled .seg-fill { transform: scaleX(1); }
/* A dot running along the segment into the current step. The wrapper is the segment's width, so % moves work. */
.seg-dot { position: absolute; inset: 0; opacity: 0; }
.seg-dot::after { content: ""; position: absolute; right: 0; top: -1px; width: 12px; height: 5px; border-radius: 3px; background: var(--accent-text); opacity: 0.85; }
.seg.into .seg-dot { animation: travel 3s var(--dg-ease) infinite both; }
.node.now .ring { animation: ring 3s ease-out infinite both; }

@keyframes travel {
  0% { opacity: 0; transform: translateX(-100%); }
  10% { opacity: 1; }
  45% { opacity: 1; transform: translateX(0); }
  55%, 100% { opacity: 0; transform: translateX(0); }
}
@keyframes ring {
  0%, 45% { opacity: 0; transform: scale(0.9); }
  50% { opacity: 0.8; transform: scale(0.95); }
  90%, 100% { opacity: 0; transform: scale(1.3); }
}
</style>
