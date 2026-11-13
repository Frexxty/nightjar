const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "toggle", "next", "previous", "like", "shuffle", "repeat",
  "navigate", "back", "forward", "focus-search", "toggle-drawer", "immersive",
  "check-updates",
];

// The main process wraps replies as { ok, result | error } so errors arrive as
// plain messages instead of "Error invoking remote method ...".
async function unwrap(promise) {
  const reply = await promise;
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

contextBridge.exposeInMainWorld("stratus", {
  platform: process.platform,
  reportPlayback: (state) => ipcRenderer.send("playback", state),
  window: (action, value) => ipcRenderer.send("window", action, value),
  spotify: {
    // The main process wraps results so errors arrive as plain messages
    // instead of "Error invoking remote method ...".
    fetchPlaylist: async (url) => {
      const reply = await ipcRenderer.invoke("spotify:fetch", String(url));
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
  },
  spotifyAuth: {
    authorize: (url) => unwrap(ipcRenderer.invoke("spotify-auth:authorize", String(url))),
    cancel: () => unwrap(ipcRenderer.invoke("spotify-auth:cancel")),
    getTokens: () => unwrap(ipcRenderer.invoke("spotify-auth:get-tokens")),
    setTokens: (tokens) => unwrap(ipcRenderer.invoke("spotify-auth:set-tokens", tokens)),
    clearTokens: () => unwrap(ipcRenderer.invoke("spotify-auth:clear-tokens")),
  },
  onCommand: (handler) => {
    const listener = (_event, command, payload) => {
      if (commands.includes(command)) handler(command, payload);
    };
    ipcRenderer.on("command", listener);
    return () => ipcRenderer.removeListener("command", listener);
  },
  updates: {
    getInfo: () => ipcRenderer.invoke("update:get-info"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    skip: (version) => ipcRenderer.invoke("update:skip", version),
    setBeta: (beta) => ipcRenderer.invoke("update:set-beta", beta),
    onState: (handler) => {
      const listener = (_event, state) => handler(state);
      ipcRenderer.on("update:state", listener);
      return () => ipcRenderer.removeListener("update:state", listener);
    },
  },
});
