'use strict';
// Presentation-only counterpart of the Reseller Bills “Money collected” card.
// Never use current cash, wallet balances, POS income or supplier spending as
// substitutes. It intentionally spans all saved dates and all resellers.
const Collections=require('./reseller-collections.cjs');
const Finance=require('./finance-ledger.cjs');
const identity=Object.freeze({basis:'reseller_bill_collections',scope:'all_resellers',period:'all_recorded_dates'});
function exact(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('The saved reseller collection total is unavailable.');const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-6)throw Error('The saved reseller collection total exceeds exact USD cents.');return cents;}
function summary(db){
 if(arguments.length!==1||!db||typeof db.prepare!=='function')throw Error('Choose the authoritative Resellers ledger without an employee or date override.');
 try{const value=Collections.summary(db).total,amount=exact(value.moneyCollected);if(exact(value.netMoneyCollected)!==amount||exact(value.collectedNet)!==amount)throw Error('The saved reseller collection totals disagree.');return {...identity,available:true,amount:amount/100};}
 catch{return {...identity,available:false,reason:'Verified reseller bill collections are unavailable. Refresh Main before showing revenue.'};}
}
const q=Finance.query;
function integer(value){if(!Number.isSafeInteger(value)||value<0)throw Error('The saved reseller collection cents could not be verified.');return value;}
function signed(value){if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)throw Error('The saved reseller report amount could not be verified.');return Math.round(value*100);}
function sum(values){const n=values.reduce((a,v)=>a+BigInt(v),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER))throw Error('The reseller period total exceeds supported exact cents.');return Number(n);}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Choose a valid reseller reporting date.');return value;}
// Collections belong to the date Admin actually collected them, including a
// later collection of a previous month's funding. Outstanding lots stay global.
function period(db,{start,end,accountKey=null}={}){
 day(start);day(end);if(start>end||accountKey!==null&&(typeof accountKey!=='string'||!accountKey||accountKey.length>200))throw Error('Choose a valid reseller collection period.');
 const totals=Collections.summary(db),lots=Collections.lots(db),rows=q(db,"SELECT * FROM reseller_collections WHERE state='completed' ORDER BY created_at,request_id"),byId=new Map(rows.map(row=>[row.request_id,row])),allocated=new Map(),events=[];
 for(const lot of lots)for(const allocation of lot.allocations.filter(a=>a.state==='completed')){
  const row=byId.get(allocation.collectionId);if(!row)throw Error('A completed reseller allocation has no saved collection.');
  const net=integer(allocation.walletDebitCents??integer(allocation.amountCents)-integer(allocation.feeCents||0));
  allocated.set(row.request_id,sum([allocated.get(row.request_id)||0,net]));
  const at=day(String(row.created_at).slice(0,10));if(at<start||at>end||accountKey!==null&&lot.fund.actor_key!==accountKey)continue;
  const input=JSON.parse(row.input_json),method=input.collectionRouteVersion===2?'Whish Money':'Cash';
  events.push({day:at,username:lot.fund.username,amountCents:net,cashCents:method==='Cash'?net:0,whishCents:method==='Whish Money'?net:0});
 }
 for(const row of rows)if(allocated.get(row.request_id)!==integer(row.net_cents))throw Error('The saved reseller collection and allocated net receipt disagree.');
 if(sum([...allocated.values()])!==exact(totals.total.moneyCollected))throw Error('The saved reseller collection total and period proof disagree.');
 const aggregate=selected=>({amount:sum(selected.map(r=>r.amountCents))/100,cash:sum(selected.map(r=>r.cashCents))/100,whish:sum(selected.map(r=>r.whishCents))/100});
 return {basis:'reseller_bill_collections_period',start,end,accountKey,available:true,...aggregate(events),daily:[...new Set(events.map(r=>r.day))].sort().map(date=>({day:date,...aggregate(events.filter(r=>r.day===date))})),byReseller:[...new Set(events.map(r=>r.username))].sort().map(username=>({username,...aggregate(events.filter(r=>r.username===username))}))};
}
const metrics=['revenue','costOfGoods','grossProfit','netProfit','cashReceived','whishReceived','grossWhishReceived','collectionsTotal'];
function projectReport(report,collection,cost){
 const previous=report.resellerCollectionProjection,original=previous?.version===1?previous.original:{metrics:Object.fromEntries(metrics.map(key=>[key,Number(report[key]||0)])),profitParts:report.profitParts||[]};
 if(!original||!original.metrics||!Array.isArray(original.profitParts))throw Error('The original reseller transaction report could not be verified.');
 const base=Object.fromEntries(metrics.map(key=>[key,signed(original.metrics[key])])),received=exact(collection.amount),bandwidth=exact(cost),cash=exact(collection.cash),whish=exact(collection.whish),delta=sum([received,-bandwidth]);
 const result={...report,...Object.fromEntries(metrics.map(key=>[key,base[key]/100])),revenue:sum([base.revenue,received])/100,costOfGoods:sum([base.costOfGoods,bandwidth])/100,grossProfit:sum([base.grossProfit,delta])/100,netProfit:sum([base.netProfit,delta])/100,cashReceived:sum([base.cashReceived,cash])/100,whishReceived:sum([base.whishReceived,whish])/100,grossWhishReceived:sum([base.grossWhishReceived,whish])/100,collectionsTotal:sum([base.collectionsTotal,received])/100,resellerCollectionsRevenue:collection,resellerBandwidthCost:cost,resellerCollectionProjection:{version:1,original:JSON.parse(JSON.stringify(original))}};
 result.profitParts=[...original.profitParts,{id:'reseller_collections',label:'Reseller collections and bandwidth cost',revenue:collection.amount,cost,profit:delta/100}];
 return result;
}
// A read-only projection repairs old missing report inputs without changing the
// archived JSON, request proof, cash, wallets, Bank, debts or original receipts.
function presentSnapshot(db,value,month,accountKey=null,bandwidth={incurredCost:0,daily:[]}){
 const range=Finance.monthRange(month),collection=period(db,{start:range.start,end:range.end,accountKey}),cost=exact(bandwidth.incurredCost),costDays=bandwidth.daily||[];
 if(!Array.isArray(value.daily)||!value.report||costDays.some(row=>day(row.day)<range.start||row.day>range.end)||sum(costDays.map(row=>exact(row.incurredCost)))!==cost)throw Error('The reseller month report and bandwidth dates could not be verified.');
 const savedRevenue=value.resellerRevenuePresentation?.basis==='reseller_bill_collections_period'?value.resellerRevenuePresentation.originalSavedRevenue:Number(value.report.revenue||0),daily=value.daily.map(row=>{const part=collection.daily.find(r=>r.day===row.date)||{day:row.date,amount:0,cash:0,whish:0},dayCost=costDays.find(r=>r.day===row.date)?.incurredCost||0;return {...row,report:projectReport(row.report,{...collection,...part,start:row.date,end:row.date,daily:[],byReseller:[]},dayCost)};});
 const result={...value,report:projectReport(value.report,collection,cost/100),daily,resellerRevenuePresentation:{basis:'reseller_bill_collections_period',amount:collection.amount,originalSavedRevenue:savedRevenue,bandwidthCost:cost/100,immutableArchivePreserved:true,note:'Period revenue includes confirmed Admin reseller collections plus recorded sales and service revenue. Bandwidth purchases reduce profit on their purchase dates, including unpaid supplier bills. Whish fees and monthly deductions remain counted once. The original saved archive, receipt history and money balances are unchanged.'}};
 for(const key of ['revenue','costOfGoods','grossProfit','netProfit','cashReceived','whishReceived'])if(sum(daily.map(row=>signed(row.report[key])))!==signed(result.report[key]))throw Error('The reseller daily report does not reconcile to its monthly total.');
 return result;
}
// Combined transaction reports intentionally exclude internal reseller custody
// transfers and retain Main's physical bandwidth expense once. Their basis is
// separate from a business's monthly collections ledger.
function transactionSnapshot(value){
 const restore=report=>{if(report.resellerCollectionProjection?.version!==1)return report;const original=report.resellerCollectionProjection.original;if(!original?.metrics||!Array.isArray(original.profitParts))throw Error('The archived transaction report basis is unavailable.');for(const key of metrics)signed(original.metrics[key]);const result={...report,...original.metrics,profitParts:JSON.parse(JSON.stringify(original.profitParts))};for(const key of ['resellerCollectionProjection','resellerCollectionsRevenue','resellerBandwidthCost'])delete result[key];return result;};
 const result={...value,report:restore(value.report),daily:value.daily.map(row=>({...row,report:restore(row.report)}))};delete result.resellerRevenuePresentation;return result;
}
module.exports={summary,period,presentSnapshot,transactionSnapshot};
