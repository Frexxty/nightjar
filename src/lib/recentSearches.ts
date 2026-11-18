// The last searches on this device, shown on the empty Search page.
import { ref } from "vue";

// Keeps the pre-rename prefix like every other key.
const KEY = "stratus.recentSearches";
const MAX = 10;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export const recentSearches = ref<string[]>(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentSearches.value));
  } catch {
    // Lasts for this session.
  }
}

/** Moves `query` to the front, ignoring case when matching an older entry. */
export function rememberSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  recentSearches.value = [q, ...recentSearches.value.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  save();
}

export function forgetSearch(query: string) {
  recentSearches.value = recentSearches.value.filter((x) => x !== query);
  save();
}

export function clearSearches() {
  recentSearches.value = [];
  save();
}
