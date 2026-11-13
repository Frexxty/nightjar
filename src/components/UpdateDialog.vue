<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { AlertCircle, Download, RefreshCw, X } from "lucide-vue-next";
import MarkdownInline from "@/components/MarkdownInline.vue";
import { parseMarkdown } from "@/lib/markdown";
import { useUpdates } from "@/stores/updates";

const updates = useUpdates();
const state = computed(() => updates.state);
const notes = computed(() => parseMarkdown(state.value.notes ?? ""));
const busy = computed(() => state.value.status === "downloading");

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && updates.dialog && !busy.value && updates.countdown === null) updates.later();
};
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="update">
      <div v-if="updates.dialog" class="scrim">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
          <header>
            <div class="badge"><AlertCircle v-if="state.status === 'error'" :size="20" /><Download v-else :size="20" /></div>
            <div class="titles">
              <h2 id="update-title">
                <template v-if="state.status === 'error'">Update failed</template>
                <template v-else-if="state.status === 'downloaded'">Ready to install</template>
                <template v-else>A new version of Stratus is available</template>
              </h2>
              <p class="muted">
                <template v-if="state.version">Stratus {{ state.version }}</template>
                <template v-if="updates.info"> · you have {{ updates.info.currentVersion }}</template>
              </p>
            </div>
            <button class="icon-btn" title="Close" :disabled="busy || updates.countdown !== null" @click="updates.later()">
              <X :size="16" />
            </button>
          </header>

          <div v-if="state.status === 'error'" class="error">{{ state.error }}</div>

          <div v-if="notes.length" class="notes">
            <template v-for="(block, i) in notes" :key="i">
              <component :is="`h${Math.min(block.level + 2, 6)}`" v-if="block.kind === 'heading'">
                <MarkdownInline :parts="block.inlines" />
              </component>
              <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
              <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'">
                <li v-for="(item, k) in block.items" :key="k">
                  <MarkdownInline :parts="item" />
                </li>
              </component>
              <p v-else>
                <MarkdownInline :parts="block.inlines" />
              </p>
            </template>
          </div>

          <div v-if="busy" class="progress" role="progressbar" :aria-valuenow="state.progress ?? 0" aria-valuemin="0" aria-valuemax="100">
            <div class="bar"><div class="fill" :style="{ width: `${state.progress ?? 0}%` }" /></div>
            <span class="faint">{{ state.progress ?? 0 }}%</span>
          </div>

          <footer>
            <template v-if="state.status === 'downloaded'">
              <template v-if="updates.countdown !== null">
                <span class="muted grow">Restarting in {{ updates.countdown }}…</span>
                <button class="btn" @click="updates.cancelRestart()">Cancel</button>
              </template>
              <template v-else>
                <span class="grow" />
                <button class="btn" @click="updates.later()">Later</button>
                <button class="btn primary" @click="updates.install()"><RefreshCw :size="14" /> Restart to update</button>
              </template>
            </template>
            <template v-else-if="busy">
              <span class="muted grow">Downloading…</span>
            </template>
            <template v-else>
              <button v-if="state.version && state.status !== 'error'" class="btn" @click="updates.skip()">Skip this version</button>
              <span class="grow" />
              <button class="btn" @click="updates.later()">Later</button>
              <button v-if="state.version" class="btn primary" @click="updates.download()">
                <Download :size="14" /> {{ state.status === "error" ? "Try again" : "Download & Install" }}
              </button>
            </template>
          </footer>
        </div>
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
  background: rgba(0, 0, 0, 0.35);
}
.dialog {
  width: min(520px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
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
.badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}
.titles { flex: 1; min-width: 0; }
h2 { margin: 0 0 2px; font-size: 16px; }
.titles p { margin: 0; }
.error { color: #ff6b6b; user-select: text; }
.notes {
  overflow-y: auto;
  min-height: 0;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--hover);
  color: var(--text-2);
  user-select: text;
}
.notes :is(h3, h4, h5, h6) { margin: 10px 0 4px; color: var(--text); font-size: 13.5px; }
.notes :is(h3, h4, h5, h6):first-child { margin-top: 0; }
.notes p, .notes ul, .notes ol { margin: 0 0 8px; }
.notes ul, .notes ol { padding-left: 18px; }
.notes a { color: var(--accent); }
.notes code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.notes pre { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--active); overflow-x: auto; }
.progress { display: flex; align-items: center; gap: 10px; font-variant-numeric: tabular-nums; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: var(--active); overflow: hidden; }
.fill { height: 100%; background: var(--accent); transition: width 0.2s ease; }
footer { display: flex; align-items: center; gap: 8px; }
.grow { flex: 1; }
.update-enter-active, .update-leave-active { transition: opacity 0.18s ease; }
.update-enter-active .dialog, .update-leave-active .dialog { transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1); }
.update-enter-from, .update-leave-to { opacity: 0; }
.update-enter-from .dialog, .update-leave-to .dialog { transform: scale(0.96); }
</style>
