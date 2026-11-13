<script setup lang="ts">
import { ref } from "vue";
import { GripVertical, X } from "lucide-vue-next";
import { duration } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

const player = usePlayer();
const ui = useUi();
const menus = useMenus();
const tab = ref<"next" | "history">("next");
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function drop(to: number) {
  if (dragFrom.value != null) player.moveInQueue(dragFrom.value, to);
  dragFrom.value = dragOver.value = null;
}
</script>

<template>
  <div class="queue">
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'next' }" @click="tab = 'next'">Up Next</button>
      <button class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">History</button>
      <button v-if="tab === 'next' && player.upNext.length" class="clear faint" @click="player.clearUpNext()">Clear</button>
    </div>

    <div class="list">
      <template v-if="tab === 'next'">
        <div v-if="player.current" class="now">
          <div class="label faint">Now playing</div>
          <div class="row current">
            <Artwork :src="player.current.artworkUrl" :size="40" :radius="5" />
            <div class="meta"><div class="t ellipsis">{{ player.current.title }}</div><div class="a ellipsis">{{ player.current.user.username }}</div></div>
          </div>
        </div>
        <p v-if="!player.upNext.length" class="empty-note">Nothing queued.{{ player.current ? " Related tracks will play when the queue ends." : "" }}</p>
        <div
          v-for="(t, k) in player.upNext"
          :key="`${t.id}-${k}`"
          class="row"
          :class="{ over: dragOver === player.index + 1 + k }"
          draggable="true"
          @dragstart="dragFrom = player.index + 1 + k"
          @dragover.prevent="dragOver = player.index + 1 + k"
          @drop="drop(player.index + 1 + k)"
          @dragend="dragFrom = dragOver = null"
          @dblclick="player.jumpTo(player.index + 1 + k)"
          @contextmenu="ui.openMenu($event, menus.track(t, [{ label: 'Remove from queue', danger: true, action: () => player.removeAt(player.index + 1 + k) }]))"
        >
          <GripVertical :size="14" class="grip" />
          <Artwork :src="t.artworkUrl" :size="40" :radius="5" />
          <div class="meta"><div class="t ellipsis">{{ t.title }}</div><div class="a ellipsis">{{ t.user.username }}</div></div>
          <span class="d faint">{{ duration(t.duration) }}</span>
          <button class="icon-btn x" title="Remove" @click="player.removeAt(player.index + 1 + k)"><X :size="14" /></button>
        </div>
      </template>

      <template v-else>
        <p v-if="!player.previous.length" class="empty-note">Tracks you've played from this queue show up here.</p>
        <div v-for="(t, k) in [...player.previous].reverse()" :key="`${t.id}-${k}`" class="row" @dblclick="player.jumpTo(player.index - 1 - k)">
          <Artwork :src="t.artworkUrl" :size="40" :radius="5" />
          <div class="meta"><div class="t ellipsis">{{ t.title }}</div><div class="a ellipsis">{{ t.user.username }}</div></div>
          <span class="d faint">{{ duration(t.duration) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.queue { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.tabs { padding: 0 12px; margin-bottom: 8px; align-items: center; }
.clear { margin-left: auto; font-size: 12px; }
.clear:hover { color: var(--text); }
.list { flex: 1; overflow-y: auto; padding: 0 8px 20px; }
.label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: 4px 8px 4px; }
.now { margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.row:hover { background: var(--hover); }
.row.over { box-shadow: inset 0 2px 0 var(--accent); }
.row.current .t { color: var(--accent); }
.grip { color: var(--text-3); cursor: grab; flex: none; margin-right: -4px; }
.meta { flex: 1; min-width: 0; }
.t { font-weight: 600; }
.a { font-size: 12px; color: var(--text-2); }
.d { font-size: 12px; font-variant-numeric: tabular-nums; }
.x { width: 24px; height: 24px; opacity: 0; }
.row:hover .x { opacity: 1; }
.row:hover .d { display: none; }
.empty-note { color: var(--text-3); font-size: 12.5px; padding: 12px 8px; }
</style>
