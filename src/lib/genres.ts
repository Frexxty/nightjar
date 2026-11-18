// Genres and moods on the Browse page. Pure data, tested in tests/genres.test.ts.
//
// `soundcloud` is the slug of SoundCloud's "Trending by genre" system playlist
// (soundcloud:system-playlists:trending-by-genre:<slug>, docs/hosted-api.md),
// for genres that have one. The rest, and Spotify, search with `query`.
// `spotify` is the value for Spotify search's genre: filter.

export interface Genre {
  id: string;
  label: string;
  /** Search words for SoundCloud tracks and playlists. */
  query: string;
  soundcloud?: string;
  spotify: string;
  /** Hue for the tile, 0 to 360. */
  hue: number;
  mood?: boolean;
}

export const GENRES: Genre[] = [
  { id: "hip-hop", label: "Hip Hop", query: "hip hop", soundcloud: "hip-hop", spotify: "hip-hop", hue: 28 },
  { id: "electronic", label: "Electronic", query: "electronic", soundcloud: "electronic", spotify: "electronic", hue: 200 },
  { id: "house", label: "House", query: "house", soundcloud: "house", spotify: "house", hue: 268 },
  { id: "techno", label: "Techno", query: "techno", soundcloud: "techno", spotify: "techno", hue: 230 },
  { id: "lo-fi", label: "Lo-fi", query: "lofi", spotify: "lo-fi", hue: 160 },
  { id: "pop", label: "Pop", query: "pop", soundcloud: "pop", spotify: "pop", hue: 330 },
  { id: "rock", label: "Rock", query: "rock", soundcloud: "rock", spotify: "rock", hue: 0 },
  { id: "indie", label: "Indie", query: "indie", soundcloud: "indie", spotify: "indie", hue: 45 },
  { id: "r-n-b", label: "R&B", query: "r&b", soundcloud: "r-n-b", spotify: "r-n-b", hue: 300 },
  { id: "jazz", label: "Jazz", query: "jazz", soundcloud: "jazz", spotify: "jazz", hue: 36 },
  { id: "ambient", label: "Ambient", query: "ambient", soundcloud: "ambient", spotify: "ambient", hue: 185 },
  { id: "drum-and-bass", label: "Drum & Bass", query: "drum and bass", spotify: "drum-and-bass", hue: 95 },
  { id: "trap", label: "Trap", query: "trap", soundcloud: "trap", spotify: "trap", hue: 12 },
  { id: "soul", label: "Soul", query: "soul", soundcloud: "soul", spotify: "soul", hue: 20 },
  { id: "latin", label: "Latin", query: "latin", soundcloud: "latin", spotify: "latin", hue: 50 },
  { id: "metal", label: "Metal", query: "metal", soundcloud: "metal", spotify: "metal", hue: 250 },
  { id: "chill", label: "Chill", query: "chill", spotify: "chill", hue: 175, mood: true },
  { id: "workout", label: "Workout", query: "workout", spotify: "work-out", hue: 5, mood: true },
  { id: "focus", label: "Focus", query: "focus music", spotify: "study", hue: 215, mood: true },
  { id: "sleep", label: "Sleep", query: "sleep music", spotify: "sleep", hue: 245, mood: true },
];

export const genreById = (id: string): Genre | null => GENRES.find((g) => g.id === id) ?? null;

export const soundcloudGenrePlaylistId = (g: Genre): string | null =>
  g.soundcloud ? `soundcloud:system-playlists:trending-by-genre:${g.soundcloud}` : null;

/** The Spotify search query for a genre's tracks. Moods aren't genres on Spotify, so they search as words. */
export const spotifyGenreQuery = (g: Genre): string => (g.mood ? g.query : `genre:"${g.spotify}"`);
