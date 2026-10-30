// 실제 Electron 메인·메뉴·요청 훅·보조 창을 격리 데이터로 검사. 운영 쿠키/직원 계정 미사용.
const { app, session, Menu } = require("electron")
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict")
const { BASE, PARTITION } = require("../rules.cjs")
const evidence = process.argv[2]
if (!evidence || !path.isAbsolute(evidence)) throw Error("시험 결과 절대 경로가 필요합니다")
fs.mkdirSync(evidence, { recursive: true })
app.disableHardwareAcceleration()
const originalPath = app.getPath.bind(app)
app.getPath = name => name === "appData" ? evidence : originalPath(name)
let unread = 4, auth = true
const rows = () => [{ id: "fixture-room", kind: "dm", otherId: "fixture-peer", name: "fixture-self:fixture-peer", unread: unread / 2, slackUnread: unread / 2, mentioned: 0, hidden: false, muted: false, lastAt: "2026-10-30T09:00:00Z" }]
const html = url => `<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{font:16px sans-serif;margin:0}main{padding:24px}button{padding:12px;margin:8px;border:1px solid #888;background:white}h1{color:#E63329}</style><div data-chrome>대표실·인트라넷 알림4개(시험 데이터)</div><main data-main><h1>${url.pathname.startsWith("/talk") ? "열톡 · 대화" : "열정 슬랙 · 업무 채널"}</h1><p>격리 검증 화면 · 실제 직원/대화 아님</p><p id="room">${url.searchParams.get("c") || url.pathname}</p><button id="talk" onclick="window.open('${BASE}/talk/fixture-room')">작은 열톡 창</button><button id="read" onclick="fetch('/api/chat/channels/fixture-room/read',{method:'POST'})">대화 읽기</button></main></html>`
app.whenReady().then(() => {
  session.fromPartition(PARTITION).protocol.handle("https", request => {
    const url = new URL(request.url)
    if (url.origin !== BASE) return new Response("시험에서 외부 통신 차단", { status: 403 })
    if (url.pathname.endsWith("/read") && request.method === "POST") unread = 0
    if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify(url.pathname.endsWith("bootstrap") ? { employees: [{ id: "fixture-peer", name: "시험 직원" }] } : url.pathname.endsWith("inbox") ? rows() : { ok: true }), { status: auth ? 200 : 401, headers: { "content-type": "application/json" } })
    return new Response(html(url), { headers: { "content-type": "text/html; charset=utf-8" } })
  })
})
const entry = path.resolve(__dirname, "../main.cjs"), runtime = new Module(entry, module)
runtime.filename = entry; runtime.paths = Module._nodeModulePaths(path.dirname(entry))
runtime._compile(fs.readFileSync(entry, "utf8") + "\nmodule.exports={poll,state:()=>({mainWindow,talkWindow,unreadRooms})};", entry)
const api = runtime.exports
async function until(predicate) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 20000) throw Error("시험 상태 대기시간 초과")
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
app.whenReady().then(async () => {
  await until(() => api.state().mainWindow && !api.state().mainWindow.webContents.isLoading())
  const win = api.state().mainWindow, overlay = []
  const nativeOverlay = win.setOverlayIcon.bind(win)
  win.setOverlayIcon = (image, label) => { overlay.push({ empty: image ? image.isEmpty() : true, label }); nativeOverlay(image, label) }
  await api.poll()
  const unreadMenu = () => Menu.getApplicationMenu().items[0].submenu.items.find(x => x.label.startsWith("안 읽은 대화"))
  await until(() => unreadMenu()?.submenu?.items[0]?.label.includes("시험 직원"))
  assert.match(unreadMenu().label, /4개 메시지/)
  assert.match(unreadMenu().submenu.items[0].label, /시험 직원.*4/)
  assert.equal(overlay.at(-1).empty, false)
  unreadMenu().submenu.items[0].click()
  await until(() => !win.webContents.isLoading() && win.webContents.getURL().includes("c=fixture-room"))
  assert.equal(win.webContents.getURL(), BASE + "/slack?c=fixture-room")
  await win.webContents.executeJavaScript("document.getElementById('talk').click()")
  await until(() => api.state().talkWindow && !api.state().talkWindow.webContents.isLoading())
  const talk = api.state().talkWindow
  assert.equal(talk.webContents.getURL(), BASE + "/talk/fixture-room")
  assert.equal(win.webContents.getURL(), BASE + "/slack?c=fixture-room")
  assert.equal(talk.webContents.session, win.webContents.session)
  fs.writeFileSync(path.join(evidence, "slack-fixture.png"), (await win.webContents.capturePage()).toPNG())
  fs.writeFileSync(path.join(evidence, "talk-fixture.png"), (await talk.webContents.capturePage()).toPNG())
  await talk.webContents.executeJavaScript("document.getElementById('read').click()")
  await until(() => unread === 0 && api.state().unreadRooms.length === 0)
  assert.equal(unreadMenu().enabled, false)
  assert.equal(overlay.at(-1).empty, true)
  auth = false; unread = 4; await api.poll()
  assert.equal(unreadMenu().enabled, false)
  const result = { fixtureOnly: true, actualEmployeeLogin: false, nativeWindowsOverlayImageLoaded: true, unread4ToRoom: true,
    mainSlackPreserved: true, separateTalkWindow: true, sharedSession: true, talkReadClearsSlackBadgeViaNetworkHook: true, expiredSessionClearsRoomMenu: true }
  fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify(result, null, 2))
  app.exit(0)
}).catch(error => { fs.writeFileSync(path.join(evidence, "error.txt"), error.stack); app.exit(1) })
