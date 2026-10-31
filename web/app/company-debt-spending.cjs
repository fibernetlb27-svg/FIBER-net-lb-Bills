'use strict';
// Read-only projection of proven MANUAL company-debt repayments. Recording a
// liability is not income or a new cost. Linked monthly obligations are paid
// and projected only by the original fixed-monthly engine, never here.
const {WORKSPACES}=require('./workspaces.cjs');
const {applyCompanyDebtFees}=require('./profit-breakdown.cjs');
const IDS=new Set(WORKSPACES.map(row=>row.id)),LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
const FLOWS=['fee','periodCustodyPaid','cashPaid','whishPaid'];
function fail(){throw Error('Company debt payment totals could not be verified from the original completed repayment and source debit. No unverified profit or custody total was shown.');}
function integer(value,{positive=false}={}){if(!Number.isSafeInteger(value)||value<0||positive&&value===0)return fail();return value;}
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0)return fail();const result=Math.round(value*100);if(!Number.isSafeInteger(result)||Math.abs(value*100-result)>1e-6)return fail();return result;}
function sum(values){const total=values.reduce((n,value)=>n+BigInt(integer(value)),0n);if(total>LIMIT)return fail();return Number(total);}
function signedSum(values){if(values.some(value=>!Number.isSafeInteger(value)))return fail();const total=values.reduce((n,value)=>n+BigInt(value),0n);if(total>LIMIT||total< -LIMIT)return fail();return Number(total);}
function usd(value){return value/100;}
function day(value){if(typeof value!=='string'||!/^2[01]\d{2}-\d{2}-\d{2}$/.test(value))return fail();const parsed=new Date(value+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return fail();return value;}
function account(value){if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>200))return fail();return value;}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value))return fail();return value;}
function stableIds(values){if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!value))return fail();return [...new Set(values)].sort();}
function verifyRows(projection){
 if(!projection||!Array.isArray(projection.payments)||!Array.isArray(projection.pending))return fail();
 const seen=new Set(),payments=[];
 for(const row of projection.payments){
  if(!row||![1,2].includes(row.version)||row.state!=='completed'||typeof row.actorKey!=='string'||typeof row.sourceAccountKey!=='string'||!IDS.has(row.sourceWorkspaceId))return fail();
  const requestId=id(row.requestId);id(row.debtId);if(seen.has(requestId))return fail();seen.add(requestId);account(row.actorKey);account(row.sourceAccountKey);
  if(row.sourceAccountKey===row.actorKey?row.sourceRole!=='admin':row.sourceRole!=='cashier'||['main','fiber-resellers'].includes(row.sourceWorkspaceId))return fail();
  integer(row.sourceUserId,{positive:true});integer(row.amountCents,{positive:true});integer(row.feeCents);day(row.paymentDate);
  if(typeof row.effectiveAt!=='string'||row.effectiveAt.slice(0,10)!==row.paymentDate||!Number.isFinite(new Date(row.effectiveAt).getTime())||!['Cash','Whish Money'].includes(row.paymentMethod)||row.feeCents>row.amountCents||row.paymentMethod==='Cash'&&row.feeCents||typeof row.sourceWalletId!=='string'||row.paymentMethod==='Cash'&&row.sourceWalletId||row.paymentMethod==='Whish Money'&&!row.sourceWalletId||row.kind!==undefined&&row.kind!=='manual')return fail();
  payments.push(row);
 }
 const pendingIds=new Set(),pending=[];
 for(const row of projection.pending){
  if(!row||pendingIds.has(id(row.requestId))||seen.has(row.requestId))return fail();pendingIds.add(row.requestId);
  if(row.global!==true){
   if(![1,2].includes(row.version)||typeof row.actorKey!=='string'||!IDS.has(row.sourceWorkspaceId)||!Array.isArray(row.sourceHolders)||row.sourceHolders.length!==1||row.sourceHolders[0]?.workspaceId!==row.sourceWorkspaceId||typeof row.sourceHolders[0]?.accountKey!=='string')return fail();
   account(row.actorKey);account(row.sourceHolders[0].accountKey);
  }
  pending.push(row);
 }
 return {payments,pending};
}
function buildSummary(projection,{workspaceId,start,end,accountKey,custodyStart}){
 const total=Object.fromEntries([...FLOWS,'custodyPaid','openingCustodyPaid'].map(field=>[field,0])),days=new Map(),paymentIds=[],pendingIds=[];
 const add=(target,field,value)=>{target[field]=sum([target[field]||0,value]);};
 for(const row of projection.payments){
  if(row.paymentDate>end||row.sourceWorkspaceId!==workspaceId)continue;
  // Admin owns the fee/profit responsibility; the selected holder owns only
  // the principal custody movement. Neither acquires new revenue/funding.
  const actorMatches=accountKey===null||row.actorKey===accountKey,holderMatches=accountKey===null||row.sourceAccountKey===accountKey,amount=holderMatches?row.amountCents:0,inPeriod=row.paymentDate>=start;
  if(amount&&row.paymentDate>=custodyStart){add(total,'custodyPaid',amount);if(!inPeriod)add(total,'openingCustodyPaid',amount);}
  if(!inPeriod)continue;
  const part={fee:actorMatches?row.feeCents:0,periodCustodyPaid:amount,cashPaid:row.paymentMethod==='Cash'?amount:0,whishPaid:row.paymentMethod==='Whish Money'?amount:0};
  if(!Object.values(part).some(Boolean))continue;
  paymentIds.push(row.requestId);const daily=days.get(row.paymentDate)||{day:row.paymentDate,...Object.fromEntries(FLOWS.map(field=>[field,0])),paymentIds:[]};daily.paymentIds.push(row.requestId);for(const field of FLOWS){add(total,field,part[field]);add(daily,field,part[field]);}days.set(row.paymentDate,daily);
 }
 for(const row of projection.pending)if(row.global===true||row.sourceWorkspaceId===workspaceId&&(accountKey===null||row.actorKey===accountKey||row.sourceHolders.some(value=>value.accountKey===accountKey)))pendingIds.push(row.requestId);
 const convert=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='number'?usd(value):value]));
 return {basis:'company_debt_paid',workspaceId,start,end,accountKey,custodyStart,profitCost:0,...convert(total),count:stableIds(paymentIds).length,pendingCount:stableIds(pendingIds).length,paymentIds:stableIds(paymentIds),pendingIds:stableIds(pendingIds),daily:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(row=>({...convert(row),profitCost:0,custodyPaid:usd(row.periodCustodyPaid),count:stableIds(row.paymentIds).length,paymentIds:stableIds(row.paymentIds)})),alreadyReflectedInCustody:true,noRevenue:true,noFunding:true,principalIsProfitCost:false,recognition:'actual_admin_payment_date'};
}
function summary({entries,workspaceId,start,end,accountKey=null,custodyStart=start}={}){
 if(!entries||typeof entries.get!=='function'||!IDS.has(workspaceId)&&workspaceId!=='all')return fail();day(start);day(end);day(custodyStart);account(accountKey);if(start>end)return fail();
 const projection=verifyRows(require('./company-debts.cjs').projectionRows({entries})),options={start,end,accountKey,custodyStart};
 return workspaceId==='all'?mergeSummaries(WORKSPACES.map(row=>buildSummary(projection,{...options,workspaceId:row.id}))):buildSummary(projection,{...options,workspaceId});
}
// Main Admin's optional display deduction uses the approving Admin's profit
// responsibility, not the selected Cashier's custody. Reports and archives
// continue to treat liability principal as custody-only, independently of this
// read-only choice. The core projection proves only manual repayments; linked
// monthly debts remain exclusively in their original monthly-payment card.
function dashboardPaid(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(key=>!['entries','workspaceId','accountKey','start','end','asOf'].includes(key)))return fail();
 const {entries,workspaceId,start,end,asOf}=options,accountKey=options.accountKey===undefined?null:options.accountKey;
 if(!entries||typeof entries.get!=='function'||!IDS.has(workspaceId)&&workspaceId!=='all')return fail();day(start);day(end);day(asOf);account(accountKey);
 if(start!==asOf.slice(0,7)+'-01'||end!==asOf||accountKey!==null&&(accountKey.trim()!==accountKey||/[\u0000-\u001f\u007f]/.test(accountKey)))return fail();
 const projection=verifyRows(require('./company-debts.cjs').projectionRows({entries})),inBusiness=row=>workspaceId==='all'||row.sourceWorkspaceId===workspaceId,owned=row=>accountKey===null||row.actorKey===accountKey;
 if(projection.pending.some(row=>row.global===true||inBusiness(row)&&owned(row)))throw Error('Finish the saved Company debt payment before displaying verified debt payment deductions.');
 const selected=projection.payments.filter(row=>inBusiness(row)&&owned(row)&&row.paymentDate>=start&&row.paymentDate<=end),principalCents=sum(selected.map(row=>row.amountCents)),paidPrincipal=usd(principalCents);
 if(money(paidPrincipal)!==principalCents)return fail();
 return {basis:'manual_company_debt_paid',workspaceId,accountKey,start,end,asOf,paidPrincipal,paidProfitCost:paidPrincipal,count:selected.length,pendingCount:0,readOnly:true,noRevenue:true,noFunding:true,recognition:'actual_payment_date',ownership:'approving_admin',linkedMonthlyExcluded:true,feesExcluded:true};
}
function validateSummary(value){
 if(!value||value.basis!=='company_debt_paid'||!IDS.has(value.workspaceId)&&value.workspaceId!=='all'||value.profitCost!==0)return fail();day(value.start);day(value.end);if(value.start>value.end)return fail();account(value.accountKey);if(value.custodyStart!==null)day(value.custodyStart);for(const field of [...FLOWS,'custodyPaid','openingCustodyPaid'])money(value[field]);integer(value.count);integer(value.pendingCount);
 if(stableIds(value.paymentIds).length!==value.count||stableIds(value.pendingIds).length!==value.pendingCount||!Array.isArray(value.daily))return fail();
 const seen=new Set();for(const row of value.daily){if(seen.has(day(row.day))||row.day<value.start||row.day>value.end||row.profitCost!==0)return fail();seen.add(row.day);for(const field of FLOWS)money(row[field]);if(money(row.custodyPaid)!==money(row.periodCustodyPaid)||stableIds(row.paymentIds).length!==integer(row.count))return fail();}
 for(const field of FLOWS)if(sum(value.daily.map(row=>money(row[field])))!==money(value[field]))return fail();
 if(sum([money(value.cashPaid),money(value.whishPaid)])!==money(value.periodCustodyPaid)||stableIds(value.daily.flatMap(row=>row.paymentIds)).join('\0')!==stableIds(value.paymentIds).join('\0'))return fail();return value;
}
function mergeSummaries(values){
 if(!Array.isArray(values))return fail();if(!values.length)return null;
 const flat=values.flatMap(value=>{validateSummary(value);if(value.workspaceId!=='all')return [value];if(!Array.isArray(value.byBusiness))return fail();return value.byBusiness.map(validateSummary);}),groups=new Map(),accountKey=flat[0]?.accountKey;
 for(const value of flat){if(value.accountKey!==accountKey)return fail();const group=groups.get(value.workspaceId)||[];group.push(value);groups.set(value.workspaceId,group);}
 const merge=(rows,workspaceId)=>{
  const sorted=[...rows].sort((a,b)=>a.end.localeCompare(b.end)||a.start.localeCompare(b.start)),latest=sorted.at(-1),days=new Map(),result={...latest,workspaceId,start:rows.map(row=>row.start).sort()[0],end:rows.map(row=>row.end).sort().at(-1)};
  if(workspaceId!=='all'&&rows.reduce((count,row)=>count+row.paymentIds.length,0)!==stableIds(rows.flatMap(row=>row.paymentIds)).length)return fail();
  for(const field of FLOWS)result[field]=usd(sum(rows.map(row=>money(row[field]))));result.paymentIds=stableIds(rows.flatMap(row=>row.paymentIds));result.pendingIds=stableIds(rows.flatMap(row=>row.pendingIds));result.count=result.paymentIds.length;result.pendingCount=result.pendingIds.length;
  for(const row of rows)for(const daily of row.daily){const prior=days.get(daily.day)||{day:daily.day,...Object.fromEntries(FLOWS.map(field=>[field,0])),paymentIds:[]};if(workspaceId!=='all'&&prior.paymentIds.some(value=>daily.paymentIds.includes(value)))return fail();for(const field of FLOWS)prior[field]=usd(sum([money(prior[field]),money(daily[field])]));prior.paymentIds.push(...daily.paymentIds);days.set(daily.day,prior);}
  result.daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(row=>({...row,profitCost:0,custodyPaid:row.periodCustodyPaid,count:stableIds(row.paymentIds).length,paymentIds:stableIds(row.paymentIds)}));return result;
 };
 const business=[...groups].map(([workspaceId,rows])=>merge(rows,workspaceId));if(business.length===1)return validateSummary(business[0]);
 const result=merge(business,'all');result.custodyStart=null;result.custodyPaid=usd(sum(business.map(row=>money(row.custodyPaid))));result.openingCustodyPaid=usd(sum(business.map(row=>money(row.openingCustodyPaid))));result.byBusiness=business;return validateSummary(result);
}
function applyToReport(baseReport,value){
 const debt=validateSummary(value);if(!baseReport||typeof baseReport!=='object'||baseReport.companyDebtProjection===true)throw Error('Company debt fees were already included or the original report is unavailable.');if(debt.pendingCount)throw Error('Finish the saved Company debt payment before displaying verified profit.');
 const reportMoney=value=>{if(typeof value!=='number'||!Number.isFinite(value))return fail();const result=Math.round(value*100);if(!Number.isSafeInteger(result)||Math.abs(value*100-result)>1e-6)return fail();return result;};
 const fee=money(debt.fee);return {...baseReport,netProfit:usd(signedSum([reportMoney(baseReport.netProfit),-fee])),whishFees:usd(signedSum([reportMoney(baseReport.whishFees??0),fee])),profitParts:applyCompanyDebtFees(baseReport.profitParts,debt),companyDebtProjection:true,companyDebtFees:debt.fee,companyDebt:JSON.parse(JSON.stringify(debt))};
}
module.exports={summary,dashboardPaid,mergeSummaries,applyToReport};
