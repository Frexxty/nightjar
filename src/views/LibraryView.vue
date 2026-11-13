<script setup lang="ts">
// The Library tab on phones: what the desktop sidebar lists under Library and
// Your playlists, plus Settings, which has no other way in on a phone.
import { ChevronRight, Settings } from "lucide-vue-next";
import Artwork from "@/components/Artwork.vue";
import { libraryLinks, useYourPlaylists } from "@/lib/nav";
import { useLibrary } from "@/stores/library";

const library = useLibrary();
const playlists = useYourPlaylists();
</script>

<template>
  <div class="page library">
    <h1 class="page-title">Library</h1>

    <nav class="list">
      <RouterLink v-for="item in libraryLinks" :key="item.to" :to="item.to" class="link">
        <component :is="item.icon" :size="21" class="icon" />
        <span class="label">{{ item.label }}</span>
        <ChevronRight :size="18" class="chev" />
      </RouterLink>
    </nav>

    <template v-if="playlists.length">
      <h2 class="section-title">Your playlists</h2>
      <nav class="list">
        <RouterLink v-for="p in playlists" :key="p.id" :to="`/playlist/${p.id}`" class="link playlist">
          <Artwork :src="p.artworkUrl" :size="48" :radius="6" />
          <span class="label">
            <span class="ellipsis">{{ p.title }}</span>
            <span class="sub ellipsis">{{ p.trackCount }} tracks</span>
          </span>
          <ChevronRight :size="18" class="chev" />
        </RouterLink>
      </nav>
    </template>

    <nav class="list">
      <RouterLink v-if="library.me" :to="`/user/${library.me.id}`" class="link">
        <Artwork :src="library.me.avatarUrl" :size="28" round />
        <span class="label ellipsis">{{ library.me.username }}</span>
        <ChevronRight :size="18" class="chev" />
      </RouterLink>
      <RouterLink to="/settings" class="link">
        <Settings :size="21" class="icon" />
        <span class="label">Settings</span>
        <ChevronRight :size="18" class="chev" />
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.library { max-width: 720px; }
.section-title { margin: 28px 0 8px; }
.list { display: flex; flex-direction: column; margin-bottom: 8px; }
.link {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 50px;
  padding: 0 4px;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
  font-weight: 500;
}
.link:hover { text-decoration: none; }
.link:active { background: var(--hover); }
.link.playlist { min-height: 64px; }
.icon { color: var(--accent); flex: none; }
.label { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sub { font-size: 13px; color: var(--text-2); }
.chev { color: var(--text-3); flex: none; }
.list + .list { margin-top: 28px; }
</style>
