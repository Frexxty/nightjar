<script setup lang="ts">
import { ref } from "vue";
import { Clock, Heart, MoreHorizontal, Pause, Play } from "lucide-vue-next";
import type { Track } from "@/api";
import { count, duration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { isPhone } from "@/lib/responsive";
import { isSpotifyId } from "@/spotify/ids";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useUi, type MenuItem } from "@/stores/ui";
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
    /** Extra context-menu items for a row, e.g. "Remove from playlist". */
    menuExtra?: (track: Track, index: number) => MenuItem[];
    /** Makes rows draggable; called with the old and new index when one is dropped. */
    reorder?: (from: number, to: number) => void;
  }>(),
  { source: undefined, numbered: false, showArtwork: true, showPlays: true, showHeader: true, menuExtra: undefined, reorder: undefined },
);

const player = usePlayer();
const library = useLibrary();
const ui = useUi();
const menus = useMenus();
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

const menuFor = (t: Track, i: number) => menus.track(t, props.menuExtra?.(t, i) ?? []);

function drop(to: number) {
  if (dragFrom.value != null && dragFrom.value !== to) props.reorder?.(dragFrom.value, to);
  dragFrom.value = dragOver.value = null;
}

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
      :class="{
        current: player.isCurrent(t),
        unavailable: !t.streamable,
        dragging: dragFrom === i,
        'over-above': dragOver === i && dragFrom != null && dragFrom > i,
        'over-below': dragOver === i && dragFrom != null && dragFrom < i,
      }"
      :draggable="reorder ? 'true' : undefined"
      @dragstart="reorder && (dragFrom = i)"
      @dragover="reorder && dragFrom != null && ($event.preventDefault(), (dragOver = i))"
      @drop="reorder && drop(i)"
      @dragend="dragFrom = dragOver = null"
      @dblclick="play(i)"
      @click="isPhone && play(i)"
      @contextmenu="ui.openMenu($event, menuFor(t, i))"
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
        <span class="name-line">
          <RouterLink :to="`/track/${t.id}`" class="name ellipsis" :draggable="reorder ? 'false' : undefined">{{ t.title }}</RouterLink>
          <span v-if="t.preview" class="preview-pill" title="Only a 30-second preview can be played">Preview</span>
        </span>
        <RouterLink :to="`/user/${t.user.id}`" class="by ellipsis" :draggable="reorder ? 'false' : undefined">{{ t.user.username }}</RouterLink>
      </span>
      <!-- Spotify doesn't share play counts; its tracks carry a placeholder 0. -->
      <span v-if="showPlays" class="num faint">{{ isSpotifyId(t.id) ? "–" : count(t.playbackCount) }}</span>
      <span class="like">
        <button class="icon-btn" :class="{ on: library.isLiked(t) }" :title="library.isLiked(t) ? 'Unlike' : 'Like'" @click="library.toggleLike(t)">
          <Heart :size="15" :fill="library.isLiked(t) ? 'currentColor' : 'none'" />
        </button>
      </span>
      <span class="num faint">{{ duration(t.duration) }}</span>
      <span>
        <button class="icon-btn more" title="More" @click.stop="ui.openMenu($event, menuFor(t, i))"><MoreHorizontal :size="16" /></button>
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
@media (hover: hover) { .row:not(.head):hover { background: var(--hover); } }
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
.name-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.row[draggable="true"] { cursor: grab; }
.row.dragging { opacity: 0.4; }
.row.over-above { box-shadow: inset 0 2px 0 var(--accent); }
.row.over-below { box-shadow: inset 0 -2px 0 var(--accent); }
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

/* Touch: the row buttons can't wait for a hover that never comes. */
@media (hover: none) {
  .like .icon-btn, .more { opacity: 1; }
}

/* Phone: artwork, title and artist, and a menu button. A tap plays the row. */
@media (max-width: 760px) {
  .row,
  .table:not(.art) .row,
  .table.art.numbered .row { grid-template-columns: auto minmax(0, 1fr) 44px; gap: 12px; min-height: 60px; padding: 0; border-radius: 0; }
  .table:not(.art) .row { min-height: 54px; }
  .row:active { background: var(--hover); }
  .head, .row > .num, .row > .like, .play-btn { display: none; }
  .table.art .n { display: none; }
  .table:not(.art) .n { width: 24px; text-align: center; }
  .thumb { width: 48px !important; height: 48px !important; border-radius: 6px !important; }
  .title { pointer-events: none; }
  .name { font-size: 15px; font-weight: 550; }
  .by { font-size: 13px; }
  .more { margin-right: -6px; color: var(--text-2); }
}
</style>
