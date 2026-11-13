<script setup lang="ts">
// Shown in place of Spotify pages when there's no Spotify session.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { isClientId } from "@/spotify/pkce";
import { useSpotify } from "@/spotify/auth";
import SpotifyIcon from "./SpotifyIcon.vue";

withDefaults(defineProps<{ text?: string }>(), { text: "Sign in with your Spotify Premium account to browse and play Spotify here." });

const spotify = useSpotify();
const router = useRouter();
const ready = computed(() => isClientId(spotify.clientId));

function connect() {
  if (ready.value) void spotify.connect();
  else void router.push("/settings");
}
</script>

<template>
  <div class="prompt">
    <span class="badge"><SpotifyIcon :size="26" /></span>
    <div class="text">
      <strong>Connect Spotify</strong>
      <p class="muted">{{ text }}</p>
      <p v-if="spotify.error" class="error" role="alert">{{ spotify.error }}</p>
    </div>
    <div class="actions">
      <button class="btn primary" :disabled="spotify.status === 'connecting'" @click="connect">
        {{ spotify.status === "connecting" ? "Waiting for Spotify…" : ready ? "Connect Spotify" : "Set up Spotify" }}
      </button>
      <RouterLink v-if="ready" to="/settings" class="btn">Settings</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.prompt { display: grid; justify-items: center; gap: 12px; padding: 64px 20px; text-align: center; }
.badge { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(30, 215, 96, 0.14); color: #1ed760; }
.text strong { font-size: 16px; }
.text p { margin: 4px 0 0; max-width: 400px; }
.error { color: #ff6b6b; user-select: text; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
a.btn:hover { text-decoration: none; }
</style>
