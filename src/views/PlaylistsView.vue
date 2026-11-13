<script setup lang="ts">
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import { useLoad } from "@/lib/useLoad";

const props = defineProps<{ albums: boolean }>();

const { data, loading, error, reload } = useLoad(async (b) => {
  if (props.albums) return (await b.likedPlaylists()).filter((p) => p.isAlbum);
  const [mine, liked] = await Promise.all([b.myPlaylists(), b.likedPlaylists()]);
  return [...mine, ...liked.filter((p) => !p.isAlbum)];
});
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ albums ? "Albums" : "Playlists" }}</h1>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!data?.length"
      :empty-text="albums ? 'Albums you like show up here.' : 'Playlists you make or like show up here.'"
      @retry="reload"
    >
      <div class="grid">
        <MediaCard v-for="p in data" :key="p.id" kind="playlist" :item="p" />
      </div>
    </LoadState>
  </div>
</template>
