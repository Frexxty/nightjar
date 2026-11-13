<script setup lang="ts">
import { ref, watch } from "vue";
import { AudioLines, User } from "lucide-vue-next";

const props = withDefaults(defineProps<{ src: string | null | undefined; size?: number | string; round?: boolean; radius?: number }>(), {
  size: "100%",
  round: false,
  radius: 8,
});

const failed = ref(false);
watch(() => props.src, () => (failed.value = false));
</script>

<template>
  <div
    class="artwork"
    :class="{ round }"
    :style="{
      width: typeof size === 'number' ? `${size}px` : size,
      height: typeof size === 'number' ? `${size}px` : undefined,
      borderRadius: round ? '50%' : `${radius}px`,
    }"
  >
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" decoding="async" @error="failed = true" />
    <User v-else-if="round" class="placeholder" />
    <AudioLines v-else class="placeholder" />
  </div>
</template>

<style scoped>
.artwork {
  position: relative;
  flex: none;
  aspect-ratio: 1;
  overflow: hidden;
  background: linear-gradient(135deg, var(--active), var(--hover));
  box-shadow: inset 0 0 0 1px var(--border);
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.placeholder {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 36%;
  height: 36%;
  color: var(--text-3);
}
</style>
