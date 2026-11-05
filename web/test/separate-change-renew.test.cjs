'use strict';
// Genuine core/HTTP workflows; every account, amount and provider response is
// fictional. The captured provider fetch can never contact a live service.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{createServer}=require('../server.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),{query}=require('../app/finance-ledger.cjs');
const username='fictional.active.customer',password='Fictional-sequential-owner-123';

function providerFixture(){
  const calendar=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  const state={service:11,expiry:new Date(Date.UTC(Number(calendar.year),Number(calendar.month),5)).toISOString().slice(0,10)+'T12:00:00',changeCost:3,lostChange:false,lostRenew:false,calls:[],gates:[]};
  const services=[{service_id:11,shortname:'6GB Internet',price:13},{service_id:22,shortname:'8GB Internet',price:17},{service_id:33,shortname:'10GB Internet',price:23}];
  function defer(kind){let enter,release;const gate={kind,entered:new Promise(resolve=>enter=resolve),wait:new Promise(resolve=>release=resolve),enter,release};state.gates.push(gate);return gate;}
  async function pause(kind){const gate=state.gates.find(value=>value.kind===kind&&!value.used);if(gate){gate.used=true;gate.enter();await gate.wait;}}
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const fetch=async(url,options={})=>{
    const route=new URL(url);assert.equal(route.origin,'https://pi.fibernetlb.net');const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    state.calls.push({path:route.pathname,method,op:body?.op||null,service:state.service});
    if(route.pathname==='/api/token/')return json({access:'fictional-provider-token'});
    assert.equal(options.headers.Authorization,'Bearer fictional-provider-token');
    if(method==='PUT')throw Error('The fictional provider must never receive a profile PUT.');
    if(route.pathname==='/api/me')return json({id:41,username:'fibernetlb2',user_type:2,get_all_permissions:['console.view_users','console.change_service_money','console.renew_users']});
    if(route.pathname==='/api/resellers')return json({body:[{id:41,username:'fibernetlb2',fullname:'Fictional Billing Reseller'}]});
    if(route.pathname==='/api/user/'){
      assert.equal(route.searchParams.get('username'),username);
      return json({body:{info:{username,shortname:'Fictional Active Customer',password:'fictional-profile-value',phone:'03000001',service:state.service,reseller:41,collector:0,switch:null,duedate:5,override_price:false,price:999,discount:0,service_expiry:state.expiry,save_mac:false,note:'Fictional preserved profile',email:'fixture@example.invalid',address:'Fictional address',region:'Fictional region',nationality:'Test',building:'Test',latitude:null,longitude:null,freetime_enabled:false,freetime:0,freetime_active:false},services}});
    }
    if(route.pathname==='/api/services/reseller/action/'){
      await pause('fixed');
      if(state.failFixedCosts)return json({success:false,message:'Fictional unavailable fixed monthly costs.'});
      return json({username:'fibernetlb2',services:[{id:101,servicename:'FIBER net lb 6GB',price:13,limittype:'fixed'},{id:102,servicename:'FIBER net lb 8GB',price:16,limittype:'fixed'},{id:103,servicename:'FIBER net lb 10GB',price:20,limittype:'fixed'}]});
    }
    if(route.pathname==='/api/user/services/')return json({body:services.filter(value=>value.service_id!==state.service)});
    assert.equal(route.pathname,'/api/user/bulk/actions/');
    if(body.op==='checkchangeservice'){await pause('changeQuote');const quote={price:state.changeCost,current_period_price:state.changeCost,freetime_price:0,pending_refills:0,pending_refills_price:0,...state.changeBreakdown};if(state.omitPeriodBreakdown)delete quote.current_period_price;return json({body:quote});}
    if(body.op==='renewcheck'){if(state.failRenewQuote&&state.service===22)return json({success:false,message:'Fictional unavailable target quote.'});return json({body:{data:[{username,service_id:state.service,servicename:services.find(value=>value.service_id===state.service).shortname,price:services.find(value=>value.service_id===state.service).price,freetime_price:0}]}});}
    if(body.op==='changeservice'){
      const target=state.expectedChangeTarget??22;assert.deepEqual(body,{op:'changeservice',data:{username,service:target}});state.service=target;
      if(state.lostChange)throw Error('Fictional lost change response.');
      return json({success:true});
    }
    assert.equal(body.op,'renew');assert.deepEqual(body.ids,[{username,service:state.service}]);await pause('renew');
    if(state.lostRenew)throw Error('Fictional lost renewal response.');
    const [year,month]=state.expiry.slice(0,10).split('-').map(Number);state.expiry=new Date(Date.UTC(year,month,5)).toISOString().slice(0,10)+'T12:00:00';return json({body:{success:1,fail:0,data:[{username,success:true}]}});
  };
  return {state,fetch,defer,releaseAll(){for(const gate of state.gates)gate.release();},count(op){return state.calls.filter(call=>op==='PUT'?call.method==='PUT':call.op===op).length;}};
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
  return {call,good,async login(credentials={username:'workflow.owner',password}){const initial=await request('/api/session');csrf=initial.data.csrfToken;version=initial.data.version;await good('auth:login',[credentials],'main');await good('auth:switch',['fiber-users'],'main');}};
}

async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-separate-renew-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32)),provider=providerFixture(),SQL=await require('sql.js')();let core,server,client;
  const file=path.join(directory,'sections','fiber-users.sqlite');
  async function stop(){provider.releaseAll();if(server?.listening)await new Promise(resolve=>server.close(resolve));server=null;await core?.close();core=null;}
  async function start(initialize=false){
    const original=global.fetch;global.fetch=provider.fetch;
    try{core=await createBackend({dataDirectory:directory,initialize,providersEnabled:true,secrets,automaticMonthClose:false});}finally{global.fetch=original;}
    if(initialize)await core.createOwner({username:'workflow.owner',fullName:'Fictional Workflow Owner',password});
    server=createServer({backend:core,origin:'http://localhost',demo:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));client=browser(server);await client.login();
  }
  function read(fn){const db=new SQL.Database(new Uint8Array(fs.readFileSync(file)));try{return fn(db);}finally{db.close();}}
  function seed(fn){assert.equal(core,null,'Synthetic legacy fixtures are changed only while the backend is stopped.');const db=new SQL.Database(new Uint8Array(fs.readFileSync(file)));try{fn(db);fs.writeFileSync(file,Buffer.from(db.export()));}finally{db.close();}}
  t.after(async()=>{await stop();secrets.destroy();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-separate-renew-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});
  await start(true);await client.good('portal:configure',[{username:'fibernetlb2',password:'Fictional-provider-password'}],'main');await client.good('portal:test',[username],'main');
  const finance=await client.good('finance:overview',[{workspaceId:'fiber-users'}],'main'),today=finance.today,period=today.slice(0,7);
  return {provider,read,seed,stop,start,today,period,newClient:()=>browser(server),get client(){return client;},input(extra={}){return {requestId:crypto.randomUUID(),customerAccount:username,exactPortalAccount:true,customerName:'Fictional Active Customer',phone:'03000001',serviceType:'Internet',bundleCode:'NET-8GB',billingPeriod:period,renewalMonths:1,amount:25,paymentMethod:'Cash',reference:'Fictional sequential renewal',portalServiceId:22,portalExpectedServiceId:22,confirmPlanChange:false,...extra};},async quote(){return client.good('portal:quoteChange',[{username,expectedId:11,targetId:22}]);},change(quote,extra={}){return {requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,amount:quote.retailPricing.suggestedAmount??5,paymentMethod:'Cash',billingPeriod:period,reference:'Fictional separate service adjustment',confirm:true,...extra};}};
}

test('HTTP new bills refuse changing a verified service before any provider submission and retain legacy uncertain-plan review',async t=>{
  const f=await fixture(t),input=f.input({portalExpectedServiceId:11,confirmPlanChange:true}),before=f.read(db=>Buffer.from(db.export()));
  for(const renew of [false,true]){const result=await f.client.call('bills:savePortal',[{...input,requestId:crypto.randomUUID()},renew]);assert.equal(result.status,400);assert.match(result.error,/Change service & renew/);}
  assert.deepEqual(f.read(db=>Buffer.from(db.export())),before,'The new unsupported action does not even alter the private business ledger.');
  assert.equal(f.provider.count('PUT'),0);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);
  const forged=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(forged.status,400);assert.match(forged.error,/portal plan changed since lookup/);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
  await f.stop();f.seed(db=>{
    const owner=query(db,"SELECT * FROM users WHERE username='workflow.owner'")[0],id='fictional-legacy-uncertain-change';
    db.run("INSERT INTO internet_plan_changes(request_id,fingerprint,username,before_service,target_service,target_name,state,message,actor,recorded_at,actor_key) VALUES(?,?,?,?,?,?,'unknown',?,?,?,?)",[id,crypto.createHash('sha256').update(JSON.stringify({username,expectedId:11,targetId:22})).digest('hex'),username,11,22,'8GB Internet','Fictional preserved uncertain change; review before retry.',owner.full_name,new Date().toISOString(),owner.account_key]);
    db.run("INSERT INTO internet_plan_events(request_id,state,note,actor,recorded_at) VALUES(?,'processing',?,?,?)",[id,'Fictional original submission audit.',owner.full_name,new Date().toISOString()]);
  });await f.start();
  const pending=await f.client.good('portal:planHistory',[username]);assert.equal(pending.latest.state,'unknown');assert.match(pending.latest.message,/preserved uncertain change/);
  const refused=await f.client.call('bills:savePortal',[{...input,requestId:crypto.randomUUID()},true]);assert.equal(refused.status,400);assert.match(refused.error,/Change service & renew/);
  const same=await f.client.call('bills:savePortal',[f.input({bundleCode:'NET-6GB',amount:20,portalServiceId:11,portalExpectedServiceId:11}),true]);assert.equal(same.status,400);assert.match(same.error,/unfinished plan change/);assert.equal((await f.client.good('portal:planHistory',[username])).latest.state,'unknown');
  await f.client.good('portal:resolvePlan',[pending.latest.requestId,{confirmation:'NOT CHANGED',note:'Fictional exact provider service and account reviewed.'}]);
  const reviewed=await f.client.good('portal:planHistory',[username]);assert.equal(reviewed.latest.state,'failed');assert(reviewed.events.some(event=>event.note==='Fictional original submission audit.'));assert(reviewed.events.some(event=>/Administrator verified NOT CHANGED/.test(event.note)));
  assert.equal(f.provider.count('PUT'),0);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
});

test('HTTP quoted Change Plan then fresh same-plan renewal keep separate costs and replay original historical receipts',async t=>{
  const f=await fixture(t),quote=await f.quote(),change=f.change(quote);assert.equal(quote.total,3);assert.equal(quote.retailPricing.customerAmount,quote.retailPricing.zeroChargeWindow?0:5);
  const adjustment=await f.client.good('portal:applyChange',[change]);assert.equal(adjustment.bundleCost,3);assert.equal(adjustment.amount,change.amount);assert.equal(adjustment.serviceType,'Internet plan change');assert.equal(f.provider.state.service,22);assert.equal(f.provider.count('renew'),0);
  const fresh=await f.client.good('portal:lookup',[username]);assert.equal(fresh.serviceId,22);assert.equal(fresh.renewalQuote.cost,17,'The live target renewal quote differs from its fixed monthly reference16.');
  const input=f.input(),bill=await f.client.good('bills:savePortal',[input,true]);assert.equal(bill.renewal.state,'succeeded');assert.equal(bill.bundleCost,17);assert.equal(bill.amount,25);
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);assert.equal(f.provider.count('PUT'),0);
  const mutations=f.provider.state.calls.filter(call=>['changeservice','renew'].includes(call.op));assert.deepEqual(mutations.map(call=>call.op),['changeservice','renew']);assert.equal(mutations[1].service,22);
  const lastChange=f.provider.state.calls.findIndex(call=>call.op==='changeservice'),targetQuote=f.provider.state.calls.findIndex((call,index)=>index>lastChange&&call.op==='renewcheck'&&call.service===22);assert(targetQuote>lastChange,'A fresh target quote is obtained after Change Service, before renewing.');
  const totals=f.read(db=>query(db,'SELECT COUNT(*) AS count,SUM(amount) AS amount,SUM(bundle_cost) AS cost FROM fibernetlb_bills')[0]);assert.deepEqual(totals,{count:2,amount:25+change.amount,cost:20});assert.equal((await f.client.good('drawer:get')).balance,25+change.amount);
  assert.equal((await f.client.good('portal:applyChange',[change])).id,adjustment.id);assert.equal((await f.client.good('bills:savePortal',[input,true])).id,bill.id);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
  // Reproduce only the persisted pre-update fingerprint of an old combined
  // receipt. Validate the fixture shape against a real current fingerprint
  // before substituting its original expected service; never call the old PUT.
  await f.stop();const oldInput={...input,portalExpectedServiceId:11,confirmPlanChange:true};f.seed(db=>{
    const bundle=query(db,'SELECT * FROM fibernetlb_bundles WHERE code=?',[input.bundleCode])[0],fingerprint=expected=>crypto.createHash('sha256').update(JSON.stringify({bill:{customerAccount:username,customerName:input.customerName,phone:input.phone,serviceType:'Internet',billingPeriod:input.billingPeriod,renewalMonths:1,amount:25,paymentMethod:'Cash',paymentStatus:'paid',reference:input.reference,bundleCode:bundle.code,bundleName:bundle.name,bundleDetails:bundle.allowance,bundlePrice:bundle.price,portalServiceId:22,portalExpectedServiceId:expected},renew:true})).digest('hex');
    assert.equal(query(db,'SELECT fingerprint FROM bill_requests WHERE request_id=?',[input.requestId])[0].fingerprint,fingerprint(22));db.run('UPDATE bill_requests SET fingerprint=? WHERE request_id=?',[fingerprint(11),input.requestId]);
  });await f.start();f.provider.state.service=11;const writes=[f.provider.count('changeservice'),f.provider.count('renew')],old=await f.client.good('bills:savePortal',[oldInput,true]);assert.equal(old.id,bill.id);assert.equal(old.idempotent,true);assert.deepEqual([f.provider.count('changeservice'),f.provider.count('renew')],writes);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),2);
});

test('HTTP lost Change Service and renewal responses preserve exact audit recovery without replaying either provider action',async t=>{
  const f=await fixture(t),quote=await f.quote(),change=f.change(quote);f.provider.state.lostChange=true;
  const lost=await f.client.call('portal:applyChange',[change]);assert.equal(lost.status,400);assert.match(lost.error,/uncertain/);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
  const repeated=await f.client.call('portal:applyChange',[change]);assert.equal(repeated.status,400);assert.match(repeated.error,/needs review/);assert.equal(f.provider.count('changeservice'),1);
  const blockedRenew=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(blockedRenew.status,400);assert.match(blockedRenew.error,/unfinished portal operation/);assert.equal(f.provider.count('renew'),0);
  f.provider.state.lostChange=false;const adjustment=await f.client.good('portal:resolveOperation',[change.requestId,{confirmation:'APPLIED',note:'Fictional exact charged service transaction and target verified.'}]);assert.equal(adjustment.bundleCost,3);assert.equal(f.provider.count('changeservice'),1);
  f.provider.state.lostRenew=true;const input=f.input(),bill=await f.client.good('bills:savePortal',[input,true]);assert.equal(bill.renewal.state,'unknown');assert.equal(f.provider.count('renew'),1);assert.equal(bill.bundleCost,17);
  assert.equal((await f.client.good('bills:savePortal',[input,true])).id,bill.id);const reviewed=await f.client.good('bills:renew',[bill.id]);assert.equal(reviewed.renewal.state,'unknown');assert.equal(f.provider.count('renew'),1);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('PUT'),0);
  assert.deepEqual(f.read(db=>query(db,'SELECT COUNT(*) AS count,SUM(amount) AS amount,SUM(bundle_cost) AS cost FROM fibernetlb_bills')[0]),{count:2,amount:25+change.amount,cost:20});
});

test('HTTP Change Plan rechecks a same-customer renewal that started while its cost review was awaiting the provider',async t=>{
  const f=await fixture(t),paid=await f.client.good('bills:savePortal',[f.input({bundleCode:'NET-6GB',amount:20,portalServiceId:11,portalExpectedServiceId:11}),false]),quote=await f.quote(),change=f.change(quote),fixed=f.provider.defer('fixed');
  const changing=f.client.call('portal:applyChange',[change]);await fixed.entered;
  const native=f.provider.defer('renew'),renewing=f.client.call('bills:renew',[paid.id]);await native.entered;fixed.release();
  const blocked=await changing;assert.equal(blocked.status,400);assert.match(blocked.error,/unfinished renewal or plan change/);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM portal_operations')[0].count),0,'No replacement Change Service reservation or bill is created.');
  native.release();const completed=await renewing;assert.equal(completed.status,200,completed.error);assert.equal(completed.data.renewal.state,'succeeded');assert.equal(f.provider.count('renew'),1);assert.equal(f.provider.count('PUT'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);
});

async function combinedStart(f,months=1){
  const quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:months}]),input={requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:months,changeCustomerAmount:quote.changeCustomerAmount,confirm:true};
  const record=await f.client.good('bills:startChangeRenew',[input]);assert.equal(record.phase,'awaiting_payment',record.message);return {quote,input,record};
}
function combinedPayment(f,record,extra={}){return {requestId:record.requestId,token:record.token,amount:record.totalToCollect,paymentMethod:'Cash',billingPeriod:f.period,reference:'Fictional one combined customer payment',confirm:true,...extra};}

test('HTTP combined service change and multi-cycle renewal collect once and retain actual native adjustment in every cost sync',async t=>{
  const f=await fixture(t),{quote,input,record}=await combinedStart(f,2);assert.equal(quote.changeCustomerAmount,quote.zeroChargeWindow?0:5);assert.equal(record.totalToCollect,50+quote.changeCustomerAmount);assert.equal(record.changeCost,3);assert.equal(record.renewalCost,17);
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);assert.equal((await f.client.good('drawer:get')).balance,0);
  assert.equal((await f.client.good('bills:startChangeRenew',[input])).requestId,record.requestId);assert.equal(f.provider.count('changeservice'),1);
  const unpaid=await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record,{paymentMethod:'Unpaid'})]);assert.equal(unpaid.status,400);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
  const wrong=await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record,{amount:record.totalToCollect-1})]);assert.equal(wrong.status,400);assert.equal(f.provider.count('renew'),0);
  for(const billingPeriod of ['2026-00','2026-13','1999-12','9999-01']){const invalid=await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record,{billingPeriod})]);assert.equal(invalid.status,400);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);}
  const payment=combinedPayment(f,record),done=await f.client.good('bills:confirmChangeRenew',[payment]);assert.equal(done.phase,'completed',done.message);assert.equal(done.state,'succeeded');assert.equal(done.bill.renewal.completedMonths,2);assert.equal(done.bill.amount,record.totalToCollect);assert.equal(done.bill.bundleCost,37,'Two actual17 cycle costs plus the immutable3 change cost, once.');assert.equal(f.provider.count('renew'),2);assert.equal(f.provider.count('PUT'),0);
  assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal((await f.client.good('drawer:get')).balance,record.totalToCollect);assert(!/current period|pending refills|freetime|internal cost/.test(done.bill.bundleDetails));
  const replay=await f.client.good('bills:confirmChangeRenew',[payment]);assert.equal(replay.bill.id,done.bill.id);assert.equal(f.provider.count('renew'),2);assert.equal(f.provider.count('changeservice'),1);assert.deepEqual((await f.client.good('bills:changeRenewStatus',[{}])).pending,[]);
  const foreign=await f.client.call('bills:confirmChangeRenew',[{...payment,reference:'Different payment details'}]);assert.equal(foreign.status,400);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);
});

test('HTTP default Cashier and Support see customer pricing policy but no combined financial costs or foreign parent',async t=>{
  const f=await fixture(t);for(const role of ['cashier','support'])await f.client.good('users:create',[{username:'fictional.'+role,fullName:'Fictional '+role,password,role,allowedSections:['fiber-users']}],'main');
  const cashier=f.newClient(),support=f.newClient();await cashier.login({username:'fictional.cashier',password});await support.login({username:'fictional.support',password});
  const standalone=await cashier.good('portal:quoteChange',[{username,expectedId:11,targetId:22}]);assert.equal(typeof standalone.retailPricing.zeroChargeWindow,'boolean');assert.match(standalone.retailPricing.policyDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(standalone.total,undefined);assert.equal(standalone.retailPricing.expectedProfit,undefined);
  for(const client of [cashier,support]){const quote=await client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]);assert.equal(quote.changeCost,undefined);assert.equal(quote.renewalCost,undefined);assert.equal(typeof quote.totalToCollect,'number');}
  const quote=await cashier.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]),requestId=crypto.randomUUID(),ready=await cashier.good('bills:startChangeRenew',[{requestId,quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:quote.changeCustomerAmount,confirm:true}]);assert.equal(ready.changeCost,undefined);assert.equal(ready.renewalCost,undefined);
  assert.equal((await support.call('bills:changeRenewStatus',[{requestId}])).status,400);assert.deepEqual((await support.good('bills:changeRenewStatus',[{}])).pending,[]);
  const done=await cashier.good('bills:confirmChangeRenew',[combinedPayment(f,ready)]);assert.equal(done.phase,'completed',done.message);assert.equal(done.bill.bundleCost,undefined);assert.equal(done.bill.portalInternalCost,undefined);assert.equal(done.bill.renewal.costQuotes,undefined);
  const history=await cashier.good('portal:operations',['change_renew']);assert.equal(history.length,1);assert.equal(history[0].changeCost,undefined);assert.equal(history[0].renewalCost,undefined);assert.equal(history[0].quote,undefined);assert.equal(history[0].input,undefined);
});

test('HTTP combined lost native responses recover the same parent, single payment and precise uncertain renewal without replay',async t=>{
  const f=await fixture(t);f.provider.state.lostChange=true;const quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]),input={requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:quote.changeCustomerAmount,confirm:true},unknown=await f.client.good('bills:startChangeRenew',[input]);assert.equal(unknown.phase,'change_unknown');assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);
  assert.equal((await f.client.good('bills:startChangeRenew',[input])).phase,'change_unknown');assert.equal((await f.client.good('bills:resumeChangeRenew',[{requestId:input.requestId}])).phase,'change_unknown');assert.equal(f.provider.count('changeservice'),1);
  f.provider.state.lostChange=false;const ready=await f.client.good('bills:resolveChangeRenew',[{requestId:input.requestId,confirmation:'APPLIED',note:'Fictional exact Change Service transaction and target verified.'}]);assert.equal(ready.phase,'awaiting_payment',ready.message);assert.equal(f.provider.count('changeservice'),1);
  f.provider.state.lostRenew=true;const payment=combinedPayment(f,ready),lost=await f.client.good('bills:confirmChangeRenew',[payment]);assert.equal(lost.phase,'renewal_unknown',lost.message);assert.equal(lost.bill.bundleCost,20);assert.equal(f.provider.count('renew'),1);
  assert.equal((await f.client.good('bills:confirmChangeRenew',[payment])).bill.id,lost.bill.id);assert.equal((await f.client.good('bills:resumeChangeRenew',[{requestId:input.requestId,renew:true}])).phase,'renewal_unknown');assert.equal(f.provider.count('renew'),1);
  await f.stop();await f.start();const restored=await f.client.good('bills:changeRenewStatus',[{}]);assert.equal(restored.pending.length,1);assert.equal(restored.pending[0].bill.id,lost.bill.id);assert.equal(restored.pending[0].phase,'renewal_unknown');
  await f.client.good('bills:resolveRenewal',[lost.bill.id,{confirmation:'RENEWED',note:'Fictional exact renewal cycle confirmed in provider history.'}]);const done=await f.client.good('bills:changeRenewStatus',[{requestId:input.requestId}]);assert.equal(done.state,'succeeded');assert.equal(done.bill.bundleCost,20);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);
});

test('HTTP combined concurrent final confirms cannot replace the first immutable payment intent',async t=>{
  const f=await fixture(t),{record}=await combinedStart(f),gate=f.provider.defer('fixed'),first=combinedPayment(f,record),pending=f.client.call('bills:confirmChangeRenew',[first]);await gate.entered;
  const competing=f.client.call('bills:confirmChangeRenew',[{...first,reference:'Fictional competing final payment'}]),refresh=f.client.call('bills:resumeChangeRenew',[{requestId:record.requestId}]);gate.release();
  const accepted=await pending;assert.equal(accepted.status,200,accepted.error);assert.equal(accepted.data.phase,'completed',accepted.data.message);assert.equal((await competing).status,400);assert.equal((await refresh).status,200);
  const saved=await f.client.good('bills:changeRenewStatus',[{requestId:record.requestId}]);assert.equal(saved.bill.reference,first.reference);assert.equal(saved.state,'succeeded');assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);
});

test('HTTP combined restart after atomic bill-parent persistence recovers the original charge despite a changed catalog',async t=>{
  const f=await fixture(t),{record}=await combinedStart(f),Class=require('../app/combined-change-renew.cjs').CombinedChangeRenew,original=Class.prototype.completePayment;let armed=true;
  Class.prototype.completePayment=async function(parent,renew){const create=this.createBill;this.createBill=async(...args)=>{const bill=await create(...args);if(armed){armed=false;throw Error('Fictional interruption after durable payment, before parent attachment.');}return bill;};try{return await original.call(this,parent,renew);}finally{this.createBill=create;}};
  try{const interrupted=await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record)]);assert.equal(interrupted.status,400);assert.match(interrupted.error,/Fictional interruption/);}finally{Class.prototype.completePayment=original;}
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal((await f.client.good('drawer:get')).balance,record.totalToCollect);
  await f.stop();f.seed(db=>db.run("UPDATE fibernetlb_bundles SET price=31 WHERE code='NET-8GB'"));await f.start();const pending=await f.client.good('bills:changeRenewStatus',[{requestId:record.requestId}]);assert.equal(pending.phase,'renewal_pending');assert(pending.bill?.id,'The original receipt and parent pointer were saved atomically.');assert.equal(pending.bill.amount,record.totalToCollect);
  const done=await f.client.good('bills:resumeChangeRenew',[{requestId:record.requestId,renew:true}]);assert.equal(done.phase,'completed',done.message);assert.equal(f.provider.count('renew'),1);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal((await f.client.good('drawer:get')).balance,record.totalToCollect);
});

test('HTTP combined reserved child identity rejects preexisting or competing ordinary payment requests without another charge',async t=>{
  const f=await fixture(t),parentId=crypto.randomUUID(),paid=await f.client.good('bills:savePortal',[f.input({requestId:parentId+'-bill',bundleCode:'NET-6GB',amount:20,portalServiceId:11,portalExpectedServiceId:11}),false]),quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]),stopped=await f.client.call('bills:startChangeRenew',[{requestId:parentId,quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:quote.changeCustomerAmount,confirm:true}]);assert.equal(stopped.status,400);assert.match(stopped.error,/payment request ID was already used/);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal((await f.client.good('drawer:get')).balance,paid.amount);
  const {record}=await combinedStart(f),other=f.input({requestId:record.requestId+'-bill',customerAccount:'fictional.other.customer'});delete other.portalServiceId;delete other.portalExpectedServiceId;const conflict=await f.client.call('bills:create',[other]);assert.equal(conflict.status,400);assert.match(conflict.error,/belongs to a saved combined workflow/);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal((await f.client.good('drawer:get')).balance,paid.amount);assert.equal(f.provider.count('renew'),0);
});

test('HTTP combined restart after successful renewal retains a visible local-only parent finalization',async t=>{
  const f=await fixture(t),{record}=await combinedStart(f),Class=require('../app/combined-change-renew.cjs').CombinedChangeRenew,original=Class.prototype.finalize;let armed=true;
  Class.prototype.finalize=function(id){const parent=this.read(id);if(armed&&parent.row.bill_id&&this.readBill(parent.row.bill_id).renewal.state==='succeeded'){armed=false;throw Error('Fictional interruption before final parent audit save.');}return original.call(this,id);};
  try{const interrupted=await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record)]);assert.equal(interrupted.status,400);}finally{Class.prototype.finalize=original;}
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);await f.stop();await f.start();const before=f.read(db=>Buffer.from(db.export())),pending=await f.client.good('bills:changeRenewStatus',[{}]);assert.equal(pending.pending.length,1);assert.equal(pending.pending[0].phase,'renewal_pending');assert.equal(pending.pending[0].canFinalize,true);assert.deepEqual(f.read(db=>Buffer.from(db.export())),before,'Status is read-only even at the finalization cutpoint.');
  const done=await f.client.good('bills:resumeChangeRenew',[{requestId:record.requestId}]);assert.equal(done.state,'succeeded');assert.equal(done.phase,'completed');assert.equal(f.provider.count('renew'),1);assert.deepEqual((await f.client.good('bills:changeRenewStatus',[{}])).pending,[]);
});

test('HTTP confirmed combined change can refresh a changed retail price after restart without changing its frozen adjustment',async t=>{
  const f=await fixture(t),{record}=await combinedStart(f),oldTotal=record.totalToCollect;await f.stop();f.seed(db=>{db.run("UPDATE fibernetlb_bundles SET price=30 WHERE code='NET-8GB'");const parent=query(db,'SELECT * FROM portal_operations WHERE request_id=?',[record.requestId])[0];for(let i=0;i<105;i++)db.run("INSERT INTO portal_operations(request_id,kind,entity,fingerprint,input_json,quote_json,state,actor,recorded_at,message,result_json,actor_key) VALUES(?,'change_renew',?,?,?,?, 'failed',?,?,?, ?,?)",['fictional-terminal-history-'+i,parent.entity,parent.fingerprint,parent.input_json,parent.quote_json,parent.actor,parent.recorded_at,'Fictional terminal request.',parent.result_json,parent.actor_key]);});await f.start();
  const pending=await f.client.good('bills:changeRenewStatus',[{}]);assert.equal(pending.pending.length,1,'A pending request remains discoverable behind105newer terminal requests.');assert.equal(pending.pending[0].requestId,record.requestId);
  const fresh=await f.client.good('bills:resumeChangeRenew',[{requestId:record.requestId}]);assert.equal(fresh.phase,'awaiting_payment',fresh.message);assert.equal(fresh.changeCustomerAmount,record.changeCustomerAmount);assert.equal(fresh.totalToCollect,oldTotal+5);assert.notEqual(fresh.token,record.token);assert.equal(f.provider.count('changeservice'),1);
  assert.equal((await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record)])).status,400);const done=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,fresh)]);assert.equal(done.bill.amount,fresh.totalToCollect);assert.equal(done.bill.bundleCost,20);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
});

test('HTTP signed actual provider change credit survives combined multi-cycle synchronization and restart',async t=>{
  const f=await fixture(t);f.provider.state.changeCost=-3;const quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:2}]),input={requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:2,changeCustomerAmount:quote.changeCustomerAmount??0,confirm:true},ready=await f.client.good('bills:startChangeRenew',[input]);assert.equal(ready.phase,'awaiting_payment',ready.message);assert.equal(ready.changeCost,-3);
  const done=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,ready)]);assert.equal(done.phase,'completed',done.message);assert.equal(done.bill.bundleCost,31,'Two actual17 cycle costs retain the provider credit-3 once.');await f.stop();await f.start();const saved=await f.client.good('bills:changeRenewStatus',[{requestId:ready.requestId}]);assert.equal(saved.bill.bundleCost,31);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),2);
});

test('HTTP Beirut day5-to6 native requote race stops before change and confirmed day6 customer pricing stays frozen into next month',async t=>{
  const OriginalDate=global.Date;let clock=OriginalDate.parse('2026-11-05T21:59:59.000Z');class FictionalDate extends OriginalDate{constructor(...args){super(...args.length?args:[clock]);}static now(){return clock;}}global.Date=FictionalDate;t.after(()=>{global.Date=OriginalDate;});
  const f=await fixture(t);f.provider.state.expiry='2026-11-05T12:00:00';const initial=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]);assert.equal(initial.zeroChargeWindow,true);assert.equal(initial.changeCustomerAmount,0);
  const gate=f.provider.defer('changeQuote'),firstId=crypto.randomUUID(),starting=f.client.call('bills:startChangeRenew',[{requestId:firstId,quoteId:initial.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:0,confirm:true}]);await gate.entered;clock=OriginalDate.parse('2026-11-05T22:00:01.000Z');gate.release();const stopped=await starting;assert.equal(stopped.status,400);assert.match(stopped.error,/Beirut billing day changed/);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);
  f.provider.state.expiry='2026-12-05T12:00:00';const standalone=await f.quote();assert.equal(standalone.retailPricing.policyDay,6);assert.equal(standalone.retailPricing.zeroChargeWindow,false);assert.equal(standalone.retailPricing.customerAmount,5);
  const quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]);assert.equal(quote.changeCustomerAmount,5);const id=crypto.randomUUID(),ready=await f.client.good('bills:startChangeRenew',[{requestId:id,quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:5,confirm:true}]);assert.equal(ready.phase,'awaiting_payment',ready.message);assert.equal(ready.totalToCollect,30);assert.equal(ready.zeroChargeWindow,false);
  clock=OriginalDate.parse('2026-12-01T10:00:00.000Z');await f.client.login();const resumed=await f.client.good('bills:resumeChangeRenew',[{requestId:id}]);assert.equal(resumed.phase,'awaiting_payment',resumed.message);assert.equal(resumed.changeCustomerAmount,5,'A confirmed day6 adjustment is not retroactively made free next month.');assert.equal(resumed.policyDate,'2026-11-06');assert.equal(resumed.totalToCollect,30);assert.equal(f.provider.count('changeservice'),1);
  const done=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,resumed,{billingPeriod:'2026-12'})]);assert.equal(done.phase,'completed',done.message);assert.equal(done.bill.amount,30);assert.equal(done.bill.bundleCost,20);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
});

test('HTTP standalone free-date quote cannot be forged into a customer charge and rechecks the Beirut day after native preview',async t=>{
  const OriginalDate=global.Date;let clock=OriginalDate.parse('2026-11-05T21:59:59.000Z');class FictionalDate extends OriginalDate{constructor(...args){super(...args.length?args:[clock]);}static now(){return clock;}}global.Date=FictionalDate;t.after(()=>{global.Date=OriginalDate;});
  const f=await fixture(t);f.provider.state.expiry='2026-11-05T12:00:00';const quote=await f.quote();assert.equal(quote.retailPricing.zeroChargeWindow,true);assert.equal(quote.retailPricing.customerAmount,0);const forged=await f.client.call('portal:applyChange',[f.change(quote,{amount:5})]);assert.equal(forged.status,400);assert.match(forged.error,/must be \$0/);assert.equal(f.provider.count('changeservice'),0);
  const gate=f.provider.defer('changeQuote'),changing=f.client.call('portal:applyChange',[f.change(quote)]);await gate.entered;clock=OriginalDate.parse('2026-11-05T22:00:01.000Z');gate.release();const stopped=await changing;assert.equal(stopped.status,400);assert.match(stopped.error,/Beirut change-charge day changed/);assert.equal(f.provider.count('changeservice'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
});

test('HTTP combined saved payment review is verified before any resumed receipt or money write',async t=>{
  const f=await fixture(t),{record}=await combinedStart(f),Class=require('../app/combined-change-renew.cjs').CombinedChangeRenew,original=Class.prototype.completePayment;
  Class.prototype.completePayment=async function(){throw Error('Fictional interruption immediately after the immutable intent save.');};
  try{assert.equal((await f.client.call('bills:confirmChangeRenew',[combinedPayment(f,record)])).status,400);}finally{Class.prototype.completePayment=original;}
  assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);await f.stop();f.seed(db=>{const row=query(db,'SELECT result_json FROM portal_operations WHERE request_id=?',[record.requestId])[0],result=JSON.parse(row.result_json);result.payment.review.renewalQuote.cost=999;db.run('UPDATE portal_operations SET result_json=? WHERE request_id=?',[JSON.stringify(result),record.requestId]);});await f.start();
  const refused=await f.client.call('bills:resumeChangeRenew',[{requestId:record.requestId,renew:true}]);assert.equal(refused.status,400);assert.match(refused.error,/payment proof does not match/);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);assert.equal((await f.client.good('drawer:get')).balance,0);
});

test('HTTP combined Whish collection credits the full wallet once, charges one fee and recovers an inactive saved destination',async t=>{
  const f=await fixture(t),wallet=await f.client.good('whish:save',[{label:'Fictional combined wallet',number:'03000002',active:true}],'main'),{record}=await combinedStart(f),Class=require('../app/combined-change-renew.cjs').CombinedChangeRenew,original=Class.prototype.completePayment;
  const payment=combinedPayment(f,record,{paymentMethod:'Whish Money',whishDestinationId:wallet.id});Class.prototype.completePayment=async function(){throw Error('Fictional interruption after Whish intent save, before any receipt.');};
  try{assert.equal((await f.client.call('bills:confirmChangeRenew',[payment])).status,400);}finally{Class.prototype.completePayment=original;}
  await f.client.good('whish:save',[{id:wallet.id,label:wallet.label,number:wallet.number,active:false}],'main');await f.stop();f.seed(db=>db.run("UPDATE fibernetlb_bundles SET price=47,name='Fictional changed catalog name',allowance='Fictional changed catalog allowance',active=0 WHERE code='NET-8GB'"));await f.start();const done=await f.client.good('bills:resumeChangeRenew',[{requestId:record.requestId,renew:true}]);assert.equal(done.phase,'completed',done.message);assert.equal(done.bill.amount,record.totalToCollect);assert.equal(done.bill.paymentMethod,'Whish Money');assert.equal(done.bill.whishDestination.walletAmount,record.totalToCollect);assert.equal(done.bill.whishDestination.fee,Math.round(record.totalToCollect)/100);assert.equal(done.bill.whishDestination.id,wallet.id);assert.equal(done.bill.bundlePrice,25);assert(!done.bill.bundleName.includes('changed catalog'));assert(!done.bill.bundleDetails.includes('changed catalog'));assert.equal((await f.client.good('drawer:get')).balance,0);
  const replay=await f.client.good('bills:confirmChangeRenew',[payment]);assert.equal(replay.bill.id,done.bill.id);assert.equal(f.read(db=>query(db,"SELECT COUNT(*) AS count FROM payment_destinations WHERE kind='bill'")[0].count),1);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
});

test('HTTP confirmed combined change survives an unavailable fresh renewal quote and restart without repeating the change',async t=>{
  const f=await fixture(t);f.provider.state.failRenewQuote=true;const quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]),input={requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:quote.changeCustomerAmount,confirm:true},waiting=await f.client.good('bills:startChangeRenew',[input]);assert.equal(waiting.phase,'change_confirmed');assert.equal(waiting.state,'confirmed');assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);assert(f.read(db=>require('../app/finance-ledger.cjs').pendingActions(db)).some(row=>row.source==='portal_operations'&&row.state==='confirmed'),'The unresolved parent remains visible to monthly-close and custody guards.');
  await f.stop();f.provider.state.failRenewQuote=false;await f.start();assert.equal((await f.client.good('bills:changeRenewStatus',[{}])).pending[0].phase,'change_confirmed');const ready=await f.client.good('bills:resumeChangeRenew',[{requestId:input.requestId}]);assert.equal(ready.phase,'awaiting_payment',ready.message);const done=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,ready)]);assert.equal(done.phase,'completed',done.message);assert.equal(done.bill.bundleCost,20);assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),1);
});

function billingClock(t,instant='2026-11-05T08:00:00.000Z'){
  const OriginalDate=global.Date;let clock=OriginalDate.parse(instant);
  class FictionalDate extends OriginalDate{constructor(...args){super(...args.length?args:[clock]);}static now(){return clock;}}
  global.Date=FictionalDate;t.after(()=>{global.Date=OriginalDate;});
  return {set(value){clock=OriginalDate.parse(value);}};
}

test('HTTP day5 already-paid full current cycle charges the retail upgrade difference without another renewal',async t=>{
  billingClock(t);const f=await fixture(t);f.provider.state.expiry='2026-12-05T12:00:00';f.provider.state.changeCost=7;f.provider.state.expectedChangeTarget=33;
  const quote=await f.client.good('portal:quoteChange',[{username,expectedId:11,targetId:33}]);
  assert.equal(quote.retailPricing.policyVersion,2);assert.equal(quote.retailPricing.calendarWindow,true);assert.equal(quote.retailPricing.zeroChargeWindow,false);
  assert.equal(quote.retailPricing.coverageReason,'paid_current_period');assert.equal(quote.retailPricing.customerAmount,10);assert.equal(quote.retailPricing.customerCredit,0);assert.equal(quote.total,7);
  const expiry=f.provider.state.expiry,instruction=f.change(quote,{targetId:33}),bill=await f.client.good('portal:applyChange',[instruction]);
  assert.equal(bill.amount,10);assert.equal(bill.bundleCost,7);assert.equal(f.provider.state.expiry,expiry);
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);assert.equal((await f.client.good('drawer:get')).balance,10);
  assert.equal((await f.client.good('portal:applyChange',[instruction])).id,bill.id);
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);
});

test('HTTP combined v2 exposes paid-period metadata and adds only an explicitly requested new renewal',async t=>{
  billingClock(t);const f=await fixture(t);f.provider.state.expiry='2026-12-05T12:00:00';
  const {quote,record}=await combinedStart(f);
  for(const value of [quote,record]){assert.equal(value.policyVersion,2);assert.equal(value.calendarWindow,true);assert.equal(value.zeroChargeWindow,false);assert.equal(value.coverageReason,'paid_current_period');assert.equal(value.changeCustomerAmount,5);}
  assert.equal(record.renewalCustomerAmount,25);assert.equal(record.totalToCollect,30);assert.equal(f.provider.count('renew'),0);
  const before=f.read(db=>Buffer.from(db.export()));const status=await f.client.good('bills:changeRenewStatus',[{requestId:record.requestId}]);
  assert.equal(status.policyVersion,2);assert.deepEqual(f.read(db=>Buffer.from(db.export())),before,'Displaying saved v2 policy never reprices or writes its parent.');
  const paid=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,record)]);
  assert.equal(paid.phase,'completed');assert.equal(paid.bill.amount,30);assert.equal(paid.bill.bundleCost,20);
  assert.equal(f.provider.state.expiry,'2027-01-05T12:00:00');assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
  assert.equal((await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,record)])).bill.id,paid.bill.id);assert.equal(f.provider.count('renew'),1);
});

test('HTTP closing day5 period remains waived before renewal while the new renewal is charged once',async t=>{
  billingClock(t);const f=await fixture(t);f.provider.state.expiry='2026-11-05T12:00:00';
  const {quote,record}=await combinedStart(f);
  assert.equal(quote.policyVersion,2);assert.equal(quote.calendarWindow,true);assert.equal(quote.zeroChargeWindow,true);assert.equal(quote.coverageReason,'closing_period_waived');
  assert.equal(record.changeCustomerAmount,0);assert.equal(record.renewalCustomerAmount,25);assert.equal(record.totalToCollect,25);assert.equal(f.provider.count('renew'),0);
  const paid=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,record)]);
  assert.equal(paid.bill.amount,25);assert.equal(paid.bill.bundleCost,20);assert.equal(f.provider.state.expiry,'2026-12-05T12:00:00');
  assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),1);
});

test('HTTP closing partial-period waiver retains the full adjustment for an already-paid pending cycle',async t=>{
  billingClock(t,'2026-11-03T10:00:00.000Z');const f=await fixture(t);f.provider.state.expiry='2026-12-05T12:00:00';f.provider.state.changeCost=4.5;
  f.provider.state.changeBreakdown={current_period_price:1.5,pending_refills:1,pending_refills_price:3};
  const quote=await f.quote();assert.equal(quote.retailPricing.policyVersion,2);assert.equal(quote.retailPricing.calendarWindow,true);assert.equal(quote.retailPricing.zeroChargeWindow,false);
  assert.equal(quote.retailPricing.coverageReason,'closing_period_with_paid_refills');assert.equal(quote.retailPricing.customerAmount,5);assert.equal(quote.total,4.5);
  const bill=await f.client.good('portal:applyChange',[f.change(quote)]);assert.equal(bill.amount,5);assert.equal(bill.bundleCost,4.5);
  assert.equal(f.provider.state.expiry,'2026-12-05T12:00:00');assert.equal(f.provider.count('changeservice'),1);assert.equal(f.provider.count('renew'),0);
});

test('HTTP paid day5 downgrade reports the signed retail credit without choosing a refund destination',async t=>{
  billingClock(t);const f=await fixture(t);f.provider.state.service=33;f.provider.state.expiry='2026-12-05T12:00:00';f.provider.state.changeCost=-7;
  const quote=await f.client.good('portal:quoteChange',[{username,expectedId:33,targetId:11}]);
  assert.equal(quote.retailPricing.policyVersion,2);assert.equal(quote.retailPricing.zeroChargeWindow,false);assert.equal(quote.retailPricing.coverageReason,'paid_current_period');
  assert.equal(quote.retailPricing.customerAmount,-10);assert.equal(quote.retailPricing.customerCredit,10);assert.equal(quote.total,-7);
  assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);assert.equal((await f.client.good('drawer:get')).balance,0);
});

test('HTTP unknown period pricing requires explicit review instead of automatically assuming a free change',async t=>{
  billingClock(t);const f=await fixture(t);f.provider.state.expiry='2026-12-05T12:00:00';f.provider.state.omitPeriodBreakdown=true;
  const quote=await f.quote();assert.equal(quote.retailPricing.policyVersion,2);assert.equal(quote.retailPricing.calendarWindow,true);assert.equal(quote.retailPricing.zeroChargeWindow,false);
  assert.equal(quote.retailPricing.available,false);assert.equal(quote.retailPricing.suggestedAmount,null);assert.equal(quote.retailPricing.coverageReason,'manual_review');
  const combined=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]);
  assert.equal(combined.policyVersion,2);assert.equal(combined.coverageReason,'manual_review');assert.equal(combined.changeAmountRequired,true);assert.equal(combined.changeCustomerAmount,null);assert.equal(combined.totalToCollect,null);
  assert.equal(f.provider.count('changeservice'),0);assert.equal(f.provider.count('renew'),0);assert.equal(f.read(db=>query(db,'SELECT COUNT(*) AS count FROM fibernetlb_bills')[0].count),0);
});

test('HTTP original zero-charge combined parent and receipt stay immutable after restart under v2 pricing',async t=>{
  const clock=billingClock(t),f=await fixture(t);f.provider.state.expiry='2026-11-05T12:00:00';
  const {record}=await combinedStart(f),completed=await f.client.good('bills:confirmChangeRenew',[combinedPayment(f,record)]);assert.equal(completed.bill.amount,25);
  await f.stop();f.seed(db=>{
    const row=query(db,'SELECT * FROM portal_operations WHERE request_id=?',[record.requestId])[0],input=JSON.parse(row.input_json),quote=JSON.parse(row.quote_json),result=JSON.parse(row.result_json),pricing={...quote.changePolicy};
    for(const name of ['policyVersion','calendarWindow','coverageReason','waivedFraction','chargedFraction','currentPeriodEnd'])delete pricing[name];
    Object.assign(pricing,{zeroChargeWindow:true,customerAmount:0,suggestedAmount:0,retailAdjustment:0,customerCredit:0,expectedProfit:-quote.total,method:'No customer service-change charge on Beirut dates 1–5',reason:'The customer service-change charge is $0 from the 1st through the 5th, inclusive. Renewal charges and provider costs are unchanged.'});
    quote.changePolicy=pricing;
    const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for(const review of [result.review,result.payment?.review])if(review){review.changePolicy={...pricing};const {proofHash,...proof}=review;review.proofHash=hash(proof);}
    input.quoteHash=hash(quote);
    db.run('UPDATE portal_operations SET fingerprint=?,input_json=?,quote_json=?,result_json=? WHERE request_id=?',[hash(input),JSON.stringify(input),JSON.stringify(quote),JSON.stringify(result),record.requestId]);
  });clock.set('2026-12-01T10:00:00.000Z');await f.start();
  const before=f.read(db=>Buffer.from(db.export())),writes=[f.provider.count('changeservice'),f.provider.count('renew')];
  const saved=await f.client.good('bills:changeRenewStatus',[{requestId:record.requestId}]);assert.equal(saved.policyVersion,undefined);assert.equal(saved.calendarWindow,undefined);assert.equal(saved.changeCustomerAmount,0);assert.equal(saved.bill.id,completed.bill.id);assert.equal(saved.bill.amount,25);
  const history=await f.client.good('portal:operations',['change_renew']);assert.equal(history.find(row=>row.requestId===record.requestId).changeCustomerAmount,0);
  const resumed=await f.client.good('bills:resumeChangeRenew',[{requestId:record.requestId}]);assert.equal(resumed.phase,'completed');assert.equal(resumed.bill.amount,25);
  assert.deepEqual(f.read(db=>Buffer.from(db.export())),before,'New policy never rewrites a saved old quote, fingerprint, audit event or receipt.');assert.deepEqual([f.provider.count('changeservice'),f.provider.count('renew')],writes);
});
