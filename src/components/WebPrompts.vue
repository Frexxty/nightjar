<script setup lang="ts">
// Web build only: "New version available" once a new service worker is
// waiting, and on iOS Safari a hint for Add to Home Screen.
import { ref } from "vue";
import { Share, X } from "lucide-vue-next";
import { applyUpdate, dismissInstallHint, shouldShowInstallHint, updateReady } from "@/lib/pwa";

const hint = ref(shouldShowInstallHint());

function dismiss() {
  hint.value = false;
  dismissInstallHint();
}
</script>

<template>
  <div class="web-prompts">
    <Transition name="prompt">
      <div v-if="updateReady" class="prompt" role="status">
        <span class="text">New version available</span>
        <button class="btn primary" @click="applyUpdate">Reload</button>
      </div>
    </Transition>
    <Transition name="prompt">
      <div v-if="hint && !updateReady" class="prompt hint" role="note">
        <img :src="'/icons/apple-touch-icon.png'" alt="" class="app-icon" />
        <span class="text">Install: tap <Share :size="15" class="share" aria-label="Share" /> Share, then Add to Home Screen</span>
        <button class="icon-btn" title="Dismiss" @click="dismiss"><X :size="16" /></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.web-prompts {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--dock, 0px) + 12px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
  pointer-events: none;
}
.prompt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(440px, 100%);
  padding: 8px 8px 8px 14px;
  border-radius: 14px;
  background: var(--overlay);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
  pointer-events: auto;
}
.hint { padding-left: 8px; }
.text { flex: 1; min-width: 0; font-size: 14px; font-weight: 550; line-height: 1.35; }
.share { vertical-align: -2px; color: var(--accent); }
.app-icon { width: 38px; height: 38px; border-radius: 9px; flex: none; }
.btn { flex: none; }
.icon-btn { flex: none; width: 44px; height: 44px; margin: -6px 0; }
.prompt-enter-active, .prompt-leave-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.32, 0.72, 0, 1); }
.prompt-enter-from, .prompt-leave-to { opacity: 0; transform: translateY(12px); }
</style>
