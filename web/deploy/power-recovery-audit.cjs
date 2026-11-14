'use strict';
// Operator-only read of an explicit stopped-data COPY. Never initialize a backend,
// open live data, load secrets, contact a provider or promote a pending file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSql = require('sql.js');
const Finance = require('../app/finance-ledger.cjs');
const Whish = require('../app/whish-destinations.cjs');
const { DATABASES } = require('../app/backup-archive.cjs');

const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_ROWS = 2_000_000;
const HISTORY_TABLES = new Set(['internet_renewal_events', 'internet_plan_events', 'portal_operation_events']);
// These rows are quoted per-cycle cost proofs, not the state of a renewal.
// Its authoritative pending state is in internet_renewals/portal_operations.
// Staff permission reconciliation records a separate access-control review.
const AUXILIARY_STATE_TABLES = new Set(['internet_renewal_costs', 'staff_role_reconciliations']);
const COMPLETE_ONLY = new Set([
  'shared_maintenance_operations', 'funded_stock_purchase_intents',
  'bandwidth_payment_intents', 'fixed_monthly_payment_intents', 'fixed_monthly_payment_attempts',
  'fixed_monthly_reversal_intents', 'fixed_monthly_category_requests',
  'company_debt_business_requests', 'company_debt_payment_intents', 'company_debt_partial_payment_intents'
]);
const COMPLETE_OR_CANCELLED = new Set(['reseller_collections', 'reseller_wallet_reconciliations', 'reseller_admin_wallet_corrections']);
const TERMINAL = new Set(['completed', 'complete', 'succeeded', 'failed', 'cancelled', 'canceled', 'not_applied', 'released', 'reversed', 'voided', 'deleted', 'expired']);
const FORMAT = 'FIBERNETLB-POWER-RECOVERY-AUDIT-1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const quoted = value => '"' + value.replaceAll('"', '""') + '"';
const codeError = code => Object.assign(Error('Power recovery copied-data audit refused.'), { code });
function fail(code) { throw codeError(code); }

function regular(file, maximum = MAX_DATABASE_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum) fail('AUDIT_UNSAFE_COPY_FILE');
  return stat;
}
function directory(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('AUDIT_UNSAFE_COPY_DIRECTORY');
}
function assertCopiedDirectory(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('AUDIT_EXPLICIT_COPY_REQUIRED');
  directory(root); directory(path.join(root, 'sections'));
  if (fs.existsSync(path.join(root, '.fibernetlb-web.lock'))) fail('AUDIT_COPY_HAS_WRITER_LOCK');
  // The guard creates this small copy: canonical databases and the scheduler only.
  // Reject unexpected files, links and crash-pending files rather than interpreting them.
  const allowed = new Set([...DATABASES, 'automatic-month-closing.json']);
  for (const name of fs.readdirSync(root)) {
    if (name === 'sections') continue;
    if (/\.pending(?:$|\.)/i.test(name)) fail('AUDIT_PENDING_FILE_REQUIRES_REVIEW');
    if (!allowed.has(name)) fail('AUDIT_UNEXPECTED_COPY_FILE');
    regular(path.join(root, name), name.endsWith('.json') ? MAX_JOURNAL_BYTES : MAX_DATABASE_BYTES);
  }
  for (const name of fs.readdirSync(path.join(root, 'sections'))) {
    if (/\.pending(?:$|\.)/i.test(name)) fail('AUDIT_PENDING_FILE_REQUIRES_REVIEW');
    if (!allowed.has('sections/' + name)) fail('AUDIT_UNEXPECTED_COPY_FILE');
    regular(path.join(root, 'sections', name));
  }
}
function snapshot(root) {
  let total = 0;
  const files = DATABASES.map(name => {
    const file = path.join(root, name), stat = regular(file);
    if (stat.size < 100) fail('AUDIT_INCOMPLETE_DATABASE_SET');
    total += stat.size;
    if (total > MAX_DATABASE_BYTES) fail('AUDIT_DATABASE_SIZE_LIMIT');
    return { name, length: stat.size, sha256: hash(fs.readFileSync(file)) };
  });
  const scheduler = path.join(root, 'automatic-month-closing.json');
  regular(scheduler, MAX_JOURNAL_BYTES);
  return { files, schedulerSha256: hash(fs.readFileSync(scheduler)) };
}
function verifyUnchanged(root, before) {
  assertCopiedDirectory(root);
  const after = snapshot(root);
  if (JSON.stringify(after) !== JSON.stringify(before)) fail('AUDIT_COPY_CHANGED');
}
function schedulerState(bytes) {
  let envelope;
  try { envelope = JSON.parse(bytes); } catch (_) { fail('AUDIT_INVALID_SCHEDULER'); }
  const value = envelope?.state;
  const month = text => typeof text === 'string' && /^20\d{2}-(?:0[1-9]|1[0-2])$/.test(text);
  const valid = value && value.version === 1 &&
    Object.keys(value).sort().join(',') === 'completedThrough,createdAt,firstMonth,lastAttemptAt,lastError,month,state,version' &&
    month(value.firstMonth) && (!value.completedThrough || month(value.completedThrough) && value.completedThrough >= value.firstMonth) &&
    (!value.month || month(value.month)) && typeof value.createdAt === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value.createdAt) &&
    typeof value.lastAttemptAt === 'string' && typeof value.lastError === 'string' && ['ready', 'running', 'waiting', 'completed'].includes(value.state);
  if (!valid || typeof envelope.sha256 !== 'string' || envelope.sha256 !== hash(JSON.stringify(value))) fail('AUDIT_INVALID_SCHEDULER');
  // A close that was running/waiting at power loss requires its existing operator review.
  if (!['ready', 'completed'].includes(value.state)) fail('AUDIT_PENDING_MONTH_CLOSE');
  return value.state;
}
function exactTotal(values) {
  const total = values.reduce((n, value) => {
    const cents = Math.round(value * 100);
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-6) fail('AUDIT_INVALID_CUSTODY');
    return n + BigInt(cents);
  }, 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) fail('AUDIT_INVALID_CUSTODY');
  return Number(total) / 100;
}
function financeCoveredPending(table, state) {
  if (COMPLETE_ONLY.has(table)) return state !== 'completed';
  if (COMPLETE_OR_CANCELLED.has(table)) return !['completed', 'cancelled'].includes(state);
  if (table === 'reseller_money_journal') return state === 'held';
  if (table === 'portal_operations') return ['checking', 'processing', 'unknown', 'confirmed'].includes(state);
  if (['internet_renewals', 'internet_plan_changes'].includes(table)) return ['checking', 'processing', 'unknown'].includes(state);
  return false;
}
function currentJournalName(table) {
  return COMPLETE_ONLY.has(table) || COMPLETE_OR_CANCELLED.has(table) ||
    /(?:^|_)(?:intents?|requests?|operations?|journals?|renewals?|plan_changes?|collections?|reconciliations?|corrections?|attempts?)(?:_|$)/i.test(table);
}
function pendingCounts(db) {
  const known = Finance.pendingActions(db).length;
  let additional = 0;
  const groups = [];
  for (const { name } of Finance.query(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")) {
    if (HISTORY_TABLES.has(name) || AUXILIARY_STATE_TABLES.has(name) || !currentJournalName(name)) continue;
    const columns = Finance.query(db, 'PRAGMA table_info(' + quoted(name) + ')').map(row => row.name);
    // 'phase' may describe a movement kind (e.g. reserve/release). State is authoritative.
    const column = ['state', 'status', 'phase'].find(value => columns.includes(value));
    if (!column) continue;
    let extra = 0, total = 0;
    const values = Finance.query(db, 'SELECT ' + quoted(column) + ' AS state,COUNT(*) AS count FROM ' + quoted(name) + ' GROUP BY ' + quoted(column));
    if (values.length > 100) fail('AUDIT_INVALID_JOURNAL_STATE');
    for (const value of values) {
      if (typeof value.state !== 'string' || !Number.isSafeInteger(value.count) || value.count < 1) fail('AUDIT_INVALID_JOURNAL_STATE');
      const covered = column === 'state' && financeCoveredPending(name, value.state);
      const unresolved = covered || !TERMINAL.has(value.state);
      if (unresolved) total += value.count;
      if (unresolved && !covered) extra += value.count;
    }
    if (total) groups.push({ table: name, pendingRows: total, additionalRows: extra });
    additional += extra;
  }
  return { financePendingActions: known, additionalPendingRows: additional, pendingFinancialActions: known + additional, pendingTables: groups };
}
function tableHashes(db) {
  const result = Object.create(null);
  for (const { name } of Finance.query(db, "SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name")) {
    const statement = db.prepare('SELECT * FROM ' + quoted(name)), hashes = [];
    try {
      while (statement.step()) {
        if (hashes.length >= MAX_ROWS) fail('AUDIT_ROW_LIMIT');
        hashes.push(hash(JSON.stringify(statement.getAsObject())));
      }
    } finally { statement.free(); }
    hashes.sort();
    result[name] = { rows: hashes.length, sha256: hash(hashes.join('\n')) };
  }
  return result;
}
async function auditCopiedData(root, options = {}) {
  if (options.copiedData !== true) fail('AUDIT_EXPLICIT_COPY_REQUIRED');
  assertCopiedDirectory(root);
  const before = snapshot(root);
  const scheduler = schedulerState(fs.readFileSync(path.join(root, 'automatic-month-closing.json'), 'utf8'));
  const SQL = await initSql({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  let destinations = [], pending = 0;
  const files = [];
  for (const saved of before.files) {
    const bytes = fs.readFileSync(path.join(root, saved.name));
    if (hash(bytes) !== saved.sha256) fail('AUDIT_COPY_CHANGED');
    const db = new SQL.Database(bytes);
    try {
      const integrity = Finance.query(db, 'PRAGMA integrity_check');
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') fail('AUDIT_DATABASE_INTEGRITY');
      const schema = Finance.query(db, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR name='sqlite_sequence' ORDER BY type,name");
      const tables = tableHashes(db), has = name => Object.hasOwn(tables, name) || schema.some(row => row.type === 'view' && row.name === name);
      // Guard against accepting seven newly empty SQLite files as business data.
      for (const name of ['users', 'products', 'sales', 'fibernetlb_bills', 'cash_drawer_transactions', 'finance_wallet_entries']) if (!has(name)) fail('AUDIT_ACCOUNTING_SCHEMA_MISSING');
      if (saved.name === 'isp-desk.sqlite' && has('whish_destinations')) destinations = Whish.listDestinations(db, true);
      const custody = {
        cash: has('active_cash_drawer_transactions') ? exactTotal(Finance.query(db, 'SELECT amount FROM active_cash_drawer_transactions').map(row => row.amount)) : null,
        whish: has('finance_wallet_entries') && has('payment_destinations') ? exactTotal(Finance.walletBalances(db, destinations, null).map(row => row.balance)) : null
      };
      const actions = pendingCounts(db); pending += actions.pendingFinancialActions;
      files.push({ ...saved, schemaSha256: hash(JSON.stringify(schema)), tables, custody, ...actions });
    } finally { db.close(); }
  }
  verifyUnchanged(root, before);
  return { format: FORMAT, privateReport: true, readOnly: true, integrityPassed: true, databases: DATABASES.length, pendingFinancialActions: pending, schedulerState: scheduler, schedulerSha256: before.schedulerSha256, rowHashAlgorithm: 'sha256-of-sorted-row-sha256', files };
}
async function main(args) {
  if (args.length !== 3 || args[0] !== '--inspect' || !path.isAbsolute(args[1]) || !path.isAbsolute(args[2])) fail('AUDIT_INVALID_ARGUMENTS');
  const output = path.resolve(args[2]);
  if (fs.existsSync(output)) fail('AUDIT_REPORT_EXISTS');
  directory(path.dirname(output));
  const copyRoot = fs.realpathSync(args[1]);
  const actualOutput = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  if (actualOutput === copyRoot || actualOutput.startsWith(copyRoot + path.sep)) fail('AUDIT_REPORT_INSIDE_COPY');
  const report = await auditCopiedData(path.resolve(args[1]), { copiedData: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ format: FORMAT, integrityPassed: true, databases: report.databases, pendingFinancialActions: report.pendingFinancialActions, schedulerState: report.schedulerState, readOnly: true }));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const allowed = /^AUDIT_[A-Z_]+$/;
  console.error(JSON.stringify({ ok: false, code: allowed.test(error?.code || '') ? error.code : 'AUDIT_FAILED', customerDataExported: false }));
  process.exitCode = 1;
});
module.exports = { auditCopiedData, pendingCounts, schedulerState, verifyUnchanged, DATABASES, FORMAT, HISTORY_TABLES, currentJournalName };
