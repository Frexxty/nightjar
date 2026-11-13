<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BadgeCheck, MapPin, Play, Shuffle, UserCheck, UserPlus } from "lucide-vue-next";
import { api, type Playlist, type Track } from "@/api";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import PageHero from "@/components/PageHero.vue";
import TrackTable from "@/components/TrackTable.vue";
import { count } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSpotify } from "@/spotify/auth";
import { catalogueFor } from "@/spotify/catalogue";
import { isSpotifyId } from "@/spotify/ids";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const library = useLibrary();

const isSpotify = isSpotifyId(props.id);
const spotify = useSpotify();
const backend = () => catalogueFor(props.id);
const { data, loading, error, needsSpotify, reload } = useLoad(async () => {
  const b = backend();
  const [user, top] = await Promise.all([b.user(props.id), b.userTopTracks(props.id).catch(() => [])]);
  return { user, top };
});
const user = computed(() => data.value?.user ?? null);
const isMe = computed(() => library.me?.id === props.id);

type Tab = "tracks" | "playlists" | "likes";
const tab = ref<Tab>("tracks");
const tracks = ref<Track[]>([]);
const playlists = ref<Playlist[]>([]);
const next = ref<string | null>(null);
const tabLoading = ref(false);
const loadingMore = ref(false);

async function loadTab() {
  tabLoading.value = true;
  try {
    const b = backend();
    if (tab.value === "playlists") playlists.value = await b.userPlaylists(props.id);
    else {
      const page = tab.value === "tracks" ? await b.userTracks(props.id) : await b.userLikes(props.id);
      tracks.value = page.items;
      next.value = page.next;
    }
  } finally {
    tabLoading.value = false;
  }
}
async function more() {
  if (!next.value || tab.value === "playlists") return;
  loadingMore.value = true;
  try {
    const b = backend();
    const page = tab.value === "tracks" ? await b.userTracks(props.id, next.value) : await b.userLikes(props.id, next.value);
    tracks.value = [...tracks.value, ...page.items];
    next.value = page.next;
  } finally {
    loadingMore.value = false;
  }
}
watch([tab, api, () => spotify.connected], () => loadTab().catch(() => {}), { immediate: true });

function playAll(shuffle = false) {
  const list = tracks.value.length ? tracks.value : data.value?.top ?? [];
  player.playTracks(list, shuffle ? Math.floor(Math.random() * list.length) : 0, `user:${props.id}`);
  if (shuffle) player.toggleShuffle();
}
</script>

<template>
  <div>
    <LoadState :loading="loading" :error="error" :needs-spotify="needsSpotify" @retry="reload">
      <template v-if="user">
        <div v-if="user.bannerUrl" class="banner" :style="{ backgroundImage: `url(${JSON.stringify(user.bannerUrl)})` }" />
        <PageHero :art="user.avatarUrl" round :title="user.username" :eyebrow="isSpotify ? 'Spotify artist' : 'Artist'" :class="{ overlap: user.bannerUrl }">
          <template #meta>
            <div class="meta muted">
              <BadgeCheck v-if="user.verified" :size="14" class="verified" />
              <span v-if="user.city || user.country"><MapPin :size="12" /> {{ [user.city, user.country].filter(Boolean).join(", ") }}</span>
              <template v-if="!isSpotify">
                <span><b>{{ count(user.followersCount) }}</b> followers</span>
                <span><b>{{ count(user.followingsCount) }}</b> following</span>
                <span><b>{{ count(user.trackCount) }}</b> tracks</span>
              </template>
            </div>
            <p v-if="user.description" class="bio muted">{{ user.description }}</p>
          </template>
          <template #actions>
            <button class="btn primary" @click="playAll()"><Play :size="15" fill="currentColor" /> Play</button>
            <button class="btn" @click="playAll(true)"><Shuffle :size="15" /> Shuffle</button>
            <button v-if="!isMe" class="btn" :class="{ on: library.isFollowing(user) }" @click="library.toggleFollow(user)">
              <UserCheck v-if="library.isFollowing(user)" :size="15" />
              <UserPlus v-else :size="15" />
              {{ library.isFollowing(user) ? "Following" : "Follow" }}
            </button>
          </template>
        </PageHero>

        <div class="page">
          <section v-if="data?.top.length" class="top">
            <h2 class="section-title">Popular</h2>
            <TrackTable :tracks="data.top" :source="`user-top:${user.id}`" numbered :show-header="false" />
          </section>

          <div class="tabs">
            <button class="tab" :class="{ active: tab === 'tracks' }" @click="tab = 'tracks'">Tracks</button>
            <button class="tab" :class="{ active: tab === 'playlists' }" @click="tab = 'playlists'">{{ isSpotify ? "Releases" : "Playlists" }}</button>
            <button v-if="!isSpotify" class="tab" :class="{ active: tab === 'likes' }" @click="tab = 'likes'">Likes</button>
          </div>
          <LoadState :loading="tabLoading" :error="null" :empty="tab === 'playlists' ? !playlists.length : !tracks.length">
            <div v-if="tab === 'playlists'" class="grid">
              <MediaCard v-for="p in playlists" :key="p.id" kind="playlist" :item="p" />
            </div>
            <template v-else>
              <TrackTable :tracks="tracks" :source="`user-${tab}:${user.id}`" />
              <LoadMore :has-more="!!next" :loading="loadingMore" @more="more" />
            </template>
          </LoadState>
        </div>
      </template>
    </LoadState>
  </div>
</template>

<style scoped>
.banner {
  height: 180px;
  background-size: cover;
  background-position: center;
  mask-image: linear-gradient(#000 40%, transparent);
}
.overlap { margin-top: -120px; }
.overlap :deep(.wash) { display: none; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; font-size: 12.5px; }
.meta span { display: inline-flex; align-items: center; gap: 4px; }
.meta b { color: var(--text); }
.verified { color: var(--accent); }
.bio { max-width: 620px; margin: 10px 0 0; user-select: text; }
.top { margin-bottom: 32px; }
.top .section-title { margin-bottom: 8px; }
</style>
