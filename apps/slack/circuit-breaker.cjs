// 문서·RSC 반복은 경로별로, 차단은 출처별로 적용하며 민감한 URL은 로그에 남기지 않는다.
function createCircuitBreaker({ now = Date.now, log = () => {} } = {}) {
  const origins = new Map()
  return (kind, value) => {
    const limit = { external: 5, load: 40, popup: 5, rsc: 10 }[kind]
    let origin, page
    try {
      const url = new URL(value)
      page = url.pathname
      origin = url.origin === "null" ? url.protocol : url.origin
    } catch { return false }
    if (!limit) return false
    const time = now()
    for (const [key, entry] of origins) {
      if (time >= entry.blockedUntil && entry.last <= time - 60000) origins.delete(key)
    }
    let entry = origins.get(origin)
    if (!entry) {
      entry = { external: [], load: [], loadPaths: new Map(), popup: [], rsc: new Map(), blockedUntil: 0, last: time }
      origins.set(origin, entry)
    }
    if (time < entry.blockedUntil) return false
    entry.last = time
    if (kind === "load") {
      for (const [key, times] of entry.loadPaths) {
        const recent = times.filter(at => at > time - 10000)
        if (recent.length) entry.loadPaths.set(key, recent)
        else entry.loadPaths.delete(key)
      }
      const times = entry.loadPaths.get(page) || []
      if (times.length >= 5) {
        entry.blockedUntil = time + 5 * 60000
        entry.loadPaths.clear()
        log(`navigation-circuit-open load repeated-path ${origin}`)
        return false
      }
      times.push(time)
      entry.loadPaths.set(page, times)
    }
    if (kind === "rsc") {
      for (const [key, times] of entry.rsc) {
        const recent = times.filter(at => at > time - 2000)
        if (recent.length) entry.rsc.set(key, recent)
        else entry.rsc.delete(key)
      }
      const times = entry.rsc.get(page) || []
      if (times.length < limit) { times.push(time); entry.rsc.set(page, times); return true }
      entry.blockedUntil = time + 5 * 60000
      entry.rsc.clear()
      log(`navigation-circuit-open rsc ${origin}`)
      return false
    }
    entry[kind] = entry[kind].filter(at => at > time - 60000)
    if (entry[kind].length >= limit) {
      entry.blockedUntil = time + 5 * 60000
      entry.external = []; entry.load = []; entry.popup = []
      log(`navigation-circuit-open ${kind} ${origin}`)
      return false
    }
    entry[kind].push(time)
    return true
  }
}
module.exports = { createCircuitBreaker }
