// Turns an imported Spotify list into Spotify tracks Stratus can save and play
// as they are, for people whose music source is Spotify (docs/spotify.md).
// Type imports only, so `node --test` can load this file directly.
import type { Track } from "@/api";
import type { SourceTrack } from "./match";

/** Spotify lists carry no artist IDs, so every artist gets this placeholder. */
export const UNKNOWN_ARTIST_ID = "spotify:artist:unknown";

export interface SpotifyImport {
  tracks: Track[];
  /** Entries without a Spotify ID (local files in a playlist), which Spotify can't play. */
  skipped: SourceTrack[];
}

/**
 * `fallbackArt` is the album cover for album imports. Playlists pass null: their
 * cover is a mosaic of other tracks, so tracks without their own art are left
 * blank for src/spotify/artwork.ts to fill in.
 */
export function spotifyListTrack(t: SourceTrack & { spotifyId: string }, fallbackArt: string | null, now = new Date().toISOString()): Track {
  const id = `spotify:track:${t.spotifyId}`;
  return {
    id,
    uri: id,
    source: "spotify",
    title: t.title,
    user: { id: UNKNOWN_ARTIST_ID, username: t.artists[0] ?? "Unknown artist", avatarUrl: null },
    artworkUrl: t.artworkUrl ?? fallbackArt,
    duration: t.durationMs ?? 0,
    createdAt: now,
    playbackCount: 0,
    likesCount: 0,
    repostsCount: 0,
    commentCount: 0,
    waveform: null,
    permalinkUrl: `https://open.spotify.com/track/${t.spotifyId}`,
    streamable: t.spotifyId != null,
    album: null,
  };
}

/** Spotify tracks for every entry with a Spotify ID, in list order. Works for read links and pasted CSVs with track URIs. */
export function spotifyImport(list: { kind?: "playlist" | "album"; coverUrl: string | null; tracks: SourceTrack[] }): SpotifyImport {
  const now = new Date().toISOString();
  // Every track on an album has the album's cover; a playlist's cover belongs to no track.
  const fallbackArt = list.kind === "album" ? list.coverUrl : null;
  const tracks: Track[] = [];
  const skipped: SourceTrack[] = [];
  for (const t of list.tracks) {
    if (t.spotifyId) tracks.push(spotifyListTrack({ ...t, spotifyId: t.spotifyId }, fallbackArt, now));
    else skipped.push(t);
  }
  return { tracks, skipped };
}
