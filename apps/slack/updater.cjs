/** 열톡과 별도 피드. 새 버전은 백그라운드에서 받고 명시적 종료/재시작에만 적용. */
function connectUpdater(updater, { changed = () => {}, log = () => {} } = {}) {
  let state = { phase: "idle", label: "업데이트 확인", version: null }
  let checking = false
  const set = (phase, label, version = state.version) => { state = { phase, label, version }; changed(state) }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.autoRunAppAfterInstall = true
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.on("checking-for-update", () => set("checking", "업데이트 확인 중"))
  updater.on("update-available", info => set("downloading", "새 버전 다운로드 중", info.version))
  updater.on("update-not-available", () => set("current", "최신 버전 · 다시 확인"))
  updater.on("update-downloaded", info => set("ready", "새 버전 준비됨 · 재시작해 적용", info.version))
  updater.on("error", () => { set("error", "업데이트 연결 확인 필요 · 다시 확인"); log("update-check-failed") })
  return {
    state: () => ({ ...state }),
    check: async () => {
      if (checking || ["ready", "downloading"].includes(state.phase)) return
      checking = true
      try { await updater.checkForUpdates() }
      catch { set("error", "업데이트 연결 확인 필요 · 다시 확인"); log("update-check-failed") }
      finally { checking = false }
    },
    install: () => { if (state.phase === "ready") updater.quitAndInstall(false, true) },
  }
}
module.exports = { connectUpdater }
