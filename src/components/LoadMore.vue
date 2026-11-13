<script setup lang="ts">
// Loads the next page when scrolled into view, with a button as a fallback.
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ hasMore: boolean; loading: boolean; doneText?: string }>();
const emit = defineEmits<{ more: [] }>();
const el = ref<HTMLDivElement>();
let observer: IntersectionObserver | undefined;

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && props.hasMore && !props.loading) emit("more");
  }, { rootMargin: "600px" });
  observer.observe(el.value!);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="el" class="more">
    <button v-if="hasMore" class="btn" :disabled="loading" @click="emit('more')">{{ loading ? "Loading…" : "Load more" }}</button>
    <span v-else-if="doneText" class="faint">{{ doneText }}</span>
  </div>
</template>

<style scoped>
.more { display: flex; justify-content: center; padding: 28px 0; }
</style>
