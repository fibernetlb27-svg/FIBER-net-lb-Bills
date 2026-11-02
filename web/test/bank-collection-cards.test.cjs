'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Finance = require('../app/finance-ledger.cjs'), Whish = require('../app/whish-destinations.cjs');
const Bank = require('../app/bank-accounts.cjs'), Cards = require('../app/bank-collection-cards.cjs');
const sql = require('sql.js')(), q = Finance.query;
async function fixture(t) {
  const SQL = await sql, ids = ['main', 'fiber-users', 'fiber-resellers'];
  const entries = new Map(ids.map(id => [id, {id, db:new SQL.Database()}]));
  t.after(() => { for (const entry of entries.values()) entry.db.close(); });
  for (const entry of entries.values()) {
    entry.db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT,full_name TEXT,role TEXT,active INTEGER);
      INSERT INTO users VALUES(1,'admin:1','Fictional Admin','admin',1),(2,'cashier:2','Fictional Cashier','cashier',1),(3,'support:3','Fictional Support','support',1);
      CREATE TABLE finance_months(month TEXT PRIMARY KEY,closed_at TEXT,actor_name TEXT,actor_key TEXT,archive_json TEXT);
      CREATE TABLE finance_wallet_entries(id TEXT PRIMARY KEY,event_id TEXT,wallet_id TEXT,account_key TEXT,amount_cents INTEGER,effective_at TEXT);
      CREATE TABLE cash_drawer_transactions(id INTEGER PRIMARY KEY,amount REAL,transaction_type TEXT,reference_type TEXT,reference_id INTEGER,note TEXT,created_at TEXT,user_id INTEGER,user_name TEXT);
      CREATE VIEW active_cash_drawer_transactions AS SELECT * FROM cash_drawer_transactions;
      CREATE TABLE payment_destinations(kind TEXT,record_key TEXT,snapshot_json TEXT);
      CREATE TABLE debt_payments(id INTEGER,kind TEXT,record_id INTEGER,payment_method TEXT,user_id INTEGER,received_at TEXT);
      CREATE TABLE sales(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,payment_method TEXT);
      CREATE VIEW active_sales AS SELECT * FROM sales;
      CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
      CREATE VIEW active_fibernetlb_bills AS SELECT * FROM fibernetlb_bills;
      CREATE TABLE telecom_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);
      CREATE VIEW active_telecom_payments AS SELECT * FROM telecom_payments;
      CREATE TABLE installation_payments(id INTEGER PRIMARY KEY,user_id INTEGER,paid_at TEXT,payment_method TEXT);`);
    Whish.initializeWhish(entry.db); Bank.initialize(entry.db);
    for (const [id, key, cash, wallet] of [[1, 'admin:1', 300, 100], [2, 'cashier:2', 200, 50], [3, 'support:3', 75, 25]]) {
      entry.db.run('INSERT INTO cash_drawer_transactions(amount,transaction_type,created_at,user_id,user_name) VALUES(?,?,?,?,?)', [cash, 'fictional-opening', '2026-10-30T12:00:00', id, key]);
      entry.db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)', ['opening-' + key, 'fictional', 'wallet-a', key, wallet * 100, '2026-10-30T12:00:00']);
    }
  }
  const db = id => entries.get(id).db;
  Whish.saveDestination(db('main'), {label:'Fictional wallet', number:'03000001', active:true});
  db('main').run("UPDATE whish_destinations SET id='wallet-a'");
  let key = 'admin:1', blocked = false, at = '2026-11-01T12:00:00', failSave = false;
  const actor = () => q(db('main'), 'SELECT * FROM users WHERE account_key=?', [key])[0];
  const bank = new Bank.BankAccounts({entries, authorize:() => actor(), holders:id => q(db(id), 'SELECT * FROM users'), now:() => at,
    assertReady() { if (blocked) throw Error('Fictional pending money operation'); },
    saveEntry:async() => { if (failSave) throw Error('Fictional interrupted save'); }});
  const base = extra => ({workspaceId:'fiber-users', holderAccountKey:'cashier:2', method:'cash', walletId:'', direction:'deposit', amount:80, note:'Fictional month savings', ...extra});
  const transfer = (id, extra = {}) => { const input = base(extra); return bank.transfer({...input, requestId:id, token:bank.preview(input).token, confirmation:'TRANSFER BANK'}); };
  return {bank, db, entries, transfer, set key(value) { key = value; }, set blocked(value) { blocked = value; }, set at(value) { at = value; }, set failSave(value) { failSave = value; }};
}
test('collection cards display each business once and preserve signed all-holder custody without writing', async t => {
  const f = await fixture(t), before = new Map([...f.entries].map(([id, row]) => [id, Buffer.from(row.db.export())]));
  const shown = Cards.overview(f.bank);
  assert.equal(shown.basis, 'business_collection_custody'); assert.equal(shown.scope, 'all'); assert.equal(shown.asOf, '2026-11-01');
  assert.equal(shown.businesses.length, 3); assert.equal(shown.totals.total, 2250); assert.equal(shown.separateReceivable, false);
  const users = shown.businesses.find(row => row.workspaceId === 'fiber-users'), resellers = shown.businesses.find(row => row.workspaceId === 'fiber-resellers');
  assert.deepEqual([users.cash, users.whish, users.total], [575, 175, 750]);
  assert.deepEqual(users.availableToDeposit, {cash:500, whish:150, total:650});
  assert.deepEqual(resellers.availableToDeposit, {cash:300, whish:100, total:400});
  for (const [id, entry] of f.entries) assert.ok(Buffer.from(entry.db.export()).equals(before.get(id)), 'Read-only cards changed a database');
});
test('partial cash and Whish deposits reduce the card remainder and increase only that business Bank', async t => {
  const f = await fixture(t);
  await f.transfer('card-cash-partial');
  let row = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.deepEqual([row.cash, row.whish, row.total, row.bankBalance], [495, 175, 670, 80]);
  await f.transfer('card-whish-partial', {method:'whish', walletId:'wallet-a', amount:20});
  row = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.deepEqual([row.cash, row.whish, row.total, row.bankBalance], [495, 155, 650, 100]);
  assert.equal(Cards.overview(f.bank, {workspaceId:'fiber-resellers'}).businesses[0].total, 750);
  assert.equal(q(f.db('fiber-users'), 'SELECT * FROM sales').length, 0);
  const history = f.bank.overview({workspaceId:'fiber-users'}).history;
  assert.ok(history.every(row => row.noProfitChange && row.noRevenue && row.noExpense && row.noWhishFee));
});
test('carried money is current custody rather than repeated monthly debt and a Bank return restores the remainder', async t => {
  const f = await fixture(t), db = f.db('fiber-users');
  const archive = {all:{closing:{cash:575, wallets:[{id:'wallet-a', balance:175}]}}, employees:{}};
  db.run('INSERT INTO finance_months VALUES(?,?,?,?,?)', ['2026-10', '2026-11-01T00:00:01', 'Fictional Admin', 'admin:1', JSON.stringify(archive)]);
  await f.transfer('carried-deposit-test', {amount:100});
  assert.equal(Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0].total, 650);
  f.at = '2026-12-01T12:00:00';
  db.run('INSERT INTO finance_months VALUES(?,?,?,?,?)', ['2026-11', '2026-12-01T00:00:01', 'Fictional Admin', 'admin:1', JSON.stringify(archive)]);
  let row = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.equal(row.total, 650); assert.equal(row.lastClosedMonth, '2026-11');
  await f.transfer('carried-return-test', {direction:'withdraw', amount:40});
  row = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.equal(row.total, 690); assert.equal(row.bankBalance, 60);
});
test('negative historical balances stay visible and inactive wallets cannot inflate available deposits', async t => {
  const f = await fixture(t), db = f.db('fiber-users');
  db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,created_at,user_id,user_name) VALUES(-350,'fictional-correction','2026-11-01T10:00:00',1,'Fictional Admin')");
  f.db('main').run("UPDATE whish_destinations SET active=0 WHERE id='wallet-a'");
  const row = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.equal(row.cash, 225); assert.equal(row.whish, 175); assert.equal(row.total, 400);
  assert.deepEqual(row.availableToDeposit, {cash:200, whish:0, total:200});
  assert.throws(() => f.bank.preview({workspaceId:'fiber-users', holderAccountKey:'support:3', method:'cash', direction:'deposit', amount:10}), /active Cashier/);
});
test('11:59 PM closing leaves the carried card visible and Bank waits for the open month', async t => {
  const f = await fixture(t), db = f.db('fiber-users');
  const archive = {all:{closing:{cash:575, wallets:[{id:'wallet-a', balance:175}]}}, employees:{}};
  f.at = '2026-11-30T23:59:30';
  db.run('INSERT INTO finance_months VALUES(?,?,?,?,?)', ['2026-11', '2026-11-30T23:59:01', 'Fictional Admin', 'admin:1', JSON.stringify(archive)]);
  const before = Buffer.from(db.export()), card = Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0];
  assert.equal(card.total, 750); assert.equal(card.lastClosedMonth, '2026-11');
  assert.ok(Buffer.from(db.export()).equals(before));
  assert.throws(() => f.transfer('closed-minute-bank'), /accounting month is closed/);
  f.at = '2026-12-01T00:00:01'; await f.transfer('next-month-bank');
  assert.equal(Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0].total, 670);
});
test('collection scope and current Admin permission are enforced and pending money cannot appear verified', async t => {
  const f = await fixture(t);
  assert.throws(() => Cards.overview(f.bank, {workspaceId:'fictional-unknown'}), /valid Bank business/);
  assert.throws(() => Cards.overview(f.bank, {amount:100}), /valid business collection scope/);
  f.key = 'cashier:2'; assert.throws(() => Cards.overview(f.bank), /active Main administrator/);
  f.key = 'admin:1'; f.blocked = true; assert.throws(() => Cards.overview(f.bank), /pending money operation/);
  f.blocked = false; f.failSave = true;
  await assert.rejects(f.transfer('card-unconfirmed-save'), /save could not be confirmed/);
  assert.throws(() => Cards.overview(f.bank), /pending Bank transfer/);
  f.failSave = false; await f.bank.resume({workspaceId:'fiber-users', requestId:'card-unconfirmed-save'});
  assert.equal(Cards.overview(f.bank, {workspaceId:'fiber-users'}).businesses[0].bankBalance, 80);
  f.db('fiber-users').exec("CREATE TABLE company_debt_partial_payment_intents(request_id TEXT,state TEXT,created_at TEXT);INSERT INTO company_debt_partial_payment_intents VALUES('fictional-partial-debt','saving','2026-11-01T12:00:00')");
  assert.throws(() => Cards.overview(f.bank, {workspaceId:'fiber-users'}), /pending financial operations/);
});
test('corrupt carried-close proofs and Bank source movements fail without replacing them', async t => {
  const f = await fixture(t), db = f.db('fiber-users');
  const archive = {mode:'carry_forward', all:{closing:{mode:'carry_forward', cash:575, wallets:[]}}, employees:{}};
  db.run('INSERT INTO finance_months VALUES(?,?,?,?,?)', ['2026-10', '2026-11-01T00:00:01', 'Fictional Admin', 'admin:1', JSON.stringify(archive)]);
  assert.throws(() => Cards.overview(f.bank, {workspaceId:'fiber-users'}), /could not be verified/);
  db.run('DELETE FROM finance_months'); await f.transfer('card-corrupted-bank');
  db.run("UPDATE cash_drawer_transactions SET amount=-79 WHERE transaction_type='bank_deposit'");
  assert.throws(() => Cards.overview(f.bank, {workspaceId:'fiber-users'}), /could not be verified/);
});
