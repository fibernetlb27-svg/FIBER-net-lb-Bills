// Reviewed month closing. Existing money is carried forward unless Admin moves
// a chosen amount to this business's Bank through the server's single workflow.
window.MonthClosing = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
  const cents = value => Math.round(value * 100);
  const balance = value => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(cents(value)) && Math.abs(value * 100 - cents(value)) < 0.000001;
  const money = value => balance(value) && value >= 0;
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;
  const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
  const safeError = error => String(error?.message || error || 'The month closing could not be verified.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 700);
  const sourceKey = value => JSON.stringify([value.holderAccountKey, value.method, value.walletId || '']);
  const walletSum = rows => rows.reduce((sum, row) => sum + cents(row.balance), 0) / 100;
  let config, dialog, base, reviewed, held, pending = [], selected, sourceRows = [], identity = '', storageKey = '', epoch = 0, sequence = 0, busy = false;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const account = () => String(user()?.accountKey || user()?.account_key || '');
  const permitted = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && Boolean(account());
  const allowed = () => permitted() && typeof config?.api?.closeMonthPreview === 'function' && typeof config?.api?.closeMonth === 'function';
  const identityOf = () => JSON.stringify([workspace()?.id, account(), user()?.role, user()?.active, user()?.activity_inspection, user()?.activityInspection]);
  const capture = () => ({epoch, identity});
  const current = stamp => allowed() && stamp.epoch === epoch && stamp.identity === identity && identityOf() === identity;
  const notify = (text, error = false) => config?.toast?.(text, error ? 'error' : undefined);
  function status(text = '', error = false) { if (!el('mc-status')) return; el('mc-status').textContent = text; el('mc-status').hidden = !text; el('mc-status').classList.toggle('mc-error', error); }
  function validWallets(rows) {
    if (!Array.isArray(rows) || new Set(rows.map(row => row?.id)).size !== rows.length || rows.some(row => !identifier(row?.id) || !balance(row.balance))) throw Error('The month-end Whish balances could not be verified.');
    return rows;
  }
  function validBalances(value) { if (!value || !balance(value.cash) || !money(value.bank)) throw Error('The month-end cash or Bank balance could not be verified.'); validWallets(value.wallets); return value; }
  function validAllocations(rows) {
    if (!Array.isArray(rows) || rows.length > 500 || new Set(rows.map(sourceKey)).size !== rows.length || rows.some(row => !identifier(row?.holderAccountKey) || !['cash','whish'].includes(row.method) || typeof row.walletId !== 'string' || row.method === 'cash' && row.walletId !== '' || row.method === 'whish' && !identifier(row.walletId) || !money(row.amount) || row.amount <= 0)) throw Error('Choose each money source once and enter a positive exact USD amount.');
    return rows;
  }
  function validInput(value, write = false) {
    if (!value || !identifier(value.workspaceId) || !monthPattern.test(value.month || '')) throw Error('Select one business and a valid completed month.');
    validAllocations(value.allocations);
    if (write && (!requestPattern.test(value.requestId || '') || !/^[a-f0-9]{64}$/i.test(value.token || '') || value.confirmation !== 'CLOSE ' + value.month)) throw Error('Review the month and type its exact closing confirmation.');
    return value;
  }
  function validPreview(value, input) {
    if (!value || value.workspaceId !== input.workspaceId || value.month !== input.month || typeof value.workspaceName !== 'string' || value.mode !== 'carry_forward' || !/^\d{4}-\d{2}-\d{2}$/.test(value.today || '') || input.month >= value.today.slice(0,7) || !/^[a-f0-9]{64}$/i.test(value.token || '') || !value.sources || !Array.isArray(value.sources.holders) || new Set(value.sources.holders.map(row => row?.accountKey)).size !== value.sources.holders.length) throw Error('The completed month or business closing preview could not be verified.');
    validBalances(value.current); validBalances(value.closing); validBalances(value.carry);
    for (const holder of value.sources.holders) if (!identifier(holder?.accountKey) || typeof holder.name !== 'string' || !['admin','cashier'].includes(holder.role) || !balance(holder.cashBalance) || !Array.isArray(holder.wallets) || new Set(holder.wallets.map(row => row?.id)).size !== holder.wallets.length || holder.wallets.some(row => !identifier(row?.id) || typeof row.label !== 'string' || !balance(row.balance) || typeof row.active !== 'boolean')) throw Error('A permitted month-closing money source could not be verified.');
    validAllocations(value.allocations);
    if (value.allocations.length !== input.allocations.length || !money(value.bankTransferTotal)) throw Error('The reviewed Bank allocations changed.');
    let bankBefore = cents(value.current.bank);
    for (const leg of value.allocations) {
      const requested = input.allocations.find(row => sourceKey(row) === sourceKey(leg));
      const holder = value.sources.holders.find(row => row.accountKey === leg.holderAccountKey), source = leg.method === 'cash' ? holder?.cashBalance : holder?.wallets.find(row => row.id === leg.walletId && row.active)?.balance;
      if (!requested || !balance(source) || cents(source) !== cents(leg.sourceBefore) || cents(requested.amount) !== cents(leg.amount) || !balance(leg.sourceBefore) || !money(leg.sourceAfter) || cents(leg.sourceAfter) !== cents(leg.sourceBefore) - cents(leg.amount) || !money(leg.bankBefore) || !money(leg.bankAfter) || cents(leg.bankBefore) !== bankBefore || cents(leg.bankAfter) !== cents(leg.bankBefore) + cents(leg.amount) || typeof leg.holderName !== 'string') throw Error('A Bank allocation differs from its selected source or reviewed balance.');
      bankBefore = cents(leg.bankAfter);
    }
    const sum = value.allocations.reduce((total, row) => total + cents(row.amount), 0), cash = value.allocations.filter(row => row.method === 'cash').reduce((total, row) => total + cents(row.amount), 0);
    if (!Number.isSafeInteger(sum) || sum !== cents(value.bankTransferTotal) || cents(value.carry.cash) !== cents(value.current.cash) - cash || cents(value.carry.bank) !== cents(value.current.bank) + sum || value.current.wallets.length !== value.carry.wallets.length) throw Error('The Bank total and carried balances do not match.');
    for (const row of value.current.wallets) {
      const after = value.carry.wallets.find(wallet => wallet.id === row.id), moved = value.allocations.filter(leg => leg.method === 'whish' && leg.walletId === row.id).reduce((total, leg) => total + cents(leg.amount), 0);
      if (!after || cents(after.balance) !== cents(row.balance) - moved) throw Error('A carried Whish wallet does not match its selected Bank allocation.');
    }
    return value;
  }
  function validMarker(value) {
    if (!value || value.version !== 1 || value.accountKey !== account() || value.workspaceId !== value.input?.workspaceId || value.month !== value.input?.month || value.requestId !== value.input?.requestId) throw Error('The saved month-closing request is damaged. Keep this PC’s app data and review it before closing another month.');
    validInput(value.input, true); return value;
  }
  function restore() {
    storageKey = 'fiber-month-close-v1:' + encodeURIComponent(JSON.stringify(['main', account()]));
    try { const raw = localStorage.getItem(storageKey); held = raw ? validMarker(JSON.parse(raw)) : null; }
    catch (error) { held = {corrupt:true, error:'Closing recovery storage is unavailable. New closings are blocked. ' + safeError(error)}; }
  }
  function preserve(input) {
    if (held) throw Error('Resolve the original month closing before entering another request.');
    const marker = validMarker({version:1, accountKey:account(), workspaceId:input.workspaceId, month:input.month, requestId:input.requestId, input}), raw = JSON.stringify(marker);
    try { localStorage.setItem(storageKey, raw); if (localStorage.getItem(storageKey) !== raw) throw Error('The original closing request could not be retained.'); held = marker; }
    catch (error) { held = {corrupt:true, error:'No closing request was submitted because its original reference could not be saved. ' + safeError(error)}; throw error; }
  }
  function forget(marker) {
    if (held?.requestId !== marker.requestId || held?.workspaceId !== marker.workspaceId) return;
    localStorage.removeItem(storageKey); if (localStorage.getItem(storageKey) !== null) throw Error('The completed closing reference could not be cleared. Check it before another close.'); held = null;
  }
  function close(force = false) { if (busy && !force) return; sequence++; if (dialog) { dialog.close(); dialog.remove(); dialog = null; } base = null; reviewed = null; sourceRows = []; }
  function reset() { epoch++; busy = false; close(true); config = null; selected = null; held = null; pending = []; identity = ''; storageKey = ''; }
  function init(value) { reset(); config = value; if (!allowed()) return; identity = identityOf(); restore(); }
  function controls() {
    if (!dialog) return;
    dialog.setAttribute('aria-busy', String(busy));
    for (const field of dialog.querySelectorAll('input,button,select')) field.disabled = busy;
    for (const row of dialog.querySelectorAll('[data-mc-source]')) {
      const source = sourceRows[Number(row.dataset.mcSource)];
      if (!source) continue;
      row.querySelector('[data-mc-select]').disabled = busy || source.balance <= 0 || Boolean(held) || pending.length > 0;
      row.querySelector('[data-mc-amount]').disabled = busy || !row.querySelector('[data-mc-select]').checked || Boolean(held) || pending.length > 0;
    }
    if (el('mc-review')) el('mc-review').disabled = busy || Boolean(held) || pending.length > 0 || !base;
    if (el('mc-confirm')) el('mc-confirm').disabled = busy || !reviewed || !el('mc-ack').checked || el('mc-confirmation').value !== 'CLOSE ' + selected.month || Boolean(held) || pending.length > 0;
    if (el('mc-discard-confirm')) el('mc-discard-confirm').disabled = busy || !el('mc-discard-ack').checked;
  }
  function mount() {
    close(); dialog = document.createElement('dialog'); dialog.className = 'modal mc-dialog'; dialog.setAttribute('aria-labelledby','mc-title');
    dialog.innerHTML = '<div class="modal-heading"><div><p class="eyebrow">MAIN OFFICE · MONTHLY ACCOUNTING</p><h2 id="mc-title">End of Month</h2><p id="mc-subtitle" class="field-note"></p></div><button id="mc-close" type="button" class="button button-secondary">Close</button></div><p id="mc-status" class="mc-status" role="status" aria-live="polite" hidden></p><section id="mc-recovery" class="mc-recovery" aria-label="Month-closing request recovery" hidden></section><div id="mc-content"><p class="field-note">Loading the historical month-end snapshot and today’s balances…</p></div>';
    document.body.append(dialog); el('mc-close').onclick = () => close(); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.showModal();
    el('mc-recovery').onclick = event => {
      const button = event.target.closest('[data-mc-check],[data-mc-resume],[data-mc-retry],[data-mc-discard]'); if (!button || button.disabled || !allowed()) return;
      if (button.hasAttribute('data-mc-retry')) retry();
      else if (button.hasAttribute('data-mc-discard')) discard();
      else { const key = button.dataset.mcCheck || button.dataset.mcResume, marker = key === 'local' ? held : pending.find(row => row.requestId === key); if (marker) check(marker, button.hasAttribute('data-mc-resume')); }
    };
  }
  function renderRecovery() {
    if (!el('mc-recovery')) return;
    const box = el('mc-recovery'); box.hidden = !held && !pending.length;
    let html = '';
    if (held?.corrupt) html = '<h3>Saved closing reference needs review</h3><p>' + esc(held.error) + '</p>';
    else if (held) html = '<h3>Check the original month closing</h3><p>Do not close the month again or enter replacement Bank transfers while its result is unconfirmed.</p><p class="mc-reference">' + esc(held.workspaceId) + ' · ' + esc(held.month) + ' · ' + esc(held.requestId) + '</p><div class="mc-actions"><button class="button button-secondary" type="button" data-mc-check="local">Check saved closing</button>' + (held.checkedState === 'save_required' ? '<button class="button button-primary" type="button" data-mc-resume="local">Finish saving original closing</button>' : '') + (held.checkedState === 'not_found' ? '<button class="button button-secondary" type="button" data-mc-retry>Retry original request</button>' : '') + (held.canRelease ? '<button class="button button-secondary" type="button" data-mc-discard>Discard unsaved request</button>' : '') + '</div>';
    for (const row of pending) if (row.requestId !== held?.requestId) html += '<div class="mc-pending"><strong>Original closing is awaiting its durable save</strong><p class="mc-reference">' + esc(row.workspaceId) + ' · ' + esc(row.requestId) + '</p><button class="button button-secondary" type="button" data-mc-resume="' + esc(row.requestId) + '">Finish saving closing</button></div>';
    box.innerHTML = html; controls();
  }
  function summary(title, value, note) {
    return '<section class="mc-balance-section"><h3>' + esc(title) + '</h3><p class="field-note">' + esc(note) + '</p><div class="mc-balance-grid"><article><span>Cash drawers</span><strong>' + usd(value.cash) + '</strong></article><article><span>Whish wallets</span><strong>' + usd(walletSum(value.wallets)) + '</strong></article><article><span>Bank</span><strong>' + usd(value.bank) + '</strong></article></div>' + (value.wallets.length ? '<details class="mc-wallet-details"><summary>Wallet breakdown</summary>' + value.wallets.map(row => '<p><span>' + esc(row.label || 'Whish wallet') + '</span><strong>' + usd(row.balance) + '</strong></p>').join('') + '</details>' : '') + '</section>';
  }
  function renderForm(value, allocations = []) {
    base = value; reviewed = null;
    const selectedMap = new Map(allocations.map(row => [sourceKey(row), row.amount]));
    sourceRows = value.sources.holders.flatMap(holder => [{holderAccountKey:holder.accountKey,holderName:holder.name,role:holder.role,method:'cash',walletId:'',label:'Cash drawer',balance:holder.cashBalance}, ...holder.wallets.filter(row => row.active).map(row => ({holderAccountKey:holder.accountKey,holderName:holder.name,role:holder.role,method:'whish',walletId:row.id,label:row.label,balance:row.balance}))]);
    el('mc-subtitle').textContent = value.workspaceName + ' · ' + value.month;
    el('mc-content').innerHTML = '<p class="mc-warning">Close the completed month without resetting money. Choose any amounts to move to this business’s Bank; all remaining cash and Whish money carries forward. Selected transfers are recorded today (' + esc(value.today) + '), not backdated.</p>' + summary('Historical month-end snapshot', value.closing, 'Balances at the end of ' + value.month + '. Later receipts and payments stay in their original periods.') + summary('Balances available now', value.current, 'Current recorded balances, including activity after the month being closed.') + '<form id="mc-form"><div class="mc-allocation-heading"><div><p class="eyebrow">OPTIONAL BANK SAVINGS</p><h3>Choose amounts to put in Bank</h3><p class="field-note">Leave every source unselected to carry everything forward. Each listed source belongs to the chosen business.</p></div></div><div class="table-wrap"><table class="mc-source-table"><thead><tr><th>MONEY HOLDER / SOURCE</th><th class="number">AVAILABLE NOW</th><th>MOVE TO BANK</th></tr></thead><tbody>' + sourceRows.map((row,index) => { const selectedAmount = selectedMap.get(sourceKey(row)), checked = selectedAmount !== undefined; return '<tr data-mc-source="' + index + '"><td><strong>' + esc(row.holderName) + '</strong><small>' + esc(row.role === 'admin' ? 'Admin' : 'Cashier') + ' · ' + esc(row.method === 'cash' ? 'Cash drawer' : 'Whish · ' + row.label) + '</small></td><td class="number">' + usd(row.balance) + '</td><td><label class="mc-allocation-input"><input data-mc-select type="checkbox" aria-label="Move money from ' + esc(row.holderName + ' ' + row.label) + ' to Bank"' + (checked ? ' checked' : '') + (row.balance <= 0 ? ' disabled' : '') + ' /><span class="mc-currency">$</span><input data-mc-amount type="number" inputmode="decimal" min="0.01" max="' + esc(Math.max(0,row.balance).toFixed(2)) + '" step="0.01" value="' + esc(checked ? selectedAmount.toFixed(2) : '') + '" aria-label="Amount from ' + esc(row.holderName + ' ' + row.label) + ' to Bank"' + (checked ? '' : ' disabled') + ' /></label></td></tr>'; }).join('') + '</tbody></table></div>' + (!sourceRows.length ? '<p class="field-note">No permitted cash or wallet sources are available for a Bank allocation. You can still review carrying all balances forward.</p>' : '') + '<div id="mc-review-result" hidden></div><p id="mc-form-error" class="form-error" role="status" aria-live="polite"></p><div id="mc-confirm-fields" class="mc-confirm-fields" hidden><label>Type CLOSE ' + esc(value.month) + '<input id="mc-confirmation" autocomplete="off" spellcheck="false" /></label><label class="mc-check"><input id="mc-ack" type="checkbox" />I reviewed the completed month, today’s Bank transfers and all balances being carried forward.</label></div><div class="mc-actions mc-footer"><button id="mc-review" class="button button-secondary" type="button">Review month close</button><button id="mc-confirm" class="button button-primary" type="submit" disabled>Close ' + esc(value.month) + '</button></div></form>';
    el('mc-form').oninput = event => {
      if (event.target.closest('[data-mc-source]')) { reviewed = null; el('mc-review-result').hidden = true; el('mc-confirm-fields').hidden = true; el('mc-ack').checked = false; el('mc-confirmation').value = ''; el('mc-form-error').textContent = ''; }
      controls();
    };
    el('mc-form').onchange = controls;
    el('mc-review').onclick = review;
    el('mc-form').onsubmit = event => { event.preventDefault(); void commit(); };
    controls();
  }
  function inputs() {
    const allocations = [];
    for (const row of dialog.querySelectorAll('[data-mc-source]')) if (row.querySelector('[data-mc-select]').checked) { const source = sourceRows[Number(row.dataset.mcSource)]; allocations.push({holderAccountKey:source.holderAccountKey, method:source.method, walletId:source.walletId, amount:Number(row.querySelector('[data-mc-amount]').value)}); }
    return validInput({workspaceId:selected.workspaceId, month:selected.month, allocations});
  }
  function renderReview(value) {
    const result = el('mc-review-result');
    result.innerHTML = '<section class="mc-reviewed"><h3>Reviewed transfers to Bank · ' + usd(value.bankTransferTotal) + '</h3>' + (value.allocations.length ? '<div class="mc-reviewed-legs">' + value.allocations.map(leg => '<article><strong>' + esc(leg.holderName) + ' · ' + esc(leg.method === 'cash' ? 'Cash drawer' : 'Whish · ' + (leg.walletLabel || 'wallet')) + '</strong><div><span>Move to Bank</span><strong>' + usd(leg.amount) + '</strong></div><div><span>Source before → after</span><strong>' + usd(leg.sourceBefore) + ' → ' + usd(leg.sourceAfter) + '</strong></div></article>').join('') + '</div>' : '<p class="field-note">No money will be moved to Bank. All current cash and wallet balances remain available.</p>') + '<div class="mc-bank-change"><span>Bank before → after</span><strong>' + usd(value.current.bank) + ' → ' + usd(value.carry.bank) + '</strong></div></section>' + summary('Balances carried forward after closing', value.carry, 'Unselected money remains in its cash drawer or Whish wallet. No balance is reset to zero.') + '<p class="field-note">Closing locks the completed month’s financial records and preserves its report. It does not renew Internet services, reset stock or customer debts, change profit, add expenses or charge Whish fees.</p>';
    result.hidden = false; el('mc-confirm-fields').hidden = false;
  }
  async function open(input) {
    if (!allowed()) { notify('End of Month is available to the Main Office administrator. Update Main and this PC together if the reviewed closing service is unavailable.', true); return; }
    try { validInput({...input, allocations:[]}); } catch (error) { notify(safeError(error), true); return; }
    if (busy) return;
    if (identity !== identityOf()) { epoch++; identity = identityOf(); restore(); }
    selected = {workspaceId:input.workspaceId, month:input.month}; pending = []; mount(); const stamp = capture(), ticket = sequence; busy = true; controls();
    try {
      if (typeof config.api.pendingMonthClose === 'function') {
        const value = await config.api.pendingMonthClose();
        if (!current(stamp) || ticket !== sequence) return;
        if (!value || !Array.isArray(value.requests) || value.requests.some(row => !identifier(row?.workspaceId) || !requestPattern.test(row.requestId || '') || row.state !== 'save_required')) throw Error('Pending month-closing requests could not be verified.');
        pending = value.requests;
      }
      renderRecovery();
      if (held || pending.length) { el('mc-content').innerHTML = '<p class="field-note">Resolve the original saved request before reviewing another month closing.</p>'; return; }
      const request = {...selected, allocations:[]}, value = validPreview(await config.api.closeMonthPreview(request), request);
      if (!current(stamp) || ticket !== sequence) return;
      renderForm(value);
    } catch (error) { if (current(stamp) && ticket === sequence) { el('mc-content').textContent = ''; status(safeError(error), true); } }
    finally { if (current(stamp) && ticket === sequence) { busy = false; renderRecovery(); controls(); } }
  }
  async function review() {
    if (!allowed() || !dialog || busy || held || pending.length) return;
    let input; try { input = inputs(); } catch (error) { el('mc-form-error').textContent = safeError(error); return; }
    const stamp = capture(), ticket = sequence; busy = true; reviewed = null; controls(); el('mc-form-error').textContent = '';
    try {
      const value = validPreview(await config.api.closeMonthPreview(input), input);
      if (!current(stamp) || ticket !== sequence || !dialog) return;
      renderForm(value, input.allocations); reviewed = {value,input}; renderReview(value);
    } catch (error) { if (current(stamp) && ticket === sequence && dialog) el('mc-form-error').textContent = safeError(error); }
    finally { if (current(stamp) && ticket === sequence) { busy = false; controls(); } }
  }
  async function commit() {
    if (!allowed() || busy || !reviewed || held || pending.length || !el('mc-ack').checked || el('mc-confirmation').value !== 'CLOSE ' + selected.month) return;
    let input;
    try { input = inputs(); validPreview(reviewed.value,input); input = {...input, token:reviewed.value.token, requestId:'month-close-' + crypto.randomUUID(), confirmation:el('mc-confirmation').value}; validInput(input,true); preserve(input); }
    catch (error) { el('mc-form-error').textContent = safeError(error); renderRecovery(); return; }
    const stamp = capture(), ticket = sequence, marker = held; busy = true; controls();
    try { const result = await config.api.closeMonth(input); if (!current(stamp) || ticket !== sequence) return; await complete(result, marker); }
    catch (error) { if (current(stamp) && ticket === sequence) status('Closing result is unconfirmed. Check the original request; do not close again or replace its Bank transfers. ' + safeError(error), true); }
    finally { if (current(stamp) && ticket === sequence) { busy = false; renderRecovery(); controls(); } }
  }
  async function complete(value, marker) {
    const result = value?.result || value;
    if (!result || value.state !== 'completed' || result.state !== 'completed' || result.mode !== 'carry_forward' || result.requestId !== marker.requestId || result.month !== (marker.month || marker.input?.month || result.month) || result.workspaceId !== undefined && result.workspaceId !== marker.workspaceId || typeof result.closedAt !== 'string' || !Number.isFinite(Date.parse(result.closedAt)) || typeof result.actorName !== 'string' || result.readOnly !== true || !Array.isArray(result.daily) || !result.report) throw Error('The original month-closing completion could not be verified.');
    validBalances(result.closing); forget(marker); pending = pending.filter(row => row.requestId !== marker.requestId || row.workspaceId !== marker.workspaceId); reviewed = null; base = null;
    el('mc-content').innerHTML = '<section class="mc-complete"><span aria-hidden="true">✓</span><h3>' + esc(result.month) + ' closed</h3><p>The report is archived and the completed month is read-only. Remaining cash and Whish balances were carried forward.</p><p class="field-note">Recorded by ' + esc(result.actorName) + ' · ' + esc(result.closedAt.replace('T',' ')) + '</p><p class="mc-reference">' + esc(result.requestId) + '</p></section>';
    status('Month closed successfully. No balances were reset.'); notify('Month archived; remaining money carried forward.');
    try { await config.onComplete?.(result); } catch { notify('Month closing is saved. Refresh the ledger and dashboard when ready.'); }
  }
  async function check(marker, resume = false) {
    if (!allowed() || busy || !marker || marker.corrupt) return;
    const stamp = capture(), ticket = sequence; busy = true; controls();
    try {
      const result = await config.api[resume ? 'resumeMonthClose' : 'closeMonthStatus']({workspaceId:marker.workspaceId, requestId:marker.requestId});
      if (!current(stamp) || ticket !== sequence) return;
      if (result?.state === 'completed') await complete(result, marker);
      else if (result?.state === 'save_required') { if (held?.requestId === marker.requestId) held.checkedState = 'save_required'; status('The original closing exists but its durable save needs confirmation. Finish saving it; do not enter another close.', true); }
      else if (result?.state === 'not_found' && result.requestId === marker.requestId) { if (held?.requestId === marker.requestId) { held.checkedState = 'not_found'; held.canRelease = result.canRelease === true; } status('No completed closing was found for this reference. Retry the original request, or discard it only after reviewing this result.'); }
      else throw Error('The saved month-closing status could not be verified.');
    } catch (error) { if (current(stamp) && ticket === sequence) status(safeError(error), true); }
    finally { if (current(stamp) && ticket === sequence) { busy = false; renderRecovery(); controls(); } }
  }
  async function retry() {
    if (!allowed() || busy || held?.checkedState !== 'not_found' || !held.input) return;
    const stamp = capture(), ticket = sequence, marker = held; busy = true; controls();
    try { const result = await config.api.closeMonth({...marker.input}); if (!current(stamp) || ticket !== sequence) return; await complete(result,marker); }
    catch (error) { if (current(stamp) && ticket === sequence) status('The original request is still held. Check its saved status. ' + safeError(error), true); }
    finally { if (current(stamp) && ticket === sequence) { busy = false; renderRecovery(); controls(); } }
  }
  function discard() {
    if (!allowed() || busy || !held?.canRelease || held.checkedState !== 'not_found') return;
    const marker = held;
    el('mc-content').innerHTML = '<p class="mc-warning">The server reported that the original reference has no saved closing. Discarding its local request does not move money or close a month.</p><label class="mc-check"><input id="mc-discard-ack" type="checkbox" />I reviewed the original request check and want to discard this unsaved closing.</label><button id="mc-discard-confirm" type="button" class="button button-primary" disabled>Discard unsaved request</button>';
    el('mc-discard-ack').onchange = () => { el('mc-discard-confirm').disabled = !el('mc-discard-ack').checked; };
    el('mc-discard-confirm').onclick = async () => {
      if (busy || !el('mc-discard-ack').checked) return;
      const stamp = capture(), ticket = sequence; busy = true; controls();
      try { const value = await config.api.closeMonthStatus({workspaceId:marker.workspaceId, requestId:marker.requestId}); if (!current(stamp) || ticket !== sequence) return; if (value?.state !== 'not_found' || value.requestId !== marker.requestId || value.canRelease !== true) throw Error('The original closing can no longer be discarded. Check its saved status.'); forget(marker); status('Unsaved closing reference discarded. No money or month was changed.'); }
      catch (error) { if (current(stamp) && ticket === sequence) status(safeError(error),true); }
      finally { if (current(stamp) && ticket === sequence) { busy = false; renderRecovery(); controls(); if (!held) { const value = {...selected}; close(); await open(value); } } }
    };
  }
  return {init, open, reset, close, hasPending:() => Boolean(held) || pending.length > 0 || busy};
})();
