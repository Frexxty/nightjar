<script setup lang="ts">
import { CloudOff } from "lucide-vue-next";

defineProps<{ loading: boolean; error: string | null; empty?: boolean; emptyText?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="error" class="empty">
    <CloudOff :size="34" />
    <div>Couldn't load this.</div>
    <code class="faint">{{ error }}</code>
    <button class="btn" @click="$emit('retry')">Try again</button>
  </div>
  <div v-else-if="loading" class="loading">
    <slot name="skeleton">
      <div v-for="i in 6" :key="i" class="skeleton line" :style="{ width: `${90 - i * 7}%` }" />
    </slot>
  </div>
  <div v-else-if="empty" class="empty">{{ emptyText ?? "Nothing here yet." }}</div>
  <slot v-else />
</template>

<style scoped>
.loading { display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }
.line { height: 40px; }
code { font-size: 11.5px; max-width: 520px; user-select: text; }
</style>
