<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { isPhone, isTouch } from "@/lib/responsive";
import { useUi, type MenuItem } from "@/stores/ui";

const ui = useUi();
// On phones and touch screens the menu is an action sheet along the bottom.
const asSheet = computed(() => isPhone.value || isTouch.value);

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
    <div v-if="ui.menu && !asSheet" class="scrim" @mousedown="close" @contextmenu.prevent="close">
      <div class="menu" :style="{ left: `${ui.menu.x}px`, top: `${ui.menu.y}px` }" @mousedown.stop>
        <button v-for="item in ui.menu.items" :key="item.label" :class="{ danger: item.danger }" @click="run(item)">
          {{ item.label }}
        </button>
      </div>
    </div>
    <Transition name="action-sheet">
      <div v-if="ui.menu && asSheet" class="sheet-scrim" @click.self="close" @contextmenu.prevent>
        <div class="action-sheet" role="menu">
          <div class="group">
            <button v-for="item in ui.menu.items" :key="item.label" role="menuitem" :class="{ danger: item.danger }" @click="run(item)">
              {{ item.label }}
            </button>
          </div>
          <button class="cancel" @click="close">Cancel</button>
        </div>
      </div>
    </Transition>
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

.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.4);
}
.action-sheet { display: flex; flex-direction: column; gap: 8px; width: min(100%, 440px); margin: 0 auto; }
.group, .cancel {
  border-radius: 14px;
  background: var(--overlay);
  backdrop-filter: blur(30px) saturate(1.6);
}
.group { max-height: calc(100dvh - 140px); overflow-y: auto; overscroll-behavior: contain; }
.action-sheet button {
  height: 54px;
  padding: 0 16px;
  border-radius: 0;
  text-align: center;
  font-size: 17px;
  font-weight: 500;
}
.group button + button { box-shadow: inset 0 1px 0 var(--border); }
/* Undo the desktop menu's hover fill, which would stick after a tap. */
.group button:hover { background: none; color: inherit; }
.action-sheet .cancel, .action-sheet .cancel:hover { background: var(--overlay); color: var(--text); font-weight: 650; border-radius: 14px; }
.action-sheet button:active, .action-sheet .cancel:active { background: var(--active); }
.action-sheet button.danger, .action-sheet button.danger:hover { color: #ff5a5a; background: none; }
.action-sheet-enter-active, .action-sheet-leave-active { transition: opacity 0.25s; }
.action-sheet-enter-active .action-sheet, .action-sheet-leave-active .action-sheet { transition: transform 0.38s cubic-bezier(0.32, 0.72, 0, 1); }
.action-sheet-enter-from, .action-sheet-leave-to { opacity: 0; }
.action-sheet-enter-from .action-sheet, .action-sheet-leave-to .action-sheet { transform: translateY(110%); }
</style>
