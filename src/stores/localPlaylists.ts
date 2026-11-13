import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { Playlist, Track } from "@/api";
import { useUi } from "./ui";

const KEY = "stratus.localPlaylists";
export const LOCAL_PREFIX = "local:";

export interface LocalPlaylist {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Full tracks so the playlist renders without asking the backend. */
  tracks: Track[];
  /** Where it was imported from, if anywhere. */
  sourceUrl?: string | null;
}

export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX);

// Waveforms can be thousands of samples. 500 tracks of those would blow the
// ~5 MB localStorage quota, so keep a coarse copy (the UI resamples anyway).
function slim(t: Track): Track {
  const { description: _d, tags: _t, ...rest } = t;
  const wave = t.waveform;
  if (!wave || wave.length <= 200) return rest;
  const step = wave.length / 200;
  const waveform = Array.from({ length: 200 }, (_, i) => Math.round(wave[Math.floor(i * step)] * 100) / 100);
  return { ...rest, waveform };
}

/** Playlists kept on this computer, such as Spotify imports. */
export const useLocalPlaylists = defineStore("localPlaylists", () => {
  const ui = useUi();
  const playlists = ref<LocalPlaylist[]>(load());

  function load(): LocalPlaylist[] {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  watch(
    playlists,
    (value) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        ui.notify("Couldn't save playlists to disk. Changes last until you quit.");
      }
    },
    { deep: true },
  );

  const get = (id: string) => playlists.value.find((p) => p.id === id) ?? null;

  function touch(p: LocalPlaylist) {
    p.updatedAt = new Date().toISOString();
  }

  function create(title: string, tracks: Track[], sourceUrl: string | null = null): LocalPlaylist {
    const now = new Date().toISOString();
    const playlist: LocalPlaylist = {
      id: `${LOCAL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim() || "Untitled playlist",
      createdAt: now,
      updatedAt: now,
      tracks: tracks.map(slim),
      sourceUrl,
    };
    playlists.value.unshift(playlist);
    return playlist;
  }

  function rename(id: string, title: string) {
    const p = get(id);
    if (!p || !title.trim()) return;
    p.title = title.trim();
    touch(p);
  }

  function remove(id: string) {
    playlists.value = playlists.value.filter((p) => p.id !== id);
  }

  function removeTrack(id: string, index: number) {
    const p = get(id);
    if (!p || index < 0 || index >= p.tracks.length) return;
    p.tracks.splice(index, 1);
    touch(p);
  }

  function moveTrack(id: string, from: number, to: number) {
    const p = get(id);
    if (!p || from === to || to < 0 || to >= p.tracks.length) return;
    const [t] = p.tracks.splice(from, 1);
    p.tracks.splice(to, 0, t);
    touch(p);
  }

  /** The same shape as a backend playlist, for the sidebar and PlaylistView. */
  function asPlaylist(p: LocalPlaylist): Playlist {
    return {
      id: p.id,
      title: p.title,
      user: { id: "local", username: "On this computer", avatarUrl: null },
      artworkUrl: p.tracks.find((t) => t.artworkUrl)?.artworkUrl ?? null,
      description: null,
      isAlbum: false,
      trackCount: p.tracks.length,
      duration: p.tracks.reduce((sum, t) => sum + t.duration, 0),
      createdAt: p.createdAt,
      likesCount: 0,
      tracks: p.tracks,
      permalinkUrl: null,
    };
  }

  return { playlists, get, create, rename, remove, removeTrack, moveTrack, asPlaylist };
});
