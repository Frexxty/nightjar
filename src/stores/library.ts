import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { api, isUnauthorized, onSessionExpired, type Playlist, type Track, type User } from "@/api";
import { router } from "@/router";
import { useUi } from "./ui";

const HISTORY_KEY = "stratus.history";

/** Likes, reposts, follows and listening history, with optimistic updates. */
export const useLibrary = defineStore("library", () => {
  const ui = useUi();
  const liked = reactive(new Map<string, boolean>());
  const reposted = reactive(new Map<string, boolean>());
  const followed = reactive(new Map<string, boolean>());
  const me = ref<User | null>(null);
  /** False until the first `/me` answer, so nothing treats "still loading" as signed out. */
  const ready = ref(false);
  const playlists = ref<Playlist[]>([]);
  /** Plays on this computer. What History shows when signed out. */
  const history = ref<Track[]>(loadHistory());

  /** The backend has accounts you can sign in to. */
  const accounts = computed(() => typeof api.value.login === "function");
  const signedOut = computed(() => ready.value && !me.value);

  function loadHistory(): Track[] {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    } catch {
      return [];
    }
  }

  let latest: Promise<void> = Promise.resolve();
  /** Reloads the account. Resolves once the newest refresh has finished, so callers see current state. */
  function refresh() {
    const run = load();
    latest = run;
    return run;
  }
  async function load(): Promise<void> {
    liked.clear();
    reposted.clear();
    followed.clear();
    const backend = api.value;
    const user = await backend.me().catch(() => null);
    const owned = user ? await backend.myPlaylists().catch(() => [] as Playlist[]) : [];
    // A sign-in or backend switch can start a newer refresh while this one
    // waits; that one's answer wins.
    if (backend !== api.value) return latest;
    me.value = user;
    playlists.value = owned;
    ready.value = true;
  }

  onSessionExpired(() => ui.notify("Signed out, please sign in again"));

  /** Opens the sign-in page, coming back to `next` (default: the current page) afterwards. */
  function signIn(next = router.currentRoute.value.fullPath) {
    void router.push({ path: "/account", query: next && next !== "/account" ? { next } : {} });
  }

  /**
   * True if the action can go ahead. When signed out of a backend with
   * accounts, opens the sign-in page instead and returns false.
   */
  function requireAccount() {
    if (!signedOut.value || !accounts.value) return true;
    signIn();
    return false;
  }

  const isLiked = (t: Track) => liked.get(t.id) ?? t.liked ?? false;
  const isReposted = (t: Track) => reposted.get(t.id) ?? t.reposted ?? false;
  const isFollowing = (u: User) => followed.get(u.id) ?? u.following ?? false;

  async function optimistic(map: Map<string, boolean>, id: string, value: boolean, call: () => Promise<void>, label: string) {
    if (!requireAccount()) return;
    map.set(id, value);
    try {
      await call();
    } catch (err) {
      map.set(id, !value);
      if (isUnauthorized(err) && accounts.value) signIn();
      else ui.notify(`Couldn't ${label}: ${(err as Error).message}`);
    }
  }

  function toggleLike(t: Track) {
    const next = !isLiked(t);
    return optimistic(liked, t.id, next, () => api.value.setTrackLiked(t.id, next), next ? "like" : "unlike");
  }
  function toggleRepost(t: Track) {
    const next = !isReposted(t);
    if (next && !signedOut.value) ui.notify(`Reposted "${t.title}"`);
    return optimistic(reposted, t.id, next, () => api.value.setReposted(t.id, next), "repost");
  }
  function toggleFollow(u: User) {
    const next = !isFollowing(u);
    return optimistic(followed, u.id, next, () => api.value.setFollowing(u.id, next), next ? "follow" : "unfollow");
  }

  function addToHistory(t: Track) {
    history.value = [t, ...history.value.filter((x) => x.id !== t.id)].slice(0, 200);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
    } catch {
      // History still works in memory.
    }
    // The account copy is best effort; a missed play isn't worth a toast.
    if (me.value && api.value.addHistory) api.value.addHistory(t.id).catch(() => {});
  }

  function clearHistory() {
    history.value = [];
    localStorage.removeItem(HISTORY_KEY);
  }

  return {
    me, ready, accounts, signedOut, playlists, history,
    refresh, signIn, requireAccount, isLiked, isReposted, isFollowing, toggleLike, toggleRepost, toggleFollow, addToHistory, clearHistory,
  };
});
