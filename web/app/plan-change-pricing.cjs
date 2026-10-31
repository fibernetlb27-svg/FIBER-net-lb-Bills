const {matchInternetBundle,matchPortalPlan}=require("./src/bill-plan.js");
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const validMoney=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1000000;

// The portal quote is our cost. Apply its period share to the app's retail
// difference, rather than using that cost as a customer price. Special or
// unknown billing rules require an explicit amount, not a guessed price.
function planChangePricing(quote,bundles,fixedPlans){
  const unavailable=reason=>({available:false,reason});
  const before=matchInternetBundle(quote.beforeName,bundles),target=matchInternetBundle(quote.targetName,bundles);
  if(!before||!target||!validMoney(before.price)||!validMoney(target.price))return unavailable("Match both services to active Internet bundles with selling prices, or enter the customer amount manually.");
  const beforeCost=matchPortalPlan(before,fixedPlans)?.cost,targetCost=matchPortalPlan(target,fixedPlans)?.cost;
  if(!validMoney(beforeCost)||!validMoney(targetCost))return unavailable("Verified fixed monthly costs for both services are required for automatic customer pricing.");
  const costDifference=round(targetCost-beforeCost),priceDifference=round(target.price-before.price);
  if(costDifference===0)return unavailable("These services have the same monthly cost; Proradius's quote cannot establish a retail proration. Enter the customer amount manually.");
  if(quote.freetimePrice!==0)return unavailable("This quote includes a freetime adjustment. Enter the customer amount manually; the full portal cost is still recorded.");
  const {currentPeriodPrice,pendingRefills,pendingRefillsPrice,price,total}=quote;
  if(!quote.hasPeriodBreakdown||![currentPeriodPrice,pendingRefillsPrice,price,total].every(Number.isFinite)||!Number.isSafeInteger(pendingRefills)||pendingRefills<0||pendingRefills>1000)return unavailable("Proradius did not supply a complete period breakdown. Enter the customer amount manually.");
  if(Math.abs(price-currentPeriodPrice-pendingRefillsPrice)>0.021||Math.abs(total-price)>0.011||Math.abs(pendingRefillsPrice-costDifference*pendingRefills)>0.021)return unavailable("The portal quote has special or inconsistent period costs. Enter the customer amount manually rather than guessing its selling price.");
  const fraction=currentPeriodPrice/costDifference,tolerance=0.011/Math.abs(costDifference);
  if(fraction<-tolerance||fraction>1+tolerance)return unavailable("The portal's current-period cost does not match the verified monthly cost difference. Enter the customer amount manually.");
  const currentFraction=Math.max(0,Math.min(1,fraction));
  // A downgrade reverses revenue as well as cost. Clamping the customer
  // adjustment to zero would turn the portal credit into fictitious profit.
  const retailAdjustment=round(priceDifference*(currentFraction+pendingRefills)),customerAmount=retailAdjustment;
  if(Math.abs(customerAmount)>1000000)return unavailable("The calculated customer amount is outside the supported range.");
  return {available:true,method:"App selling-price difference × Proradius period share",beforeCode:before.code,targetCode:target.code,beforePrice:before.price,targetPrice:target.price,beforeMonthlyCost:beforeCost,targetMonthlyCost:targetCost,priceDifference,costDifference,currentFraction,pendingRefills,retailAdjustment,customerCredit:Math.max(0,-retailAdjustment),customerAmount,expectedProfit:round(customerAmount-total)};
}
module.exports={planChangePricing};
