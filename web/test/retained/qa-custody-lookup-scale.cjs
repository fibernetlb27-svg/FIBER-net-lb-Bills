'use strict';
// Fictional in-memory ledgers only. Timing is diagnostic; query plans, exact
// results and tamper rejection are the assertions, not a wall-clock threshold.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{performance}=require('node:perf_hooks');
const Finance=require('./finance-ledger.cjs'),Whish=require('./whish-destinations.cjs'),Bank=require('./bank-accounts.cjs'),Transfers=require('./admin-money-transfers.cjs'),q=Finance.query;
function legacy(file){
 let source=fs.readFileSync(path.join(__dirname,file),'utf8');
 if(file==='bank-accounts.cjs'){
  const current="const key=row.source_entry_id,sourceId=Number(key);if(typeof key!=='string'||!/^[1-9]\\d*$/.test(key)||!Number.isSafeInteger(sourceId)||String(sourceId)!==key)return fail();\n   const source=q(db,'SELECT * FROM cash_drawer_transactions WHERE id=?',[sourceId]);";
  assert(source.includes(current),'Review the exact Bank lookup-only comparison.');source=source.replace(current,"const source=q(db,'SELECT * FROM cash_drawer_transactions WHERE CAST(id AS TEXT)=?',[row.source_entry_id]);");
 }else{
  const current="const key=row.source_entry_id,sourceId=Number(key);if(typeof key!=='string'||!/^[1-9]\\d*$/.test(key)||!Number.isSafeInteger(sourceId)||String(sourceId)!==key)return fail();const source=q(db,'SELECT * FROM cash_drawer_transactions WHERE id=?',[sourceId]);";
  assert(source.includes(current),'Review the exact Admin transfer lookup-only comparison.');source=source.replace(current,"const source=q(db,'SELECT * FROM cash_drawer_transactions WHERE CAST(id AS TEXT)=?',[row.source_entry_id]);");
 }
 const filename=path.join(__dirname,'.qa-virtual-legacy-'+file),copy=new Module(filename,module);copy.filename=filename;copy.paths=Module._nodeModulePaths(__dirname);copy._compile(source,filename);return copy.exports;
}
(async()=>{
 const SQL=await require('sql.js')(),ids=['main','fiber-users','fiber-resellers'],entries=new Map(ids.map((id,index)=>[id,{id,db:new SQL.Database(),userId:index*10+1}]));
 for(const [id,entry]of entries){entry.db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT,full_name TEXT,role TEXT,active INTEGER);
 CREATE TABLE finance_months(month TEXT PRIMARY KEY);
 CREATE TABLE finance_events(id TEXT PRIMARY KEY,kind TEXT,created_at TEXT,effective_at TEXT,actor_key TEXT,from_key TEXT,to_key TEXT,amount_cents INTEGER,note TEXT,input_json TEXT,result_json TEXT);
 CREATE TABLE finance_wallet_entries(id TEXT PRIMARY KEY,event_id TEXT,wallet_id TEXT,account_key TEXT,amount_cents INTEGER,effective_at TEXT);
 CREATE TABLE cash_drawer_transactions(id INTEGER PRIMARY KEY,amount REAL,transaction_type TEXT,reference_type TEXT,reference_id INTEGER,note TEXT,created_at TEXT,user_id INTEGER,user_name TEXT);
 CREATE VIEW active_cash_drawer_transactions AS SELECT * FROM cash_drawer_transactions;
 CREATE TABLE payment_destinations(kind TEXT,record_key TEXT,snapshot_json TEXT);
 CREATE TABLE debt_payments(id INTEGER,kind TEXT,record_id INTEGER,payment_method TEXT,user_id INTEGER,received_at TEXT);
 CREATE TABLE sales(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,payment_method TEXT);CREATE VIEW active_sales AS SELECT * FROM sales;
 CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);CREATE VIEW active_fibernetlb_bills AS SELECT * FROM fibernetlb_bills;
 CREATE TABLE telecom_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);CREATE VIEW active_telecom_payments AS SELECT * FROM telecom_payments;
 CREATE TABLE installation_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);`);
  for(const [offset,key,role,name]of [[0,'main:1','admin','Fictional Admin'],[1,'main:2','cashier','Fictional Cashier']]){entry.db.run('INSERT INTO users VALUES(?,?,?,?,1)',[entry.userId+offset,key,name,role]);entry.db.run("INSERT INTO cash_drawer_transactions VALUES(NULL,2000,'synthetic_opening','test',NULL,'Fictional opening','2026-10-01T09:00:00',?,?)",[entry.userId+offset,name]);entry.db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['opening-'+key,'synthetic_opening','wallet-a',key,50000,'2026-10-01T09:00:00']);}
  Whish.initializeWhish(entry.db);Bank.initialize(entry.db);Transfers.initialize(entry.db,{main:id==='main'});
 }
 const db=id=>entries.get(id).db;Whish.saveDestination(db('main'),{label:'Fictional scale wallet',number:'03000001',active:true});db('main').run("UPDATE whish_destinations SET id='wallet-a'");
 const context={entries,authorize:(id='main')=>q(db(id),"SELECT * FROM users WHERE account_key='main:1'")[0],holders:id=>q(db(id),'SELECT * FROM users'),now:()=> '2026-10-29T12:00:00',saveEntry:async()=>{}};
 const bank=new Bank.BankAccounts(context),transfers=new Transfers.AdminMoneyTransfers(context);
 for(let n=0;n<100;n++){const value={fromWorkspaceId:'fiber-resellers',fromAccountKey:'main:1',fromWalletId:'',toWorkspaceId:'fiber-users',toAccountKey:'main:2',toWalletId:'',method:'cash',amount:1,note:'Fictional scale transfer'};await transfers.transfer({...value,requestId:'qa-scale-transfer-'+n,token:transfers.preview(value).token,confirmation:'TRANSFER MONEY'});}
 for(let n=0;n<25;n++){const value={workspaceId:'fiber-users',holderAccountKey:'main:1',method:'cash',walletId:'',direction:'deposit',amount:1,note:'Fictional scale savings'};await bank.transfer({...value,requestId:'qa-scale-bank-'+n,token:bank.preview(value).token,confirmation:'TRANSFER BANK'});}
 const oldBank=legacy('bank-accounts.cjs'),oldTransfers=legacy('admin-money-transfers.cjs');
 const project=(banks,moves,selected=entries)=>ids.map(workspaceId=>({bank:banks.custodySummary({db:selected.get(workspaceId).db,workspaceId,through:'2026-10-29'}),transfer:moves.custodySummary({entries:selected,workspaceId,through:'2026-10-29'})}));
 const baseline=project(Bank,Transfers),smallStart=performance.now();assert.deepEqual(project(oldBank,oldTransfers),baseline);const smallLegacyMs=performance.now()-smallStart;
 for(const id of ['fiber-users','fiber-resellers']){const entry=db(id);entry.exec('BEGIN');const insert=entry.prepare("INSERT INTO cash_drawer_transactions VALUES(NULL,0,'synthetic_noise','test',NULL,'Fictional scale noise','2026-10-02T09:00:00',?,'Fictional Admin')");try{for(let n=0;n<100000;n++)insert.run([entries.get(id).userId]);entry.exec('COMMIT');}finally{insert.free();}}
 const planNew=q(db('fiber-users'),'EXPLAIN QUERY PLAN SELECT * FROM cash_drawer_transactions WHERE id=?',[3]),planOld=q(db('fiber-users'),'EXPLAIN QUERY PLAN SELECT * FROM cash_drawer_transactions WHERE CAST(id AS TEXT)=?',['3']);
 assert(planNew.some(row=>/SEARCH .*INTEGER PRIMARY KEY/i.test(row.detail)));assert(planOld.some(row=>/SCAN cash_drawer_transactions/i.test(row.detail)));
 // Observe the actual production verification SQL, not just a hand-written plan.
 const observed=[];for(const entry of entries.values()){const prepare=entry.db.prepare;entry.db.prepare=function(sql,...args){if(/SELECT \* FROM cash_drawer_transactions WHERE/.test(sql))observed.push(sql);return prepare.call(this,sql,...args);};}
 const before=[...entries].map(([id,entry])=>[id,Buffer.from(entry.db.export()).toString('base64')]),fastStart=performance.now(),large=project(Bank,Transfers),optimizedMs=performance.now()-fastStart;assert.deepEqual(large,baseline);assert(observed.length>0);assert(observed.every(sql=>sql==='SELECT * FROM cash_drawer_transactions WHERE id=?'),'Production proof lookups must use the indexed numeric primary key.');
 const oldStart=performance.now();assert.deepEqual(project(oldBank,oldTransfers),baseline);const legacyMs=performance.now()-oldStart;assert.deepEqual([...entries].map(([id,entry])=>[id,Buffer.from(entry.db.export()).toString('base64')]),before,'Both verification paths are read-only.');
 const stored=new Map([...entries].map(([id,entry])=>[id,entry.db.export()])),clone=()=>new Map([...stored].map(([id,bytes])=>[id,{id,db:new SQL.Database(bytes)}]));let rejected=0;
 const oneProof=(banks,moves,selected,kind)=>kind==='bank'?banks.custodySummary({db:selected.get('fiber-users').db,workspaceId:'fiber-users',through:'2026-10-29'}):moves.custodySummary({entries:selected,workspaceId:'fiber-resellers',through:'2026-10-29'});
 function rejectBoth(selected,kind){assert.throws(()=>oneProof(Bank,Transfers,selected,kind),/could not be verified/);assert.throws(()=>oneProof(oldBank,oldTransfers,selected,kind),/could not be verified/);rejected++;for(const entry of selected.values())entry.db.close();}
 for(const kind of ['bank','transfer']){
  const reference=kind==='bank'?q(db('fiber-users'),"SELECT source_entry_id FROM bank_transfers WHERE request_id='qa-scale-bank-0'")[0].source_entry_id:q(db('fiber-resellers'),"SELECT source_entry_id FROM admin_money_transfer_legs WHERE request_id='qa-scale-transfer-0' AND leg='out'")[0].source_entry_id;
  for(const value of ['0'+reference,reference+'.0','+'+reference,' '+reference,reference+' ',reference+'e0','0','-1','9007199254740992','NaN','Infinity','']){
   const copy=clone(),target=copy.get(kind==='bank'?'fiber-users':'fiber-resellers').db;
   if(kind==='bank'){target.exec('DROP TRIGGER bank_transfers_update');target.run("UPDATE bank_transfers SET source_entry_id=? WHERE request_id='qa-scale-bank-0'",[value]);}
   else{target.exec('DROP TRIGGER admin_money_transfer_legs_update');target.run("UPDATE admin_money_transfer_legs SET source_entry_id=? WHERE request_id='qa-scale-transfer-0' AND leg='out'",[value]);}
   rejectBoth(copy,kind);
  }
  for(const [field,value]of [['amount',-.99],['user_id',999],['user_name','Wrong fictional holder'],['created_at','2026-10-28T12:00:00'],['transaction_type','wrong_type'],['reference_type','wrong_reference'],['reference_id',1],['note','Changed original proof']]){
   const copy=clone();oneProof(Bank,Transfers,copy,kind);const target=copy.get(kind==='bank'?'fiber-users':'fiber-resellers').db;target.run('UPDATE cash_drawer_transactions SET '+field+'=? WHERE id=?',[value,Number(reference)]);rejectBoth(copy,kind);
  }
 }
 assert.equal(rejected,40);console.log(JSON.stringify({passed:true,syntheticOnly:true,completedAdminTransfers:100,bankTransfers:25,noiseCashRows:200000,businessProjections:3,primaryKeyLookup:true,exactLegacyResults:true,tamperCasesRejected:rejected,noCrossRequestCache:true,readOnly:true,timingDiagnosticOnly:{smallLegacyMs:Math.round(smallLegacyMs),largeLegacyMs:Math.round(legacyMs),largeOptimizedMs:Math.round(optimizedMs)},queryPlans:{before:planOld.map(row=>row.detail),after:planNew.map(row=>row.detail)}}));
 for(const entry of entries.values())entry.db.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
