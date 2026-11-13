const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "toggle", "next", "previous", "like", "shuffle", "repeat",
  "navigate", "back", "forward", "focus-search", "toggle-drawer", "immersive",
];

contextBridge.exposeInMainWorld("stratus", {
  platform: process.platform,
  reportPlayback: (state) => ipcRenderer.send("playback", state),
  window: (action, value) => ipcRenderer.send("window", action, value),
  onCommand: (handler) => {
    const listener = (_event, command, payload) => {
      if (commands.includes(command)) handler(command, payload);
    };
    ipcRenderer.on("command", listener);
    return () => ipcRenderer.removeListener("command", listener);
  },
});
