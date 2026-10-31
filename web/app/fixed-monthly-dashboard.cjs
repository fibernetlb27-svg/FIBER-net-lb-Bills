'use strict';
// Presentation-only billing-month cohort. Call only after the Admin-authorized
// core overview has verified each immutable bill and completed payment proof.
// This module never opens a database or changes reports, payments or balances.
const {WORKSPACES}=require('./workspaces.cjs');
const IDS=new Set(WORKSPACES.map(row=>row.id));
const LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
const fail=()=>{throw Error('Monthly payment dashboard totals could not be verified. Refresh the original monthly bills before showing a deduction.');};
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function integer(value,{positive=false,max=Number.MAX_SAFE_INTEGER}={}){if(!Number.isSafeInteger(value)||value<0||value>max||positive&&value===0)return fail();return value;}
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0)return fail();const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-6)return fail();return cents;}
function sum(values){const total=values.reduce((n,value)=>n+BigInt(integer(value)),0n);if(total>LIMIT)return fail();return Number(total);}
function usd(value){const result=integer(value)/100;if(money(result)!==value)return fail();return result;}
function day(value){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return fail();const parsed=new Date(value+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return fail();return value;}
function account(value){if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>200||/[\u0000-\u001f\u007f]/.test(value))return fail();return value;}
function identity(value,max=180){if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return fail();return value;}
function ownerFor(owners,bill){const owner=owners instanceof Map?owners.get(bill.billId):Object.hasOwn(owners,bill.billId)?owners[bill.billId]:undefined;return account(owner);}
function allocations(rows,amount,profit){
 if(!Array.isArray(rows)||!rows.length||rows.length>IDS.size)return fail();
 const seen=new Set();for(const row of rows){
  if(!plain(row)||!IDS.has(row.workspaceId)||seen.has(row.workspaceId))return fail();seen.add(row.workspaceId);
  integer(row.basisPoints,{positive:true,max:10000});integer(row.billShareCents);integer(row.profitCostCents);
  if(row.profitCostCents>row.billShareCents||money(row.billShare)!==row.billShareCents||money(row.profitCost)!==row.profitCostCents)return fail();
 }
 if(sum(rows.map(row=>row.basisPoints))!==10000||sum(rows.map(row=>row.billShareCents))!==amount||sum(rows.map(row=>row.profitCostCents))!==profit)return fail();
 return rows;
}
function allocationSignature(rows){return JSON.stringify([...rows].sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId)).map(row=>[row.workspaceId,row.basisPoints,row.billShareCents,row.profitCostCents]));}
function paymentSignature(payment,bill,asOf){
 if(!plain(payment)||payment.kind!=='payment'||payment.state!=='completed'||![1,2,3].includes(payment.version)||payment.noRevenue!==true||payment.noFunding!==true||payment.billId!==bill.billId||payment.templateId!==bill.templateId||payment.month!==bill.month||money(payment.amount)!==bill.amountCents)return fail();
 const requestId=identity(payment.requestId,100),actorKey=account(payment.actorKey),paymentDate=day(payment.paymentDate),fee=money(payment.whishFee);
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(requestId)||paymentDate<bill.month+'-01'||paymentDate>asOf||typeof payment.effectiveAt!=='string'||payment.effectiveAt.slice(0,10)!==paymentDate||!Number.isFinite(new Date(payment.effectiveAt).getTime())||fee>bill.amountCents)return fail();
 if(allocationSignature(allocations(payment.allocations,bill.amountCents,bill.profitTotalCents))!==allocationSignature(bill.allocations))return fail();
 // The core already verifies custody legs. Holder identity intentionally does
 // not choose this card's cost owner: only the approving Admin actor does.
 return JSON.stringify([requestId,actorKey,bill.billId,bill.month,paymentDate,payment.effectiveAt,payment.version,bill.amountCents,fee,allocationSignature(payment.allocations)]);
}
function verifyOverview(overview,owners,asOf){
 if(!plain(overview)||overview.month!==asOf.slice(0,7)||!Array.isArray(overview.bills)||!Array.isArray(overview.payments)||!Array.isArray(overview.pending)||overview.pending.length||!plain(overview.totals)||!Array.isArray(overview.workspaces)||!(owners instanceof Map)&&!plain(owners))return fail();
 const workspaceIds=overview.workspaces.map(row=>row?.id);if(workspaceIds.length!==IDS.size||new Set(workspaceIds).size!==IDS.size||workspaceIds.some(id=>!IDS.has(id)))return fail();
 const seen=new Set(),requests=new Set(),expectedPayments=new Map(),checked=[];
 for(const bill of overview.bills){
  if(!plain(bill)||seen.has(identity(bill.billId))||bill.id!==bill.billId||bill.month!==overview.month||bill.billId!==identity(bill.templateId,100)+':'+bill.month||!['paid','unpaid','frozen'].includes(bill.state)||typeof bill.generated!=='boolean'||bill.pendingRequestId!==null)return fail();seen.add(bill.billId);
  integer(bill.templateVersion,{positive:true});integer(bill.amountCents,{positive:true});integer(bill.profitTotalCents);integer(bill.profitBasisPoints,{max:10000});
  if(money(bill.amount)!==bill.amountCents||money(bill.profitCost)!==bill.profitTotalCents||day(bill.dueDate).slice(0,7)!==bill.month||bill.profitTotalCents!==Number((BigInt(bill.amountCents)*BigInt(bill.profitBasisPoints)+5000n)/10000n))return fail();
  allocations(bill.allocations,bill.amountCents,bill.profitTotalCents);
  if(bill.companyDebtId!==null)identity(bill.companyDebtId);
  let owner;
  if(bill.state==='paid'){
   if(bill.frozen!==null||!bill.generated)return fail();
   const signature=paymentSignature(bill.payment,bill,asOf);if(requests.has(bill.payment.requestId))return fail();requests.add(bill.payment.requestId);expectedPayments.set(bill.payment.requestId,{bill,signature});owner=bill.payment.actorKey;
  }else{
   if(bill.payment!==null||bill.state==='unpaid'&&bill.frozen!==null||bill.state==='frozen'&&!plain(bill.frozen))return fail();
   if(bill.state==='frozen'){
    const frozen=bill.frozen;identity(frozen.requestId,100);identity(frozen.reason,1000);identity(frozen.actorName,300);
    if(!bill.generated||typeof frozen.frozenAt!=='string'||!Number.isFinite(new Date(frozen.frozenAt).getTime())||day(frozen.frozenAt.slice(0,10))>asOf)return fail();
   }
   owner=ownerFor(owners,bill);
  }
  checked.push({bill,owner});
 }
 const suppliedPayments=new Set();for(const payment of overview.payments){
  if(!plain(payment)||suppliedPayments.has(payment.requestId))return fail();suppliedPayments.add(payment.requestId);
  const expected=expectedPayments.get(payment.requestId);if(!expected||paymentSignature(payment,expected.bill,asOf)!==expected.signature)return fail();
 }
 if(suppliedPayments.size!==expectedPayments.size)return fail();
 const all=checked.map(row=>row.bill),paid=all.filter(row=>row.state==='paid'),unpaid=all.filter(row=>row.state==='unpaid'),frozen=all.filter(row=>row.state==='frozen'),totals=overview.totals;
 for(const [field,value]of Object.entries({billCount:all.length,paidCount:paid.length,unpaidCount:unpaid.length,frozenCount:frozen.length}))if(integer(totals[field])!==value)return fail();
 const expected={totalAmount:sum(all.map(row=>row.amountCents)),paidAmount:sum(paid.map(row=>row.amountCents)),unpaidAmount:sum(unpaid.map(row=>row.amountCents)),frozenAmount:sum(frozen.map(row=>row.amountCents)),profitDeducted:sum(paid.map(row=>row.profitTotalCents)),whishFees:sum(paid.map(row=>money(row.payment.whishFee)))};
 for(const [field,value]of Object.entries(expected))if(money(totals[field])!==value)return fail();
 return checked;
}
function summarize(options){
 if(!plain(options)||Reflect.ownKeys(options).some(key=>!['overview','workspaceId','accountKey','owners','asOf'].includes(key)))return fail();
 const {overview,workspaceId,owners}=options,accountKey=options.accountKey===undefined?null:options.accountKey,asOf=day(options.asOf);
 if(workspaceId!=='all'&&!IDS.has(workspaceId))return fail();if(accountKey!==null)account(accountKey);
 const checked=verifyOverview(overview,owners,asOf),totals={total:0,paid:0,remaining:0,totalProfitCost:0,paidProfitCost:0,remainingProfitCost:0},counts={billCount:0,paidCount:0,remainingCount:0,frozenCount:0};
 for(const {bill,owner}of checked){
  if(accountKey!==null&&owner!==accountKey)continue;
  const selected=workspaceId==='all'?bill.allocations:bill.allocations.filter(row=>row.workspaceId===workspaceId);
  const amount=sum(selected.map(row=>row.billShareCents)),profit=sum(selected.map(row=>row.profitCostCents));if(!amount)continue;
  if(bill.state==='frozen'){counts.frozenCount++;continue;}
  const row=bill.state==='paid'?'paid':'remaining',cost=row+'ProfitCost';
  totals[row]=sum([totals[row],amount]);totals[cost]=sum([totals[cost],profit]);counts[row+'Count']++;counts.billCount++;
 }
 totals.total=sum([totals.paid,totals.remaining]);totals.totalProfitCost=sum([totals.paidProfitCost,totals.remainingProfitCost]);
 return {basis:'fixed_monthly_billing_month',month:overview.month,workspaceId,accountKey,asOf,...Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,usd(value)])),...counts,pendingCount:0,readOnly:true,noRevenue:true,noFunding:true,recognition:'billing_month_cohort',ownership:'unpaid_template_admin_paid_payment_admin'};
}
module.exports={summarize};
