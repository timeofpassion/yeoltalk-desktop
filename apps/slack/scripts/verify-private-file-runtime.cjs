// 운영 계정·실제 파일 없이 Electron의 쿠키·새창·다운로드 경로를 검증한다.
const { app, session, BrowserWindow } = require("electron")
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict")
const http = require("node:http")
const { BASE, PARTITION } = require("../rules.cjs")
const evidence = process.argv[2]
if (!evidence || !path.isAbsolute(evidence)) throw Error("검증 전용 절대 경로가 필요합니다")
fs.mkdirSync(evidence, { recursive: true })
app.disableHardwareAcceleration()
const originalPath = app.getPath.bind(app)
app.getPath = name => name === "appData" ? evidence : originalPath(name)
const attachment = BASE + "/api/chat/files/v1/fixture-room/fixture-user/fixture-private.txt"
const saved = path.join(evidence, "fixture-private.txt")
let cookieUsed = false
const diagnostics = []
let fixtureServer
app.whenReady().then(async () => {
  const current = session.fromPartition(PARTITION)
  await current.cookies.set({ url: BASE, name: "fixture-auth", value: "test-only", secure: true, httpOnly: true })
  // Electron의 protocol.handle Request에는 Cookie가 생략된다. 실제 HTTP 전송에서 현재 세션 쿠키를 검사한다.
  fixtureServer = http.createServer((request, response) => {
    cookieUsed = (request.headers.cookie || "").includes("fixture-auth=test-only")
    diagnostics.push({ stage: "http-file", cookieUsed })
    response.writeHead(cookieUsed ? 200 : 401, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="fixture-private.txt"', "cache-control": "private, no-store" })
    response.end(cookieUsed ? "private-fixture" : "unauthorized")
  })
  await new Promise(resolve => fixtureServer.listen(0, "127.0.0.1", resolve))
  const localFile = `http://127.0.0.1:${fixtureServer.address().port}/fixture-private.txt`
  await current.cookies.set({ url: localFile, name: "fixture-auth", value: "test-only", httpOnly: true })
  current.protocol.handle("https", request => {
    const url = new URL(request.url)
    if (request.url === attachment) {
      // 시험 API를 같은 세션의 로컬 HTTP 서버로 전달한다. 운영 endpoint 통신을 대신하지 않는다.
      return current.fetch(localFile, { cache: "no-store", bypassCustomProtocolHandlers: true })
    }
    if (url.pathname.startsWith("/api/")) return new Response("[]", { headers: { "content-type": "application/json" } })
    return new Response(`<!doctype html><a id="file" href="${attachment}" target="_blank">시험용 비공개 첨부</a>`, { headers: { "content-type": "text/html" } })
  })
  const downloaded = new Promise((resolve, reject) => {
    current.once("will-download", (_event, item) => {
      item.setSavePath(saved)
      item.once("done", (_event, state) => { diagnostics.push({ stage: "download-done", state }); state === "completed" ? resolve() : reject(Error(state)) })
    })
    setTimeout(() => reject(Error("시험 다운로드 시간 초과")), 20000).unref()
  })
  const entry = path.resolve(__dirname, "../main.cjs"), runtime = new Module(entry, module)
  runtime.filename = entry; runtime.paths = Module._nodeModulePaths(path.dirname(entry))
  runtime._compile(fs.readFileSync(entry, "utf8") + "\nmodule.exports={getWindow:()=>mainWindow};", entry)
  let win
  for (let i = 0; i < 400; i++) {
    win = runtime.exports.getWindow()
    if (win && !win.webContents.isLoading()) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(win); win.hide()
  const originalUrl = win.webContents.getURL()
  await win.webContents.executeJavaScript("document.getElementById('file').click()")
  await downloaded
  assert.equal(cookieUsed, true)
  assert.equal(fs.readFileSync(saved, "utf8"), "private-fixture")
  assert.equal(win.webContents.getURL(), originalUrl)
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  assert.equal((await session.defaultSession.cookies.get({ name: "fixture-auth" })).length, 0)
  fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ fixtureOnly: true, realEmployeeLogin: false,
    fixtureApiProxiedViaSameSessionLocalHttp: true, authenticatedCookieUsed: true, defaultBrowserProfileNotUsed: true, sameSlackWindowPreserved: true, exactFixtureFileDownloaded: true }, null, 2))
  await new Promise(resolve => fixtureServer.close(resolve))
  app.exit(0)
}).catch(error => { fixtureServer?.close(); fs.writeFileSync(path.join(evidence, "error.txt"), error.stack); fs.writeFileSync(path.join(evidence, "diagnostics.json"), JSON.stringify(diagnostics)); app.exit(1) })
