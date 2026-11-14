'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../app/core.cjs');
const { createSecretStorage } = require('../lib/secrets.cjs');

test('filtered bandwidth cards and repeat purchases use the original ledger with atomic idempotent saves', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-bandwidth-fictional-'));
  const secrets = createSecretStorage(crypto.randomBytes(32));
  const owner = { username: 'bandwidth.owner', fullName: 'Fictional Owner', password: 'Fictional-draft-2026-only' };
  let core, token;
  t.after(async () => {
    await core?.close();
    secrets.destroy();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^fibernetlb-bandwidth-fictional-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const request = (name, args = [], session = token, workspaceId = 'main') => core.request({ channel: 'bandwidth:' + name, args, token: session, workspaceId });
  const good = async (name, input) => {
    const result = await request(name, input ? [input] : []);
    assert.equal(result.status, 200, result.error);
    return result.data;
  };
  const login = async () => {
    const result = await core.request({ channel: 'auth:login', args: [{ username: owner.username, password: owner.password }] });
    assert.equal(result.status, 200, result.error);
    token = result.data.sessionToken;
  };
  core = await createBackend({ dataDirectory: directory, initialize: true, providersEnabled: false, automaticMonthClose: false, secrets });
  await core.createOwner(owner);
  await login();

  const create = (channel, input) => good(channel, { requestId: crypto.randomUUID(), ...input });
  const supplier = await create('createSupplier', { name: 'Fictional Link Supplier' });
  const otherSupplier = await create('createSupplier', { name: 'Fictional Other Supplier' });
  const type = await create('createType', { name: 'Fictional Transit', unit: 'Mbps' });
  const oldType = await create('createType', { name: 'Fictional Old Link', unit: 'Gbps' });
  const newType = await create('createType', { name: 'Fictional New Link', unit: 'Gbps' });
  const purchase = (purchaseDate, typeId, quantity, unitPrice, supplierId = supplier.id, note = '') => create('createPurchase', { supplierId, typeId, purchaseDate, quantity, unitPrice, note });
  await purchase('2020-09-29', type.id, 8, 10);
  const octoberTransit = await purchase('2020-10-05', type.id, 4, 10, supplier.id, 'Fictional transit note');
  const octoberOld = await purchase('2020-10-06', oldType.id, '0.125005', 320);
  await purchase('2020-10-07', type.id, 1, 11, otherSupplier.id);
  await purchase('2020-11-02', type.id, 5, 10);

  const updated = await request('updateType', [oldType.id, { requestId: crypto.randomUUID(), name: oldType.name, unit: oldType.unit, active: false }]);
  assert.equal(updated.status, 200, updated.error);
  const today = (await good('overview')).today;
  const drawer = await core.request({ channel: 'drawer:setBalance', args: [{ balance: 200, note: 'Fictional test funds' }], token });
  assert.equal(drawer.status, 200, drawer.error);
  const payment = await create('pay', { supplierId: supplier.id, paymentDate: today, amount: 100, paymentMethod: 'Cash', sourceWorkspaceId: 'main' });
  assert.deepEqual(payment.allocations.map(row => row.amount), [80, 20]);

  const overview = (start, end) => good('overview', { supplierId: supplier.id, start, end });
  const october = await overview('2020-10-01', '2020-10-31');
  assert.deepEqual([october.totals.periodCost, october.totals.periodPaid, october.totals.periodRemaining], [80, 0, 80]);
  assert.equal(october.totals.remaining, 160, 'Supplier statements retain outstanding earlier purchases.');
  const throughToday = await overview('2020-10-01', today);
  assert.deepEqual([throughToday.totals.periodCost, throughToday.totals.periodPaid, throughToday.totals.periodRemaining], [130, 100, 110]);
  const unpaidPrior = await overview('2020-11-01', '2020-11-30');
  assert.deepEqual([unpaidPrior.totals.periodCost, unpaidPrior.totals.periodPaid, unpaidPrior.totals.periodRemaining], [50, 0, 50]);
  assert.equal(unpaidPrior.totals.remaining, 210);
  const all = await overview('', '');
  assert.deepEqual([all.totals.periodCost, all.totals.periodPaid, all.totals.periodRemaining], [all.totals.totalCost, all.totals.totalPaid, all.totals.remaining]);

  const scope = { supplierId: supplier.id, purchaseDate: '2020-11-12' };
  const draft = await good('purchaseDraft', scope);
  assert.equal(draft.sourceMonth, '2020-10');
  assert.deepEqual(draft.lines.map(row => [row.typeId, row.unit, row.quantity, row.unitPrice, row.active]), [
    [type.id, 'Mbps', '4', '10', true], [oldType.id, 'Gbps', '0.125005', '320', false]
  ]);
  assert.equal(draft.lines[0].note, octoberTransit.note);
  assert.deepEqual((await good('purchaseDraft', { ...scope, purchaseDate: '2021-01-01' })).lines, []);
  const retryId = crypto.randomUUID();
  const first = { typeId: type.id, quantity: '3', unitPrice: draft.lines[0].unitPrice, note: draft.lines[0].note };
  const second = { typeId: newType.id, quantity: '2', unitPrice: '6' };
  const batch = { requestId: retryId, ...scope, lines: [first, second] };
  const bad = await request('createPurchases', [{ ...batch, lines: [first, { ...second, typeId: oldType.id }] }]);
  assert.notEqual(bad.status, 200);
  assert.match(bad.error, /active supplier and bandwidth type/);
  const rejected = await overview('2020-11-12', '2020-11-12');
  assert.equal(rejected.purchases.length, 0, 'The valid first line is rolled back when the next type is inactive.');

  const pendingPath = path.join(directory, 'isp-desk.sqlite.pending');
  fs.mkdirSync(pendingPath);
  try {
    const uncertain = await request('createPurchases', [batch]);
    assert.notEqual(uncertain.status, 200);
    assert.equal(uncertain.error, 'The bandwidth purchase save could not be confirmed.');
    assert.equal((await overview('2020-11-12', '2020-11-12')).purchases.length, 2);
  } finally {
    fs.rmdirSync(pendingPath);
  }
  const saved = await good('createPurchases', batch);
  assert.equal(saved.idempotent, true);
  assert.deepEqual(saved.purchases.map(row => [row.typeId, row.quantity, row.total, !!row.expenseId]), [
    [type.id, 3, 30, true], [newType.id, 2, 12, true]
  ]);
  assert.equal(new Set(saved.purchases.map(row => row.expenseId)).size, 2);
  for (const lines of [[second, first], [first], []]) {
    assert.notEqual((await request('createPurchases', [{ ...batch, lines }])).status, 200);
  }
  assert.equal((await request('purchaseDraft', [scope], '')).status, 401);
  const switched = await core.request({ channel: 'auth:switch', args: ['fiber-users'], token });
  assert.equal(switched.status, 200, switched.error);
  assert.notEqual((await request('createPurchases', [batch], switched.data.sessionToken, 'fiber-users')).status, 200);

  await core.close();
  core = await createBackend({ dataDirectory: directory, providersEnabled: false, automaticMonthClose: false, secrets });
  await login();
  assert.deepEqual((await good('createPurchases', batch)).purchases.map(row => row.id), saved.purchases.map(row => row.id));
  const recent = await overview('2020-11-12', '2020-11-12');
  assert.equal(recent.purchases.length, 2);
  assert.equal(recent.totals.periodRemaining, 42);
  const originals = (await overview('2020-10-01', '2020-10-31')).purchases;
  assert.deepEqual(originals, [octoberOld, octoberTransit]);
});
