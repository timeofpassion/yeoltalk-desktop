const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path")
test("화면 생성 전에 공통 메뉴·자동 열톡 패널을 제거하는 스타일을 넣고 OS 권한을 노출하지 않는다", () => {
  const styles = [], exposed = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.cjs"), "utf8"), {
    require(name) {
      assert.equal(name, "electron")
      return { webFrame: { insertCSS: css => { styles.push(css); return "style" } },
        contextBridge: { exposeInMainWorld: (...args) => exposed.push(args) } }
    },
  })
  assert.equal(styles.length, 1)
  assert.match(styles[0], /\[data-chrome\][^{]*\{[^}]*display:\s*none\s*!important/)
  assert.match(styles[0], /main\[data-main\][^{]*\{[^}]*margin-left:\s*0\s*!important/)
  assert.deepEqual(Object.keys(exposed[0][1]).sort(), ["product", "version"])
})
