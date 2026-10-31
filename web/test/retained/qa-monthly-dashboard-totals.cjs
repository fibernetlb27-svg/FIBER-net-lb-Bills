'use strict';
// Fictional, read-only presentation contract. No files, databases, providers,
// source instructions or actual financial records are created or modified.
const assert=require('node:assert/strict');
const Totals=require('./consolidated-finance.cjs');
const clone=value=>structuredClone(value);
const fixed=(billShare=400,profitCost=200,fee=4,custodyPaid=400)=>({basis:'fixed_monthly_paid',billShare,profitCost,fee,custodyPaid,pendingCount:0});
function overview(monthly,{gross=1000,cash=0,wallet=600,other=10,debt=null,bandwidth=0,supplierPaid=0}={}){
 const monthlyFee=monthly?.fee||0,debtFee=debt?.fee||0,whishFees=1+monthlyFee+debtFee;
 return {...monthly?{fixedMonthly:clone(monthly)}:{},...debt?{companyDebt:clone(debt)}:{},report:{revenue:gross,costOfGoods:0,grossProfit:gross,expenses:other+1,whishFees,netProfit:gross-other-whishFees-(monthly?.profitCost||0)},dashboard:{drawer:{balance:cash}},wallets:[{balance:wallet}],bandwidthCost:{incurredCost:bandwidth},bandwidthSpending:{paid:supplierPaid,pendingCount:0}};
}
const section=id=>({id,name:id});
const total=(id,value)=>Totals.businessTotals(section(id),value);
const combine=rows=>Totals.sumBusinessTotals(rows.map(([id,value])=>({section:section(id),overview:value})));

{
 const input=overview(fixed()),before=clone(input),result=total('fiber-users',input);
 assert.equal(result.fixedMonthlyPaid,400,'The card receives the full paid participation share.');
 assert.equal(result.fixedMonthlyProfitCost,200,'The separate profit deduction retains Admin’s configured 50%.');
 assert.equal(result.fixedMonthlyFees,4);
 assert.equal(result.whishFees,5,'The optional monthly fee remains in mandatory Whish fees.');
 assert.equal(result.otherExpenses,10,'Monthly fees and principal never become Other expenses.');
 assert.equal(result.profitBeforeOther,795);
 assert.equal(result.profitAfterOther,785);
 assert.equal(result.profitBeforeOther+result.fixedMonthlyProfitCost,995,'Unchecked monthly display can restore exactly the configured deduction, not the $400 source debit or fee.');
 assert.equal(result.profitAfterOther+result.fixedMonthlyProfitCost,985);
 assert.equal(result.cash,0);assert.equal(result.wallets,600);
 assert.deepEqual(input,before,'Presentation fields leave source report, balances and monthly history unchanged.');
 for(const profitCost of [0,400]){
  const variant=total('fiber-users',overview(fixed(400,profitCost)));
  assert.equal(variant.fixedMonthlyPaid,400);
  assert.equal(variant.fixedMonthlyProfitCost,profitCost);
  assert.equal(variant.profitBeforeOther,995-profitCost);
 }
 const reportOnly=clone(input);reportOnly.report.fixedMonthly=reportOnly.fixedMonthly;delete reportOnly.fixedMonthly;
 assert.deepEqual(total('fiber-users',reportOnly),result,'Report-embedded projection and overview projection expose identical presentation fields.');
}
{
 const input=overview(fixed()),result=total('fiber-resellers',input);
 assert.equal(result.fixedMonthlyPaid,400);assert.equal(result.fixedMonthlyProfitCost,200);
 assert.equal(result.profitBeforeOther,795,'Resellers restores the already-debited $400 before charging only its $200 profit allocation and mandatory fee.');
 assert.equal(result.profitAfterOther,785);assert.equal(result.wallets,600);
 const oldRoute=total('fiber-resellers',overview(fixed(100,50,4,400)));
 assert.equal(oldRoute.fixedMonthlyPaid,100,'Historical V1 source debit may exceed this business’s paid allocation; it is not the card value.');
 assert.equal(oldRoute.profitBeforeOther,945);
}
{
 const users=overview(fixed(200,100,0,200),{wallet:800}),resellers=overview(fixed(200,100,2,200),{wallet:800}),result=combine([['fiber-users',users],['fiber-resellers',resellers]]);
 assert.equal(result.fixedMonthlyPaid,400,'Two $200 participant allocations consolidate one $400 bill, not two full bills.');
 assert.equal(result.fixedMonthlyProfitCost,200);assert.equal(result.fixedMonthlyFees,2);assert.equal(result.whishFees,4);
 assert.equal(result.profitBeforeOther,1796);assert.equal(result.profitAfterOther,1776);
 assert.equal(result.cash,0);assert.equal(result.wallets,1600);assert.equal(result.otherExpenses,20);
 const supplied=Totals.sumBusinessTotals([['fiber-users',users],['fiber-resellers',resellers]].map(([id,value])=>({section:section(id),overview:{dashboardTotals:total(id,value)}})));
 assert.deepEqual(supplied,result,'Cached independent dashboard DTOs retain the same allocation-based paid sum.');
}
{
 const debt={basis:'company_debt_paid',profitCost:0,fee:1,custodyPaid:100,pendingCount:0},input=overview(fixed(),{wallet:500,debt}),result=total('fiber-resellers',input);
 assert.equal(result.fixedMonthlyPaid,400);assert.equal(result.fixedMonthlyProfitCost,200);
 assert.equal(result.companyDebtFees,1);assert.equal(result.whishFees,6);assert.equal(result.otherExpenses,10);
 assert.equal(result.profitBeforeOther,794,'Company debt principal is neutralized separately; only its $1 fee adds to profit cost.');
 assert.equal(result.profitAfterOther,784);assert.equal(result.wallets,500);
}
{
 const absent={...Totals.emptyOverview(),fixedMonthly:fixed(200,100,2,0)},result=total('studio',absent);
 assert.equal(result.fixedMonthlyPaid,200);assert.equal(result.fixedMonthlyProfitCost,100);
 assert.equal(result.profitBeforeOther,-102);assert.equal(result.profitAfterOther,-102);assert.equal(result.cash,0);assert.equal(result.wallets,0);
 absent.fixedMonthly.pendingCount=1;const pending=total('studio',absent);
 assert.equal(pending.profitKnown,false);assert.equal(pending.profitBeforeOther,null);assert.equal(pending.fixedMonthlyPaid,200);
}
{
 const empty=total('fiber-users',overview(fixed(0,0,0,0)));
 assert.equal(empty.fixedMonthlyPaid,0);assert.equal(empty.fixedMonthlyProfitCost,0);
 const opening=total('fiber-resellers',overview(fixed(0,0,0,400)));
 assert.equal(opening.fixedMonthlyPaid,0,'Earlier custody add-back is not new paid-month expense.');
 assert.equal(opening.profitBeforeOther,999);
 const noProjection=total('printer',overview(null));assert(!('fixedMonthlyPaid' in noProjection));
 const combined=combine([['fiber-users',overview(fixed())],['printer',overview(null)]]);
 assert.equal(combined.fixedMonthlyPaid,400,'A business without a monthly projection does not duplicate another business’s paid amount.');
}
for(const billShare of [undefined,null,'400',NaN,Infinity,-1,-0.001,0.001,Number.MAX_SAFE_INTEGER]){
 const input=overview(fixed());input.fixedMonthly.billShare=billShare;
 assert.throws(()=>total('fiber-users',input),/unavailable|supported range|could not be verified/,'Invalid paid amount is never silently shown as zero.');
 const cached=total('fiber-users',overview(fixed()));cached.fixedMonthlyPaid=billShare;
 assert.throws(()=>Totals.sumBusinessTotals([{section:section('fiber-users'),overview:{dashboardTotals:cached}}]),/unavailable|supported range|could not be verified/,'Invalid cached paid amount blocks consolidation.');
}
assert.throws(()=>total('fiber-users',overview(fixed(100,101))),/could not be verified/,'A configured deduction cannot exceed the paid allocation.');
for(const field of ['fixedMonthlyProfitCost','fixedMonthlyFees'])for(const value of [undefined,null,NaN,-1,0.001]){
 const cached=total('fiber-users',overview(fixed()));cached[field]=value;
 assert.throws(()=>Totals.sumBusinessTotals([{section:section('fiber-users'),overview:{dashboardTotals:cached}}]),/unavailable|could not be verified/,'A malformed cached monthly cost/fee must not use the old zero fallback.');
}
{
 const cached=total('fiber-users',overview(fixed()));cached.fixedMonthlyProfitCost=401;
 assert.throws(()=>Totals.sumBusinessTotals([{section:section('fiber-users'),overview:{dashboardTotals:cached}}]),/could not be verified/);
}
assert.throws(()=>combine([['fiber-users',overview(fixed(Number.MAX_SAFE_INTEGER/200,0,0,0))],['studio',overview(fixed(Number.MAX_SAFE_INTEGER/200,0,0,0))],['printer',overview(fixed(Number.MAX_SAFE_INTEGER/200,0,0,0))]]),/supported range|could not be verified/,'Combined paid totals must remain safe cents.');
console.log('Monthly dashboard totals QA passed: paid allocation separate from Admin profit percentage; existing authoritative profit/Other modes unchanged; mandatory fee and source custody neutralization once; split-business allocation sum, employee absence, prior custody, Company debt independence, immutable inputs and invalid/unsafe totals fail closed. Synthetic read-only presentation only.');
