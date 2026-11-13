<script setup lang="ts">
import { ref } from "vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";

defineProps<{ title: string; subtitle?: string; to?: string }>();
const row = ref<HTMLDivElement>();

function scroll(direction: 1 | -1) {
  const el = row.value!;
  el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
}
</script>

<template>
  <section class="shelf">
    <header>
      <div>
        <h2 class="section-title">
          <RouterLink v-if="to" :to="to">{{ title }} <ChevronRight :size="16" class="chev" /></RouterLink>
          <template v-else>{{ title }}</template>
        </h2>
        <p v-if="subtitle" class="muted sub">{{ subtitle }}</p>
      </div>
      <div class="nav">
        <button class="icon-btn" title="Scroll left" @click="scroll(-1)"><ChevronLeft :size="18" /></button>
        <button class="icon-btn" title="Scroll right" @click="scroll(1)"><ChevronRight :size="18" /></button>
      </div>
    </header>
    <div ref="row" class="row"><slot /></div>
  </section>
</template>

<style scoped>
.shelf { margin-bottom: 36px; }
header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 12px; }
.sub { margin: 2px 0 0; font-size: 12.5px; }
.chev { vertical-align: -2px; color: var(--text-3); }
.nav { display: flex; gap: 2px; }
.row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: clamp(150px, 15vw, 196px);
  gap: 18px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding-bottom: 4px;
}
.row::-webkit-scrollbar { display: none; }
.row > :deep(*) { scroll-snap-align: start; }
</style>
