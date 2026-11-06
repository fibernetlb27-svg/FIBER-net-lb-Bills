const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..','app','src');
const contract = fs.readFileSync(path.join(root,'browser-contract.js'),'utf8');
const bridge = fs.readFileSync(path.join(root,'browser-api.js'),'utf8');
const user = {id:1,username:'fictional-admin',fullName:'Fictional Admin',role:'admin',permissions:['dashboard.view']};
const sections = [{id:'main',kind:'main',name:'Main dashboard'},{id:'printer',kind:'printing',name:'Printer'},{id:'fiber-users',kind:'internet',name:'Fictional Users'}];
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem:key => values.has(key) ? values.get(key) : null,setItem:(key,value) => values.set(key,String(value)),removeItem:key => values.delete(key),values};
}
function harness({workspaceId='main',rpc=() => ({}),demo=true,initialStorage={},rpcStatus=200} = {}) {
  const calls=[],events=[],listeners=new Map(),elements=[],navigations=[];
  const localStorage=storage(initialStorage),sessionStorage=storage();
  const banner={hidden:true};let serverVersion='1.45.3';
  const location={href:'http://127.0.0.1:9911/?workspaceId='+workspaceId,origin:'http://127.0.0.1:9911',assign:url => navigations.push(url)};
  const window={location,sessionStorage,addEventListener:(type,callback) => listeners.set(type,callback),dispatchEvent:event => {events.push(event);listeners.get(event.type)?.(event);}};
  const document={getElementById:id => id==='website-preview-banner' ? banner : null,addEventListener:() => {},body:{appendChild:() => {}},createElement:tag => {const element={tag,click(){element.clicked=true;},remove(){element.removed=true;}};elements.push(element);return element;}};
  const context=vm.createContext({window,document,localStorage,crypto,URL,Blob,AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setTimeout,clearTimeout,fetch:async(route,options={}) => {
    calls.push({route,options});
    let data;
    if(route.startsWith('/api/meta'))data={version:serverVersion,demo,section:sections.find(row=>row.id===workspaceId),sections,areas:[],needsSetup:false};
    else if(route.startsWith('/api/session'))data={user,csrfToken:'fixture-csrf',version:serverVersion,workspaceId};
    else data=await rpc(JSON.parse(options.body));
    const status=route==='/api/rpc'?rpcStatus:200;
    return {ok:status===200,status,json:async()=>status===200?{data}:{error:'Your session ended.'}};
  }});
  vm.runInContext(contract,context,{filename:'browser-contract.js'});
  vm.runInContext(bridge,context,{filename:'browser-api.js'});
  return {api:window.posApi,calls,events,listeners,elements,navigations,sessionStorage,localStorage,banner,context,setVersion:value=>{serverVersion=value;}};
}
test('bridge uses cookie session and CSRF, preserving exact positional arguments and workspace',async()=>{
  const h=harness({workspaceId:'printer',rpc:body=>body.args});
  const result=await h.api.expenses.update(12,{amount:18.25});
  assert.equal(result[0],12);
  const call=h.calls.find(row=>row.route==='/api/rpc');
  assert.deepEqual(JSON.parse(call.options.body),{channel:'expenses:update',args:[12,{amount:18.25}],workspaceId:'printer'});
  assert.equal(call.options.credentials,'same-origin');
  assert.equal(call.options.redirect,'error');
  assert.equal(call.options.headers['X-CSRF-Token'],'fixture-csrf');
  assert.equal(call.options.headers['X-App-Version'],'1.45.3');
  assert.equal(call.options.headers.Authorization,undefined);
  assert.equal(h.api.printing,undefined);
  assert.equal(h.api.rollback,undefined);
});
test('login returns user contract and rejects accidentally exposed core tokens',async()=>{
  const h=harness({rpc:()=>user});
  assert.equal((await h.api.auth.login({username:'fixture',password:'fictional'})).username,user.username);
  assert.equal((await h.api.auth.status()).needsSetup,false);
  const unsafe=harness({rpc:()=>({...user,sessionToken:'not-for-the-browser'})});
  await assert.rejects(unsafe.api.auth.login({}),/could not be verified/);
});
test('business switching verifies target and keeps source workspace for authorization',async()=>{
  const h=harness();
  await h.api.workspace.open('printer');
  const rpc=h.calls.find(row=>row.route==='/api/rpc');
  assert.deepEqual(JSON.parse(rpc.options.body),{channel:'auth:switch',args:['printer'],workspaceId:'main'});
  assert.deepEqual(h.navigations,['/?workspaceId=printer']);
  await assert.rejects(h.api.workspace.open('unknown'),/Unknown business/);
  assert.equal(h.calls.filter(row=>row.route==='/api/rpc').length,1);
});
test('lost financial response is uncertain and is never retried',async()=>{
  const h=harness({rpc:()=>{throw Error('lost reply');}});
  await assert.rejects(h.api.sales.create({requestId:'original-request'}),error=>error.uncertain===true&&/Nothing was automatically retried/.test(error.message));
  assert.equal(h.calls.filter(row=>row.route==='/api/rpc').length,1);
});

test('combined change/renew keeps one saved request on a lost mutation response and treats quotes/status as reads',async()=>{
  const h=harness({rpc:()=>{throw Error('lost reply');}});
  const saved={requestId:'fictional-combined-original',token:'fictional-reviewed-quote',amount:30,paymentMethod:'Cash',confirm:true};
  for(const method of ['quoteChangeRenew','changeRenewStatus']){
    await assert.rejects(h.api.bills[method]({requestId:saved.requestId}),error=>error.uncertain===false);
  }
  for(const method of ['startChangeRenew','confirmChangeRenew','resumeChangeRenew','resolveChangeRenew']){
    await assert.rejects(h.api.bills[method](saved),error=>error.uncertain===true&&/Nothing was automatically retried/.test(error.message));
  }
  const calls=h.calls.filter(row=>row.route==='/api/rpc').map(row=>JSON.parse(row.options.body));
  assert.equal(calls.length,6,'Each explicit invocation sends once; the transport does not replay a collection.');
  assert.deepEqual(calls.map(row=>row.channel),['bills:quoteChangeRenew','bills:changeRenewStatus','bills:startChangeRenew','bills:confirmChangeRenew','bills:resumeChangeRenew','bills:resolveChangeRenew']);
  assert.ok(calls.every(row=>row.args[0].requestId===saved.requestId));
});

test('collection balances and automatic closing status are read-only browser requests',async()=>{
  const h=harness({rpc:()=>{throw Error('offline read');}});
  for(const read of [()=>h.api.bank.collectionOverview({workspaceId:'fiber-users'}),()=>h.api.finance.autoMonthStatus()]){
    await assert.rejects(read(),error=>error.uncertain===false&&/could not be reached/.test(error.message));
  }
  assert.deepEqual(h.calls.filter(row=>row.route==='/api/rpc').map(row=>JSON.parse(row.options.body)),[
    {channel:'bank:collectionOverview',args:[{workspaceId:'fiber-users'}],workspaceId:'main'},
    {channel:'finance:autoMonthStatus',args:[],workspaceId:'main'}
  ]);
});

test('payment correction transport preserves one reviewed request and never retries a lost financial response',async()=>{
  const h=harness({workspaceId:'fiber-users',rpc:()=>{throw Error('Fictional offline response');}});
  for(const method of ['options','preview','status','history'])await assert.rejects(h.api.billPayments[method]({billId:7,requestId:'fictional-correction'}),error=>error.uncertain===false);
  const input={billId:7,paymentKey:'fictional-collection',method:'Unpaid',requestId:'fictional-correction',token:'a'.repeat(64),reason:'Fictional payment entered incorrectly'};
  await assert.rejects(h.api.billPayments.correct(input),error=>error.uncertain===true&&/Nothing was automatically retried/.test(error.message));
  const calls=h.calls.filter(row=>row.route==='/api/rpc').map(row=>JSON.parse(row.options.body));
  assert.equal(calls.length,5);assert.deepEqual(calls.at(-1),{channel:'billPayments:correct',args:[input],workspaceId:'fiber-users'});
});
test('logout clears local sign-in even on network failure and preserves pending request markers',async()=>{
  const marker='fiber-invoice-void-v1:existing-account:original';
  const h=harness({rpc:()=>{throw Error('offline');},initialStorage:{[marker]:'pending'}});
  await assert.rejects(h.api.auth.logout());
  assert.equal((await h.api.auth.status()).user,null);
  assert.equal(h.localStorage.getItem(marker),'pending');
  assert.equal(h.sessionStorage.getItem('fibernetlb.web.signed-out:main'),'1');
  assert.equal(h.events.at(-1).type,'pos-web-auth-ended');
  await assert.rejects(h.api.sales.create({}),/sign in again/);
  assert.equal(h.calls.filter(row=>row.route==='/api/rpc').length,1);
});
test('logout in a different tab clears only the matching workspace',async()=>{
  const h=harness({workspaceId:'printer'});
  await h.api.auth.status();
  h.listeners.get('storage')({key:'fibernetlb.web.auth-event.v1',newValue:JSON.stringify({workspaceId:'main'})});
  assert.ok((await h.api.auth.status()).user);
  h.listeners.get('storage')({key:'fibernetlb.web.auth-event.v1',newValue:JSON.stringify({workspaceId:'printer'})});
  assert.equal((await h.api.auth.status()).user,null);
});
test('stale tabs keep the loaded version and stop financial submissions until refresh',async()=>{
  const h=harness();await h.api.workspace.current();h.setVersion('1.45.4');
  const status=await h.api.network.status();
  assert.equal(status.localVersion,'1.45.3');assert.equal(status.serverVersion,'1.45.4');assert.equal(status.versionMismatch,true);
  await assert.rejects(h.api.sales.create({requestId:'original-request'}),/version changed/);
  assert.equal(h.calls.filter(row=>row.route==='/api/rpc').length,0);
  assert.equal((await h.api.updates.status()).available,true);
});
test('expired business authorization removes private views without replaying the request',async()=>{
  const h=harness({rpcStatus:401});
  await assert.rejects(h.api.products.list(),error=>error.status===401);
  assert.equal(h.events.at(-1).type,'pos-web-auth-ended');
  assert.equal((await h.api.auth.status()).user,null);
  assert.equal(h.calls.filter(row=>row.route==='/api/rpc').length,1);
});
test('CSV export downloads server contents and never invokes native export',async()=>{
  const h=harness({rpc:()=>({filename:'../../fixture.csv',contents:'Heading,Value\r\nDemo,12'})});
  assert.equal((await h.api.reports.export('2026-01-01','2026-01-31','','all')).canceled,false);
  const body=JSON.parse(h.calls.find(row=>row.route==='/api/rpc').options.body);
  assert.equal(body.channel,'reports:csv');
  assert.equal(h.elements[0].download,'.._.._fixture.csv');
  assert.equal(h.elements[0].clicked,true);
});
test('WhatsApp accepts intended HTTPS hosts and rejects script or credential URLs',async()=>{
  const h=harness();
  await h.api.sharing.openWhatsApp('https://wa.me/96170000000?text=Fictional');
  assert.equal(h.elements[0].rel,'noopener noreferrer');
  for(const value of ['javascript:alert(1)','https://wa.me.evil.example/','http://wa.me/96170000000','https://user:password@wa.me/'])await assert.rejects(h.api.sharing.openWhatsApp(value),/Invalid WhatsApp/);
});
test('preview badge is controlled by server metadata and native recovery never reaches RPC',async()=>{
  const demo=harness();await demo.api.workspace.current();assert.equal(demo.banner.hidden,false);
  const normal=harness({demo:false});await normal.api.workspace.current();assert.equal(normal.banner.hidden,true);
  await assert.rejects(normal.api.backups.extract('fictional-passphrase'),/administrator/);
  assert.equal(normal.calls.filter(row=>row.route==='/api/rpc').length,0);
});
test('all referenced scripts are local and browser bridge loads before business modules',()=>{
  for(const name of ['index.html','bandwidth.html']){
    const html=fs.readFileSync(path.join(root,name),'utf8');
    assert.ok(html.indexOf('browser-api.js')<html.indexOf(name==='index.html'?'bill-plan.js':'bandwidth-window.js'));
    assert.doesNotMatch(html,/<script>(?!\s*<)/);
    for(const match of html.matchAll(/<script src="([^"]+)"/g))assert.ok(fs.existsSync(path.join(root,match[1])),match[1]);
  }
  assert.doesNotMatch(contract,/require\(|ipcRenderer|contextBridge/);
});
