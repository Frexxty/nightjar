<script setup lang="ts">
import { computed } from "vue";
import { Check, Copy, KeyRound, Link2, MousePointer2 } from "lucide-vue-next";
import AppMark from "./AppMark.vue";
import DiagramFrame from "./DiagramFrame.vue";

/**
 * One illustration per Spotify setup step. `done` holds the finished frame
 * still; otherwise the step plays its loop.
 */
const props = defineProps<{ step: 1 | 2 | 3 | 4 | 5; done?: boolean }>();

const labels: Record<number, string> = {
  1: "Illustration: a browser window showing the Spotify developer dashboard.",
  2: "Illustration: a new app in the dashboard with Web API and Web Playback SDK ticked.",
  3: "Illustration: the two redirect links are copied into the Redirect URIs field of the app form.",
  4: "Illustration: the Client ID is copied from the Spotify dashboard into the app.",
  5: "Illustration: the app connects to Spotify and the connection is confirmed.",
};
const label = computed(() => labels[props.step]);
</script>

<template>
  <DiagramFrame :label="label" :still="props.done" class="art" :class="{ done: props.done }">
    <div class="dg-stage stage">
      <!-- 1. The dashboard in a browser -->
      <template v-if="step === 1">
        <div class="dg-panel win">
          <span class="dg-chrome bar-dots"><i /><i /><i /></span>
          <span class="address"><span class="dg-dot" style="--c: var(--dg-spotify)" />developer.spotify.com<span class="loading" /></span>
          <span v-for="n in 6" :key="n" class="tile" :style="{ '--i': n - 1, left: `${10 + ((n - 1) % 3) * 52}px`, top: `${30 + Math.floor((n - 1) / 3) * 34}px` }">
            <span class="tile-icon" /><span class="tile-line" />
          </span>
        </div>
      </template>

      <!-- 2. The new app, two boxes ticked -->
      <template v-else-if="step === 2">
        <div class="dg-panel win">
          <span class="app-title"><span class="app-icon" /><span class="dg-label">Create app</span></span>
          <span v-for="(name, i) in ['Web API', 'Web Playback SDK']" :key="name" class="opt" :style="{ top: `${40 + i * 26}px`, '--i': i }">
            <span class="box"><span class="box-fill"><Check :size="9" :stroke-width="3.5" /></span></span>
            <span class="opt-name">{{ name }}</span>
          </span>
          <MousePointer2 class="cursor two" :size="14" fill="currentColor" />
        </div>
      </template>

      <!-- 3. Both redirect links copied into the form -->
      <template v-else-if="step === 3">
        <span v-for="i in 2" :key="i" class="link-row" :style="{ top: `${(i - 1) * 21}px`, '--i': i - 1 }">
          <Link2 :size="11" /><span class="link-line" /><span class="copy"><Copy :size="10" /><span class="ring" /></span>
        </span>
        <div class="dg-panel form">
          <span class="dg-label form-label"><span class="dg-dot" style="--c: var(--dg-spotify)" />Redirect URIs</span>
          <span v-for="i in 2" :key="i" class="slot" :style="{ top: `${24 + (i - 1) * 15}px` }">
            <span class="slot-fill" :style="{ '--i': i - 1 }"><Link2 :size="8" /><span class="slot-line" /></span>
          </span>
        </div>
        <span v-for="i in 2" :key="i" class="chip3" :style="{ top: `${(i - 1) * 21 + 2}px`, '--i': i - 1, '--dy': `${67 - (i - 1) * 6}px` }">
          <Link2 :size="9" />
        </span>
      </template>

      <!-- 4. Client ID from the dashboard into the app -->
      <template v-else-if="step === 4">
        <div class="dg-panel half from">
          <span class="dg-label half-head"><span class="dg-dot" style="--c: var(--dg-spotify)" />Spotify</span>
          <span class="half-caption">Client ID</span>
          <span class="id-ghost" />
        </div>
        <div class="dg-panel half to">
          <span class="half-head"><span class="dg-chrome"><i /><i /><i /></span><AppMark class="mark" /></span>
          <span class="input"><span class="ok"><Check :size="8" :stroke-width="3.5" /></span></span>
        </div>
        <span class="key-chip"><KeyRound :size="10" /><span>1a2b…</span></span>
      </template>

      <!-- 5. Connected -->
      <template v-else>
        <span class="wire" />
        <span class="wire solid" />
        <span class="packet out" />
        <span class="packet back" />
        <span class="node spot"><span class="spot-glyph"><i /><i /><i /></span></span>
        <span class="node app"><AppMark class="mark big" /><span class="badge"><Check :size="10" :stroke-width="3.5" /></span></span>
        <span class="dg-label node-label l">Spotify</span>
      </template>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.stage { width: 168px; height: 100px; }
.win { inset: 0; }

/* 1 */
.bar-dots { position: absolute; top: 9px; left: 9px; }
.address {
  position: absolute;
  top: 5px;
  left: 34px;
  right: 7px;
  height: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--active);
  font-size: 8.5px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.address .dg-dot { width: 5px; height: 5px; }
.loading { position: absolute; left: 0; right: 0; bottom: 0; height: 1.5px; background: var(--dg-spotify); transform-origin: left; transform: scaleX(0); }
.tile {
  position: absolute;
  width: 46px;
  height: 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--border);
}
.tile-icon { width: 8px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--dg-spotify) 70%, var(--text-3)); }
.tile:nth-child(odd) .tile-icon { background: var(--text-3); }
.tile-line { width: 70%; height: 3px; border-radius: 2px; background: var(--text-3); }
.loading { animation: load 4.6s ease-in-out infinite both; }
.tile { animation: tile 4.6s var(--dg-ease) calc(0.5s + var(--i) * 0.12s) infinite both; }
@keyframes load {
  0% { opacity: 1; transform: scaleX(0); }
  14% { opacity: 1; transform: scaleX(1); }
  20%, 100% { opacity: 0; transform: scaleX(1); }
}
@keyframes tile {
  0% { opacity: 0; transform: translateY(5px) scale(0.92); }
  10%, 82% { opacity: 1; transform: none; }
  92%, 100% { opacity: 0; transform: none; }
}

/* 2 */
.app-title { position: absolute; top: 10px; left: 10px; display: flex; align-items: center; gap: 6px; }
.app-icon { width: 14px; height: 14px; border-radius: 4px; background: var(--dg-spotify); }
.opt { position: absolute; left: 10px; display: flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 600; color: var(--text); }
.box { position: relative; width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1.5px var(--text-3); }
.box-fill { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 4px; background: var(--dg-spotify); color: #0b0b0c; }
.cursor { position: absolute; left: 0; top: 0; color: var(--text); opacity: 0; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35)); }
.box-fill { animation: tickbox 4.4s var(--dg-ease) calc(var(--i) * 0.9s) infinite both; }
.cursor.two { animation: cursor2 4.4s var(--dg-ease) infinite both; }
@keyframes tickbox {
  0%, 22% { opacity: 0; transform: scale(0.4); }
  27% { opacity: 1; transform: scale(1.15); }
  31%, 84% { opacity: 1; transform: scale(1); }
  92%, 100% { opacity: 0; transform: scale(1); }
}
/* Box centres: (17, 47) and (17, 73). The pointer's tip is its top-left. */
@keyframes cursor2 {
  0% { opacity: 0; transform: translate(130px, 78px); }
  6% { opacity: 1; transform: translate(130px, 78px); }
  20% { opacity: 1; transform: translate(18px, 48px); }
  23% { opacity: 1; transform: translate(18px, 48px) scale(0.85); }
  26% { opacity: 1; transform: translate(18px, 48px); }
  41% { opacity: 1; transform: translate(18px, 74px); }
  43% { opacity: 1; transform: translate(18px, 74px) scale(0.85); }
  46% { opacity: 1; transform: translate(18px, 74px); }
  62%, 100% { opacity: 0; transform: translate(60px, 92px); }
}

/* 3 */
.link-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 17px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 7px;
  border-radius: 6px;
  background: var(--active);
  color: var(--text-2);
}
.link-line { flex: 1; height: 4px; border-radius: 2px; background: var(--text-3); }
.copy { position: relative; display: grid; place-items: center; width: 14px; height: 14px; color: var(--text-2); }
.ring { position: absolute; inset: -2px; border-radius: 5px; box-shadow: 0 0 0 1.5px var(--accent); opacity: 0; }
.form { left: 0; right: 0; top: 46px; bottom: 0; }
.form-label { position: absolute; top: 9px; left: 8px; }
.slot { position: absolute; left: 8px; right: 8px; height: 12px; border-radius: 4px; background: var(--hover); box-shadow: inset 0 0 0 1px var(--border); }
.slot-fill { position: absolute; inset: 0; display: flex; align-items: center; gap: 4px; padding: 0 5px; color: var(--text-2); }
.slot-line { flex: 1; height: 3px; border-radius: 2px; background: var(--text-3); }
.chip3 {
  position: absolute;
  right: 3px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 13px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--accent-text);
  opacity: 0;
}
.ring { animation: ring 4.8s ease-out calc(var(--i) * 1.4s) infinite both; }
.chip3 { animation: chip3 4.8s var(--dg-ease) calc(var(--i) * 1.4s) infinite both; }
.slot-fill { animation: slot 4.8s linear calc(var(--i) * 1.4s) infinite both; }
@keyframes ring {
  0%, 4% { opacity: 0; transform: scale(0.8); }
  7% { opacity: 1; transform: scale(1); }
  16%, 100% { opacity: 0; transform: scale(1.6); }
}
@keyframes chip3 {
  0%, 8% { opacity: 0; transform: translate(0, 0); }
  11% { opacity: 1; transform: translate(0, 0); }
  26% { opacity: 1; transform: translate(-134px, var(--dy)); }
  29%, 100% { opacity: 0; transform: translate(-134px, var(--dy)); }
}
@keyframes slot {
  0%, 26% { opacity: 0; }
  29%, 86% { opacity: 1; }
  94%, 100% { opacity: 0; }
}

/* 4 */
.half { top: 0; bottom: 0; width: 76px; }
.from { left: 0; }
.to { right: 0; }
.half-head { position: absolute; top: 9px; left: 8px; display: flex; align-items: center; gap: 6px; }
.half-caption { position: absolute; top: 34px; left: 8px; font-size: 9.5px; font-weight: 600; color: var(--text-3); }
.id-ghost { position: absolute; top: 50px; left: 6px; width: 64px; height: 18px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--border); }
.mark { height: 8px; }
.input { position: absolute; top: 49px; left: 5px; right: 5px; height: 20px; border-radius: 5px; background: var(--hover); box-shadow: inset 0 0 0 1px var(--text-3); }
.ok {
  position: absolute;
  right: -5px;
  top: -6px;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
}
.key-chip {
  position: absolute;
  top: 51px;
  left: 98px;
  height: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dg-spotify) 22%, var(--raised));
  color: var(--text);
  font: 600 9.5px/1 ui-monospace, "SF Mono", Menlo, monospace;
  white-space: nowrap;
}
.key-chip { animation: key 4.2s var(--dg-ease) infinite both; }
.ok { animation: ok 4.2s var(--dg-ease) infinite both; }
@keyframes key {
  0% { opacity: 0; transform: translateX(-91px); }
  8%, 22% { opacity: 1; transform: translateX(-91px); }
  44%, 86% { opacity: 1; transform: translateX(0); }
  94%, 100% { opacity: 0; transform: translateX(0); }
}
@keyframes ok {
  0%, 44% { opacity: 0; transform: scale(0.3); }
  50% { opacity: 1; transform: scale(1.2); }
  54%, 86% { opacity: 1; transform: scale(1); }
  94%, 100% { opacity: 0; transform: scale(1); }
}

/* 5 */
.node {
  position: absolute;
  top: 22px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
}
.spot { left: 14px; background: var(--dg-spotify); }
.spot-glyph { display: flex; flex-direction: column; gap: 3px; transform: rotate(-8deg); }
.spot-glyph i { display: block; height: 2.5px; border-radius: 2px; background: #0b0b0c; }
.spot-glyph i:nth-child(1) { width: 20px; }
.spot-glyph i:nth-child(2) { width: 16px; margin-left: 1px; }
.spot-glyph i:nth-child(3) { width: 12px; margin-left: 2px; }
.app { right: 14px; background: var(--raised); box-shadow: inset 0 0 0 1.5px var(--border); }
.mark.big { height: 13px; }
.badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--dg-spotify);
  color: #0b0b0c;
  box-shadow: 0 0 0 2px var(--panel);
}
.node-label { position: absolute; top: 74px; }
.node-label.l { left: 16px; }
.wire { position: absolute; top: 43px; left: 58px; right: 58px; height: 2px; border-top: 2px dashed var(--text-3); }
.wire.solid { border-top-style: solid; border-color: var(--dg-spotify); }
.packet { position: absolute; top: 40px; left: 56px; width: 8px; height: 8px; border-radius: 50%; opacity: 0; }
.packet.out { background: var(--accent); }
.packet.back { background: var(--dg-spotify); }
.wire.solid { animation: wire 4.6s linear infinite both; }
.packet.out { animation: out 4.6s var(--dg-ease) infinite both; }
.packet.back { animation: back 4.6s var(--dg-ease) infinite both; }
.badge { animation: badge 4.6s var(--dg-ease) infinite both; }
/* The wire is 52 px long: the request goes app → Spotify, the approval comes back. */
@keyframes out {
  0%, 6% { opacity: 0; transform: translateX(44px); }
  9% { opacity: 1; transform: translateX(44px); }
  28% { opacity: 1; transform: translateX(0); }
  31%, 100% { opacity: 0; transform: translateX(0); }
}
@keyframes back {
  0%, 34% { opacity: 0; transform: translateX(0); }
  37% { opacity: 1; transform: translateX(0); }
  56% { opacity: 1; transform: translateX(44px); }
  59%, 100% { opacity: 0; transform: translateX(44px); }
}
@keyframes wire {
  0%, 56% { opacity: 0; }
  60%, 88% { opacity: 1; }
  96%, 100% { opacity: 0; }
}
@keyframes badge {
  0%, 57% { opacity: 0; transform: scale(0.3); }
  62% { opacity: 1; transform: scale(1.2); }
  66%, 88% { opacity: 1; transform: scale(1); }
  96%, 100% { opacity: 0; transform: scale(1); }
}
</style>
