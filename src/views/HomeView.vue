<script setup lang="ts">
import { computed, watch } from "vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import Shelf from "@/components/Shelf.vue";
import TrackTable from "@/components/TrackTable.vue";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useSpotify } from "@/spotify/auth";
import { sourceCatalogue } from "@/spotify/catalogue";

const library = useLibrary();
const settings = useSettings();
const spotify = useSpotify();
const { data: sections, loading, error, needsSpotify, reload } = useLoad(() => sourceCatalogue().home());
watch(() => settings.musicSource, () => void reload());
const name = computed(() => (settings.musicSource === "spotify" ? spotify.profile?.displayName : library.me?.username));

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
});
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ greeting }}{{ name ? `, ${name}` : "" }}</h1>
    <LoadState :loading="loading" :error="error" :needs-spotify="needsSpotify" :empty="!sections?.length" @retry="reload">
      <template #skeleton>
        <div class="skeleton-shelf">
          <div v-for="i in 6" :key="i"><div class="skeleton art" /><div class="skeleton text" /></div>
        </div>
      </template>
      <template v-for="s in sections" :key="s.id">
        <section v-if="s.kind === 'tracks' && s.display === 'list'" class="chart">
          <h2 class="section-title">{{ s.title }}</h2>
          <p v-if="s.subtitle" class="muted sub">{{ s.subtitle }}</p>
          <TrackTable :tracks="s.items" :source="`home:${s.id}`" numbered :show-header="false" />
        </section>
        <Shelf v-else :title="s.title" :subtitle="s.subtitle">
          <template v-if="s.kind === 'tracks'">
            <MediaCard v-for="t in s.items" :key="t.id" kind="track" :item="t" :siblings="s.items" :source="`home:${s.id}`" />
          </template>
          <template v-else-if="s.kind === 'playlists'">
            <MediaCard v-for="p in s.items" :key="p.id" kind="playlist" :item="p" />
          </template>
          <template v-else>
            <MediaCard v-for="u in s.items" :key="u.id" kind="user" :item="u" />
          </template>
        </Shelf>
      </template>
    </LoadState>
  </div>
</template>

<style scoped>
.chart { margin-bottom: 36px; }
.sub { margin: 2px 0 10px; font-size: 12.5px; }
.skeleton-shelf { display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px; }
.skeleton.art { aspect-ratio: 1; border-radius: 10px; }
.skeleton.text { height: 14px; margin-top: 10px; width: 70%; }
</style>
