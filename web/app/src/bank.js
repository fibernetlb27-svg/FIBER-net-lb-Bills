// Per-business safekeeping. The server owns every atomic drawer/wallet movement.
window.Bank = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
  const cents = value => Math.round(value * 100);
  const balance = value => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(cents(value)) && Math.abs(value * 100 - cents(value)) < 0.000001;
  const money = value => balance(value) && value >= 0;
  const identifier = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
  const requestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value);
  const month = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
  const errorText = error => String(error?.message || error || 'The Bank request could not be verified.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 700);
  const methodName = value => value === 'cash' ? 'Cash drawer' : 'Whish wallet';
  const directionName = value => value === 'deposit' ? 'Deposit to Bank' : 'Return from Bank';
  let config, host, dialog, data, collections, sources, review, held, serverPending = [], scope = 'all', search = '', directionFilter = 'all', collectionMonth = '';
  let identity = '', storageKey = '', epoch = 0, loadTicket = 0, formTicket = 0, sourceTicket = 0, previewTicket = 0, loading = false, busy = false, suspended = true, loaded = false;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const account = () => String(user()?.accountKey || user()?.account_key || '');
  const permitted = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && Boolean(account());
  const allowed = () => !suspended && permitted() && Boolean(config?.api?.overview);
  const identityOf = () => JSON.stringify([workspace()?.id, account(), user()?.role, user()?.active, user()?.activity_inspection, user()?.activityInspection]);
  const capture = () => ({epoch, identity});
  const current = value => allowed() && value.epoch === epoch && value.identity === identity && identityOf() === identity;
  const blocked = () => !allowed() || busy || loading || !loaded || Boolean(held) || serverPending.length > 0;
  const notify = (text, error = false) => config?.toast?.(text, error ? 'error' : undefined);
  function status(text = '', error = false) { if (!el('bank-status')) return; el('bank-status').textContent = text; el('bank-status').hidden = !text; el('bank-status').classList.toggle('bank-error', error); }
  function validInput(input) {
    if (!input || Array.isArray(input) || !identifier(input.workspaceId) || !identifier(input.holderAccountKey) || !['cash','whish'].includes(input.method) || !['deposit','withdraw'].includes(input.direction) || !money(input.amount) || input.amount <= 0 || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1000 || input.method === 'whish' && !identifier(input.walletId) || input.method === 'cash' && Boolean(input.walletId)) throw Error('Choose the business, exact money holder, source and a positive amount with a transfer note.');
    if (input.collectionMonth !== undefined && (!month(input.collectionMonth) || input.direction !== 'deposit')) throw Error('Choose a valid prior month for this Bank deposit.');
    return input;
  }
  function validCollectionProof(value, input) {
    if (input.collectionMonth !== undefined) {
      if (!month(input.collectionMonth) || input.direction !== 'deposit' || value.collectionMonth !== input.collectionMonth || !/^[a-f0-9]{64}$/.test(value.collectionProof || '') || !money(value.collectionBefore) || !money(value.collectionAfter) || cents(value.collectionAfter) !== cents(value.collectionBefore) - cents(input.amount)) throw Error('The previous month’s remaining money changed. Review this deposit again.');
    } else if (value.collectionMonth !== undefined || value.collectionBefore !== undefined || value.collectionAfter !== undefined || value.collectionProof !== undefined) throw Error('The reviewed Bank deposit has a different money period.');
    return value;
  }
  function validRecord(row) {
    if (!row || !requestId(row.requestId) || !identifier(row.workspaceId) || typeof row.workspaceName !== 'string' || !['deposit','withdraw'].includes(row.direction) || !['cash','whish'].includes(row.method) || !money(row.amount) || row.amount <= 0 || ![row.bankBefore,row.bankAfter].every(money) || ![row.sourceBefore,row.sourceAfter].every(balance) || row.direction === 'deposit' && row.sourceAfter < 0 || !identifier(row.holderAccountKey) || row.method === 'whish' && !identifier(row.walletId) || row.method === 'cash' && Boolean(row.walletId) || typeof row.holderName !== 'string' || typeof row.note !== 'string' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('A saved Bank transfer could not be verified.');
    const sign = row.direction === 'deposit' ? 1 : -1;
    if (cents(row.bankAfter) !== cents(row.bankBefore) + sign * cents(row.amount) || cents(row.sourceAfter) !== cents(row.sourceBefore) - sign * cents(row.amount)) throw Error('A Bank transfer does not balance with its original drawer or wallet.');
    validCollectionProof(row,row);
    return row;
  }
  function validOverview(value, selected) {
    if (!value || !Array.isArray(value.workspaces) || !Array.isArray(value.accounts) || !Array.isArray(value.history) || new Set(value.workspaces.map(row => row?.id)).size !== value.workspaces.length || value.workspaces.some(row => !identifier(row?.id) || typeof row.name !== 'string') || new Set(value.accounts.map(row => row?.workspaceId)).size !== value.accounts.length) throw Error('The business Bank accounts could not be verified.');
    for (const row of value.accounts) if (!value.workspaces.some(item => item.id === row.workspaceId) || selected !== 'all' && row.workspaceId !== selected || typeof row.workspaceName !== 'string' || ![row.bankBalance,row.deposited,row.withdrawn].every(money) || cents(row.bankBalance) !== cents(row.deposited) - cents(row.withdrawn) || !Number.isSafeInteger(row.transferCount) || row.transferCount < 0) throw Error('A business Bank balance could not be verified.');
    if (!value.totals || !['bankBalance','deposited','withdrawn'].every(key => money(value.totals[key]) && cents(value.totals[key]) === value.accounts.reduce((sum, row) => sum + cents(row[key]), 0))) throw Error('Bank totals do not match the selected business accounts.');
    for (const row of value.history) { validRecord(row); if (!value.workspaces.some(item => item.id === row.workspaceId) || selected !== 'all' && row.workspaceId !== selected) throw Error('A transfer belongs to a different business scope.'); }
    return value;
  }
  function validSources(value, selected) {
    if (!value || value.workspaceId !== selected || !money(value.bankBalance) || typeof value.workspaceName !== 'string' || typeof value.lockedOwner !== 'boolean' || !Array.isArray(value.holders) || new Set(value.holders.map(row => row?.accountKey)).size !== value.holders.length) throw Error('This business’s money sources could not be verified.');
    for (const row of value.holders) if (!identifier(row?.accountKey) || typeof row.name !== 'string' || !['admin','cashier'].includes(row.role) || !balance(row.cashBalance) || value.lockedOwner && row.accountKey !== account() || !Array.isArray(row.wallets) || row.wallets.some(wallet => !identifier(wallet?.id) || typeof wallet.label !== 'string' || !balance(wallet.balance) || typeof wallet.active !== 'boolean')) throw Error('A money holder or wallet could not be verified.');
    return value;
  }
  function validCollections(value, selected, overview) {
    const previous = new Date(value?.asOf + 'T12:00:00Z');
    if (!Number.isFinite(previous.getTime()) || previous.toISOString().slice(0,10) !== value.asOf) throw Error('The previous-month Bank balance date could not be verified.');
    previous.setUTCMonth(previous.getUTCMonth() - 1, 1);
    const ids = overview.accounts.map(row => row.workspaceId).sort();
    if (!value || value.basis !== 'prior_month_collection_custody' || value.scope !== selected || !month(value.month) || value.month !== previous.toISOString().slice(0,7) || value.currentHoldings !== false || value.includesCarriedMoney !== true || value.separateReceivable !== false || !Array.isArray(value.businesses) || JSON.stringify(value.businesses.map(row => row?.workspaceId).sort()) !== JSON.stringify(ids)) throw Error('The previous month’s business balances could not be verified.');
    for (const row of value.businesses) {
      const amounts = ['cash','whish','total','bankBalance'], opening = row.opening, available = row.availableToDeposit;
      if (!identifier(row.workspaceId) || typeof row.workspaceName !== 'string' || row.month !== value.month || row.asOf !== value.asOf || typeof row.available !== 'boolean' || !['ready','no_archive','legacy_zero','negative_opening'].includes(row.state) || (row.state === 'ready') !== row.available || typeof row.reason !== 'string' || amounts.some(key => !money(row[key])) || !opening || !available || ['cash','whish','total'].some(key => !money(opening[key]) || !money(available[key]) || cents(available[key]) > cents(row[key])) || cents(row.total) > cents(opening.total) || cents(row.cash) + cents(row.whish) !== cents(row.total) || cents(opening.cash) + cents(opening.whish) !== cents(opening.total) || cents(available.cash) + cents(available.whish) !== cents(available.total) || !/^[a-f0-9]{64}$/.test(row.proofHash || '') || !Array.isArray(row.sources) || row.sources.some(source => !identifier(source?.holderAccountKey) || typeof source.holderName !== 'string' || !['cash','whish'].includes(source.method) || typeof source.walletId !== 'string' || source.method === 'cash' && source.walletId !== '' || source.method === 'whish' && !identifier(source.walletId) || !money(source.remaining))) throw Error('A previous-month business money source could not be verified.');
      const keys = row.sources.map(source => JSON.stringify([source.holderAccountKey,source.method,source.walletId]));
      if (new Set(keys).size !== keys.length || ['cash','whish'].some(method => row.sources.filter(source => source.method === method).reduce((sum, source) => sum + BigInt(cents(source.remaining)), 0n) !== BigInt(cents(row[method]))) || !row.available && ['cash','whish','total'].some(key => cents(row[key]) !== 0) || cents(row.bankBalance) !== cents(overview.accounts.find(account => account.workspaceId === row.workspaceId)?.bankBalance)) throw Error('The previous-month balances do not match their business sources.');
    }
    if (!value.totals || ['cash','whish','total','bankBalance'].some(key => !money(value.totals[key]) || value.businesses.reduce((sum, row) => sum + BigInt(cents(row[key])),0n) !== BigInt(cents(value.totals[key])))) throw Error('The previous-month Bank totals could not be verified.');
    return value;
  }
  function businessBalances(value, selected) {
    const proof=value?.businessBalances;
    if(!proof||proof.basis!=='business_custody'||proof.scope!=='all_holders'||proof.workspaceId!==selected||value.workspaceId!==selected||!/^\d{4}-\d{2}-\d{2}$/.test(proof.asOf||'')||!balance(proof.cash)||!balance(proof.whish)||!Array.isArray(proof.wallets)||new Set(proof.wallets.map(row=>row?.id)).size!==proof.wallets.length||proof.wallets.some(row=>!identifier(row?.id)||!balance(row.balance)))return null;
    const date=new Date(proof.asOf+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==proof.asOf)return null;
    const total=proof.wallets.reduce((sum,row)=>sum+BigInt(cents(row.balance)),0n);
    return total===BigInt(cents(proof.whish))?proof:null;
  }
  function renderBusinessBalances(value=null, selected='', message='') {
    if(!el('bank-business-balances'))return;
    const proof=value?businessBalances(value,selected):null;
    el('bank-business-cash').textContent=proof?usd(proof.cash):'—';el('bank-business-whish').textContent=proof?usd(proof.whish):'—';
    el('bank-business-balance-scope').textContent=value?.workspaceId===selected?value.workspaceName:'Selected business';
    el('bank-business-balances').dataset.verified=String(Boolean(proof));
    el('bank-business-balances-note').textContent=proof?'Recorded balances · '+proof.asOf+' · all money holders. Choose the exact money holder and source for this transfer.':message||(value?'Business totals are unavailable. Update Main and this PC together to view them. You can still review a transfer from a verified individual source.':'Choose a business to see its recorded cash and Whish totals.');
  }
  function validPreview(value, input) {
    if (!value || !/^[a-f0-9]{64}$/i.test(value.token || '') || value.workspaceId !== input.workspaceId || value.holderAccountKey !== input.holderAccountKey || value.direction !== input.direction || value.method !== input.method || String(value.walletId || '') !== String(input.walletId || '') || cents(value.amount) !== cents(input.amount) || value.note !== input.note || ![value.amount,value.bankBefore,value.bankAfter].every(money) || ![value.sourceBefore,value.sourceAfter].every(balance) || value.direction === 'deposit' && value.sourceAfter < 0 || typeof value.workspaceName !== 'string' || typeof value.holderName !== 'string') throw Error('The reviewed business, amount or money source changed. Review the transfer again.');
    const sign = value.direction === 'deposit' ? 1 : -1;
    if (cents(value.bankAfter) !== cents(value.bankBefore) + sign * cents(value.amount) || cents(value.sourceAfter) !== cents(value.sourceBefore) - sign * cents(value.amount)) throw Error('The reviewed Bank transfer does not balance.');
    validCollectionProof(value,input);
    return value;
  }
  function validMarker(value) {
    if (!value || value.version !== 1 || value.accountKey !== account() || !requestId(value.requestId) || value.workspaceId !== value.input?.workspaceId || value.requestId !== value.input?.requestId || value.input?.confirmation !== 'TRANSFER BANK' || !/^[a-f0-9]{64}$/i.test(value.input?.token || '')) throw Error('The saved Bank request reference is damaged. Keep this PC’s app data and review it before making another transfer.');
    validInput(value.input); return value;
  }
  function restore() {
    storageKey = 'fiber-bank-request-v1:' + encodeURIComponent(JSON.stringify(['main', account()]));
    try { const raw = localStorage.getItem(storageKey); held = raw ? validMarker(JSON.parse(raw)) : null; }
    catch (error) { held = {corrupt:true, error:'Bank recovery storage is unavailable. New transfers are blocked. ' + errorText(error)}; }
  }
  function preserve(input) {
    if (held) throw Error('Resolve the original Bank request before entering another transfer.');
    const marker = validMarker({version:1, accountKey:account(), requestId:input.requestId, workspaceId:input.workspaceId, input});
    const raw = JSON.stringify(marker);
    try { localStorage.setItem(storageKey, raw); if (localStorage.getItem(storageKey) !== raw) throw Error('The Bank request was not retained.'); held = marker; }
    catch (error) { held = {corrupt:true, error:'The original Bank request could not be retained safely. No transfer was submitted. ' + errorText(error)}; throw error; }
  }
  function forget(marker) {
    if (!held || held.corrupt || held.requestId !== marker.requestId || held.workspaceId !== marker.workspaceId) return;
    localStorage.removeItem(storageKey);
    if (localStorage.getItem(storageKey) !== null) throw Error('The completed Bank reference could not be cleared. Check it before another transfer.');
    held = null;
  }
  function closeDialog(force = false) { if (busy && !force) return; formTicket++; sourceTicket++; previewTicket++; if (dialog) { dialog.close(); dialog.remove(); dialog = null; } sources = null; review = null; collectionMonth = ''; }
  function reset() {
    suspended = true; epoch++; loadTicket++; closeDialog(true); busy = false; loading = false; loaded = false; data = null; collections = null; held = null; serverPending = []; identity = ''; storageKey = ''; scope = 'all'; search = ''; directionFilter = 'all';
    if (host) { host.onclick = null; host.replaceChildren(); host.hidden = true; } host = null; config = null;
  }
  function suspend() { suspended = true; epoch++; loadTicket++; loading = false; busy = false; closeDialog(true); }
  function init(value) {
    reset(); config = value; host = typeof value?.container === 'string' ? el(value.container) : value?.container;
    if (!host) return; host.hidden = false; host.classList.add('bank-root');
    if (!permitted() || !config?.api?.overview) { host.textContent = 'Bank is available to the Main Office administrator only.'; return; }
    suspended = false; identity = identityOf(); restore(); mount();
  }
  function mount() {
    host.innerHTML = '<div class="bank-heading"><div><p class="eyebrow">MAIN OFFICE · ADMIN ONLY</p><h2>Bank</h2><p class="bank-note">Keep each business’s saved money in its own account.</p></div><button id="bank-back" class="button button-secondary" type="button">← Return to Main</button></div><p id="bank-status" class="bank-status" role="status" aria-live="polite" hidden></p><section id="bank-recovery" class="bank-recovery" aria-label="Bank transfer recovery" hidden></section><div class="bank-toolbar"><label>Business<select id="bank-business"><option value="all">All businesses</option></select></label><div class="bank-actions"><button id="bank-refresh" class="button button-secondary" type="button">Refresh balances</button><button id="bank-deposit" class="button button-primary" type="button">+ Deposit to Bank</button><button id="bank-withdraw" class="button button-secondary" type="button">Return money</button></div></div><section class="bank-metrics" aria-label="Selected Bank totals"><article class="metric-card bank-balance"><span>Money in Bank</span><strong id="bank-total">—</strong><small id="bank-scope">All businesses · saved money</small></article><article class="metric-card"><span>Total deposited</span><strong id="bank-deposited">—</strong><small>Moved from cash drawers and Whish wallets</small></article><article class="metric-card"><span>Total returned</span><strong id="bank-withdrawn">—</strong><small>Returned to the same business’s drawer or wallet</small></article></section><p id="bank-prior-policy" class="bank-note">The amounts inside each business card come only from the previous month’s verified carried money. New-month receipts are excluded. Outgoing payments reduce the older money first; money returned from Bank does not refill it. Use “Deposit to Bank” above for an ordinary deposit from current funds.</p><div id="bank-accounts" class="bank-accounts" aria-label="Business Bank accounts"></div><article class="panel bank-history"><div class="panel-heading stacked-mobile"><div><p class="eyebrow">EVERY MOVEMENT</p><h3>Bank transfer history</h3><p class="bank-note">Deposits and returns follow the selected business.</p></div><div class="bank-history-filters"><label class="search-box"><input id="bank-search" type="search" aria-label="Search Bank history" placeholder="Business, holder, note or reference" /></label><label><span class="sr-only">Transfer direction</span><select id="bank-direction" aria-label="Filter Bank transfer direction"><option value="all">All transfers</option><option value="deposit">Deposits</option><option value="withdraw">Returns</option></select></label></div></div><div class="table-wrap"><table class="bank-table"><thead><tr><th>DATE / BUSINESS</th><th>TRANSFER / MONEY SOURCE</th><th class="number">AMOUNT</th><th class="number">BANK AFTER</th><th>NOTE / REFERENCE</th></tr></thead><tbody id="bank-history-rows"></tbody></table></div></article><p class="bank-note bank-footnote">A Bank transfer moves existing money between the selected business’s balances. It does not create revenue, deduct profit, add expenses or charge Whish fees. No bank or provider transfer is sent by this bookkeeping entry.</p>';
    el('bank-back').onclick = () => { if (!busy) config.onBack?.(); };
    el('bank-refresh').onclick = () => load();
    el('bank-business').onchange = () => { scope = el('bank-business').value; loaded = false; void load(); };
    el('bank-deposit').onclick = () => openTransfer('deposit', scope === 'all' ? '' : scope);
    el('bank-withdraw').onclick = () => openTransfer('withdraw', scope === 'all' ? '' : scope);
    el('bank-search').oninput = () => { search = el('bank-search').value; renderHistory(); };
    el('bank-direction').onchange = () => { directionFilter = el('bank-direction').value; renderHistory(); };
    host.onclick = event => {
      const button = event.target.closest('[data-bank-deposit],[data-bank-collect],[data-bank-withdraw],[data-bank-check],[data-bank-resume],[data-bank-retry],[data-bank-discard]');
      if (!button || button.disabled || !host.contains(button) || !allowed()) return;
      if (button.dataset.bankCollect) {
        const row = collections?.businesses.find(row => row.workspaceId === button.dataset.bankCollect), method = button.dataset.bankMethod;
        if (row?.available && ['cash','whish'].includes(method) && row.availableToDeposit[method] > 0) openTransfer('deposit',row.workspaceId,{method,collectionMonth:row.month});
      }
      else if (button.dataset.bankDeposit) openTransfer('deposit', button.dataset.bankDeposit);
      else if (button.dataset.bankWithdraw) openTransfer('withdraw', button.dataset.bankWithdraw);
      else if (button.hasAttribute('data-bank-retry')) retryOriginal();
      else if (button.hasAttribute('data-bank-discard')) discardOriginal();
      else { const marker = button.dataset.bankCheck === 'local' || button.dataset.bankResume === 'local' ? held : serverPending.find(row => row.requestId === (button.dataset.bankCheck || button.dataset.bankResume)); if (marker) checkSaved(marker, button.hasAttribute('data-bank-resume')); }
    };
    render();
  }
  function controls() {
    if (!host || !el('bank-refresh')) return;
    host.setAttribute('aria-busy', String(loading || busy));
    el('bank-refresh').disabled = !allowed() || loading || busy;
    el('bank-business').disabled = !allowed() || loading || busy;
    for (const button of host.querySelectorAll('[data-bank-deposit],[data-bank-collect],[data-bank-withdraw],#bank-deposit,#bank-withdraw')) button.disabled = blocked() || button.dataset.bankWithdraw && !data?.accounts.find(row => row.workspaceId === button.dataset.bankWithdraw)?.bankBalance || button.dataset.bankCollect && !collections?.businesses.find(row => row.workspaceId === button.dataset.bankCollect)?.availableToDeposit?.[button.dataset.bankMethod];
    for (const button of host.querySelectorAll('[data-bank-check],[data-bank-resume],[data-bank-retry],[data-bank-discard]')) button.disabled = !allowed() || busy || loading;
    if (dialog) { for (const field of dialog.querySelectorAll('input,select,textarea,button')) field.disabled = busy; if (collectionMonth && el('bank-transfer-business')) el('bank-transfer-business').disabled = true; if (el('bank-review')) el('bank-review').disabled = busy || !sources; if (el('bank-confirm')) el('bank-confirm').disabled = busy || !review || !el('bank-ack').checked; if (el('bank-discard-confirm')) el('bank-discard-confirm').disabled = busy || !el('bank-discard-ack').checked; }
  }
  function renderRecovery() {
    const box = el('bank-recovery'); if (!box) return;
    box.hidden = !held && !serverPending.length;
    let html = '';
    if (held?.corrupt) html += '<h3>Review the saved Bank request</h3><p>' + esc(held.error) + '</p>';
    else if (held) html += '<h3>Original transfer needs confirmation</h3><p>Do not enter a replacement. Check the saved request first.</p><p class="bank-reference">' + esc(held.workspaceId) + ' · ' + esc(held.requestId) + '</p><div class="bank-actions"><button class="button button-secondary" type="button" data-bank-check="local">Check saved transfer</button>' + (held.checkedState === 'save_required' ? '<button class="button button-primary" type="button" data-bank-resume="local">Finish saving original transfer</button>' : '') + (held.checkedState === 'not_found' ? '<button class="button button-secondary" type="button" data-bank-retry>Retry original request</button>' : '') + (held.canRelease ? '<button class="button button-secondary" type="button" data-bank-discard>Discard unsaved request</button>' : '') + '</div>';
    for (const row of serverPending) if (row.requestId !== held?.requestId) html += '<div class="bank-server-pending"><strong>Original transfer is awaiting a durable save</strong><p class="bank-reference">' + esc(row.workspaceId) + ' · ' + esc(row.requestId) + '</p><button class="button button-secondary" type="button" data-bank-resume="' + esc(row.requestId) + '">Finish saving transfer</button></div>';
    box.innerHTML = html;
  }
  function collectionCard(id) {
    const row = collections?.businesses.find(row => row.workspaceId === id);
    if (!row) return '<p class="bank-note">Previous-month money is unavailable. Refresh this Bank account.</p>';
    if (!row.available) return '<section class="bank-prior-month" data-bank-prior="' + esc(id) + '"><h4>From last month · ' + esc(row.month) + '</h4><p class="bank-note">' + esc(row.reason || 'A verified carry-forward archive is needed for this month.') + '</p></section>';
    return '<section class="bank-prior-month" data-bank-prior="' + esc(id) + '"><h4>From last month · ' + esc(row.month) + '</h4><div class="bank-prior-balances"><div><span>Cash remaining</span><strong data-bank-prior-cash>' + usd(row.cash) + '</strong></div><div><span>Whish remaining</span><strong data-bank-prior-whish>' + usd(row.whish) + '</strong></div></div><p class="bank-prior-total"><span>Remaining to collect</span><strong data-bank-prior-total>' + usd(row.total) + '</strong></p><div class="bank-actions"><button type="button" class="button button-primary" data-bank-collect="' + esc(id) + '" data-bank-method="cash">Deposit last month’s cash</button><button type="button" class="button button-secondary" data-bank-collect="' + esc(id) + '" data-bank-method="whish">Deposit last month’s Whish</button></div>' + (row.total > 0 && row.availableToDeposit.total === 0 ? '<p class="bank-note">This money is not held in a permitted deposit source. Review its money holder before depositing.</p>' : '') + '</section>';
  }
  function render() {
    if (!host || !el('bank-total')) return;
    renderRecovery();
    if (data && loaded) {
      const old = el('bank-business').value;
      el('bank-business').innerHTML = '<option value="all">All businesses</option>' + data.workspaces.map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>').join('');
      el('bank-business').value = data.workspaces.some(row => row.id === scope) || scope === 'all' ? scope : old;
      el('bank-total').textContent = usd(data.totals.bankBalance); el('bank-deposited').textContent = usd(data.totals.deposited); el('bank-withdrawn').textContent = usd(data.totals.withdrawn);
      el('bank-scope').textContent = (scope === 'all' ? 'All businesses' : data.workspaces.find(row => row.id === scope)?.name || scope) + ' · saved money';
      el('bank-accounts').innerHTML = data.accounts.map(row => '<article class="bank-account" data-bank-account="' + esc(row.workspaceId) + '"><div class="bank-account-title"><span class="bank-account-icon" aria-hidden="true">▥</span><h3>' + esc(row.workspaceName) + '</h3></div><p class="bank-account-amount" data-bank-account-balance>' + usd(row.bankBalance) + '</p><p class="bank-note">Saved in Bank · ' + row.transferCount + ' recorded transfer' + (row.transferCount === 1 ? '' : 's') + '</p>' + collectionCard(row.workspaceId) + '<div class="bank-actions"><button type="button" class="button button-secondary" data-bank-withdraw="' + esc(row.workspaceId) + '">Return money</button></div></article>').join('');
    } else {
      for (const id of ['bank-total','bank-deposited','bank-withdrawn']) el(id).textContent = '—';
      el('bank-accounts').innerHTML = '<p class="bank-note">' + (loading ? 'Loading verified Bank balances…' : 'Refresh to load the Bank accounts.') + '</p>';
    }
    renderHistory(); controls();
  }
  function renderHistory() {
    if (!el('bank-history-rows')) return;
    const query = search.trim().toLowerCase();
    const rows = loaded ? data.history.filter(row => (directionFilter === 'all' || row.direction === directionFilter) && (!query || [row.workspaceName,row.holderName,row.walletLabel,row.note,row.requestId].join(' ').toLowerCase().includes(query))) : [];
    el('bank-history-rows').innerHTML = rows.map(row => '<tr><td data-label="Date / business"><strong>' + esc(row.workspaceName) + '</strong><small>' + esc(new Date(row.createdAt).toLocaleString()) + '</small></td><td data-label="Transfer / source"><span class="bank-tag bank-tag-' + esc(row.direction) + '">' + directionName(row.direction) + '</span><small>' + esc(row.holderName) + ' · ' + methodName(row.method) + (row.method === 'whish' ? ' · ' + esc(row.walletLabel || 'Whish') : '') + '</small></td><td class="number" data-label="Amount">' + usd(row.amount) + '</td><td class="number" data-label="Bank after">' + usd(row.bankAfter) + '</td><td data-label="Note / reference">' + esc(row.note) + '<small class="bank-reference">' + esc(row.requestId) + '</small><small>Recorded by ' + esc(row.actorName || 'Admin') + '</small></td></tr>').join('') || '<tr><td colspan="5"><div class="empty-state"><strong>' + (loaded ? data.history.length ? 'No transfers match these filters.' : 'No Bank transfers yet.' : 'Load the ledger to see verified transfers.') + '</strong></div></td></tr>';
  }
  async function load() {
    if (!allowed() || busy) return;
    const stamp = capture(), selected = scope, ticket = ++loadTicket; loading = true; render(); status('');
    try {
      if (typeof config.api.pending === 'function') {
        const pending = await config.api.pending();
        if (!current(stamp) || ticket !== loadTicket) return;
        if (!pending || !Array.isArray(pending.requests) || pending.requests.some(row => !identifier(row?.workspaceId) || !requestId(row.requestId) || row.state !== 'save_required')) throw Error('Saved Bank recovery requests could not be verified.');
        serverPending = pending.requests;
      }
      const hasCollectionApi = typeof config.api.collectionOverview === 'function';
      const [bankValue, collectionValue] = await Promise.all([config.api.overview({workspaceId:selected}),hasCollectionApi ? config.api.collectionOverview({workspaceId:selected}) : Promise.resolve(null)]);
      if (!current(stamp) || ticket !== loadTicket) return;
      const value = validOverview(bankValue, selected), previous = hasCollectionApi ? validCollections(collectionValue,selected,value) : null;
      data = value; collections = previous; loaded = true;
    } catch (error) { if (current(stamp) && ticket === loadTicket) { loaded = false; status(errorText(error), true); } }
    finally { if (current(stamp) && ticket === loadTicket) { loading = false; render(); } }
  }
  async function open() {
    if (!permitted() || !host) return;
    suspended = false;
    if (identity !== identityOf()) { epoch++; identity = identityOf(); data = null; loaded = false; restore(); }
    host.hidden = false; await load();
  }
  async function openDeposit(preset = {}) {
    if (!permitted() || !host || !config?.api?.overview) throw Error('Only the Main Office administrator can add dashboard money to Bank.');
    if (!preset || typeof preset !== 'object' || Array.isArray(preset) || Object.keys(preset).some(key => !['workspaceId','holderAccountKey','method','walletId'].includes(key))) throw Error('Choose a valid dashboard Bank source.');
    const method = preset.method ?? 'cash', selected = preset.workspaceId === 'all' || preset.workspaceId === undefined ? '' : preset.workspaceId;
    if (!['cash','whish'].includes(method) || selected && !identifier(selected) || preset.holderAccountKey !== undefined && !identifier(preset.holderAccountKey) || preset.walletId !== undefined && !identifier(preset.walletId) || preset.holderAccountKey && !selected || preset.walletId && (method !== 'whish' || !selected || !preset.holderAccountKey)) throw Error('Choose one business and money holder before using a specific Bank source.');
    if (busy || loading || dialog) throw Error('Finish the open Bank form before starting another deposit.');
    suspended = false;
    if (identity !== identityOf()) { epoch++; identity = identityOf(); data = null; loaded = false; restore(); }
    await load();
    if (!allowed() || identity !== identityOf()) throw Error('Your Bank access changed. Refresh and choose the source again.');
    if (held || serverPending.length) throw Error('Open Main Office → Bank and finish the original saved request before adding more money.');
    if (blocked() || !data) throw Error('Bank balances are unavailable. Refresh Bank before adding dashboard money.');
    if (selected && !data.workspaces.some(row => row.id === selected)) throw Error('This dashboard business is no longer available for Bank.');
    await openTransfer('deposit', selected, {...preset, method});
  }
  function modal(title, body) {
    closeDialog(); dialog = document.createElement('dialog'); dialog.className = 'modal bank-dialog'; dialog.setAttribute('aria-labelledby','bank-dialog-title');
    dialog.innerHTML = '<div class="modal-heading"><div><p class="eyebrow">MAIN OFFICE · BANK</p><h2 id="bank-dialog-title">' + esc(title) + '</h2></div><button id="bank-dialog-close" class="button button-secondary" type="button">Close</button></div>' + body;
    document.body.append(dialog); el('bank-dialog-close').onclick = () => closeDialog(); dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); }); dialog.showModal();
  }
  async function openTransfer(direction, selected, preset = {}) {
    if (blocked()) return;
    modal(directionName(direction), '<p class="bank-warning">Move existing money for one business only. Both balances update together; profit, revenue, expenses and Whish fees stay unchanged.</p><form id="bank-transfer-form"><div class="bank-fields"><label>Business<select id="bank-transfer-business" required><option value="">Choose business</option>' + data.workspaces.map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>').join('') + '</select></label><label>Money held by<select id="bank-holder" required><option value="">Choose business first</option></select></label><section id="bank-business-balances" class="bank-business-balances bank-wide" aria-label="Selected business recorded balances" data-verified="false"><p id="bank-business-balance-scope" class="bank-business-balance-scope">Selected business</p><div class="bank-business-balance-cards"><article><span>Cash drawer</span><strong id="bank-business-cash">—</strong></article><article><span>Whish wallets</span><strong id="bank-business-whish">—</strong></article></div><p id="bank-business-balances-note" class="bank-note" role="status" aria-live="polite">Choose a business to see its recorded cash and Whish totals.</p></section><label>' + (direction === 'deposit' ? 'Take money from' : 'Return money to') + '<select id="bank-method"><option value="cash">Cash drawer</option><option value="whish">Whish Money wallet</option></select></label><label id="bank-wallet-field" hidden>Selected holder’s wallet<select id="bank-wallet"><option value="">Choose wallet</option></select></label><label>Amount (USD)<input id="bank-amount" type="number" inputmode="decimal" min="0.01" max="1000000000" step="0.01" required /></label><label class="bank-wide">Transfer note<input id="bank-note" maxlength="1000" placeholder="For example: end-of-day savings" required /></label></div><p id="bank-source-note" class="bank-note" role="status"></p><div id="bank-impact" class="bank-preview" hidden></div><p id="bank-form-error" class="form-error" role="status" aria-live="polite"></p><label id="bank-ack-field" class="bank-check" hidden><input id="bank-ack" type="checkbox" />I reviewed the business, exact money source and both balances.</label><div class="bank-actions bank-dialog-actions"><button id="bank-review" class="button button-secondary" type="button">Review transfer</button><button id="bank-confirm" class="button button-primary" type="submit" disabled>Confirm ' + (direction === 'deposit' ? 'deposit' : 'return') + '</button></div></form>');
    collectionMonth = preset.collectionMonth || '';
    const form = formTicket, stamp = capture(); el('bank-transfer-business').value = selected; if (preset.method) el('bank-method').value = preset.method;
    if (collectionMonth) {
      el('bank-dialog-title').textContent = 'Deposit last month’s money'; el('bank-transfer-business').disabled = true;
      const row = collections?.businesses.find(row => row.workspaceId === selected && row.month === collectionMonth && row.available);
      const notice = document.createElement('section'); notice.className = 'bank-prior-limit'; notice.id = 'bank-prior-transfer';
      notice.innerHTML = '<h3>From last month · ' + esc(collectionMonth) + '</h3><p class="bank-note">New receipts are excluded from this deposit. Choose an exact holder and source, then enter the amount to move.</p><div class="bank-prior-balances"><div><span>Cash remaining</span><strong>' + (row ? usd(row.cash) : '—') + '</strong></div><div><span>Whish remaining</span><strong>' + (row ? usd(row.whish) : '—') + '</strong></div></div><p id="bank-prior-source-limit" class="bank-note" role="status"></p>';
      el('bank-transfer-form').prepend(notice); el('bank-note').value = 'Previous-month collection · ' + collectionMonth;
    }
    const invalidate = () => { review = null; previewTicket++; el('bank-ack').checked = false; el('bank-ack-field').hidden = true; el('bank-impact').hidden = true; el('bank-form-error').textContent = ''; controls(); };
    el('bank-transfer-business').onchange = () => { invalidate(); void loadSources(el('bank-transfer-business').value, form, stamp); };
    el('bank-holder').onchange = () => { invalidate(); populateWallets(); sourceNote(direction); };
    el('bank-method').onchange = () => { invalidate(); populateWallets(); sourceNote(direction); };
    el('bank-wallet').onchange = () => { invalidate(); sourceNote(direction); };
    for (const id of ['bank-amount','bank-note']) el(id).oninput = invalidate;
    el('bank-ack').onchange = controls;
    el('bank-review').onclick = () => reviewTransfer(direction, form, stamp);
    el('bank-transfer-form').onsubmit = event => { event.preventDefault(); void commitTransfer(direction, form, stamp); };
    if (selected) await loadSources(selected, form, stamp);
    if (preset.holderAccountKey || preset.walletId) {
      if (!current(stamp) || form !== formTicket || !dialog || !sources) throw Error('The dashboard source could not be verified. Choose it again.');
      if (preset.holderAccountKey) {
        if (!sources.holders.some(row => row.accountKey === preset.holderAccountKey)) { el('bank-holder').value = ''; populateWallets(); el('bank-form-error').textContent = 'This dashboard money holder is no longer available. Choose an authorized holder explicitly.'; throw Error(el('bank-form-error').textContent); }
        el('bank-holder').value = preset.holderAccountKey;
      }
      populateWallets();
      if (preset.walletId) {
        const holder = sources.holders.find(row => row.accountKey === el('bank-holder').value);
        if (!holder?.wallets.some(row => row.active && row.id === preset.walletId)) { el('bank-wallet').value = ''; el('bank-form-error').textContent = 'This dashboard wallet is no longer available for the selected holder. Choose a wallet explicitly.'; throw Error(el('bank-form-error').textContent); }
        el('bank-wallet').value = preset.walletId;
      }
      sourceNote(direction); controls();
    }
  }
  async function loadSources(selected, form, stamp) {
    const ticket = ++sourceTicket; sources = null;
    renderBusinessBalances(null,selected,selected?'Loading this business’s recorded balances…':'Choose a business to see its recorded cash and Whish totals.');
    el('bank-holder').innerHTML = '<option value="">' + (selected ? 'Loading money holders…' : 'Choose business first') + '</option>';
    populateWallets();
    el('bank-source-note').textContent = selected ? 'Verifying this business’s balances…' : ''; el('bank-review').disabled = true;
    if (!selected) return;
    try {
      const value = validSources(await config.api.sources({workspaceId:selected}), selected);
      if (!current(stamp) || form !== formTicket || ticket !== sourceTicket || !dialog) return;
      sources = value; renderBusinessBalances(value,selected); el('bank-holder').innerHTML = '<option value="">Choose money holder</option>' + value.holders.map(row => '<option value="' + esc(row.accountKey) + '">' + esc(row.name) + ' · ' + esc(row.role === 'admin' ? 'Admin' : 'Cashier') + '</option>').join('');
      if (value.holders.length === 1) el('bank-holder').value = value.holders[0].accountKey;
      populateWallets(); sourceNote(el('bank-dialog-title').textContent.startsWith('Deposit') ? 'deposit' : 'withdraw');
    } catch (error) { if (current(stamp) && form === formTicket && ticket === sourceTicket && dialog) { renderBusinessBalances(null,selected,'This business’s recorded balances are unavailable. Choose the business again to refresh.'); el('bank-holder').innerHTML = '<option value="">Money holders unavailable</option>'; el('bank-source-note').textContent = 'Money sources are unavailable. Choose the business again to refresh.'; el('bank-form-error').textContent = errorText(error); } }
    finally { if (current(stamp) && form === formTicket && ticket === sourceTicket && dialog) el('bank-review').disabled = !sources; }
  }
  function populateWallets() {
    const holder = sources?.holders.find(row => row.accountKey === el('bank-holder').value), old = el('bank-wallet').value;
    const wallets = holder?.wallets.filter(row => row.active) || [];
    el('bank-wallet-field').hidden = el('bank-method').value !== 'whish';
    el('bank-wallet').innerHTML = '<option value="">Choose wallet</option>' + wallets.map(row => '<option value="' + esc(row.id) + '">' + esc(row.label) + ' · ' + usd(row.balance) + '</option>').join('');
    if (wallets.some(row => row.id === old)) el('bank-wallet').value = old; else if (wallets.length === 1) el('bank-wallet').value = wallets[0].id;
  }
  function sourceNote(direction) {
    const holder = sources?.holders.find(row => row.accountKey === el('bank-holder').value), wallet = holder?.wallets.find(row => row.id === el('bank-wallet').value), method = el('bank-method').value;
    el('bank-source-note').textContent = !sources ? '' : (sources.lockedOwner ? 'This business uses the approving Admin’s collected funds. ' : 'Choose this business’s active Cashier or your own Admin funds. ') + 'Bank: ' + usd(sources.bankBalance) + (holder ? ' · ' + holder.name + ' · ' + (method === 'cash' ? 'Cash: ' + usd(holder.cashBalance) : wallet ? wallet.label + ': ' + usd(wallet.balance) : 'Choose a wallet') : '') + (direction === 'withdraw' ? '. The return stays in this business.' : '');
    if (collectionMonth && el('bank-prior-source-limit')) {
      const row = collections?.businesses.find(row => row.workspaceId === el('bank-transfer-business').value && row.month === collectionMonth), old = row?.sources.find(source => source.holderAccountKey === holder?.accountKey && source.method === method && source.walletId === (method === 'whish' ? el('bank-wallet').value : ''));
      el('bank-prior-source-limit').textContent = holder ? 'Available from ' + collectionMonth + ' in this exact source: ' + usd(old?.remaining || 0) + '.' : 'Choose a money holder to see the previous-month amount available from that source.';
      el('bank-amount').max = String(old?.remaining || 0);
    }
  }
  function formInput(direction) {
    return validInput({workspaceId:el('bank-transfer-business').value, holderAccountKey:el('bank-holder').value, method:el('bank-method').value, walletId:el('bank-method').value === 'whish' ? el('bank-wallet').value : '', direction, amount:Number(el('bank-amount').value), note:el('bank-note').value.trim(),...collectionMonth ? {collectionMonth} : {}});
  }
  async function reviewTransfer(direction, form, stamp) {
    if (!current(stamp) || form !== formTicket || busy || held || serverPending.length) return;
    let input; try { input = formInput(direction); } catch (error) { el('bank-form-error').textContent = errorText(error); return; }
    const ticket = ++previewTicket; busy = true; review = null; controls(); el('bank-form-error').textContent = '';
    try {
      const value = validPreview(await config.api.preview(input), input);
      if (!current(stamp) || form !== formTicket || ticket !== previewTicket || !dialog) return;
      review = {...value, input};
      const source = methodName(value.method) + (value.method === 'whish' ? ' · ' + (value.walletLabel || 'Whish') : '');
      el('bank-impact').innerHTML = '<h3>' + esc(value.workspaceName) + ' · ' + usd(value.amount) + '</h3><p class="bank-note">' + esc(value.holderName) + ' · ' + esc(source) + '</p><div class="bank-preview-line"><span>' + esc(source) + ' before</span><strong>' + usd(value.sourceBefore) + '</strong></div><div class="bank-preview-line"><span>' + esc(source) + ' after</span><strong>' + usd(value.sourceAfter) + '</strong></div><div class="bank-preview-line bank-preview-total"><span>Bank before</span><strong>' + usd(value.bankBefore) + '</strong></div><div class="bank-preview-line"><span>Bank after</span><strong>' + usd(value.bankAfter) + '</strong></div>';
      if (input.collectionMonth) el('bank-impact').insertAdjacentHTML('beforeend','<div class="bank-preview-line bank-preview-total"><span>Previous-month source remaining after deposit</span><strong>' + usd(value.collectionAfter) + '</strong></div>');
      el('bank-impact').hidden = false; el('bank-ack-field').hidden = false; el('bank-ack').checked = false;
    } catch (error) { if (current(stamp) && form === formTicket && dialog) el('bank-form-error').textContent = errorText(error); }
    finally { if (current(stamp) && form === formTicket) { busy = false; controls(); } }
  }
  async function commitTransfer(direction, form, stamp) {
    if (!current(stamp) || form !== formTicket || busy || !review || !el('bank-ack').checked || held || serverPending.length) return;
    let input;
    try { input = formInput(direction); validPreview(review, input); input = {...input, token:review.token, requestId:'bank-' + crypto.randomUUID(), confirmation:'TRANSFER BANK'}; preserve(input); }
    catch (error) { el('bank-form-error').textContent = errorText(error); renderRecovery(); controls(); return; }
    busy = true; controls();
    try {
      const result = await config.api.transfer(input);
      if (!current(stamp) || form !== formTicket) return;
      await completed(result, held);
    } catch (error) {
      if (!current(stamp) || form !== formTicket) return;
      status('The result is unconfirmed. Keep the original request and check it before another transfer. ' + errorText(error), true); notify('Check the original Bank request before entering another transfer.', true);
    } finally { if (current(stamp)) { busy = false; closeDialog(); renderRecovery(); controls(); if (!held) await load(); } }
  }
  async function completed(result, marker) {
    if (!result || result.state !== 'completed') throw Error('The Bank transfer is awaiting its durable save.');
    const row = validRecord(result.result || result);
    if (marker && (row.workspaceId !== marker.workspaceId || row.requestId !== marker.requestId || marker.input && (row.direction !== marker.input.direction || row.method !== marker.input.method || row.holderAccountKey !== marker.input.holderAccountKey || String(row.walletId || '') !== String(marker.input.walletId || '') || cents(row.amount) !== cents(marker.input.amount) || row.note !== marker.input.note || (row.collectionMonth || '') !== (marker.input.collectionMonth || '')))) throw Error('The completed transfer differs from the original reviewed request.');
    if (marker) forget(marker); serverPending = serverPending.filter(value => value.requestId !== row.requestId || value.workspaceId !== row.workspaceId);
    status(directionName(row.direction) + ' saved: ' + usd(row.amount) + ' · ' + row.workspaceName + '.'); notify('Bank transfer saved.');
    try { await config.refresh?.(); } catch { notify('Bank transfer is saved. Refresh the main balances when ready.'); }
  }
  async function checkSaved(marker, resume = false) {
    if (!allowed() || busy || !marker || marker.corrupt) return;
    const stamp = capture(); busy = true; controls();
    try {
      const result = await config.api[resume ? 'resume' : 'status']({workspaceId:marker.workspaceId, requestId:marker.requestId});
      if (!current(stamp)) return;
      if (result?.state === 'completed') await completed(result, marker);
      else if (result?.state === 'save_required') { if (held?.requestId === marker.requestId) held.checkedState = 'save_required'; status('The original money movement is recorded in memory. Finish saving it; do not enter a replacement.', true); }
      else if (result?.state === 'not_found' && result.requestId === marker.requestId) { if (held?.requestId === marker.requestId) { held.checkedState = 'not_found'; held.canRelease = result.canRelease === true; } status('No saved transfer was found for the original reference. Retry that exact request, or discard it only after reviewing this result.'); }
      else throw Error('The saved Bank request status could not be verified.');
    } catch (error) { if (current(stamp)) status(errorText(error), true); }
    finally { if (current(stamp)) { busy = false; renderRecovery(); controls(); if (!held && !serverPending.length) await load(); } }
  }
  async function retryOriginal() {
    if (!allowed() || busy || held?.checkedState !== 'not_found' || !held.input) return;
    const stamp = capture(), marker = held; busy = true; controls();
    try { const result = await config.api.transfer({...marker.input}); if (!current(stamp)) return; await completed(result, marker); }
    catch (error) { if (current(stamp)) status('The original request remains held. Check its saved status. ' + errorText(error), true); }
    finally { if (current(stamp)) { busy = false; renderRecovery(); controls(); if (!held) await load(); } }
  }
  function discardOriginal() {
    if (!allowed() || busy || !held?.canRelease || held.checkedState !== 'not_found') return;
    const marker = held;
    modal('Discard an unsaved request', '<p class="bank-warning">The server reported that this original reference has no saved Bank transfer. Discarding this local request does not move money.</p><p class="bank-reference">' + esc(marker.workspaceId) + ' · ' + esc(marker.requestId) + '</p><label class="bank-check"><input id="bank-discard-ack" type="checkbox" />I reviewed the saved-request check and want to discard this unsaved request.</label><div class="bank-actions bank-dialog-actions"><button id="bank-discard-confirm" class="button button-primary" type="button" disabled>Discard unsaved request</button></div>');
    el('bank-discard-ack').onchange = () => { el('bank-discard-confirm').disabled = !el('bank-discard-ack').checked; };
    el('bank-discard-confirm').onclick = async () => {
      if (!el('bank-discard-ack').checked || busy) return;
      const stamp = capture(); busy = true; controls();
      try { const result = await config.api.status({workspaceId:marker.workspaceId, requestId:marker.requestId}); if (!current(stamp)) return; if (result?.state !== 'not_found' || result.requestId !== marker.requestId || result.canRelease !== true) throw Error('The original transfer can no longer be discarded. Check its saved status.'); forget(marker); status('Unsaved request discarded. No money was moved.'); }
      catch (error) { if (current(stamp)) status(errorText(error), true); }
      finally { if (current(stamp)) { busy = false; closeDialog(); renderRecovery(); controls(); if (!held) await load(); } }
    };
  }
  function updateUser(value) {
    if (!config) return;
    if (identityOf() !== identity) init({...config,user:value});
    else config.user = value;
  }
  return {init, open, openDeposit, load, reset, suspend, updateUser, hasPending:() => Boolean(held) || serverPending.length > 0 || busy};
})();
