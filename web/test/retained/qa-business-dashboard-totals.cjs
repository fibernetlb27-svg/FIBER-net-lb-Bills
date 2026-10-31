'use strict';
// Pure synthetic dashboard accounting. No live data, mutations or provider.
const assert=require('node:assert/strict'),{businessTotals,sumBusinessTotals,emptyOverview}=require('./consolidated-finance.cjs');
const sections=['main','fiber-users','fiber-resellers','iptv','printer','studio','mobile-ogero'].map(id=>({id,name:id}));
const view=(values={})=>({report:{grossProfit:0,expenses:0,whishFees:0,...values.report},dashboard:{drawer:{balance:values.cash||0}},wallets:[{balance:values.wallet||0}],bandwidthCost:{incurredCost:200},bandwidthSpending:{paid:0,pendingCount:0},...values});
const sources=[view({report:{grossProfit:0,expenses:230,whishFees:0}}),view({cash:400,wallet:100,report:{grossProfit:160,expenses:11,whishFees:1}}),view({cash:500,wallet:50,report:{grossProfit:999999,expenses:7.5,whishFees:2.5}}),view({report:{grossProfit:30,expenses:3,whishFees:0}}),view({report:{grossProfit:40,expenses:4,whishFees:0}}),view({report:{grossProfit:20,expenses:2,whishFees:0}}),view({report:{grossProfit:10,expenses:1,whishFees:0}})],before=JSON.stringify(sources);
const contributions=()=>sections.map((section,index)=>({section,overview:sources[index]})),all=()=>sumBusinessTotals(contributions());
const totals=all();
assert.deepEqual(totals,{basis:'business_sum',cash:900,wallets:150,whishFees:3.5,otherExpenses:55,profitBeforeOther:606.5,profitAfterOther:551.5,profitKnown:true,pendingCount:0});
assert.equal(businessTotals(sections[0],sources[0]).otherExpenses,30,'Physical Main BW expense is allocated to Resellers, not optional Other.');
assert.equal(businessTotals(sections[2],sources[2]).profitBeforeOther,347.5,'R uses its independently shown custody formula, not report gross profit.');
for(const key of ['cash','wallets','whishFees','otherExpenses','profitBeforeOther','profitAfterOther'])assert.equal(Math.round(totals[key]*100),contributions().reduce((sum,row)=>sum+Math.round(businessTotals(row.section,row.overview)[key]*100),0));
assert.equal(JSON.stringify(sources),before,'Dashboard calculations cannot alter any input report or wallet.');
// A partial supplier settlement moves custody, not incurred cost a second time.
sources[2].dashboard.drawer.balance-=50;sources[2].bandwidthSpending={paid:50,pendingCount:0};assert.deepEqual({...all(),cash:900},totals);
sources[2].bandwidthSpending.pendingCount=1;let unknown=all();assert.equal(unknown.profitKnown,false);assert.equal(unknown.profitBeforeOther,null);assert.equal(unknown.profitAfterOther,null);assert.equal(unknown.pendingCount,1);assert.equal(unknown.cash,850);assert.equal(unknown.otherExpenses,55);
sources[2].bandwidthSpending.pendingCount=0;delete sources[2].bandwidthCost;unknown=all();assert.equal(unknown.profitBeforeOther,null);assert.equal(unknown.otherExpenses,55);
delete sources[0].bandwidthCost;unknown=all();assert.equal(unknown.otherExpenses,null);assert.equal(unknown.profitAfterOther,null);
// Legitimately missing employees have no invented cash, wallets or earnings.
const absent=emptyOverview();assert.equal(businessTotals(sections[2],absent).profitBeforeOther,0);const virtual={...absent,bandwidthCost:{incurredCost:12.34}};assert.deepEqual(businessTotals(sections[2],virtual),{basis:'independent_business',cash:0,wallets:0,whishFees:0,otherExpenses:0,profitBeforeOther:-12.34,profitAfterOther:-12.34,profitKnown:true,pendingCount:0});
const pennies=sections.map(section=>({section,overview:view({cash:.1,wallet:.2,report:{grossProfit:.3,expenses:.02,whishFees:.01},bandwidthCost:{incurredCost:0},bandwidthSpending:{paid:0,pendingCount:0}})}));assert.equal(sumBusinessTotals(pennies).cash,.7);assert.equal(sumBusinessTotals(pennies).wallets,1.4);assert.equal(sumBusinessTotals(pennies).whishFees,.07);assert.equal(sumBusinessTotals(pennies).profitBeforeOther,2.03);assert.equal(sumBusinessTotals(pennies).profitAfterOther,1.96);
for(const bad of [null,undefined,NaN,Infinity,'1'])assert.throws(()=>businessTotals(sections[1],view({report:{grossProfit:bad,expenses:0,whishFees:0}})),/unavailable/);
assert.throws(()=>businessTotals(sections[2],view({bandwidthSpending:{paid:0,pendingCount:-1}})),/count is unavailable/);
assert.throws(()=>sumBusinessTotals(sections.map(section=>({section,overview:view({cash:50000000000000,report:{grossProfit:0,expenses:0,whishFees:0},bandwidthCost:{incurredCost:0}})}))),/supported range/);
const max=Number.MAX_SAFE_INTEGER/100,mixed=[max,.02,-max].map(value=>({section:{id:'printer'},overview:{dashboardTotals:{basis:'independent_business',cash:0,wallets:0,whishFees:0,otherExpenses:0,profitBeforeOther:value,profitAfterOther:value,profitKnown:true,pendingCount:0}}}));assert.equal(sumBusinessTotals(mixed).profitBeforeOther,.02,'Mixed-sign intermediate sums cannot lose a cent before cancellation.');
console.log('Independent business dashboard unit QA passed: exact-cent sums, individual R policy, optional Other toggle, bandwidth allocation once, settlement add-back, missing and pending unavailable profits, absent-employee allocated cost, validation and unchanged source objects. Synthetic only.');
