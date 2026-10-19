'use strict';
// Synthetic development fixture ONLY. This is not a replacement for Main PC.
// Never reads a database, settings file, environment secret or provider account.
// It binds exclusively to 127.0.0.1 and rejects every financial write.
const http = require('node:http');
const crypto = require('node:crypto');

const VERSION = '1.43.4';
const FIXTURE_PASSWORD = 'demo-only-123';
const TODAY = '2026-10-19';
const WORKSPACES = Object.freeze([
  { id: 'main', name: 'Main dashboard', kind: 'main' },
  { id: 'fiber-users', name: 'FIBER net lb Users', kind: 'internet' },
  { id: 'fiber-resellers', name: 'FIBER net lb Resellers', kind: 'reseller' },
  { id: 'iptv', name: 'IPTV', kind: 'satellite' },
  { id: 'printer', name: 'Printer', kind: 'printing' },
  { id: 'studio', name: 'Studio', kind: 'studio' },
  { id: 'mobile-ogero', name: 'Mobile and Ogero', kind: 'telecom' },
]);
const COMMON_PERMISSIONS = [
  'dashboard.view', 'products.read', 'products.manage', 'sales.create',
  'reports.view', 'expenses.view', 'customers.manage', 'bills.view',
  'bills.create', 'telecom.view', 'telecom.create', 'debts.view',
  'debts.manage', 'drawer.view', 'drawer.manage', 'plans.manage',
  'resellerFunding.manage', 'network.configure', 'attendance.clock',
];
const USERS = Object.freeze([
  { id: 1, username: 'demo.admin', fullName: 'Demo Administrator', role: 'admin', accountKey: 'main:1',
    allowedSections: [...WORKSPACES.filter(w => w.id !== 'main').map(w => w.id), 'main-expenses', 'main-attendance'],
    permissions: [...COMMON_PERMISSIONS.filter(p => p !== 'resellerFunding.manage'), 'expenses.manage', 'purchases.view', 'purchases.manage', 'users.manage', 'bills.manage', 'bundles.manage'] },
  { id: 2, username: 'demo.cashier', fullName: 'Demo Cashier', role: 'cashier', accountKey: 'main:2',
    allowedSections: WORKSPACES.filter(w => w.id !== 'main').map(w => w.id), permissions: [...COMMON_PERMISSIONS] },
  { id: 3, username: 'demo.support', fullName: 'Demo Support', role: 'support', accountKey: 'main:3',
    allowedSections: ['fiber-users', 'fiber-resellers'], permissions: [...COMMON_PERMISSIONS] },
]);
const READ_CHANNELS = new Set([
  'reports:dashboard', 'finance:overview', 'bills:list', 'portal:search',
  'resellers:accounts', 'resellers:list', 'resellers:portalList', 'resellers:collections',
  'finance:receiptCopies', 'whish:list', 'dashboard:resellerCollections',
]);
const SAFE_LOG_CHANNELS = new Set([...READ_CHANNELS, 'auth:login', 'auth:logout', 'auth:status', 'auth:switch']);
const SYNTHETIC_CUSTOMERS = [
  { username: 'demo.customer01', name: 'Demo Customer One', phone: '00000001', service: 'Demo Fiber 20 Mbps', expiry: '2026-11-19', status: 'Active' },
  { username: 'demo.customer02', name: 'Demo Customer Two', phone: '00000002', service: 'Demo Fiber 40 Mbps', expiry: '2026-10-18', status: 'Expired' },
  { username: 'demo.customer03', name: 'Demo Customer Three', phone: '00000003', service: 'Demo Fiber 20 Mbps', expiry: '2026-11-01', status: 'Active' },
];
const DEMO_WALLET = { id: 'demo-wallet-1', label: 'Demo office wallet', number: '00000000', active: true };
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const clone = value => JSON.parse(JSON.stringify(value));
function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function publicUser(user) { return { ...clone(user), active: true }; }
function canOpen(user, id) { return id === 'main' || user.allowedSections.includes(id); }
function workspace(id) {
  const found = WORKSPACES.find(w => w.id === id);
  if (!found) fail(400, 'Unknown business section.');
  return found;
}

// Amounts are explicitly invented and deterministic, including synthetic dates.
function sectionAmounts(id, user) {
  const scale = user.role === 'admin' ? 1 : user.role === 'cashier' ? 0.6 : 0.2;
  const base = {
    main: [0, 0, 0, 0, 0, 0, 0],
    'fiber-users': [2500, 300, 1250, 12.5, 1600, 30, 0],
    'fiber-resellers': [0, 400, 200, 2, 0, 20, 500],
    iptv: [240, 130, 110, 1.1, 110, 15, 0],
    printer: [180, 150, 30, 0.3, 20, 5, 0],
    studio: [300, 200, 100, 1, 0, 10, 0],
    'mobile-ogero': [400, 350, 50, 0.5, 300, 10, 0],
  }[id];
  return Object.fromEntries(['revenue', 'cash', 'wallets', 'fees', 'cost', 'other', 'bandwidth'].map((key, i) => [key, money(base[i] * scale)]));
}
function bills(user) {
  return [
    { id: 101, receiptNo: 'DEMO-BILL-001', customerAccount: 'demo.customer01', customerName: 'Demo Customer One', phone: '00000001', serviceType: 'Internet', bundleName: 'Demo Fiber 20 Mbps', amount: 25, bundleCost: 17, paymentMethod: 'Cash', paymentStatus: 'paid', paidAt: TODAY + 'T10:30:00', cashierName: 'Demo Cashier', accountKey: 'main:2', renewal: { state: 'succeeded', message: 'Synthetic receipt only.' } },
    { id: 102, receiptNo: 'DEMO-BILL-002', customerAccount: 'demo.customer02', customerName: 'Demo Customer Two', phone: '00000002', serviceType: 'Internet', bundleName: 'Demo Fiber 40 Mbps', amount: 40, bundleCost: 28, paymentMethod: 'Whish Money', paymentStatus: 'paid', paidAt: TODAY + 'T09:20:00', cashierName: 'Demo Support', accountKey: 'main:3', renewal: { state: 'unknown', message: 'Synthetic incomplete renewal; no provider was contacted.' } },
  ].filter(row => user.role === 'admin' || row.accountKey === user.accountKey)
    .map(({ accountKey, ...row }) => row);
}
function overview(id, user, accountKey) {
  const aggregate = id === 'all';
  if (aggregate && user.role !== 'admin') fail(403, 'Only the administrator can view consolidated finances.');
  if (!aggregate && !canOpen(user, id)) fail(403, 'Your administrator has not granted access to this business.');
  if (accountKey && user.role !== 'admin' && accountKey !== user.accountKey) fail(403, 'You can view only your own activity.');
  const selectedUser = accountKey ? USERS.find(u => u.accountKey === accountKey) : user;
  if (!selectedUser) fail(400, 'Choose a valid application employee account.');
  const rows = aggregate ? WORKSPACES.map(w => ({ section: w, overview: overview(w.id, user, accountKey) })) : null;
  const a = aggregate ? Object.fromEntries(['revenue', 'cash', 'wallets', 'fees', 'cost', 'other', 'bandwidth'].map(key => [key, money(rows.reduce((n, row) => n + row.overview.fixtureAmounts[key], 0))])) : sectionAmounts(id, selectedUser);
  const reseller = id === 'fiber-resellers';
  const gross = money(a.revenue - a.cost);
  const beforeOther = aggregate
    ? money(rows.reduce((n, row) => n + row.overview.dashboardTotals.profitBeforeOther, 0))
    : money((reseller ? a.cash + a.wallets - a.bandwidth : gross) - a.fees);
  const afterOther = money(beforeOther - a.other);
  const wallet = { ...DEMO_WALLET, balance: a.wallets, gross: a.wallets, fees: a.fees };
  const recent = !aggregate && id !== 'fiber-users' ? [] : bills(selectedUser).map(row => ({ ...row, invoiceNo: row.receiptNo, createdAt: row.paidAt, subtotal: row.amount, activity: row.serviceType }));
  const dashboard = {
    canViewFinancials: true, activityScope: user.role === 'admin' && !accountKey ? 'all' : 'own',
    todaySales: { value: 0, count: 0 }, todayBills: { value: id === 'fiber-users' ? 65 : 0, count: id === 'fiber-users' ? recent.length : 0 },
    todayTelecom: { value: 0, count: 0 }, todayProfit: { value: 20 }, monthExpenses: { value: money(a.other + a.fees) },
    outstandingDebt: { value: id === 'fiber-users' ? 80 : 0, count: id === 'fiber-users' ? 2 : 0 },
    drawer: { balance: a.cash, todayIn: 25, lastCount: null }, stock: { value: 0, units: 0 },
    lowStock: [], recentSales: [], recentActivity: recent,
    monthInternetCost: id === 'fiber-users' || aggregate ? a.cost : 0,
    monthWhishFees: a.fees, totalWhishWallets: a.wallets,
  };
  const report = {
    revenue: a.revenue, posRevenue: 0, serviceRevenue: a.revenue,
    serviceCost: a.cost, costOfGoods: a.cost, grossProfit: gross,
    expenses: money(a.other + a.fees), whishFees: a.fees,
    netProfit: money(gross - a.fees - a.other), installationIncome: 0,
    daily: [{ day: TODAY, revenue: a.revenue, profit: gross }], recentSales: [],
    profitParts: [{ id: 'internet', name: 'Internet', revenue: id === 'fiber-users' ? a.revenue : 0, cost: id === 'fiber-users' ? a.cost : 0, profit: id === 'fiber-users' ? gross : 0 }],
    reportCurrency: 'USD', exchangeRate: 89500,
  };
  return {
    workspaceId: id, workspaceName: aggregate ? 'All businesses' : workspace(id).name,
    aggregate, readOnly: aggregate, admin: user.role === 'admin',
    accountKey: user.role === 'admin' && !accountKey ? null : selectedUser.accountKey,
    employeeName: user.role === 'admin' && !accountKey ? 'All employees' : selectedUser.fullName,
    employees: (user.role === 'admin' ? USERS : [user]).map(publicUser), recipients: [],
    costSettlement: null, costRecipient: null, costRecipientKey: '', whishCorrection: null,
    whishFeePolicy: { policy: 'profit_only', additionalCashoutFee: 0, deferred: false, warnings: [], reason: '' },
    wallets: [wallet], whishFees: a.fees, serviceCost: a.cost,
    internetCost: id === 'fiber-users' || aggregate ? a.cost : 0,
    bandwidthCost: { incurredCost: a.bandwidth, paid: 0, outstanding: a.bandwidth },
    bandwidthSpending: { paid: 0, pendingCount: 0 },
    dashboardTotals: { basis: aggregate ? 'business_sum' : 'independent_business', cash: a.cash, wallets: a.wallets, whishFees: a.fees, otherExpenses: a.other, profitBeforeOther: beforeOther, profitAfterOther: afterOther, profitKnown: true, pendingCount: 0 },
    history: [], months: [], lastClosedMonth: '', today: TODAY, dashboard, report,
    ...(aggregate ? { businesses: rows.map(row => ({ workspaceId: row.section.id, workspaceName: row.section.name, dashboardTotals: row.overview.dashboardTotals })) } : {}),
    fixtureAmounts: a,
  };
}
function resellers(user) {
  const scale = user.role === 'admin' ? 1 : user.role === 'cashier' ? 0.6 : 0.2;
  const accounts = [
    { id: 6, username: 'fibernetlb2', name: 'Demo representative reseller', balance: -240, added: 198, cash: 0, whish: 198, collected: 0, pending: 200 },
    { id: 22, username: 'demo.reseller', name: 'Demo reseller', balance: 135.5, added: 100, cash: 100, whish: 0, collected: 50, pending: 50 },
  ].map(({ added, cash, whish, collected, pending, ...row }) => ({
    ...row, localId: row.id, active: true, balanceRead: true, balanceAvailable: true,
    moneyAdded: money(added * scale), moneyRefunded: 0, moneyCollected: money(collected * scale), pendingToCollect: money(pending * scale),
    paymentTotals: { added: money(added * scale), refunded: 0, cashAdded: money(cash * scale), whishAdded: money(whish * scale), whishFees: money((row.id === 6 ? 2 : 0) * scale), grossWhishAdded: money((row.id === 6 ? 200 : 0) * scale), net: money(added * scale) },
  }));
  return {
    accounts, canManage: ['cashier', 'support'].includes(user.role),
    chargeError: '', recipientError: '', receiver: { accountKey: 'main:1', name: 'Demo Administrator' },
    opening: '2026-10-01T00:00:00',
    totals: { added: money(298 * scale), cashAdded: money(100 * scale), whishAdded: money(198 * scale), grossWhishAdded: money(200 * scale), refunded: 0, whishFees: money(2 * scale), net: money(298 * scale) },
    history: [], refundable: [], custodians: [], userCustodians: [], sources: [],
    collectionTotals: { moneyCollected: money(50 * scale), pendingToCollect: money(250 * scale) },
    note: 'Synthetic demonstration only. Provider balances are invented; no Proradius or Whish connection. Mobile first build is read-only.',
  };
}
function readChannel(channel, args, session) {
  const { user, workspaceId } = session;
  if (channel === 'finance:overview') {
    const input = args[0] ?? {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Choose valid finance request options.');
    return overview(input.workspaceId || workspaceId, user, input.accountKey);
  }
  if (channel === 'reports:dashboard') return overview(workspaceId, user).dashboard;
  if (channel === 'whish:list') return [DEMO_WALLET];
  if (channel === 'dashboard:resellerCollections') {
    if (workspaceId !== 'main') fail(403, 'Open Main dashboard for collection cards.');
    if (user.role !== 'cashier') return { available: false, scope: 'own', includesRepresentative: true, reason: 'These cards are for Cashier accounts.' };
    return { available: true, scope: 'own', accountKey: user.accountKey, includesRepresentative: true, fibernetlb2: { pendingToCollect: 120, moneyAdded: 118.8, moneyCollected: 0 }, all: { pendingToCollect: 150, moneyAdded: 178.8, moneyCollected: 30 } };
  }
  if (channel.startsWith('resellers:')) {
    if (workspaceId !== 'fiber-resellers') fail(403, 'Open FIBER net lb Resellers first.');
    const result = resellers(user);
    if (channel === 'resellers:accounts') return result;
    if (channel === 'resellers:list') return result.accounts.map(row => ({ id: row.localId, username: row.username, fullName: row.name, phone: '', active: true }));
    if (channel === 'resellers:portalList') return result.accounts;
    if (channel === 'resellers:collections') return [];
  }
  if (channel === 'finance:receiptCopies') {
    if (workspaceId !== 'fiber-users') fail(403, 'Receipt copies belong to FIBER net lb Users.');
    const key = args[0]?.accountKey;
    if (key && key !== user.accountKey && user.role !== 'admin') fail(403, 'You can view only your own receipt copies.');
    return [];
  }
  if (channel === 'bills:list') {
    if (workspaceId !== 'fiber-users') return [];
    const [start, end] = args;
    if (!validDay(start) || !validDay(end) || start > end) fail(400, 'Choose a valid bill date range.');
    return bills(user).filter(row => row.paidAt.slice(0, 10) >= start && row.paidAt.slice(0, 10) <= end);
  }
  if (channel === 'portal:search') {
    if (workspaceId !== 'fiber-users') fail(403, 'Open FIBER net lb Users first.');
    if (typeof args[0] !== 'string' || args[0].length < 2 || args[0].length > 100) fail(400, 'Enter at least two search characters.');
    const term = args[0].toLowerCase();
    const customers = SYNTHETIC_CUSTOMERS.filter(row => [row.username, row.name, row.phone].some(value => value.toLowerCase().includes(term)));
    return { customers, total: customers.length };
  }
  fail(404, 'Unknown application request.');
}

function createFixture({ port = 33345, now = () => Date.now(), maxAgeMs = 30 * 60 * 1000 } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw Error('Choose a valid fixture port.');
  const sessions = new Map(), requestLog = [];
  function sessionFor(request) {
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(request.headers.authorization || '');
    const token = match?.[1];
    const found = token && sessions.get(token);
    if (!found || now() - found.lastSeen > maxAgeMs) { if (token) sessions.delete(token); return null; }
    found.lastSeen = now();
    return { ...found, token };
  }
  function issue(user, workspaceId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user, workspaceId, lastSeen: now() });
    return { user: publicUser(user), sessionToken: token };
  }
  const server = http.createServer(async (request, response) => {
    let channel = '', requestedWorkspace = '', status = 500;
    const send = (code, value) => {
      status = code;
      response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const origin = request.headers.origin;
      if (origin) {
        let url; try { url = new URL(origin); } catch { fail(403, 'Only a local development origin can use the fixture.'); }
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) fail(403, 'Only a local development origin can use the fixture.');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Version');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (request.method === 'OPTIONS') { status = 204; response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && request.url === '/health') return send(200, { app: 'ISP Desk POS', version: VERSION, needsSetup: false, fixture: true });
      if (request.method !== 'POST' || request.url !== '/rpc') return send(404, { error: 'Not found.' });
      if (request.headers['x-client-version'] !== VERSION) return send(409, { error: 'The synthetic Main PC is version ' + VERSION + '. Update the client before continuing.' });
      let buffer = '';
      for await (const chunk of request) { buffer += chunk; if (Buffer.byteLength(buffer) > 65536) fail(413, 'Request too large.'); }
      let body; try { body = JSON.parse(buffer); } catch { fail(400, 'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.channel !== 'string' || !Array.isArray(body.args)) fail(400, 'Invalid request.');
      channel = body.channel;
      // The log never stores bodies, passwords, tokens, query text or identities.
      if (!/^[a-zA-Z]+:[a-zA-Z]+$/.test(channel)) fail(400, 'Invalid request channel.');
      requestedWorkspace = body.workspaceId || 'main';
      workspace(requestedWorkspace);
      const session = sessionFor(request);
      if (channel === 'auth:status') return send(200, { data: { needsSetup: false, user: session?.workspaceId === requestedWorkspace ? publicUser(session.user) : null } });
      if (channel === 'auth:login') {
        const input = body.args[0];
        const user = USERS.find(row => row.username === String(input?.username || '').trim().toLowerCase());
        if (!user || input?.password !== FIXTURE_PASSWORD) fail(400, 'Incorrect username or password.');
        if (!canOpen(user, requestedWorkspace)) fail(403, 'Your administrator has not granted an active login for this section.');
        return send(200, { data: issue(user, requestedWorkspace) });
      }
      if (channel === 'auth:logout') { if (session) sessions.delete(session.token); return send(200, { data: { ok: true } }); }
      if (!session) fail(401, 'Your session ended. Please sign in again.');
      if (requestedWorkspace !== session.workspaceId) fail(403, 'This session belongs to another business section. Sign in to that section first.');
      if (channel === 'auth:switch') {
        const target = body.args[0]; workspace(target);
        if (!canOpen(session.user, target)) fail(403, 'Your administrator has not granted an active login for this section.');
        // Match Main: old token remains scoped to its original business.
        return send(200, { data: issue(session.user, target) });
      }
      if (!READ_CHANNELS.has(channel)) fail(403, 'Read-only synthetic fixture: no payments, renewals, account changes or other mutations are implemented. Nothing was sent.');
      return send(200, { data: readChannel(channel, body.args, session) });
    } catch (error) { if (!response.headersSent) send(error.status || 400, { error: error.message || 'Request failed.' }); }
    finally {
      requestLog.push(Object.freeze({ method: request.method, path: request.url === '/rpc' ? '/rpc' : request.url === '/health' ? '/health' : '/unknown', channel: SAFE_LOG_CHANNELS.has(channel) ? channel : channel ? '[blocked]' : '', workspaceId: typeof requestedWorkspace === 'string' && WORKSPACES.some(w => w.id === requestedWorkspace) ? requestedWorkspace : '', status }));
      if (requestLog.length > 200) requestLog.shift();
    }
  });
  return {
    server, requestLog,
    async start() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return 'http://127.0.0.1:' + server.address().port; },
    async close() { sessions.clear(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
module.exports = { createFixture, VERSION, WORKSPACES, FIXTURE_PASSWORD };
if (require.main === module) {
  const rawPort = process.argv.find(arg => arg.startsWith('--port='));
  const port = rawPort ? Number(rawPort.slice(7)) : 33345;
  const fixture = createFixture({ port });
  fixture.start().then(url => {
    console.log('Synthetic mobile fixture at ' + url + ' (loopback only; no live data or financial writes).');
    console.log('Demo users: demo.admin / demo.cashier / demo.support. Demo password: ' + FIXTURE_PASSWORD);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => fixture.close().then(() => process.exit(0)));
}
