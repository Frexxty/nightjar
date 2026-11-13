<script setup lang="ts">
import { computed } from "vue";
import { ListPlus, MoreHorizontal, Pause, Play, Shuffle } from "lucide-vue-next";
import LoadState from "@/components/LoadState.vue";
import PageHero from "@/components/PageHero.vue";
import TrackTable from "@/components/TrackTable.vue";
import { ago, count, longDuration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLoad } from "@/lib/useLoad";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const ui = useUi();
const menus = useMenus();
const { data: playlist, loading, error, reload } = useLoad((b) => b.playlist(props.id));

const source = computed(() => `playlist:${props.id}`);
const tracks = computed(() => playlist.value?.tracks ?? []);
const active = computed(() => player.queueSource === source.value && player.playing);

function shuffle() {
  // playTracks resets shuffle, so toggling afterwards always turns it on.
  player.playTracks(tracks.value, Math.floor(Math.random() * tracks.value.length), source.value);
  player.toggleShuffle();
}
</script>

<template>
  <div>
    <LoadState :loading="loading" :error="error" @retry="reload">
      <template v-if="playlist">
        <PageHero :art="playlist.artworkUrl" :title="playlist.title" :eyebrow="playlist.isAlbum ? 'Album' : 'Playlist'">
          <template #meta>
            <RouterLink :to="`/user/${playlist.user.id}`" class="owner">{{ playlist.user.username }}</RouterLink>
            <div class="muted meta">
              {{ playlist.trackCount }} tracks · {{ longDuration(playlist.duration) }} · {{ count(playlist.likesCount) }} likes · {{ ago(playlist.createdAt) }}
            </div>
            <p v-if="playlist.description" class="muted desc">{{ playlist.description }}</p>
          </template>
          <template #actions>
            <button class="btn primary" :disabled="!tracks.length" @click="player.playOrToggle(tracks, 0, source)">
              <Pause v-if="active" :size="15" fill="currentColor" />
              <Play v-else :size="15" fill="currentColor" />
              {{ active ? "Pause" : "Play" }}
            </button>
            <button class="btn" :disabled="!tracks.length" @click="shuffle"><Shuffle :size="15" /> Shuffle</button>
            <button class="btn" :disabled="!tracks.length" @click="player.addToQueue(tracks)"><ListPlus :size="15" /> Add to queue</button>
            <button class="icon-btn" title="More" @click="ui.openMenu($event, menus.playlist(playlist))"><MoreHorizontal :size="18" /></button>
          </template>
        </PageHero>
        <div class="page">
          <TrackTable :tracks="tracks" :source="source" :numbered="true" :show-artwork="!playlist.isAlbum" />
        </div>
      </template>
    </LoadState>
  </div>
</template>

<style scoped>
.owner { font-size: 17px; font-weight: 600; color: var(--text-2); }
.meta { margin-top: 6px; font-size: 12.5px; }
.desc { margin: 8px 0 0; max-width: 620px; }
.page { padding-top: 8px; }
</style>
