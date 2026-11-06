/* A selected recorded payment is corrected locally; no provider action is sent. */
window.BillPaymentCorrections=(()=>{
 'use strict';
 const el=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n));
 let config,mounted=false,generation=0,view=null;
 const user=()=>config?.getUser?.(),workspace=()=>config?.getWorkspace?.();
 const allowed=()=>Boolean(config?.api?.billPayments)&&workspace()?.id==='fiber-users'&&user()?.active!==false&&['admin','cashier','support'].includes(user()?.role)&&config.has('bills.view')&&(config.has('bills.create')||config.has('bills.manage'));
 const identity=()=>config?.identity?.()||'',current=v=>Boolean(v)&&view===v&&v.identity===identity()&&allowed()&&el('bill-payment-correction-dialog').open;
 const key=()=>`fibernetlb.bill-payment-correction.v1:${workspace()?.id}:${user()?.accountKey||user()?.account_key||user()?.username||''}`;
 const errorText=e=>e?.message||'The payment correction could not be checked.';
 function text(id,value){el(id).textContent=String(value??'');}
 function showError(message){text('bpc-error',message);}
 function held(){try{const value=JSON.parse(sessionStorage.getItem(key())||'null');return value&&typeof value==='object'&&Number.isSafeInteger(value.billId)&&typeof value.requestId==='string'&&/^[A-Za-z0-9-]{8,100}$/.test(value.requestId)?value:null;}catch{return null;}}
 function store(value){if(value)sessionStorage.setItem(key(),JSON.stringify(value));else sessionStorage.removeItem(key());}
 function option(select,value,label){const node=document.createElement('option');node.value=String(value);node.textContent=label;select.append(node);}
 function source(v=view){return v?.options?.payments?.find(p=>p.paymentKey===el('bpc-payment').value);}
 function selection(){const input={billId:view.billId,paymentKey:el('bpc-payment').value,method:el('bpc-method').value};if(input.method==='Whish Money')input.whishDestinationId=el('bpc-wallet').value;return input;}
 function controls(){
  const v=view,p=source(v),locked=!v||!v.options||v.busy||Boolean(v.pending),blocked=!p||p.canCorrect!==true;
  for(const id of ['bpc-payment','bpc-method','bpc-wallet','bpc-reason'])el(id).disabled=locked;
  el('bpc-reviewed').disabled=locked||!v?.preview;
  el('bpc-submit').disabled=locked||blocked||Boolean(v.preview&&!el('bpc-reviewed').checked);
  el('bpc-submit').textContent=v?.preview?'Save correction':'Review change';
  el('bpc-submit').classList.toggle('hidden',Boolean(v?.pending));
  el('bpc-check').classList.toggle('hidden',!v?.pending);el('bpc-check').disabled=!v?.pending||v.busy;
  el('bpc-retry').classList.toggle('hidden',!v?.pending||!v.retryAllowed);el('bpc-retry').disabled=v?.busy;
  el('bpc-review-again').classList.toggle('hidden',!v?.pending||!v.retryAllowed);el('bpc-review-again').disabled=v?.busy;
  el('bpc-close').disabled=Boolean(v?.writing);
  el('bpc-wallet-field').classList.toggle('hidden',el('bpc-method').value!=='Whish Money');
  el('bpc-review-check').classList.toggle('hidden',!v?.preview);
  text('bpc-source-note',p?(p.canCorrect?`${money(p.amount)} received by ${p.ownerName||'the recorded money holder'} · ${p.receivedAt}`:p.blockedReason||'This payment needs review before it can be corrected.'):'No received payment is available to correct. Use Debts to record a new payment.');
 }
 function invalidate(){if(!view||view.pending||view.busy)return;view.preview=null;view.reviewInput=null;view.sequence++;el('bpc-reviewed').checked=false;el('bpc-preview').replaceChildren();showError('');controls();}
 function sourceChanged(){
  invalidate();const p=source(),select=el('bpc-method');select.replaceChildren();for(const method of ['Cash','Whish Money','Unpaid'])if(method!==p?.method)option(select,method,method==='Unpaid'?'Unpaid — return this amount to debt':method);
  el('bpc-wallet').value='';controls();
 }
 function metric(label,value){const line=document.createElement('div'),name=document.createElement('span'),amount=document.createElement('strong');line.className='bpc-metric';name.textContent=label;amount.textContent=value;line.append(name,amount);return line;}
 function renderPreview(p){
  const panel=el('bpc-preview');panel.replaceChildren();
  for(const [label,value]of [['Selected payment',money(p.amount)],['Change',`${p.oldMethod} → ${p.method||view.reviewInput.method}`],['Money holder',p.ownerName],['Whish fee before',money(p.feeBefore)],['Whish fee after',money(p.feeAfter)],['Customer debt before',money(p.debtBefore)],['Customer debt after',money(p.debtAfter)]])panel.append(metric(label,value));
  if(p.whishDestination)panel.append(metric('Whish wallet',[p.whishDestination.label,p.whishDestination.number].filter(Boolean).join(' · ')));
  const note=document.createElement('p');note.className='field-note';note.textContent=view.reviewInput.method==='Unpaid'?'The selected payment is removed from received money and its amount returns to customer debt. Other payments stay recorded.':'The selected amount moves from its recorded payment method to the reviewed method. The Whish fee affects profit only.';panel.append(note);
 }
 function renderHistory(rows){const panel=el('bpc-history');panel.replaceChildren();for(const row of rows||[]){const item=document.createElement('p');item.className='field-note';item.textContent=`${row.recordedAt||row.correctedAt||row.createdAt||''} · ${row.oldMethod||row.fromMethod||''} → ${row.method||row.newMethod||row.toMethod||''} · ${money(row.amount)} · ${row.actorName||row.actor||''} · ${row.reason||''}`;panel.append(item);}el('bpc-history-section').classList.toggle('hidden',!rows?.length);}
 async function open(billId){
  if(!allowed()||!Number.isSafeInteger(billId)||billId<=0)return;
  if(view?.busy)return;
  const pending=held(),v={identity:identity(),billId:pending?.billId||billId,options:null,preview:null,reviewInput:null,pending,busy:false,sequence:++generation,retryAllowed:false};view=v;
  el('bpc-form').reset();el('bpc-payment').replaceChildren();el('bpc-method').replaceChildren();el('bpc-wallet').replaceChildren();el('bpc-preview').replaceChildren();renderHistory([]);showError('');text('bpc-summary','Loading the original bill and its recorded payments…');
  if(!el('bill-payment-correction-dialog').open)el('bill-payment-correction-dialog').showModal();controls();
  try{const [options,wallets]=await Promise.all([config.api.billPayments.options({billId:v.billId}),config.api.whish.list()]);if(!current(v))return;
   if(options.billId!==v.billId||!Array.isArray(options.payments))throw Error('The bill payment list could not be verified.');
   v.options=options;text('bpc-summary',`${options.receiptNo} · Paid ${money(options.paidAmount)} · Customer debt ${money(options.remainingAmount)}`);
   for(const p of options.payments)option(el('bpc-payment'),p.paymentKey,`${p.paymentKey==='original'?'Original payment':'Debt payment'} · ${money(p.amount)} · ${p.method} · ${p.ownerName||''}`);
   const first=options.payments.find(p=>p.canCorrect)||options.payments[0];if(first)el('bpc-payment').value=first.paymentKey;
   option(el('bpc-wallet'),'','Choose the Whish wallet');for(const wallet of wallets)option(el('bpc-wallet'),wallet.id,`${wallet.label} · ${wallet.number}`);
   renderHistory(options.history||[]);sourceChanged();
   if(v.pending)showError('This browser has a saved correction request. Check its result before starting another edit.');controls();
  }catch(e){if(current(v)){showError(errorText(e));controls();}}
 }
 async function complete(v,result){
  if(!current(v))return;
  if(result?.state!=='completed'||result.requestId!==v.pending?.requestId)throw Error('The saved correction result is not confirmed. Check the original request.');
  store(null);v.pending=null;el('bill-payment-correction-dialog').close();view=null;
  config.toast('Payment method corrected. The Internet service and renewal history were kept.');
  try{await config.refresh(result.bill);}catch{config.toast('Correction saved. Refresh the page to load the updated balances.','error');}
 }
 async function send(v){
  if(!current(v)||v.busy||!v.pending)return;v.busy=true;v.writing=true;v.retryAllowed=false;controls();showError('');
  try{const result=await config.api.billPayments.correct(v.pending);if(current(v))await complete(v,result);}
  catch(e){if(current(v))showError(`${errorText(e)} Check the saved correction before trying again.`);}
  finally{if(current(v)){v.busy=false;v.writing=false;controls();}}
 }
 async function check(){
  const v=view;if(!current(v)||!v.pending||v.busy)return;v.busy=true;v.retryAllowed=false;controls();showError('');
  try{const result=await config.api.billPayments.status({requestId:v.pending.requestId});if(!current(v))return;if(result?.state==='completed')await complete(v,result);else if(result===null||result?.state==='not_found'){v.retryAllowed=true;showError('No saved correction was found for this request. Retry the exact reviewed correction, or review the current payment again.');}else showError('This correction is still being saved. Check the same request again.');}
  catch(e){if(current(v))showError(errorText(e));}finally{if(current(v)){v.busy=false;controls();}}
 }
 async function submit(event){
  event.preventDefault();const v=view;if(!current(v)||v.busy||v.pending||!source()?.canCorrect)return;
  const input=selection(),reason=el('bpc-reason').value.trim();if(reason.length<5||reason.length>500)return showError('Enter a reason of 5–500 characters.');
  if(input.method==='Whish Money'&&!input.whishDestinationId)return showError('Choose the exact Whish wallet.');
  if(!v.preview){const ticket=++v.sequence;v.busy=true;controls();showError('');try{const p=await config.api.billPayments.preview(input);if(!current(v)||ticket!==v.sequence||JSON.stringify(input)!==JSON.stringify(selection()))return;
    if(p.billId!==v.billId||p.paymentKey!==input.paymentKey||typeof p.token!=='string')throw Error('The payment preview could not be verified.');
    v.preview=p;v.reviewInput=input;renderPreview(p);el('bpc-reviewed').checked=false;
   }catch(e){if(current(v))showError(errorText(e));}finally{if(current(v)){v.busy=false;controls();}}return;
  }
  if(JSON.stringify(input)!==JSON.stringify(v.reviewInput)||!el('bpc-reviewed').checked)return invalidate();
  const pending={...v.reviewInput,requestId:crypto.randomUUID(),token:v.preview.token,reason};
  try{store(pending);}catch{return showError('This browser could not keep the correction request. Allow session storage before saving.');}
  v.pending=pending;await send(v);
 }
 function mount(){
  if(mounted)return;mounted=true;const node=document.createElement('dialog');node.id='bill-payment-correction-dialog';node.className='modal bpc-dialog';node.setAttribute('aria-labelledby','bpc-title');
  node.innerHTML='<form id="bpc-form"><div class="modal-heading"><div><p class="eyebrow">FIBER NET LB USERS · PAYMENT CORRECTION</p><h2 id="bpc-title">Edit payment method</h2></div><button id="bpc-close" type="button" class="button button-secondary">Close</button></div><p id="bpc-summary" class="subtext"></p><p class="auth-copy">Correct one recorded payment. No Internet renewal, service change or external money transfer is sent.</p><div class="form-grid"><label class="wide">Payment to correct<select id="bpc-payment"></select><small id="bpc-source-note" class="field-note"></small></label><label>Correct payment method<select id="bpc-method"></select></label><label id="bpc-wallet-field" class="hidden">Whish wallet<select id="bpc-wallet"></select></label><label class="wide">Reason<textarea id="bpc-reason" rows="2" required minlength="5" maxlength="500"></textarea></label></div><div id="bpc-preview" class="bpc-preview" aria-live="polite"></div><label id="bpc-review-check" class="bpc-check hidden"><input id="bpc-reviewed" type="checkbox" /><span>I reviewed the payment, money holder and resulting customer debt.</span></label><p id="bpc-error" class="form-error" role="alert"></p><div class="modal-actions"><button id="bpc-check" type="button" class="button button-secondary hidden">Check saved correction</button><button id="bpc-retry" type="button" class="button button-secondary hidden">Retry saved correction</button><button id="bpc-review-again" type="button" class="button button-secondary hidden">Review current payment again</button><button id="bpc-submit" type="submit" class="button button-primary">Review change</button></div><details id="bpc-history-section" class="hidden"><summary>Payment correction history</summary><div id="bpc-history"></div></details></form>';
  document.body.append(node);el('bpc-form').addEventListener('submit',submit);el('bpc-close').onclick=()=>{if(!view?.writing)node.close();};node.addEventListener('cancel',e=>{if(view?.writing)e.preventDefault();});node.addEventListener('close',()=>{if(!view?.writing){view=null;generation++;}});
  el('bpc-payment').onchange=sourceChanged;el('bpc-method').onchange=invalidate;el('bpc-wallet').onchange=invalidate;el('bpc-reviewed').onchange=controls;
  el('bpc-check').onclick=check;el('bpc-retry').onclick=()=>{if(view?.retryAllowed)void send(view);};
  el('bpc-review-again').onclick=()=>{if(!view?.retryAllowed)return;const id=view.billId;try{store(null);}catch{return showError('Could not release the checked request.');}view.pending=null;void open(id);};
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-edit-bill-payment]');if(button&&!button.disabled)void open(Number(button.dataset.editBillPayment));});
  window.addEventListener('pos-web-auth-ended',()=>{generation++;view=null;node.close();});
 }
 function init(next){config=next;mount();generation++;view=null;el('bill-payment-correction-dialog').close();}
 function button(bill){return allowed()&&Number(bill.amount)>0&&bill.renewal?.state!=='free'?`<button class="icon-button" type="button" data-edit-bill-payment="${Number(bill.id)}" title="Edit payment method" aria-label="Edit payment method">✎</button>`:'';}
 function syncAccess(){if(view&&(!allowed()||view.identity!==identity())){generation++;view=null;el('bill-payment-correction-dialog')?.close();}}
 return {init,button,syncAccess,open};
})();
