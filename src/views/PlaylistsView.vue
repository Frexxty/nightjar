<script setup lang="ts">
import { computed } from "vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import { useLoad } from "@/lib/useLoad";
import { useLocalPlaylists } from "@/stores/localPlaylists";

const props = defineProps<{ albums: boolean }>();
const local = useLocalPlaylists();

const { data, loading, error, reload } = useLoad(async (b) => {
  if (props.albums) return (await b.likedPlaylists()).filter((p) => p.isAlbum);
  const [mine, liked] = await Promise.all([b.myPlaylists(), b.likedPlaylists()]);
  return [...mine, ...liked.filter((p) => !p.isAlbum)];
});

// Playlists saved on this machine (e.g. Spotify imports) come first.
const items = computed(() => [
  ...(props.albums ? [] : local.playlists.map(local.asPlaylist)),
  ...(data.value ?? []),
]);
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ albums ? "Albums" : "Playlists" }}</h1>
    <LoadState
      :loading="loading && !items.length"
      :error="items.length ? null : error"
      :empty="!items.length"
      :empty-text="albums ? 'Albums you like show up here.' : 'Playlists you make, import or like show up here.'"
      @retry="reload"
    >
      <div class="grid">
        <MediaCard v-for="p in items" :key="p.id" kind="playlist" :item="p" />
      </div>
    </LoadState>
  </div>
</template>
