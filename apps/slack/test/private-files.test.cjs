const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm")
const rules = require("../rules.cjs")
const file = `${rules.BASE}/api/chat/files/v1/room1/user1/random-photo.png`

test("인증 첨부의 정확한 서버 경로만 전용 다운로드로 구분한다", () => {
  assert.equal(rules.classifyUrl(file), "attachment")
  assert.equal(rules.classifyUrl(file + "?download=%EC%82%AC%EC%A7%84.png"), "attachment")
  for (const url of [file.replace("room1", "%2froom1"), file + "/more", file + "?redirect=https://evil.test", file.replace("https://", "https://user:pass@")]) assert.equal(rules.classifyUrl(url), "blocked")
  assert.notEqual(rules.classifyUrl(file.replace(rules.BASE, "https://evil.test")), "attachment")
})

test("첨부 새창/일반링크는 현재 로그인 세션으로 다운로드하며 슬랙창·기본브라우저를 바꾸지 않는다", () => {
  const downloads = [], external = [], urls = [], listeners = {}
  let popup
  const win = { isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {}, once() {}, on() {},
    loadURL: async url => urls.push(url), webContents: { setWindowOpenHandler: handler => { popup = handler }, on: (name, handler) => { listeners[name] = handler }, downloadURL: url => downloads.push(url) } }
  const electron = { app: { setName() {}, setPath() {}, getPath: () => "fixture", setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() {} },
    BrowserWindow: function () { return win }, shell: { openExternal: async url => external.push(url) } }
  const root = path.resolve(__dirname, ".."), sandbox = { __dirname: root, require: id => id === "electron" ? electron : id === "./rules.cjs" ? rules : id === "./updater.cjs" ? {} : require(id) }
  vm.runInNewContext(fs.readFileSync(path.join(root, "main.cjs"), "utf8") + "\nthis.make=makeWindow;", sandbox)
  sandbox.make()
  assert.equal(popup({ url: file }).action, "deny")
  let prevented = false
  listeners["will-navigate"]({ preventDefault: () => { prevented = true } }, file + "?download=1")
  assert.equal(prevented, true)
  assert.deepEqual(downloads, [file, file + "?download=1"])
  assert.deepEqual(urls, [rules.START])
  assert.deepEqual(external, [])
})
