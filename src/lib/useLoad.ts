import { ref, shallowRef, watch, type Ref } from "vue";
import { api, isUnauthorized, type Backend } from "@/api";

/** Runs `load` now and whenever the backend changes, tracking loading and error state. */
export function useLoad<T>(load: (backend: Backend) => Promise<T>) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(true);
  /** The last error was a 401: signed out, or the session ended. */
  const needsAuth = ref(false);
  let token = 0;

  async function run() {
    const mine = ++token;
    loading.value = true;
    error.value = null;
    needsAuth.value = false;
    try {
      const result = await load(api.value);
      if (mine === token) data.value = result;
    } catch (err) {
      if (mine === token) {
        error.value = (err as Error).message;
        needsAuth.value = isUnauthorized(err);
      }
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  watch(api, run, { immediate: true });
  return { data, error, loading, needsAuth, reload: run };
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

  return { items, next, more, loadingMore, loading: first.loading, error: first.error, needsAuth: first.needsAuth, reload: first.reload };
}
