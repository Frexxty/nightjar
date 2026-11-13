<script setup lang="ts">
import { computed } from "vue";
import { Heart, ListPlus, MessageCircle, MoreHorizontal, Pause, Play, Radio, Repeat2 } from "lucide-vue-next";
import Artwork from "@/components/Artwork.vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import PageHero from "@/components/PageHero.vue";
import Shelf from "@/components/Shelf.vue";
import Waveform from "@/components/Waveform.vue";
import { ago, count, duration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

const props = defineProps<{ id: string }>();
const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const menus = useMenus();

const { data, loading, error, reload } = useLoad(async (b) => {
  const [track, comments, related] = await Promise.all([
    b.track(props.id),
    b.trackComments(props.id).catch(() => []),
    b.relatedTracks(props.id).catch(() => []),
  ]);
  return { track, comments, related };
});

const track = computed(() => data.value?.track ?? null);
const current = computed(() => !!track.value && player.isCurrent(track.value));
const comments = computed(() => (current.value ? player.comments : data.value?.comments ?? []));

function play(at?: number) {
  const t = track.value!;
  if (current.value) return at == null ? player.toggle() : player.seekFraction(at);
  player.playTracks([t, ...(data.value?.related ?? [])], 0, `track:${t.id}`, at ?? null);
}
</script>

<template>
  <div>
    <LoadState :loading="loading" :error="error" @retry="reload">
      <template v-if="track">
        <PageHero :art="track.artworkUrl" :title="track.title" :eyebrow="track.genre ? `#${track.genre}` : 'Track'">
          <template #meta>
            <RouterLink :to="`/user/${track.user.id}`" class="artist">{{ track.user.username }}</RouterLink>
            <div class="stats muted">
              <span><Play :size="12" fill="currentColor" /> {{ count(track.playbackCount) }}</span>
              <span><Heart :size="12" /> {{ count(track.likesCount) }}</span>
              <span><Repeat2 :size="12" /> {{ count(track.repostsCount) }}</span>
              <span><MessageCircle :size="12" /> {{ count(track.commentCount) }}</span>
              <span>{{ duration(track.duration) }} · {{ ago(track.createdAt) }}</span>
            </div>
          </template>
          <template #actions>
            <button class="btn primary" :disabled="!track.streamable" @click="play()">
              <Pause v-if="current && player.playing" :size="15" fill="currentColor" />
              <Play v-else :size="15" fill="currentColor" />
              {{ current && player.playing ? "Pause" : "Play" }}
            </button>
            <button class="btn" :class="{ on: library.isLiked(track) }" @click="library.toggleLike(track)">
              <Heart :size="15" :fill="library.isLiked(track) ? 'currentColor' : 'none'" /> {{ library.isLiked(track) ? "Liked" : "Like" }}
            </button>
            <button class="btn" :class="{ on: library.isReposted(track) }" @click="library.toggleRepost(track)">
              <Repeat2 :size="15" /> {{ library.isReposted(track) ? "Reposted" : "Repost" }}
            </button>
            <button class="btn" @click="menus.startStation(track)"><Radio :size="15" /> Station</button>
            <button class="btn" @click="player.playNext([track])"><ListPlus :size="15" /> Play next</button>
            <button class="icon-btn" title="More" @click="ui.openMenu($event, menus.track(track))"><MoreHorizontal :size="18" /></button>
          </template>
          <div class="wave">
            <Waveform
              :samples="track.waveform"
              :progress="current ? player.progress : null"
              :duration="track.duration"
              :comments="settings.showCommentsOnWaveform ? comments : []"
              :height="90"
              @seek="play"
            />
          </div>
        </PageHero>

        <div class="page body">
          <div class="cols">
            <section>
              <p v-if="track.description" class="description">{{ track.description }}</p>
              <div v-if="track.tags?.length" class="tags">
                <span v-for="tag in track.tags" :key="tag" class="tag">#{{ tag }}</span>
              </div>
              <h2 class="section-title">{{ comments.length }} comments</h2>
              <div class="comments">
                <div v-for="c in comments" :key="c.id" class="comment">
                  <Artwork :src="c.user.avatarUrl" :size="34" round />
                  <div>
                    <div class="who">
                      <RouterLink :to="`/user/${c.user.id}`"><b>{{ c.user.username }}</b></RouterLink>
                      <template v-if="c.timestamp != null"> at <a class="at" @click="play(c.timestamp / track.duration)">{{ duration(c.timestamp) }}</a></template>
                      <span class="faint"> · {{ ago(c.createdAt) }}</span>
                    </div>
                    <div class="text">{{ c.body }}</div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <Shelf v-if="data?.related.length" title="Related tracks">
            <MediaCard v-for="t in data.related" :key="t.id" kind="track" :item="t" :siblings="data.related" :source="`related:${track.id}`" />
          </Shelf>
        </div>
      </template>
    </LoadState>
  </div>
</template>

<style scoped>
.artist { font-size: 17px; font-weight: 600; color: var(--text-2); }
.stats { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12.5px; }
.stats span { display: inline-flex; align-items: center; gap: 4px; }
.wave { position: relative; margin-top: 26px; }
.body { padding-top: 8px; }
.description { white-space: pre-line; color: var(--text-2); max-width: 720px; user-select: text; }
.tags { display: flex; gap: 6px; margin: 12px 0 28px; }
.tag { padding: 3px 10px; border-radius: 12px; background: var(--hover); color: var(--text-2); font-size: 12px; }
.comments { display: flex; flex-direction: column; gap: 14px; margin: 14px 0 40px; max-width: 720px; }
.comment { display: flex; gap: 12px; }
.who { font-size: 12.5px; color: var(--text-2); }
.at { color: var(--accent); cursor: pointer; }
.text { margin-top: 2px; user-select: text; }
</style>
