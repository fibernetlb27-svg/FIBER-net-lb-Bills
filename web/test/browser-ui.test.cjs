'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createBackend}=require('../app/core.cjs');
const {createServer}=require('../server.cjs');
const {createSecretStorage}=require('../lib/secrets.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function connect(url){
 const socket=new WebSocket(url),pending=new Map(),events=[];let next=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.id){const request=pending.get(value.id);if(request){pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(value.error.message)):request.resolve(value.result);}}else events.push(value);});
 return {events,close:()=>socket.close(),send(method,params={}){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}};
}
async function pageFor(debugPort,url){const response=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(url),{method:'PUT'});const target=await response.json();const page=await connect(target.webSocketDebuggerUrl);await page.send('Runtime.enable');await page.send('Page.enable');return page;}
async function evaluate(page,expression){let value;try{value=await page.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});}catch(error){throw Error(error.message+' (expression: '+expression.slice(0,180)+')');}if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;}
async function waitFor(page,expression,label,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(page,expression))return;await pause(100);}const detail=await evaluate(page,"({url:location.href,toasts:document.getElementById('toast-region')?.innerText,body:document.body.innerText.slice(0,1400)})");throw Error(label+' timed out: '+JSON.stringify(detail));}
function pdfSize(bytes){const match=bytes.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);assert.ok(match,'PDF has a MediaBox');return match.slice(1).map(Number);}
const viewports=[[320,700],[375,812],[390,844],[414,896],[430,932],[600,900],[768,1024],[1024,768],[1440,1000],[1920,1080],[844,390]];
async function responsive(page,label){
 await page.send('Page.bringToFront');
 for(const [width,height]of viewports){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});
  await evaluate(page,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const result=await evaluate(page,"(()=>{const width=innerWidth,dialog=document.querySelector('dialog[open]'),rect=dialog?.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-width,dialog:rect?{left:rect.left,right:rect.right,width:rect.width,height:rect.height}:null,culprits:[...document.querySelectorAll('body *')].filter(el=>el.offsetParent&&el.getBoundingClientRect().right>width+2&&!el.closest('.table-wrap, .sidebar')).slice(0,6).map(el=>({tag:el.tagName,id:el.id,class:el.className,text:el.innerText?.slice(0,50)}))};})()");
  assert.ok(result.overflow<=2,label+' at '+width+'x'+height+' has page overflow: '+JSON.stringify(result));
  if(result.dialog)assert.ok(result.dialog.left>=-1&&result.dialog.right<=width+1,label+' dialog fits '+width+'x'+height+': '+JSON.stringify(result.dialog));
  if(width<=900){
   const navigation=await evaluate(page,"(()=>{const shell=document.querySelector('#app-shell');if(!shell||shell.classList.contains('hidden'))return null;scrollTo(0,0);const sidebar=shell.querySelector('.sidebar'),toggle=document.querySelector('#website-navigation-toggle'),nav=document.querySelector('#website-navigation'),banner=document.querySelector('#website-preview-banner'),rect=toggle.getBoundingClientRect();return {sidebarHeight:sidebar.getBoundingClientRect().height,mainTop:document.querySelector('.main-content').getBoundingClientRect().top,bannerHeight:banner?.getBoundingClientRect().height||0,closed:toggle.getAttribute('aria-expanded')==='false'&&getComputedStyle(nav).display==='none',toggleWidth:rect.width,toggleHeight:rect.height};})()");
   if(navigation){assert.ok(navigation.closed,label+' mobile navigation starts collapsed');assert.ok(navigation.sidebarHeight<=84,label+' mobile header stays compact: '+JSON.stringify(navigation));assert.ok(navigation.mainTop<=navigation.bannerHeight+90,label+' content starts below the compact header: '+JSON.stringify(navigation));assert.ok(navigation.toggleWidth>=44&&navigation.toggleHeight>=44,label+' menu has a usable touch target');}
  }
 }
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
}
async function tap(page,selector){
 await page.send('Page.bringToFront');
 await evaluate(page,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
 const rect=await evaluate(page,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};})()`);
 assert.ok(rect.width>0&&rect.height>0,'Pointer target is visible: '+selector);
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});
}
async function navigationScreenshot(page,name){
 const directory=path.resolve(__dirname,'../validation/navigation');fs.mkdirSync(directory,{recursive:true});
 const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 fs.writeFileSync(path.join(directory,name+'.png'),Buffer.from(screenshot.data,'base64'));
}
async function mobileNavigation(page){
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate(page,'scrollTo(0,0)');
 await tap(page,'#website-navigation-toggle');
 await waitFor(page,"document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')==='true'",'Mobile menu opens by pointer');
 assert.ok(await evaluate(page,"(()=>{const nav=document.querySelector('#website-navigation'),r=nav.getBoundingClientRect();return getComputedStyle(nav).display==='grid'&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"),'Expanded mobile navigation fits viewport and uses vertical rows');
 const links=await evaluate(page,"[...document.querySelectorAll('#website-navigation .workspace-nav-button[data-workspace]')].filter(el=>!el.classList.contains('hidden')).map(el=>({id:el.dataset.workspace,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))");
 assert.equal(links.length,6,'Admin can reach all six businesses from Main');assert(links.every(link=>link.width>=200&&link.height>=44),'Every business is a full-width touch row');
 await navigationScreenshot(page,'mobile-menu-open');
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate(page,"document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')==='false'&&document.activeElement.id==='website-navigation-toggle'"),true,'Escape closes menu and returns keyboard focus');
 await tap(page,'#website-navigation-toggle');await tap(page,'#website-navigation [data-view="products"]');
 await waitFor(page,"state.currentView==='products'&&document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')==='false'",'Mobile section selection closes menu');
 await tap(page,'#website-navigation-toggle');await tap(page,'#website-navigation [data-view="dashboard"]');
 await waitFor(page,"state.currentView==='dashboard'&&document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')==='false'",'Mobile return to dashboard');
 await tap(page,'#website-navigation-toggle');await tap(page,'#page-title');
 assert.equal(await evaluate(page,"document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')"),'false','Outside click closes menu');
 await evaluate(page,'scrollTo(0,0)');await navigationScreenshot(page,'mobile-menu-closed');
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const desktop=await evaluate(page,"(()=>{const sidebar=document.querySelector('.sidebar'),nav=document.querySelector('#website-navigation'),banner=document.querySelector('#website-preview-banner');return {toggle:getComputedStyle(document.querySelector('#website-navigation-toggle')).display,nav:getComputedStyle(nav).display,sidebarTop:sidebar.getBoundingClientRect().top,bannerBottom:banner.getBoundingClientRect().bottom};})()");
 assert.equal(desktop.toggle,'none');assert.notEqual(desktop.nav,'none');assert.ok(desktop.sidebarTop>=desktop.bannerBottom-1,'Preview banner does not obscure the desktop sidebar');
 await evaluate(page,'scrollTo(0,0)');await navigationScreenshot(page,'desktop-sidebar');
}
async function enlargedText(page,label){
 await page.send('Page.bringToFront');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 try{
  const scale=await evaluate(page,"(()=>{const rows=[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&(/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)||[...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))).map(el=>{const css=getComputedStyle(el);return {el,style:el.getAttribute('style'),font:parseFloat(css.fontSize),line:css.lineHeight};});window.__qaTextStyles=rows;for(const row of rows){row.el.style.setProperty('font-size',row.font*1.25+'px','important');if(row.line.endsWith('px'))row.el.style.setProperty('line-height',parseFloat(row.line)*1.25+'px','important');}const control=rows.find(row=>/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(row.el.tagName));return {count:rows.length,before:control?.font,after:control?parseFloat(getComputedStyle(control.el).fontSize):0};})()");
  assert.ok(scale.count>0&&scale.after>=scale.before*1.249,label+' actually enlarges visible text and controls by25%');
  await evaluate(page,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const layout=await evaluate(page,"(()=>{const dialog=document.querySelector('dialog[open]'),rect=dialog?.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,dialog:rect?{left:rect.left,right:rect.right,overflow:dialog.scrollWidth-dialog.clientWidth}:null};})()");
  assert.ok(layout.overflow<=2,label+' enlarged text has page overflow: '+JSON.stringify(layout));
  if(layout.dialog)assert.ok(layout.dialog.left>=-1&&layout.dialog.right<=391&&layout.dialog.overflow<=2,label+' enlarged-text dialog fits390px: '+JSON.stringify(layout));
 }finally{
  await evaluate(page,"for(const row of window.__qaTextStyles||[]){if(row.style===null)row.el.removeAttribute('style');else row.el.setAttribute('style',row.style);}delete window.__qaTextStyles;");
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 }
}

test('genuine browser signs in, uses accounting routes, prints paper layouts, and clears private views',{timeout:180000},async t=>{
 const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>fs.existsSync(file));
 assert.ok(chrome,'Set CHROME_BIN to a Chromium browser to run browser validation.');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-web-browser-fictional-'));
 const data=path.join(directory,'data'),downloads=path.join(directory,'downloads');fs.mkdirSync(downloads);
 const secrets=createSecretStorage(crypto.randomBytes(32)),pages=[];let backend,server,child,browser;
 t.after(async()=>{
  for(const page of pages)page.close();
  try{await browser?.send('Browser.close');}catch{}browser?.close();
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await backend?.close();secrets.destroy();
  const resolved=path.resolve(directory),temporary=path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved),temporary);assert.ok(path.basename(resolved).startsWith('fibernetlb-web-browser-fictional-'));
  for(let attempt=0;attempt<10;attempt++){try{fs.rmSync(resolved,{recursive:true,force:true});break;}catch(error){if(attempt===9)throw error;await pause(250);}}
 });
 backend=await createBackend({dataDirectory:data,initialize:true,secrets,providersEnabled:false,version:'0.1.0-browser-test'});
 const password='Fictional-browser-only-2026!';
 await backend.createOwner({username:'browser.fixture.admin',fullName:'Fictional Browser Admin',password});
 const ownerLogin=await backend.request({channel:'auth:login',args:[{username:'browser.fixture.admin',password}],workspaceId:'main'});
 const viewer=await backend.request({channel:'users:create',args:[{username:'browser.fixture.viewer',fullName:'Fictional Browser Viewer',password,role:'viewer',allowedSections:['fiber-users']}],workspaceId:'main',token:ownerLogin.data.sessionToken});
 assert.equal(viewer.status,200);
 for(const role of ['cashier','support']){
  const created=await backend.request({channel:'users:create',args:[{username:'browser.fixture.'+role,fullName:'Fictional Browser '+role,password,role,allowedSections:['fiber-users','fiber-resellers']}],workspaceId:'main',token:ownerLogin.data.sessionToken});assert.equal(created.status,200);
 }
 const supportLogin=await backend.request({channel:'auth:login',args:[{username:'browser.fixture.support',password}],workspaceId:'fiber-users'});assert.equal(supportLogin.status,200);
 assert.equal((await backend.request({channel:'drawer:setBalance',args:[{balance:17,note:'Fictional Support cash for read-only handover preview'}],workspaceId:'fiber-users',token:supportLogin.data.sessionToken})).status,200);
 const usersOwner=await backend.request({channel:'auth:switch',args:['fiber-users'],workspaceId:'main',token:ownerLogin.data.sessionToken});assert.equal(usersOwner.status,200);
 assert.equal((await backend.request({channel:'drawer:setBalance',args:[{balance:217,note:'Fictional business custody: Admin200 plus Support17 for a partial Bank deposit'}],workspaceId:'fiber-users',token:usersOwner.data.sessionToken})).status,200);
 const port=await unusedPort(),origin='http://127.0.0.1:'+port;
 server=createServer({backend,origin,demo:true});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const debugUrl=await new Promise((resolve,reject)=>{
  let log='';const timer=setTimeout(()=>reject(Error('Chrome did not expose a test debugging socket.')),20000);
  child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-component-update',...(process.env.CHROME_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),'--remote-debugging-port=0','--user-data-dir='+path.join(directory,'chrome'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.stderr.on('data',chunk=>{log+=String(chunk);const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Chrome exited before test startup: '+code));});
 });
 browser=await connect(debugUrl);const debugPort=Number(new URL(debugUrl).port);
 await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 const page=await pageFor(debugPort,origin);pages.push(page);
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await waitFor(page,"document.querySelector('#auth-screen')&&!document.querySelector('#auth-screen').classList.contains('hidden')",'Login screen');
 await responsive(page,'Login');
 await enlargedText(page,'Login');
 assert.equal(await evaluate(page,"document.querySelector('#website-preview-banner').hidden"),false);
 await evaluate(page,`document.querySelector('#login-username').value='browser.fixture.admin';document.querySelector('#login-password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();`);
 await waitFor(page,"!document.querySelector('#app-shell').classList.contains('hidden')&&document.querySelector('#current-user-name').textContent==='Fictional Browser Admin'",'Administrator dashboard');
 await waitFor(page,"document.querySelector('#updates-button-label').textContent==='Website version'",'Website version controls');
 await responsive(page,'Main dashboard');
 await mobileNavigation(page);
 assert.equal(await evaluate(page,"document.querySelector('#network-settings-button').classList.contains('website-only-hidden')"),true);
 assert.equal(await evaluate(page,"Boolean(window.posApi.printing)"),false);
 await evaluate(page,"window.__qaPending=0;window.__qaFailures=[];const qaFetch=window.fetch;window.fetch=async(...args)=>{window.__qaPending++;try{const response=await qaFetch(...args);if(!response.ok)window.__qaFailures.push({channel:args[1]?.body?JSON.parse(args[1].body).channel:String(args[0]),status:response.status});return response;}finally{window.__qaPending--;}};");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===7",'All business money-to-collect cards');
 assert.equal(await evaluate(page,"document.querySelector('[data-collection-card=\"fiber-users\"] [data-collection-total]').textContent"),'$217.00','Collection card includes Support holdings without substituting Admin custody');
 assert.equal(await evaluate(page,"document.querySelector('[data-collection-card=\"fiber-users\"] [data-collection-whish]').textContent"),'$0.00');
 await evaluate(page,"document.querySelector('#finance-business').value='fiber-users';document.querySelector('#finance-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===1&&document.querySelector('[data-collection-card=\"fiber-users\"]')",'Collection cards follow selected business');
 await evaluate(page,"document.querySelector('[data-collection-business=\"fiber-users\"][data-collection-method=cash]').click()");
 await waitFor(page,"document.querySelector('#bank-transfer-form')&&document.querySelector('#bank-transfer-business').value==='fiber-users'&&document.querySelector('#bank-holder').options.length>=2",'Collection card opens exact business Bank deposit');
 assert.equal(await evaluate(page,"document.querySelector('#bank-business-cash').textContent"),'$217.00','Deposit dialog shows full business custody');
 await responsive(page,'Collection-card Bank deposit');await enlargedText(page,'Collection-card Bank deposit');
 await evaluate(page,"(()=>{const holder=document.querySelector('#bank-holder');holder.value=[...holder.options].find(option=>option.textContent.endsWith('· Admin')).value;holder.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#bank-amount').value='50';document.querySelector('#bank-note').value='Fictional partial month-end Bank deposit';document.querySelector('#bank-review').click();})()");
 await waitFor(page,"!document.querySelector('#bank-impact').hidden&&!document.querySelector('#bank-ack-field').hidden",'Partial Bank deposit review');
 assert.match(await evaluate(page,"document.querySelector('#bank-impact').textContent"),/Cash drawer after\$150\.00/,'Preview debits only the explicitly selected Admin drawer');
 await evaluate(page,"document.querySelector('#bank-ack').checked=true;document.querySelector('#bank-ack').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#bank-transfer-form').requestSubmit()");
 await waitFor(page,"!document.querySelector('#bank-transfer-form')&&document.querySelector('[data-collection-card=\"fiber-users\"] [data-collection-total]')?.textContent==='$167.00'",'Partial Bank deposit updates real remaining collection');
 assert.match(await evaluate(page,"document.querySelector('[data-collection-card=\"fiber-users\"] .month-collection-bank').textContent"),/\$50\.00/);
 await evaluate(page,"(async()=>{window.__qaCollectionOriginal=posApi.bank.collectionOverview;window.__qaLateCollection=await posApi.bank.collectionOverview({workspaceId:'fiber-users'});posApi.bank.collectionOverview=input=>input.workspaceId==='fiber-users'?new Promise(resolve=>{window.__qaReleaseCollection=resolve;}):window.__qaCollectionOriginal(input);void MonthCollections.load(true);})()");
 await waitFor(page,"typeof window.__qaReleaseCollection==='function'",'Retained delayed collection read');
 await evaluate(page,"document.querySelector('#finance-business').value='all';document.querySelector('#finance-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===7",'New collection scope loads before old response');
 await evaluate(page,"window.__qaReleaseCollection(window.__qaLateCollection);posApi.bank.collectionOverview=window.__qaCollectionOriginal;delete window.__qaCollectionOriginal;delete window.__qaReleaseCollection;delete window.__qaLateCollection");
 assert.equal(await evaluate(page,"document.querySelectorAll('[data-collection-card]').length"),7,'Late single-business response cannot replace all-business cards');
 await evaluate(page,"document.querySelector('#finance-business').value='fiber-users';document.querySelector('#finance-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===1",'Selected collection scope restored');
 await evaluate(page,"(async()=>{window.__qaCollectionApi=posApi.bank.collectionOverview;const original=await posApi.bank.collectionOverview({workspaceId:'fiber-users'});posApi.bank.collectionOverview=async()=>({...original,totals:{...original.totals,total:999999}});await MonthCollections.load(true);})()");
 await waitFor(page,"document.querySelector('#month-collections [role=alert]')&&!document.querySelector('[data-collection-card]')",'Unverified collection totals clear previous balances');
 await evaluate(page,"posApi.bank.collectionOverview=window.__qaCollectionApi;delete window.__qaCollectionApi;void MonthCollections.load(true)");
 await waitFor(page,"document.querySelector('[data-collection-card=\"fiber-users\"] [data-collection-total]')?.textContent==='$167.00'",'Verified collection totals recover safely');
 await evaluate(page,"document.querySelector('#finance-business').value='all';document.querySelector('#finance-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===7",'Return to all-business collection cards');
 await evaluate(page,"(async()=>{window.__qaCollectionOriginal=posApi.bank.collectionOverview;window.__qaCollectionAdmin=state.currentUser;window.__qaLateCollection=await posApi.bank.collectionOverview({workspaceId:'all'});posApi.bank.collectionOverview=()=>new Promise(resolve=>{window.__qaReleaseCollection=resolve;});void MonthCollections.load(true);})()");
 await waitFor(page,"typeof window.__qaReleaseCollection==='function'",'Retained collection read before permission revocation');
 await evaluate(page,"state.currentUser={...state.currentUser,role:'viewer'};MonthCollections.updateUser(state.currentUser);window.__qaReleaseCollection(window.__qaLateCollection)");
 assert.equal(await evaluate(page,"document.querySelector('#month-collections').hidden&&document.querySelector('#month-collections').textContent==='';"),true,'Permission revocation clears money and rejects a late response');
 await evaluate(page,"posApi.bank.collectionOverview=window.__qaCollectionOriginal;state.currentUser=window.__qaCollectionAdmin;MonthCollections.updateUser(state.currentUser);delete window.__qaCollectionOriginal;delete window.__qaCollectionAdmin;delete window.__qaReleaseCollection;delete window.__qaLateCollection;void MonthCollections.load(true)");
 await waitFor(page,"document.querySelectorAll('[data-collection-card]').length===7",'Collection cards reload only after Admin permission is restored');
 await responsive(page,'Month-end collection cards');await enlargedText(page,'Month-end collection cards');
 await waitFor(page,"document.querySelector('#toast-region').childElementCount===0",'Collection confirmation notification settles before guide screenshot');
 await evaluate(page,"scrollTo(0,document.querySelector('#month-collections').getBoundingClientRect().top+scrollY-20)");await navigationScreenshot(page,'month-collections-desktop');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate(page,"scrollTo(0,document.querySelector('#month-collections').getBoundingClientRect().top+scrollY-115)");await navigationScreenshot(page,'month-collections-mobile');
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const views=await evaluate(page,"[...document.querySelectorAll('.nav-item[data-view]')].filter(button=>button.offsetParent&&!['dashboard','backups'].includes(button.dataset.view)).map(button=>button.dataset.view)");
 for(const view of views){
  await evaluate(page,`document.querySelector('.nav-item[data-view="${view}"]').click()`);
  await pause(120);await waitFor(page,"window.__qaPending===0",'Main '+view+' requests');
  assert.equal(await evaluate(page,`state.currentView===${JSON.stringify(view)}`),true,'Main '+view+' route is active');
  await responsive(page,'Main '+view);
  if(view==='ledger'){
   await waitFor(page,"document.querySelector('#automatic-month-status')?.textContent.includes('11:59 PM')",'Verified automatic monthly closing schedule');
   assert.match(await evaluate(page,"document.querySelector('#automatic-month-status').textContent"),/Beirut time/);
   await evaluate(page,"document.querySelector('#ledger-close-month').value='2026-01';document.querySelector('#ledger-close-button').click()");
   await waitFor(page,"Boolean(document.querySelector('dialog[open]'))",'Monthly close dialog');
   await responsive(page,'Monthly close dialog');await evaluate(page,"document.querySelector('dialog[open]').close()");
  }
 }
 for(const view of ['bank','company-debts','fixed-monthly']){
  await evaluate(page,`switchView('${view}')`);await pause(120);await waitFor(page,"window.__qaPending===0",'Main '+view+' requests');
  assert.equal(await evaluate(page,`state.currentView===${JSON.stringify(view)}`),true);
  await responsive(page,'Main '+view);
  const button={bank:'bank-deposit','company-debts':'cd-add','fixed-monthly':'fm-add'}[view];
  await evaluate(page,`document.querySelector('#${button}').click()`);
  await waitFor(page,"Boolean(document.querySelector('dialog[open]'))",view+' dialog');
  await responsive(page,view+' dialog');if(view==='bank')await enlargedText(page,'Bank transfer dialog');await evaluate(page,"document.querySelector('dialog[open]').close()");
 }
 assert.deepEqual(await evaluate(page,"window.__qaFailures"),[],'Main navigation requests succeed');
 await evaluate(page,"document.querySelector('[data-view=backups]').click()");
 await waitFor(page,"document.querySelector('#backup-running-status').textContent==='Ready'",'Server backup status');
 assert.equal(await evaluate(page,"document.querySelector('#backup-open-folder').disabled&&document.querySelector('#backup-extract').disabled"),true);
 await evaluate(page,"document.querySelector('[data-view=dashboard]').click();document.querySelector('#portal-settings-button').click()");
 await waitFor(page,"document.querySelector('#portal-settings-dialog')?.open||document.querySelector('#portal-dialog')?.open",'Provider settings');
 await evaluate(page,"for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();void posApi.bandwidth.open()");
 await waitFor(page,"document.querySelector('#bandwidth-accounting-root')&&!document.querySelector('#bandwidth-accounting-root').hidden",'Supplier accounting route');
 await responsive(page,'Supplier accounting');
 await evaluate(page,"document.querySelector('#bandwidth-window-close').click()");
 await waitFor(page,"document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",'Return from supplier accounting');
 for(const section of ['printer','studio','mobile-ogero','iptv','fiber-resellers','fiber-users']){
  await evaluate(page,`document.querySelector('[data-workspace="${section}"]').click()`);
  await waitFor(page,`location.search.includes('${section}')&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')`,'Authorized '+section+' business switch');
  await responsive(page,section+' dashboard');
 }
 for(const [view,button,dialog]of [['products','add-product','product-dialog'],['expenses','add-expense','expense-dialog']]){
  await evaluate(page,`document.querySelector('[data-view=${view}]').click()`);await pause(200);
  await responsive(page,'Business '+view);
  await evaluate(page,`document.querySelector('#${button}').click()`);await waitFor(page,`document.querySelector('#${dialog}').open`,view+' form');
  await responsive(page,view+' form');await enlargedText(page,view+' form');await evaluate(page,`document.querySelector('#${dialog}').close()`);
 }
 await evaluate(page,"document.querySelector('[data-view=pos]').click()");await pause(200);await responsive(page,'POS catalog and cart');
 // Disposable financial fixture travels through the real cookie/CSRF gateway and accounting backend.
 const sale=await evaluate(page,"(async()=>{const product=await posApi.products.create({sku:'WEB-QA-SERVICE',name:'Fictional browser service',category:'Maintenance',currency:'USD',cost:1,price:5,barcodes:['9823456789012']});const receipt=await posApi.sales.create({items:[{productId:product.id,quantity:1}],paymentMethod:'Cash',customerName:'Fictional Browser Customer'});showReceipt('sale',receipt);return {id:receipt.id,invoiceNo:receipt.invoiceNo,total:receipt.total};})()");
 assert.ok(sale.id);assert.ok(sale.invoiceNo);
 await waitFor(page,"document.querySelector('#receipt-dialog').open&&document.querySelector('#receipt-customer').textContent==='Fictional Browser Customer'",'Saved receipt');
 await page.send('Emulation.setEmulatedMedia',{media:'print'});
 for(const [paper,expected]of [['a4',[595,842]],['a5',[420,595]]]){
  await evaluate(page,`document.querySelector('#receipt-paper-size').value='${paper}';document.querySelector('#receipt-paper-size').dispatchEvent(new Event('change'));document.body.dataset.printTarget='receipt';`);
  const pdf=await page.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});
  const size=pdfSize(Buffer.from(pdf.data,'base64'));
  assert.ok(Math.abs(size[0]-expected[0])<2&&Math.abs(size[1]-expected[1])<2,paper+' PDF dimensions '+size);
 }
 for(const [paper,width]of [['thermal-80',74],['thermal-58',52],['xp-235b',48]]){
  await evaluate(page,`document.querySelector('#receipt-paper-size').value='${paper}';document.querySelector('#receipt-paper-size').dispatchEvent(new Event('change'));document.body.dataset.printTarget='receipt';`);
  const actual=await evaluate(page,"document.querySelector('#printable-receipt').getBoundingClientRect().width*25.4/96");
  assert.ok(actual<=width+0.2,paper+' printable width '+actual);
  const pdf=await page.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,paperWidth:(paper==='thermal-80'?80:58)/25.4,paperHeight:300/25.4});
  assert.ok(Buffer.from(pdf.data,'base64').length>1000);
 }
 await page.send('Emulation.setEmulatedMedia',{media:'screen'});
 await evaluate(page,"delete document.body.dataset.printTarget;document.querySelector('#receipt-dialog').close()");
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const overflow=await evaluate(page,"document.documentElement.scrollWidth>innerWidth+2");assert.equal(overflow,false,'Phone dashboard fits its viewport');
 await evaluate(page,"(async()=>{const date=new Date().toISOString().slice(0,10);return posApi.reports.export(date,date,'','');})()");
 for(let i=0;i<30&&!fs.readdirSync(downloads).some(name=>name.endsWith('.csv'));i++)await pause(100);
 const csv=fs.readdirSync(downloads).find(name=>name.endsWith('.csv'));assert.ok(csv,'Browser downloads a CSV');assert.match(fs.readFileSync(path.join(downloads,csv),'utf8'),/profit|revenue|report/i);
 const second=await pageFor(debugPort,origin+'/?workspaceId=fiber-users');pages.push(second);
 await waitFor(second,"document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",'Second tab session');
 await evaluate(page,"localStorage.setItem('fiber-browser-qa-pending-marker','original-request');document.querySelector('#logout-button').click()");
 for(const target of [page,second]){
  await waitFor(target,"document.querySelector('#app-shell').classList.contains('hidden')&&!document.querySelector('#auth-screen').classList.contains('hidden')",'Logout privacy');
  assert.equal(await evaluate(target,"document.querySelector('#receipt-customer').textContent"),'');
  assert.equal(await evaluate(target,"document.querySelector('#login-password').value"),'');
 }
 assert.equal(await evaluate(page,"localStorage.getItem('fiber-browser-qa-pending-marker')"),'original-request');
 await evaluate(page,`document.querySelector('#login-username').value='browser.fixture.viewer';document.querySelector('#login-password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();`);
 await waitFor(page,"!document.querySelector('#app-shell').classList.contains('hidden')&&document.querySelector('#current-user-name').textContent==='Fictional Browser Viewer'",'Viewer session');
 assert.equal(await evaluate(page,"document.querySelector('[data-view=users]').classList.contains('hidden')&&document.querySelector('#add-product').classList.contains('hidden')"),true,'Viewer management controls are hidden');
 assert.equal(await evaluate(page,"posApi.backups.status().then(()=>false,error=>error.status===403)"),true,'Viewer cannot bypass backup authorization');
 assert.equal(await evaluate(page,"Boolean(document.querySelector('#month-collections')?.textContent)"),false,'Viewer does not inherit Admin business collection cards');
 assert.equal(await evaluate(page,"posApi.bank.collectionOverview({workspaceId:'all'}).then(()=>false,error=>error.status===400||error.status===403)"),true,'Viewer cannot bypass collection-card authorization');
 assert.equal(await evaluate(page,"posApi.workspace.open('printer').then(()=>false,error=>error.status===403||error.status===400)"),true,'Viewer cannot open an unassigned business');
 for(const role of ['cashier','support']){
  await evaluate(page,"document.querySelector('#logout-button').click()");await waitFor(page,"document.querySelector('#app-shell').classList.contains('hidden')",role+' sign-in screen');
  await evaluate(page,`document.querySelector('#login-username').value=${JSON.stringify('browser.fixture.'+role)};document.querySelector('#login-password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();`);
  await waitFor(page,`!document.querySelector('#app-shell').classList.contains('hidden')&&document.querySelector('#current-user-name').textContent===${JSON.stringify('Fictional Browser '+role)}`,role+' session');
  await page.send('Page.bringToFront');
  if(await evaluate(page,"businessWorkspace.id!=='main'")){
   await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate(page,"new Promise(resolve=>requestAnimationFrame(resolve))");
   await tap(page,'#website-navigation-toggle');await tap(page,'#back-main-dashboard');await waitFor(page,"typeof businessWorkspace!=='undefined'&&businessWorkspace.id==='main'&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",role+' initial return to Main');
  }
  await responsive(page,role+' Main dashboard');await enlargedText(page,role+' Main dashboard');
  assert.equal(await evaluate(page,"Boolean(document.querySelector('#month-collections')?.getClientRects().length)"),false,role+' cannot see Admin business collection cards');
  assert.equal(await evaluate(page,"Boolean(document.querySelector('#support-end-day')?.getClientRects().length)"),role==='support',role+' Main shows only the authorized Users handover shortcut');
  if(role==='support'){
   assert.equal(await evaluate(page,"document.querySelector('#support-end-day').textContent"),'Open Users End of day');
   assert.equal(await evaluate(page,"posApi.finance.endDayTargets().then(()=>false,error=>/FIBER net lb Users only/.test(error.message))"),true,'Main shortcut does not grant Main an End of day API');
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await tap(page,'#website-navigation-toggle');
  const assigned=await evaluate(page,"[...document.querySelectorAll('#website-navigation [data-workspace]')].map(el=>el.dataset.workspace)");assert.deepEqual(assigned,['fiber-users','fiber-resellers'],role+' menu contains only assigned businesses');
  if(role==='support'){await tap(page,'#website-navigation-toggle');await tap(page,'#support-end-day');}
  else await tap(page,'#website-navigation [data-workspace="fiber-users"]');
  await waitFor(page,"typeof businessWorkspace!=='undefined'&&businessWorkspace.id==='fiber-users'&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",role+' business navigation');
  assert.equal(await evaluate(page,"document.querySelector('#website-navigation-toggle').getAttribute('aria-expanded')"),'false',role+' business navigation starts closed');
  await responsive(page,role+' business dashboard');
  assert.equal(await evaluate(page,"Boolean(document.querySelector('#support-end-day')?.getClientRects().length)"),role==='support',role+' Users action is visible despite retired headline cards');
  if(role==='support'){
   assert.equal(await evaluate(page,"getComputedStyle(document.querySelector('#view-dashboard > .metric-grid')).display"),'none','Legacy metric cards remain hidden');
   assert.equal(await evaluate(page,"document.querySelector('#support-end-day').textContent"),'End of day');
   await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await tap(page,'#support-end-day');
   await waitFor(page,"document.querySelector('#support-end-dialog').open&&document.querySelector('#support-end-to').options.length===2",'Support receiving Cashier');
   await responsive(page,'Support End of day dialog');await enlargedText(page,'Support End of day dialog');
   await evaluate(page,"const select=document.querySelector('#support-end-to');select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#support-end-preview-button').click()");
   await waitFor(page,"!document.querySelector('#support-end-save').disabled",'Support read-only end-of-day preview');
   assert.match(await evaluate(page,"document.querySelector('#support-end-preview').textContent"),/\$17\.00 cash/);
   assert.equal(await evaluate(page,"posApi.drawer.get().then(value=>value.balance)"),17,'Review never transfers Support cash');
   // A late preview must not reopen a handover after the staff permission changes.
   await evaluate(page,"(async()=>{window.__qaSupportUser=state.currentUser;window.__qaOriginalPreview=posApi.finance.endDayPreview;window.__qaSupportPreview=await posApi.finance.endDayPreview({toKey:document.querySelector('#support-end-to').value});posApi.finance.endDayPreview=()=>new Promise(resolve=>{window.__qaReleaseSupportPreview=resolve;});document.querySelector('#support-end-preview-button').click();})()");
   await evaluate(page,"(async()=>{state.currentUser={...state.currentUser,permissions:state.currentUser.permissions.filter(permission=>permission!=='drawer.manage')};SupportHandover.updateUser(state.currentUser);window.__qaReleaseSupportPreview(window.__qaSupportPreview);await Promise.resolve();await Promise.resolve();})()");
   assert.equal(await evaluate(page,"!document.querySelector('#support-end-dialog').open&&!document.querySelector('#support-end-day').getClientRects().length&&document.querySelector('#support-end-save').disabled&&document.querySelector('#support-end-preview').textContent===''"),true,'Revocation hides the action, closes the dialog and ignores a late preview');
   await evaluate(page,"posApi.finance.endDayPreview=window.__qaOriginalPreview;state.currentUser=window.__qaSupportUser;SupportHandover.updateUser(state.currentUser);delete window.__qaOriginalPreview;delete window.__qaSupportUser;delete window.__qaSupportPreview;delete window.__qaReleaseSupportPreview;");
   assert.equal(await evaluate(page,"Boolean(document.querySelector('#support-end-day').getClientRects().length)"),true,'Authorized Support can reopen the action after permission refresh');
  }else{
   assert.equal(await evaluate(page,"posApi.finance.endDayTargets().then(()=>false,error=>/Support/.test(error.message))"),true,'Cashier cannot invoke Support End of day');
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await tap(page,'#website-navigation-toggle');
  assert.equal(await evaluate(page,"(()=>{const r=document.querySelector('#website-navigation').getBoundingClientRect();return r.bottom<=innerHeight;})()"),true,role+' business menu fits with Return to Main');
  await tap(page,'#back-main-dashboard');await waitFor(page,"typeof businessWorkspace!=='undefined'&&businessWorkspace.id==='main'&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",role+' return to Main');
  if(role==='support'){
   await tap(page,'#website-navigation-toggle');
   await tap(page,'#website-navigation [data-workspace="fiber-resellers"]');await waitFor(page,"typeof businessWorkspace!=='undefined'&&businessWorkspace.id==='fiber-resellers'&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",'Support Resellers scope');
   assert.equal(await evaluate(page,"Boolean(document.querySelector('#support-end-day')?.getClientRects().length)"),false,'Resellers does not expose Users handover');
   assert.equal(await evaluate(page,"posApi.finance.endDayTargets().then(()=>false,error=>/FIBER net lb Users only/.test(error.message))"),true,'Resellers cannot invoke Users handover');
   await tap(page,'#website-navigation-toggle');
   await tap(page,'#back-main-dashboard');await waitFor(page,"typeof businessWorkspace!=='undefined'&&businessWorkspace.id==='main'&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')",'Support returns from Resellers');
  }
 }
 await evaluate(page,"document.querySelector('#logout-button').click()");await waitFor(page,"document.querySelector('#app-shell').classList.contains('hidden')",'Final Support logout');
 assert.equal(await evaluate(page,"!document.querySelector('#support-end-day').getClientRects().length&&!document.querySelector('#support-end-dialog').open&&document.querySelector('#support-end-save').disabled"),true,'Logout clears the Support action and unfinished preview');
 const exceptions=pages.flatMap(target=>target.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text));
 assert.deepEqual(exceptions,[],'Browser has no uncaught JavaScript exceptions');
 t.diagnostic('Real Node/core + Chrome: eleven phone/tablet/desktop viewport sizes,compact mobile navigation,125% enlarged text, all seven business collection cards, selected-business filtering, exact-Admin-source partial Bank deposit with live remainder, malformed-total denial and stale-scope/permission protection, verified11:59PM Beirut monthly schedule, visible Users End of day and Main shortcut, Main routes, financial forms, actual receipt/PDF, CSV, cross-tab logout and Viewer authorization passed.');
});
