'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const {createBackend} = require('../app/core.cjs');
const {createServer} = require('../server.cjs');
const {createSecretStorage} = require('../lib/secrets.cjs');
const {extractVerifiedBackup} = require('../tools/verify-backup.cjs');

test('real core through HTTP keeps credentials encrypted, protects host settings, and produces verifiable seven-file backups', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-server-core-fictional-'));
  const secrets = createSecretStorage(crypto.randomBytes(32));
  let backend, server;
  t.after(async () => { if (server?.listening) await new Promise(resolve => server.close(resolve)); await backend?.close(); secrets.destroy(); fs.rmSync(directory, {recursive: true, force: true}); });
  backend = await createBackend({dataDirectory: directory, initialize: true, secrets, providersEnabled: false});
  await backend.createOwner({username: 'owner', fullName: 'Fictional Website Owner', password: 'Fictional-web-only-123'});
  server = createServer({backend, origin: 'http://localhost', demo: true});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let cookie = '', csrf = '';
  async function request(route, value) {
    return new Promise((resolve, reject) => {
      const req = http.request({host: '127.0.0.1', port: server.address().port, path: route, method: value ? 'POST' : 'GET', headers: {Host: 'localhost', ...(cookie ? {Cookie: cookie} : {}), ...(value ? {Origin: 'http://localhost', 'X-CSRF-Token': csrf, 'X-App-Version': '0.1.0', 'Content-Type': 'application/json'} : {})}}, res => {
        if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks))}));
      }); req.on('error', reject); req.end(value ? JSON.stringify(value) : undefined);
    });
  }
  const call = (channel, args = [], workspaceId = 'main') => request('/api/rpc', {channel, args, workspaceId});
  const bootstrap = await request('/api/session'); csrf = bootstrap.body.data.csrfToken;
  const login = await call('auth:login', [{username: 'owner', password: 'Fictional-web-only-123'}]);
  assert.equal(login.status, 200); assert.equal(login.body.data.role, 'admin'); assert.equal(login.body.data.sessionToken, undefined);
  const portal = await call('portal:configure', [{username: 'fictional-api-account', password: 'Fictional-provider-secret'}]);
  assert.equal(portal.status, 200); assert.equal(portal.body.data.configured, true);
  const saved = fs.readFileSync(path.join(directory, 'internet-api-settings.json'), 'utf8');
  assert(!saved.includes('Fictional-provider-secret'));
  const encrypted = JSON.parse(saved).passwordEncrypted;
  assert.equal(secrets.decryptString(Buffer.from(encrypted, 'base64')), 'Fictional-provider-secret');
  const blocked = await call('portal:test', ['fictional-only']); assert(blocked.status >= 400, 'providers remain disabled');
  const passphrase = 'Fictional-backup-passphrase-123';
  const settings = await call('backups:save', [{enabled: false, passphrase, ftp: {enabled: false}, email: {enabled: false}}]);
  assert.equal(settings.status, 200); assert.equal(settings.body.data.folder, undefined); assert(!JSON.stringify(settings.body).includes(directory)); assert(!JSON.stringify(settings.body).includes(passphrase));
  const backup = await call('backups:run'); assert.equal(backup.status, 200); assert.equal(backup.body.data.history[0].local, 'saved');
  const files = fs.readdirSync(path.join(directory, 'scheduled-backups')).filter(name => name.endsWith('.fnbak')); assert.equal(files.length, 1);
  const archive = path.join(directory, 'scheduled-backups', files[0]);
  const destination = path.join(directory, 'new-verified-extraction');
  const verified = await extractVerifiedBackup({archive, destination, passphrase});
  assert.equal(verified.files.filter(file => file.name.endsWith('.sqlite')).length, 7);
  assert(fs.existsSync(path.join(destination, 'backup-verification.json')));
  await assert.rejects(extractVerifiedBackup({archive, destination, passphrase}), /already exists/);
  const wrong = path.join(directory, 'wrong-passphrase');
  await assert.rejects(extractVerifiedBackup({archive, destination: wrong, passphrase: 'Wrong-fictional-passphrase'}), /passphrase|damaged/);
  assert.equal(fs.existsSync(wrong), false);
});
