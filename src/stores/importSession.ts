import { defineStore } from "pinia";
import { computed, markRaw, ref } from "vue";
import { api, type Track } from "@/api";
import type { SpotifyImport } from "@/lib/spotifyImport";
import { CHECK, findMatches, rankCandidates, statusOf, type MatchStatus, type ScoredCandidate, type SourceTrack } from "@/lib/match";
import { withTrackArtwork } from "@/spotify/artwork";

/** What is being imported, whichever way it came in. */
export interface ImportList {
  name: string;
  owner: string | null;
  coverUrl: string | null;
  total: number | null;
  truncated: boolean;
  notice: string | null;
  source: "embed" | "page" | "paste";
  url: string | null;
}

export interface ImportRow {
  key: number;
  source: SourceTrack;
  state: "pending" | "searching" | "done" | "error";
  error: string | null;
  candidates: ScoredCandidate[];
  pick: ScoredCandidate | null;
  /** The user chose this pick, so it counts as matched whatever its score. */
  manual: boolean;
  skipped: boolean;
}

export type RowStatus = MatchStatus | "pending" | "skipped";

const CONCURRENCY = 4;
/** How long saving waits for covers still loading. Ones that miss it are filled in when the playlist opens. */
const ARTWORK_WAIT_MS = 4000;

const isTrack = (x: object): x is Track => "duration" in x && "streamable" in x;

async function searchTracks(query: string): Promise<Track[]> {
  const page = await api.value.searchKind(query, "tracks");
  return page.items.filter(isTrack);
}

/**
 * The import in progress. Kept in a store so matching carries on, and the
 * results survive, if you leave the import page and come back.
 */
export const useImportSession = defineStore("importSession", () => {
  const list = ref<ImportList | null>(null);
  const rows = ref<ImportRow[]>([]);
  /** Set when the list was taken as Spotify tracks, with no SoundCloud matching. */
  const direct = ref<SpotifyImport | null>(null);
  /** What was read, so a direct import can still switch to matching. */
  const sourceTracks = ref<SourceTrack[]>([]);
  const matching = ref(false);
  /** Cover lookups for a direct import: how many have finished, out of how many. */
  const artwork = ref<{ done: number; total: number; running: boolean }>({ done: 0, total: 0, running: false });
  let artworkJob: Promise<unknown> = Promise.resolve();
  let token = 0;

  function rowStatus(row: ImportRow): RowStatus {
    if (row.skipped) return "skipped";
    if (row.state === "pending" || row.state === "searching") return "pending";
    if (!row.pick) return "none";
    return row.manual ? "matched" : statusOf(row.pick.score);
  }

  const done = computed(() => rows.value.filter((r) => r.state === "done" || r.state === "error").length);
  const counts = computed(() => {
    const c = { matched: 0, check: 0, none: 0, pending: 0 };
    for (const row of rows.value) {
      const s = rowStatus(row);
      if (s === "skipped") c.none++;
      else c[s]++;
    }
    return c;
  });
  const chosenTracks = computed(() =>
    direct.value ? direct.value.tracks : rows.value.filter((r) => r.pick && !r.skipped && rowStatus(r) !== "pending").map((r) => r.pick!.track),
  );

  function begin(next: ImportList, tracks: SourceTrack[]) {
    cancel();
    list.value = next;
    direct.value = null;
    artwork.value = { done: 0, total: 0, running: false };
    sourceTracks.value = tracks;
    rows.value = tracks.map((source, key) => ({
      key, source, state: "pending", error: null, candidates: [], pick: null, manual: false, skipped: false,
    }));
    void match();
  }

  /** Takes the list as Spotify tracks (music source Spotify). Nothing to match. */
  function beginDirect(next: ImportList, tracks: SourceTrack[], result: SpotifyImport) {
    cancel();
    list.value = next;
    rows.value = [];
    sourceTracks.value = tracks;
    direct.value = { tracks: result.tracks.map((t) => markRaw(t)), skipped: result.skipped };
    void fillArtwork();
  }

  /**
   * Looks up the cover of each Spotify track that has none (playlist tracks read
   * from the embed page); the list's rows update as they arrive. Album tracks
   * already carry the album cover.
   */
  function fillArtwork() {
    const mine = token;
    const d = direct.value;
    if (!d) return;
    artwork.value = { done: 0, total: 0, running: true };
    artworkJob = withTrackArtwork(
      d.tracks,
      ({ index, track, found, done, total }) => {
        if (mine !== token || direct.value !== d) return;
        if (found) d.tracks[index] = markRaw(track);
        artwork.value = { done, total, running: done < total };
      },
      { missingOnly: true },
    ).finally(() => {
      if (mine === token) artwork.value = { ...artwork.value, running: false };
    });
    return artworkJob;
  }

  /** Resolves once covers are in, or after a few seconds, whichever comes first. */
  function artworkSettled(maxMs = ARTWORK_WAIT_MS): Promise<void> {
    if (!artwork.value.running) return Promise.resolve();
    return Promise.race([artworkJob.then(() => {}), new Promise<void>((resolve) => setTimeout(resolve, maxMs))]);
  }

  /** "Match on SoundCloud instead" for a direct import. */
  function matchInstead() {
    if (list.value) begin(list.value, sourceTracks.value);
  }

  function reset() {
    cancel();
    artwork.value = { done: 0, total: 0, running: false };
    list.value = null;
    rows.value = [];
    direct.value = null;
    sourceTracks.value = [];
  }

  // Candidates hold full Track objects; markRaw keeps Vue from proxying them.
  function setCandidates(row: ImportRow, found: ScoredCandidate[]) {
    row.candidates = found.map((c) => markRaw(c));
  }

  async function matchRow(row: ImportRow) {
    row.state = "searching";
    try {
      const found = await findMatches(row.source, searchTracks);
      setCandidates(row, found);
      const best = row.candidates[0] ?? null;
      row.pick = best && best.score >= CHECK ? best : null;
      row.manual = false;
      row.state = "done";
      row.error = null;
    } catch (err) {
      row.state = "error";
      row.error = (err as Error).message;
    }
  }

  /** Matches every row that hasn't been matched yet, four searches at a time. */
  async function match() {
    const mine = ++token;
    const todo = rows.value.filter((r) => r.state === "pending" || r.state === "error");
    if (!todo.length) return;
    matching.value = true;
    let next = 0;
    const worker = async () => {
      while (mine === token && next < todo.length) await matchRow(todo[next++]);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (mine === token) matching.value = false;
  }

  /** Stops after the searches already in flight. Unmatched rows stay pending. */
  function cancel() {
    token++;
    matching.value = false;
    for (const row of rows.value) if (row.state === "searching") row.state = "pending";
  }

  /** Searches again with the user's own text. Keeps the current pick until they choose. */
  async function research(row: ImportRow, query: string) {
    const q = query.trim();
    if (!q) return;
    const before = row.state;
    row.state = "searching";
    try {
      setCandidates(row, rankCandidates(row.source, await searchTracks(q), 8));
      row.state = "done";
      row.error = null;
    } catch (err) {
      row.state = before === "done" ? "done" : "error";
      row.error = (err as Error).message;
    }
  }

  function choose(row: ImportRow, candidate: ScoredCandidate) {
    row.pick = candidate;
    row.manual = true;
    row.skipped = false;
  }

  function setSkipped(row: ImportRow, skipped: boolean) {
    row.skipped = skipped;
  }

  return {
    list, rows, direct, sourceTracks, matching, artwork, done, counts, chosenTracks,
    rowStatus, begin, beginDirect, artworkSettled, matchInstead, reset, match, cancel, research, choose, setSkipped,
  };
});
