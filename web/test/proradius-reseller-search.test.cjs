'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ProradiusApi, PortalSettings} = require('../app/proradius-api.cjs');

const resellers = [{id:17,username:'fictional.alpha',fullname:'Fictional Alpha'},{id:29,username:'fictional.beta',fullname:'Fictional Beta'}];
const row = (username, owner = {}) => ({username,shortname:'Shared Fictional Customer',phone:'03730001',service_id:11,servicename:'Fictional 6GB',...owner});
const customers = [
  row('scope.alpha',{reseller_id:'17'}),
  row('scope.beta',{reseller:29}),
  row('scope.gamma',{owner:'17'}),
  row('scope.missing-owner')
];
const response = body => new Response(JSON.stringify(body), {status:200,headers:{'Content-Type':'application/json'}});

function fixture({list = customers, catalogue = resellers, page, owners = {'scope.alpha':17,'scope.beta':29,'scope.gamma':17,'scope.missing-owner':29}} = {}) {
  const calls=[];
  const fetch = async (url, options) => {
    const address=new URL(url);calls.push({path:address.pathname,params:Object.fromEntries(address.searchParams),method:options.method});
    assert.equal(options.method,'GET','Scoped customer discovery performs read-only GET requests.');
    if(address.pathname==='/api/resellers')return response({body:catalogue});
    if(address.pathname==='/api/user/') {
      const username=address.searchParams.get('username');assert(Object.hasOwn(owners,username),'Only explicit fictional missing-owner profiles may be looked up.');
      const owner=owners[username];
      return response({body:{info:row(username,owner&&typeof owner==='object'?owner:{reseller_id:owner})}});
    }
    assert.equal(address.pathname,'/api/users');
    if(page)return response(page(address));
    // Deliberately ignore the requested reseller: the connector must still
    // enforce ownership locally on every page and every search field.
    const index=Number(address.searchParams.get('pageIndex'));
    return response({body:{data:list.slice((index-1)*2,index*2),itemscount:list.length}});
  };
  const api = new ProradiusApi({}, fetch);
  api.token=async()=> 'fictional-search-token';
  return {api,calls,fetch};
}

test('scoped native search excludes foreign owners even when the provider ignores its filter', async () => {
  const {api,calls}=fixture();
  const result=await api.search({term:'scope',reseller:'fictional.alpha'});
  assert.deepEqual(result.customers.map(customer=>customer.username),['scope.alpha','scope.gamma']);
  assert.equal(result.total,2);assert(result.customers.every(customer=>customer.resellerId===17));
  const pages=calls.filter(call=>call.path==='/api/users');
  assert.equal(pages.length,4);assert(pages.every(call=>call.params.reseller==='17'&&call.params.resellername==='fictional.alpha'&&call.params.pageSize==='50'));
  assert.deepEqual(pages.map(call=>[call.params.username?'username':'shortname',call.params.pageIndex]),[['username','1'],['username','2'],['shortname','1'],['shortname','2']]);
  assert.equal(calls.filter(call=>call.path==='/api/user/'&&call.params.username==='scope.missing-owner').length,1);
});

test('phone and full-name searches apply the same reseller ownership checks', async () => {
  for(const term of ['03730001','Shared Fictional']) {
    const {api,calls}=fixture();
    const result=await api.search({term,reseller:'Fictional Beta'});
    assert.deepEqual(result.customers.map(customer=>customer.username),['scope.beta','scope.missing-owner']);
    assert(result.customers.every(customer=>customer.resellerId===29));
    const pages=calls.filter(call=>call.path==='/api/users');
    assert(pages.every(call=>call.params.reseller==='29'&&call.params.resellername==='fictional.beta'));
    assert.equal(pages.filter(call=>call.params.phone).length,term==='03730001'?2:0);
  }
});

test('unfiltered cache remains isolated and scoped searches always verify fresh ownership', async () => {
  const {api,calls}=fixture({page:()=>({results:customers,next:null})});
  const all=await api.search('scope');assert.equal(all.total,4);
  const alpha=await api.search({term:'scope',reseller:'fictional.alpha'});
  assert.deepEqual(alpha.customers.map(customer=>customer.username),['scope.alpha','scope.gamma']);
  const beta=await api.search({term:'scope',reseller:'fictional.beta'});
  assert.deepEqual(beta.customers.map(customer=>customer.username),['scope.beta','scope.missing-owner']);
  const pageCalls=calls.filter(call=>call.path==='/api/users');
  assert.deepEqual(pageCalls.map(call=>call.params.reseller),[undefined,'17','29']);

  const native=fixture();
  const first=await native.api.search({term:'scope',reseller:'fictional.alpha'});
  const before=native.calls.filter(call=>call.path==='/api/users').length;
  const cached=await native.api.search({term:'scope',reseller:'fictional.alpha'});
  assert.deepEqual(cached,first);assert(native.calls.filter(call=>call.path==='/api/users').length>before);
  const changed=await native.api.search({term:'scope',reseller:'fictional.beta'});
  assert(changed.customers.every(customer=>customer.resellerId===29));
  assert(native.calls.filter(call=>call.path==='/api/users').length>before);
});

test('legacy pagination retains the reseller and rejects a dropped filter before reading its page', async () => {
  for(const retainFilter of [true,false]) {
    const {api,calls}=fixture({page:address=>Number(address.searchParams.get('pageIndex'))===1
      ? {results:customers.slice(0,2),next:'/api/users?pageIndex=2'+(retainFilter?'&reseller=17':'')}
      : {results:customers.slice(2),next:null}});
    const finding=api.search({term:'scope',reseller:'fictional.alpha'});
    if(retainFilter)assert.deepEqual((await finding).customers.map(customer=>customer.username),['scope.alpha','scope.gamma']);
    else await assert.rejects(finding,/pagination lost the reseller filter/);
    const pages=calls.filter(call=>call.path==='/api/users');
    assert.equal(pages.length,retainFilter?2:1);assert(pages.every(call=>call.params.reseller==='17'&&call.params.resellername==='fictional.alpha'));
  }
});

test('legacy next links reject conflicting native reseller names and propagate a missing name', async () => {
  for(const suffix of ['', '&resellername=fictional.alpha', '&resellername=fictional.beta', '&resellername=fictional.alpha&resellername=fictional.beta']) {
    const {api,calls}=fixture({page:address=>Number(address.searchParams.get('pageIndex'))===1
      ? {results:customers.slice(0,2),next:'/api/users?pageIndex=2&reseller=17'+suffix}
      : {results:customers.slice(2),next:null}});
    const finding=api.search({term:'scope',reseller:'fictional.alpha'}),conflicting=suffix.includes('fictional.beta');
    if(conflicting)await assert.rejects(finding,/pagination changed the reseller name/);
    else assert.deepEqual((await finding).customers.map(customer=>customer.username),['scope.alpha','scope.gamma']);
    const pages=calls.filter(call=>call.path==='/api/users');
    assert.equal(pages.length,conflicting?1:2);
    assert(pages.every(call=>call.params.resellername==='fictional.alpha'));
  }
});

test('an unknown or ambiguous reseller never falls back to an unfiltered customer query', async () => {
  for(const [catalogue,selection] of [[resellers,'missing.reseller'],[[...resellers,{id:35,username:'fictional.clone',fullname:'Fictional Alpha'}],'Fictional Alpha']]) {
    const {api,calls}=fixture({catalogue});
    await assert.rejects(api.search({term:'scope',reseller:selection}),/one exact Proradius reseller/);
    assert.equal(calls.filter(call=>call.path==='/api/users'||call.path==='/api/user/').length,0);
  }
});

test('missing or unrecognized list ownership is verified exactly and fails closed when still unverifiable', async () => {
  const list=[row('scope.alpha',{reseller:{id:17}}),row('scope.beta',{resellername:'Fictional Alpha'}),row('irrelevant.customer')];
  const {api,calls}=fixture({list,owners:{'scope.alpha':'17','scope.beta':null}});
  const result=await api.search({term:'scope',reseller:'fictional.alpha'});
  assert.deepEqual(result.customers.map(customer=>customer.username),['scope.alpha']);
  const exact=calls.filter(call=>call.path==='/api/user/');
  assert(exact.some(call=>call.params.username==='scope.alpha'));
  assert(exact.some(call=>call.params.username==='scope.beta'));
  assert(exact.every(call=>call.params.username!=='irrelevant.customer'));
});

test('exact customer verification rejects a different selected reseller', async () => {
  const {api}=fixture({owners:{'scope.alpha':17}});
  assert.equal((await api.customer({username:'scope.alpha',reseller:'fictional.alpha'})).resellerId,17);
  await assert.rejects(api.customer({username:'scope.alpha',reseller:'fictional.beta'}),/does not belong to the selected reseller/);
});

test('scoped search verifies canonical ownership when a list row claims the selected reseller', async () => {
  const {api}=fixture({list:[row('scope.alpha',{reseller_id:17})],owners:{'scope.alpha':29}});
  assert.deepEqual(await api.search({term:'scope',reseller:'fictional.alpha'}),{customers:[],total:0});
});

test('contradictory list-owner aliases cannot prove the selected reseller', async () => {
  const {api}=fixture({list:[row('scope.alpha',{reseller_id:17,reseller:29})],owners:{'scope.alpha':29}});
  assert.deepEqual(await api.search({term:'scope',reseller:'fictional.alpha'}),{customers:[],total:0});
});

test('a scoped search cache cannot redisplay a customer after canonical ownership changes', async () => {
  const owners={'scope.alpha':17};
  const {api}=fixture({list:[row('scope.alpha',{reseller_id:17})],owners});
  assert.equal((await api.search({term:'scope',reseller:'fictional.alpha'})).total,1);
  owners['scope.alpha']=29;
  assert.deepEqual(await api.search({term:'scope',reseller:'fictional.alpha'}),{customers:[],total:0});
});

test('exact scoped profiles support numeric owner objects and reject contradictory aliases', async () => {
  const owners={'scope.alpha':{reseller:{id:'17'}},'scope.beta':{reseller_id:17,reseller:29}};
  const {api}=fixture({list:customers.slice(0,2),owners});
  assert.equal((await api.customer({username:'scope.alpha',reseller:'fictional.alpha'})).resellerId,17);
  await assert.rejects(api.customer({username:'scope.beta',reseller:'fictional.alpha'}),/owner could not be verified/);
  assert.deepEqual((await api.search({term:'scope',reseller:'fictional.alpha'})).customers.map(customer=>customer.username),['scope.alpha']);
});

test('contradictory supported IDs inside an owner object fail both exact lookup and scoped search', async () => {
  for(const key of ['reseller_id','reseller','owner']) {
    const owners={'scope.alpha':{[key]:{reseller_id:17,id:29}}};
    const {api}=fixture({list:[row('scope.alpha',{reseller_id:17})],owners});
    await assert.rejects(api.customer({username:'scope.alpha',reseller:'fictional.alpha'}),/owner could not be verified/);
    assert.deepEqual(await api.search({term:'scope',reseller:'fictional.alpha'}),{customers:[],total:0});
  }
});

test('broad scoped searches bound exact verification to 30 candidates and report only verified rows', async () => {
  const list=Array.from({length:45},(_,index)=>row('scope.bound.'+index,{reseller_id:17}));
  const owners=Object.fromEntries(list.map((customer,index)=>[customer.username,index%2?29:17]));
  const {api,calls}=fixture({list,owners,page:()=>({body:{data:list,itemscount:list.length}})});
  const result=await api.search({term:'scope',reseller:'fictional.alpha'});
  assert.equal(result.total,15);assert.equal(result.customers.length,15);assert.equal(result.truncated,true);
  assert(result.customers.every(customer=>customer.resellerId===17));
  assert.equal(calls.filter(call=>call.path==='/api/user/').length,30);
  assert.equal(calls.filter(call=>call.path==='/api/resellers').length,1);
});

test('an exact profile failure or settings change cannot return the unverified list row', async () => {
  for(const changed of [false,true]) {
    const {api}=fixture({list:[row('scope.alpha',{reseller_id:17})]});
    const original=api.get.bind(api);
    api.get=async route=>{
      if(route.startsWith('/api/user/?')) {
        if(changed) {api.clearToken();return {body:{info:row('scope.alpha',{reseller_id:29})}};}
        throw Error('Fictional exact lookup unavailable.');
      }
      return original(route);
    };
    await assert.rejects(api.search({term:'scope',reseller:'fictional.alpha'}),changed?/settings changed/:/exact lookup unavailable/);
  }
});

test('real HTTP portal search preserves reseller scope despite ignored provider filters and moved owners', async t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
  const {createBackend}=require('../app/core.cjs'),{createServer}=require('../server.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),{DATABASES}=require('../app/backup-archive.cjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-scoped-search-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32));
  const owners={'scope.alpha':17,'scope.beta':29,'scope.gamma':17,'scope.missing-owner':29},provider=fixture({owners});
  let backend,server,tokenRequests=0;
  t.after(async()=>{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    await backend?.close();secrets.destroy();
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('fibernetlb-scoped-search-fictional-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  // Synthetic provider credentials and ready state are prepared locally; no
  // real account, provider verification or financial action is involved.
  const settings=new PortalSettings(path.join(directory,'internet-api-settings.json'),secrets);
  settings.configure({username:'fictional.search.api',password:'Fictional-search-provider-password'});settings.enable();
  const originalFetch=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://pi.fibernetlb.net');
    if(new URL(url).pathname==='/api/token/') {assert.equal(options.method,'POST');tokenRequests++;return response({access:'fictional-search-token'});}
    return provider.fetch(url,options);
  };
  try {backend=await createBackend({dataDirectory:directory,initialize:true,providersEnabled:true,secrets,automaticMonthClose:false});}
  finally {global.fetch=originalFetch;}
  const password='Fictional-search-owner-password';
  await backend.createOwner({username:'search.owner',fullName:'Fictional Search Owner',password});
  server=createServer({backend,origin:'http://localhost',demo:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let cookie='',csrf='',version='';
  const request=(route,payload)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:payload?'POST':'GET',headers:{Host:'localhost',...cookie?{Cookie:cookie}:{},...payload?{Origin:'http://localhost','Content-Type':'application/json','X-CSRF-Token':csrf,'X-App-Version':version}:{}}},res=>{
      if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});
    });req.on('error',reject);req.end(payload?JSON.stringify(payload):undefined);
  });
  const call=async(channel,args=[],workspaceId='fiber-users')=>{
    const result=await request('/api/rpc',{channel,args,workspaceId});assert.equal(result.status,200,channel+': '+result.error);return result.data;
  };
  const session=await request('/api/session');csrf=session.data.csrfToken;version=session.data.version;
  await call('auth:login',[{username:'search.owner',password}],'main');await call('auth:switch',['fiber-users'],'main');
  const fingerprints=()=>DATABASES.map(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex'));
  const before=fingerprints();
  const alpha=await call('portal:search',[{term:'scope',reseller:'fictional.alpha'}]);
  assert.deepEqual(alpha.customers.map(customer=>customer.username),['scope.alpha','scope.gamma']);
  const beta=await call('portal:search',[{term:'scope',reseller:'fictional.beta'}]);
  assert.deepEqual(beta.customers.map(customer=>customer.username),['scope.beta','scope.missing-owner']);
  owners['scope.alpha']=29;
  const refreshed=await call('portal:search',[{term:'scope',reseller:'fictional.alpha'}]);
  assert.deepEqual(refreshed.customers.map(customer=>customer.username),['scope.gamma']);
  assert(refreshed.customers.every(customer=>customer.resellerId===17));
  assert.deepEqual(fingerprints(),before,'Search does not modify any of the seven fictional databases.');
  assert.equal(tokenRequests,1);assert(provider.calls.every(call=>call.method==='GET'));
  const pages=provider.calls.filter(call=>call.path==='/api/users');
  assert(pages.some(call=>call.params.reseller==='17'));assert(pages.some(call=>call.params.reseller==='29'));
  assert(pages.every(call=>call.params.reseller==='17'?call.params.resellername==='fictional.alpha':call.params.reseller==='29'&&call.params.resellername==='fictional.beta'));
});
