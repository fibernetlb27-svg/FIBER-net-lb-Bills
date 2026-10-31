// Admin-only, audited POS invoice reversal. Never delete or refund twice.
window.InvoiceVoids = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
  const message = error => error?.message || String(error);
  const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
  const safeMoney = (value, signed = false) => typeof value === 'number' && Number.isFinite(value) && (signed || value >= 0) && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
  let config, mounted = false, suspended = true, identity = '', epoch = 0, previewTicket = 0, pendingTicket = 0;
  let target = null, preview = null, receiptScope = null, fromReceipt = false, held = null, pending = [], prefix = '', pendingError = '', checkedPending = false, loadingPending = false, pendingRequest = null, previewLoading = false, busy = false;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const api = () => config?.api?.invoiceVoids;
  const available = () => !suspended && Boolean(api()) && user()?.active !== false && user()?.role === 'admin' && Boolean(workspace()?.id);
  const identityOf = () => JSON.stringify([workspace()?.id,user()?.accountKey || user()?.id || user()?.username,user()?.role,user()?.active,[...(user()?.permissions || [])].sort(),[...(user()?.allowedSections || [])].sort()]);
  const current = (key, generation) => available() && identity === key && identityOf() === key && epoch === generation;
  const locked = () => busy || previewLoading || loadingPending || Boolean(held) || !checkedPending || Boolean(pendingError) || pending.length > 0;
  const toast = (text, error = false) => config?.toast?.(text, error ? 'error' : undefined);
  const knownWorkspace = id => typeof id === 'string' && id.length > 0 && ((config?.sections || []).some(row => row.id === id) || id === workspace()?.id);
  const scopeValid = scope => scope && knownWorkspace(scope.workspaceId) && Number.isSafeInteger(scope.saleId) && scope.saleId > 0 && (workspace()?.id === 'main' || scope.workspaceId === workspace()?.id);
  const sameScope = (a, b) => a?.workspaceId === b?.workspaceId && a?.saleId === b?.saleId;
  const scopeName = id => (config?.sections || []).find(row => row.id === id)?.name || id;
  const showDialog = id => { if (!el(id).open) el(id).showModal(); };
  function addDialog(id, title, body) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'modal invoice-void-dialog'; node.setAttribute('aria-labelledby', id + '-title');
    node.innerHTML = `<div class="modal-heading"><div><p class="eyebrow">ADMIN · AUDITED INVOICE REVERSAL</p><h2 id="${id}-title">${title}</h2></div><button type="button" class="button button-secondary" data-iv-close>Close</button></div>${body}`;
    document.body.append(node); node.querySelector('[data-iv-close]').onclick = () => { if (!busy) node.close(); };
    node.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  function mount() {
    if (mounted) return; mounted = true;
    const button = document.createElement('button'); button.id = 'invoice-void-receipt-delete'; button.type = 'button'; button.className = 'button invoice-void-danger hidden'; button.textContent = 'Delete invoice';
    el('print-receipt').before(button); button.onclick = () => receiptScope && open({...receiptScope},true);
    const banner = document.createElement('article'); banner.id = 'invoice-void-recovery'; banner.className = 'invoice-void-recovery hidden';
    banner.innerHTML = '<div><p class="eyebrow">INVOICE REVERSAL RECOVERY</p><h3 id="iv-recovery-title">Check the original request</h3><p id="iv-recovery-note" role="status"></p></div><div class="invoice-void-actions"><button id="iv-held-check" type="button" class="button button-secondary">Check saved result</button><button id="iv-pending-open" type="button" class="button button-secondary">Review unfinished reversals</button><button id="iv-release-open" type="button" class="button button-secondary hidden">Release after checking records</button></div>';
    el('view-dashboard').prepend(banner);
    addDialog('invoice-void-dialog', 'Delete POS invoice', '<p id="iv-target" class="subtext"></p><p class="invoice-void-warning">This reverses the app’s invoice records. It does not send a bank/Whish refund or undo any Internet/provider action. Audit copies remain preserved.</p><div id="iv-effects" class="invoice-void-effects"></div><p id="iv-preview-error" class="form-error" role="alert"></p><form id="iv-form"><label class="invoice-void-field">Reason for deleting this invoice<textarea id="iv-reason" rows="3" maxlength="1000" required></textarea></label><label id="iv-goods-field" class="invoice-void-check hidden"><input id="iv-goods" type="checkbox" /><span>I confirm the listed physical goods have been returned to stock.</span></label><label class="invoice-void-field">Type DELETE INVOICE to confirm<input id="iv-confirmation" autocomplete="off" spellcheck="false" required pattern="DELETE INVOICE" /></label><p id="iv-submit-error" class="form-error" role="alert"></p><div class="modal-actions"><button id="iv-preview-refresh" type="button" class="button button-secondary">Refresh preview</button><button id="iv-submit" type="submit" class="button invoice-void-danger" disabled>Delete invoice &amp; reverse records</button></div></form>');
    addDialog('invoice-void-pending', 'Unfinished invoice reversals', '<p class="subtext">Resume the original request only. A completed-but-unanswered request may not appear in Main’s pending list; check this PC’s held request too.</p><p id="iv-pending-error" class="form-error" role="alert"></p><div id="iv-pending-list" class="invoice-void-pending-list"></div>');
    addDialog('invoice-void-release', 'Release an unsaved reversal request', '<p id="iv-release-note"></p><label class="invoice-void-check"><input id="iv-release-checked" type="checkbox" /><span>I checked the invoice, stock, debts and account balances. No reversal was saved for this exact request.</span></label><p id="iv-release-error" class="form-error" role="alert"></p><div class="modal-actions"><button id="iv-release-confirm" type="button" class="button button-secondary" disabled>Release request — do not repeat it</button></div>');
    el('iv-form').onsubmit = remove;
    el('iv-reason').minLength = 5;
    el('iv-reason').previousSibling.textContent = 'Reason for deleting this invoice · at least 5 characters';
    el('iv-goods').nextElementSibling.textContent = 'I confirm these goods were returned or were never issued. Restore their stock count once.';
    for (const [id,label,handler] of [['iv-dialog-check','Check saved result',()=>check()],['iv-dialog-review','Review unfinished reversals',openPending],['iv-dialog-release','Release after checking records',openRelease]]) { const button=document.createElement('button');button.id=id;button.type='button';button.className='button button-secondary hidden';button.textContent=label;button.onclick=handler;el('iv-preview-refresh').before(button); }
    for (const id of ['iv-reason','iv-confirmation','iv-goods']) el(id).addEventListener('input', render);
    el('iv-preview-refresh').onclick = () => refreshPreview();
    el('iv-held-check').onclick = () => check(); el('iv-pending-open').onclick = openPending; el('iv-release-open').onclick = openRelease;
    el('iv-release-checked').onchange = () => { el('iv-release-confirm').disabled = !el('iv-release-checked').checked || busy; };
    el('iv-release-confirm').onclick = release;
    el('iv-pending-list').onclick = event => { const button = event.target.closest('[data-iv-status],[data-iv-resume]'); if (!button) return; const row = pending.find(item => item.requestId === (button.dataset.ivStatus || button.dataset.ivResume)); if (row) button.dataset.ivStatus ? check(row) : resume(row); };
    document.addEventListener('click', event => { const button = event.target.closest('[data-invoice-void-sale]'); if (!button) return; event.preventDefault(); if (!button.disabled) open({workspaceId:button.dataset.invoiceVoidWorkspace,saleId:Number(button.dataset.invoiceVoidSale),invoiceNo:button.dataset.invoiceVoidNumber}); });
    el('logout-button')?.addEventListener('click', () => reset(), {capture:true});
  }
  function clear() {
    epoch++; previewTicket++; pendingTicket++; identity = ''; prefix = ''; target = null; preview = null; receiptScope = null; fromReceipt = false; held = null; pending = []; pendingError = ''; checkedPending = false; loadingPending = false; pendingRequest = null; previewLoading = false; busy = false;
    if (!mounted) return;
    for (const id of ['invoice-void-dialog','invoice-void-pending','invoice-void-release']) if (el(id).open) el(id).close();
    for (const id of ['iv-target','iv-effects','iv-preview-error','iv-submit-error','iv-pending-error','iv-pending-list','iv-release-note','iv-release-error','iv-recovery-note']) el(id).textContent = '';
    el('iv-form').reset(); el('iv-release-checked').checked = false;
    el('invoice-void-receipt-delete').classList.add('hidden'); el('invoice-void-recovery').classList.add('hidden');
    document.querySelectorAll('[data-invoice-void-sale]').forEach(node => { node.classList.add('hidden'); node.disabled = true; });
  }
  function storageScope() { const account = user()?.accountKey || user()?.id || user()?.username; if (!account) throw Error('A stable signed-in account is required.'); return 'fiber-invoice-void-v1:' + encodeURIComponent(JSON.stringify([workspace().id,String(account)])) + ':'; }
  function entries() { const result = []; for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) result.push([key,localStorage.getItem(key)]); } return result.sort(([a],[b]) => a.localeCompare(b)); }
  function marker(key, raw) { const value = JSON.parse(raw); if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'requestId,saleId,workspaceId' || !requestPattern.test(value.requestId) || !scopeValid(value) || key !== prefix + value.requestId) throw Error('The local reversal request identity is damaged or belongs to another scope.'); return value; }
  function storageFailure(error) { held = {corrupt:true,error:'Invoice reversal recovery could not be read or preserved. New reversals are blocked. Keep this PC’s app data and ask Main Admin for help. ' + message(error)}; }
  function restore() { try { prefix ||= storageScope(); const rows = entries(); rows.forEach(([key,raw]) => marker(key,raw)); held = rows.length ? {...marker(...rows[0]),restored:true} : null; } catch (error) { storageFailure(error); } }
  function preserve(value) { try { prefix ||= storageScope(); if (entries().length) { restore(); throw Error('Check the earlier reversal request before another operation.'); } const saved = {requestId:value.requestId,workspaceId:value.workspaceId,saleId:value.saleId},key = prefix + saved.requestId,raw = JSON.stringify(saved); marker(key,raw); localStorage.setItem(key,raw); if (localStorage.getItem(key) !== raw) throw Error('The request identity was not saved.'); held = {...saved}; } catch (error) { if (!held) storageFailure(error); throw error; } }
  function forget(id) { const key = prefix + id,raw = localStorage.getItem(key); if (raw !== null) { marker(key,raw); localStorage.removeItem(key); if (localStorage.getItem(key) !== null) throw Error('The completed reversal identity could not be cleared.'); } }
  function syncAccess() {
    if (!config || !api()) { if (mounted) clear(); return false; } mount();
    if (!available()) { if (identity) clear(); return false; }
    const next = identityOf(); if (next !== identity) { clear(); identity = next; restore(); }
    render(); return true;
  }
  function reportButton(sale) {
    if (!available()) return '';
    const scope = {workspaceId:sale?.workspaceId || (workspace().id !== 'main' ? workspace().id : ''),saleId:sale?.id};
    if (!scopeValid(scope) || sale?.deleted || sale?.invoiceDeleted) return '';
    return `<button type="button" class="button invoice-void-row-action" data-invoice-void-workspace="${esc(scope.workspaceId)}" data-invoice-void-sale="${scope.saleId}" data-invoice-void-number="${esc(sale.invoiceNo)}" ${locked()?'disabled':''}>Delete invoice</button>`;
  }
  function setReceipt(type, record) {
    const next = type === 'sale' && record && !record.deleted && !record.invoiceDeleted ? {workspaceId:record.workspaceId || workspace()?.id,saleId:record.id,invoiceNo:record.invoiceNo} : null;
    if (fromReceipt && target && el('invoice-void-dialog')?.open && receiptScope && !sameScope(receiptScope,next) && !busy && !held) { previewTicket++; preview = null; target = null; previewLoading = false; fromReceipt = false; el('iv-form').reset(); el('invoice-void-dialog').close(); }
    receiptScope = available() && scopeValid(next) ? next : null; render();
  }
  function render() {
    if (!mounted) return;
    const permitted = available();
    el('invoice-void-receipt-delete').classList.toggle('hidden', !permitted || !scopeValid(receiptScope)); el('invoice-void-receipt-delete').disabled = locked();
    document.querySelectorAll('[data-invoice-void-sale]').forEach(node => { const allowed=permitted&&scopeValid({workspaceId:node.dataset.invoiceVoidWorkspace,saleId:Number(node.dataset.invoiceVoidSale)});node.classList.toggle('hidden', !allowed); node.disabled = !allowed || locked(); });
    const show = permitted && (held || pending.length || pendingError || !checkedPending);
    el('invoice-void-recovery').classList.toggle('hidden', !show);
    el('iv-recovery-title').textContent = held ? 'Result not confirmed — do not delete again' : pending.length ? 'Earlier invoice reversals need review' : 'Check invoice reversal recovery';
    el('iv-recovery-note').textContent = held?.corrupt ? held.error : held ? `Request ${held.requestId} · ${scopeName(held.workspaceId)} · sale ${held.saleId}. ${held.restored?'Recovered after reopening this PC. ':''}Check or resume the exact original request before a new reversal.` : pendingError || (pending.length ? `${pending.length} unfinished reversal request(s). Original invoices and audit evidence are preserved.` : 'Checking Main for saved invoice reversals…');
    el('iv-held-check').classList.toggle('hidden', !held); el('iv-held-check').disabled = busy || Boolean(held?.corrupt);
    el('iv-pending-open').disabled = busy || Boolean(held?.corrupt); el('iv-release-open').classList.toggle('hidden', !held?.notFound); el('iv-release-open').disabled = busy;
    for (const id of ['iv-reason','iv-confirmation','iv-goods']) el(id).disabled = !permitted || busy || Boolean(held) || previewLoading || !preview || preview.alreadyDeleted;
    el('iv-preview-refresh').disabled = !permitted || busy || Boolean(held) || previewLoading || !target;
    const goods = !preview?.stockReturns?.length || el('iv-goods').checked;
    el('iv-submit').disabled = !permitted || locked() || !preview || preview.alreadyDeleted || el('iv-reason').value.trim().length < 5 || el('iv-confirmation').value !== 'DELETE INVOICE' || !goods;
    for(const id of ['iv-dialog-check','iv-dialog-review']) { el(id).classList.toggle('hidden',!held);el(id).disabled=busy||Boolean(held?.corrupt); } el('iv-dialog-release').classList.toggle('hidden',!held?.notFound);el('iv-dialog-release').disabled=busy;
    document.querySelectorAll('.invoice-void-dialog [data-iv-close]').forEach(node => node.disabled = busy);
  }
  function validatePreview(value, scope) {
    if (!value || !sameScope(value,scope) || !value.invoiceNo || !value.workspaceName || typeof value.alreadyDeleted !== 'boolean' || scope.invoiceNo && value.invoiceNo !== scope.invoiceNo) throw Error('The exact original invoice preview could not be verified.');
    if (value.alreadyDeleted) return value;
    for (const field of ['subtotal','customerPaid','customerDebt','wholesaleDebt','adminCollected','whishFees','cashRefund','whishRefund']) if (!safeMoney(value[field])) throw Error('An invoice reversal amount could not be verified.');
    if (!safeMoney(value.marginFunding,true) || !Array.isArray(value.stockReturns) || value.stockReturns.some(row => !row || typeof row.name !== 'string' || !Number.isSafeInteger(row.quantity) || row.quantity <= 0) || typeof value.token !== 'string' || !value.token) throw Error('Stock, margin funding or the invoice preview token could not be verified.');
    return value;
  }
  function renderPreview() {
    if (!preview) return;
    el('iv-target').textContent = `${preview.workspaceName} · ${preview.invoiceNo} · sale ${preview.saleId}`;
    if (preview.alreadyDeleted) { el('iv-effects').innerHTML = '<p class="invoice-void-warning">This invoice has already been deleted and reversed. No second reversal can be submitted.</p>'; return; }
    const effects = [['Original customer invoice',preview.subtotal],['Customer payments to reverse',preview.customerPaid],['Customer debt to cancel',preview.customerDebt],['Remaining business product debt to cancel',preview.wholesaleDebt],['Already-collected Admin payments to reverse',preview.adminCollected],['Expense margin funding to reverse',preview.marginFunding],['Whish profit fees to reverse',preview.whishFees],['Cash refund records',preview.cashRefund],['Whish refund records',preview.whishRefund]];
    el('iv-effects').innerHTML = `<dl>${effects.map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${money(value)}</dd></div>`).join('')}</dl><h3>Physical stock returned</h3>${preview.stockReturns.length?'<ul>'+preview.stockReturns.map(row => `<li>${esc(row.name)} <strong>× ${row.quantity}</strong></li>`).join('')+'</ul>':'<p>No tracked stock to return. Non-stock services do not create inventory.</p>'}<p class="field-note">The original invoice becomes inactive; an immutable audit copy stays available. No external refund is sent by this action. Account-source proof, current balances and open months are checked again when confirming.</p>`;
    el('iv-goods-field').classList.toggle('hidden', !preview.stockReturns.length);
  }
  async function open(scope, receiptOrigin = false) {
    if (!syncAccess() || !scopeValid(scope)) return;
    if (locked()) return toast('Check or finish the earlier invoice reversal before starting another.', true);
    target = {...scope}; fromReceipt = receiptOrigin; showDialog('invoice-void-dialog'); await refreshPreview();
  }
  async function refreshPreview() {
    if (!available() || !scopeValid(target) || busy || held) return;
    const key = identity,generation = epoch,ticket = ++previewTicket,scope = {...target}; preview = null; previewLoading = true;
    el('iv-form').reset(); el('iv-effects').textContent = 'Loading verified reversal effects…'; el('iv-target').textContent = `${scopeName(scope.workspaceId)} · sale ${scope.saleId}`; el('iv-preview-error').textContent = ''; el('iv-submit-error').textContent = ''; el('iv-goods-field').classList.add('hidden'); render();
    try { const result = validatePreview(await api().preview({workspaceId:scope.workspaceId,saleId:scope.saleId}),scope); if (!current(key,generation) || ticket !== previewTicket || !sameScope(target,scope) || !el('invoice-void-dialog').open) return; preview = result; renderPreview(); }
    catch (error) { if (current(key,generation) && ticket === previewTicket) { el('iv-effects').textContent = ''; el('iv-preview-error').textContent = message(error) + ' No reversal was submitted.'; } }
    finally { if (current(key,generation) && ticket === previewTicket) { previewLoading = false; render(); } }
  }
  function verifyResult(result, operation) { if (!result || result.requestId !== operation.requestId || result.state !== 'completed' || !sameScope(result,operation) || result.deleted !== true || typeof result.invoiceNo !== 'string' || !result.invoiceNo || operation.invoiceNo && result.invoiceNo !== operation.invoiceNo) throw Error('The exact completed invoice reversal could not be verified. Keep its original request for recovery.'); }
  async function completed(result, operation) {
    verifyResult(result,operation); forget(operation.requestId); held = null; restore(); preview = null; target = null; previewTicket++;
    el('iv-form').reset(); for (const id of ['invoice-void-dialog','invoice-void-pending','invoice-void-release']) if (el(id).open) el(id).close();
    toast(`${result.invoiceNo} deleted and reversed once. The audit copy is preserved; no external refund was sent.`);
    try { await config?.refresh?.(result); } catch (error) { toast('Reversal completed. Refresh the reports to see the saved balances. ' + message(error), true); }
    await load();
  }
  async function remove(event) {
    event.preventDefault(); if (!available() || locked() || !preview || preview.alreadyDeleted || !scopeValid(target)) return;
    const reason = el('iv-reason').value.trim(),confirmation = el('iv-confirmation').value,goodsReturned = !preview.stockReturns.length || el('iv-goods').checked;
    if (reason.length < 5 || confirmation !== 'DELETE INVOICE' || !goodsReturned) return;
    const operation = {requestId:crypto.randomUUID(),workspaceId:preview.workspaceId,saleId:preview.saleId,invoiceNo:preview.invoiceNo},input = {...operation,token:preview.token,reason,confirmation,goodsReturned:true}; delete input.invoiceNo;
    const key = identity,generation = epoch; busy = true; render();
    try { preserve(operation); held = {...operation}; const result = await api().remove(input); if (!current(key,generation)) return; await completed(result,operation); }
    catch (error) { if (current(key,generation)) { el('iv-submit-error').textContent = message(error) + ' Result unconfirmed: check the saved request, do not delete again.'; toast('Check the exact invoice reversal request before any repeat. ' + message(error), true); } }
    finally { if (current(key,generation)) { busy = false; render(); } }
  }
  function validatePending(value) { const rows = Array.isArray(value) ? value : value?.requests ?? value?.pending; if (!Array.isArray(rows) || rows.some(row => !row || !requestPattern.test(row.requestId) || !scopeValid(row) || typeof row.invoiceNo !== 'string' || typeof row.state !== 'string')) throw Error('Saved invoice reversal requests could not be verified.'); return rows; }
  async function load() {
    if (!syncAccess()) return; const key = identity,generation = epoch;
    if(pendingRequest?.key===key&&pendingRequest.generation===generation)return pendingRequest.promise;
    const ticket = ++pendingTicket; loadingPending = true; render();
    const promise=(async()=>{await Promise.resolve();if(!current(key,generation))return;
      try { const rows = validatePending(await api().pending()); if (!current(key,generation) || ticket !== pendingTicket) return; pending = rows; pendingError = ''; checkedPending = true; renderPending(); }
      catch (error) { if (current(key,generation) && ticket === pendingTicket) { pendingError = message(error); checkedPending = true; } }
      finally { if (current(key,generation) && ticket === pendingTicket) { loadingPending = false; render(); }if(pendingRequest?.ticket===ticket)pendingRequest=null; }
    })();pendingRequest={key,generation,ticket,promise};return promise;
  }
  function renderPending() { el('iv-pending-error').textContent = pendingError || (held?.corrupt ? held.error : ''); el('iv-pending-list').innerHTML = pending.length ? pending.map(row => `<article><strong>${esc(row.invoiceNo)} · ${esc(scopeName(row.workspaceId))}</strong><p>${esc(row.requestId)} · ${esc(row.state)}</p><div class="invoice-void-actions"><button type="button" class="button button-secondary" data-iv-status="${esc(row.requestId)}" ${busy||held?.corrupt?'disabled':''}>Check result</button><button type="button" class="button button-secondary" data-iv-resume="${esc(row.requestId)}" ${busy||held?.corrupt||held&&held.requestId!==row.requestId?'disabled':''}>Resume exact reversal</button></div></article>`).join('') : '<p class="subtext">No unfinished reversal requests. A local held request must still be checked.</p>'; }
  async function openPending() { if (!syncAccess() || busy || held?.corrupt) return; showDialog('invoice-void-pending'); await load(); renderPending(); }
  async function check(row) {
    if (!syncAccess() || busy || held?.corrupt) return; const operation = row || held; if (!operation?.requestId || !scopeValid(operation)) return;
    const key = identity,generation = epoch; busy = true; render();
    try { const result = await api().status({requestId:operation.requestId}); if (!current(key,generation)) return; if (result?.requestId !== operation.requestId || result.workspaceId && !sameScope(result,operation)) throw Error('The saved reversal belongs to another request or invoice.');
      if (result.state === 'completed') await completed(result,operation);
      else if (result.state === 'not_found') { if (held?.requestId === operation.requestId) held.notFound = true; toast('Main found no saved reversal for this exact request. Check original records before explicitly releasing it.', true); }
      else { toast('The original reversal still needs recovery. Review unfinished reversals and resume that request.', true); await load(); }
    } catch (error) { if (current(key,generation)) { pendingError = message(error); toast(message(error), true); } }
    finally { if (current(key,generation)) { busy = false; render(); renderPending(); } }
  }
  async function resume(row) {
    if (!syncAccess() || busy || held?.corrupt || held && held.requestId !== row.requestId || !pending.some(item => item.requestId === row.requestId)) return;
    const key = identity,generation = epoch; busy = true; render();
    try { if (!held) { preserve(row); held = {...row}; } const result = await api().resume({requestId:row.requestId}); if (!current(key,generation)) return; await completed(result,row); }
    catch (error) { if (current(key,generation)) { pendingError = message(error); toast(message(error), true); } }
    finally { if (current(key,generation)) { busy = false; render(); renderPending(); } }
  }
  function openRelease() { if (!available() || busy || !held?.notFound || held.corrupt) return; el('iv-release-note').textContent = `Main found no saved request ${held.requestId} for ${scopeName(held.workspaceId)} sale ${held.saleId}. This does not cancel a completed invoice or submit another deletion.`; el('iv-release-checked').checked = false; el('iv-release-confirm').disabled = true; el('iv-release-error').textContent = ''; showDialog('invoice-void-release'); }
  async function release() { if (!available() || busy || !held?.notFound || held.corrupt || !el('iv-release-checked').checked) return; try { forget(held.requestId); held = null; restore(); el('invoice-void-release').close(); preview = null; target = null; if (el('invoice-void-dialog').open) el('invoice-void-dialog').close(); await load(); } catch (error) { storageFailure(error); el('iv-release-error').textContent = message(error); } render(); }
  function init(options) { config = options; suspended = false; if (syncAccess()) load(); }
  function updateUser(value) { if (config) config.user = value; suspended = false; syncAccess(); }
  function reset() { suspended = true; clear(); }
  return Object.freeze({init,updateUser,reset,syncAccess,load,setReceipt,reportButton,open});
})();
