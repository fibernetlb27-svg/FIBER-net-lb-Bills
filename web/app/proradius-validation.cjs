'use strict';

const MAX_BYTES = 16 * 1024;
const OPERATIONS = new Set(['checkchangeservice', 'changeservice']);
const FIELDS = ['op', 'username', 'service', 'data.username', 'data.service'];
const MESSAGES = Object.freeze({
  expired_current_period: 'Proradius reported an expired or inactive current subscription period. Review the current service, expiry and transactions before any further action.',
  insufficient_balance: 'Proradius reports insufficient reseller balance for this service change. Review the balance in Proradius.',
  permission: 'Proradius reports that this API account is not permitted to change the service. Ask the Proradius administrator to review its permissions.',
  invalid_service: 'Proradius rejected the selected service for this customer. Refresh the customer and choose an offered service.',
  invalid_fields: 'Proradius rejected the service-change request fields.'
});
const REASONS = [
  ['expired_current_period', /^(?:(?:the )?(?:user|customer|account|subscription|current (?:subscription|service|period)) (?:is (?:already )?expired|has expired|is not active)|(?:cannot|can not) change (?:the )?service (?:for (?:an? )?expired (?:user|customer|account|subscription)|without an active (?:subscription|current period))|(?:please )?renew (?:the )?(?:user|customer|account|subscription|current period) (?:first|before changing (?:the )?service))[.!]?$/i],
  ['insufficient_balance', /^(?:(?:the )?(?:reseller |account )?(?:balance|credit|funds) (?:is |are )?(?:insufficient|not sufficient)|insufficient (?:reseller |account )?(?:balance|credit|funds)|not enough (?:balance|credit|funds))[.!]?$/i],
  ['permission', /^(?:permission denied|(?:you|this account|the api account) (?:do not|does not) have permission to change (?:the )?service|(?:you are|this account is|the api account is) not (?:allowed|permitted|authorized) to change (?:the )?service)[.!]?$/i],
  ['invalid_service', /^(?:invalid service|(?:the )?(?:selected |target )?service (?:is invalid|is not (?:available|allowed|offered)(?: for this (?:user|customer|account))?|does not exist)|(?:this|the selected) service cannot be (?:used|selected) for this (?:user|customer|account))[.!]?$/i],
  ['invalid_fields', /^(?:validation (?:error|failed)|invalid (?:request|input)(?: fields| data)?|(?:the )?(?:request|input) (?:fields|data) (?:are|is) invalid)[.!]?$/i]
];
const FIELD_ERROR = /^(?:this field is required|this field may not be (?:blank|null)|a valid integer is required|(?:not a valid|invalid) (?:integer|string)|invalid (?:value|choice)|select a valid choice)[.!]?$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Persist only these small categories and field names. Provider text, values,
// credentials and HTML are never returned to callers or used as public text.
function publicMessage(metadata) {
  try {
    if (!object(metadata) || Reflect.ownKeys(metadata).length !== 3 ||
        !['operation', 'code', 'fields'].every(key => Object.hasOwn(metadata, key)) ||
        !OPERATIONS.has(metadata.operation) || typeof metadata.code !== 'string' || !Object.hasOwn(MESSAGES, metadata.code) ||
        !Array.isArray(metadata.fields) || metadata.fields.length > FIELDS.length ||
        Array.from(metadata.fields).some(field => !FIELDS.includes(field)) || new Set(metadata.fields).size !== metadata.fields.length) return null;
    return MESSAGES[metadata.code] + (metadata.fields.length ? ` Check: ${metadata.fields.join(', ')}.` : '');
  } catch { return null; }
}

function validationMetadata(payload, operation) {
  if (!object(payload)) return null;
  const wrappers = [payload, object(payload.body) ? payload.body : null].filter(Boolean);
  const fields = new Set();
  let fieldError = false;
  const field = (name, value) => {
    if (!FIELDS.includes(name)) return;
    const messages = Array.isArray(value) ? value : [value];
    if (messages.some(message => typeof message === 'string' && message.length <= 256 && FIELD_ERROR.test(message.trim()))) {
      fields.add(name); fieldError = true;
    }
  };
  for (const wrapper of wrappers) {
    for (const errors of [wrapper, wrapper.errors, wrapper.detail]) {
      if (!object(errors)) continue;
      for (const name of FIELDS) if (Object.hasOwn(errors, name)) field(name, errors[name]);
      if (object(errors.data)) for (const name of ['username', 'service']) if (Object.hasOwn(errors.data, name)) field('data.' + name, errors.data[name]);
    }
  }
  let code = null;
  for (const wrapper of wrappers) {
    for (const key of ['message', 'detail', 'error']) {
      const message = wrapper[key];
      if (typeof message !== 'string' || message.length > 256) continue;
      const reason = REASONS.find(([, pattern]) => pattern.test(message.trim()));
      if (reason) {
        if (code && code !== reason[0]) return null;
        code = reason[0];
      }
    }
  }
  if (!code && fieldError) code = 'invalid_fields';
  if (!code) return null;
  const metadata = {operation, code, fields: FIELDS.filter(name => fields.has(name))};
  return publicMessage(metadata) ? metadata : null;
}

function readChunk(reader, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { void reader.cancel().catch(() => {}); reject(new Error('Provider validation read aborted.')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    reader.read().then(value => { signal?.removeEventListener('abort', abort); resolve(value); }, error => { signal?.removeEventListener('abort', abort); reject(error); });
  });
}

async function readProviderValidation(response, {operation, signal} = {}) {
  if (response?.status !== 422 || !OPERATIONS.has(operation)) return null;
  let reader;
  try {
    const type = response.headers?.get('content-type') || '';
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type) || Number(response.headers?.get('content-length')) > MAX_BYTES) return null;
    reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = []; let size = 0;
    for (;;) {
      const {value, done} = await readChunk(reader, signal);
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(Buffer.from(value));
    }
    if (signal?.aborted) return null;
    return validationMetadata(JSON.parse(Buffer.concat(chunks).toString('utf8')), operation);
  } catch { return null; }
  finally { try { reader?.releaseLock(); } catch {} }
}

module.exports = {publicMessage, readProviderValidation};
