// Spotify objects use their URIs as Stratus IDs ("spotify:track:…"), so they
// never collide with SoundCloud's numeric IDs. See docs/spotify.md.

export type SpotifyKind = "track" | "artist" | "playlist" | "album";

export const isSpotifyId = (id: string | null | undefined): boolean => !!id && id.startsWith("spotify:");

/** "spotify:track:abc" -> { kind: "track", id: "abc" }, or null for anything else. */
export function parseSpotifyUri(uri: string): { kind: SpotifyKind; id: string } | null {
  const m = /^spotify:(track|artist|playlist|album):([A-Za-z0-9]+)$/.exec(uri);
  return m ? { kind: m[1] as SpotifyKind, id: m[2] } : null;
}

export const spotifyUri = (kind: SpotifyKind, id: string) => `spotify:${kind}:${id}`;
