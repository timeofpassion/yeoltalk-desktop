const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { BASE, START, PARTITION, classifyUrl, returnAfterLogin, workspaceKey } = require("./rules.cjs")

// 대화 1개 + 사용자가 연 업무 화면만 유지한다. 탭 전환은 재탐색하지 않는다.
function connectWorkspace(win, { WebContentsView, ipcMain, dialog, openExternal, safeLog, loaded = () => {} }) {
  // BaseWindow의 형제 뷰로 배치한다. 원격 화면을 다른 웹뷰의 자식에 겹치지 않는다.
  let shellView, railView
  if (!win.webContents) {
    shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "workspace-preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })
    win.contentView.addChildView(shellView)
    win.webContents = shellView.webContents
    win.loadFile = filename => shellView.webContents.loadFile(filename)
  }
  const views = new Map()
  let active = "chat", destroyed = false, attached
  const shellUrl = pathToFileURL(path.join(__dirname, "assets", "workspace.html")).href
  function layout() {
    const [width, height] = win.getContentSize()
    const top = width < 600 ? 104 : 56
    const left = active === "chat" || width < 600 ? 0 : 76
    shellView?.setBounds({ x: 0, y: 0, width, height: top })
    if (left && shellView && !railView) {
      railView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "workspace-preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } })
      win.contentView.addChildView(railView)
      railView.webContents.loadFile(path.join(__dirname, "assets", "workspace.html"), { query: { rail: "1" } })
      railView.webContents.on("did-finish-load", announce)
      railView.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      railView.webContents.on("will-navigate", e => e.preventDefault())
    }
    railView?.setBounds({ x: 0, y: top, width: left, height: Math.max(1, height - top) })
    attached?.setBounds({ x: left, y: top, width: Math.max(1, width - left), height: Math.max(1, height - top) })
  }
  function announce() {
    if (!destroyed) {
      const state = { active, opened: [...views.keys()] }
      win.webContents.send("workspace:state", state)
      railView?.webContents.send("workspace:state", state)
    }
  }
  function open(key, url) {
    if (!["chat", "tasks", "approvals"].includes(key)) return
    let view = views.get(key)
    if (!view) {
      view = new WebContentsView({ webPreferences: { partition: PARTITION, preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: true } })
      views.set(key, view)
      if (attached) win.contentView.removeChildView(attached)
      win.contentView.addChildView(view)
      attached = view
      active = key
      layout()
      const wc = view.webContents
      const route = target => {
        const kind = classifyUrl(target)
        if (kind === "attachment") wc.downloadURL(target)
        else if (kind === "internal") open(workspaceKey(target), returnAfterLogin(target) || target)
        else openExternal(target)
      }
      wc.setWindowOpenHandler(({ url: target }) => { route(target); return { action: "deny" } })
      const navigate = (event, target) => {
        const kind = classifyUrl(target)
        if (kind !== "internal") { event.preventDefault(); route(target); return }
        const next = workspaceKey(target)
        const login = new URL(target).pathname.match(/^\/(login|api\/auth|change-password|auth-error)(\/|$)/)
        if (!login && next !== key) { event.preventDefault(); route(target) }
      }
      wc.on("will-navigate", navigate)
      wc.on("will-redirect", navigate)
      wc.on("will-attach-webview", event => event.preventDefault())
      wc.on("will-prevent-unload", event => {
        if (dialog.showMessageBoxSync(win, { type: "question", buttons: ["계속 작성", "이동"], defaultId: 0, cancelId: 0,
          message: "작성 중인 내용을 확인해 주세요", detail: "저장하지 않은 내용이 있을 수 있습니다." }) === 1) event.preventDefault()
      })
      wc.on("did-finish-load", () => { loaded(); announce() })
      wc.on("did-fail-load", (_e, code, _description, _url, main) => {
        if (main && code !== -3) { safeLog("workspace-load-failed"); win.webContents.send("workspace:error", key) }
      })
      wc.on("render-process-gone", () => { safeLog("workspace-renderer-gone"); win.webContents.send("workspace:error", key) })
      wc.on("destroyed", () => {
        views.delete(key)
        if (attached === view) attached = undefined
        if (!destroyed) { if (active === key) open("chat"); else announce() }
      })
      const initial = url || (key === "chat" ? START : `${BASE}/${key}`)
      wc.loadURL(initial).catch(() => safeLog("workspace-load-failed"))
    } else if (url && url !== view.webContents.getURL()) {
      view.webContents.loadURL(url).catch(() => safeLog("workspace-navigation-failed"))
    }
    active = key
    if (attached !== view) {
      if (attached) win.contentView.removeChildView(attached)
      win.contentView.addChildView(view)
      attached = view
    }
    layout(); announce()
    view.webContents.focus()
  }
  const onCommand = (event, command) => {
    // 원격 인트라넷/하위 프레임은 로컬 앱 제어 IPC를 호출할 수 없다.
    const sender = event.sender
    const trusted = sender === win.webContents ? shellUrl : sender === railView?.webContents ? shellUrl + "?rail=1" : null
    if (!trusted || event.senderFrame !== sender.mainFrame || event.senderFrame.url !== trusted) return
    if (["chat", "tasks", "approvals"].includes(command)) open(command)
    else if (command === "reload") views.get(active)?.webContents.reload()
    else if (["close-tasks", "close-approvals"].includes(command)) views.get(command.slice(6))?.webContents.close({ waitForBeforeUnload: true })
  }
  ipcMain.on("workspace:open", onCommand)
  const onNavigate = (event, url) => {
    if (![...views.values()].some(view => view.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) return
    try { if (new URL(event.senderFrame.url).origin !== BASE) return } catch { return }
    if (classifyUrl(url) === "internal") open(workspaceKey(url), returnAfterLogin(url) || url)
  }
  ipcMain.on("workspace:navigate", onNavigate)
  win.on("resize", layout)
  win.on("closed", () => {
    destroyed = true
    ipcMain.removeListener("workspace:open", onCommand)
    ipcMain.removeListener("workspace:navigate", onNavigate)
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close()
    if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.close()
    if (railView && !railView.webContents.isDestroyed()) railView.webContents.close()
  })
  win.webContents.on("did-finish-load", () => { open("chat"); announce() })
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.webContents.on("will-navigate", event => event.preventDefault())
  win.loadFile(path.join(__dirname, "assets", "workspace.html"))
  layout()
  return { openUrl: url => open(workspaceKey(url), returnAfterLogin(url) || url), active: () => active,
    clearWork: () => { for (const key of ["tasks", "approvals"]) views.get(key)?.webContents.close(); },
    session: () => views.get("chat")?.webContents.session, contents: () => views.get(active)?.webContents,
    count: () => views.size }
}
module.exports = { connectWorkspace }
