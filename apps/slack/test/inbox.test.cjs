const test = require("node:test"), assert = require("node:assert/strict")
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path")

function harness() {
  let rows = [], ok = true, contextMenu
  const badge = [], overlays = [], urls = [], notices = [], fetches = []
  const names = { employees: [{ id: "peer", name: "시험 직원" }] }
  const win = { isDestroyed: () => false, isFocused: () => false, isMinimized: () => false, show() {}, focus() {}, flashFrame() {},
    loadURL: async url => { urls.push(url) }, setOverlayIcon: (image, label) => overlays.push({ image, label }),
    webContents: { session: { fetch: async url => { fetches.push(url); return { ok, headers: { get: () => "application/json" }, json: async () => url.includes("bootstrap") ? names : rows } } } } }
  const tray = { setToolTip() {}, setContextMenu: menu => { contextMenu = menu }, setImage() {} }
  class Notification { static isSupported() { return true }; constructor(value) { notices.push(value) }; on() {}; show() {} }
  const electron = { app: { setName() {}, setPath() {}, getPath: () => "fixture", setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() {},
    setBadgeCount: n => badge.push(n), getLoginItemSettings: () => ({ openAtLogin: false }) }, Notification,
    Menu: { buildFromTemplate: rows => rows, setApplicationMenu() {} },
    nativeImage: { createFromPath: filename => ({ filename, resize() { return this } }) } }
  const root = path.resolve(__dirname, ".."), sandbox = { fixture: { win, tray }, __dirname: root, console, Map, Date, AbortSignal,
    require: id => id === "electron" ? electron : id === "./rules.cjs" ? { ...require("../rules.cjs"), alertHours: () => true } : id === "./updater.cjs" ? {} : require(id) }
  vm.runInNewContext(fs.readFileSync(path.join(root, "main.cjs"), "utf8") +
    "\nmainWindow=fixture.win;tray=fixture.tray;this.api={poll,refreshMenus};", sandbox)
  return { ...sandbox.api, badge, overlays, urls, notices, fetches, setRows: value => { rows = value }, fail: () => { ok = false }, menu: () => contextMenu }
}
const room = overrides => ({ id: "room", kind: "dm", name: "me:peer", otherId: "peer", unread: 2, slackUnread: 2, mentioned: 0, lastAt: "2026-10-30T08:00:00Z", hidden: false, muted: false, ...overrides })

test("동일 방의 슬랙 이관 글2개와 내부 글2개를 합쳐4개로 표시하고 방 메뉴로 연결", async () => {
  const h = harness(); h.setRows([room()]); await h.poll()
  assert.equal(h.badge.at(-1), 4)
  assert.match(h.overlays.at(-1).label, /4/)
  const unread = h.menu().find(x => x.label?.startsWith("안 읽은 대화"))
  assert.ok(unread)
  assert.match(unread.submenu[0].label, /시험 직원.*4/)
  unread.submenu[0].click()
  assert.equal(h.urls.at(-1), "https://intranet.timeofpassion.com/slack?c=room")
})
test("읽은 뒤 숫자와 이동 목록이 함께 비워지며 숨김방은 집계하지 않는다", async () => {
  const h = harness(); h.setRows([room(), room({ id: "hidden", hidden: true, unread: 12 })]); await h.poll()
  h.setRows([room({ unread: 0, slackUnread: 0 })]); await h.poll()
  assert.equal(h.badge.at(-1), 0)
  assert.equal(h.overlays.at(-1).image, null)
  const unread = h.menu().find(x => x.label?.startsWith("안 읽은 대화"))
  assert.equal(unread.enabled, false)
})
test("세션이 만료되면 이전 계정의 배지와 대화 이동 목록을 지운다", async () => {
  const h = harness(); h.setRows([room()]); await h.poll(); h.fail(); await h.poll()
  assert.equal(h.badge.at(-1), 0)
  assert.equal(h.menu().find(x => x.label?.startsWith("안 읽은 대화")).enabled, false)
})
test("음소거방 직접멘션을 유지하고 DM 알림에 상대 이름을 표시한다", async () => {
  const h = harness(); h.setRows([room({ muted: true, unread: 1, mentioned: 1, slackUnread: 4 })]); await h.poll()
  assert.equal(h.badge.at(-1), 1)
  h.setRows([room({ lastAt: "2026-10-30T08:01:00Z", unread: 3 })]); await h.poll()
  assert.match(h.notices.at(-1).title, /시험 직원/)
})
test("직원 목록에 없는 옛 상대 때문에 매15초 전체 프로필을 다시 요청하지 않는다", async () => {
  const h = harness(); h.setRows([room({ otherId: "inactive" })]); await h.poll(); await h.poll(); await h.poll()
  assert.equal(h.fetches.filter(url => url.includes("bootstrap")).length, 1)
  assert.equal(h.badge.at(-1), 4)
})
