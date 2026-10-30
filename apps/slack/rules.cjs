const BASE = "https://intranet.timeofpassion.com"
const START = `${BASE}/slack`
const PARTITION = "persist:passion-slack"
function classifyUrl(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return "blocked"
    if (url.origin === BASE) {
      if (["/", "/dashboard", "/slack", "/talk"].includes(url.pathname) || /^\/talk\/[a-z0-9_-]{1,100}$/i.test(url.pathname) || isLoginPath(url.pathname)) return "internal"
      const documents = ["/approvals", "/tasks", "/docs", "/clients", "/sign", "/s", "/finance/expenses", "/api/chat/files", "/api/files", "/api/attachments", "/uploads"]
      return documents.some(p => url.pathname === p || url.pathname.startsWith(p + "/")) ? "external" : "blocked"
    }
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "blocked"
  } catch { return "blocked" }
}
// 문서 전환과 Next.js의 SPA 페이지 요청을 모두 제한한다. 일반 API·첨부 요청은 서버 권한 검사를 따른다.
function requestDecision(details, isTalk = false) {
  let url
  try { url = new URL(details.url) } catch { return { cancel: true } }
  const pageRequest = details.resourceType === "mainFrame" || url.searchParams.has("_rsc") ||
    Object.entries(details.requestHeaders || {}).some(([name, value]) => name.toLowerCase() === "rsc" && value === "1")
  if (!pageRequest) return {}
  if (details.resourceType === "mainFrame") {
    const target = returnAfterLogin(details.url, isTalk)
    if (target) return { redirectURL: target }
  }
  return classifyUrl(details.url) === "internal" ? {} : { cancel: true }
}
function isLoginPath(pathname) {
  return ["/login", "/change-password", "/auth-error", "/api/auth"].some(p => pathname === p || pathname.startsWith(p + "/"))
}
function returnAfterLogin(value, isTalk = false) {
  if (classifyUrl(value) !== "internal") return null
  const url = new URL(value)
  if (["/", "/dashboard"].includes(url.pathname)) return isTalk ? `${BASE}/talk` : START
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
module.exports = { BASE, START, PARTITION, classifyUrl, isLoginPath, returnAfterLogin, roomLink, unreadFor, roomTitle, notificationCandidates, alertHours, requestDecision }
