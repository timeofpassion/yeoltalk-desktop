const test = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { connectWorkspace } = require('../workspace.cjs')
const { BASE } = require('../rules.cjs')
function harness() {
  const views = [], external = [], downloads = [], ipcMain = new EventEmitter()
  class Contents extends EventEmitter {
    constructor() { super(); this.url = ''; this.loads = []; this.mainFrame = { url: '' }; this.session = {} }
    setWindowOpenHandler(handler) { this.popup = handler }
    loadURL(url) { this.url = url; this.loads.push(url); return Promise.resolve() }
    getURL() { return this.url }
    focus() {} send() {} reload() {} close() { this.closed = true } isDestroyed() { return false }
    downloadURL(url) { downloads.push(url) }
  }
  class View { constructor() { this.webContents = new Contents(); views.push(this) } setVisible(v) { this.visible = v } setBounds(b) { this.bounds = b } }
  const win = new EventEmitter(); win.webContents = new Contents(); win.contentView = { addChildView(v) { v.visible=true }, removeChildView(v) { v.visible=false } }
  win.getContentSize = () => [1440, 900]; win.loadFile = () => {}
  const api = connectWorkspace(win, { WebContentsView: View, ipcMain, dialog: { showMessageBoxSync: () => 0 }, openExternal: u => external.push(u), safeLog() {} })
  win.webContents.emit('did-finish-load')
  return { api, views, win, ipcMain, external, downloads }
}
test('처음에는 대화만 로드하고 탭 30회 전환해도 대화·결재 각각 한 번만 로드', () => {
  const h = harness(); assert.equal(h.views.length, 1)
  h.api.openUrl(BASE + '/approvals')
  for (let i=0;i<30;i++) { h.api.openUrl(BASE + '/slack'); h.api.openUrl(BASE + '/approvals') }
  assert.equal(h.views.length, 2)
  for (const v of h.views) assert.equal(v.webContents.loads.length, 1)
  assert.equal(h.views.filter(v => v.visible).length, 1)
})
test('결재 링크는 앱의 업무 탭, 인증 첨부는 기존 세션 다운로드, 외부 링크만 브라우저', () => {
  const h = harness(), chat = h.views[0].webContents
  chat.popup({url: BASE+'/approvals/doc1'})
  assert.equal(h.api.active(), 'approvals'); assert.equal(h.views[1].webContents.url, BASE+'/approvals/doc1')
  const file = BASE+'/api/chat/files/v1/room1/user1/photo.png'
  chat.popup({url:file}); assert.deepEqual(h.downloads,[file])
  chat.popup({url:'https://example.org'}); assert.deepEqual(h.external,['https://example.org'])
  assert.equal(chat.loads.length,1)
})
test('원격 화면·하위 프레임은 앱 제어 IPC를 사용할 수 없다', () => {
  const h=harness()
  h.ipcMain.emit('workspace:open',{sender:h.views[0].webContents,senderFrame:{url:BASE+'/slack'}},'approvals')
  assert.equal(h.views.length,1)
  h.win.emit('closed'); assert.ok(h.views[0].webContents.closed); assert.equal(h.ipcMain.listenerCount('workspace:open'),0)
})
test('360px에서 업무 콘텐츠에 메뉴가 겹치지 않는다', () => {
  const h=harness(); h.api.openUrl(BASE+'/tasks'); h.win.getContentSize=()=>[360,800]; h.win.emit('resize')
  assert.deepEqual(h.views[1].bounds,{x:0,y:104,width:360,height:696})
})
