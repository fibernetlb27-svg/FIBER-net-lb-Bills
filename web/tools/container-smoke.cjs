'use strict';
// CI-only Linux Docker check. Every credential and database below is fictional.
// The accounting container has only an internal network. A fixture-only proxy
// also joins an ingress bridge and publishes host loopback; providers stay off.
// No existing directory or service is selected.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), http = require('node:http'), assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createBackend} = require('../app/core.cjs');
const {createSecretStorage} = require('../lib/secrets.cjs');
const version = require('../package.json').version;

function docker(args, {allowFailure = false} = {}) {
  const result = spawnSync('docker', args, {encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe']});
  if (result.error || result.status !== 0) { if (allowFailure) return null; throw Error(`Docker fixture check failed during ${args[0] || 'command'}.`); }
  return (String(result.stdout || '') + (args[0] === 'logs' ? String(result.stderr || '') : '')).trim();
}
function containerArguments({image, name, network, data, key}) {
  return ['run', '--detach', '--name', name, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,size=32m,mode=1777', '--mount', `type=bind,source=${data},target=/data`, '--mount', `type=bind,source=${key},target=/run/secrets/server-key,readonly`, '--env', 'APP_ORIGIN=https://ci.invalid', '--env', 'BIND_ADDRESS=0.0.0.0', '--env', 'DATA_DIRECTORY=/data', '--env', 'SECRETS_KEY_FILE=/run/secrets/server-key', '--env', 'PROVIDERS_ENABLED=false', image];
}
function proxyArguments({image, name, ingress, target}) {
  // Fixed upstream only; no URLs, request bodies, credentials or access logs.
  // Each inbound request creates exactly one upstream request, with no replay.
  const code = "const http=require('node:http');const target=process.argv[1];const server=http.createServer((req,res)=>{const upstream=http.request({hostname:target,port:3000,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fictional fixture upstream is not ready.'}));}else res.destroy();});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);});server.headersTimeout=15000;server.requestTimeout=20000;server.listen(3000,'0.0.0.0');";
  return ['run', '--detach', '--name', name, '--network', ingress, '--publish', '127.0.0.1::3000', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--no-healthcheck', '--entrypoint', 'node', image, '-e', code, target];
}
function changeFixtureOwner(image, directory, uid, gid) {
  const code = "const fs=require('node:fs'),path=require('node:path');const root='/fixture';function visit(file){const s=fs.lstatSync(file);if(s.isSymbolicLink())throw Error('Unexpected fixture symlink');if(s.isDirectory())for(const n of fs.readdirSync(file))visit(path.join(file,n));fs.chownSync(file,Number(process.argv[1]),Number(process.argv[2]));}visit(root);";
  docker(['run', '--rm', '--network', 'none', '--user', '0:0', '--read-only', '--mount', `type=bind,source=${directory},target=/fixture`, '--entrypoint', 'node', image, '-e', code, String(uid), String(gid)]);
}
function client(port) {
  const jar = {cookie: '', csrf: ''};
  async function request(route, input) {
    return new Promise((resolve, reject) => {
      const req = http.request({hostname: '127.0.0.1', port, path: route, method: input ? 'POST' : 'GET', headers: {Host: 'ci.invalid', ...(jar.cookie ? {Cookie: jar.cookie} : {}), ...(input ? {Origin: 'https://ci.invalid', 'Content-Type': 'application/json', 'X-CSRF-Token': jar.csrf, 'X-App-Version': version} : {})}}, res => {
        if (res.headers['set-cookie']) jar.cookie = res.headers['set-cookie'][0].split(';')[0];
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
          try { resolve({status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}); } catch { reject(Error('Container returned invalid JSON.')); }
        });
      });
      req.setTimeout(5000, () => req.destroy(Error('Container fixture HTTP timeout.'))); req.on('error', reject); req.end(input ? JSON.stringify(input) : undefined);
    });
  }
  return {jar, request, rebind(nextPort) { if (!Number.isSafeInteger(nextPort) || nextPort < 1 || nextPort > 65535) throw Error('Invalid fixture port.'); port = nextPort; }, rpc: (channel, args = [], workspaceId = 'main') => request('/api/rpc', {channel, args, workspaceId})};
}
async function ready(connection) {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    try { if ((await connection.request('/health')).status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Error('Container did not become ready.');
}
async function main(args) {
  if (process.platform !== 'linux') throw Error('The Docker fixture smoke check runs on an isolated Linux CI host.');
  if (args.length !== 2 || args[0] !== '--image' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(args[1])) throw Error('Use --image LOCAL_BUILT_IMAGE.');
  process.umask(0o077); docker(['version', '--format', '{{.Server.Version}}']);
  const image = args[1], directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernetlb-container-fictional-'));
  const data = path.join(directory, 'data'), key = path.join(directory, 'server-key'), incomplete = path.join(directory, 'incomplete');
  fs.mkdirSync(data, {mode: 0o700}); fs.mkdirSync(incomplete, {mode: 0o700});
  const bytes = crypto.randomBytes(32); fs.writeFileSync(key, bytes, {mode: 0o600}); const secrets = createSecretStorage(bytes); bytes.fill(0);
  const suffix = crypto.randomBytes(8).toString('hex'), name = `fibernetlb-fixture-${suffix}`, proxy = `${name}-proxy`, conflict = `${name}-conflict`, missing = `${name}-missing`, network = `${name}-private`, ingress = `${name}-ingress`;
  const username = 'ci.fictional.owner', password = crypto.randomBytes(24).toString('hex');
  let backend, ownerChanged = false, networkCreated = false, ingressCreated = false, stage = 'initialize fictional accounting';
  try {
    backend = await createBackend({dataDirectory: data, initialize: true, providersEnabled: false, secrets, version});
    await backend.createOwner({username, password, fullName: 'Fictional CI Owner'});
    const login = await backend.request({channel: 'auth:login', args: [{username, password}], workspaceId: 'main'}); assert.equal(login.status, 200);
    const opening = await backend.request({channel: 'drawer:setBalance', args: [{balance: 17, note: 'Fictional CI opening'}], workspaceId: 'main', token: login.data.sessionToken}); assert.equal(opening.status, 200);
    await backend.close(); backend = null; secrets.destroy();
    stage = 'assign fixture-only UID 10001 ownership';
    changeFixtureOwner(image, directory, 10001, 10001); ownerChanged = true;
    stage = 'create isolated fixture network';
    docker(['network', 'create', '--internal', network]); networkCreated = true;
    docker(['network', 'create', ingress]); ingressCreated = true;
    stage = 'launch production fixture image';
    docker(containerArguments({image, name, network, data, key}));
    stage = 'inspect isolated accounting network';
    const inspect = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(Object.keys(inspect.NetworkSettings.Networks), [network], 'accounting has no ingress/default-gateway network');
    assert.equal(Object.values(inspect.NetworkSettings.Ports || {}).flat().filter(Boolean).length, 0, 'accounting never publishes a host port');
    assert.equal(JSON.parse(docker(['network', 'inspect', network]))[0].Internal, true);
    stage = 'launch loopback-only fixture ingress proxy';
    docker(proxyArguments({image, name: proxy, ingress, target: name}));
    docker(['network', 'connect', network, proxy]);
    const proxyInspect = JSON.parse(docker(['inspect', proxy]))[0];
    const binding = proxyInspect.NetworkSettings.Ports['3000/tcp'][0]; assert.equal(binding.HostIp, '127.0.0.1');
    assert.deepEqual(Object.keys(proxyInspect.NetworkSettings.Networks).sort(), [ingress, network].sort());
    stage = 'verify non-root container identity';
    assert.equal(docker(['exec', name, 'node', '-e', 'process.stdout.write(String(process.getuid()))']), '10001');
    stage = 'wait for initial HTTP readiness';
    const connection = client(Number(binding.HostPort)); await ready(connection);
    async function signIn(existingBootstrap) {
      const session = existingBootstrap || await connection.request('/api/session'); connection.jar.csrf = session.body.data.csrfToken;
      assert.match(session.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Secure/);
      const result = await connection.rpc('auth:login', [{username, password}]); assert.equal(result.status, 200); assert.equal(result.body.data.sessionToken, undefined);
    }
    stage = 'verify protected fixture session and persisted balance';
    await signIn(); assert.equal((await connection.rpc('drawer:get')).body.data.balance, 17);
    assert.equal((await connection.request('/server.cjs')).status, 404);
    stage = 'verify disabled provider behavior';
    const configured = await connection.rpc('portal:configure', [{username: 'fictional-provider', password: 'Fictional-provider-only-123'}]); assert.equal(configured.status, 200);
    assert((await connection.rpc('portal:test', ['fictional-only'])).status >= 400, 'real providers remain disabled');
    stage = 'verify exclusive writer refusal';
    docker(containerArguments({image, name: conflict, network, data, key}));
    assert.equal(docker(['wait', conflict]), '1', 'a second backend cannot acquire the same data directory');
    stage = 'verify incomplete-data refusal';
    docker(containerArguments({image, name: missing, network, data: incomplete, key}));
    assert.equal(docker(['wait', missing]), '1', 'missing seven-file storage fails closed');
    stage = 'restart and rediscover loopback binding';
    docker(['stop', '--time', '60', name]); docker(['start', name]);
    const restarted = JSON.parse(docker(['inspect', proxy]))[0].NetworkSettings.Ports['3000/tcp'][0];
    assert.equal(restarted.HostIp, '127.0.0.1'); connection.rebind(Number(restarted.HostPort));
    stage = 'verify restarted HTTP session and durable balance';
    await ready(connection);
    const afterRestart = await connection.request('/api/session'); assert.equal(afterRestart.body.data.user, null, 'restart clears website sessions');
    await signIn(afterRestart); assert.equal((await connection.rpc('drawer:get')).body.data.balance, 17, 'the same private persisted files survive restart');
    docker(['stop', '--time', '60', name]);
    process.stdout.write('PASS isolated Linux Docker: non-root/read-only accounting container, internal-only accounting network, loopback ingress proxy, protected sessions, providers disabled, exclusive writer, incomplete-data refusal and restart persistence.\n');
  } catch (error) {
    // Only these self-created fictional containers are inspected. Never log
    // environment variables, mount contents, HTTP bodies, passwords or keys.
    for (const target of [name, proxy, conflict, missing]) {
      const raw = docker(['inspect', target], {allowFailure: true});
      if (!raw) continue;
      const value = JSON.parse(raw)[0];
      process.stderr.write(JSON.stringify({fixture: target === name ? 'primary' : target === proxy ? 'proxy' : target === conflict ? 'conflict' : 'missing', state: value.State?.Status, exitCode: value.State?.ExitCode, user: value.Config?.User, published: value.NetworkSettings?.Ports, requestedBindings: value.HostConfig?.PortBindings}) + '\n');
      const logs = docker(['logs', '--tail', '8', target], {allowFailure: true});
      if (logs) process.stderr.write(logs.replaceAll(password, '[fictional credential omitted]').slice(-2000) + '\n');
    }
    throw Error(`Docker fixture failure at ${stage}: ${String(error.message).replaceAll(password, '[fictional credential omitted]').slice(0, 500)}`);
  } finally {
    await backend?.close(); secrets.destroy();
    for (const target of [name, proxy, conflict, missing]) docker(['rm', '--force', target], {allowFailure: true});
    if (networkCreated) docker(['network', 'rm', network], {allowFailure: true});
    if (ingressCreated) docker(['network', 'rm', ingress], {allowFailure: true});
    if (ownerChanged) changeFixtureOwner(image, directory, process.getuid(), process.getgid());
    const resolved = path.resolve(directory), temporary = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith('fibernetlb-container-fictional-')) throw Error('Refusing to clean an unexpected fixture path.');
    assert.deepEqual(fs.readdirSync(incomplete), [], 'failed production startup created no files');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\nNo live data, provider or deployment was selected.\n`); process.exitCode = 1; });
module.exports = {containerArguments, proxyArguments, client};
