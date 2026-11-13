<script setup lang="ts">
// Phone layout: the sidebar becomes this bar along the bottom.
import { useRoute } from "vue-router";
import { tabs } from "@/lib/nav";

const route = useRoute();
</script>

<template>
  <nav class="tabbar" aria-label="Sections">
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="tab-item"
      :class="{ active: t.match(route.path) }"
      :aria-current="t.match(route.path) ? 'page' : undefined"
    >
      <component :is="t.icon" :size="23" :stroke-width="t.match(route.path) ? 2.3 : 1.8" />
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  display: flex;
  padding: 0 max(4px, env(safe-area-inset-right)) env(safe-area-inset-bottom) max(4px, env(safe-area-inset-left));
}
.tab-item {
  flex: 1;
  min-width: 0;
  height: var(--tabbar-height);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding-top: 2px;
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: color 0.15s;
}
.tab-item:hover { text-decoration: none; }
.tab-item:active svg { transform: scale(0.9); }
.tab-item svg { transition: transform 0.12s ease-out; }
.tab-item.active { color: var(--accent); }
</style>
