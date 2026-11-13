<script setup lang="ts">
import { Clock, Heart, MoreHorizontal, Pause, Play } from "lucide-vue-next";
import type { Track } from "@/api";
import { count, duration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const props = withDefaults(
  defineProps<{
    tracks: Track[];
    /** Identifies this list as a queue source so its play button can toggle. */
    source?: string;
    numbered?: boolean;
    showArtwork?: boolean;
    showPlays?: boolean;
    showHeader?: boolean;
  }>(),
  { source: undefined, numbered: false, showArtwork: true, showPlays: true, showHeader: true },
);

const player = usePlayer();
const library = useLibrary();
const ui = useUi();
const menus = useMenus();

function play(i: number) {
  const t = props.tracks[i];
  if (player.isCurrent(t)) player.toggle();
  else player.playTracks(props.tracks, i, props.source ?? null);
}
</script>

<template>
  <div class="table" :class="{ numbered, art: showArtwork }">
    <div v-if="showHeader" class="row head">
      <span class="idx">#</span>
      <span>Title</span>
      <span v-if="showPlays" class="num">Plays</span>
      <span />
      <span class="num"><Clock :size="13" /></span>
      <span />
    </div>
    <div
      v-for="(t, i) in tracks"
      :key="`${t.id}-${i}`"
      class="row"
      :class="{ current: player.isCurrent(t), unavailable: !t.streamable }"
      @dblclick="play(i)"
      @contextmenu="ui.openMenu($event, menus.track(t))"
    >
      <span class="idx">
        <button class="play-btn" @click="play(i)">
          <Pause v-if="player.isCurrent(t) && player.playing" :size="14" fill="currentColor" />
          <Play v-else :size="14" fill="currentColor" />
        </button>
        <span v-if="numbered" class="n">
          <span v-if="player.isCurrent(t) && player.playing" class="bars"><i /><i /><i /></span>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <Artwork v-if="showArtwork" class="thumb" :src="t.artworkUrl" :size="38" :radius="5" />
      </span>
      <span class="title">
        <RouterLink :to="`/track/${t.id}`" class="name ellipsis">{{ t.title }}</RouterLink>
        <RouterLink :to="`/user/${t.user.id}`" class="by ellipsis">{{ t.user.username }}</RouterLink>
      </span>
      <span v-if="showPlays" class="num faint">{{ count(t.playbackCount) }}</span>
      <span class="like">
        <button class="icon-btn" :class="{ on: library.isLiked(t) }" :title="library.isLiked(t) ? 'Unlike' : 'Like'" @click="library.toggleLike(t)">
          <Heart :size="15" :fill="library.isLiked(t) ? 'currentColor' : 'none'" />
        </button>
      </span>
      <span class="num faint">{{ duration(t.duration) }}</span>
      <span>
        <button class="icon-btn more" title="More" @click.stop="ui.openMenu($event, menus.track(t))"><MoreHorizontal :size="16" /></button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 70px 36px 56px 36px;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 8px;
  border-radius: 8px;
}
.table:not(.art) .row { grid-template-columns: 36px minmax(0, 1fr) 70px 36px 56px 36px; min-height: 46px; }
.row:not(.head):hover { background: var(--hover); }
.row.current .name { color: var(--accent); }
.row.unavailable { opacity: 0.45; }
.head {
  min-height: 32px;
  font-size: 11.5px;
  color: var(--text-3);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  margin-bottom: 4px;
}
.idx { position: relative; display: flex; align-items: center; gap: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.head .idx { padding-left: 4px; }
.n { width: 18px; text-align: right; }
.table.art.numbered .row { grid-template-columns: 84px minmax(0, 1fr) 70px 36px 56px 36px; }
.play-btn {
  position: absolute;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 5px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.12s;
}
.table.art.numbered .play-btn { left: 28px; }
.table:not(.art) .play-btn { width: 24px; height: 24px; background: var(--panel); color: var(--text); }
.row:hover .play-btn, .row.current .play-btn { opacity: 1; }
.table:not(.art) .row.current:not(:hover) .play-btn { opacity: 0; }
.title { display: flex; flex-direction: column; min-width: 0; }
.name { font-weight: 600; }
.by { color: var(--text-2); font-size: 12px; }
.num { text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; display: flex; justify-content: flex-end; }
.like .icon-btn:not(.on), .more { opacity: 0; }
.row:hover .like .icon-btn, .row:hover .more { opacity: 1; }
.bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 12px; }
/* scaleY instead of height keeps this on the compositor: no layout or paint per frame. */
.bars i { width: 3px; height: 12px; background: var(--accent); transform-origin: bottom; animation: eq 0.9s ease-in-out infinite; }
.bars i:nth-child(2) { animation-delay: -0.3s; }
.bars i:nth-child(3) { animation-delay: -0.6s; }
@keyframes eq { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }
</style>
