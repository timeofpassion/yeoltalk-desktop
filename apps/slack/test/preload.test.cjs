const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path")
test("웹 레이아웃을 숨기지 않고 OS 권한도 노출하지 않는다", () => {
  const styles = [], exposed = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.cjs"), "utf8"), {
    process: { argv: ["electron", "--app-version=9.8.7"] },
    require(name) {
      assert.equal(name, "electron")
      return { webFrame: { insertCSS: css => { styles.push(css); return "style" } },
        contextBridge: { exposeInMainWorld: (...args) => exposed.push(args) } }
    },
  })
  assert.equal(exposed[0][1].version, "9.8.7")
  assert.equal(exposed[0][1].product, "passion-slack")
  assert.equal(styles.length, 0)
  assert.deepEqual(Object.keys(exposed[0][1]).sort(), ["product", "version"])
})
