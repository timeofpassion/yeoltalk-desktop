const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("workspace", Object.freeze({
  open: key => { if (["chat", "tasks", "approvals", "reload", "close-tasks", "close-approvals"].includes(key)) ipcRenderer.send("workspace:open", key) },
  state: callback => ipcRenderer.on("workspace:state", (_event, state) => callback(state)),
  error: callback => ipcRenderer.on("workspace:error", (_event, key) => callback(key)),
}))
