'use strict';
// Month allocation is a budget classification, never a cash/wallet movement
// or permission to spend. Negative recorded balances remain visible.
const {WORKSPACES}=require('./workspaces.cjs'),IDS=new Set(WORKSPACES.map(row=>row.id)),MAX=BigInt(Number.MAX_SAFE_INTEGER);
const RECEIVED=new Set(['installation_payment','product_margin_funding','maintenance_funding']);
const FEES=new Set(['whish_fee','whish_cashout','whish_receipt_migration','reseller_whish_fee','reseller_collection_fee','stock_purchase_whish_fee','optional_whish_fee']);
function month(value){if(typeof value!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))throw Error('Choose a valid expense funding month.');return value;}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)){throw Error('Choose a valid expense funding date.');}const date=new Date(value+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw Error('Choose a valid expense funding date.');return value;}
function localDay(){const now=new Date();return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function cents(value){if(typeof value!=='number'||!Number.isFinite(value))throw Error('The expense funding amount is unavailable.');const valueCents=Math.round(value*100);if(!Number.isSafeInteger(valueCents)||Math.abs(value*100-valueCents)>1e-6)throw Error('Expense funding must use exact supported USD cents.');return BigInt(valueCents);}
function dollars(value){if(value>MAX||value< -MAX)throw Error('The expense funding total exceeds the supported range.');return Number(value)/100;}
function storedMonth(row){
 if(Object.hasOwn(row,'funding_month'))return row.funding_month;
 if(row.fundingMonthExplicit===false)return null;
 return row.fundingMonth;
}
function effectiveMonth(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('The original expense funding month is unavailable.');
 const date=day(row.expenseDate??row.expense_date),saved=storedMonth(row),value=saved===null||saved===undefined?date.slice(0,7):month(saved);
 if(value>date.slice(0,7))throw Error('Funding month cannot be later than the expense month.');return value;
}
function resolveFundingMonth(input,expenseDate,{previous=null}={}){
 const date=day(expenseDate);let value;
 if(input.fundingMonth!==undefined)value=month(input.fundingMonth);
 else{const saved=previous?storedMonth(previous):null;value=saved===null||saved===undefined?date.slice(0,7):month(saved);}
 if(value>date.slice(0,7))throw Error('Funding month cannot be later than the expense month.');return value;
}
function summary(rows,{workspaceId,through,today=localDay(),excludeExpenseId=null}={}){
 if(!Array.isArray(rows)||!IDS.has(workspaceId))throw Error('Choose one valid business for expense funding.');day(through);day(today);
 if(excludeExpenseId!==null&&(!Number.isSafeInteger(excludeExpenseId)||excludeExpenseId<=0))throw Error('Choose the original expense for funding review.');
 const expenseMonth=through.slice(0,7),availableThrough=through<today?through:today,buckets=new Map(),seen=new Set();
 const bucket=key=>{if(!buckets.has(key))buckets.set(key,{month:key,received:0n,spent:0n,cashReceived:0n,whishReceived:0n,cashSpent:0n,whishSpent:0n,otherReceived:0n,unallocatedSpent:0n,fundingCount:0,expenseCount:0,otherReceivedCount:0,unallocatedCount:0});return buckets.get(key);};
 bucket(expenseMonth);let excluded=null;
 if(excludeExpenseId!==null){const matches=rows.filter(row=>row?.workspaceId===workspaceId&&row.id===excludeExpenseId&&row.sourceType==='manual');if(matches.length!==1)throw Error('The original local manual expense could not be verified for funding review.');excluded=matches[0];const original=effectiveMonth(excluded);if(original<=expenseMonth)bucket(original);}
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.workspaceId!==workspaceId)throw Error('Expense funding belongs to another or unverified business.');
  if(row.pending===true||row.unverified===true||row.available===false||['prepared','checking','processing','unknown','pending','save_required'].includes(row.state))throw Error('Expense funding has pending or unverified source records. No balance was guessed.');
  const date=day(row.expenseDate),amount=cents(row.amount),received=RECEIVED.has(row.sourceType),key=received?date.slice(0,7):effectiveMonth(row);
  // Each original business record contributes once. Prefixes keep physical
  // expenses distinct from generated installation / margin / service funding.
  if(typeof row.id==='string'?(!row.id||/[\u0000-\u001f\u007f]/.test(row.id)):!Number.isSafeInteger(row.id)||row.id<=0)throw Error('The original expense funding record is unavailable.');
  const identity=JSON.stringify([received?row.sourceType:'expense',row.id]);if(seen.has(identity))throw Error('An expense funding record was returned more than once.');seen.add(identity);
  if(row===excluded||key>expenseMonth)continue;
  if(received){if(date>availableThrough)continue;const value=bucket(key),method=row.paymentMethod??row.fundingMethod;value.received+=amount;value.fundingCount++;if(method==='Cash')value.cashReceived+=amount;else if(method==='Whish Money')value.whishReceived+=amount;else{value.otherReceived+=amount;value.otherReceivedCount++;}}
  else if(row.feeProfitOnly!==true&&!FEES.has(row.sourceType)&&row.sourceType!=='bandwidth_purchase'){
   // Allocations already recorded against an eligible bucket remain reserved,
   // even when their accounting date is later than this form's review date.
   const value=bucket(key);value.spent+=amount;value.expenseCount++;if(row.fundingMethod==='Cash')value.cashSpent+=amount;else if(row.fundingMethod==='Whish Money')value.whishSpent+=amount;else{value.unallocatedSpent+=amount;value.unallocatedCount++;}
  }
 }
 const months=[...buckets.values()].sort((a,b)=>b.month.localeCompare(a.month)).map(value=>{
  const numeric=['received','spent','cashReceived','whishReceived','cashSpent','whishSpent','otherReceived','unallocatedSpent'],result={...value};for(const key of numeric)result[key]=dollars(value[key]);
  result.remaining=dollars(value.received-value.spent);result.cashRemaining=dollars(value.cashReceived-value.cashSpent);result.whishRemaining=dollars(value.whishReceived-value.whishSpent);
  return {...result,hasUnallocated:value.otherReceivedCount>0||value.unallocatedCount>0,hasDeficit:result.remaining<0||result.cashRemaining<0||result.whishRemaining<0};
 });
 return {basis:'expense_funding_months',workspaceId,asOf:through,availableThrough,currentMonth:today.slice(0,7),expenseMonth,excludeExpenseId,allocationOnly:true,months};
}
module.exports={resolveFundingMonth,effectiveMonth,summary};
