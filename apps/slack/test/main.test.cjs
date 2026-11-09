const test = require("node:test"), assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path")
const { BASE, START } = require("../rules.cjs")

async function fixture() {
  const calls = { load: [], external: [], reload: 0, logs: [], timers: [], fetch: [], checks: 0, requests: [] }
  let windowOptions, popup, appMenu, updaterOptions, response = { ok: true, json: async () => ({ minVersion: "0.1.7" }) }
  const contents = new EventEmitter(), win = new EventEmitter(), app = new EventEmitter()
  Object.assign(contents, {
    mainFrame: {}, getURL: () => START,
    setWindowOpenHandler: handler => { popup = handler }, downloadURL() {},
  })
  Object.assign(win, {
    webContents: contents, isDestroyed: () => false, isMinimized: () => false,
    isVisible: () => true, show() {}, focus() {},
    loadURL: async url => { calls.request({ url, resourceType: "mainFrame" }, d => { if (!d.cancel) calls.load.push(url) }) },
    reload: () => { calls.request({ url: START, resourceType: "mainFrame" }, d => { if (!d.cancel) calls.reload++ }) },
  })
  Object.assign(app, {
    isPackaged: true, setName() {}, setPath() {}, getPath: () => "fixture", getVersion: () => "7.8.9",
    setAppUserModelId() {}, requestSingleInstanceLock: () => true, quit() {}, whenReady: () => Promise.resolve(),
    getLoginItemSettings: () => ({ openAtLogin: false }),
  })
  const chatSession = {
    setPermissionRequestHandler() {},
    webRequest: { onBeforeRequest(fnFilter, fn) { calls.request = fn }, onBeforeSendHeaders() {}, onCompleted() {} },
    fetch: async (...args) => { calls.fetch.push(args); return response },
  }
  const electron = {
    app, BrowserWindow: Object.assign(function (options) { windowOptions = options; return win }, { getFocusedWindow: () => win, getAllWindows: () => [win] }),
    Tray: function () { return { on() {}, setContextMenu() {} } },
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { appMenu = value } },
    nativeImage: { createFromPath: () => ({ resize() { return this } }) },
    shell: { openExternal: async url => calls.external.push(url) },
    session: { fromPartition: () => chatSession }, powerMonitor: { getSystemIdleTime: () => 125 },
    dialog: { showMessageBoxSync() { throw new Error("자동 적용을 대화상자로 막으면 안 됨") } },
  }
  const root = path.resolve(__dirname, "..")
  const sandbox = {
    __dirname: root, URL, AbortSignal,
    setTimeout: (fn, delay) => { calls.timers.push({ fn, delay, interval: false }); return { unref() {} } },
    setInterval: (fn, delay) => { calls.timers.push({ fn, delay, interval: true }); return { unref() {} } },
    require: id => {
      if (id === "electron") return electron
      if (id === "electron-updater") return { autoUpdater: {} }
      if (id === "node:fs") return { appendFileSync: (_file, text) => calls.logs.push(text) }
      if (id === "./updater.cjs") return { connectUpdater: (_updater, options) => {
        updaterOptions = options
        return { state: () => ({ phase: "idle" }), check: () => { calls.checks++ } }
      } }
      return id.startsWith("./") ? require(path.join(root, id)) : require(id)
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, "main.cjs"), "utf8"), sandbox)
  await Promise.resolve()
  return {
    calls, win, contents, app, options: windowOptions, updater: updaterOptions,
    popup: details => popup(details), reload: () => appMenu.find(item => item.label === "보기").submenu[0].click(),
    setResponse: value => { response = value },
  }
}

test("main이 실제 앱 버전을 인자로 전달하고 15초 후·10분마다 확인", async () => {
  const f = await fixture()
  assert.deepEqual(Array.from(f.options.webPreferences.additionalArguments), ["--app-version=7.8.9"])
  assert.equal(f.updater.currentVersion, "7.8.9"); assert.equal(f.updater.getIdleTime(), 125)
  assert.equal(f.updater.isHidden(), false)
  f.win.isVisible = () => false; assert.equal(f.updater.isHidden(), true)
  const first = f.calls.timers.find(timer => !timer.interval && timer.delay === 15000)
  const every = f.calls.timers.find(timer => timer.interval && timer.delay === 600000)
  assert.ok(first); assert.ok(every); first.fn(); every.fn(); assert.equal(f.calls.checks, 2)
})
test("정책은 공개 GET·캐시 없이 읽고 404면 무시", async () => {
  const f = await fixture()
  assert.deepEqual(await f.updater.readPolicy(), { minVersion: "0.1.7" })
  const [url, options] = f.calls.fetch[0]
  assert.equal(url, `${BASE}/api/desktop/policy`)
  assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store")
  assert.ok(options.signal)
  f.setResponse({ ok: false }); assert.equal(await f.updater.readPolicy(), null)
})
test("iframe의 SPA·서버 리다이렉트·상위 이동 시도가 브라우저 열기나 창 이동을 유발하지 않음", async () => {
  const f = await fixture(), initial = f.calls.load.length
  for (let i = 0; i < 20; i++) {
    f.contents.emit("did-navigate-in-page", {}, `${BASE}/tasks?status=${i}`, false)
    f.contents.emit("will-redirect", { preventDefault() { assert.fail("하위 프레임 자체 이동은 허용") } }, `${BASE}/tasks`, false, false)
    f.contents.emit("will-redirect", { isMainFrame: false, url: `${BASE}/tasks`, preventDefault() { assert.fail("하위 프레임 자체 이동은 허용") } })
  }
  let prevented = false
  f.contents.emit("will-navigate", { isMainFrame: true, initiator: {}, preventDefault() { prevented = true } }, `${BASE}/tasks`)
  assert.equal(prevented, true); assert.deepEqual(f.calls.external, []); assert.equal(f.calls.load.length, initial)
  f.contents.emit("will-redirect", { isMainFrame: true, url: `${BASE}/tasks`, preventDefault() {} })
  assert.deepEqual(f.calls.external, [])
})
test("main의 새창·새로고침 모두 같은 출처 차단기를 거침", async () => {
  const f = await fixture()
  for (let i = 0; i < 30; i++) {
    f.popup({ url: `${BASE}/tasks/${i}` })
  }
  assert.equal(f.calls.external.length, 0)
  assert.ok(f.calls.load.length <= 10)
  const loads = f.calls.load.length
  f.reload(); assert.equal(f.calls.reload, 0)
  f.popup({ url: `${BASE}/slack` }); assert.equal(f.calls.load.length, loads)
  assert.ok(f.calls.logs.some(log => log.includes("navigation-circuit-open")))
})
test("이동이 끝난 뒤에는 어떤 주소로 가도 다시 열거나 브라우저를 열지 않는다(0.1.8 · 11/8 무한 반복 재발 방지)", async () => {
  const f = await fixture()
  for (const p of ["/dashboard", "/", "/talk", "/talk/room1", "/tasks", "/ceo", "/login"]) {
    f.contents.emit("did-navigate", {}, BASE + p)
    f.contents.emit("did-navigate-in-page", {}, BASE + p, true)
    f.contents.emit("did-navigate-in-page", {}, BASE + p, false)
  }
  f.contents.emit("did-navigate", {}, "https://example.org/")
  assert.deepEqual(f.calls.load, [START]); assert.deepEqual(f.calls.external, []); assert.equal(f.calls.reload, 0)
})
test("첫 화면 loadURL과 메뉴 reload가 같은 경로 10초 5회 한도를 공유", async () => {
  const f = await fixture()
  for (let i = 0; i < 20; i++) f.reload()
  assert.deepEqual(f.calls.load, [START]); assert.equal(f.calls.reload, 4)
  assert.ok(f.calls.logs.some(log => log.includes("navigation-circuit-open load")))
  assert.ok(f.calls.logs.some(log => log.includes("navigation-document-cancelled circuit-blocked")))
})
test("자동 적용 시 창 닫기·작성 중 확인 대화상자가 종료를 막지 않음", async () => {
  const f = await fixture()
  f.updater.beforeInstall()
  f.win.emit("close", { preventDefault() { assert.fail("자동 적용을 숨김으로 바꾸면 안 됨") } })
  let prevented = false
  f.contents.emit("will-prevent-unload", { preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  f.updater.installFailed()
  let closePrevented = false
  f.win.hide = () => {}
  f.win.emit("close", { preventDefault() { closePrevented = true } })
  assert.equal(closePrevented, true)
})

test("표시 이름을 바꾸어도 기존 앱 식별자·세션·업데이트·자동실행 파일명 유지", () => {
  const pkg = require("../package.json")
  assert.equal(pkg.version, "0.2.0")
  assert.equal(pkg.build.appId, "com.timeofpassion.slack")
  assert.equal(pkg.build.productName, "열정의시간")
  assert.equal(pkg.build.nsis.shortcutName, "열정의시간")
  assert.equal(pkg.build.win.executableName, "슬랙")
  assert.equal(pkg.build.publish[0].url, "https://github.com/timeofpassion/yeoltalk-desktop/releases/download/passion-slack-updates/")
  assert.equal(require("../rules.cjs").PARTITION, "persist:passion-slack")
})
