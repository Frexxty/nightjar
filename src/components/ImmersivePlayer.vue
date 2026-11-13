<script setup lang="ts">
// Full-window player: blurred, slowly drifting artwork behind large artwork,
// a full waveform with timed comments, and Up Next / Comments tabs on the side.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ChevronDown, Heart, Loader2, Pause, Play, Repeat, Repeat1, Repeat2, Shuffle, SkipBack, SkipForward,
} from "lucide-vue-next";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";
import CommentFeed from "./CommentFeed.vue";
import QueueList from "./QueueList.vue";
import VolumeControl from "./VolumeControl.vue";
import Waveform from "./Waveform.vue";

const player = usePlayer();
const library = useLibrary();
const settings = useSettings();
const ui = useUi();
const router = useRouter();
const tab = ref<"comments" | "queue">("comments");
const track = computed(() => player.current);

function close() {
  ui.immersive = false;
}
function go(path: string) {
  close();
  void router.push(path);
}
const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

// The backdrop blobs used to be 90vmax images with filter: blur(90px), which
// the GPU re-blurs on every frame of the drift animation. Blurring the artwork
// once into a small canvas and letting CSS scale it up looks the same, and the
// animation then only moves a cheap texture around.
const BLOB = 96;
const blobA = ref<HTMLCanvasElement>();
const blobB = ref<HTMLCanvasElement>();
let paintToken = 0;
async function paintBlobs(src: string | null | undefined) {
  const token = ++paintToken;
  let img: HTMLImageElement | null = null;
  if (src) {
    img = new Image();
    img.src = src;
    await img.decode().catch(() => (img = null));
    if (token !== paintToken) return;
  }
  // Clip to a circle first, then blur, so the edge fades out like the old blurred round image.
  const disc = document.createElement("canvas");
  disc.width = disc.height = BLOB;
  const d = disc.getContext("2d")!;
  if (img) {
    const r = BLOB * 0.375;
    d.beginPath();
    d.arc(BLOB / 2, BLOB / 2, r, 0, Math.PI * 2);
    d.clip();
    // Centre-crop to a square like object-fit: cover. SVGs with only a viewBox report no size.
    const { naturalWidth: w, naturalHeight: h } = img;
    const side = Math.min(w, h);
    if (side) d.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, BLOB / 2 - r, BLOB / 2 - r, r * 2, r * 2);
    else d.drawImage(img, BLOB / 2 - r, BLOB / 2 - r, r * 2, r * 2);
  }
  for (const el of [blobA.value, blobB.value]) {
    const ctx = el?.getContext("2d");
    if (!ctx) continue;
    ctx.clearRect(0, 0, BLOB, BLOB);
    ctx.filter = `blur(${BLOB * 0.06}px) saturate(1.6)`;
    ctx.drawImage(disc, 0, 0);
  }
}
watch(() => track.value?.artworkUrl, paintBlobs, { flush: "post" });
onMounted(() => void paintBlobs(track.value?.artworkUrl));
</script>

<template>
  <div class="immersive" :class="{ still: !settings.immersiveMotion }">
    <div class="backdrop">
      <canvas ref="blobA" :width="BLOB" :height="BLOB" class="blob a" />
      <canvas ref="blobB" :width="BLOB" :height="BLOB" class="blob b" />
      <div class="shade" />
    </div>

    <header class="drag">
      <button class="icon-btn no-drag" title="Close (Esc)" @click="close"><ChevronDown :size="22" /></button>
    </header>

    <main v-if="track">
      <section class="stage">
        <Artwork :src="track.artworkUrl" class="cover" :radius="14" />
        <div class="info">
          <div class="titles">
            <h1 class="ellipsis"><a @click="go(`/track/${track.id}`)">{{ track.title }}</a></h1>
            <p class="ellipsis"><a @click="go(`/user/${track.user.id}`)">{{ track.user.username }}</a></p>
          </div>
          <button class="icon-btn" :class="{ on: library.isReposted(track) }" title="Repost" @click="library.toggleRepost(track)">
            <Repeat2 :size="20" />
          </button>
          <button class="icon-btn" :class="{ on: library.isLiked(track) }" title="Like" @click="library.toggleLike(track)">
            <Heart :size="20" :fill="library.isLiked(track) ? 'currentColor' : 'none'" />
          </button>
        </div>
        <Waveform
          :samples="track.waveform"
          :progress="player.progress"
          :duration="track.duration"
          :comments="settings.showCommentsOnWaveform ? player.comments : []"
          :height="72"
          color="#ffffff"
          @seek="player.seekFraction"
        />
        <div class="controls">
          <button class="icon-btn" :class="{ on: player.shuffle }" title="Shuffle" @click="player.toggleShuffle()"><Shuffle :size="18" /></button>
          <button class="icon-btn big" title="Previous" @click="player.prev()"><SkipBack :size="26" fill="currentColor" /></button>
          <button class="play" :title="player.playing ? 'Pause' : 'Play'" @click="player.toggle()">
            <Loader2 v-if="player.state === 'loading'" class="spin" :size="30" />
            <Pause v-else-if="player.playing" :size="30" fill="currentColor" />
            <Play v-else :size="30" fill="currentColor" />
          </button>
          <button class="icon-btn big" title="Next" @click="player.next()"><SkipForward :size="26" fill="currentColor" /></button>
          <button class="icon-btn" :class="{ on: player.repeat !== 'off' }" title="Repeat" @click="player.cycleRepeat()">
            <Repeat1 v-if="player.repeat === 'one'" :size="18" />
            <Repeat v-else :size="18" />
          </button>
        </div>
        <VolumeControl class="vol" />
      </section>

      <section class="side">
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'comments' }" @click="tab = 'comments'">Comments</button>
          <button class="tab" :class="{ active: tab === 'queue' }" @click="tab = 'queue'">Up Next</button>
        </div>
        <CommentFeed v-if="tab === 'comments'" large />
        <QueueList v-else />
      </section>
    </main>
    <p v-else class="nothing">Nothing playing.</p>
  </div>
</template>

<style scoped>
.immersive {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  color: #fff;
  background: #000;
  --text: #fff;
  --text-2: rgba(255, 255, 255, 0.7);
  --text-3: rgba(255, 255, 255, 0.45);
  --hover: rgba(255, 255, 255, 0.1);
  --active: rgba(255, 255, 255, 0.16);
  --border: rgba(255, 255, 255, 0.12);
  --wave: rgba(255, 255, 255, 0.3);
  --panel: #000;
}
.backdrop { position: absolute; inset: 0; overflow: hidden; }
/* The canvas holds a pre-blurred disc 3/4 its width, so 120vmax here is the old 90vmax blob plus room for the blur. */
.blob {
  position: absolute;
  width: 120vmax;
  height: 120vmax;
  opacity: 0.75;
}
.blob.a { top: -45vmax; left: -35vmax; animation: drift-a 38s ease-in-out infinite alternate; }
.blob.b { bottom: -55vmax; right: -40vmax; animation: drift-b 46s ease-in-out infinite alternate; transform: rotate(180deg); }
.still .blob { animation: none; }
@media (prefers-reduced-motion: reduce) { .blob { animation: none; } }
.shade { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.6)); }
@keyframes drift-a { to { transform: translate(18vmax, 12vmax) rotate(40deg) scale(1.15); } }
@keyframes drift-b { to { transform: translate(-16vmax, -10vmax) rotate(220deg) scale(1.2); } }

header { position: relative; height: 52px; display: flex; align-items: center; padding: 0 16px 0 90px; }
:root:not([data-platform="darwin"]) header { padding-left: 16px; }
main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 6vw;
  padding: 2vh 6vw 6vh;
}
.stage { display: flex; flex-direction: column; justify-content: center; gap: 18px; min-width: 0; max-width: 560px; justify-self: center; width: 100%; }
.cover { width: min(100%, 52vh) !important; align-self: center; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5); animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes rise { from { transform: translateY(16px) scale(0.97); opacity: 0; } }
.info { display: flex; align-items: center; gap: 4px; }
.titles { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 24px; font-weight: 750; letter-spacing: -0.01em; }
.info p { margin: 2px 0 0; font-size: 16px; color: var(--text-2); }
.info a { cursor: pointer; }
.controls { display: flex; align-items: center; justify-content: center; gap: 14px; }
.icon-btn { color: var(--text-2); }
.icon-btn.big { width: 48px; height: 48px; color: #fff; }
.icon-btn.on { color: #fff; background: var(--active); }
.play {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: #fff;
  color: #000;
  transition: transform 0.12s;
}
.play:hover { transform: scale(1.05); }
.play:active { transform: scale(0.95); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.vol { align-self: center; }
.side { display: flex; flex-direction: column; min-height: 0; padding-top: 4vh; }
.side .tabs { justify-content: center; }
.side .tab.active { background: #fff; color: #000; }
.side > :last-child { flex: 1; min-height: 0; }
.side :deep(.list) { mask-image: linear-gradient(transparent, #000 15%, #000 85%, transparent); }
.side :deep(.compose) { border-top: 0; }
.nothing { position: relative; text-align: center; margin-top: 30vh; color: var(--text-2); }
</style>
