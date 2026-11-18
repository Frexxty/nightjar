<script setup lang="ts">
import { computed, watch } from "vue";
import { ListMusic, Pause, Play, Shuffle, Sparkles } from "lucide-vue-next";
import type { Section, Track } from "@/api";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import Shelf from "@/components/Shelf.vue";
import TrackTable from "@/components/TrackTable.vue";
import { FOR_YOU_ID, isRecommendationSection } from "@/lib/recommend";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { distinctCovers } from "@/spotify/artwork";
import { useSpotify } from "@/spotify/auth";
import { sourceCatalogue } from "@/spotify/catalogue";

const library = useLibrary();
const player = usePlayer();
const settings = useSettings();
const spotify = useSpotify();
const ui = useUi();

// Recommendations come first. The hosted server also puts them in /home for
// older apps, so shelves already shown up top are dropped from the rest.
const { data, loading, error, needsSpotify, reload } = useLoad(async () => {
  const b = sourceCatalogue();
  const [home, recs] = await Promise.all([
    b.home(),
    b.recommendations ? b.recommendations().catch(() => [] as Section[]) : Promise.resolve([] as Section[]),
  ]);
  const personal = recs.filter((s) => isRecommendationSection(s.id));
  const shown = new Set(personal.map((s) => s.id));
  return [...personal, ...home.filter((s) => !shown.has(s.id))];
});
watch(() => settings.musicSource, () => void reload());
const sections = computed(() => data.value ?? []);
const name = computed(() => (settings.musicSource === "spotify" ? spotify.profile?.displayName : library.me?.username));

const mix = computed(() => {
  const s = sections.value.find((x) => x.id === FOR_YOU_ID);
  return s?.kind === "tracks" ? s : null;
});
const mixTracks = computed<Track[]>(() => mix.value?.items ?? []);
const mixCovers = computed(() => distinctCovers(mixTracks.value));
const mixSource = "home:made-for-you";
const mixActive = computed(() => player.queueSource === mixSource && player.playing);

function shuffleMix() {
  player.playTracks(mixTracks.value, Math.floor(Math.random() * mixTracks.value.length), mixSource);
  player.toggleShuffle();
}

function saveMix() {
  const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  ui.newPlaylist({
    tracks: mixTracks.value,
    title: `Made for you, ${date}`,
    description: "Picked by Nightjar from what you like and play.",
    open: true,
  });
}

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
});
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ greeting }}{{ name ? `, ${name}` : "" }}</h1>
    <LoadState :loading="loading" :error="error" :needs-spotify="needsSpotify" :empty="!sections.length" @retry="reload">
      <template #skeleton>
        <div class="skeleton-shelf">
          <div v-for="i in 6" :key="i"><div class="skeleton art" /><div class="skeleton text" /></div>
        </div>
      </template>

      <section v-if="mix && mixTracks.length" class="for-you" aria-labelledby="for-you-title">
        <div class="mix-art" aria-hidden="true">
          <img v-for="(src, i) in mixCovers" :key="i" :src="src" alt="" decoding="async" />
          <span v-if="mixCovers.length < 4" class="mix-fallback"><Sparkles :size="40" /></span>
        </div>
        <div class="mix-text">
          <div class="eyebrow">For you</div>
          <h2 id="for-you-title">Made for you</h2>
          <p class="muted">{{ mix.subtitle ?? "Picked from what you like and play" }} · {{ mixTracks.length }} tracks</p>
          <div class="mix-actions">
            <button class="btn primary" @click="player.playOrToggle(mixTracks, 0, mixSource)">
              <Pause v-if="mixActive" :size="15" fill="currentColor" />
              <Play v-else :size="15" fill="currentColor" />
              {{ mixActive ? "Pause" : "Play" }}
            </button>
            <button class="btn" @click="shuffleMix"><Shuffle :size="15" /> Shuffle</button>
            <button class="btn" @click="saveMix"><ListMusic :size="15" /> Save as playlist</button>
          </div>
        </div>
      </section>

      <template v-for="s in sections" :key="s.id">
        <section v-if="s.kind === 'tracks' && s.display === 'list'" class="chart">
          <h2 class="section-title">{{ s.title }}</h2>
          <p v-if="s.subtitle" class="muted sub">{{ s.subtitle }}</p>
          <TrackTable :tracks="s.items" :source="`home:${s.id}`" numbered :show-header="false" />
        </section>
        <Shelf v-else :title="s.title" :subtitle="s.id === 'for-you' ? undefined : s.subtitle">
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

.for-you {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 36px;
  padding: 18px;
  border-radius: var(--radius-lg);
  background: linear-gradient(120deg, var(--accent-soft), transparent 70%), var(--hover);
  box-shadow: inset 0 0 0 1px var(--border);
}
.mix-art {
  position: relative;
  flex: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 148px;
  height: 148px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--active);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.mix-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mix-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--accent); background: var(--active); }
.mix-text { min-width: 0; }
.eyebrow { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); }
.mix-text h2 { margin: 2px 0 4px; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
.mix-text p { margin: 0; font-size: 13px; }
.mix-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
@media (max-width: 760px) {
  .for-you { flex-direction: column; align-items: stretch; text-align: center; gap: 14px; padding: 16px; }
  .mix-art { width: min(52vw, 200px); height: auto; aspect-ratio: 1; margin: 0 auto; }
  .mix-actions { justify-content: center; }
}
</style>
