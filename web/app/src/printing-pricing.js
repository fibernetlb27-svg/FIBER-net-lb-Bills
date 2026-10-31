(function (root, factory) {
  const pricing = factory();
  if (typeof module === "object" && module.exports) module.exports = pricing;
  else root.PrintingPricing = pricing;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const DEFAULT_CUSTOM = [{ key: "id-photo", name: "ID Photo", price: 0 }];
  function normalizeCustom(value) {
    const source = value === undefined ? DEFAULT_CUSTOM : value;
    if (!Array.isArray(source) || source.length > 50) throw Error("Use up to 50 custom printing types.");
    const keys = new Set(), names = new Set();
    return source.map(item => {
      const key = String(item?.key || ""), name = String(item?.name || "").trim();
      const price = Number(item?.price);
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key) || keys.has(key)) throw Error("Custom printing type IDs must be unique.");
      if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) || names.has(name.toLowerCase())) throw Error("Enter a unique printing type name (up to 80 characters).");
      if (!Number.isFinite(price) || price < 0 || price > 1e12 || !Number.isInteger(price)) throw Error("Custom printing prices must be whole LBP amounts from 0 to 1,000,000,000,000.");
      keys.add(key); names.add(name.toLowerCase());
      return { key, name, price };
    });
  }
  function customSelection(table, size) {
    if (!String(size).startsWith("custom:")) return null;
    const key = String(size).slice(7);
    const item = normalizeCustom(table?.custom).find(item => item.key === key);
    if (!item) throw Error("This printing type was removed. Refresh products and choose again.");
    return { options: { size: `custom:${key}`, service: "custom", costKnown: false }, unitPrice: item.price, currency: "LBP", description: item.name, costKnown: false };
  }
  function unknownCostSummary(items) {
    let count = 0, revenue = 0;
    for (const item of items) {
      let options;
      try { options = JSON.parse(item.printingOptions || "{}"); } catch { continue; }
      if (options?.costKnown !== false) continue;
      count += Number(item.quantity) || 0;
      revenue += Number(item.lineTotal) || 0;
    }
    return { unknownPrintingUnits: count, unknownPrintingRevenue: Math.round((revenue + Number.EPSILON) * 100) / 100 };
  }
  return { DEFAULT_CUSTOM, normalizeCustom, customSelection, unknownCostSummary };
});
