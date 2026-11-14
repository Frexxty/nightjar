<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ChevronDown, CircleCheck, ClipboardList, CloudUpload, ExternalLink, Link2, LogIn, Monitor, RotateCcw, Save, Search, TriangleAlert } from "lucide-vue-next";
import { api, ApiError, friendlyError, isUnauthorized, type SpotifyList } from "@/api";
import Artwork from "@/components/Artwork.vue";
import MatchPicker from "@/components/MatchPicker.vue";
import ImportFlow, { type ImportStage } from "@/components/onboarding/ImportFlow.vue";
import { duration } from "@/lib/format";
import type { SourceTrack } from "@/lib/match";
import { spotifyImport } from "@/lib/spotifyImport";
import { parseTrackList } from "@/lib/trackList";
import { useImportSession, type ImportList, type ImportRow, type RowStatus } from "@/stores/importSession";
import { useLibrary } from "@/stores/library";
import { useLocalPlaylists } from "@/stores/localPlaylists";
import { usePlayer } from "@/stores/player";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

const session = useImportSession();
const settings = useSettings();
const local = useLocalPlaylists();
const library = useLibrary();
const player = usePlayer();
const ui = useUi();
const router = useRouter();

// A browser tab can't read Spotify's pages. The desktop app reads them in its
// main process (full playlists); elsewhere the backend may read them for us.
const desktop = !!window.nightjar?.spotify;
const viaBackend = computed(() => !desktop && typeof api.value.importSpotify === "function");
const canReadLinks = computed(() => desktop || viaBackend.value);

const tab = ref<"link" | "paste">(canReadLinks.value ? "link" : "paste");
const link = ref("");
const pasted = ref("");
const fetching = ref(false);
const inputError = ref<string | null>(null);

function readSpotify(url: string): Promise<SpotifyList> {
  if (window.nightjar?.spotify) return window.nightjar.spotify.fetchPlaylist(url);
  const read = api.value.importSpotify;
  if (!read) throw new Error("Reading Spotify links needs the Nightjar desktop app.");
  return read.call(api.value, url).catch((err) => {
    // A custom server without the route.
    if (err instanceof ApiError && (err.status === 404 || err.status === 405) && !err.code) {
      throw new Error("This server can't read Spotify links. Paste a track list instead.");
    }
    throw err;
  });
}

// With Spotify as the music source, a list with Spotify IDs is saved as
// Spotify tracks. Otherwise each track is matched against SoundCloud.
const spotifyMode = computed(() => settings.musicSource === "spotify");

function start(info: ImportList, tracks: SourceTrack[], coverUrl: string | null, kind: "playlist" | "album" = "playlist") {
  if (spotifyMode.value && tracks.some((t) => t.spotifyId)) session.beginDirect(info, tracks, spotifyImport({ kind, coverUrl, tracks }));
  else session.begin(info, tracks);
}

async function importLink() {
  if (!canReadLinks.value || !link.value.trim()) return;
  fetching.value = true;
  inputError.value = null;
  try {
    const list = await readSpotify(link.value.trim());
    if (!list.tracks.length) throw new Error("That list has no tracks.");
    start(
      { name: list.name, owner: list.owner, coverUrl: list.coverUrl, total: list.total, truncated: list.truncated, notice: list.notice, source: list.source, url: list.url },
      list.tracks,
      list.coverUrl,
      list.kind,
    );
    saveName.value = list.name;
  } catch (err) {
    inputError.value = friendlyError(err);
  } finally {
    fetching.value = false;
  }
}

function importPasted() {
  inputError.value = null;
  const parsed = parseTrackList(pasted.value);
  if (!parsed.tracks.length) {
    inputError.value = "Couldn't find any tracks. Use one \"Artist - Title\" per line, or paste a CSV with a \"Track Name\" column.";
    return;
  }
  start(
    { name: "Imported playlist", owner: null, coverUrl: null, total: parsed.tracks.length, truncated: false, notice: null, source: "paste", url: null },
    parsed.tracks,
    null,
  );
  saveName.value = "Imported playlist";
  if (parsed.skipped) ui.notify(`Skipped ${parsed.skipped} ${parsed.skipped === 1 ? "line" : "lines"} without a title`);
}

async function readFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) pasted.value = await file.text();
}

function startOver(toPaste = false) {
  session.reset();
  inputError.value = null;
  if (toPaste) tab.value = "paste";
}

const sourceLabel = computed(() => {
  switch (session.list?.source) {
    case "embed": return "Read from Spotify's embed page";
    case "page": return "Read from the full Spotify page";
    case "paste": return "From a pasted list";
    default: return "";
  }
});

/** Where the import is, for the step diagram at the top. */
const stage = computed<ImportStage>(() => {
  if (!session.list) return fetching.value ? "reading" : "idle";
  if (!session.direct && (session.matching || session.counts.pending)) return "matching";
  return "review";
});
const flowDirect = computed(() => (session.list ? !!session.direct : spotifyMode.value));

const percent = computed(() => (session.rows.length ? Math.round((session.done / session.rows.length) * 100) : 0));

// Review table.
type Filter = "all" | "matched" | "check" | "none";
const filter = ref<Filter>("all");
const filters = computed(() => [
  { id: "all" as const, label: "All", n: session.rows.length },
  { id: "matched" as const, label: "Matched", n: session.counts.matched },
  { id: "check" as const, label: "Check", n: session.counts.check },
  { id: "none" as const, label: "No match", n: session.counts.none },
]);
const filtered = computed(() =>
  filter.value === "all"
    ? session.rows
    : session.rows.filter((r) => {
        const s = session.rowStatus(r);
        return filter.value === "none" ? s === "none" || s === "skipped" : s === filter.value;
      }),
);
// Long playlists render in steps so the page stays responsive.
const shown = ref(150);
watch(filter, () => (shown.value = 150));
const visible = computed(() => filtered.value.slice(0, shown.value));

const statusText: Record<RowStatus, string> = { matched: "Matched", check: "Check", none: "No match", pending: "…", skipped: "Skipped" };

const picker = ref<{ row: ImportRow; anchor: DOMRect } | null>(null);
function openPicker(row: ImportRow, e: MouseEvent) {
  const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  picker.value = picker.value?.row === row ? null : { row, anchor };
}
function choose(index: number) {
  if (!picker.value) return;
  session.choose(picker.value.row, picker.value.row.candidates[index]);
  picker.value = null;
}
function skip(skipped: boolean) {
  if (!picker.value) return;
  session.setSkipped(picker.value.row, skipped);
  picker.value = null;
}

function preview(row: ImportRow) {
  if (row.pick) player.playTrack(row.pick.track);
}

// Saving.
const saveName = ref(session.list?.name ?? "");
const makePublic = ref(false);
const saving = ref(false);
const canSaveRemote = computed(() => typeof api.value.createPlaylist === "function");
/** Saving to the account is possible once they sign in; the session waits here meanwhile. */
const remoteNeedsSignIn = computed(() => canSaveRemote.value && library.accounts && library.signedOut);
const leftOut = computed(() => (session.direct ? session.direct.skipped.length : session.rows.length - session.chosenTracks.length));
const canSave = computed(() => !!session.direct || (!session.matching && session.rows.length > 0));
/** Direct imports keep every artist for display; the saved track names the first. */
const directRows = computed(() => {
  const d = session.direct;
  if (!d) return [];
  const sources = session.sourceTracks.filter((t) => t.spotifyId);
  return d.tracks.map((track, i) => ({ track, artists: sources[i]?.artists ?? [] }));
});

async function saveLocal() {
  if (!session.chosenTracks.length) return;
  saving.value = true;
  await session.artworkSettled();
  saving.value = false;
  const tracks = session.chosenTracks;
  if (!tracks.length) return;
  const p = local.create(saveName.value || session.list?.name || "Imported playlist", tracks, session.list?.url ?? null);
  ui.notify(`Saved "${p.title}" with ${tracks.length} tracks`);
  void router.push(`/playlist/${p.id}`);
}

async function saveRemote() {
  const create = api.value.createPlaylist;
  if (!create || !session.chosenTracks.length) return;
  saving.value = true;
  try {
    await session.artworkSettled();
    const tracks = session.chosenTracks;
    const title = saveName.value || session.list?.name || "Imported playlist";
    const extras = session.list?.url ? { sourceUrl: session.list.url } : {};
    // Full tracks go along so Spotify ones can be stored as snapshots.
    const p = await create.call(api.value, title, tracks.map((t) => t.id), makePublic.value, { ...extras, tracks });
    ui.notify(`Saved "${p.title}" to your library`);
    void library.refresh();
    void router.push(`/playlist/${p.id}`);
  } catch (err) {
    if (isUnauthorized(err) && library.accounts) library.signIn("/import");
    else ui.notify(`Couldn't save the playlist: ${friendlyError(err)}`);
  } finally {
    saving.value = false;
  }
}

function openExternal(url: string) {
  if (window.nightjar) window.nightjar.window("open-external", url);
  else window.open(url, "_blank", "noopener");
}
</script>

<template>
  <div class="page import">
    <div class="head">
      <h1 class="page-title">Import from Spotify</h1>
      <button v-if="session.list" class="btn" @click="startOver()"><RotateCcw :size="15" /> Start over</button>
    </div>
    <ImportFlow class="import-flow" :stage="stage" :direct="flowDirect" :busy="fetching || session.matching" />

    <!-- Step 1: where the tracks come from -->
    <template v-if="!session.list">
      <p v-if="spotifyMode" class="muted intro">
        Paste a link to a public Spotify playlist or album. It's saved as a playlist that plays from Spotify, no matching needed.
      </p>
      <p v-else class="muted intro">
        Paste a link to a public Spotify playlist or album. Nightjar searches SoundCloud for each track and you check the matches.
      </p>
      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'link' }" @click="tab = 'link'"><Link2 :size="14" /> Spotify link</button>
        <button class="tab" :class="{ active: tab === 'paste' }" @click="tab = 'paste'"><ClipboardList :size="14" /> Paste a track list</button>
      </div>

      <section v-if="tab === 'link'" class="card">
        <div v-if="!canReadLinks" class="notice">
          <Monitor :size="18" />
          <div>
            <strong>Importing from a link needs the Nightjar desktop app.</strong>
            <p class="muted">A browser tab isn't allowed to read Spotify's pages. You can still paste a track list here.</p>
          </div>
        </div>
        <form class="link-form" @submit.prevent="importLink">
          <input
            v-model="link"
            :disabled="!canReadLinks || fetching"
            placeholder="https://open.spotify.com/playlist/…"
            spellcheck="false"
            aria-label="Spotify playlist or album link"
          />
          <button class="btn primary" type="submit" :disabled="!canReadLinks || fetching || !link.trim()">
            {{ fetching ? "Reading…" : "Import" }}
          </button>
        </form>
        <p v-if="fetching" class="faint small">
          {{ desktop ? "Playlists over 100 tracks take a few seconds while Nightjar reads the full page." : "Reading the playlist through the Nightjar server…" }}
        </p>
      </section>

      <section v-else class="card">
        <p class="muted small first">
          One track per line as <code>Artist - Title</code>, or a CSV with "Track Name" and "Artist Name(s)" columns, like the
          ones <a href="#" @click.prevent="openExternal('https://exportify.net')">Exportify</a> exports.
        </p>
        <textarea v-model="pasted" rows="10" spellcheck="false" placeholder="The Weeknd - Blinding Lights&#10;Daft Punk - One More Time" />
        <div class="row">
          <label class="btn file">Open a CSV file…<input type="file" accept=".csv,.txt,text/csv,text/plain" @change="readFile" /></label>
          <button class="btn primary" :disabled="!pasted.trim()" @click="importPasted">{{ spotifyMode ? "Import tracks" : "Match tracks" }}</button>
        </div>
      </section>

      <p v-if="inputError" class="error">{{ inputError }}</p>
    </template>

    <!-- Step 2: matching and review -->
    <template v-else>
      <header class="summary">
        <Artwork :src="session.list.coverUrl" :size="112" :radius="10" />
        <div class="summary-text">
          <h2>{{ session.list.name }}</h2>
          <div class="muted">
            <template v-if="session.list.owner">{{ session.list.owner }} · </template>
            {{ session.sourceTracks.length }} tracks<template v-if="session.list.truncated && session.list.total"> of {{ session.list.total }}</template>
          </div>
          <div class="faint small">{{ sourceLabel }}</div>
        </div>
      </header>

      <div v-if="session.list.truncated" class="notice warn">
        <TriangleAlert :size="18" />
        <div>
          <strong>Only part of this playlist was read.</strong>
          <p class="muted">{{ session.list.notice ?? "Spotify only gave the first 100 tracks." }}</p>
          <div class="actions">
            <button class="btn" @click="startOver(true)"><ClipboardList :size="14" /> Paste a track list instead</button>
            <button class="btn" @click="openExternal('https://exportify.net')"><ExternalLink :size="14" /> Open Exportify</button>
          </div>
        </div>
      </div>

      <!-- Spotify as the music source: the list is saved as Spotify tracks. -->
      <div v-if="session.direct" class="notice ready">
        <CircleCheck :size="18" />
        <div>
          <strong>{{ session.direct.tracks.length }} Spotify tracks ready to save.</strong>
          <p class="muted">
            They play from Spotify as they are, so there's nothing to match.
            <template v-if="session.artwork.running"> Loading covers, {{ session.artwork.done }} of {{ session.artwork.total }}…</template>
          </p>
          <p v-if="session.direct.skipped.length" class="muted">
            {{ session.direct.skipped.length }} {{ session.direct.skipped.length === 1 ? "track is a local file" : "tracks are local files" }}
            on the playlist owner's computer, which Spotify can't play. {{ session.direct.skipped.length === 1 ? "It is" : "They are" }} skipped.
          </p>
          <div class="actions">
            <button class="btn" @click="session.matchInstead()"><Search :size="14" /> Match on SoundCloud instead</button>
          </div>
        </div>
      </div>

      <div v-else class="notice warn">
        <TriangleAlert :size="18" />
        <div>
          <strong>Most songs from a typical Spotify playlist aren't on SoundCloud.</strong>
          <p class="muted">Check the matches before saving.</p>
        </div>
      </div>

      <div v-if="!session.direct && (session.matching || session.counts.pending)" class="progress">
        <div class="bar"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <span class="muted small">Searched {{ session.done }} of {{ session.rows.length }}</span>
        <button v-if="session.matching" class="btn" @click="session.cancel()">Stop</button>
        <button v-else class="btn" @click="session.match()">Resume</button>
      </div>

      <div v-if="canSave" class="save card">
        <input v-model="saveName" class="name" aria-label="Playlist name" placeholder="Playlist name" />
        <template v-if="remoteNeedsSignIn">
          <button class="btn primary" :disabled="!session.chosenTracks.length" @click="library.signIn('/import')">
            <LogIn :size="15" /> Sign in to save to my library
          </button>
        </template>
        <template v-else-if="canSaveRemote">
          <button class="btn primary" :disabled="!session.chosenTracks.length || saving" @click="saveRemote">
            <CloudUpload :size="15" /> {{ saving ? "Saving…" : "Save to my library" }}
          </button>
        </template>
        <button class="btn" :class="{ primary: !canSaveRemote }" :disabled="!session.chosenTracks.length || saving" @click="saveLocal">
          <Save :size="15" /> Save on this computer
        </button>
        <label v-if="canSaveRemote && !remoteNeedsSignIn" class="check"><input v-model="makePublic" type="checkbox" /> Public</label>
        <span v-if="session.direct" class="faint small grow">
          Saves {{ session.chosenTracks.length }} Spotify tracks.<template v-if="leftOut"> {{ leftOut }} skipped.</template>
        </span>
        <span v-else class="faint small grow">
          Saves {{ session.chosenTracks.length }} tracks<template v-if="session.counts.check">, {{ session.counts.check }} of them worth checking</template>.
          <template v-if="leftOut"> {{ leftOut }} without a match are left out.</template>
        </span>
      </div>

      <div v-if="session.direct" class="direct">
        <div v-for="(row, i) in directRows" :key="i" class="d">
          <span class="idx faint">{{ i + 1 }}</span>
          <Artwork :src="row.track.artworkUrl" :size="36" :radius="5" />
          <span class="sp">
            <span class="name ellipsis">{{ row.track.title }}</span>
            <span class="by ellipsis">{{ row.artists.join(", ") || row.track.user.username }}</span>
          </span>
          <span class="faint dur">{{ duration(row.track.duration) }}</span>
        </div>
        <div v-for="(t, i) in session.direct.skipped" :key="`skipped-${i}`" class="d skipped">
          <span class="idx faint">–</span>
          <Artwork :src="null" :size="36" :radius="5" />
          <span class="sp">
            <span class="name ellipsis">{{ t.title }}</span>
            <span class="by ellipsis">{{ t.artists.join(", ") || "Unknown artist" }}</span>
          </span>
          <span class="pill skipped">Local file, skipped</span>
        </div>
      </div>

      <template v-else>
      <div class="tabs filters">
        <button v-for="f in filters" :key="f.id" class="tab" :class="{ active: filter === f.id }" @click="filter = f.id">
          {{ f.label }} <span class="count">{{ f.n }}</span>
        </button>
      </div>

      <div class="review">
        <div class="r head">
          <span class="idx">#</span>
          <span>Spotify</span>
          <span>SoundCloud match</span>
          <span>Confidence</span>
          <span />
        </div>
        <div v-for="row in visible" :key="row.key" class="r" :class="session.rowStatus(row)">
          <span class="idx faint">{{ row.key + 1 }}</span>
          <span class="sp">
            <span class="name ellipsis">{{ row.source.title }}</span>
            <span class="by ellipsis">
              {{ row.source.artists.join(", ") || "Unknown artist" }}<template v-if="row.source.durationMs"> · {{ duration(row.source.durationMs) }}</template>
            </span>
          </span>
          <span class="sc" :title="row.pick ? 'Double-click to preview' : undefined" @dblclick="preview(row)">
            <template v-if="row.pick">
              <Artwork :src="row.pick.track.artworkUrl" :size="36" :radius="5" />
              <span class="text">
                <span class="name-line">
                  <span class="name ellipsis">{{ row.pick.track.title }}</span>
                  <span v-if="row.pick.track.preview" class="preview-pill" title="Only a 30-second preview can be played">Preview</span>
                </span>
                <span class="by ellipsis">{{ row.pick.track.user.username }} · {{ duration(row.pick.track.duration) }}</span>
              </span>
            </template>
            <span v-else-if="row.state === 'pending' || row.state === 'searching'" class="skeleton line" />
            <span v-else-if="row.state === 'error'" class="faint small ellipsis" :title="row.error ?? ''">Search failed</span>
            <span v-else class="faint small">{{ row.candidates.length ? "Nothing close enough" : "No results" }}</span>
          </span>
          <span>
            <span v-if="session.rowStatus(row) !== 'pending'" class="pill" :class="session.rowStatus(row)">
              {{ statusText[session.rowStatus(row)] }}
              <span v-if="row.pick && !row.skipped && !row.manual" class="score">{{ Math.round(row.pick.score * 100) }}%</span>
            </span>
          </span>
          <span>
            <button
              class="icon-btn"
              title="Other matches, search, or skip"
              :disabled="row.state === 'pending'"
              @click="openPicker(row, $event)"
            >
              <ChevronDown :size="16" />
            </button>
          </span>
        </div>
        <div v-if="!filtered.length" class="empty">Nothing here.</div>
        <div v-if="filtered.length > shown" class="more">
          <button class="btn" @click="shown += 300">Show more ({{ filtered.length - shown }} left)</button>
        </div>
      </div>

      <MatchPicker
        v-if="picker"
        :key="picker.row.key"
        :row="picker.row"
        :anchor="picker.anchor"
        @close="picker = null"
        @search="(q) => picker && session.research(picker.row, q)"
        @choose="choose"
        @skip="skip"
      />
      </template>
    </template>
  </div>
</template>

<style scoped>
.import { max-width: 1080px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.head .page-title { margin: 0; }
.import-flow { margin: 14px 0 18px; }
.intro { max-width: 640px; margin: 0 0 20px; }
.tabs .tab { display: inline-flex; align-items: center; gap: 6px; }
.card { padding: 16px; border-radius: var(--radius); background: var(--hover); margin-bottom: 14px; }
.link-form { display: flex; gap: 8px; }
.link-form input { flex: 1; min-width: 0; height: 34px; }
.small { font-size: 12px; }
.first { margin: 0 0 10px; }
.card a, .notice a { color: var(--accent); }
code { font-size: 12px; padding: 1px 5px; border-radius: 5px; background: var(--active); }
textarea { width: 100%; resize: vertical; font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
.row { display: flex; align-items: center; gap: 8px; margin-top: 10px; justify-content: flex-end; }
.file { position: relative; overflow: hidden; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.error { color: #ff6b6b; user-select: text; }

.notice { display: flex; gap: 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--active); margin-bottom: 14px; }
.notice svg { flex: none; margin-top: 1px; color: var(--text-2); }
.notice p { margin: 4px 0 0; }
.notice .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.notice.warn { background: color-mix(in srgb, #ffb340 14%, transparent); }
.notice.warn svg { color: #ffb340; }
.notice.ready { background: color-mix(in srgb, #30d158 12%, transparent); }
.notice.ready svg { color: #30d158; }

.direct { display: flex; flex-direction: column; }
.d { display: grid; grid-template-columns: 40px 36px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 48px; padding: 0 8px; border-radius: 8px; }
.d:hover { background: var(--hover); }
.d.skipped .sp { opacity: 0.55; }
.dur { font-variant-numeric: tabular-nums; font-size: 12px; }

.summary { display: flex; align-items: center; gap: 18px; margin: 14px 0 18px; }
.summary-text { min-width: 0; }
.summary h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; overflow-wrap: anywhere; }

.progress { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: var(--active); overflow: hidden; }
.fill { height: 100%; background: var(--accent); transition: width 0.2s ease; }

.save { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.save .name { width: 260px; height: 32px; }
.check { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
.check input { accent-color: var(--accent); }
.grow { flex: 1; min-width: 200px; }

.filters { margin: 4px 0 10px; }
.count { margin-left: 4px; opacity: 0.6; font-variant-numeric: tabular-nums; }

.r {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1.25fr) 116px 40px;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 0 8px;
  border-radius: 8px;
}
.r:not(.head):hover { background: var(--hover); }
.r.head { min-height: 32px; font-size: 11.5px; color: var(--text-3); border-bottom: 1px solid var(--border); border-radius: 0; margin-bottom: 4px; }
.idx { text-align: right; font-variant-numeric: tabular-nums; }
.sp, .text { display: flex; flex-direction: column; min-width: 0; }
.sc { display: flex; align-items: center; gap: 10px; min-width: 0; }
.name { font-weight: 600; }
.name-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.by { font-size: 12px; color: var(--text-2); }
.r.skipped .sc, .r.none .sc { opacity: 0.55; }
.line { width: 70%; height: 30px; }
.pill { display: inline-block; padding: 3px 8px; border-radius: 10px; font-size: 11.5px; font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pill.matched { background: color-mix(in srgb, #30d158 20%, transparent); color: #30d158; }
.pill.check { background: color-mix(in srgb, #ffb340 22%, transparent); color: #ffb340; }
.pill.none { background: color-mix(in srgb, #ff6b6b 18%, transparent); color: #ff6b6b; }
.pill .score { margin-left: 4px; opacity: 0.85; }
.pill.skipped { background: var(--hover); color: var(--text-3); }
.more { display: flex; justify-content: center; padding: 16px; }
:root[data-theme="light"] .pill.matched { color: #1a9c42; }
:root[data-theme="light"] .pill.check { color: #b36b00; }
</style>
