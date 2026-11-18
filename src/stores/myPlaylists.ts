import { defineStore } from "pinia";
import { computed, reactive } from "vue";
import { api, friendlyError, type Playlist, type PlaylistPatch, type Track } from "@/api";
import { addMessage, planAdd, type AddPlan } from "@/lib/playlistEdit";
import { useLibrary } from "./library";
import { isLocalId, useLocalPlaylists } from "./localPlaylists";
import { useUi } from "./ui";

export interface NewPlaylist {
  title: string;
  description?: string;
  isPublic?: boolean;
  tracks?: Track[];
}

/**
 * The playlists you can add to: the account's (when signed in to a backend
 * with playlists) and the ones on this device. New playlists go to the account
 * when there is one, otherwise to this device. Spotify tracks are kept as
 * snapshots in the account (docs/hosted-api.md#spotify-tracks); nothing is
 * written to the Spotify library.
 */
export const useMyPlaylists = defineStore("myPlaylists", () => {
  const library = useLibrary();
  const local = useLocalPlaylists();
  const ui = useUi();

  /** New playlists go to the account. False means they're kept on this device. */
  const toAccount = computed(() => !!library.me && typeof api.value.createPlaylist === "function" && typeof api.value.updatePlaylist === "function");
  const localList = computed(() => local.playlists.map(local.asPlaylist));
  /** Account playlists first, then this device's. */
  const all = computed(() => [...(toAccount.value ? library.playlists : []), ...localList.value]);

  // Bumped when a playlist changes from outside its page, so an open PlaylistView reloads.
  const versions = reactive(new Map<string, number>());
  const version = (id: string) => versions.get(id) ?? 0;
  const bump = (id: string) => versions.set(id, version(id) + 1);

  /** Keeps the sidebar's copy of an account playlist in step after a write. */
  function syncSidebar(p: Playlist) {
    const summary: Playlist = { ...p, tracks: undefined };
    const at = library.playlists.findIndex((x) => x.id === p.id);
    if (at < 0) library.playlists = [summary, ...library.playlists];
    else library.playlists = library.playlists.map((x) => (x.id === p.id ? { ...x, ...summary } : x));
  }

  async function create(input: NewPlaylist): Promise<Playlist> {
    const tracks = input.tracks ?? [];
    const title = input.title.trim();
    if (toAccount.value) {
      const p = await api.value.createPlaylist!(title, tracks.map((t) => t.id), !!input.isPublic, {
        description: input.description?.trim() || undefined,
        tracks,
      });
      syncSidebar(p);
      return p;
    }
    return local.asPlaylist(local.create(title, tracks, null, input.description ?? null));
  }

  // One write at a time per playlist, so two quick adds can't overwrite each other.
  const chains = new Map<string, Promise<unknown>>();
  function serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const next = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    chains.set(id, next);
    return next;
  }

  /** Adds tracks the playlist doesn't have yet and says what happened in a toast. */
  function addTracks(playlist: Pick<Playlist, "id" | "title">, tracks: Track[]): Promise<AddPlan | null> {
    return serial(playlist.id, async () => {
      if (isLocalId(playlist.id)) {
        const plan = local.addTracks(playlist.id, tracks);
        if (plan) ui.notify(addMessage(playlist.title, plan));
        return plan;
      }
      // Read the list fresh: another device or page may have changed it.
      const current = await api.value.playlist(playlist.id);
      const plan = planAdd(current.tracks ?? [], tracks);
      if (plan.added.length) {
        const updated = await api.value.updatePlaylist!(playlist.id, { trackIds: plan.next.map((t) => t.id), tracks: plan.next });
        syncSidebar(updated);
        bump(playlist.id);
      }
      ui.notify(addMessage(current.title || playlist.title, plan));
      return plan;
    }).catch((err) => {
      ui.notify(`Couldn't add to "${playlist.title}": ${friendlyError(err)}`);
      return null;
    });
  }

  /** Title, description and public for an account playlist. Track edits stay on PlaylistView. */
  async function updateDetails(id: string, patch: Pick<PlaylistPatch, "title" | "description" | "public">): Promise<Playlist | null> {
    if (isLocalId(id)) {
      local.update(id, { title: patch.title, description: patch.description });
      const p = local.get(id);
      return p ? local.asPlaylist(p) : null;
    }
    const updated = await serial(id, () => api.value.updatePlaylist!(id, patch));
    syncSidebar(updated);
    return updated;
  }

  return { toAccount, all, version, bump, create, addTracks, updateDetails, syncSidebar };
});
