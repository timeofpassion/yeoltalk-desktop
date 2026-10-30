const { contextBridge, webFrame } = require("electron")
// 서버의 공통 레이아웃 표시 영역만 숨긴다. 로그인·채팅 본문·권한 판정에는 손대지 않는다.
// preload에서 넣으므로 첫 화면과 새로고침, SPA 이동에도 공통 메뉴가 나타나지 않는다.
webFrame.insertCSS(`
  [data-chrome] { display: none !important; }
  main[data-main] { margin-left: 0 !important; padding-bottom: 0 !important; }
`)
// 홈페이지에는 OS 권한·쿠키·파일 API를 노출하지 않는다.
contextBridge.exposeInMainWorld("yeoltalkDesktop", Object.freeze({ version: "0.1.3", product: "passion-slack" }))
