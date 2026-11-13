<script setup lang="ts">
// The "LCD" in the middle of the chrome bar, like Cider's: artwork, title,
// artist, and a scrubbable mini waveform that shows elapsed/remaining on hover.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { AudioLines, Maximize2 } from "lucide-vue-next";
import { seconds } from "@/lib/format";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";
import Waveform from "./Waveform.vue";

const player = usePlayer();
const ui = useUi();
const router = useRouter();
const track = computed(() => player.current);
const remaining = computed(() => Math.max(0, player.duration - player.currentTime));
</script>

<template>
  <div class="lcd no-drag" :class="{ idle: !track }">
    <template v-if="track">
      <button class="art" title="Open immersive player" @click="ui.immersive = true">
        <Artwork :src="track.artworkUrl" :size="48" :radius="0" />
        <Maximize2 class="expand" :size="16" />
      </button>
      <div class="body">
        <div class="meta">
          <span class="time">{{ seconds(player.currentTime) }}</span>
          <div class="lines">
            <a class="title ellipsis" @click="router.push(`/track/${track.id}`)">{{ track.title }}</a>
            <a class="artist ellipsis" @click="router.push(`/user/${track.user.id}`)">{{ track.user.username }}</a>
          </div>
          <span class="time">-{{ seconds(remaining) }}</span>
        </div>
        <Waveform
          class="wave"
          :samples="track.waveform"
          :progress="player.progress"
          :duration="track.duration"
          :height="10"
          :bar="2"
          :gap="1"
          :reflection="false"
          @seek="player.seekFraction"
        />
      </div>
    </template>
    <div v-else class="idle-mark">
      <AudioLines :size="20" />
    </div>
  </div>
</template>

<style scoped>
.lcd {
  display: flex;
  width: min(460px, 38vw);
  height: 48px;
  border-radius: 9px;
  background: var(--hover);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
}
.lcd.idle { justify-content: center; align-items: center; color: var(--text-3); }
.art { position: relative; flex: none; }
.expand {
  position: absolute;
  inset: 0;
  margin: auto;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
}
.art:hover .expand { opacity: 1; }
.art:hover :deep(img) { filter: brightness(0.55); }
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 10px 4px;
}
.meta { display: flex; align-items: center; gap: 8px; }
.lines { flex: 1; min-width: 0; text-align: center; line-height: 1.25; }
.title { display: block; font-weight: 600; font-size: 12.5px; }
.artist { display: block; font-size: 11.5px; color: var(--text-2); }
.time {
  flex: none;
  width: 40px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.15s;
}
.time:last-child { text-align: right; }
.lcd:hover .time { opacity: 1; }
.wave { margin-top: 2px; }
</style>
