<script setup lang="ts">
import { Check, Cloud, Globe, Laptop, Smartphone } from "lucide-vue-next";
import DiagramFrame from "./DiagramFrame.vue";

/** Signed in to an account: Spotify connects once, to the account, and every device gets it from there. */
const devices = [
  { icon: Laptop, y: 16 },
  { icon: Smartphone, y: 48 },
  { icon: Globe, y: 80 },
];
const HUB = { x: 116, y: 48 };
const DEVICE_X = 220;
</script>

<template>
  <DiagramFrame label="Diagram: Spotify connects once to your account, and your laptop, phone and browser all get the connection from it.">
    <div class="dg-stage stage">
      <svg class="wires" width="252" height="96" viewBox="0 0 252 96" aria-hidden="true">
        <line x1="32" y1="48" x2="64" y2="48" />
        <line v-for="(d, i) in devices" :key="i" :x1="HUB.x" :y1="HUB.y" :x2="DEVICE_X" :y2="d.y" />
      </svg>

      <span class="spot"><span class="spot-glyph"><i /><i /><i /></span></span>
      <span class="hub"><Cloud :size="24" :stroke-width="2" /></span>

      <span class="packet first" />
      <span
        v-for="(d, i) in devices"
        :key="`p-${i}`"
        class="packet"
        :style="{ '--i': i, '--dx': `${DEVICE_X - HUB.x - 4}px`, '--dy': `${d.y - HUB.y}px` }"
      />

      <span v-for="(d, i) in devices" :key="`d-${i}`" class="device" :style="{ top: `${d.y - 14}px`, '--i': i }">
        <component :is="d.icon" :size="16" />
        <span class="badge"><Check :size="8" :stroke-width="3.5" /></span>
      </span>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.stage { width: 252px; height: 96px; }
.wires { position: absolute; inset: 0; overflow: visible; }
.wires line { stroke: var(--text-3); stroke-width: 1.5; stroke-dasharray: 3 3; }

.spot {
  position: absolute;
  left: 4px;
  top: 34px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--dg-spotify);
}
.spot-glyph { display: flex; flex-direction: column; gap: 2px; transform: rotate(-8deg); }
.spot-glyph i { display: block; height: 2px; border-radius: 1px; background: #0b0b0c; }
.spot-glyph i:nth-child(1) { width: 13px; }
.spot-glyph i:nth-child(2) { width: 10px; margin-left: 1px; }
.spot-glyph i:nth-child(3) { width: 7px; margin-left: 2px; }

.hub {
  position: absolute;
  left: 64px;
  top: 22px;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--raised);
  box-shadow: inset 0 0 0 1.5px var(--accent);
  color: var(--accent);
}

.device {
  position: absolute;
  left: 220px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text);
}
.badge {
  position: absolute;
  right: -5px;
  top: -5px;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--dg-spotify);
  color: #0b0b0c;
  box-shadow: 0 0 0 2px var(--panel);
}

.packet { position: absolute; left: 112px; top: 44px; width: 8px; height: 8px; border-radius: 50%; background: var(--dg-spotify); opacity: 0; }
.packet.first { left: 28px; }

/* 5 s loop: Spotify → account once, then account → each device. */
.packet.first { animation: first 5s var(--dg-ease) infinite both; }
.packet:not(.first) { animation: fan 5s var(--dg-ease) calc(var(--i) * 0.3s) infinite both; }
.badge { animation: badge 5s var(--dg-ease) calc(var(--i) * 0.3s) infinite both; }
.hub { animation: hub 5s ease-out infinite both; }

@keyframes first {
  0%, 4% { opacity: 0; transform: translateX(0); }
  7% { opacity: 1; transform: translateX(0); }
  18% { opacity: 1; transform: translateX(40px); }
  20%, 100% { opacity: 0; transform: translateX(40px); }
}
@keyframes hub {
  0%, 18% { transform: scale(1); }
  22% { transform: scale(1.08); }
  28%, 100% { transform: scale(1); }
}
@keyframes fan {
  0%, 22% { opacity: 0; transform: translate(0, 0); }
  25% { opacity: 1; transform: translate(0, 0); }
  40% { opacity: 1; transform: translate(var(--dx), var(--dy)); }
  42%, 100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
}
@keyframes badge {
  0%, 40% { opacity: 0; transform: scale(0.3); }
  45% { opacity: 1; transform: scale(1.2); }
  49%, 88% { opacity: 1; transform: scale(1); }
  96%, 100% { opacity: 0; transform: scale(1); }
}
</style>
