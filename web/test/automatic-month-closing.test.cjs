'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Auto=require('../app/automatic-month-closing.cjs');
function temporary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-auto-month-fictional-'));t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-auto-month-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});return directory;}
test('automatic monthly due time follows Beirut midnight, calendar lengths, leap years and DST',()=>{
 for(const [utc,local,due]of [
  ['2026-11-30T21:58:59Z','2026-11-30T23:58:59','2026-10'],
  ['2026-11-30T21:59:00Z','2026-11-30T23:59:00','2026-11'],
  ['2026-12-01T00:10:00Z','2026-12-01T02:10:00','2026-11'],
  ['2026-03-31T20:58:59Z','2026-03-31T23:58:59','2026-02'],
  ['2026-03-31T20:59:00Z','2026-03-31T23:59:00','2026-03'],
  ['2026-10-31T21:59:00Z','2026-10-31T23:59:00','2026-10'],
  ['2028-02-28T21:59:00Z','2028-02-28T23:59:00','2028-01'],
  ['2028-02-29T21:59:00Z','2028-02-29T23:59:00','2028-02'],
  ['2027-02-28T21:59:00Z','2027-02-28T23:59:00','2027-02']
 ]){assert.equal(Auto.localTime(utc),local);assert.equal(Auto.dueMonth(utc),due);assert.equal(Auto.mayCloseCurrent(due,local),due===local.slice(0,7));}
 assert.equal(Auto.nextMonth('2026-12'),'2027-01');assert.equal(Auto.nextMonth('2027-01',-1),'2026-12');assert.throws(()=>Auto.localTime('invalid'),/clock/);
});
test('genuine encrypted backups restore the first-enabled schedule while older seven-database archives remain supported',async t=>{
 const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),{openBackup,sealBackup}=require('../app/backup-archive.cjs'),{extractVerifiedBackup}=require('../tools/verify-backup.cjs');
 const directory=temporary(t),secrets=createSecretStorage(crypto.randomBytes(32)),password='Fictional-backup-owner-123',passphrase='Fictional-journal-recovery-123';let core;
 t.after(async()=>{await core?.close();secrets.destroy();});
 core=await createBackend({dataDirectory:directory,initialize:true,secrets,monthCloseClock:()=>new Date('2026-11-02T12:00:00Z')});await core.createOwner({username:'backup.owner',fullName:'Fictional Backup Owner',password});const login=await core.request({channel:'auth:login',args:[{username:'backup.owner',password}]}),token=login.data.sessionToken;
 const configured=await core.request({channel:'backups:save',token,args:[{enabled:false,time:'23:00',passphrase,ftp:{enabled:false},email:{enabled:false}}]});assert.equal(configured.status,200);const saved=await core.request({channel:'backups:run',token});assert.equal(saved.status,200);const job=saved.data.history[0],archiveFile=path.join(directory,'scheduled-backups',job.filename),archive=await openBackup(fs.readFileSync(archiveFile),passphrase),journal=archive.entries.find(row=>row.name==='automatic-month-closing.json');assert(journal);assert.equal(JSON.parse(journal.data).state.firstMonth,'2026-11');assert.equal(archive.entries.filter(row=>row.name.endsWith('.sqlite')).length,7);await core.close();
 const restored=path.join(directory,'restored-with-schedule');await extractVerifiedBackup({archive:archiveFile,destination:restored,passphrase});core=await createBackend({dataDirectory:restored,secrets,monthCloseClock:()=>new Date('2026-12-02T12:00:00Z')});const result=await core.tickAutomaticMonthClose();assert.equal(result.completedThrough,'2026-11');assert.equal(result.firstMonth,'2026-11');await core.close();
 const legacyFile=path.join(directory,'fictional-old-format.fnbak');fs.writeFileSync(legacyFile,await sealBackup(archive.entries.filter(row=>row.name!=='automatic-month-closing.json'),passphrase));const legacy=path.join(directory,'restored-legacy-seven');await extractVerifiedBackup({archive:legacyFile,destination:legacy,passphrase});core=await createBackend({dataDirectory:legacy,secrets,monthCloseClock:()=>new Date('2026-12-02T12:00:00Z')});const idle=await core.tickAutomaticMonthClose();assert.equal(idle.firstMonth,'2026-12');assert.equal(idle.completedThrough,'','A legacy archive never creates retrospective automatic closes without a saved schedule.');await core.close();
});
test('first enabling month is persisted and duplicate ticks/restarts do not repeat completed jobs',async t=>{
 const directory=temporary(t);let at=new Date('2026-11-02T12:00:00Z'),calls=0,release;
 const execute=async plan=>{calls++;assert.equal(plan.month,'2026-11');assert(plan.workspaces.every(row=>row.requestId===Auto.requestId(plan.month,row.workspaceId)));await new Promise(resolve=>{release=resolve;});};
 let scheduler=new Auto.AutomaticMonthClosing({directory,now:()=>at,workspaces:['main','fiber-users'],execute});assert.equal(scheduler.status().firstMonth,'2026-11');await scheduler.tick();assert.equal(calls,0,'No prior month is auto-closed on installation.');
 at=new Date('2026-11-30T21:59:00Z');const first=scheduler.tick(),repeat=scheduler.tick();assert.equal(first,repeat);assert.equal(calls,1);release();assert.equal((await first).state,'completed');await scheduler.tick();assert.equal(calls,1);
 scheduler=new Auto.AutomaticMonthClosing({directory,now:()=>at,workspaces:['main','fiber-users'],execute});await scheduler.tick();assert.equal(calls,1);assert.equal(scheduler.status().completedThrough,'2026-11');
 const file=path.join(directory,'automatic-month-closing.json');if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
});
test('partial business interruption retries stable child IDs and catches up missed months in order',async t=>{
 const directory=temporary(t);let at=new Date('2026-11-02T12:00:00Z'),failure=true;const durable=new Map(),calls=[];
 const execute=async({month,workspaces})=>{for(const row of workspaces){calls.push([month,row.workspaceId,row.requestId]);if(failure&&row.workspaceId==='fiber-users')throw Error('Fictional pending financial request');durable.set(month+':'+row.workspaceId,row.requestId);}};
 let scheduler=new Auto.AutomaticMonthClosing({directory,now:()=>at,workspaces:['main','fiber-users'],execute});at=new Date('2026-11-30T21:59:00Z');assert.equal((await scheduler.tick()).state,'waiting');assert.equal(durable.size,1);assert.equal(scheduler.status().completedThrough,'');
 failure=false;at=new Date('2027-02-03T12:00:00Z');scheduler=new Auto.AutomaticMonthClosing({directory,now:()=>at,workspaces:['main','fiber-users'],execute});await scheduler.tick();assert.equal(scheduler.status().completedThrough,'2027-01');assert.equal(durable.size,6);assert.equal(calls[0][2],calls[2][2]);assert.deepEqual([...new Set(calls.map(row=>row[0]))],['2026-11','2026-12','2027-01']);
});
test('corrupt scheduler journal fails closed instead of resetting the first enabled month',t=>{
 const directory=temporary(t),options={directory,now:()=>new Date('2026-11-02T12:00:00Z'),workspaces:['main'],execute:async()=>{}};new Auto.AutomaticMonthClosing(options);const file=path.join(directory,'automatic-month-closing.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));saved.state.firstMonth='2026-10';fs.writeFileSync(file,JSON.stringify(saved));assert.throws(()=>new Auto.AutomaticMonthClosing(options),/could not be verified/);
});
test('an unresolved genuine provider journal blocks every automatic close until reconciled, then downtime catch-up succeeds',async t=>{
 const {createBackend}=require('../app/core.cjs'),F=require('../app/finance-ledger.cjs'),{WORKSPACES}=require('../app/workspaces.cjs');
 const directory=temporary(t);let at=new Date('2026-11-02T12:00:00Z'),core;const make=()=>createBackend({dataDirectory:directory,initialize:!fs.existsSync(path.join(directory,'isp-desk.sqlite')),providersEnabled:false,monthCloseClock:()=>at});t.after(async()=>{await core?.close();});
 core=await make();await core.createOwner({username:'pending.owner',fullName:'Fictional Pending Owner',password:'Fictional-pending-pass-123'});await core.close();const SQL=await require('sql.js')(),file=path.join(directory,'sections/mobile-ogero.sqlite');let db=new SQL.Database(fs.readFileSync(file));try{db.run('INSERT INTO portal_operations(request_id,kind,entity,fingerprint,input_json,quote_json,state,actor,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',['fictional-auto-pending','renew','fictional-subscriber','fictional-no-provider-call','{}','{}','unknown','Fictional Pending Owner','2026-11-30T22:00:00']);fs.writeFileSync(file,Buffer.from(db.export()));}finally{db.close();}
 at=new Date('2026-11-30T21:59:00Z');core=await make();const waiting=await core.tickAutomaticMonthClose();assert.equal(waiting.state,'waiting');assert.equal(waiting.completedThrough,'');await core.close();
 for(const section of WORKSPACES){const current=new SQL.Database(fs.readFileSync(path.join(directory,section.id==='main'?'isp-desk.sqlite':'sections/'+section.id+'.sqlite')));try{assert.equal(F.query(current,'SELECT * FROM finance_months').length,0,'All businesses preflight before the first close.');if(section.id==='mobile-ogero')assert.equal(F.query(current,"SELECT state FROM portal_operations WHERE request_id='fictional-auto-pending'")[0].state,'unknown');}finally{current.close();}}
 db=new SQL.Database(fs.readFileSync(file));try{db.run("UPDATE portal_operations SET state='failed',message='Fictional journal reconciled without contacting a provider' WHERE request_id='fictional-auto-pending'");fs.writeFileSync(file,Buffer.from(db.export()));}finally{db.close();}
 at=new Date('2026-12-01T08:00:00Z');core=await make();const recovered=await core.tickAutomaticMonthClose();assert.equal(recovered.state,'completed');assert.equal(recovered.completedThrough,'2026-11');await core.close();
});
test('genuine core drains an in-flight transfer, preserves auth, recovers a partial close, and carries all business custody without automatic Bank movements',async t=>{
 const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),F=require('../app/finance-ledger.cjs'),{WORKSPACES}=require('../app/workspaces.cjs');
 const directory=temporary(t),secrets=createSecretStorage(crypto.randomBytes(32)),password='Fictional-month-owner-123';let at=new Date('2026-11-30T21:58:00Z'),core;
 t.after(async()=>{await core?.close();secrets.destroy();});const make=()=>createBackend({dataDirectory:directory,initialize:!fs.existsSync(path.join(directory,'isp-desk.sqlite')),providersEnabled:false,secrets,monthCloseClock:()=>at});
 core=await make();await core.createOwner({username:'month.owner',fullName:'Fictional Monthly Owner',password});let login=await core.request({channel:'auth:login',args:[{username:'month.owner',password}]});assert.equal(login.status,200);let token=login.data.sessionToken;
 let status=await core.request({channel:'finance:autoMonthStatus',token});assert.equal(status.status,200);assert.equal(status.data.firstMonth,'2026-11');assert.equal(status.data.automaticBankDeposit,false);
 const manual=await core.request({channel:'finance:closeMonthPreview',token,args:[{workspaceId:'main',month:new Date().toISOString().slice(0,7),allocations:[]}]});assert.equal(manual.status,400);assert.match(manual.error,/current month stays open/);
 const forged=await core.request({channel:'finance:closeMonthPreview',token,args:[{workspaceId:'main',month:'2026-11',allocations:[],allowCurrentMonth:true,automaticMonthClosing:true}]});assert.equal(forged.status,400);assert.match(forged.error,/unsupported fields/);
 await core.close();const SQL=await require('sql.js')(),holdings=new Map();
 for(const [index,section]of WORKSPACES.entries()){
  const file=path.join(directory,section.id==='main'?'isp-desk.sqlite':'sections/'+section.id+'.sqlite'),db=new SQL.Database(fs.readFileSync(file));try{
   const actor=F.query(db,"SELECT * FROM users WHERE username='month.owner'")[0];assert(actor);
   if(section.id==='main')db.run("INSERT INTO whish_destinations VALUES('fictional-auto-wallet','Fictional schedule wallet','03000001',1,'2026-11-01T09:00:00')");
   const cash=100+index,whish=50+index;db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,note,created_at,user_id,user_name) VALUES(?,'synthetic_opening','test','Fictional automated-close custody','2026-11-01T12:00:00',?,?)",[cash,actor.id,actor.full_name]);db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['auto-opening-'+section.id,'fictional-auto-opening','fictional-auto-wallet',actor.account_key,whish*100,'2026-11-01T12:00:00']);
   if(section.id==='fiber-resellers')db.exec("CREATE TRIGGER synthetic_auto_close_interruption BEFORE INSERT ON finance_months BEGIN SELECT RAISE(ABORT,'Fictional closing interruption');END;");
   holdings.set(section.id,{cash,whish});fs.writeFileSync(file,Buffer.from(db.export()));
  }finally{db.close();}
 }
 core=await make();login=await core.request({channel:'auth:login',args:[{username:'month.owner',password}]});token=login.data.sessionToken;
 const source=await core.request({channel:'bank:sources',token,args:[{workspaceId:'main'}]}),base={workspaceId:'main',direction:'deposit',holderAccountKey:source.data.holders[0].accountKey,method:'cash',walletId:'',amount:1,note:'Fictional in-flight reviewed deposit'},preview=await core.request({channel:'bank:preview',token,args:[base]});assert.equal(preview.status,200);
 const transfer=core.request({channel:'bank:transfer',token,args:[{...base,requestId:crypto.randomUUID(),token:preview.data.token,confirmation:'TRANSFER BANK'}]});
 at=new Date('2026-11-30T21:59:00Z');const closing=core.tickAutomaticMonthClose(),blocked=await core.request({channel:'drawer:setBalance',token,args:[{amount:0}]});assert.equal(blocked.status,503);assert.match(blocked.error,/no new transaction was accepted/);
 const authDuring=await core.request({channel:'auth:status',token});assert.equal(authDuring.status,200);assert.equal(authDuring.data.user.username,'month.owner');const during=await core.request({channel:'finance:autoMonthStatus',token});assert.equal(during.status,200);assert.equal(during.data.state,'running');
 assert.equal((await transfer).status,200,'An already accepted Bank request completes before closing.');holdings.get('main').cash-=1;
 const interrupted=await closing;assert.equal(interrupted.state,'waiting');assert.equal(interrupted.completedThrough,'');await core.close();
 const beforeResume=new Map();for(const section of WORKSPACES){const file=path.join(directory,section.id==='main'?'isp-desk.sqlite':'sections/'+section.id+'.sqlite'),db=new SQL.Database(fs.readFileSync(file));try{const row=F.query(db,'SELECT * FROM finance_months')[0];if(row)beforeResume.set(section.id,row.archive_json);if(section.id==='fiber-resellers'){db.exec('DROP TRIGGER synthetic_auto_close_interruption');fs.writeFileSync(file,Buffer.from(db.export()));}}finally{db.close();}}
 assert.deepEqual([...beforeResume.keys()],['main','fiber-users']);core=await make();const finished=await core.tickAutomaticMonthClose();assert.equal(finished.state,'completed');assert.equal(finished.completedThrough,'2026-11');await core.close();
 const archiveHashes=new Map();
 for(const section of WORKSPACES){const file=path.join(directory,section.id==='main'?'isp-desk.sqlite':'sections/'+section.id+'.sqlite'),db=new SQL.Database(fs.readFileSync(file));try{
  const row=F.query(db,"SELECT * FROM finance_months WHERE month='2026-11'")[0];assert(row);assert.equal(row.closed_at,'2026-11-30T23:59:00');const archive=JSON.parse(row.archive_json),expected=holdings.get(section.id);assert.equal(archive.mode,'carry_forward');assert.equal(archive.all.closing.cash,expected.cash);assert.equal(archive.all.closing.wallets.find(value=>value.id==='fictional-auto-wallet').balance,expected.whish);assert.equal(F.drawerBalance(db),expected.cash);assert.equal(F.query(db,'SELECT * FROM bank_transfers').length,section.id==='main'?1:0,'Only the explicitly requested pre-close deposit exists.');assert.equal(F.query(db,'SELECT * FROM month_close_requests').length,1);if(beforeResume.has(section.id))assert.equal(row.archive_json,beforeResume.get(section.id),'An earlier completed business keeps its exact original archive.');archiveHashes.set(section.id,crypto.createHash('sha256').update(row.archive_json).digest('hex'));
 }finally{db.close();}}
 core=await make();await core.tickAutomaticMonthClose();await core.close();
 for(const section of WORKSPACES){const db=new SQL.Database(fs.readFileSync(path.join(directory,section.id==='main'?'isp-desk.sqlite':'sections/'+section.id+'.sqlite')));try{const rows=F.query(db,'SELECT * FROM finance_months');assert.equal(rows.length,1);assert.equal(crypto.createHash('sha256').update(rows[0].archive_json).digest('hex'),archiveHashes.get(section.id));assert.equal(F.query(db,'SELECT * FROM month_close_requests').length,1);}finally{db.close();}}
});
