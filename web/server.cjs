'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {PUBLIC_RPC_CHANNELS, ADMIN_HOST_CHANNELS} = require('./lib/rpc-channels.cjs');

const COOKIE = 'fibernetlb_session';
const WORKSPACES = new Set(['main', 'fiber-users', 'fiber-resellers', 'iptv', 'printer', 'studio', 'mobile-ogero']);
const MIME = Object.freeze({'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2'});
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const random = () => crypto.randomBytes(32).toString('hex');

function publicOrigin(value, demo) {
  let url;
  try { url = new URL(value); } catch { throw Error('APP_ORIGIN must be an explicit HTTPS origin.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw Error('APP_ORIGIN must contain only the website scheme and host.');
  if (url.protocol !== 'https:' && !(demo && LOOPBACK.has(url.hostname))) throw Error('HTTPS is required except for an explicit loopback demonstration.');
  return url;
}

class WindowLimiter {
  constructor({limit, windowMs, maxKeys = 20000, now}) { Object.assign(this, {limit, windowMs, maxKeys, now}); this.rows = new Map(); }
  take(key) {
    const now = this.now();
    let row = this.rows.get(key);
    if (!row || row.until <= now) {
      if (this.rows.size >= this.maxKeys) this.prune(now);
      if (!row && this.rows.size >= this.maxKeys) return false;
      row = {until: now + this.windowMs, count: 0}; this.rows.set(key, row);
    }
    return ++row.count <= this.limit;
  }
  prune(now = this.now()) { for (const [key, row] of this.rows) if (row.until <= now) this.rows.delete(key); }
}

function safeMessage(error, status) {
  const value = typeof error === 'string' ? error : '';
  if (status >= 500 || !value || value.length > 700 || /[\r\n\0]|[A-Za-z]:[\\/]|\/(?:home|var|etc|usr|tmp|run|opt|root|private)\//.test(value)) return 'The request could not be completed. Check its saved result before repeating a change.';
  return value;
}

function createServer(options = {}) {
  const {backend, demo = false, now = Date.now} = options;
  if (!backend || typeof backend.request !== 'function' || typeof backend.metadata !== 'function') throw Error('A configured accounting backend is required.');
  const origin = publicOrigin(options.origin, demo);
  const secure = options.secureCookies === undefined ? origin.protocol === 'https:' : options.secureCookies;
  if (!secure && !(demo && origin.protocol === 'http:' && LOOPBACK.has(origin.hostname))) throw Error('Production sessions require Secure cookies.');
  const idleMs = options.idleMs ?? 30 * 60 * 1000;
  const absoluteMs = options.absoluteMs ?? 12 * 60 * 60 * 1000;
  const anonymousMs = options.anonymousMs ?? 15 * 60 * 1000;
  const maxSessions = options.maxSessions ?? 2000;
  const maxConcurrent = options.maxConcurrent ?? 64;
  for (const value of [idleMs, absoluteMs, anonymousMs, maxSessions, maxConcurrent]) if (!Number.isSafeInteger(value) || value <= 0) throw Error('Session and request limits must be positive integers.');
  const sessions = new Map();
  const limits = options.limits || {};
  const limiter = (key, limit, windowMs) => new WindowLimiter({limit: limits[key] ?? limit, windowMs, now});
  const requestLimit = limiter('requestsPerAddress', 600, 60_000);
  const globalLimit = limiter('requestsGlobal', 6000, 60_000);
  const staticAddress = limiter('staticPerAddress', 6000, 60_000);
  const staticGlobal = limiter('staticGlobal', 60000, 60_000);
  const loginAddress = limiter('loginsPerAddress', 10, 15 * 60_000);
  const loginAccount = limiter('loginsPerAccount', 10, 15 * 60_000);
  const loginGlobal = limiter('loginsGlobal', 100, 15 * 60_000);
  const trustedProxies = new Set(options.trustedProxies || []);
  const sourceRoot = path.resolve(options.staticDirectory || path.join(__dirname, 'app', 'src'));
  const staticFiles = new Map();
  for (const item of fs.readdirSync(sourceRoot, {withFileTypes: true})) {
    const extension = path.extname(item.name);
    if (!item.isFile() || !MIME[extension] || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.name)) continue;
    const file = path.join(sourceRoot, item.name);
    if (fs.lstatSync(file).isSymbolicLink()) continue;
    staticFiles.set(`/${item.name}`, {file, type: MIME[extension], html: extension === '.html'});
  }
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", ...(secure ? ['upgrade-insecure-requests'] : [])].join('; ');
  let concurrent = 0;

  function headers(response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function json(response, status, value) {
    if (response.destroyed || response.writableEnded) return;
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(value));
  }
  function fail(response, status, message) { json(response, status, {error: message}); }
  function cookie(response, id) { response.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`); }
  function cookieId(request) {
    const values = String(request.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return '';
    const id = values[0].slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(id) ? id : '';
  }
  async function revoke(session) {
    const tokens = [...session.tokens]; session.tokens.clear();
    await Promise.allSettled(tokens.map(([workspaceId, token]) => backend.request({channel: 'auth:logout', args: [], workspaceId, token})));
  }
  function expired(session, time) {
    return time - session.lastSeen >= idleMs || time - session.createdAt >= absoluteMs || !session.tokens.size && time - session.createdAt >= anonymousMs;
  }
  function prune() {
    const time = now();
    for (const [id, session] of sessions) if (expired(session, time)) { sessions.delete(id); void revoke(session); }
    for (const value of [requestLimit, globalLimit, staticAddress, staticGlobal, loginAddress, loginAccount, loginGlobal]) value.prune();
  }
  function sessionFor(request, response, create = false) {
    const id = cookieId(request);
    let session = sessions.get(id);
    if (session && expired(session, now())) { sessions.delete(id); void revoke(session); session = null; }
    if (!session && create) {
      if (sessions.size >= maxSessions) prune();
      if (sessions.size >= maxSessions) return null;
      const time = now();
      session = {id: random(), csrf: random(), createdAt: time, lastSeen: time, tokens: new Map(), authBusy: false};
      sessions.set(session.id, session); cookie(response, session.id);
    }
    if (session) session.lastSeen = now();
    return session;
  }
  function rotate(session, response) { sessions.delete(session.id); session.id = random(); sessions.set(session.id, session); cookie(response, session.id); }
  function csrfValid(request, session) {
    const supplied = request.headers['x-csrf-token'];
    return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf));
  }
  function address(request) {
    const remote = request.socket.remoteAddress || 'unknown';
    if (!trustedProxies.has(remote)) return remote;
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
    return net.isIP(forwarded) ? forwarded : remote;
  }
  function validWorkspace(value) { return typeof value === 'string' && WORKSPACES.has(value); }
  async function body(request) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers['content-type'] || ''))) throw Object.assign(Error('Send a JSON request.'), {status: 415});
    return new Promise((resolve, reject) => {
      let size = 0, failed = false; const chunks = [];
      request.on('data', chunk => {
        if (failed) return;
        size += chunk.length;
        if (size > (options.maxBodyBytes ?? 1_048_576)) { failed = true; chunks.length = 0; return reject(Object.assign(Error('The request is too large.'), {status: 413})); }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (failed) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(Object.assign(Error('The JSON request is invalid.'), {status: 400})); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return reject(Object.assign(Error('The JSON request is invalid.'), {status: 400}));
        resolve(value);
      });
      request.on('error', () => reject(Object.assign(Error('The request was interrupted.'), {status: 400})));
      request.on('aborted', () => reject(Object.assign(Error('The request was interrupted.'), {status: 400})));
    });
  }
  async function currentUser(session, workspaceId) {
    const token = session.tokens.get(workspaceId);
    if (!token) return null;
    const result = await backend.request({channel: 'auth:status', args: [], workspaceId, token});
    if (result.status >= 400 || !result.data?.user) { session.tokens.delete(workspaceId); return null; }
    return result.data.user;
  }
  function metadata(workspaceId) {
    return Promise.resolve(backend.metadata(workspaceId)).then(value => {
      // Expose the declared browser metadata only; never host paths or settings.
      const source = value || {};
      return {version: source.version || options.version || '0.1.0', section: source.section, sections: source.sections, areas: source.areas, needsSetup: Boolean(source.needsSetup), demo: Boolean(demo), capabilities: {browserPrinting: true, csvDownload: true, nativePrinters: false, nativePrinting: false, nativeUpdates: false, backups: true, portalSettings: true, backupRestore: 'operator', hostAdministration: true, providerActions: Boolean(source.providersEnabled)}};
    });
  }

  const server = http.createServer(async (request, response) => {
    headers(response);
    if (String(request.headers.host || '').toLowerCase() !== origin.host.toLowerCase()) return fail(response, 421, 'This request does not match the configured website.');
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) return fail(response, 400, 'Invalid request address.');
    let url;
    try { url = new URL(request.url, origin); } catch { return fail(response, 400, 'Invalid request address.'); }
    if (url.origin !== origin.origin) return fail(response, 400, 'Invalid request address.');
    const clientAddress = address(request);
    const apiRequest = url.pathname.startsWith('/api/') || url.pathname === '/health';
    const withinBudget = apiRequest ? globalLimit.take('all') && requestLimit.take(clientAddress) : staticGlobal.take('all') && staticAddress.take(clientAddress);
    if (!withinBudget) { response.setHeader('Retry-After', '60'); return fail(response, 429, 'Too many requests. Wait before continuing; do not repeat an uncertain financial change.'); }
    if (concurrent >= maxConcurrent) return fail(response, 503, 'The server is busy. Check saved results before repeating a change.');
    concurrent++;
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, {data: {ready: true, demo: Boolean(demo)}});
      if (url.pathname.startsWith('/api/')) {
        if (request.headers.origin && request.headers.origin !== origin.origin) return fail(response, 403, 'This request must come from the configured website.');
        const queryKeys = [...url.searchParams.keys()];
        if (queryKeys.some(key => key !== 'workspaceId') || url.searchParams.getAll('workspaceId').length > 1) return fail(response, 400, 'Choose exactly one business section.');
        const workspaceId = url.searchParams.get('workspaceId') || 'main';
        if (!validWorkspace(workspaceId)) return fail(response, 400, 'Choose a valid business section.');
        if (request.method === 'GET' && url.pathname === '/api/meta') return json(response, 200, {data: await metadata(workspaceId)});
        if (request.method === 'GET' && url.pathname === '/api/session') {
          const session = sessionFor(request, response, true);
          if (!session) return fail(response, 503, 'The server has reached its session limit. Try again later.');
          const [user, meta] = await Promise.all([currentUser(session, workspaceId), metadata(workspaceId)]);
          return json(response, 200, {data: {user, csrfToken: session.csrf, version: meta.version, workspaceId, needsSetup: meta.needsSetup, demo: Boolean(demo)}});
        }
        if (request.method !== 'POST' || url.pathname !== '/api/rpc') return fail(response, 404, 'Not found.');
        if (request.headers.origin !== origin.origin) return fail(response, 403, 'This request must come from the configured website.');
        const session = sessionFor(request, response);
        if (!session || !csrfValid(request, session)) return fail(response, 403, 'Your website session changed. Refresh before continuing; check saved results before repeating a change.');
        const input = await body(request);
        if (Object.keys(input).some(key => !['channel', 'args', 'workspaceId'].includes(key)) || typeof input.channel !== 'string' || !PUBLIC_RPC_CHANNELS.has(input.channel) || !Array.isArray(input.args) || input.args.length > 20 || !validWorkspace(input.workspaceId)) return fail(response, 400, 'This browser request is not supported.');
        const {channel, args} = input, section = input.workspaceId;
        const expectedVersion = (await metadata(section)).version;
        if (request.headers['x-app-version'] !== expectedVersion) return json(response, 409, {error: 'This page belongs to another website version. Check saved or pending results, then reload before continuing. No action was submitted and no request was retried.', code: 'APP_VERSION_MISMATCH', version: expectedVersion});
        const token = session.tokens.get(section) || '';
        if (!token && !['auth:login', 'auth:status', 'auth:logout'].includes(channel)) return fail(response, 401, 'Sign in to this business section.');
        if (ADMIN_HOST_CHANNELS.has(channel) && (section !== 'main' || (await currentUser(session, section))?.role !== 'admin')) return fail(response, 403, 'Only the active Main administrator can manage server settings.');
        const isAuth = ['auth:login', 'auth:switch', 'auth:logout'].includes(channel);
        if (isAuth && session.authBusy) return fail(response, 409, 'A sign-in change is already running. Wait for it to finish.');
        if (channel === 'auth:login') {
          const account = crypto.createHash('sha256').update(String(args[0]?.username || '').trim().toLowerCase()).digest('hex');
          if (!loginGlobal.take('all') || !loginAddress.take(clientAddress) || !loginAccount.take(account)) { response.setHeader('Retry-After', '900'); return fail(response, 429, 'Too many sign-in attempts. Wait before trying again.'); }
          if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || typeof args[0].username !== 'string' || typeof args[0].password !== 'string' || args[0].username.length > 120 || args[0].password.length > 256) return fail(response, 400, 'Enter a valid username and password.');
        }
        if (channel === 'auth:switch' && (args.length !== 1 || !validWorkspace(args[0]))) return fail(response, 400, 'Choose a valid business section.');
        if (isAuth) session.authBusy = true;
        try {
          // Exactly one backend request: transport failures never replay writes.
          const result = await backend.request({channel, args, workspaceId: section, token});
          const status = Number.isInteger(result?.status) && result.status >= 200 && result.status <= 599 ? result.status : 500;
          if (status >= 400 || result.error) {
            if (status === 401) session.tokens.delete(section);
            return fail(response, status >= 400 ? status : 400, safeMessage(result.error, status));
          }
          if (channel === 'auth:login' || channel === 'auth:switch') {
            if (!result.data?.user || !/^[a-f0-9]{64}$/.test(result.data?.sessionToken || '')) return fail(response, 502, 'The sign-in result could not be verified.');
            const target = channel === 'auth:switch' ? args[0] : section;
            const previous = session.tokens.get(target);
            session.tokens.set(target, result.data.sessionToken);
            if (previous && previous !== result.data.sessionToken) await backend.request({channel: 'auth:logout', args: [], workspaceId: target, token: previous}).catch(() => {});
            if (!sessions.has(session.id)) { await revoke(session); return fail(response, 401, 'Your website session expired. Sign in again.'); }
            rotate(session, response);
            return json(response, 200, {data: result.data.user});
          }
          if (channel === 'auth:logout') session.tokens.delete(section);
          if (status === 401) session.tokens.delete(section);
          return json(response, status, {data: result.data});
        } finally { if (isAuth) session.authBusy = false; }
      }
      if (!['GET', 'HEAD'].includes(request.method)) return fail(response, 405, 'Method not allowed.');
      const resource = staticFiles.get(url.pathname === '/' ? '/index.html' : url.pathname);
      if (!resource) return fail(response, 404, 'Not found.');
      const stat = fs.lstatSync(resource.file);
      if (!stat.isFile() || stat.isSymbolicLink()) return fail(response, 404, 'Not found.');
      response.setHeader('Content-Type', resource.type);
      if (!resource.html) {
        if (!resource.etag || resource.size !== stat.size || resource.modified !== stat.mtimeMs) {
          resource.etag = `"${crypto.createHash('sha256').update(fs.readFileSync(resource.file)).digest('hex')}"`;
          resource.size = stat.size; resource.modified = stat.mtimeMs;
        }
        response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        response.setHeader('ETag', resource.etag);
        if (String(request.headers['if-none-match'] || '').split(',').some(tag => tag.trim().replace(/^W\//, '') === resource.etag)) { response.statusCode = 304; return response.end(); }
      }
      response.setHeader('Content-Length', stat.size);
      if (request.method === 'HEAD') return response.end();
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(resource.file);
        stream.on('error', reject); response.on('close', resolve); stream.on('end', resolve); stream.pipe(response);
      });
    } catch (error) {
      if (response.headersSent) response.destroy();
      else fail(response, error.status || 500, safeMessage(error.status ? error.message : '', error.status || 500));
    } finally { concurrent--; }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  server.timeout = 660_000;
  server.maxHeadersCount = 64;
  const timer = setInterval(prune, 60_000); timer.unref();
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('close', () => { clearInterval(timer); for (const session of sessions.values()) void revoke(session); sessions.clear(); });
  return server;
}

async function startFromEnvironment(environment = process.env) {
  process.umask(0o077);
  const {assertCompleteDataDirectory} = require('./lib/storage.cjs');
  const {loadSecretStorage} = require('./lib/secrets.cjs');
  const origin = publicOrigin(environment.APP_ORIGIN, false);
  const directory = assertCompleteDataDirectory(environment.DATA_DIRECTORY);
  const packageRoot = path.resolve(__dirname);
  const inside = (candidate, root) => { const relative = path.relative(root, candidate); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
  if (inside(directory, packageRoot)) throw Error('Production data must be outside the application package.');
  if (!path.isAbsolute(environment.SECRETS_KEY_FILE || '')) throw Error('SECRETS_KEY_FILE must be an explicit absolute private file.');
  const keyFile = path.resolve(environment.SECRETS_KEY_FILE);
  if (inside(keyFile, packageRoot) || inside(keyFile, directory)) throw Error('The server key must be outside both the package and data directory.');
  let secrets, backend, server;
  try {
    secrets = loadSecretStorage(keyFile);
    const {createBackend} = require('./app/core.cjs');
    backend = await createBackend({dataDirectory: directory, version: require('./package.json').version, secrets, initialize: false, providersEnabled: environment.PROVIDERS_ENABLED === 'true'});
    const trustedProxies = String(environment.TRUSTED_PROXY_ADDRESSES || '').split(',').map(value => value.trim()).filter(Boolean);
    if (trustedProxies.some(value => !net.isIP(value))) throw Error('Trusted proxy addresses must be explicit IP addresses.');
    server = createServer({backend, origin: origin.origin, trustedProxies});
    const port = Number(environment.PORT || 3000), host = environment.BIND_ADDRESS || '127.0.0.1';
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !net.isIP(host)) throw Error('Choose a valid bind address and port.');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      await new Promise(resolve => server.close(resolve));
      await backend.close(); secrets.destroy();
    };
    const shutdown = () => { void stop().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    return {server, backend, stop};
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await backend?.close(); secrets?.destroy(); throw error;
  }
}

if (require.main === module) {
  startFromEnvironment().then(() => process.stdout.write('FIBER net lb website is listening.\n')).catch(() => {
    process.stderr.write('Website startup refused. Check the explicit HTTPS origin, seven private database files, separate key, permissions and writer lock. No empty database was created.\n');
    process.exitCode = 1;
  });
}

module.exports = {createServer, startFromEnvironment, publicOrigin, safeMessage};
