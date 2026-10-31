'use strict';
// Fictional projection contracts only. Actual original-ledger payment proofs,
// Main/preload/LAN authorization and restart behavior are tested separately.
// No database, source movement, provider or live customer is used here.
const assert=require('node:assert/strict'),Module=require('node:module');
const Spending=require('./company-debt-spending.cjs');
const originalLoad=Module._load,clone=value=>structuredClone(value),entries=new Map([['main',{fictional:true}]]),ADMIN='fictional-admin-owner',OTHER_ADMIN='fictional-admin-other',CASHIER='fictional-cashier-holder',AS_OF='2026-10-24';
let rows={payments:[],pending:[]},reads=0,checks=0;
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const rejects=(run,label)=>{assert.throws(run,/could not be verified|saved Company debt payment|Fictional proof failure/,label);checks++;};
Module._load=function(name,parent,...args){
 if(name==='./company-debts.cjs'&&parent?.filename.endsWith('company-debt-spending.cjs'))return {projectionRows({entries:provided}){assert.equal(provided,entries);reads++;if(rows.throw)throw Error('Fictional proof failure');return clone(rows);}};
 return originalLoad.call(this,name,parent,...args);
};
let serial=0;
function payment(overrides={}){const requestId='fictional-paid-debt-'+(++serial);return {requestId,version:2,debtId:'fictional-existing-debt',effectiveAt:AS_OF+'T12:00:00',paymentDate:AS_OF,actorKey:ADMIN,sourceWorkspaceId:'fiber-users',sourceAccountKey:CASHIER,sourceUserId:73,sourceRole:'cashier',paymentMethod:'Whish Money',sourceWalletId:'fictional-wallet',amountCents:20000,feeCents:200,state:'completed',creditor:'Fictional private creditor',...overrides};}
const options=overrides=>({entries,workspaceId:'all',accountKey:null,start:'2026-10-01',end:AS_OF,asOf:AS_OF,...overrides});
const request=overrides=>Spending.dashboardPaid(options(overrides));
const principal=value=>[value.paidPrincipal,value.paidProfitCost,value.count];
try{
 const empty=request();equal(principal(empty),[0,0,0],'An empty verified ledger is a known zero.');
 equal(empty,{basis:'manual_company_debt_paid',workspaceId:'all',accountKey:null,start:'2026-10-01',end:AS_OF,asOf:AS_OF,paidPrincipal:0,paidProfitCost:0,count:0,pendingCount:0,readOnly:true,noRevenue:true,noFunding:true,recognition:'actual_payment_date',ownership:'approving_admin',linkedMonthlyExcluded:true,feesExcluded:true});
 const whish=payment(),cash=payment({amountCents:725,feeCents:0,paymentMethod:'Cash',sourceWalletId:''}),otherActor=payment({actorKey:OTHER_ADMIN,sourceAccountKey:OTHER_ADMIN,sourceRole:'admin',amountCents:3150,feeCents:31,sourceWorkspaceId:'studio'}),reseller=payment({sourceWorkspaceId:'fiber-resellers',sourceAccountKey:ADMIN,sourceRole:'admin',amountCents:10001,feeCents:100});
 rows={payments:[whish,cash,otherActor,reseller],pending:[]};const before=clone(rows),all=request();
 equal(principal(all),[338.76,338.76,4],'Principal combines exact Cash and Whish installments across businesses.');
 equal(principal(request({workspaceId:'fiber-users'})),[207.25,207.25,2]);equal(principal(request({workspaceId:'fiber-resellers'})),[100.01,100.01,1]);equal(principal(request({workspaceId:'studio'})),[31.5,31.5,1]);equal(principal(request({workspaceId:'main'})),[0,0,0]);
 equal(principal(request({accountKey:ADMIN})),[307.26,307.26,3]);equal(principal(request({accountKey:OTHER_ADMIN})),[31.5,31.5,1]);equal(principal(request({accountKey:CASHIER})),[0,0,0],'A Cashier supplying the money is not the approving Admin profit owner.');
 equal(principal(request({workspaceId:'fiber-users',accountKey:ADMIN})),[207.25,207.25,2]);equal(principal(request({workspaceId:'fiber-users',accountKey:OTHER_ADMIN})),[0,0,0]);
 equal(rows,before,'The original projection is not mutated.');
 for(const field of ['payments','paymentIds','requestId','debtId','creditor','actorName','sourceAccountKey','sourceUserId','sourceWalletId','sourceWalletNumber'])equal(Object.hasOwn(all,field),false,'Card DTO excludes private source/payee/payment details: '+field);
 equal(JSON.stringify(all).includes('Fictional private creditor'),false);
 // Version 1 is an original full repayment, version 2 a proven installment.
 rows={payments:[payment({version:1,sourceWorkspaceId:'main',sourceAccountKey:ADMIN,sourceRole:'admin',amountCents:15000,feeCents:150})],pending:[]};equal(principal(request()),[150,150,1]);
 rows={payments:[payment({amountCents:1,feeCents:0})],pending:[]};equal(principal(request()),[0.01,0.01,1],'One-cent installments stay exact.');
 const date=(value,overrides={})=>payment({paymentDate:value,effectiveAt:value+'T12:00:00',amountCents:100,feeCents:0,...overrides});
 rows={payments:[date('2026-09-30'),date('2026-10-01'),date('2026-10-23'),date(AS_OF),date('2026-10-25'),date('2026-11-01')],pending:[]};equal(principal(request()),[3,3,3],'Actual payment dates, not original debt dates, determine the current month.');
 equal(principal(request({start:'2026-11-01',end:'2026-11-15',asOf:'2026-11-15'})),[1,1,1]);
 // Deduction principal excludes all optional Whish fees, including the maximum
 // valid recorded fee. Existing reports stay fee-only, never this UI choice.
 rows={payments:[payment({feeCents:20000})],pending:[]};equal(principal(request()),[200,200,1]);
 const summaryBefore=Spending.summary({entries,workspaceId:'fiber-users',start:'2026-10-01',end:AS_OF,accountKey:ADMIN}),reportBefore={revenue:1000,grossProfit:1000,costOfGoods:0,expenses:0,whishFees:0,netProfit:1000,profitParts:[]},report=Spending.applyToReport(reportBefore,summaryBefore);
 request();equal(summaryBefore.profitCost,0);equal(summaryBefore.custodyPaid,0);equal(summaryBefore.fee,200);equal(report.netProfit,800);equal(report.companyDebt.profitCost,0);equal(reportBefore.netProfit,1000);equal(Spending.summary({entries,workspaceId:'fiber-users',start:'2026-10-01',end:AS_OF,accountKey:ADMIN}),summaryBefore,'Card reads never rewrite report recognition.');
 // Linked monthly debt payments never enter the manual core projection. An
 // unexpected linked/non-manual row is rejected, not silently counted twice.
 rows={payments:[payment({kind:'monthly'})],pending:[]};rejects(()=>request(),'A linked monthly row cannot masquerade as manual debt principal.');
 rows={payments:[],pending:[]};equal(principal(request()),[0,0,0],'A linked obligation handled only by monthly engine adds no manual debt deduction.');
 const pending={requestId:'fictional-pending-debt',version:2,kind:'payment',actorKey:ADMIN,sourceWorkspaceId:'fiber-users',sourceHolders:[{workspaceId:'fiber-users',accountKey:CASHIER}]};
 rows={payments:[],pending:[pending]};rejects(()=>request());rejects(()=>request({workspaceId:'fiber-users',accountKey:ADMIN}));equal(principal(request({workspaceId:'fiber-resellers'})),[0,0,0]);equal(principal(request({workspaceId:'fiber-users',accountKey:OTHER_ADMIN})),[0,0,0]);
 equal(principal(request({workspaceId:'fiber-users',accountKey:CASHIER})),[0,0,0],'Unrelated holder cost ownership is not invented by a pending repayment.');
 rows={payments:[],pending:[{requestId:'fictional-global-pending',global:true}]};rejects(()=>request({workspaceId:'studio',accountKey:OTHER_ADMIN}));
 rows={payments:[payment()],pending:[pending]};rejects(()=>request(),'Completed principal must not be offered while its scoped saved payment is unresolved.');
 rows={payments:[],pending:[]};
 for(const bad of [undefined,null,[],1,'all'])rejects(()=>Spending.dashboardPaid(bad));
 for(const changed of [{entries:null},{entries:{}},{workspaceId:'missing'},{workspaceId:null},{accountKey:''},{accountKey:' x'},{accountKey:'x '},{accountKey:'x\n'},{accountKey:1},{accountKey:true},{start:'2026-09-01'},{start:'2026-10-02'},{start:'2026-02-30'},{end:'2026-10-23'},{asOf:'2026-10-25'},{asOf:'2026-02-30'},{unknown:true},{start:null},{end:null},{asOf:null}])rejects(()=>request(changed));
 const symbolic=options();symbolic[Symbol('unknown')]=true;rejects(()=>Spending.dashboardPaid(symbolic));
 const implicit=options();delete implicit.accountKey;equal(Spending.dashboardPaid(implicit).accountKey,null);
 for(const mutation of [row=>{row.amountCents=0;},row=>{row.amountCents=1.1;},row=>{row.amountCents=-1;},row=>{row.feeCents=-1;},row=>{row.feeCents=row.amountCents+1;},row=>{row.state='prepared';},row=>{row.version=3;},row=>{row.paymentDate='2026-02-30';},row=>{row.sourceWorkspaceId='missing';},row=>{row.sourceRole='support';},row=>{row.actorKey=null;},row=>{row.sourceUserId=0;},row=>{row.sourceWalletId='';}]){
  const bad=payment();mutation(bad);rows={payments:[bad],pending:[]};rejects(()=>request());
 }
 const duplicate=payment();rows={payments:[duplicate,clone(duplicate)],pending:[]};rejects(()=>request(),'Duplicate completed request IDs cannot duplicate a deduction.');
 rows={payments:[payment({amountCents:Number.MAX_SAFE_INTEGER,feeCents:0}),payment({amountCents:1,feeCents:0})],pending:[]};rejects(()=>request(),'Overflow fails closed.');
 for(const bad of [{payments:null,pending:[]},{payments:[],pending:null},{payments:[],pending:[pending,clone(pending)]},{payments:[],pending:[{...pending,sourceHolders:[]}]},{throw:true}]){rows=bad;rejects(()=>request());}
 console.log('Company debt paid dashboard contracts PASS: '+checks+' checks; exact manual principal and partials, approving-Admin profit ownership, selected business/employee/month, linked-monthly and fee exclusion, legacy/report policy unchanged, pending/malformed/overflow denial and no private payment DTO. Fictional only.');
}finally{Module._load=originalLoad;}
