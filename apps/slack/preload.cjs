const { contextBridge, webFrame, ipcRenderer } = require("electron")
// 서버의 공통 레이아웃 표시 영역만 숨긴다. 로그인·채팅 본문·권한 판정에는 손대지 않는다.
// preload에서 넣으므로 첫 화면과 새로고침, SPA 이동에도 공통 메뉴가 나타나지 않는다.
webFrame.insertCSS(`
  [data-chrome] { display: none !important; }
  main[data-main] { margin-left: 0 !important; padding-bottom: 0 !important; }
`)
// 홈페이지에는 OS 권한·쿠키·파일 API를 노출하지 않는다.
contextBridge.exposeInMainWorld("yeoltalkDesktop", Object.freeze({ version: "0.2.0", product: "passion-slack" }))

// Next.js가 대화 화면을 교체하기 전에 다른 업무 모듈 링크만 앱 탭으로 넘긴다.
// 원격 페이지에 범용 IPC/OS API는 노출하지 않는다.
if (typeof document !== "undefined") document.addEventListener("click", event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const link = event.target?.closest?.("a[href]")
  if (!link || link.hasAttribute("download")) return
  const url = new URL(link.href, location.href)
  const base = "https://intranet.timeofpassion.com"
  const key = pathname => /^\/approvals(\/|$)/.test(pathname) ? "approvals" : /^\/tasks(\/|$)/.test(pathname) ? "tasks" : "chat"
  if (location.origin !== base || url.origin !== base || key(url.pathname) === key(location.pathname)) return
  if (!/^\/(approvals|tasks|slack|talk)(\/|$)/.test(url.pathname)) return
  event.preventDefault(); event.stopImmediatePropagation()
  ipcRenderer.send("workspace:navigate", url.href)
}, true)
