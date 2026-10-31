// One reviewed batch, with the existing durable closing applied separately to
// each business. Keep its original input until every child result is verified.
window.MonthClosingAll = (() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value);
  const cents = value => Math.round(value * 100);
  const balance = value => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(cents(value)) && Math.abs(value * 100 - cents(value)) < 1e-6;
  const money = value => balance(value) && value >= 0;
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
  const safeError = error => String(error?.message || error || 'The batch month closing could not be verified.').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,700);
  const sourceKey = row => JSON.stringify([row.holderAccountKey,row.method,row.walletId || '']);
  const walletSum = rows => rows.reduce((sum,row) => sum + cents(row.balance),0) / 100;
  let config,dialog,base,reviewed,held,selected,storageKey='',identity='',sources=[],singlePending=[],busy=false,epoch=0,sequence=0;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const account = () => String(user()?.accountKey || user()?.account_key || '');
  const permitted = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && Boolean(account());
  const allowed = () => permitted() && ['closeMonthsPreview','closeMonths','closeMonthsStatus','resumeMonthsClose'].every(name => typeof config?.api?.[name] === 'function');
  const identityOf = () => JSON.stringify([workspace()?.id,account(),user()?.role,user()?.active,user()?.activity_inspection,user()?.activityInspection]);
  const capture = () => ({epoch,identity});
  const current = stamp => allowed() && stamp.epoch === epoch && stamp.identity === identity && identityOf() === identity;
  const notify = (message,error=false) => config?.toast?.(message,error ? 'error' : undefined);
  const businessIds = () => (config?.sections || []).map(row => row.id).sort();
  function membership(rows) {
    const expected=businessIds();
    if(!Array.isArray(rows)||!expected.length||new Set(expected).size!==expected.length||rows.some(row=>!identifier(row?.workspaceId))||JSON.stringify(rows.map(row=>row.workspaceId).sort())!==JSON.stringify(expected))throw Error('The full list of businesses could not be verified. No business was substituted or omitted.');
  }
  function validAllocations(rows) {
    if(!Array.isArray(rows)||rows.length>500||new Set(rows.map(sourceKey)).size!==rows.length||rows.some(row=>!identifier(row?.holderAccountKey)||!['cash','whish'].includes(row.method)||typeof row.walletId!=='string'||row.method==='cash'&&row.walletId!==''||row.method==='whish'&&!identifier(row.walletId)||!money(row.amount)||row.amount<=0))throw Error('Choose each cash drawer or Whish wallet once, with a positive exact USD amount.');
    return rows;
  }
  function validBalances(value) {
    if(!value||!balance(value.cash)||!money(value.bank)||!Array.isArray(value.wallets)||new Set(value.wallets.map(row=>row?.id)).size!==value.wallets.length||value.wallets.some(row=>!identifier(row?.id)||!balance(row.balance)))throw Error('A business’s recorded cash, Whish or Bank balance could not be verified.');
    return value;
  }
  function validReview(value,row,month) {
    if(!value||value.workspaceId!==row.workspaceId||value.month!==month||typeof value.workspaceName!=='string'||value.mode!=='carry_forward'||!/^\d{4}-\d{2}-\d{2}$/.test(value.today||'')||month>=value.today.slice(0,7)||!hash(value.token)||!Array.isArray(value.sources?.holders)||new Set(value.sources.holders.map(holder=>holder?.accountKey)).size!==value.sources.holders.length)throw Error('A business month-end review could not be verified.');
    validBalances(value.current);validBalances(value.closing);validBalances(value.carry);validAllocations(value.allocations);
    for(const holder of value.sources.holders)if(!identifier(holder?.accountKey)||typeof holder.name!=='string'||!['admin','cashier'].includes(holder.role)||!balance(holder.cashBalance)||!Array.isArray(holder.wallets)||new Set(holder.wallets.map(wallet=>wallet?.id)).size!==holder.wallets.length||holder.wallets.some(wallet=>!identifier(wallet?.id)||typeof wallet.label!=='string'||!balance(wallet.balance)||typeof wallet.active!=='boolean'))throw Error('A month-end money holder could not be verified.');
    const requested=row.allocations||[];validAllocations(requested);
    if(requested.length!==value.allocations.length||!money(value.bankTransferTotal))throw Error('The selected business’s Bank allocations changed.');
    let bankBefore=cents(value.current.bank),total=0,cash=0;
    for(const leg of value.allocations){
      const original=requested.find(item=>sourceKey(item)===sourceKey(leg)),holder=value.sources.holders.find(item=>item.accountKey===leg.holderAccountKey),source=leg.method==='cash'?holder?.cashBalance:holder?.wallets.find(wallet=>wallet.id===leg.walletId&&wallet.active)?.balance;
      if(!original||!balance(source)||cents(source)!==cents(leg.sourceBefore)||cents(original.amount)!==cents(leg.amount)||!balance(leg.sourceBefore)||!money(leg.sourceAfter)||cents(leg.sourceAfter)!==cents(source)-cents(leg.amount)||!money(leg.bankBefore)||!money(leg.bankAfter)||cents(leg.bankBefore)!==bankBefore||cents(leg.bankAfter)!==bankBefore+cents(leg.amount)||typeof leg.holderName!=='string')throw Error('A Bank amount differs from the business and exact source reviewed.');
      bankBefore=cents(leg.bankAfter);total+=cents(leg.amount);if(leg.method==='cash')cash+=cents(leg.amount);
    }
    if(!Number.isSafeInteger(total)||cents(value.bankTransferTotal)!==total||cents(value.carry.cash)!==cents(value.current.cash)-cash||cents(value.carry.bank)!==cents(value.current.bank)+total||value.carry.wallets.length!==value.current.wallets.length)throw Error('A business’s Bank and carry-forward totals do not match.');
    for(const wallet of value.current.wallets){const after=value.carry.wallets.find(item=>item.id===wallet.id),moved=value.allocations.filter(leg=>leg.method==='whish'&&leg.walletId===wallet.id).reduce((sum,leg)=>sum+cents(leg.amount),0);if(!after||cents(after.balance)!==cents(wallet.balance)-moved)throw Error('A carried Whish wallet differs from its Bank allocation.');}
    return value;
  }
  function validArchive(value,month) {
    if(!value||value.month!==month||typeof value.closedAt!=='string'||!Number.isFinite(Date.parse(value.closedAt))||typeof value.actorName!=='string'||value.readOnly!==true||!Array.isArray(value.daily)||!value.report||!value.closing||!balance(value.closing.cash)||!Array.isArray(value.closing.wallets)||value.closing.wallets.some(row=>!balance(row.balance)))throw Error('An already closed business archive could not be verified.');
    return value;
  }
  function validPreview(value,input) {
    if(!value||value.basis!=='all_business_month_close'||value.mode!=='carry_forward'||value.month!==input.month||!hash(value.token))throw Error('The all-business closing preview could not be verified.');
    membership(value.businesses);
    if(input.businesses)membership(input.businesses);
    for(const row of value.businesses){
      if(typeof row.workspaceName!=='string'||!['ready','already_closed'].includes(row.state))throw Error('A business’s closing state could not be verified.');
      const requested=input.businesses?.find(item=>item.workspaceId===row.workspaceId)||{workspaceId:row.workspaceId,allocations:[]};
      if(row.state==='ready')validReview(row.review,requested,input.month);
      else{if(!hash(row.archiveProof))throw Error('An already closed business proof is unavailable.');validArchive(row.archive,input.month);if(requested.allocations?.length)throw Error('An already closed business cannot receive new closing Bank allocations.');}
    }
    return value;
  }
  function validInput(input) {
    if(!input||!requestPattern.test(input.requestId||'')||!monthPattern.test(input.month||'')||!hash(input.token)||input.confirmation!=='CLOSE ALL '+input.month)throw Error('The original reviewed batch closing input is invalid.');
    membership(input.businesses);
    for(const row of input.businesses){if(row.state==='ready'){validAllocations(row.allocations);if(!hash(row.token))throw Error('A business closing token is invalid.');}else if(row.state!=='already_closed'||!hash(row.archiveProof))throw Error('An original business closing state is invalid.');}
    return input;
  }
  function validMarker(marker) {
    if(!marker||marker.version!==1||marker.accountKey!==account()||marker.month!==marker.input?.month||marker.requestId!==marker.input?.requestId)throw Error('The retained all-business closing reference is damaged. Preserve this PC’s app data and resolve it before closing another month.');
    validInput(marker.input);return marker;
  }
  function restore() {
    storageKey='fiber-month-close-all-v1:'+encodeURIComponent(JSON.stringify(['main',account()]));
    try{const raw=localStorage.getItem(storageKey);held=raw?validMarker(JSON.parse(raw)):null;}catch(error){held={corrupt:true,error:'Closing recovery storage is unavailable. New batch closings are blocked. '+safeError(error)};}
  }
  function preserve(input) {
    if(held)throw Error('Resolve the original batch before preparing another closing.');
    const marker=validMarker({version:1,accountKey:account(),month:input.month,requestId:input.requestId,input}),raw=JSON.stringify(marker);
    try{localStorage.setItem(storageKey,raw);if(localStorage.getItem(storageKey)!==raw)throw Error('The original batch reference was not retained.');held=marker;}catch(error){held={corrupt:true,error:'No batch was submitted because its recovery reference could not be saved. '+safeError(error)};throw error;}
  }
  function forget(marker) {
    if(held?.requestId!==marker.requestId)return;
    localStorage.removeItem(storageKey);if(localStorage.getItem(storageKey)!==null)throw Error('The resolved batch reference could not be cleared.');held=null;
  }
  function close(force=false){if(busy&&!force)return;sequence++;if(dialog){dialog.close();dialog.remove();dialog=null;}base=null;reviewed=null;sources=[];}
  function reset(){epoch++;busy=false;close(true);config=null;held=null;singlePending=[];selected=null;identity='';storageKey='';}
  function init(value){reset();config=value;if(!allowed())return;identity=identityOf();restore();}
  function status(message='',error=false){if(!el('mca-status'))return;el('mca-status').textContent=message;el('mca-status').hidden=!message;el('mca-status').classList.toggle('mca-error',error);}
  function controls(){
    if(!dialog)return;dialog.setAttribute('aria-busy',String(busy));
    for(const control of dialog.querySelectorAll('input,button'))control.disabled=busy;
    for(const row of dialog.querySelectorAll('[data-mca-source]')){const source=sources[Number(row.dataset.mcaSource)];row.querySelector('[data-mca-select]').disabled=busy||Boolean(held)||source.balance<=0;row.querySelector('[data-mca-amount]').disabled=busy||Boolean(held)||!row.querySelector('[data-mca-select]').checked;}
    if(el('mca-review'))el('mca-review').disabled=busy||Boolean(held)||!base||singlePending.length>0;
    if(el('mca-confirm'))el('mca-confirm').disabled=busy||Boolean(held)||!reviewed||!el('mca-ack').checked||el('mca-confirmation').value!=='CLOSE ALL '+selected.month;
    if(el('mca-release-confirm'))el('mca-release-confirm').disabled=busy||!el('mca-release-ack').checked;
  }
  function mount(){
    close();dialog=document.createElement('dialog');dialog.className='modal mca-dialog';dialog.setAttribute('aria-labelledby','mca-title');
    dialog.innerHTML='<div class="modal-heading"><div><p class="eyebrow">MAIN OFFICE · MONTHLY ACCOUNTING</p><h2 id="mca-title">End of Month · All businesses</h2><p id="mca-subtitle" class="field-note"></p></div><button id="mca-close" type="button" class="button button-secondary">Close</button></div><p id="mca-status" class="mca-status" role="status" aria-live="polite" hidden></p><section id="mca-recovery" class="mca-recovery" aria-label="Original batch closing recovery" hidden></section><div id="mca-content"><p class="field-note">Loading each business’s separate month-end review…</p></div>';
    document.body.append(dialog);el('mca-close').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
    el('mca-recovery').onclick=event=>{const button=event.target.closest('[data-mca-check],[data-mca-resume],[data-mca-retry],[data-mca-release],[data-mca-single]');if(!button||button.disabled||!allowed())return;if(button.hasAttribute('data-mca-check'))void check(false);else if(button.hasAttribute('data-mca-resume'))void check(true);else if(button.hasAttribute('data-mca-retry'))void retry();else if(button.hasAttribute('data-mca-release'))release();else{const row=singlePending.find(item=>item.requestId===button.dataset.mcaSingle);if(row){close();void window.MonthClosing?.open({workspaceId:row.workspaceId,month:row.month||selected.month});}}};
  }
  function renderRecovery(){
    if(!el('mca-recovery'))return;
    let html='';
    if(held?.corrupt)html='<h3>Closing reference needs review</h3><p>'+esc(held.error)+'</p>';
    else if(held){const proof=held.checked;html='<h3>Resolve the original batch closing</h3><p>Keep this original request. A connection failure can leave some businesses completed and others waiting. Do not create replacement Bank transfers.</p><p class="mca-reference">'+esc(held.month)+' · '+esc(held.requestId)+'</p><div class="mca-actions"><button type="button" class="button button-secondary" data-mca-check>Check original batch</button>'+(proof&&proof.state!=='completed'&&!proof.businesses.some(row=>row.state==='unknown')?'<button type="button" class="button button-primary" data-mca-resume>Continue original batch</button>':'')+(proof?.state==='not_started'&&proof.canRelease?'<button type="button" class="button button-secondary" data-mca-retry>Retry exact original request</button>':'')+(proof?.canReplan||proof?.canRelease?'<button type="button" class="button button-secondary" data-mca-release>Review remaining businesses again</button>':'')+'</div>';}
    for(const row of singlePending)html+='<div class="mca-single-pending"><strong>An individual business closing needs recovery first</strong><p>'+esc(row.workspaceId)+' · '+esc(row.month||'')+' · '+esc(row.requestId)+'</p><button type="button" class="button button-secondary" data-mca-single="'+esc(row.requestId)+'">Review original business closing</button></div>';
    el('mca-recovery').innerHTML=html;el('mca-recovery').hidden=!html;controls();
  }
  function balances(label,value){return '<div class="mca-balances"><h4>'+esc(label)+'</h4><div><span>Cash drawers</span><strong>'+usd(value.cash)+'</strong></div><div><span>Whish wallets</span><strong>'+usd(walletSum(value.wallets))+'</strong></div><div><span>Bank</span><strong>'+usd(value.bank)+'</strong></div></div>';}
  function renderForm(value,requests=[]){
    base=value;reviewed=null;sources=[];el('mca-subtitle').textContent=value.month+' · '+value.businesses.length+' businesses';
    const html=value.businesses.map((business,index)=>{
      if(business.state==='already_closed')return '<section class="mca-business mca-skipped"><div class="mca-business-heading"><h3>'+esc(business.workspaceName)+'</h3><span class="mca-badge">Already closed · skipped</span></div><p class="field-note">'+esc(business.archive.closedAt.replace('T',' '))+' · '+esc(business.archive.actorName)+'. Its saved report and balances remain unchanged.</p></section>';
      const review=business.review,selectedMap=new Map((requests.find(row=>row.workspaceId===business.workspaceId)?.allocations||[]).map(row=>[sourceKey(row),row.amount]));
      const rows=review.sources.holders.flatMap(holder=>[{workspaceId:business.workspaceId,holderAccountKey:holder.accountKey,holderName:holder.name,role:holder.role,method:'cash',walletId:'',label:'Cash drawer',balance:holder.cashBalance},...holder.wallets.filter(wallet=>wallet.active).map(wallet=>({workspaceId:business.workspaceId,holderAccountKey:holder.accountKey,holderName:holder.name,role:holder.role,method:'whish',walletId:wallet.id,label:wallet.label,balance:wallet.balance}))]);
      return '<details class="mca-business" open><summary><span>'+esc(business.workspaceName)+'</span><span class="mca-badge">Ready to review</span></summary><div class="mca-business-body"><div class="mca-snapshots">'+balances('At the end of '+value.month,review.closing)+balances('Recorded balances now',review.current)+'</div><p class="field-note">Choose this business’s optional Bank savings. Unselected cash and Whish money carries forward. Transfers are recorded today ('+esc(review.today)+').</p><div class="mca-source-list">'+rows.map(row=>{const sourceIndex=sources.push(row)-1,amount=selectedMap.get(sourceKey(row)),checked=amount!==undefined;return '<div class="mca-source" data-mca-source="'+sourceIndex+'"><div><strong>'+esc(row.holderName)+'</strong><small>'+esc(row.role==='admin'?'Admin':'Cashier')+' · '+esc(row.method==='cash'?'Cash drawer':'Whish · '+row.label)+'</small></div><div class="mca-available"><span>Available now</span><strong>'+usd(row.balance)+'</strong></div><label class="mca-allocation"><input type="checkbox" data-mca-select aria-label="Move '+esc(business.workspaceName+' '+row.holderName+' '+row.label)+' to Bank"'+(checked?' checked':'')+' /><span>To Bank $</span><input type="number" inputmode="decimal" min="0.01" step="0.01" max="'+esc(Math.max(0,row.balance).toFixed(2))+'" data-mca-amount value="'+esc(checked?amount.toFixed(2):'')+'" aria-label="Bank amount for '+esc(business.workspaceName+' '+row.holderName+' '+row.label)+'" /></label></div>';}).join('')+'</div>'+(!rows.length?'<p class="field-note">No permitted Bank sources. All balances can still carry forward.</p>':'')+'</div></details>';
    }).join('');
    el('mca-content').innerHTML='<p class="mca-warning">Review every business separately. Closing preserves each month’s report and carries remaining money forward. Already closed businesses are skipped. A batch can finish one business before another; its original recovery reference keeps every result linked.</p><form id="mca-form">'+html+'<section id="mca-review-result" hidden></section><div id="mca-confirm-fields" class="mca-confirm-fields" hidden><label>Type CLOSE ALL '+esc(value.month)+'<input id="mca-confirmation" autocomplete="off" spellcheck="false" /></label><label class="mca-check"><input id="mca-ack" type="checkbox" />I reviewed every business, each selected Bank amount, all balances carried forward and the businesses already closed.</label></div><p id="mca-form-error" class="form-error" role="status" aria-live="polite"></p><div class="mca-actions mca-footer"><button id="mca-review" type="button" class="button button-secondary">Review all business closings</button><button id="mca-confirm" type="submit" class="button button-primary" disabled>Close '+esc(value.month)+' for all businesses</button></div></form>';
    el('mca-form').oninput=event=>{if(event.target.closest('[data-mca-source]')){reviewed=null;el('mca-review-result').hidden=true;el('mca-confirm-fields').hidden=true;el('mca-ack').checked=false;el('mca-confirmation').value='';el('mca-form-error').textContent='';}controls();};
    el('mca-form').onchange=controls;el('mca-review').onclick=()=>void review();el('mca-form').onsubmit=event=>{event.preventDefault();void commit();};controls();
  }
  function inputs(){
    const businesses=base.businesses.map(row=>({workspaceId:row.workspaceId,allocations:[]}));
    for(const row of dialog.querySelectorAll('[data-mca-source]'))if(row.querySelector('[data-mca-select]').checked){const source=sources[Number(row.dataset.mcaSource)];businesses.find(item=>item.workspaceId===source.workspaceId).allocations.push({holderAccountKey:source.holderAccountKey,method:source.method,walletId:source.walletId,amount:Number(row.querySelector('[data-mca-amount]').value)});}
    for(const row of businesses)validAllocations(row.allocations);return {month:selected.month,businesses};
  }
  function renderReview(value){
    el('mca-review-result').innerHTML='<h3>Final review · '+esc(value.month)+'</h3><p class="field-note">Each Bank account belongs to its own business. No money is moved between businesses, no expense or Whish fee is created, and no cash or wallet balance is reset.</p>'+value.businesses.map(row=>row.state==='already_closed'?'<article class="mca-reviewed-business"><h4>'+esc(row.workspaceName)+'</h4><p>Already closed · skipped</p></article>':'<article class="mca-reviewed-business"><h4>'+esc(row.workspaceName)+'</h4><p><span>Bank savings</span><strong>'+usd(row.review.bankTransferTotal)+'</strong></p>'+row.review.allocations.map(leg=>'<p><span>'+esc(leg.holderName)+' · '+esc(leg.method==='cash'?'Cash drawer':'Whish · '+(leg.walletLabel||leg.walletId))+'</span><strong>'+usd(leg.sourceBefore)+' → '+usd(leg.sourceAfter)+'</strong></p>').join('')+balances('Carry forward after closing',row.review.carry)+'</article>').join('');
    el('mca-review-result').hidden=false;el('mca-confirm-fields').hidden=false;
    for(const section of dialog.querySelectorAll('details.mca-business')){section.open=false;section.querySelector('.mca-badge').textContent='Reviewed';}
    const heading=el('mca-review-result').querySelector('h3');heading.tabIndex=-1;heading.focus();el('mca-review-result').scrollIntoView({block:'start'});
  }
  async function open(input){
    if(!allowed()){notify('All-business End of Month is available to the Main Office administrator. Update Main and this PC together if needed.',true);return;}
    if(!monthPattern.test(input?.month||'')){notify('Choose a valid completed month.',true);return;}if(busy)return;
    if(identity!==identityOf()){epoch++;identity=identityOf();restore();}
    selected={month:held?.input?.month||input.month};singlePending=[];mount();const stamp=capture(),request=sequence;busy=true;controls();
    try{
      renderRecovery();if(held){el('mca-content').innerHTML='<p class="field-note">Check the original batch before reviewing another closing.</p>';return;}
      const pending=typeof config.api.pendingMonthClose==='function'?await config.api.pendingMonthClose():null;
      if(!current(stamp)||request!==sequence)return;
      if(!pending||!Array.isArray(pending.requests)||pending.requests.some(row=>!identifier(row?.workspaceId)||!requestPattern.test(row.requestId||'')||row.state!=='save_required'))throw Error('Individual month-closing recovery status is unavailable. No new batch was prepared.');
      singlePending=pending.requests;
      if(singlePending.length||window.MonthClosing?.hasPending()){el('mca-content').innerHTML='<p class="field-note">Resolve the original individual business closing before preparing this batch. If its reference is retained on this PC, close this dialog, select that business in Monthly ledger and use Review &amp; close month to check it.</p>';renderRecovery();return;}
      const value=validPreview(await config.api.closeMonthsPreview(selected),selected);if(!current(stamp)||request!==sequence)return;renderForm(value);
    }catch(error){if(current(stamp)&&request===sequence){el('mca-content').textContent='';status(safeError(error),true);}}
    finally{if(current(stamp)&&request===sequence){busy=false;renderRecovery();controls();}}
  }
  async function review(){
    if(!allowed()||busy||held||!base||singlePending.length)return;let input;try{input=inputs();}catch(error){el('mca-form-error').textContent=safeError(error);return;}
    const stamp=capture(),request=sequence;busy=true;reviewed=null;controls();el('mca-form-error').textContent='';
    try{const value=validPreview(await config.api.closeMonthsPreview(input),input);if(!current(stamp)||request!==sequence)return;renderForm(value,input.businesses);reviewed={value,input};renderReview(value);}catch(error){if(current(stamp)&&request===sequence)el('mca-form-error').textContent=safeError(error);}
    finally{if(current(stamp)&&request===sequence){busy=false;controls();}}
  }
  async function commit(){
    if(!allowed()||busy||held||!reviewed||!el('mca-ack').checked||el('mca-confirmation').value!=='CLOSE ALL '+selected.month)return;
    let input;try{const currentInput=inputs();validPreview(reviewed.value,currentInput);input=validInput({requestId:'month-all-'+crypto.randomUUID(),month:selected.month,businesses:reviewed.value.businesses.map(row=>row.state==='ready'?{workspaceId:row.workspaceId,state:'ready',allocations:currentInput.businesses.find(item=>item.workspaceId===row.workspaceId).allocations,token:row.review.token}:{workspaceId:row.workspaceId,state:'already_closed',archiveProof:row.archiveProof}),token:reviewed.value.token,confirmation:el('mca-confirmation').value});preserve(input);}catch(error){el('mca-form-error').textContent=safeError(error);renderRecovery();return;}
    await execute('closeMonths',input);
  }
  function validOutcome(value,marker){
    if(!value||value.basis!=='all_business_month_close'||value.mode!=='carry_forward'||value.requestId!==marker.requestId||value.month!==marker.month||!['completed','partial','not_started'].includes(value.state)||typeof value.canRelease!=='boolean'||typeof value.canReplan!=='boolean')throw Error('The original batch result could not be verified. Keep its recovery reference.');
    membership(value.businesses);const counts={completed:0,alreadyClosed:0,remaining:0,saveRequired:0};
    for(const row of value.businesses){
      const original=marker.input.businesses.find(item=>item.workspaceId===row.workspaceId);
      if(typeof row.workspaceName!=='string'||!['completed','save_required','not_started','already_closed','unknown'].includes(row.state))throw Error('A business result in the original batch is unavailable.');
      if(row.state==='already_closed'){if(original.state!=='already_closed'||row.archiveProof!==original.archiveProof)throw Error('An original closed-business proof changed.');validArchive(row.archive,marker.month);counts.alreadyClosed++;}
      else if(row.state==='completed'||row.state==='save_required'){if(original.state!=='ready'||!requestPattern.test(row.requestId||'')||row.result?.requestId!==row.requestId||row.result?.state!=='completed'||row.result.mode!=='carry_forward')throw Error('A saved business closing result is unavailable.');validArchive(row.result,marker.month);if(row.state==='completed')counts.completed++;else{counts.saveRequired++;counts.remaining++;}}
      else{if(original.state!=='ready')throw Error('An already closed business was returned as unstarted.');counts.remaining++;}
    }
    if(!value.counts||Object.keys(counts).some(key=>value.counts[key]!==counts[key])||value.state==='completed'&&counts.remaining||value.state!=='completed'&&!counts.remaining||value.canRelease&&(value.state!=='not_started'||counts.completed||counts.saveRequired)||value.canReplan&&(counts.saveRequired||value.businesses.some(row=>row.state==='unknown')))throw Error('The per-business batch progress could not be verified.');
    return value;
  }
  function renderOutcome(value){
    el('mca-content').innerHTML='<section class="mca-outcome"><h3>'+(value.state==='completed'?'All business closings are resolved':'Batch closing progress')+'</h3><p class="field-note">'+value.counts.completed+' completed · '+value.counts.alreadyClosed+' already closed · '+value.counts.remaining+' remaining ('+value.counts.saveRequired+' awaiting durable save)</p><div class="mca-outcome-list">'+value.businesses.map(row=>'<article><strong>'+esc(row.workspaceName)+'</strong><span>'+esc({completed:'Closed successfully',already_closed:'Already closed · skipped',save_required:'Save confirmation required',not_started:'Not started',unknown:'Result needs review · original request retained'}[row.state])+'</span>'+(row.requestId?'<small class="mca-reference">'+esc(row.requestId)+'</small>':'')+'</article>').join('')+'</div>'+(value.error?'<p class="form-error">'+esc(safeError(value.error))+'</p>':'')+'</section>';
  }
  async function accept(value,marker){
    const result=validOutcome(value,marker);renderOutcome(result);reviewed=null;base=null;
    if(result.state==='completed'){forget(marker);status('Every business is closed or was already closed. Archived reports remain separate; remaining money carried forward.');notify('All business month closings verified.');try{await config.onComplete?.(result);}catch{notify('Closings are saved. Refresh the ledger and dashboard when ready.');}}
    else{held.checked=result;status('The original batch is retained. Review its per-business progress, then continue the original request or review remaining businesses only when the server allows it.',true);}
  }
  async function execute(method,input){
    const stamp=capture(),request=sequence,marker=held;busy=true;controls();
    try{const result=await config.api[method](input);if(!current(stamp)||request!==sequence)return;await accept(result,marker);}catch(error){if(current(stamp)&&request===sequence)status('The batch result is unconfirmed. Check its original request before closing again or replacing Bank transfers. '+safeError(error),true);}
    finally{if(current(stamp)&&request===sequence){busy=false;renderRecovery();controls();}}
  }
  async function check(resume){if(!allowed()||busy||!held||held.corrupt)return;await execute(resume?'resumeMonthsClose':'closeMonthsStatus',held.input);}
  async function retry(){if(!allowed()||busy||held?.checked?.state!=='not_started'||held.checked.canRelease!==true)return;await execute('closeMonths',held.input);}
  function release(){
    if(!allowed()||busy||!held||held.corrupt||!(held.checked?.canReplan||held.checked?.canRelease))return;
    const marker=held;el('mca-content').innerHTML='<p class="mca-warning">Completed business archives and Bank transfers stay saved. Only the unfinished part of this batch will be reviewed again. No closing or payment is reversed.</p><label class="mca-check"><input id="mca-release-ack" type="checkbox" />I reviewed the original batch progress and want a new review for its remaining businesses.</label><button id="mca-release-confirm" type="button" class="button button-primary" disabled>Review remaining businesses</button>';
    el('mca-release-ack').onchange=controls;el('mca-release-confirm').onclick=async()=>{
      if(busy||!el('mca-release-ack').checked)return;const stamp=capture(),request=sequence;busy=true;controls();let released=false;
      try{const result=validOutcome(await config.api.closeMonthsStatus(marker.input),marker);if(!current(stamp)||request!==sequence)return;if(result.state==='completed'){await accept(result,marker);return;}if(!result.canReplan&&!result.canRelease)throw Error('The original batch cannot be released. Continue its saved recovery instead.');forget(marker);released=true;}
      catch(error){if(current(stamp)&&request===sequence)status(safeError(error),true);}
      finally{if(current(stamp)&&request===sequence){busy=false;renderRecovery();controls();if(released){const month=marker.month;close();await open({month});}}}
    };
  }
  return {init,open,reset,close,hasPending:()=>Boolean(held)||busy};
})();
