// 열톡 화면이 「PC 프로그램 안에서 열렸다」는 것만 알 수 있게(설치 안내·알림 켜기 안내를 숨기는 용도)
const { contextBridge } = require("electron")
contextBridge.exposeInMainWorld("yeoltalkDesktop", { version: "1.0.0" })
