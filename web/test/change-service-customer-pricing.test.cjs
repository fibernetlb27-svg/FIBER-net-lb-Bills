'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {POLICY_VERSION, customerChangePolicy, applyCustomerChangePolicy} = require('../app/change-service-customer-pricing.cjs');
const {planChangePricing} = require('../app/plan-change-pricing.cjs');

const bundles = [
  {code:'NET-6GB',name:'Internet 6GB',allowance:'6GB',serviceType:'Internet',price:20},
  {code:'NET-8GB',name:'Internet 8GB',allowance:'8GB',serviceType:'Internet',price:25},
  {code:'NET-10GB',name:'Internet 10GB',allowance:'10GB',serviceType:'Internet',price:30}
];
const fixedPlans = [{name:'6GB Internet',cost:13},{name:'8GB Internet',cost:16},{name:'10GB Internet',cost:20}];
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const at = '2026-11-05T10:00:00Z';

function fixture({before=0,target=1,fraction=1,pending=0,expiry='2026-12-05'}={}) {
  const difference=fixedPlans[target].cost-fixedPlans[before].cost;
  const currentPeriodPrice=round(difference*fraction),pendingRefillsPrice=round(difference*pending);
  const quote={username:'fictional.coverage',beforeName:bundles[before].name,targetName:bundles[target].name,expiry,
    currentPeriodPrice,pendingRefills:pending,pendingRefillsPrice,price:round(currentPeriodPrice+pendingRefillsPrice),
    total:round(currentPeriodPrice+pendingRefillsPrice),freetimePrice:0,hasPeriodBreakdown:true};
  const normal=planChangePricing(quote,bundles,fixedPlans);
  return {quote,normal,apply:(now=at)=>applyCustomerChangePolicy(normal,now,quote.total,quote)};
}

function assertManual(normal,quote,cost=quote?.total,now=at) {
  const result=applyCustomerChangePolicy(normal,now,cost,quote);
  assert.equal(result.policyVersion,2);assert.equal(result.calendarWindow,true);
  assert.equal(result.available,false);assert.equal(result.zeroChargeWindow,false);
  assert.equal(result.coverageReason,'manual_review');assert.equal(result.suggestedAmount,null);
  assert.equal(result.customerAmount,null);assert.equal(result.customerCredit,null);
  assert.equal(result.expectedProfit,undefined);return result;
}

test('v2 retains signed paid-next-cycle adjustments on Beirut day5, including full current periods without pending refills', () => {
  assert.equal(POLICY_VERSION,2);
  for(const [options,amount,cost] of [[{target:1},5,3],[{target:2},10,7],[{before:2,target:0},-10,-7]]) {
    const f=fixture(options),before=structuredClone({quote:f.quote,normal:f.normal});
    const result=f.apply();
    assert.equal(result.policyVersion,2);assert.equal(result.calendarWindow,true);assert.equal(result.zeroChargeWindow,false);
    assert.equal(result.coverageReason,'paid_current_period');assert.equal(result.currentPeriodEnd,'2026-12-05');
    assert.equal(result.customerAmount,amount);assert.equal(result.suggestedAmount,amount);assert.equal(result.customerCredit,Math.max(0,-amount));
    assert.equal(result.expectedProfit,amount-cost);assert.equal(result.waivedFraction,0);assert.equal(result.chargedFraction,1);
    assert.equal(f.quote.total,cost);assert.deepEqual({quote:f.quote,normal:f.normal},before);
  }
});

test('only a verified closing current period is waived, retaining the actual provider debit or credit', () => {
  for(const options of [{expiry:'2026-11-05'},{expiry:'2026-11-05',fraction:0.25},{expiry:'2026-10-05',fraction:0},{before:2,target:0,expiry:'2026-11-05',fraction:0.5}]) {
    const f=fixture(options),result=f.apply();
    assert.equal(result.available,true);assert.equal(result.zeroChargeWindow,true);assert.equal(result.coverageReason,'closing_period_waived');
    assert.equal(result.customerAmount,0);assert.equal(result.suggestedAmount,0);assert.equal(result.customerCredit,0);
    assert.equal(result.chargedFraction,0);assert.equal(result.waivedFraction,f.normal.currentFraction);
    assert.equal(result.expectedProfit,round(-f.quote.total));
  }
});

test('pending paid cycles are charged or credited while only the inferred closing period is waived', () => {
  for(const [options,expected] of [
    [{fraction:0.5,pending:1,expiry:'2026-12-05'},5],
    [{fraction:0.25,pending:2,expiry:'2027-01-05'},10],
    [{before:2,target:0,fraction:0.25,pending:2,expiry:'2027-01-05'},-20]
  ]) {
    const f=fixture(options),result=f.apply();
    assert.equal(result.available,true);assert.equal(result.zeroChargeWindow,false);assert.equal(result.coverageReason,'closing_period_with_paid_refills');
    assert.equal(result.currentPeriodEnd,'2026-11-05');assert.equal(result.customerAmount,expected);
    assert.equal(result.customerCredit,Math.max(0,-expected));assert.equal(result.waivedFraction,f.normal.currentFraction);
    assert.equal(result.chargedFraction,options.pending);assert.equal(result.expectedProfit,round(expected-f.quote.total));
  }
});

test('paid current coverage and additional paid cycles both retain their signed adjustment', () => {
  for(const options of [{fraction:0.5,pending:1,expiry:'2027-01-05'},{before:2,target:0,fraction:1,pending:1,expiry:'2027-01-05'}]) {
    const f=fixture(options),result=f.apply();
    assert.equal(result.coverageReason,'paid_current_period_and_refills');assert.equal(result.currentPeriodEnd,'2026-12-05');
    assert.equal(result.zeroChargeWindow,false);assert.equal(result.waivedFraction,0);assert.equal(result.chargedFraction,options.fraction+options.pending);
    assert.equal(result.customerAmount,f.normal.customerAmount);assert.equal(result.customerCredit,f.normal.customerCredit);
  }
  const f=fixture();f.normal.targetPrice=20;f.normal.priceDifference=0;f.normal.customerAmount=0;f.normal.retailAdjustment=0;
  const result=applyCustomerChangePolicy(f.normal,at,f.quote.total,f.quote);
  assert.equal(result.customerAmount,0);assert.equal(result.zeroChargeWindow,false,'A zero selling-price difference is not an entire-policy waiver.');
});

test('winter and summer Beirut calendar boundaries apply independently of the machine timezone', () => {
  for(const [instant,expiry,day,calendarWindow] of [
    ['2026-10-31T21:59:59.999Z','2026-11-05',31,false],
    ['2026-10-31T22:00:00Z','2026-11-05',1,true],
    ['2026-11-05T21:59:59.999Z','2026-11-05',5,true],
    ['2026-11-05T22:00:00Z','2026-11-05',6,false],
    ['2026-07-05T20:59:59.999Z','2026-07-05',5,true],
    ['2026-07-05T21:00:00Z','2026-07-05',6,false]
  ]) {
    const f=fixture({expiry}),result=f.apply(instant);
    assert.equal(result.policyDay,day);assert.equal(result.calendarWindow,calendarWindow);assert.equal(result.zeroChargeWindow,calendarWindow);
    assert.equal(result.policyTimezone,'Asia/Beirut');assert.equal(result.customerAmount,calendarWindow?0:5);
  }
  const raw=customerChangePolicy(at);assert.equal(raw.calendarWindow,true);assert.equal(raw.zeroChargeWindow,false,'Calendar eligibility alone does not prove a waiver.');
});

test('date-only, local provider timestamps and explicit winter or summer offsets resolve exact monthly coverage', () => {
  for(const [expiry,now] of [
    ['2026-11-05',at],['2026-11-05T12:00:00',at],['2026-11-05 12:00:00',at],['2026-11-05T12:00:00.123+02:00',at],
    ['2026-11-04T22:30:00Z',at],['2026-07-04T21:30:00Z','2026-07-02T10:00:00Z'],
    ['2026-07-05T00:30:00+03:00','2026-07-02T10:00:00Z']
  ]) {
    const f=fixture({expiry}),result=f.apply(now);assert.equal(result.available,true);assert.equal(result.zeroChargeWindow,true);
  }
  const f=fixture({expiry:'2026-11-05T00:30:00+03:00'});
  assertManual(f.normal,f.quote,f.quote.total);
});

test('invalid, off-cycle, rolled-over or unsupported expiry dates require review', () => {
  const f=fixture();
  for(const expiry of [undefined,null,'','2026-12-06','2026-12-01','2026-13-05','2026-11-31','2026-02-29','0000-11-05',
    '2026-11-05garbage','2026-11-05T24:00:00','2026-11-05T12:60:00','2026-11-05T12:00:60Z','2026-11-05T12:00:00+14:01',
    '2026-11-05T12:00:00+02:99','2026-11-05T12:00:00Ztrailing','2026-11-05T12:00:00.1234Z']) {
    assertManual(f.normal,{...f.quote,expiry});
  }
});

test('missing quote context or unavailable normal pricing never creates an automatic free amount', () => {
  const f=fixture();assertManual(f.normal,undefined,3);
  assertManual({available:false,reason:'Missing fixed costs'},f.quote,3);
  assertManual({available:false,reason:'Freetime adjustment'}, {...f.quote,freetimePrice:1,total:4},4);
  assertManual(f.normal,{...f.quote,freetimePrice:1,total:4},4);
  assertManual(f.normal,{...f.quote,hasPeriodBreakdown:false},3);
  assertManual(f.normal,f.quote,99);
  assertManual(f.normal,f.quote,NaN);
  const noCost=applyCustomerChangePolicy(f.normal,at,undefined,f.quote);
  assert.equal(noCost.customerAmount,5);assert.equal(noCost.expectedProfit,undefined);
});

test('inconsistent normal and provider period proofs are rejected before selecting a customer amount', () => {
  const f=fixture();
  for(const patch of [{currentPeriodPrice:4},{pendingRefillsPrice:1},{price:4},{total:4},{pendingRefills:1}])assertManual(f.normal,{...f.quote,...patch},patch.total??f.quote.total);
  for(const patch of [{currentFraction:-0.01},{currentFraction:1.01},{currentFraction:NaN},{costDifference:0},{priceDifference:6},{priceDifference:5.01},{customerAmount:6},{customerAmount:5.01},{retailAdjustment:6},{retailAdjustment:5.01},{beforeMonthlyCost:null},{targetPrice:Infinity}])assertManual({...f.normal,...patch},f.quote,3);
});

test('pending period counts are bounded to safe integers through 1000, with correct year rollover', () => {
  const f=fixture();
  for(const pending of [-1,0.5,1001,NaN,Infinity,'1'])assertManual({...f.normal,pendingRefills:pending},{...f.quote,pendingRefills:pending});
  const maximum=fixture({pending:1000,fraction:0.25,expiry:'2110-03-05'}),result=maximum.apply();
  assert.equal(result.available,true);assert.equal(result.currentPeriodEnd,'2026-11-05');assert.equal(result.chargedFraction,1000);assert.equal(result.customerAmount,5000);
  const january=fixture({pending:1,expiry:'2027-01-05'}).apply();assert.equal(january.currentPeriodEnd,'2026-12-05');
});

test('day6 and later retain existing signed pricing and unavailable manual review without requiring new context', () => {
  for(const amount of [7.5,-4,0]) {
    const normal={available:true,customerAmount:amount,retailAdjustment:amount,customerCredit:Math.max(0,-amount),expectedProfit:amount-3};
    const result=applyCustomerChangePolicy(normal,'2026-11-08T12:00:00Z',3);
    assert.equal(result.customerAmount,amount);assert.equal(result.suggestedAmount,amount);assert.equal(result.expectedProfit,normal.expectedProfit);
    assert.equal(result.zeroChargeWindow,false);assert.equal(result.calendarWindow,false);assert.equal(result.coverageReason,'outside_calendar_window');
    assert.deepEqual(normal,{available:true,customerAmount:amount,retailAdjustment:amount,customerCredit:Math.max(0,-amount),expectedProfit:amount-3});
  }
  const missing={available:false,reason:'Incomplete period breakdown'};
  const later=applyCustomerChangePolicy(missing,'2026-11-06T12:00:00Z');assert.equal(later.available,false);assert.equal(later.suggestedAmount,null);assert.equal(later.reason,missing.reason);
  assert.throws(()=>customerChangePolicy('invalid'),/date could not be verified/);
  assert.throws(()=>applyCustomerChangePolicy(null),/pricing could not be verified/);
});
