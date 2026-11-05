'use strict';
// All accounts, databases and provider responses are fictional. Provider fetch
// is captured in memory; only the HTTP boundary binds a loopback socket.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{createServer}=require('../server.cjs'),{createSecretStorage}=require('../lib/secrets.cjs');
const {RenewalLedger}=require('../app/internet-renewals.cjs');
const username='fictional.credit.customer',password='Fictional-credit-owner-123';

function clock(t,instant='2026-11-06T10:00:00Z'){
  const Original=global.Date;let now=Original.parse(instant);
  global.Date=class extends Original{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  t.after(()=>{global.Date=Original;});return {set:instant=>{now=Original.parse(instant);}};
}
function provider(){
  const state={expiry:'2026-11-05T12:00:00',cycles:0,unknownCycle:0,calls:[],costs:[13,14,15,16]};
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  return {state,async fetch(url,options={}){
    const route=new URL(url),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    assert.equal(route.origin,'https://pi.fibernetlb.net');state.calls.push({route:route.pathname,method,body});
    if(route.pathname==='/api/token/'){assert.equal(method,'POST');return json({access:'fictional-credit-token'});}
    assert.equal(options.headers.Authorization,'Bearer fictional-credit-token');
    if(route.pathname==='/api/me')return json({id:41,username:'fibernetlb2',user_type:2});
    if(route.pathname==='/api/resellers')return json({body:[{id:41,username:'fibernetlb2',fullname:'Fictional Credit Reseller'}]});
    if(route.pathname==='/api/user/'){
      assert.equal(method,'GET');assert.equal(route.searchParams.get('username'),username);
      return json({body:{info:{username,shortname:'Fictional Credit Customer',phone:'03000001',service:11,reseller:41,service_expiry:state.expiry,blocked:false},services:[{service_id:11,shortname:'6GB Internet',price:13}]}});
    }
    if(route.pathname==='/api/services/reseller/action/')return json({username:'fibernetlb2',services:[{id:101,servicename:'FIBER net lb 6GB',price:13,limittype:'fixed'}]});
    assert.equal(route.pathname,'/api/user/bulk/actions/');assert.equal(method,'POST');
    if(body.op==='renewcheck')return json({body:{data:[{username,service_id:11,servicename:'6GB Internet',price:state.costs[state.cycles]??16,freetime_price:0}]}});
    assert.equal(body.op,'renew','No other provider action is allowed in this fixture.');assert.deepEqual(body.ids,[{username,service:11}]);
    state.cycles++;
    const previous=new Date(state.expiry+'Z');previous.setUTCMonth(previous.getUTCMonth()+1);state.expiry=previous.toISOString().slice(0,19);
    if(state.cycles===state.unknownCycle)throw Error('Fictional lost provider renewal response.');
    return json({body:{success:1,fail:0,data:[{username,success:true}]}});
  }};
}
function browser(server){
  let cookie='',csrf='',version='';
  const request=(route,payload)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:payload?'POST':'GET',headers:{Host:'localhost',...cookie?{Cookie:cookie}:{},...payload?{Origin:'http://localhost','Content-Type':'application/json','X-CSRF-Token':csrf,'X-App-Version':version}:{}}},res=>{
      if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});
    });req.on('error',reject);req.end(payload?JSON.stringify(payload):undefined);
  });
  const call=(channel,args=[],workspaceId='fiber-users')=>request('/api/rpc',{channel,args,workspaceId});
  const good=async(channel,args=[],workspaceId='fiber-users')=>{const result=await call(channel,args,workspaceId);assert.equal(result.status,200,channel+': '+result.error);return result.data;};
  return {call,good,async login(credentials={username:'credit.owner',password}){const initial=await request('/api/session');csrf=initial.data.csrfToken;version=initial.data.version;await good('auth:login',[credentials],'main');await good('auth:switch',['fiber-users'],'main');}};
}
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-unpaid-renew-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32)),portal=provider(),SQL=await require('sql.js')();
  let backend,server,client;const file=path.join(directory,'sections','fiber-users.sqlite');
  async function stop(){if(server?.listening)await new Promise(resolve=>server.close(resolve));server=null;await backend?.close();backend=null;}
  async function start(initialize=false){
    const original=global.fetch;global.fetch=portal.fetch;
    try{backend=await createBackend({dataDirectory:directory,initialize,providersEnabled:true,secrets,automaticMonthClose:false});}finally{global.fetch=original;}
    if(initialize)await backend.createOwner({username:'credit.owner',fullName:'Fictional Credit Owner',password});
    server=createServer({backend,origin:'http://localhost',demo:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));client=browser(server);await client.login();
  }
  function read(fn){const db=new SQL.Database(fs.readFileSync(file));try{return fn(db);}finally{db.close();}}
  function q(db,sql,args=[]){const s=db.prepare(sql);s.bind(args);try{const out=[];while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
  function seed(fn){assert.equal(backend,null,'Only stopped fictional copies may be changed.');const db=new SQL.Database(fs.readFileSync(file));try{fn(db);fs.writeFileSync(file,Buffer.from(db.export()));}finally{db.close();}}
  t.after(async()=>{await stop();secrets.destroy();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-unpaid-renew-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});
  await start(true);await client.good('portal:configure',[{username:'fibernetlb2',password:'Fictional-credit-provider-password'}],'main');await client.good('portal:test',[username],'main');
  return {directory,portal,read,q,seed,stop,start,get client(){return client;},get server(){return server;},input(extra={}){return {requestId:crypto.randomUUID(),customerAccount:username,exactPortalAccount:true,customerName:'Fictional Credit Customer',phone:'03000001',serviceType:'Internet',bundleCode:'NET-6GB',billingPeriod:'2026-11',renewalMonths:1,amount:20,paymentMethod:'Unpaid',reference:'Fictional explicit renewal debt',portalServiceId:11,portalExpectedServiceId:11,renewOnCredit:true,...extra};},bill:async id=>(await client.good('bills:list',['2026-11-01','2026-11-30'])).find(b=>b.id===id),counts(){return read(db=>({bills:q(db,'SELECT COUNT(*) AS n FROM fibernetlb_bills')[0].n,payments:q(db,'SELECT COUNT(*) AS n FROM debt_payments')[0].n,cash:q(db,'SELECT COALESCE(SUM(amount),0) AS n FROM cash_drawer_transactions')[0].n,snapshots:q(db,'SELECT COUNT(*) AS n FROM payment_destinations')[0].n}));}};
}

test('HTTP Unpaid Save & Renew records full debt and no received funds, then mixed actual collections never renew twice',async t=>{
  clock(t);const f=await fixture(t),wallet=await f.client.good('whish:save',[{label:'Fictional Credit Wallet',number:'03000002',active:true}],'main');
  const input=f.input(),bill=await f.client.good('bills:savePortal',[input,true]);
  assert.equal(bill.renewal.state,'succeeded');assert.equal(bill.renewal.onCredit,true);assert.equal(bill.paymentStatus,'unpaid');assert.equal(bill.paidAmount,0);assert.equal(bill.remainingAmount,20);assert.equal(bill.bundleCost,13);
  assert.deepEqual(f.counts(),{bills:1,payments:0,cash:0,snapshots:0});assert.equal(f.portal.state.cycles,1);
  const history=await f.client.good('bills:renewalHistory',[bill.id]);
  assert.equal(history.find(e=>e.state==='unpaid_authorized').note,'Renewal on credit authorized; full amount remains customer debt. No cash or wallet payment received.');assert.doesNotMatch(JSON.stringify(history),/billFingerprint|requestFingerprint|creator_key/);
  const proof=f.read(db=>f.q(db,"SELECT note FROM internet_renewal_events WHERE bill_id=? AND state='unpaid_authorized'",[bill.id])[0].note);
  assert.equal((await f.client.good('bills:renew',[bill.id])).renewal.state,'succeeded');
  const cashId=crypto.randomUUID(),cashArgs=['bill',bill.id,'Cash',8,cashId];
  const partial=await f.client.good('debts:settle',cashArgs);assert.equal(partial.remainingAmount,12);assert.equal(f.counts().cash,8);
  assert.equal((await f.client.good('debts:settle',cashArgs)).idempotent,true);assert.equal(f.counts().cash,8);assert.equal(f.portal.state.cycles,1);
  await f.stop();await f.start();assert.equal((await f.bill(bill.id)).renewal.onCredit,true);
  const whishId=crypto.randomUUID(),whishArgs=['bill',bill.id,'Whish Money',12,whishId,wallet.id];
  const final=await f.client.good('debts:settle',whishArgs);assert.equal(final.remainingAmount,0);assert.equal(final.paidAmount,20);assert.equal(final.cashPaid,8);assert.equal(final.whishPaid,12);
  assert.equal((await f.client.good('debts:settle',whishArgs)).idempotent,true);
  const stored=await f.bill(bill.id);assert.equal(stored.amount,20);assert.equal(stored.originalAmount,20);assert.equal(stored.paymentStatus,'paid');assert.equal(stored.bundleCost,13);assert.equal(stored.renewal.onCredit,true);
  const receipt=f.read(db=>f.q(db,"SELECT snapshot_json FROM payment_destinations WHERE kind='debt' AND record_key=?",[whishId])[0]);
  assert.equal(JSON.parse(receipt.snapshot_json).walletAmount,12);assert.equal(JSON.parse(receipt.snapshot_json).fee,0.12);
  assert.deepEqual(f.counts(),{bills:1,payments:2,cash:8,snapshots:1});
  assert.equal(f.read(db=>f.q(db,"SELECT note FROM internet_renewal_events WHERE bill_id=? AND state='unpaid_authorized'",[bill.id])[0].note),proof);
  assert.equal((await f.client.good('bills:savePortal',[input,true])).idempotent,true);await f.client.good('bills:renew',[bill.id]);assert.equal(f.portal.state.cycles,1);
  const finance=await f.client.good('finance:overview',[{workspaceId:'fiber-users'}],'main');assert.equal(finance.wallets.find(w=>w.id===wallet.id).balance,12);
});

test('HTTP credit renewal records all 12 live cycle costs once and preserves the full receivable across restart',async t=>{
  clock(t);const f=await fixture(t),input=f.input({renewalMonths:12,amount:240}),bill=await f.client.good('bills:savePortal',[input,true]);
  assert.equal(bill.renewal.state,'succeeded');assert.equal(bill.renewal.completedMonths,12);assert.equal(bill.bundleCost,186);assert.equal(bill.remainingAmount,240);assert.equal(f.portal.state.cycles,12);
  assert.deepEqual(bill.renewal.costQuotes.map(q=>[q.cycle,q.cost,q.state]),Array.from({length:12},(_,index)=>[index+1,[13,14,15][index]??16,'confirmed']));
  await f.stop();await f.start();const replay=await f.client.good('bills:savePortal',[input,true]);assert.equal(replay.id,bill.id);assert.equal(replay.renewal.onCredit,true);assert.equal(replay.bundleCost,186);
  await f.client.good('bills:renew',[bill.id]);assert.equal(f.portal.state.cycles,12);assert.deepEqual(f.counts(),{bills:1,payments:0,cash:0,snapshots:0});
});

test('HTTP uncertain credit cycle blocks replay and new debt, then exact manual reconciliation resumes only remaining cycles',async t=>{
  clock(t);const f=await fixture(t);f.portal.state.unknownCycle=2;
  const input=f.input({renewalMonths:3,amount:60}),bill=await f.client.good('bills:savePortal',[input,true]);
  assert.equal(bill.renewal.state,'unknown');assert.equal(bill.renewal.completedMonths,1);assert.equal(bill.renewal.onCredit,true);assert.equal(f.portal.state.cycles,2);
  await f.stop();await f.start();assert.equal((await f.client.good('bills:savePortal',[input,true])).renewal.state,'unknown');assert.equal((await f.client.good('bills:renew',[bill.id])).renewal.state,'unknown');
  const blocked=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(blocked.status,400);assert.match(blocked.error,/unfinished renewal/);assert.equal(f.counts().bills,1);assert.equal(f.portal.state.cycles,2);
  await f.client.good('bills:resolveRenewal',[bill.id,{confirmation:'RENEWED',note:'Fictional exact second provider refill and cost verified.'}]);
  const done=await f.client.good('bills:renew',[bill.id]);assert.equal(done.renewal.state,'succeeded');assert.equal(done.renewal.completedMonths,3);assert.equal(done.bundleCost,42);assert.equal(done.remainingAmount,60);assert.equal(f.portal.state.cycles,3);
  assert.deepEqual(f.counts(),{bills:1,payments:0,cash:0,snapshots:0});
});

test('HTTP proof exists before the first attempt and allows explicit failed-request retry after restart',async t=>{
  clock(t);const f=await fixture(t),original=RenewalLedger.prototype.start,input=f.input();let bill;
  RenewalLedger.prototype.start=async()=>{throw Error('Fictional interruption before renewal verification.');};
  try{bill=await f.client.good('bills:savePortal',[input,true]);}finally{RenewalLedger.prototype.start=original;}
  assert.equal(bill.renewal.state,'failed');assert.equal(bill.renewal.onCredit,true);assert.equal(bill.renewal.attempts,0);assert.equal(f.portal.state.cycles,0);
  assert.equal((await f.client.good('bills:savePortal',[input,true])).renewal.state,'failed');assert.equal(f.portal.state.cycles,0);
  const blocked=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(blocked.status,400);assert.match(blocked.error,/original bill/);assert.equal(f.counts().bills,1);
  await f.stop();await f.start();const retried=await f.client.good('bills:renew',[bill.id]);assert.equal(retried.renewal.state,'succeeded');assert.equal(retried.remainingAmount,20);assert.equal(f.portal.state.cycles,1);
});

test('HTTP committed credit intent without a renewal row blocks a second debt and resumes only the original bill',async t=>{
  clock(t);const f=await fixture(t),original=RenewalLedger.prototype.start;let bill;
  RenewalLedger.prototype.start=async function(value){return this.details(value.id);};
  try{bill=await f.client.good('bills:savePortal',[f.input(),true]);}finally{RenewalLedger.prototype.start=original;}
  assert.equal(bill.renewal.state,'not_requested');assert.equal(bill.renewal.onCredit,true);
  assert.equal(f.read(db=>f.q(db,'SELECT COUNT(*) AS n FROM internet_renewals')[0].n),0);
  await f.stop();await f.start();
  for(const patch of [{},{renewOnCredit:undefined,paymentMethod:'Cash'}]){
    const denied=await f.client.call('bills:savePortal',[f.input(patch),true]);
    assert.equal(denied.status,400);assert.match(denied.error,/original bill/);assert.deepEqual(f.counts(),{bills:1,payments:0,cash:0,snapshots:0});assert.equal(f.portal.state.cycles,0);
  }
  const paid=await f.client.good('bills:savePortal',[f.input({renewOnCredit:undefined,paymentMethod:'Cash'}),false]);
  const other=await f.client.call('bills:renew',[paid.id]);assert.equal(other.status,400);assert.match(other.error,/unfinished renewal/);assert.equal(f.portal.state.cycles,0);
  const resumed=await f.client.good('bills:renew',[bill.id]);assert.equal(resumed.renewal.state,'succeeded');assert.equal(resumed.remainingAmount,20);assert.equal(f.portal.state.cycles,1);
});

test('HTTP legacy, forged intent, manual SaveRenew and unprivileged requests cannot authorize unpaid renewal',async t=>{
  clock(t);const f=await fixture(t);
  for(const patch of [{renewOnCredit:undefined},{renewOnCredit:false},{renewOnCredit:'true'}]){const denied=await f.client.call('bills:savePortal',[f.input(patch),true]);assert.equal(denied.status,400);}
  assert.equal((await f.client.call('bills:savePortal',[f.input(),false])).status,400);
  assert.equal((await f.client.call('bills:saveRenew',[f.input()])).status,400);
  const legacyInput=f.input({renewOnCredit:undefined}),legacy=await f.client.good('bills:savePortal',[legacyInput,false]);
  assert.equal(legacy.renewal.onCredit,undefined);assert.equal((await f.client.call('bills:renew',[legacy.id])).status,400);
  const forged=await f.client.call('bills:savePortal',[{...legacyInput,renewOnCredit:true},true]);assert.equal(forged.status,400);assert.match(forged.error,/different details/);
  assert.equal(f.read(db=>f.q(db,"SELECT COUNT(*) AS n FROM internet_renewal_events WHERE state='unpaid_authorized'")[0].n),0);
  await f.client.good('users:create',[{username:'credit.viewer',fullName:'Fictional Credit Viewer',password,role:'viewer',allowedSections:['fiber-users']}],'main');
  const viewer=browser(f.server);await viewer.login({username:'credit.viewer',password});const forbidden=await viewer.call('bills:savePortal',[f.input(),true]);assert.equal(forbidden.status,400);assert.match(forbidden.error,/role does not allow/);
  assert.equal((await f.client.call('bills:savePortal',[f.input(),true],'iptv')).status,401);
  assert.equal(f.portal.state.cycles,0);assert.deepEqual(f.counts(),{bills:1,payments:0,cash:0,snapshots:0});
});

test('HTTP malformed or conflicting credit proof and immutable receipt tampering fail closed without another provider action',async t=>{
  clock(t);const f=await fixture(t),original=RenewalLedger.prototype.start;let bill;
  RenewalLedger.prototype.start=async()=>{throw Error('Fictional interruption before first attempt.');};
  try{bill=await f.client.good('bills:savePortal',[f.input(),true]);}finally{RenewalLedger.prototype.start=original;}
  await f.stop();const baseline=fs.readFileSync(path.join(f.directory,'sections','fiber-users.sqlite'));
  const variants=[
    db=>db.run("UPDATE internet_renewal_events SET note='not-json' WHERE state='unpaid_authorized'"),
    db=>db.run("INSERT INTO internet_renewal_events(bill_id,state,note,actor,recorded_at) SELECT bill_id,state,note,actor,recorded_at FROM internet_renewal_events WHERE state='unpaid_authorized'"),
    db=>db.run('UPDATE fibernetlb_bills SET amount=21 WHERE id=?',[bill.id]),
    db=>db.run("UPDATE bill_requests SET fingerprint=? WHERE bill_id=?",['a'.repeat(64),bill.id])
  ];
  for(const mutate of variants){
    fs.writeFileSync(path.join(f.directory,'sections','fiber-users.sqlite'),baseline);f.seed(mutate);await f.start();
    const denied=await f.client.call('bills:renew',[bill.id]);assert.equal(denied.status,400);assert.match(denied.error,/authorization/);assert.equal(f.portal.state.cycles,0);await f.stop();
  }
});

test('HTTP invalid credit intent and interrupted authorization leave no receipt, request, debt or received funds',async t=>{
  clock(t);const f=await fixture(t);
  for(const patch of [{amount:0},{amount:-1},{renewalMonths:13},{bundleCode:'SAT-MONTHLY',serviceType:'Satellite'},{portalServiceId:12},{portalExpectedServiceId:12},{whishDestination:{id:1,label:'Fictional unreceived wallet'}}]){
    const denied=await f.client.call('bills:savePortal',[f.input(patch),true]);assert.equal(denied.status,400,JSON.stringify(patch));assert.equal(f.portal.state.cycles,0);
  }
  const original=RenewalLedger.prototype.authorizeOnCredit;RenewalLedger.prototype.authorizeOnCredit=()=>{throw Error('Fictional interrupted authorization transaction.');};
  try{const denied=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(denied.status,400);assert.match(denied.error,/interrupted authorization transaction/);}finally{RenewalLedger.prototype.authorizeOnCredit=original;}
  assert.deepEqual(f.counts(),{bills:0,payments:0,cash:0,snapshots:0});assert.equal(f.portal.state.cycles,0);
  assert.equal(f.read(db=>f.q(db,'SELECT COUNT(*) AS n FROM bill_requests')[0].n),0);assert.equal(f.read(db=>f.q(db,"SELECT COUNT(*) AS n FROM internet_renewal_events WHERE state='unpaid_authorized'")[0].n),0);
});

test('HTTP late free-cycle credit request stays rejected while an already renewed additional full cycle may remain debt',async t=>{
  clock(t,'2026-11-12T10:00:00Z');const f=await fixture(t),denied=await f.client.call('bills:savePortal',[f.input(),true]);
  assert.equal(denied.status,400);assert.match(denied.error,/Free renewal/);assert.deepEqual(f.counts(),{bills:0,payments:0,cash:0,snapshots:0});assert.equal(f.portal.state.cycles,0);
  f.portal.state.expiry='2026-12-05T12:00:00';const allowed=await f.client.good('bills:savePortal',[f.input(),true]);assert.equal(allowed.renewal.onCredit,true);assert.equal(allowed.renewal.state,'succeeded');assert.equal(allowed.remainingAmount,20);assert.equal(f.portal.state.cycles,1);assert.equal(f.counts().cash,0);
});
