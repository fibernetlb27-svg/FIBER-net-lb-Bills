'use strict';
// Read-only DTO projections. Callers must first authorize every original ledger.
// Never derive a customer's balance from business-to-Admin wholesale liabilities.
const fail=()=>{throw Error('The saved employee dashboard totals could not be verified. Refresh the original ledger.');};
function cents(value,signed=false){const n=Math.round(value*100);if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(n)||(!signed&&n<0)||Math.abs(value*100-n)>1e-6)fail();return n;}
function sum(values){let n=0;for(const value of values){n+=value;if(!Number.isSafeInteger(n))fail();}return n;}
function scope(workspaceId,accountKey,asOf){if(typeof workspaceId!=='string'||!workspaceId||accountKey!==null&&(typeof accountKey!=='string'||!accountKey)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))fail();}
function customerDebts(records,{workspaceId,accountKey,asOf}){
  scope(workspaceId,accountKey,asOf);if(!Array.isArray(records))fail();const seen=new Set(),values=[];
  for(const row of records){
    if(!row||!['sale','bill','telecom'].includes(row.kind)||!Number.isSafeInteger(row.id)||row.id<1||row.isDebt!==true||row.isRefund!==false)fail();
    const key=row.kind+':'+row.id;if(seen.has(key))fail();seen.add(key);
    const original=cents(row.originalAmount),paid=cents(row.paidAmount),remaining=cents(row.remainingAmount);
    if(paid>original||remaining!==original-paid||cents(row.amount)!==remaining)fail();
    if(remaining)values.push(remaining);
  }
  return {basis:'customer_receivables',workspaceId,accountKey,amount:sum(values)/100,count:values.length,asOf,readOnly:true};
}
function mergeDebts(sources,{workspaceId,accountKey,asOf}){
  scope(workspaceId,accountKey,asOf);const seen=new Set();let count=0;
  const values=sources.map(source=>{const proof=source.customerDebts;if(seen.has(source.workspaceId)||!proof||proof.basis!=='customer_receivables'||proof.workspaceId!==source.workspaceId||proof.accountKey!==accountKey||proof.asOf!==asOf||proof.readOnly!==true||!Number.isSafeInteger(proof.count)||proof.count<0)fail();seen.add(source.workspaceId);count+=proof.count;if(!Number.isSafeInteger(count))fail();return cents(proof.amount);});
  return {basis:'customer_receivables',workspaceId,accountKey,amount:sum(values)/100,count,asOf,readOnly:true};
}
function aggregate(sources,{workspaceIds,accountKey,asOf,employee}){
  scope('all',accountKey,asOf);if(!accountKey||!Array.isArray(workspaceIds)||new Set(workspaceIds).size!==workspaceIds.length||!Array.isArray(sources)||sources.length!==workspaceIds.length||!employee||employee.accountKey!==accountKey)fail();
  const seen=new Set(),wallets=new Map(),cash=[];
  for(const source of sources){
    if(!workspaceIds.includes(source.workspaceId)||seen.has(source.workspaceId)||source.accountKey!==accountKey||!Array.isArray(source.wallets))fail();seen.add(source.workspaceId);cash.push(cents(source.cash,true));const walletIds=new Set();
    for(const wallet of source.wallets){if(!wallet||typeof wallet.id!=='string'||!wallet.id||walletIds.has(wallet.id)||typeof wallet.label!=='string'||typeof wallet.number!=='string')fail();walletIds.add(wallet.id);const n=cents(wallet.balance,true),prior=wallets.get(wallet.id);if(prior&&(prior.label!==wallet.label||prior.number!==wallet.number||Boolean(prior.active)!==Boolean(wallet.active)))fail();wallets.set(wallet.id,{id:wallet.id,label:wallet.label,number:wallet.number,active:wallet.active,balance:(sum([prior?cents(prior.balance,true):0,n]))/100});}
  }
  const rows=[...wallets.values()],cashTotal=sum(cash)/100,walletTotal=sum(rows.map(row=>cents(row.balance,true)))/100;
  return {workspaceId:'all',workspaceName:'All assigned businesses',aggregate:true,admin:false,accountKey,employeeName:employee.fullName,employees:[{...employee,canReceive:false}],wallets:rows,history:[],recipients:[],months:[],lastClosedMonth:null,today:asOf,dashboard:{drawer:{balance:cashTotal}},staffTotals:{basis:'employee_custody_sum',workspaceIds:[...workspaceIds],accountKey,asOf,cash:cashTotal,wallets:walletTotal,readOnly:true},customerDebts:mergeDebts(sources,{workspaceId:'all',accountKey,asOf}),readOnly:true,whishCorrection:null,whishFeePolicy:{policy:'profit_only',readOnly:true,deferred:false,warnings:[],reason:''}};
}
module.exports={cents,sum,customerDebts,mergeDebts,aggregate};
