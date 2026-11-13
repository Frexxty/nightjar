const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "toggle", "next", "previous", "like", "shuffle", "repeat",
  "navigate", "back", "forward", "focus-search", "toggle-drawer", "immersive",
];

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
  onCommand: (handler) => {
    const listener = (_event, command, payload) => {
      if (commands.includes(command)) handler(command, payload);
    };
    ipcRenderer.on("command", listener);
    return () => ipcRenderer.removeListener("command", listener);
  },
});
