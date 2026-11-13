<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { ListPlus, MoreHorizontal, Pause, Pencil, Play, Shuffle, Trash2 } from "lucide-vue-next";
import type { Track } from "@/api";
import LoadState from "@/components/LoadState.vue";
import PageHero from "@/components/PageHero.vue";
import TrackTable from "@/components/TrackTable.vue";
import { ago, count, longDuration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLoad } from "@/lib/useLoad";
import { isLocalId, useLocalPlaylists } from "@/stores/localPlaylists";
import { usePlayer } from "@/stores/player";
import { useUi, type MenuItem } from "@/stores/ui";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const ui = useUi();
const menus = useMenus();
const router = useRouter();
const local = useLocalPlaylists();

// Local playlists ("local:" ids) live in the store; everything else comes from the backend.
const isLocal = isLocalId(props.id);
const remote = useLoad((b) => (isLocal ? Promise.resolve(null) : b.playlist(props.id)));
const localEntry = computed(() => (isLocal ? local.get(props.id) : null));
const playlist = computed(() => (localEntry.value ? local.asPlaylist(localEntry.value) : remote.data.value));
const loading = computed(() => !isLocal && remote.loading.value);
const error = computed(() => (isLocal && !localEntry.value ? "This playlist was deleted." : isLocal ? null : remote.error.value));

const source = computed(() => `playlist:${props.id}`);
const tracks = computed(() => playlist.value?.tracks ?? []);
const active = computed(() => player.queueSource === source.value && player.playing);

function shuffle() {
  // playTracks resets shuffle, so toggling afterwards always turns it on.
  player.playTracks(tracks.value, Math.floor(Math.random() * tracks.value.length), source.value);
  player.toggleShuffle();
}

const renaming = ref(false);
const draftTitle = ref("");
const titleInput = ref<HTMLInputElement>();
async function startRename() {
  draftTitle.value = playlist.value?.title ?? "";
  renaming.value = true;
  await nextTick();
  titleInput.value?.select();
}
function saveRename() {
  local.rename(props.id, draftTitle.value);
  renaming.value = false;
}

// Two clicks to delete, since there's no undo.
const confirmDelete = ref(false);
function deletePlaylist() {
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    setTimeout(() => (confirmDelete.value = false), 3000);
    return;
  }
  const title = playlist.value?.title;
  local.remove(props.id);
  ui.notify(`Deleted "${title}"`);
  void router.push("/library/playlists");
}

function localMenu(_t: Track, i: number): MenuItem[] {
  const last = tracks.value.length - 1;
  return [
    ...(i > 0 ? [{ label: "Move up", action: () => local.moveTrack(props.id, i, i - 1) }] : []),
    ...(i < last ? [{ label: "Move down", action: () => local.moveTrack(props.id, i, i + 1) }] : []),
    { label: "Remove from playlist", danger: true, action: () => local.removeTrack(props.id, i) },
  ];
}
</script>

<template>
  <div>
    <LoadState :loading="loading" :error="error" @retry="remote.reload">
      <template v-if="playlist">
        <PageHero :art="playlist.artworkUrl" :title="playlist.title" :eyebrow="playlist.isAlbum ? 'Album' : isLocal ? 'Local playlist' : 'Playlist'">
          <template #meta>
            <form v-if="renaming" class="rename" @submit.prevent="saveRename">
              <input ref="titleInput" v-model="draftTitle" aria-label="Playlist name" @keydown.esc="renaming = false" />
              <button class="btn primary" type="submit">Save</button>
              <button class="btn" type="button" @click="renaming = false">Cancel</button>
            </form>
            <span v-if="isLocal" class="owner">Saved on this computer</span>
            <RouterLink v-else :to="`/user/${playlist.user.id}`" class="owner">{{ playlist.user.username }}</RouterLink>
            <div class="muted meta">
              {{ playlist.trackCount }} tracks · {{ longDuration(playlist.duration) }}
              <template v-if="!isLocal"> · {{ count(playlist.likesCount) }} likes</template>
              · {{ ago(playlist.createdAt) }}
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
            <template v-if="isLocal">
              <button class="btn" @click="startRename"><Pencil :size="15" /> Rename</button>
              <button class="btn" :class="{ danger: confirmDelete }" @click="deletePlaylist">
                <Trash2 :size="15" /> {{ confirmDelete ? "Click again to delete" : "Delete" }}
              </button>
            </template>
            <button v-else class="icon-btn" title="More" @click="ui.openMenu($event, menus.playlist(playlist))"><MoreHorizontal :size="18" /></button>
          </template>
        </PageHero>
        <div class="page">
          <div v-if="isLocal && !tracks.length" class="empty">This playlist is empty.</div>
          <TrackTable
            v-else
            :tracks="tracks"
            :source="source"
            :numbered="true"
            :show-artwork="!playlist.isAlbum"
            :menu-extra="isLocal ? localMenu : undefined"
          />
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
.rename { display: flex; gap: 8px; margin: 2px 0 10px; }
.rename input { width: min(420px, 100%); font-size: 15px; font-weight: 600; }
.btn.danger { background: #ff5a5a; color: #fff; }
</style>
