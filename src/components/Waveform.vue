<script setup lang="ts">
// SoundCloud-style waveform: bars above a dimmer reflection, filled up to the
// playhead, with a hover preview and optional comment avatars along the bottom.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Comment } from "@/api";
import { duration as fmt } from "@/lib/format";
import { useSettings } from "@/stores/settings";
import Artwork from "./Artwork.vue";

const props = withDefaults(
  defineProps<{
    samples?: number[] | null;
    /** 0..1, or null when this waveform isn't the playing track. */
    progress?: number | null;
    /** Track length in ms, for hover time and comment placement. */
    duration: number;
    comments?: Comment[];
    height?: number;
    bar?: number;
    gap?: number;
    reflection?: boolean;
    color?: string;
  }>(),
  { samples: null, progress: null, comments: () => [], height: 60, bar: 2, gap: 1, reflection: true, color: "" },
);

const emit = defineEmits<{ seek: [fraction: number] }>();

const root = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const width = ref(0);
const hover = ref<number | null>(null);
const activeComment = ref<Comment | null>(null);
let resizeObserver: ResizeObserver | undefined;
let viewObserver: IntersectionObserver | undefined;
let onScreen = false;

const pinned = computed(() => props.comments.filter((c) => c.timestamp != null && props.duration > 0));

function resample(samples: number[], count: number) {
  if (!samples.length) return new Array(count).fill(0.08);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i / count) * samples.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / count) * samples.length));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, samples[j] ?? 0);
    out.push(peak);
  }
  return out;
}

// What's on the canvas right now. Playback only moves the playhead, so a
// progress tick repaints just the bars that changed colour, which is usually
// none. Anything else (size, samples, colours, hover) repaints everything.
let peaks: number[] = [];
let accent = "";
let base = "";
let paintedPlayed = 0;
let full = true;
let frame = 0;

function schedule() {
  if (!frame && onScreen) frame = requestAnimationFrame(paint);
}
function invalidate() {
  full = true;
  schedule();
}

/** Index of the first bar at or after `x`, i.e. how many bars lie left of it. */
function barsBefore(x: number, step: number, count: number) {
  return Math.min(count, Math.max(0, Math.ceil(x / step)));
}

function drawBar(ctx: CanvasRenderingContext2D, i: number, played: number, hovered: number) {
  const h = props.height;
  const top = props.reflection ? h * 0.7 : h;
  const amp = Math.max(1, peaks[i] * top);
  const isPlayed = i < played;
  const inHover = hovered >= 0 && ((i >= played && i < hovered) || (i < played && i >= hovered));
  const x = i * (props.bar + props.gap);
  ctx.fillStyle = isPlayed ? accent : base;
  ctx.globalAlpha = inHover ? 0.65 : 1;
  ctx.fillRect(x, top - amp, props.bar, amp);
  if (props.reflection) {
    ctx.globalAlpha = (inHover ? 0.3 : 0.45) * (isPlayed ? 0.8 : 0.7);
    ctx.fillRect(x, top + 1, props.bar, Math.max(1, peaks[i] * (h - top - 1)));
  }
}

function paint() {
  frame = 0;
  const el = canvas.value;
  if (!el || !width.value || !onScreen) return;
  const step = props.bar + props.gap;
  const count = Math.max(1, Math.floor(width.value / step));
  const played = props.progress == null ? 0 : barsBefore(props.progress * width.value, step, count);
  const hovered = hover.value == null ? -1 : barsBefore(hover.value * width.value, step, count);
  const ctx = el.getContext("2d")!;

  if (!full && hovered < 0) {
    if (played === paintedPlayed) return;
    for (let i = Math.min(played, paintedPlayed); i < Math.max(played, paintedPlayed); i++) {
      ctx.clearRect(i * step - props.gap / 2, 0, step, props.height);
      drawBar(ctx, i, played, -1);
    }
    ctx.globalAlpha = 1;
    paintedPlayed = played;
    return;
  }

  // 2x is plenty for 2-3px bars; higher ratios only cost memory.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(width.value * dpr);
  const h = Math.round(props.height * dpr);
  // Assigning width/height reallocates the backing store, so only do it when the size changes.
  if (el.width !== w || el.height !== h) {
    el.width = w;
    el.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width.value, props.height);
  if (peaks.length !== count) peaks = resample(props.samples ?? [], count);
  const styles = getComputedStyle(el);
  accent = props.color || styles.getPropertyValue("--accent").trim() || "#ff5500";
  base = styles.getPropertyValue("--wave").trim() || "rgba(255,255,255,.3)";
  for (let i = 0; i < count; i++) drawBar(ctx, i, played, hovered);
  ctx.globalAlpha = 1;
  // Hover styling is spread across the canvas, so keep repainting fully until it's gone.
  full = hovered >= 0;
  paintedPlayed = played;
}

function fractionAt(event: MouseEvent) {
  const rect = root.value!.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
    invalidate();
  });
  resizeObserver.observe(root.value!);
  // Stream and user pages mount dozens of these; only the ones on screen paint.
  viewObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    schedule();
  });
  viewObserver.observe(root.value!);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  viewObserver?.disconnect();
  cancelAnimationFrame(frame);
});
const settings = useSettings();
watch(() => props.progress, schedule);
watch(() => props.samples, () => {
  peaks = [];
  invalidate();
});
watch(() => [hover.value, props.height, props.color, settings.accent, settings.theme], invalidate);
</script>

<template>
  <div
    ref="root"
    class="waveform"
    :style="{ height: `${height}px` }"
    @mousemove="hover = fractionAt($event)"
    @mouseleave="hover = null"
    @click.stop="emit('seek', fractionAt($event))"
  >
    <canvas ref="canvas" :style="{ width: '100%', height: `${height}px` }" />
    <span v-if="hover != null && duration" class="time hover" :style="{ left: `${hover * 100}%` }">{{ fmt(hover * duration) }}</span>
    <span v-if="progress != null && duration && reflection" class="time now" :style="{ left: `${progress * 100}%` }">{{ fmt(progress * duration) }}</span>
    <span v-if="duration && reflection" class="time total">{{ fmt(duration) }}</span>

    <div v-if="pinned.length" class="comments" :style="{ top: `${height * 0.7 - 6}px` }">
      <button
        v-for="c in pinned"
        :key="c.id"
        class="pin"
        :style="{ left: `${(c.timestamp! / duration) * 100}%` }"
        @mouseenter="activeComment = c"
        @mouseleave="activeComment = null"
        @click.stop="emit('seek', c.timestamp! / duration)"
      >
        <Artwork :src="c.user.avatarUrl" :size="14" round />
      </button>
      <div v-if="activeComment" class="bubble" :style="{ left: `${(activeComment.timestamp! / duration) * 100}%` }">
        <b>{{ activeComment.user.username }}</b> {{ activeComment.body }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.waveform {
  position: relative;
  width: 100%;
  cursor: pointer;
}
canvas { display: block; }
.time {
  position: absolute;
  top: 34%;
  transform: translateY(-50%);
  padding: 1px 4px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  border-radius: 3px;
  pointer-events: none;
}
.time.now { transform: translate(-100%, -50%); color: var(--accent); }
.time.hover { transform: translate(-50%, -160%); }
.time.total { right: 0; }
.comments { position: absolute; left: 0; right: 0; height: 14px; }
.pin {
  position: absolute;
  transform: translateX(-50%);
  opacity: 0.85;
  transition: transform 0.12s, opacity 0.12s;
}
.pin:hover { transform: translateX(-50%) scale(1.5); opacity: 1; z-index: 2; }
.bubble {
  position: absolute;
  top: 20px;
  transform: translateX(-10px);
  max-width: 280px;
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--overlay);
  box-shadow: var(--shadow);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 3;
}
.bubble b { color: var(--accent); margin-right: 4px; }
</style>
