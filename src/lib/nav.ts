// Navigation for the phone layout: the tab bar and the Library page. The
// desktop sidebar lists the same places.
import { computed } from "vue";
import { Compass, Disc3, Heart, History, Home, Import, Library, ListMusic, Radio, Search, Users } from "lucide-vue-next";
import { useLibrary } from "@/stores/library";
import { useLocalPlaylists } from "@/stores/localPlaylists";

export const tabs = [
  { to: "/", label: "Home", icon: Home, match: (path: string) => path === "/" },
  { to: "/stream", label: "Stream", icon: Radio, match: (path: string) => path === "/stream" },
  { to: "/browse", label: "Browse", icon: Compass, match: (path: string) => path.startsWith("/browse") },
  { to: "/search", label: "Search", icon: Search, match: (path: string) => path === "/search" },
  { to: "/library", label: "Library", icon: Library, match: (path: string) => path.startsWith("/library") || path === "/import" },
];

export const libraryLinks = [
  { to: "/library/likes", label: "Likes", icon: Heart },
  { to: "/library/playlists", label: "Playlists", icon: ListMusic },
  { to: "/library/albums", label: "Albums", icon: Disc3 },
  { to: "/library/following", label: "Following", icon: Users },
  { to: "/library/history", label: "History", icon: History },
  { to: "/import", label: "Import from Spotify", icon: Import },
];

/** Playlists on this device first, then the account's, like the sidebar's "Your playlists". */
export function useYourPlaylists() {
  const library = useLibrary();
  const local = useLocalPlaylists();
  return computed(() => [...local.playlists.map(local.asPlaylist), ...library.playlists]);
}
