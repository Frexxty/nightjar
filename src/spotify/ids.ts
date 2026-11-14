// Spotify objects use their URIs as Nightjar IDs ("spotify:track:…"), so they
// never collide with SoundCloud's numeric IDs. See docs/spotify.md.

/** "user" is a playlist owner; the Web API only shares the signed-in user's profile. */
export type SpotifyKind = "track" | "artist" | "playlist" | "album" | "user";

export const isSpotifyId = (id: string | null | undefined): boolean => !!id && id.startsWith("spotify:");

/** "spotify:track:abc" -> { kind: "track", id: "abc" }, or null for anything else. */
export function parseSpotifyUri(uri: string): { kind: SpotifyKind; id: string } | null {
  const m = /^spotify:(track|artist|playlist|album):([A-Za-z0-9]+)$/.exec(uri) ?? /^spotify:(user):([^:\s]+)$/.exec(uri);
  return m ? { kind: m[1] as SpotifyKind, id: m[2] } : null;
}

export const spotifyUri = (kind: SpotifyKind, id: string) => `spotify:${kind}:${id}`;

/** The open.spotify.com page for a URI, or null for local files and unknown shapes. */
export function spotifyWebUrl(uri: string): string | null {
  const parsed = parseSpotifyUri(uri);
  return parsed ? `https://open.spotify.com/${parsed.kind}/${parsed.id}` : null;
}
