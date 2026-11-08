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
      if (["/", "/dashboard", "/slack", "/talk"].includes(url.pathname) || /^\/talk\/[a-z0-9_-]{1,100}$/i.test(url.pathname) || isLoginPath(url.pathname)) return "internal"
      const documents = ["/approvals", "/tasks", "/docs", "/clients", "/sign", "/s", "/finance/expenses", "/api/chat/files", "/api/files", "/api/attachments", "/uploads"]
      return documents.some(p => url.pathname === p || url.pathname.startsWith(p + "/")) ? "external" : "blocked"
    }
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "blocked"
  } catch { return "blocked" }
}
// 문서 전환과 Next.js의 SPA 페이지 요청을 모두 제한한다. 일반 API·첨부 요청은 서버 권한 검사를 따른다.
function requestDecision(details) {
  let url
  try { url = new URL(details.url) } catch { return { cancel: true } }
  const pageRequest = details.resourceType === "mainFrame" || url.searchParams.has("_rsc") ||
    Object.entries(details.requestHeaders || {}).some(([name, value]) => name.toLowerCase() === "rsc" && value === "1")
  if (!pageRequest) return {}
  // [0.1.8 · 2026-11-09 대표 지시] 이동이 끝난 뒤 다시 여는 규칙은 없다. 판단은 이동 전에 여기서 한 번만 한다.
  //   화면 안 이동(RSC)을 취소하면 Next 가 주소창 이동으로 바꾸고, 그건 will-navigate 가 막거나 아래 문서 요청에서 한 번 바꾼다.
  if (details.resourceType === "mainFrame") {
    const target = returnAfterLogin(details.url)
    if (target) return { redirectURL: target }
    if (classifyUrl(details.url) === "attachment") return {}
    return classifyUrl(details.url) === "internal" ? {} : { cancel: true }
  }
  // 로그인 완료(/·/dashboard)·옛 열톡 주소로 가는 화면 안 이동 → 취소해 위 문서 요청에서 슬랙으로 한 번만 바꾼다.
  if (returnAfterLogin(details.url)) return { cancel: true }
  // 업무 원본은 슬랙의 하위 프레임에서만 연다. 필터·저장 뒤 Next RSC 요청도 같은 세션을 쓴다.
  // 상위 창이 업무로 화면 안 이동을 하면 취소 → 주소창 이동 → will-navigate 가 기본 브라우저로 연다. 대표실·재무 등은 차단한다.
  if (url.origin === BASE && !url.username && !url.password && !fromTopFrame(details) &&
      (url.pathname === "/tasks" || url.pathname.startsWith("/tasks/"))) return {}
  return classifyUrl(details.url) === "internal" ? {} : { cancel: true }
}
// 요청한 프레임이 슬랙 창 자체인지. 프레임 정보가 없거나 이미 닫혔으면 하위 프레임으로 본다(기존 동작).
function fromTopFrame(details) {
  try { return !!details.frame && details.frame.parent === null } catch { return false }
}
function isLoginPath(pathname) {
  return ["/login", "/change-password", "/auth-error", "/api/auth"].some(p => pathname === p || pathname.startsWith(p + "/"))
}
// 로그인 완료·옛 열톡 주소 모두 한 슬랙 창으로 모은다. 방·스레드 링크는 유지한다.
function returnAfterLogin(value) {
  if (classifyUrl(value) !== "internal") return null
  const url = new URL(value)
  if (["/", "/dashboard"].includes(url.pathname)) return START
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
module.exports = { BASE, START, PARTITION, classifyUrl, isLoginPath, returnAfterLogin, roomLink, unreadFor, roomTitle, notificationCandidates, alertHours, requestDecision }
