'use strict';

const POLICY_TIMEZONE = 'Asia/Beirut';
const POLICY_VERSION = 2;
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
    policyVersion: POLICY_VERSION,
    policyDate: `${parts.year}-${parts.month}-${parts.day}`,
    policyDay,
    policyTimezone: POLICY_TIMEZONE,
    calendarWindow: policyDay >= 1 && policyDay <= 5,
    zeroChargeWindow: false
  };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const money = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
const close = (left, right, tolerance = 0.011) => Math.abs(left - right) <= tolerance;

// Date-only and zone-less provider dates describe Beirut calendar dates.
// Explicit offsets are converted to Beirut before checking the monthly 5th.
// Validate components before constructing a Date; never accept rollover dates.
function expiryCalendar(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!match) return null;
  let [year, month, day] = match.slice(1, 4).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month - 1]) return null;
  if (match[4] !== undefined) {
    const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] || 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const zone = match[8];
    if (zone) {
      let offset = 0;
      if (zone !== 'Z') {
        const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
        if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return null;
        offset = (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes);
      }
      const utc = new Date(0);
      utc.setUTCFullYear(year, month - 1, day);
      utc.setUTCHours(hour, minute, second, Number((match[7] || '').padEnd(3, '0')));
      const date = new Date(utc.getTime() - offset * 60000);
      if (!Number.isFinite(date.getTime())) return null;
      const parts = Object.fromEntries(beirutCalendar.formatToParts(date).map(part => [part.type, part.value]));
      [year, month, day] = [Number(parts.year), Number(parts.month), Number(parts.day)];
    }
  }
  return year >= 1 && year <= 9999 ? {year, month, day} : null;
}

function verifiedCoverage(pricing, quote, providerCost) {
  if (pricing.available !== true || !object(quote) || quote.hasPeriodBreakdown !== true || quote.freetimePrice !== 0) return null;
  const prices = ['beforePrice','targetPrice','beforeMonthlyCost','targetMonthlyCost'];
  if (prices.some(key => !money(pricing[key]) || pricing[key] < 0) || !money(pricing.priceDifference) || !money(pricing.costDifference) || pricing.costDifference === 0) return null;
  if (pricing.priceDifference !== round(pricing.targetPrice - pricing.beforePrice) || pricing.costDifference !== round(pricing.targetMonthlyCost - pricing.beforeMonthlyCost)) return null;
  const fraction = pricing.currentFraction, pending = pricing.pendingRefills;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || !Number.isSafeInteger(pending) || pending < 0 || pending > 1000 || quote.pendingRefills !== pending) return null;
  if (['currentPeriodPrice','pendingRefillsPrice','price','total'].some(key => !money(quote[key]))) return null;
  if (!close(quote.currentPeriodPrice, pricing.costDifference * fraction, 0.021) || !close(quote.pendingRefillsPrice, pricing.costDifference * pending, 0.021) || !close(quote.price, quote.currentPeriodPrice + quote.pendingRefillsPrice, 0.021) || !close(quote.total, quote.price)) return null;
  const expected = round(pricing.priceDifference * (fraction + pending));
  if (!money(expected) || !money(pricing.customerAmount) || !money(pricing.retailAdjustment) || pricing.customerAmount !== expected || pricing.retailAdjustment !== expected) return null;
  if (providerCost !== undefined && (!money(providerCost) || !close(providerCost, quote.total))) return null;
  const expiry = expiryCalendar(quote.expiry);
  if (!expiry || expiry.day !== 5) return null;
  const monthIndex = expiry.year * 12 + expiry.month - 1 - pending;
  const year = Math.floor(monthIndex / 12), month = monthIndex - year * 12 + 1;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  return {fraction, pending, currentPeriodEnd: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-05`};
}

function applyCustomerChangePolicy(retailPricing, now = new Date(), providerCost, providerQuote) {
  if (!retailPricing || typeof retailPricing !== 'object' || Array.isArray(retailPricing)) {
    throw Error('The service-change customer pricing could not be verified.');
  }
  const policy = customerChangePolicy(now);
  if (!policy.calendarWindow) {
    return {...retailPricing, ...policy,
      coverageReason: 'outside_calendar_window', waivedFraction: 0,
      suggestedAmount: retailPricing.available === true ? retailPricing.customerAmount : null};
  }
  const coverage = verifiedCoverage(retailPricing, providerQuote, providerCost);
  if (!coverage) {
    const result = {...retailPricing, ...policy, available: false, coverageReason: 'manual_review',
      reason: 'The paid service periods could not be verified. Review the current service, expiry and period breakdown before entering a customer adjustment.',
      customerAmount: null, suggestedAmount: null, retailAdjustment: null, customerCredit: null,
      waivedFraction: null, chargedFraction: null};
    delete result.expectedProfit;
    return result;
  }
  const closing = coverage.currentPeriodEnd <= policy.policyDate.slice(0, 7) + '-05';
  const waivedFraction = closing ? coverage.fraction : 0;
  const chargedFraction = (closing ? 0 : coverage.fraction) + coverage.pending;
  const customerAmount = round(retailPricing.priceDifference * chargedFraction);
  const zeroChargeWindow = closing && coverage.pending === 0;
  const coverageReason = closing ? coverage.pending ? 'closing_period_with_paid_refills' : 'closing_period_waived'
    : coverage.pending ? 'paid_current_period_and_refills' : 'paid_current_period';
  const result = {...retailPricing, ...policy, available: true, zeroChargeWindow, coverageReason,
    currentPeriodEnd: coverage.currentPeriodEnd, waivedFraction, chargedFraction,
    method: 'App selling-price difference × verified paid period share; eligible closing period waived on Beirut dates 1–5',
    reason: zeroChargeWindow ? 'Only the closing current period is covered, so the customer service-change adjustment is waived. Provider costs are unchanged.'
      : 'Already renewed service coverage retains its signed customer adjustment. Only an eligible closing current period is waived; provider costs are unchanged.',
    customerAmount, suggestedAmount: customerAmount, retailAdjustment: customerAmount, customerCredit: Math.max(0, -customerAmount)};
  // Provider cost is never waived or substituted by the retail policy.
  delete result.expectedProfit;
  if (money(providerCost)) result.expectedProfit = round(customerAmount - providerCost);
  return result;
}

module.exports = {POLICY_TIMEZONE, POLICY_VERSION, customerChangePolicy, applyCustomerChangePolicy};
