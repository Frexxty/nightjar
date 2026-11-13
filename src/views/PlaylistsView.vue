<script setup lang="ts">
import { computed } from "vue";
import LoadState from "@/components/LoadState.vue";
import MediaCard from "@/components/MediaCard.vue";
import SignInPrompt from "@/components/SignInPrompt.vue";
import { useLoad } from "@/lib/useLoad";
import { useLibrary } from "@/stores/library";
import { useLocalPlaylists } from "@/stores/localPlaylists";

const props = defineProps<{ albums: boolean }>();
const local = useLocalPlaylists();
const library = useLibrary();

const { data, loading, error, needsAuth, reload } = useLoad(async (b) => {
  if (props.albums) return (await b.likedPlaylists()).filter((p) => p.isAlbum);
  const [mine, liked] = await Promise.all([b.myPlaylists(), b.likedPlaylists()]);
  return [...mine, ...liked.filter((p) => !p.isAlbum)];
});

const askSignIn = computed(() => library.accounts && (library.signedOut || needsAuth.value));
const localItems = computed(() => (props.albums ? [] : local.playlists.map(local.asPlaylist)));
// Playlists saved on this machine (e.g. Spotify imports) come first.
const items = computed(() => [...localItems.value, ...(askSignIn.value ? [] : data.value ?? [])]);
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ albums ? "Albums" : "Playlists" }}</h1>
    <SignInPrompt
      v-if="askSignIn && !items.length"
      :text="albums ? 'Sign in to keep albums you like in your library.' : 'Sign in to keep playlists in your account and use them on every device.'"
    />
    <template v-else>
      <SignInPrompt
        v-if="askSignIn"
        compact
        title="These are only on this computer"
        text="Sign in to keep playlists in your account and use them on every device."
        class="banner"
      />
      <LoadState
        :loading="loading && !items.length"
        :error="items.length ? null : error"
        :empty="!items.length"
        :empty-text="albums ? 'Albums you like show up here.' : 'Playlists you make, import or like show up here.'"
        @retry="reload"
      >
        <div class="grid">
          <MediaCard v-for="p in items" :key="p.id" kind="playlist" :item="p" />
        </div>
      </LoadState>
    </template>
  </div>
</template>

<style scoped>
.banner { margin-bottom: 22px; }
</style>
