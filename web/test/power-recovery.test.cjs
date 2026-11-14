'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {GuardError,validateConfig,validateLock,verifyAttestation,claimOf,createController,linuxDevice,mountOverlapsData,DATABASES}=require('../deploy/power-recovery.cjs');
const Audit=require('../deploy/power-recovery-audit.cjs');
const initSql=require('sql.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function context(){return {machineIdHash:'a'.repeat(64),data:{path:'/srv/fictional/private/data',dev:'8',ino:'42'},boot:{id:'22222222-2222-2222-2222-222222222222',btime:1000},authority:{recordSha256:'b'.repeat(64),containerName:'fictional-web',containerId:'c'.repeat(64),imageId:'sha256:'+'d'.repeat(64),imageName:'fibernetlb-web:0.1.14',version:'0.1.14',sourceCommit:'e'.repeat(40)},lock:{dev:'8',ino:'57',size:59,mtimeNs:'900000000000',uid:10001,mode:0o600,sha256:'f'.repeat(64),pid:2,instance:'33333333-3333-3333-3333-333333333333'},healthy:false,running:true};}
function fixture(options={}){
 const original=context(),calls=[],saved=[];if(options.noLock)original.lock=null;if(options.healthy)original.healthy=true;
 const attestation=claimOf(clone(original));attestation.boot={id:'11111111-1111-1111-1111-111111111111',btime:500};attestation.attestedAt='2026-11-08T00:00:00.000Z';
 let current=clone(original);const checkpoint={job:'fictional-private-checkpoint'};
 const adapter={
  async inspect(){calls.push('inspect');return clone(current);},
  async loadState(){calls.push('loadState');return options.state===undefined?clone(attestation):options.state;},
  async saveState(value){calls.push('attest');saved.push(clone(value));if(options.failAt==='attest')throw new GuardError('STATE_WRITE_FAILED');},
  async stop(){calls.push('stop');if(options.failAt==='stop')throw new GuardError('WRITER_DID_NOT_STOP');current.running=false;},
  async exclusive(){calls.push('exclusive');if(options.failAt==='exclusive')throw new GuardError('OTHER_DATA_WRITER');},
  async checkpoint(){calls.push('checkpoint');if(options.failAt==='checkpoint')throw new GuardError('CHECKPOINT_FAILED');return checkpoint;},
  async audit(){calls.push('audit');if(options.failAt==='audit')throw new GuardError('AUDIT_FAILED');return {pendingFinancialActions:options.pending||0};},
  async recheck(){calls.push('recheck');if(options.failAt==='recheck')throw new GuardError('SOURCE_CHANGED');},
  async archive(){calls.push('archive');if(options.failAt==='archive')throw new GuardError('WRITER_LOCK_CHANGED');current.lock=null;},
  async start(){calls.push('start');if(options.failAt==='start')throw new GuardError('START_FAILED');current.running=true;},
  async waitHealthy(){calls.push('healthy');if(options.failAt==='healthy')throw new GuardError('STARTUP_REQUIRES_REVIEW');current.healthy=true;current.lock={...original.lock,sha256:'9'.repeat(64),mtimeNs:'1001000000000',instance:'44444444-4444-4444-4444-444444444444'};return clone(current);},
  async finish(result){calls.push('finish');saved.push(clone(result));},
  async fail(code){calls.push('failed:'+code);}
 };
 return {controller:createController(adapter),adapter,calls,saved,original,attestation,setState:value=>{adapter.loadState=async()=>value;}};
}
test('power recovery attests a healthy known writer without stopping or reading the databases',async()=>{
 const f=fixture({healthy:true});const result=await f.controller.recover();assert.equal(result.action,'healthy-attested');assert.deepEqual(f.calls,['inspect','attest']);assert.equal(f.saved[0].lock.sha256,f.original.lock.sha256);
});
test('power recovery requires a healthy writer and its existing marker for attestation',async()=>{
 for(const options of [{},{healthy:true,noLock:true}]){const f=fixture(options);await assert.rejects(f.controller.attest(),error=>error.code==='HEALTHY_WRITER_REQUIRED');assert.deepEqual(f.calls,['inspect']);}
});
test('previous-boot exact attestation recovers only after checkpoint, audit and final source verification',async()=>{
 const f=fixture();const result=await f.controller.recover();assert.equal(result.action,'previous-boot-lock-archived-and-started');assert.equal(result.oldDataRestored,false);
 assert.deepEqual(f.calls,['inspect','loadState','stop','exclusive','checkpoint','audit','recheck','archive','start','healthy','attest','finish']);assert.notEqual(f.saved[0].lock.sha256,f.original.lock.sha256);assert.equal(f.saved[0].boot.id,f.original.boot.id);
});
test('a stopped container without a lock still needs exclusive storage and a seven-database audit before starting',async()=>{
 const f=fixture({noLock:true});const result=await f.controller.recover();assert.equal(result.action,'verified-unlocked-container-started');assert.ok(!f.calls.includes('archive'));assert.ok(!f.calls.includes('loadState'));assert.ok(f.calls.indexOf('audit')<f.calls.indexOf('start'));
});
test('unattested, foreign, changed-machine, data, image or writer locks never reach a stop or archive',async()=>{
 const original=fixture();const mutations=[null,{}, {...clone(original.attestation),format:'old-protocol'}];
 for(const field of ['machineIdHash','data','authority','lock']){const next=clone(original.attestation);if(field==='machineIdHash')next[field]='0'.repeat(64);else next[field]={...next[field],extra:'unverified'};mutations.push(next);}
 for(const state of mutations){const f=fixture({state});await assert.rejects(f.controller.recover(),error=>['MISSING_ATTESTATION','ATTESTATION_MISMATCH'].includes(error.code));assert.ok(!f.calls.includes('stop'));assert.ok(!f.calls.includes('archive'));assert.ok(!f.calls.includes('start'));}
});
test('same-boot, future-clock and invalid boot attestations cannot authorize clearing a lock',()=>{
 const f=fixture();for(const boot of [f.original.boot,{id:'invalid',btime:500},{id:f.attestation.boot.id,btime:1001}]){const state={...f.attestation,boot};assert.throws(()=>verifyAttestation(state,f.original),error=>['SAME_OR_UNPROVEN_BOOT','INVALID_ATTESTATION'].includes(error.code));}
 const state=clone(f.attestation),source=clone(f.original);source.lock.mtimeNs='1000000000000';state.lock=clone(source.lock);assert.throws(()=>verifyAttestation(state,source),error=>error.code==='LOCK_NOT_PREVIOUS_BOOT');
});
test('corrupt private attestation metadata is rejected even when its writer identity matches',()=>{
 const f=fixture();
 for(const mutate of [state=>{state.boot.id='-'.repeat(36);},state=>{state.boot.btime=-1;},state=>{delete state.attestedAt;},state=>{state.attestedAt='2026-02-30T00:00:00.000Z';},state=>{state.extra='unrecognized';}]){const state=clone(f.attestation);mutate(state);assert.throws(()=>verifyAttestation(state,f.original),error=>error.code==='INVALID_ATTESTATION');}
});
test('future marker fields and malformed marker identities require operator review',()=>{
 for(const value of [null,[],{pid:2,instance:'not-uuid'},{pid:-1,instance:'33333333-3333-3333-3333-333333333333'},{pid:2,instance:'33333333-3333-3333-3333-333333333333',host:'unattested'}])assert.throws(()=>validateLock(value),error=>error.code==='UNRECOGNIZED_WRITER_LOCK');
 assert.equal(validateLock({pid:2,instance:'33333333-3333-3333-3333-333333333333'}).pid,2);
});
for(const stage of ['stop','exclusive','checkpoint','audit','recheck','archive'])test('recovery failure at '+stage+' preserves financial data and never starts an unverified writer',async()=>{
 const f=fixture({failAt:stage});await assert.rejects(f.controller.recover(),error=>error instanceof GuardError);assert.ok(!f.calls.includes('start'));assert.ok(!f.calls.includes('attest'));if(stage!=='archive')assert.ok(!f.calls.includes('archive'));assert.ok(f.calls.at(-1).startsWith('failed:'));
});
test('current unfinished financial requests stop recovery before lock archival or restart',async()=>{
 const f=fixture({pending:1});await assert.rejects(f.controller.recover(),error=>error.code==='PENDING_FINANCIAL_REVIEW_REQUIRED');assert.ok(!f.calls.includes('recheck'));assert.ok(!f.calls.includes('archive'));assert.ok(!f.calls.includes('start'));
});
test('a failed restart cannot claim a healthy attestation or restore old database files',async()=>{
 for(const failAt of ['start','healthy']){const f=fixture({failAt});await assert.rejects(f.controller.recover());assert.ok(!f.calls.includes('attest'));assert.ok(!f.calls.includes('finish'));assert.ok(f.calls.includes('archive'));assert.ok(!Object.keys(f.adapter).some(name=>/restore|replay|renew|pay|transfer/i.test(name)));}
});
test('kernel device conversion and inode sets catch aliases of files, sections and data ancestors',()=>{
 const value=linuxDevice((8n<<8n)|2n);assert.deepEqual(value,{major:8n,minor:2n});
 const protectedInodes=new Set(['8:100','8:200','8:300']),ancestors=new Set(['8:1','8:2','8:100']);
 for(const identity of ['8:100','8:200','8:300','8:1'])assert.equal(mountOverlapsData(identity,[identity,'8:1'],protectedInodes,ancestors),true);
 assert.equal(mountOverlapsData('8:400',['8:400','8:200','8:1'],protectedInodes,ancestors),true,'A descendant of an aliased sections mount is protected');
 assert.equal(mountOverlapsData('8:999',['8:999','8:2','8:1'],protectedInodes,ancestors),false,'An unrelated sibling sharing a host parent is permitted');
});
test('root configuration permits only explicit private paths and a safe exact expected image',()=>{
 const c={format:'FIBERNETLB-POWER-RECOVERY-CONFIG-1',privateDirectory:'/srv/fictional/private',dataDirectory:'/srv/fictional/private/data',activeRecord:'/srv/fictional/private/active.json',stateFile:'/srv/fictional/private/attestation.json',jobsDirectory:'/srv/fictional/private/recovery',containerName:'fictional-web',auditScript:'/opt/fictional/audit.cjs',dockerBinary:'/usr/bin/docker',serializationLock:'/srv/fictional/private/guard.lock'};
 assert.equal(validateConfig(c).containerName,'fictional-web');assert.equal(validateConfig({...c,expectedImage:'fibernetlb-web-ci:fixture'}).expectedImage,'fibernetlb-web-ci:fixture');
 for(const changed of [{...c,extra:true},{...c,stateFile:'/tmp/state'},{...c,jobsDirectory:c.dataDirectory+'/jobs'},{...c,dockerBinary:'/tmp/docker'},{...c,containerName:'name;touch-file'},{...c,expectedImage:'x;touch-file'},{...c,dataDirectory:'/srv/fictional/private/../elsewhere'}])assert.throws(()=>validateConfig(changed),error=>error.code==='INVALID_CONFIG');
});
const sqlPromise=initSql({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});
test('copied-data pending checks ignore exact transition history, not future event journals or current intents',async()=>{
 const SQL=await sqlPromise,db=new SQL.Database();try{
  db.run("CREATE TABLE internet_renewal_events(state TEXT);INSERT INTO internet_renewal_events VALUES('checking'),('processing');CREATE TABLE internet_plan_events(state TEXT);INSERT INTO internet_plan_events VALUES('processing');CREATE TABLE portal_operation_events(state TEXT);INSERT INTO portal_operation_events VALUES('checking');");
  db.run("CREATE TABLE staff_role_reconciliations(status TEXT);INSERT INTO staff_role_reconciliations VALUES('restricted'),('review-required');");
  assert.equal(Audit.pendingCounts(db).pendingFinancialActions,0);
  db.run("CREATE TABLE future_operation_events(state TEXT);INSERT INTO future_operation_events VALUES('checking');");assert.equal(Audit.pendingCounts(db).pendingFinancialActions,1,'Unknown future journal names do not get a broad events exemption');
  db.run("CREATE TABLE admin_warehouse_intents(state TEXT);INSERT INTO admin_warehouse_intents VALUES('prepared'),('completed');");assert.equal(Audit.pendingCounts(db).pendingFinancialActions,2);
 }finally{db.close();}
});
test('current journal state takes precedence over a movement phase and pending requests are not double counted',async()=>{
 const SQL=await sqlPromise,db=new SQL.Database();try{db.run("CREATE TABLE reseller_money_journal(state TEXT,phase TEXT,recorded_at TEXT);INSERT INTO reseller_money_journal VALUES('held','reserve','2026-11-08T10:00:00');");const result=Audit.pendingCounts(db);assert.equal(result.financePendingActions,1);assert.equal(result.pendingFinancialActions,1);db.run("UPDATE reseller_money_journal SET state='released'");assert.equal(Audit.pendingCounts(db).pendingFinancialActions,0);}finally{db.close();}
});
function scheduler(state='ready'){
 const value={version:1,firstMonth:'2026-11',completedThrough:'',month:'',state,createdAt:'2026-11-01T10:00:00',lastAttemptAt:'',lastError:''};return JSON.stringify({state:value,sha256:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')});
}
test('scheduler recovery accepts verified ready/completed journals and rejects active or damaged month closing',()=>{
 for(const state of ['ready','completed'])assert.equal(Audit.schedulerState(scheduler(state)),state);
 for(const state of ['running','waiting'])assert.throws(()=>Audit.schedulerState(scheduler(state)),error=>error.code==='AUDIT_PENDING_MONTH_CLOSE');
 const broken=JSON.parse(scheduler());broken.sha256='0'.repeat(64);assert.throws(()=>Audit.schedulerState(JSON.stringify(broken)),error=>error.code==='AUDIT_INVALID_SCHEDULER');
});
function temporary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-power-fixture-'));t.after(()=>{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('fibernetlb-power-fixture-'));fs.rmSync(resolved,{recursive:true,force:true});});return directory;}
test('genuine copied-data audit checks every database and leaves rows, custody and bytes unchanged',async t=>{
 const {createBackend}=require('../app/core.cjs'),directory=temporary(t),source=path.join(directory,'source'),copy=path.join(directory,'copy');
 const core=await createBackend({dataDirectory:source,initialize:true,automaticMonthClose:false});try{await core.createOwner({username:'fictional.power.owner',fullName:'Fictional Power Owner',password:'Fictional-power-only-123'});}finally{await core.close();}
 fs.mkdirSync(path.join(copy,'sections'),{recursive:true});for(const name of DATABASES)fs.copyFileSync(path.join(source,name),path.join(copy,name));fs.writeFileSync(path.join(copy,'automatic-month-closing.json'),scheduler());
 const before=DATABASES.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(copy,name))).digest('hex'));
 const report=await Audit.auditCopiedData(copy,{copiedData:true});assert.equal(report.databases,7);assert.equal(report.pendingFinancialActions,0);assert.equal(report.integrityPassed,true);assert.equal(report.readOnly,true);assert.ok(report.files.every(row=>row.tables.users.rows===1));
 assert.deepEqual(DATABASES.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(copy,name))).digest('hex')),before);
 fs.writeFileSync(path.join(copy,'sections/fiber-users.sqlite.pending'),'fictional interrupted save');await assert.rejects(Audit.auditCopiedData(copy,{copiedData:true}),error=>error.code==='AUDIT_PENDING_FILE_REQUIRES_REVIEW');fs.unlinkSync(path.join(copy,'sections/fiber-users.sqlite.pending'));
 fs.writeFileSync(path.join(copy,DATABASES[2]),'fictional corrupt database');await assert.rejects(Audit.auditCopiedData(copy,{copiedData:true}));
 assert.equal(fs.existsSync(path.join(copy,'.fibernetlb-web.lock')),false,'The auditor never creates a writer marker');
});
