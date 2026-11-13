<script setup lang="ts">
import TrackTable from "@/components/TrackTable.vue";
import { useLibrary } from "@/stores/library";

const library = useLibrary();
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">History</h1>
      <button v-if="library.history.length" class="btn" @click="library.clearHistory()">Clear history</button>
    </div>
    <TrackTable v-if="library.history.length" :tracks="library.history" source="history" />
    <div v-else class="empty">Tracks you play show up here.</div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.head .page-title { margin: 0; }
</style>
