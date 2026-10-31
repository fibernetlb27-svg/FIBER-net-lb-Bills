'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{DATABASES}=require('../app/backup-archive.cjs');
const password='Fictional-roles-only-123';
async function good(backend,channel,args=[],token='',workspaceId='main'){const result=await backend.request({channel,args,token,workspaceId});assert.equal(result.status,200,channel+': '+result.error);return result.data;}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
test('Cashier and Support keep isolated custody; account revocation and idle/absolute expiry are enforced',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-core-roles-fictional-'));let now=Date.now(),backend;
 t.after(async()=>{await backend?.close();fs.rmSync(directory,{recursive:true,force:true});});
 backend=await createBackend({dataDirectory:directory,initialize:true,sessionClock:()=>now});
 await backend.createOwner({username:'owner',fullName:'Fictional Owner',password});
 const admin=(await good(backend,'auth:login',[{username:'owner',password}])).sessionToken;
 const issued={};
 for(const role of ['cashier','support','viewer']){
  const user=await good(backend,'users:create',[{username:role,fullName:'Fictional '+role,password,role,allowedSections:['fiber-users']}],admin);
  const login=await good(backend,'auth:login',[{username:role,password}]);assert.equal(login.user.role,role);
  const scoped=await good(backend,'auth:switch',['fiber-users'],login.sessionToken);assert.equal(scoped.user.accountKey,user.accountKey);assert.equal(scoped.user.role,role);
  issued[role]={user,main:login.sessionToken,section:scoped.sessionToken};
  assert.notEqual((await backend.request({channel:'auth:switch',args:['fiber-resellers'],token:login.sessionToken})).status,200);
  for(const channel of ['bank:sources','portal:settings','backups:status','backups:run','backups:retry','backups:test'])assert.notEqual((await backend.request({channel,args:channel==='bank:sources'?[{workspaceId:'fiber-users'}]:[],token:scoped.sessionToken,workspaceId:'fiber-users'})).status,200,role+' '+channel);
 }
 for(const [role,balance]of [['cashier',11],['support',29]])await good(backend,'drawer:setBalance',[{balance,note:'Fictional '+role+' opening custody'}],issued[role].section,'fiber-users');
 const reads=await Promise.all(Array.from({length:20},(_,i)=>good(backend,'drawer:get',[],issued[i%2?'support':'cashier'].section,'fiber-users')));
 reads.forEach((value,i)=>assert.equal(value.balance,i%2?29:11,'AsyncLocalStorage keeps caller custody scope'));
 const source=await good(backend,'bank:sources',[{workspaceId:'fiber-users'}],admin);assert.equal(source.businessBalances.cash,40);
 assert.equal((await backend.request({channel:'drawer:setBalance',args:[{balance:999}],token:issued.viewer.section,workspaceId:'fiber-users'})).status,400);
 const context=backend.metadata('fiber-users');assert.equal(context.section.id,'fiber-users');context.sections[0].id='tampered';assert.equal(backend.metadata().sections[0].id,'main');assert.throws(()=>backend.metadata('unknown'),/Unknown business/);
 await good(backend,'users:updateAccess',[issued.viewer.user.accountKey,[]],admin);
 assert.equal((await good(backend,'auth:status',[],issued.viewer.section,'fiber-users')).user,null,'Section access revocation invalidates a previously issued token');
 assert.equal((await backend.request({channel:'drawer:get',token:issued.viewer.section,workspaceId:'fiber-users'})).status,401);
 await good(backend,'users:update',[issued.cashier.user.accountKey,{username:'cashier',fullName:'Fictional cashier',role:'cashier',active:true,password:'Fictional-new-password-123',allowedSections:['fiber-users']}],admin);
 assert.equal((await backend.request({channel:'drawer:get',token:issued.cashier.section,workspaceId:'fiber-users'})).status,401,'Password changes revoke existing sessions');
 assert.equal((await backend.request({channel:'auth:login',args:[{username:'cashier',password}]})).status,400);
 assert.equal((await good(backend,'auth:login',[{username:'cashier',password:'Fictional-new-password-123'}])).user.role,'cashier');
 await good(backend,'users:update',[issued.support.user.accountKey,{username:'support',fullName:'Fictional support',role:'support',active:false,allowedSections:['fiber-users']}],admin);
 assert.equal((await backend.request({channel:'drawer:get',token:issued.support.section,workspaceId:'fiber-users'})).status,401,'Deactivation revokes existing sessions');
 now+=12*60*60*1000+1;
 assert.equal((await backend.request({channel:'drawer:get',token:admin})).status,401,'Idle expiry');
 const absolute=(await good(backend,'auth:login',[{username:'owner',password}])).sessionToken;
 now+=11*60*60*1000;assert.equal((await good(backend,'auth:status',[],absolute)).user.role,'admin');
 now+=11*60*60*1000;assert.equal((await good(backend,'auth:status',[],absolute)).user.role,'admin');
 now+=2*60*60*1000+1;assert.equal((await good(backend,'auth:status',[],absolute)).user,null,'Absolute expiry applies despite activity');
});
test('corrupt data and stale writer locks fail before any migration; clean recovery retains every database',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-core-recovery-fictional-'));let backend;
 t.after(async()=>{await backend?.close();fs.rmSync(directory,{recursive:true,force:true});});
 backend=await createBackend({dataDirectory:directory,initialize:true});await backend.createOwner({username:'owner',fullName:'Fictional Recovery Owner',password});await backend.close();
 const files=new Map(DATABASES.map(name=>[name,fs.readFileSync(path.join(directory,name))]));
 const broken=DATABASES[3];fs.writeFileSync(path.join(directory,broken),'fictional corrupt database');
 await assert.rejects(createBackend({dataDirectory:directory}),/validation failed.*No accounting migrations/);
 for(const [name,bytes]of files)if(name!==broken)assert.equal(digest(fs.readFileSync(path.join(directory,name))),digest(bytes),'Validation failure does not save '+name);
 const lock=path.join(directory,'.fibernetlb-web.lock');assert.equal(fs.existsSync(lock),false,'Initialization failure releases its own lock');
 fs.writeFileSync(path.join(directory,broken),files.get(broken));fs.writeFileSync(lock,'fictional stale writer marker');
 await assert.rejects(createBackend({dataDirectory:directory}),/writer lock/);assert.equal(fs.readFileSync(lock,'utf8'),'fictional stale writer marker','Stale locks require operator review');
 fs.unlinkSync(lock);backend=await createBackend({dataDirectory:directory});assert.equal(backend.metadata().needsSetup,false);
 assert.equal((await good(backend,'auth:login',[{username:'owner',password}])).user.fullName,'Fictional Recovery Owner');
 await backend.close();assert.throws(()=>backend.metadata(),/closed/);assert.equal((await backend.request({channel:'auth:status'})).status,400);await backend.close();
});
