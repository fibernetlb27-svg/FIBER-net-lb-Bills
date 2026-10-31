window.BandwidthAccounting = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(value || 0));
  const number = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:6}).format(Number(value || 0));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const amount = value => Math.round(Number(value || 0) * 100);
  function purchaseCents(quantity,unitPrice) {
    const scaled=(value,places)=>{const raw=String(value).trim();if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(raw))return null;const [whole,fraction='']=raw.split('.');return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));};
    const quantityMicros=scaled(quantity,6),priceCents=scaled(unitPrice,2);if(quantityMicros===null||priceCents===null)return null;
    const total=(quantityMicros*priceCents+500000n)/1000000n;return total>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(total);
  }
  const names = {dashboard:'Dashboard',suppliers:'Suppliers',types:'Bandwidth types',purchases:'Bandwidth purchases'};
  let config = null, host = null, data = null, sources = [], view = 'dashboard', epoch = 0, loadTicket = 0, sourceTicket = 0, dashboardTicket = 0, busy = false, loaded = false;
  let dialog = null, requestId = '', editId = null, payingSupplier = null, frozenPayment = null;
  const user = value => value?.getUser?.() ?? value?.user;
  const workspace = value => value?.getWorkspace?.() ?? value?.workspace;
  const identity = value => {const owner=user(value);return JSON.stringify([owner?.accountKey||owner?.account_key,owner?.role,owner?.active,workspace(value)?.id,[...(owner?.permissions||[])].sort(),[...(owner?.allowedSections||[])].sort()]);};
  const allowed = () => Boolean(user(config)?.role === 'admin' && user(config)?.active !== false && workspace(config)?.id === 'main');
  const capture = () => ({epoch,identity:identity(config),config});
  const current = state => Boolean(allowed() && state?.epoch === epoch && state.identity === identity(config));
  const api = () => config?.api;
  const findSupplier = id => data?.suppliers?.find(row => String(row.id) === String(id));
  function errorText(error) { return error?.message || String(error || 'Unable to complete this action.'); }
  function notify(message,kind) { config?.toast?.(message,kind); }
  function setStatus(message,error=false) { if (!$('ba-status')) return; $('ba-status').textContent=message; $('ba-status').classList.toggle('ba-error',error); $('ba-status').hidden=!message; }
  function options(rows,label,selected='') { return rows.map(row => `<option value="${esc(row.id)}"${String(row.id)===String(selected)?' selected':''}>${esc(label(row))}</option>`).join(''); }
  function empty(columns,message) { return `<tr><td colspan="${columns}" class="ba-empty">${esc(message)}</td></tr>`; }
  function reset() {
    epoch++; loadTicket++; sourceTicket++; dashboardTicket++; data=null; sources=[]; loaded=false; busy=false; frozenPayment=null; requestId=''; editId=null; payingSupplier=null;
    if(dialog?.open) dialog.close();
    dialog?.remove(); dialog=null;
    if(host) { host.removeEventListener('click',handleClick); host.replaceChildren(); host.classList.remove('ba-root'); host.hidden=true; }
    host=null; config=null;
  }
  function init(value) {
    reset(); config=value;
    host=typeof value?.container==='string' ? $(value.container) : value?.container || $('bandwidth-accounting-root');
    if(!host || !allowed() || !api()?.overview) { if(host) { host.hidden=Boolean(value?.paymentOnly); host.textContent='Bandwidth Accounting is available to Main Office administrators only.'; } return; }
    host.hidden=Boolean(value?.paymentOnly); host.classList.add('ba-root'); view='dashboard'; mount();
    $('logout-button')?.addEventListener('click',reset,{once:true,capture:true});
  }
  function mount() {
    host.innerHTML=`<div class="ba-topline"><div><p class="eyebrow">MAIN OFFICE · ADMIN ONLY</p><h2>Bandwidth Accounting</h2><p class="field-note">Supplier purchases, outstanding balances and payments in one place.</p></div><button type="button" id="ba-return" class="button button-secondary">← Return to Main</button></div>
      <nav class="ba-nav" aria-label="Bandwidth accounting views">${Object.entries(names).map(([id,label])=>`<button type="button" class="button button-secondary${id===view?' active':''}" data-ba-view="${id}" aria-current="${id===view?'page':'false'}">${label}</button>`).join('')}</nav>
      <form id="ba-filter" class="ba-filter panel"><div><strong>Accounting period</strong><small>Balances include earlier unpaid purchases through the end date.</small></div><label>From<input type="date" id="ba-from" aria-label="Accounting period from" /></label><label>To<input type="date" id="ba-to" aria-label="Accounting period to" /></label><button type="submit" class="button button-secondary">Apply</button><button type="button" id="ba-all-dates" class="button button-secondary">All dates</button><button type="button" id="ba-refresh" class="button button-secondary">Refresh</button></form>
      <p id="ba-status" class="ba-status" role="status" aria-live="polite" hidden></p><article id="ba-pending-panel" class="panel ba-pending" hidden><div class="panel-heading"><div><p class="eyebrow">SAVED PAYMENT RECOVERY</p><h3>Payments awaiting completion</h3><p class="field-note">Finish the original saved payment with its original source. Do not enter it again as a new payment.</p></div></div><div class="table-wrap"><table><thead><tr><th>Reference / supplier</th><th>Method / saved source</th><th class="number">Amount USD</th><th>Status</th><th></th></tr></thead><tbody id="ba-pending-body"></tbody></table></div></article>
      <section id="ba-dashboard" aria-label="Bandwidth dashboard"><div id="ba-metrics" class="ba-metrics metric-grid"></div><article class="panel"><div class="panel-heading"><div><p class="eyebrow">SUPPLIER STATEMENTS</p><h3>Bandwidth purchased &amp; money owed</h3><p class="field-note" id="ba-period-note"></p></div><button type="button" class="button button-primary" data-ba-new="purchase">Add purchase</button></div><div id="ba-statements"></div></article><article class="panel ba-history"><div class="panel-heading"><div><p class="eyebrow">PAYMENT AUDIT</p><h3>Payments to suppliers</h3><p class="field-note">Saved source and supplier details are kept with each payment.</p></div></div><div class="table-wrap"><table><thead><tr><th>Receipt / date</th><th>Supplier</th><th>Payment source</th><th>Destination</th><th class="number">Paid USD</th><th></th></tr></thead><tbody id="ba-payment-body"></tbody></table></div></article></section>
      <section id="ba-suppliers" hidden aria-label="Suppliers"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">SUPPLIER DIRECTORY</p><h3>Suppliers</h3><p class="field-note">Contact and receiving-wallet details. Editing a supplier does not change earlier receipts.</p></div><button type="button" class="button button-primary" data-ba-new="supplier">Add supplier</button></div><div class="table-wrap"><table><thead><tr><th>Name / address</th><th>Phone</th><th>Whish receiving number</th><th>Status</th><th></th></tr></thead><tbody id="ba-supplier-body"></tbody></table></div></article></section>
      <section id="ba-types" hidden aria-label="Bandwidth types"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">PURCHASE CATALOGUE</p><h3>Bandwidth types &amp; units</h3><p class="field-note">Choose Mbps or Gbps. Different units are never added together.</p></div><button type="button" class="button button-primary" data-ba-new="type">Add bandwidth type</button></div><div class="table-wrap"><table><thead><tr><th>Bandwidth type</th><th>Unit</th><th>Quantity in period</th><th>Status</th><th></th></tr></thead><tbody id="ba-type-body"></tbody></table></div></article></section>
      <section id="ba-purchases" hidden aria-label="Bandwidth purchases"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">MANUAL PURCHASES</p><h3>Bandwidth purchases</h3><p class="field-note">Recording a purchase creates a supplier amount owed. Payment is recorded separately.</p></div><button type="button" class="button button-primary" data-ba-new="purchase">Add purchase</button></div><div class="table-wrap"><table><thead><tr><th>Date / supplier</th><th>Bandwidth type</th><th class="number">Quantity</th><th class="number">Unit price USD</th><th class="number">Cost USD</th><th class="number">Paid USD</th><th class="number">Remaining USD</th><th>Recorded by / note</th></tr></thead><tbody id="ba-purchase-body"></tbody></table></div></article></section>`;
    host.addEventListener('click',handleClick);
    $('ba-filter').onsubmit=event=>{event.preventDefault();if(!busy)load().catch(()=>{});};
    $('ba-all-dates').onclick=()=>{if(!busy){$('ba-from').value='';$('ba-to').value='';load().catch(()=>{});}};
    $('ba-refresh').onclick=()=>{if(!busy)load().catch(()=>{});};
    $('ba-return').onclick=()=>{if(!busy && allowed())config.onBack?.();};
    render();
  }
  function handleClick(event) {
    if(!allowed() || busy) return;
    const button=event.target.closest('button'); if(!button || !host.contains(button))return;
    if(button.dataset.baView) showView(button.dataset.baView);
    else if(button.dataset.baNew) openForm(button.dataset.baNew);
    else if(button.dataset.baSupplier) openForm('supplier',button.dataset.baSupplier);
    else if(button.dataset.baType) openForm('type',button.dataset.baType);
    else if(button.dataset.baPay) openPayment(button.dataset.baPay).catch(error=>setStatus(errorText(error),true));
    else if(button.dataset.baReceipt) showReceipt(data.payments.find(row=>String(row.id)===button.dataset.baReceipt));
    else if(button.dataset.baResume) openRecovery(button.dataset.baResume);
  }
  function showView(next) {
    if(!allowed() || busy || !Object.hasOwn(names,next))return;
    view=next;
    for(const id of Object.keys(names)) $('ba-'+id).hidden=id!==view;
    host.querySelectorAll('[data-ba-view]').forEach(button=>{const selected=button.dataset.baView===view;button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');});
    config.onView?.(view,names[view]);
  }
  function setLoading(value) {
    if(!host)return;
    host.setAttribute('aria-busy',String(value));
    host.querySelectorAll('button,input,select').forEach(node=>{node.disabled=value;});
    if(!value) render();
  }
  async function load() {
    if(!allowed())return null;
    const start=$('ba-from').value,end=$('ba-to').value;
    if(start && end && start>end){setStatus('The end date must be on or after the start date.',true);return null;}
    const state=capture(),ticket=++loadTicket;
    setStatus('Loading supplier balances…');setLoading(true);
    try {
      const result=await state.config.api.overview({start,end});
      const pending=Array.isArray(result.pending)?result.pending:state.config.api.pending?await state.config.api.pending():[];
      if(!current(state) || ticket!==loadTicket)return null;
      data={...result,suppliers:result.suppliers||[],types:result.types||[],purchases:result.purchases||[],payments:result.payments||[],pending,totals:result.totals||{}};
      loaded=true;setStatus('');render();return data;
    } catch(error) {
      if(!current(state)||ticket!==loadTicket)return null;
      data=null;loaded=false;render();setStatus(errorText(error),true);return null;
    } finally {if(current(state)&&ticket===loadTicket)setLoading(false);}
  }
  function lineTable(lines) {
    return `<div class="table-wrap"><table class="ba-lines"><thead><tr><th>Purchase date</th><th>Bandwidth type</th><th class="number">Quantity</th><th class="number">Unit price USD</th><th class="number">Total USD</th><th class="number">Remaining USD</th></tr></thead><tbody>${lines.map(row=>`<tr><td>${esc(row.purchaseDate)}</td><td>${esc(row.typeName)}<small>${esc(row.note||'')}</small></td><td class="number">${esc(number(row.quantity))} ${esc(row.unit)}</td><td class="number">${money(row.unitPrice)}</td><td class="number">${money(row.totalCost??row.total)}</td><td class="number">${money(row.remaining)}</td></tr>`).join('')||empty(6,'No purchases through this date.')}</tbody></table></div>`;
  }
  function render() {
    if(!allowed() || !host)return;
    const d=data||{suppliers:[],types:[],purchases:[],payments:[],pending:[],totals:{}},t=d.totals;
    $('ba-pending-panel').hidden=!d.pending?.length;
    $('ba-pending-body').innerHTML=(d.pending||[]).map(row=>`<tr><td><strong>${esc(row.requestId)}</strong><small>${esc(findSupplier(row.supplierId)?.name||row.supplierId)} · ${esc(row.actorName||row.actorKey)}</small></td><td>${esc(row.paymentMethod)}<small>${esc(row.sourceWorkspaceId)}${row.sourceWalletId?' · wallet '+esc(row.sourceWalletId):' · Admin cash drawer'}</small></td><td class="number">${money(row.amount)}</td><td>${esc(row.state)}</td><td><button type="button" class="button button-secondary" data-ba-resume="${esc(row.requestId)}"${row.actorKey!==(config.user.accountKey||config.user.account_key)?' disabled title="Only the original Admin can finish this payment"':''}>Review &amp; finish</button></td></tr>`).join('');
    $('ba-metrics').innerHTML=[['Total purchased','totalCost','Supplier purchase cost'],['Paid to suppliers','totalPaid','Recorded payments'],['Still owed to suppliers','remaining','Outstanding supplier balance']].map(([label,key,note])=>`<article class="metric-card${key==='remaining'?' debt-card':''}" data-ba-metric="${key}"><span>${label}</span><strong>${loaded?money(t[key]):'—'}</strong><small>${note}</small></article>`).join('');
    const period=[$('ba-from').value||'the beginning',$('ba-to').value||'today'].join(' → ');
    $('ba-period-note').textContent=loaded?`${period}. Period purchases ${money(t.periodCost)} · period payments ${money(t.periodPaid)}. Supplier balances include earlier purchases through the end date.`:'Load the ledger to see verified supplier balances.';
    $('ba-statements').innerHTML=d.suppliers.map(row=>`<section class="ba-supplier-statement"><div class="ba-statement-heading"><div class="ba-supplier-name"><h4>${esc(row.name)}</h4><small>${esc(row.phone||'No phone')} · Whish ${esc(row.whishNumber||'not set')}</small>${row.address?`<small>${esc(row.address)}</small>`:''}${row.active===false?'<span class="ba-badge">Inactive supplier</span>':''}</div><dl class="ba-balances"><div><dt>Purchase cost</dt><dd>${money(row.totalCost)}</dd></div><div><dt>Paid</dt><dd>${money(row.totalPaid)}</dd></div><div class="ba-remaining"><dt>Remaining</dt><dd>${money(row.remaining)}</dd></div></dl><button type="button" data-ba-pay="${esc(row.id)}" class="button button-primary"${amount(row.remaining)<=0||(d.pending||[]).some(p=>String(p.supplierId)===String(row.id))?' disabled':''}>Pay supplier</button></div><details><summary>Purchase lines <span>${esc((row.purchaseLines||[]).length)}</span></summary>${lineTable(row.purchaseLines||[])}</details></section>`).join('')||`<p class="ba-empty">${loaded?'No suppliers yet. Add a supplier, then record a bandwidth purchase.':'No supplier information loaded.'}</p>`;
    $('ba-supplier-body').innerHTML=d.suppliers.map(row=>`<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.address||'No address')}</small>${row.note?`<small>${esc(row.note)}</small>`:''}</td><td>${esc(row.phone||'—')}</td><td>${esc(row.whishNumber||'Not set')}</td><td><span class="ba-badge">${row.active===false?'Inactive':'Active'}</span></td><td><button type="button" data-ba-supplier="${esc(row.id)}" class="button button-secondary">Edit</button></td></tr>`).join('')||empty(5,loaded?'No suppliers yet.':'No supplier information loaded.');
    $('ba-type-body').innerHTML=d.types.map(row=>`<tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.unit)}</td><td>${esc(number(row.totalQuantity))} ${esc(row.unit)}</td><td><span class="ba-badge">${row.active===false?'Inactive':'Active'}</span></td><td><button type="button" data-ba-type="${esc(row.id)}" class="button button-secondary">Edit</button></td></tr>`).join('')||empty(5,loaded?'No bandwidth types yet.':'No type information loaded.');
    $('ba-purchase-body').innerHTML=d.purchases.map(row=>`<tr><td>${esc(row.purchaseDate)}<small>${esc(row.supplierName)}</small></td><td>${esc(row.typeName)}</td><td class="number">${esc(number(row.quantity))} ${esc(row.unit)}</td><td class="number">${money(row.unitPrice)}</td><td class="number">${money(row.totalCost??row.total)}</td><td class="number">${money(row.paidAmount)}</td><td class="number">${money(row.remaining)}</td><td>${esc(row.actorName||'—')}<small>${esc(row.note||'')}</small></td></tr>`).join('')||empty(8,loaded?'No bandwidth purchases in this period.':'No purchase information loaded.');
    $('ba-payment-body').innerHTML=d.payments.map(row=>`<tr><td><strong>${esc(row.receiptNo||row.requestId)}</strong><small>${esc(row.paymentDate||row.recordedAt)}</small></td><td>${esc(row.supplierName)}<small>${esc(row.note||'')}</small></td><td>${esc(row.paymentMethod)}<small>${esc(row.sourceWorkspaceName||row.sourceWorkspaceId)} · ${esc(row.sourceName||row.actorName||'Admin')}</small>${row.sourceWalletId?`<small>${esc(row.sourceWalletLabel)} · ${esc(row.sourceWalletNumber)}</small>`:''}</td><td>${row.paymentMethod==='Whish Money'?`Supplier Whish<small>${esc(row.supplierWhishNumber||'—')}</small>`:'Supplier cash payment'}</td><td class="number">${money(row.amount)}</td><td><button type="button" class="button button-secondary" data-ba-receipt="${esc(row.id)}">Receipt</button></td></tr>`).join('')||empty(6,loaded?'No supplier payments in this period.':'No payment information loaded.');
    host.querySelectorAll('[data-ba-new],[data-ba-pay],[data-ba-supplier],[data-ba-type]').forEach(button=>{button.disabled=!loaded||Boolean(d.pending?.length)||(Boolean(button.dataset.baPay)&&amount(findSupplier(button.dataset.baPay)?.remaining)<=0);});
  }
  function mountDialog(title,eyebrow,body,submitLabel) {
    if(dialog?.open)dialog.close();dialog?.remove();dialog=document.createElement('dialog');dialog.id='ba-dialog';dialog.className='modal ba-dialog';
    dialog.innerHTML=`<form id="ba-form"><div class="modal-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h2 id="ba-dialog-title">${esc(title)}</h2></div><button type="button" id="ba-dialog-close" class="button button-secondary">Close</button></div><fieldset id="ba-fields">${body}</fieldset><p id="ba-form-error" class="form-error" role="alert"></p><div class="modal-actions"><button type="button" id="ba-cancel" class="button button-secondary">Cancel</button><button type="submit" id="ba-save" class="button button-primary">${esc(submitLabel)}</button></div></form>`;
    document.body.append(dialog);dialog.setAttribute('aria-labelledby','ba-dialog-title');
    const close=()=>{if(!busy){dialog.close();sourceTicket++;}};
    $('ba-dialog-close').onclick=close;$('ba-cancel').onclick=close;
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else sourceTicket++;});
    requestId=crypto.randomUUID();frozenPayment=null;dialog.showModal();
    return dialog;
  }
  function activeField(active=true) { return `<label class="ba-check wide"><input type="checkbox" id="ba-active"${active?' checked':''} />Active · available for new purchases</label>`; }
  function openForm(kind,id=null) {
    if(!allowed() || !loaded || busy)return;
    editId=id;payingSupplier=null;
    if(kind==='supplier') {
      const row=id?findSupplier(id):{};if(!row)return;
      mountDialog(id?'Edit supplier':'Add supplier','SUPPLIER DIRECTORY',`<p class="field-note">Contact details and the supplier’s receiving Whish number. Earlier receipts keep their original details.</p><div class="form-grid"><label class="wide">Supplier name<input id="ba-name" required maxlength="160" value="${esc(row.name||'')}" autocomplete="organization" /></label><label>Phone<input id="ba-phone" maxlength="80" value="${esc(row.phone||'')}" autocomplete="tel" /></label><label>Whish receiving number<input id="ba-whish" maxlength="80" value="${esc(row.whishNumber||'')}" autocomplete="off" /></label><label class="wide">Address<textarea id="ba-address" maxlength="500">${esc(row.address||'')}</textarea></label><label class="wide">Note<textarea id="ba-note" maxlength="1000">${esc(row.note||'')}</textarea></label>${id?activeField(row.active!==false):''}</div>`,'Save supplier');
      $('ba-form').onsubmit=event=>save(event,kind);
    } else if(kind==='type') {
      const row=id?data.types.find(item=>String(item.id)===String(id)):{};if(!row)return;
      mountDialog(id?'Edit bandwidth type':'Add bandwidth type','TYPE & UNIT',`<p class="field-note">Choose Mbps or Gbps. Past purchases retain their saved type and unit.</p><div class="form-grid"><label>Type name<input id="ba-name" required maxlength="120" value="${esc(row.name||'')}" /></label><label>Unit<select id="ba-unit" required${row.inUse?' disabled':''}><option${row.unit!=='Gbps'?' selected':''}>Mbps</option><option${row.unit==='Gbps'?' selected':''}>Gbps</option></select>${row.inUse?'<small>Unit is fixed after a purchase. Create a new type to use another unit.</small>':''}</label>${id?activeField(row.active!==false):''}</div>`,'Save bandwidth type');
      $('ba-form').onsubmit=event=>save(event,kind);
    } else if(kind==='purchase') {
      const suppliers=data.suppliers.filter(row=>row.active!==false),types=data.types.filter(row=>row.active!==false);
      mountDialog('Add bandwidth purchase','MANUAL PURCHASE',`<p class="field-note">The purchase records its cost once in Main Office under “Bandwidth cost” and creates an amount owed to the supplier. Pay supplier settles that amount; it does not add a second cost. No stock or customer renewal is changed.</p><div class="form-grid"><label>Supplier<select id="ba-purchase-supplier" required><option value="">Select supplier</option>${options(suppliers,row=>row.name)}</select></label><label>Bandwidth type<select id="ba-purchase-type" required><option value="">Select bandwidth type</option>${options(types,row=>`${row.name} · ${row.unit}`)}</select></label><label>Purchase date<input id="ba-date" type="date" value="${today()}" required /></label><label>Quantity <span id="ba-quantity-unit"></span><input id="ba-quantity" type="number" min="0.000001" max="1000000000" step="any" required value="1" /></label><label>Unit price (USD)<input id="ba-unit-price" type="number" min="0.01" max="1000000000" step="0.01" required /></label><label class="wide">Description / note<textarea id="ba-note" maxlength="1000"></textarea></label></div><div class="ba-payment-preview"><span>Total purchase cost</span><strong id="ba-purchase-total">$0.00</strong></div>`, 'Save purchase');
      if(!suppliers.length||!types.length){$('ba-form-error').textContent='Add an active supplier and bandwidth type first.';$('ba-save').disabled=true;}
      $('ba-purchase-type').onchange=()=>{const type=data.types.find(row=>String(row.id)===$('ba-purchase-type').value);$('ba-quantity-unit').textContent=type?`(${type.unit})`:'';};
      for(const field of ['ba-quantity','ba-unit-price'])$(field).oninput=()=>{const total=purchaseCents($('ba-quantity').value,$('ba-unit-price').value);$('ba-purchase-total').textContent=total===null?'—':money(total/100);};
      $('ba-form').onsubmit=event=>save(event,kind);
    }
  }
  async function save(event,kind) {
    event.preventDefault();if(busy || !allowed() || !$('ba-form').reportValidity())return;
    const state=capture(),selectedId=editId;
    let payload;
    if(kind==='supplier')payload={requestId,name:$('ba-name').value.trim(),phone:$('ba-phone').value.trim(),address:$('ba-address').value.trim(),whishNumber:$('ba-whish').value.trim(),note:$('ba-note').value.trim(),active:selectedId?$('ba-active').checked:true};
    else if(kind==='type')payload={requestId,name:$('ba-name').value.trim(),unit:$('ba-unit').value.trim(),active:selectedId?$('ba-active').checked:true};
    else {
      const total=purchaseCents($('ba-quantity').value,$('ba-unit-price').value);
      if(total===null||total<=0){$('ba-form-error').textContent='Use a positive quantity with up to 6 decimal places and a unit price with up to 2 decimal places. The total must be at least $0.01.';return;}
      payload={requestId,supplierId:$('ba-purchase-supplier').value,typeId:$('ba-purchase-type').value,purchaseDate:$('ba-date').value,quantity:$('ba-quantity').value,unitPrice:$('ba-unit-price').value,note:$('ba-note').value.trim()};
    }
    busy=true;setDialogBusy(true);$('ba-form-error').textContent='';
    try {
      let result;
      if(kind==='supplier') result=selectedId?await state.config.api.updateSupplier(selectedId,payload):await state.config.api.createSupplier(payload);
      else if(kind==='type') result=selectedId?await state.config.api.updateType(selectedId,payload):await state.config.api.createType(payload);
      else result=await state.config.api.createPurchase(payload);
      if(!current(state))return;
      dialog.close();notify(kind==='purchase'?'Bandwidth purchase recorded. Supplier amount owed updated.':kind==='supplier'?'Supplier saved.':'Bandwidth type saved.');
      await load();return result;
    } catch(error) {if(current(state))$('ba-form-error').textContent=errorText(error);}
    finally {if(current(state)){busy=false;setDialogBusy(false);}}
  }
  function setDialogBusy(value) {
    if(!dialog)return;
    $('ba-fields').disabled=value;
    for(const id of ['ba-save','ba-cancel','ba-dialog-close'])if($(id))$(id).disabled=value;
    dialog.setAttribute('aria-busy',String(value));
  }
  // Payment sources and the saved payment receipt are supplied by the Main Office service.
  // Neither wallet balances nor supplier balances are reconstructed from browser storage.
  async function openPayment(id) {
    if(!allowed()||!loaded||busy)return;
    const row=findSupplier(id);if(!row||amount(row.remaining)<=0)return;
    payingSupplier=row;editId=null;
    mountDialog('Pay supplier','SUPPLIER PAYMENT',`<div class="ba-payee"><strong id="ba-payee-name">${esc(row.name)}</strong><small id="ba-payee-contact">${esc(row.phone||'No phone')} · ${esc(row.address||'No address')}</small><span>Current outstanding <b id="ba-payee-remaining">${money(row.remaining)}</b></span></div><div class="form-grid"><label>Payment date<input id="ba-pay-date" type="date" value="${today()}" required /></label><label>Amount (USD)<span class="ba-input-action"><input id="ba-pay-amount" type="number" min="0.01" max="${esc(row.remaining)}" step="0.01" value="${esc(Number(row.remaining).toFixed(2))}" required /><button type="button" id="ba-pay-full" class="button button-secondary">Full amount</button></span></label><label>Payment method<select id="ba-pay-method"><option>Cash</option><option>Whish Money</option></select></label><label id="ba-source-business-field">Source business<select id="ba-pay-business" required><option value="">Loading sources…</option></select><small>Defaults to FIBER net lb Resellers. You can choose another business.</small></label><label id="ba-source-wallet-field" class="wide" hidden>Admin source Whish wallet<select id="ba-pay-wallet"></select></label><label class="wide" id="ba-supplier-wallet-field" hidden>Supplier receiving Whish number<input id="ba-pay-destination" value="${esc(row.whishNumber||'')}" readonly /><small>Saved supplier destination · not editable here.</small></label><label class="wide">Payment description / note<textarea id="ba-pay-note" maxlength="1000"></textarea></label></div><p id="ba-source-balance" class="field-note"></p><div id="ba-pay-preview" class="ba-payment-preview" aria-live="polite"></div><p class="field-note">Applied to the oldest unpaid purchases first. Record the supplier payment once. This does not send real Whish money. No additional fee is applied.</p>`,'Pay supplier');
    $('ba-fields').disabled=true;$('ba-save').disabled=true;$('ba-form-error').textContent='Verifying the current supplier balance and Admin sources…';$('ba-form').onsubmit=pay;
    for(const field of ['ba-pay-method','ba-pay-business'])$(field).onchange=()=>{populateWallets();paymentPreview();};
    for(const field of ['ba-pay-amount','ba-pay-wallet'])$(field).oninput=paymentPreview;
    $('ba-pay-full').onclick=()=>{if(!busy&&!frozenPayment){$('ba-pay-amount').value=Number(payingSupplier.remaining).toFixed(2);paymentPreview();}};
    const state=capture(),ticket=++sourceTicket;
    try {
      const [result,latest]=await Promise.all([state.config.api.sources(),state.config.api.overview({})]);
      if(!current(state)||ticket!==sourceTicket||!dialog?.open)return;
      const supplier=(latest.suppliers||[]).find(item=>String(item.id)===String(id));
      if(!supplier||amount(supplier.remaining)<=0){payingSupplier=null;$('ba-form-error').textContent='This supplier has no current unpaid balance. Refresh the ledger to see its latest statement.';return;}
      payingSupplier=supplier;
      $('ba-payee-name').textContent=supplier.name;
      $('ba-payee-contact').textContent=`${supplier.phone||'No phone'} · ${supplier.address||'No address'}`;
      $('ba-payee-remaining').textContent=money(supplier.remaining);
      $('ba-pay-amount').value=Number(supplier.remaining).toFixed(2);$('ba-pay-amount').max=supplier.remaining;
      $('ba-pay-destination').value=supplier.whishNumber||'';
      sources=result.sources||[];
      $('ba-pay-business').innerHTML='<option value="">Select source business</option>'+sources.map(row=>`<option value="${esc(row.workspaceId)}">${esc(row.workspaceName)}</option>`).join('');
      $('ba-pay-business').value=sources.some(row=>row.workspaceId==='fiber-resellers')?'fiber-resellers':'';
      $('ba-fields').disabled=false;$('ba-form-error').textContent='';
      populateWallets();paymentPreview();
    } catch(error) {if(current(state)&&ticket===sourceTicket)$('ba-form-error').textContent=errorText(error);}
  }
  function selectedSource() {return sources.find(row=>String(row.workspaceId)===$('ba-pay-business')?.value);}
  function selectedWallet() {return selectedSource()?.wallets?.find(row=>String(row.id)===$('ba-pay-wallet')?.value&&row.active!==false);}
  function populateWallets() {
    if(!$('ba-pay-wallet'))return;
    const method=$('ba-pay-method').value,old=$('ba-pay-wallet').value,rows=(selectedSource()?.wallets||[]).filter(row=>row.active!==false);
    $('ba-source-wallet-field').hidden=method!=='Whish Money';$('ba-supplier-wallet-field').hidden=method!=='Whish Money';$('ba-pay-wallet').required=method==='Whish Money';
    $('ba-pay-wallet').innerHTML='<option value="">Select Admin wallet</option>'+options(rows,row=>`${row.label} · ${row.number} · ${money(row.balance)}`,old);
    if(rows.length===1)$('ba-pay-wallet').value=String(rows[0].id);
  }
  function paymentPreview() {
    if(!allowed()||!payingSupplier||!$('ba-pay-preview'))return;
    const source=selectedSource(),whish=$('ba-pay-method').value==='Whish Money',wallet=whish?selectedWallet():null,value=Number($('ba-pay-amount').value),balance=Number(whish?wallet?.balance:source?.cash);
    const valid=Number.isFinite(value)&&amount(value)>0&&amount(value)<=amount(payingSupplier.remaining)&&Boolean(source)&&(!whish||Boolean(wallet)&&Boolean(payingSupplier.whishNumber))&&Number.isFinite(balance)&&amount(value)<=amount(balance);
    $('ba-source-balance').textContent=source?`${source.workspaceName||source.name} · Admin ${whish?'Whish wallet':'cash drawer'} available: ${Number.isFinite(balance)?money(balance):'Select a wallet'}.`:sources.some(row=>row.workspaceId==='fiber-resellers')?'Choose the business whose Admin funds will pay this supplier.':'FIBER net lb Resellers is unavailable for this Admin. Choose another source business explicitly to continue.';
    $('ba-pay-preview').innerHTML=`<div><span>Supplier payment</span><strong>${Number.isFinite(value)&&value>=0?money(value):'—'}</strong></div><div><span>Remaining after payment</span><strong>${Number.isFinite(value)&&value>=0?money(Math.max(0,amount(payingSupplier.remaining)-amount(value))/100):'—'}</strong></div>`;
    if(!frozenPayment) {
      let warning='';if(whish&&!payingSupplier.whishNumber)warning='Add the supplier’s receiving Whish number in Suppliers before paying by Whish.';
      else if(source&&whish&&!wallet)warning='Select an active Admin source Whish wallet.';
      else if(source&&Number.isFinite(balance)&&amount(value)>amount(balance))warning='The selected Admin source has insufficient recorded funds.';
      else if(amount(value)>amount(payingSupplier.remaining))warning='The amount cannot exceed this supplier’s outstanding balance.';
      $('ba-form-error').textContent=warning;
    }
    $('ba-save').disabled=!valid||busy;
  }
  async function pay(event) {
    event.preventDefault();if(busy||!allowed()||!payingSupplier||!$('ba-form').reportValidity())return;
    paymentPreview();if($('ba-save').disabled)return;
    const state=capture(),source=selectedSource(),whish=$('ba-pay-method').value==='Whish Money',wallet=whish?selectedWallet():null;
    const payload=frozenPayment||{requestId,supplierId:payingSupplier.id,paymentDate:$('ba-pay-date').value,amount:Number($('ba-pay-amount').value),paymentMethod:$('ba-pay-method').value,sourceWorkspaceId:source.workspaceId,sourceWalletId:wallet?.id||'',note:$('ba-pay-note').value.trim()};
    frozenPayment=payload;busy=true;setDialogBusy(true);$('ba-form-error').textContent='Saving payment…';
    try {
      const result=await state.config.api.pay(payload);if(!current(state))return;
      dialog.close();notify('Supplier payment recorded.');
      await load();if(current(state)){try{await config?.refresh?.(result);}catch(error){notify('Payment saved. Refresh the dashboard to see the latest totals. '+errorText(error),'error');}if(current(state))showReceipt(result.payment||result);}
    } catch(error) {if(current(state)){$('ba-form-error').textContent=errorText(error)+' Retry uses this same payment reference; no second payment is created.';$('ba-save').textContent='Retry same payment';}}
    finally {if(current(state)){busy=false;setDialogBusy(false);if(frozenPayment&&dialog?.open){$('ba-fields').disabled=true;$('ba-save').disabled=false;}}}
  }
  function openRecovery(id) {
    if(!allowed()||busy)return;
    const row=data?.pending?.find(item=>item.requestId===id);if(!row||row.actorKey!==(config.user.accountKey||config.user.account_key))return;
    mountDialog('Finish saved supplier payment','PAYMENT RECOVERY',`<p class="field-note">The original payment reference and source stay unchanged. This finishes the saved payment; it must not be entered again as a new payment.</p><dl class="ba-receipt"><div><dt>Payment reference</dt><dd>${esc(row.requestId)}</dd></div><div><dt>Supplier</dt><dd>${esc(findSupplier(row.supplierId)?.name||row.supplierId)}</dd></div><div><dt>Amount</dt><dd>${money(row.amount)}</dd></div><div><dt>Saved source</dt><dd>${esc(row.sourceWorkspaceId)} · ${esc(row.paymentMethod)}${row.sourceWalletId?' · wallet '+esc(row.sourceWalletId):' · Admin cash drawer'}</dd></div><div><dt>State</dt><dd>${esc(row.state)}</dd></div></dl>`,'Finish saved payment');
    $('ba-form').onsubmit=async event=>{
      event.preventDefault();if(busy||!allowed())return;
      const state=capture();busy=true;setDialogBusy(true);$('ba-form-error').textContent='Finishing the original payment…';
      try {
        const result=await state.config.api.resume(row.requestId);if(!current(state))return;
        dialog.close();notify('Saved supplier payment completed.');await load();if(current(state)){try{await config?.refresh?.(result);}catch(error){notify('Payment saved. Refresh the dashboard to see the latest totals. '+errorText(error),'error');}if(current(state))showReceipt(result.payment||result);}
      } catch(error) {if(current(state))$('ba-form-error').textContent=errorText(error);}
      finally {if(current(state)){busy=false;setDialogBusy(false);}}
    };
  }
  function showReceipt(row) {
    if(!allowed()||!row)return;
    const whish=row.paymentMethod==='Whish Money';
    mountDialog('Payment recorded','SUPPLIER PAYMENT RECEIPT',`<div class="ba-success" role="status"><span aria-hidden="true">✓</span><strong>${money(row.amount)} paid to ${esc(row.supplierName||'supplier')}</strong><small>${esc(row.receiptNo||row.requestId)}</small></div><dl class="ba-receipt"><div><dt>Payment date</dt><dd>${esc(row.paymentDate||row.recordedAt)}</dd></div><div><dt>Method</dt><dd>${esc(row.paymentMethod)}</dd></div><div><dt>Source business</dt><dd>${esc(row.sourceWorkspaceName||row.sourceWorkspaceId)}</dd></div><div><dt>Source Admin</dt><dd>${esc(row.sourceName||row.actorName||'Admin')}</dd></div>${whish?`<div><dt>Source Whish wallet</dt><dd>${esc(row.sourceWalletLabel)} · ${esc(row.sourceWalletNumber)}</dd></div><div><dt>Supplier receiving Whish</dt><dd>${esc(row.supplierWhishNumber)}</dd></div>`:''}<div><dt>Note</dt><dd>${esc(row.note||'—')}</dd></div></dl><p class="field-note">This is the saved application receipt. No automatic real-money transfer or extra fee was sent.</p>`,'Done');
    $('ba-cancel').hidden=true;$('ba-form').onsubmit=event=>{event.preventDefault();if(!busy)dialog.close();};
  }
  // Dashboard entry opens the reviewed form, never another accounting window.
  async function payFromDashboard(supplierId) {
    if(!allowed()||!host)throw Error('Main Office administrator access is required.');
    if(typeof supplierId!=='string'&&typeof supplierId!=='number'||!String(supplierId).trim())throw Error('Choose a valid supplier.');
    if(busy)throw Error('Wait for the original supplier payment to finish.');
    if(dialog?.open){dialog.focus();return;}
    // An unanswered payment keeps its original request and reviewed source, even
    // after Cancel. Reopening it must not create a new request reference.
    if(frozenPayment&&dialog){dialog.showModal();return;}
    const state=capture(),ticket=++dashboardTicket,result=await load();
    if(!current(state)||ticket!==dashboardTicket)return;
    if(!result)throw Error($('ba-status')?.textContent||'Supplier balances could not be loaded.');
    if(result.pending?.length){
      const owner=String(user(config)?.accountKey||user(config)?.account_key||''),saved=result.pending.find(row=>String(row.supplierId)===String(supplierId)&&row.actorKey===owner)||result.pending.find(row=>row.actorKey===owner);
      if(!saved)throw Error('Another Admin must finish the saved supplier payment before a new payment can be recorded.');
      openRecovery(saved.requestId);return;
    }
    const supplier=findSupplier(supplierId);
    if(!supplier||amount(supplier.remaining)<=0)throw Error('This supplier has no current unpaid balance. Refresh the dashboard list.');
    await openPayment(supplierId);
  }
  function updateUser(next) { if(!next){reset();return;}if(!config)return;const previous=identity({...config,getUser:undefined});config.user=next;if(previous!==identity(config))init({...config,user:next}); }
  return {init,load,showView,updateUser,reset,payFromDashboard};
})();
