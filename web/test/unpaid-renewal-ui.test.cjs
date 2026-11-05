'use strict';
// Exercise actual renderer functions and bound handlers with fictional local
// DOM/API fixtures. No provider, network, accounting database or cash is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/app.js'),'utf8');
const FiberInternetPricing=require('../app/src/internet-pricing.js'),FiberBillPlan=require('../app/src/bill-plan.js');
function functionSource(name){
  const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(match,'Actual renderer function exists: '+name);
  const firstEnd=source.indexOf('\n',match.index),first=source.slice(match.index,firstEnd);
  if(first.trimEnd().endsWith('}'))return first;
  const end=source.indexOf('\n}',match.index);assert(end>match.index,'Actual function has a closing boundary: '+name);return source.slice(match.index,end+2);
}
function binding(startText,endText){const start=source.indexOf(startText),end=source.indexOf(endText,start);assert(start>=0&&end>start,'Actual form binding exists');return source.slice(start,end);}
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
const bundle={code:'SYNTHETIC-6GB',name:'Fictional 6GB',allowance:'6GB',serviceType:'Internet',price:20,cost:13};
const customer=()=>({username:'fictional.credit.client',name:'Fictional Credit Customer',phone:'03000001',serviceId:11,service:'Fictional 6GB',expiry:'2026-12-05T12:00:00',billingDate:'2026-11-05',resellerId:17,plans:[{id:11,name:'Fictional 6GB',cost:13,fixedCost:13,renewalCost:13}]});
const receipt=(renewalState='succeeded',extra={})=>({id:701,receiptNo:'FICTIONAL-CREDIT-701',customerAccount:'fictional.credit.client',customerName:'Fictional Credit Customer',serviceType:'Internet',amount:40,paymentMethod:'Unpaid',paymentStatus:'unpaid',paidAmount:0,remainingAmount:40,renewalMonths:2,renewal:{state:renewalState,onCredit:true,requestedMonths:2,completedMonths:renewalState==='succeeded'?2:1,remainingMonths:renewalState==='succeeded'?0:1},...extra});
function fixture(){
  const elements=new Map(),listeners=new Map(),calls=[],reviews=[],toasts=[],receipts=[],htmlWrites=[];
  function node(tag='div'){
    const classes=new Set();let text='',html='';const value={tagName:tag.toUpperCase(),value:'',disabled:false,open:false,checked:false,returnValue:'',dataset:{},children:[],selectedOptions:[],className:'',scrollTop:0,isConnected:true,
      classList:{toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)},
      append(...children){value.children.push(...children);},replaceChildren(...children){text='';html='';value.children=children;},setAttribute(name,content){value[name]=String(content);},removeAttribute(name){delete value[name];},focus(){},
      addEventListener(event,handler){listeners.set(value.selector+':'+event,handler);},showModal(){value.open=true;},close(){value.open=false;listeners.get(value.selector+':close')?.();},querySelector(){return element('#settle-submit');}};
    Object.defineProperties(value,{textContent:{get:()=>text+value.children.map(child=>child.textContent??String(child)).join(''),set(content){text=String(content);html='';value.children=[];}},innerHTML:{get:()=>html,set(content){html=String(content);text='';value.children=[];htmlWrites.push({tag,content:html});}}});return value;
  }
  function element(selector){if(!elements.has(selector)){const value=node();value.selector=selector;elements.set(selector,value);}return elements.get(selector);}
  const buttons=[element('#bill-save-only'),element('#bill-renew-button')];
  const context=vm.createContext({state:{currentView:'bills',currentUser:{accountKey:'fictional-operator-key',username:'fictional.operator',role:'cashier',active:true,permissions:['bills.create','debts.manage']},bundles:[bundle],bills:[]},businessWorkspace:{id:'fiber-users',kind:'internet'},authSessionVersion:1,
    portalCustomer:customer(),portalStatus:{ready:true},portalSelecting:false,billSaving:false,billRequestId:'fictional-credit-request-01',billAmountAutomatic:false,billBundleNeedsSelection:false,changeBusy:false,FIBERNETLB_ACCOUNT_PREFIX:'fibernetlb',
    FiberInternetPricing,FiberBillPlan,$:element,$$:selector=>selector.startsWith('#bill-form')?buttons:[],document:{createElement:node,activeElement:null},Date,Number,
    accessibleSections:()=>['fiber-users'],has:permission=>context.state.currentUser?.permissions.includes(permission)===true,formatMoney:value=>'$'+Number(value).toFixed(2),icon:()=>'<svg></svg>',errorMessage:error=>error.message,
    selectPayment:(_group,selector,method)=>{element(selector).value=method;},canChangeRenew:()=>false,
    WhishPayments:{sync(){},input(){return element('#bill-payment-method').value==='Whish Money'?{whishDestinationId:'fictional-wallet'}:{};},preview(amount,method){return method==='Whish Money'?{fee:Number(amount)*0.01,note:'Fictional fee preview'}:null;}},
    showToast:(message,type)=>toasts.push({message,type}),showReceipt:(kind,saved)=>receipts.push({kind,saved}),loadBills:async()=>{},loadDebts:async()=>{},loadDashboard:async()=>{},loadDrawer:async()=>{},loadTelecomPayments:async()=>{},loadExpenses:async()=>{},loadFreeRenewalHistory:async()=>{},
    FiberActionFeedback:{renewed:saved=>saved.renewal?.state==='succeeded',incomplete:saved=>calls.push({method:'incomplete',saved})},
    confirmPortalAction:async(message,review)=>{reviews.push({message,review});return true;},
    api:{portal:{lookup:async username=>{calls.push({method:'lookup',username});return customer();}},bills:{savePortal:async(input,wantRenew)=>{calls.push({method:'savePortal',input:structuredClone(input),wantRenew});return receipt();},saveRenew:async input=>{calls.push({method:'saveRenew',input:structuredClone(input)});return receipt();},create:async input=>{calls.push({method:'create',input:structuredClone(input)});return receipt('not_requested',{renewal:{state:'not_requested'}});},saveFreeRenewal:async input=>{calls.push({method:'saveFreeRenewal',input:structuredClone(input)});return receipt('free');},renew:async id=>{calls.push({method:'renew',id});return receipt();}},debts:{settle:async(...args)=>{calls.push({method:'settle',args});return {amount:10,remainingAmount:30};}}}
  });
  for(const [selector,value]of Object.entries({'#bill-customer-account':customer().username,'#bill-customer-name':customer().name,'#bill-service-type':'Internet','#bill-bundle':bundle.code,'#bill-period':'2026-11','#bill-months':'2','#bill-amount':'40','#bill-payment-method':'Unpaid','#bill-reference':'Fictional unpaid renewal','#portal-reseller-search':'fictional.reseller','#bill-free-funding':'0'}))element(selector).value=value;
  element('#bill-dialog').open=true;
  vm.runInContext(['selectedPortalPlan','portalWorkflowIdentity','billMonths','billFreePolicy','updateFreeRenewalForm','billRetailQuote','retailPriceNote','billRetailSelection','renderPortalConfirmation','updateBillBundleNote','updatePortalCustomerSummary','escapeHtml','paymentIcon','paymentBadge','renewalLabel','billRenewalBadge','internetBillActions','billRenewalConfirmation','billRenewalReview','saveFreeRenewal','normalizedBillAccount'].map(functionSource).join('\n'),context);
  vm.runInContext(binding('  $("#bill-form").addEventListener("submit"','\n\n  $("#telecom-form")'),context);
  vm.runInContext(binding('  $("#settle-debt-form").addEventListener("submit"','\n\n  $("#bill-form")'),context);
  const rowStart=source.indexOf('    if(target.classList.contains("renew-internet-bill"))'),rowEnd=source.indexOf('    if(target.dataset.openBandwidth)',rowStart);assert(rowStart>=0&&rowEnd>rowStart);
  vm.runInContext('globalThis.rowAction=async function(target,id){\n'+source.slice(rowStart,rowEnd)+'\n};',context);
  return {context,element,elements,calls,reviews,toasts,receipts,htmlWrites,submit:async(wantRenew=true)=>listeners.get('#bill-form:submit')({preventDefault(){},submitter:{id:wantRenew?'bill-renew-button':'bill-save-only'}}),settle:async()=>listeners.get('#settle-debt-form:submit')({preventDefault(){},currentTarget:element('#settle-debt-form')})};
}
test('verified Unpaid summary enables current-service renewal and labels debt-only separately',()=>{
  const f=fixture();f.context.updatePortalCustomerSummary();assert.equal(f.element('#bill-renew-button').disabled,false);assert.match(f.element('#bill-renew-button').innerHTML,/Save debt & Renew current service/);assert.equal(f.element('#bill-save-only').textContent,'Save debt only');
  f.context.portalCustomer.blocked=true;f.context.updatePortalCustomerSummary();assert.equal(f.element('#bill-renew-button').disabled,true);
});
test('credit review states full debt and no received payment with exact entered amount and cycle count',()=>{
  const f=fixture(),bill=receipt();const review=f.context.billRenewalReview(bill,customer(),customer().plans[0],false,true);assert.equal(review.title,'Confirm renewal on credit');assert.equal(review.actionLabel,'Save debt & Renew');assert.match(review.subtitle,/No money received/);assert.equal(review.payments[0].label,'Customer debt');assert.equal(review.payments[0].amount,'$40.00');assert.match(review.payments[0].note,/Full amount remains due/);assert.match(review.notice,/2 monthly cycles/);assert.match(review.notice,/Collecting this debt later does not renew/);assert.doesNotMatch(review.notice,/One payment/);
  const message=f.context.billRenewalConfirmation(bill.customerAccount,40,customer(),customer().plans[0],false,true,2);assert.match(message,/as customer debt/);assert.match(message,/No money has been received/);assert.match(message,/collection does not renew the service again/);
});
test('actual debt confirmation renderer inserts customer text literally',()=>{
  const f=fixture(),malicious='<img src=x onerror="globalThis.injected=true">',review=f.context.billRenewalReview({...receipt(),customerName:malicious},customer(),customer().plans[0],false,true);f.context.renderPortalConfirmation(review);assert(f.element('#portal-confirm-review').textContent.includes(malicious));assert.match(f.element('#portal-confirm-review').textContent,/Full amount remains due/);assert.equal(f.context.injected,undefined);assert.equal(f.htmlWrites.length,0);
});
test('bound Save debt & Renew sends explicit opt-in once with no received-payment destination',async()=>{
  const f=fixture();await f.submit();const sent=f.calls.filter(call=>call.method==='savePortal');assert.equal(sent.length,1);assert.equal(sent[0].wantRenew,true);assert.equal(sent[0].input.renewOnCredit,true);assert.equal(sent[0].input.amount,'40');assert.equal(sent[0].input.renewalMonths,2);assert.equal(sent[0].input.portalServiceId,11);assert.equal(sent[0].input.portalExpectedServiceId,11);assert.equal(Object.hasOwn(sent[0].input,'whishDestinationId'),false);assert.equal(f.reviews.length,1);assert.equal(f.receipts[0].saved.remainingAmount,40);
});
test('bound Save debt only preserves records-only semantics without credit authorization or confirmation',async()=>{
  const f=fixture();await f.submit(false);const sent=f.calls.find(call=>call.method==='savePortal');assert.equal(sent.wantRenew,false);assert.equal(Object.hasOwn(sent.input,'renewOnCredit'),false);assert.equal(sent.input.paymentMethod,'Unpaid');assert.equal(f.reviews.length,0);assert.match(f.toasts.at(-1).message,/added to customer debts.*no portal renewal sent/);
});
for(const method of ['Cash','Whish Money'])test(method+' current-service renewal keeps payment semantics without credit opt-in',async()=>{
  const f=fixture();f.element('#bill-payment-method').value=method;await f.submit();const sent=f.calls.find(call=>call.method==='savePortal');assert.equal(Object.hasOwn(sent.input,'renewOnCredit'),false);assert.equal(sent.input.paymentMethod,method);assert.equal(f.reviews[0].review.title,'Confirm current-service renewal');assert.equal(f.reviews[0].review.payments[0].label,'Customer payment');if(method==='Whish Money')assert.equal(sent.input.whishDestinationId,'fictional-wallet');
});
test('cancelled credit confirmation creates no request and unlocks the existing form',async()=>{
  const f=fixture();f.context.confirmPortalAction=async()=>false;await f.submit();assert.equal(f.calls.length,0);assert.equal(f.context.billSaving,false);assert.equal(f.element('#bill-dialog').open,true);assert.equal(f.element('#bill-renew-button').disabled,false);
});
for(const [name,change]of [['identity changes',f=>{f.context.authSessionVersion++;}],['permission revoked',f=>{f.context.state.currentUser.permissions=[];}],['form closed',f=>{f.element('#bill-dialog').open=false;}]])test('pending credit confirmation sends nothing after '+name,async()=>{
  const f=fixture(),pending=deferred();f.context.confirmPortalAction=()=>pending.promise;const running=f.submit();change(f);pending.resolve(true);await running;assert.equal(f.calls.length,0);assert.equal(f.context.billSaving,false);
});
test('unverified or different-service customers cannot submit credit renewal',async()=>{
  for(const mutate of [f=>{f.context.portalCustomer=null;},f=>{f.context.portalCustomer.serviceId=22;}]){const f=fixture();mutate(f);await f.submit();assert.equal(f.calls.length,0);assert.equal(f.reviews.length,0);assert.equal(f.toasts.at(-1).type,'error');}
});
test('free-period form disables Unpaid and keeps received funding outside ordinary debt renewal',async()=>{
  const f=fixture();f.context.portalCustomer.billingDate='2026-11-12';f.context.portalCustomer.expiry='2026-11-05T12:00:00';f.context.updatePortalCustomerSummary();assert.equal(f.element('input[name="bill-payment"][value="Unpaid"]').disabled,true);assert.equal(f.element('#bill-payment-method').value,'Cash');assert.equal(f.element('#bill-save-only').classList.contains('hidden'),true);assert.match(f.element('#bill-renew-button').innerHTML,/Confirm free renewal & expense funding/);await f.submit();assert.deepEqual(f.calls.map(call=>call.method),['saveFreeRenewal']);assert.equal(Object.hasOwn(f.calls[0].input,'renewOnCredit'),false);assert.equal(f.calls[0].input.amount,0);
});
test('forged Unpaid selection during free period cannot create debt or submit paid renewal',async()=>{
  const f=fixture();f.context.portalCustomer.billingDate='2026-11-12';f.context.portalCustomer.expiry='2026-11-05T12:00:00';await f.submit();assert.equal(f.calls.length,0);assert.match(f.toasts.at(-1).message,/Cash or Whish Money for expense funding/);
});
test('legacy Unpaid rows have no continuation but newly authorized pending/failed rows show only remaining cycles',()=>{
  const f=fixture();for(const state of ['not_requested','failed']){const bill=receipt(state);assert.match(f.context.internetBillActions(bill),/renew-internet-bill/);assert.match(f.context.internetBillActions(bill),/Renew 1 month/);delete bill.renewal.onCredit;assert.doesNotMatch(f.context.internetBillActions(bill),/renew-internet-bill/);}
});
test('credit rows never offer another renewal for succeeded or uncertain outcomes, including after full collection',()=>{
  const f=fixture();for(const state of ['checking','processing','unknown','succeeded','free','created'])for(const collected of [false,true]){const bill=receipt(state,collected?{paymentStatus:'paid',paymentMethod:'Cash + Whish Money',paidAmount:40,remainingAmount:0}:{});assert.doesNotMatch(f.context.internetBillActions(bill),/renew-internet-bill/,state+' collected='+collected);assert.match(f.context.internetBillActions(bill),/renewal-history/);}
  const bill=receipt();assert.match(f.context.billRenewalBadge(bill),/Internet renewed/);assert.match(f.context.paymentBadge(bill.paymentMethod,bill.paymentStatus),/Unpaid \/ Debt/);
});
test('continuation requires operator rights and enabled API, and does not apply outside Internet users',()=>{
  const f=fixture(),bill=receipt('failed');f.context.state.currentUser.permissions=[];assert.doesNotMatch(f.context.internetBillActions(bill),/renew-internet-bill/);f.context.state.currentUser.permissions=['bills.manage'];f.context.portalStatus.ready=false;assert.match(f.context.internetBillActions(bill),/data-id="701" disabled/);f.context.businessWorkspace.id='iptv';assert.equal(f.context.internetBillActions(bill),'');
});
test('bound row continuation reuses original credit bill and explains debt without creating another receipt',async()=>{
  const f=fixture(),bill=receipt('failed');f.context.state.bills=[bill];const target=f.element('#row-renew');target.classList.add('renew-internet-bill');await f.context.rowAction(target,bill.id);assert.deepEqual(f.calls.map(call=>call.method),['lookup','renew']);assert.equal(f.calls[1].id,bill.id);assert.match(f.reviews[0].message,/Customer still owes \$40\.00/);assert.match(f.reviews[0].message,/only the 1 remaining monthly cycle/);assert.match(f.reviews[0].message,/No new payment/);assert.equal(target.disabled,false);
});
test('bound debt settlement collects money only and never invokes a renewal API',async()=>{
  const f=fixture();for(const [selector,value]of Object.entries({'#settle-debt-kind':'bill','#settle-debt-id':'701','#settle-payment-method':'Cash','#settle-amount':'10','#settle-request-id':'fictional-collection-701'}))f.element(selector).value=value;await f.settle();assert.deepEqual(f.calls.map(call=>call.method),['settle']);assert.match(f.toasts.at(-1).message,/Received \$10\.00.*Remaining: \$30\.00/);assert.equal(f.element('#settle-submit').disabled,false);
});
test('combined-change payment selector remains paid-only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../app/src/index.html'),'utf8'),match=/<select id="change-renew-method">([\s\S]*?)<\/select>/.exec(html);assert(match);assert.deepEqual([...match[1].matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(option=>option[1]),['Cash','Whish Money']);
});
