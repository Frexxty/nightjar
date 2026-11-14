<script setup lang="ts">
import { X } from "lucide-vue-next";
import { useUi } from "@/stores/ui";
import CommentFeed from "./CommentFeed.vue";
import QueueList from "./QueueList.vue";

const ui = useUi();
</script>

<template>
  <Transition name="drawer">
    <aside v-if="ui.drawer" class="drawer">
      <header>
        <h3>{{ ui.drawer === "queue" ? "Queue" : "Comments" }}</h3>
        <button class="icon-btn" title="Close" @click="ui.drawer = null"><X :size="16" /></button>
      </header>
      <QueueList v-if="ui.drawer === 'queue'" />
      <CommentFeed v-else />
    </aside>
  </Transition>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  width: var(--drawer-width);
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--panel);
}
header { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 10px 20px; }
h3 { margin: 0; font-size: 15px; font-weight: 700; }
.drawer > :last-child { flex: 1; min-height: 0; }
.drawer-enter-active, .drawer-leave-active { transition: margin-right 0.28s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s; }
.drawer-enter-from, .drawer-leave-to { margin-right: calc(var(--drawer-width) * -1); opacity: 0; }
@media (max-width: 1100px) {
  .drawer { position: absolute; inset: 0 0 0 auto; z-index: 5; max-width: 100%; box-shadow: var(--shadow); }
}
</style>
