'use strict';
// Fictional, in-memory presentation fixtures. No database/provider is opened,
// no actual ledger is changed and no source request or receipt is rewritten.
const assert=require('node:assert/strict');
const {summarize}=require('./fixed-monthly-dashboard.cjs');
const {WORKSPACES}=require('./workspaces.cjs');
const clone=value=>structuredClone(value),AS_OF='2026-10-22',ADMIN='admin-main',OTHER_ADMIN='admin-other',CASHIER='cashier-users';
let next=0,checks=0;
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}
function throws(fn,label){assert.throws(fn,/could not be verified/,label);checks++;}
function distribute(total,weights){const denominator=weights.reduce((n,value)=>n+BigInt(value),0n),rows=weights.map((weight,index)=>({index,whole:BigInt(total)*BigInt(weight)/denominator,remainder:BigInt(total)*BigInt(weight)%denominator}));let left=BigInt(total)-rows.reduce((n,row)=>n+row.whole,0n);for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(!left)break;row.whole++;left--;}return rows.map(row=>Number(row.whole));}
function bill({amount=40000,profitBasisPoints=10000,weights={'fiber-resellers':5000,'fiber-users':5000},state='unpaid',month='2026-10',actor=ADMIN,paymentDate=AS_OF,generated=true,linked=false}={}){
 const templateId='monthly-test-'+(++next),billId=templateId+':'+month,ids=Object.keys(weights).sort(),shares=distribute(amount,ids.map(id=>weights[id])),profit=Math.round(amount*profitBasisPoints/10000),profits=distribute(profit,shares);
 const allocations=ids.map((workspaceId,index)=>({workspaceId,workspaceName:workspaceId,basisPoints:weights[workspaceId],billShareCents:shares[index],profitCostCents:profits[index],billShare:shares[index]/100,profitCost:profits[index]/100}));
 const value={billId,id:billId,templateId,templateVersion:1,month,dueDate:month+'-01',amountCents:amount,amount:amount/100,profitBasisPoints,profitTotalCents:profit,profitCost:profit/100,allocations,generated,state,pendingRequestId:null,companyDebtId:linked?'linked-company-debt':null,frozen:state==='frozen'?{requestId:'freeze-test-'+next,reason:'Unused this month',frozenAt:AS_OF+'T10:00:00Z',actorName:'Admin'}:null,payment:null};
 if(state==='paid')value.payment={requestId:'monthly-payment-test-'+next,kind:'payment',state:'completed',billId,templateId,month,amount:amount/100,whishFee:0,paymentDate,effectiveAt:paymentDate+'T10:00:00Z',version:3,actorKey:actor,actorName:actor,allocations:clone(allocations),noRevenue:true,noFunding:true,payments:allocations.filter(row=>row.billShareCents).map(row=>({sourceWorkspaceId:row.workspaceId,sourceAccountKey:row.workspaceId==='fiber-users'?CASHIER:actor,paymentMethod:'Cash',amountCents:row.billShareCents,feeCents:0}))};
 return value;
}
function overview(bills=[]){const subset=state=>bills.filter(row=>row.state===state),sum=(rows,field)=>rows.reduce((n,row)=>n+row[field],0)/100,paid=subset('paid'),unpaid=subset('unpaid'),frozen=subset('frozen');return {month:'2026-10',bills:clone(bills),templates:[],payments:clone(paid.map(row=>row.payment)),pending:[],workspaces:clone(WORKSPACES),totals:{billCount:bills.length,paidCount:paid.length,unpaidCount:unpaid.length,frozenCount:frozen.length,totalAmount:sum(bills,'amountCents'),paidAmount:sum(paid,'amountCents'),unpaidAmount:sum(unpaid,'amountCents'),frozenAmount:sum(frozen,'amountCents'),profitDeducted:sum(paid,'profitTotalCents'),whishFees:paid.reduce((n,row)=>n+row.payment.whishFee,0)}};}
function options(bills=[],scope={}){return {overview:overview(bills),workspaceId:'all',accountKey:null,owners:Object.fromEntries(bills.map(row=>[row.billId,ADMIN])),asOf:AS_OF,...scope};}
function fields(value){return Object.fromEntries(['total','paid','remaining','totalProfitCost','paidProfitCost','remainingProfitCost','billCount','paidCount','remainingCount','frozenCount'].map(key=>[key,value[key]]));}
const zero={total:0,paid:0,remaining:0,totalProfitCost:0,paidProfitCost:0,remainingProfitCost:0,billCount:0,paidCount:0,remainingCount:0,frozenCount:0};

{
 const result=summarize(options());equal(fields(result),zero,'An empty verified ledger is a known zero, not unavailable.');
 equal([result.basis,result.month,result.asOf,result.workspaceId,result.accountKey,result.pendingCount],['fixed_monthly_billing_month','2026-10',AS_OF,'all',null,0]);
 equal([result.readOnly,result.noRevenue,result.noFunding],[true,true,true]);
}
{
 const unpaid=bill({profitBasisPoints:5000}),paid=bill({amount:60000,profitBasisPoints:5000,state:'paid'}),input=options([unpaid,paid]),before=clone(input),all=summarize(input);
 equal(fields(all),{total:1000,paid:600,remaining:400,totalProfitCost:500,paidProfitCost:300,remainingProfitCost:200,billCount:2,paidCount:1,remainingCount:1,frozenCount:0},'The three rows and their configured costs share one billing-month cohort.');
 for(const workspaceId of ['fiber-users','fiber-resellers']){
  const part=summarize({...input,workspaceId});equal(fields(part),{total:500,paid:300,remaining:200,totalProfitCost:250,paidProfitCost:150,remainingProfitCost:100,billCount:2,paidCount:1,remainingCount:1,frozenCount:0},'Each selected business sees only its half.');
 }
 equal(fields(summarize({...input,workspaceId:'studio'})),zero,'A nonparticipating business does not inherit the full bill.');
 equal(input,before,'Card reads preserve the original bill/payment/source bytes.');
}
{
 for(const profitBasisPoints of [0,5000,10000]){
  const paid=bill({state:'paid',profitBasisPoints}),unpaid=bill({profitBasisPoints}),value=summarize(options([paid,unpaid]));
  equal([value.total,value.totalProfitCost,value.paidProfitCost,value.remainingProfitCost],[800,800*profitBasisPoints/10000,400*profitBasisPoints/10000,400*profitBasisPoints/10000],'The Admin percentage applies independently of payment principal.');
 }
 const cents=bill({amount:101,profitBasisPoints:5000,weights:{'fiber-users':3333,'fiber-resellers':3333,main:3334}}),input=options([cents]),all=summarize(input),parts=WORKSPACES.map(row=>summarize({...input,workspaceId:row.id}));
 equal([all.total,all.totalProfitCost],[1.01,.51],'Configured half-cent profit rounds once at the bill.');
 equal(parts.reduce((n,row)=>n+Math.round(row.total*100),0),101,'Largest-remainder cents consolidate once.');
 equal(parts.reduce((n,row)=>n+Math.round(row.totalProfitCost*100),0),51,'Main Office remainder and profit cents are preserved.');
}
{
 const frozen=bill({state:'frozen'}),linked=bill({linked:true}),unissued=bill({generated:false}),input=options([frozen,linked,unissued]),before=clone(input),value=summarize(input);
 equal(fields(value),{total:800,paid:0,remaining:800,totalProfitCost:800,paidProfitCost:0,remainingProfitCost:800,billCount:2,paidCount:0,remainingCount:2,frozenCount:1},'Frozen is skipped; linked debt is one obligation; an unissued bill needs no write.');
 equal(input,before,'Reading generated=false neither issues a bill nor writes monthly history.');
 const sole=summarize(options([frozen]));equal(fields(sole),{...zero,frozenCount:1});
}
{
 const paid=bill({state:'paid',actor:OTHER_ADMIN}),unpaid=bill(),input=options([paid,unpaid]),admin=summarize({...input,accountKey:ADMIN}),other=summarize({...input,accountKey:OTHER_ADMIN}),cashier=summarize({...input,accountKey:CASHIER});
 equal([admin.total,admin.paid,admin.remaining],[400,0,400],'Unpaid responsibility uses the saved applicable template Admin.');
 equal([other.total,other.paid,other.remaining],[400,400,0],'Paid responsibility moves to the approving payment Admin.');
 equal(fields(cashier),zero,'A Cashier source holder never inherits Admin profit cost.');
 const ownership=clone(input);delete ownership.owners[paid.billId];equal(summarize(ownership).paid,400,'A completed bill requires its proven actual actor, not a current/future template owner.');
 const mapping=new Map(Object.entries(input.owners));equal(summarize({...input,owners:mapping}).total,800,'Map owner dictionaries also preserve exact scope.');
}
{
 // A September bill paid in October remains in September's cohort. October
 // actual-payment reports still recognize it; this new card never edits that.
 const historical=bill({month:'2026-09',state:'paid',paymentDate:AS_OF,amount:50000,profitBasisPoints:5000}),current=bill({amount:30000,profitBasisPoints:5000}),paymentReport={basis:'fixed_monthly_paid',start:'2026-10-01',end:AS_OF,profitCost:250,paymentIds:[historical.payment.requestId]},before=clone(paymentReport),value=summarize(options([current]));
 equal([value.total,value.paid,value.remaining,value.totalProfitCost],[300,0,300,150],'An older bill paid now is absent from the current billing-month card.');
 equal(paymentReport,before,'The saved actual-payment recognition remains byte-for-byte unchanged.');
 const mixed=options([current,historical]);throws(()=>summarize(mixed),'A mixed-month overview cannot masquerade as one cohort.');
}
{
 const input=options([bill(),bill({state:'paid'}),bill({state:'frozen'})]);
 const mutations=[
  value=>{value.asOf='2026-11-01';},value=>{value.asOf='2026-02-30';},value=>{value.overview.month='2026-09';},value=>{value.workspaceId='unknown';},value=>{value.accountKey=' ';},value=>{value.accountKey=123;},value=>{value.overview.pending=[{requestId:'pending-monthly'}];},
  value=>{delete value.owners[value.overview.bills[0].billId];},value=>{delete value.owners[value.overview.bills[2].billId];},value=>{value.owners[value.overview.bills[0].billId]=' ';},value=>{value.overview.bills[0].state='prepared';},value=>{value.overview.bills[0].pendingRequestId='pending-test';},value=>{value.overview.bills[0].generated='false';},
  value=>{value.overview.bills.push(clone(value.overview.bills[0]));},value=>{value.overview.workspaces.pop();},value=>{value.overview.workspaces[0].id='unknown';},value=>{value.overview.workspaces[1].id='main';},value=>{value.overview.payments=[];},value=>{value.overview.payments.push(clone(value.overview.payments[0]));},
  value=>{value.overview.bills[0].amount=400.001;},value=>{value.overview.bills[0].amountCents=-1;},value=>{value.overview.bills[0].amountCents=Number.MAX_SAFE_INTEGER+1;},value=>{value.overview.bills[0].profitBasisPoints=10001;},value=>{value.overview.bills[0].profitTotalCents--;},value=>{value.overview.bills[0].templateVersion=0;},value=>{value.overview.bills[0].dueDate='2026-11-01';},
  value=>{value.overview.bills[0].allocations[0].workspaceId='unknown';},value=>{value.overview.bills[0].allocations[0].workspaceId=value.overview.bills[0].allocations[1].workspaceId;},value=>{value.overview.bills[0].allocations[0].billShareCents++;},value=>{value.overview.bills[0].allocations[0].profitCostCents++;},value=>{value.overview.bills[0].allocations[0].basisPoints--;},
  value=>{value.overview.bills[1].payment.actorKey=null;},value=>{value.overview.bills[1].payment.noFunding=false;},value=>{value.overview.bills[1].payment.version='3';},value=>{value.overview.bills[1].payment.paymentDate='2026-10-23';},value=>{value.overview.bills[1].payment.allocations[0].profitCostCents--;},value=>{value.overview.bills[1].payment.month='2026-09';},value=>{value.overview.bills[1].payment.requestId='bad';},value=>{value.overview.bills[1].frozen={};},value=>{value.overview.bills[2].frozen=null;},value=>{value.overview.bills[2].frozen={};},value=>{value.overview.bills[2].generated=false;},value=>{value.overview.bills[0].companyDebtId=' ';},
  ...['billCount','paidCount','unpaidCount','frozenCount','totalAmount','paidAmount','unpaidAmount','frozenAmount','profitDeducted','whishFees'].map(field=>value=>{value.overview.totals[field]++;})
 ];
 for(const [index,mutation]of mutations.entries()){const changed=clone(input);mutation(changed);throws(()=>summarize(changed),'Corrupt, stale or pending proof fails closed: '+index);}
}
{
 const high=4500000000000000,one=bill({amount:high}),two=bill({amount:high}),three=bill({amount:high});
 throws(()=>summarize(options([one,two,three])),'BigInt summation detects overflow before showing an imprecise monetary total.');
 const frozen=options([bill({state:'frozen'})]);frozen.owners={};throws(()=>summarize(frozen),'Unknown frozen ownership cannot produce misleading employee counts.');
}
async function coreSeam(){
 const SQL=await require('sql.js')(),crypto=require('node:crypto'),Finance=require('./finance-ledger.cjs'),Whish=require('./whish-destinations.cjs'),Core=require('./fixed-monthly-payments.cjs'),Spending=require('./fixed-monthly-spending.cjs'),q=Finance.query;
 const entries=new Map(WORKSPACES.map((row,index)=>[row.id,{id:row.id,db:new SQL.Database(),ownerId:index*10+1}]));
 for(const entry of entries.values()){
  entry.db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT,username TEXT,full_name TEXT,role TEXT,active INTEGER);
   CREATE TABLE finance_events(id TEXT PRIMARY KEY,kind TEXT,created_at TEXT,effective_at TEXT,actor_key TEXT,from_key TEXT,to_key TEXT,amount_cents INTEGER,note TEXT,input_json TEXT,result_json TEXT);
   CREATE TABLE finance_months(month TEXT PRIMARY KEY);
   CREATE TABLE finance_wallet_entries(id TEXT PRIMARY KEY,event_id TEXT,wallet_id TEXT,account_key TEXT,amount_cents INTEGER,effective_at TEXT);
   CREATE TABLE cash_drawer_transactions(id INTEGER PRIMARY KEY,amount REAL,transaction_type TEXT,reference_type TEXT,reference_id INTEGER,note TEXT,created_at TEXT,user_id INTEGER,user_name TEXT);
   CREATE VIEW active_cash_drawer_transactions AS SELECT * FROM cash_drawer_transactions;
   CREATE TABLE expenses(id INTEGER PRIMARY KEY,amount REAL);
   CREATE TABLE payment_destinations(kind TEXT,record_key TEXT,snapshot_json TEXT);
   CREATE TABLE debt_payments(id INTEGER,kind TEXT,record_id INTEGER,payment_method TEXT,user_id INTEGER,received_at TEXT);
   CREATE TABLE sales(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,payment_method TEXT);
   CREATE VIEW active_sales AS SELECT * FROM sales;
   CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
   CREATE VIEW active_fibernetlb_bills AS SELECT * FROM fibernetlb_bills;
   CREATE TABLE telecom_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
   CREATE VIEW active_telecom_payments AS SELECT * FROM telecom_payments;
   CREATE TABLE installation_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);`);
  for(const [offset,key,role]of [[0,'main:1','admin'],[1,'main:2','cashier'],[2,'main:3','admin']]){
   entry.db.run('INSERT INTO users VALUES(?,?,?,?,?,?)',[entry.ownerId+offset,key,'synthetic-'+key,'Fictional '+key,role,1]);
   entry.db.run('INSERT INTO cash_drawer_transactions(amount,transaction_type,note,created_at,user_id,user_name) VALUES(?,?,?,?,?,?)',[1000,'synthetic_opening','Synthetic opening only','2026-09-20T12:00:00',entry.ownerId+offset,'Fictional '+key]);
  }
  Whish.initializeWhish(entry.db);Core.initialize(entry.db,{main:entry.id==='main'});
 }
 let clock='2026-09-20T12:00:00',actorKey='main:1',saves=0;
 const db=entries.get('main').db,actor=()=>q(db,'SELECT * FROM users WHERE account_key=?',[actorKey])[0],service=new Core.FixedMonthlyPayments({entries,authorize:actor,holders:id=>q(entries.get(id).db,'SELECT * FROM users'),saveEntry:async()=>{saves++;},now:()=>clock});
 const template=requestId=>({requestId,name:'Fictional shared monthly bill',recipient:'Fictional provider',description:'No real debt',amount:500,dueDay:1,participants:[{workspaceId:'fiber-users',basisPoints:5000},{workspaceId:'fiber-resellers',basisPoints:5000}],profitBasisPoints:5000,active:true});
 const saved=await service.saveTemplate(template('qa-dashboard-template-initial')),oldId=saved.templateId+':2026-09';clock=AS_OF+'T12:00:00';
 const digest=()=>[...entries.values()].map(entry=>crypto.createHash('sha256').update(entry.db.export()).digest('hex')).join(':');
 const read=accountKey=>{const current=service.overview({month:'2026-10'}),owners=Object.fromEntries(current.bills.map(row=>[row.billId,service.versionFor(row.templateId,current.month).updatedBy]));return summarize({overview:current,owners,workspaceId:'all',accountKey,asOf:AS_OF});};
 const untouched=digest(),saveCount=saves,unissued=service.overview({month:'2026-10'});equal(unissued.bills[0].generated,false,'The original core emits a future recurring bill read-only.');
 equal([read(null).total,read(null).remaining,read(null).totalProfitCost],[500,500,250]);equal(digest(),untouched,'Actual SQL.js service plus card projection performs zero writes.');equal(saves,saveCount,'Reading the card calls no save hook.');
 async function pay(billId,requestId){const preview=service.preview({billId});return service.pay({requestId,billId,token:preview.token,payments:preview.allocations.filter(row=>row.billShareCents>0).map(row=>({workspaceId:row.workspaceId,sourceAccountKey:actorKey,paymentMethod:'Cash',sourceWalletId:'',deductWhishFee:false})),note:'Synthetic QA only',confirmation:'PAY BILL'});}
 actorKey='main:3';await pay(oldId,'qa-dashboard-old-paid-now');
 const legacy=Spending.summary({entries,workspaceId:'all',start:'2026-10-01',end:AS_OF,accountKey:null}),legacyBefore=clone(legacy),oldProof=JSON.stringify(Core.projectionRows({entries}));
 equal(legacy.profitCost,250,'The original actual-date projection recognizes the old bill paid this month.');equal([read(null).paid,read(null).remaining],[0,500],'The current billing-month cohort does not absorb an older bill paid today.');
 await pay(saved.templateId+':2026-10','qa-dashboard-current-paid');
 const proofBefore=JSON.stringify(Core.projectionRows({entries})),paidBytes=digest(),paidSaves=saves;
 equal([read(null).total,read(null).paid,read(null).remaining,read(null).paidProfitCost],[500,500,0,250],'A real completed core DTO matches the pure card protocol.');
 equal(read('main:1').paid,0,'The template creator does not retain responsibility after another Admin pays.');equal(read('main:3').paid,500,'Actual approving Admin owns the paid allocation.');equal(read('main:2').total,0,'An actual Cashier account never inherits Admin cost.');
 equal(digest(),paidBytes,'Completed proof, receipts, cash, funding and all SQLite bytes remain unchanged by repeated card reads.');equal(saves,paidSaves);equal(JSON.stringify(Core.projectionRows({entries})),proofBefore,'Legacy actual-payment proof is unchanged.');
 equal(legacy,legacyBefore,'An already-produced actual-period report DTO is untouched.');assert(oldProof.includes('2026-09'));checks++;
 const actual=Spending.summary({entries,workspaceId:'all',start:'2026-10-01',end:AS_OF,accountKey:null});equal(actual.profitCost,500,'Actual-month reports still recognize both completed payments, unlike the single current-month card.');
 for(const entry of entries.values())entry.db.close();
}
coreSeam().then(()=>console.log('PASS fixed-monthly-dashboard: '+checks+' read-only billing-month, scope, exact-cent, core SQL.js seam and fail-closed assertions.')).catch(error=>{console.error(error);process.exitCode=1;});
