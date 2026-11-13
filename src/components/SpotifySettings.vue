<script setup lang="ts">
// Settings > Spotify: music source, the user's own Client ID, sign-in, and
// where Spotify tracks play. docs/spotify.md explains the Client ID.
import { computed, ref, watch } from "vue";
import { Copy, LogOut } from "lucide-vue-next";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useSpotify } from "@/spotify/auth";
import { isClientId } from "@/spotify/pkce";
import Artwork from "./Artwork.vue";

const settings = useSettings();
const spotify = useSpotify();
const ui = useUi();
const draft = ref(spotify.clientId);
watch(() => spotify.clientId, (v) => (draft.value = v));
const draftValid = computed(() => isClientId(draft.value));

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => ui.notify("Copied"));
}

function connect() {
  if (!draftValid.value) {
    ui.notify("That doesn't look like a Client ID. It's 32 letters and numbers.");
    return;
  }
  spotify.setClientId(draft.value);
  void spotify.connect();
}

const productLabel = computed(() => {
  const p = spotify.profile?.product;
  if (!p) return null;
  return p === "premium" ? "Premium" : p === "open" ? "Free" : p[0].toUpperCase() + p.slice(1);
});
</script>

<template>
  <section id="spotify">
    <h2>Music source</h2>
    <p class="muted">Where Home, Search and Likes come from. SoundCloud and Spotify pages both open from links either way.</p>
    <div class="field">
      <label>Source</label>
      <div class="seg">
        <button :class="{ active: settings.musicSource !== 'spotify' }" @click="settings.musicSource = 'soundcloud'">SoundCloud</button>
        <button :class="{ active: settings.musicSource === 'spotify' }" @click="settings.musicSource = 'spotify'">Spotify (Premium)</button>
      </div>
    </div>

    <h3>Spotify</h3>
    <template v-if="spotify.connected">
      <div class="account-row">
        <Artwork :src="spotify.profile?.avatarUrl ?? null" :size="40" round />
        <div class="account-text">
          <strong>{{ spotify.profile?.displayName ?? "Connected" }}</strong>
          <span class="muted">Spotify<template v-if="productLabel"> {{ productLabel }}</template></span>
        </div>
        <button class="btn" @click="spotify.disconnect()"><LogOut :size="14" /> Disconnect</button>
      </div>
      <p v-if="spotify.premiumMessage" class="error small" role="alert">{{ spotify.premiumMessage }}</p>
    </template>
    <template v-else>
      <ol class="steps muted">
        <li>
          Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify developer dashboard</a>
          with your Premium account and create an app. Tick "Web API" and "Web Playback SDK".
        </li>
        <li>
          Add this redirect URI to the app:
          <span class="uri"><code>{{ spotify.redirectUri }}</code><button class="icon-btn" title="Copy" @click="copy(spotify.redirectUri)"><Copy :size="13" /></button></span>
        </li>
        <li>Paste the app's Client ID here. No client secret is needed.</li>
      </ol>
      <div class="field">
        <label for="sp-client">Client ID</label>
        <input id="sp-client" v-model="draft" placeholder="32 letters and numbers" spellcheck="false" autocomplete="off" @keydown.enter="connect" />
      </div>
      <div class="row">
        <button class="btn primary" :disabled="spotify.status === 'connecting'" @click="connect">
          {{ spotify.status === "connecting" ? "Waiting for Spotify…" : "Connect Spotify" }}
        </button>
      </div>
    </template>
    <p v-if="spotify.error" class="error small" role="alert">{{ spotify.error }}</p>

    <div class="field play-mode">
      <label>Spotify plays</label>
      <div class="seg">
        <button :class="{ active: settings.spotifyPlayback === 'this-device' }" @click="settings.spotifyPlayback = 'this-device'">In Stratus</button>
        <button :class="{ active: settings.spotifyPlayback === 'remote' }" @click="settings.spotifyPlayback = 'remote'">Control the Spotify app</button>
      </div>
    </div>
    <p class="faint small hint">
      "Control the Spotify app" plays on your phone or computer's Spotify app, picked in the queue panel. It works better on iPhone, where the
      in-browser player stops when the screen locks.
    </p>
  </section>
</template>

<style scoped>
section { padding: 20px 0 26px; border-bottom: 1px solid var(--border); }
h2 { margin: 0 0 6px; font-size: 16px; }
h3 { margin: 18px 0 10px; font-size: 14px; }
section > p { margin: 0 0 16px; }
.field { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 12px; margin-bottom: 12px; }
label { color: var(--text-2); }
.field input { max-width: 380px; font-family: ui-monospace, monospace; }
.seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 9px; background: var(--hover); width: fit-content; }
.seg button { height: 26px; padding: 0 12px; border-radius: 7px; color: var(--text-2); font-weight: 550; }
.seg button.active { background: var(--raised); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
.row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.steps { margin: 0 0 14px; padding-left: 20px; max-width: 600px; }
.steps li { margin-bottom: 6px; }
.uri { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
.uri code { padding: 1px 6px; border-radius: 5px; background: var(--hover); font-size: 12px; user-select: all; }
.uri .icon-btn { width: 22px; height: 22px; }
.account-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.account-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.play-mode { margin-top: 18px; }
.small { font-size: 12px; margin: 10px 0 0; }
.hint { margin: -4px 0 0 132px; max-width: 460px; }
.error { color: #ff6b6b; user-select: text; }
@media (max-width: 560px) {
  .field { grid-template-columns: 1fr; gap: 6px; }
  .hint { margin-left: 0; }
  .seg { flex-wrap: wrap; }
}
</style>
