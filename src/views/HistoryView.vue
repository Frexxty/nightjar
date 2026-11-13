<script setup lang="ts">
import { computed, watch } from "vue";
import { api } from "@/api";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import SignInPrompt from "@/components/SignInPrompt.vue";
import TrackTable from "@/components/TrackTable.vue";
import { usePaged } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";

const library = useLibrary();

// Signed in to a backend that keeps history: show the account's. Otherwise
// show the plays recorded on this computer.
const fromAccount = computed(() => !!library.me && typeof api.value.history === "function");
const { items, next, more, loading, loadingMore, error, reload } = usePaged((b, cursor) =>
  fromAccount.value && b.history ? b.history(cursor) : Promise.resolve({ items: [], next: null }),
);
watch(fromAccount, (yes) => yes && reload());
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">History</h1>
      <button v-if="!fromAccount && library.history.length" class="btn" @click="library.clearHistory()">Clear history</button>
    </div>

    <LoadState v-if="fromAccount" :loading="loading" :error="error" :empty="!items.length" empty-text="Tracks you play show up here." @retry="reload">
      <TrackTable :tracks="items" source="history" />
      <LoadMore :has-more="!!next" :loading="loadingMore" @more="more" />
    </LoadState>

    <template v-else>
      <SignInPrompt
        v-if="library.accounts && library.signedOut"
        compact
        title="This history is only on this computer"
        text="Sign in to keep what you play in your account."
        class="banner"
      />
      <TrackTable v-if="library.history.length" :tracks="library.history" source="history" />
      <div v-else class="empty">Tracks you play show up here.</div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.head .page-title { margin: 0; }
.banner { margin-bottom: 18px; }
</style>
