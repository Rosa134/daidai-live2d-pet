const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("daidaiPet", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  setConfig: (patch) => ipcRenderer.invoke("app:set-config", patch),
  importModelDirectory: () => ipcRenderer.invoke("model:import-directory"),
  selectModel: (modelId) => ipcRenderer.invoke("model:select", modelId),
  openModelsDirectory: () => ipcRenderer.invoke("model:open-directory"),
  openSoundsDirectory: () => ipcRenderer.invoke("model:open-sounds-directory"),
  showPet: () => ipcRenderer.invoke("pet:show"),
  hidePet: () => ipcRenderer.invoke("pet:hide"),
  onUpdate: (callback) => subscribe("app:update", callback),
  onCursorPosition: (callback) => subscribe("pet:cursor-position", callback),
  onDragState: (callback) => subscribe("pet:drag-state", callback)
});
