const test = require("node:test"), assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { connectNavigation } = require("../navigation.cjs")
const { BASE, START } = require("../rules.cjs")

test("업무 하위 프레임의 필터·상세·해시 이동은 외부 창과 슬랙 재로딩을 만들지 않는다", () => {
  const calls = [], win = { webContents: new EventEmitter(), loadURL: async url => calls.push(url) }
  connectNavigation(win, { openExternal: url => calls.push(url), show: (_win, url) => calls.push(url), loadURL: (_win, url) => calls.push(url) })
  for (const path of ["/tasks", "/tasks?status=DONE", "/tasks/task1#detail", "/dashboard"]) {
    win.webContents.emit("did-navigate-in-page", {}, BASE + path, false)
  }
  assert.deepEqual(calls, [])
  win.webContents.emit("did-navigate-in-page", {}, BASE + "/tasks", true)
  assert.deepEqual(calls, [BASE + "/tasks", START])
  calls.length = 0
  win.webContents.emit("did-navigate", {}, BASE + "/dashboard")
  assert.deepEqual(calls, [START])
})
