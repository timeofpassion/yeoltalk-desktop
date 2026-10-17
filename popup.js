// 네이트온식 알림창 — 화면 오른쪽 아래에서 올라오는 작은 창.
// [2026-10-18 대표] "네이트온처럼 아래에 떠야 하는데 안 뜬다. 열톡은 업무시간에 알림을 확실하게 받고 인지해야 한다"
// 윈도우 기본 알림은 「방해 금지」·알림 설정에 따라 조용히 묻힌다 → 프로그램이 자기 창을 직접 띄운다(항상 위, 포커스는 안 뺏음).
const { BrowserWindow, screen, powerMonitor } = require("electron")
const path = require("path")
const fs = require("fs")

const W = 340
const H = 104
const GAP = 8
// [2026-10-18 대표 「너무 금방 사라진다」] 8초 → 15초. 자리를 비웠으면(30초 넘게 키보드·마우스 안 씀) 돌아올 때까지 안 닫힌다
const STAY_MS = 15000
const AWAY_SEC = 30
const MAX = 3
const open = [] // 아래에서 위로 쌓인 순서

const LOGO = (() => {
  try { return "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "build", "icon.png")).toString("base64") } catch { return "" }
})()

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

function html({ title, body, sub }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;overflow:hidden;background:transparent;font-family:Pretendard,"Malgun Gothic","맑은 고딕",sans-serif;word-break:keep-all}
  .card{position:absolute;inset:0;display:flex;gap:12px;align-items:flex-start;padding:14px 14px 12px;background:#fff;border:1px solid #d9d9d9;border-left:5px solid #E63329;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;animation:up .22s ease-out}
  @keyframes up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
  img{width:36px;height:36px;border-radius:9px;flex:none}
  .t{display:flex;align-items:baseline;gap:6px}
  .n{font-size:14px;font-weight:700;color:#191919;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
  .s{font-size:11.5px;color:#8a8a8a;white-space:nowrap}
  .b{margin-top:3px;font-size:13px;line-height:1.4;color:#333;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .x{position:absolute;top:6px;right:8px;border:0;background:none;font-size:15px;color:#999;cursor:pointer;padding:2px 4px}
  .x:hover{color:#333}
  </style></head><body><div class="card" id="c">
  ${LOGO ? `<img src="${LOGO}" alt="">` : ""}
  <div style="min-width:0;flex:1;padding-right:14px"><div class="t"><span class="n">${esc(title)}</span><span class="s">${esc(sub)}</span></div><div class="b">${esc(body)}</div></div>
  <button class="x" id="x" title="닫기">✕</button></div>
  <script>
  // 짧은 「띵」 — 소리 파일 없이
  try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.setValueAtTime(880,a.currentTime);o.frequency.setValueAtTime(1320,a.currentTime+.09);g.gain.setValueAtTime(.0001,a.currentTime);g.gain.exponentialRampToValueAtTime(.25,a.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+.35);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.36)}catch(e){}
  document.getElementById("x").onclick=(e)=>{e.stopPropagation();location.hash="close"}
  document.getElementById("c").onclick=()=>{location.hash="open"}
  // 마우스를 올려 두는 동안은 안 닫힌다
  document.getElementById("c").onmouseenter=()=>{location.hash="hold"}
  document.getElementById("c").onmouseleave=()=>{location.hash="go"}
  </script></body></html>`
}

function layout() {
  const { workArea } = screen.getPrimaryDisplay()
  open.forEach((p, i) => {
    if (p.win.isDestroyed()) return
    p.win.setBounds({ x: workArea.x + workArea.width - W - 12, y: workArea.y + workArea.height - (H + GAP) * (i + 1) - 4, width: W, height: H })
  })
}

function close(p) {
  const i = open.indexOf(p)
  if (i >= 0) open.splice(i, 1)
  clearInterval(p.timer)
  if (!p.win.isDestroyed()) p.win.destroy()
  layout()
}

/** 알림창 하나 띄우기. onClick = 눌렀을 때(그 대화방 열기) */
function showPopup({ title, body, sub = "열톡", onClick }) {
  while (open.length >= MAX) close(open[open.length - 1])
  const win = new BrowserWindow({
    width: W, height: H, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, transparent: true, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: true, autoplayPolicy: "no-user-gesture-required" },
  })
  win.setAlwaysOnTop(true, "screen-saver")
  const p = { win, timer: null }
  open.unshift(p) // 새 알림이 맨 아래
  layout()
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html({ title, body, sub })))
  win.once("ready-to-show", () => win.showInactive())
  // 닫힘 시계: 15초. 단 자리를 비운 동안·마우스를 올린 동안은 멈춘다
  p.left = STAY_MS
  p.hold = false
  p.timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(p.timer)
    let away = false
    try { away = powerMonitor.getSystemIdleTime() >= AWAY_SEC } catch {}
    if (p.hold || away) return
    p.left -= 1000
    if (p.left <= 0) close(p)
  }, 1000)
  win.webContents.on("did-navigate-in-page", (_e, url) => {
    if (url.endsWith("#open")) { close(p); onClick && onClick() }
    else if (url.endsWith("#close")) close(p)
    else if (url.endsWith("#hold")) p.hold = true
    else if (url.endsWith("#go")) { p.hold = false; p.left = Math.max(p.left, 5000) }
  })
  win.on("closed", () => clearInterval(p.timer))
  return p
}

module.exports = { showPopup }
