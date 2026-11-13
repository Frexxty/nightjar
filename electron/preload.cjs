const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "toggle", "next", "previous", "like", "shuffle", "repeat",
  "navigate", "back", "forward", "focus-search", "toggle-drawer", "immersive",
  "check-updates",
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
