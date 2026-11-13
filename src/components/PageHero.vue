<script setup lang="ts">
// Header for detail pages: blurred artwork wash behind the cover, title and actions.
import Artwork from "./Artwork.vue";

defineProps<{ art: string | null | undefined; round?: boolean; eyebrow?: string; title: string }>();
</script>

<template>
  <header class="hero">
    <div class="wash" :style="art ? { backgroundImage: `url(${JSON.stringify(art)})` } : undefined" />
    <div class="inner">
      <Artwork :src="art" :round="round" :radius="12" :size="220" class="cover" />
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
</style>
