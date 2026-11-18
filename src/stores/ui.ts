import { defineStore } from "pinia";
import { ref } from "vue";
import type { Playlist, PlaylistPatch, Track } from "@/api";

export type Drawer = "queue" | "comments" | null;

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

/** The New playlist / Edit details dialog (PlaylistDialog.vue). */
export type PlaylistDialogState =
  | {
      mode: "create";
      /** Tracks the new playlist starts with. */
      tracks: Track[];
      title?: string;
      description?: string;
      /** Open the playlist once it's made. */
      open?: boolean;
      /** Called with the new playlist, e.g. the picker's "New playlist…". */
      done?: (playlist: Playlist) => void;
    }
  | { mode: "edit"; playlist: Playlist; local: boolean; save: (patch: PlaylistPatch) => void };

export const useUi = defineStore("ui", () => {
  const drawer = ref<Drawer>(null);
  const immersive = ref(false);
  const searchFocus = ref(0);
  const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const toast = ref<string | null>(null);
  const playlistDialog = ref<PlaylistDialogState | null>(null);
  /** "Add to playlist" picker (PlaylistPicker.vue) for these tracks. */
  const picker = ref<{ tracks: Track[] } | null>(null);
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

  function newPlaylist(options: Omit<Extract<PlaylistDialogState, { mode: "create" }>, "mode" | "tracks"> & { tracks?: Track[] } = {}) {
    menu.value = null;
    playlistDialog.value = { mode: "create", ...options, tracks: options.tracks ?? [] };
  }

  function addToPlaylist(tracks: Track[]) {
    menu.value = null;
    const playable = tracks.filter((t) => t && t.id);
    if (!playable.length) return notify("Nothing to add");
    picker.value = { tracks: playable };
  }

  return { drawer, immersive, searchFocus, menu, toast, playlistDialog, picker, toggleDrawer, openMenu, notify, newPlaylist, addToPlaylist };
});

