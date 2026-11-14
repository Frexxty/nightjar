<script setup lang="ts">
// Header for detail pages: blurred artwork wash behind the cover, title and actions.
import Artwork from "./Artwork.vue";

/** `mosaic`: four covers shown 2x2 in place of `art`, for playlists made of other people's tracks. */
defineProps<{ art: string | null | undefined; mosaic?: string[]; round?: boolean; eyebrow?: string; title: string }>();
</script>

<template>
  <header class="hero">
    <div class="wash" :style="art ? { backgroundImage: `url(${JSON.stringify(art)})` } : undefined" />
    <div class="inner">
      <div v-if="mosaic?.length === 4" class="cover mosaic" aria-hidden="true">
        <img v-for="(src, i) in mosaic" :key="i" :src="src" alt="" decoding="async" />
      </div>
      <Artwork v-else :src="art" :round="round" :radius="12" :size="220" class="cover" />
      <div class="text">
        <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
        <h1>{{ title }}</h1>
        <slot name="meta" />
        <div class="actions"><slot name="actions" /></div>
      </div>
    </div>
    <slot />
  </header>
</template>

<style scoped>
.hero { position: relative; padding: 36px 32px 24px; overflow: hidden; }
.wash {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(70px) saturate(1.5);
  opacity: 0.45;
  mask-image: linear-gradient(#000 30%, transparent);
  pointer-events: none;
}
.inner { position: relative; display: flex; align-items: flex-end; gap: 28px; }
.cover { box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4), inset 0 0 0 1px var(--border); }
.mosaic {
  flex: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  width: 220px;
  height: 220px;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--active);
}
.mosaic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.text { flex: 1; min-width: 0; padding-bottom: 4px; }
.eyebrow { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-2); }
h1 {
  margin: 4px 0 6px;
  font-size: clamp(26px, 3.4vw, 44px);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.05;
  overflow-wrap: anywhere;
  user-select: text;
}
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
/* Phone: cover on top, everything centred under it. */
@media (max-width: 760px) {
  .hero { padding: 12px 16px 20px; }
  .inner { flex-direction: column; align-items: center; gap: 18px; text-align: center; }
  .cover { width: min(58vw, 240px) !important; height: auto !important; }
  .text { width: 100%; padding-bottom: 0; }
  h1 { font-size: 24px; letter-spacing: -0.02em; line-height: 1.15; }
  .actions { justify-content: center; }
}
</style>
