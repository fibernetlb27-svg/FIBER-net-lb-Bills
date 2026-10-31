const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const labels={products:"Products / POS",internet:"Internet bills & plan changes",satellite:"Satellite bills",resellers:"Reseller payments",other:"Other / combined services",telecom:"Mobile & Ogero"};
function profitBreakdown(sales,bills,telecom,expenses,installationIncome=0,fixedMonthly=null){
  const parts=Object.entries(labels).map(([id,label])=>({id,label,revenue:0,cost:0,profit:0}));
  const add=(id,revenue,cost)=>{const part=parts.find(item=>item.id===id);part.revenue=round(part.revenue+Number(revenue));part.cost=round(part.cost+Number(cost));part.profit=round(part.revenue-part.cost);};
  add("products",sales.revenue,sales.costOfGoods);
  add("telecom",telecom.telecomRevenue,telecom.telecomCost);
  for(const bill of bills){const id=["Internet","Internet plan change"].includes(bill.serviceType)?"internet":bill.serviceType==="Satellite"?"satellite":bill.serviceType==="Reseller transfer"?"resellers":"other";add(id,bill.revenue,bill.cost);}
  parts.push({id:'installation',label:'Installation and free-renewal expense funding',revenue:round(installationIncome),cost:0,profit:round(installationIncome)});
  parts.push({id:"expenses",label:"Company expenses (deducted once)",revenue:0,cost:round(expenses),profit:-round(expenses)});
  return fixedMonthly===null?parts:applyFixedMonthlyCosts(parts,fixedMonthly);
}
function applyFixedMonthlyCosts(parts,fixed={}){
  if(!Array.isArray(parts)||parts.some(part=>['fixed_monthly','fixed_monthly_whish_fee'].includes(part.id)))throw Error('Fixed monthly costs were already included or the original profit breakdown is unavailable.');
  const {profitCost=0,fee=0}=fixed,reversed=fixed.reversalProjectionVersion!==undefined;
  // Negative adjustments are permitted only with the complete, verified
  // gross/returned proof. Ordinary callers cannot turn a cost into income.
  if(reversed)require('./fixed-monthly-spending.cjs').validateSummary(fixed);
  const money=(value,label)=>{const cents=Math.round(value*100);if(typeof value!=='number'||!Number.isFinite(value)||!reversed&&value<0||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-6)throw Error('The fixed monthly '+label+' is unavailable.');return cents/100;};
  const cost=money(profitCost,'profit deduction'),fees=money(fee,'Whish fee'),result=parts.map(part=>({...part}));
  if(cost)result.push({id:'fixed_monthly',label:'Fixed monthly profit deduction (paid once)',revenue:0,cost,profit:-cost});
  if(fees)result.push({id:'fixed_monthly_whish_fee',label:'Whish fees — fixed monthly payments (paid once)',revenue:0,cost:fees,profit:-fees});
  return result;
}
function applyCompanyDebtFees(parts,{profitCost=0,fee=0}={}){
  if(!Array.isArray(parts)||parts.some(part=>part.id==='company_debt_whish_fee'))throw Error('Company debt fees were already included or the original profit breakdown is unavailable.');
  const cents=Math.round(fee*100);if(profitCost!==0||typeof fee!=='number'||!Number.isFinite(fee)||fee<0||!Number.isSafeInteger(cents)||Math.abs(fee*100-cents)>1e-6)throw Error('The Company debt Whish fee is unavailable.');
  const result=parts.map(part=>({...part}));if(cents)result.push({id:'company_debt_whish_fee',label:'Whish fees — Company debt repayments (paid once)',revenue:0,cost:cents/100,profit:-cents/100});return result;
}
function combineProfitBreakdowns(reports){
  const totals=new Map();
  for(const report of reports)for(const part of report.profitParts||[]){const combined=totals.get(part.id)||{...part,revenue:0,cost:0,profit:0};for(const field of ["revenue","cost","profit"])combined[field]=round(combined[field]+part[field]);totals.set(part.id,combined);}
  return [...totals.values()];
}
function profitBreakdownCsv(report){
  const quote=value=>`"${String(value).replaceAll('"','""')}"`;
  const incomplete=report.wholesaleAttributionUnavailable===true;
  return [...incomplete?[`PROFIT ATTRIBUTION NOTE,${quote(report.profitUnavailableReason||'Select All employees for verified Main warehouse profit.')}`,"NATIVE EMPLOYEE TRANSACTIONS ONLY — unallocated warehouse wholesale is excluded."]:[],"PROFIT BREAKDOWN (USD)","Activity,Revenue USD,Direct cost / expense USD,Profit contribution USD",...(report.profitParts||[]).map(part=>[part.label,part.revenue,part.cost,part.profit].map(quote).join(",")),`"NET PROFIT",,,${quote(incomplete?'Unavailable':report.netProfit)}`,"Shared company expenses are deducted separately; no arbitrary allocation to activities.",""].join("\r\n");
}
module.exports={profitBreakdown,combineProfitBreakdowns,profitBreakdownCsv,applyFixedMonthlyCosts,applyCompanyDebtFees};
