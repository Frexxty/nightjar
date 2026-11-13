<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-vue-next";
import { api, createBackend, loadBackendConfig, useBackend, type BackendConfig } from "@/api";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useUpdates } from "@/stores/updates";

const settings = useSettings();
const ui = useUi();
const updates = useUpdates();
const isWindows = window.stratus?.platform === "win32";
const backend = reactive<BackendConfig>(loadBackendConfig());
const test = ref<{ ok: boolean; message: string } | null>(null);
const testing = ref(false);

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
  useBackend({ ...backend });
  ui.notify(`Using the ${api.value.name} backend`);
}
</script>

<template>
  <div class="page settings">
    <h1 class="page-title">Settings</h1>

    <section>
      <h2>Backend</h2>
      <p class="muted">Stratus is only the UI. Point it at a server that implements the routes in BACKEND.md, or use the built-in mock.</p>
      <div class="field">
        <label>Source</label>
        <div class="seg">
          <button :class="{ active: backend.kind === 'mock' }" @click="backend.kind = 'mock'">Mock data</button>
          <button :class="{ active: backend.kind === 'http' }" @click="backend.kind = 'http'">HTTP server</button>
        </div>
      </div>
      <template v-if="backend.kind === 'http'">
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
.update-status.error { color: #ff6b6b; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
