// 열톡 PC 프로그램 — 인트라넷 열톡 화면(/talk)을 감싼 윈도우 프로그램.
// [2026-10-16 대표] "PC 다운받게끔 프로그램 만들고" — 크롬을 꺼도 알림이 오고, PC 를 켜면 자동으로 뜬다.
// 하는 일: ① 창(로그인은 한 번, 계속 유지) ② 닫아도 작업표시줄 오른쪽(트레이)에 상주 ③ 윈도우 시작 시 자동 실행
//          ④ 15초마다 안 읽은 메시지를 확인해 윈도우 알림(평일 09:00~19:00, 인트라넷과 같은 규칙) — 누르면 그 대화방
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell } = require("electron")
const path = require("path")

const BASE = "https://intranet.timeofpassion.com"
const START = `${BASE}/talk`
const ICON = path.join(__dirname, "build", "icon.png")

let win = null
let tray = null
let quitting = false
let lastUnread = null
let names = null

if (!app.requestSingleInstanceLock()) app.quit()
app.on("second-instance", () => show())
app.setAppUserModelId("com.timeofpassion.yeoltalk") // 윈도우 알림에 「열톡」 이름이 뜨게

function inAlertHours(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3)
  const dow = k.getUTCDay()
  if (dow === 0 || dow === 6) return false
  const min = k.getUTCHours() * 60 + k.getUTCMinutes()
  return min >= 9 * 60 && min < 19 * 60
}

function show(url) {
  if (!win) return
  if (url) win.loadURL(url)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    title: "열톡",
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: { partition: "persist:yeoltalk", preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  })
  win.loadURL(START)
  // 새 창으로 여는 링크(인트라넷 업무·외부 주소)는 평소 쓰는 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })
  // 인트라넷 다른 화면으로 가려 하면 브라우저로 보내고 열톡은 그대로(로그인 화면은 예외)
  win.webContents.on("will-navigate", (e, url) => {
    const u = new URL(url)
    const inside = u.origin === BASE && (u.pathname.startsWith("/talk") || u.pathname.startsWith("/login") || u.pathname.startsWith("/api/auth"))
    if (!inside && u.origin !== BASE) { e.preventDefault(); shell.openExternal(url) }
  })
  win.on("close", (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide() // 닫기 = 숨기기. 알림은 계속 온다
  })
  win.on("focus", () => win.flashFrame(false))
  win.on("page-title-updated", (e) => e.preventDefault()) // 창 제목은 늘 「열톡」
  // 로그인하면 인트라넷은 대시보드로 보낸다 → 이 프로그램에서는 열톡으로 되돌린다
  win.webContents.on("did-navigate", (_e, url) => {
    const u = new URL(url)
    const keep = ["/talk", "/login", "/change-password", "/api/auth", "/auth-error"].some((p) => u.pathname.startsWith(p))
    if (u.origin === BASE && !keep) win.loadURL(START)
  })
}

function trayMenu() {
  const auto = app.getLoginItemSettings().openAtLogin
  return Menu.buildFromTemplate([
    { label: "열톡 열기", click: () => show() },
    { type: "separator" },
    { label: "PC 켤 때 자동 실행", type: "checkbox", checked: auto, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit() } },
  ])
}

// 안 읽은 메시지 — 열톡 화면이 로그인된 세션으로 직접 묻는다(쿠키를 프로그램이 따로 들고 있지 않음)
async function poll() {
  if (!win || win.webContents.isLoading()) return
  try {
    const rooms = await win.webContents.executeJavaScript(
      `fetch("/api/chat/inbox",{credentials:"include"}).then(r=>r.ok?r.json():null).catch(()=>null)`,
    )
    if (!Array.isArray(rooms)) return
    const unread = rooms.reduce((a, r) => a + (r.unread || 0), 0)
    tray && tray.setToolTip(unread > 0 ? `열톡 · 안 읽은 메시지 ${unread}` : "열톡")
    if (lastUnread !== null && unread > lastUnread && !win.isFocused()) {
      const top = rooms.filter((r) => r.unread > 0).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0]
      if (top) {
        if (top.kind === "dm" && !names) {
          const boot = await win.webContents.executeJavaScript(`fetch("/api/chat/bootstrap").then(r=>r.ok?r.json():null).catch(()=>null)`)
          names = new Map(((boot && boot.employees) || []).map((e) => [e.id, e.name]))
        }
        const title = top.kind === "ai" ? (top.persona && top.persona.name) || "AI 팀원" : top.kind === "dm" ? (names && names.get(top.otherId)) || "새 메시지" : top.name
        win.flashFrame(true)
        if (inAlertHours() && Notification.isSupported()) {
          const n = new Notification({ title: `${title}${top.mentioned ? " · 나를 언급" : ""}`, body: top.lastText || "새 메시지", icon: ICON, silent: false })
          n.on("click", () => show(`${START}/${top.id}`))
          n.show()
        }
      }
    }
    lastUnread = unread
  } catch {
    // 로그인 전·네트워크 끊김 — 다음 차례에 다시
  }
}

app.whenReady().then(() => {
  // 처음 설치하면 PC 켤 때 자동 실행을 켜 둔다(트레이 메뉴에서 끌 수 있음)
  if (!app.getLoginItemSettings().openAtLogin && !process.argv.includes("--no-autostart")) app.setLoginItemSettings({ openAtLogin: true })
  createWindow()
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.setToolTip("열톡")
  tray.on("click", () => show())
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu()))
  tray.setContextMenu(trayMenu())
  setInterval(poll, 15000)
})

app.on("before-quit", () => { quitting = true })
app.on("window-all-closed", (e) => e.preventDefault())
