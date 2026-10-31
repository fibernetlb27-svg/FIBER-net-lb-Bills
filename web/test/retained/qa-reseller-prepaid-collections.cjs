'use strict';
// Synthetic bookkeeping fixtures only. No portal calls, customer data or live DBs.
const assert=require('node:assert/strict'),Finance=require('./finance-ledger.cjs'),A=require('./reseller-accounting.cjs'),C=require('./reseller-collections.cjs'),q=Finance.query;
const now='2026-10-14T12:00:00',wallet={id:'synthetic-wallet',label:'Synthetic Whish',number:'03123456',active:1};
(async()=>{
 const SQL=await require('sql.js')();
 function database(section){const db=new SQL.Database();db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,full_name TEXT,account_key TEXT,role TEXT,active INTEGER);
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
 INSERT INTO resellers VALUES(1,'fibernetlb2','Synthetic representative',1),(2,'other','Synthetic other reseller',1);`);
  const id=section==='fiber-users'?7:2;db.run('INSERT INTO users VALUES(?,?,?,?,?,?)',[1,'owner','Synthetic Admin','admin-key','admin',1]);db.run('INSERT INTO users VALUES(?,?,?,?,?,?)',[id,'cashier','Synthetic Cashier','cashier-key','cashier',1]);db.run('INSERT INTO users VALUES(?,?,?,?,?,?)',[3,'support','Synthetic Support','support-key','support',1]);Finance.initializeFinance(db);A.initialize(db);C.initialize(db);db.run('INSERT INTO cash_drawer_transactions(amount,transaction_type,created_at,user_id,user_name) VALUES(?,?,?,?,?)',[500,'synthetic',now,id,'Synthetic Cashier']);db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['synthetic-opening','synthetic',wallet.id,'cashier-key',50000,now]);return db;
 }
 function fixture(){const entries=new Map(['fiber-users','fiber-resellers'].map(id=>[id,{id,db:database(id)}])),saved=new Map([...entries].map(([id,e])=>[id,Buffer.from(e.db.export())]));let actorKey='admin-key',hook=null;
  const context={entries,now:()=>now,destinations:()=>[wallet],member:(key,section)=>{const found=q(entries.get(section).db,'SELECT * FROM users WHERE account_key=?',[key])[0];if(!found)throw Error('No section access');return found;},cashiers:section=>q(entries.get(section).db,'SELECT account_key AS accountKey FROM users'),authorizeAdmin:()=>q(entries.get('fiber-resellers').db,'SELECT * FROM users WHERE account_key=?',[actorKey])[0],receiver:()=>q(entries.get('fiber-resellers').db,"SELECT * FROM users WHERE account_key='admin-key'")[0],save:entry=>{if(hook)hook(entry,'before');saved.set(entry.id,Buffer.from(entry.db.export()));if(hook)hook(entry,'after');}};
  const service=()=>new C.ResellerCollections(context),restart=()=>{for(const [id,bytes]of saved)entries.get(id).db=new SQL.Database(bytes);};return {entries,saved,context,service,restart,setActor:key=>{actorKey=key;},setHook:value=>{hook=value;}};
 }
 function fund(f,id,username,amount,options={}){const input={accountingVersion:3,paymentMethod:options.paymentMethod||'Cash',applyWhishFee:false,feePolicy:'none',grossAmount:Math.abs(amount),fee:0,...options};f.entries.get('fiber-resellers').db.run('INSERT INTO reseller_funds VALUES(?,?,?,?,?,?,?,?,?,?)',[id,'RF-'+id,username,Math.round(amount*100),input.paymentMethod,'cashier-key','Synthetic Cashier',now,JSON.stringify(input),'{}']);}
 const input=(id,resellerId,amount,method='Cash')=>({requestId:id,resellerId,sourceKey:'cashier-key',sourceWallet:method==='Whish Money'?wallet.id:'',paymentMethod:method,amount,note:'Synthetic local bill collection'});
 const approved=(service,value)=>({...value,token:service.prepare(value).token,confirm:true,confirmation:'PAY BILL'});
 const collect=async(service,value)=>service.apply(approved(service,value));
 const dbOf=f=>f.entries.get('fiber-resellers').db,userDb=f=>f.entries.get('fiber-users').db,cash=(db,key)=>Finance.drawerBalance(db,q(db,'SELECT id FROM users WHERE account_key=?',[key])[0].id),balance=db=>Finance.walletBalances(db,[wallet],'cashier-key')[0].balance;

 // New funding stores gross/Native credit separately from available wallet money.
 for(const checked of [true,false]){
  const f=fixture(),s=f.service();fund(f,'prepaid-'+checked,'other',checked?99:100,{accountingVersion:4,paymentMethod:'Whish Money',grossAmount:100,walletAmount:99,walletFee:1,fee:1,nativeDeduction:checked?1:0,applyWhishFee:checked,feeTiming:'before_cashout'});
  const due=C.summary(dbOf(f)).total;assert.equal(due.pending,99);assert.equal(due.pendingGross,100);assert.equal(due.whishCollectibleGross,99);assert.equal(due.whishCollectibleNet,99);
  assert.throws(()=>s.prepare(input('too-large-'+checked,2,100,'Whish Money')),/exceeds/);
  const p=s.prepare(input('collect-net-'+checked,2,99,'Whish Money'));assert.equal(p.fee,0);assert.equal(p.netCash,99);assert.equal(p.grossBasis,100);assert.equal(p.prepaidFee,1);assert.equal(p.allocations[0].walletDebitCents,9900);assert.equal(p.allocations[0].amountCents,10000);
  await s.apply({...input('collect-net-'+checked,2,99,'Whish Money'),token:p.token,confirm:true,confirmation:'PAY BILL'});assert.equal(balance(dbOf(f)),401);assert.equal(cash(dbOf(f),'admin-key'),99);assert.equal(C.summary(dbOf(f)).total.pending,0);assert.equal(C.summary(dbOf(f)).total.collectedNet,99);assert.equal(C.summary(dbOf(f)).total.collectedFees,0);assert.equal(q(dbOf(f),'SELECT * FROM expenses').length,0,'Pay bill creates no new fee expense');
 }
 const split=fixture(),ss=split.service();fund(split,'prepaid-partials','other',100,{accountingVersion:4,paymentMethod:'Whish Money',grossAmount:100,walletAmount:99,walletFee:1,fee:1,feeTiming:'before_cashout'});
 for(const [id,value]of [['one',33.33],['two',33.33],['three',32.34]])assert.equal((await collect(ss,input('split-'+id,2,value,'Whish Money'))).fee,0);
 assert.equal(C.summary(dbOf(split)).total.pending,0);assert.equal(C.summary(dbOf(split)).total.collectedGross,100);assert.equal(C.summary(dbOf(split)).total.collectedNet,99);assert.equal(cash(dbOf(split),'admin-key'),99);assert.equal(balance(dbOf(split)),401);
 const tiny=fixture(),ts=tiny.service();fund(tiny,'prepaid-tiny','other',1,{accountingVersion:4,paymentMethod:'Whish Money',grossAmount:1,walletAmount:.99,walletFee:.01,fee:.01,feeTiming:'before_cashout'});
 for(const [id,value]of [['a',.49],['b',.01],['c',.49]])assert.equal((await collect(ts,input('tiny-collect-'+id,2,value,'Whish Money'))).fee,0);
 assert.equal(C.summary(dbOf(tiny)).total.collectedNet,.99);assert.equal(C.summary(dbOf(tiny)).total.collectedGross,1);assert.equal(C.summary(dbOf(tiny)).total.pending,0);
 // Only the unsettled old v3 portion receives a migration snapshot. Its
 // original Native request, original JSON and completed fee stay untouched.
 const old=fixture(),os=old.service();fund(old,'old-partial-fund','other',99,{paymentMethod:'Whish Money',grossAmount:100,nativeDeduction:1,fee:0,feeTiming:'cashout_only'});
 const oldInput=q(dbOf(old),'SELECT input_json FROM reseller_funds WHERE request_id=?',['old-partial-fund'])[0].input_json;
 await collect(os,input('old-already-collected',2,40,'Whish Money'));assert.equal(cash(dbOf(old),'admin-key'),39.6);assert.equal(balance(dbOf(old)),460);
 const plans=C.prepaymentPlans(dbOf(old));assert.equal(plans.length,1);assert.equal(plans[0].grossCents,6000);assert.equal(plans[0].feeCents,60);assert.equal(plans[0].netCents,5940);
 C.recordPrepayment(dbOf(old),plans[0],now);C.recordPrepayment(dbOf(old),plans[0],now);assert.equal(q(dbOf(old),'SELECT * FROM reseller_fee_prepayments').length,1);assert.equal(C.prepaymentPlans(dbOf(old)).length,0);
 const owner=q(dbOf(old),"SELECT * FROM users WHERE account_key='cashier-key'")[0];A.movement(dbOf(old),'synthetic-prepayment','fee',owner,-60,'Whish Money',wallet.id,now,'Synthetic remaining fee correction','complete');
 dbOf(old).run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id) VALUES(?,'Whish Money fees','Synthetic migrated remaining fee',.6,2,'whish_prepaid_fee','old-partial-fund')",[now.slice(0,10)]);
 const p=os.prepare(input('old-net-collection',2,59.4,'Whish Money'));assert.equal(p.fee,0);assert.equal(p.grossBasis,60);assert.equal(p.netCash,59.4);await os.apply({...input('old-net-collection',2,59.4,'Whish Money'),token:p.token,confirm:true,confirmation:'PAY BILL'});
 assert.equal(balance(dbOf(old)),400);assert.equal(cash(dbOf(old),'admin-key'),99);assert.equal(C.summary(dbOf(old)).total.collectedFees,.4);assert.equal(C.summary(dbOf(old)).total.collectedNet,99);assert.equal(C.summary(dbOf(old)).total.pending,0);assert.equal(Math.round(q(dbOf(old),'SELECT SUM(amount) AS n FROM expenses')[0].n*100),100);assert.equal(q(dbOf(old),'SELECT input_json FROM reseller_funds WHERE request_id=?',['old-partial-fund'])[0].input_json,oldInput);
 // A later recovered old receipt is discovered even after earlier plans were
 // recorded; this migration is per receipt, never a whole-database done flag.
 fund(old,'late-recovered-old-fund','other',10,{paymentMethod:'Whish Money'});assert.equal(C.prepaymentPlans(dbOf(old)).length,1);
 const cent=fixture(),centService=cent.service();fund(cent,'old-cent-rounding','other',3,{paymentMethod:'Whish Money'});await collect(centService,input('old-cent-half',2,1.5,'Whish Money'));const centPlan=C.prepaymentPlans(dbOf(cent))[0];assert.equal(centPlan.grossCents,150);assert.equal(centPlan.feeCents,1,'Prior cash-out already charged2 cents; the remaining correction is1 cent, not another independently rounded2 cents.');assert.equal(centPlan.netCents,149);C.recordPrepayment(dbOf(cent),centPlan,now);assert.equal(C.summary(dbOf(cent)).total.pending,1.49);assert.equal((await collect(centService,input('old-cent-rest',2,1.49,'Whish Money'))).fee,0);assert.equal(C.summary(dbOf(cent)).total.collectedNet,2.97);
 const refunds=fixture();fund(refunds,'refund-prepaid','other',99,{accountingVersion:4,paymentMethod:'Whish Money',grossAmount:100,walletAmount:99,walletFee:1,fee:1,feeTiming:'before_cashout'});
 const rc=C.refundCustody(dbOf(refunds),'refund-prepaid',5000);assert.equal(rc.walletCents,4950);assert.equal(rc.prepaid,true);
 fund(refunds,'partial-native-refund','other',-49.5,{accountingVersion:4,paymentMethod:'Whish Money',grossAmount:49.5,walletAmount:49.5,walletFee:0,fee:0,refundOfRequest:'refund-prepaid',refundGrossAmount:50,refundWalletAmount:49.5,feeTiming:'before_cashout'});
 assert.equal(C.summary(dbOf(refunds)).total.pending,49.5);assert.equal(C.openFunding(dbOf(refunds),'refund-prepaid').remainingWallet,49.5);assert.equal(C.refundCustody(dbOf(refunds),'refund-prepaid',5000).walletCents,4950);
 assert.throws(()=>C.refundCustody(dbOf(refunds),'refund-prepaid',5001),/exceeds/);
 // Preserve an old in-flight collection exactly. Correct only the balance left
 // after it finishes; interrupted intents cannot be silently re-priced.
 const pending=fixture(),ps=pending.service();fund(pending,'pending-old-fund','other',100,{paymentMethod:'Whish Money'});let interrupted=false;
 pending.setHook((entry,phase)=>{if(!interrupted&&phase==='after'&&entry.id==='fiber-resellers'&&q(entry.db,"SELECT state FROM reseller_collections WHERE request_id='pending-old-collect'")[0]?.state==='prepared'){interrupted=true;throw Error('Synthetic preserved old intent');}});
 const saved=approved(ps,input('pending-old-collect',2,20,'Whish Money'));await assert.rejects(ps.apply(saved),/preserved old intent/);assert.throws(()=>C.prepaymentPlans(dbOf(pending)),/pending reseller collections/);
 pending.setHook(null);await pending.service().apply(saved);const after=C.prepaymentPlans(dbOf(pending));assert.equal(after[0].grossCents,8000);assert.equal(after[0].feeCents,80);assert.equal(cash(dbOf(pending),'admin-key'),19.8);
 console.log('Reseller prepaid collections QA passed: gross versus Native versus available wallet, optional Native deduction independence, zero new cash-out fee, partial/cent allocations, net refunds, immutable old paid fees, per-receipt remaining migration/replay and pending-intent deferral. Synthetic only.');
})().catch(error=>{console.error(error);process.exit(1);});
