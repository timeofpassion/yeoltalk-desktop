const test = require("node:test"), assert = require("node:assert/strict")
const { BASE, START, PARTITION, classifyUrl, returnAfterLogin, roomLink, notificationCandidates, alertHours } = require("../rules.cjs")
test("내부 슬랙·열톡은 같은 서버를 쓰고 기존 열톡 프로필과 분리", () => {
  assert.equal(START, BASE + "/slack"); assert.equal(PARTITION, "persist:passion-slack")
})
test("로그인 후 대시보드에서 각 원래 창으로 복귀", () => {
  assert.equal(returnAfterLogin(BASE + "/dashboard"), START)
  assert.equal(returnAfterLogin(BASE + "/dashboard", true), BASE + "/talk")
  assert.equal(returnAfterLogin(BASE + "/login"), null)
  assert.equal(returnAfterLogin(BASE + "/slack?c=room"), null)
})
test("외부 링크를 앱 안에서 실행하지 않고 위험 스킴·주소 자격증명 차단", () => {
  assert.equal(classifyUrl(BASE + "/slack"), "internal")
  assert.equal(classifyUrl("https://example.org"), "external")
  for (const url of ["javascript:alert(1)", "file:///C:/Windows/a.exe", "data:text/html,test", "https://user:pass@intranet.timeofpassion.com"]) assert.equal(classifyUrl(url), "blocked")
})
test("알림 링크는 큰 슬랙의 동일한 방으로 연결", () => {
  assert.equal(roomLink("room1"), START + "?c=room1")
  assert.equal(roomLink("../../bad"), START)
})
test("첫 로그인 과거 알림·일반 채널 잡담·중복 알림 제외, 음소거여도 새 직접 멘션은 알림", () => {
  const rooms = [{ id: "channel", kind: "channel", lastAt: "2", unread: 5, mentioned: 1, muted: true }, { id: "dm", kind: "dm", lastAt: "2", unread: 1 }]
  assert.deepEqual(notificationCandidates(null, rooms), [])
  const before = new Map([["channel", { lastAt: "1", mentioned: 0 }], ["dm", { lastAt: "1", mentioned: 0 }]])
  assert.equal(notificationCandidates(before, rooms).length, 2)
  const same = new Map(rooms.map(r => [r.id, { lastAt: r.lastAt, mentioned: r.mentioned }]))
  assert.equal(notificationCandidates(same, rooms).length, 0)
  same.set("channel", { lastAt: "1", mentioned: 1 })
  assert.equal(notificationCandidates(same, rooms).length, 0)
})
test("기존 근무시간과 동일한 한국시간 평일09~19시 알림", () => {
  assert.equal(alertHours(new Date("2026-11-02T09:30:00+09:00")), true)
  assert.equal(alertHours(new Date("2026-10-31T09:30:00+09:00")), false)
  assert.equal(alertHours(new Date("2026-11-02T19:00:00+09:00")), false)
})
