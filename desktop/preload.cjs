const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("rappZooDesktop", Object.freeze({
  status: invoke("desktop:status"),
  brainstemStatus: invoke("brainstem:status"),
  askBrainstem: invoke("brainstem:chat"),
  cancelBrainstem: invoke("brainstem:cancel"),
  listProviderProfiles: invoke("providers:list"),
  providerStatus: invoke("providers:status"),
  saveProviderProfile: invoke("providers:save"),
  deleteProviderProfile: invoke("providers:delete"),
  testProviderProfile: invoke("providers:test"),
  setActiveProviderProfile: invoke("providers:set-active"),
  breathingStatus: invoke("breathing:status"),
  startBreathing: invoke("breathing:start"),
  pauseBreathing: invoke("breathing:pause"),
  stageHologramOutput: invoke("hologram:stage"),
  commitHologramOutput: invoke("hologram:commit"),
  generateHologram: invoke("hologram:generate"),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:state", listener);
    return () => ipcRenderer.removeListener("desktop:state", listener);
  },
  onBreathingState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("breathing:state", listener);
    return () => ipcRenderer.removeListener("breathing:state", listener);
  },
}));
