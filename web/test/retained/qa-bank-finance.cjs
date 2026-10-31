'use strict';
// Synthetic Bank custody projections only: no live databases or financial writes.
const assert=require('node:assert/strict');
const {businessTotals,sumBusinessTotals}=require('./consolidated-finance.cjs');
const section={id:'fiber-resellers',name:'FIBER net lb Resellers'};
const today='2026-10-29',accountKey='main:admin-example';
const projection=(netDeposits,extra={})=>({basis:'bank_internal_custody',workspaceId:section.id,accountKey,through:today,custodyStart:null,netDeposits,...extra});
const view=(cash=200,wallet=100,extra={})=>({accountKey,today,report:{revenue:1200,grossProfit:999999,expenses:15,whishFees:5},dashboard:{drawer:{balance:cash}},wallets:[{balance:wallet}],bandwidthCost:{incurredCost:50},bandwidthSpending:{paid:10,pendingCount:0},...extra});
const totals=value=>businessTotals(section,value);
const before=view(),snapshot=JSON.stringify(before),base=totals(before);
assert.equal(base.profitBeforeOther,255);
assert.equal(base.profitAfterOther,245);
for(const [cash,wallet,saved]of [[125,100,75],[200,25,75],[100,50,150],[225,100,-25],[200,125,-25]]){
 const source=view(cash,wallet,{bankCustody:projection(saved)}),original=JSON.stringify(source),actual=totals(source);
 assert.equal(actual.profitBeforeOther,base.profitBeforeOther,'Moving money to/from Bank must not change Resellers profit.');
 assert.equal(actual.profitAfterOther,base.profitAfterOther);
 assert.equal(actual.cash,cash);assert.equal(actual.wallets,wallet);
 assert.equal(actual.whishFees,base.whishFees);assert.equal(actual.otherExpenses,base.otherExpenses);
 assert.equal(JSON.stringify(source),original,'The Bank adjustment is presentation-only.');
}
assert.equal(JSON.stringify(before),snapshot);
// Older Bank savings remain assets. After monthly zero opening they cannot be
// treated as new-month earnings. A withdrawal has a negative custody adjustment.
const november='2026-11-03',reset={today:november,bankCustody:projection(0,{through:november,custodyStart:'2026-11-01'})};
const emptyMonth=view(0,0,{...reset,report:{revenue:0,grossProfit:0,expenses:0,whishFees:0},bandwidthCost:{incurredCost:0},bandwidthSpending:{paid:0,pendingCount:0}});
assert.equal(totals(emptyMonth).profitBeforeOther,0);
assert.equal(totals({...emptyMonth,dashboard:{drawer:{balance:40}},bankCustody:{...reset.bankCustody,netDeposits:-40}}).profitBeforeOther,0,'Withdrawing $40 of older savings is not current-month revenue/profit.');
// Net deposits are the entire current custody horizon, not merely a narrowed
// report range, because the drawer balance is cumulative since its last reset.
const period=view(75,100,{bankCustody:projection(125,{custodyStart:'2026-10-01'}),report:{revenue:0,grossProfit:0,expenses:5,whishFees:5}});
assert.equal(totals(period).profitBeforeOther,base.profitBeforeOther);
const penny=view(.10,.20,{bankCustody:projection(.30),report:{revenue:0,grossProfit:0,expenses:0,whishFees:0},bandwidthCost:{incurredCost:0},bandwidthSpending:{paid:0,pendingCount:0}});
assert.equal(totals(penny).profitBeforeOther,.60);
for(const workspaceId of ['main','fiber-users','printer','studio']){
 const ordinary={id:workspaceId,name:workspaceId},source=view(100,50,{bankCustody:projection(150,{workspaceId}),report:{revenue:700,grossProfit:80,expenses:3,whishFees:1},bandwidthCost:{incurredCost:0}}),original=JSON.stringify(source),result=businessTotals(ordinary,source);
 assert.equal(result.profitBeforeOther,79,'Report-based businesses must not add Bank assets or transfers into profit.');
 assert.equal(JSON.stringify(source),original);
}
const resellerMoved=view(125,100,{bankCustody:projection(75)}),printer={id:'printer',name:'Printer'},printerView=view(20,0,{bankCustody:projection(20,{workspaceId:'printer'}),report:{revenue:100,grossProfit:30,expenses:1,whishFees:1}});
const combined=sumBusinessTotals([{section,overview:resellerMoved},{section:printer,overview:printerView}]);
assert.equal(combined.profitBeforeOther,base.profitBeforeOther+29);
assert.equal(combined.cash,145);assert.equal(combined.wallets,100);
for(const malformed of [null,{...projection(1),basis:'all_time_bank_balance'},{...projection(1),workspaceId:'fiber-users'},{...projection(1),accountKey:'someone-else'},{...projection(1),through:'2026-10-28'},{...projection(1),through:'2026-02-30'},{...projection(1),custodyStart:'2026-10-30'},...['1',null,NaN,Infinity,.001,Number.MAX_SAFE_INTEGER].map(netDeposits=>({...projection(1),netDeposits}))]){
 assert.throws(()=>totals(view(200,100,{bankCustody:malformed})),/Bank custody totals could not be verified/);
}
const pending=view(125,100,{bankCustody:projection(75),bandwidthSpending:{paid:10,pendingCount:1}});
assert.equal(totals(pending).profitKnown,false);assert.equal(totals(pending).profitBeforeOther,null,'Bank assets cannot make an unrelated pending payment appear verified.');
console.log('Bank finance QA passed: Cash/Whish deposit and withdrawal neutrality, reset-horizon and older-savings withdrawal behavior, holder/business/date proof isolation, report-based business profits unchanged, exact cents, combined totals, no input mutation, malformed proofs rejected and pending states preserved. Synthetic only.');
