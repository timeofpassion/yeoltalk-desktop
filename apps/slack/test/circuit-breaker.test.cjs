const test = require("node:test"), assert = require("node:assert/strict")
const { createCircuitBreaker } = require("../circuit-breaker.cjs")

test("같은 출처의 외부 열기 6번째·로딩 11번째부터 5분간 두 동작 모두 차단", () => {
  for (const [kind, limit] of [["external", 5], ["load", 10]]) {
    let time = 0
    const logs = [], allow = createCircuitBreaker({ now: () => time, log: value => logs.push(value) })
    for (let i = 0; i < limit; i++) assert.equal(allow(kind, `https://same.test/tasks/${i}?secret=hidden`), true)
    assert.equal(allow(kind, "https://same.test/slack"), false)
    assert.equal(allow("external", "https://same.test/other"), false)
    assert.equal(allow("load", "https://same.test/other"), false)
    assert.equal(allow(kind, "https://other.test/tasks"), true)
    assert.equal(logs.length, 1); assert.equal(logs[0].includes("secret"), false)
    time = 299999; assert.equal(allow(kind, "https://same.test/tasks"), false)
    time = 300000; assert.equal(allow(kind, "https://same.test/tasks"), true)
  }
})
test("60초 이동 구간 집계이며 차단 시도는 5분 종료 시점을 늘리지 않음", () => {
  let time = 0
  const allow = createCircuitBreaker({ now: () => time })
  for (let i = 0; i < 5; i++) assert.equal(allow("external", "https://same.test/tasks"), true)
  time = 60000; assert.equal(allow("external", "https://same.test/tasks"), true)
  time = 119999
  for (let i = 0; i < 4; i++) assert.equal(allow("external", "https://same.test/tasks"), true)
  assert.equal(allow("external", "https://same.test/tasks"), false)
  time += 299999; assert.equal(allow("external", "https://same.test/tasks"), false)
  time++; assert.equal(allow("external", "https://same.test/tasks"), true)
})
test("잘못된 주소는 차단하고 다른 포트·프로토콜은 별도 출처로 취급", () => {
  const allow = createCircuitBreaker()
  assert.equal(allow("external", "invalid"), false)
  for (let i = 0; i < 5; i++) allow("external", "https://same.test")
  assert.equal(allow("external", "https://same.test"), false)
  assert.equal(allow("external", "http://same.test"), true)
  assert.equal(allow("external", "https://same.test:444"), true)
})
