'use strict';
// A read-only view of money still held by each business. A month close carries
// custody forward; it does not create another receivable or another balance.
// Deposits use the existing reviewed, atomic Bank transfer and its journal.
const Finance = require('./finance-ledger.cjs');
const MonthClosing = require('./month-closing.cjs');
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
function fail() { throw Error('The remaining business money could not be verified. Refresh before depositing to Bank.'); }
function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail();
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount) || Math.abs(value * 100 - amount) > 1e-6) return fail();
  return amount;
}
function sum(values) {
  const amount = values.reduce((total, value) => total + BigInt(value), 0n);
  if (amount > LIMIT || amount < -LIMIT) return fail();
  return Number(amount);
}
function overview(bank, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).some(key => key !== 'workspaceId')) throw Error('Choose a valid business collection scope.');
  bank.ctx();
  const selected = input.workspaceId ?? 'all';
  if (selected !== 'all') bank.section(selected);
  bank.assertIdle();
  const businesses = [];
  let asOf = null;
  for (const section of bank.sections.filter(row => selected === 'all' || row.id === selected)) {
    bank.ready(section.id);
    const source = bank.sources({workspaceId:section.id}), custody = source.businessBalances;
    if (!custody || custody.basis !== 'business_custody' || custody.scope !== 'all_holders' || custody.workspaceId !== section.id || !Array.isArray(custody.wallets) || !/^20\d{2}-\d{2}-\d{2}$/.test(custody.asOf)) return fail();
    if (asOf !== null && asOf !== custody.asOf) throw Error('The business balance date changed. Refresh the collection cards.');
    asOf = custody.asOf;
    const cash = cents(custody.cash), whish = cents(custody.whish);
    if (sum(custody.wallets.map(row => cents(row.balance))) !== whish) return fail();
    // All-holder custody is displayed even when some money is still held by
    // Support. It never widens the Admin/Cashier sources accepted by Bank.
    const permittedCash = sum(source.holders.map(row => Math.max(0, cents(row.cashBalance))));
    const permittedWhish = sum(source.holders.flatMap(row => row.wallets.filter(wallet => wallet.active).map(wallet => Math.max(0, cents(wallet.balance)))));
    const latest = Finance.months(bank.entries.get(section.id).db)[0] ?? null;
    if (latest) MonthClosing.verifyArchive({db:bank.entries.get(section.id).db, workspaceId:section.id, month:latest.month});
    businesses.push({
      workspaceId:section.id, workspaceName:source.workspaceName,
      cash:cash / 100, whish:whish / 100, total:sum([cash, whish]) / 100,
      bankBalance:cents(source.bankBalance) / 100,
      lastClosedMonth:latest?.month ?? null, closedAt:latest?.closedAt ?? null,
      availableToDeposit:{cash:permittedCash / 100, whish:permittedWhish / 100, total:sum([permittedCash, permittedWhish]) / 100}
    });
  }
  return {
    basis:'business_collection_custody', scope:selected, asOf, businesses,
    totals:Object.fromEntries(['cash', 'whish', 'total', 'bankBalance'].map(key => [key, sum(businesses.map(row => cents(row[key]))) / 100])),
    currentHoldings:true, includesCarriedMoney:true, separateReceivable:false
  };
}
module.exports = {overview};
