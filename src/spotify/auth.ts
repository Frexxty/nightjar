// TEMPORARY STUB. The real `useSpotify()` store is built on a parallel branch;
// at merge, take that branch's src/spotify/auth.ts and delete this one.
//
// It has the same names and shapes the welcome page, Settings and the import
// page use (docs/spotify.md), and reads the same localStorage keys, so a
// session saved by the real store shows as connected here. `connect()` can't
// sign in; it reports that sign-in isn't in this build.
import { defineStore } from "pinia";
import { computed, ref } from "vue";

const CLIENT_ID_KEY = "stratus.spotify.clientId";
const TOKENS_KEY = "stratus.spotify.tokens";
const PROFILE_KEY = "stratus.spotify.profile";

export type SpotifyStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SpotifyProfile {
  id: string;
  displayName: string;
  product: string | null;
  country: string | null;
  avatarUrl: string | null;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export const useSpotify = defineStore("spotify", () => {
  const clientId = ref(localStorage.getItem(CLIENT_ID_KEY) ?? "");
  const profile = ref<SpotifyProfile | null>(read<SpotifyProfile>(PROFILE_KEY));
  const status = ref<SpotifyStatus>(read(TOKENS_KEY) ? "connected" : "disconnected");
  const error = ref<string | null>(null);
  const connected = computed(() => status.value === "connected");
  const isPremium = computed(() => profile.value?.product == null || profile.value.product === "premium");
  const redirectUri = computed(() => (window.stratus ? "http://127.0.0.1:43821/callback" : `${location.origin}/spotify-callback`));

  function setClientId(value: string) {
    clientId.value = value.trim();
    try {
      localStorage.setItem(CLIENT_ID_KEY, clientId.value);
    } catch {
      // Kept for this session.
    }
  }

  function init() {
    return Promise.resolve();
  }

  async function connect() {
    status.value = "error";
    error.value = "Spotify sign-in isn't in this build yet.";
  }

  async function disconnect() {
    localStorage.removeItem(TOKENS_KEY);
    localStorage.removeItem(PROFILE_KEY);
    profile.value = null;
    status.value = "disconnected";
    error.value = null;
  }

  return { clientId, status, error, profile, connected, isPremium, redirectUri, setClientId, init, connect, disconnect };
});
