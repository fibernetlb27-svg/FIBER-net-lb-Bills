'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Finance=require('../app/finance-ledger.cjs'),A=require('../app/reseller-accounting.cjs'),C=require('../app/reseller-collections.cjs'),Revenue=require('../app/reseller-collected-revenue.cjs');
const {ResellerFundingService}=require('../app/reseller-funding-service.cjs');
const {combineReports,workspace}=require('../app/workspaces.cjs');
const sql=require('sql.js')();
async function fixture(){const SQL=await sql,db=new SQL.Database();A.initialize(db);C.initialize(db);db.exec("CREATE TABLE finance_settings(name TEXT PRIMARY KEY,value TEXT);CREATE TABLE resellers(id INTEGER PRIMARY KEY,username TEXT UNIQUE,full_name TEXT,active INTEGER DEFAULT 1);INSERT INTO resellers VALUES(1,'fictional-reseller','Fictional Reseller',1)");return db;}
function fund(db,id,cents,at,method='Cash',actor='cashier:2'){
 const deduction=method==='Whish Money'?Math.round(cents/100):0,input={accountingVersion:5,grossAmount:cents/100,nativeDeduction:deduction/100,fee:deduction/100,profitFee:deduction/100,walletAmount:cents/100,paymentMethod:method,receiverKey:'admin:1',custodianKey:'cashier:2',custodySection:'fiber-resellers'};
 db.run('INSERT INTO reseller_funds VALUES(?,?,?,?,?,?,?,?,?,?)',[id,'RF-'+id,'fictional-reseller',cents-deduction,method,actor,'Fictional Operator',at,JSON.stringify(input),'{}']);
}
function collect(db,id,fundId,cents,at,{fee=0,wallet=false,actor='cashier:2'}={}){
 const allocation={fundRequestId:fundId,fundActorKey:actor,amountCents:cents,walletDebitCents:cents-fee,feeCents:fee},input={collectionRouteVersion:wallet?2:1,paymentMethod:wallet?'Whish Money':'Cash'};
 db.run('INSERT INTO reseller_collections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,'fictional-reseller','completed',cents,fee,cents-fee,'fiber-resellers',actor,wallet?'fictional-wallet':'','admin:1','Fictional Admin','admin:1',at,JSON.stringify(input),JSON.stringify([allocation]),'fictional-proof','{}']);
}
const baseReport=()=>({revenue:0,costOfGoods:0,grossProfit:0,netProfit:0,cashReceived:0,whishReceived:0,grossWhishReceived:0,collectionsTotal:0,expenses:0,whishFees:0,profitParts:[]});
function snapshot(month){const range=Finance.monthRange(month),count=Number(range.end.slice(-2));return {month,report:baseReport(),daily:Array.from({length:count},(_,index)=>({date:month+'-'+String(index+1).padStart(2,'0'),report:baseReport()})),closing:{cash:40,wallets:[],bank:50},readOnly:true};}
test('month activity uses actual collection dates and leaves earlier unpaid funding available',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'october-fund',10000,'2026-10-10T10:00:00');collect(db,'october-collection','october-fund',6000,'2026-10-20T10:00:00');fund(db,'november-fund',5000,'2026-11-01T10:00:00');collect(db,'november-late-collection','october-fund',2000,'2026-11-02T10:00:00');
 const october=Revenue.period(db,{start:'2026-10-01',end:'2026-10-31'}),november=Revenue.period(db,{start:'2026-11-01',end:'2026-11-30'});
 assert.equal(october.amount,60);assert.equal(november.amount,20);assert.equal(october.daily[0].day,'2026-10-20');assert.equal(november.daily[0].day,'2026-11-02');assert.equal(C.summary(db).total.pending,70);assert.equal(C.openFunding(db,'october-fund').remaining,20);
 assert.equal(A.fundingTotals(db).total.added,150);assert.equal(A.fundingTotals(db,null,{start:'2026-11-01',end:'2026-11-30'}).total.added,50);
 assert.equal(Revenue.period(db,{start:'2026-11-01',end:'2026-11-30',accountKey:'cashier:99'}).amount,0);
});
test('current Reseller Bills totals roll over without deleting funding, history or outstanding claims',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'old-fund',10000,'2026-10-10T10:00:00');collect(db,'old-collection','old-fund',6000,'2026-10-20T10:00:00');
 const actor={account_key:'admin:1',full_name:'Fictional Admin',active:1,role:'admin'},entries=new Map([['fiber-resellers',{db}],['fiber-users',{db}]]),service=new ResellerFundingService({entries,authorize:()=>actor,destinations:()=>[],api:()=>({moneyResellers:async()=>[{id:1,username:'fictional-reseller',name:'Fictional Reseller',balance:12,balanceRead:true,balanceAvailable:true}]}),now:()=> '2026-11-02T10:00:00',save(){},receiverKey:()=>actor.account_key,member:()=>actor,canManage:()=>false});
 const before=db.exec('SELECT * FROM reseller_funds'),result=await service.accounts();
 assert.equal(result.period.month,'2026-11');assert.equal(result.totals.added,0);assert.equal(result.periodCollections.amount,0);assert.equal(result.accounts[0].paymentTotals.added,0);assert.equal(result.accounts[0].periodMoneyCollected,0);assert.equal(result.accounts[0].pending,40);assert.equal(result.history.length,1);assert.equal(result.history[0].paidAt.slice(0,7),'2026-10');assert.deepEqual(db.exec('SELECT * FROM reseller_funds'),before);
});
test('closed-month presentation fixes revenue, bandwidth and profit coherently without changing its saved proof or counting twice',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'old-fund',10000,'2026-10-10T10:00:00');collect(db,'old-collection','old-fund',6000,'2026-10-20T10:00:00');
 const old=snapshot('2026-10');for(const r of [old.report,old.daily[14].report]){r.netProfit=-6;r.expenses=1;r.whishFees=1;r.fixedMonthlyProfitCost=5;r.profitParts=[{id:'expenses',revenue:0,cost:1,profit:-1},{id:'fixed_monthly',revenue:0,cost:5,profit:-5}];}
 db.exec('CREATE TABLE archived_proof(input_hash TEXT,result_hash TEXT,archive_json TEXT)');db.run('INSERT INTO archived_proof VALUES(?,?,?)',['unchanged-input-hash','unchanged-result-hash',JSON.stringify(old)]);
 const bytes=Buffer.from(db.export()),saved=JSON.stringify(old),bandwidth={incurredCost:30,daily:[{day:'2026-10-02',incurredCost:30}]},shown=Revenue.presentSnapshot(db,old,'2026-10',null,bandwidth);
 assert.equal(shown.report.revenue,60);assert.equal(shown.report.costOfGoods,30);assert.equal(shown.report.grossProfit,30);assert.equal(shown.report.netProfit,24);assert.equal(shown.report.expenses,1);assert.equal(shown.report.whishFees,1);assert.equal(shown.report.fixedMonthlyProfitCost,5);assert.equal(shown.daily[19].report.revenue,60);assert.equal(shown.daily[1].report.costOfGoods,30);assert.equal(shown.daily[14].report.netProfit,-6);assert.equal(shown.report.profitParts.reduce((sum,row)=>sum+row.profit,0),24);
 assert.deepEqual(Revenue.presentSnapshot(db,shown,'2026-10',null,bandwidth),shown);assert.equal(shown.resellerRevenuePresentation.originalSavedRevenue,0);assert.equal(shown.resellerRevenuePresentation.immutableArchivePreserved,true);assert.equal(JSON.stringify(old),saved);assert.deepEqual(Buffer.from(db.export()),bytes);assert.deepEqual(shown.closing,old.closing);
 const transaction=Revenue.transactionSnapshot(shown);assert.equal(transaction.report.revenue,0);assert.equal(transaction.report.costOfGoods,0);assert.equal(transaction.report.netProfit,-6);assert.deepEqual(transaction.daily,old.daily);assert.equal(transaction.resellerRevenuePresentation,undefined);
 // A newly stored corrected archive identifies its actual saved figure, not
 // the original transaction-only metric retained in the projection basis.
 const newlyStored={...shown};delete newlyStored.resellerRevenuePresentation;assert.equal(Revenue.presentSnapshot(db,newlyStored,'2026-10',null,bandwidth).resellerRevenuePresentation.originalSavedRevenue,60);
});
test('Whish collections report the full saved gross wallet credit without recharging its earlier fee',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'whish-fund',10000,'2026-10-10T10:00:00','Whish Money');collect(db,'whish-collection','whish-fund',10000,'2026-10-20T10:00:00',{wallet:true});
 const value=Revenue.period(db,{start:'2026-10-01',end:'2026-10-31'});assert.equal(value.amount,100);assert.equal(value.whish,100);assert.equal(value.cash,0);assert.equal(A.fundingTotals(db).total.added,99);assert.equal(A.fundingTotals(db).total.whishFees,1);assert.equal(C.summary(db).total.pending,0);
 const old=snapshot('2026-10');old.report.netProfit=-1;old.report.expenses=1;old.report.whishFees=1;old.daily[9].report.netProfit=-1;old.daily[9].report.expenses=1;old.daily[9].report.whishFees=1;
 const shown=Revenue.presentSnapshot(db,old,'2026-10');assert.equal(shown.report.revenue,100);assert.equal(shown.report.netProfit,99);assert.equal(shown.report.whishFees,1);assert.equal(shown.report.whishReceived,100);
});
test('unverified or out-of-range saved collection allocations fail instead of showing a zero revenue',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'fund',10000,'2026-10-10T10:00:00');collect(db,'collection','fund',6000,'2026-10-20T10:00:00');db.run('UPDATE reseller_collections SET net_cents=6100');assert.throws(()=>Revenue.period(db,{start:'2026-10-01',end:'2026-10-31'}),/disagree/);assert.throws(()=>A.fundingTotals(db,null,{start:'2026-02-31',end:'2026-03-01'}),/dates/);
});
test('combined transaction reports retain one customer income and one Main bandwidth expense across closed and partial periods',async t=>{
 const db=await fixture();t.after(()=>db.close());fund(db,'fund',10000,'2026-10-10T10:00:00');collect(db,'collection','fund',6000,'2026-10-20T10:00:00');
 const old=snapshot('2026-10'),shown=Revenue.presentSnapshot(db,old,'2026-10',null,{incurredCost:30,daily:[{day:'2026-10-02',incurredCost:30}]}),restored=Revenue.transactionSnapshot(shown);
 const combine=(resellerReport,expense)=>{const main={...baseReport(),expenses:expense,netProfit:-expense,daily:[],recentSales:[]},users={...baseReport(),revenue:60,grossProfit:60,netProfit:60,daily:[],recentSales:[]};return combineReports([{section:workspace('main'),report:main,drawer:{balance:0}},{section:workspace('fiber-users'),report:users,drawer:{balance:0}},{section:workspace('fiber-resellers'),report:{...resellerReport,daily:[],recentSales:[]},drawer:{balance:0}}]);};
 const month=combine(restored.report,30);assert.equal(month.revenue,60);assert.equal(month.costOfGoods,0);assert.equal(month.expenses,30);assert.equal(month.netProfit,30);assert.equal(shown.report.revenue,60);assert.equal(shown.report.costOfGoods,30);assert.equal(shown.report.netProfit,30);
 const partial=combine(combineReports(restored.daily.filter(row=>row.date>='2026-10-20').map(row=>({section:workspace('fiber-resellers'),report:{...row.report,daily:[],recentSales:[]},drawer:{balance:0}}))),0);assert.equal(partial.revenue,60);assert.equal(partial.expenses,0);assert.equal(partial.netProfit,60);
});
