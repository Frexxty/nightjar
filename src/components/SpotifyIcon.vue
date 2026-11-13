<script setup lang="ts">
// Spotify's mark, for "this comes from Spotify" labels. Drawn in currentColor.
withDefaults(defineProps<{ size?: number }>(), { size: 14 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1 .25c-2.85-1.74-6.43-2.13-10.66-1.17a.75.75 0 1 1-.33-1.46c4.62-1.06 8.6-.6 11.75 1.33.36.22.47.69.25 1.05Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.26-2-8.23-2.59-12.09-1.42a.94.94 0 0 1-.54-1.8c4.4-1.33 9.88-.68 13.6 1.62.44.27.58.85.31 1.29Zm.13-3.4C15.2 8.3 8.77 8.08 5.05 9.21a1.12 1.12 0 1 1-.65-2.15c4.27-1.3 11.36-1.05 15.84 1.6a1.12 1.12 0 0 1-1.14 1.97Z"
    />
  </svg>
</template>
