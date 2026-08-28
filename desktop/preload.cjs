const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("rappZooDesktop", Object.freeze({
  status: invoke("desktop:status"),
  copilotStatus: invoke("copilot:status"),
  askCopilot: invoke("copilot:ask"),
  cancelCopilot: invoke("copilot:cancel"),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:state", listener);
    return () => ipcRenderer.removeListener("desktop:state", listener);
  },
  onCopilotChunk(callback) {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("copilot:chunk", listener);
    return () => ipcRenderer.removeListener("copilot:chunk", listener);
  },
}));
