// Parses a pasted track list: "Artist - Title" lines, or a CSV such as the
// one Exportify (exportify.net) writes. Pure, tested in tests/trackList.test.ts.
import type { SourceTrack } from "./match";

export interface ParsedTrackList {
  format: "csv" | "lines";
  tracks: SourceTrack[];
  /** Lines or rows that had no usable title. */
  skipped: number;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** "3:45" or "1:02:03" -> ms. */
function clockToMs(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

function durationField(value: string, header: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const clock = clockToMs(v);
  if (clock != null) return clock;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Exportify gives milliseconds; other tools sometimes give seconds.
  return /ms|milli/i.test(header) || n > 10000 ? Math.round(n) : Math.round(n * 1000);
}

const looksLikeCsvHeader = (line: string) =>
  line.includes(",") && /(^|,)\s*"?(track name|track|title|name|song)"?\s*(,|$)/i.test(line);

function fromCsv(text: string): ParsedTrackList {
  const [header = [], ...rows] = parseCsv(text);
  const cols = header.map((h) => h.trim().toLowerCase());
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = cols.findIndex((c) => p.test(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  const title = find(/^track name$/, /^(title|name|song|track)$/, /track name|title/);
  const artist = find(/^artist name\(s\)$/, /^artists?( name)?$/, /artist/);
  const duration = find(/^duration \(ms\)$/, /duration|length|time/);
  const uri = find(/^track uri$/, /uri|spotify id/);

  const tracks: SourceTrack[] = [];
  let skipped = 0;
  for (const row of rows) {
    const name = (row[title] ?? "").trim();
    if (title < 0 || !name) {
      skipped++;
      continue;
    }
    const rawUri = uri >= 0 ? (row[uri] ?? "").trim() : "";
    tracks.push({
      title: name,
      // Exportify joins several artists with commas (older exports) or semicolons.
      artists: artist >= 0 ? (row[artist] ?? "").split(/\s*[;,]\s*/).map((a) => a.trim()).filter(Boolean) : [],
      durationMs: duration >= 0 ? durationField(row[duration] ?? "", header[duration] ?? "") : null,
      spotifyId: rawUri.startsWith("spotify:track:") ? rawUri.slice(14) : null,
    });
  }
  return { format: "csv", tracks, skipped };
}

function fromLines(text: string): ParsedTrackList {
  const tracks: SourceTrack[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^\d+[.)]\s+/, "");
    let durationMs: number | null = null;
    line = line.replace(/\s*[([]?(\d{1,2}:\d{2}(?::\d{2})?)[)\]]?$/, (_m, clock: string) => {
      durationMs = clockToMs(clock);
      return "";
    });
    const parts = line.split(/\s+[-–—]\s+|\t/);
    const artist = parts.length > 1 ? parts[0].trim() : "";
    const title = (parts.length > 1 ? parts.slice(1).join(" - ") : parts[0]).trim();
    if (!title) {
      skipped++;
      continue;
    }
    tracks.push({ title, artists: artist ? [artist] : [], durationMs });
  }
  return { format: "lines", tracks, skipped };
}

export function parseTrackList(text: string): ParsedTrackList {
  const firstLine = text.trimStart().split(/\r?\n/, 1)[0] ?? "";
  return looksLikeCsvHeader(firstLine) ? fromCsv(text.trimStart()) : fromLines(text);
}
