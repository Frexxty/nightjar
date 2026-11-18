<script setup lang="ts">
// "New playlist" and "Edit details". Opened through ui.newPlaylist() or by
// setting ui.playlistDialog to an edit state (PlaylistView).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ListMusic, X } from "lucide-vue-next";
import { friendlyError } from "@/api";
import { playlistTitleError } from "@/lib/playlistEdit";
import { useLibrary } from "@/stores/library";
import { useMyPlaylists } from "@/stores/myPlaylists";
import { useUi } from "@/stores/ui";

const ui = useUi();
const library = useLibrary();
const mine = useMyPlaylists();
const router = useRouter();

const state = computed(() => ui.playlistDialog);
const editing = computed(() => state.value?.mode === "edit");
const title = ref("");
const description = ref("");
const isPublic = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);
const nameInput = ref<HTMLInputElement>();

/** Where the playlist lives: the account, or only this device. */
const onDevice = computed(() => {
  const s = state.value;
  if (!s) return false;
  return s.mode === "edit" ? s.local : !mine.toAccount;
});
const trackCount = computed(() => (state.value?.mode === "create" ? state.value.tracks.length : 0));

watch(state, async (s) => {
  if (!s) return;
  error.value = null;
  saving.value = false;
  if (s.mode === "edit") {
    title.value = s.playlist.title;
    description.value = s.playlist.description ?? "";
    isPublic.value = !!s.playlist.public;
  } else {
    title.value = s.title ?? "";
    description.value = s.description ?? "";
    isPublic.value = false;
  }
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
});

function close() {
  if (!saving.value) ui.playlistDialog = null;
}

async function submit() {
  const s = state.value;
  if (!s || saving.value) return;
  error.value = playlistTitleError(title.value);
  if (error.value) return nameInput.value?.focus();
  const name = title.value.trim();
  const desc = description.value.trim();

  if (s.mode === "edit") {
    const patch: { title?: string; description?: string | null; public?: boolean } = {};
    if (name !== s.playlist.title) patch.title = name;
    if (desc !== (s.playlist.description ?? "")) patch.description = desc || null;
    if (!s.local && isPublic.value !== !!s.playlist.public) patch.public = isPublic.value;
    if (Object.keys(patch).length) s.save(patch);
    ui.playlistDialog = null;
    return;
  }

  saving.value = true;
  try {
    const p = await mine.create({ title: name, description: desc, isPublic: isPublic.value, tracks: s.tracks });
    ui.playlistDialog = null;
    const where = onDevice.value ? " on this device" : "";
    ui.notify(s.tracks.length ? `Added ${s.tracks.length === 1 ? `"${s.tracks[0].title}"` : `${s.tracks.length} tracks`} to "${p.title}"${where}` : `Created "${p.title}"${where}`);
    s.done?.(p);
    if (s.open) void router.push(`/playlist/${p.id}`);
  } catch (err) {
    error.value = friendlyError(err);
  } finally {
    saving.value = false;
  }
}

function signIn() {
  ui.playlistDialog = null;
  library.signIn();
}

const onKey = (e: KeyboardEvent) => e.key === "Escape" && state.value && close();
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="state" class="scrim" @mousedown.self="close">
        <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title" @submit.prevent="submit">
          <header>
            <div class="badge"><ListMusic :size="20" /></div>
            <div class="titles">
              <h2 id="playlist-dialog-title">{{ editing ? "Edit details" : "New playlist" }}</h2>
              <p v-if="trackCount" class="muted">Starts with {{ trackCount === 1 ? "1 track" : `${trackCount} tracks` }}</p>
            </div>
            <button type="button" class="icon-btn" title="Close" :disabled="saving" @click="close"><X :size="16" /></button>
          </header>

          <label class="field">
            <span>Name</span>
            <input ref="nameInput" v-model="title" maxlength="100" placeholder="My playlist" autocomplete="off" :aria-invalid="!!error" />
          </label>
          <label class="field">
            <span>Description <span class="faint">(optional)</span></span>
            <textarea v-model="description" rows="3" maxlength="2000" placeholder="What's it for?" />
          </label>
          <label v-if="!onDevice" class="check">
            <input v-model="isPublic" type="checkbox" />
            <span>
              Public
              <span class="faint">Anyone with the link can open it. Private playlists are only for you.</span>
            </span>
          </label>
          <p v-else class="note">
            Saved on this device only.
            <template v-if="!editing && library.accounts && library.signedOut">
              <a href="#" @click.prevent="signIn">Sign in</a> to keep playlists in your account and on your other devices.
            </template>
          </p>

          <p v-if="error" class="error" role="alert">{{ error }}</p>

          <footer>
            <button type="button" class="btn" :disabled="saving" @click="close">Cancel</button>
            <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Saving…" : editing ? "Save" : "Create" }}</button>
          </footer>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.35);
}
.dialog {
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--overlay);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
}
header { display: flex; align-items: flex-start; gap: 12px; }
.badge { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }
.titles { flex: 1; min-width: 0; }
h2 { margin: 0 0 2px; font-size: 16px; }
.titles p { margin: 0; font-size: 12.5px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
.field input, .field textarea { width: 100%; font-size: 14px; font-weight: 500; color: var(--text); }
.field textarea { resize: vertical; min-height: 64px; font-family: inherit; }
.check { display: flex; align-items: flex-start; gap: 10px; font-weight: 600; }
.check input { width: 16px; height: 16px; margin-top: 2px; accent-color: var(--accent); flex: none; }
.check .faint { display: block; font-weight: 400; font-size: 12.5px; }
.note { margin: 0; font-size: 12.5px; color: var(--text-2); }
.note a { color: var(--accent); }
.error { margin: 0; color: #ff6b6b; font-size: 13px; }
footer { display: flex; justify-content: flex-end; gap: 8px; }
.dialog-enter-active, .dialog-leave-active { transition: opacity 0.18s ease; }
.dialog-enter-active .dialog, .dialog-leave-active .dialog { transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1); }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog, .dialog-leave-to .dialog { transform: scale(0.96); }
/* Phone: a sheet from the bottom, above the keyboard. */
@media (max-width: 760px) {
  .scrim { place-items: end center; padding: 0 0 env(safe-area-inset-bottom); }
  .dialog { width: 100%; border-radius: 16px 16px 0 0; padding-bottom: 24px; }
  .field input, .field textarea { font-size: 16px; }
  .dialog-enter-from .dialog, .dialog-leave-to .dialog { transform: translateY(40px); }
}
</style>
