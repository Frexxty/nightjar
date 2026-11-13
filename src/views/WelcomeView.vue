<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Loader2, TriangleAlert } from "lucide-vue-next";
import logoMark from "@/assets/logo-mark.svg?raw";
import Artwork from "@/components/Artwork.vue";
import { useSpotify } from "@/spotify/auth";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

const route = useRoute();
const router = useRouter();
const settings = useSettings();
const spotify = useSpotify();
const library = useLibrary();
const ui = useUi();

const DASHBOARD = "https://developer.spotify.com/dashboard";
const DESKTOP_REDIRECT = "http://127.0.0.1:43821/callback";
const WEB_REDIRECT = "https://stratus-app.k3s.lat/spotify-callback";
const desktop = !!window.stratus;

/** "choose" (the two cards) or "spotify" (the setup guide). In the URL so a web sign-in comes back to the guide. */
const step = computed(() => (route.query.step === "spotify" ? "spotify" : "choose"));
/** Opened from Settings: going back returns there and nothing is reset. */
const fromSettings = computed(() => route.query.from === "settings");

onMounted(() => void spotify.init());

// A new device signed in to an account that already uses Spotify has nothing to set up.
watch(
  () => spotify.viaAccount,
  (shared) => {
    if (shared && step.value === "choose" && !fromSettings.value) void router.replace("/");
  },
  { immediate: true },
);

function chooseSoundCloud() {
  settings.musicSource = "soundcloud";
  void router.replace("/");
}

function chooseSpotify() {
  void router.push({ path: "/welcome", query: { step: "spotify", ...(fromSettings.value ? { from: "settings" } : {}) } });
}

function back() {
  if (fromSettings.value) void router.push("/settings");
  else void router.push("/welcome");
}

/** Keeps SoundCloud (or, from Settings, whatever was set) and leaves. */
function skip() {
  if (fromSettings.value) return void router.push("/settings");
  settings.musicSource = "soundcloud";
  void router.replace("/");
}

// Redirect URIs: this platform's first, then the other one.
const redirects = computed(() => {
  const web = desktop ? WEB_REDIRECT : `${location.origin}/spotify-callback`;
  const here = { label: desktop ? "Desktop app (this one)" : "Web player (this one)", uri: desktop ? DESKTOP_REDIRECT : web };
  const other = { label: desktop ? "Web player" : "Desktop app", uri: desktop ? web : DESKTOP_REDIRECT };
  return [here, other];
});

const copied = ref<string | null>(null);
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => copied.value === text && (copied.value = null), 2000);
  } catch {
    ui.notify("Couldn't copy. Select the text and copy it yourself.");
  }
}

function openDashboard() {
  window.stratus?.window("open-external", DASHBOARD);
}

// Client ID: 32 hex characters.
const clientIdInput = ref(spotify.clientId ?? "");
const trimmedId = computed(() => clientIdInput.value.trim());
const validId = computed(() => /^[0-9a-f]{32}$/i.test(trimmedId.value));
const idHint = computed(() => {
  if (!trimmedId.value) return null;
  if (validId.value) return null;
  if (trimmedId.value.length !== 32) return `A Client ID is 32 characters. This is ${trimmedId.value.length}.`;
  return "A Client ID only has the digits 0 to 9 and the letters a to f.";
});

async function connect() {
  if (!validId.value) return;
  spotify.setClientId(trimmedId.value);
  await spotify.connect();
}

const premium = computed<"yes" | "no" | "unknown">(() => {
  const product = spotify.profile?.product;
  if (!spotify.isPremium) return "no";
  return product === "premium" ? "yes" : "unknown";
});

function startSpotify() {
  settings.musicSource = "spotify";
  ui.notify("Spotify is your music source");
  void router.replace(fromSettings.value ? "/settings" : "/");
}

async function useAnotherAccount() {
  await spotify.disconnect();
}
</script>

<template>
  <div class="welcome">
    <!-- Choose a source -->
    <template v-if="step === 'choose'">
      <header class="intro">
        <div class="mark" aria-hidden="true" v-html="logoMark" />
        <h1>Where should Stratus get music?</h1>
        <p class="muted">You can change this later in Settings.</p>
      </header>

      <div class="choices">
        <button class="choice spotify" @click="chooseSpotify">
          <span class="choice-head">
            <span class="name">Spotify</span>
            <span class="tag">Premium</span>
          </span>
          <span class="body">
            Play your Spotify library and playlists with Spotify's own audio. Needs Spotify Premium and a free Spotify developer app
            (one-time, about 5 minutes).
          </span>
          <span class="go">Set up Spotify <ArrowRight :size="15" /></span>
        </button>

        <button class="choice soundcloud" @click="chooseSoundCloud">
          <span class="choice-head">
            <span class="name">SoundCloud</span>
            <span class="tag">Free</span>
          </span>
          <span class="body">
            Free. Plays music uploaded to SoundCloud. When you import a Spotify playlist, Stratus finds the closest SoundCloud uploads.
            These may be relevant, but most songs from a typical playlist will be missing or only partly there.
          </span>
          <span class="go">Use SoundCloud <ArrowRight :size="15" /></span>
        </button>
      </div>
    </template>

    <!-- Spotify setup guide -->
    <template v-else>
      <div class="guide">
        <button class="btn back" @click="back"><ArrowLeft :size="15" /> Back</button>
        <h1>Set up Spotify</h1>
        <p class="muted lead">
          Stratus signs in through a Spotify developer app that you create. Each Spotify developer app works for up to 5 accounts,
          so everyone creates their own. It's free and takes about 5 minutes.
        </p>
        <p v-if="spotify.accountAvailable" class="muted lead">
          You're signed in to Stratus, so the connection is saved in your account and your other devices get it too.
        </p>
        <p v-else-if="library.accounts" class="muted lead">
          Using Stratus on more than one device?
          <RouterLink :to="{ path: '/account', query: { next: route.fullPath } }">Sign in to your Stratus account</RouterLink>
          first, and you only connect Spotify once for all of them.
        </p>

        <ol class="steps">
          <li>
            <span class="num">1</span>
            <div class="step">
              <h2>Open the Spotify developer dashboard</h2>
              <p class="muted">Sign in with the Spotify account you listen with. It needs Premium.</p>
              <button v-if="desktop" class="btn" @click="openDashboard"><ExternalLink :size="14" /> Open developer.spotify.com</button>
              <a v-else class="btn" :href="DASHBOARD" target="_blank" rel="noopener"><ExternalLink :size="14" /> Open developer.spotify.com</a>
            </div>
          </li>

          <li>
            <span class="num">2</span>
            <div class="step">
              <h2>Create an app</h2>
              <p class="muted">
                Click <strong>Create app</strong>. The name and description can be anything, such as "Stratus". Under
                "Which API/SDKs are you planning to use?", check <strong>Web API</strong> and <strong>Web Playback SDK</strong>.
              </p>
            </div>
          </li>

          <li>
            <span class="num">3</span>
            <div class="step">
              <h2>Add the redirect URIs</h2>
              <p class="muted">
                In the same form, add these under <strong>Redirect URIs</strong>, then accept the terms and save. Spotify compares them
                character by character. The first is the one this app uses; add the second too if you also use Stratus there.
              </p>
              <div class="uris">
                <div v-for="r in redirects" :key="r.uri" class="uri">
                  <span class="uri-label faint">{{ r.label }}</span>
                  <!-- Line breaks only after slashes when the URI has to wrap. -->
                  <code><template v-for="(part, i) in r.uri.split(/(?<=\/)/)" :key="i">{{ part }}<wbr /></template></code>
                  <button class="btn small" :aria-label="`Copy ${r.uri}`" @click="copy(r.uri)">
                    <Check v-if="copied === r.uri" :size="14" />
                    <Copy v-else :size="14" />
                    {{ copied === r.uri ? "Copied" : "Copy" }}
                  </button>
                </div>
              </div>
            </div>
          </li>

          <li>
            <span class="num">4</span>
            <div class="step">
              <h2>Paste the Client ID</h2>
              <p class="muted">
                Open the app you made and go to its settings. Copy the <strong>Client ID</strong>. Stratus never needs the Client secret.
              </p>
              <label class="field">
                <span class="sr-only">Client ID</span>
                <input
                  v-model="clientIdInput"
                  class="client-id"
                  placeholder="32 characters, like 1a2b3c…"
                  spellcheck="false"
                  autocapitalize="off"
                  autocomplete="off"
                  maxlength="64"
                  :aria-invalid="!!idHint"
                  @keydown.enter="connect"
                />
                <small v-if="idHint" class="err">{{ idHint }}</small>
                <small v-else-if="validId" class="ok"><Check :size="13" /> Looks like a Client ID.</small>
              </label>
            </div>
          </li>

          <li>
            <span class="num">5</span>
            <div class="step">
              <h2>Connect</h2>
              <p class="muted">
                {{ desktop
                  ? "Spotify opens in your browser. Approve Stratus there, then come back to this window."
                  : "This page goes to Spotify. Approve Stratus there and it brings you back here." }}
              </p>

              <!-- Connected: who, and whether playback will work -->
              <div v-if="spotify.status === 'connected' && spotify.profile" class="result">
                <div class="who">
                  <Artwork :src="spotify.profile.avatarUrl" :size="44" round />
                  <div class="who-text">
                    <strong>{{ spotify.profile.displayName }}</strong>
                    <span class="muted">
                      Premium:
                      <template v-if="premium === 'yes'">yes</template>
                      <template v-else-if="premium === 'no'">no</template>
                      <template v-else>not reported by Spotify</template>
                    </span>
                  </div>
                </div>
                <template v-if="premium === 'no'">
                  <div class="notice warn">
                    <TriangleAlert :size="18" />
                    <p>
                      Spotify only lets Premium accounts play music in other apps, so Spotify playback won't work with this account.
                      You can use SoundCloud instead, or connect a Premium account.
                    </p>
                  </div>
                  <div class="row">
                    <button class="btn primary" @click="chooseSoundCloud">Use SoundCloud</button>
                    <button class="btn" @click="useAnotherAccount">Use another Spotify account</button>
                  </div>
                </template>
                <template v-else>
                  <p v-if="premium === 'unknown'" class="faint small">
                    Spotify didn't say which plan this account has. Stratus finds out when you first play a song.
                  </p>
                  <div class="row">
                    <button class="btn primary" @click="startSpotify">Start listening</button>
                    <button class="btn" :disabled="!validId" @click="connect">Reconnect</button>
                  </div>
                </template>
              </div>

              <div v-else class="row">
                <button class="btn primary" :disabled="!validId || spotify.status === 'connecting'" @click="connect">
                  <Loader2 v-if="spotify.status === 'connecting'" :size="15" class="spin" />
                  {{ spotify.status === "connecting" ? "Waiting for Spotify…" : "Connect Spotify" }}
                </button>
              </div>
              <p v-if="spotify.status === 'error' && spotify.error" class="err form-err" role="alert">{{ spotify.error }}</p>
            </div>
          </li>
        </ol>

        <p class="skip">
          <button class="link" @click="skip">{{ fromSettings ? "Cancel" : "Skip for now and use SoundCloud" }}</button>
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.welcome { max-width: 860px; margin: 0 auto; padding: 72px 24px 48px; }
.intro { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; margin-bottom: 32px; }
.intro p { margin: 0; }
.mark { height: 30px; color: var(--accent); }
.mark :deep(svg) { height: 100%; width: auto; }
h1 { margin: 0; font-size: 28px; font-weight: 750; letter-spacing: -0.02em; }

.choices { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.choice {
  --brand: var(--accent);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 22px 22px 20px;
  border-radius: var(--radius-lg);
  background: var(--raised);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
  text-align: left;
  transition: box-shadow 0.15s, transform 0.1s;
}
.choice.spotify { --brand: #1ed760; }
.choice.soundcloud { --brand: #ff5500; }
@media (hover: hover) { .choice:hover { box-shadow: var(--shadow), inset 0 0 0 1.5px var(--brand); } }
.choice:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.choice:active { transform: scale(0.99); }
.choice-head { display: flex; align-items: center; gap: 10px; }
.name { font-size: 20px; font-weight: 750; letter-spacing: -0.01em; }
.tag {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand);
  background: color-mix(in srgb, var(--brand) 16%, transparent);
}
.body { color: var(--text-2); line-height: 1.55; flex: 1; }
.go { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; color: var(--brand); }
:root[data-theme="light"] .choice.spotify { --brand: #128a3e; }

.guide { max-width: 640px; margin: 0 auto; }
.back { margin-bottom: 18px; }
.lead { margin: 8px 0 24px; line-height: 1.55; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.steps li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 14px; padding: 16px; border-radius: var(--radius); background: var(--hover); }
.num {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.step { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.step h2 { margin: 3px 0 0; font-size: 15px; }
.step p { margin: 0; line-height: 1.5; }
.step strong { color: var(--text); }
a.btn:hover { text-decoration: none; }

.uris { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.uri { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "label label" "code copy"; gap: 4px 8px; align-items: center; }
.uri-label { grid-area: label; font-size: 11.5px; }
.uri code {
  grid-area: code;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--active);
  font: 12.5px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
  overflow-wrap: break-word;
  user-select: all;
}
.uri .btn { grid-area: copy; }
.btn.small { height: 30px; padding: 0 10px; min-width: 86px; justify-content: center; }

.field { display: flex; flex-direction: column; gap: 5px; width: 100%; }
.client-id { width: 100%; max-width: 420px; height: 36px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.client-id[aria-invalid="true"] { border-color: #ff6b6b; }
.field small { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.err { color: #ff6b6b; user-select: text; }
.ok { color: #30d158; }
:root[data-theme="light"] .ok { color: #1a9c42; }
.form-err { margin: 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, #ff6b6b 12%, transparent); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.row { display: flex; flex-wrap: wrap; gap: 8px; }
.result { display: flex; flex-direction: column; gap: 12px; width: 100%; padding: 14px; border-radius: var(--radius); background: var(--raised); box-shadow: inset 0 0 0 1px var(--border); }
.who { display: flex; align-items: center; gap: 12px; }
.who-text { display: flex; flex-direction: column; min-width: 0; }
.who-text strong { font-size: 15px; }
.notice { display: flex; gap: 10px; padding: 10px 12px; border-radius: var(--radius); }
.notice.warn { background: color-mix(in srgb, #ffb340 14%, transparent); }
.notice.warn svg { flex: none; color: #ffb340; margin-top: 1px; }
.small { font-size: 12px; }

.skip { text-align: center; margin: 22px 0 0; }
.link { color: var(--text-2); font-weight: 600; }
@media (hover: hover) { .link:hover { color: var(--text); text-decoration: underline; } }

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .welcome { padding: calc(28px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom)); }
  h1 { font-size: 26px; }
  .choices { grid-template-columns: minmax(0, 1fr); }
  .steps li { grid-template-columns: 24px minmax(0, 1fr); gap: 12px; padding: 14px 12px; }
  .num { width: 24px; height: 24px; font-size: 12px; }
  .client-id { height: 42px; }
  /* Copy button on the label's line, so the URI gets the full width. */
  .uri { grid-template-areas: "label copy" "code code"; gap: 6px 8px; }
  .btn.small { height: 34px; padding: 0 12px; }
}
</style>
