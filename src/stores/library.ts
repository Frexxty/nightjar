import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { api, type Playlist, type Track, type User } from "@/api";
import { useUi } from "./ui";

const HISTORY_KEY = "stratus.history";

/** Likes, reposts, follows and listening history, with optimistic updates. */
export const useLibrary = defineStore("library", () => {
  const ui = useUi();
  const liked = reactive(new Map<string, boolean>());
  const reposted = reactive(new Map<string, boolean>());
  const followed = reactive(new Map<string, boolean>());
  const me = ref<User | null>(null);
  const playlists = ref<Playlist[]>([]);
  const history = ref<Track[]>(loadHistory());

  function loadHistory(): Track[] {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    } catch {
      return [];
    }
  }

  async function refresh() {
    liked.clear();
    reposted.clear();
    followed.clear();
    const [user, mine] = await Promise.allSettled([api.value.me(), api.value.myPlaylists()]);
    me.value = user.status === "fulfilled" ? user.value : null;
    playlists.value = mine.status === "fulfilled" ? mine.value : [];
  }

  const isLiked = (t: Track) => liked.get(t.id) ?? t.liked ?? false;
  const isReposted = (t: Track) => reposted.get(t.id) ?? t.reposted ?? false;
  const isFollowing = (u: User) => followed.get(u.id) ?? u.following ?? false;

  async function optimistic(map: Map<string, boolean>, id: string, value: boolean, call: () => Promise<void>, label: string) {
    map.set(id, value);
    try {
      await call();
    } catch (err) {
      map.set(id, !value);
      ui.notify(`Couldn't ${label}: ${(err as Error).message}`);
    }
  }

  function toggleLike(t: Track) {
    const next = !isLiked(t);
    return optimistic(liked, t.id, next, () => api.value.setTrackLiked(t.id, next), next ? "like" : "unlike");
  }
  function toggleRepost(t: Track) {
    const next = !isReposted(t);
    if (next) ui.notify(`Reposted "${t.title}"`);
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
  }

  function clearHistory() {
    history.value = [];
    localStorage.removeItem(HISTORY_KEY);
  }

  return { me, playlists, history, refresh, isLiked, isReposted, isFollowing, toggleLike, toggleRepost, toggleFollow, addToHistory, clearHistory };
});
