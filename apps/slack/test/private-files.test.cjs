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
