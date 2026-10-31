(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.ExpenseFunding=factory();
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 // Funding allocation only. These calculations do not move drawer/wallet
 // custody and never assign an unknown historical expense to a funding source.
 const feeSources=new Set(['whish_fee','whish_cashout','whish_receipt_migration','reseller_whish_fee','reseller_collection_fee','optional_whish_fee']);
 const isProfitOnlyFee=row=>row?.feeProfitOnly===true||feeSources.has(row?.sourceType);
 const isBandwidthCost=row=>row?.sourceType==='bandwidth_purchase';
 const isFunding=row=>['installation_payment','product_margin_funding','maintenance_funding'].includes(row?.sourceType);
 const validMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
 function fundingMonth(row){const month=row.fundingMonth??row.expenseDate?.slice(0,7);if(!validMonth(month)||month>row.expenseDate.slice(0,7))throw Error('The expense funding month is unavailable. No funding balance was guessed.');return month;}
 function cents(value,label){
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('The '+label+' amount is unavailable. No funding balance was guessed.');
  const result=Math.round((value+Number.EPSILON)*100);
  if(!Number.isSafeInteger(result))throw Error('The '+label+' amount exceeds the supported range.');
  return BigInt(result);
 }
 function dollars(value,label){
  const limit=BigInt(Number.MAX_SAFE_INTEGER);
  if(value>limit||value< -limit)throw Error('The '+label+' total exceeds the supported range.');
  return Number(value)/100;
 }
 function summary(rows,{month}={}){
  if(!Array.isArray(rows)||typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid expense funding month.');
  const totals={received:0n,spent:0n,fundingSpent:0n,fees:0n,bandwidth:0n,cashReceived:0n,whishReceived:0n,cashSpent:0n,whishSpent:0n,unallocatedSpent:0n,otherReceived:0n};
  let unallocatedCount=0,otherReceivedCount=0;
  for(const row of rows){
   const date=typeof row?.expenseDate==='string'?new Date(row.expenseDate+'T12:00:00Z'):null;
   if(!row||typeof row.expenseDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.expenseDate)||!Number.isFinite(date?.getTime())||date.toISOString().slice(0,10)!==row.expenseDate)throw Error('The expense funding date is unavailable. No funding balance was guessed.');
   const datedMonth=row.expenseDate.slice(0,7),receipt=isFunding(row),ordinary=!receipt&&!isBandwidthCost(row)&&!isProfitOnlyFee(row),allocatedMonth=ordinary?fundingMonth(row):datedMonth;
   if(datedMonth!==month&&allocatedMonth!==month)continue;
   const amount=cents(row.amount,'expense funding');
   if(receipt&&datedMonth===month){
    totals.received+=amount;
    if(row.paymentMethod==='Cash')totals.cashReceived+=amount;
    else if(row.paymentMethod==='Whish Money')totals.whishReceived+=amount;
    else {totals.otherReceived+=amount;otherReceivedCount++;}
   }else if(isBandwidthCost(row)&&datedMonth===month)totals.bandwidth+=amount;
   else if(isProfitOnlyFee(row)&&datedMonth===month)totals.fees+=amount;
   else if(ordinary){
    if(datedMonth===month)totals.spent+=amount;
    if(allocatedMonth!==month)continue;
    totals.fundingSpent+=amount;
    if(row.fundingMethod==='Cash')totals.cashSpent+=amount;
    else if(row.fundingMethod==='Whish Money')totals.whishSpent+=amount;
    else {totals.unallocatedSpent+=amount;unallocatedCount++;}
   }
  }
  const amounts=Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,dollars(value,key)]));
  return {...amounts,remaining:dollars(totals.received-totals.fundingSpent,'remaining funding'),expenses:dollars(totals.spent+totals.fees+totals.bandwidth,'recorded expenses'),cashRemaining:dollars(totals.cashReceived-totals.cashSpent,'Cash funding'),whishRemaining:dollars(totals.whishReceived-totals.whishSpent,'Whish funding'),profitOnlyFees:amounts.fees,hasUnallocated:unallocatedCount>0||otherReceivedCount>0,unallocatedCount,otherReceivedCount};
 }
 function carry(rows,{month,workspaceId}={}){
  summary(rows,{month});
  const businesses=new Map();
  for(const row of rows){if(isBandwidthCost(row)||isProfitOnlyFee(row))continue;const key=row.workspaceId??workspaceId;if(typeof key!=='string'||!key||key==='all')throw Error('The funding business is unavailable. Earlier balances were not combined across unknown businesses.');if(!businesses.has(key))businesses.set(key,{rows:[],months:new Set(),name:row.workspaceName||''});const group=businesses.get(key);group.rows.push(row);const bucket=isFunding(row)?row.expenseDate.slice(0,7):fundingMonth(row);if(bucket<month)group.months.add(bucket);}
  const buckets=[];for(const [id,group]of businesses)for(const bucket of [...group.months].sort())buckets.push({workspaceId:id,workspaceName:group.name,month:bucket,...summary(group.rows,{month:bucket})});
  const unused=buckets.filter(row=>row.remaining>0),deficits=buckets.filter(row=>row.remaining<0);let total=0n;for(const row of unused)total+=cents(row.remaining,'earlier unused funding');
  return {month,remaining:dollars(total,'earlier unused funding'),buckets:unused,deficits};
 }
 function reportSummary(report){
  const received=cents(report.installationIncome??0,'reported funding')+cents(report.productMarginFunding??0,'reported product funding')+cents(report.maintenanceFunding??0,'reported Maintenance funding'),expenses=cents(report.expenses??0,'reported expenses'),fees=cents(report.whishFees??0,'reported Whish fees'),spent=expenses-fees;
  return {received:dollars(received,'reported funding'),spent:dollars(spent,'funding spending'),fees:dollars(fees,'profit-only fees'),remaining:dollars(received-spent,'remaining funding')};
 }
 return Object.freeze({summary,carry,fundingMonth,reportSummary,isProfitOnlyFee,isBandwidthCost});
});
