const { contextBridge } = require("electron")
// 홈페이지에는 OS 권한·쿠키·파일 API를 노출하지 않는다.
contextBridge.exposeInMainWorld("yeoltalkDesktop", Object.freeze({ version: "0.1.0", product: "passion-slack" }))
