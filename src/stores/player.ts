import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import type { Comment, Track } from "@/api";
import {
  HtmlAudioEngine, PlaybackError, SpotifyConnectEngine, SpotifySdkEngine,
  type EngineEvents, type EngineKind, type PlaybackEngine,
} from "@/player/engines";
import { catalogueFor } from "@/spotify/catalogue";
import { useLibrary } from "./library";
import { useSettings } from "./settings";
import { useUi } from "./ui";

export type Repeat = "off" | "all" | "one";
export type PlayState = "stopped" | "loading" | "playing" | "paused";

const VOLUME_KEY = "stratus.volume";

export const usePlayer = defineStore("player", () => {
  const library = useLibrary();
  const settings = useSettings();
  const ui = useUi();

  let loadToken = 0;

  const queue = ref<Track[]>([]);
  const index = ref(-1);
  const unshuffled = ref<Track[] | null>(null);
  const repeat = ref<Repeat>("off");
  const state = ref<PlayState>("stopped");
  const currentTime = ref(0);
  const duration = ref(0);
  const volume = ref(Number(localStorage.getItem(VOLUME_KEY) ?? 0.8));
  const muted = ref(false);
  const comments = shallowRef<Comment[]>([]);
  const queueSource = ref<string | null>(null);

  const current = computed(() => queue.value[index.value] ?? null);
  const shuffle = computed(() => unshuffled.value !== null);
  const upNext = computed(() => queue.value.slice(index.value + 1));
  const previous = computed(() => queue.value.slice(0, Math.max(0, index.value)));
  const progress = computed(() => (duration.value ? currentTime.value / duration.value : 0));
  const playing = computed(() => state.value === "playing");

  // Engines. Events from any engine but the active one are ignored, so a
  // late "pause" from the <audio> element can't touch a Spotify track's state.
  const engines = new Map<EngineKind, PlaybackEngine>();
  const engineKind = ref<EngineKind>("html");
  let active: PlaybackEngine;

  function eventsFor(kind: EngineKind): EngineEvents {
    const live = () => active?.kind === kind;
    return {
      time: (s) => live() && (currentTime.value = s),
      duration: (s) => live() && (duration.value = s),
      state: (s) => live() && (state.value = s),
      ended: () => live() && onEnded(),
      error: (message, skip) => {
        if (!live()) return;
        ui.notify(message);
        if (skip) void next();
        else if (state.value === "loading") state.value = "paused";
      },
      detached: () => {
        if (!live()) return;
        state.value = "paused";
        ui.notify("Spotify is playing something else now");
      },
    };
  }

  function engine(kind: EngineKind): PlaybackEngine {
    let e = engines.get(kind);
    if (!e) {
      const events = eventsFor(kind);
      e = kind === "html" ? new HtmlAudioEngine(events)
        : kind === "spotify-sdk" ? new SpotifySdkEngine(events)
        : new SpotifyConnectEngine(events, () => settings.spotifyDeviceId);
      e.setVolume(volume.value);
      e.setMuted(muted.value);
      engines.set(kind, e);
    }
    return e;
  }
  active = engine("html");

  const kindFor = (track: Track): EngineKind =>
    track.source !== "spotify" ? "html" : settings.spotifyPlayback === "remote" ? "spotify-connect" : "spotify-sdk";

  function use(kind: EngineKind) {
    const next = engine(kind);
    if (next !== active) {
      const previous = active;
      active = next;
      engineKind.value = kind;
      previous.unload();
    }
    return next;
  }

  watch(volume, (v) => {
    for (const e of engines.values()) e.setVolume(v);
    localStorage.setItem(VOLUME_KEY, String(v));
  });
  watch(muted, (m) => {
    for (const e of engines.values()) e.setMuted(m);
  });

  async function load(track: Track, autoplay = true, startAt: number | null = null) {
    const token = ++loadToken;
    const e = use(kindFor(track));
    state.value = "loading";
    currentTime.value = 0;
    duration.value = track.duration / 1000;
    comments.value = [];

    catalogueFor(track.id).trackComments(track.id).then((list) => {
      if (token === loadToken) comments.value = list;
    }).catch(() => {});

    try {
      await e.load(track, { autoplay, startAt });
      if (token !== loadToken) return;
      library.addToHistory(track);
    } catch (err) {
      if (token !== loadToken) return;
      if ((err as Error).name === "AbortError") return;
      // Not connected, not Premium, no device: every next Spotify track would fail the same way.
      if (err instanceof PlaybackError && err.stopQueue) {
        ui.notify((err as Error).message);
        state.value = "paused";
        return;
      }
      ui.notify(`Skipped "${track.title}": ${(err as Error).message}`);
      if (index.value < queue.value.length - 1) await next();
      else state.value = "stopped";
    }
  }

  /**
   * Replace the queue and start playing at `start`, optionally from a fraction of the track.
   * With `autoplay` false the track is loaded and left paused.
   */
  function playTracks(tracks: Track[], start = 0, source: string | null = null, startAt: number | null = null, autoplay = true) {
    if (!tracks.length) return;
    unshuffled.value = null;
    queue.value = [...tracks];
    index.value = start;
    queueSource.value = source;
    void load(queue.value[start], autoplay, startAt);
  }

  function playTrack(track: Track) {
    playTracks([track], 0);
  }

  function isCurrent(track: Track) {
    return current.value?.id === track.id;
  }

  function toggle() {
    if (!current.value) return;
    if (active.paused) void active.play().catch(() => {});
    else active.pause();
  }

  /** Play the given list, or toggle pause if it's already the current queue. */
  function playOrToggle(tracks: Track[], start = 0, source: string | null = null) {
    if (source && queueSource.value === source && current.value) toggle();
    else playTracks(tracks, start, source);
  }

  async function next() {
    if (index.value < queue.value.length - 1) {
      index.value++;
      await load(queue.value[index.value]);
    } else if (repeat.value === "all" && queue.value.length) {
      index.value = 0;
      await load(queue.value[0]);
    } else if (settings.autoplayRelated && current.value) {
      const seed = current.value;
      const related = await catalogueFor(seed.id).relatedTracks(seed.id).catch(() => [] as Track[]);
      const fresh = related.filter((t) => !queue.value.some((q) => q.id === t.id));
      if (fresh.length) {
        queue.value.push(...fresh);
        index.value++;
        await load(queue.value[index.value]);
      } else stop();
    } else stop();
  }

  async function prev() {
    if (currentTime.value > 3 || index.value <= 0) {
      seek(0);
      return;
    }
    index.value--;
    await load(queue.value[index.value]);
  }

  function onEnded() {
    if (repeat.value === "one") {
      seek(0);
      void active.play();
    } else void next();
  }

  function stop() {
    active.pause();
    state.value = queue.value.length ? "paused" : "stopped";
    seek(0);
  }

  function seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(seconds, duration.value || seconds));
    active.seek(target);
    currentTime.value = target;
    syncPosition();
  }

  function seekFraction(f: number) {
    seek(f * duration.value);
  }

  function jumpTo(i: number) {
    if (i < 0 || i >= queue.value.length) return;
    index.value = i;
    void load(queue.value[i]);
  }

  function playNext(tracks: Track[]) {
    if (!current.value) return playTracks(tracks);
    queue.value.splice(index.value + 1, 0, ...tracks);
    ui.notify(tracks.length === 1 ? `"${tracks[0].title}" plays next` : `${tracks.length} tracks play next`);
  }

  function addToQueue(tracks: Track[]) {
    if (!current.value) return playTracks(tracks);
    queue.value.push(...tracks);
    ui.notify(tracks.length === 1 ? `Added "${tracks[0].title}" to the queue` : `Added ${tracks.length} tracks to the queue`);
  }

  function removeAt(i: number) {
    if (i === index.value) return;
    queue.value.splice(i, 1);
    if (i < index.value) index.value--;
  }

  function moveInQueue(from: number, to: number) {
    if (from === to) return;
    const [item] = queue.value.splice(from, 1);
    queue.value.splice(to, 0, item);
    if (from === index.value) index.value = to;
    else if (from < index.value && to >= index.value) index.value--;
    else if (from > index.value && to <= index.value) index.value++;
  }

  function clearUpNext() {
    queue.value.splice(index.value + 1);
  }

  function toggleShuffle() {
    const now = current.value;
    if (unshuffled.value) {
      queue.value = unshuffled.value;
      unshuffled.value = null;
      index.value = now ? queue.value.findIndex((t) => t.id === now.id) : -1;
      return;
    }
    unshuffled.value = [...queue.value];
    const rest = queue.value.filter((_, i) => i !== index.value);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queue.value = now ? [now, ...rest] : rest;
    index.value = now ? 0 : -1;
  }

  function cycleRepeat() {
    repeat.value = repeat.value === "off" ? "all" : repeat.value === "all" ? "one" : "off";
  }

  // Changing Settings > Spotify playback moves a playing Spotify track to the new engine.
  watch(() => settings.spotifyPlayback, () => {
    const t = current.value;
    if (!t || t.source !== "spotify" || kindFor(t) === active.kind) return;
    const at = duration.value ? currentTime.value / duration.value : null;
    void load(t, state.value === "playing", at);
  });

  // OS integration: Now Playing / media keys, plus the Electron menus.
  // The lock screen's scrubber and elapsed time come from the position state.
  function syncPosition() {
    if (!("mediaSession" in navigator)) return;
    const d = duration.value;
    if (!d || !Number.isFinite(d)) return;
    try {
      navigator.mediaSession.setPositionState?.({ duration: d, playbackRate: 1, position: Math.min(currentTime.value, d) });
    } catch {
      // Some browsers reject a position past the duration while it settles.
    }
  }

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => void active.play().catch(() => {}));
    ms.setActionHandler("pause", () => active.pause());
    ms.setActionHandler("nexttrack", () => void next());
    ms.setActionHandler("previoustrack", () => void prev());
    ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    watch(current, (t) => {
      ms.metadata = t
        ? new MediaMetadata({
            title: t.title,
            artist: t.user.username,
            album: t.album?.title ?? "Stratus",
            // Lock screens need an absolute URL. iOS skips data: URLs (the mock's artwork).
            artwork: t.artworkUrl ? [{ src: new URL(t.artworkUrl, location.href).href, sizes: "500x500" }] : [],
          })
        : null;
    });
    watch(duration, syncPosition);
    watch(state, (s) => {
      if (s === "playing") ms.playbackState = "playing";
      else if (s === "paused") ms.playbackState = "paused";
      if (s === "playing" || s === "paused") syncPosition();
    });
  }

  watch(
    () => [state.value, current.value?.id, current.value && library.isLiked(current.value)] as const,
    () => {
      const t = current.value;
      window.stratus?.reportPlayback({
        state: state.value === "loading" ? "playing" : state.value,
        track: t ? { id: t.id, title: t.title, artist: t.user.username } : null,
        liked: t ? library.isLiked(t) : false,
      });
    },
  );

  return {
    queue, index, repeat, state, currentTime, duration, volume, muted, comments,
    current, shuffle, upNext, previous, progress, playing, queueSource, engineKind,
    playTracks, playTrack, playOrToggle, isCurrent, toggle, next, prev, seek, seekFraction, jumpTo,
    playNext, addToQueue, removeAt, moveInQueue, clearUpNext, toggleShuffle, cycleRepeat, stop,
  };
});
