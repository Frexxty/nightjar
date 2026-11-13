import { useRouter } from "vue-router";
import type { Playlist, Track } from "@/api";
import { useLibrary } from "@/stores/library";
import { usePlayer } from "@/stores/player";
import { useUi, type MenuItem } from "@/stores/ui";
import { catalogueFor } from "@/spotify/catalogue";
import { isSpotifyId } from "@/spotify/ids";

function copy(text: string | null | undefined, ui: ReturnType<typeof useUi>) {
  if (!text) return;
  void navigator.clipboard.writeText(text).then(() => ui.notify("Link copied"));
}

/** Context menu builders shared by rows, cards and pages. */
export function useMenus() {
  const router = useRouter();
  const player = usePlayer();
  const library = useLibrary();
  const ui = useUi();

  function track(t: Track, extra: MenuItem[] = []): MenuItem[] {
    const items: MenuItem[] = [
      { label: "Play next", action: () => player.playNext([t]) },
      { label: "Add to queue", action: () => player.addToQueue([t]) },
      { label: library.isLiked(t) ? "Unlike" : "Like", action: () => library.toggleLike(t) },
      ...(isSpotifyId(t.id) ? [] : [{ label: library.isReposted(t) ? "Remove repost" : "Repost", action: () => library.toggleRepost(t) }]),
      { label: "Start station", action: () => startStation(t) },
      { label: "Go to track", action: () => router.push(`/track/${t.id}`) },
      { label: `Go to ${t.user.username}`, action: () => router.push(`/user/${t.user.id}`) },
      ...extra,
    ];
    if (t.permalinkUrl) items.push({ label: "Copy link", action: () => copy(t.permalinkUrl, ui) });
    return items;
  }

  function playlist(p: Playlist): MenuItem[] {
    const load = async () => (p.tracks?.length ? p.tracks : (await catalogueFor(p.id).playlist(p.id)).tracks ?? []);
    const items: MenuItem[] = [
      { label: "Play", action: async () => player.playTracks(await load(), 0, `playlist:${p.id}`) },
      { label: "Play next", action: async () => player.playNext(await load()) },
      { label: "Add to queue", action: async () => player.addToQueue(await load()) },
      { label: `Open ${p.isAlbum ? "album" : "playlist"}`, action: () => router.push(`/playlist/${p.id}`) },
      { label: `Go to ${p.user.username}`, action: () => router.push(`/user/${p.user.id}`) },
    ];
    if (p.permalinkUrl) items.push({ label: "Copy link", action: () => copy(p.permalinkUrl, ui) });
    return items;
  }

  async function startStation(t: Track) {
    const related = await catalogueFor(t.id).relatedTracks(t.id).catch(() => []);
    player.playTracks([t, ...related], 0, `station:${t.id}`);
    ui.notify(`Station based on "${t.title}"`);
  }

  return { track, playlist, startStation };
}
