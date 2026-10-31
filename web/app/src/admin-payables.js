// Main Admin company payables. Lists are read-only; existing ledgers own every
// payment and its original cash/wallet, profit and recovery rules.
window.AdminPayables=(()=>{
 'use strict';
 const el=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<1e-6;
 const usd=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value),count=value=>Number.isSafeInteger(value)&&value>=0;
 const definitions=[
  {id:'bandwidth',title:'Bandwidth Accounting',listTitle:'Unpaid bandwidth supplier bills',period:'all_dates',details:'Unpaid supplier balances · all dates',button:'View unpaid supplier bills',icon:'chart',pay:'payBandwidth'},
  {id:'monthly',title:'Fixed monthly payments',listTitle:'Unpaid monthly payments',period:'through_current_month',details:'Unpaid monthly bills · through the current month',button:'View unpaid monthly payments',icon:'clock',pay:'payMonthly'},
  {id:'companyDebts',title:'Company debts',listTitle:'Unpaid Company debts',period:'all_dates',details:'Remaining company debts · all dates',button:'View unpaid Company debts',icon:'debt',pay:'payCompanyDebt'}
 ];
 let config=null,mounted=false,identity='',generation=0,ticket=0,inflight=null,loading=false,summaryLoaded=false;
 let listSection=null,listRows=[],listTicket=0,listRequest=null,listLoading=false,listAvailable=false,listPaying=null,listLoaded=false,listMarkup='';
 const user=()=>config?.getUser?.()??config?.user,workspace=()=>config?.getWorkspace?.()??config?.workspace;
 const allowed=()=>workspace()?.id==='main'&&user()?.role==='admin'&&user()?.active!==false&&user()?.active!==0&&user()?.activity_inspection!==true&&user()?.activityInspection!==true&&Boolean(config?.has?.('dashboard.view'));
 const identityOf=()=>JSON.stringify([workspace()?.id,user()?.accountKey||user()?.account_key||user()?.id||user()?.username,user()?.role,user()?.active,user()?.activity_inspection,user()?.activityInspection,businessSelection(),[...(user()?.permissions||[])].sort(),[...(user()?.allowedSections||[])].sort()]);
 const businessIds=new Set(['all','main','fiber-users','fiber-resellers','iptv','printer','studio','mobile-ogero']);
 const businessSelection=()=>String(config?.getBusiness?.()??el('finance-business')?.value??'all');
 const selector=()=>{const workspaceId=businessSelection();if(!businessIds.has(workspaceId))throw Error('Choose a supported business before viewing its payables.');return workspaceId==='all'?[]:[{workspaceId}];};
 const scopeMatches=(value,id)=>id==='all'?value?.scope==='company'&&(value.workspaceId===undefined||value.workspaceId==='all'):value?.scope==='business'&&value.workspaceId===id&&typeof value.workspaceName==='string'&&value.workspaceName.trim()&&value.workspaceName.length<=300;
 const scopeLabel=value=>value.workspaceId&&value.workspaceId!=='all'?value.workspaceName:'All businesses';
 const unassignedValid=(value,id)=>value&&typeof value==='object'&&!Array.isArray(value)&&value.included===(id==='all')&&(value.available===true?money(value.amount)&&count(value.count):value.available===false&&value.amount===null&&value.count===null);
 const current=(key,epoch)=>allowed()&&identity===key&&identityOf()===key&&generation===epoch;
 const message=error=>error?.message||String(error),safeText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500):'';
 const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 const validMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&Number(value.slice(0,4))>=1900;
 const validId=value=>typeof value==='string'&&value.length>0&&value.length<=500&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
 const positiveId=value=>Number.isSafeInteger(value)&&value>0;
 const icon=name=>'<svg class="ui-icon" aria-hidden="true"><use href="#icon-'+name+'"></use></svg>';
 const empty=text=>'<tr><td colspan="6"><div class="empty-state"><div><strong>'+esc(text)+'</strong></div></div></td></tr>';
 const definition=id=>definitions.find(row=>row.id===id);
 const text=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
 const table=markup=>{if(listMarkup!==markup){el('ap-list-body').innerHTML=markup;listMarkup=markup;}};
 function position(){const panel=el('admin-payables-panel'),anchor=el('admin-receivables-panel')||el('warehouse-debt-panel')||el('workspace-cards');if(panel&&anchor&&anchor.nextElementSibling!==panel)anchor.after(panel);}
 function mount(){
  if(mounted)return;const anchor=el('workspace-cards');if(!anchor)return;mounted=true;
  const panel=document.createElement('section');panel.id='admin-payables-panel';panel.className='admin-payables-panel hidden';panel.setAttribute('aria-labelledby','ap-panel-title');panel.setAttribute('aria-busy','false');
  panel.innerHTML='<div class="admin-payables-heading"><div><p class="eyebrow">ADMIN · MONEY TO PAY</p><h2 id="ap-panel-title">Company payments outstanding</h2><span id="ap-business-scope" class="status">Verifying business scope</span><p id="ap-as-of" class="field-note"></p></div><button id="ap-refresh" type="button" class="button button-secondary">'+icon('refresh')+'Refresh balances</button></div><div class="admin-payables-grid">'+definitions.map(row=>'<article class="metric-card admin-payable-card admin-payable-'+row.id+'" aria-labelledby="ap-'+row.id+'-title"><span id="ap-'+row.id+'-title">'+row.title+'</span><strong id="ap-'+row.id+'-amount">—</strong><small id="ap-'+row.id+'-count">Balance not loaded</small><p class="field-note admin-payable-period">'+row.details+'</p><p id="ap-'+row.id+'-status" class="field-note admin-payable-status" role="status" aria-live="polite"></p><div class="admin-payable-actions"><button id="ap-'+row.id+'-open" type="button" class="button button-secondary">'+icon(row.icon)+row.button+'</button><button id="ap-'+row.id+'-retry" type="button" class="text-button hidden">Retry balance</button></div></article>').join('')+'</div><p id="ap-scope-note" class="field-note admin-payables-note">Amounts and lists follow the Business filter below. Shared bills show that business’s saved share; the Employee filter does not change company obligations. Linked monthly debts remain one obligation, not two payments.</p><p id="ap-unassigned-note" class="field-note"></p>';
  anchor.after(panel);position();el('ap-refresh').onclick=()=>load();for(const row of definitions){el('ap-'+row.id+'-retry').onclick=()=>load();el('ap-'+row.id+'-open').onclick=()=>open(row.id);}
  const dialog=document.createElement('dialog');dialog.id='ap-list-dialog';dialog.className='modal admin-payables-modal';dialog.setAttribute('aria-labelledby','ap-list-title');dialog.setAttribute('aria-describedby','ap-list-note');dialog.setAttribute('aria-busy','false');
  dialog.innerHTML='<div class="modal-heading"><div><p class="eyebrow">MAIN OFFICE · MONEY TO PAY</p><h2 id="ap-list-title">Payments outstanding</h2><p id="ap-list-total" class="subtext"></p></div><button id="ap-list-close" type="button" class="button button-secondary">Close</button></div><div class="admin-payables-toolbar"><label class="search-box">'+icon('search')+'<input id="ap-list-search" type="search" aria-label="Search outstanding payments" placeholder="Name, description or date" /></label><button id="ap-list-refresh" type="button" class="button button-secondary">'+icon('refresh')+'Refresh list</button></div><p id="ap-list-status" class="field-note" role="status" aria-live="polite"></p><div class="table-wrap"><table><thead><tr><th>Payment / description</th><th>Date / month</th><th class="number">Original</th><th class="number">Paid</th><th class="number">Remaining</th><th>Action</th></tr></thead><tbody id="ap-list-body"></tbody></table></div><p id="ap-list-note" class="field-note admin-payables-list-note">Pay opens the original payment form, including its business, cash drawer or Whish wallet selections. A business filter changes this list only; a shared monthly bill still opens its complete original business shares. Nothing is paid until you review and confirm that form. A linked monthly debt appears in both lists as one obligation, not two payments.</p>';
  document.body.append(dialog);el('ap-list-close').onclick=closeList;el('ap-list-refresh').onclick=()=>load();el('ap-list-search').oninput=renderList;
  el('ap-list-body').onclick=event=>{const button=event.target.closest('[data-ap-pay]');if(!button||button.disabled)return;const row=listRows.find(item=>item.key===button.dataset.apPay);if(row)pay(row);};
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeList();});dialog.addEventListener('close',()=>{if(!dialog.open)clearList();});
  el('logout-button')?.addEventListener('click',()=>reset(),{capture:true});
  document.addEventListener('change',event=>{if(event.target?.id==='finance-business'&&allowed())void load();},{capture:true});
 }
 function controls(){
  if(!mounted)return;el('ap-refresh').disabled=loading;
  for(const row of definitions){el('ap-'+row.id+'-open').disabled=!allowed();el('ap-'+row.id+'-retry').disabled=loading;}
  el('ap-list-refresh').disabled=!allowed()||listLoading;el('ap-list-search').disabled=!allowed()||!listAvailable;
  for(const button of el('ap-list-body').querySelectorAll('[data-ap-pay]'))button.disabled=!allowed()||!listAvailable||listPaying!==null||typeof config?.[definition(listSection)?.pay]!=='function';
 }
 function unavailable(id,reason='Balance could not be verified. Refresh or open the original ledger.'){if(!mounted)return;text('ap-'+id+'-amount','—');text('ap-'+id+'-count',loading?'Verifying outstanding balance…':'Balance unavailable');text('ap-'+id+'-status',safeText(reason));el('ap-'+id+'-status').classList.toggle('admin-payable-error',!loading);el('ap-'+id+'-retry').classList.toggle('hidden',loading);}
 function clearList(){
  listTicket++;listSection=null;listRows=[];listRequest=null;listLoading=false;listAvailable=false;listPaying=null;listLoaded=false;if(!mounted)return;
  el('ap-list-dialog').setAttribute('aria-busy','false');text('ap-list-total','');text('ap-list-status','');el('ap-list-status').classList.remove('admin-payable-error');table('');el('ap-list-search').value='';controls();
 }
 function closeList(){if(mounted&&el('ap-list-dialog').open)el('ap-list-dialog').close();clearList();}
 function clear(){generation++;ticket++;identity='';inflight=null;loading=false;summaryLoaded=false;if(!mounted)return;closeList();el('admin-payables-panel').classList.add('hidden');el('admin-payables-panel').setAttribute('aria-busy','false');text('ap-as-of','');text('ap-business-scope','Verifying business scope');text('ap-unassigned-note','');for(const row of definitions)unavailable(row.id,'');controls();}
 function syncAccess(){if(!allowed()){if(identity)clear();else if(mounted){closeList();el('admin-payables-panel').classList.add('hidden');}return false;}mount();if(!mounted)return false;const key=identityOf();if(identity!==key){clear();identity=key;}position();el('admin-payables-panel').classList.remove('hidden');controls();return true;}
 function renderCard(row,value){if(value?.available!==true||value.period!==row.period||!money(value.amount)||!count(value.count)){unavailable(row.id,safeText(value?.reason)||safeText(value?.error)||'This balance is unavailable or has an unfinished operation. Refresh or review the original ledger.');return;}text('ap-'+row.id+'-amount',usd(value.amount));text('ap-'+row.id+'-count',value.count+' outstanding '+(row.id==='bandwidth'?'supplier bill':row.id==='monthly'?'monthly bill':'company debt')+(value.count===1?'':'s'));text('ap-'+row.id+'-status','');el('ap-'+row.id+'-status').classList.remove('admin-payable-error');el('ap-'+row.id+'-retry').classList.add('hidden');}
 async function loadSummary(){
  if(!syncAccess())return;const key=identity,epoch=generation;if(inflight?.key===key&&inflight.epoch===epoch)return inflight.promise;const selected=++ticket;loading=true;el('admin-payables-panel').setAttribute('aria-busy','true');if(!summaryLoaded){text('ap-as-of','');for(const row of definitions)unavailable(row.id,'');}controls();
  const promise=(async()=>{await Promise.resolve();if(!current(key,epoch))return;try{if(typeof config?.api?.mainOfficePayables?.overview!=='function')throw Error('Update Main and this PC together to load company payment balances.');const selectedBusiness=businessSelection(),result=await config.api.mainOfficePayables.overview(...selector());if(!current(key,epoch)||ticket!==selected)return;if(result?.basis!=='main_office_payables'||!scopeMatches(result,selectedBusiness)||!validDay(result.asOf)||!result.cards||typeof result.cards!=='object'||Array.isArray(result.cards))throw Error('The selected business payment scope could not be verified. No company-wide totals were substituted.');
    if(result.unassignedCompanyDebts!==undefined&&!unassignedValid(result.unassignedCompanyDebts,selectedBusiness))throw Error('The unassigned Company debt balance could not be verified.');
    loading=false;summaryLoaded=true;text('ap-business-scope',scopeLabel(result)+(selectedBusiness==='all'?'':' · business share'));text('ap-as-of',scopeLabel(result)+' outstanding balances · as of '+result.asOf);
    const unassigned=result.unassignedCompanyDebts;text('ap-unassigned-note',unassigned?.available===true&&unassigned.count?usd(unassigned.amount)+' in '+unassigned.count+' unassigned manual Company debt'+(unassigned.count===1?'':'s')+(unassigned.included?' included in All businesses.':' excluded from this business until Admin assigns them.'):'');
    for(const row of definitions)renderCard(row,result.cards[row.id]);}catch(error){if(current(key,epoch)&&ticket===selected){loading=false;summaryLoaded=true;text('ap-business-scope','Business scope unavailable');text('ap-as-of','');text('ap-unassigned-note','');for(const row of definitions)unavailable(row.id,message(error));}}finally{if(current(key,epoch)&&ticket===selected){loading=false;el('admin-payables-panel').setAttribute('aria-busy','false');controls();}if(inflight?.ticket===selected)inflight=null;}})();inflight={key,epoch,ticket:selected,promise};return promise;
 }
 function validRows(result,section){
  if(!money(result.amount)||!count(result.count)||!Array.isArray(result.rows)||result.count!==result.rows.length)return false;
  const seen=new Set(),targets=new Set();let total=0n;
  for(const row of result.rows){
   if(!row||!validId(row.key)||seen.has(row.key)||typeof row.title!=='string'||!row.title.trim()||typeof row.description!=='string'||!validDay(row.date)||!money(row.originalAmount)||!money(row.paidAmount)||!money(row.remainingAmount)||row.remainingAmount<=0)return false;
   const original=Math.round(row.originalAmount*100),paid=Math.round(row.paidAmount*100),remaining=Math.round(row.remainingAmount*100);if(paid>original||original-paid!==remaining)return false;
   if(result.scope==='business'){if(!money(row.fullOriginalAmount)||!money(row.fullPaidAmount)||!money(row.fullRemainingAmount))return false;const fullOriginal=Math.round(row.fullOriginalAmount*100),fullPaid=Math.round(row.fullPaidAmount*100),fullRemaining=Math.round(row.fullRemainingAmount*100);if(fullOriginal-fullPaid!==fullRemaining||fullOriginal<original||fullPaid<paid||fullRemaining<remaining)return false;}
   let target;
   if(section==='bandwidth'){if(row.kind!=='supplier'||!positiveId(row.supplierId)||row.key!=='supplier:'+row.supplierId||row.billId!==null||row.debtId!==null||row.month!==null||!positiveId(row.purchaseCount))return false;target=row.supplierId;}
   else if(section==='monthly'){if(row.kind!=='monthly'||!validId(row.billId)||row.key!==row.billId||row.supplierId!==null||row.debtId!==null||row.purchaseCount!==null||!validMonth(row.month)||row.month>result.asOf.slice(0,7))return false;target=row.billId;}
   else{if(!['manual_debt','linked_monthly_debt'].includes(row.kind)||!validId(row.debtId)||row.key!==row.debtId||row.supplierId!==null||row.purchaseCount!==null)return false;if(row.kind==='manual_debt'&&(row.billId!==null||row.month!==null)||row.kind==='linked_monthly_debt'&&(!validId(row.billId)||!validMonth(row.month)))return false;target=row.debtId;}
   if(targets.has(target))return false;seen.add(row.key);targets.add(target);total+=BigInt(remaining);if(total>BigInt(Number.MAX_SAFE_INTEGER))return false;
  }
  return total===BigInt(Math.round(result.amount*100));
 }
 function showListUnavailable(reason){listRows=[];listAvailable=false;listLoaded=true;text('ap-list-total','— · Verified balance unavailable');text('ap-list-status',safeText(reason)||'The outstanding payments could not be verified. Refresh the list or review the original ledger.');el('ap-list-status').classList.add('admin-payable-error');table(empty('No verified payment actions available'));}
 function renderList(){
  if(!allowed()||!listAvailable||!listSection)return;
  const term=el('ap-list-search').value.trim().toLowerCase(),rows=listRows.filter(row=>[row.title,row.description,row.date,row.month].some(value=>String(value||'').toLowerCase().includes(term)));
  el('ap-list-status').classList.remove('admin-payable-error');text('ap-list-status',rows.length+' of '+listRows.length+' outstanding '+(listSection==='bandwidth'?'suppliers':listSection==='monthly'?'monthly payments':'company debts')+' shown');
  table(rows.length?rows.map(row=>'<tr><td data-label="Payment"><div class="admin-payable-cell"><strong>'+esc(row.title)+'</strong><span>'+esc(row.description||'No description recorded')+'</span>'+(row.fullOriginalAmount!==undefined?'<small>Business share shown · full original bill '+usd(row.fullOriginalAmount)+'</small>':'')+(row.kind==='supplier'?'<small>'+row.purchaseCount+' unpaid purchase'+(row.purchaseCount===1?'':'s')+'</small>':row.kind==='linked_monthly_debt'?'<small>Linked monthly payment · one obligation</small>':'')+'</div></td><td data-label="Date / month"><div class="admin-payable-cell"><span>'+esc(row.date)+'</span>'+(row.month?'<small>'+esc(row.month)+'</small>':'')+'</div></td><td data-label="Original" class="number">'+usd(row.originalAmount)+'</td><td data-label="Paid" class="number paid-amount">'+usd(row.paidAmount)+'</td><td data-label="Remaining" class="number"><strong>'+usd(row.remainingAmount)+'</strong></td><td data-label="Action"><button type="button" class="button button-primary" data-ap-pay="'+esc(row.key)+'">Pay</button></td></tr>').join(''):empty(listRows.length?'No matching outstanding payments':'No outstanding payments'));controls();
 }
 const currentList=(key,epoch,selected,section)=>current(key,epoch)&&listTicket===selected&&listSection===section&&el('ap-list-dialog').open;
 async function loadList(){
  if(!syncAccess()||!listSection||!el('ap-list-dialog').open)return;const section=listSection,row=definition(section),key=identity,epoch=generation;
  if(listRequest?.key===key&&listRequest.epoch===epoch&&listRequest.section===section)return listRequest.promise;
  const selected=++listTicket;listLoading=true;el('ap-list-dialog').setAttribute('aria-busy','true');if(!listLoaded){listAvailable=false;listRows=[];text('ap-list-total','Verifying outstanding payments…');text('ap-list-status','');el('ap-list-status').classList.remove('admin-payable-error');table(empty('Loading verified outstanding payments…'));}controls();
  const promise=(async()=>{await Promise.resolve();if(!currentList(key,epoch,selected,section))return;try{
   if(typeof config?.api?.mainOfficePayables?.details!=='function')throw Error('Update Main and this PC together to view payment lists.');
   const selectedBusiness=businessSelection(),result=await config.api.mainOfficePayables.details(section,...selector());if(!currentList(key,epoch,selected,section))return;
   if(result?.basis!=='main_office_payable_details'||!scopeMatches(result,selectedBusiness)||result.section!==section||result.period!==row.period||!validDay(result.asOf))throw Error('The original payment list scope could not be verified.');
   if(result.unassignedCompanyDebts!==undefined&&!unassignedValid(result.unassignedCompanyDebts,selectedBusiness))throw Error('The unassigned Company debt list scope could not be verified.');
   if(result.available===false){if(result.amount!==null||result.count!==null||!Array.isArray(result.rows)||result.rows.length)throw Error('An unavailable payment list returned conflicting amounts.');showListUnavailable(result.reason);return;}
   if(result.available!==true||!validRows(result,section))throw Error('The outstanding payments, identities and exact balances could not be verified. No payment actions were enabled.');
   listRows=result.rows.map(item=>Object.freeze({...item}));listAvailable=true;listLoaded=true;text('ap-list-total',scopeLabel(result)+' · '+usd(result.amount)+' remaining · '+result.count+' '+(section==='bandwidth'?'supplier'+(result.count===1?'':'s'):'payment'+(result.count===1?'':'s'))+' · as of '+result.asOf);renderList();
  }catch(error){if(currentList(key,epoch,selected,section))showListUnavailable(message(error));}finally{if(currentList(key,epoch,selected,section)){listLoading=false;el('ap-list-dialog').setAttribute('aria-busy','false');controls();}if(listRequest?.ticket===selected)listRequest=null;}})();
  listRequest={key,epoch,section,ticket:selected,promise};return promise;
 }
 async function load(){if(!syncAccess())return;const tasks=[loadSummary()];if(listSection&&el('ap-list-dialog').open)tasks.push(loadList());await Promise.all(tasks);}
 async function open(id){
  if(!definition(id)||!syncAccess())return;const dialog=el('ap-list-dialog');if(listSection===id&&dialog.open)return loadList();
  clearList();listSection=id;el('ap-list-title').textContent=definition(id).listTitle;el('ap-list-search').setAttribute('aria-label','Search '+definition(id).listTitle.toLowerCase());
  if(!dialog.open)dialog.showModal();return loadList();
 }
 async function pay(row){
  if(!syncAccess()||!listSection||!listAvailable||listPaying!==null||!listRows.includes(row)||!el('ap-list-dialog').open)return;
  const section=listSection,selected=listTicket,key=identity,epoch=generation,callback=config?.[definition(section).pay];if(typeof callback!=='function')return;
  const opening={key:row.key};listPaying=opening;controls();el('ap-list-status').classList.remove('admin-payable-error');el('ap-list-status').textContent='Opening the original payment review for '+safeText(row.title)+'…';
  try{const id=section==='bandwidth'?row.supplierId:section==='monthly'?row.billId:row.debtId;await callback(id);if(currentList(key,epoch,selected,section)){el('ap-list-status').textContent='Review and confirm the original payment form. This list remains open and refreshes after payment.';}}
  catch(error){if(currentList(key,epoch,selected,section)){el('ap-list-status').textContent=safeText(message(error));el('ap-list-status').classList.add('admin-payable-error');}}
  finally{if(current(key,epoch)&&listSection===section&&listPaying===opening){listPaying=null;controls();}}
 }
 function init(value){clear();config=value;syncAccess();}
 function updateUser(value){if(config)config.user=value;syncAccess();}
 function reset(){clear();config=null;}
 return Object.freeze({init,load,syncAccess,updateUser,reset});
})();
