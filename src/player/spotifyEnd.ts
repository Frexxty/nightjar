// Decides when a Spotify track Nightjar asked for has finished, from the
// snapshots the Web Playback SDK (player_state_changed, getCurrentState) or
// the Connect API (GET /me/player) report. Spotify doesn't send an "ended"
// event, and the signs differ by client, so several are checked.
// Pure, no imports: tests/spotifyEnd.test.ts runs it directly.

export interface PlaybackSnapshot {
  /** URI of the track the device has loaded, or null when nothing is loaded. */
  uri: string | null;
  /** Milliseconds. */
  position: number;
  /** Milliseconds. */
  duration: number;
  paused: boolean;
  /** SDK only: `track_window.previous_tracks` URIs. Connect has no such list. */
  previousUris?: string[];
}

export interface EndTracker {
  /** The URI Nightjar started. */
  uri: string;
  /** Seen playing past the start, so a later stop at 0 means it finished rather than hadn't started. */
  played: boolean;
  /** Last position seen for `uri`, in ms. */
  lastPosition: number;
  /** Duration seen for `uri`, in ms. */
  duration: number;
}

/**
 * "ended": the track finished. "foreign": the device moved to something else
 * mid-track (the user picked another song in the Spotify app). "none": keep going.
 */
export type EndVerdict = "none" | "ended" | "foreign";

export const newTracker = (uri: string, duration = 0): EndTracker => ({ uri, played: false, lastPosition: 0, duration });

/** How close to the end (ms) a last-seen position must be for a track change to count as the track ending. */
export const END_SLACK_MS = 4000;

export function checkEnd(tracker: EndTracker, snap: PlaybackSnapshot | null): { verdict: EndVerdict; tracker: EndTracker } {
  const nearEnd = tracker.duration > 0 && tracker.lastPosition >= tracker.duration - END_SLACK_MS;

  // Nothing loaded any more (Connect: 204 from /me/player after a lone URI finishes).
  if (!snap || !snap.uri) {
    return { verdict: tracker.played ? "ended" : "none", tracker };
  }

  if (snap.uri !== tracker.uri) {
    // The SDK moved on and lists our track as played.
    if (snap.previousUris?.includes(tracker.uri)) return { verdict: "ended", tracker };
    // Spotify's own autoplay started something after our track ran out.
    if (tracker.played && nearEnd) return { verdict: "ended", tracker };
    // Before ours has started, the device may still report the previous track.
    return { verdict: tracker.played ? "foreign" : "none", tracker };
  }

  const duration = snap.duration || tracker.duration;
  const next: EndTracker = {
    ...tracker,
    duration,
    played: tracker.played || (!snap.paused && snap.position > 0) || snap.position > 1000,
    lastPosition: snap.position,
  };

  if (next.played && snap.paused) {
    // The SDK resets to 0 and pauses when a lone URI finishes.
    if (snap.position === 0 && tracker.lastPosition > 0) return { verdict: "ended", tracker: next };
    // Some clients stop on the last frame instead.
    if (duration > 0 && snap.position >= duration - 500) return { verdict: "ended", tracker: next };
  }
  return { verdict: "none", tracker: next };
}
