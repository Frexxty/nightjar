// Scores SoundCloud search results against a track from another service.
// Pure functions with no Vue or DOM imports so `node --test` can run them
// directly (see tests/match.test.ts).
import type { Track } from "@/api";

/** A track to look for: from Spotify, a pasted line, or a CSV row. */
export interface SourceTrack {
  title: string;
  artists: string[];
  durationMs: number | null;
  spotifyId?: string | null;
  explicit?: boolean;
  /** The track's own cover, when the reader had it (the full-page reader does). */
  artworkUrl?: string | null;
}

export type MatchStatus = "matched" | "check" | "none";

export interface ScoredCandidate {
  track: Track;
  score: number;
  parts: { title: number; artist: number | null; duration: number | null; penalty: number };
}

export const MATCHED = 0.75;
export const CHECK = 0.5;

export function statusOf(score: number): MatchStatus {
  return score >= MATCHED ? "matched" : score >= CHECK ? "check" : "none";
}

/** Lowercase, no accents, no punctuation, single spaces. "Beyoncé's Hits!" -> "beyonces hits". */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/&|\+/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const compact = (s: string) => normalize(s).replace(/ /g, "");
const tokens = (s: string) => normalize(s).split(" ").filter(Boolean);

// Words that describe the upload, not the song. A bracket made only of these goes.
const NOISE = new RegExp(
  "\\b(" + [
    "official", "music", "lyrics?", "lyric", "audio", "video", "visuali[sz]er", "hd", "hq", "4k", "explicit", "clean",
    "remaster(ed)?", "\\d{4}", "version", "radio", "edit", "original", "mix", "single", "album", "mono", "stereo",
    "free", "download", "dl", "out", "now", "premiere", "bonus", "track", "full", "song", "new", "extended", "ver",
  ].join("|") + ")\\b",
  "g",
);
const FEAT = /^(feat|ft|featuring|with)\b\.?\s*/i;
const PROD = /^prod\b\.?(\s*by)?\s*/i;
const DASH = /\s+[-–—]\s+/;

function isNoise(text: string) {
  const rest = normalize(text).replace(NOISE, "").trim();
  return rest === "";
}

/**
 * Removes "(Official Video)", "[feat. X]", " feat. X", "(prod. Y)" and the like.
 * Keeps brackets that change what the recording is ("(Tiesto Remix)", "(Live)").
 * Returns the featured artists it took out.
 */
export function stripDecorations(title: string): { text: string; featured: string[] } {
  const featured: string[] = [];
  let text = title.replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (whole, inner: string) => {
    const content = inner.trim();
    if (FEAT.test(content)) {
      featured.push(...splitArtists(content.replace(FEAT, "")));
      return " ";
    }
    if (PROD.test(content) || isNoise(content)) return " ";
    return whole;
  });
  // Unbracketed "feat. X" runs to the end of the title or the next dash.
  text = text.replace(/\s(?:feat|ft|featuring)\b\.?\s+(.+?)(?=\s+[-–—]\s+|$)/i, (_m, who: string) => {
    featured.push(...splitArtists(who));
    return "";
  });
  return { text: text.replace(/\s+/g, " ").trim(), featured };
}

/** "A, B & C x D feat. E" -> ["A", "B", "C", "D", "E"]. */
export function splitArtists(s: string): string[] {
  return s
    .split(/\s*(?:,|&|\+|;|\/|\bx\b|\band\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Title for comparing and searching: decorations removed, and a trailing
 * " - Remastered 2011" / " - Radio Edit" / " - From "Film"" dropped. A suffix
 * like " - Acoustic" or " - X Remix" stays because it names a different recording.
 */
export function cleanTitle(title: string): string {
  const { text } = stripDecorations(title);
  const parts = text.split(DASH);
  if (parts.length > 1) {
    const suffix = parts.slice(1).join(" - ");
    if (isNoise(suffix) || /^from\b/i.test(suffix) || FEAT.test(suffix)) return parts[0].trim();
  }
  return text;
}

/**
 * SoundCloud uploads are often titled "Artist - Title". Returns both halves
 * (cleaned) when there's a dash, plus artists named after "feat.".
 */
export function splitUploadTitle(title: string): { artist: string | null; title: string; featured: string[] } {
  const { text, featured } = stripDecorations(title);
  const parts = text.split(DASH);
  if (parts.length < 2) return { artist: null, title: text, featured };
  return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim(), featured };
}

/** Dice coefficient over word sets, 1 for identical text ignoring spaces. */
export function titleSimilarity(a: string, b: string): number {
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

export function artistSimilarity(a: string, b: string): number {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // "theweeknd" vs "theweekndofficial", "sza" vs "szamusic".
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 3 && long.includes(short)) return 0.9;
  return titleSimilarity(a, b) * 0.8;
}

const VARIANTS: [string, RegExp][] = [
  ["remix", /\b(remix|rmx|remixed|bootleg|flip|rework|vip)\b/],
  ["cover", /\bcover\b/],
  ["sped up", /\b(sped up|speed up|spedup)\b/],
  ["slowed", /\b(slowed|reverb)\b/],
  ["nightcore", /\bnightcore\b/],
  ["8d", /\b8d\b/],
  ["instrumental", /\b(instrumental|inst)\b/],
  ["karaoke", /\bkaraoke\b/],
  ["live", /\blive\b/],
  ["acoustic", /\bacoustic\b/],
  ["mashup", /\bmash ?up\b/],
  ["loop", /\b\d+ hours?\b/],
  ["sing off", /\bsing ?off\b/],
  ["edit", /\b(no autotune|acapella|a cappella|bass boosted)\b/],
];

// Checked against the lowercased raw title: "w/ Ariana Grande" is how mashups
// credit the second song, and normalize() drops the slash.
const RAW_VARIANTS: [string, RegExp][] = [["mashup", /(^|[\s(\[])w\/\s/]];

/** Which variant markers ("remix", "live", "sped up"...) a title carries. */
export function variantsOf(title: string): Set<string> {
  const n = normalize(title);
  const raw = title.toLowerCase();
  return new Set([
    ...VARIANTS.filter(([, re]) => re.test(n)).map(([name]) => name),
    ...RAW_VARIANTS.filter(([, re]) => re.test(raw)).map(([name]) => name),
  ]);
}

/**
 * Penalty for a SoundCloud upload that is a different recording: a remix,
 * cover, sped-up edit, etc. that the source title doesn't also have.
 */
export function variantPenalty(sourceTitle: string, uploadTitle: string): number {
  const want = variantsOf(sourceTitle);
  const got = variantsOf(uploadTitle);
  let extra = 0;
  for (const v of got) if (!want.has(v)) extra++;
  let missing = 0;
  for (const v of want) if (!got.has(v)) missing++;
  const penalty = (extra ? 0.3 + (extra - 1) * 0.15 : 0) + missing * 0.1;
  return Math.min(0.45, penalty);
}

/** 1 within 3 s, at least 0.6 within 10 s or 10%, then falls off to 0 around 30% off. */
export function durationSimilarity(sourceMs: number, uploadMs: number): number {
  const diff = Math.abs(sourceMs - uploadMs);
  if (diff <= 3000) return 1;
  const rel = diff / Math.max(sourceMs, 1);
  if (diff <= 10000 || rel <= 0.1) return 1 - 0.4 * Math.min(1, (diff - 3000) / 7000);
  return Math.max(0, 0.4 - (rel - 0.1) * 2);
}

/** SoundCloud serves 30-second previews for Go+ tracks; a 30 s upload of a 3 min song is one of those. */
export function looksLikePreview(sourceMs: number | null, uploadMs: number): boolean {
  return sourceMs != null && sourceMs > 45000 && uploadMs >= 25000 && uploadMs <= 35000;
}

export function artistScore(artists: string[], track: Track): number | null {
  if (!artists.length) return null;
  const upload = splitUploadTitle(track.title);
  const names = [track.user.username, ...(upload.artist ? splitArtists(upload.artist) : []), ...upload.featured];
  const best = (artist: string) => Math.max(0, ...names.map((n) => artistSimilarity(artist, n)));
  let score = best(artists[0]);
  for (const other of artists.slice(1)) score = Math.max(score, best(other) * 0.85);
  // Artist named somewhere in the title, e.g. "Blinding Lights - The Weeknd".
  const inTitle = compact(track.title);
  if (artists.some((a) => compact(a).length >= 4 && inTitle.includes(compact(a)))) score = Math.max(score, 0.85);
  return score;
}

/** How well a dash-separated half of an upload title names one of the source artists. */
function namesArtist(half: string, artists: string[]): number {
  const names = splitArtists(half);
  return Math.max(0, ...artists.flatMap((a) => names.map((n) => artistSimilarity(a, n))));
}

export function scoreCandidate(source: SourceTrack, track: Track): ScoredCandidate {
  const wanted = cleanTitle(source.title);
  const upload = splitUploadTitle(track.title);
  // "Artist - Title" (or "Title - Artist") only counts in full when the other
  // half is one of the artists we want. Otherwise "WHAT I NEED (w/ Ariana
  // Grande - Into You)" would be a perfect "Into You".
  const trust = (other: string | null) => (other == null || !source.artists.length || namesArtist(other, source.artists) >= 0.6 ? 1 : 0.6);
  const title = Math.max(
    titleSimilarity(wanted, cleanTitle(track.title)),
    titleSimilarity(wanted, cleanTitle(upload.title)) * trust(upload.artist),
    upload.artist ? titleSimilarity(wanted, upload.artist) * trust(upload.title) : 0,
  );
  const artist = artistScore(source.artists, track);
  // A preview's 30 s says nothing about whether it's the right recording.
  const preview = track.preview === true || looksLikePreview(source.durationMs, track.duration);
  const duration = !preview && source.durationMs != null && track.duration > 0 ? durationSimilarity(source.durationMs, track.duration) : null;

  let weighted = 0;
  let weight = 0;
  const add = (value: number | null, w: number) => {
    if (value == null) return;
    weighted += value * w;
    weight += w;
  };
  add(title, 0.5);
  add(artist, 0.3);
  add(duration, 0.2);
  let score = weighted / weight;

  // A matching artist and length can't rescue a different song.
  if (title < 0.5) score *= title / 0.5;
  // Without an artist we only know the title; never call that a sure match.
  if (artist == null) score = Math.min(score, 0.7);

  // Right title and artist but a minute off is usually a different edit or a
  // rip with intros cut; worth showing, not worth trusting.
  if (duration != null && duration < 0.3) score = Math.min(score, 0.7);
  // A 30 s preview is often the official recording, but it only plays 30
  // seconds. Keep it as a last resort below any full-length upload of the song.
  if (preview) score = Math.min(score - 0.05, 0.6);

  const penalty = variantPenalty(source.title, track.title);
  score = Math.max(0, Math.min(1, score - penalty));

  return { track, score, parts: { title, artist, duration, penalty } };
}

/** Highest score first; non-streamable uploads are dropped. */
export function rankCandidates(source: SourceTrack, tracks: Track[], limit = 5): ScoredCandidate[] {
  const seen = new Set<string>();
  return tracks
    .filter((t) => t.streamable && !seen.has(t.id) && seen.add(t.id))
    .map((t) => scoreCandidate(source, t))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** "{first artist} {clean title}", then "{clean title}". */
export function searchQueries(source: SourceTrack): string[] {
  const title = cleanTitle(source.title) || source.title.trim();
  const artist = source.artists[0]?.trim();
  const queries = artist ? [`${artist} ${title}`, title] : [title];
  return [...new Set(queries.filter(Boolean))];
}

/**
 * Searches with each query in turn and stops as soon as one gives a confident
 * match. `search` returns tracks for a query (the caller filters search results).
 */
export async function findMatches(
  source: SourceTrack,
  search: (query: string) => Promise<Track[]>,
  limit = 5,
): Promise<ScoredCandidate[]> {
  const pool: Track[] = [];
  let ranked: ScoredCandidate[] = [];
  for (const query of searchQueries(source)) {
    pool.push(...(await search(query)));
    ranked = rankCandidates(source, pool, limit);
    if (ranked[0] && ranked[0].score >= MATCHED) break;
  }
  return ranked;
}
