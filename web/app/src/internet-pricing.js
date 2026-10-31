(function (root) {
  "use strict";
  const DAY = 86400000, POLICY = "internet-5th-v1";
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  function beirutDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    return ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
  }
  function civilDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("A valid billing date is required.");
    const [year, month, day] = value.split("-").map(Number), date = new Date(Date.UTC(year, month - 1, day));
    if (year < 2000 || year > 9998 || date.toISOString().slice(0, 10) !== value) throw Error("A valid billing date is required.");
    return date;
  }
  function internetBillPricing(monthlyPrice, months = 1, now = new Date(), expiry = '') {
    if (typeof monthlyPrice !== "number" || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || monthlyPrice > 1000000 || !Number.isSafeInteger(months) || months < 1 || months > 12) throw Error("A positive monthly selling price and 1–12 renewal months are required.");
    const asOf = typeof now === "string" ? now : beirutDate(now), today = civilDate(asOf);
    const year = today.getUTCFullYear(), month = today.getUTCMonth(), day = today.getUTCDate();
    // Count civil calendar days: a DST transition must never add/subtract a day.
    // On the 5th a new full cycle starts; its end date is exclusive.
    const start = Date.UTC(year, month - (day < 5 ? 1 : 0), 5), end = Date.UTC(year, month + (day < 5 ? 0 : 1), 5);
    const expiryDate=typeof expiry==='string'?expiry.slice(0,10):'',advance=Boolean(expiryDate&&civilDate(expiryDate).getTime()>=end);
    // A customer who already covers this cycle purchases an additional full
    // cycle. Today's elapsed days must not discount that future month.
    const billedStart=advance?civilDate(expiryDate).getTime():start;
    const billedEnd=advance?Date.UTC(new Date(billedStart).getUTCFullYear(),new Date(billedStart).getUTCMonth()+1,5):end;
    const cycleDays = (billedEnd - billedStart) / DAY, remainingDays = advance?cycleDays:(end - today.getTime()) / DAY;
    if(cycleDays<=0)throw Error('The portal expiry does not define a valid next billing cycle. Verify the customer again.');
    const firstCycleAmount = round(monthlyPrice * remainingDays / cycleDays);
    return { policy: POLICY, asOf, cycleStart: new Date(billedStart).toISOString().slice(0, 10), cycleEnd: new Date(billedEnd).toISOString().slice(0, 10), cycleDays, remainingDays, months, monthlyPrice: round(monthlyPrice), firstCycleAmount, additionalFullMonths: months - 1, suggestedAmount: round(monthlyPrice * remainingDays / cycleDays + monthlyPrice * (months - 1)),...advance?{advance:true,expectedExpiry:expiry}:{} };
  }
  function retailSelection(value) {
    if (value === undefined) return undefined; // Historical payments retain their fingerprint.
    if (!value || value.policy !== POLICY || typeof value.automatic !== "boolean") throw Error("Refresh the Internet selling-price calculation before saving.");
    civilDate(value.asOf);
    if(value.advance!==undefined&&(typeof value.advance!=='boolean'||typeof value.expectedExpiry!=='string'||value.expectedExpiry.length>100))throw Error('Refresh the renewal period before saving.');
    return { policy: POLICY, asOf: value.asOf, automatic: value.automatic,...value.advance!==undefined?{advance:value.advance,expectedExpiry:value.expectedExpiry}:{} };
  }
  function verifyRetailSelection(selection, quote, amount) {
    if (!selection) return;
    if (selection.asOf !== quote.asOf || selection.policy !== quote.policy || (selection.advance!==undefined&&(selection.advance!==Boolean(quote.advance)||selection.expectedExpiry!==quote.expectedExpiry)) || (selection.automatic && round(Number(amount)) !== quote.suggestedAmount)) throw Error("The Internet billing day, renewal period or selling price changed. Refresh the calculation and confirm the customer amount again. Nothing was submitted.");
  }
  function retailDescription(quote, amount) {
    if (!quote) return "";
    return `Customer pricing: ${quote.asOf} · ${quote.advance?'Additional full-month renewal · ':''}${quote.remainingDays}/${quote.cycleDays} days until ${quote.cycleEnd} · monthly $${quote.monthlyPrice.toFixed(2)}${quote.additionalFullMonths ? ` + ${quote.additionalFullMonths} full cycle(s)` : ""} · suggested $${quote.suggestedAmount.toFixed(2)}${round(Number(amount)) !== quote.suggestedAmount ? ` · entered $${Number(amount).toFixed(2)}` : ""}`;
  }
  function lateRenewalPolicy(now = new Date(), customerExpiry = '') {
    const asOf = typeof now === "string" ? now : beirutDate(now), date = civilDate(asOf);
    const day = date.getUTCDate();
    const expiry = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (day < 5 ? 0 : 1), 5)).toISOString().slice(0, 10);
    const prepaid=Boolean(customerExpiry&&civilDate(customerExpiry.slice(0,10)).getTime()>=civilDate(expiry).getTime());
    return { policy: "internet-free-11th-v1", asOf, free:(day>=11||day<=4)&&!prepaid, expiry, cutoffTime: "12:00 · Asia/Beirut" };
  }
  const helpers = { beirutDate, internetBillPricing, retailSelection, verifyRetailSelection, retailDescription, lateRenewalPolicy };
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.FiberInternetPricing = helpers;
})(globalThis);
