const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm")

test("새 설치용 고정 파일도 같은 바이트를 올리고 자동 업데이트 안내는 마지막에 공개", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/publish.cjs"), "utf8")
  const bytes = Buffer.from("격리된 설치파일"), calls = [], copies = []
  const version = require("../package.json").version
  const digest = crypto.createHash("sha512").update(bytes).digest("base64")
  vm.runInNewContext(source, {
    __dirname: path.join(__dirname, "../scripts"), console: { log() {} },
    process: { argv: ["node", "publish.cjs", "--publish"], env: { GITHUB_ACTIONS: "true" } },
    require(id) {
      if (id === "../package.json") return { version }
      if (id === "node:fs") return {
        readFileSync(file) {
          if (file.endsWith("previous-latest.yml")) return "version: 0.1.4\n"
          if (file.endsWith("latest.yml")) return `version: ${version}\npath: passion-slack-setup-${version}.exe\nsha512: ${digest}\n`
          return bytes
        },
        copyFileSync: (from, to) => copies.push([path.basename(from), path.basename(to)]),
      }
      if (id === "node:child_process") return { execFileSync(command, args) { assert.equal(command, "gh"); calls.push([...args]); return "" } }
      return require(id)
    },
  })
  assert.deepEqual(copies, [[`passion-slack-setup-${version}.exe`, "passion-slack-setup.exe"]])
  const uploads = calls.filter(args => args[1] === "upload")
  assert.equal(uploads.length, 3)
  assert.ok(uploads[0].some(value => value.endsWith(`passion-slack-setup-${version}.exe`)))
  assert.ok(uploads[1].some(value => value.endsWith("passion-slack-setup.exe")))
  assert.ok(uploads[2].some(value => value.endsWith("latest.yml")))
})
