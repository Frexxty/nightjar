<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Search } from "lucide-vue-next";
import { api, type Playlist, type SearchKind, type SearchResults, type Track, type User } from "@/api";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import Shelf from "@/components/Shelf.vue";
import TrackTable from "@/components/TrackTable.vue";
import { isPhone } from "@/lib/responsive";

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

const tabs: { id: "all" | SearchKind; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "tracks", label: "Tracks" },
  { id: "users", label: "People" },
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
];

async function run() {
  if (!q.value) return;
  loading.value = true;
  error.value = null;
  try {
    if (tab.value === "all") all.value = await api.value.search(q.value);
    else {
      const page = await api.value.searchKind(q.value, tab.value);
      items.value = page.items;
      next.value = page.next;
    }
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function more() {
  if (!next.value || tab.value === "all") return;
  loadingMore.value = true;
  try {
    const page = await api.value.searchKind(q.value, tab.value, next.value);
    items.value = [...items.value, ...page.items];
    next.value = page.next;
  } finally {
    loadingMore.value = false;
  }
}

watch([q, tab, api], run, { immediate: true });

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
    <template v-if="isPhone">
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
      <p v-if="!q" class="muted hint">Search SoundCloud for tracks, people, playlists and albums.</p>
    </template>
    <h1 v-else class="page-title">Results for "{{ q }}"</h1>
    <div v-if="q || !isPhone" class="tabs">
      <button v-for="t in tabs" :key="t.id" class="tab" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <LoadState v-if="q || !isPhone" :loading="loading" :error="error" :empty="empty" :empty-text="`No results for “${q}”.`" @retry="run">
      <template v-if="tab === 'all' && all">
        <section v-if="all.tracks.items.length" class="block">
          <h2 class="section-title">Tracks</h2>
          <TrackTable :tracks="all.tracks.items.slice(0, 8)" :source="`search:${q}`" :show-header="false" />
        </section>
        <Shelf v-if="all.users.items.length" title="People">
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
.hint { margin: 24px 4px; font-size: 15px; }
</style>
