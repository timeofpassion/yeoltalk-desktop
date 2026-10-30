const BASE = "https://intranet.timeofpassion.com"
const START = `${BASE}/slack`
const PARTITION = "persist:passion-slack"
function classifyUrl(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return "blocked"
    if (url.origin === BASE) return "internal"
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "blocked"
  } catch { return "blocked" }
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
module.exports = { BASE, START, PARTITION, classifyUrl, isLoginPath, returnAfterLogin, roomLink, notificationCandidates, alertHours }
