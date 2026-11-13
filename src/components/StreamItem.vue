<script setup lang="ts">
// A SoundCloud-style stream entry: who posted or reposted it, artwork, title,
// and an inline waveform you can click to start playing at that point.
import { computed } from "vue";
import { Heart, ListPlus, MessageCircle, MoreHorizontal, Pause, Play, Repeat2 } from "lucide-vue-next";
import type { FeedItem, Track } from "@/api";
import { ago, count, longDuration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";
import Waveform from "./Waveform.vue";

const props = defineProps<{ entry: FeedItem; queue: Track[] }>();

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const menus = useMenus();

const track = computed(() => (props.entry.kind === "track" ? props.entry.track : null));
const playlist = computed(() => (props.entry.kind === "playlist" ? props.entry.playlist : null));
const current = computed(() => !!track.value && player.isCurrent(track.value));
const poster = computed(() => props.entry.repostedBy ?? (track.value ?? playlist.value)!.user);

function play(at?: number) {
  const t = track.value;
  if (!t) return;
  if (current.value) {
    if (at != null) player.seekFraction(at);
    else player.toggle();
    return;
  }
  const i = Math.max(0, props.queue.findIndex((q) => q.id === t.id));
  player.playTracks(props.queue, i, "stream", at);
}
</script>

<template>
  <article class="item" @contextmenu="track ? ui.openMenu($event, menus.track(track)) : playlist && ui.openMenu($event, menus.playlist(playlist))">
    <div class="who">
      <Artwork :src="poster.avatarUrl" :size="22" round />
      <RouterLink :to="`/user/${poster.id}`" class="name">{{ poster.username }}</RouterLink>
      <span class="faint">
        <template v-if="entry.repostedBy"><Repeat2 :size="12" class="inline" /> reposted</template>
        <template v-else>posted a {{ playlist ? (playlist.isAlbum ? "album" : "playlist") : "track" }}</template>
        · {{ ago(entry.createdAt) }}
      </span>
    </div>

    <div class="body">
      <RouterLink :to="track ? `/track/${track.id}` : `/playlist/${playlist!.id}`" class="art">
        <Artwork :src="(track ?? playlist)!.artworkUrl" :size="148" :radius="6" />
      </RouterLink>

      <div class="main">
        <div class="head">
          <button v-if="track" class="play" @click="play()">
            <Pause v-if="current && player.playing" :size="20" fill="currentColor" />
            <Play v-else :size="20" fill="currentColor" />
          </button>
          <div class="titles">
            <RouterLink :to="`/user/${(track ?? playlist)!.user.id}`" class="artist ellipsis">{{ (track ?? playlist)!.user.username }}</RouterLink>
            <span class="title-line">
              <RouterLink :to="track ? `/track/${track.id}` : `/playlist/${playlist!.id}`" class="title ellipsis">{{ (track ?? playlist)!.title }}</RouterLink>
              <span v-if="track?.preview" class="preview-pill" title="Only a 30-second preview can be played">Preview</span>
            </span>
          </div>
          <span v-if="track?.genre" class="genre">#{{ track.genre }}</span>
        </div>

        <Waveform
          v-if="track"
          :samples="track.waveform"
          :progress="current ? player.progress : null"
          :duration="track.duration"
          :comments="current && settings.showCommentsOnWaveform ? player.comments : []"
          :height="64"
          @seek="play"
        />
        <div v-else class="tracklist">
          <RouterLink v-for="(t, i) in playlist!.tracks?.slice(0, 4)" :key="t.id" :to="`/track/${t.id}`" class="mini ellipsis">
            <span class="faint">{{ i + 1 }}</span> {{ t.user.username }} – {{ t.title }}
          </RouterLink>
          <span class="faint">{{ playlist!.trackCount }} tracks · {{ longDuration(playlist!.duration) }}</span>
        </div>

        <div v-if="track" class="actions">
          <button class="chip" :class="{ on: library.isLiked(track) }" @click="library.toggleLike(track)">
            <Heart :size="13" :fill="library.isLiked(track) ? 'currentColor' : 'none'" /> {{ count(track.likesCount + Number(library.isLiked(track)) - Number(!!track.liked)) }}
          </button>
          <button class="chip" :class="{ on: library.isReposted(track) }" @click="library.toggleRepost(track)">
            <Repeat2 :size="13" /> {{ count(track.repostsCount) }}
          </button>
          <button class="chip" @click="player.playNext([track])"><ListPlus :size="13" /> Next up</button>
          <button class="chip" @click="ui.openMenu($event, menus.track(track))"><MoreHorizontal :size="13" /></button>
          <span class="stats faint">
            <Play :size="11" fill="currentColor" /> {{ count(track.playbackCount) }}
            <MessageCircle :size="11" /> {{ count(track.commentCount) }}
          </span>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.item { padding: 18px 0 22px; border-bottom: 1px solid var(--border); }
.who { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12.5px; }
.name { font-weight: 600; }
.inline { vertical-align: -2px; }
.body { display: flex; gap: 16px; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.head { display: flex; align-items: center; gap: 10px; }
.play {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  transition: transform 0.1s;
}
.play:hover { transform: scale(1.05); }
.titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.artist { color: var(--text-2); font-size: 12.5px; }
.title { font-size: 15px; font-weight: 650; }
.title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.genre { padding: 3px 9px; border-radius: 11px; background: var(--hover); color: var(--text-2); font-size: 11.5px; }
.tracklist { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-radius: 8px; background: var(--hover); }
.mini { font-size: 12.5px; }
.actions { display: flex; align-items: center; gap: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-2);
}
.chip:hover { color: var(--text); background: var(--hover); }
.chip.on { color: var(--accent); border-color: var(--accent-soft); }
.stats { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
</style>
