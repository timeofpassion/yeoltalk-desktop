// 실제 main을 격리 세션과 시험 응답으로 실행한다. 운영 서버에는 연결하지 않는다.
const { app, session, BrowserWindow, shell } = require("electron")
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict")
const { BASE, PARTITION } = require("../rules.cjs")
const evidence = process.argv[2]
if (!evidence || !path.isAbsolute(evidence)) throw Error("검증 결과 절대 경로 필요")
fs.mkdirSync(evidence, { recursive: true })
app.disableHardwareAcceleration()
let phase = "준비"
setTimeout(() => { fs.writeFileSync(path.join(evidence, "timeout.txt"), phase); app.exit(1) }, 30000).unref()
process.on("uncaughtException", error => { fs.writeFileSync(path.join(evidence, "uncaught.txt"), error.stack); app.exit(1) })
const originalPath = app.getPath.bind(app)
app.getPath = key => key === "appData" ? evidence : originalPath(key)
const external = [], logs = []
shell.openExternal = async url => { external.push(url) }
app.whenReady().then(() => session.fromPartition(PARTITION).protocol.handle("https", request => {
  const url = new URL(request.url)
  assert.equal(url.origin, BASE)
  logs.push(url.pathname)
  if (url.pathname.startsWith("/api/")) return new Response("[]", { headers: { "content-type": "application/json" } })
  return new Response(`<!doctype html><meta charset="utf-8"><title>시험 ${url.pathname}</title><nav data-chrome>홈 업무 결재 대표실</nav><main>${url.pathname}<input aria-label="초안"></main>`, { headers: { "content-type": "text/html; charset=utf-8" } })
}))
const entry = path.resolve(__dirname, "../main.cjs"), runtime = new Module(entry, module)
runtime.filename = entry; runtime.paths = Module._nodeModulePaths(path.dirname(entry))
runtime._compile(fs.readFileSync(entry, "utf8") + "\nmodule.exports={window:()=>mainWindow};", entry)
async function until(check) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 15000) throw Error("상태 대기 초과")
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}
app.whenReady().then(async () => {
  await until(() => runtime.exports.window() && !runtime.exports.window().webContents.isLoading())
  const win = runtime.exports.window(), wc = win.webContents
  assert.equal(wc.getURL(), BASE + "/slack")
  if (["load-path", "load-total"].includes(process.argv[3])) {
    const samePath = process.argv[3] === "load-path"
    // 첫 /slack 문서 1회를 포함해 경로 한도와 출처 총량을 실제 요청 훅에서 확인한다.
    for (let i = 0; i < (samePath ? 4 : 39); i++) {
      const target = BASE + (samePath ? `/slack?visit=${i}` : `/normal/${i}`)
      await win.loadURL(target)
      assert.equal(wc.getURL(), target)
    }
    await assert.rejects(win.loadURL(BASE + (samePath ? "/slack?visit=blocked" : "/normal/overflow")))
    // 연속 취소 시 loadURL이 성공으로 끝나기도 하므로 실제 요청 도달 여부를 검증한다.
    await win.loadURL(BASE + "/other-path").catch(() => {})
    assert.equal(logs.includes("/other-path"), false)
    assert.match(fs.readFileSync(path.join(evidence, "PassionSlack", "app.log"), "utf8"), /navigation-document-cancelled circuit-blocked/)
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ fixtureOnly: true, mode: process.argv[3], allowedDocuments: samePath ? 5 : 40, nextDocumentBlocked: true, originBlocked: true, cancellationLogged: true }))
    app.exit(0); return
  }
  if (process.argv[3] === "login") {
    await win.loadURL(BASE + "/login?callbackUrl=%2Fceo")
    await win.loadURL(BASE + "/dashboard")
    assert.equal(wc.getURL(), BASE + "/ceo")
    await win.loadURL(BASE + "/dashboard")
    assert.equal(wc.getURL(), BASE + "/dashboard")
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({fixtureOnly:true, loginReturnsOnce:true, destinationPreserved:true, ordinaryHomePreserved:true}))
    app.exit(0); return
  }
  // 실제 요청 훅의 60초 차단기와 독립적으로 정상 이동·키보드 경로를 시험한다.
  for (const p of ["/dashboard", "/", "/ceo"]) {
    phase = p; await win.loadURL(BASE + p)
    assert.equal(wc.getURL(), BASE + p)
    assert.equal(win.getTitle(), "시험 " + p)
    assert.equal(await wc.executeJavaScript("getComputedStyle(document.querySelector('[data-chrome]')).display !== 'none'"), true)
  }
  phase = "뒤로"
  let prevented = 0
  wc.emit("before-input-event", { preventDefault() { prevented++ } }, { type: "keyDown", alt: true, key: "ArrowLeft" })
  await until(() => wc.getURL() === BASE + "/" && !wc.isLoading())
  phase = "앞으로"
  win.emit("app-command", { preventDefault() { prevented++ } }, "browser-forward")
  await until(() => wc.getURL() === BASE + "/ceo" && !wc.isLoading())
  for (const input of [{ key: "F5" }, { key: "r", control: true }]) {
    phase = input.key
    const before = logs.length
    wc.emit("before-input-event", { preventDefault() { prevented++ } }, { type: "keyDown", ...input })
    await until(() => logs.length > before && !wc.isLoading())
  }
  assert.equal(prevented, 4)
  phase = "새창"
  await wc.executeJavaScript(`window.open('https://example.org'); window.open('mailto:test@example.org')`)
  await until(() => external.length === 2)
  phase = "새창"
  await wc.executeJavaScript(`window.open('${BASE}/approvals')`)
  await until(() => BrowserWindow.getAllWindows().length === 2)
  const child = BrowserWindow.getAllWindows().find(w => w !== win)
  await until(() => !child.webContents.isLoading())
  assert.equal(child.webContents.getURL(), BASE + "/approvals")
  assert.equal(child.webContents.session, wc.session)
  phase = "자식 닫기"
  child.close()
  await until(() => BrowserWindow.getAllWindows().length === 1)
  // 정상 창 생성 뒤 폭주시키면 새 창 수가 제한되고 이후 문서 이동도 멈춘다.
  phase = "폭주"
  await wc.executeJavaScript(`for(let i=0;i<30;i++) window.open('${BASE}/marketing/'+i)`)
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.ok(BrowserWindow.getAllWindows().length <= 5)
  await assert.rejects(win.loadURL(BASE + "/finance"))
  fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ fixtureOnly: true, homePreserved: true, pageTitle: true, webChromeVisible: true, keyboardAndMouseHistory: true, reloadKeys: true, externalAndMail: external, sameSessionChild: true, popupStormStopped: true, noProductionLogin: true }, null, 2))
  app.exit(0)
}).catch(error => { fs.writeFileSync(path.join(evidence, "error.txt"), error.stack); app.exit(1) })
