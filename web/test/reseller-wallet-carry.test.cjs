'use strict';
// Fictional in-memory custody only: no files, provider calls or real payments.
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../app/finance-ledger.cjs'),A=require('../app/reseller-accounting.cjs'),C=require('../app/reseller-collections.cjs'),Bank=require('../app/bank-accounts.cjs'),Month=require('../app/month-closing.cjs');
const q=F.query,wallet={id:'fictional-wallet',label:'Fictional Whish',number:'03000000',active:true};
const sql=require('sql.js')();
async function fixture(){
 const SQL=await sql,entries=new Map(),clock={now:'2026-10-14T10:00:00'};
 for(const id of ['main','fiber-users','fiber-resellers']){
  const db=new SQL.Database();db.exec(`
   CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,full_name TEXT,account_key TEXT,role TEXT,active INTEGER);
   INSERT INTO users VALUES(1,'owner','Fictional Admin','admin-key','admin',1),(2,'operator','Fictional Operator','operator-key','cashier',1),(3,'custodian','Fictional Custodian','custodian-key','cashier',1);
   CREATE TABLE sales(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,subtotal REAL,cost_total REAL,reset_id TEXT,payment_method TEXT,customer_name TEXT,customer_account TEXT);
   CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,amount REAL,bundle_cost REAL,reset_id TEXT,payment_method TEXT,customer_name TEXT,customer_account TEXT);
   CREATE TABLE telecom_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,amount REAL,cost REAL,reset_id TEXT,payment_method TEXT,customer_name TEXT,phone TEXT);
   CREATE TABLE installation_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,amount REAL,payment_method TEXT,customer_account TEXT);
   CREATE TABLE debt_payments(id TEXT PRIMARY KEY,user_id INTEGER,received_at TEXT,payment_method TEXT,kind TEXT,record_id INTEGER);
   CREATE TABLE expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,expense_date TEXT,category TEXT,description TEXT,amount REAL,user_id INTEGER,source_type TEXT,source_id TEXT);
   CREATE TABLE purchase_receipts(id INTEGER PRIMARY KEY,purchase_date TEXT);
   CREATE TABLE cash_drawer_transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,amount REAL,transaction_type TEXT,reference_type TEXT,reference_id INTEGER,note TEXT,created_at TEXT,user_id INTEGER,user_name TEXT);
   CREATE VIEW active_cash_drawer_transactions AS SELECT * FROM cash_drawer_transactions;
   CREATE VIEW active_sales AS SELECT * FROM sales WHERE reset_id IS NULL;
   CREATE VIEW active_fibernetlb_bills AS SELECT * FROM fibernetlb_bills WHERE reset_id IS NULL;
   CREATE VIEW active_telecom_payments AS SELECT * FROM telecom_payments WHERE reset_id IS NULL;
   CREATE TABLE payment_destinations(kind TEXT,record_key TEXT,snapshot_json TEXT);
   CREATE TABLE resellers(id INTEGER PRIMARY KEY,username TEXT,full_name TEXT,active INTEGER);
   INSERT INTO resellers VALUES(1,'fibernetlb2','Fictional representative',1);
  `);
  F.initializeFinance(db);A.initialize(db);C.initialize(db);Bank.initialize(db);Month.initialize(db);entries.set(id,{id,db});
 }
 const user=(section,key)=>q(entries.get(section).db,'SELECT * FROM users WHERE account_key=?',[key])[0];
 const users=entries.get('fiber-users').db,resellers=entries.get('fiber-resellers').db;
 users.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-existing-wallet','fictional-receipt',wallet.id,'operator-key',10000,'2026-10-01T09:00:00']);
 function fund(version){
  const id='fictional-fund-'+version,transfer=version===6,input={accountingVersion:version,username:'fibernetlb2',amount:80,grossAmount:80,walletAmount:80,paymentMethod:'Whish Money',feeTiming:transfer?'existing_users_fee':'profit_only',fee:0,walletFee:0,profitFee:0,nativeDeduction:0,reference:'Fictional existing wallet funding',sourceKey:'operator-key',custodianKey:transfer?'custodian-key':'operator-key',custodySection:transfer?'fiber-resellers':'fiber-users',sourceWallet:wallet.id,targetWallet:wallet.id,sourceWalletNumber:wallet.number,targetWalletNumber:wallet.number,...transfer?{custodyOrigin:'users_wallet_transfer',sourceSection:'fiber-users',transferAt:clock.now}:{}};
  A.recordFund(resellers,{request_id:id,state:'confirmed',kind:'topup',input_json:JSON.stringify(input),result_json:'{}'},user('fiber-resellers','operator-key'),clock.now);
  if(transfer){A.movement(users,id,'reserve',user('fiber-users','operator-key'),-8000,'Whish Money',wallet.id,clock.now,input.reference,'complete');A.movement(resellers,id,'credit',user('fiber-resellers','custodian-key'),8000,'Whish Money',wallet.id,clock.now,input.reference,'complete');}
  return id;
 }
 async function close(section,month='2026-10',allocations=[]){
  const service=new Month.MonthClosing({entries,now:()=>clock.now,destinations:()=>[wallet],authorize:()=>user('main','admin-key'),holders:id=>q(entries.get(id).db,'SELECT * FROM users'),saveEntry:()=>{},backup:async()=>'fictional-private-backup',snapshot:()=>({all:{report:{revenue:0,netProfit:0},daily:[]},employees:Object.fromEntries(q(entries.get(section).db,'SELECT account_key FROM users').map(row=>[row.account_key,{report:{revenue:0,netProfit:0},daily:[]}]))})});
  const base={workspaceId:section,month,allocations},review=service.preview(base);return service.close({...base,requestId:'fictional-close-'+section+'-'+month,token:review.token,confirmation:'CLOSE '+month});
 }
 function legacyClose(section){entries.get(section).db.run('INSERT INTO finance_months VALUES(?,?,?,?,?,?)',['2026-10',clock.now,'admin-key','Fictional Admin','fictional-backup',JSON.stringify({month:'2026-10',all:{report:{},daily:[],closing:{cash:0,wallets:[]}},employees:{}})]);}
 const bytes=()=>[...entries].map(([id,e])=>[id,Buffer.from(e.db.export())]);
 const dispose=()=>{for(const e of entries.values())e.db.close();};
 return {entries,clock,user,users,resellers,fund,close,legacyClose,bytes,dispose};
}
test('uncollected Users Whish claims stay protected after verified carried closes, without rewriting any ledger',async t=>{
 const f=await fixture();t.after(f.dispose);f.fund(5);assert.equal(C.usersWalletEncumbrance(f.resellers,f.users,'operator-key',wallet.id),8000);
 f.clock.now='2026-11-02T10:00:00';await f.close('fiber-users');const before=f.bytes();
 assert.equal(C.usersWalletEncumbrance(f.resellers,f.users,'operator-key',wallet.id),8000);assert.deepEqual(f.bytes(),before);
 f.clock.now='2026-12-02T10:00:00';await f.close('fiber-users','2026-11');assert.equal(C.usersWalletEncumbrance(f.resellers,f.users,'operator-key',wallet.id),8000);
});
test('legacy zero-opening claims cannot be assigned to a fresh Users wallet, and corrupt/gapped carry proofs fail closed',async t=>{
 await t.test('legacy opening',async()=>{const f=await fixture();try{f.fund(5);f.clock.now='2026-11-02T10:00:00';f.legacyClose('fiber-users');assert.equal(C.usersWalletEncumbrance(f.resellers,f.users,'operator-key',wallet.id),0);}finally{f.dispose();}});
 for(const kind of ['corrupt','gap'])await t.test(kind,async()=>{const f=await fixture();try{f.fund(5);f.clock.now=kind==='gap'?'2026-12-02T10:00:00':'2026-11-02T10:00:00';await f.close('fiber-users',kind==='gap'?'2026-11':'2026-10');if(kind==='corrupt')f.users.run("UPDATE finance_months SET archive_json=replace(archive_json,'carry_forward','broken_carry')");assert.throws(()=>C.usersWalletEncumbrance(f.resellers,f.users,'operator-key',wallet.id),/verified|carry-forward/);}finally{f.dispose();}});
});
test('native transferred Whish funding retains its exact refundable custody across carried month closing',async t=>{
 const f=await fixture();t.after(f.dispose);const id=f.fund(6);f.clock.now='2026-11-02T10:00:00';await f.close('fiber-users');await f.close('fiber-resellers');
 const before=f.bytes(),result=C.verifyUsersTransferCustody(f.resellers,f.users,id,{through:f.clock.now,destinations:[wallet]});assert.equal(result.fund.request_id,id);assert.deepEqual(f.bytes(),before);
 assert.throws(()=>C.verifyUsersTransferCustody(f.resellers,f.users,id,{through:f.clock.now,destinations:[{...wallet,number:'03999999'}]}),/original Whish wallet|closed-month/);
});
test('closed native funding cannot consume unrelated new wallet money after erosion or a legacy reset',async t=>{
 await t.test('spent then refilled',async()=>{const f=await fixture();try{const id=f.fund(6);f.clock.now='2026-11-02T10:00:00';await f.close('fiber-resellers');f.resellers.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-spend','fictional-spending',wallet.id,'custodian-key',-8000,'2026-11-02T11:00:00']);f.resellers.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-unrelated-income','fictional-new-income',wallet.id,'custodian-key',8000,'2026-11-02T12:00:00']);f.clock.now='2026-11-02T13:00:00';const before=f.bytes();assert.throws(()=>C.verifyUsersTransferCustody(f.resellers,f.users,id,{through:f.clock.now,destinations:[wallet]}),/closed-month funding custody/);assert.deepEqual(f.bytes(),before);}finally{f.dispose();}});
 await t.test('legacy reset',async()=>{const f=await fixture();try{const id=f.fund(6);f.clock.now='2026-11-02T10:00:00';f.legacyClose('fiber-resellers');assert.throws(()=>C.verifyUsersTransferCustody(f.resellers,f.users,id,{through:f.clock.now,destinations:[wallet]}),/opened at zero|closed-month/);}finally{f.dispose();}});
});
