const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("rappZooDesktop", Object.freeze({
  status: invoke("desktop:status"),
  brainstemStatus: invoke("brainstem:status"),
  askBrainstem: invoke("brainstem:chat"),
  cancelBrainstem: invoke("brainstem:cancel"),
  generateHologram: invoke("hologram:generate"),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:state", listener);
    return () => ipcRenderer.removeListener("desktop:state", listener);
  },
}));
