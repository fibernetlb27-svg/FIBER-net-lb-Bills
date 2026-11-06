'use strict';
// All accounts, databases and provider responses are fictional. Provider fetch
// is captured in memory; only the HTTP boundary binds a loopback socket.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {createBackend}=require('../../app/core.cjs'),{createServer}=require('../../server.cjs'),{createSecretStorage}=require('../../lib/secrets.cjs');
const {RenewalLedger}=require('../../app/internet-renewals.cjs');
const username='fictional.credit.customer',password='Fictional-credit-owner-123';

function clock(t,instant='2026-11-06T10:00:00Z'){
  const Original=global.Date;let now=Original.parse(instant);
  global.Date=class extends Original{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  t.after(()=>{global.Date=Original;});return {set:instant=>{now=Original.parse(instant);}};
}
function provider(){
  const state={service:11,expiry:'2026-11-05T12:00:00',cycles:0,unknownCycle:0,calls:[],costs:[13,14,15,16]};
  const services=[{service_id:11,shortname:'6GB Internet',price:13},{service_id:22,shortname:'8GB Internet',price:17}];
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
      return json({body:{info:{username,shortname:'Fictional Credit Customer',phone:'03000001',service:state.service,reseller:41,service_expiry:state.expiry,blocked:false},services}});
    }
    if(route.pathname==='/api/services/reseller/action/')return json({username:'fibernetlb2',services:[{id:101,servicename:'FIBER net lb 6GB',price:13,limittype:'fixed'},{id:102,servicename:'FIBER net lb 8GB',price:16,limittype:'fixed'}]});
    if(route.pathname==='/api/user/services/')return json({body:services.filter(row=>row.service_id!==state.service)});
    assert.equal(route.pathname,'/api/user/bulk/actions/');assert.equal(method,'POST');
    if(body.op==='checkchangeservice')return json({body:{price:3,current_period_price:3,freetime_price:0,pending_refills:0,pending_refills_price:0}});
    if(body.op==='changeservice'){assert.deepEqual(body.data,{username,service:22});state.service=22;return json({success:true});}
    if(body.op==='renewcheck')return json({body:{data:[{username,service_id:state.service,servicename:services.find(row=>row.service_id===state.service).shortname,price:state.service===22?17:state.costs[state.cycles]??16,freetime_price:0}]}});
    assert.equal(body.op,'renew','No other provider action is allowed in this fixture.');assert.deepEqual(body.ids,[{username,service:state.service}]);
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

module.exports={fixture,clock,provider,browser,username,password};
