<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useUi, type MenuItem } from "@/stores/ui";

const ui = useUi();

function run(item: MenuItem) {
  ui.menu = null;
  item.action();
}

function close() {
  ui.menu = null;
}
const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", close);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("blur", close);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.menu" class="scrim" @mousedown="close" @contextmenu.prevent="close">
      <div class="menu" :style="{ left: `${ui.menu.x}px`, top: `${ui.menu.y}px` }" @mousedown.stop>
        <button v-for="item in ui.menu.items" :key="item.label" :class="{ danger: item.danger }" @click="run(item)">
          {{ item.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 100; }
.menu {
  position: fixed;
  min-width: 200px;
  padding: 5px;
  border-radius: 10px;
  background: var(--overlay);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
  animation: pop 0.12s ease-out;
  transform-origin: top left;
}
button {
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  text-align: left;
  font-weight: 500;
}
button:hover { background: var(--accent); color: var(--accent-text); }
button.danger { color: #ff5a5a; }
button.danger:hover { background: #ff5a5a; color: #fff; }
@keyframes pop { from { opacity: 0; transform: scale(0.96); } }
</style>
