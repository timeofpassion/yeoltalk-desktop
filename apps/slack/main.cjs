const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, dialog, session } = require("electron")
const path = require("node:path")
const fs = require("node:fs")
const { BASE, START, PARTITION, classifyUrl, returnAfterLogin, roomLink, notificationCandidates, alertHours } = require("./rules.cjs")
const { connectUpdater } = require("./updater.cjs")

app.setName("열정 슬랙")
// 기존 열톡/웹브라우저와 분리된 PC별 프로필. 비밀번호를 따로 저장하지 않는다.
app.setPath("userData", path.join(app.getPath("appData"), "PassionSlack"))
app.setAppUserModelId("com.timeofpassion.slack")
const iconPath = path.join(__dirname, "assets", "icon.png")
let mainWindow, talkWindow, tray, updates, previous, polling = false, quitting = false
function safeLog(event) {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "app.log"), `${new Date().toISOString()} ${event}\n`) } catch {}
}
function show(win, url) {
  if (!win || win.isDestroyed()) return
  if (url) win.loadURL(url).catch(() => safeLog("navigation-failed"))
  if (win.isMinimized()) win.restore()
  win.show(); win.focus()
}
function openExternal(url) {
  if (classifyUrl(url) === "external") shell.openExternal(url).catch(() => safeLog("external-open-failed"))
}
function makeWindow(isTalk = false) {
  const win = new BrowserWindow({
    width: isTalk ? 460 : 1360, height: isTalk ? 760 : 900, minWidth: isTalk ? 380 : 900, minHeight: 600,
    title: isTalk ? "열톡 · 열정 슬랙" : "열정 슬랙", icon: iconPath, backgroundColor: "#fff9f8", show: false,
    webPreferences: { partition: PARTITION, preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  win.once("ready-to-show", () => show(win))
  win.on("page-title-updated", e => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyUrl(url) === "internal") {
      // 결재·문서·첨부도 로그인 세션은 공유하며 별도 창으로 연다.
      return { action: "allow", overrideBrowserWindowOptions: { width: 1100, height: 800, icon: iconPath,
        webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true } } }
    }
    openExternal(url)
    return { action: "deny" }
  })
  const navigation = (e, url) => {
    if (classifyUrl(url) !== "internal") { e.preventDefault(); openExternal(url) }
  }
  win.webContents.on("will-navigate", navigation)
  win.webContents.on("will-redirect", navigation)
  win.webContents.on("did-create-window", child => {
    child.webContents.on("will-navigate", navigation)
    child.webContents.on("will-redirect", navigation)
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  })
  win.webContents.on("will-attach-webview", e => e.preventDefault())
  const restoreHome = (_e, url) => {
    const target = returnAfterLogin(url, isTalk)
    if (target) win.loadURL(target).catch(() => safeLog("login-return-failed"))
  }
  win.webContents.on("did-navigate", restoreHome)
  win.webContents.on("did-navigate-in-page", restoreHome)
  win.webContents.on("will-prevent-unload", event => {
    const answer = dialog.showMessageBoxSync(win, { type: "question", buttons: ["계속 작성", "이동"], defaultId: 0, cancelId: 0,
      message: "작성 중인 내용을 확인해 주세요", detail: "저장하지 않은 내용이 있을 수 있습니다." })
    if (answer === 1) event.preventDefault()
  })
  win.on("close", e => { if (!quitting) { e.preventDefault(); win.hide() } })
  win.on("focus", () => win.flashFrame(false))
  win.webContents.on("did-fail-load", (_e, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      safeLog("page-load-failed")
      win.loadFile(path.join(__dirname, "assets", "offline.html")).catch(() => safeLog("offline-page-failed"))
    }
  })
  win.loadURL(isTalk ? `${BASE}/talk` : START).catch(() => safeLog("page-load-failed"))
  return win
}
function showTalk() {
  if (!talkWindow || talkWindow.isDestroyed()) talkWindow = makeWindow(true)
  else show(talkWindow)
}
function checkMenu() {
  if (updates?.state().phase === "ready") {
    dialog.showMessageBox(mainWindow, { type: "info", buttons: ["나중에", "재시작해 적용"], defaultId: 0, cancelId: 0,
      message: "새 버전이 준비됐습니다", detail: "작성 중인 내용을 저장한 뒤 재시작해 주세요." }).then(r => { if (r.response === 1) { quitting = true; updates.install() } })
  } else updates?.check()
}
function refreshMenus() {
  const auto = app.getLoginItemSettings().openAtLogin
  const items = [
    { label: "내부 슬랙 열기", click: () => show(mainWindow) },
    { label: "열톡 열기", click: showTalk }, { type: "separator" },
    { label: updates?.state().label || "업데이트 확인", click: checkMenu },
    { label: "PC 시작 시 자동 실행", type: "checkbox", checked: auto,
      click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenus() } },
    { label: "프로그램 정보", click: () => dialog.showMessageBox(mainWindow, { message: `열정 슬랙 ${app.getVersion()}`,
      detail: "내부 슬랙과 같은 계정·대화·파일을 사용합니다. 창을 닫아도 알림은 유지됩니다. 완전히 종료하려면 메뉴의 종료를 사용하세요." }) },
    { type: "separator" }, { label: "종료", click: () => { quitting = true; app.quit() } },
  ]
  tray?.setContextMenu(Menu.buildFromTemplate(items))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "열정 슬랙", submenu: items },
    { label: "편집", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "보기", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
  ]))
}
async function poll() {
  if (polling || !mainWindow || mainWindow.isDestroyed()) return
  polling = true
  try {
    const response = await mainWindow.webContents.session.fetch(`${BASE}/api/chat/inbox`, { credentials: "include" })
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) { previous = null; return }
    const rooms = await response.json()
    if (!Array.isArray(rooms)) return
    const unread = rooms.reduce((n, r) => n + (r.hidden || r.muted ? 0 : (r.slackUnread || r.unread || 0)), 0)
    app.setBadgeCount(unread)
    tray?.setToolTip(unread ? `열정 슬랙 · 안 읽음 ${unread}` : "열정 슬랙")
    const candidates = notificationCandidates(previous, rooms)
    const focused = [mainWindow, talkWindow].some(w => w && !w.isDestroyed() && w.isFocused())
    if (candidates.length && !focused && alertHours() && Notification.isSupported()) {
      const top = candidates.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0]
      const notice = new Notification({ title: `열정 슬랙 · ${top.name || "새 메시지"}`, body: String(top.lastText || "새 메시지가 있습니다").slice(0, 160), icon: iconPath })
      notice.on("click", () => show(mainWindow, roomLink(top.id)))
      notice.show(); mainWindow.flashFrame(true)
    }
    previous = new Map(rooms.map(r => [r.id, { lastAt: r.lastAt, mentioned: r.mentioned || 0 }]))
  } catch { safeLog("inbox-check-failed") }
  finally { polling = false }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", () => show(mainWindow))
  app.on("before-quit", () => { quitting = true })
  app.on("window-all-closed", event => event.preventDefault())
  app.whenReady().then(() => {
    session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "notifications"))
    mainWindow = makeWindow()
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
    tray.on("click", () => show(mainWindow))
    if (app.isPackaged) {
      const { autoUpdater } = require("electron-updater")
      updates = connectUpdater(autoUpdater, { changed: refreshMenus, log: safeLog })
      setTimeout(() => updates.check(), 15000)
      setInterval(() => updates.check(), 60 * 60 * 1000).unref()
    }
    refreshMenus()
    setInterval(poll, 15000).unref()
    app.on("activate", () => show(mainWindow))
  })
}
