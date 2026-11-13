<script setup lang="ts">
// Blurred, slowly drifting artwork behind the immersive player and the phone's
// now-playing sheet.
import { onMounted, ref, watch } from "vue";

const props = defineProps<{ src: string | null | undefined; still?: boolean }>();

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
watch(() => props.src, paintBlobs, { flush: "post" });
onMounted(() => void paintBlobs(props.src));
</script>

<template>
  <div class="backdrop" :class="{ still }">
    <canvas ref="blobA" :width="BLOB" :height="BLOB" class="blob a" />
    <canvas ref="blobB" :width="BLOB" :height="BLOB" class="blob b" />
    <div class="shade" />
  </div>
</template>

<style scoped>
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
</style>
