<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Disc3, Heart, History, Home, ListMusic, Radio, Search, Settings, Users,
} from "lucide-vue-next";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const library = useLibrary();
const ui = useUi();
const route = useRoute();
const router = useRouter();
const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const input = ref<HTMLInputElement>();

watch(() => ui.searchFocus, () => {
  input.value?.focus();
  input.value?.select();
});

function search() {
  const q = query.value.trim();
  if (q) router.push({ path: "/search", query: { q } });
}

const main = [
  { to: "/", label: "Home", icon: Home },
  { to: "/stream", label: "Stream", icon: Radio },
];
const lib = [
  { to: "/library/likes", label: "Likes", icon: Heart },
  { to: "/library/playlists", label: "Playlists", icon: ListMusic },
  { to: "/library/albums", label: "Albums", icon: Disc3 },
  { to: "/library/following", label: "Following", icon: Users },
  { to: "/library/history", label: "History", icon: History },
];
</script>

<template>
  <aside class="sidebar">
    <div class="titlebar drag" />
    <form class="search" @submit.prevent="search">
      <Search :size="15" class="search-icon" />
      <input ref="input" v-model="query" type="search" placeholder="Search" spellcheck="false" />
    </form>

    <nav>
      <RouterLink v-for="item in main" :key="item.to" :to="item.to" class="item">
        <component :is="item.icon" :size="17" /> {{ item.label }}
      </RouterLink>

      <div class="heading">Library</div>
      <RouterLink v-for="item in lib" :key="item.to" :to="item.to" class="item">
        <component :is="item.icon" :size="17" /> {{ item.label }}
      </RouterLink>

      <template v-if="library.playlists.length">
        <div class="heading">Your playlists</div>
        <RouterLink v-for="p in library.playlists" :key="p.id" :to="`/playlist/${p.id}`" class="item playlist">
          <Artwork :src="p.artworkUrl" :size="20" :radius="4" />
          <span class="ellipsis">{{ p.title }}</span>
        </RouterLink>
      </template>
    </nav>

    <div class="footer">
      <RouterLink v-if="library.me" :to="`/user/${library.me.id}`" class="me">
        <Artwork :src="library.me.avatarUrl" :size="26" round />
        <span class="ellipsis">{{ library.me.username }}</span>
      </RouterLink>
      <span v-else class="me faint">Not signed in</span>
      <RouterLink to="/settings" class="icon-btn" title="Settings"><Settings :size="17" /></RouterLink>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  background: var(--sidebar);
}
.titlebar { height: 46px; flex: none; }
:root:not([data-platform="darwin"]) .titlebar { height: 14px; }
.search { position: relative; margin: 0 12px 10px; }
.search input { width: 100%; height: 30px; padding-left: 30px; background: var(--hover); border-color: transparent; }
.search input:focus { border-color: var(--accent); }
.search-icon { position: absolute; left: 10px; top: 8px; color: var(--text-3); pointer-events: none; }
nav { flex: 1; overflow-y: auto; padding: 0 10px 12px; }
.heading {
  margin: 18px 10px 6px;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--text-2);
  font-weight: 550;
}
.item:hover { background: var(--hover); color: var(--text); text-decoration: none; }
.item.router-exact-active { background: var(--active); color: var(--text); }
.item.router-exact-active svg { color: var(--accent); }
.item.playlist { gap: 9px; font-weight: 500; }
.footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.me { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; font-weight: 600; }
.me:hover { text-decoration: none; }
</style>
