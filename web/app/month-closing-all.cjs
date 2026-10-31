'use strict';
// A batch is a reviewed set of the existing per-business atomic closes. There
// is deliberately no second money journal or parent transaction: recovery must
// retain this exact input and verify the original durable child requests.
const crypto = require('node:crypto');
const Finance = require('./finance-ledger.cjs');
const Core = require('./month-closing.cjs');
const {WORKSPACES} = require('./workspaces.cjs');
const BASIS = 'all_business_month_close', MODE = 'carry_forward';
const q = Finance.query, clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw Error('Choose valid All businesses month-close details; unsupported fields were rejected.');
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value)) throw Error('Use a valid unique All businesses month-close request ID.');
  return value;
}
function token(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Review every business before closing the month.');
  return value;
}
function text(value) { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value); }
function allocations(value = []) {
  if (!Array.isArray(value) || value.length > 200) throw Error('Choose valid Bank allocations for each business.');
  const seen = new Set();
  return value.map(row => {
    object(row, ['holderAccountKey', 'method', 'walletId', 'amount'], ['holderAccountKey', 'method', 'amount']);
    const walletId = row.walletId ?? '', amount = Number(row.amount), cents = Math.round(amount * 100);
    if (!text(row.holderAccountKey) || !['cash', 'whish'].includes(row.method) || typeof walletId !== 'string' || walletId.length > 200 || /[\u0000-\u001f\u007f]/.test(walletId) || row.method === 'cash' && walletId !== '' || row.method === 'whish' && !walletId || !['number', 'string'].includes(typeof row.amount) || typeof row.amount === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(row.amount.trim()) || !Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount * 100 - cents) > 1e-6) throw Error('Choose exact positive USD amounts and valid cash or Whish sources.');
    const out = {holderAccountKey:row.holderAccountKey, method:row.method, walletId, amount:cents / 100}, key = JSON.stringify([out.holderAccountKey, out.method, out.walletId]);
    if (seen.has(key)) throw Error('Each business drawer or wallet may be allocated only once.');
    seen.add(key); return out;
  }).sort((a, b) => JSON.stringify([a.holderAccountKey, a.method, a.walletId]).localeCompare(JSON.stringify([b.holderAccountKey, b.method, b.walletId])));
}
function membership(rows) {
  if (!Array.isArray(rows) || rows.length !== WORKSPACES.length || new Set(rows.map(row => row?.workspaceId)).size !== WORKSPACES.length || WORKSPACES.some(section => !rows.some(row => row?.workspaceId === section.id))) throw Error('All businesses must include the exact complete business list once, including Main Office.');
  return WORKSPACES.map(section => rows.find(row => row.workspaceId === section.id));
}
function childRequestId(parent, workspaceId) {
  requestId(parent);
  if (!WORKSPACES.some(row => row.id === workspaceId)) throw Error('Choose a valid business.');
  return 'month-all-' + hash([parent, workspaceId]);
}
function canonical(value) {
  object(value, ['requestId', 'month', 'businesses', 'token', 'confirmation'], ['requestId', 'month', 'businesses', 'token', 'confirmation']);
  Finance.monthRange(value.month);
  if (value.confirmation !== 'CLOSE ALL ' + value.month) throw Error('Type CLOSE ALL ' + value.month + ' to confirm every business.');
  const businesses = membership(value.businesses).map(row => {
    if (row.state === 'ready') {
      object(row, ['workspaceId', 'state', 'allocations', 'token'], ['workspaceId', 'state', 'allocations', 'token']);
      return {workspaceId:row.workspaceId, state:'ready', allocations:allocations(row.allocations), token:token(row.token)};
    }
    object(row, ['workspaceId', 'state', 'archiveProof'], ['workspaceId', 'state', 'archiveProof']);
    if (row.state !== 'already_closed') throw Error('Review a ready or already closed result for every business.');
    return {workspaceId:row.workspaceId, state:'already_closed', archiveProof:token(row.archiveProof)};
  });
  return {requestId:requestId(value.requestId), month:value.month, businesses, token:token(value.token), confirmation:value.confirmation};
}
const reviewToken = (month, businesses, actorKey) => hash({basis:BASIS, mode:MODE, month, actorKey, businesses});
class MonthClosingAll {
  constructor({service}) {
    if (!service || !(service.entries instanceof Map)) throw Error('The existing month-closing service is required.');
    this.service = service; this.queue = Promise.resolve();
  }
  queued(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  authority() {
    const service = this.service, actor = service.ctx();
    if (!Array.isArray(service.sections) || service.sections.length !== WORKSPACES.length || new Set(service.sections.map(row => row.id)).size !== WORKSPACES.length) throw Error('The complete business list is unavailable.');
    for (const section of WORKSPACES) { service.section(section.id); service.bank.holderRows(section.id, actor.account_key); }
    return actor;
  }
  archived(workspaceId, month) {
    const db = this.service.entries.get(workspaceId).db, rows = q(db, 'SELECT * FROM finance_months WHERE month=?', [month]);
    if (!rows.length) return null;
    if (rows.length !== 1) throw Error('The already closed business archive is ambiguous.');
    // New carry archives require their immutable close and Bank movement proof.
    // Legacy archives stay read-only, with the exact historical row pinned.
    const verified = Core.verifyArchive({db, workspaceId, month}), archive = Finance.archive(db, month), row = rows[0];
    let raw; try { raw = JSON.parse(row.archive_json); } catch { throw Error('The already closed business archive could not be verified.'); }
    if (raw?.month !== month || !raw.all || !raw.all.report || typeof raw.all.report !== 'object' || Array.isArray(raw.all.report) || !Array.isArray(raw.all.daily) || !raw.all.closing || typeof raw.all.closing.cash !== 'number' || !Number.isFinite(raw.all.closing.cash) || !Array.isArray(raw.all.closing.wallets) || !raw.employees || typeof raw.employees !== 'object' || Array.isArray(raw.employees) || typeof row.closed_at !== 'string' || !Number.isFinite(Date.parse(row.closed_at)) || typeof row.actor_key !== 'string' || !row.actor_key || typeof row.actor_name !== 'string' || typeof row.backup_path !== 'string' || !row.backup_path) throw Error('The already closed business archive could not be verified.');
    if (verified && verified.workspaceId !== workspaceId) throw Error('The already closed archive belongs to another business.');
    return {archiveProof:hash({workspaceId, row}), archive};
  }
  preview(value) {
    object(value, ['month', 'businesses'], ['month']); Finance.monthRange(value.month);
    const actor = this.authority(), service = this.service;
    if (value.month >= service.now().slice(0, 7)) throw Error('Only completed months can be closed. The current month stays open.');
    const selected = value.businesses === undefined ? WORKSPACES.map(row => ({workspaceId:row.id, allocations:[]})) : membership(value.businesses);
    const businesses = selected.map(row => {
      object(row, ['workspaceId', 'allocations'], ['workspaceId']); const chosen = allocations(row.allocations), section = WORKSPACES.find(item => item.id === row.workspaceId);
      service.ready(section.id);
      const saved = this.archived(section.id, value.month);
      if (saved) { if (chosen.length) throw Error('An already closed business cannot receive new Bank allocations.'); return {workspaceId:section.id, workspaceName:section.name, state:'already_closed', ...saved}; }
      return {workspaceId:section.id, workspaceName:section.name, state:'ready', review:service.preview({workspaceId:section.id, month:value.month, allocations:chosen})};
    });
    const plans = businesses.map(row => row.state === 'ready' ? {workspaceId:row.workspaceId, state:row.state, allocations:allocations(row.review.allocations.map(({holderAccountKey, method, walletId, amount}) => ({holderAccountKey, method, walletId, amount}))), token:row.review.token} : {workspaceId:row.workspaceId, state:row.state, archiveProof:row.archiveProof});
    return {basis:BASIS, mode:MODE, month:value.month, businesses, token:reviewToken(value.month, plans, actor.account_key)};
  }
  input(value) {
    const input = canonical(value), actor = this.authority();
    if (reviewToken(input.month, input.businesses, actor.account_key) !== input.token) throw Error('The reviewed All businesses plan changed. Review the original business list and allocations again.');
    return input;
  }
  child(input, row) { return {workspaceId:row.workspaceId, month:input.month, allocations:row.allocations, requestId:childRequestId(input.requestId, row.workspaceId), token:row.token, confirmation:'CLOSE ' + input.month}; }
  inspect(input) {
    const service = this.service, actor = this.authority();
    const businesses = input.businesses.map(row => {
      const base = {workspaceId:row.workspaceId, workspaceName:WORKSPACES.find(item => item.id === row.workspaceId).name, requestId:childRequestId(input.requestId, row.workspaceId)};
      if (row.state === 'already_closed') {
        const saved = this.archived(row.workspaceId, input.month);
        if (!saved || saved.archiveProof !== row.archiveProof) throw Error('An already closed business archive changed or could not be verified.');
        return {...base, state:'already_closed', ...saved};
      }
      const child = this.child(input, row), status = service.status({workspaceId:row.workspaceId, requestId:child.requestId});
      if (status.state === 'not_found') {
        const existing = q(service.entries.get(row.workspaceId).db, 'SELECT month FROM finance_months WHERE month=?', [input.month]);
        return {...base, state:existing.length ? 'unknown' : 'not_started', ...(existing.length ? {error:'This business month was closed by a different request. Keep the original batch for review.'} : {})};
      }
      const saved = service.read(row.workspaceId, child.requestId);
      if (!saved || saved.row.actor_key !== actor.account_key || JSON.stringify(saved.input) !== JSON.stringify(child) || !['completed', 'save_required'].includes(status.state)) throw Error('An original business close has different details or could not be verified.');
      return {...base, state:status.state, result:clone(status.result)};
    });
    const counts = {completed:businesses.filter(row => row.state === 'completed').length, alreadyClosed:businesses.filter(row => row.state === 'already_closed').length, remaining:businesses.filter(row => !['completed', 'already_closed'].includes(row.state)).length, saveRequired:businesses.filter(row => row.state === 'save_required').length};
    const state = !counts.remaining ? 'completed' : counts.completed || counts.saveRequired || businesses.some(row => row.state === 'unknown') ? 'partial' : 'not_started';
    let clear = false;
    if (counts.remaining && businesses.every(row => ['completed', 'already_closed', 'not_started'].includes(row.state))) {
      try { for (const row of WORKSPACES) service.ready(row.id); clear = true; } catch { /* An unrelated pending operation must retain the batch marker. */ }
    }
    return {basis:BASIS, mode:MODE, requestId:input.requestId, month:input.month, state, businesses, counts, canRelease:clear && state === 'not_started', canReplan:clear};
  }
  status(value) { return this.inspect(this.input(value)); }
  preflight(input) {
    const status = this.inspect(input);
    if (status.businesses.some(row => row.state === 'unknown' || row.state === 'save_required')) throw Error('Check or resume the original unresolved business close before continuing the batch.');
    // Validate every unclosed original token before the first additional close.
    for (const row of input.businesses) {
      const current = status.businesses.find(item => item.workspaceId === row.workspaceId);
      if (current.state !== 'not_started') continue;
      const review = this.service.preview({workspaceId:row.workspaceId, month:input.month, allocations:row.allocations});
      if (review.token !== row.token) throw Error('A business balance, access or report changed. Review the remaining businesses before closing; completed archives stay unchanged.');
    }
    return status;
  }
  execute(value, recover) {
    return this.queued(async () => {
      const input = this.input(value);
      try {
        let status = this.inspect(input);
        if (recover) for (const row of status.businesses.filter(item => item.state === 'save_required')) {
          this.authority(); await this.service.resume({workspaceId:row.workspaceId, requestId:row.requestId});
        }
        status = this.preflight(input);
        for (const row of input.businesses) {
          if (status.businesses.find(item => item.workspaceId === row.workspaceId).state !== 'not_started') continue;
          this.authority(); await this.service.close(this.child(input, row));
        }
        return this.inspect(input);
      } catch (error) {
        // A transport/disk failure may follow an atomic business commit. Never
        // roll it back or replace its request; report durable child proofs.
        const status = this.inspect(input);
        return {...status, error:String(error?.message || error).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000)};
      }
    });
  }
  close(value) { return this.execute(value, false); }
  resume(value) { return this.execute(value, true); }
}
module.exports = {MonthClosingAll, childRequestId};
