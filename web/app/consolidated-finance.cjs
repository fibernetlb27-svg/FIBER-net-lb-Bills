'use strict';
// Read-only presentation totals. Transaction reports retain their income
// policy; dashboard profits use each business's own calculation separately.
const {combineReports}=require('./workspaces.cjs');
const cents=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error(`The ${label} total is unavailable. No incomplete consolidated total was shown.`);const result=Math.round((value+Number.EPSILON)*100);if(!Number.isSafeInteger(result))throw Error(`The ${label} total exceeds the supported range.`);return result;};
const sumMoney=(values,label)=>{const total=values.reduce((n,value)=>n+BigInt(cents(value,label)),0n),limit=BigInt(Number.MAX_SAFE_INTEGER);if(total>limit||total< -limit)throw Error(`The ${label} total exceeds the supported range.`);return Number(total)/100;};
const sumCount=(values,label)=>{if(values.some(value=>!Number.isSafeInteger(value)||value<0))throw Error(`The ${label} count is unavailable.`);const total=values.reduce((n,value)=>n+value,0);if(!Number.isSafeInteger(total))throw Error(`The ${label} count exceeds the supported range.`);return total;};
function emptyOverview(){return {employeeAbsent:true,report:{daily:[],recentSales:[],profitParts:[]},wallets:[],whishFeePolicy:{deferred:false,warnings:[],reason:''},dashboard:{todaySales:{value:0,count:0},todayBills:{value:0,count:0},todayTelecom:{value:0,count:0},todayProfit:{value:0},monthExpenses:{value:0},outstandingDebt:{value:0,count:0},drawer:{balance:0,todayIn:0,lastCount:null},stock:{value:0,units:0},lowStock:[],recentSales:[],recentActivity:[]}};}
function paidMonthlyAllocation(value){
 const amount=sumMoney([value],'paid fixed monthly allocation');
 if(value<0||Math.abs(value*100-Math.round(value*100))>1e-6)throw Error('Fixed monthly payment totals could not be verified.');
 return amount;
}
function fixedMonthlyTotals(overview){
 const saved=overview.fixedMonthly??overview.report?.fixedMonthly;if(saved===undefined)return null;
 if(!saved||saved.basis!=='fixed_monthly_paid')throw Error('Fixed monthly payment totals could not be verified.');
 const reversed=saved.reversalProjectionVersion!==undefined;
 if(reversed)require('./fixed-monthly-spending.cjs').validateSummary(saved);
 // Paid participation, configured profit deduction and source custody differ
 // for reduced-profit percentages and historical single-source payments.
 const billShare=reversed?sumMoney([saved.billShare],'net paid fixed monthly allocation'):paidMonthlyAllocation(saved.billShare),profitCost=sumMoney([saved.profitCost],'fixed monthly profit cost'),fee=sumMoney([saved.fee],'fixed monthly fee'),custodyPaid=sumMoney([saved.custodyPaid],'fixed monthly source custody'),pendingCount=sumCount([saved.pendingCount],'pending fixed monthly payments');
 if(!reversed&&([profitCost,fee,custodyPaid].some(value=>value<0)||profitCost>billShare))throw Error('Fixed monthly payment totals could not be verified.');
 return {billShare,profitCost,fee,custodyPaid,pendingCount,...reversed?{proof:JSON.parse(JSON.stringify(saved))}:{}};
}
function companyDebtTotals(overview){
 const saved=overview.companyDebt??overview.report?.companyDebt;if(saved===undefined)return null;
 if(!saved||saved.basis!=='company_debt_paid'||saved.profitCost!==0)throw Error('Company debt payment totals could not be verified.');
 const fee=sumMoney([saved.fee],'Company debt fee'),custodyPaid=sumMoney([saved.custodyPaid],'Company debt source custody'),pendingCount=sumCount([saved.pendingCount],'pending Company debt payments');
 if([fee,custodyPaid].some(value=>value<0))throw Error('Company debt payment totals could not be verified.');return {fee,custodyPaid,pendingCount};
}
function fundedStockTotals(section,overview){
 const saved=overview.fundedStock??overview.report?.fundedStock;if(saved===undefined)return null;
 if(!saved||saved.basis!=='funded_stock_acquisition'||saved.workspaceId!==section.id||saved.noFundingSpend!==true||saved.noRevenue!==true||saved.principalIsCapital!==true)throw Error('Paid stock purchase totals could not be verified.');
 const principal=paidMonthlyAllocation(saved.principal),custodyPaid=paidMonthlyAllocation(saved.custodyPaid),fee=paidMonthlyAllocation(saved.fee),pendingCount=sumCount([saved.pendingCount],'pending stock supplier payments');
 return {principal,custodyPaid,fee,pendingCount};
}
function bankCustodyTotals(section,overview){
 const saved=overview.bankCustody;if(saved===undefined)return 0;
 const fail=()=>{throw Error('Bank custody totals could not be verified. No unverified business profit was shown.');};
 const validDay=value=>typeof value==='string'&&/^2[01]\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 if(!saved||saved.basis!=='bank_internal_custody'||saved.workspaceId!==section.id||saved.accountKey!==null&&(typeof saved.accountKey!=='string'||!saved.accountKey.trim()||saved.accountKey.length>200)||!validDay(saved.through)||saved.custodyStart!==null&&(!validDay(saved.custodyStart)||saved.custodyStart>saved.through)||overview.accountKey!==undefined&&saved.accountKey!==overview.accountKey||overview.today!==undefined&&saved.through!==overview.today)return fail();
 const value=saved.netDeposits;
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)return fail();
 return value;
}
function monthOpeningTotals(section,overview){
 const saved=overview.monthOpening;if(saved===undefined)return 0;
 require('./month-opening-custody.cjs').validateSummary(saved);
 if(saved.workspaceId!==section.id||overview.accountKey!==undefined&&saved.accountKey!==overview.accountKey||overview.today!==undefined&&saved.through!==overview.today)throw Error('The carried monthly opening has a different business or employee scope. No unverified business profit was shown.');
 return saved.total;
}
function adminTransferTotals(section,overview){
 const saved=overview.adminTransferCustody;if(saved===undefined)return 0;
 const fail=()=>{throw Error('Admin transfer custody totals could not be verified. No unverified business profit was shown.');};
 const validDay=value=>typeof value==='string'&&/^2[01]\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 if(!saved||saved.basis!=='admin_transfer_custody'||saved.workspaceId!==section.id||saved.accountKey!==null&&(typeof saved.accountKey!=='string'||!saved.accountKey.trim()||saved.accountKey.length>200)||!validDay(saved.through)||saved.custodyStart!==null&&(!validDay(saved.custodyStart)||saved.custodyStart>saved.through)||overview.accountKey!==undefined&&saved.accountKey!==overview.accountKey||overview.today!==undefined&&saved.through!==overview.today)return fail();
 const value=saved.netOut;if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)return fail();
 // Both custody projections neutralize movements since the same monthly
 // opening. A mismatched cutoff cannot be silently mixed into balance profit.
 if(overview.bankCustody&&saved.custodyStart!==overview.bankCustody.custodyStart)return fail();
 if(overview.monthOpening&&saved.custodyStart!==overview.monthOpening.openingDate)return fail();
 return value;
}
function carriedResellerCollectionTotals(section,overview){
 const saved=overview.carriedResellerCollectionCustody;if(saved===undefined)return 0;
 const fail=()=>{throw Error('Carried reseller collection custody could not be verified. No unverified business profit was shown.');};
 const validDay=value=>typeof value==='string'&&/^2[01]\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 if(!saved||saved.basis!=='carried_reseller_collection_custody'||saved.workspaceId!==section.id||saved.accountKey!==null&&(typeof saved.accountKey!=='string'||!saved.accountKey.trim()||saved.accountKey.length>200)||!validDay(saved.through)||saved.custodyStart!==null&&(!validDay(saved.custodyStart)||saved.custodyStart>saved.through)||overview.accountKey!==undefined&&saved.accountKey!==overview.accountKey||overview.today!==undefined&&saved.through!==overview.today)return fail();
 const value=saved.netOut;if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)return fail();
 if(overview.bankCustody&&saved.custodyStart!==overview.bankCustody.custodyStart||overview.monthOpening&&saved.custodyStart!==overview.monthOpening.openingDate||overview.adminTransferCustody&&saved.custodyStart!==overview.adminTransferCustody.custodyStart)return fail();
 return value;
}
function businessTotals(section,overview){
 const zero={basis:'independent_business',cash:0,wallets:0,whishFees:0,otherExpenses:0,profitBeforeOther:0,profitAfterOther:0,profitKnown:true,pendingCount:0};
 const monthOpening=monthOpeningTotals(section,overview),bankCustody=bankCustodyTotals(section,overview),adminTransfers=adminTransferTotals(section,overview),carriedCollections=carriedResellerCollectionTotals(section,overview),fixed=fixedMonthlyTotals(overview),debt=companyDebtTotals(overview),stock=fundedStockTotals(section,overview),fixedFields={...fixed?{fixedMonthlyPaid:fixed.billShare,fixedMonthlyProfitCost:fixed.profitCost,fixedMonthlyFees:fixed.fee,...fixed.proof?{fixedMonthlyProof:fixed.proof}:{}}:{},...debt?{companyDebtFees:debt.fee}:{},...stock?{fundedStockPrincipal:stock.principal,fundedStockFees:stock.fee}:{}};
 if(overview.employeeAbsent){
  // A historical Main purchase keeps its creator even if that person no
  // longer has a local Resellers account. Custody stays zero, not its cost.
  const cost=section.id==='fiber-resellers'&&Number.isFinite(overview.bandwidthCost?.incurredCost)?sumMoney([overview.bandwidthCost.incurredCost],'allocated bandwidth cost'):0,total=sumMoney([cost,fixed?.profitCost||0,fixed?.fee||0,debt?.fee||0,stock?.fee||0],'absent employee allocated costs'),pendingCount=sumCount([fixed?.pendingCount||0,debt?.pendingCount||0,stock?.pendingCount||0],'pending allocated payments');
  return {...zero,...fixedFields,whishFees:sumMoney([fixed?.fee||0,debt?.fee||0,stock?.fee||0],'absent employee allocated fees'),profitKnown:!pendingCount,pendingCount,profitBeforeOther:pendingCount?null:total?-total:0,profitAfterOther:pendingCount?null:total?-total:0};
 }
 const label=section.name||section.id,report=overview.report,cash=sumMoney([overview.dashboard.drawer.balance],label+' cash'),wallets=sumMoney(overview.wallets.map(wallet=>wallet.balance),label+' wallets'),whishFees=sumMoney([report.whishFees],label+' fees'),reseller=section.id==='fiber-resellers',company=section.id==='main',costKnown=Number.isFinite(overview.bandwidthCost?.incurredCost),cost=costKnown?sumMoney([overview.bandwidthCost.incurredCost],label+' bandwidth cost'):null,spending=overview.bandwidthSpending,paidKnown=Number.isFinite(spending?.paid),pendingCount=reseller&&spending?sumCount([spending.pendingCount],'pending supplier payments'):0;
 // Main keeps the physical expense/report. Its dashboard allocates that cost
 // to Resellers, where it is already mandatory, instead of optional Other.
 // Dedicated monthly payment fees live in the fee projection, not SQL
 // expenses. Add them back here so Other never cancels/repeats that fee.
 const otherExpenses=company&&!costKnown?null:sumMoney([report.expenses,-whishFees,fixed?.fee||0,debt?.fee||0,...company?[-cost]:[]],label+' other expenses'),profitKnown=report.wholesaleAttributionUnavailable!==true&&!fixed?.pendingCount&&!debt?.pendingCount&&!stock?.pendingCount&&(!reseller||costKnown&&paidKnown&&!pendingCount&&!report.productTrade?.custodyAttributionUnavailable)&&otherExpenses!==null;
 const productAdjustment=reseller&&report.productTrade?sumMoney([report.productTrade.productTradeAdjustment],label+' product-trade adjustment'):0;
 // Buying inventory changes assets, not profit or expense funding. Resellers'
 // balance-derived dashboard therefore neutralizes that supplier principal;
 // the optional fee remains in whishFees exactly once like other receipt fees.
 // Bank stores business money; it creates no expense or earnings. Neutralize
 // only the signed deposit/withdrawal flow since this drawer's latest monthly
 // opening. The all-time Bank balance may contain older savings and must not
 // enter a new month's balance-derived profit. Other businesses use reports.
 // New month closing carries unspent principal in Cash/Whish instead of
 // offsetting it to zero. Subtract that verified opening so the same prior
 // earnings do not become income again. Legacy zero openings subtract zero.
 // Admin custody transfers are neither earnings nor a cost. Outbound
 // principal is added back and inbound principal removed, including transfers
 // across businesses and between holders of one business.
 // Collecting an old carried bill changes who holds its opening money. It
 // cannot create new employee earnings or a loss for the original holder.
 const profitBeforeOther=profitKnown?sumMoney(reseller?[cash,wallets,bankCustody,adminTransfers,carriedCollections,-monthOpening,spending.paid,fixed?.custodyPaid||0,debt?.custodyPaid||0,stock?.custodyPaid||0,-cost,-whishFees,productAdjustment,-(fixed?.profitCost||0)]:[report.grossProfit,-whishFees,-(fixed?.profitCost||0)],label+' profit before Other'):null;
 const profitAfterOther=profitKnown?sumMoney([profitBeforeOther,-otherExpenses],label+' profit after Other'):null;
 return {...zero,...fixedFields,cash,wallets,whishFees,otherExpenses,profitBeforeOther,profitAfterOther,profitKnown,pendingCount:sumCount([pendingCount,fixed?.pendingCount||0,debt?.pendingCount||0,stock?.pendingCount||0],'pending business payments'),...stock?.pendingCount?{profitUnavailableReason:'Finish the saved stock supplier payment before displaying verified business profit.'}:debt?.pendingCount?{profitUnavailableReason:'Finish the saved Company debt payment before displaying verified business profit.'}:fixed?.pendingCount?{profitUnavailableReason:'Finish the saved fixed monthly payment before displaying verified business profit.'}:report.wholesaleAttributionUnavailable===true?{wholesaleAttributionUnavailable:true,profitUnavailableReason:report.profitUnavailableReason||'Admin warehouse wholesale has no verified employee ownership. Select All employees for the verified Main profit.'}:report.productTrade?.custodyAttributionUnavailable?{profitUnavailableReason:'Mixed employee handovers cannot identify the product share of this employee’s remaining money. Select All employees for the verified business profit.'}:{}};
}
function sumBusinessTotals(overviews){
 const totals=overviews.map(({section,overview})=>overview.dashboardTotals||businessTotals(section,overview)),sum=field=>sumMoney(totals.map(row=>row[field]),'business dashboard '+field),profitKnown=totals.every(row=>row.profitKnown===true),otherKnown=totals.every(row=>Number.isFinite(row.otherExpenses));
 const monthly=totals.map(row=>{if(['fixedMonthlyPaid','fixedMonthlyProfitCost','fixedMonthlyFees'].every(field=>row[field]===undefined))return null;if(row.fixedMonthlyProof!==undefined){const proof=require('./fixed-monthly-spending.cjs').validateSummary(row.fixedMonthlyProof);if(proof.reversalProjectionVersion!==1||proof.billShare!==row.fixedMonthlyPaid||proof.profitCost!==row.fixedMonthlyProfitCost||proof.fee!==row.fixedMonthlyFees)throw Error('Fixed monthly payment totals could not be verified.');return {paid:proof.billShare,cost:proof.profitCost,fee:proof.fee};}const paid=paidMonthlyAllocation(row.fixedMonthlyPaid),cost=paidMonthlyAllocation(row.fixedMonthlyProfitCost),fee=paidMonthlyAllocation(row.fixedMonthlyFees);if(cost>paid)throw Error('Fixed monthly payment totals could not be verified.');return {paid,cost,fee};});
 return {basis:'business_sum',cash:sum('cash'),wallets:sum('wallets'),whishFees:sum('whishFees'),otherExpenses:otherKnown?sum('otherExpenses'):null,profitBeforeOther:profitKnown?sum('profitBeforeOther'):null,profitAfterOther:profitKnown?sum('profitAfterOther'):null,profitKnown,...monthly.some(Boolean)?{fixedMonthlyPaid:sumMoney(monthly.map(row=>row?.paid||0),'combined paid fixed monthly allocation'),fixedMonthlyProfitCost:sumMoney(monthly.map(row=>row?.cost||0),'combined fixed monthly cost'),fixedMonthlyFees:sumMoney(monthly.map(row=>row?.fee||0),'combined fixed monthly fees')}:{},...totals.some(row=>row.companyDebtFees!==undefined)?{companyDebtFees:sumMoney(totals.map(row=>row.companyDebtFees||0),'combined Company debt fees')}:{},...totals.some(row=>row.wholesaleAttributionUnavailable===true)?{wholesaleAttributionUnavailable:true}:{},...!profitKnown&&totals.some(row=>row.profitUnavailableReason)?{profitUnavailableReason:[...new Set(totals.map(row=>row.profitUnavailableReason).filter(Boolean))].join(' ')}:{},pendingCount:sumCount(totals.map(row=>row.pendingCount),'pending supplier payments')};
}
// Old funding used a dedicated bill type. Remove only its income presentation
// from All businesses, never its original records, custody, payment flow or fee.
// Rows must come from the caller's ownership-scoped active bill view.
function excludeLegacyFunding(overview,rows,{start,today}){
 const selected=rows.filter(row=>row.serviceType==='Reseller transfer'&&row.day>=start&&row.day<=today);
 if(!selected.length)return overview;
 const total=(items,field)=>sumMoney(items.map(row=>row[field]),'legacy funding '+field),amount=total(selected,'amount'),cost=total(selected,'cost'),profit=sumMoney([amount,-cost],'legacy funding profit');
 const subtract=(value,change,label)=>sumMoney([value,-change],label),report={...overview.report};
 for(const field of ['revenue','serviceRevenue'])report[field]=subtract(report[field],amount,field);
 for(const field of ['costOfGoods','serviceCost'])report[field]=subtract(report[field],cost,field);
 for(const field of ['grossProfit','serviceProfit','netProfit'])report[field]=subtract(report[field],profit,field);
 if(!Number.isSafeInteger(report.billCount)||report.billCount<selected.length)throw Error('The legacy funding bill count is inconsistent. No incomplete consolidated total was shown.');
 report.billCount-=selected.length;
 const days=new Map();for(const row of selected){const day=days.get(row.day)||[];day.push(row);days.set(row.day,day);}
 // Closed partial-month snapshots can omit a fully cancelled day's point.
 if([...days].some(([day,funding])=>!report.daily.some(row=>row.day===day)&&(total(funding,'amount')!==0||total(funding,'cost')!==0)))throw Error('The legacy funding daily report is unavailable. No incomplete consolidated total was shown.');
 report.daily=report.daily.map(row=>{const funding=days.get(row.day);if(!funding)return {...row};const revenue=total(funding,'amount'),directCost=total(funding,'cost');return {...row,revenue:subtract(row.revenue,revenue,'daily revenue'),profit:subtract(row.profit,sumMoney([revenue,-directCost],'daily funding profit'),'daily profit')};});
 if(!report.profitParts.some(part=>part.id==='resellers'))throw Error('The legacy funding profit breakdown is unavailable. No incomplete consolidated total was shown.');
 report.profitParts=report.profitParts.map(part=>part.id==='resellers'?{...part,revenue:subtract(part.revenue,amount,'reseller revenue'),cost:subtract(part.cost,cost,'reseller cost'),profit:subtract(part.profit,profit,'reseller profit')}:{...part});
 const daily=selected.filter(row=>row.day===today),dailyAmount=total(daily,'amount'),dailyCost=total(daily,'cost'),dashboard={...overview.dashboard};
 if(!Number.isSafeInteger(dashboard.todayBills.count)||dashboard.todayBills.count<daily.length)throw Error('The legacy funding dashboard count is inconsistent. No incomplete consolidated total was shown.');
 dashboard.todayBills={...dashboard.todayBills,value:subtract(dashboard.todayBills.value,dailyAmount,'today bill revenue'),count:dashboard.todayBills.count-daily.length};
 dashboard.todayProfit={...dashboard.todayProfit,value:dashboard.wholesaleAttributionUnavailable===true?null:subtract(dashboard.todayProfit.value,sumMoney([dailyAmount,-dailyCost],'today funding profit'),'today profit')};
 return {...overview,report,dashboard};
}
function combine(overviews,{sections,employees,accountKey=null,today}){
 if(!Array.isArray(overviews)||!sections.length||overviews.length!==sections.length||new Set(overviews.map(row=>row.section.id)).size!==sections.length||sections.some(section=>!overviews.some(row=>row.section.id===section.id)))throw Error('Every required business must be available for the consolidated dashboard.');
 const report=combineReports(overviews.map(({section,overview})=>{if(!overview?.report||!overview.dashboard||!Array.isArray(overview.wallets))throw Error(`The ${section.name} finance view is unavailable.`);if(!overview.employeeAbsent)for(const field of ['revenue','costOfGoods','grossProfit','expenses','netProfit','whishFees'])cents(overview.report[field],section.name+' '+field);return {section,report:overview.report,drawer:overview.dashboard.drawer};})),walletMap=new Map();
 for(const field of ['revenue','costOfGoods','grossProfit','expenses','netProfit','whishFees'])cents(report[field],'consolidated '+field);
 for(const {section,overview}of overviews){const seen=new Set();for(const wallet of overview.wallets){if(!wallet.id||seen.has(wallet.id))throw Error(`The ${section.name} wallet list is ambiguous.`);seen.add(wallet.id);const existing=walletMap.get(wallet.id)||{...wallet,balance:0,gross:0,fees:0,_cents:0,_gross:0,_fees:0};if(existing.number&&wallet.number&&String(existing.number)!==String(wallet.number))throw Error('A shared wallet ID has conflicting physical destination numbers. No ambiguous consolidated wallet balance was shown.');existing._cents+=cents(wallet.balance,'Whish wallet');existing._gross+=cents(wallet.gross??0,'gross Whish wallet');existing._fees+=cents(wallet.fees??0,'Whish wallet fees');if(![existing._cents,existing._gross,existing._fees].every(Number.isSafeInteger))throw Error('The consolidated wallet total exceeds the supported range.');walletMap.set(wallet.id,existing);}}
 report.reportCurrency='USD';if(report.exchangeRate===undefined){const reference=overviews.find(row=>row.overview.report.exchangeRate!==undefined);if(reference)report.exchangeRate=reference.overview.report.exchangeRate;}
 const wallets=[...walletMap.values()].map(({_cents,_gross,_fees,...wallet})=>({...wallet,balance:_cents/100,gross:_gross/100,fees:_fees/100})),views=overviews.map(row=>row.overview.dashboard),pair=name=>({value:sumMoney(views.map(d=>d[name].value),name),count:sumCount(views.map(d=>d[name].count),name)});
 const merge=(field,limit,sort)=>overviews.flatMap(({section,overview})=>(overview.dashboard[field]||[]).map(row=>({...row,workspaceId:section.id,workspaceName:section.name}))).sort(sort).slice(0,limit),recent=(a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''));
 const todayWholesaleUnavailable=views.some(view=>view.wholesaleAttributionUnavailable===true);
 const dashboard={...report.fixedMonthly?{fixedMonthly:report.fixedMonthly}:{},aggregate:true,canViewFinancials:true,activityScope:accountKey?'employee':'all',todaySales:pair('todaySales'),todayBills:pair('todayBills'),todayTelecom:pair('todayTelecom'),todayProfit:{value:todayWholesaleUnavailable?null:sumMoney(views.map(d=>d.todayProfit.value),'today profit')},monthExpenses:{value:sumMoney(views.map(d=>d.monthExpenses.value),'monthly expenses')},outstandingDebt:pair('outstandingDebt'),drawer:{balance:sumMoney(views.map(d=>d.drawer.balance),'cash drawer'),todayIn:sumMoney(views.map(d=>d.drawer.todayIn),'cash received today'),lastCount:null},stock:{value:views.some(d=>d.stock.value===null)?null:sumMoney(views.map(d=>d.stock.value),'inventory'),units:sumCount(views.map(d=>d.stock.units),'stock units')},lowStock:merge('lowStock',8,(a,b)=>Number(a.quantity)-Number(b.quantity)||String(a.name).localeCompare(String(b.name))),recentSales:merge('recentSales',6,recent),recentActivity:merge('recentActivity',10,recent),monthInternetCost:report.profitParts?.find(part=>part.id==='internet')?.cost??0,monthWhishFees:report.whishFees,totalWhishWallets:sumMoney(wallets.map(wallet=>wallet.balance),'all Whish wallets'),...todayWholesaleUnavailable?{wholesaleAttributionUnavailable:true,profitUnavailableReason:[...new Set(views.filter(view=>view.wholesaleAttributionUnavailable).map(view=>view.profitUnavailableReason).filter(Boolean))].join(' ')}:{}};
 if(report.companyDebt)dashboard.companyDebt=report.companyDebt;
 const alerts=overviews.map(({section,overview})=>({section,status:overview.whishFeePolicy||{}})),warnings=alerts.flatMap(({section,status})=>(status.warnings||[]).map(warning=>section.name+': '+warning)),deferred=alerts.filter(({status})=>status.deferred),policy={policy:'profit_only',readOnly:true,additionalCashoutFee:0,deferred:deferred.length>0,warnings,reason:deferred.map(({section,status})=>section.name+': '+(status.reason||'Older custody needs review in this business.')).join('; ')};
 return {...report.companyDebt?{companyDebt:report.companyDebt}:{},...report.fixedMonthly?{fixedMonthly:report.fixedMonthly}:{},workspaceId:'all',workspaceName:'All businesses',aggregate:true,readOnly:true,admin:true,accountKey,employeeName:accountKey?employees.find(employee=>employee.accountKey===accountKey)?.fullName||'Selected employee':'All employees',employees,recipients:[],costSettlement:null,costRecipient:null,costRecipientKey:'',whishCorrection:null,whishFeePolicy:policy,wallets,whishFees:report.whishFees,serviceCost:report.serviceCost,internetCost:dashboard.monthInternetCost,history:[],months:[],lastClosedMonth:'',today,dashboard,report,dashboardTotals:sumBusinessTotals(overviews),incomeBasis:'Recorded business income only; internal transfers and reseller funding are excluded.',businesses:overviews.map(({section,overview})=>({workspaceId:section.id,workspaceName:section.name,employeeAbsent:!!overview.employeeAbsent,dashboardTotals:overview.dashboardTotals||businessTotals(section,overview)}))};
}
module.exports={emptyOverview,combine,excludeLegacyFunding,businessTotals,sumBusinessTotals};
