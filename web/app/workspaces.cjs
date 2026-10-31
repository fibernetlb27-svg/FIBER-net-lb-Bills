const {combineProfitBreakdowns}=require("./profit-breakdown.cjs");
const WORKSPACES = [
  { id: "main", name: "Main dashboard", icon: "dashboard", color: "slate", kind: "main" },
  { id: "fiber-users", name: "FIBER net lb Users", icon: "internet-users", color: "orange", kind: "internet" },
  { id: "fiber-resellers", name: "FIBER net lb Resellers", icon: "resellers", color: "blue", kind: "reseller" },
  { id: "iptv", name: "IPTV", icon: "tv", color: "violet", kind: "satellite" },
  { id: "printer", name: "Printer", icon: "printer", color: "teal", kind: "printing" },
  { id: "studio", name: "Studio", icon: "camera", color: "pink", kind: "studio" },
  { id: "mobile-ogero", name: "Mobile and Ogero", icon: "telecom", color: "green", kind: "telecom" }
];
const RESET_TABLES = ["internet_renewal_costs", "internet_renewal_events", "internet_renewals", "bill_requests", "debt_payments", "cash_drawer_transactions", "sale_items", "purchase_receipt_items", "expenses", "purchase_receipts", "sales", "fibernetlb_bills", "bill_resets", "resellers", "telecom_payments", "product_barcodes", "products", "attendance_records", "employees"];
RESET_TABLES.unshift("expense_edits");
RESET_TABLES.unshift('payment_destinations');

function workspace(id = "main") {
  const found = WORKSPACES.find(item => item.id === id);
  if (!found) throw new Error("Unknown business section.");
  return found;
}

function combineReports(reports) {
  const result = { ...reports[0]?.report, daily: [], recentSales: [], sections: [], debtAccounts:[], debtPayments:[], refundPayments:[],installationPayments:[],internetRenewals:[],whishPayments:[],whishCashouts:[],whishReceiptCorrections:[],whishWalletRestorations:[],optionalWhishPayments:[],maintenancePayments:[],fundedStockFeePayments:[] };
  const fields = ["revenue", "posRevenue", "serviceRevenue", "serviceCost", "serviceProfit", "telecomRevenue", "telecomCost", "telecomProfit", "costOfGoods", "posCostOfGoods", "posGrossProfit", "grossProfit", "saleCount", "billCount", "telecomCount", "expenses", "netProfit", "outstandingDebt", "debtCount", "cashPaid","whishPaid","otherPaid","periodDebt","paymentTotal","cashReceived","whishReceived","otherReceived","collectionsTotal","cashRefunded","whishRefunded","refundsTotal"];
  fields.push('installationIncome', 'unknownPrintingUnits', 'unknownPrintingRevenue','whishFees','grossWhishReceived','cashoutFees','receiptMigrationFees','optionalWhishFees','productMarginFunding','maintenanceFunding','fundedStockFees');
  for (const field of fields) result[field] = Math.round(reports.reduce((sum, entry) => sum + Number(entry.report[field] || 0), 0) * 100) / 100;
  const days = new Map();
  for (const { section, report, drawer } of reports) {
    result.sections.push({ ...section, revenue: report.revenue, expenses: report.expenses, netProfit: report.netProfit, outstandingDebt: report.outstandingDebt, cashBalance: drawer.balance, cashReceived:report.cashReceived,whishReceived:report.whishReceived,collectionsTotal:report.collectionsTotal });
    for(const field of ["debtAccounts","debtPayments","refundPayments","installationPayments","internetRenewals","whishPayments","whishCashouts","whishReceiptCorrections","whishWalletRestorations","optionalWhishPayments","maintenancePayments","fundedStockFeePayments"]) result[field].push(...(report[field]||[]).map(item=>({...item,workspaceId:section.id,workspaceName:section.name})));
    for (const day of report.daily) {
      const value = days.get(day.day) || { day: day.day, revenue: 0, profit: 0 };
      value.revenue = Math.round((value.revenue + day.revenue) * 100) / 100;
      value.profit = Math.round((value.profit + day.profit) * 100) / 100;
      days.set(day.day, value);
    }
    result.recentSales.push(...report.recentSales.map(sale => ({ ...sale, workspaceId: section.id, workspaceName: section.name })));
  }
  result.daily = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  result.recentSales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  result.recentSales = result.recentSales.slice(0, 100);
  result.internetRenewals.sort((a,b)=>b.paidAt.localeCompare(a.paidAt));
  result.debtPayments.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
  result.refundPayments.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
  result.profitParts=combineProfitBreakdowns(reports.map(entry=>entry.report));
  const fixedMonthly=reports.filter(entry=>entry.report.fixedMonthlyProjection===true);
  if(fixedMonthly.length){result.fixedMonthlyProjection=true;result.fixedMonthly=require('./fixed-monthly-spending.cjs').mergeSummaries(fixedMonthly.map(entry=>entry.report.fixedMonthly));result.fixedMonthlyProfitCost=result.fixedMonthly.profitCost;result.fixedMonthlyFees=result.fixedMonthly.fee;}
  const companyDebt=reports.filter(entry=>entry.report.companyDebtProjection===true);
  if(companyDebt.length){result.companyDebtProjection=true;result.companyDebt=require('./company-debt-spending.cjs').mergeSummaries(companyDebt.map(entry=>entry.report.companyDebt));result.companyDebtFees=result.companyDebt.fee;}
  const stock=reports.filter(entry=>entry.report.fundedStock!==undefined).map(entry=>entry.report.fundedStock);
  if(stock.length){
    const flow=['principal','paid','periodCustodyPaid','cashPaid','whishPaid','fee','fees','additionalProfitDeduction'],limit=BigInt(Number.MAX_SAFE_INTEGER),money=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)throw Error('Paid stock purchase report totals could not be verified.');return Math.round(value*100);},sum=values=>{const n=values.reduce((n,value)=>n+BigInt(money(value)),0n);if(n>limit)throw Error('Paid stock purchase report totals exceed the supported range.');return Number(n)/100;};
    const flat=stock.flatMap(value=>value.workspaceId==='all'?value.byBusiness||[]:[value]),groups=new Map();if(!flat.length)throw Error('Paid stock purchase business proof is unavailable.');
    for(const value of flat){if(value.basis!=='funded_stock_acquisition'||!WORKSPACES.some(section=>section.id===value.workspaceId)||value.noFundingSpend!==true||value.noRevenue!==true||value.principalIsCapital!==true||!Array.isArray(value.rows)||!Array.isArray(value.daily)||!Number.isSafeInteger(value.pendingCount)||value.pendingCount<0)throw Error('Paid stock purchase report proof is invalid.');for(const field of [...flow,'custodyPaid','openingCustodyPaid'])money(value[field]);const group=groups.get(value.workspaceId)||[];group.push(value);groups.set(value.workspaceId,group);}
    const merge=(values,id)=>{const sorted=[...values].sort((a,b)=>a.end.localeCompare(b.end)||a.start.localeCompare(b.start)),latest=sorted.at(-1),requests=new Set(),days=new Map(),merged={...latest,workspaceId:id,start:values.map(row=>row.start).sort()[0],end:values.map(row=>row.end).sort().at(-1),rows:[]};for(const value of values){for(const row of value.rows){if(typeof row.requestId!=='string'||requests.has(row.requestId))throw Error('A paid stock purchase was counted twice in a report.');requests.add(row.requestId);merged.rows.push({...row});}for(const row of value.daily){const day=days.get(row.day)||{day:row.day,principal:0,fee:0,count:0};day.principal=sum([day.principal,row.principal]);day.fee=sum([day.fee,row.fee]);if(!Number.isSafeInteger(row.count)||row.count<0||!Number.isSafeInteger(day.count+row.count))throw Error('Paid stock purchase report count is invalid.');day.count+=row.count;days.set(row.day,day);}}for(const field of flow)merged[field]=sum(values.map(row=>row[field]));merged.count=merged.rows.length;merged.pendingCount=values.reduce((sum,row)=>sum+row.pendingCount,0);if(!Number.isSafeInteger(merged.pendingCount))throw Error('Paid stock purchase pending count is invalid.');merged.daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day));return merged;};
    const business=[...groups].map(([id,values])=>merge(values,id));result.fundedStock=business.length===1?business[0]:{...merge(business,'all'),custodyStart:null,custodyPaid:sum(business.map(row=>row.custodyPaid)),openingCustodyPaid:sum(business.map(row=>row.openingCustodyPaid)),byBusiness:business};
  }
  const unavailableWholesale=reports.filter(entry=>entry.report.wholesaleAttributionUnavailable===true);
  if(unavailableWholesale.length){result.wholesaleAttributionUnavailable=true;result.profitUnavailableReason=[...new Set(unavailableWholesale.map(entry=>entry.report.profitUnavailableReason).filter(Boolean))].join(' ');result.wholesaleAttributionDays=[...new Set(unavailableWholesale.flatMap(entry=>entry.report.wholesaleAttributionDays||[]))].sort();}
  // Monthly reports also merge several days/months of ONE business. Preserve
  // the wholesale proof through those merges so a later business consolidation
  // can eliminate it once, using wholesale value rather than acquisition COGS.
  const wholesale=reports.filter(entry=>entry.report.internalWholesaleProjection===true);
  if(wholesale.length){
    result.internalWholesaleProjection=true;
    for(const field of ['internalWholesaleRevenue','internalWholesaleCost','internalWholesaleAcquisitionCost','internalWholesaleProfit','internalWholesaleSaleCount','internalWholesaleEliminated'])result[field]=Math.round(wholesale.reduce((sum,entry)=>sum+Number(entry.report[field]||0),0)*100)/100;
    const wholesaleDays=new Map();for(const {report}of wholesale)for(const row of report.internalWholesaleDaily||[]){const value=wholesaleDays.get(row.day)||{day:row.day,revenue:0,cost:0,acquisitionCost:0,profit:0,count:0};for(const field of ['revenue','cost','acquisitionCost','profit','count'])value[field]=Math.round((value[field]+Number(row[field]||0))*100)/100;wholesaleDays.set(row.day,value);}result.internalWholesaleDaily=[...wholesaleDays.values()].sort((a,b)=>a.day.localeCompare(b.day));
  }
  const trades=reports.filter(entry=>entry.report.productTrade).map(entry=>({workspaceId:entry.section.id,trade:entry.report.productTrade}));
  if(trades.length){
    const tradeFields=['saleCount','physicalProductRevenue','physicalProductWholesaleCost','physicalProductAcquisitionCost','physicalProductGrossMargin','marginFunding','internalWholesaleCost'],latestByBusiness=new Map(),tradeDays=new Map();
    // Whole-invoice custody includes the Maintenance payment too. Preserve its
    // separately proved zero-cost profit through day/month/business merges;
    // otherwise an archived Resellers dashboard would lose that profit again.
    // Old reports without these opt-in fields retain their original shape.
    const mixedFields=['mixedServiceRevenue','mixedServiceGrossMargin'],hasMixed=trades.some(({trade})=>mixedFields.some(field=>Object.hasOwn(trade,field)));
    const mixedCents=value=>{const n=Math.round(value*100);if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(n)||Math.abs(value*100-n)>1e-6)throw Error('Combined Maintenance report totals could not be verified.');return n;};
    const mixedSum=values=>{const n=values.reduce((sum,value)=>sum+BigInt(mixedCents(value)),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Combined Maintenance report totals exceed the supported range.');return Number(n)/100;};
    if(hasMixed)for(const {trade}of trades)if(mixedFields.some(field=>Object.hasOwn(trade,field))){if(mixedFields.some(field=>!Object.hasOwn(trade,field)))throw Error('Combined Maintenance report proof is incomplete.');for(const field of mixedFields)mixedCents(trade[field]);}
    for(const {workspaceId,trade}of trades){const last=latestByBusiness.get(workspaceId);if(!last||String(trade.end||'')>=String(last.end||''))latestByBusiness.set(workspaceId,trade);for(const row of trade.daily||[]){const value=tradeDays.get(row.day)||{day:row.day,revenue:0,cost:0,acquisitionCost:0,profit:0,count:0};for(const field of ['revenue','cost','acquisitionCost','profit','count'])value[field]=Math.round((value[field]+Number(row[field]||0))*100)/100;if(Object.hasOwn(row,'mixedServiceProfit')){if(!hasMixed)throw Error('Combined Maintenance daily profit has no report proof.');value.mixedServiceProfit=mixedSum([value.mixedServiceProfit??0,row.mixedServiceProfit]);}tradeDays.set(row.day,value);}}
    const last=trades.at(-1).trade,combined={...last,start:trades.map(row=>row.trade.start).filter(Boolean).sort()[0],end:trades.map(row=>row.trade.end).filter(Boolean).sort().at(-1),daily:[...tradeDays.values()].sort((a,b)=>a.day.localeCompare(b.day))};
    for(const field of tradeFields)combined[field]=Math.round(trades.reduce((sum,row)=>sum+Number(row.trade[field]||0),0)*100)/100;
    if(hasMixed)for(const field of mixedFields)combined[field]=mixedSum(trades.map(({trade})=>Object.hasOwn(trade,field)?trade[field]:0));
    // Custody is an absolute balance through each report's end, not a flow.
    // Take the final balance per business instead of adding it once per day.
    combined.warehouseNetCustody=Math.round([...latestByBusiness.values()].reduce((sum,trade)=>sum+Number(trade.warehouseNetCustody||0),0)*100)/100;
    combined.productTradeAdjustment=Math.round((combined.physicalProductGrossMargin+(hasMixed?combined.mixedServiceGrossMargin:0)-combined.warehouseNetCustody)*100)/100;
    combined.custodyAttributionUnavailable=trades.some(row=>row.trade.custodyAttributionUnavailable===true);
    result.productTrade=combined;
  }
  // Internal wholesale is visible in Admin's standalone business report, but
  // it is not a second customer payment when the businesses are consolidated.
  if(new Set(reports.map(entry=>entry.section.id)).size>1&&reports.some(entry=>entry.section.id==='main')){
    const mainReports=reports.filter(entry=>entry.section.id==='main').map(entry=>entry.report),value=Math.round(mainReports.reduce((sum,report)=>sum+Number(report.internalWholesaleRevenue||0)-Number(report.internalWholesaleEliminated||0),0)*100)/100,count=mainReports.reduce((sum,report)=>sum+Number(report.internalWholesaleSaleCount||0),0);
    for(const field of ['revenue','posRevenue','costOfGoods','posCostOfGoods'])result[field]=Math.round((result[field]-value)*100)/100;
    result.saleCount-=count;
    const days=new Map();for(const report of mainReports)for(const row of report.internalWholesaleDaily||[]){const value=days.get(row.day)||{revenue:0};value.revenue=Math.round((value.revenue+Number(row.revenue||0))*100)/100;days.set(row.day,value);}
    result.daily=result.daily.map(row=>({...row,revenue:Math.round((row.revenue-Number(days.get(row.day)?.revenue||0))*100)/100}));
    result.profitParts=result.profitParts.map(part=>part.id==='products'?{...part,revenue:Math.round((part.revenue-value)*100)/100,cost:Math.round((part.cost-value)*100)/100}:part);
    result.internalWholesaleEliminated=Math.round((Number(result.internalWholesaleEliminated||0)+value)*100)/100;
  }
  return result;
}

module.exports = { WORKSPACES, RESET_TABLES, workspace, combineReports };
