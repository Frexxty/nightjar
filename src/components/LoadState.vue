<script setup lang="ts">
import { computed } from "vue";
import { CloudOff } from "lucide-vue-next";
import { useLibrary } from "@/stores/library";
import SignInPrompt from "./SignInPrompt.vue";
import SpotifyConnectPrompt from "./SpotifyConnectPrompt.vue";

const props = defineProps<{
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyText?: string;
  /** For pages that need an account: what signing in shows here. */
  signInText?: string;
  /** The load failed with a 401. */
  needsAuth?: boolean;
  /** The load needs a Spotify session (useLoad's `needsSpotify`). */
  needsSpotify?: boolean;
}>();
defineEmits<{ retry: [] }>();

const library = useLibrary();
const askSignIn = computed(() => !!props.signInText && library.accounts && (library.signedOut || props.needsAuth));
</script>

<template>
  <SpotifyConnectPrompt v-if="needsSpotify" />
  <SignInPrompt v-else-if="askSignIn" :text="signInText!" />
  <div v-else-if="error" class="empty">
    <CloudOff :size="34" />
    <div>Couldn't load this.</div>
    <code class="faint">{{ error }}</code>
    <button class="btn" @click="$emit('retry')">Try again</button>
  </div>
  <div v-else-if="loading" class="loading">
    <slot name="skeleton">
      <div v-for="i in 6" :key="i" class="skeleton line" :style="{ width: `${90 - i * 7}%` }" />
    </slot>
  </div>
  <div v-else-if="empty" class="empty">{{ emptyText ?? "Nothing here yet." }}</div>
  <slot v-else />
</template>

<style scoped>
.loading { display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }
.line { height: 40px; }
code { font-size: 11.5px; max-width: 520px; user-select: text; }
</style>
