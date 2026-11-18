// Adding tracks to a playlist without duplicates, and the message that goes
// with it. Pure, tested in tests/playlistEdit.test.ts.
import type { Track } from "../api/types";

export interface AddPlan {
  /** The playlist after the add: existing tracks, then the new ones in the order given. */
  next: Track[];
  added: Track[];
  /** Tracks already in the playlist, or given twice. */
  duplicates: Track[];
}

/** Appends `incoming` to `existing`, skipping tracks the playlist already has (by ID) and repeats within `incoming`. */
export function planAdd(existing: readonly Pick<Track, "id">[], incoming: readonly Track[]): AddPlan {
  const have = new Set(existing.map((t) => t.id));
  const added: Track[] = [];
  const duplicates: Track[] = [];
  for (const t of incoming) {
    if (have.has(t.id)) duplicates.push(t);
    else {
      have.add(t.id);
      added.push(t);
    }
  }
  return { next: [...(existing as Track[]), ...added], added, duplicates };
}

/** The toast after an add: "Added to X", "Already in X", "Added 3 tracks to X (2 were already there)". */
export function addMessage(playlistTitle: string, plan: Pick<AddPlan, "added" | "duplicates">): string {
  const name = `"${playlistTitle}"`;
  const a = plan.added.length;
  const d = plan.duplicates.length;
  if (!a && !d) return `Nothing to add to ${name}`;
  if (!a) return d === 1 ? `Already in ${name}` : `All ${d} tracks are already in ${name}`;
  const what = a === 1 ? (d ? "1 track" : `"${plan.added[0].title}"`) : `${a} tracks`;
  const tail = d ? ` (${d} ${d === 1 ? "was" : "were"} already there)` : "";
  return `Added ${what} to ${name}${tail}`;
}

/** Moves one item, returning a new array. Out-of-range moves return a copy unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Checks a playlist name the way the hosted server does: required, at most 100 characters. */
export function playlistTitleError(title: string): string | null {
  const t = title.trim();
  if (!t) return "Give the playlist a name.";
  if (t.length > 100) return "Names can be at most 100 characters.";
  return null;
}
