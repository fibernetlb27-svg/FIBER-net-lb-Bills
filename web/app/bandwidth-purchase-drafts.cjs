'use strict';

const { createHash } = require('node:crypto');
const { monthRange } = require('./finance-ledger.cjs');

const BATCH_ACTION = 'purchase_batch_create';
const MAX_LINES = 100;

function fields(input, allowed, message) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw Error(message);
  }
}

function purchaseScope(core, input) {
  if (typeof input.purchaseDate !== 'string' || !input.purchaseDate) throw Error('Choose a valid purchase date.');
  const scope = core.range({ start: input.purchaseDate, end: input.purchaseDate, supplierId: input.supplierId });
  if (scope.supplierId === null) throw Error('Choose a valid supplier.');
  return { supplierId: scope.supplierId, purchaseDate: scope.start };
}

// The ledger stores exact cents and millionths. Convert directly to decimal
// text so copied values never pick up floating point artifacts or exponents.
function decimalString(value, places) {
  const scaled = String(value).padStart(places + 1, '0');
  const fraction = scaled.slice(-places).replace(/0+$/, '');
  return scaled.slice(0, -places) + (fraction ? '.' + fraction : '');
}

function purchaseDraft(core, input) {
  core.guard();
  fields(input, ['supplierId', 'purchaseDate'], 'Choose a supplier and purchase date.');
  const scope = purchaseScope(core, input);
  const supplier = core.supplier(scope.supplierId);
  if (!supplier.active) throw Error('Choose an active supplier.');

  const [year, month] = scope.purchaseDate.split('-').map(Number);
  const sourceMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  if (sourceMonth < '2000-01') return { ...scope, sourceMonth, lines: [] };

  const { start, end } = monthRange(sourceMonth);
  const previousPurchases = core.purchases({ start, end, supplierId: scope.supplierId });
  const currentTypes = new Map(core.types().map(type => [type.id, type]));
  const lines = previousPurchases.reverse().map(purchase => {
    const type = currentTypes.get(purchase.typeId);
    if (!type || type.unit !== purchase.unit) throw Error('A previous bandwidth type no longer matches its original unit.');
    return {
      typeId: purchase.typeId,
      typeName: purchase.typeName,
      unit: purchase.unit,
      quantity: decimalString(purchase.quantityMicros, 6),
      unitPrice: decimalString(purchase.unitPriceCents, 2),
      note: purchase.note,
      active: type.active
    };
  });
  return { ...scope, sourceMonth, lines };
}

// All lines and their cost links are created by the existing single-purchase
// path inside the caller's single database transaction. The audit key binds
// the whole ordered draft, while each line keeps its own receipt and audit.
function createPurchases(core, input, createPurchaseWithCost) {
  core.guard();
  fields(input, ['requestId', 'supplierId', 'purchaseDate', 'lines'], 'Choose valid bandwidth purchase details.');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(input.requestId)) {
    throw Error('Use a valid, unique bandwidth request ID.');
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_LINES) {
    throw Error(`Enter between 1 and ${MAX_LINES} purchase lines.`);
  }

  const scope = purchaseScope(core, input);
  const lines = Array.from(input.lines, (line, index) => {
    fields(line, ['typeId', 'quantity', 'unitPrice', 'note'], `Enter valid details for purchase line ${index + 1}.`);
    const hash = createHash('sha256').update(JSON.stringify([input.requestId, index])).digest('hex');
    const requestId = `bandwidth-line-${hash}`;
    return core.purchaseInput({ ...line, ...scope, requestId });
  });
  const batch = { requestId: input.requestId, ...scope, lines };
  const prior = core.prior(BATCH_ACTION, batch);
  if (prior) return { purchases: prior.purchaseIds.map(id => core.purchase(id)), idempotent: true };

  for (const line of lines) {
    if (core.prior('purchase_create', line)) throw Error('A purchase line request already exists. Review the original purchase.');
  }
  const purchases = lines.map(line => createPurchaseWithCost({
    ...scope,
    requestId: line.requestId,
    typeId: line.typeId,
    quantity: decimalString(line.quantityMicros, 6),
    unitPrice: decimalString(line.unitPriceCents, 2),
    note: line.note
  }));
  core.audit(BATCH_ACTION, batch, purchases[0].id, null, { purchaseIds: purchases.map(purchase => purchase.id) });
  return { purchases, idempotent: false };
}

function periodRemaining(purchases) {
  const cents = purchases.reduce((total, purchase) => total + BigInt(purchase.remainingCents), 0n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('The bandwidth total is outside the supported range.');
  return Number(cents) / 100;
}

module.exports = { purchaseDraft, createPurchases, periodRemaining };
