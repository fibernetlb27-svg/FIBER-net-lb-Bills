'use strict';

const POLICY_TIMEZONE = 'Asia/Beirut';
const beirutCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: POLICY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

// This rule concerns the customer's service-change adjustment only. It never
// changes a provider quote, the renewal retail price, or an already saved bill.
function customerChangePolicy(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw Error('The service-change date could not be verified.');
  const parts = Object.fromEntries(beirutCalendar.formatToParts(date).map(part => [part.type, part.value]));
  const policyDay = Number(parts.day);
  return {
    policyDate: `${parts.year}-${parts.month}-${parts.day}`,
    policyDay,
    policyTimezone: POLICY_TIMEZONE,
    zeroChargeWindow: policyDay >= 1 && policyDay <= 5
  };
}

function applyCustomerChangePolicy(retailPricing, now = new Date(), providerCost) {
  if (!retailPricing || typeof retailPricing !== 'object' || Array.isArray(retailPricing)) {
    throw Error('The service-change customer pricing could not be verified.');
  }
  const policy = customerChangePolicy(now);
  if (!policy.zeroChargeWindow) {
    return {...retailPricing, ...policy,
      suggestedAmount: retailPricing.available === true ? retailPricing.customerAmount : null};
  }
  const result = {...retailPricing, ...policy,
    available: true,
    method: 'No customer service-change charge on Beirut dates 1–5',
    reason: 'The customer service-change charge is $0 from the 1st through the 5th, inclusive. Renewal charges and provider costs are unchanged.',
    customerAmount: 0, suggestedAmount: 0, retailAdjustment: 0, customerCredit: 0};
  // Do not retain the normal retail adjustment's profit on a free change.
  delete result.expectedProfit;
  if (typeof providerCost === 'number' && Number.isFinite(providerCost)) {
    result.expectedProfit = Math.round((-providerCost + Number.EPSILON) * 100) / 100;
  }
  return result;
}

module.exports = {POLICY_TIMEZONE, customerChangePolicy, applyCustomerChangePolicy};
