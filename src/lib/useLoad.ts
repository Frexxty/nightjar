import { ref, shallowRef, watch, type Ref } from "vue";
import { api, isUnauthorized, type Backend } from "@/api";
import { useSpotify } from "@/spotify/auth";

/** The error means Spotify isn't connected (or the session ended), so the page should offer to connect. */
export const isSpotifyAuthError = (err: unknown) => (err as Error)?.name === "SpotifyAuthError";

/**
 * Runs `load` now and whenever the backend changes or Spotify connects or
 * disconnects, tracking loading and error state.
 */
export function useLoad<T>(load: (backend: Backend) => Promise<T>) {
  const spotify = useSpotify();
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(true);
  /** The last error was a 401: signed out, or the session ended. */
  const needsAuth = ref(false);
  /** The last error was "Spotify isn't connected". */
  const needsSpotify = ref(false);
  let token = 0;

  async function run() {
    const mine = ++token;
    loading.value = true;
    error.value = null;
    needsAuth.value = false;
    needsSpotify.value = false;
    try {
      const result = await load(api.value);
      if (mine === token) data.value = result;
    } catch (err) {
      if (mine === token) {
        error.value = (err as Error).message;
        needsAuth.value = isUnauthorized(err);
        needsSpotify.value = isSpotifyAuthError(err);
      }
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  watch([api, () => spotify.connected], run, { immediate: true });
  return { data, error, loading, needsAuth, needsSpotify, reload: run };
}

/** Cursor pagination on top of useLoad, for "load more" lists. */
export function usePaged<T>(load: (backend: Backend, cursor: string | null) => Promise<{ items: T[]; next: string | null }>) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const next = ref<string | null>(null);
  const loadingMore = ref(false);

  const first = useLoad(async (backend) => {
    const page = await load(backend, null);
    items.value = page.items;
    next.value = page.next;
    return page;
  });

  async function more() {
    if (!next.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const page = await load(api.value, next.value);
      items.value = [...items.value, ...page.items];
      next.value = page.next;
    } catch (err) {
      first.error.value = (err as Error).message;
    } finally {
      loadingMore.value = false;
    }
  }

  return {
    items, next, more, loadingMore,
    loading: first.loading, error: first.error, needsAuth: first.needsAuth, needsSpotify: first.needsSpotify, reload: first.reload,
  };
}
