<script setup lang="ts">
import { computed, watch } from "vue";
import { ListMusic, ListPlus, Pause, Play, Shuffle } from "lucide-vue-next";
import GenreTiles from "@/components/GenreTiles.vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import PageHero from "@/components/PageHero.vue";
import Shelf from "@/components/Shelf.vue";
import TrackTable from "@/components/TrackTable.vue";
import { loadGenre } from "@/lib/browse";
import { genreById } from "@/lib/genres";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { distinctCovers } from "@/spotify/artwork";
import { sourceCatalogue } from "@/spotify/catalogue";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const settings = useSettings();
const ui = useUi();
const genre = computed(() => genreById(props.id));

const { data, loading, error, needsSpotify, reload } = useLoad(() => {
  if (!genre.value) return Promise.reject(new Error("There's no such genre."));
  return loadGenre(sourceCatalogue(), genre.value);
});
watch(() => settings.musicSource, () => void reload());

const tracks = computed(() => data.value?.tracks ?? []);
const covers = computed(() => distinctCovers(tracks.value));
const source = computed(() => `browse:${props.id}`);
const active = computed(() => player.queueSource === source.value && player.playing);
const from = computed(() => {
  switch (data.value?.from) {
    case "chart": return "Trending on SoundCloud";
    case "spotify": return "From Spotify";
    case "search": return "SoundCloud search";
    default: return "";
  }
});

function shuffle() {
  player.playTracks(tracks.value, Math.floor(Math.random() * tracks.value.length), source.value);
  player.toggleShuffle();
}
</script>

<template>
  <div>
    <PageHero
      :art="covers[0] ?? null"
      :mosaic="covers.length === 4 ? covers : undefined"
      :title="genre?.label ?? 'Browse'"
      :eyebrow="genre?.mood ? 'Mood' : 'Genre'"
    >
      <template #meta>
        <div class="muted meta">{{ from }}<template v-if="tracks.length"> · {{ tracks.length }} tracks</template></div>
      </template>
      <template #actions>
        <button class="btn primary" :disabled="!tracks.length" @click="player.playOrToggle(tracks, 0, source)">
          <Pause v-if="active" :size="15" fill="currentColor" />
          <Play v-else :size="15" fill="currentColor" />
          {{ active ? "Pause" : "Play all" }}
        </button>
        <button class="btn" :disabled="!tracks.length" @click="shuffle"><Shuffle :size="15" /> Shuffle</button>
        <button class="btn" :disabled="!tracks.length" @click="player.addToQueue(tracks)"><ListPlus :size="15" /> Add to queue</button>
        <button class="btn" :disabled="!tracks.length" @click="ui.addToPlaylist(tracks)"><ListMusic :size="15" /> Add to playlist</button>
      </template>
    </PageHero>
    <div class="page body">
      <LoadState
        :loading="loading"
        :error="error"
        :needs-spotify="needsSpotify"
        :empty="!tracks.length && !data?.playlists.length"
        :empty-text="`Nothing came up for ${genre?.label ?? 'this'} right now.`"
        @retry="reload"
      >
        <TrackTable v-if="tracks.length" :tracks="tracks" :source="source" numbered />
        <Shelf v-if="data?.playlists.length" :title="`${genre?.label} playlists`" class="playlists">
          <MediaCard v-for="p in data.playlists" :key="p.id" kind="playlist" :item="p" />
        </Shelf>
      </LoadState>
      <section class="more">
        <h2 class="section-title">More to browse</h2>
        <GenreTiles chips :exclude="id" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.meta { margin-top: 6px; font-size: 12.5px; }
.body { padding-top: 8px; }
.playlists { margin-top: 36px; }
.more { margin-top: 12px; }
.more .section-title { margin-bottom: 12px; }
</style>
