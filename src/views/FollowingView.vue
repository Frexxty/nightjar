<script setup lang="ts">
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import { useLoad } from "@/lib/useLoad";

const { data, loading, error, reload } = useLoad((b) => b.following());
</script>

<template>
  <div class="page">
    <h1 class="page-title">Following</h1>
    <LoadState :loading="loading" :error="error" :empty="!data?.length" empty-text="Artists you follow show up here." @retry="reload">
      <div class="grid">
        <MediaCard v-for="u in data" :key="u.id" kind="user" :item="u" />
      </div>
    </LoadState>
  </div>
</template>
