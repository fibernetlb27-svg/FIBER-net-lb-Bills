'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {startFromEnvironment} = require('../server.cjs');
const {DATABASES} = require('../lib/storage.cjs');
const {containerArguments, proxyArguments, client} = require('../tools/container-smoke.cjs');
const http = require('node:http');

test('production entrypoint rejects HTTP, missing businesses and a key inside data before any backend starts', async t => {
  const mask = process.umask(); t.after(() => process.umask(mask));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-production-preflight-fictional-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const environment = {APP_ORIGIN: 'https://ci.invalid', DATA_DIRECTORY: directory, SECRETS_KEY_FILE: path.join(directory, 'key')};
  await assert.rejects(startFromEnvironment({...environment, APP_ORIGIN: 'http://localhost'}), /HTTPS/);
  await assert.rejects(startFromEnvironment(environment)); assert.deepEqual(fs.readdirSync(directory), []);
  fs.mkdirSync(path.join(directory, 'sections'), {mode: 0o700});
  for (const name of DATABASES) fs.writeFileSync(path.join(directory, name), Buffer.alloc(100), {mode: 0o600});
  await assert.rejects(startFromEnvironment(environment), /outside both/);
  assert.equal(fs.existsSync(path.join(directory, '.fibernetlb-web.lock')), false, 'unsafe secret placement never initializes a backend');
});

test('CI accounting stays internal and provider-disabled while only its credential-free ingress proxy publishes loopback', () => {
  const args = containerArguments({image: 'fixture:local', name: 'fictional', network: 'internal-fixture', data: '/tmp/fictional/data', key: '/tmp/fictional/key'});
  assert.equal(args.includes('--publish'), false);
  assert(args.includes('PROVIDERS_ENABLED=false'));
  assert(args.includes('type=bind,source=/tmp/fictional/key,target=/run/secrets/server-key,readonly'));
  assert(args.includes('--read-only')); assert(args.includes('no-new-privileges:true'));
  assert.equal(args.includes('--privileged'), false);
  assert.equal(args.includes('host'), false);
  const proxy = proxyArguments({image: 'fixture:local', name: 'fictional-proxy', ingress: 'fixture-ingress', target: 'fictional'});
  assert(proxy.includes('127.0.0.1::3000')); assert(proxy.includes('--read-only'));
  assert.equal(proxy.includes('--mount'), false, 'proxy cannot read private databases or key files');
  assert.equal(proxy.includes('--env'), false, 'proxy receives no provider/account credentials');
  assert.equal(proxy.includes('--privileged'), false);
});

test('container smoke HTTP client follows a changed restart port while retaining its opaque cookie', async t => {
  const first = http.createServer((_req, res) => { res.setHeader('Set-Cookie', 'opaque=fictional; HttpOnly; SameSite=Strict; Secure'); res.end('{"data":{"port":"first"}}'); });
  const second = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({data: {port: 'second', cookie: req.headers.cookie}})); });
  for (const server of [first, second]) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve))); }
  const connection = client(first.address().port);
  assert.equal((await connection.request('/health')).body.data.port, 'first');
  connection.rebind(second.address().port);
  const result = await connection.request('/health');
  assert.equal(result.body.data.port, 'second'); assert.equal(result.body.data.cookie, 'opaque=fictional');
  assert.throws(() => connection.rebind(0), /Invalid fixture port/);
});
