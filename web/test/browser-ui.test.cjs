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

async function resellerScopedSearchBrowser(page){
 // Pointer interactions and real bound change events use fictional adapter
 // replies only. Deferred results can never contact a provider or collect money.
 await evaluate(page,`(async()=>{
  await loadBundles();
  const bundles=state.bundles.filter(row=>row.serviceType==='Internet');if(bundles.length<2)throw Error('Two fictional Internet bundles are required');
  window.__qaResellerSearch={originalPortal:{...posApi.portal},originalBills:{...posApi.bills},oldUser:state.currentUser,oldView:state.currentView,oldStatus:portalStatus,searches:[],lookups:[],mutations:0,deferNext:false};
  const qa=window.__qaResellerSearch;
  const plans=bundles.slice(0,2).map((row,index)=>({id:301+index,name:row.name,cost:13+index,fixedCost:13+index,renewalCost:13+index}));
  qa.customer=scope=>({username:scope==='fictional.beta'?'fictional.beta.client':'fictional.alpha.client',name:scope==='fictional.beta'?'Fictional Beta Client':'Fictional Alpha Client',phone:'03000003',serviceId:301,service:plans[0].name,resellerId:scope==='fictional.beta'?29:17,expiry:'2099-12-05T12:00:00',billingDate:'2026-11-05',blocked:false,plans,costVerifiedAt:new Date().toISOString()});
  posApi.portal.status=async()=>({ready:true});posApi.portal.operations=async()=>[];
  posApi.portal.resellers=async()=>[{id:17,username:'fictional.alpha',name:'Fictional Alpha'},{id:29,username:'fictional.beta',name:'Fictional Beta'}];
  posApi.portal.search=async input=>{qa.searches.push(structuredClone(input));const result={customers:[qa.customer(input.reseller)],total:1};if(qa.deferNext){qa.deferNext=false;return new Promise(resolve=>{qa.release=()=>{delete qa.release;resolve(result);};});}return result;};
  posApi.portal.lookup=async input=>{qa.lookups.push(structuredClone(input));const scope=typeof input==='object'?input.reseller:'';const found=qa.customer(scope);if((typeof input==='object'?input.username:input)!==found.username)throw Error('Fictional lookup must retain the selected reseller.');return found;};
  const denied=async()=>{qa.mutations++;throw Error('Financial actions are forbidden in the reseller-search browser fixture.');};
  posApi.portal.applyChange=denied;for(const name of ['savePortal','saveRenew','renew','startChangeRenew','confirmChangeRenew'])posApi.bills[name]=denied;
  switchView('bills',{deferLoad:true});await openBillDialog();
  document.querySelector('#portal-reseller-search').value='fictional.alpha';document.querySelector('#portal-reseller-search').dispatchEvent(new Event('change',{bubbles:true}));
  document.querySelector('#portal-customer-search').value='fictional';document.querySelector('#portal-customer-search').dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 try{
  await tap(page,'#portal-search-button');
  await waitFor(page,"document.querySelector('#portal-search-results [data-portal-index]')&&portalSearchCustomers[0]?.username==='fictional.alpha.client'",'Bills bound search keeps reseller Alpha');
  await tap(page,'#portal-search-results [data-portal-index="0"]');
  await waitFor(page,"portalCustomer?.username==='fictional.alpha.client'&&!portalSelecting",'Bills pointer selection verifies Alpha');
  await evaluate(page,"__qaResellerSearch.deferNext=true");await tap(page,'#portal-search-button');
  await waitFor(page,"typeof __qaResellerSearch.release==='function'",'Bills deferred Alpha search is in flight');
  await evaluate(page,"document.querySelector('#portal-reseller-search').value='fictional.beta';document.querySelector('#portal-reseller-search').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate(page,"portalCustomer===null&&portalSearchCustomers.length===0&&document.querySelector('#portal-search-results').textContent===''&&document.querySelector('#bill-save-only').disabled&&document.querySelector('#bill-renew-button').disabled"),true,'Committed reseller change clears the prior Bills customer, rows and payment readiness');
  await evaluate(page,"__qaResellerSearch.release();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.equal(await evaluate(page,"portalCustomer===null&&portalSearchCustomers.length===0&&!document.querySelector('#portal-search-results').textContent.includes('Alpha')"),true,'Late Alpha search cannot repopulate Bills under reseller Beta');
  await tap(page,'#portal-search-button');
  await waitFor(page,"portalSearchCustomers[0]?.username==='fictional.beta.client'",'Bills current Beta search returns Beta');
  await tap(page,'#portal-search-results [data-portal-index="0"]');
  await waitFor(page,"portalCustomer?.username==='fictional.beta.client'&&!portalSelecting",'Bills pointer selection verifies Beta');
  await evaluate(page,"document.querySelector('#bill-dialog').close();switchView('change-plan',{deferLoad:true});document.querySelector('#change-reseller').value='fictional.alpha';document.querySelector('#change-reseller').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#change-search').value='fictional';document.querySelector('#change-search').dispatchEvent(new Event('input',{bubbles:true}))");
  await tap(page,'#change-search-button');
  await waitFor(page,"changeResults[0]?.username==='fictional.alpha.client'&&document.querySelector('#change-search-results [data-change-customer]')",'Change Plan bound search keeps Alpha');
  await tap(page,'#change-search-results [data-change-customer="0"]');
  await waitFor(page,"changeCustomer?.username==='fictional.alpha.client'",'Change Plan pointer selection verifies Alpha');
  await evaluate(page,"document.querySelector('#change-reseller').value='fictional.beta';document.querySelector('#change-reseller').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate(page,"changeCustomer===null&&changeResults.length===0&&changeQuote===null&&document.querySelector('#change-target').disabled&&document.querySelector('#change-apply').disabled&&document.querySelector('#change-search-results').textContent===''"),true,'Committed reseller change clears the prior Change Plan customer, target and charge');
  await evaluate(page,"document.querySelector('#change-reseller').value='fictional.alpha';document.querySelector('#change-reseller').dispatchEvent(new Event('change',{bubbles:true}));__qaResellerSearch.deferNext=true");
  await tap(page,'#change-search-button');await waitFor(page,"typeof __qaResellerSearch.release==='function'",'Change Plan deferred Alpha search is in flight');
  await evaluate(page,"document.querySelector('#change-reseller').value='fictional.beta';document.querySelector('#change-reseller').dispatchEvent(new Event('change',{bubbles:true}));__qaResellerSearch.release();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.equal(await evaluate(page,"changeCustomer===null&&changeResults.length===0&&!document.querySelector('#change-search-results').textContent.includes('Alpha')&&document.querySelector('#change-apply').disabled"),true,'Late Alpha search cannot repopulate Change Plan or re-enable its action under Beta');
  await tap(page,'#change-search-button');await waitFor(page,"changeResults[0]?.username==='fictional.beta.client'",'Change Plan current Beta search returns Beta');
  await tap(page,'#change-search-results [data-change-customer="0"]');await waitFor(page,"changeCustomer?.username==='fictional.beta.client'",'Change Plan pointer selection verifies Beta');
  assert.deepEqual(await evaluate(page,"({searches:__qaResellerSearch.searches.map(row=>row.reseller),lookups:__qaResellerSearch.lookups.map(row=>row.reseller).filter((scope,index,scopes)=>!index||scope!==scopes[index-1]),mutations:__qaResellerSearch.mutations})"),{searches:['fictional.alpha','fictional.alpha','fictional.beta','fictional.alpha','fictional.alpha','fictional.beta'],lookups:['fictional.alpha','fictional.beta','fictional.alpha','fictional.beta'],mutations:0},'Both bound forms preserve the exact selected reseller without any financial action; repeated read-only cost refreshes retain that scope');
 }finally{
  await evaluate(page,"(()=>{const qa=window.__qaResellerSearch;if(!qa)return;if(qa.release)qa.release();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();Object.assign(posApi.portal,qa.originalPortal);Object.assign(posApi.bills,qa.originalBills);state.currentUser=qa.oldUser;portalStatus=qa.oldStatus;portalCustomer=null;portalSearchCustomers=[];portalLookupVersion++;portalSearchVersion++;portalSelecting=false;invalidateChange(true);applyPermissions();switchView(qa.oldView,{deferLoad:true});delete window.__qaResellerSearch;})()");
 }
}

async function combinedServiceChangeBrowser(page){
 // Fictional adapter responses exercise the genuine bound browser controls. No provider or live customer is called.
 await evaluate(page,`(async()=>{
  await loadBundles();
  const bundles=state.bundles.filter(row=>row.serviceType==='Internet');if(bundles.length<2)throw Error('Two fictional catalogue matches are required');
  window.__qaCombined={current:101,changeSends:0,payments:0,renewals:0,lookups:0,zero:true,loseStart:true,unknown:false,record:null,oldUser:state.currentUser,originalPortal:{...posApi.portal},originalBills:{...posApi.bills},plans:bundles.slice(0,2).map((row,index)=>({id:101+index,name:row.name,cost:3,fixedCost:6,renewalCost:3}))};
  const qa=window.__qaCombined;
  posApi.portal.status=async()=>({ready:true});posApi.portal.resellers=async()=>[];posApi.portal.operations=async()=>[];
  posApi.portal.lookup=async()=>{qa.lookups++;const plan=qa.plans.find(row=>row.id===qa.current);return {username:'fictional.browser.customer',name:'Fictional Service Customer',phone:'03000002',serviceId:plan.id,service:plan.name,expiry:'2026-11-06T12:00:00',billingDate:'2026-11-05',blocked:false,plans:qa.plans,costVerifiedAt:new Date().toISOString()};};
  const initial=input=>({phase:'review_change',quoteId:'fictional-change-quote-'+input.targetId,validUntil:new Date(Date.now()+120000).toISOString(),username:input.username,customerName:'Fictional Service Customer',beforeName:qa.plans.find(row=>row.id===input.expectedId).name,targetName:qa.plans.find(row=>row.id===input.targetId).name,expectedId:input.expectedId,targetId:input.targetId,renewalMonths:input.renewalMonths,changeCustomerAmount:qa.zero?0:4.25,changeAmountRequired:false,policyDate:qa.zero?'2026-11-03':'2026-11-06',policyTimezone:'Asia/Beirut',zeroChargeWindow:qa.zero,changeCost:1.5,renewalCustomerAmount:25,totalToCollect:qa.zero?25:29.25});
  posApi.bills.quoteChangeRenew=async input=>{const quote=initial(input);if(qa.delayQuote)return new Promise(resolve=>{qa.releaseQuote=()=>resolve(quote);});qa.quote=quote;return structuredClone(quote);};
  posApi.bills.startChangeRenew=async input=>{qa.changeSends++;qa.current=input.targetId;qa.record={...qa.quote,requestId:input.requestId,phase:qa.unknown?'change_unknown':'awaiting_payment',state:qa.unknown?'change_unknown':'awaiting_payment',token:'fictional-post-change-payment-token',renewalCost:3};if(qa.loseStart){qa.loseStart=false;throw Error('Fictional lost response after the service change was saved. Check saved request.');}return structuredClone(qa.record);};
  posApi.bills.changeRenewStatus=async input=>input.requestId?structuredClone(qa.record):{pending:qa.record&&!['completed','change_failed'].includes(qa.record.phase)?[structuredClone(qa.record)]:[]};
  posApi.bills.resumeChangeRenew=async input=>{(qa.resumeInputs||=[]).push(input);if(qa.record.canFinalize){delete qa.record.canFinalize;qa.record.phase='completed';return structuredClone(qa.record);}qa.record.phase='awaiting_payment';qa.record.validUntil=new Date(Date.now()+120000).toISOString();if(qa.refreshRetail){qa.record.renewalCustomerAmount=qa.refreshRetail;qa.record.totalToCollect=qa.record.changeCustomerAmount+qa.refreshRetail;qa.record.token='fictional-refreshed-payment-token';}return structuredClone(qa.record);};
  posApi.bills.confirmChangeRenew=async input=>{qa.payments++;qa.renewals++;qa.paymentInput=structuredClone(input);qa.record={...qa.record,phase:'completed',bill:{id:900001,receiptNo:'FICTIONAL-COMBINED-001',customerAccount:'fictional.browser.customer',customerName:'Fictional Service Customer',serviceType:'Internet',bundleName:qa.record.targetName,bundleDetails:'Service change plus renewal: one payment',amount:input.amount,paymentMethod:input.paymentMethod,paymentStatus:'paid',paidAmount:input.amount,remainingAmount:0,paidAt:new Date().toISOString(),cashierName:'Fictional Browser Admin',renewalMonths:1,renewal:{state:'succeeded',completedMonths:1,requestedMonths:1}}};return structuredClone(qa.record);};
  posApi.bills.receiptCredentials=async()=>({username:'fictional.browser.customer',password:'fictional-not-a-real-password'});
  posApi.portal.quoteChange=async input=>({quoteId:'fictional-standalone-zero',username:input.username,expectedId:input.expectedId,targetId:input.targetId,beforeName:qa.plans.find(row=>row.id===input.expectedId).name,targetName:qa.plans.find(row=>row.id===input.targetId).name,total:1.5,expiry:'2026-11-06T12:00:00',retailPricing:{available:true,customerAmount:0,zeroChargeWindow:true,policyDate:'2026-11-03',policyTimezone:'Asia/Beirut'}});
  switchView('bills',{deferLoad:true});await openBillDialog();document.querySelector('#bill-customer-account').value='fictional.browser.customer';await selectPortalCustomer('fictional.browser.customer');
 })()`);
 assert.equal(await evaluate(page,"document.querySelector('#bill-bundle').options.length"),1,'Renewal selector exposes only the verified current service');
 assert.equal(await evaluate(page,"document.querySelector('#bill-bundle').disabled"),true,'Current service is fixed in the ordinary renewal form');
 await tap(page,'#portal-change-renew-open');await waitFor(page,"document.querySelector('#change-renew-dialog').open",'Combined service wizard opens');
 await evaluate(page,"document.querySelector('#change-renew-target').value='102';document.querySelector('#change-renew-target').dispatchEvent(new Event('change'))");await tap(page,'#change-renew-quote');
 await waitFor(page,"!document.querySelector('#change-renew-first-review').classList.contains('hidden')",'Native service-change review');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-change-amount').value"),'0.00','Dates1–5 service-change customer charge is fixed0');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-change-amount').readOnly"),true);
 assert.match(await evaluate(page,"document.querySelector('#change-renew-estimate').textContent"),/Full customer charge \$25\.00/,'Full customer charge is shown before service change');
 await tap(page,'#change-renew-start');await waitFor(page,"document.querySelector('#portal-confirm-dialog').open",'Separate first-phase provider confirmation');
 assert.equal(await evaluate(page,"__qaCombined.changeSends+__qaCombined.payments+__qaCombined.renewals"),0,'No action runs before the service-change confirmation');
 await tap(page,'#portal-confirm-accept');await waitFor(page,"document.querySelector('#change-renew-status').textContent.includes('lost response')",'Lost change response is preserved');
 assert.equal(await evaluate(page,"__qaCombined.changeSends"),1);assert.equal(await evaluate(page,"__qaCombined.payments"),0,'Service-change phase records no separate customer payment');
 await tap(page,'#change-renew-close');await waitFor(page,"document.querySelector('[data-change-renew-request]')",'Saved parent is discoverable after closing the wizard');
 await tap(page,'[data-change-renew-request]');await waitFor(page,"!document.querySelector('#change-renew-payment').classList.contains('hidden')",'Reopen exact saved request');
 assert.equal(await evaluate(page,"__qaCombined.changeSends"),1,'Opening saved request never repeats known service change');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-amount').value"),'25.00','Full amount collected is automatically filled');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-amount').readOnly"),true);
 await evaluate(page,"document.querySelector('#change-renew-method').value='Whish Money';document.querySelector('#change-renew-method').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#change-renew-method-whish').value=document.querySelector('#change-renew-method-whish').options[1].value;document.querySelector('#change-renew-method-whish').dispatchEvent(new Event('change',{bubbles:true}))");
 assert.match(await evaluate(page,"document.querySelector('#change-renew-method-whish-note').textContent"),/Full wallet credit: \$25\.00/,'Whish fee preview uses the combined amount once');
 await evaluate(page,"document.querySelector('#change-renew-ack').checked=true;document.querySelector('#change-renew-ack').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#change-renew-method').value='Cash';document.querySelector('#change-renew-method').dispatchEvent(new Event('change',{bubbles:true}))");
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-ack').checked"),false,'Changing the payment method invalidates the full-amount acknowledgement');
 await evaluate(page,"document.querySelector('#change-renew-method').value='Whish Money';document.querySelector('#change-renew-method').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#change-renew-ack').checked=true;document.querySelector('#change-renew-ack').dispatchEvent(new Event('change',{bubbles:true}))");
 await evaluate(page,"__qaCombined.refreshRetail=26");await tap(page,'#change-renew-resume');await waitFor(page,"document.querySelector('#change-renew-amount').value==='26.00'",'Refreshed server quote displays its current full charge');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-ack').checked"),false,'A changed quote token and full total require a fresh acknowledgement');
 await evaluate(page,"document.querySelector('#change-renew-ack').checked=true;document.querySelector('#change-renew-ack').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#change-renew-amount').value='27.00';document.querySelector('#change-renew-amount').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await evaluate(page,"!document.querySelector('#change-renew-ack').checked&&document.querySelector('#change-renew-confirm').disabled"),true,'Changing even a readonly amount programmatically clears the payment acknowledgement');
 await evaluate(page,"document.querySelector('#change-renew-amount').value='26.00';document.querySelector('#change-renew-amount').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#change-renew-ack').checked=true;document.querySelector('#change-renew-ack').dispatchEvent(new Event('change',{bubbles:true}))");
 await responsive(page,'Combined service change and single payment');await enlargedText(page,'Combined service change and single payment');
 await navigationScreenshot(page,'service-change-renewal-desktop');await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigationScreenshot(page,'service-change-renewal-mobile');await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await tap(page,'#change-renew-confirm');await waitFor(page,"document.querySelector('#portal-confirm-dialog').open",'One full customer-payment confirmation');
 assert.equal(await evaluate(page,"__qaCombined.payments"),0,'Opening final confirmation has not collected payment');
 assert.deepEqual(await evaluate(page,"({label:document.querySelector('.confirm-payment-separate > div > strong').textContent,amount:document.querySelector('.confirm-payment-separate .confirm-payment-value > strong').textContent})"),{label:'Total amount collected',amount:'$26.00'});
 await tap(page,'#portal-confirm-accept');await waitFor(page,"changeRenewWorkflow.record?.phase==='completed'",'Combined payment completes');
 assert.deepEqual(await evaluate(page,"({change:__qaCombined.changeSends,payment:__qaCombined.payments,renewal:__qaCombined.renewals,amount:__qaCombined.paymentInput.amount,method:__qaCombined.paymentInput.paymentMethod,hasWallet:Boolean(__qaCombined.paymentInput.whishDestinationId)})"),{change:1,payment:1,renewal:1,amount:26,method:'Whish Money',hasWallet:true},'One change, one combined payment and one renewal use the exact selected wallet and newly reviewed total');
 await tap(page,'#change-renew-receipt');await waitFor(page,"document.querySelector('#receipt-dialog').open",'Single combined receipt');assert.equal(await evaluate(page,"document.querySelector('#receipt-number').textContent"),'FICTIONAL-COMBINED-001');await evaluate(page,"document.querySelector('#receipt-dialog').close()");
 await evaluate(page,"__qaCombined.record.phase='renewal_pending';__qaCombined.record.canFinalize=true;void loadChangeRenewPending()");await waitFor(page,"document.querySelector('[data-change-renew-request]')",'Incomplete local completion audit stays recoverable');await tap(page,'[data-change-renew-request]');await waitFor(page,"document.querySelector('#change-renew-resume').textContent==='Finalize saved receipt'",'Proven receipt finalization action');await tap(page,'#change-renew-resume');await waitFor(page,"changeRenewWorkflow.record?.phase==='completed'",'Local-only finalization completes');assert.equal(await evaluate(page,"Object.hasOwn(__qaCombined.resumeInputs.at(-1),'renew')"),false,'Finalizing a succeeded renewal never requests another provider renewal');assert.equal(await evaluate(page,"__qaCombined.renewals"),1);await tap(page,'#change-renew-close');
 await evaluate(page,"(async()=>{await openBillDialog();document.querySelector('#bill-customer-account').value='fictional.browser.customer';await selectPortalCustomer('fictional.browser.customer');})()");
 await tap(page,'#portal-change-plan-first');await waitFor(page,"changeCustomer?.username==='fictional.browser.customer'",'Standalone service-change handoff verifies customer');
 await evaluate(page,"document.querySelector('#change-target').value='101';document.querySelector('#change-target').dispatchEvent(new Event('change'))");await tap(page,'#change-calculate');await waitFor(page,"!document.querySelector('#change-quote-panel').classList.contains('hidden')",'Standalone free-date change quote');
 assert.equal(await evaluate(page,"document.querySelector('#change-amount').value"),'0.00');assert.equal(await evaluate(page,"document.querySelector('#change-amount').readOnly"),true);assert.doesNotMatch(await evaluate(page,"document.querySelector('#change-quote-panel').textContent"),/NaN|undefined/,'Zero-date policy does not assume unavailable prorating fields');
 await evaluate(page,"(async()=>{__qaCombined.zero=false;__qaCombined.unknown=true;switchView('bills',{deferLoad:true});await openBillDialog();document.querySelector('#bill-customer-account').value='fictional.browser.customer';await selectPortalCustomer('fictional.browser.customer');})()");
 await tap(page,'#portal-change-renew-open');await evaluate(page,"document.querySelector('#change-renew-target').value='101';document.querySelector('#change-renew-target').dispatchEvent(new Event('change'))");await tap(page,'#change-renew-quote');await waitFor(page,"changeRenewWorkflow.quote?.changeCustomerAmount===4.25",'Normal service-change charge from the6th');assert.match(await evaluate(page,"document.querySelector('#change-renew-estimate').textContent"),/Full customer charge \$29\.25/);
 await tap(page,'#change-renew-start');await waitFor(page,"document.querySelector('#portal-confirm-dialog').open",'Unknown-outcome fixture confirmation');await tap(page,'#portal-confirm-accept');await waitFor(page,"changeRenewWorkflow.record?.phase==='change_unknown'",'Uncertain native change remains pending');
 assert.equal(await evaluate(page,"document.querySelector('#change-renew-payment').classList.contains('hidden')"),true,'Unknown change cannot collect or renew');assert.equal(await evaluate(page,"document.querySelector('#change-renew-resume').classList.contains('hidden')"),true,'Unknown change has no blind retry');assert.equal(await evaluate(page,"__qaCombined.payments"),1);
 await tap(page,'#change-renew-close');
 await evaluate(page,"(async()=>{__qaCombined.record=null;__qaCombined.delayQuote=true;await openBillDialog();document.querySelector('#bill-customer-account').value='fictional.browser.customer';await selectPortalCustomer('fictional.browser.customer');})()");await tap(page,'#portal-change-renew-open');await evaluate(page,"document.querySelector('#change-renew-target').value='102';document.querySelector('#change-renew-target').dispatchEvent(new Event('change'))");await tap(page,'#change-renew-quote');await waitFor(page,"typeof __qaCombined.releaseQuote==='function'",'Delayed quote fixture');
 await evaluate(page,"state.currentUser={...state.currentUser,permissions:state.currentUser.permissions.filter(value=>!['plans.manage','bills.manage'].includes(value))};applyPermissions();__qaCombined.releaseQuote()");
 assert.equal(await evaluate(page,"!document.querySelector('#change-renew-dialog').open&&changeRenewWorkflow.quote===null&&document.querySelector('#change-renew-total').textContent===''"),true,'Permission removal closes and clears wizard; late quote cannot restore financial controls');
 await evaluate(page,"Object.assign(posApi.portal,__qaCombined.originalPortal);Object.assign(posApi.bills,__qaCombined.originalBills);state.currentUser=__qaCombined.oldUser;applyPermissions();clearChangeRenewal();portalCustomer=null;portalStatus={ready:false};invalidateChange(true);delete window.__qaCombined;");
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
 const financeDate=(await backend.request({channel:'finance:overview',args:[{workspaceId:'all'}],workspaceId:'main',token:ownerLogin.data.sessionToken})).data.today;
 const priorDate=new Date(financeDate+'T12:00:00Z');priorDate.setUTCMonth(priorDate.getUTCMonth()-1,1);const priorMonth=priorDate.toISOString().slice(0,7);
 const wallet=await backend.request({channel:'whish:save',args:[{label:'Fictional prior-month wallet',number:'03000001',active:true}],workspaceId:'main',token:ownerLogin.data.sessionToken});assert.equal(wallet.status,200);
 await backend.close();
 const SQL=await require('sql.js')(),fixtureFile=path.join(data,'sections','fiber-users.sqlite'),fixtureDb=new SQL.Database(fs.readFileSync(fixtureFile));
 try{
  const F=require('../app/finance-ledger.cjs'),actor=F.query(fixtureDb,"SELECT * FROM users WHERE username='browser.fixture.admin'")[0];
  fixtureDb.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,note,created_at,user_id,user_name) VALUES(100,'synthetic_opening','test','Fictional previous-month cash',?,?,?)",[priorMonth+'-15T12:00:00',actor.id,actor.full_name]);
  fixtureDb.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-prior-wallet','synthetic_opening',wallet.data.id,actor.account_key,3000,priorMonth+'-15T12:00:00']);
  fixtureDb.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-current-wallet','synthetic_opening',wallet.data.id,actor.account_key,2000,financeDate+'T00:00:00']);
  fs.writeFileSync(fixtureFile,Buffer.from(fixtureDb.export()));
 }finally{fixtureDb.close();}
 backend=await createBackend({dataDirectory:data,initialize:false,secrets,providersEnabled:false,version:'0.1.0-browser-test'});
 const reopened=await backend.request({channel:'auth:login',args:[{username:'browser.fixture.admin',password}],workspaceId:'main'});assert.equal(reopened.status,200);
 const closeReview=await backend.request({channel:'finance:closeMonthPreview',args:[{workspaceId:'fiber-users',month:priorMonth,allocations:[]}],workspaceId:'main',token:reopened.data.sessionToken});assert.equal(closeReview.status,200);
 const closed=await backend.request({channel:'finance:commitMonthClose',args:[{workspaceId:'fiber-users',month:priorMonth,allocations:[],requestId:'fictional-browser-prior-month',token:closeReview.data.token,confirmation:'CLOSE '+priorMonth}],workspaceId:'main',token:reopened.data.sessionToken});assert.equal(closed.status,200);
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
 assert.equal(await evaluate(page,"Boolean(document.querySelector('#month-collections'))"),false,'Money-to-collect section is removed from Main dashboard');
 await evaluate(page,"switchView('bank')");
 await waitFor(page,"document.querySelectorAll('[data-bank-account]').length===7&&document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-total]')",'Previous-month balances inside existing Bank cards');
 assert.equal(await evaluate(page,"document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-cash]').textContent"),'$100.00','Current-month cash is excluded from previous-month money');
 assert.equal(await evaluate(page,"document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-whish]').textContent"),'$30.00','Current-month Whish is excluded from previous-month money');
 assert.equal(await evaluate(page,"document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-total]').textContent"),'$130.00');
 await responsive(page,'Bank previous-month business cards');await enlargedText(page,'Bank previous-month business cards');
 await evaluate(page,"document.querySelector('#bank-business').value='fiber-users';document.querySelector('#bank-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-bank-account]').length===1&&document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-total]')",'Previous-month Bank cards follow selected business');
 await evaluate(page,"document.querySelector('[data-bank-collect=\"fiber-users\"][data-bank-method=cash]').click()");
 await waitFor(page,"document.querySelector('#bank-transfer-form')&&document.querySelector('#bank-transfer-business').value==='fiber-users'&&document.querySelector('#bank-holder').options.length>=2",'Previous-month Bank deposit chooses exact business');
 assert.equal(await evaluate(page,"document.querySelector('#bank-transfer-business').disabled"),true,'Previous-month deposit cannot silently switch businesses');
 assert.equal(await evaluate(page,"document.querySelector('#bank-business-cash').textContent"),'$317.00','Current business custody remains separately visible');
 await responsive(page,'Previous-month Bank deposit');await enlargedText(page,'Previous-month Bank deposit');
 await evaluate(page,"(()=>{const holder=document.querySelector('#bank-holder');holder.value=[...holder.options].find(option=>option.textContent.endsWith('· Admin')).value;holder.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#bank-amount').value='50';document.querySelector('#bank-review').click();})()");
 await waitFor(page,"!document.querySelector('#bank-impact').hidden&&!document.querySelector('#bank-ack-field').hidden",'Previous-month partial Bank review');
 assert.match(await evaluate(page,"document.querySelector('#bank-prior-source-limit').textContent"),/\$100\.00/,'Exact source is capped to old money despite new receipts');
 assert.match(await evaluate(page,"document.querySelector('#bank-impact').textContent"),/Cash drawer after\$250\.00/,'Only the explicitly selected Admin drawer is debited');
 assert.match(await evaluate(page,"document.querySelector('#bank-impact').textContent"),/Previous-month source remaining after deposit\$50\.00/);
 await evaluate(page,"document.querySelector('#bank-ack').checked=true;document.querySelector('#bank-ack').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#bank-transfer-form').requestSubmit()");
 await waitFor(page,"!document.querySelector('#bank-transfer-form')&&document.querySelector('[data-bank-prior=\"fiber-users\"] [data-bank-prior-total]')?.textContent==='$80.00'",'Partial old-money deposit updates only previous-month remainder');
 assert.equal(await evaluate(page,"document.querySelector('[data-bank-account=\"fiber-users\"] [data-bank-account-balance]').textContent"),'$50.00');
 await evaluate(page,"(async()=>{window.__qaCollectionOriginal=posApi.bank.collectionOverview;window.__qaLateCollection=await posApi.bank.collectionOverview({workspaceId:'fiber-users'});posApi.bank.collectionOverview=input=>input.workspaceId==='fiber-users'?new Promise(resolve=>{window.__qaReleaseCollection=resolve;}):window.__qaCollectionOriginal(input);void Bank.load();})()");
 await waitFor(page,"typeof window.__qaReleaseCollection==='function'",'Retained delayed Bank collection read');
 await evaluate(page,"document.querySelector('#bank-business').value='all';document.querySelector('#bank-business').dispatchEvent(new Event('change',{bubbles:true}))");
 await waitFor(page,"document.querySelectorAll('[data-bank-account]').length===7",'New Bank scope loads before old response');
 await evaluate(page,"window.__qaReleaseCollection(window.__qaLateCollection);posApi.bank.collectionOverview=window.__qaCollectionOriginal;delete window.__qaCollectionOriginal;delete window.__qaReleaseCollection;delete window.__qaLateCollection");
 assert.equal(await evaluate(page,"document.querySelectorAll('[data-bank-account]').length"),7,'Late selected-business response cannot replace all Bank cards');
 await evaluate(page,"(async()=>{window.__qaCollectionOriginal=posApi.bank.collectionOverview;const original=await posApi.bank.collectionOverview({workspaceId:'all'});posApi.bank.collectionOverview=async()=>({...original,totals:{...original.totals,total:999999}});await Bank.load();})()");
 await waitFor(page,"!document.querySelector('[data-bank-account]')&&!document.querySelector('#bank-status').hidden",'Unverified old-money totals clear Bank cards');
 await evaluate(page,"posApi.bank.collectionOverview=window.__qaCollectionOriginal;delete window.__qaCollectionOriginal;void Bank.load()");
 await waitFor(page,"document.querySelectorAll('[data-bank-account]').length===7",'Verified Bank cards recover safely');
 await evaluate(page,"(async()=>{window.__qaCollectionOriginal=posApi.bank.collectionOverview;window.__qaCollectionAdmin=state.currentUser;window.__qaLateCollection=await posApi.bank.collectionOverview({workspaceId:'all'});posApi.bank.collectionOverview=()=>new Promise(resolve=>{window.__qaReleaseCollection=resolve;});void Bank.load();})()");
 await waitFor(page,"typeof window.__qaReleaseCollection==='function'",'Retained prior-month read before role revocation');
 await evaluate(page,"state.currentUser={...state.currentUser,role:'viewer'};Bank.updateUser(state.currentUser);window.__qaReleaseCollection(window.__qaLateCollection)");
 assert.equal(await evaluate(page,"!document.querySelector('[data-bank-account]')&&!document.querySelector('#bank-transfer-form')&&!document.querySelector('#bank-root').textContent.includes('$')"),true,'Revoked Admin permission clears Bank money and rejects a late response');
 await evaluate(page,"posApi.bank.collectionOverview=window.__qaCollectionOriginal;state.currentUser=window.__qaCollectionAdmin;Bank.updateUser(state.currentUser);delete window.__qaCollectionOriginal;delete window.__qaCollectionAdmin;delete window.__qaReleaseCollection;delete window.__qaLateCollection;void Bank.open()");
 await waitFor(page,"document.querySelectorAll('[data-bank-account]').length===7",'Bank cards reload only after Admin access is restored');
 await waitFor(page,"document.querySelector('#toast-region').childElementCount===0",'Bank notification settles before guide screenshot');
 await evaluate(page,"scrollTo(0,document.querySelector('#bank-accounts').getBoundingClientRect().top+scrollY-20)");await navigationScreenshot(page,'bank-prior-month-desktop');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate(page,"scrollTo(0,document.querySelector('[data-bank-account=\"fiber-users\"]').getBoundingClientRect().top+scrollY-115)");await navigationScreenshot(page,'bank-prior-month-mobile');
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate(page,"switchView('dashboard')");
 const views=await evaluate(page,"[...document.querySelectorAll('.nav-item[data-view]')].filter(button=>button.offsetParent&&!['dashboard','backups'].includes(button.dataset.view)).map(button=>button.dataset.view)");
 for(const view of views){
  await evaluate(page,`document.querySelector('.nav-item[data-view="${view}"]').click()`);
  await pause(120);await waitFor(page,"window.__qaPending===0",'Main '+view+' requests');
  assert.equal(await evaluate(page,`state.currentView===${JSON.stringify(view)}`),true,'Main '+view+' route is active');
  await responsive(page,'Main '+view);
  if(view==='ledger'){
   await waitFor(page,"document.querySelector('#automatic-month-status')?.textContent.includes('11:59 PM')",'Verified automatic monthly closing schedule');
   assert.match(await evaluate(page,"document.querySelector('#automatic-month-status').textContent"),/Beirut time/);
   await evaluate(page,`document.querySelector('#ledger-business').value='main';document.querySelector('#ledger-business').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#ledger-close-month').value=${JSON.stringify(priorMonth)};document.querySelector('#ledger-close-button').click()`);
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
 await resellerScopedSearchBrowser(page);
 await combinedServiceChangeBrowser(page);
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
 assert.equal(await evaluate(page,"Boolean(document.querySelector('#month-collections'))"),false,'Viewer does not inherit Admin business collection cards');
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
  assert.equal(await evaluate(page,"Boolean(document.querySelector('#month-collections'))"),false,role+' cannot see Admin business collection cards');
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
 t.diagnostic('Real Node/core + Chrome: eleven phone/tablet/desktop viewport sizes, compact navigation,125% text, prior-month Bank custody and partial deposit, verified11:59PM schedule, Users End of day, pointer-operated Bills and Change Plan reseller searches with committed selection clearing and stale in-flight result rejection, fictional one-payment change/renew wizard with zero/date pricing, lost-response recovery without repeated change, fresh full-total acknowledgement, one Whish payment and receipt, unknown denial, local-only succeeded-renewal finalization, stale permission quote denial, receipt/PDF/CSV and logout privacy passed.');
});
