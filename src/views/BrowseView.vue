<script setup lang="ts">
import { computed } from "vue";
import GenreTiles from "@/components/GenreTiles.vue";
import { useSettings } from "@/stores/settings";

const settings = useSettings();
const from = computed(() => (settings.musicSource === "spotify" ? "Spotify" : "SoundCloud"));
</script>

<template>
  <div class="page">
    <h1 class="page-title">Browse</h1>
    <p class="muted intro">What's playing on {{ from }} by genre and mood.</p>
    <GenreTiles />
  </div>
</template>

<style scoped>
.page-title { margin-bottom: 4px; }
.intro { margin: 0 0 24px; }
</style>
