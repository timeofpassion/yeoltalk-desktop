const test = require("node:test"), assert = require("node:assert/strict")
const { createCircuitBreaker } = require("../circuit-breaker.cjs")

test("같은 출처의 외부 열기·팝업 6번째부터 5분간 모든 동작 차단", () => {
  for (const [kind, limit] of [["external", 5], ["popup", 5]]) {
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

test("RSC는 같은 경로의 2초 폭주를 차단하며 쿼리 변경으로 우회하지 못한다", () => {
  let time = 0
  const allow = createCircuitBreaker({now:()=>time})
  for(let i=0;i<10;i++) assert.equal(allow("rsc", `https://same.test/ceo?_rsc=${i}`), true)
  assert.equal(allow("rsc", "https://same.test/finance"), true)
  assert.equal(allow("rsc", "https://same.test/ceo?_rsc=next"), false)
  assert.equal(allow("popup", "https://same.test/tasks"), false)
  time = 300000
  assert.equal(allow("rsc", "https://same.test/ceo"), true)
})


test("같은 경로 문서 이동은 10초 안 6번째부터 출처 전체 5분 차단", () => {
  let time = 0
  const logs = [], allow = createCircuitBreaker({ now: () => time, log: value => logs.push(value) })
  for (let i = 0; i < 5; i++) assert.equal(allow("load", `https://same.test/tasks?secret=${i}#${i}`), true)
  time = 9999
  assert.equal(allow("load", "https://same.test/tasks?secret=next"), false)
  for (const kind of ["load", "external", "popup", "rsc"]) assert.equal(allow(kind, "https://same.test/other"), false)
  assert.equal(allow("load", "https://other.test/tasks"), true)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].includes("secret"), false)
  time += 299999
  assert.equal(allow("load", "https://same.test/other"), false)
  time++
  assert.equal(allow("load", "https://same.test/tasks"), true)
})

test("다른 경로 30회 통과, 총량 60초 41번째 차단", () => {
  const allow = createCircuitBreaker({ now: () => 0 })
  for (let i = 0; i < 30; i++) assert.equal(allow("load", `https://same.test/tasks/${i}`), true)
  for (let i = 30; i < 40; i++) assert.equal(allow("load", `https://same.test/tasks/${i}`), true)
  assert.equal(allow("load", "https://same.test/tasks/40"), false)
  assert.equal(allow("popup", "https://same.test/other"), false)
})

test("경로 10초와 총량 60초 경계에서 오래된 요청 제외", () => {
  let time = 0
  const allow = createCircuitBreaker({ now: () => time })
  for (let i = 0; i < 5; i++) assert.equal(allow("load", "https://same.test/tasks"), true)
  time = 10000
  assert.equal(allow("load", "https://same.test/tasks"), true)
  for (let i = 0; i < 34; i++) assert.equal(allow("load", `https://same.test/path/${i}`), true)
  time = 60000
  for (let i = 0; i < 5; i++) assert.equal(allow("load", `https://same.test/new/${i}`), true)
  assert.equal(allow("load", "https://same.test/overflow"), false)
})
