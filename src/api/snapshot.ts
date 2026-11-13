// Spotify tracks saved in a Stratus account travel as snapshots: the server
// can't ask Spotify for them, so it keeps what the client sends (docs/spotify.md).
// No imports beyond types, so `node --test` can load this file directly.
import type { Track } from "./types";

export const isSpotifyTrackId = (id: string | null | undefined) => !!id && id.startsWith("spotify:");

/** The fields of a Spotify track worth storing. Per-user flags and bulky fields stay out. */
export function trackSnapshot(t: Track): Track {
  return {
    id: t.id,
    title: t.title,
    user: { id: t.user.id, username: t.user.username, avatarUrl: t.user.avatarUrl, ...(t.user.verified ? { verified: true } : {}) },
    artworkUrl: t.artworkUrl,
    duration: t.duration,
    createdAt: t.createdAt,
    playbackCount: t.playbackCount,
    likesCount: t.likesCount,
    repostsCount: t.repostsCount,
    commentCount: t.commentCount,
    permalinkUrl: t.permalinkUrl ?? null,
    streamable: t.streamable,
    source: t.source ?? "spotify",
    uri: t.uri ?? null,
    album: t.album ?? null,
    ...(t.genre ? { genre: t.genre } : {}),
    ...(t.preview ? { preview: true } : {}),
  };
}

/** Snapshots for a list, or undefined when it has no Spotify track (SoundCloud-only lists send IDs as before). */
export function snapshotsFor(tracks: Track[] | undefined): Track[] | undefined {
  if (!tracks?.some((t) => isSpotifyTrackId(t.id))) return undefined;
  return tracks.map((t) => (isSpotifyTrackId(t.id) ? trackSnapshot(t) : { ...t, waveform: null }));
}
