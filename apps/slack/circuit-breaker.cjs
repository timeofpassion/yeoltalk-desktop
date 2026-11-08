// 경로·쿼리가 바뀌어도 출처 단위로 집계하며 민감한 URL은 로그에 남기지 않는다.
function createCircuitBreaker({ now = Date.now, log = () => {} } = {}) {
  const origins = new Map()
  return (kind, value) => {
    const limit = { external: 5, load: 10 }[kind]
    let origin
    try {
      const url = new URL(value)
      origin = url.origin === "null" ? url.protocol : url.origin
    } catch { return false }
    if (!limit) return false
    const time = now()
    for (const [key, entry] of origins) {
      if (time >= entry.blockedUntil && entry.last <= time - 60000) origins.delete(key)
    }
    let entry = origins.get(origin)
    if (!entry) {
      entry = { external: [], load: [], blockedUntil: 0, last: time }
      origins.set(origin, entry)
    }
    if (time < entry.blockedUntil) return false
    entry.last = time
    entry[kind] = entry[kind].filter(at => at > time - 60000)
    if (entry[kind].length >= limit) {
      entry.blockedUntil = time + 5 * 60000
      entry.external = []; entry.load = []
      log(`navigation-circuit-open ${kind} ${origin}`)
      return false
    }
    entry[kind].push(time)
    return true
  }
}
module.exports = { createCircuitBreaker }
