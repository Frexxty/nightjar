<script setup lang="ts">
import { computed, ref } from "vue";
import { Play, Shuffle } from "lucide-vue-next";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import TrackTable from "@/components/TrackTable.vue";
import { usePaged } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { sourceCatalogue } from "@/spotify/catalogue";

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const filter = ref("");
const spotifySource = computed(() => settings.musicSource === "spotify");
const { items, next, more, loading, loadingMore, error, needsAuth, needsSpotify, reload } = usePaged((_b, cursor) => sourceCatalogue().likedTracks(cursor));

// Hide tracks unliked during this visit without refetching.
const shown = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return items.value.filter((t) => library.isLiked(t) && (!needle || `${t.title} ${t.user.username}`.toLowerCase().includes(needle)));
});

function play(shuffle: boolean) {
  const list = shown.value;
  player.playTracks(list, shuffle ? Math.floor(Math.random() * list.length) : 0, "likes");
  if (shuffle) player.toggleShuffle();
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">{{ spotifySource ? "Liked Songs" : "Likes" }}</h1>
      <div v-if="spotifySource ? !needsSpotify : !(library.accounts && library.signedOut)" class="actions">
        <input v-model="filter" type="search" placeholder="Filter likes" />
        <button class="btn primary" :disabled="!shown.length" @click="play(false)"><Play :size="15" fill="currentColor" /> Play</button>
        <button class="btn" :disabled="!shown.length" @click="play(true)"><Shuffle :size="15" /> Shuffle</button>
      </div>
    </div>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!shown.length"
      empty-text="Tracks you like show up here."
      :sign-in-text="spotifySource ? undefined : 'Sign in to like tracks and keep them in one place, on every device.'"
      :needs-auth="needsAuth && !spotifySource"
      :needs-spotify="needsSpotify"
      @retry="reload"
    >
      <TrackTable :tracks="shown" source="likes" />
      <LoadMore :has-more="!!next" :loading="loadingMore" @more="more" />
    </LoadState>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.head .page-title { margin: 0; }
.actions { display: flex; gap: 8px; }
.actions input { width: 200px; }
@media (max-width: 760px) {
  .head { flex-wrap: wrap; }
  .actions { width: 100%; }
  .actions input { flex: 1; min-width: 0; width: auto; }
}
</style>
