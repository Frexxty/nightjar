import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("./views/HomeView.vue") },
    { path: "/stream", name: "stream", component: () => import("./views/StreamView.vue") },
    { path: "/search", name: "search", component: () => import("./views/SearchView.vue") },
    { path: "/track/:id", name: "track", component: () => import("./views/TrackView.vue"), props: true },
    { path: "/playlist/:id", name: "playlist", component: () => import("./views/PlaylistView.vue"), props: true },
    { path: "/user/:id", name: "user", component: () => import("./views/UserView.vue"), props: true },
    { path: "/library", name: "library", component: () => import("./views/LibraryView.vue") },
    { path: "/library/likes", name: "likes", component: () => import("./views/LikesView.vue") },
    { path: "/library/playlists", name: "playlists", component: () => import("./views/PlaylistsView.vue"), props: { albums: false } },
    { path: "/library/albums", name: "albums", component: () => import("./views/PlaylistsView.vue"), props: { albums: true } },
    { path: "/library/following", name: "following", component: () => import("./views/FollowingView.vue") },
    { path: "/library/history", name: "history", component: () => import("./views/HistoryView.vue") },
    { path: "/import", name: "import", component: () => import("./views/ImportView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/account", name: "account", component: () => import("./views/AccountView.vue") },
  ],
});
