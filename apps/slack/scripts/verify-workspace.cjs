// 운영 계정·직원 데이터 없이 실제 Electron 탭/세션/요청 경계를 실행한다.
const { app, BaseWindow, WebContentsView, desktopCapturer, ipcMain, session } = require('electron')
const path=require('node:path'), fs=require('node:fs'), assert=require('node:assert/strict')
const {connectWorkspace}=require('../workspace.cjs')
const {BASE,PARTITION,requestDecision}=require('../rules.cjs')
const out=process.argv[2]
if(!out || !path.isAbsolute(out)) throw Error('결과 절대 경로 필요')
fs.mkdirSync(out,{recursive:true}); app.setPath('userData',path.join(out,'profile'))
const fixture=pathname=>`<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{margin:0;font:16px sans-serif;color:#0f172a}main{padding:24px}h1{font-size:24px}button,input,textarea{font:inherit;padding:12px;min-height:44px;box-sizing:border-box}textarea{display:block;width:100%;height:150px;margin:20px 0}button{background:#E63329;color:white;border:0}aside{padding:24px;background:#a9231b;color:white}article{max-width:850px}label{display:block}a{color:#E63329} [data-chrome]{background:#222;color:white}</style><div data-chrome>기존 인트라넷 공통 메뉴</div><main data-main><article><p>격리 검증용 예시 데이터 · 운영 화면 아님</p><h1>${pathname.startsWith('/approvals')?'전자결재 · 휴가 신청서':pathname.startsWith('/tasks')?'업무':'슬랙 · 대화'}</h1><p>${pathname.startsWith('/approvals')?'승인 대기 · 직원 A · 운영팀':'메시지와 작성 내용을 유지합니다.'}</p><label>작성 내용<textarea aria-label="작성 내용"></textarea></label><a href="${BASE}/approvals/doc1" target="_blank">결재 문서 열기</a><p><button>저장하지 않는 시험 버튼</button></p></article></main></html>`
app.whenReady().then(async()=>{
  const counts={}, external=[], errors=[]
  const ses=session.fromPartition(PARTITION)
  ses.webRequest.onBeforeRequest({urls:['https://*/*']},(d,cb)=>cb(requestDecision(d)))
  ses.protocol.handle('https',request=>{const u=new URL(request.url); counts[u.pathname]=(counts[u.pathname]||0)+1; return new Response(fixture(u.pathname),{headers:{'content-type':'text/html; charset=utf-8'}})})
  const win=new BaseWindow({width:1440,height:900,useContentSize:true,show:false,webPreferences:{preload:path.resolve(__dirname,'../workspace-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}})
  const ws=connectWorkspace(win,{WebContentsView,ipcMain,dialog:{showMessageBoxSync:()=>0},openExternal:u=>external.push(u),safeLog:e=>errors.push(e)})
  async function ready(){for(let i=0;i<100;i++){const wc=ws.contents();if(wc&&!wc.isLoading()&&wc.getURL().startsWith(BASE)) return;await new Promise(r=>setTimeout(r,50))}throw Error('화면 로드 시간 초과')}
  win.setAlwaysOnTop(true)
  win.show(); win.focus()
  await ready()
  assert.equal(ws.count(),1)
  await ws.contents().executeJavaScript(`document.querySelector('textarea').value='대화 초안 유지'`)
  await ws.contents().executeJavaScript(`document.querySelector('a').click()`)
  await ready(); assert.equal(ws.active(),'approvals')
  await ws.contents().executeJavaScript(`document.querySelector('textarea').value='결재 작성 내용 유지'`)
  const initial={...counts}
  for(let i=0;i<20;i++){
    await win.webContents.executeJavaScript(`document.querySelector('[data-open="chat"]').click()`)
    assert.equal(await ws.contents().executeJavaScript(`document.querySelector('textarea').value`),'대화 초안 유지')
    await win.webContents.executeJavaScript(`document.querySelector('[data-open="approvals"]').click()`)
    assert.equal(await ws.contents().executeJavaScript(`document.querySelector('textarea').value`),'결재 작성 내용 유지')
  }
  assert.deepEqual(counts,initial)
  const layouts=[]
  for(const width of [1440,360,390]){
    win.setContentSize(width,900); await new Promise(r=>setTimeout(r,100)); win.emit("resize"); await new Promise(r=>setTimeout(r,300));
    await new Promise(r=>setTimeout(r,1000))
    const body=await ws.contents().executeJavaScript(`({visibility:document.visibilityState,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,chromeHidden:getComputedStyle(document.querySelector('[data-chrome]')).display==='none'})`)
    assert.equal(body.visibility,"visible");assert.equal(body.width,width < 600 ? width : width-76);assert.equal(body.overflow,false);assert.equal(body.chromeHidden,true)
    const toolbar=await win.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('header button')].map(b=>({text:b.textContent,height:b.getBoundingClientRect().height}))})`)
    assert.equal(toolbar.overflow,false);assert.ok(toolbar.buttons.filter(b=>b.height>0).every(b=>b.height>=44))
    fs.writeFileSync(path.join(out,`workspace-${width}.png`),(await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out,`content-${width}.png`),(await ws.contents().capturePage()).toPNG())
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:960}})
    const source=sources.find(s=>s.id===win.getMediaSourceId());if(source)fs.writeFileSync(path.join(out,`native-${width}.png`),source.thumbnail.toPNG())
    fs.writeFileSync(path.join(out,'diagnostic.json'),JSON.stringify({visible:win.isVisible(),bounds:win.getContentBounds(),children:win.contentView.children.map(v=>({bounds:v.getBounds(),visible:v.getVisible()})),page:await ws.contents().executeJavaScript('({visibility:document.visibilityState,ready:document.readyState})')}))
    layouts.push({width,body,toolbar})
  }
  ws.openUrl(BASE+'/tasks'); await ready();assert.equal(ws.count(),3)
  assert.deepEqual(await ws.contents().executeJavaScript(`Promise.all([fetch('/approvals/doc1?_rsc=fixture',{headers:{RSC:'1'}}).then(r=>r.ok,()=>false),fetch('/ceo?_rsc=fixture',{headers:{RSC:'1'}}).then(r=>r.ok,()=>false)])`),[true,false])
  const beforeClose = ws.count()
  await win.webContents.executeJavaScript(`document.getElementById('close-tab').click()`)
  for(let i=0;i<50 && ws.count()===beforeClose;i++)await new Promise(r=>setTimeout(r,20))
  assert.equal(ws.count(),2);assert.equal(ws.active(),'chat')
  assert.equal(await ws.contents().executeJavaScript(`document.querySelector('textarea').value`),'대화 초안 유지')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({fixtureOnly:true,actualEmployeeSessionTested:false,lazyInitialViews:1,viewsAfterAllOpened:3,closedViewReleased:ws.count()===2,tabSwitches:40,extraPageRequestsDuringSwitch:0,draftsPreserved:true,layouts,counts,errors},null,2))
  win.destroy();app.quit()
}).catch(e=>{fs.writeFileSync(path.join(out,'error.txt'),e.stack);app.exit(1)})
