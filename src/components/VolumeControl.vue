<script setup lang="ts">
import { computed } from "vue";
import { Volume, Volume1, Volume2, VolumeX } from "lucide-vue-next";
import { usePlayer } from "@/stores/player";

const player = usePlayer();
const icon = computed(() => {
  if (player.muted || player.volume === 0) return VolumeX;
  if (player.volume < 0.35) return Volume;
  if (player.volume < 0.7) return Volume1;
  return Volume2;
});

function onWheel(event: WheelEvent) {
  player.volume = Math.min(1, Math.max(0, player.volume - Math.sign(event.deltaY) * 0.05));
}
</script>

<template>
  <div class="volume no-drag" @wheel.prevent="onWheel">
    <button class="icon-btn" :title="player.muted ? 'Unmute' : 'Mute'" @click="player.muted = !player.muted">
      <component :is="icon" :size="17" />
    </button>
    <input
      v-model.number="player.volume"
      type="range"
      min="0"
      max="1"
      step="0.01"
      :style="{ '--fill': `${(player.muted ? 0 : player.volume) * 100}%` }"
      aria-label="Volume"
    />
  </div>
</template>

<style scoped>
.volume { display: flex; align-items: center; gap: 2px; }
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 88px;
  height: 4px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: linear-gradient(to right, var(--text-2) var(--fill), var(--active) var(--fill));
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.15s;
}
.volume:hover input::-webkit-slider-thumb { opacity: 1; }
.volume:hover input { background: linear-gradient(to right, var(--accent) var(--fill), var(--active) var(--fill)); }
</style>
