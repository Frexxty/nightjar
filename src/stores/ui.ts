import { defineStore } from "pinia";
import { ref } from "vue";

export type Drawer = "queue" | "comments" | null;

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

export const useUi = defineStore("ui", () => {
  const drawer = ref<Drawer>(null);
  const immersive = ref(false);
  const searchFocus = ref(0);
  const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const toast = ref<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function toggleDrawer(which: Exclude<Drawer, null>) {
    drawer.value = drawer.value === which ? null : which;
  }

  function openMenu(event: MouseEvent, items: MenuItem[]) {
    event.preventDefault();
    const width = 220;
    const height = items.length * 32 + 12;
    menu.value = {
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8),
      items,
    };
  }

  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = null), 2400);
  }

  return { drawer, immersive, searchFocus, menu, toast, toggleDrawer, openMenu, notify };
});

