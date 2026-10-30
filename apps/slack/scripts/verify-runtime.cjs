// Electron 실제 세션/업데이트 전송 검증. 회사 계정·운영 데이터·설치 레지스트리를 건드리지 않는다.
const { app, session } = require("electron")
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto"), assert = require("node:assert/strict")
const { PARTITION } = require("../rules.cjs")
const mode = process.argv[2], evidence = process.argv[3]
if (!evidence || !path.isAbsolute(evidence)) throw new Error("검증 전용 절대 경로가 필요합니다")
fs.mkdirSync(evidence, { recursive: true })
app.setPath("userData", path.join(evidence, "isolated-profile"))
app.whenReady().then(async () => {
  if (mode === "session-write") {
    const s = session.fromPartition(PARTITION)
    await s.cookies.set({ url: "https://fixture.invalid", name: "fixture-session", value: "test-only-not-a-company-login", expirationDate: Date.now() / 1000 + 3600, secure: true, httpOnly: true })
    await s.cookies.flushStore()
    fs.writeFileSync(path.join(evidence, "session-write.json"), JSON.stringify({ persistentPartition: PARTITION, fixtureOnly: true }))
  } else if (mode === "session-read") {
    const cookies = await session.fromPartition(PARTITION).cookies.get({ url: "https://fixture.invalid" })
    assert.equal(cookies.find(c => c.name === "fixture-session")?.value, "test-only-not-a-company-login")
    fs.writeFileSync(path.join(evidence, "session-read.json"), JSON.stringify({ persistedAcrossRestart: true, realEmployeeLogin: false }))
  } else if (mode === "update-download") {
    const dist = path.resolve(__dirname, "../dist"), file = "passion-slack-setup-0.1.0.exe"
    const source = path.join(dist, file)
    const server = http.createServer((req, res) => {
      const requested = new URL(req.url, "http://localhost").pathname
      if (requested === "/latest.yml") { res.setHeader("content-type", "text/yaml"); fs.createReadStream(path.join(dist, "latest.yml")).pipe(res) }
      else if (requested === "/" + file) { res.setHeader("content-length", fs.statSync(source).size); fs.createReadStream(source).pipe(res) }
      else { res.statusCode = 404; res.end() }
    })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
      const { NsisUpdater } = require("electron-updater")
      const { ElectronHttpExecutor } = require("electron-updater/out/electronHttpExecutor")
      const adapter = { version: "0.0.9", name: "passion-slack-runtime-test", isPackaged: true,
        userDataPath: evidence, baseCachePath: path.join(evidence, "cache"), appUpdateConfigPath: path.join(dist, "win-unpacked/resources/app-update.yml"),
        whenReady: async () => {}, relaunch() { throw new Error("시험 중 설치/재시작 금지") }, quit() {}, onQuit() {} }
      const updater = new NsisUpdater(null, adapter)
      updater.httpExecutor = new ElectronHttpExecutor(() => {})
      updater.setFeedURL({ provider: "generic", url: `http://127.0.0.1:${server.address().port}/` })
      updater.autoInstallOnAppQuit = false
      updater.disableDifferentialDownload = true
      updater.disableWebInstaller = true
      updater.logger = { info() {}, warn() {}, error() {} }
      const result = await updater.checkForUpdates()
      assert.equal(result.updateInfo.version, "0.1.0")
      const files = await result.downloadPromise
      const hash = filename => crypto.createHash("sha512").update(fs.readFileSync(filename)).digest("hex")
      assert.equal(hash(files[0]), hash(source))
      fs.writeFileSync(path.join(evidence, "update-download.json"), JSON.stringify({ simulatedOldClientVersion: adapter.version, downloadedVersion: result.updateInfo.version,
        actualInstallerBytes: fs.statSync(source).size, integrityMatched: true, source: "isolated-local-server", installerExecuted: false, productionFeedTested: false }))
    } finally { await new Promise(resolve => server.close(resolve)) }
  } else throw new Error("알 수 없는 검증 단계")
  app.quit()
}).catch(error => { fs.writeFileSync(path.join(evidence, `error-${mode}.txt`), error.stack); app.exit(1) })
