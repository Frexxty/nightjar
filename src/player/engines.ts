// What actually makes sound. The player store owns the queue and picks one of
// these per track (docs/spotify.md):
// - HtmlAudioEngine: an <audio> element, with hls.js where the browser has no native HLS (SoundCloud).
// - SpotifySdkEngine: a Web Playback SDK device inside Nightjar (Spotify Premium, needs Widevine).
// - SpotifyConnectEngine: remote-controls another Spotify device, such as the phone's Spotify app.
import type Hls from "hls.js";
import { api, type Track } from "@/api";
import { useSpotify } from "@/spotify/auth";
import { spGet, spotifyRequest, SpotifyApiError } from "@/spotify/api";
import { checkEnd, newTracker, type EndTracker, type PlaybackSnapshot } from "./spotifyEnd";

export type EngineKind = "html" | "spotify-sdk" | "spotify-connect";
export type EngineState = "loading" | "playing" | "paused";

export interface EngineEvents {
  /** Seconds. Not sent while the window is hidden, like `timeupdate` before. */
  time(seconds: number): void;
  /** Seconds. */
  duration(seconds: number): void;
  state(state: EngineState): void;
  ended(): void;
  /** A playback failure after `load` resolved. `skip`: try the next track. */
  error(message: string, skip: boolean): void;
  /** The device moved to something Nightjar didn't start (Connect, or the SDK device taken over). */
  detached?(): void;
}

export interface LoadOptions {
  autoplay: boolean;
  /** Fraction of the track (0..1) to start from, or null for the start. */
  startAt: number | null;
}

export interface PlaybackEngine {
  readonly kind: EngineKind;
  readonly paused: boolean;
  /** Starts `track`. Rejects when it can't; a rejection with `stopQueue` set means skipping ahead won't help. */
  load(track: Track, options: LoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Stops and lets go of the current track, for when another engine takes over. */
  unload(): void;
  destroy(): void;
}

/** An error that would hit every following track too (not signed in, not Premium, no device), so the queue stops instead of skipping. */
export class PlaybackError extends Error {
  stopQueue: boolean;
  constructor(message: string, stopQueue = false) {
    super(message);
    this.name = "PlaybackError";
    this.stopQueue = stopQueue;
  }
}

// ---------------------------------------------------------------------------
// <audio> + hls.js

export class HtmlAudioEngine implements PlaybackEngine {
  readonly kind = "html";
  readonly audio = new Audio();
  private hls: Hls | null = null;
  private token = 0;
  private pendingSeek: number | null = null;
  /** The last state reported, so a pause while buffering stays "loading" as before. */
  private lastState: EngineState = "paused";
  private current: Track | null = null;

  constructor(private events: EngineEvents) {
    const audio = this.audio;
    audio.preload = "auto";
    // Only the UI reads the time, so while the window is hidden skip the
    // updates (and the re-renders they trigger) and catch up when it's shown.
    const syncTime = () => {
      if (!document.hidden) events.time(audio.currentTime);
    };
    audio.addEventListener("timeupdate", syncTime);
    document.addEventListener("visibilitychange", syncTime);
    audio.addEventListener("durationchange", () => {
      if (Number.isFinite(audio.duration)) events.duration(audio.duration);
    });
    audio.addEventListener("loadedmetadata", () => {
      if (this.pendingSeek != null && Number.isFinite(audio.duration)) this.seek(this.pendingSeek * audio.duration);
      this.pendingSeek = null;
    });
    audio.addEventListener("playing", () => this.emit("playing"));
    audio.addEventListener("pause", () => {
      if (this.lastState !== "loading" && !audio.ended) this.emit("paused");
    });
    audio.addEventListener("waiting", () => this.emit("loading"));
    audio.addEventListener("ended", () => events.ended());
    audio.addEventListener("error", () => {
      if (!audio.src) return;
      events.error(`Couldn't play "${this.current?.title ?? "track"}"`, true);
    });
  }

  private emit(state: EngineState) {
    this.lastState = state;
    this.events.state(state);
  }

  get paused() {
    return this.audio.paused;
  }

  async load(track: Track, { autoplay, startAt }: LoadOptions) {
    const token = ++this.token;
    this.current = track;
    this.pendingSeek = startAt;
    this.lastState = "loading";
    this.hls?.destroy();
    this.hls = null;

    if (!track.streamable) throw new Error("not streamable");
    const stream = await api.value.stream(track);
    if (token !== this.token) return;

    if (stream.protocol === "hls" && !this.audio.canPlayType("application/vnd.apple.mpegurl")) {
      const { default: HlsCtor } = await import("hls.js");
      if (token !== this.token) return;
      this.hls = new HlsCtor();
      this.hls.loadSource(stream.url);
      this.hls.attachMedia(this.audio);
    } else {
      this.audio.src = stream.url;
    }
    if (autoplay) await this.audio.play();
    else this.emit("paused");
  }

  play() {
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds: number) {
    this.audio.currentTime = seconds;
  }

  setVolume(volume: number) {
    this.audio.volume = volume;
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted;
  }

  unload() {
    this.token++;
    this.lastState = "paused";
    this.hls?.destroy();
    this.hls = null;
    this.audio.pause();
    // With no src the error listener ignores the abort this causes.
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  destroy() {
    this.unload();
  }
}

// ---------------------------------------------------------------------------
// Spotify, shared

/** Spotify's own error reasons in plain words; marks the ones that would fail for every track. */
function toPlaybackError(err: unknown): PlaybackError {
  if (err instanceof PlaybackError) return err;
  const spotify = useSpotify();
  if ((err as Error)?.name === "SpotifyAuthError") return new PlaybackError((err as Error).message, true);
  if (err instanceof SpotifyApiError) {
    if (err.reason === "PREMIUM_REQUIRED") {
      spotify.markNotPremium("Playing Spotify in Nightjar needs Spotify Premium.");
      return new PlaybackError(err.message, true);
    }
    if (err.reason === "NO_ACTIVE_DEVICE" || err.status === 404) return new PlaybackError(err.message, true);
    if (err.status === 401 || err.status === 403) return new PlaybackError(err.message, true);
    return new PlaybackError(err.message, false);
  }
  return new PlaybackError((err as Error)?.message ?? String(err), false);
}

const startMs = (track: Track, startAt: number | null) => Math.max(0, Math.round((startAt ?? 0) * track.duration));

function requireSpotifyTrack(track: Track): string {
  if (!track.uri || !track.streamable) throw new PlaybackError("not streamable");
  return track.uri;
}

// ---------------------------------------------------------------------------
// Web Playback SDK

interface SdkTrack { uri: string; linked_from?: { uri: string | null } | null; duration_ms: number }
interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: SdkTrack | null; previous_tracks: SdkTrack[] };
}
interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: never) => void): boolean;
  getCurrentState(): Promise<SdkState | null>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  activateElement(): Promise<void>;
}
interface SdkNamespace {
  Player: new (options: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume?: number }) => SdkPlayer;
}
declare global {
  interface Window {
    Spotify?: SdkNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
let sdkPromise: Promise<SdkNamespace> | null = null;

/** Loads Spotify's SDK script once. */
export function loadSpotifySdk(timeoutMs = 20_000): Promise<SdkNamespace> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  sdkPromise ??= new Promise<SdkNamespace>((resolve, reject) => {
    const timer = setTimeout(() => fail("Spotify's player didn't load. Check your connection and try again."), timeoutMs);
    function fail(message: string) {
      clearTimeout(timer);
      sdkPromise = null;
      script.remove();
      reject(new PlaybackError(message, true));
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      if (window.Spotify) resolve(window.Spotify);
      else fail("Spotify's player loaded without its API.");
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => fail("Couldn't load Spotify's player script.");
    document.head.append(script);
  });
  return sdkPromise;
}

/** Spotify's audio is Widevine-protected. Stock Electron and some browsers can't decrypt it. */
export async function hasWidevine(): Promise<boolean> {
  if (!navigator.requestMediaKeySystemAccess) return false;
  try {
    await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{
      initDataTypes: ["cenc"],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    }]);
    return true;
  } catch {
    return false;
  }
}

export class SpotifySdkEngine implements PlaybackEngine {
  readonly kind = "spotify-sdk";
  private player: SdkPlayer | null = null;
  private deviceId: string | null = null;
  private deviceWaiters: ((id: string) => void)[] = [];
  private setup: Promise<SdkPlayer> | null = null;
  private tracker: EndTracker | null = null;
  private endedSent = false;
  private poll: ReturnType<typeof setInterval> | undefined;
  private isPaused = true;
  private volume = 0.8;
  private muted = false;
  /** Loaded with autoplay off: started on the first play(). */
  private armed: { uri: string; positionMs: number } | null = null;
  private token = 0;

  constructor(private events: EngineEvents) {
    document.addEventListener("visibilitychange", () => this.syncPolling());
  }

  get paused() {
    return this.isPaused;
  }

  private ensurePlayer(): Promise<SdkPlayer> {
    this.setup ??= (async () => {
      const spotify = useSpotify();
      await spotify.accessToken();
      if (!(await hasWidevine())) {
        throw new PlaybackError(
          "This app can't decrypt Spotify's audio (no Widevine). Switch Settings > Spotify playback to \"Control the Spotify app\".",
          true,
        );
      }
      const sdk = await loadSpotifySdk();
      const player = new sdk.Player({
        name: window.nightjar ? "Nightjar (desktop)" : "Nightjar (web)",
        getOAuthToken: (cb) => void spotify.accessToken().then(cb, () => {}),
        volume: this.muted ? 0 : this.volume,
      });
      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        this.deviceId = device_id;
        for (const w of this.deviceWaiters.splice(0)) w(device_id);
      });
      player.addListener("not_ready", () => (this.deviceId = null));
      player.addListener("player_state_changed", (state: SdkState | null) => this.onState(state));
      player.addListener("initialization_error", ({ message }: { message: string }) => {
        this.events.error(`Spotify's player couldn't start here: ${message}`, false);
      });
      player.addListener("authentication_error", () => {
        this.events.error("Spotify rejected the sign-in. Reconnect Spotify in Settings.", false);
      });
      player.addListener("account_error", () => {
        spotify.markNotPremium();
        this.events.error(spotify.premiumMessage ?? "This Spotify account can't play music in Nightjar.", false);
      });
      player.addListener("playback_error", ({ message }: { message: string }) => {
        this.events.error(`Spotify couldn't play this track${message ? `: ${message}` : ""}`, true);
      });
      if (!(await player.connect())) throw new PlaybackError("Spotify's player couldn't connect.", true);
      this.player = player;
      return player;
    })().catch((err) => {
      this.setup = null;
      throw err;
    });
    return this.setup;
  }

  private waitForDevice(timeoutMs = 15_000): Promise<string> {
    if (this.deviceId) return Promise.resolve(this.deviceId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new PlaybackError("Spotify's player didn't come online. Try again.", true)), timeoutMs);
      this.deviceWaiters.push((id) => {
        clearTimeout(timer);
        resolve(id);
      });
    });
  }

  private async start(uri: string, positionMs: number) {
    const token = this.token;
    const device = await this.waitForDevice();
    if (token !== this.token) return;
    const send = () => spotifyRequest<void>("PUT", "/me/player/play", { query: { device_id: device }, body: { uris: [uri], position_ms: positionMs } });
    try {
      await send();
    } catch (err) {
      // A brand-new device can take a moment before the Web API knows it.
      if (!(err instanceof SpotifyApiError) || err.status !== 404) throw err;
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== this.token) return;
      await send();
    }
  }

  async load(track: Track, { autoplay, startAt }: LoadOptions) {
    // Before any await, so it still counts as part of the click (autoplay rules).
    void this.player?.activateElement().catch(() => {});
    const token = ++this.token;
    const uri = requireSpotifyTrack(track);
    this.tracker = newTracker(uri, track.duration);
    this.endedSent = false;
    this.armed = null;
    this.events.duration(track.duration / 1000);
    try {
      await this.ensurePlayer();
      if (token !== this.token) return;
      const positionMs = startMs(track, startAt);
      if (!autoplay) {
        this.armed = { uri, positionMs };
        this.isPaused = true;
        this.events.time(positionMs / 1000);
        this.events.state("paused");
        return;
      }
      this.events.state("loading");
      await this.start(uri, positionMs);
    } catch (err) {
      throw toPlaybackError(err);
    }
  }

  private onState(state: SdkState | null) {
    const tracker = this.tracker;
    if (!tracker) return;
    const current = state?.track_window.current_track ?? null;
    // Spotify may play a relinked copy (another market's release) under a different URI.
    const uri = current && (current.uri === tracker.uri || current.linked_from?.uri === tracker.uri) ? tracker.uri : current?.uri ?? null;
    const snap: PlaybackSnapshot | null = state && {
      uri,
      position: state.position,
      duration: state.duration,
      paused: state.paused,
      previousUris: state.track_window.previous_tracks.flatMap((t) => [t.uri, t.linked_from?.uri ?? ""]),
    };
    const { verdict, tracker: next } = checkEnd(tracker, snap);
    this.tracker = next;

    if (verdict === "ended") return this.finish();
    if (verdict === "foreign") {
      this.tracker = null;
      this.stopPolling();
      this.events.detached?.();
      return;
    }
    if (!snap || snap.uri !== tracker.uri) return;
    this.isPaused = snap.paused;
    if (snap.duration) this.events.duration(snap.duration / 1000);
    if (!document.hidden) this.events.time(snap.position / 1000);
    this.events.state(snap.paused ? "paused" : "playing");
    this.syncPolling();
  }

  private finish() {
    if (this.endedSent) return;
    this.endedSent = true;
    this.isPaused = true;
    this.stopPolling();
    this.events.ended();
  }

  /** getCurrentState ~4 times a second, only while playing and visible, so the UI's clock moves like `timeupdate`. */
  private syncPolling() {
    if (!this.isPaused && !document.hidden && this.player && this.tracker) {
      this.poll ??= setInterval(() => {
        void this.player?.getCurrentState().then((s) => s && this.onState(s), () => {});
      }, 250);
    } else this.stopPolling();
  }

  private stopPolling() {
    clearInterval(this.poll);
    this.poll = undefined;
  }

  async play() {
    void this.player?.activateElement().catch(() => {});
    if (this.armed) {
      const { uri, positionMs } = this.armed;
      this.armed = null;
      this.events.state("loading");
      try {
        await this.start(uri, positionMs);
      } catch (err) {
        const e = toPlaybackError(err);
        this.events.error(e.message, false);
      }
      return;
    }
    if (this.tracker && this.endedSent) {
      // Repeat one: the track finished, so start it again.
      this.tracker = newTracker(this.tracker.uri, this.tracker.duration);
      this.endedSent = false;
      await this.start(this.tracker.uri, 0).catch((err) => this.events.error(toPlaybackError(err).message, false));
      return;
    }
    await this.player?.resume();
  }

  pause() {
    void this.player?.pause().catch(() => {});
  }

  seek(seconds: number) {
    const ms = Math.round(seconds * 1000);
    if (this.armed) {
      this.armed.positionMs = ms;
      return;
    }
    if (this.tracker) this.tracker = { ...this.tracker, lastPosition: ms, played: ms > 0 && this.tracker.played };
    if (this.endedSent && this.tracker) {
      // After the end, seeking (repeat one goes to 0 first) restarts on play().
      return;
    }
    void this.player?.seek(ms).catch(() => {});
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (!this.muted) void this.player?.setVolume(volume).catch(() => {});
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    void this.player?.setVolume(muted ? 0 : this.volume).catch(() => {});
  }

  unload() {
    this.token++;
    this.tracker = null;
    this.armed = null;
    this.stopPolling();
    if (!this.isPaused) void this.player?.pause().catch(() => {});
    this.isPaused = true;
  }

  destroy() {
    this.unload();
    this.player?.disconnect();
    this.player = null;
    this.setup = null;
    this.deviceId = null;
  }
}

// ---------------------------------------------------------------------------
// Spotify Connect (remote control)

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
  supports_volume?: boolean;
}

/** The user's Spotify devices, for the device picker. */
export async function listSpotifyDevices(): Promise<SpotifyDevice[]> {
  const r = await spGet<{ devices: SpotifyDevice[] }>("/me/player/devices");
  return (r.devices ?? []).filter((d) => d.id && !d.is_restricted);
}

interface ConnectState {
  is_playing: boolean;
  progress_ms: number | null;
  item: { uri: string; duration_ms: number; linked_from?: { uri: string | null } | null } | null;
  device?: { id: string | null; name: string } | null;
}

export class SpotifyConnectEngine implements PlaybackEngine {
  readonly kind = "spotify-connect";
  private tracker: EndTracker | null = null;
  private endedSent = false;
  private isPaused = true;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private tick: ReturnType<typeof setInterval> | undefined;
  /** Position from the last poll and when it was read, to move the clock between polls. */
  private anchor = { positionMs: 0, at: 0 };
  private volumeTimer: ReturnType<typeof setTimeout> | undefined;
  private volume = 0.8;
  private muted = false;
  private token = 0;
  private armed: { uri: string; positionMs: number } | null = null;

  /** `deviceId` returns the chosen device, or null for whichever is active. */
  constructor(private events: EngineEvents, private deviceId: () => string | null) {
    document.addEventListener("visibilitychange", () => this.schedule(0));
  }

  get paused() {
    return this.isPaused;
  }

  private query() {
    const id = this.deviceId();
    return id ? { device_id: id } : {};
  }

  private async start(uri: string, positionMs: number) {
    await spotifyRequest<void>("PUT", "/me/player/play", { query: this.query(), body: { uris: [uri], position_ms: positionMs } });
    this.isPaused = false;
    this.anchor = { positionMs, at: Date.now() };
    this.events.state("playing");
    this.startTick();
    // The device takes a moment to report the new track.
    this.schedule(1500);
  }

  async load(track: Track, { autoplay, startAt }: LoadOptions) {
    const token = ++this.token;
    const uri = requireSpotifyTrack(track);
    this.tracker = newTracker(uri, track.duration);
    this.endedSent = false;
    this.armed = null;
    this.stopTimers();
    this.events.duration(track.duration / 1000);
    const positionMs = startMs(track, startAt);
    try {
      await useSpotify().accessToken();
      if (token !== this.token) return;
      if (!autoplay) {
        this.armed = { uri, positionMs };
        this.isPaused = true;
        this.events.time(positionMs / 1000);
        this.events.state("paused");
        return;
      }
      this.events.state("loading");
      await this.start(uri, positionMs);
    } catch (err) {
      throw toPlaybackError(err);
    }
  }

  /** Polls GET /me/player: every second while playing and visible, every 3 s hidden, every 5 s paused. */
  private schedule(delay?: number) {
    clearTimeout(this.poll);
    if (!this.tracker || this.endedSent) return;
    const wait = delay ?? (this.isPaused ? 5000 : document.hidden ? 3000 : 1000);
    if (this.isPaused && document.hidden) return;
    this.poll = setTimeout(() => void this.refresh(), wait);
  }

  private async refresh() {
    const token = this.token;
    let state: ConnectState | undefined;
    try {
      state = await spGet<ConnectState | undefined>("/me/player");
    } catch {
      return this.schedule(5000);
    }
    if (token !== this.token || !this.tracker) return;
    const item = state?.item ?? null;
    const target = this.tracker.uri;
    const uri = item && (item.uri === target || item.linked_from?.uri === target) ? target : item?.uri ?? null;
    const snap: PlaybackSnapshot | null = state && item ? {
      uri, position: state.progress_ms ?? 0, duration: item.duration_ms, paused: !state.is_playing,
    } : null;
    const { verdict, tracker } = checkEnd(this.tracker, snap);
    this.tracker = tracker;
    if (verdict === "ended") return this.finish();
    if (verdict === "foreign") {
      this.tracker = null;
      this.stopTimers();
      this.isPaused = true;
      this.events.detached?.();
      return;
    }
    if (snap && snap.uri === target) {
      this.isPaused = snap.paused;
      this.anchor = { positionMs: snap.position, at: Date.now() };
      if (snap.duration) this.events.duration(snap.duration / 1000);
      if (!document.hidden) this.events.time(snap.position / 1000);
      this.events.state(snap.paused ? "paused" : "playing");
      if (snap.paused) this.stopTick();
      else this.startTick();
    }
    this.schedule();
  }

  /** Moves the clock four times a second between polls. */
  private startTick() {
    this.tick ??= setInterval(() => {
      if (this.isPaused || document.hidden) return;
      this.events.time((this.anchor.positionMs + Date.now() - this.anchor.at) / 1000);
    }, 250);
  }

  private stopTick() {
    clearInterval(this.tick);
    this.tick = undefined;
  }

  private stopTimers() {
    clearTimeout(this.poll);
    this.poll = undefined;
    this.stopTick();
  }

  private finish() {
    if (this.endedSent) return;
    this.endedSent = true;
    this.isPaused = true;
    this.stopTimers();
    this.events.ended();
  }

  async play() {
    try {
      if (this.armed) {
        const { uri, positionMs } = this.armed;
        this.armed = null;
        await this.start(uri, positionMs);
      } else if (this.tracker && this.endedSent) {
        this.tracker = newTracker(this.tracker.uri, this.tracker.duration);
        this.endedSent = false;
        await this.start(this.tracker.uri, 0);
      } else {
        await spotifyRequest<void>("PUT", "/me/player/play", { query: this.query() });
        this.isPaused = false;
        this.anchor = { ...this.anchor, at: Date.now() };
        this.events.state("playing");
        this.startTick();
        this.schedule(1000);
      }
    } catch (err) {
      this.events.error(toPlaybackError(err).message, false);
    }
  }

  pause() {
    const position = this.anchor.positionMs + (this.isPaused ? 0 : Date.now() - this.anchor.at);
    this.isPaused = true;
    this.anchor = { positionMs: position, at: Date.now() };
    this.stopTick();
    this.events.state("paused");
    spotifyRequest<void>("PUT", "/me/player/pause", { query: this.query() })
      .then(() => this.schedule(), (err) => this.events.error(toPlaybackError(err).message, false));
  }

  seek(seconds: number) {
    const ms = Math.round(seconds * 1000);
    this.anchor = { positionMs: ms, at: Date.now() };
    if (this.armed) {
      this.armed.positionMs = ms;
      return;
    }
    if (this.tracker) this.tracker = { ...this.tracker, lastPosition: ms, played: ms > 0 && this.tracker.played };
    if (this.endedSent) return;
    spotifyRequest<void>("PUT", "/me/player/seek", { query: { ...this.query(), position_ms: ms } })
      .then(() => this.schedule(1000), () => {});
  }

  /** Debounced: dragging the slider would otherwise send dozens of requests. Phones often refuse remote volume; that's ignored. */
  private sendVolume() {
    clearTimeout(this.volumeTimer);
    this.volumeTimer = setTimeout(() => {
      if (!this.tracker) return;
      const percent = Math.round((this.muted ? 0 : this.volume) * 100);
      spotifyRequest<void>("PUT", "/me/player/volume", { query: { ...this.query(), volume_percent: percent } }).catch(() => {});
    }, 300);
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.sendVolume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.sendVolume();
  }

  unload() {
    this.token++;
    const wasPlaying = !this.isPaused && !!this.tracker;
    this.tracker = null;
    this.armed = null;
    this.isPaused = true;
    this.stopTimers();
    if (wasPlaying) spotifyRequest<void>("PUT", "/me/player/pause", { query: this.query() }).catch(() => {});
  }

  destroy() {
    this.unload();
  }
}
