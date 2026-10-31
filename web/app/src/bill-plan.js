(function (root) {
  "use strict";
  const canonical = value => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, "");
  function matchInternetBundle(service, bundles) {
    const fullName = canonical(service);
    if (!fullName || /\d[\s_-]+\d/.test(String(service))) return null;
    const planNames = new Set([fullName, fullName.replace(/^fiber\.?net\.?lb/, "")]);
    const candidates = bundles.filter(bundle => {
      if (bundle.serviceType !== "Internet" || bundle.active === false) return false;
      const allowance = canonical(bundle.allowance);
      const names = [bundle.code, bundle.name, allowance,
        allowance ? `Internet ${allowance}` : "", allowance ? `${allowance} Internet` : ""];
      return names.some(name => canonical(name) && planNames.has(canonical(name)));
    });
    // Exact known names/codes/allowances only. Never infer a price from a
    // substring, numeric service ID, bandwidth, or ambiguous/custom plan.
    return candidates.length === 1 ? candidates[0] : null;
  }
  function matchPortalPlan(bundle, plans) {
    if (!bundle || !Array.isArray(plans)) return null;
    const candidates = plans.filter(plan => matchInternetBundle(plan.name, [bundle]));
    return candidates.length === 1 ? candidates[0] : null;
  }
  const helpers = { matchInternetBundle, matchPortalPlan };
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.FiberBillPlan = helpers;
})(globalThis);
