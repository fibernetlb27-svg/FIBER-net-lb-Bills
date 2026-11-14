'use strict';
// Isolated Linux CI only. This creates its own fictional seven-file database,
// container and internal network. It never accepts an existing data path,
// server address, production image, customer, provider or payment instruction.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {DATABASES} = require('../deploy/power-recovery.cjs');
const {auditCopiedData} = require('../deploy/power-recovery-audit.cjs');

const IMAGE = 'fibernetlb-web-ci:fixture';
const LABEL = 'io.fibernetlb.ci.power-recovery';
const ROOT = '/var/lib';
const PREFIX = 'ci-power-recovery-';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function argumentsAreFixtureOnly(args) {
  assert.deepEqual(args, ['--image', IMAGE], 'Use exactly --image fibernetlb-web-ci:fixture. No existing service or path can be selected.');
  assert.equal(process.platform, 'linux', 'This explicit Docker fixture check requires Linux; it is not a skipped cross-platform test.');
}

function command(binary, args, {allowFailure = false, timeout = 120_000, inherit = false} = {}) {
  const result = spawnSync(binary, args, {encoding: 'utf8', timeout,
    env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''},
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']});
  if (result.error || result.status !== 0) {
    if (allowFailure) return {status: result.status ?? -1, stdout: String(result.stdout || ''), stderr: String(result.stderr || '')};
    // Command arguments can contain fictional secrets. Never echo arguments,
    // container environment, database rows or subprocess error objects.
    throw Error(`Fixture command failed: ${path.basename(binary)} (${result.status ?? 'not started'}).`);
  }
  return {status: 0, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim()};
}

function docker(args, options) {
  return command('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args], options);
}

function privateJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.chmodSync(file, 0o600);
}

function ownTree(directory, uid, gid) {
  const value = fs.lstatSync(directory);
  assert(!value.isSymbolicLink(), 'The fresh fixture must contain no symlinks.');
  if (value.isDirectory()) for (const item of fs.readdirSync(directory)) ownTree(path.join(directory, item), uid, gid);
  fs.chownSync(directory, uid, gid);
}

function filesBelow(directory, relative = '') {
  const result = [];
  for (const item of fs.readdirSync(path.join(directory, relative), {withFileTypes: true})) {
    const name = relative ? relative + '/' + item.name : item.name;
    const file = path.join(directory, name), stat = fs.lstatSync(file, {bigint: true});
    assert(!stat.isSymbolicLink(), 'Fixture source changed to a symlink.');
    if (stat.isDirectory()) result.push(...filesBelow(directory, name));
    else {
      assert(stat.isFile());
      result.push({name, dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), sha256: sha256(fs.readFileSync(file))});
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function main(args) {
  argumentsAreFixtureOnly(args);
  if (process.getuid() !== 0) {
    // GitHub-hosted Ubuntu supplies passwordless sudo. All mutable paths remain
    // newly created under our fixture root; no arbitrary privileged args exist.
    command('/usr/bin/sudo', ['-n', '--', process.execPath, __filename, ...args], {timeout: 1_200_000, inherit: true});
    return;
  }
  process.umask(0o077);
  for (const file of ['/usr/bin/docker', '/usr/bin/flock', '/usr/bin/findmnt', '/usr/bin/fuser']) assert(fs.statSync(file).isFile(), `Missing required CI host tool: ${file}.`);
  const base = fs.lstatSync(ROOT);
  assert.equal(fs.realpathSync(ROOT), ROOT);
  assert(base.isDirectory() && base.uid === 0 && (base.mode & 0o022) === 0, 'The CI fixture base must be a protected root-owned directory.');
  docker(['version', '--format', '{{.Server.Version}}']);
  const builtImage = JSON.parse(docker(['image', 'inspect', IMAGE]).stdout)[0];
  assert.match(builtImage.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(builtImage.Config.User, '10001:10001');

  const directory = fs.mkdtempSync(path.join(ROOT, PREFIX));
  fs.chmodSync(directory, 0o700);
  const directoryIdentity = fs.lstatSync(directory, {bigint: true});
  const runId = crypto.randomUUID(), name = PREFIX + runId, network = name + '-internal';
  const marker = path.join(directory, 'fixture-owner.json');
  privateJson(marker, {format: 'FIBERNETLB-CI-POWER-FIXTURE-1', runId});
  const data = path.join(directory, 'data'), stateDirectory = path.join(directory, 'state');
  fs.mkdirSync(data, {mode: 0o700}); fs.mkdirSync(stateDirectory, {mode: 0o700});
  const key = path.join(directory, 'fictional-server-key'), guard = path.join(directory, 'power-recovery.cjs');
  const auditor = path.join(directory, 'power-recovery-audit.cjs'), guardLock = path.join(directory, 'guard.lock');
  const record = path.join(directory, 'active.json'), state = path.join(stateDirectory, 'healthy.json');
  const jobs = path.join(directory, 'jobs'), config = path.join(directory, 'config.json');
  for (const [source, target] of [['power-recovery.cjs', guard], ['power-recovery-audit.cjs', auditor]]) {
    fs.copyFileSync(path.join(__dirname, '..', 'deploy', source), target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o644);
  }
  fs.writeFileSync(guardLock, '', {flag: 'wx', mode: 0o600});
  const version = require('../package.json').version;
  privateJson(record, {format: 'FIBERNETLB-ACTIVE-DOMAIN-1', version, sourceCommit: 'a'.repeat(40)});
  privateJson(config, {format: 'FIBERNETLB-POWER-RECOVERY-CONFIG-1', privateDirectory: directory, dataDirectory: data,
    activeRecord: record, stateFile: state, jobsDirectory: jobs, containerName: name, auditScript: auditor,
    dockerBinary: '/usr/bin/docker', serializationLock: guardLock, expectedImage: IMAGE});

  let backend, secrets, createdContainer = false, createdNetwork = false, stage = 'initialize fictional accounting';
  function inspect({optional = false} = {}) {
    const result = docker(['inspect', name], {allowFailure: optional});
    if (result.status !== 0) return null;
    const values = JSON.parse(result.stdout);
    assert.equal(values.length, 1);
    assert.equal(values[0].Name, '/' + name);
    assert.equal(values[0].Config.Labels[LABEL], runId, 'Refusing an unrelated container.');
    return values[0];
  }
  function invoke(mode, {expectFailure = false} = {}) {
    const result = command('/usr/bin/flock', ['--no-fork', '--nonblock', guardLock, process.execPath, guard, '--config', config, mode], {allowFailure: true, timeout: 180_000});
    if (expectFailure) {
      assert.notEqual(result.status, 0, 'The real host recovery CLI must refuse this fixture.');
      const value = JSON.parse(result.stderr.trim());
      assert.equal(value.success, false); assert.equal(value.oldDataRestored, false);
      return value;
    }
    if (result.status !== 0) {
      let code;
      try { code = JSON.parse(result.stderr.trim()).code; } catch {}
      if (code === 'UNTRUSTED_PATH' || code === 'UNTRUSTED_PERMISSIONS' || code === 'UNTRUSTED_DOCKER_PATH') {
        const candidates = new Set();
        for (const guardedPath of [config, record, auditor, guardLock, '/usr/bin/docker', fs.realpathSync('/usr/bin/docker')]) {
          for (let file = guardedPath; ; file = path.dirname(file)) {
            candidates.add(file);
            if (file === '/') break;
          }
        }
        for (const file of candidates) {
          const info = fs.lstatSync(file);
          process.stderr.write(`${file}: uid=${info.uid} mode=${(info.mode & 0o777).toString(8)} nlink=${info.nlink} canonical=${file === fs.realpathSync(file)}\n`);
        }
      }
      throw Error(`Host recovery fixture failed (${/^[A-Z_]+$/.test(code || '') ? code : 'UNKNOWN_FAILURE'}).`);
    }
    const value = JSON.parse(result.stdout.trim()); assert.equal(value.success, true); return value;
  }
  async function healthy() {
    const until = Date.now() + 70_000;
    while (Date.now() < until) {
      const value = inspect();
      if (value.State.Running && value.State.Health?.Status === 'healthy') return value;
      if (!value.State.Running) throw Error('The fictional container stopped during startup.');
      await wait(500);
    }
    throw Error('The fictional accounting container did not become healthy.');
  }
  function archiveFiles() {
    return fs.existsSync(jobs) ? filesBelow(jobs).filter(row => row.name.endsWith('/abandoned-writer-lock.json')) : [];
  }
  function databaseHashes(directory) {
    return DATABASES.map(name => ({name, sha256: sha256(fs.readFileSync(path.join(directory, name)))}));
  }
  function previousBootFixture() {
    const value = JSON.parse(fs.readFileSync(state, 'utf8'));
    const before = fs.lstatSync(path.join(data, '.fibernetlb-web.lock'), {bigint: true});
    const actualBtime = Number(fs.readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)[1]);
    const oldTime = actualBtime - 60;
    // Only this newly created fictional marker and root-owned claim are dated
    // into a previous boot. The production CLI has no test bypass or clock flag.
    fs.utimesSync(path.join(data, '.fibernetlb-web.lock'), oldTime, oldTime);
    const after = fs.lstatSync(path.join(data, '.fibernetlb-web.lock'), {bigint: true});
    assert.equal(after.ino, before.ino, 'KILL and dating preserve the abandoned lock inode.');
    value.boot = {id: '00000000-0000-0000-0000-000000000000', btime: actualBtime - 3600};
    value.lock.mtimeNs = String(after.mtimeNs);
    value.attestedAt = new Date((actualBtime - 120) * 1000).toISOString();
    privateJson(state, value);
    return value;
  }
  function assertStoppedSameContainer(original) {
    const current = inspect();
    assert.equal(current.Id, original.Id); assert.equal(current.Image, builtImage.Id);
    assert.equal(current.State.Running, false); assert.equal(current.State.Restarting, false);
  }
  function refuseUnchanged(expectedCode) {
    const original = inspect(), before = filesBelow(data), archives = archiveFiles();
    const result = invoke('--recover', {expectFailure: true});
    if (expectedCode) assert.equal(result.code, expectedCode);
    assert.deepEqual(filesBelow(data), before, 'A refused recovery must preserve every source byte and inode.');
    assert.deepEqual(archiveFiles(), archives, 'A refused recovery must not archive the writer marker.');
    assertStoppedSameContainer(original);
    return result.code;
  }
  try {
    const {createBackend} = require('../app/core.cjs');
    const {createSecretStorage} = require('../lib/secrets.cjs');
    const bytes = crypto.randomBytes(32);
    fs.writeFileSync(key, bytes, {mode: 0o600}); fs.chownSync(key, 10001, 10001);
    secrets = createSecretStorage(bytes); bytes.fill(0);
    backend = await createBackend({dataDirectory: data, initialize: true, providersEnabled: false, secrets, version});
    const username = 'ci.fictional.owner', password = crypto.randomBytes(32).toString('hex');
    await backend.createOwner({username, password, fullName: 'Fictional Power Recovery CI Owner'});
    const login = await backend.request({channel: 'auth:login', args: [{username, password}], workspaceId: 'main'});
    assert.equal(login.status, 200);
    const opening = await backend.request({channel: 'drawer:setBalance', args: [{balance: 17, note: 'Fictional recovery fixture opening'}], workspaceId: 'main', token: login.data.sessionToken});
    assert.equal(opening.status, 200);
    await backend.close(); backend = null; secrets.destroy(); secrets = null;
    ownTree(data, 10001, 10001);
    assert.equal(fs.readdirSync(path.join(data, 'sections')).filter(file => file.endsWith('.sqlite')).length, 6);

    stage = 'create a fixture-only internal network and production image container';
    docker(['network', 'create', '--internal', '--label', LABEL + '=' + runId, network]); createdNetwork = true;
    createdContainer = true;
    docker(['run', '--detach', '--pull=never', '--name', name, '--label', LABEL + '=' + runId,
      '--network', network, '--restart=no', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--health-interval=1s', '--health-start-period=1s', '--health-retries=5', '--pids-limit', '128',
      '--tmpfs', '/tmp:rw,nosuid,noexec,size=32m,mode=1777', '--mount', `type=bind,source=${data},target=/data`,
      '--mount', `type=bind,source=${key},target=/run/secrets/server-key,readonly`, '--env', 'APP_ORIGIN=https://ci.invalid',
      '--env', 'PROVIDERS_ENABLED=false', IMAGE]);
    const initial = await healthy();
    assert.equal(initial.Config.User, '10001:10001'); assert.equal(initial.Image, builtImage.Id);
    assert.equal(initial.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(Object.keys(initial.NetworkSettings.Networks), [network]);
    assert.equal(Object.values(initial.NetworkSettings.Ports || {}).flat().filter(Boolean).length, 0);
    assert.equal(JSON.parse(docker(['network', 'inspect', network]).stdout)[0].Internal, true);

    stage = 'attest the actual healthy writer through real kernel flock';
    assert.equal(invoke('--attest').action, 'healthy-attested');
    const firstClaim = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert.equal(firstClaim.authority.containerId, initial.Id);
    assert.equal(firstClaim.authority.imageId, builtImage.Id);
    assert.equal(fs.lstatSync(state).uid, 0); assert.equal(fs.lstatSync(state).mode & 0o777, 0o600);
    const lock = path.join(data, '.fibernetlb-web.lock');
    const abandoned = {ino: String(fs.lstatSync(lock, {bigint: true}).ino), bytes: fs.readFileSync(lock)};
    const databases = databaseHashes(data);

    stage = 'simulate loss of only the isolated fixture writer';
    docker(['kill', '--signal=KILL', initial.Id]);
    assertStoppedSameContainer(initial);
    assert.equal(String(fs.lstatSync(lock, {bigint: true}).ino), abandoned.ino);
    assert.deepEqual(fs.readFileSync(lock), abandoned.bytes);
    previousBootFixture();

    stage = 'recover through the genuine privileged CLI and isolated seven-database auditor';
    const recovery = invoke('--recover');
    assert.equal(recovery.action, 'previous-boot-lock-archived-and-started');
    assert.equal(recovery.databasesIntegrityPassed, 7); assert.equal(recovery.pendingFinancialActions, 0);
    assert.equal(recovery.oldDataRestored, false);
    const restarted = await healthy();
    assert.equal(restarted.Id, initial.Id); assert.equal(restarted.Image, initial.Image);
    const archives = archiveFiles(); assert.equal(archives.length, 1);
    assert.equal(archives[0].sha256, sha256(abandoned.bytes));
    assert.equal(archives[0].ino, abandoned.ino, 'The exact old inode was renamed into the private checkpoint.');
    assert.notEqual(sha256(fs.readFileSync(lock)), sha256(abandoned.bytes), 'The sole restarted writer has a new marker.');
    const job = path.join(jobs, archives[0].name.split('/')[0]);
    assert.deepEqual(databaseHashes(path.join(job, 'current-data')), databases, 'The checkpoint preserves the exact seven current databases.');
    const report = JSON.parse(fs.readFileSync(path.join(job, 'reports', 'result.json'), 'utf8'));
    assert.equal(report.databases, 7); assert.equal(report.integrityPassed, true); assert.equal(report.pendingFinancialActions, 0);
    // Normal application startup may re-export SQLite pages. Compare logical
    // records, schema and custody in a fresh copy of the synthetic data.
    const restartedCopy = path.join(directory, 'restarted-copy');
    fs.mkdirSync(path.join(restartedCopy, 'sections'), {recursive: true, mode: 0o700});
    for (const file of [...DATABASES, 'automatic-month-closing.json']) {
      fs.copyFileSync(path.join(data, file), path.join(restartedCopy, file));
    }
    const restartedAudit = await auditCopiedData(restartedCopy, {copiedData: true});
    const contents = ({files}) => files.map(({name, schemaSha256, tables, custody}) => ({name, schemaSha256, tables: {...tables}, custody}));
    assert.deepEqual(contents(restartedAudit), contents(report), 'All seven databases keep their schema, rows and custody after restart.');
    assert.equal(JSON.parse(fs.readFileSync(state, 'utf8')).boot.id, firstClaim.boot.id, 'Recovery re-attests the genuine current boot.');

    stage = 'repeat recovery while healthy without a second checkpoint or restart';
    const beforeHealthy = filesBelow(data), beforeJobs = fs.readdirSync(jobs), beforeState = fs.readFileSync(state);
    assert.equal(invoke('--recover').action, 'healthy-attested');
    assert.deepEqual(filesBelow(data), beforeHealthy); assert.deepEqual(fs.readdirSync(jobs), beforeJobs);
    assert.deepEqual(fs.readFileSync(state), beforeState, 'A current healthy attestation is a no-op.');
    assert.equal(inspect().Id, initial.Id);

    stage = 'refuse foreign prior-boot evidence without a new writer';
    docker(['kill', '--signal=KILL', initial.Id]);
    const prior = previousBootFixture();
    privateJson(state, {...prior, machineIdHash: '0'.repeat(64)});
    refuseUnchanged('ATTESTATION_MISMATCH'); privateJson(state, prior);

    stage = 'refuse corrupt current data without removing the writer marker';
    const mainFile = path.join(data, 'isp-desk.sqlite'), originalMain = fs.readFileSync(mainFile);
    const corrupt = Buffer.from(originalMain); corrupt.fill(0, 0, Math.min(100, corrupt.length)); fs.writeFileSync(mainFile, corrupt);
    const beforeCorruptJobs = new Set(fs.readdirSync(jobs));
    refuseUnchanged('HOST_COMMAND_FAILED');
    const corruptJobs = fs.readdirSync(jobs).filter(value => !beforeCorruptJobs.has(value));
    assert.equal(corruptJobs.length, 1, 'Corrupt data reaches an isolated current-data checkpoint, then its auditor refuses it.');
    assert.equal(fs.existsSync(path.join(jobs, corruptJobs[0], 'reports', 'result.json')), false);
    fs.writeFileSync(mainFile, originalMain);

    stage = 'refuse an actual prepared Maintenance operation in fictional current data';
    const initSqlJs = require('sql.js'), SQL = await initSqlJs();
    const db = new SQL.Database(originalMain);
    try {
      db.run('INSERT INTO shared_maintenance_operations(request_id,workspace_id,actor_key,kind,state,created_at,input_json,instruction_json,instruction_hash,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ['ci-prepared-' + runId, 'main', 'ci.fictional.owner', 'save', 'prepared', new Date().toISOString(), '{}', '{}', sha256('{}'), '{}']);
      fs.writeFileSync(mainFile, Buffer.from(db.export()));
    } finally { db.close(); }
    const beforePendingJobs = new Set(fs.readdirSync(jobs));
    refuseUnchanged('PENDING_FINANCIAL_REVIEW_REQUIRED');
    const pendingJobs = fs.readdirSync(jobs).filter(value => !beforePendingJobs.has(value));
    assert.equal(pendingJobs.length, 1);
    const pendingReport = JSON.parse(fs.readFileSync(path.join(jobs, pendingJobs[0], 'reports', 'result.json'), 'utf8'));
    assert.equal(pendingReport.integrityPassed, true); assert.equal(pendingReport.databases, 7);
    assert.equal(pendingReport.pendingFinancialActions, 1, 'The actual copied-data auditor sees the prepared financial operation.');
    fs.writeFileSync(mainFile, originalMain);

    stage = 'refuse an uncommitted source .pending file';
    const pending = path.join(data, 'ci-uncommitted.sqlite.pending');
    fs.writeFileSync(pending, 'fictional uncommitted bytes', {mode: 0o600}); fs.chownSync(pending, 10001, 10001);
    refuseUnchanged('PENDING_FILE_REQUIRES_REVIEW'); fs.unlinkSync(pending);

  } catch (error) {
    throw Error(`Power-recovery fixture failure at ${stage}: ${String(error.message).slice(0, 600)}`);
  } finally {
    await backend?.close(); secrets?.destroy();
    // Only inspect/delete resources with both our fresh random name and label.
    if (createdContainer) { const value = inspect({optional: true}); if (value) docker(['rm', '--force', value.Id]); }
    if (createdNetwork) {
      const value = JSON.parse(docker(['network', 'inspect', network]).stdout)[0];
      assert.equal(value.Name, network); assert.equal(value.Labels[LABEL], runId);
      docker(['network', 'rm', network]);
    }
    const current = fs.lstatSync(directory, {bigint: true});
    assert.equal(path.dirname(directory), ROOT); assert(path.basename(directory).startsWith(PREFIX));
    assert(current.isDirectory() && !current.isSymbolicLink() && current.uid === 0n);
    assert.equal(current.dev, directoryIdentity.dev); assert.equal(current.ino, directoryIdentity.ino);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), {format: 'FIBERNETLB-CI-POWER-FIXTURE-1', runId});
    fs.rmSync(directory, {recursive: true});
  }
  process.stdout.write('POWER_RECOVERY_LINUX_FIXTURE_PASS: kernel flock, previous-boot recovery, preserved rows and custody in seven databases, and refusal of corrupt or pending writes.\n');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message).slice(0, 1000) + '\n'); process.exitCode = 1; });
module.exports = {argumentsAreFixtureOnly};
