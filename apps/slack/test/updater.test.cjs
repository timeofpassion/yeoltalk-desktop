const test = require("node:test"), assert = require("node:assert/strict"), { EventEmitter } = require("node:events")
const { connectUpdater, canApplyUpdate, belowMinimum } = require("../updater.cjs")
function fixture(options = {}) {
  const updater = new EventEmitter(), calls = [], notices = [], timers = new Map()
  let time = 0, nextId = 0, idle = 0, hidden = false, policy = null, policyReads = 0
  updater.checkForUpdates = async () => calls.push("check")
  updater.quitAndInstall = (...args) => calls.push(["install", ...args])
  const handle = connectUpdater(updater, {
    currentVersion: "0.1.7", getIdleTime: () => idle, isHidden: () => hidden,
    readPolicy: async () => { policyReads++; return policy },
    now: () => time, notify: text => notices.push(text),
    schedule: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id },
    cancel: id => timers.delete(id), ...options,
  })
  return {
    updater, handle, calls, notices,
    setIdle: value => { idle = value }, setHidden: value => { hidden = value },
    setPolicy: value => { policy = value }, policyReads: () => policyReads,
    downloaded: () => updater.emit("update-downloaded", { version: "0.1.8" }),
    advance: duration => {
      const end = time + duration
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        timers.delete(next[0]); time = next[1].at; next[1].fn()
      }
      time = end
    },
  }
}
test("유휴 120초 경계 또는 숨김일 때만 안전하게 적용", () => {
  assert.equal(canApplyUpdate(119, false), false)
  assert.equal(canApplyUpdate(120, false), true)
  assert.equal(canApplyUpdate(0, true), true)
  for (const value of [NaN, Infinity, -1, undefined]) assert.equal(canApplyUpdate(value, false), false)
})
test("다운로드 완료 즉시 유휴·숨김 상태에서는 무인 설치 후 재실행", () => {
  for (const condition of ["idle", "hidden"]) {
    const f = fixture()
    if (condition === "idle") f.setIdle(120)
    else f.setHidden(true)
    assert.equal(f.updater.autoDownload, true); assert.equal(f.updater.autoInstallOnAppQuit, true)
    assert.equal(f.updater.autoRunAppAfterInstall, true); assert.equal(f.updater.allowDowngrade, false)
    f.downloaded(); f.downloaded(); f.handle.install(); f.advance(60 * 60000)
    assert.deepEqual(f.calls, [["install", true, true]])
  }
})
test("사용 중이면 1분마다 다시 판단하고 유휴가 되면 적용", () => {
  const f = fixture()
  f.downloaded(); assert.equal(f.handle.state().phase, "ready")
  f.advance(60000); assert.deepEqual(f.calls, [])
  f.setIdle(120); f.advance(59999); assert.deepEqual(f.calls, [])
  f.advance(1); assert.deepEqual(f.calls, [["install", true, true]])
})
test("계속 사용해도 30분에 적용하고 10초 전에 한 번 알림", () => {
  const f = fixture()
  f.downloaded(); f.advance(20 * 60000); f.downloaded() // 중복 완료 이벤트가 기한을 늘리지 않음
  f.advance(10 * 60000 - 10001); assert.deepEqual(f.notices, [])
  f.advance(1); assert.deepEqual(f.notices, ["새 버전으로 자동 재시작해요"])
  f.advance(9999); assert.deepEqual(f.calls, [])
  f.advance(1); assert.deepEqual(f.calls, [["install", true, true]])
})
test("정책은 숫자·시험판 순서로 비교하고 동일·상위·잘못된 버전은 강제하지 않음", () => {
  for (const [current, minimum] of [["0.1.6", "0.1.7"], ["0.1.9", "0.1.10"], ["0.9.0", "0.10.0"], ["0.1.7-beta.2", "0.1.7-beta.10"], ["0.1.7-rc.1", "0.1.7"]]) assert.equal(belowMinimum(current, minimum), true)
  for (const minimum of ["0.1.7", "0.1.6", "0.1.7+build.2", "0.1.7-beta.1", undefined, null, 7, "bad", "0.01.8", "0.1.8-01"]) assert.equal(belowMinimum("0.1.7", minimum), false)
})
test("최소 버전 미달은 확인·다운로드 뒤 사용 중에도 즉시 적용", async () => {
  const f = fixture()
  f.setPolicy({ minVersion: "0.1.8" }); await f.handle.check()
  f.updater.emit("update-available", { version: "0.1.8" }); f.downloaded()
  assert.deepEqual(f.calls, ["check", ["install", true, true]])
})
test("다운로드 중·준비 상태에도 정책을 읽되 중복 다운로드·상태 덮어쓰기 없음", async () => {
  const f = fixture()
  await f.handle.check(); f.updater.emit("update-available", { version: "0.1.8" })
  await f.handle.check(); assert.equal(f.handle.state().phase, "downloading")
  f.downloaded(); await f.handle.check(); assert.equal(f.handle.state().phase, "ready")
  assert.equal(f.policyReads(), 3); assert.deepEqual(f.calls, ["check"])
  f.setPolicy({ minVersion: "0.1.8" }); await f.handle.check()
  assert.deepEqual(f.calls, ["check", ["install", true, true]])
})
test("다운로드 중 수신한 강제 정책은 다운로드 완료 때 즉시 적용", async () => {
  const f = fixture()
  f.updater.emit("update-available", { version: "0.1.8" })
  f.setPolicy({ minVersion: "0.1.8" }); await f.handle.check(); f.downloaded()
  assert.deepEqual(f.calls, [["install", true, true]])
})
test("정책 404·통신 실패·잘못된 JSON은 일반 업데이트를 막거나 강제하지 않음", async () => {
  for (const readPolicy of [async () => null, async () => { throw new Error("offline/invalid JSON") }, async () => ({ minVersion: "invalid" })]) {
    const f = fixture({ readPolicy })
    await f.handle.check(); f.downloaded(); await f.handle.check()
    assert.deepEqual(f.calls, ["check"]); assert.equal(f.handle.state().phase, "ready")
    f.setHidden(true); f.advance(60000)
    assert.deepEqual(f.calls, ["check", ["install", true, true]])
  }
})
test("다운로드 완료 후 뒤늦은 오류·확인 이벤트가 자동 적용을 취소하지 않음", () => {
  const f = fixture()
  f.downloaded(); f.updater.emit("error", new Error("late"))
  f.updater.emit("checking-for-update"); f.updater.emit("update-not-available")
  assert.equal(f.handle.state().phase, "ready")
  f.advance(30 * 60000); assert.deepEqual(f.calls, [["install", true, true]])
})
test("다운로드 실패 뒤 다음 확인에서는 다시 시도", async () => {
  const f = fixture()
  f.updater.emit("update-available", { version: "0.1.8" }); f.updater.emit("error", new Error("offline"))
  await f.handle.check(); assert.deepEqual(f.calls, ["check"])
})
test("다운로드 취소 뒤 다음 확인에서 다시 시도", async () => {
  const f = fixture()
  f.updater.emit("update-available", { version: "0.1.8" }); f.updater.emit("update-cancelled")
  await f.handle.check(); assert.deepEqual(f.calls, ["check"])
})
test("설치 오류 이벤트 뒤 종료 상태를 복원하고 1분 후 다시 적용", () => {
  let restored = 0
  const f = fixture({ installFailed: () => { restored++ } })
  f.setHidden(true); f.downloaded(); f.updater.emit("error", new Error("installer unavailable"))
  assert.equal(restored, 1); assert.equal(f.handle.state().phase, "ready")
  f.advance(60000); assert.deepEqual(f.calls, [["install", true, true], ["install", true, true]])
})
test("설치 호출 자체가 예외를 던져도 1분 뒤 재시도", () => {
  let attempts = 0, restored = 0
  const f = fixture({ installFailed: () => { restored++ } })
  f.updater.quitAndInstall = () => { attempts++; if (attempts === 1) throw new Error("installer unavailable") }
  f.setHidden(true); f.downloaded(); assert.equal(restored, 1)
  f.advance(60000); assert.equal(attempts, 2)
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
