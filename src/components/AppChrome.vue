<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  ChevronLeft, ChevronRight, Heart, ListMusic, Loader2, MessageSquareText, Pause, Play,
  Repeat, Repeat1, Shuffle, SkipBack, SkipForward,
} from "lucide-vue-next";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import NowPlayingLcd from "./NowPlayingLcd.vue";
import VolumeControl from "./VolumeControl.vue";

const player = usePlayer();
const library = useLibrary();
const ui = useUi();
const router = useRouter();
const liked = computed(() => !!player.current && library.isLiked(player.current));
</script>

<template>
  <header class="chrome drag">
    <div class="left">
      <button class="icon-btn no-drag" title="Back" @click="router.back()"><ChevronLeft :size="20" /></button>
      <button class="icon-btn no-drag" title="Forward" @click="router.forward()"><ChevronRight :size="20" /></button>
    </div>

    <div class="center">
      <div class="controls no-drag">
        <button class="icon-btn" :class="{ on: player.shuffle }" title="Shuffle" @click="player.toggleShuffle()">
          <Shuffle :size="16" />
        </button>
        <button class="icon-btn" title="Previous" :disabled="!player.current" @click="player.prev()">
          <SkipBack :size="18" fill="currentColor" />
        </button>
        <button class="play" :title="player.playing ? 'Pause' : 'Play'" :disabled="!player.current" @click="player.toggle()">
          <Loader2 v-if="player.state === 'loading'" class="spin" :size="20" />
          <Pause v-else-if="player.playing" :size="20" fill="currentColor" />
          <Play v-else :size="20" fill="currentColor" />
        </button>
        <button class="icon-btn" title="Next" :disabled="!player.current" @click="player.next()">
          <SkipForward :size="18" fill="currentColor" />
        </button>
        <button class="icon-btn" :class="{ on: player.repeat !== 'off' }" :title="`Repeat: ${player.repeat}`" @click="player.cycleRepeat()">
          <Repeat1 v-if="player.repeat === 'one'" :size="16" />
          <Repeat v-else :size="16" />
        </button>
      </div>
      <NowPlayingLcd />
    </div>

    <div class="right">
      <button
        class="icon-btn no-drag"
        :class="{ on: liked }"
        :disabled="!player.current"
        :title="liked ? 'Unlike' : 'Like'"
        @click="player.current && library.toggleLike(player.current)"
      >
        <Heart :size="17" :fill="liked ? 'currentColor' : 'none'" />
      </button>
      <VolumeControl />
      <button class="icon-btn no-drag" :class="{ on: ui.drawer === 'comments' }" title="Comments" @click="ui.toggleDrawer('comments')">
        <MessageSquareText :size="17" />
      </button>
      <button class="icon-btn no-drag" :class="{ on: ui.drawer === 'queue' }" title="Up Next" @click="ui.toggleDrawer('queue')">
        <ListMusic :size="17" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.chrome {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  height: var(--chrome-height);
  padding: 0 14px;
}
:root:not([data-platform="darwin"]) .chrome { padding-right: 150px; }
.left, .right { display: flex; align-items: center; gap: 2px; }
.right { justify-content: flex-end; }
.center { display: flex; align-items: center; gap: 14px; }
.controls { display: flex; align-items: center; gap: 2px; }
.play {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--text);
  transition: background 0.15s, transform 0.1s;
}
.play:hover { background: var(--hover); }
.play:active { transform: scale(0.92); }
.play:disabled { opacity: 0.35; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1120px) {
  .controls .icon-btn:first-child, .controls .icon-btn:last-child { display: none; }
}
</style>
