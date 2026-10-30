const test = require("node:test"), assert = require("node:assert/strict"), { EventEmitter } = require("node:events")
const { connectUpdater } = require("../updater.cjs")
function fixture() {
  const updater = new EventEmitter(), calls = []
  updater.checkForUpdates = async () => calls.push("check")
  updater.quitAndInstall = (...args) => calls.push(["install", ...args])
  const handle = connectUpdater(updater)
  return { updater, handle, calls }
}
test("업데이트는 자동 다운로드하되 강제 재시작하지 않음", async () => {
  const { updater, handle, calls } = fixture()
  assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(updater.allowDowngrade, false)
  await handle.check(); updater.emit("update-available", { version: "0.2.0" }); updater.emit("update-downloaded", { version: "0.2.0" })
  assert.equal(handle.state().phase, "ready"); assert.deepEqual(calls, ["check"])
  await handle.check(); assert.deepEqual(calls, ["check"])
  handle.install(); assert.deepEqual(calls[1], ["install", false, true])
})
test("피드 미발행·인터넷 단절은 앱을 종료시키지 않고 상태로 안내", async () => {
  const { updater, handle, calls } = fixture()
  updater.checkForUpdates = async () => { throw new Error("404") }
  await handle.check(); assert.equal(handle.state().phase, "error")
  handle.install(); assert.equal(calls.length, 0)
  updater.emit("error", new Error("offline")); assert.equal(handle.state().phase, "error")
})
test("동시에 반복 호출해도 다운로드 확인 한 번만 실행", async () => {
  const { updater, handle } = fixture(); let n = 0, done
  updater.checkForUpdates = () => { n++; return new Promise(resolve => done = resolve) }
  const first = handle.check(); await handle.check(); assert.equal(n, 1); done(); await first
})
