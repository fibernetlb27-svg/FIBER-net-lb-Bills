'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const {createServer, publicOrigin} = require('../server.cjs');
const {createSecretStorage, loadSecretStorage} = require('../lib/secrets.cjs');
const {assertCompleteDataDirectory, DATABASES} = require('../lib/storage.cjs');

function fixtureBackend() {
  const tokens = new Map(), calls = [];
  return {
    calls,
    metadata(workspaceId) { return {version: '0.1.0', section: {id: workspaceId}, sections: [{id: 'main'}, {id: 'fiber-users'}], areas: [], needsSetup: false, providersEnabled: false, folder: '/private/never-public', secret: 'never-public'}; },
    async request(input) {
      calls.push(input);
      const {channel, args, token, workspaceId} = input;
      if (channel === 'auth:login') {
        if (args[0].password !== 'Fictional-only-123') return {status: 400, error: 'Incorrect username or password.'};
        const sessionToken = crypto.randomBytes(32).toString('hex'), user = {username: args[0].username, role: args[0].username === 'cashier' ? 'cashier' : 'admin', active: true};
        tokens.set(sessionToken, {workspaceId, user}); return {status: 200, data: {user, sessionToken}};
      }
      const session = tokens.get(token);
      if (channel === 'auth:status') return {status: 200, data: {needsSetup: false, user: session?.workspaceId === workspaceId ? session.user : null}};
      if (channel === 'auth:logout') { tokens.delete(token); return {status: 200, data: {ok: true}}; }
      if (!session || session.workspaceId !== workspaceId) return {status: 401, error: 'Sign in again.'};
      if (channel === 'auth:switch') { const sessionToken = crypto.randomBytes(32).toString('hex'); tokens.set(sessionToken, {...session, workspaceId: args[0]}); return {status: 200, data: {user: session.user, sessionToken}}; }
      if (channel === 'products:list' && args[0] === 'path-error') return {status: 400, error: 'Unable to read /private/secret-file'};
      if (channel === 'products:list' && args[0] === 'throw') throw Error('password=never-public C:\\secret\\database');
      return {status: 200, data: {workspaceId, channel}};
    }
  };
}

async function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-http-fictional-'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>Fictional website</title>');
  fs.writeFileSync(path.join(directory, 'bridge.js'), 'window.example=true;');
  fs.writeFileSync(path.join(directory, 'private.cjs'), 'never serve this');
  const backend = fixtureBackend(), origin = options.origin || 'http://localhost';
  const server = createServer({backend, origin, demo: true, staticDirectory: directory, ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  const jar = {cookie: '', csrf: ''};
  async function request(route, {method = 'GET', payload, headers = {}, useCookie = true} = {}) {
    const result = await new Promise((resolve, reject) => {
      const req = http.request(base + route, {method, headers: {Host: new URL(origin).host, ...(useCookie && jar.cookie ? {Cookie: jar.cookie} : {}), ...(payload === undefined ? {} : {'Content-Type': 'application/json'}), ...headers}}, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({status: response.statusCode, headers: new Headers(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])), text: Buffer.concat(chunks).toString('utf8')}));
      });
      req.on('error', reject); if (payload !== undefined) req.write(typeof payload === 'string' ? payload : JSON.stringify(payload)); req.end();
    });
    const cookie = result.headers.get('set-cookie'); if (cookie) jar.cookie = cookie.split(';')[0];
    let body; try { body = JSON.parse(result.text); } catch { body = result.text; }
    return {status: result.status, headers: result.headers, body};
  }
  async function bootstrap(workspaceId = 'main') { const result = await request(`/api/session?workspaceId=${workspaceId}`); jar.csrf = result.body.data.csrfToken; return result; }
  async function rpc(channel, args = [], workspaceId = 'main', headers = {}) { return request('/api/rpc', {method: 'POST', payload: {channel, args, workspaceId}, headers: {Origin: origin, 'X-CSRF-Token': jar.csrf, 'X-App-Version': '0.1.0', ...headers}}); }
  async function login(username = 'owner', workspaceId = 'main') { return rpc('auth:login', [{username, password: 'Fictional-only-123'}], workspaceId); }
  return {backend, request, bootstrap, rpc, login, jar};
}

test('website sessions require exact origin and CSRF, rotate login cookie, keep core tokens private', async t => {
  const f = await setup(t);
  const start = await f.bootstrap();
  assert.equal(start.status, 200); assert.equal(start.body.data.user, null);
  assert.match(start.body.data.csrfToken, /^[a-f0-9]{64}$/);
  assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(start.headers.get('access-control-allow-origin'), null);
  const initialCookie = f.jar.cookie;
  assert.equal((await f.request('/api/rpc', {method: 'POST', payload: {channel: 'auth:login', args: [], workspaceId: 'main'}})).status, 403);
  assert.equal((await f.rpc('auth:login', [], 'main', {Origin: 'https://attacker.invalid'})).status, 403);
  assert.equal((await f.rpc('auth:login', [], 'main', {'X-CSRF-Token': 'f'.repeat(64)})).status, 403);
  assert.equal(f.backend.calls.length, 0, 'rejected requests never reach accounting');
  const login = await f.login();
  assert.equal(login.status, 200); assert.equal(login.body.data.username, 'owner');
  assert.equal(login.body.data.sessionToken, undefined);
  assert.notEqual(f.jar.cookie, initialCookie, 'login rotates the opaque cookie');
  const internalToken = f.backend.calls.find(call => call.channel === 'auth:login'); assert(internalToken);
  const current = await f.bootstrap(); assert.equal(current.body.data.user.username, 'owner');
  assert(!JSON.stringify(current.body).includes('sessionToken'));
  assert.equal((await f.rpc('auth:createOwner', [])).status, 400);
  assert.equal((await f.rpc('workspace:reset', ['START FRESH'])).status, 400);
  assert.equal((await f.rpc('updates:install', [])).status, 400);
});

test('workspace tokens stay independent across tabs and host settings require fresh Main Admin', async t => {
  const f = await setup(t); await f.bootstrap(); await f.login();
  assert.equal((await f.rpc('auth:switch', ['fiber-users'])).status, 200);
  assert.equal((await f.rpc('products:list', [], 'fiber-users')).body.data.workspaceId, 'fiber-users');
  assert.equal((await f.rpc('products:list', [], 'main')).body.data.workspaceId, 'main');
  const calls = f.backend.calls.filter(call => call.channel === 'products:list');
  assert.notEqual(calls[0].token, calls[1].token);
  assert.equal((await f.rpc('portal:settings', [], 'fiber-users')).status, 403);
  assert.equal((await f.rpc('portal:settings', [], 'main')).status, 200);
  assert.equal((await f.rpc('auth:logout', [], 'fiber-users')).status, 200);
  assert.equal((await f.rpc('products:list', [], 'fiber-users')).status, 401);
  assert.equal((await f.rpc('products:list', [], 'main')).status, 200);
  await f.login('cashier');
  assert.equal((await f.rpc('backups:status')).status, 403);
});

test('only allowlisted renderer files are public and metadata/errors omit private paths', async t => {
  const f = await setup(t);
  const root = await f.request('/'); assert.equal(root.status, 200);
  assert.match(root.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(root.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await f.request('/bridge.js')).status, 200);
  for (const route of ['/private.cjs', '/server.cjs', '/app/core.cjs', '/.env', '/isp-desk.sqlite', '/%2e%2e/server.cjs']) assert.equal((await f.request(route)).status, 404, route);
  const meta = await f.request('/api/meta'); assert.equal(meta.body.data.demo, true); assert.equal(meta.body.data.capabilities.backups, true); assert.equal(meta.body.data.folder, undefined); assert(!JSON.stringify(meta.body).includes('never-public'));
  assert.equal((await f.request('/api/meta', {headers: {Host: 'attacker.invalid'}})).status, 421);
  assert.equal((await f.request('/api/meta?workspaceId=main&workspaceId=studio')).status, 400);
  await f.bootstrap(); await f.login();
  for (const arg of ['path-error', 'throw']) { const result = await f.rpc('products:list', [arg]); assert(result.status >= 400); assert(!JSON.stringify(result.body).includes('secret')); assert(!JSON.stringify(result.body).includes('never-public')); }
});

test('session limits, idle/absolute expiry and bounded login attempts fail closed', async t => {
  let clock = 1000;
  const f = await setup(t, {now: () => clock, idleMs: 100, absoluteMs: 200, maxSessions: 1, limits: {loginsGlobal: 2, loginsPerAddress: 10, loginsPerAccount: 10}});
  await f.bootstrap(); await f.login();
  assert.equal((await f.request('/api/session', {useCookie: false})).status, 503);
  // Restore the first jar and exercise the session before its idle deadline.
  clock = 1090; assert.equal((await f.rpc('products:list')).status, 200);
  clock = 1180; assert.equal((await f.rpc('products:list')).status, 200);
  clock = 1201; assert.equal((await f.rpc('products:list')).status, 403, 'absolute lifetime expires despite activity');
  await f.bootstrap(); await f.login();
  assert.equal((await f.login()).status, 429, 'global login budget spans distinct sessions');
  clock = 1400; assert.equal((await f.rpc('products:list')).status, 403, 'idle expiration requires a new sign in');
});

test('JSON size/content limits reject without backend effects; HTTPS cookies are secure', async t => {
  const f = await setup(t, {maxBodyBytes: 128}); await f.bootstrap();
  const tooLarge = await f.request('/api/rpc', {method: 'POST', payload: {channel: 'auth:login', args: ['x'.repeat(200)], workspaceId: 'main'}, headers: {Origin: 'http://localhost', 'X-CSRF-Token': f.jar.csrf}});
  assert.equal(tooLarge.status, 413); assert.equal(f.backend.calls.length, 0);
  assert.equal((await f.rpc('auth:login', [], 'main', {'Content-Type': 'text/plain'})).status, 415);
  const secure = await setup(t, {origin: 'https://website.invalid', demo: false});
  assert.match((await secure.bootstrap()).headers.get('set-cookie'), /; Secure/);
  assert.equal(publicOrigin('http://127.0.0.1:3000', true).origin, 'http://127.0.0.1:3000');
  assert.throws(() => publicOrigin('http://website.invalid', true), /HTTPS/);
  assert.throws(() => publicOrigin('https://website.invalid/path', false), /scheme and host/);
});

test('repeated business-page asset loads use an independent budget and revalidate ETags; API abuse still reaches its own limit', async t => {
  const f = await setup(t, {limits: {requestsPerAddress: 12, requestsGlobal: 12}});
  const asset = await f.request('/bridge.js');
  const etag = asset.headers.get('etag'); assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.match(asset.headers.get('cache-control'), /must-revalidate/);
  const fresh = await f.request('/bridge.js', {headers: {'If-None-Match': etag}}); assert.equal(fresh.status, 304); assert.equal(fresh.body, '');
  assert.equal((await f.request('/')).headers.get('cache-control'), 'no-store');
  // More than a complete seven-business navigation (roughly 60 assets each).
  for (let batch = 0; batch < 10; batch++) {
    const results = await Promise.all(Array.from({length: 50}, () => f.request('/bridge.js', {headers: {'If-None-Match': etag}})));
    assert(results.every(result => result.status === 304));
  }
  await f.bootstrap(); assert.equal((await f.login()).status, 200, 'static navigation did not consume any API/login budget');
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/api/meta')).status, 200);
  assert.equal((await f.request('/api/meta')).status, 429, 'application abuse still exhausts its independent budget');
  assert.equal((await f.request('/bridge.js', {headers: {'If-None-Match': etag}})).status, 304, 'API abuse does not block cached renderer resources');
});

test('missing or stale page version rejects before a financial action without retry', async t => {
  const f = await setup(t); await f.bootstrap(); await f.login();
  const count = f.backend.calls.length;
  for (const version of ['', '0.0.9']) {
    const result = await f.rpc('sales:create', [{items: []}], 'main', {'X-App-Version': version});
    assert.equal(result.status, 409); assert.equal(result.body.code, 'APP_VERSION_MISMATCH');
    assert.match(result.body.error, /saved or pending/);
  }
  assert.equal(f.backend.calls.length, count, 'no backend write, status request or retry occurred');
  assert.equal((await f.rpc('sales:create', [{items: []}])).status, 200);
  assert.equal(f.backend.calls.filter(call => call.channel === 'sales:create').length, 1);
});

test('server secrets authenticate encryption, require a separate valid key, reject old Windows ciphertext', t => {
  const key = crypto.randomBytes(32), a = createSecretStorage(key), b = createSecretStorage(crypto.randomBytes(32));
  const ciphertext = a.encryptString('fictional secret');
  assert(!ciphertext.includes(Buffer.from('fictional secret')));
  assert.equal(a.decryptString(ciphertext), 'fictional secret');
  assert.notDeepEqual(a.encryptString('fictional secret'), ciphertext, 'every encryption uses a new IV');
  assert.throws(() => b.decryptString(ciphertext), /could not be unlocked/);
  const altered = Buffer.from(ciphertext); altered[altered.length - 1] ^= 1;
  assert.throws(() => a.decryptString(altered), /could not be unlocked/);
  assert.throws(() => a.decryptString(Buffer.from('old-Windows-value')), /Re-enter Windows/);
  assert.throws(() => createSecretStorage(Buffer.alloc(31)), /32-byte/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-secret-fictional-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'server-key'); fs.writeFileSync(file, key, {mode: 0o600});
  const loaded = loadSecretStorage(file); assert.equal(loaded.decryptString(ciphertext), 'fictional secret'); loaded.destroy();
  a.destroy(); assert.equal(a.isEncryptionAvailable(), false); assert.throws(() => a.encryptString('x'), /closed/); b.destroy(); key.fill(0);
});

test('production storage preflight refuses incomplete directories without creating databases', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-preflight-fictional-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.chmodSync(directory, 0o700);
  assert.throws(() => assertCompleteDataDirectory(directory)); assert.deepEqual(fs.readdirSync(directory), []);
  fs.mkdirSync(path.join(directory, 'sections'), {mode: 0o700});
  for (const name of DATABASES) fs.writeFileSync(path.join(directory, name), Buffer.alloc(100), {mode: 0o600});
  assert.equal(assertCompleteDataDirectory(directory), directory);
  fs.unlinkSync(path.join(directory, DATABASES[6]));
  assert.throws(() => assertCompleteDataDirectory(directory), /all seven/i);
});
