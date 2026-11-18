<script setup lang="ts">
// "Add to playlist": lists your playlists (account and this device) with
// "New playlist…" on top. Opened with ui.addToPlaylist(tracks).
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Plus, X } from "lucide-vue-next";
import type { Playlist } from "@/api";
import { isLocalId } from "@/stores/localPlaylists";
import { useLibrary } from "@/stores/library";
import { useMyPlaylists } from "@/stores/myPlaylists";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const ui = useUi();
const library = useLibrary();
const mine = useMyPlaylists();
const filter = ref("");

const tracks = computed(() => ui.picker?.tracks ?? []);
const what = computed(() => (tracks.value.length === 1 ? tracks.value[0].title : `${tracks.value.length} tracks`));
const playlists = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? mine.all.filter((p) => p.title.toLowerCase().includes(q)) : mine.all;
});

watch(() => ui.picker, () => (filter.value = ""));

function close() {
  ui.picker = null;
}

function pick(p: Playlist) {
  const list = tracks.value;
  close();
  void mine.addTracks(p, list);
}

function create() {
  const list = tracks.value;
  close();
  ui.newPlaylist({ tracks: list });
}

function signIn() {
  close();
  library.signIn();
}

const onKey = (e: KeyboardEvent) => e.key === "Escape" && ui.picker && close();
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="picker">
      <div v-if="ui.picker" class="scrim" @mousedown.self="close">
        <div class="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
          <header>
            <div class="titles">
              <h2 id="picker-title">Add to playlist</h2>
              <p class="muted ellipsis">{{ what }}</p>
            </div>
            <button class="icon-btn" title="Close" @click="close"><X :size="16" /></button>
          </header>
          <input v-if="mine.all.length > 6" v-model="filter" class="filter" type="search" placeholder="Find a playlist" aria-label="Find a playlist" />
          <div class="list">
            <button class="row new" @click="create">
              <span class="plus"><Plus :size="20" /></span>
              <span class="label">New playlist…</span>
            </button>
            <button v-for="p in playlists" :key="p.id" class="row" @click="pick(p)">
              <Artwork :src="p.artworkUrl" :size="40" :radius="6" />
              <span class="label">
                <span class="ellipsis">{{ p.title }}</span>
                <span class="sub ellipsis">{{ p.trackCount }} tracks<template v-if="isLocalId(p.id)"> · On this device</template><template v-else-if="p.public"> · Public</template></span>
              </span>
            </button>
            <p v-if="filter && !playlists.length" class="faint empty-note">No playlist called "{{ filter }}".</p>
          </div>
          <p v-if="library.accounts && library.signedOut" class="note">
            Signed out, so new playlists stay on this device. <a href="#" @click.prevent="signIn">Sign in</a> to use your account's playlists.
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, 0.35); }
.picker {
  width: min(400px, 100%);
  max-height: min(560px, calc(100dvh - 64px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 12px 12px;
  border-radius: var(--radius-lg);
  background: var(--overlay);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
}
header { display: flex; align-items: flex-start; gap: 12px; padding: 0 4px; }
.titles { flex: 1; min-width: 0; }
h2 { margin: 0 0 2px; font-size: 16px; }
.titles p { margin: 0; font-size: 12.5px; }
.filter { margin: 0 4px; }
.list { overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px; border-radius: 8px; text-align: left; }
@media (hover: hover) { .row:hover { background: var(--hover); } }
.row:active { background: var(--active); }
.plus { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); flex: none; }
.label { flex: 1; min-width: 0; display: flex; flex-direction: column; font-weight: 600; }
.new .label { color: var(--accent); }
.sub { font-size: 12px; font-weight: 400; color: var(--text-2); }
.note, .empty-note { margin: 0; padding: 0 6px; font-size: 12.5px; color: var(--text-2); }
.note a { color: var(--accent); }
.picker-enter-active, .picker-leave-active { transition: opacity 0.18s ease; }
.picker-enter-active .picker, .picker-leave-active .picker { transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1); }
.picker-enter-from, .picker-leave-to { opacity: 0; }
.picker-enter-from .picker, .picker-leave-to .picker { transform: scale(0.96); }
@media (max-width: 760px) {
  .scrim { place-items: end center; padding: 0; }
  .picker { width: 100%; max-height: 75dvh; border-radius: 16px 16px 0 0; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .row { padding: 8px 6px; }
  .picker-enter-from .picker, .picker-leave-to .picker { transform: translateY(60px); }
}
</style>
