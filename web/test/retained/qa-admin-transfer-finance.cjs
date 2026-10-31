'use strict';
// Pure, synthetic custody presentation checks. No live records or writes.
const assert=require('node:assert/strict'),{businessTotals,sumBusinessTotals}=require('./consolidated-finance.cjs');
const section={id:'fiber-resellers',name:'Resellers'},accountKey='main:synthetic-admin',through='2026-11-03';
const projection=(netOut,extra={})=>({basis:'admin_transfer_custody',workspaceId:section.id,accountKey,through,custodyStart:null,netOut,...extra});
const view=(cash=200,wallet=100,extra={})=>({accountKey,today:through,report:{revenue:1200,grossProfit:999999,expenses:15,whishFees:5},dashboard:{drawer:{balance:cash}},wallets:[{balance:wallet}],bandwidthCost:{incurredCost:50},bandwidthSpending:{paid:10,pendingCount:0},...extra});
const total=value=>businessTotals(section,value),base=total(view());assert.equal(base.profitBeforeOther,255);
for(const [cash,wallet,netOut]of [[125,100,75],[200,25,75],[275,100,-75],[200,175,-75],[225,90,-15],[200,100,0]]){
 const source=view(cash,wallet,{adminTransferCustody:projection(netOut)}),saved=JSON.stringify(source),result=total(source);
 assert.equal(result.profitBeforeOther,base.profitBeforeOther);assert.equal(result.profitAfterOther,base.profitAfterOther);
 assert.equal(result.cash,cash);assert.equal(result.wallets,wallet);assert.equal(result.whishFees,5);assert.equal(result.otherExpenses,10);assert.equal(JSON.stringify(source),saved);
}
// Same-business custody between holders must preserve each scoped profit and
// the complete business total. No transfer principal becomes new revenue.
const originalA=view(100,0),originalB=view(100,0),movedA=view(60,0,{adminTransferCustody:projection(40)}),movedB=view(140,0,{adminTransferCustody:projection(-40)});
assert.equal(total(originalA).profitBeforeOther,total(movedA).profitBeforeOther);assert.equal(total(originalB).profitBeforeOther,total(movedB).profitBeforeOther);
assert.equal(total(view(200,0,{accountKey:null,adminTransferCustody:projection(0,{accountKey:null})})).cash,200);
// After closing a month, carried principal and older transfers cannot reappear
// as new income. Bank and ordinary transfers share the same custody horizon.
const opening={basis:'month_opening_custody',workspaceId:section.id,accountKey,through,month:'2026-10',openingDate:'2026-11-01',mode:'carry_forward',cash:80,wallets:20,total:100};
const bank={basis:'bank_internal_custody',workspaceId:section.id,accountKey,through,custodyStart:'2026-11-01',netDeposits:0};
const fresh=(cash,wallet,netOut,netDeposits=0)=>view(cash,wallet,{report:{revenue:0,grossProfit:0,expenses:0,whishFees:0},bandwidthCost:{incurredCost:0},bandwidthSpending:{paid:0,pendingCount:0},monthOpening:opening,bankCustody:{...bank,netDeposits},adminTransferCustody:projection(netOut,{custodyStart:'2026-11-01'})});
assert.equal(total(fresh(80,20,0)).profitBeforeOther,0);
assert.equal(total(fresh(40,20,40)).profitBeforeOther,0);
assert.equal(total(fresh(120,20,-40)).profitBeforeOther,0);
assert.equal(total(fresh(20,20,40,20)).profitBeforeOther,0,'Bank and other custody flows compensate independently once.');
assert.equal(total(fresh(50,20,40)).profitBeforeOther,10,'Only new money earned above the opening appears as profit.');
for(const workspaceId of ['main','fiber-users','printer','studio']){
 const ordinary={id:workspaceId,name:workspaceId},source=view(20,0,{report:{revenue:100,grossProfit:30,expenses:1,whishFees:1},bandwidthCost:{incurredCost:0},adminTransferCustody:projection(999,{workspaceId})});
 assert.equal(businessTotals(ordinary,source).profitBeforeOther,29,'Report-based profit does not add custody transfers.');
}
const printer={id:'printer',name:'Printer'},printerView=view(95,0,{report:{revenue:100,grossProfit:30,expenses:1,whishFees:1},bandwidthCost:{incurredCost:0},adminTransferCustody:projection(-75,{workspaceId:'printer'})});
const combined=sumBusinessTotals([{section,overview:view(125,100,{adminTransferCustody:projection(75)})},{section:printer,overview:printerView}]);assert.equal(combined.profitBeforeOther,base.profitBeforeOther+29);assert.equal(combined.cash,220);assert.equal(combined.wallets,100);
for(const broken of [null,{...projection(1),basis:'intercompany_revenue'},{...projection(1),workspaceId:'fiber-users'},{...projection(1),accountKey:'wrong-holder'},{...projection(1),through:'2026-11-04'},{...projection(1),through:'2026-02-30'},{...projection(1),custodyStart:'2026-11-04'},...['1',null,NaN,Infinity,.001,Number.MAX_SAFE_INTEGER].map(netOut=>({...projection(1),netOut}))])assert.throws(()=>total(view(200,100,{adminTransferCustody:broken})),/Admin transfer custody/);
assert.throws(()=>total({...fresh(80,20,0),adminTransferCustody:projection(0)}),/Admin transfer custody/,'A mismatched monthly cutoff is never guessed.');
const pending=view(125,100,{adminTransferCustody:projection(75),bandwidthSpending:{paid:10,pendingCount:1}});assert.equal(total(pending).profitKnown,false);assert.equal(total(pending).profitBeforeOther,null);
console.log('Admin transfer finance QA passed: inbound/outbound Cash and Whish principal neutral, same-business holder and cross-business totals conserved, opening/Bank horizons agree, old money excluded from new profit, report-based businesses unchanged, exact cents and malformed scope/date proofs rejected, pending states preserved.');
