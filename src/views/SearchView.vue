<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Clock, ListMusic, Search, X } from "lucide-vue-next";
import { api, type Playlist, type SearchKind, type SearchResults, type Track, type User } from "@/api";
import GenreTiles from "@/components/GenreTiles.vue";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import Shelf from "@/components/Shelf.vue";
import TrackTable from "@/components/TrackTable.vue";
import SpotifyConnectPrompt from "@/components/SpotifyConnectPrompt.vue";
import { isPhone } from "@/lib/responsive";
import { clearSearches, forgetSearch, recentSearches, rememberSearch } from "@/lib/recentSearches";
import { isSpotifyAuthError } from "@/lib/useLoad";
import { useUi } from "@/stores/ui";
import { useSettings } from "@/stores/settings";
import { useSpotify } from "@/spotify/auth";
import { sourceCatalogue } from "@/spotify/catalogue";

const route = useRoute();
const router = useRouter();
const q = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const tab = ref<"all" | SearchKind>("all");
const all = ref<SearchResults | null>(null);
const items = ref<(Track | User | Playlist)[]>([]);
const next = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const needsSpotify = ref(false);
const settings = useSettings();
const ui = useUi();
const spotify = useSpotify();
const spotifySource = computed(() => settings.musicSource === "spotify");

const tabs = computed<{ id: "all" | SearchKind; label: string }[]>(() => [
  { id: "all", label: "Everything" },
  { id: "tracks", label: "Tracks" },
  { id: "users", label: spotifySource.value ? "Artists" : "People" },
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
]);

async function run() {
  if (!q.value) return;
  rememberSearch(q.value);
  loading.value = true;
  error.value = null;
  needsSpotify.value = false;
  const b = sourceCatalogue();
  try {
    if (tab.value === "all") all.value = await b.search(q.value);
    else {
      const page = await b.searchKind(q.value, tab.value);
      items.value = page.items;
      next.value = page.next;
    }
  } catch (err) {
    error.value = (err as Error).message;
    needsSpotify.value = isSpotifyAuthError(err);
  } finally {
    loading.value = false;
  }
}

async function more() {
  if (!next.value || tab.value === "all") return;
  loadingMore.value = true;
  try {
    const page = await sourceCatalogue().searchKind(q.value, tab.value, next.value);
    items.value = [...items.value, ...page.items];
    next.value = page.next;
  } finally {
    loadingMore.value = false;
  }
}

watch([q, tab, api, () => settings.musicSource, () => spotify.connected], run, { immediate: true });

// Phones have no sidebar, so the search field lives on this page.
const draft = ref(q.value);
const field = ref<HTMLInputElement>();
watch(q, (value) => (draft.value = value));
function submit() {
  const value = draft.value.trim();
  field.value?.blur();
  if (value && value !== q.value) void router.replace({ path: "/search", query: { q: value } });
}

const empty = computed(() => {
  if (tab.value !== "all") return !items.value.length;
  const r = all.value;
  return !!r && !r.tracks.items.length && !r.users.items.length && !r.playlists.items.length && !r.albums.items.length;
});
</script>

<template>
  <div class="page">
    <template v-if="isPhone || !q">
      <h1 class="page-title">Search</h1>
      <form class="field" role="search" @submit.prevent="submit">
        <Search :size="18" class="field-icon" />
        <input
          ref="field"
          v-model="draft"
          type="search"
          placeholder="Artists, tracks, playlists"
          enterkeyhint="search"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          aria-label="Search"
        />
      </form>
      <div v-if="!q" class="start">
        <section v-if="recentSearches.length" class="recent">
          <header>
            <h2 class="section-title">Recent searches</h2>
            <button class="btn small" @click="clearSearches">Clear</button>
          </header>
          <div v-for="r in recentSearches" :key="r" class="recent-row">
            <RouterLink :to="{ path: '/search', query: { q: r } }" class="recent-link"><Clock :size="15" class="faint" /> <span class="ellipsis">{{ r }}</span></RouterLink>
            <button class="icon-btn" :title="`Remove ${r}`" @click="forgetSearch(r)"><X :size="15" /></button>
          </div>
        </section>
        <p v-else class="muted hint">
          {{ spotifySource ? "Search Spotify for tracks, artists, playlists and albums." : "Search SoundCloud for tracks, people, playlists and albums." }}
        </p>
        <section>
          <h2 class="section-title browse-title">Browse by genre and mood</h2>
          <GenreTiles chips />
        </section>
      </div>
    </template>
    <h1 v-else class="page-title">Results for "{{ q }}"</h1>
    <div v-if="q" class="tabs">
      <button v-for="t in tabs" :key="t.id" class="tab" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <LoadState v-if="q" :loading="loading" :error="error" :needs-spotify="needsSpotify" :empty="empty" :empty-text="`No results for “${q}”.`" @retry="run">
      <template v-if="tab === 'all' && all">
        <section v-if="all.tracks.items.length" class="block">
          <header class="block-head">
            <h2 class="section-title">Tracks</h2>
            <button class="btn small" @click="ui.addToPlaylist(all.tracks.items)"><ListMusic :size="14" /> Add all to playlist</button>
          </header>
          <TrackTable :tracks="all.tracks.items.slice(0, 8)" :source="`search:${q}`" :show-header="false" />
        </section>
        <Shelf v-if="all.users.items.length" :title="spotifySource ? 'Artists' : 'People'">
          <MediaCard v-for="u in all.users.items" :key="u.id" kind="user" :item="u" />
        </Shelf>
        <Shelf v-if="all.playlists.items.length" title="Playlists">
          <MediaCard v-for="p in all.playlists.items" :key="p.id" kind="playlist" :item="p" />
        </Shelf>
        <Shelf v-if="all.albums.items.length" title="Albums">
          <MediaCard v-for="p in all.albums.items" :key="p.id" kind="playlist" :item="p" />
        </Shelf>
      </template>

      <template v-else-if="tab === 'tracks'">
        <div v-if="items.length" class="block-head">
          <span class="muted">{{ items.length }} tracks loaded</span>
          <button class="btn small" @click="ui.addToPlaylist(items as Track[])"><ListMusic :size="14" /> Add all to playlist</button>
        </div>
        <TrackTable :tracks="(items as Track[])" :source="`search:${q}`" />
      </template>
      <div v-else-if="tab === 'users'" class="grid">
        <MediaCard v-for="u in (items as User[])" :key="u.id" kind="user" :item="u" />
      </div>
      <div v-else class="grid">
        <MediaCard v-for="p in (items as Playlist[])" :key="p.id" kind="playlist" :item="p" />
      </div>
      <LoadMore v-if="tab !== 'all'" :has-more="!!next" :loading="loadingMore" @more="more" />
    </LoadState>
  </div>
</template>

<style scoped>
.block { margin-bottom: 36px; }
.block .section-title { margin-bottom: 8px; }
.field { position: relative; margin-bottom: 16px; }
.field input { width: 100%; height: 44px; padding-left: 40px; border-radius: 12px; border-color: transparent; background: var(--hover); }
.field input:focus { border-color: var(--accent); }
.field-icon { position: absolute; left: 13px; top: 13px; color: var(--text-3); pointer-events: none; }
.hint { margin: 8px 0 28px; font-size: 15px; }
.start { max-width: 900px; }
.recent { margin-bottom: 28px; }
.recent header, .block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.recent-row { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--border); }
.recent-link { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 42px; font-weight: 500; }
.recent-link:hover { text-decoration: none; color: var(--accent); }
.browse-title { margin-bottom: 12px; }
.btn.small { height: 28px; padding: 0 10px; font-size: 12.5px; }
</style>
