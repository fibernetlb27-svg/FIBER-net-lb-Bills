'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {customerChangePolicy, applyCustomerChangePolicy} = require('../app/change-service-customer-pricing.cjs');

test('customer change charge is zero on Beirut dates 1–5, with exact local midnight boundaries', () => {
  const normal = {available:true, customerAmount:7.5, retailAdjustment:7.5, expectedProfit:4.5};
  for (const instant of ['2026-10-31T22:00:00Z','2026-11-03T10:00:00Z','2026-11-05T21:59:59.999Z']) {
    const priced = applyCustomerChangePolicy(normal, instant, 3);
    assert.equal(priced.zeroChargeWindow, true);
    assert.equal(priced.customerAmount, 0);
    assert.equal(priced.suggestedAmount, 0);
    assert.equal(priced.expectedProfit, -3);
    assert.equal(priced.policyTimezone, 'Asia/Beirut');
  }
  const before = applyCustomerChangePolicy(normal, '2026-10-31T21:59:59.999Z');
  assert.equal(before.policyDate, '2026-10-31');
  assert.equal(before.zeroChargeWindow, false);
  assert.equal(before.customerAmount, 7.5);
  const sixth = applyCustomerChangePolicy(normal, '2026-11-05T22:00:00Z');
  assert.equal(sixth.policyDate, '2026-11-06');
  assert.equal(sixth.zeroChargeWindow, false);
  assert.equal(sixth.customerAmount, 7.5);
  assert.equal(sixth.expectedProfit, 4.5);
  assert.deepEqual(normal, {available:true, customerAmount:7.5, retailAdjustment:7.5, expectedProfit:4.5});
});

test('Beirut summer offset and unavailable normal pricing follow the same bounded customer-only policy', () => {
  const missing = {available:false, reason:'Incomplete period breakdown'};
  assert.equal(customerChangePolicy('2026-07-05T20:59:59Z').policyDay, 5);
  assert.equal(customerChangePolicy('2026-07-05T21:00:00Z').policyDay, 6);
  const free = applyCustomerChangePolicy(missing, '2026-07-02T12:00:00Z', -2);
  assert.equal(free.available, true);
  assert.equal(free.customerAmount, 0);
  assert.equal(free.expectedProfit, 2);
  const later = applyCustomerChangePolicy(missing, '2026-07-06T12:00:00Z');
  assert.equal(later.available, false);
  assert.equal(later.suggestedAmount, null);
  assert.equal(later.reason, missing.reason);
  const credit = applyCustomerChangePolicy({available:true,customerAmount:-4}, '2026-11-08T12:00:00Z');
  assert.equal(credit.suggestedAmount, -4);
  assert.throws(() => customerChangePolicy('invalid'), /date could not be verified/);
  assert.throws(() => applyCustomerChangePolicy(null), /pricing could not be verified/);
});
