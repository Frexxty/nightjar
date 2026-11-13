<script setup lang="ts">
import { computed } from "vue";
import type { Track } from "@/api";
import LoadMore from "@/components/LoadMore.vue";
import LoadState from "@/components/LoadState.vue";
import StreamItem from "@/components/StreamItem.vue";
import { usePaged } from "@/lib/useLoad";

const { items, next, more, loading, loadingMore, error, needsAuth, reload } = usePaged((b, cursor) => b.feed(cursor));
const queue = computed(() => items.value.flatMap((e): Track[] => (e.kind === "track" ? [e.track] : [])));
</script>

<template>
  <div class="page stream">
    <h1 class="page-title">Stream</h1>
    <p class="muted intro">New posts and reposts from the people you follow.</p>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!items.length"
      empty-text="Follow some artists to fill your stream."
      sign-in-text="Sign in to see new posts and reposts from the artists you follow."
      :needs-auth="needsAuth"
      @retry="reload"
    >
      <StreamItem v-for="(e, i) in items" :key="i" :entry="e" :queue="queue" />
      <LoadMore :has-more="!!next" :loading="loadingMore" done-text="You're all caught up." @more="more" />
    </LoadState>
  </div>
</template>

<style scoped>
.stream { max-width: 920px; }
.intro { margin: -12px 0 8px; }
</style>
