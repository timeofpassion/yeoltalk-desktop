const BASE = "https://intranet.timeofpassion.com"
const START = `${BASE}/slack`
const PARTITION = "persist:passion-slack"
function classifyUrl(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return "blocked"
    if (url.origin === BASE) {
      if (url.pathname.startsWith("/api/chat/files/v1/")) {
        return /^\/api\/chat\/files\/v1\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9][A-Za-z0-9._-]{0,220}$/.test(url.pathname) && [...url.searchParams.keys()].every(k => k === "download") && url.searchParams.getAll("download").length <= 1 ? "attachment" : "blocked"
      }
      return "internal"
    }
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "blocked"
  } catch { return "blocked" }
}
// 0.1.8: 이동 완료 후 다시 열지 않고 요청 전에만 판정한다.
function requestDecision(details) {
  let url
  try { url = new URL(details.url) } catch { return { cancel: true } }
  const page = details.resourceType === "mainFrame" || url.searchParams.has("_rsc") ||
    Object.entries(details.requestHeaders || {}).some(([k, v]) => k.toLowerCase() === "rsc" && v === "1")
  if (!page) return {}
  const target = returnAfterLogin(details.url)
  if (target) return details.resourceType === "mainFrame" ? { redirectURL: target } : { cancel: true }
  const kind = classifyUrl(details.url)
  return kind === "internal" || (kind === "attachment" && details.resourceType === "mainFrame") ? {} : { cancel: true }
}
// 창별 로그인 전 주소를 보관한다. RSC 프리페치는 로그인 완료로 취급하지 않는다.
function createLoginReturn() {
  let intended = null, pending = false
  return details => {
    const url = new URL(details.url)
    if (classifyUrl(url.href) !== "internal") return null
    const main = details.resourceType === "mainFrame"
    const rsc = url.searchParams.has("_rsc") || Object.entries(details.requestHeaders || {}).some(([k, v]) => k.toLowerCase() === "rsc" && v === "1")
    const prefetch = Object.entries(details.requestHeaders || {}).some(([k, v]) =>
      (k.toLowerCase() === "next-router-prefetch" && v === "1") || (k.toLowerCase() === "purpose" && v === "prefetch"))
    if (!main && (!rsc || prefetch || details.frame?.parent)) return null
    if (isLoginPath(url.pathname)) {
      if (!pending) {
        pending = true
        const callback = url.searchParams.get("callbackUrl")
        if (callback) {
          try {
            const target = new URL(callback, BASE)
            if (classifyUrl(target.href) === "internal" && !isLoginPath(target.pathname)) intended = target.href
          } catch {}
        }
      }
      return null
    }
    if (pending) {
      if (!main) return { cancel: true }
      pending = false
      const target = returnAfterLogin(intended || START) || intended || START
      intended = url.href
      return target === url.href ? null : { redirectURL: target }
    }
    url.searchParams.delete("_rsc")
    intended = url.href
    return null
  }
}
function isLoginPath(pathname) {
  return ["/login", "/change-password", "/auth-error", "/api/auth"].some(p => pathname === p || pathname.startsWith(p + "/"))
}
// 옛 열톡 주소만 변환한다. 일반 홈 이동은 그대로 둔다.
function returnAfterLogin(value) {
  if (classifyUrl(value) !== "internal") return null
  const url = new URL(value)
  if (url.pathname === "/talk" || url.pathname.startsWith("/talk/")) {
    const room = url.pathname.slice("/talk/".length)
    url.pathname = "/slack"
    if (room) url.searchParams.set("c", room)
    // SlackPage는 메시지 딥링크를 m으로 읽는다. 이미 지정된 m은 덮어쓰지 않는다.
    if (!url.searchParams.has("m") && url.searchParams.has("thread")) url.searchParams.set("m", url.searchParams.get("thread"))
    url.searchParams.delete("thread")
    return url.href
  }
  return null
}
function roomLink(id) {
  return /^[a-z0-9_-]{1,100}$/i.test(id ?? "") ? `${START}?c=${encodeURIComponent(id)}` : START
}
function unreadFor(room) {
  const count = n => Number.isSafeInteger(n) && n > 0 ? n : 0
  if (room.hidden) return 0
  // inbox의 muted unread는 직접 멘션 수다. 이관된 과거 글은 음소거 합계에서 뺀다.
  return count(room.unread) + (room.muted ? 0 : count(room.slackUnread))
}
function roomTitle(room, names = new Map()) {
  if (room.notify) return "업무 알림"
  if (room.kind === "dm") return names.get(room.otherId) || "1:1 대화"
  if (room.kind === "ai") return room.persona?.name || "베스타"
  return `${room.kind === "channel" ? "# " : ""}${room.name || "대화"}`
}
function notificationCandidates(previous, rooms) {
  if (!previous) return [] // 첫 로그인 때 과거 글로 알림을 쏟지 않는다.
  return rooms.filter(r => {
    const before = previous.get(r.id)
    if (!r.id || r.hidden || !r.lastAt || before?.lastAt === r.lastAt) return false
    const newMention = r.mentioned > (before?.mentioned || 0)
    return newMention || (!r.muted && r.kind !== "channel" && r.unread > 0)
  })
}
function alertHours(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3)
  const day = k.getUTCDay(), minute = k.getUTCHours() * 60 + k.getUTCMinutes()
  return day > 0 && day < 6 && minute >= 540 && minute < 1140
}
module.exports = { BASE, START, PARTITION, classifyUrl, isLoginPath, returnAfterLogin, roomLink, unreadFor, roomTitle, notificationCandidates, alertHours, requestDecision, createLoginReturn }
