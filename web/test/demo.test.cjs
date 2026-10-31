'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createDemo}=require('../tools/demo.cjs'),{DATABASES}=require('../app/backup-archive.cjs');
function client(url){
 const origin=new URL(url);let cookie='',csrf='',version='';
 async function request(route,input){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:origin.port,path:route,method:input?'POST':'GET',headers:{Host:origin.host,...cookie?{Cookie:cookie}:{},...input?{Origin:origin.origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-App-Version':version}:{}}},response=>{if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});});req.setTimeout(15000,()=>req.destroy(Error('Preview test timed out.')));req.on('error',reject);req.end(input?JSON.stringify(input):undefined);});}
 return {request,rpc:(channel,args=[],workspaceId='main')=>request('/api/rpc',{channel,args,workspaceId}),async login(credentials){const session=await request('/api/session');csrf=session.body.data.csrfToken;version=session.body.data.version;return request('/api/rpc',{channel:'auth:login',args:[credentials],workspaceId:'main'});}};
}
test('disposable preview uses real HTTP, seven fictional databases, isolated instances and verified cleanup',{timeout:60000},async t=>{
 await assert.rejects(createDemo({host:'0.0.0.0',port:0}),/only to 127/);
 await assert.rejects(createDemo({host:'localhost',port:0}),/only to 127/);
 await assert.rejects(createDemo({port:-1}),/valid local preview port/);
 const originalSource=path.resolve(__dirname,'../../IspPosDesktop/main.js');
 const sourceHash=fs.existsSync(originalSource)?crypto.createHash('sha256').update(fs.readFileSync(originalSource)).digest('hex'):null;
 let first,second;t.after(async()=>{await second?.stop();await first?.stop();});
 first=await createDemo({port:0});
 assert.equal(first.server.address().address,'127.0.0.1');assert.equal(first.backend.metadata().providersEnabled,false);
 assert.equal(first.credentials.username,'demo.admin');assert.equal(first.credentials.password,'PreviewOnly-2026!');
 assert(DATABASES.every(name=>fs.statSync(path.join(first.directory,name)).isFile()));
 assert.equal(first.resourceProfile.databaseFiles,7);assert(first.resourceProfile.databaseTotalBytes>0);assert(first.resourceProfile.rss>0);assert.match(first.resourceProfile.scope,/not a production capacity/);
 const browser=client(first.url),meta=await browser.request('/api/meta');assert.equal(meta.status,200);assert.equal(meta.body.data.demo,true);assert.equal(meta.body.data.capabilities.providerActions,false);
 const login=await browser.login({username:first.credentials.username,password:first.credentials.password});assert.equal(login.status,200);assert.equal(login.body.data.role,'admin');assert.equal(login.body.data.sessionToken,undefined);
 const opening=await browser.rpc('drawer:get');assert.equal(opening.body.data.balance,500);
 assert.equal((await browser.rpc('drawer:setBalance',[{balance:507,note:'Fictional preview instance isolation'}])).status,200);
 const catalog=await browser.rpc('warehouse:list',[{workspaceId:'main'}]);assert.equal(catalog.status,200);assert(catalog.body.data.products.some(product=>product.name==='Preview Wi-Fi router'));
 const monthly=await browser.rpc('fixedMonthly:overview');assert.equal(monthly.status,200);assert.equal(monthly.body.data.totals.billCount,1);
 const provider=await browser.rpc('portal:test',['fictional-only']);assert(provider.status>=400);
 assert.equal((await browser.request('/server.cjs')).status,404);assert.equal((await browser.request('/isp-desk.sqlite')).status,404);
 second=await createDemo({port:0});assert.notEqual(first.directory,second.directory);assert.notEqual(first.url,second.url);
 assert.equal((await browser.rpc('drawer:get')).body.data.balance,507,'A second preview does not reset the first preview');
 const other=client(second.url);await other.login({username:second.credentials.username,password:second.credentials.password});assert.equal((await other.rpc('drawer:get')).body.data.balance,500,'Second preview owns fresh independent data');
 const viewer=client(first.url);assert.equal((await viewer.login(first.credentials.viewer)).body.data.role,'viewer');assert.notEqual((await viewer.rpc('bank:sources',[{workspaceId:'main'}])).status,200);
 const firstDirectory=first.directory,secondDirectory=second.directory;await second.stop();assert.equal(fs.existsSync(secondDirectory),false);assert.equal((await browser.request('/health')).status,200,'Stopping the second preview leaves the first running');
 await first.stop();await first.stop();assert.equal(fs.existsSync(firstDirectory),false);assert.equal(first.server.listening,false);assert.equal((await first.backend.request({channel:'auth:status'})).status,400);
 if(sourceHash)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(originalSource)).digest('hex'),sourceHash,'Original desktop application source remains byte untouched');
});
