<script setup lang="ts">
// Phone layout: the immersive player as a full-screen sheet. Swipe it down or
// tap the chevron to close. Queue and comments open as a second sheet on top.
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import {
  ChevronDown, Heart, ListMusic, Loader2, MessageSquareText, MoreHorizontal, Pause, Play,
  Repeat, Repeat1, Repeat2, Shuffle, SkipBack, SkipForward, X,
} from "lucide-vue-next";
import { seconds } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useSheetDrag } from "@/lib/sheet";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";
import ArtworkBackdrop from "./ArtworkBackdrop.vue";
import CommentFeed from "./CommentFeed.vue";
import QueueList from "./QueueList.vue";
import SpotifyIcon from "./SpotifyIcon.vue";
import Waveform from "./Waveform.vue";

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const menus = useMenus();
const router = useRouter();
const track = computed(() => player.current);

/** Fades a scrim in step with its sheet: opaque when the sheet is open, clear when it's gone. */
function scrimFollows(scrim: Ref<HTMLElement | undefined>) {
  return (p: number, ms: number) => {
    const el = scrim.value;
    if (!el) return;
    el.style.transition = ms ? `opacity ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)` : "none";
    el.style.opacity = String(1 - p);
  };
}

const sheet = ref<HTMLElement>();
const sheetScrim = ref<HTMLElement>();
const drag = useSheetDrag({
  sheet,
  dismiss: () => (ui.immersive = false),
  progress: scrimFollows(sheetScrim),
  ignore: ".waveform, .panel-layer",
});

const panel = ref<HTMLElement>();
const panelScrim = ref<HTMLElement>();
const panelDrag = useSheetDrag({ sheet: panel, dismiss: () => (ui.drawer = null), progress: scrimFollows(panelScrim) });

watch(() => ui.immersive, (open) => {
  if (!open) ui.drawer = null;
});

function close() {
  ui.immersive = false;
}
function go(path: string) {
  close();
  void router.push(path);
}

// The most recent timed comment, shown under the waveform like a subtitle.
const nowComment = computed(() => {
  const now = player.currentTime * 1000;
  let latest = null;
  for (const c of player.comments) if (c.timestamp != null && c.timestamp <= now) latest = c;
  return latest;
});

const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || !ui.immersive) return;
  if (ui.drawer) ui.drawer = null;
  else close();
};
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Transition :css="false" @enter="drag.enter" @leave="drag.leave">
    <div v-if="ui.immersive" class="np-layer">
      <div ref="sheetScrim" class="scrim" />
      <section ref="sheet" class="np" aria-label="Now Playing" @pointerdown="drag.onPointerDown">
        <ArtworkBackdrop :src="track?.artworkUrl" :still="!settings.immersiveMotion" />

        <header>
          <button class="icon-btn" title="Close" @click="close"><ChevronDown :size="28" /></button>
          <div class="grabber" aria-hidden="true" />
          <button v-if="track" class="icon-btn" title="More" @click="ui.openMenu($event, menus.track(track))"><MoreHorizontal :size="22" /></button>
          <span v-else />
        </header>

        <template v-if="track">
          <div class="cover-wrap">
            <div class="cover" :class="{ paused: !player.playing }">
              <Artwork :src="track.artworkUrl" :radius="12" />
            </div>
          </div>

          <div class="info">
            <div class="titles">
              <h1 class="ellipsis"><a @click="go(`/track/${track.id}`)">{{ track.title }}</a></h1>
              <p class="ellipsis">
                <span v-if="track.source === 'spotify'" class="spotify" title="Playing from Spotify"><SpotifyIcon :size="14" /></span>
                <a @click="go(`/user/${track.user.id}`)">{{ track.user.username }}</a>
              </p>
            </div>
            <button class="icon-btn" :class="{ on: library.isLiked(track) }" :title="library.isLiked(track) ? 'Unlike' : 'Like'" @click="library.toggleLike(track)">
              <Heart :size="24" :fill="library.isLiked(track) ? 'currentColor' : 'none'" />
            </button>
          </div>

          <Waveform
            class="wave"
            :samples="track.waveform"
            :progress="player.progress"
            :duration="track.duration"
            :comments="settings.showCommentsOnWaveform ? player.comments : []"
            :height="60"
            color="#ffffff"
            @seek="player.seekFraction"
          />
          <div class="times">
            <span>{{ seconds(player.currentTime) }}</span>
            <span>-{{ seconds(Math.max(0, player.duration - player.currentTime)) }}</span>
          </div>
          <button class="now-comment" :class="{ blank: !nowComment }" @click="ui.drawer = 'comments'">
            <template v-if="nowComment">
              <Artwork :src="nowComment.user.avatarUrl" :size="18" round />
              <span class="ellipsis"><b>{{ nowComment.user.username }}</b> {{ nowComment.body }}</span>
            </template>
          </button>

          <div class="controls">
            <button class="icon-btn" :class="{ on: player.shuffle }" title="Shuffle" @click="player.toggleShuffle()"><Shuffle :size="20" /></button>
            <button class="icon-btn big" title="Previous" @click="player.prev()"><SkipBack :size="30" fill="currentColor" /></button>
            <button class="play" :title="player.playing ? 'Pause' : 'Play'" @click="player.toggle()">
              <Loader2 v-if="player.state === 'loading'" class="spin" :size="30" />
              <Pause v-else-if="player.playing" :size="32" fill="currentColor" />
              <Play v-else :size="32" fill="currentColor" />
            </button>
            <button class="icon-btn big" title="Next" @click="player.next()"><SkipForward :size="30" fill="currentColor" /></button>
            <button class="icon-btn" :class="{ on: player.repeat !== 'off' }" :title="`Repeat: ${player.repeat}`" @click="player.cycleRepeat()">
              <Repeat1 v-if="player.repeat === 'one'" :size="20" />
              <Repeat v-else :size="20" />
            </button>
          </div>

          <div class="actions">
            <button class="icon-btn" :class="{ on: ui.drawer === 'comments' }" title="Comments" @click="ui.drawer = 'comments'"><MessageSquareText :size="22" /></button>
            <button v-if="track.source !== 'spotify'" class="icon-btn" :class="{ on: library.isReposted(track) }" title="Repost" @click="library.toggleRepost(track)"><Repeat2 :size="22" /></button>
            <button class="icon-btn" :class="{ on: ui.drawer === 'queue' }" title="Up Next" @click="ui.drawer = 'queue'"><ListMusic :size="22" /></button>
          </div>
        </template>
        <p v-else class="nothing">Nothing playing.</p>

        <Transition :css="false" @enter="panelDrag.enter" @leave="panelDrag.leave">
          <div v-if="ui.drawer" class="panel-layer">
            <div ref="panelScrim" class="panel-scrim" @click="ui.drawer = null" />
            <section ref="panel" class="panel" :aria-label="ui.drawer === 'queue' ? 'Queue' : 'Comments'">
              <div class="panel-head" @pointerdown="panelDrag.onPointerDown">
                <div class="grabber" aria-hidden="true" />
                <div class="seg">
                  <button :class="{ active: ui.drawer === 'queue' }" @click="ui.drawer = 'queue'">Queue</button>
                  <button :class="{ active: ui.drawer === 'comments' }" @click="ui.drawer = 'comments'">Comments</button>
                </div>
                <button class="icon-btn close" title="Close" @click="ui.drawer = null"><X :size="18" /></button>
              </div>
              <QueueList v-if="ui.drawer === 'queue'" />
              <CommentFeed v-else />
            </section>
          </div>
        </Transition>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.np-layer { position: fixed; inset: 0; z-index: 50; }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); }
.np {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: env(safe-area-inset-top) max(24px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  overflow: hidden;
  border-radius: 18px 18px 0 0;
  color: #fff;
  background: #000;
  touch-action: none;
  will-change: transform;
  --text: #fff;
  --text-2: rgba(255, 255, 255, 0.7);
  --text-3: rgba(255, 255, 255, 0.45);
  --hover: rgba(255, 255, 255, 0.1);
  --active: rgba(255, 255, 255, 0.16);
  --border: rgba(255, 255, 255, 0.12);
  --wave: rgba(255, 255, 255, 0.3);
  --panel: #1c1c1e;
  --raised: #2c2c2e;
  --overlay: rgba(44, 44, 46, 0.94);
}
/* Above the absolutely positioned backdrop. */
header, .cover-wrap, .info, .now-comment, .controls, .actions, .nothing { position: relative; }

header {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  height: 52px;
  margin: 0 -10px;
}
.grabber { justify-self: center; width: 38px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.35); }
.icon-btn { width: 44px; height: 44px; border-radius: 22px; color: var(--text-2); }
.icon-btn.on { color: var(--accent); background: none; }
header .icon-btn { color: #fff; }

.cover-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 8px 0 16px; }
.cover {
  width: min(100%, 44dvh);
  max-height: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1);
}
.cover.paused { transform: scale(0.86); }

.info { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.titles { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.2; }
.info p { margin: 2px 0 0; font-size: 17px; color: var(--text-2); }
.info a { cursor: pointer; }
.info .spotify { display: inline-flex; margin-right: 6px; vertical-align: -1px; color: #1ed760; }
.info .icon-btn { margin-right: -10px; }

/* The waveform's own time labels sit outside its edges, which this sheet clips. */
.wave :deep(.time.now), .wave :deep(.time.total) { display: none; }
.times {
  position: relative;
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.now-comment {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 28px;
  margin: 6px 0 4px;
  font-size: 13px;
  color: var(--text-2);
  text-align: left;
}
.now-comment b { color: #fff; font-weight: 600; margin-right: 2px; }
.now-comment.blank { pointer-events: none; }

.controls { display: flex; align-items: center; justify-content: space-between; margin: 6px -10px 10px; }
.icon-btn.big { width: 60px; height: 60px; border-radius: 30px; color: #fff; }
.play {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #fff;
  color: #000;
  transition: transform 0.12s ease-out;
}
.play:active, .icon-btn.big:active { transform: scale(0.9); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.actions { display: flex; justify-content: space-between; margin: 0 -10px; }
.nothing { flex: 1; display: grid; place-items: center; color: var(--text-2); }

.panel-layer { position: absolute; inset: 0; z-index: 2; }
.panel-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
.panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: min(76dvh, 680px);
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 18px 18px 0 0;
  background: rgba(28, 28, 30, 0.9);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.panel > :last-child { flex: 1; min-height: 0; }
.panel :deep(.list) { overscroll-behavior: contain; touch-action: pan-y; }
.panel-head {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  grid-template-rows: 18px auto;
  align-items: center;
  padding: 0 8px 10px;
  touch-action: none;
}
.panel-head .grabber { grid-column: 1 / -1; align-self: end; }
.seg { grid-column: 2; justify-self: center; display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--hover); }
.seg button { height: 32px; padding: 0 16px; border-radius: 8px; color: var(--text-2); font-weight: 600; }
.seg button.active { background: var(--raised); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
.close { grid-column: 3; }
</style>
