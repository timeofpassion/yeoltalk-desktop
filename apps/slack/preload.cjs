const { contextBridge } = require("electron")
// 홈페이지에는 OS 권한·쿠키·파일 API를 노출하지 않는다.
const version = process.argv.find(arg => arg.startsWith("--app-version="))?.slice("--app-version=".length) || "unknown"
contextBridge.exposeInMainWorld("yeoltalkDesktop", Object.freeze({ version, product: "passion-slack" }))
