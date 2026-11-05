'use strict';
// Actual renderer functions with deferred in-memory replies. No browser,
// accounting data, provider connection, or financial submission is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/app.js'),'utf8');
function functionSource(name){
  const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(match,'Actual renderer function exists: '+name);
  const firstEnd=source.indexOf('\n',match.index),first=source.slice(match.index,firstEnd);
  if(first.trimEnd().endsWith('}'))return first;
  const end=source.indexOf('\n}',match.index);assert(end>match.index,'Actual renderer function has a closing boundary: '+name);
  return source.slice(match.index,end+2);
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const customer=(username='fictional.alpha.client')=>({username,name:'Synthetic Alpha Customer',phone:'03000001',serviceId:11,service:'Fictional 6GB',expiry:'2099-12-05',resellerId:17,plans:[{id:11,name:'Fictional 6GB',cost:13},{id:22,name:'Fictional 8GB',cost:16}]});
function fixture(kind='portal'){
  const elements=new Map(),calls=[],toasts=[],updates=[],listeners=new Map();
  function element(selector){
    if(!elements.has(selector)){
      const classes=new Set();let html='',text='';
      const value={value:'',disabled:false,readOnly:false,checked:false,open:false,options:[],dataset:{},parentElement:{classList:{toggle(){}}},classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},insertAdjacentHTML(position,value){assert.equal(position,'beforeend');html+=String(value);},addEventListener(event,handler){listeners.set(selector+':'+event,handler);}};
      Object.defineProperties(value,{innerHTML:{get:()=>html,set(value){html=String(value);text='';}},textContent:{get:()=>text,set(value){text=String(value);html='';}}});elements.set(selector,value);
    }
    return elements.get(selector);
  }
  element('#portal-reseller-search').value='fictional.alpha';element('#change-reseller').value='fictional.alpha';
  element('#portal-customer-search').value='fictional';element('#change-search').value='fictional';
  element('#bill-dialog').open=true;element('#bill-customer-account').value='fictional.alpha.client';element('#change-target').value='22';
  const context=vm.createContext({
    state:{currentView:kind==='change'?'change-plan':'bills',currentUser:{accountKey:'main:fictional',username:'fictional.operator',role:'admin',active:true,permissions:['plans.manage','bills.create']},bundles:[]},
    businessWorkspace:{id:'fiber-users'},authSessionVersion:1,
    portalSearchCustomers:[],portalSearchVersion:0,portalLookupVersion:0,portalSelecting:false,portalCustomer:null,portalStatus:{ready:true},billRequestId:'fictional-bill-request',billSaving:false,billBundleNeedsSelection:false,billAmountAutomatic:false,costRefreshPending:false,
    changeResults:[],changeVersion:0,changeCustomer:null,changeQuote:null,changeBusy:false,changeRequestId:'fictional-change-request',
    crypto:{randomUUID:()=> 'fictional-generated-change-request'},$:element,$$:()=>[],
    accessibleSections:()=>['fiber-users'],
    has:permission=>context.state.currentUser?.permissions.includes(permission)===true,
    api:{portal:{search:async value=>{calls.push({method:'search',value});return {customers:[],total:0};},lookup:async value=>{calls.push({method:'lookup',value});return customer();},quoteChange:async value=>{calls.push({method:'quoteChange',value});return {};}}},
    icon:()=>'<svg aria-hidden="true"></svg>',errorMessage:error=>error.message,showToast:(message,type)=>toasts.push({message,type}),
    updatePortalCustomerSummary:()=>updates.push('summary'),updateBillBundleNote:()=>updates.push('note'),updateBillBundleOptions:()=>updates.push('bundle'),updateChangeProfitPreview:()=>updates.push('profit'),
    loadBundles:async()=>{updates.push('loadBundles');},FiberBillPlan:{matchInternetBundle:()=>null},formatMoney:value=>'$'+Number(value).toFixed(2)
  });
  vm.runInContext(['portalWorkflowIdentity','portalWorkflowCurrent','escapeHtml','invalidateChange','searchChangeCustomers','selectChangeCustomer','calculateChange','refreshPortalCustomerCosts','selectPortalCustomer','searchPortalCustomers'].map(functionSource).join('\n'),context);
  return {context,element,elements,calls,toasts,updates,listeners};
}
const form=kind=>kind==='portal'?{method:'searchPortalCustomers',scope:'#portal-reseller-search',term:'#portal-customer-search',results:'#portal-search-results',array:'portalSearchCustomers'}:{method:'searchChangeCustomers',scope:'#change-reseller',term:'#change-search',results:'#change-search-results',array:'changeResults'};
const transitions=[
  ['reseller A to B',(f,s)=>{f.element(s.scope).value='fictional.beta';}],
  ['reseller A to all',(f,s)=>{f.element(s.scope).value='';}],
  ['search term changed',(f,s)=>{f.element(s.term).value='different';}],
  ['signed out',f=>{f.context.state.currentUser=null;}],
  ['permissions changed',f=>{f.context.state.currentUser.permissions=[];}],
  ['left the search view',f=>{f.context.state.currentView='dashboard';f.element('#bill-dialog').open=false;}]
];
for(const kind of ['portal','change'])for(const[label,transition]of transitions)for(const outcome of ['response','error'])test(`${kind} search ignores a deferred ${outcome} after ${label}`,async()=>{
  const f=fixture(kind),s=form(kind),pending=deferred();
  f.context.api.portal.search=async value=>{f.calls.push(value);return pending.promise;};
  const running=f.context[s.method]();assert.equal(f.calls.length,1);assert.equal(f.calls[0].reseller,'fictional.alpha');
  transition(f,s);
  if(outcome==='error')pending.reject(Error('Synthetic stale reseller failure'));
  else pending.resolve({customers:[customer()],total:1});
  await assert.doesNotReject(running);
  assert.equal(f.context[s.array].length,0);assert.equal(f.element(s.results).innerHTML.includes('fictional.alpha.client'),false);
  assert.equal(f.element(s.results).textContent.includes('Synthetic stale reseller failure'),false);assert.equal(f.toasts.length,0);
});
for(const kind of ['portal','change'])test(`${kind} search accepts current selected-reseller results, escapes literal data and shows a truncation hint`,async()=>{
  const f=fixture(kind),s=form(kind),entry={...customer(),name:'<img src=x onerror="globalThis.injected=true">',phone:'<script>synthetic</script>'};
  f.context.api.portal.search=async value=>{f.calls.push(value);return {customers:[entry],total:1,truncated:true};};
  await f.context[s.method]();
  assert.equal(f.calls[0].reseller,'fictional.alpha');assert.equal(f.calls[0].term,'fictional');
  assert.equal(f.context[s.array][0].username,entry.username);
  const html=f.element(s.results).innerHTML;assert(html.includes('&lt;img'));assert(html.includes('&lt;script&gt;'));assert.doesNotMatch(html,/<img|<script/);
  assert.match(html,/More customers may match/);assert.match(html,/narrow this reseller search/);assert.equal(f.context.injected,undefined);
});
for(const kind of ['portal','change'])test(`${kind} search preserves intentional blank all-reseller scope and reports an empty truncated window`,async()=>{
  const f=fixture(kind),s=form(kind);f.element(s.scope).value='';
  f.context.api.portal.search=async value=>{f.calls.push(value);return {customers:[],total:0,truncated:true};};
  await f.context[s.method]();assert.equal(f.calls[0].reseller,'');assert.equal(f.context[s.array].length,0);
  assert.match(f.element(s.results).innerHTML,/More customers may match/);
});
for(const kind of ['portal','change'])test(`${kind} search displays a current error without restoring previous customer rows`,async()=>{
  const f=fixture(kind),s=form(kind);f.context[s.array]=[customer()];
  f.context.api.portal.search=async()=>{throw Error('Synthetic current search failure');};
  if(kind==='change')await assert.rejects(f.context[s.method](),/Synthetic current search failure/);else await f.context[s.method]();
  assert.equal(f.context[s.array].length,0);assert.equal(f.element(s.results).textContent,'Synthetic current search failure');
});
test('bill lookup cannot restore an old reseller selection before or after its bundle await',async()=>{
  for(const afterBundles of [false,true]){
    const f=fixture(),lookup=deferred(),bundles=deferred();
    f.context.api.portal.lookup=async()=>lookup.promise;f.context.loadBundles=async()=>bundles.promise;
    const running=f.context.selectPortalCustomer('fictional.alpha.client');
    if(afterBundles){lookup.resolve(customer());await Promise.resolve();await Promise.resolve();}
    f.element('#portal-reseller-search').value='fictional.beta';const replacement=customer('fictional.beta.client');f.context.portalCustomer=replacement;
    lookup.resolve(customer());bundles.resolve();await running;
    assert.equal(f.context.portalCustomer,replacement);assert.equal(f.element('#bill-customer-name').value,'');
    assert.equal(f.element('#bill-customer-account').value,'fictional.alpha.client');
  }
});
test('Change Plan lookup ignores an old reseller response without enabling a target service',async()=>{
  const f=fixture('change'),lookup=deferred();f.context.api.portal.lookup=async()=>lookup.promise;
  const running=f.context.selectChangeCustomer('fictional.alpha.client');
  f.element('#change-reseller').value='fictional.beta';const replacement=customer('fictional.beta.client');f.context.changeCustomer=replacement;
  lookup.resolve(customer());await running;
  assert.equal(f.context.changeCustomer,replacement);assert.equal(f.element('#change-target').disabled,true);
  assert.equal(f.element('#change-customer-summary').textContent,'Select a customer to see the current service and expiry.');
});
for(const outcome of ['response','error'])test(`cost refresh ignores a deferred ${outcome} after a reseller switch without mutating the current customer`,async()=>{
  const f=fixture(),lookup=deferred(),original={...customer(),cost:13};f.context.portalCustomer=original;
  f.context.api.portal.lookup=async()=>lookup.promise;
  const running=f.context.refreshPortalCustomerCosts(true);f.element('#portal-reseller-search').value='fictional.beta';
  if(outcome==='error')lookup.reject(Error('Synthetic stale refresh failure'));else lookup.resolve({...customer(),cost:99});
  await running;assert.equal(f.context.portalCustomer,original);assert.equal(original.cost,13);assert.equal(original.costRefreshError,undefined);
  assert.equal(f.toasts.length,0);assert.equal(f.context.costRefreshPending,false);
});
test('a delayed Change Plan quote cannot restore an old reseller charge or apply control',async()=>{
  const f=fixture('change'),quote=deferred();f.context.changeCustomer=customer();
  f.context.api.portal.quoteChange=async value=>{f.calls.push(value);return quote.promise;};
  const running=f.context.calculateChange();assert.equal(f.calls[0].reseller,'fictional.alpha');
  f.element('#change-reseller').value='fictional.beta';quote.resolve({total:3,beforeName:'6GB',targetName:'8GB',retailPricing:{available:true,customerAmount:5}});await running;
  assert.equal(f.context.changeQuote,null);assert.equal(f.element('#change-quote-panel').classList.contains('hidden'),true);
  assert.equal(f.element('#change-amount').disabled,true);assert.equal(f.element('#change-apply').disabled,true);
});
test('input and committed change events both clear selected reseller search state',()=>{
  const f=fixture('change');
  const changeLine=source.split('\n').find(line=>line.includes('for(const selector of ["#change-reseller","#change-search"])'));
  assert(changeLine,'Bind actual Change Plan reseller invalidation listeners.');vm.runInContext(changeLine,f.context);
  const portalStart=source.indexOf('for(const event of [\'input\',\'change\'])$("#portal-reseller-search")');
  assert(portalStart>=0,'Bind both actual bill reseller invalidation events.');const portalEnd=source.indexOf('\n  });',portalStart);assert(portalEnd>portalStart);
  vm.runInContext(source.slice(portalStart,portalEnd+6),f.context);
  for(const selector of ['#change-reseller','#portal-reseller-search'])for(const event of ['input','change']){
    f.context.changeCustomer=customer();f.context.changeResults=[customer()];f.context.changeQuote={total:3};f.context.portalCustomer=customer();f.context.portalSearchCustomers=[customer()];
    const handler=f.listeners.get(selector+':'+event);assert.equal(typeof handler,'function');handler();
    if(selector==='#change-reseller'){assert.equal(f.context.changeCustomer,null);assert.equal(f.context.changeResults.length,0);assert.equal(f.context.changeQuote,null);assert.equal(f.element('#change-apply').disabled,true);}
    else {assert.equal(f.context.portalCustomer,null);assert.equal(f.context.portalSearchCustomers.length,0);}
  }
});
