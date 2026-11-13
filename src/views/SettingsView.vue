<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle2, CloudUpload, LogOut, RefreshCw, XCircle } from "lucide-vue-next";
import { api, backendConfig, createBackend, friendlyError, HOSTED_BASE_URL, loadBackendConfig, useBackend, type BackendConfig } from "@/api";
import Artwork from "@/components/Artwork.vue";
import { useSpotify } from "@/spotify/auth";
import { useAccount } from "@/stores/account";
import { useLibrary } from "@/stores/library";
import { useLocalPlaylists } from "@/stores/localPlaylists";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useUpdates } from "@/stores/updates";

const settings = useSettings();
const ui = useUi();
const updates = useUpdates();
const library = useLibrary();
const account = useAccount();
const local = useLocalPlaylists();
const spotify = useSpotify();
const router = useRouter();
const isWindows = window.stratus?.platform === "win32";
const backend = reactive<BackendConfig>(loadBackendConfig());
// Signing in or out elsewhere changes the saved tokens; keep the form in step.
watch(backendConfig, (c) => Object.assign(backend, c));
const test = ref<{ ok: boolean; message: string } | null>(null);
const testing = ref(false);
const hostedHost = new URL(HOSTED_BASE_URL).host;

// Delete account: asks for the password first.
const deleting = ref(false);
const deletePassword = ref("");
const deleteError = ref<string | null>(null);
const deleteBusy = ref(false);
async function confirmDelete() {
  if (!deletePassword.value) {
    deleteError.value = "Enter your password to confirm.";
    return;
  }
  deleteBusy.value = true;
  deleteError.value = null;
  try {
    await account.deleteAccount(deletePassword.value);
    deleting.value = false;
    deletePassword.value = "";
  } catch (err) {
    deleteError.value = friendlyError(err);
  } finally {
    deleteBusy.value = false;
  }
}

// Upload playlists on this computer to the account, then offer to remove the local copies.
const canUpload = computed(() => !!library.me && typeof api.value.createPlaylist === "function");
const uploading = ref(false);
const uploaded = ref<string[] | null>(null);
const uploadFailed = ref<string[]>([]);
async function uploadLocal() {
  const create = api.value.createPlaylist;
  if (!create) return;
  uploading.value = true;
  uploaded.value = null;
  uploadFailed.value = [];
  const done: string[] = [];
  for (const p of [...local.playlists]) {
    try {
      await create.call(api.value, p.title, p.tracks.map((t) => t.id), false, { tracks: p.tracks, ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}) });
      done.push(p.id);
    } catch (err) {
      uploadFailed.value.push(`${p.title}: ${friendlyError(err)}`);
    }
  }
  uploaded.value = done;
  uploading.value = false;
  void library.refresh();
}
function removeUploaded() {
  for (const id of uploaded.value ?? []) local.remove(id);
  ui.notify(`Removed ${uploaded.value?.length ?? 0} playlists from this computer`);
  uploaded.value = null;
}

// Music source. Switching to Spotify before it's connected opens the setup guide.
onMounted(() => void spotify.init());
const spotifySetup = { path: "/welcome", query: { step: "spotify", from: "settings" } };
function setSource(source: "spotify" | "soundcloud") {
  if (source === settings.musicSource) return;
  if (source === "spotify" && !spotify.connected) return void router.push(spotifySetup);
  settings.musicSource = source;
  ui.notify(source === "spotify" ? "Spotify is your music source" : "SoundCloud is your music source");
}
const maskedClientId = computed(() => {
  const id = spotify.clientId;
  return id && id.length > 8 ? `${id.slice(0, 4)}••••••••${id.slice(-4)}` : id || "Not set";
});
const premiumLabel = computed(() => {
  if (!spotify.isPremium) return "no";
  return spotify.profile?.product === "premium" ? "yes" : "not reported yet";
});
async function disconnectSpotify() {
  await spotify.disconnect();
  if (settings.musicSource === "spotify") {
    settings.musicSource = "soundcloud";
    ui.notify("Disconnected from Spotify. SoundCloud is your music source now.");
  } else ui.notify("Disconnected from Spotify");
}

const accents = ["#ff5500", "#ff2d55", "#bf5af2", "#0a84ff", "#30d158", "#ffd60a", "#e5e5ea"];

async function testConnection() {
  testing.value = true;
  test.value = null;
  try {
    const b = createBackend({ ...backend });
    const me = await b.me();
    const home = await b.home();
    test.value = { ok: true, message: `Connected${me ? ` as ${me.username}` : " (not signed in)"}. Home returned ${home.length} sections.` };
  } catch (err) {
    test.value = { ok: false, message: (err as Error).message };
  } finally {
    testing.value = false;
  }
}

const updateStatus = computed(() => {
  const s = updates.state;
  const info = updates.info;
  if (!info?.enabled) return "Updates are turned off in development builds.";
  switch (s.status) {
    case "checking": return "Checking for updates…";
    case "available":
      return s.version === info.skippedVersion ? `Version ${s.version} is available (skipped).` : `Version ${s.version} is available.`;
    case "downloading": return `Downloading ${s.version ?? "update"}… ${s.progress ?? 0}%`;
    case "downloaded": return `Version ${s.version} is ready to install.`;
    case "not-available": return "Stratus is up to date.";
    case "error": return s.error ?? "The last check failed.";
    default: return "Not checked yet.";
  }
});

const lastChecked = computed(() => {
  const t = updates.info?.lastChecked;
  return t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";
});

function apply() {
  // Tokens come from storage, not the form, so a sign-in since this page
  // opened isn't undone. The custom server's token is the one field to edit.
  useBackend({ ...loadBackendConfig(), kind: backend.kind, baseUrl: backend.baseUrl, token: backend.token });
  ui.notify(`Switched to ${api.value.name}`);
}
</script>

<template>
  <div class="page settings">
    <h1 class="page-title">Settings</h1>

    <section v-if="library.accounts">
      <h2>Account</h2>
      <template v-if="library.me">
        <div class="account-row">
          <Artwork :src="library.me.avatarUrl" :size="44" round />
          <div class="account-text">
            <strong>{{ library.me.username }}</strong>
            <span class="muted">{{ account.email ?? "Signed in" }} · {{ api.name }}</span>
          </div>
          <button class="btn" @click="account.signOut()"><LogOut :size="14" /> Sign out</button>
        </div>

        <div v-if="canUpload && (local.playlists.length || uploaded)" class="sub">
          <template v-if="uploaded">
            <p class="muted">
              Uploaded {{ uploaded.length }} {{ uploaded.length === 1 ? "playlist" : "playlists" }} to your account.
              <template v-if="uploaded.length">Remove the copies on this computer?</template>
            </p>
            <p v-for="f in uploadFailed" :key="f" class="error small">{{ f }}</p>
            <div class="row">
              <button v-if="uploaded.length" class="btn danger" @click="removeUploaded">Remove local copies</button>
              <button class="btn" @click="uploaded = null">{{ uploaded.length ? "Keep them" : "OK" }}</button>
            </div>
          </template>
          <template v-else>
            <p class="muted">
              {{ local.playlists.length }} {{ local.playlists.length === 1 ? "playlist is" : "playlists are" }} saved only on this computer.
            </p>
            <button class="btn" :disabled="uploading" @click="uploadLocal">
              <CloudUpload :size="14" /> {{ uploading ? "Uploading…" : "Upload playlists on this computer to my account" }}
            </button>
          </template>
        </div>

        <div v-if="api.deleteAccount" class="sub">
          <button v-if="!deleting" class="link danger-text" @click="deleting = true">Delete account…</button>
          <form v-else class="delete" @submit.prevent="confirmDelete">
            <p class="muted">This deletes your account with its likes, playlists, follows and history. It can't be undone.</p>
            <div class="row">
              <input
                v-model="deletePassword"
                type="password"
                autocomplete="current-password"
                placeholder="Your password"
                aria-label="Password"
                :disabled="deleteBusy"
              />
              <button class="btn danger" type="submit" :disabled="deleteBusy">{{ deleteBusy ? "Deleting…" : "Delete my account" }}</button>
              <button class="btn" type="button" @click="deleting = false; deleteError = null; deletePassword = ''">Cancel</button>
            </div>
            <p v-if="deleteError" class="error small" role="alert">{{ deleteError }}</p>
          </form>
        </div>
      </template>
      <template v-else>
        <p class="muted">Sign in to keep likes, playlists, follows and history in your account, in the desktop app and the browser.</p>
        <div class="row">
          <RouterLink :to="{ path: '/account', query: { next: '/settings' } }" class="btn primary">Sign in</RouterLink>
          <RouterLink :to="{ path: '/account', query: { next: '/settings', mode: 'signup' } }" class="btn">Create account</RouterLink>
        </div>
      </template>
    </section>

    <section>
      <h2>Music source</h2>
      <p class="muted">Where songs play from. Imports from Spotify follow this too.</p>
      <div class="field">
        <label>Source</label>
        <div class="seg">
          <button :class="{ active: settings.musicSource === 'spotify' }" @click="setSource('spotify')">Spotify</button>
          <button :class="{ active: settings.musicSource === 'soundcloud' }" @click="setSource('soundcloud')">SoundCloud</button>
        </div>
      </div>
      <p v-if="settings.musicSource === 'spotify'" class="faint small hint">
        Spotify's own audio, through your Spotify Premium account. Imported Spotify playlists play as they are.
      </p>
      <p v-else class="faint small hint">
        Free. Imported Spotify playlists are matched to SoundCloud uploads, and most songs from a typical playlist won't be there.
      </p>

      <div class="field">
        <label>Spotify</label>
        <span v-if="spotify.connected && spotify.profile" class="spotify-who">
          Connected as <strong>{{ spotify.profile.displayName }}</strong>
          {{ " " }}<span class="muted">· Premium: {{ premiumLabel }}</span>
        </span>
        <span v-else-if="spotify.status === 'connecting'" class="muted">Connecting…</span>
        <span v-else class="muted">Not connected</span>
      </div>
      <div v-if="spotify.clientId" class="field">
        <label>Client ID</label>
        <code class="client-id">{{ maskedClientId }}</code>
      </div>
      <p v-if="spotify.connected && spotify.viaAccount" class="faint small hint">
        Saved in your Stratus account, so your other signed-in devices use it too. Disconnect disconnects all of them.
      </p>
      <p v-else-if="spotify.connected && library.accounts" class="faint small hint">
        Only on this device. Sign in to your Stratus account and it's shared with your other devices.
      </p>
      <p v-if="spotify.connected && !spotify.isPremium" class="error small hint">
        Spotify only plays in other apps for Premium accounts, so Spotify songs won't play with this account.
      </p>
      <p v-else-if="spotify.premiumMessage" class="error small hint" role="alert">{{ spotify.premiumMessage }}</p>
      <p v-if="spotify.status === 'error' && spotify.error" class="error small hint">{{ spotify.error }}</p>
      <div class="row indent">
        <template v-if="spotify.clientId">
          <button class="btn" :disabled="spotify.status === 'connecting'" @click="spotify.connect()">
            {{ spotify.connected ? "Reconnect" : "Connect" }}
          </button>
          <button v-if="spotify.connected" class="btn" @click="disconnectSpotify">Disconnect</button>
          <RouterLink :to="spotifySetup" class="btn">Change Client ID</RouterLink>
        </template>
        <RouterLink v-else :to="spotifySetup" class="btn">Set up Spotify</RouterLink>
      </div>

      <div class="field playback">
        <label>Play Spotify songs</label>
        <div class="seg long">
          <button :class="{ active: settings.spotifyPlayback === 'this-device' }" @click="settings.spotifyPlayback = 'this-device'">
            Play on this device
          </button>
          <button :class="{ active: settings.spotifyPlayback === 'remote' }" @click="settings.spotifyPlayback = 'remote'">
            Control my Spotify app
          </button>
        </div>
      </div>
      <p class="faint small hint">
        <template v-if="settings.spotifyPlayback === 'this-device'">Stratus plays the audio itself.</template>
        <template v-else>Your Spotify app plays the audio and Stratus works as its remote. Keep the Spotify app open.</template>
        Phone browsers can't play Spotify audio inside a web page, so on phones the web player starts with "Control my Spotify app".
      </p>
    </section>

    <section>
      <h2>Backend</h2>
      <p class="muted">Where Stratus gets music and keeps your library.</p>
      <div class="field">
        <label>Source</label>
        <div class="seg">
          <button :class="{ active: backend.kind === 'hosted' }" @click="backend.kind = 'hosted'">Stratus account</button>
          <button :class="{ active: backend.kind === 'http' }" @click="backend.kind = 'http'">Custom server</button>
          <button :class="{ active: backend.kind === 'mock' }" @click="backend.kind = 'mock'">Demo data</button>
        </div>
      </div>
      <p v-if="backend.kind === 'hosted'" class="faint small hint">
        Recommended. The Stratus server at {{ hostedHost }}, with accounts that work in the desktop app and the browser.
      </p>
      <p v-else-if="backend.kind === 'mock'" class="faint small hint">
        Made-up artists, tracks and generated audio, for trying Stratus without a server.
      </p>
      <template v-if="backend.kind === 'http'">
        <p class="faint small hint">A server you run that follows BACKEND.md.</p>
        <div class="field">
          <label for="url">Base URL</label>
          <input id="url" v-model="backend.baseUrl" placeholder="http://localhost:8787" spellcheck="false" />
        </div>
        <div class="field">
          <label for="token">Bearer token</label>
          <input id="token" v-model="backend.token" type="password" placeholder="Optional" />
        </div>
      </template>
      <div class="row">
        <button class="btn" :disabled="testing" @click="testConnection">{{ testing ? "Testing…" : "Test connection" }}</button>
        <button class="btn primary" @click="apply">Apply</button>
        <span v-if="test" class="result" :class="{ ok: test.ok }">
          <CheckCircle2 v-if="test.ok" :size="15" />
          <XCircle v-else :size="15" />
          {{ test.message }}
        </span>
      </div>
      <p class="faint small">Currently using: {{ api.name }}</p>
    </section>

    <section>
      <h2>Appearance</h2>
      <div class="field">
        <label>Theme</label>
        <div class="seg">
          <button v-for="t in (['dark', 'light', 'system'] as const)" :key="t" :class="{ active: settings.theme === t }" @click="settings.theme = t">
            {{ t[0].toUpperCase() + t.slice(1) }}
          </button>
        </div>
      </div>
      <div class="field">
        <label>Accent</label>
        <div class="swatches">
          <button
            v-for="c in accents"
            :key="c"
            class="swatch"
            :class="{ active: settings.accent === c }"
            :style="{ background: c }"
            :title="c"
            @click="settings.accent = c"
          />
          <input v-model="settings.accent" type="color" class="picker" title="Custom" />
        </div>
      </div>
      <label class="check"><input v-model="settings.immersiveMotion" type="checkbox" /> Animate the immersive player background</label>
    </section>

    <section>
      <h2>Playback</h2>
      <label class="check"><input v-model="settings.autoplayRelated" type="checkbox" /> Keep playing related tracks when the queue ends</label>
      <label class="check"><input v-model="settings.showCommentsOnWaveform" type="checkbox" /> Show timed comments on waveforms</label>
      <label v-if="isWindows" class="check"><input v-model="settings.keepPlayingInTray" type="checkbox" /> Keep playing in the tray when closed</label>
    </section>

    <section v-if="updates.info">
      <h2>Updates</h2>
      <div class="field">
        <label>Version</label>
        <span>Stratus {{ updates.info.currentVersion }}</span>
      </div>
      <div class="field">
        <label>Last checked</label>
        <span>{{ lastChecked }}</span>
      </div>
      <div class="row">
        <button class="btn" :disabled="!updates.info.enabled || updates.state.status === 'checking'" @click="updates.check()">
          <RefreshCw :size="14" :class="{ spin: updates.state.status === 'checking' }" /> Check now
        </button>
        <button v-if="['available', 'downloading', 'downloaded'].includes(updates.state.status)" class="btn primary" @click="updates.dialog = true">
          View update
        </button>
        <span class="update-status" :class="{ error: updates.state.status === 'error' }">{{ updateStatus }}</span>
      </div>
      <label class="check">
        <input :checked="updates.info.beta" type="checkbox" @change="updates.setBeta(($event.target as HTMLInputElement).checked)" />
        Beta updates (get pre-release versions)
      </label>
    </section>
  </div>
</template>

<style scoped>
.settings { max-width: 720px; }
section { padding: 20px 0 26px; border-bottom: 1px solid var(--border); }
h2 { margin: 0 0 6px; font-size: 16px; }
section > p { margin: 0 0 16px; }
.field { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 12px; margin-bottom: 12px; }
label { color: var(--text-2); }
.field input { max-width: 380px; }
.seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 9px; background: var(--hover); width: fit-content; }
.seg button { height: 26px; padding: 0 12px; border-radius: 7px; color: var(--text-2); font-weight: 550; }
.seg button.active { background: var(--raised); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
.row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.result { display: inline-flex; align-items: center; gap: 6px; color: #ff6b6b; font-size: 12.5px; user-select: text; }
.result.ok { color: #30d158; }
.small { font-size: 12px; margin: 10px 0 0; }
.swatches { display: flex; align-items: center; gap: 8px; }
.swatch { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2); }
.swatch.active { outline: 2px solid var(--text); outline-offset: 2px; }
.picker { width: 30px; height: 26px; padding: 0; border: 0; background: none; }
.check { display: flex; align-items: center; gap: 8px; margin: 10px 0; color: var(--text); }
.check input { width: 15px; height: 15px; accent-color: var(--accent); }
.update-status { color: var(--text-2); font-size: 12.5px; user-select: text; }
.hint { margin: -4px 0 12px 132px; max-width: 460px; }
.indent { margin: 0 0 16px 132px; }
.playback { margin-top: 8px; }
.spotify-who strong { color: var(--text); }
.client-id { font: 12.5px ui-monospace, "SF Mono", Menlo, monospace; color: var(--text-2); user-select: text; }
.account-row { display: flex; align-items: center; gap: 12px; }
.account-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.account-text strong { font-size: 15px; }
.sub { margin-top: 16px; }
.sub p { margin: 0 0 8px; }
.delete input { width: 220px; }
.link { color: var(--accent); font-weight: 600; }
.danger-text { color: #ff6b6b; }
.btn.danger { background: #ff5a5a; color: #fff; }
.error { color: #ff6b6b; user-select: text; }
a.btn:hover { text-decoration: none; }
@media (max-width: 560px) {
  .field { grid-template-columns: 1fr; gap: 6px; }
  .hint { margin-left: 0; }
  .indent { margin-left: 0; }
  /* Two long labels don't fit side by side on a phone; stack them as a list. */
  .seg.long { display: flex; flex-direction: column; flex-wrap: nowrap; width: 100%; }
  .seg.long button { height: 36px; text-align: left; }
  .seg { flex-wrap: wrap; }
  .delete input { width: 100%; }
}
.update-status.error { color: #ff6b6b; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
