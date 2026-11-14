<script setup lang="ts">
// Which Spotify device plays when Nightjar remote-controls Spotify (Connect).
// Shown in the queue panel while a Spotify track is current.
import { onMounted, ref } from "vue";
import { Laptop, RefreshCw, Smartphone, Speaker } from "lucide-vue-next";
import { listSpotifyDevices, type SpotifyDevice } from "@/player/engines";
import { spotifyRequest } from "@/spotify/api";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import SpotifyIcon from "./SpotifyIcon.vue";

const settings = useSettings();
const player = usePlayer();
const ui = useUi();
const devices = ref<SpotifyDevice[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function refresh() {
  loading.value = true;
  error.value = null;
  try {
    devices.value = await listSpotifyDevices();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function choose(d: SpotifyDevice) {
  if (!d.id) return;
  settings.spotifyDeviceId = d.id;
  // Move what's playing to the new device.
  if (player.current?.source === "spotify" && !d.is_active) {
    try {
      await spotifyRequest<void>("PUT", "/me/player", { body: { device_ids: [d.id], play: player.playing } });
    } catch (err) {
      ui.notify((err as Error).message);
    }
  }
  void refresh();
}

const icon = (type: string) => (/smartphone|tablet/i.test(type) ? Smartphone : /computer/i.test(type) ? Laptop : Speaker);
const selected = (d: SpotifyDevice) => (settings.spotifyDeviceId ? d.id === settings.spotifyDeviceId : d.is_active);

onMounted(refresh);
</script>

<template>
  <div class="devices">
    <div class="head">
      <span class="label faint"><SpotifyIcon :size="12" /> Playing on</span>
      <button class="icon-btn" title="Refresh devices" :disabled="loading" @click="refresh"><RefreshCw :size="13" :class="{ spin: loading }" /></button>
    </div>
    <p v-if="error" class="note error">{{ error }}</p>
    <p v-else-if="!loading && !devices.length" class="note">No Spotify devices found. Open the Spotify app on your phone or computer, then refresh.</p>
    <button v-for="d in devices" :key="d.id ?? d.name" class="device" :class="{ on: selected(d) }" @click="choose(d)">
      <component :is="icon(d.type)" :size="16" />
      <span class="ellipsis">{{ d.name }}</span>
      <span v-if="d.is_active" class="faint small">active</span>
    </button>
    <button class="link small" @click="settings.spotifyPlayback = 'this-device'">Play in Nightjar instead</button>
  </div>
</template>

<style scoped>
.devices { margin: 0 8px 10px; padding: 8px; border-radius: 10px; background: var(--hover); }
.head { display: flex; align-items: center; justify-content: space-between; }
.label { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.label :deep(svg) { color: #1ed760; }
.head .icon-btn { width: 24px; height: 24px; }
.device { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 0 8px; border-radius: 7px; text-align: left; color: var(--text-2); }
@media (hover: hover) { .device:hover { background: var(--active); } }
.device.on { color: #1ed760; font-weight: 600; }
.device .ellipsis { flex: 1; min-width: 0; }
.note { margin: 4px 0 6px; font-size: 12px; color: var(--text-3); }
.note.error { color: #ff6b6b; }
.small { font-size: 11.5px; }
.link { margin-top: 4px; color: var(--accent); font-weight: 600; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) { .device { min-height: 44px; } }
</style>
