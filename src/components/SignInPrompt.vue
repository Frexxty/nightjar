<script setup lang="ts">
// Shown in place of pages and actions that need an account, instead of a 401 error.
import { useRoute, useRouter } from "vue-router";
import { UserRound } from "lucide-vue-next";

withDefaults(defineProps<{ title?: string; text: string; compact?: boolean }>(), { title: "Sign in to Nightjar", compact: false });

const route = useRoute();
const router = useRouter();

function open(mode: "signin" | "signup") {
  void router.push({ path: "/account", query: { next: route.fullPath, ...(mode === "signup" ? { mode } : {}) } });
}
</script>

<template>
  <div class="prompt" :class="{ compact }">
    <span class="badge"><UserRound :size="compact ? 18 : 24" /></span>
    <div class="text">
      <strong>{{ title }}</strong>
      <p class="muted">{{ text }}</p>
    </div>
    <div class="actions">
      <button class="btn primary" @click="open('signin')">Sign in</button>
      <button class="btn" @click="open('signup')">Create account</button>
    </div>
  </div>
</template>

<style scoped>
.prompt { display: grid; justify-items: center; gap: 12px; padding: 64px 20px; text-align: center; }
.badge { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
.text strong { font-size: 16px; }
.text p { margin: 4px 0 0; max-width: 380px; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.prompt.compact {
  grid-template-columns: auto minmax(0, 1fr) auto;
  justify-items: start;
  align-items: center;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--hover);
  text-align: left;
}
.compact .badge { width: 36px; height: 36px; }
.compact .text strong { font-size: 13.5px; }
@media (max-width: 560px) {
  .prompt.compact { grid-template-columns: auto minmax(0, 1fr); }
  .compact .actions { grid-column: 1 / -1; }
}
</style>
