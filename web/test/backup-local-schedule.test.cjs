'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {BackupManager, beirutClock} = require('../app/backup-manager.cjs');
const {DATABASES, openBackup} = require('../app/backup-archive.cjs');
const {createSecretStorage} = require('../lib/secrets.cjs');
const {createBackend} = require('../app/core.cjs');
const {extractVerifiedBackup} = require('../tools/verify-backup.cjs');

test('local-only daily schedules wait until the Beirut time and save once per day without delivery', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-local-schedule-fictional-'));
  const secrets = createSecretStorage(crypto.randomBytes(32));
  t.after(() => { secrets.destroy(); fs.rmSync(directory, {recursive: true, force: true}); });
  let clock = new Date('2026-10-31T08:00:00Z'), snapshots = 0, deliveries = 0;
  assert.equal(beirutClock(clock).time, '10:00');
  const manager = new BackupManager({
    directory, safeStorage: secrets, version: 'fictional-local-test', now: () => clock,
    snapshot: () => { snapshots++; return DATABASES.map(name => ({name, data: Buffer.from('Fictional unit snapshot: ' + name)})); },
    ftpFactory: () => { deliveries++; throw Error('No network delivery is permitted in this test.'); },
    mailFactory: () => { deliveries++; throw Error('No network delivery is permitted in this test.'); }
  });
  const passphrase = 'Fictional-local-backup-passphrase-123';
  const saved = manager.save({enabled: true, time: '11:00', passphrase, ftp: {enabled: false}, email: {enabled: false}});
  assert.equal(saved.settings.enabled, true);
  await manager.tick();
  assert.equal(manager.status().history.length, 0, 'The initial configured day waits for the selected time.');
  clock = new Date('2026-10-31T10:00:00Z');
  await manager.tick();
  await manager.tick();
  let history = manager.status().history;
  assert.equal(history.length, 1);
  assert.equal(history[0].dailyKey, '2026-10-31');
  assert.equal(history[0].kind, 'automatic');
  assert.equal(history[0].local, 'saved');
  assert.equal(history[0].ftp, 'disabled');
  assert.equal(history[0].email, 'disabled');
  const archive = await openBackup(fs.readFileSync(manager.file(history[0].id)), passphrase);
  assert.deepEqual(archive.entries.map(entry => entry.name), DATABASES);
  clock = new Date('2026-11-01T10:00:00Z');
  await manager.tick();
  history = manager.status().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].dailyKey, '2026-11-01');
  assert.equal(snapshots, 2);
  assert.equal(deliveries, 0);
});

test('provider-disabled backend starts and drains a local scheduled backup with seven restorable databases', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-core-schedule-fictional-'));
  const secrets = createSecretStorage(crypto.randomBytes(32));
  const ftp = require('basic-ftp'), mail = require('nodemailer');
  const originals = {fetch: globalThis.fetch, ftpAccess: ftp.Client.prototype.access, createTransport: mail.createTransport};
  let externalCalls = 0, backend;
  const denyExternal = () => { externalCalls++; throw Error('External delivery was attempted in a provider-disabled test.'); };
  t.after(async () => {
    try { await backend?.close(); } finally {
      globalThis.fetch = originals.fetch; ftp.Client.prototype.access = originals.ftpAccess; mail.createTransport = originals.createTransport;
      secrets.destroy(); fs.rmSync(directory, {recursive: true, force: true});
    }
  });
  globalThis.fetch = denyExternal; ftp.Client.prototype.access = denyExternal; mail.createTransport = denyExternal;
  async function call(channel, args = [], token = '') {
    const result = await backend.request({channel, args, token, workspaceId: 'main'});
    assert.equal(result.status, 200, channel + ': ' + result.error);
    return result.data;
  }
  const password = 'Fictional-scheduler-owner-123', passphrase = 'Fictional-scheduler-recovery-123';
  backend = await createBackend({dataDirectory: directory, initialize: true, secrets, providersEnabled: false});
  await backend.createOwner({username: 'owner', fullName: 'Fictional Scheduled Owner', password});
  let login = await call('auth:login', [{username: 'owner', password}]);
  await call('drawer:setBalance', [{balance: 75, note: 'Fictional balance preserved in automatic backup'}], login.sessionToken);
  await call('backups:save', [{enabled: true, time: '00:00', passphrase, ftp: {enabled: false}, email: {enabled: false}}], login.sessionToken);
  await backend.close();

  // Startup must schedule local protection even though all provider access is off.
  backend = await createBackend({dataDirectory: directory, secrets, providersEnabled: false});
  assert.equal(backend.metadata().providersEnabled, false);
  await backend.close(); // Graceful shutdown drains the asynchronous encryption job.
  const history = JSON.parse(fs.readFileSync(path.join(directory, 'backup-history.json'), 'utf8'));
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, 'automatic');
  assert.equal(history[0].local, 'saved');
  assert.equal(history[0].ftp, 'disabled');
  assert.equal(history[0].email, 'disabled');
  const archive = path.join(directory, 'scheduled-backups', 'FIBER-net-lb-backup-' + history[0].id + '.fnbak');
  const destination = path.join(directory, 'verified-fictional-restore');
  const restored = await extractVerifiedBackup({archive, destination, passphrase});
  assert.equal(restored.files.filter(file => file.name.endsWith('.sqlite')).length, 7);
  const SQL = await require('sql.js')({locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm')});
  const restoredDb = new SQL.Database(fs.readFileSync(path.join(destination, 'isp-desk.sqlite')));
  try { assert.equal(restoredDb.exec('SELECT SUM(amount) FROM cash_drawer_transactions')[0].values[0][0], 75); }
  finally { restoredDb.close(); }

  // Even a configured external destination cannot bypass the provider kill switch.
  backend = await createBackend({dataDirectory: directory, secrets, providersEnabled: false});
  login = await call('auth:login', [{username: 'owner', password}]);
  await call('backups:save', [{enabled: false, ftp: {enabled: true, host: 'backup.invalid', username: 'fictional', password: 'Fictional-ftp-only'}, email: {enabled: true, host: 'mail.invalid', username: 'fictional', password: 'Fictional-smtp-only', from: 'backup@example.invalid', to: 'recipient@example.invalid'}}], login.sessionToken);
  const blocked = await call('backups:run', [], login.sessionToken);
  assert.equal(blocked.history[0].local, 'saved');
  assert.equal(blocked.history[0].ftp, 'failed');
  assert.equal(blocked.history[0].email, 'failed');
  assert.equal(externalCalls, 0, 'No Proradius request, FTP access or SMTP connection factory was reached.');
});
