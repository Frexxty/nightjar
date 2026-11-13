<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { ListPlus, MoreHorizontal, Pause, Pencil, Play, Shuffle, Trash2 } from "lucide-vue-next";
import { api, friendlyError, type Playlist, type PlaylistPatch, type Track } from "@/api";
import LoadState from "@/components/LoadState.vue";
import PageHero from "@/components/PageHero.vue";
import TrackTable from "@/components/TrackTable.vue";
import { ago, count, longDuration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { isLocalId, useLocalPlaylists } from "@/stores/localPlaylists";
import { usePlayer } from "@/stores/player";
import { useUi, type MenuItem } from "@/stores/ui";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const ui = useUi();
const menus = useMenus();
const router = useRouter();
const local = useLocalPlaylists();
const library = useLibrary();

// Local playlists ("local:" ids) live in the store; everything else comes from the backend.
const isLocal = isLocalId(props.id);
const remote = useLoad((b) => (isLocal ? Promise.resolve(null) : b.playlist(props.id)));
const localEntry = computed(() => (isLocal ? local.get(props.id) : null));
const playlist = computed(() => (localEntry.value ? local.asPlaylist(localEntry.value) : remote.data.value));
const loading = computed(() => !isLocal && remote.loading.value);
const error = computed(() => (isLocal && !localEntry.value ? "This playlist was deleted." : isLocal ? null : remote.error.value));

/** A playlist on the signed-in account (`sp_` ids on the hosted backend), which this page can edit. */
const owned = computed(() => {
  const p = remote.data.value;
  const me = library.me;
  if (isLocal || !p || !me || !api.value.updatePlaylist) return false;
  return props.id.startsWith("sp_") || p.user.id === me.id;
});
const editable = computed(() => isLocal || owned.value);

const source = computed(() => `playlist:${props.id}`);
const tracks = computed(() => playlist.value?.tracks ?? []);
const active = computed(() => player.queueSource === source.value && player.playing);

function shuffle() {
  // playTracks resets shuffle, so toggling afterwards always turns it on.
  player.playTracks(tracks.value, Math.floor(Math.random() * tracks.value.length), source.value);
  player.toggleShuffle();
}

// Account playlist edits show at once and roll back if the server says no.
// They run one at a time so a quick run of reorders reaches the server in order.
let queue: Promise<unknown> = Promise.resolve();
function saveRemote(next: Playlist, patch: PlaylistPatch, what: string) {
  const before = remote.data.value;
  remote.data.value = next;
  syncSidebar(next);
  const update = api.value.updatePlaylist;
  if (!update) return;
  queue = queue.then(() => update.call(api.value, props.id, patch)).catch((err) => {
    remote.data.value = before;
    if (before) syncSidebar(before);
    ui.notify(`Couldn't ${what}: ${friendlyError(err)}`);
  });
}

function syncSidebar(p: Playlist) {
  library.playlists = library.playlists.map((x) => (x.id === p.id ? { ...x, title: p.title, trackCount: p.trackCount, artworkUrl: p.artworkUrl } : x));
}

function withTracks(p: Playlist, list: Track[]): Playlist {
  return { ...p, tracks: list, trackCount: list.length, duration: list.reduce((sum, t) => sum + t.duration, 0) };
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
  const title = draftTitle.value.trim();
  renaming.value = false;
  const p = remote.data.value;
  if (isLocal) local.rename(props.id, title);
  else if (p && title && title !== p.title) saveRemote({ ...p, title }, { title }, "rename the playlist");
}

function removeTrack(i: number) {
  const p = remote.data.value;
  if (isLocal) return local.removeTrack(props.id, i);
  if (!p?.tracks) return;
  const list = p.tracks.filter((_, k) => k !== i);
  saveRemote(withTracks(p, list), { trackIds: list.map((t) => t.id) }, "remove the track");
}

function moveTrack(from: number, to: number) {
  const p = remote.data.value;
  if (isLocal) return local.moveTrack(props.id, from, to);
  if (!p?.tracks || from === to || to < 0 || to >= p.tracks.length) return;
  const list = [...p.tracks];
  const [t] = list.splice(from, 1);
  list.splice(to, 0, t);
  saveRemote(withTracks(p, list), { trackIds: list.map((x) => x.id) }, "move the track");
}

// Two clicks to delete, since there's no undo.
const confirmDelete = ref(false);
const deleting = ref(false);
async function deletePlaylist() {
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    setTimeout(() => (confirmDelete.value = false), 3000);
    return;
  }
  const title = playlist.value?.title;
  if (isLocal) local.remove(props.id);
  else {
    const remove = api.value.deletePlaylist;
    if (!remove) return;
    deleting.value = true;
    try {
      await remove.call(api.value, props.id);
      library.playlists = library.playlists.filter((p) => p.id !== props.id);
    } catch (err) {
      ui.notify(`Couldn't delete "${title}": ${friendlyError(err)}`);
      return;
    } finally {
      deleting.value = false;
      confirmDelete.value = false;
    }
  }
  ui.notify(`Deleted "${title}"`);
  void router.push("/library/playlists");
}

function editMenu(_t: Track, i: number): MenuItem[] {
  const last = tracks.value.length - 1;
  return [
    ...(i > 0 ? [{ label: "Move up", action: () => moveTrack(i, i - 1) }] : []),
    ...(i < last ? [{ label: "Move down", action: () => moveTrack(i, i + 1) }] : []),
    { label: "Remove from playlist", danger: true, action: () => removeTrack(i) },
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
            <RouterLink v-else-if="owned" to="/account" class="owner">{{ playlist.user.username }}</RouterLink>
            <RouterLink v-else :to="`/user/${playlist.user.id}`" class="owner">{{ playlist.user.username }}</RouterLink>
            <div class="muted meta">
              {{ playlist.trackCount }} tracks · {{ longDuration(playlist.duration) }}
              <template v-if="!isLocal && !owned"> · {{ count(playlist.likesCount) }} likes</template>
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
            <template v-if="editable">
              <button class="btn" @click="startRename"><Pencil :size="15" /> Rename</button>
              <button class="btn" :class="{ danger: confirmDelete }" :disabled="deleting" @click="deletePlaylist">
                <Trash2 :size="15" /> {{ deleting ? "Deleting…" : confirmDelete ? "Click again to delete" : "Delete" }}
              </button>
            </template>
            <button v-if="!isLocal" class="icon-btn" title="More" @click="ui.openMenu($event, menus.playlist(playlist))"><MoreHorizontal :size="18" /></button>
          </template>
        </PageHero>
        <div class="page">
          <div v-if="editable && !tracks.length" class="empty">This playlist is empty.</div>
          <TrackTable
            v-else
            :tracks="tracks"
            :source="source"
            :numbered="true"
            :show-artwork="!playlist.isAlbum"
            :menu-extra="editable ? editMenu : undefined"
            :reorder="editable ? moveTrack : undefined"
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
