const test = require("node:test"), assert = require("node:assert/strict")
const { BASE, START, PARTITION, classifyUrl, returnAfterLogin, roomLink, notificationCandidates, alertHours, requestDecision } = require("../rules.cjs")

test("같은 출처의 모든 화면은 서버 권한으로 앱 안에서 연다", () => {
  for (const p of ["/slack?c=mine", "/talk", "/talk/room123", "/login", "/api/auth/callback/credentials"]) assert.equal(classifyUrl(BASE + p), "internal")
  for (const p of ["/ceo", "/best3", "/control", "/settings", "/payroll", "/finance/bank", "/slack-other"]) assert.equal(classifyUrl(BASE + p), "internal")
  for (const p of ["/clients/1", "/approvals/my-doc", "/tasks/my-task", "/docs/my-doc"]) assert.equal(classifyUrl(BASE + p), "internal")
})

test("페이지 이동과 SPA 서버 렌더링도 창 경계를 지키되 채팅 API·파일은 유지", () => {
  assert.deepEqual(requestDecision({ url: BASE + "/dashboard", resourceType: "mainFrame" }), {})
  assert.deepEqual(requestDecision({ url: BASE + "/ceo?_rsc=abc", resourceType: "xhr", requestHeaders: { RSC: "1" } }), {})
  assert.deepEqual(requestDecision({ url: BASE + "/api/chat/inbox", resourceType: "xhr" }), {})
  assert.deepEqual(requestDecision({ url: "https://files.example.org/a.pdf", resourceType: "xhr" }), {})
  assert.deepEqual(requestDecision({ url: BASE + "/slack?c=mine", resourceType: "mainFrame" }), {})
})
test("내부 슬랙·열톡은 같은 서버를 쓰고 기존 열톡 프로필과 분리", () => {
  assert.equal(START, BASE + "/slack"); assert.equal(PARTITION, "persist:passion-slack")
})
test("일반 홈 이동은 슬랙으로 되돌리지 않는다", () => {
  assert.equal(returnAfterLogin(BASE + "/dashboard"), null)
  assert.equal(returnAfterLogin(BASE + "/dashboard", true), null)
  assert.equal(returnAfterLogin(BASE + "/login"), null)
  assert.equal(returnAfterLogin(BASE + "/slack?c=room"), null)
})

test("기존 열톡 링크의 방·검색·스레드 정보를 통합 슬랙에 전달", () => {
  assert.equal(returnAfterLogin(BASE + "/talk"), START)
  assert.equal(returnAfterLogin(BASE + "/talk?c=room123&thread=msg1"), START + "?c=room123&m=msg1")
  assert.equal(returnAfterLogin(BASE + "/talk/room123?c=other&thread=msg1#message"), START + "?c=room123&m=msg1#message")
  assert.equal(returnAfterLogin(BASE + "/talk/../../ceo"), null)
  assert.equal(returnAfterLogin("https://example.org/talk/room123"), null)
})

test("옛 thread를 슬랙의 메시지 m으로 변환하고 기존 m이 있으면 우선", () => {
  assert.equal(returnAfterLogin(BASE + "/talk/room123?thread=msg1"), START + "?c=room123&m=msg1")
  assert.equal(returnAfterLogin(BASE + "/talk/room123?c=other&thread=msg1&m=msg2"), START + "?c=room123&m=msg2")
  assert.equal(returnAfterLogin(BASE + "/talk?c=room123&m=msg2"), START + "?c=room123&m=msg2")
})

test("옛 열톡 페이지 요청도 별도 창 없이 같은 방의 슬랙으로 이동", () => {
  assert.deepEqual(requestDecision({ url: BASE + "/talk/room123", resourceType: "mainFrame" }), { redirectURL: START + "?c=room123" })
  assert.deepEqual(requestDecision({ url: BASE + "/talk?c=room123", resourceType: "mainFrame" }), { redirectURL: START + "?c=room123" })
  assert.deepEqual(requestDecision({ url: BASE + "/talk/room123?thread=msg1", resourceType: "mainFrame" }), { redirectURL: START + "?c=room123&m=msg1" })
  assert.deepEqual(requestDecision({ url: BASE + "/talk/room123?c=other&thread=msg1&m=msg2", resourceType: "mainFrame" }), { redirectURL: START + "?c=room123&m=msg2" })
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


test("업무·대표실·재무의 문서와 RSC 요청을 허용한다", () => {
  for (const p of ["/tasks?_rsc=fixture", "/tasks/test-task?_rsc=fixture", "/tasks?status=DONE"]) {
    assert.deepEqual(requestDecision({url:BASE+p, resourceType:"xhr", requestHeaders:{RSC:"1"}}), {})
  }
  assert.deepEqual(requestDecision({url:BASE+"/tasks",resourceType:"mainFrame"}), {})
  for (const p of ["/tasks-other?_rsc=fixture", "/ceo?_rsc=fixture", "/finance/bank?_rsc=fixture"]) {
    assert.deepEqual(requestDecision({url:BASE+p,resourceType:"xhr",requestHeaders:{RSC:"1"}}), {})
  }
  assert.deepEqual(requestDecision({url:"https://example.org/tasks?_rsc=fixture",resourceType:"xhr"}), {cancel:true})
})

test("옛 열톡 RSC만 취소하고 문서 요청에서 한 번 변환한다", () => {
  for (const p of ["/talk?_rsc=a", "/talk/room1?_rsc=a"]) {
    assert.deepEqual(requestDecision({ url: BASE + p, resourceType: "xhr", requestHeaders: { RSC: "1" } }), { cancel: true })
  }
  assert.deepEqual(requestDecision({ url: BASE + "/dashboard", resourceType: "mainFrame" }), {})
  assert.deepEqual(requestDecision({ url: BASE + "/slack?_rsc=a", resourceType: "xhr", requestHeaders: { RSC: "1" } }), {})
})
test("업무 RSC는 상위·하위 프레임 모두 허용한다", () => {
  const rsc = { url: BASE + "/tasks?status=DONE&_rsc=a", resourceType: "xhr", requestHeaders: { RSC: "1" } }
  assert.deepEqual(requestDecision({ ...rsc, frame: { parent: {} } }), {})
  assert.deepEqual(requestDecision({ ...rsc, frame: { parent: null } }), {})
  assert.deepEqual(requestDecision({ ...rsc, frame: { get parent() { throw new Error("닫힌 프레임") } } }), {})
})

test("로그인 복귀는 창별 한 번만, 콜백 검증·API·홈 이동 유지", () => {
  const { createLoginReturn } = require("../rules.cjs")
  const request = (fn, p, type = "mainFrame") => fn({url: BASE + p, resourceType: type})
  const login = createLoginReturn()
  request(login, "/approvals/doc?tab=mine")
  request(login, "/login")
  assert.equal(request(login, "/api/chat/inbox", "xhr"), null)
  assert.deepEqual(request(login, "/dashboard?_rsc=a", "xhr"), {cancel:true})
  assert.deepEqual(request(login, "/dashboard"), {redirectURL:BASE+"/approvals/doc?tab=mine"})
  assert.equal(request(login, "/dashboard"), null)
  assert.equal(request(login, "/"), null)
  const fresh = createLoginReturn()
  request(fresh, "/login?callbackUrl=https%3A%2F%2Fevil.test")
  assert.deepEqual(request(fresh, "/dashboard"), {redirectURL:START})
  const direct = createLoginReturn()
  request(direct, "/login?callbackUrl=%2Fceo")
  assert.deepEqual(request(direct, "/"), {redirectURL:BASE+"/ceo"})
})

test("SPA 목적지는 로그인 복귀에 보존하되 로그인 프리페치는 무시", () => {
  const login = require("../rules.cjs").createLoginReturn()
  const rsc = (p, headers = {}) => login({url:BASE+p,resourceType:"xhr",requestHeaders:{RSC:"1",...headers}})
  rsc("/login?_rsc=a", {"Next-Router-Prefetch":"1"})
  assert.equal(rsc("/ceo?_rsc=a"), null)
  rsc("/login?_rsc=b")
  assert.deepEqual(rsc("/dashboard?_rsc=c"), {cancel:true})
  assert.deepEqual(login({url:BASE+"/dashboard",resourceType:"mainFrame"}), {redirectURL:BASE+"/ceo"})
})
