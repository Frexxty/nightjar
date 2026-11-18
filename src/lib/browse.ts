// What a Browse genre page shows, for whichever music source is active.
import type { Backend, Page, Playlist, Track } from "@/api";
import { spotifyBackend } from "@/spotify/catalogue";
import { soundcloudGenrePlaylistId, spotifyGenreQuery, type Genre } from "./genres";

export interface GenreContent {
  tracks: Track[];
  playlists: Playlist[];
  /** Where the tracks came from, said under the title. */
  from: "chart" | "search" | "spotify";
}

const EMPTY: Page<never> = { items: [], next: null };

function unique(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => t && !seen.has(t.id) && seen.add(t.id));
}

/**
 * SoundCloud: the genre's "Trending by genre" system playlist when it has one,
 * otherwise (and when that fails) a track search. Spotify: search with the
 * genre: filter, three pages of 10, since search answers 10 at a time.
 * Playlists are a playlist search either way.
 */
export async function loadGenre(backend: Backend, genre: Genre): Promise<GenreContent> {
  const playlists = backend
    .searchKind(genre.query, "playlists")
    .then((p) => (p.items as Playlist[]).filter((x) => x.trackCount !== 0).slice(0, 16))
    .catch(() => [] as Playlist[]);

  if (backend === spotifyBackend) {
    const q = spotifyGenreQuery(genre);
    const pages = await Promise.all(["0", "10", "20"].map((offset) => backend.searchKind(q, "tracks", offset).catch(() => EMPTY)));
    let tracks = unique(pages.flatMap((p) => p.items as Track[]));
    // Not every genre name is a Spotify genre; fall back to plain words.
    if (tracks.length < 8 && q !== genre.query) {
      const words = await backend.searchKind(genre.query, "tracks").catch(() => EMPTY);
      tracks = unique([...tracks, ...(words.items as Track[])]);
    }
    return { tracks, playlists: await playlists, from: "spotify" };
  }

  const chartId = soundcloudGenrePlaylistId(genre);
  const chart = chartId ? await backend.playlist(chartId).then((p) => p.tracks ?? []).catch(() => [] as Track[]) : [];
  if (chart.length >= 5) return { tracks: unique(chart), playlists: await playlists, from: "chart" };
  const found = await backend.searchKind(genre.query, "tracks").catch(() => EMPTY);
  return { tracks: unique([...chart, ...(found.items as Track[])]), playlists: await playlists, from: "search" };
}
