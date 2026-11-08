const RETRY_MS = 60 * 1000
const MAX_WAIT_MS = 30 * 60 * 1000
const NOTICE_MS = 10 * 1000

function canApplyUpdate(idleSeconds, hidden) {
  return hidden || (Number.isFinite(idleSeconds) && idleSeconds >= 120)
}

// 설치 버전과 공개 정책을 SemVer 순서로 비교한다. 잘못된 정책은 무시한다.
function belowMinimum(current, minimum) {
  const parse = value => {
    if (typeof value !== "string") return null
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value)
    if (!match) return null
    const pre = match[4]?.split(".")
    if (pre?.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null
    return { core: match.slice(1, 4).map(BigInt), pre }
  }
  const a = parse(current), b = parse(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i]
  }
  if (!a.pre || !b.pre) return Boolean(a.pre && !b.pre)
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) < BigInt(y)
    return xn !== yn ? xn : x < y
  }
  return false
}

/** 열톡과 별도 피드. 다운로드 뒤 유휴·숨김 때 적용하고 최대 30분만 기다린다. */
function connectUpdater(updater, {
  changed = () => {}, log = () => {}, currentVersion, readPolicy = async () => null,
  getIdleTime = () => 0, isHidden = () => false, beforeInstall = () => {}, installFailed = () => {}, notify = () => {},
  now = Date.now, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let state = { phase: "idle", label: "업데이트 확인", version: null }
  let checking = false, forced = false, installing = false, downloadedAt = null, timer = null, notified = false
  const set = (phase, label, version = state.version) => { state = { phase, label, version }; changed(state) }
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null }
  const later = delay => {
    clearTimer()
    timer = schedule(considerInstall, delay)
    timer?.unref?.()
  }
  const install = () => {
    if (downloadedAt === null || installing) return
    clearTimer()
    installing = true
    try {
      beforeInstall()
      updater.quitAndInstall(true, true)
    } catch {
      installing = false
      installFailed()
      log("update-install-failed")
      later(RETRY_MS)
    }
  }
  function considerInstall() {
    if (downloadedAt === null || installing) return
    let safe = false
    try { safe = canApplyUpdate(getIdleTime(), isHidden()) } catch {}
    const remaining = downloadedAt + MAX_WAIT_MS - now()
    if (forced || safe || remaining <= 0) { install(); return }
    if (remaining <= NOTICE_MS && !notified) {
      notified = true
      try { notify("새 버전으로 자동 재시작해요") } catch { log("update-notice-failed") }
    }
    later(Math.min(RETRY_MS, remaining > NOTICE_MS ? remaining - NOTICE_MS : remaining))
  }
  const failed = () => {
    // 다운로드가 끝난 설치본은 후속 피드/통신 오류가 나도 적용 대기를 유지한다.
    if (installing) {
      installing = false
      installFailed()
      later(RETRY_MS)
    }
    if (downloadedAt === null) set("error", "업데이트 연결 확인 필요 · 다시 확인")
    log("update-check-failed")
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.autoRunAppAfterInstall = true
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.on("checking-for-update", () => { if (downloadedAt === null) set("checking", "업데이트 확인 중") })
  updater.on("update-available", info => { if (downloadedAt === null) set("downloading", "새 버전 다운로드 중", info.version) })
  updater.on("update-not-available", () => { if (downloadedAt === null) set("current", "최신 버전 · 다시 확인") })
  updater.on("update-downloaded", info => {
    if (downloadedAt === null) downloadedAt = now()
    set("ready", "새 버전 준비됨 · 자동 적용 대기", info.version)
    considerInstall()
  })
  updater.on("error", failed)
  updater.on("update-cancelled", failed)
  return {
    state: () => ({ ...state }),
    check: async () => {
      if (checking || installing) return
      checking = true
      try {
        // ready/downloading이어도 정책은 매번 읽는다. 실패·404는 조용히 무시한다.
        try {
          const policy = await readPolicy()
          forced = forced || belowMinimum(currentVersion, policy?.minVersion)
        } catch {}
        if (downloadedAt !== null) { considerInstall(); return }
        if (state.phase !== "downloading") await updater.checkForUpdates()
      } catch { failed() }
      finally { checking = false }
    },
    install,
  }
}
module.exports = { connectUpdater, canApplyUpdate, belowMinimum }
