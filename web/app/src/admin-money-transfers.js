// Admin custody transfers. Main owns every reviewed journal and saved outcome.
window.AdminMoneyTransfers = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value);
  const cents = value => Math.round(value * 100);
  const balance = value => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(cents(value)) && Math.abs(value * 100 - cents(value)) < 0.000001;
  const money = value => balance(value) && value >= 0;
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  const requestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value);
  const errorText = value => String(value?.message || value || 'The transfer could not be verified.').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,700);
  const baseKeys = ['fromWorkspaceId','fromAccountKey','fromWalletId','toWorkspaceId','toAccountKey','toWalletId','method','amount','note'];
  const methodName = value => value === 'cash' ? 'Cash drawer' : 'Whish wallet';
  let config, dialog, identity = '', storageKey = '', epoch = 0, sequence = 0, busy = false, held, pending = [], review, workspaces = [];
  let sides = {from:null,to:null}, sideTickets = {from:0,to:0}, sideLoading = {from:false,to:false}, previewTicket = 0;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const account = () => String(user()?.accountKey || user()?.account_key || '');
  const permitted = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && identifier(account());
  const allowed = () => permitted() && typeof config?.api?.sources === 'function' && typeof config?.api?.preview === 'function' && typeof config?.api?.transfer === 'function';
  const identityOf = () => JSON.stringify([workspace()?.id,account(),user()?.role,user()?.active,user()?.activity_inspection,user()?.activityInspection]);
  const capture = () => ({epoch,identity});
  const current = stamp => allowed() && stamp.epoch === epoch && stamp.identity === identity && identityOf() === identity;
  const notify = (text,error = false) => config?.toast?.(text,error ? 'error' : undefined);
  function status(text = '',error = false) { const node=el('amt-status');if(!node)return;node.textContent=text;node.hidden=!text;node.classList.toggle('amt-error',error); }
  function validInput(input,write = false) {
    if(!input || !['cash','whish'].includes(input.method) || !['fromWorkspaceId','fromAccountKey','toWorkspaceId','toAccountKey'].every(key=>identifier(input[key])) || typeof input.fromWalletId!=='string' || typeof input.toWalletId!=='string' || input.method==='cash'&&(input.fromWalletId!==''||input.toWalletId!=='') || input.method==='whish'&&(!identifier(input.fromWalletId)||!identifier(input.toWalletId)) || !money(input.amount) || input.amount<=0 || typeof input.note!=='string' || !input.note.trim() || input.note.length>1000 || /[\u0000-\u001f\u007f]/.test(input.note))throw Error('Choose the exact sending and receiving businesses, money holders and a positive amount with a transfer note.');
    if(input.fromWorkspaceId===input.toWorkspaceId && input.fromAccountKey===input.toAccountKey && input.fromWalletId===input.toWalletId)throw Error('Choose a different receiving drawer or wallet.');
    if(write && (!requestId(input.requestId) || !/^[a-f0-9]{64}$/i.test(input.token||'') || input.confirmation!=='TRANSFER MONEY'))throw Error('Review this original transfer before confirming it.');
    return input;
  }
  function validSources(value,selected) {
    if(!value || value.workspaceId!==selected || typeof value.workspaceName!=='string' || !Array.isArray(value.workspaces) || !value.workspaces.length || new Set(value.workspaces.map(row=>row?.id)).size!==value.workspaces.length || value.workspaces.some(row=>!identifier(row?.id)||typeof row.name!=='string') || !value.workspaces.some(row=>row.id===selected) || !Array.isArray(value.holders) || new Set(value.holders.map(row=>row?.accountKey)).size!==value.holders.length)throw Error('The selected business and its authorized money holders could not be verified.');
    for(const row of value.holders)if(!identifier(row?.accountKey)||typeof row.name!=='string'||!['admin','cashier','support'].includes(row.role)||!balance(row.cashBalance)||!Array.isArray(row.wallets)||new Set(row.wallets.map(wallet=>wallet?.id)).size!==row.wallets.length||row.wallets.some(wallet=>!identifier(wallet?.id)||typeof wallet.label!=='string'||!balance(wallet.balance)||typeof wallet.active!=='boolean'))throw Error('A drawer or Whish wallet could not be verified.');
    return value;
  }
  function validMovement(value,input = null,completed = false) {
    validInput(value);
    if(!['fromWorkspaceName','toWorkspaceName','fromName','toName'].every(key=>typeof value[key]==='string') || ![value.sourceBefore,value.sourceAfter,value.targetBefore,value.targetAfter].every(balance) || value.sourceAfter<0 || cents(value.sourceBefore)-cents(value.amount)!==cents(value.sourceAfter) || cents(value.targetBefore)+cents(value.amount)!==cents(value.targetAfter))throw Error('The sending and receiving balances do not match the reviewed transfer.');
    if(input && baseKeys.some(key=>key==='amount'?cents(value[key])!==cents(input[key]):value[key]!==input[key]))throw Error('The business, money holder, wallet or amount changed. Review the original transfer again.');
    if(completed){if(!requestId(value.requestId)||value.state!==(completed==='prepared'?'prepared':'completed')||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!['noRevenue','noExpense','noProfitChange','noWhishFee'].every(key=>value[key]===true))throw Error('The original saved transfer completion could not be verified.');}
    else if(!/^[a-f0-9]{64}$/i.test(value.token||'')||!/^\d{4}-\d{2}-\d{2}$/.test(value.date||''))throw Error('The server transfer review could not be verified.');
    return value;
  }
  function validMarker(value) {
    if(!value||value.version!==1||value.accountKey!==account()||!requestId(value.requestId))throw Error('The saved transfer reference is damaged. Keep this PC’s app data and review it before starting another transfer.');
    if(value.serverReference===true){if(value.input!==undefined)throw Error('The saved server transfer reference is invalid.');}
    else {validInput(value.input,true);if(value.input.requestId!==value.requestId)throw Error('The saved transfer ID does not match its original instruction.');}
    return value;
  }
  function restore() {
    storageKey='fiber-admin-transfer-v1:'+encodeURIComponent(JSON.stringify(['main',account()]));
    try{const raw=localStorage.getItem(storageKey);held=raw?validMarker(JSON.parse(raw)):null;}
    catch(error){held={corrupt:true,error:'Transfer recovery storage is unavailable. New transfers are blocked. '+errorText(error)};}
  }
  function preserve(value) {
    if(held)throw Error('Resolve the original transfer before entering another one.');
    const marker=validMarker({version:1,accountKey:account(),...value}),raw=JSON.stringify(marker);
    try{localStorage.setItem(storageKey,raw);if(localStorage.getItem(storageKey)!==raw)throw Error('The transfer reference was not retained.');held=marker;}
    catch(error){held={corrupt:true,error:'The original reference could not be saved safely. No new transfer was submitted. '+errorText(error)};throw error;}
    return marker;
  }
  function forget(marker) {
    if(held?.requestId!==marker.requestId)return;
    localStorage.removeItem(storageKey);if(localStorage.getItem(storageKey)!==null)throw Error('The saved transfer reference could not be cleared. Check its result before another transfer.');held=null;
  }
  function close(force = false) {if(busy&&!force)return;sequence++;sideTickets.from++;sideTickets.to++;previewTicket++;if(dialog){dialog.close();dialog.remove();dialog=null;}review=null;sides={from:null,to:null};sideLoading={from:false,to:false};}
  function reset(){epoch++;close(true);busy=false;held=null;pending=[];identity='';storageKey='';workspaces=[];config=null;}
  function suspend(){epoch++;close(true);busy=false;}
  function init(value){reset();config=value;if(!allowed())return;identity=identityOf();restore();}
  function updateUser(value){if(!config)return;const next={...config,user:value};config=next;if(!allowed()||identityOf()!==identity)init(next);}
  function mount(method){
    close(true);dialog=document.createElement('dialog');dialog.className='amt-dialog';dialog.setAttribute('aria-labelledby','amt-title');
    dialog.innerHTML='<div class="modal-heading"><div><p class="eyebrow">MAIN OFFICE · ADMIN ONLY</p><h2 id="amt-title">Transfer '+esc(methodName(method))+'</h2></div><button id="amt-close" type="button" class="button button-secondary">Close</button></div><p id="amt-status" class="amt-status" role="status" hidden></p><div id="amt-recovery"></div><div id="amt-content"></div>';
    document.body.append(dialog);el('amt-close').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
  }
  function form(method){
    el('amt-content').innerHTML='<p class="amt-warning">Record a movement already made separately. Choose the exact sending and receiving business and money holder. This entry creates no revenue, profit, funding, expense or Whish fee.</p><form id="amt-form"><label class="amt-method">Transfer type<select id="amt-method"><option value="cash">Cash drawer</option><option value="whish">Whish wallet</option></select></label><div class="amt-sides">'+['from','to'].map(side=>'<section class="amt-side"><p class="eyebrow">'+(side==='from'?'SENDING MONEY':'RECEIVING MONEY')+'</p><h3>'+(side==='from'?'From':'To')+'</h3><label>Business<select id="amt-'+side+'-business" aria-label="'+(side==='from'?'Sending':'Receiving')+' business"><option value="">Choose business</option></select></label><label>Money holder<select id="amt-'+side+'-holder" aria-label="'+(side==='from'?'Sending':'Receiving')+' money holder"><option value="">Choose business first</option></select></label><label id="amt-'+side+'-wallet-field">Whish wallet<select id="amt-'+side+'-wallet" aria-label="'+(side==='from'?'Sending':'Receiving')+' Whish wallet"><option value="">Choose money holder first</option></select></label><p id="amt-'+side+'-available" class="amt-note"></p></section>').join('')+'</div><div class="amt-fields"><label>Amount (USD)<input id="amt-amount" type="number" min="0.01" step="0.01" max="1000000000" required /></label><label class="amt-wide">Transfer note<input id="amt-note" maxlength="1000" placeholder="For example: move the collected cash to the receiving business" required /></label></div><div id="amt-preview" hidden></div><label id="amt-ack-field" class="amt-check" hidden><input id="amt-ack" type="checkbox" />I reviewed both businesses, exact money holders, wallets and before/after balances.</label><p id="amt-form-error" class="form-error" role="status"></p><div class="amt-actions"><button id="amt-review" type="button" class="button button-secondary">Review transfer</button><button id="amt-confirm" type="submit" class="button button-primary" disabled>Confirm transfer</button></div></form>';
    el('amt-method').value=method;
    for(const side of ['from','to']){
      el('amt-'+side+'-business').innerHTML='<option value="">Choose business</option>'+workspaces.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join('');
      el('amt-'+side+'-business').onchange=()=>{invalidate();loadSide(side,el('amt-'+side+'-business').value).catch(error=>status(errorText(error),true));};
      el('amt-'+side+'-holder').onchange=()=>{invalidate();renderWallet(side);controls();};
      el('amt-'+side+'-wallet').onchange=()=>{invalidate();available(side);controls();};
    }
    el('amt-method').onchange=()=>{invalidate();for(const side of ['from','to'])renderWallet(side);controls();};
    el('amt-amount').oninput=()=>{invalidate();controls();};el('amt-note').oninput=()=>{invalidate();controls();};el('amt-ack').onchange=controls;
    el('amt-review').onclick=reviewTransfer;el('amt-form').onsubmit=event=>{event.preventDefault();commit();};for(const side of ['from','to'])renderWallet(side);controls();
  }
  function invalidate(){previewTicket++;review=null;if(el('amt-preview')){el('amt-preview').hidden=true;el('amt-preview').replaceChildren();el('amt-ack-field').hidden=true;el('amt-ack').checked=false;}if(el('amt-form-error'))el('amt-form-error').textContent='';}
  function holder(side){return sides[side]?.holders.find(row=>row.accountKey===el('amt-'+side+'-holder')?.value);}
  function renderWallet(side,preset = ''){
    const person=holder(side),node=el('amt-'+side+'-wallet');if(!node)return;
    const prior=preset||node.value,rows=person?.wallets.filter(row=>row.active)||[];
    node.innerHTML='<option value="">Choose wallet</option>'+rows.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.label)+' · '+esc(usd(row.balance))+'</option>').join('');
    if(rows.some(row=>row.id===prior))node.value=prior;
    el('amt-'+side+'-wallet-field').hidden=el('amt-method').value!=='whish';available(side);
  }
  function available(side){
    const person=holder(side),wallet=person?.wallets.find(row=>row.id===el('amt-'+side+'-wallet')?.value&&row.active),method=el('amt-method')?.value;
    el('amt-'+side+'-available').textContent=person?(method==='cash'?'Recorded drawer balance: '+usd(person.cashBalance):wallet?'Recorded wallet balance: '+usd(wallet.balance):'Choose the exact wallet for this money holder.'):(sideLoading[side]?'Verifying this business’s money holders…':'Choose the business and money holder.');
  }
  async function loadSide(side,id,preset = {}){
    const stamp=capture(),ticket=++sideTickets[side],view=sequence;sides[side]=null;sideLoading[side]=Boolean(id);
    el('amt-'+side+'-holder').innerHTML='<option value="">'+(id?'Loading money holders…':'Choose business first')+'</option>';renderWallet(side);controls();
    if(!id)return;
    try{
      const value=validSources(await config.api.sources({workspaceId:id}),id);
      if(!current(stamp)||view!==sequence||ticket!==sideTickets[side]||!dialog)return;
      sides[side]=value;el('amt-'+side+'-holder').innerHTML='<option value="">Choose money holder</option>'+value.holders.map(row=>'<option value="'+esc(row.accountKey)+'">'+esc(row.name)+' · '+esc(row.role)+'</option>').join('');
      if(preset.holderAccountKey&&value.holders.some(row=>row.accountKey===preset.holderAccountKey))el('amt-'+side+'-holder').value=preset.holderAccountKey;
      renderWallet(side,preset.walletId||'');
    }catch(error){if(current(stamp)&&view===sequence&&ticket===sideTickets[side]){sides[side]=null;el('amt-'+side+'-holder').innerHTML='<option value="">Sources unavailable</option>';status(errorText(error),true);}}
    finally{if(current(stamp)&&view===sequence&&ticket===sideTickets[side]){sideLoading[side]=false;available(side);controls();}}
  }
  function inputs(){return validInput({fromWorkspaceId:el('amt-from-business').value,fromAccountKey:el('amt-from-holder').value,fromWalletId:el('amt-method').value==='whish'?el('amt-from-wallet').value:'',toWorkspaceId:el('amt-to-business').value,toAccountKey:el('amt-to-holder').value,toWalletId:el('amt-method').value==='whish'?el('amt-to-wallet').value:'',method:el('amt-method').value,amount:Number(el('amt-amount').value),note:el('amt-note').value.trim()});}
  function controls(){
    if(!dialog)return;dialog.setAttribute('aria-busy',String(busy));
    for(const node of dialog.querySelectorAll('input,button,select'))node.disabled=busy;
    if(el('amt-resume'))el('amt-resume').disabled=busy||!held?.resumeAcknowledged;
    if(!el('amt-form'))return;
    const blocked=busy||Boolean(held)||pending.length>0;
    for(const side of ['from','to']){el('amt-'+side+'-holder').disabled=blocked||sideLoading[side]||!sides[side];el('amt-'+side+'-wallet').disabled=blocked||sideLoading[side]||!holder(side)||el('amt-method').value!=='whish';}
    let valid=false;try{inputs();valid=true;}catch{}
    el('amt-review').disabled=blocked||sideLoading.from||sideLoading.to||!valid;
    el('amt-confirm').disabled=blocked||!review||!el('amt-ack').checked;
  }
  function line(label,value){return '<div class="amt-preview-line"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
  function movementHtml(value){return '<div class="amt-route"><article><small>FROM</small><h3>'+esc(value.fromWorkspaceName)+'</h3><p>'+esc(value.fromName)+' · '+esc(value.method==='whish'?(value.fromWalletLabel||'Whish wallet'):'Cash drawer')+'</p>'+line('Before',usd(value.sourceBefore))+line('After',usd(value.sourceAfter))+'</article><span class="amt-route-arrow" aria-hidden="true">→</span><article><small>TO</small><h3>'+esc(value.toWorkspaceName)+'</h3><p>'+esc(value.toName)+' · '+esc(value.method==='whish'?(value.toWalletLabel||'Whish wallet'):'Cash drawer')+'</p>'+line('Before',usd(value.targetBefore))+line('After',usd(value.targetAfter))+'</article></div>';}
  async function open(preset = {}){
    if(!allowed())throw Error('Admin money transfers are available to the Main Office administrator only.');if(busy)return;
    if(identityOf()!==identity)init({...config});if(!allowed())return;
    const method=preset.method==='whish'?'whish':'cash';mount(method);const stamp=capture(),ticket=sequence;busy=true;controls();
    try{
      if(typeof config.api.pending==='function'){
        const value=await config.api.pending();if(!current(stamp)||ticket!==sequence)return;
        if(!value||!Array.isArray(value.requests)||value.requests.some(row=>!requestId(row?.requestId)||!['prepared','save_required'].includes(row.state))||new Set(value.requests.map(row=>row.requestId)).size!==value.requests.length)throw Error('Saved transfer instructions could not be verified.');pending=value.requests;
      }
      if(held||pending.length){renderRecovery();return;}
      const preferred=identifier(preset.workspaceId)&&preset.workspaceId!=='all'?preset.workspaceId:'',initial=validSources(await config.api.sources({workspaceId:preferred||'main'}),preferred||'main');
      if(!current(stamp)||ticket!==sequence)return;workspaces=initial.workspaces;form(method);
      if(preferred&&workspaces.some(row=>row.id===preferred)){el('amt-from-business').value=preferred;await loadSide('from',preferred,preset);}
    }catch(error){if(current(stamp)&&ticket===sequence)status(errorText(error),true);}
    finally{if(current(stamp)&&ticket===sequence){busy=false;controls();}}
  }
  async function reviewTransfer(){
    if(!allowed()||busy||held||pending.length)return;let input;try{input=inputs();}catch(error){el('amt-form-error').textContent=errorText(error);return;}
    const stamp=capture(),ticket=sequence,version=++previewTicket;busy=true;review=null;controls();
    try{const value=validMovement(await config.api.preview(input),input);if(!current(stamp)||ticket!==sequence||version!==previewTicket||!dialog)return;review={input,value};el('amt-preview').innerHTML='<h3>Reviewed transfer · '+esc(usd(value.amount))+'</h3>'+movementHtml(value)+'<p class="amt-note">Both businesses keep their own accounting. This is a money movement, not income or an expense.</p>';el('amt-preview').hidden=false;el('amt-ack-field').hidden=false;el('amt-ack').checked=false;}
    catch(error){if(current(stamp)&&ticket===sequence)el('amt-form-error').textContent=errorText(error);}
    finally{if(current(stamp)&&ticket===sequence){busy=false;controls();}}
  }
  async function commit(){
    if(!allowed()||busy||held||pending.length||!review||!el('amt-ack').checked)return;let input;
    try{input=inputs();validMovement(review.value,input);input={...input,requestId:'admin-transfer-'+crypto.randomUUID(),token:review.value.token,confirmation:'TRANSFER MONEY'};validInput(input,true);preserve({requestId:input.requestId,input});}
    catch(error){el('amt-form-error').textContent=errorText(error);if(held)renderRecovery();return;}
    const stamp=capture(),ticket=sequence,marker=held;busy=true;controls();
    try{const result=await config.api.transfer(input);if(!current(stamp)||ticket!==sequence)return;await complete(result,marker);}
    catch(error){if(current(stamp)&&ticket===sequence)status('The transfer result is unconfirmed. Check the saved request; do not submit a replacement. '+errorText(error),true);}
    finally{if(current(stamp)&&ticket===sequence){busy=false;if(held)renderRecovery();controls();}}
  }
  async function complete(value,marker){
    const result=validMovement(value?.result||value,marker.input||null,true);
    if(result.requestId!==marker.requestId||value?.state&&value.state!=='completed')throw Error('The original saved transfer ID or outcome could not be verified.');
    forget(marker);pending=pending.filter(row=>row.requestId!==marker.requestId);review=null;
    el('amt-recovery').replaceChildren();el('amt-content').innerHTML='<section class="amt-complete"><span aria-hidden="true">✓</span><h3>Transfer recorded · '+esc(usd(result.amount))+'</h3>'+movementHtml(result)+'<p class="amt-note">Revenue, profit, funding, expenses and Whish fees are unchanged.</p><p class="amt-reference">'+esc(result.requestId)+'</p></section>';
    status('Transfer saved once. Both balances are updated.');notify('Admin money transfer saved.');
    try{await config.onComplete?.(result);}catch{notify('The transfer is saved. Refresh the dashboard balances when ready.');}
  }
  function renderRecovery(){
    const recovery=el('amt-recovery');if(!recovery)return;
    if(!held&&!pending.length){recovery.replaceChildren();return;}
    el('amt-content').replaceChildren();
    if(held?.corrupt){recovery.innerHTML='<section class="amt-recovery"><h3>Review this PC’s saved request</h3><p>'+esc(held.error)+'</p><p>Keep the app data and finish the original request before recording another money transfer.</p></section>';return;}
    if(!held){recovery.innerHTML='<section class="amt-recovery"><h3>Finish a saved transfer first</h3><p>One original transfer needs review. No other drawer or wallet will be substituted.</p>'+pending.map(row=>'<div class="amt-pending-row"><span class="amt-reference">'+esc(row.requestId)+'</span><button type="button" class="button button-secondary" data-amt-adopt="'+esc(row.requestId)+'">Review saved transfer</button></div>').join('')+'</section>';for(const button of recovery.querySelectorAll('[data-amt-adopt]'))button.onclick=()=>{if(busy)return;try{preserve({requestId:button.dataset.amtAdopt,serverReference:true});renderRecovery();check(held);}catch(error){status(errorText(error),true);}};controls();return;}
    recovery.innerHTML='<section class="amt-recovery"><h3>Original transfer · result unconfirmed</h3><p>Check this saved reference or resume its remaining steps. Do not make a new transfer to replace it.</p><p class="amt-reference">'+esc(held.requestId)+'</p>'+(held.plan?'<h3>Original transfer · '+esc(usd(held.plan.amount))+'</h3>'+movementHtml(held.plan)+'<p class="amt-note">'+esc(held.plan.note)+'</p><label class="amt-check"><input id="amt-resume-ack" type="checkbox"'+(held.resumeAcknowledged?' checked':'')+' />I reviewed this original transfer’s businesses, money holders and balances.</label>':'')+'<div class="amt-actions"><button id="amt-check" type="button" class="button button-secondary">Check saved request</button><button id="amt-resume" type="button" class="button button-primary"'+(held.checkedState==='prepared'||held.checkedState==='save_required'?'':' hidden')+'>Resume original transfer</button><button id="amt-retry" type="button" class="button button-secondary"'+(held.checkedState==='not_found'&&held.input?'':' hidden')+'>Retry original request</button><button id="amt-discard" type="button" class="button button-secondary"'+(held.checkedState==='not_found'&&held.canRelease?'':' hidden')+'>Discard unsaved reference</button></div></section>';
    el('amt-check').onclick=()=>check(held);el('amt-resume').onclick=()=>check(held,true);el('amt-retry').onclick=retry;el('amt-discard').onclick=discard;if(el('amt-resume-ack'))el('amt-resume-ack').onchange=()=>{held.resumeAcknowledged=el('amt-resume-ack').checked;controls();};controls();
  }
  async function check(marker,resume = false){
    if(!allowed()||busy||!marker||marker.corrupt||resume&&(!marker.plan||!marker.resumeAcknowledged||!['prepared','save_required'].includes(marker.checkedState)))return;const stamp=capture(),ticket=sequence;busy=true;controls();
    try{const value=await config.api[resume?'resume':'status']({requestId:marker.requestId});if(!current(stamp)||ticket!==sequence)return;
      if(value?.requestId!==marker.requestId)throw Error('The saved transfer reference did not match.');
      if(value.state==='completed')await complete(value,marker);
      else if(['prepared','save_required'].includes(value.state)){const plan=validMovement(value.result,marker.input||null,'prepared');if(plan.requestId!==marker.requestId)throw Error('The original transfer snapshot did not match.');held.plan=plan;held.resumeAcknowledged=false;held.checkedState=value.state;held.canRelease=false;status('The original transfer is saved but unfinished. Review its original money sources and balances, then resume it.');}
      else if(value.state==='not_found'){held.checkedState='not_found';held.canRelease=value.canRelease===true;status('No saved instruction was found for this reference. Review this result before retrying or discarding its local reference.');}
      else throw Error('The original transfer status could not be verified.');
    }catch(error){if(current(stamp)&&ticket===sequence)status(errorText(error),true);}
    finally{if(current(stamp)&&ticket===sequence){busy=false;if(held)renderRecovery();controls();}}
  }
  async function retry(){if(!allowed()||busy||held?.checkedState!=='not_found'||!held.input)return;const stamp=capture(),ticket=sequence,marker=held;busy=true;controls();try{const value=await config.api.transfer({...marker.input});if(current(stamp)&&ticket===sequence)await complete(value,marker);}catch(error){if(current(stamp)&&ticket===sequence)status('The original request is still retained. Check it before another transfer. '+errorText(error),true);}finally{if(current(stamp)&&ticket===sequence){busy=false;if(held)renderRecovery();controls();}}}
  function discard(){
    if(!allowed()||busy||held?.checkedState!=='not_found'||!held.canRelease)return;const marker=held;
    el('amt-recovery').innerHTML='<section class="amt-recovery"><h3>Discard an unsaved reference</h3><p>The server found no saved transfer under this ID. This removes only the local reference; it does not move or refund money.</p><label class="amt-check"><input id="amt-discard-ack" type="checkbox" />I reviewed the original request check and want to discard this unsaved reference.</label><button id="amt-discard-confirm" type="button" class="button button-secondary" disabled>Discard unsaved reference</button></section>';
    el('amt-discard-ack').onchange=()=>{el('amt-discard-confirm').disabled=!el('amt-discard-ack').checked;};
    el('amt-discard-confirm').onclick=async()=>{if(busy||!el('amt-discard-ack').checked)return;const stamp=capture(),ticket=sequence;busy=true;controls();try{const value=await config.api.status({requestId:marker.requestId});if(!current(stamp)||ticket!==sequence)return;if(value?.state!=='not_found'||value.requestId!==marker.requestId||value.canRelease!==true)throw Error('This original transfer can no longer be discarded. Check its status.');forget(marker);pending=pending.filter(row=>row.requestId!==marker.requestId);notify('Unsaved transfer reference discarded.');}catch(error){if(current(stamp)&&ticket===sequence)status(errorText(error),true);}finally{if(current(stamp)&&ticket===sequence){busy=false;renderRecovery();controls();if(!held){close();await open();}}}};
  }
  return {init,open,reset,suspend,updateUser,hasPending:()=>Boolean(held)||pending.length>0||busy};
})();
