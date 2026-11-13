<script setup lang="ts">
// One card for tracks, playlists/albums and users, used by shelves and grids.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { BadgeCheck, MoreHorizontal, Pause, Play } from "lucide-vue-next";
import { api, type Playlist, type Track, type User } from "@/api";
import { count } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const props = defineProps<
  | { kind: "track"; item: Track; siblings?: Track[]; source?: string }
  | { kind: "playlist"; item: Playlist; siblings?: never; source?: never }
  | { kind: "user"; item: User; siblings?: never; source?: never }
>();

const router = useRouter();
const player = usePlayer();
const ui = useUi();
const menus = useMenus();

const href = computed(() => `/${props.kind}/${props.item.id}`);
const art = computed(() => (props.kind === "user" ? props.item.avatarUrl : props.item.artworkUrl));
const title = computed(() => (props.kind === "user" ? props.item.username : props.item.title));
const subtitle = computed(() => {
  if (props.kind === "user") return `${count(props.item.followersCount)} followers`;
  if (props.kind === "playlist") return `${props.item.isAlbum ? "Album" : "Playlist"} · ${props.item.user.username}`;
  return props.item.user.username;
});
const source = computed(() => (props.kind === "playlist" ? `playlist:${props.item.id}` : props.source ?? null));
const active = computed(() => {
  if (props.kind === "track") return player.isCurrent(props.item) && player.playing;
  if (props.kind === "playlist") return player.queueSource === source.value && player.playing;
  return false;
});

async function play() {
  if (props.kind === "track") {
    const list = props.siblings?.length ? props.siblings : [props.item];
    const i = Math.max(0, list.findIndex((t) => t.id === props.item.id));
    if (player.isCurrent(props.item)) player.toggle();
    else player.playTracks(list, i, source.value);
  } else if (props.kind === "playlist") {
    if (player.queueSource === source.value) return player.toggle();
    const tracks = props.item.tracks?.length ? props.item.tracks : (await api.value.playlist(props.item.id)).tracks ?? [];
    player.playTracks(tracks, 0, source.value);
  }
}

function menu(event: MouseEvent) {
  if (props.kind === "track") ui.openMenu(event, menus.track(props.item));
  else if (props.kind === "playlist") ui.openMenu(event, menus.playlist(props.item));
}
</script>

<template>
  <div class="card" :class="kind" @contextmenu="menu">
    <div class="cover" @click="router.push(href)">
      <Artwork :src="art" :round="kind === 'user'" :radius="10" />
      <template v-if="kind !== 'user'">
        <button class="fab" :class="{ active }" :title="active ? 'Pause' : 'Play'" @click.stop="play">
          <Pause v-if="active" :size="18" fill="currentColor" />
          <Play v-else :size="18" fill="currentColor" />
        </button>
        <button class="more" title="More" @click.stop="menu"><MoreHorizontal :size="16" /></button>
      </template>
    </div>
    <RouterLink :to="href" class="title ellipsis">
      {{ title }}
      <BadgeCheck v-if="kind === 'user' && item.verified" :size="13" class="verified" />
    </RouterLink>
    <RouterLink v-if="kind !== 'user' && item.user.id !== 'local'" :to="`/user/${item.user.id}`" class="subtitle ellipsis">{{ subtitle }}</RouterLink>
    <div v-else class="subtitle ellipsis">{{ subtitle }}</div>
  </div>
</template>

<style scoped>
.card { min-width: 0; }
.card.user { text-align: center; }
.cover { position: relative; cursor: pointer; margin-bottom: 8px; }
.cover :deep(.artwork) { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25), inset 0 0 0 1px var(--border); transition: filter 0.2s; }
@media (hover: hover) { .cover:hover :deep(.artwork) { filter: brightness(0.82); } }
.fab, .more {
  position: absolute;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
}
.fab {
  left: 10px;
  bottom: 10px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transform: translateY(4px);
}
@media (hover: hover) { .fab:hover { transform: scale(1.06); } }
.more {
  right: 10px;
  bottom: 10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  backdrop-filter: blur(10px);
}
@media (hover: hover) { .cover:hover .fab, .cover:hover .more { opacity: 1; transform: none; } }
.fab.active { opacity: 1; transform: none; }
/* Touch: play stays visible; the menu is a long press away. */
@media (hover: none) {
  .fab { opacity: 1; transform: none; width: 36px; height: 36px; left: 8px; bottom: 8px; }
  .more { display: none; }
  .fab::after { content: ""; position: absolute; inset: -6px; }
  .fab:active { transform: scale(0.92); }
  .cover:active :deep(.artwork) { filter: brightness(0.85); }
}
.title { display: block; font-weight: 600; }
.verified { color: var(--accent); vertical-align: -2px; }
.subtitle { display: block; color: var(--text-2); font-size: 12px; margin-top: 1px; }
@media (max-width: 760px) {
  .title { font-size: 14px; font-weight: 550; }
  .subtitle { font-size: 12.5px; }
}
</style>
