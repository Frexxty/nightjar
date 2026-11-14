<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * Wraps one onboarding diagram: an accessible image whose CSS animations run
 * only while it is on screen and the page is visible. Under
 * prefers-reduced-motion the animations are removed, so every diagram's base
 * styles have to be its meaningful still frame.
 */
const props = defineProps<{
  label: string;
  /** Show the still frame instead of the loop. */
  still?: boolean;
}>();

const root = ref<HTMLElement | null>(null);
const onScreen = ref(false);
const pageHidden = ref(document.hidden);

let observer: IntersectionObserver | null = null;
const onVisibility = () => (pageHidden.value = document.hidden);

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  if (typeof IntersectionObserver === "undefined") {
    onScreen.value = true;
    return;
  }
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) onScreen.value = entry.isIntersecting;
  });
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  observer?.disconnect();
});
</script>

<template>
  <div ref="root" class="dg" :class="{ 'dg-paused': !onScreen || pageHidden, 'dg-still': props.still }" role="img" :aria-label="label">
    <slot />
  </div>
</template>

<style>
/* Not scoped: these rules reach into whichever diagram fills the slot. */
.dg { position: relative; max-width: 100%; color: var(--text-2); }
.dg {
  --dg-spotify: #1ed760;
  --dg-soundcloud: #ff5500;
  --dg-ease: cubic-bezier(0.65, 0, 0.35, 1);
}

/* Shared pieces. Stages have a fixed size so moves can be in px. */
.dg-stage { position: relative; margin: 0 auto; }
.dg-panel {
  position: absolute;
  border-radius: 10px;
  background: var(--hover);
  box-shadow: inset 0 0 0 1px var(--border);
}
.dg-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-2);
  white-space: nowrap;
}
.dg-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--accent)); }
.dg-chrome { display: flex; gap: 3px; }
.dg-chrome i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-3); opacity: 0.7; }
.dg-logo { display: block; color: var(--accent); }
.dg-logo svg { display: block; height: 100%; width: auto; }

/* A song: cover square and two text lines. */
.dg-row { position: absolute; display: flex; align-items: center; gap: 6px; height: 14px; }
.dg-art { flex: none; width: 14px; height: 14px; border-radius: 3px; background: var(--c, var(--accent)); }
.dg-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dg-lines::before,
.dg-lines::after { content: ""; height: 4px; border-radius: 2px; background: var(--text-3); }
.dg-lines::after { width: 60%; height: 3px; opacity: 0.6; }
/* The same song lifted onto a card, as it moves or once it's in the app. */
.dg-card {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 6px 0 3px;
  border-radius: 6px;
  background: var(--raised);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22), inset 0 0 0 1px var(--border);
}

.dg.dg-paused *,
.dg.dg-paused *::before,
.dg.dg-paused *::after { animation-play-state: paused !important; }
.dg.dg-still *,
.dg.dg-still *::before,
.dg.dg-still *::after { animation: none !important; }
@media (prefers-reduced-motion: reduce) {
  .dg *,
  .dg *::before,
  .dg *::after { animation: none !important; }
}
</style>
