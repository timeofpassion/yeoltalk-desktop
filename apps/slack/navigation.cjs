const { START, classifyUrl, returnAfterLogin } = require("./rules.cjs")

function connectNavigation(win, { openExternal, show, safeLog }) {
  const restoreHome = (_event, url) => {
    const target = returnAfterLogin(url)
    if (target) win.loadURL(target).catch(() => safeLog("login-return-failed"))
    else if (classifyUrl(url) !== "internal" && !url.startsWith("file:")) {
      openExternal(url)
      show(win, START)
    }
  }
  win.webContents.on("did-navigate", restoreHome)
  // 업무 iframe의 pushState는 상위 슬랙 창을 다시 열면 안 된다.
  win.webContents.on("did-navigate-in-page", (event, url, isMainFrame) => {
    if (isMainFrame) restoreHome(event, url)
  })
}
module.exports = { connectNavigation }
