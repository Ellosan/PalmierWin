const { contextBridge, ipcRenderer, webUtils } = require("electron");
const call = async (channel, ...args) => {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
const event = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld("palmier", {
  desktop: true,
  state: () => call("get-state"),
  edit: (a, b) => call("edit", a, b),
  transaction: (c) => call("transaction", c),
  undo: () => call("undo"),
  redo: () => call("redo"),
  newProject: () => call("new"),
  loadDemo: () => call("demo"),
  saveProject: (saveAs) => call("save", saveAs),
  openProject: () => call("open"),
  importMedia: () => call("import"),
  importDropped: (files) =>
    call(
      "import",
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  mediaUrl: (id) => `palmier-media://asset/${encodeURIComponent(id)}`,
  exportVideo: (codec) => call("choose-export", codec),
  cancelExport: () => call("cancel-export"),
  showExport: () => call("show-export"),
  settings: () => call("get-settings"),
  saveSettings: (value) => call("save-settings", value),
  chat: (message) => call("agent-chat", message),
  window: (action) => call("window", action),
  onState: (fn) => event("state", fn),
  onExport: (fn) => event("export-progress", fn),
  onNotice: (fn) => event("notice", fn),
});
