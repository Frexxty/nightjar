<script setup lang="ts">
// Timed comments for the playing track, scrolled in sync with playback the way
// Cider scrolls lyrics. Clicking a comment seeks to its timestamp.
import { computed, nextTick, ref, watch } from "vue";
import { Send } from "lucide-vue-next";
import { api } from "@/api";
import { duration as fmt } from "@/lib/format";
import { usePlayer } from "@/stores/player";
import { useUi } from "@/stores/ui";
import Artwork from "./Artwork.vue";

withDefaults(defineProps<{ large?: boolean }>(), { large: false });

const player = usePlayer();
const ui = useUi();
const list = ref<HTMLDivElement>();
const draft = ref("");
const posting = ref(false);

const timed = computed(() => player.comments.filter((c) => c.timestamp != null));
const loose = computed(() => player.comments.filter((c) => c.timestamp == null));
const activeIndex = computed(() => {
  const now = player.currentTime * 1000;
  let idx = -1;
  timed.value.forEach((c, i) => {
    if (c.timestamp! <= now) idx = i;
  });
  return idx;
});

// Jump straight to the current comment on open or track change, then follow smoothly.
let first = true;
watch(() => player.current?.id, () => (first = true));
watch(activeIndex, async (i) => {
  await nextTick();
  const box = list.value;
  const el = box?.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (!box || !el) return;
  const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
  box.scrollTo({ top, behavior: first ? "instant" : "smooth" });
  first = false;
}, { immediate: true, flush: "post" });

async function post() {
  const t = player.current;
  const body = draft.value.trim();
  if (!t || !body || !api.value.postComment) return;
  posting.value = true;
  try {
    const c = await api.value.postComment(t.id, body, Math.round(player.currentTime * 1000));
    player.comments = [...player.comments, c].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    draft.value = "";
  } catch (err) {
    ui.notify(`Couldn't post comment: ${(err as Error).message}`);
  } finally {
    posting.value = false;
  }
}
</script>

<template>
  <div class="feed" :class="{ large }">
    <div ref="list" class="list">
      <p v-if="!player.current" class="empty">Play something to see its comments.</p>
      <p v-else-if="!player.comments.length" class="empty">No comments on this track yet.</p>
      <button
        v-for="(c, i) in timed"
        :key="c.id"
        :data-i="i"
        class="comment"
        :class="{ past: i < activeIndex, active: i === activeIndex }"
        @click="player.seek(c.timestamp! / 1000)"
      >
        <Artwork :src="c.user.avatarUrl" :size="large ? 30 : 24" round />
        <span class="text">
          <span class="who"><b>{{ c.user.username }}</b> <span class="at">at {{ fmt(c.timestamp!) }}</span></span>
          <span class="body">{{ c.body }}</span>
        </span>
      </button>
      <template v-if="loose.length">
        <div class="divider">Other comments</div>
        <div v-for="c in loose" :key="c.id" class="comment static">
          <Artwork :src="c.user.avatarUrl" :size="24" round />
          <span class="text"><span class="who"><b>{{ c.user.username }}</b></span><span class="body">{{ c.body }}</span></span>
        </div>
      </template>
    </div>
    <form v-if="player.current && api.postComment" class="compose" @submit.prevent="post">
      <input v-model="draft" :placeholder="`Comment at ${fmt(player.currentTime * 1000)}`" :disabled="posting" />
      <button class="icon-btn" :disabled="!draft.trim() || posting" title="Post"><Send :size="15" /></button>
    </form>
  </div>
</template>

<style scoped>
.feed { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.list { position: relative; flex: 1; overflow-y: auto; padding: 4px 8px 40px; mask-image: linear-gradient(transparent, #000 24px, #000 calc(100% - 40px), transparent); }
.empty { color: var(--text-3); text-align: center; padding: 40px 12px; }
.comment {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  text-align: left;
  opacity: 0.5;
  transition: opacity 0.3s, background 0.15s, transform 0.3s;
}
.comment:hover { background: var(--hover); opacity: 0.9; }
.comment.past { opacity: 0.35; }
.comment.active { opacity: 1; transform: scale(1.02); transform-origin: left center; }
.comment.static { opacity: 0.8; }
.text { display: flex; flex-direction: column; min-width: 0; }
.who { font-size: 11.5px; color: var(--text-2); }
.who b { color: var(--text); font-weight: 600; }
.comment.active .who b { color: var(--accent); }
.at { color: var(--text-3); }
.body { font-size: 13px; }
.large .body { font-size: 20px; font-weight: 650; line-height: 1.3; }
.large .comment { padding: 10px; }
.divider { margin: 16px 8px 6px; font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.compose { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--border); }
.compose input { flex: 1; }
</style>
