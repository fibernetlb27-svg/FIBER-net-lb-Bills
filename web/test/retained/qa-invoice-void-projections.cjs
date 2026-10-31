'use strict';
// Projection contracts only: all fixtures are synthetic in-memory SQL. The
// invoice-void core owns authorization, period checks, stock restoration and
// durable cross-store reversal; these tests do not simulate a live reversal.
const assert=require('node:assert/strict');
const Accounting=require('./warehouse-accounting.cjs');
const Finance=require('./finance-ledger.cjs');
const {createWarehouse}=require('./admin-warehouse.cjs');
const AT='2026-10-21T12:00:00',DAY='2026-10-21';
const WALLET={id:'synthetic-wallet',label:'Synthetic wallet',number:'03000000',active:true};
const ADMIN={accountKey:'synthetic-admin',userId:1,role:'admin',fullName:'Synthetic Admin',username:'admin',active:true};
const SELLER={accountKey:'synthetic-seller',userId:2,role:'cashier',fullName:'Synthetic Seller',username:'seller',active:true};
const sections=[{id:'main',name:'Synthetic Main'},{id:'fiber-users',name:'Synthetic Users'},{id:'fiber-resellers',name:'Synthetic Resellers'}];
function q(db,sql,args=[]){const statement=db.prepare(sql);try{statement.bind(args);const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}}
const scalar=(db,sql,args=[])=>Object.values(q(db,sql,args)[0])[0];
const clone=value=>JSON.parse(JSON.stringify(value));
function sourceProof(db,tables){return tables.map(table=>({table,rows:q(db,'SELECT * FROM '+table+' ORDER BY rowid')}));}
function voidSaleTables(db){db.exec(`CREATE TABLE pos_invoice_voids(sale_id INTEGER PRIMARY KEY,request_id TEXT NOT NULL,invoice_no TEXT NOT NULL,workspace_id TEXT NOT NULL,voided_at TEXT NOT NULL,actor_key TEXT NOT NULL,actor_name TEXT NOT NULL,reason TEXT NOT NULL,snapshot_json TEXT NOT NULL);
 CREATE TABLE pos_invoice_void_custody(event_id TEXT PRIMARY KEY,request_id TEXT NOT NULL);
 CREATE TABLE pos_invoice_void_wallet(event_id TEXT PRIMARY KEY,request_id TEXT NOT NULL);`);}
function markSale(db,id,workspaceId='fiber-users'){db.run('INSERT INTO pos_invoice_voids VALUES(?,?,?,?,?,?,?,?,?)',[id,'synthetic-void-'+id,'SYNTHETIC-'+id,workspaceId,AT,ADMIN.accountKey,ADMIN.fullName,'Synthetic reviewed reversal','{}']);}
function walletFixture(SQL){
 const db=new SQL.Database();
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT);INSERT INTO users VALUES(1,'synthetic-admin'),(2,'synthetic-seller');
 CREATE TABLE sales(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,payment_method TEXT);
 CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
 CREATE TABLE telecom_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
 CREATE TABLE installation_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
 CREATE TABLE payment_destinations(kind TEXT,record_key TEXT,snapshot_json TEXT);
 CREATE TABLE debt_payments(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,record_id INTEGER,received_at TEXT,payment_method TEXT);
 CREATE TABLE finance_wallet_entries(id TEXT PRIMARY KEY,event_id TEXT,wallet_id TEXT,account_key TEXT,amount_cents INTEGER,effective_at TEXT);
 CREATE VIEW active_sales AS SELECT * FROM sales;
 CREATE VIEW active_fibernetlb_bills AS SELECT * FROM fibernetlb_bills;
 CREATE VIEW active_telecom_payments AS SELECT * FROM telecom_payments;`);
 db.run('INSERT INTO sales VALUES(1,2,?,?)',[AT,'Whish Money']);
 db.run('INSERT INTO payment_destinations VALUES(?,?,?)',['sale','1',JSON.stringify({...WALLET,walletAmount:12,gross:12,fee:.12})]);
 for(const [id,event,owner,amount,at]of [['void-entry','shared-policy-event',SELLER.accountKey,1500,AT],['keep-same-event','shared-policy-event',SELLER.accountKey,700,AT],['keep-other-owner','shared-policy-event',ADMIN.accountKey,300,AT],['keep-future','shared-policy-event',SELLER.accountKey,500,'2026-11-01T12:00:00']])db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[id,event,WALLET.id,owner,amount,at]);
 return db;
}
function testWallets(SQL){
 const db=walletFixture(SQL),balance=(key=null,through=DAY)=>Finance.walletBalances(db,[WALLET],key,through)[0];
 assert.equal(balance(SELLER.accountKey).balance,34,'Old databases without void tables retain their exact prior projection.');assert.equal(balance().balance,37);assert.equal(balance(SELLER.accountKey).fees,.12);
 const original=sourceProof(db,['sales','payment_destinations','finance_wallet_entries']);voidSaleTables(db);
 db.run('INSERT INTO pos_invoice_void_wallet VALUES(?,?)',['void-entry','synthetic-wallet-void']);
 assert.equal(balance(SELLER.accountKey).balance,19);assert.equal(balance(ADMIN.accountKey).balance,3);assert.equal(balance().balance,22);
 assert.equal(balance(SELLER.accountKey,null).balance,24,'Through-date and owner scopes survive entry exclusion.');
 assert.equal(balance(SELLER.accountKey).fees,.12,'Excluding one custody row does not rewrite an unrelated original receipt fee snapshot.');
 assert.deepEqual(sourceProof(db,['sales','payment_destinations','finance_wallet_entries']),original,'Exact row IDs are excluded, never edited or offset by a guessed amount.');
 assert(q(db,"SELECT id FROM finance_wallet_entries WHERE event_id='shared-policy-event'").length===4,'Other rows sharing the same event group remain stored and active.');
 // The core rebuilds active views. Its active-sale contract also removes the
 // original incoming receipt while this module excludes only exact entries.
 markSale(db,1);db.exec('DROP VIEW active_sales;CREATE VIEW active_sales AS SELECT s.* FROM sales s WHERE NOT EXISTS(SELECT 1 FROM pos_invoice_voids v WHERE v.sale_id=s.id)');
 assert.equal(balance(SELLER.accountKey).balance,7);assert.equal(balance().balance,10);assert.equal(balance(SELLER.accountKey).fees,0);assert.deepEqual(sourceProof(db,['sales','payment_destinations','finance_wallet_entries']),original);
 db.close();
}
function accountingFixture(SQL){
 const db=new SQL.Database();db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT);INSERT INTO users VALUES(1,'synthetic-admin'),(2,'synthetic-seller');
 CREATE TABLE sales(id INTEGER PRIMARY KEY,invoice_no TEXT,subtotal REAL,cost_total REAL,created_at TEXT,customer_name TEXT,customer_account TEXT);
 CREATE TABLE finance_months(month TEXT PRIMARY KEY);`);Accounting.initializeBusiness(db);return db;
}
function addLinkedSale(db,id,retail,wholesale,{workspaceId='fiber-users',method='Cash',acquisition=5}={}){
 const cost=workspaceId==='main'?acquisition:wholesale,snapshot={requestId:'synthetic-accounting-sale-'+id,subtotal:retail,wholesaleTotal:wholesale,acquisitionTotal:acquisition,margin:retail-cost,workspaceId,actor:SELLER,createdAt:AT,items:[{productKey:'main:1',quantity:1}]};
 db.run('INSERT INTO sales VALUES(?,?,?,?,?,?,?)',[id,'SYNTHETIC-'+id,retail,cost,AT,'Synthetic customer','synthetic-account']);db.run('INSERT INTO warehouse_sale_links VALUES(?,?,?)',[snapshot.requestId,id,JSON.stringify(snapshot)]);
 const detail={id,referenceNo:'SYNTHETIC-'+id,originalAmount:retail,paidAmount:retail,remainingAmount:0,cashPaid:method==='Cash'?retail:0,whishPaid:method==='Whish Money'?retail:0,otherPaid:0,whishDestination:method==='Whish Money'?WALLET:null};
 return {snapshot,detail};
}
function testAccounting(SQL){
 const db=accountingFixture(SQL),first=addLinkedSale(db,1,15,10,{method:'Whish Money'}),second=addLinkedSale(db,2,30,20),direct=addLinkedSale(db,4,15,0,{workspaceId:'main'});
 for(const sale of [first,second])Accounting.releaseFunding(db,{saleId:sale.detail.id,detail:sale.detail,receivedAt:AT,userId:SELLER.userId,actorKey:SELLER.accountKey});
 for(const [id,kind,amount]of [['sale-one','sale',15],['pay-admin-one','wholesale_payment',-4],['sale-two','sale',30]])Accounting.recordCustody(db,{id,requestId:'synthetic-custody-'+id,kind,amount,occurredAt:AT,userId:SELLER.userId,actorKey:SELLER.accountKey});
 let report=Accounting.report(db,{start:DAY,end:DAY});assert.equal(report.physicalProductRevenue,45);assert.equal(report.physicalProductGrossMargin,15);assert.equal(report.marginFunding,15);assert.equal(report.warehouseNetCustody,41);assert.equal(Accounting.sourceReadRows(db).length,2);
 const tables=['sales','warehouse_sale_links','warehouse_margin_releases','warehouse_margin_funding','warehouse_custody_events'],original=sourceProof(db,tables);voidSaleTables(db);markSale(db,1);markSale(db,4,'main');
 for(const id of ['sale-one','pay-admin-one'])db.run('INSERT INTO pos_invoice_void_custody VALUES(?,?)',[id,'synthetic-void-1']);
 const remaining=Accounting.sourceReadRows(db);assert.equal(remaining.length,1);assert.equal(remaining[0].saleId,2);assert.equal(remaining[0].amount,10);assert.equal(remaining[0].fundingMethod,'Cash');assert.equal(Accounting.sourceReadRows(db,{userId:SELLER.userId}).length,1);assert.deepEqual(Accounting.sourceReadRows(db,{userId:ADMIN.userId}),[]);
 report=Accounting.report(db,{start:DAY,end:DAY,accountKey:SELLER.accountKey});assert.equal(report.saleCount,1);assert.equal(report.physicalProductRevenue,30);assert.equal(report.physicalProductWholesaleCost,20);assert.equal(report.physicalProductAcquisitionCost,5);assert.equal(report.physicalProductGrossMargin,10);assert.equal(report.marginFunding,10);assert.equal(report.warehouseNetCustody,30);assert.equal(report.productTradeAdjustment,-20);assert.deepEqual(report.daily,[{day:DAY,revenue:30,cost:20,acquisitionCost:5,profit:10,count:1}]);
 assert.throws(()=>Accounting.releaseFunding(db,{saleId:1,detail:first.detail,receivedAt:AT,userId:SELLER.userId,actorKey:SELLER.accountKey}),/invoice was deleted/,'Even an already released margin cannot be reactivated by replay.');
 assert.throws(()=>Accounting.releaseFunding(db,{saleId:4,detail:direct.detail,receivedAt:AT,userId:SELLER.userId,actorKey:SELLER.accountKey}),/invoice was deleted/,'A voided Main direct receipt cannot acquire a new funding release.');
 assert.equal(Accounting.releaseFunding(db,{saleId:2,detail:second.detail}).idempotent,true,'An unrelated active release still replays without another budget entry.');
 assert.deepEqual(sourceProof(db,tables),original,'Funding, custody, source invoices and snapshot evidence remain immutable raw audit rows.');
 const reopened=new SQL.Database(db.export());assert.equal(Accounting.sourceReadRows(reopened).length,1);assert.equal(Accounting.report(reopened,{start:DAY,end:DAY}).physicalProductGrossMargin,10);assert.deepEqual(sourceProof(reopened,tables),original);reopened.close();db.close();
}
function warehouseFixture(SQL,state){
 const db=state?new SQL.Database(state):new SQL.Database();let person=ADMIN,callbacks=0,saves=0,nextId=1;
 const receipts=new Map();
 const complete=operation=>{callbacks++;let saved=receipts.get(operation.requestId);if(saved){assert.deepEqual(saved.operation,operation);return clone(saved.result);}const result={requestId:operation.requestId,state:'completed',workspaceId:operation.workspaceId,...operation.kind==='checkout'?{saleId:nextId,receipt:{id:nextId++,invoiceNo:'SYNTHETIC-'+operation.requestId,subtotal:operation.subtotal,costTotal:operation.costTotal,profit:operation.margin,paymentMethod:operation.paymentMethod}}:{amount:operation.amount,paymentMethod:operation.paymentMethod,receipt:{referenceNo:'SYNTHETIC-'+operation.requestId,amount:operation.amount,paymentMethod:operation.paymentMethod}}};receipts.set(operation.requestId,{operation:clone(operation),result:clone(result)});return result;};
 const api=createWarehouse({db,sections,now:()=>AT,saveMain:()=>{saves++;},authorizeAdmin:()=>{assert.equal(person.role,'admin');return person;},authorizeSale:()=>person,authorizeRead:()=>person,readOpenings:()=>{assert(!state,'Never reimport original stock on reopen.');return [{workspaceId:'main',productId:1,product:{name:'Synthetic central router',sku:'SYNTHETIC-ROUTER',category:'Router',currency:'USD',cost:5,price:15,quantity:10,reorderLevel:1,barcodes:[],trackQuantity:true}}];},prepareSale:()=>({whishDestination:null}),commitSale:complete,settleTransfer:complete,assertOpen:()=>{}});
 return {db,api,receipts,get callbacks(){return callbacks;},get saves(){return saves;},set person(value){person=value;}};
}
function checkout(id,workspaceId='fiber-users',quantity=1){return {requestId:id,workspaceId,items:[{productKey:'main:1',quantity,wholesalePrice:workspaceId==='main'?null:workspaceId==='fiber-users'?10:11,retailPrice:workspaceId==='fiber-resellers'?17:15,offerVersion:workspaceId==='main'?0:1}],paymentMethod:'Cash',customerName:'Synthetic customer'};}
async function testWarehouse(SQL){
 const f=warehouseFixture(SQL);await f.api.initialize();assert.equal(scalar(f.db,"SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'pos_invoice_void%'"),0,'Warehouse initialization does not create core-owned reversal schemas.');
 for(const [workspaceId,wholesalePrice,retailPrice]of [['fiber-users',10,15],['fiber-resellers',11,17]])await f.api.setOffer({productKey:'main:1',workspaceId,wholesalePrice,retailPrice,expectedVersion:0});
 f.person=SELLER;const firstInput=checkout('void-projection-users-one','fiber-users',2),first=await f.api.checkout(firstInput);const secondInput=checkout('void-projection-users-two');await f.api.checkout(secondInput);await f.api.checkout(checkout('void-projection-resellers','fiber-resellers'));
 f.person=ADMIN;const directInput=checkout('void-projection-main-direct','main'),direct=await f.api.checkout(directInput),payment={requestId:'void-projection-payment-one',saleRequestId:firstInput.requestId,amount:5,paymentMethod:'Cash',fromKey:SELLER.accountKey,confirm:true,note:'Synthetic partial Admin collection'},paid=await f.api.collect(payment);
 assert.equal(f.api.debts().total,36);let report=f.api.report({start:DAY,end:DAY});assert.equal(report.checkoutCount,3);assert.equal(report.wholesaleRevenue,41);assert.equal(report.wholesaleCost,20);assert.equal(report.wholesaleProfit,21);assert.equal(report.mainSales.length,1);assert.equal(report.payments.length,1);
 const tables=['admin_warehouse_products','admin_warehouse_intents','admin_warehouse_debts','admin_warehouse_payments','admin_warehouse_audit'],original=sourceProof(f.db,tables),oldCallbacks=f.callbacks,stock=scalar(f.db,"SELECT quantity FROM admin_warehouse_products WHERE product_key='main:1'");
 f.db.exec('CREATE TABLE pos_invoice_void_warehouse(sale_request_id TEXT PRIMARY KEY,request_id TEXT NOT NULL)');for(const id of [firstInput.requestId,directInput.requestId])f.db.run('INSERT INTO pos_invoice_void_warehouse VALUES(?,?)',[id,'synthetic-void-'+id]);
 const debts=f.api.debts();assert.equal(debts.total,21);assert.equal(debts.count,2);assert.equal(debts.debts.length,2);assert(!debts.debts.some(row=>row.saleRequestId===firstInput.requestId));assert.equal(debts.byBusiness.find(row=>row.workspaceId==='fiber-users').total,10);assert.equal(debts.byBusiness.find(row=>row.workspaceId==='fiber-resellers').total,11);
 report=f.api.report({start:DAY,end:DAY});assert.equal(report.checkoutCount,2);assert.equal(report.wholesaleRevenue,21);assert.equal(report.wholesaleCost,10);assert.equal(report.wholesaleProfit,11);assert.equal(report.businessMargin,11);assert.equal(report.mainSales.length,0);assert.equal(report.sales.length,2);assert.equal(report.payments.length,0);assert.equal(report.daily[0].checkoutCount,2);assert.equal(report.daily[0].wholesaleRevenue,21);assert.equal(report.byBusiness.find(row=>row.workspaceId==='fiber-users').wholesaleRevenue,10);
 const projected=Accounting.internalWholesaleReport({revenue:0,posRevenue:0,costOfGoods:0,posCostOfGoods:0,grossProfit:0,posGrossProfit:0,netProfit:0,saleCount:0,daily:[],profitParts:[]},report);assert.equal(projected.revenue,21);assert.equal(projected.costOfGoods,10);assert.equal(projected.netProfit,11);assert.equal(projected.internalWholesaleRevenue,21);assert.equal(projected.internalWholesaleCost,21);
 const blockedCounts={intents:scalar(f.db,'SELECT COUNT(*) FROM admin_warehouse_intents'),callbacks:f.callbacks,saves:f.saves};
 await assert.rejects(f.api.collect({...payment,requestId:'void-projection-new-denied',amount:1}),/invoice was deleted/);assert.equal(scalar(f.db,'SELECT COUNT(*) FROM admin_warehouse_intents'),blockedCounts.intents);assert.equal(f.callbacks,blockedCounts.callbacks);assert.equal(f.saves,blockedCounts.saves,'A new collection of deleted debt fails before intent, callback or save.');
 for(const [input,expected]of [[firstInput,first],[directInput,direct]]){const status=f.api.status({requestId:input.requestId,workspaceId:input.workspaceId});assert.equal(status.deleted,true);assert.deepEqual(status.receipt,expected.receipt);const resumed=await f.api.resume({requestId:input.requestId});assert.equal(resumed.deleted,true);assert.equal(resumed.idempotent,true);assert.deepEqual(resumed.receipt,expected.receipt);const replay=await f.api.checkout(input);assert.equal(replay.deleted,true);assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipt,expected.receipt);}
 const paymentStatus=f.api.status({requestId:payment.requestId});assert.equal(paymentStatus.deleted,true);assert.deepEqual(paymentStatus.receipt,paid.receipt);const paymentReplay=await f.api.collect(payment);assert.equal(paymentReplay.deleted,true);assert.equal(paymentReplay.idempotent,true);assert.deepEqual(paymentReplay.receipt,paid.receipt);assert.equal((await f.api.resume({requestId:payment.requestId})).deleted,true);
 await assert.rejects(f.api.collect({...payment,amount:6}),/different details/);await assert.rejects(f.api.checkout({...firstInput,customerName:'Changed synthetic customer'}),/different details/);
 assert.equal(f.callbacks,oldCallbacks,'Completed request recovery never calls a deleted receipt or collection writer.');assert.equal(scalar(f.db,"SELECT quantity FROM admin_warehouse_products WHERE product_key='main:1'"),stock,'Projection/replay never mutates stock; actual one-time stock restoration belongs to the core reversal transaction.');assert.deepEqual(sourceProof(f.db,tables),original,'All saved input/result/debt/payment/stock proofs remain unchanged.');
 const reopened=warehouseFixture(SQL,f.db.export());await reopened.api.initialize();assert.equal(reopened.api.debts().total,21);assert.equal(reopened.api.report({start:DAY,end:DAY}).wholesaleRevenue,21);assert.equal(reopened.api.status({requestId:firstInput.requestId}).deleted,true);assert.equal((await reopened.api.checkout(firstInput)).deleted,true);assert.equal((await reopened.api.collect(payment)).deleted,true);assert.equal(reopened.callbacks,0,'Restarted exact replay does not need the original business callback.');assert.deepEqual(sourceProof(reopened.db,tables),original);reopened.db.close();f.db.close();
}
(async()=>{const SQL=await require('sql.js')();testWallets(SQL);testAccounting(SQL);await testWarehouse(SQL);console.log('Invoice void projection QA passed: legacy schemas remain supported; exact wallet-entry exclusion preserves shared-event neighbors and owner/date scopes; deleted margins/custody disappear from active funding/trade totals; Main wholesale/debts/daily/consolidation exclude voided sales; new collections fail before writes, completed checkout/collection/status/resume replay returns original receipts with deleted:true after restart, without resurrecting stock, debt, funding or callbacks. Raw audit proofs remain unchanged. Synthetic in-memory projection fixtures only.');})().catch(error=>{console.error(error);process.exitCode=1;});
