// 자체 앱의 실제 Electron 렌더러에서 공통 레이아웃을 검증한다. 운영 로그인/직원 대화는 사용하지 않는다.
const { app, BrowserWindow } = require("electron")
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict")
const { BASE, START, requestDecision } = require("../rules.cjs")
// 화면 없는 시험 창의 캡처는 소프트웨어 렌더러로 고정한다(Windows GPU Viz 캡처 오류 방지).
app.disableHardwareAcceleration()
const evidence = process.argv[2]
let phase = "앱 준비"
if (!evidence || !path.isAbsolute(evidence)) throw new Error("시험 결과 절대 경로가 필요합니다")
fs.mkdirSync(evidence, { recursive: true })
app.setPath("userData", path.join(evidence, "fixture-profile"))
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>슬랙 전용 화면 · 시험 데이터</title>
<style>body{margin:0;font:16px sans-serif;background:white} [data-chrome]{display:contents}aside{position:fixed;inset:0 auto 0 0;width:64px;background:#18202f;color:white}main{margin-left:64px;padding-bottom:112px;height:100vh;box-sizing:border-box}.floating{position:fixed;right:20px;bottom:0;background:#ffe4df;padding:30px}.slack{height:100%;display:grid;grid-template-columns:180px 1fr}.channels{background:#f4f4f5;padding:24px 12px}.selected{background:#e63329;color:white;padding:8px}.conversation{padding:24px}.caption{font-size:13px;color:#666}h1{font-size:20px}@media(max-width:500px){.slack{grid-template-columns:110px 1fr}.conversation{padding:16px}.channels{padding:16px 8px}}</style>
<div data-chrome="1"><aside>베스타<br>대표실<br>홈</aside></div>
<main data-main="1"><div class="slack"><nav class="channels"><b>열정 슬랙</b><p class="selected"># 시험 채널</p><p>내 대화</p></nav><section class="conversation"><h1># 시험 채널</h1><p class="caption">시험용 레이아웃 · 실제 직원 데이터 없음</p><p>채팅 본문 영역</p><input aria-label="메시지" placeholder="메시지 입력"></section></div></main>
<div data-chrome="1"><div class="floating">자동으로 떠 있는 열톡 패널</div></div></html>`
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(fixture) })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const win = new BrowserWindow({ width: 1360, height: 900, show: false, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, "../preload.cjs"), partition: "slack-frame-fixture", sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const errors = [], rows = []
  win.webContents.on("preload-error", (_e, _p, error) => errors.push(error.message))
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/slack`)
    async function check(label) {
      phase = label
      const result = await win.webContents.executeJavaScript(`({hidden:[...document.querySelectorAll('[data-chrome]')].every(el=>getComputedStyle(el).display==='none'),left:document.querySelector('main').getBoundingClientRect().left,padding:getComputedStyle(document.querySelector('main')).paddingBottom,chatVisible:document.querySelector('.conversation').getBoundingClientRect().width>0,bridge:window.yeoltalkDesktop,inputEnabled:!document.querySelector('input').disabled})`)
      assert.equal(result.hidden, true); assert.equal(result.left, 0); assert.equal(result.padding, "0px"); assert.equal(result.chatVisible, true); assert.equal(result.inputEnabled, true)
      assert.equal(result.bridge.product, "passion-slack"); assert.equal(result.bridge.version, require("../package.json").version)
      rows.push({ label, ...result })
    }
    await check("1360px 최초 표시")
    phase = "1360px 화면 캡처"
    fs.writeFileSync(path.join(evidence, "slack-only-1360.png"), (await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript(`history.pushState({},'', '/slack?c=fixture'); document.querySelector('[data-chrome]').style.display='contents'`)
    await check("SPA 이동·인라인 표시 시도")
    await win.loadURL(win.webContents.getURL())
    await check("새 문서로 재진입")
    win.setContentSize(360, 800)
    await check("360px 창")
    phase = "360px 화면 캡처"
    fs.writeFileSync(path.join(evidence, "slack-only-360.png"), (await win.webContents.capturePage()).toPNG())
    // 회사 서버에 보내지 않고 독립 시험 세션에서만 HTTPS를 가로채 실제 Electron 요청 훅을 검사한다.
    const isolated = win.webContents.session
    isolated.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => callback(requestDecision(details)))
    isolated.webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
      callback(requestDecision(details).cancel ? { cancel: true } : { requestHeaders: details.requestHeaders })
    })
    // HTTP 시험 서버로 헤더 전송 단계까지 검사한다(커스텀 프로토콜은 그 단계를 거치지 않는다).
    const requests = await win.webContents.executeJavaScript(`Promise.all([
      fetch('/ceo?_rsc=fixture').then(()=>false,()=>true),
      fetch('/ceo',{headers:{RSC:'1'}}).then(()=>false,()=>true),
      fetch('/api/chat/inbox').then(r=>r.ok)
    ])`)
    assert.deepEqual(requests, [true, true, true])
    isolated.protocol.handle("https", request => new Response(new URL(request.url).pathname.startsWith("/api/") ? "{}" : fixture,
      { headers: { "content-type": new URL(request.url).pathname.startsWith("/api/") ? "application/json" : "text/html; charset=utf-8" } }))
    await win.loadURL(BASE + "/dashboard")
    assert.equal(win.webContents.getURL(), START)
    await check("로그인 완료 경로를 슬랙으로 복귀")
    await assert.rejects(win.loadURL(BASE + "/ceo"))
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(evidence, "slack-window.json"), JSON.stringify({ fixtureOnly: true, softwareRenderer: true, actualEmployeeLoginTested: false,
      rows, nativePageBoundary: { forbiddenDocumentBlocked: true, forbiddenRscQueryBlocked: requests[0], forbiddenRscHeaderBlocked: requests[1], chatApiAllowed: requests[2] }, preloadErrors: errors }, null, 2))
  } finally { win.destroy(); await new Promise(resolve => server.close(resolve)) }
  app.quit()
}).catch(error => { fs.writeFileSync(path.join(evidence, "slack-window-error.txt"), `${phase}\n${error.stack}`); app.exit(1) })
