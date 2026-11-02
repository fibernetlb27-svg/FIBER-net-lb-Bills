// Current business custody, including month-end carry-forward. Bank remains the
// only writer: these cards never create a second debt or move money themselves.
window.MonthCollections = (() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value);
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  function cents(value, positive = false) { if (typeof value !== 'number' || !Number.isFinite(value) || positive && value < 0) return null; const result = Math.round(value * 100); return Number.isSafeInteger(result) && Math.abs(value * 100 - result) < 1e-6 ? result : null; }
  function day(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(value + 'T00:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value; }
  let config, host, data, epoch = 0, sequence = 0, scheduleSequence = 0, inflight, identity = '', rendered = '', opening = false;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const identityOf = () => JSON.stringify([workspace()?.id,user()?.accountKey || user()?.account_key,user()?.role,user()?.active,user()?.activity_inspection,user()?.activityInspection,user()?.allowedSections]);
  const allowed = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && identifier(user()?.accountKey || user()?.account_key) && typeof config?.api?.collectionOverview === 'function';
  const selected = () => config?.getBusiness?.() || 'all';
  const current = stamp => allowed() && stamp.epoch === epoch && stamp.identity === identity && identityOf() === identity && stamp.scope === selected();
  function clear() { data = null; rendered = ''; if (host) { host.hidden = true; host.replaceChildren(); } }
  function reset() { epoch++; sequence++; scheduleSequence++; inflight = null; opening = false; clear(); const schedule = document.getElementById('automatic-month-status'); if (schedule) { schedule.hidden = true; schedule.textContent = ''; } config = null; identity = ''; }
  function mount() {
    host = document.getElementById('month-collections');
    if (!host) { const finance = document.getElementById('finance-dashboard'); if (!finance) return; host = document.createElement('section'); host.id = 'month-collections'; host.className = 'month-collections'; host.setAttribute('aria-labelledby','month-collections-title'); finance.before(host); }
    host.onclick = event => {
      const refresh = event.target.closest('[data-collection-refresh]');
      if (refresh && host.contains(refresh)) { void load(true); return; }
      const button = event.target.closest('[data-collection-business][data-collection-method]');
      if (!button || button.disabled || !host.contains(button) || !allowed() || !data || opening) return;
      const row = data.businesses.find(item => item.workspaceId === button.dataset.collectionBusiness), method = button.dataset.collectionMethod;
      if (!row || row.lastClosedMonth >= data.asOf.slice(0,7) || !['cash','whish'].includes(method) || cents(row.availableToDeposit[method], true) <= 0) return;
      opening = true; render();
      Promise.resolve().then(() => window.Bank.openDeposit({workspaceId:row.workspaceId,method})).catch(error => config?.toast?.(String(error?.message || error), 'error')).finally(() => { opening = false; if (allowed()) render(); });
    };
  }
  function init(value) { reset(); config = value; identity = identityOf(); if (allowed()) { mount(); host.hidden = false; } }
  async function loadSchedule() {
    if (!allowed() || typeof config?.financeApi?.autoMonthStatus !== 'function') return;
    const ledger = document.querySelector('#view-ledger .finance-content'); if (!ledger) return;
    let note = document.getElementById('automatic-month-status');
    if (!note) { note = document.createElement('p'); note.id = 'automatic-month-status'; note.className = 'month-auto-status'; note.setAttribute('role','status'); ledger.prepend(note); }
    const stamp = {epoch,identity}, request = ++scheduleSequence;
    try {
      const value = await config.financeApi.autoMonthStatus();
      if (!allowed() || stamp.epoch !== epoch || stamp.identity !== identity || identityOf() !== identity || request !== scheduleSequence) return;
      const month = value => value === null || value === '' || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value || '');
      if (!value || value.basis !== 'automatic_month_close' || value.enabled !== true || value.timeZone !== 'Asia/Beirut' || value.hour !== 23 || value.minute !== 59 || value.carryForward !== true || value.automaticBankDeposit !== false || !['ready','running','waiting','completed'].includes(value.state) || !month(value.firstMonth) || !month(value.completedThrough) || !month(value.month)) throw Error('The automatic month-closing schedule could not be verified.');
      const state = value.state === 'waiting' ? 'Waiting for pending accounting operations to be reviewed. It will retry automatically.' : value.state === 'running' ? 'Closing is in progress.' : value.completedThrough ? 'Completed through ' + value.completedThrough + '.' : 'Ready' + (value.firstMonth ? ' from ' + value.firstMonth : '') + '.';
      note.hidden = false; note.classList.toggle('month-auto-waiting',value.state === 'waiting'); note.textContent = 'Automatic closing: 11:59 PM on the last day of every month · Beirut time. ' + state + ' Cash and Whish carry forward; Admin chooses Bank deposits. After closing, new financial entries wait until midnight.';
    } catch (error) {
      if (!allowed() || stamp.epoch !== epoch || stamp.identity !== identity || request !== scheduleSequence) return;
      note.hidden = false; note.classList.add('month-auto-waiting'); note.textContent = String(error?.message || error);
    }
  }
  function validate(value, scope) {
    const ids = (config.sections || []).filter(row => scope === 'all' || row.id === scope).map(row => row.id).sort();
    if (!value || value.basis !== 'business_collection_custody' || value.scope !== scope || !day(value.asOf) || value.currentHoldings !== true || value.includesCarriedMoney !== true || value.separateReceivable !== false || !Array.isArray(value.businesses) || !ids.length || new Set(ids).size !== ids.length || JSON.stringify(value.businesses.map(row => row?.workspaceId).sort()) !== JSON.stringify(ids)) throw Error('The selected businesses’ remaining money could not be verified.');
    for (const row of value.businesses) {
      const fields = ['cash','whish','total','bankBalance'];
      if (!identifier(row.workspaceId) || typeof row.workspaceName !== 'string' || fields.some(key => cents(row[key], key === 'bankBalance') === null) || BigInt(cents(row.cash)) + BigInt(cents(row.whish)) !== BigInt(cents(row.total)) || row.lastClosedMonth !== null && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.lastClosedMonth || '') || row.lastClosedMonth && (typeof row.closedAt !== 'string' || !Number.isFinite(Date.parse(row.closedAt))) || row.lastClosedMonth === null && row.closedAt !== null) throw Error('A business’s carried cash or Whish balance could not be verified.');
      const available = row.availableToDeposit;
      if (!available || ['cash','whish','total'].some(key => cents(available[key], true) === null) || BigInt(cents(available.cash)) + BigInt(cents(available.whish)) !== BigInt(cents(available.total))) throw Error('The permitted Bank deposit sources could not be verified.');
    }
    if (!value.totals || ['cash','whish','total','bankBalance'].some(key => cents(value.totals[key], key === 'bankBalance') === null || value.businesses.reduce((sum, row) => sum + BigInt(cents(row[key])), 0n) !== BigInt(cents(value.totals[key])))) throw Error('The remaining-money totals do not match the selected businesses.');
    return value;
  }
  function header() { return '<div class="month-collections-heading"><div><p class="eyebrow">MONTH-END · MONEY TO COLLECT</p><h2 id="month-collections-title">Business money remaining</h2></div><button type="button" class="button button-secondary" data-collection-refresh>Refresh balances</button></div>'; }
  function card(row) {
    const closed = row.lastClosedMonth && row.lastClosedMonth >= data.asOf.slice(0,7);
    return '<article class="month-collection-card" data-collection-card="' + esc(row.workspaceId) + '"><div class="month-collection-card-heading"><h3>' + esc(row.workspaceName) + '</h3><span>' + (row.lastClosedMonth ? 'Last closed: ' + esc(row.lastClosedMonth) : 'No closed month yet') + '</span></div><p class="month-collection-total"><span>Amount to collect</span><strong data-collection-total>' + usd(row.total) + '</strong></p><div class="month-collection-balances"><div><span>Cash drawer</span><strong data-collection-cash>' + usd(row.cash) + '</strong></div><div><span>Whish wallets</span><strong data-collection-whish>' + usd(row.whish) + '</strong></div></div><p class="month-collection-bank">Saved in Bank: ' + usd(row.bankBalance) + '</p><div class="month-collection-actions">' + ['cash','whish'].map(method => '<button type="button" class="button ' + (method === 'cash' ? 'button-primary' : 'button-secondary') + '" data-collection-business="' + esc(row.workspaceId) + '" data-collection-method="' + method + '"' + (closed || opening || cents(row.availableToDeposit[method], true) <= 0 ? ' disabled' : '') + '>Add ' + (method === 'cash' ? 'cash' : 'Whish') + ' to Bank</button>').join('') + '</div>' + (closed ? '<p class="month-collection-warning">This month is closed. Bank deposits are available when the next month opens at midnight.</p>' : '') + (row.total < 0 ? '<p class="month-collection-warning">This business has a negative recorded balance. Review its money sources.</p>' : '') + (cents(row.availableToDeposit.total, true) === 0 && row.total > 0 ? '<p class="month-collection-warning">An authorized money holder must hold the funds before Admin can deposit them.</p>' : '') + '</article>';
  }
  function render(error = '') {
    if (!host || !allowed()) { clear(); return; }
    host.hidden = false;
    const cards = data ? '<div class="month-collection-grid">' + data.businesses.map(card).join('') + '</div>' : '';
    const html = header() + '<p class="month-collections-note">Cash and Whish still held by each business, including money carried from closed months. Choose how much to add to its Bank. A partial deposit reduces the remaining amount; later receipts, spending and transfers also update these current balances.</p>' + (error ? '<p class="month-collections-error" role="alert">' + esc(error) + '</p>' : cards || '<p class="month-collections-note" role="status">Loading verified business balances…</p>') + (data && !error ? '<p class="month-collections-note month-collections-asof">Recorded balances through ' + esc(data.asOf) + ' · all money holders. The deposit form shows only permitted sources.</p>' : '');
    if (html !== rendered) { host.innerHTML = html; rendered = html; }
  }
  async function load(force = false) {
    if (!allowed()) { clear(); return null; }
    void loadSchedule();
    if (!host) mount();
    const scope = selected(), key = JSON.stringify([identity,scope]);
    if (inflight?.key === key && !force) return inflight.promise;
    const stamp = {epoch,identity,scope}, ticket = ++sequence;
    if (data?.scope !== scope) { data = null; render(); }
    const promise = Promise.resolve().then(() => config.api.collectionOverview({workspaceId:scope})).then(value => {
      if (!current(stamp) || ticket !== sequence) return null;
      data = validate(value, scope); render(); return data;
    }).catch(error => { if (current(stamp) && ticket === sequence) { data = null; render(String(error?.message || error)); } return null; }).finally(() => { if (ticket === sequence) inflight = null; });
    inflight = {key,promise}; return promise;
  }
  function updateUser(value) { if (!config) return; config.user = value; if (!allowed() || identityOf() !== identity) { epoch++; sequence++; scheduleSequence++; inflight = null; identity = identityOf(); clear(); const note = document.getElementById('automatic-month-status'); if (note) { note.hidden = true; note.textContent = ''; } } }
  return {init,load,loadSchedule,reset,updateUser};
})();
