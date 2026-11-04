const { app, BaseWindow, Tray, Menu, Notification, nativeImage, shell, dialog, session, WebContentsView, ipcMain } = require("electron")
const path = require("node:path")
const fs = require("node:fs")
const { BASE, START, PARTITION, classifyUrl, returnAfterLogin, roomLink, unreadFor, roomTitle, notificationCandidates, alertHours, requestDecision } = require("./rules.cjs")
const { connectUpdater } = require("./updater.cjs")
const { connectWorkspace } = require("./workspace.cjs")

app.setName("열정 인트라넷")
// 기존 열톡/웹브라우저와 분리된 PC별 프로필. 비밀번호를 따로 저장하지 않는다.
app.setPath("userData", path.join(app.getPath("appData"), "PassionSlack"))
app.setAppUserModelId("com.timeofpassion.slack")
const iconPath = path.join(__dirname, "assets", "icon.png")
let mainWindow, workspace, tray, updates, previous, polling = false, quitting = false
let menuSignature = "", pollQueued = false, sessionEpoch = 0
let unreadRooms = [], names = new Map(), namesFetchedAt = 0
function safeLog(event) {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "app.log"), `${new Date().toISOString()} ${event}\n`) } catch {}
}
function show(win, url) {
  if (!win || win.isDestroyed()) return
  if (url) {
    if (workspace) workspace.openUrl(url)
    else win.loadURL(returnAfterLogin(url) || url).catch(() => safeLog("navigation-failed"))
  }
  if (win.isMinimized()) win.restore()
  win.show(); win.focus()
}
function openExternal(url) {
  if (classifyUrl(url) === "external") shell.openExternal(url).catch(() => safeLog("external-open-failed"))
}
function makeWindow() {
  const win = new BaseWindow({
    width: 1360, height: 900, minWidth: 360, minHeight: 600,
    title: "열정 인트라넷", icon: iconPath, backgroundColor: "#ffffff", show: false,
  })
  workspace = connectWorkspace(win, { WebContentsView, ipcMain, dialog, openExternal, safeLog, loaded: poll })
  win.webContents.once("did-finish-load", () => show(win))
  win.on("close", e => { if (!quitting) { e.preventDefault(); win.hide() } })
  win.on("focus", () => { win.flashFrame(false); poll() })
  return win
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
    { label: "열정 인트라넷 열기", click: () => show(mainWindow) },
    { label: `안 읽은 대화 (${unreadRooms.reduce((n, r) => n + unreadFor(r), 0)}개 메시지)`, enabled: unreadRooms.length > 0,
      submenu: unreadRooms.map(r => ({ label: `${roomTitle(r, names).replaceAll("&", "&&").replace(/[\r\n]/g, " ")} · ${unreadFor(r)}`, click: () => show(mainWindow, roomLink(r.id)) })) },
    { type: "separator" },
    { label: updates?.state().label || "업데이트 확인", click: checkMenu },
    { label: "PC 시작 시 자동 실행", type: "checkbox", checked: auto,
      click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenus() } },
    { label: "프로그램 정보", click: () => dialog.showMessageBox(mainWindow, { message: `열정 인트라넷 ${app.getVersion()}`,
      detail: "내부 슬랙과 같은 계정·대화·파일을 사용합니다. 창을 닫아도 알림은 유지됩니다. 완전히 종료하려면 메뉴의 종료를 사용하세요." }) },
    { type: "separator" }, { label: "종료", click: () => { quitting = true; app.quit() } },
  ]
  tray?.setContextMenu(Menu.buildFromTemplate(items))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "열정 인트라넷", submenu: items },
    { label: "편집", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "보기", submenu: [{ label: "현재 화면 새로고침", accelerator: "CmdOrCtrl+R", click: () => workspace?.contents()?.reload() }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
  ]))
}
function updateUnread(rooms) {
  unreadRooms = rooms.filter(r => unreadFor(r) > 0).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
  const unread = unreadRooms.reduce((n, r) => n + unreadFor(r), 0)
  const signature = JSON.stringify(unreadRooms.map(r => [r.id, unreadFor(r), roomTitle(r, names)]))
  if (signature === menuSignature) return
  menuSignature = signature
  app.setBadgeCount(unread)
  const key = unread > 9 ? "9p" : String(unread)
  mainWindow?.setOverlayIcon(unread > 0 ? nativeImage.createFromPath(path.join(__dirname, "assets", `badge-${key}.png`)) : null,
    unread ? `안 읽은 메시지 ${unread}개 · 메뉴에서 대화 확인` : "")
  tray?.setToolTip(unread ? `슬랙 · 안 읽음 ${unread} · 우클릭해서 대화 확인` : "슬랙")
  refreshMenus()
}
async function poll() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (polling) { pollQueued = true; return }
  const epoch = sessionEpoch
  polling = true
  try {
    const chatSession = workspace?.session() || mainWindow.webContents.session
    const response = await chatSession.fetch(`${BASE}/api/chat/inbox`, { credentials: "include", signal: AbortSignal.timeout(8000) })
    if (epoch !== sessionEpoch) return
    if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error("inbox-unavailable")
    if (response.status === 401 || response.status === 403) workspace?.clearWork()
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) { previous = null; names = new Map(); namesFetchedAt = 0; updateUnread([]); return }
    const rooms = await response.json()
    if (epoch !== sessionEpoch) return
    if (!Array.isArray(rooms)) { previous = null; names = new Map(); namesFetchedAt = 0; updateUnread([]); return }
    updateUnread(rooms)
    if (rooms.some(r => r.kind === "dm" && r.otherId && !names.has(r.otherId)) && Date.now() - namesFetchedAt > 300000) {
      namesFetchedAt = Date.now() // 퇴사자 등 목록에 없는 상대 때문에 매번 전체 목록을 다시 받지 않는다.
      const boot = await chatSession.fetch(`${BASE}/api/chat/bootstrap`, { credentials: "include", signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (boot?.ok) {
        const data = await boot.json().catch(() => ({}))
        if (epoch !== sessionEpoch) return
        names = new Map((data.employees || []).map(e => [e.id, e.name]))
      }
      updateUnread(rooms)
    }
    const candidates = notificationCandidates(previous, rooms)
    const focused = mainWindow.isFocused() && (!workspace || workspace.active() === "chat")
    if (candidates.length && !focused && alertHours() && Notification.isSupported()) {
      const top = candidates.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0]
      const notice = new Notification({ title: `슬랙 · ${roomTitle(top, names)}`, body: String(top.lastText || "새 메시지가 있습니다").slice(0, 160), icon: iconPath })
      notice.on("click", () => show(mainWindow, roomLink(top.id)))
      notice.show(); mainWindow.flashFrame(true)
    }
    previous = new Map(rooms.map(r => [r.id, { lastAt: r.lastAt, mentioned: r.mentioned || 0 }]))
  } catch { safeLog("inbox-check-failed") }
  finally { polling = false; if (pollQueued) { pollQueued = false; void poll() } }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", () => show(mainWindow))
  app.on("before-quit", () => { quitting = true })
  app.on("window-all-closed", event => event.preventDefault())
  app.whenReady().then(() => {
    const chatSession = session.fromPartition(PARTITION)
    chatSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "notifications"))
    chatSession.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
      callback(requestDecision(details))
    })
    chatSession.webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
      const decision = requestDecision(details)
      callback(decision.cancel ? { cancel: true } : { requestHeaders: details.requestHeaders })
    })
    chatSession.webRequest.onCompleted({ urls: [`${BASE}/api/chat/channels/*/read`, `${BASE}/api/chat/channels/*/reads`, `${BASE}/api/auth/signout`] }, details => {
      if (details.method === "POST" && details.statusCode >= 200 && details.statusCode < 300) {
        if (new URL(details.url).pathname === "/api/auth/signout") {
          sessionEpoch++; previous = null; names = new Map(); namesFetchedAt = 0; workspace?.clearWork(); updateUnread([])
        } else poll()
      }
    })
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
