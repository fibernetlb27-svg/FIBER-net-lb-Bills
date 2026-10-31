let registrationForm=null,registrationRequest=null,registeredCustomer=null,registrationBusy=false,equipmentDraft=[],registrationHistory=[],registrationResellers=[],registrationEpoch=0;
let registrationCostRefreshing=false;
let registrationAmountAutomatic=true;
function registrationStatus(message){$('#new-customer-status').textContent=message;}
function updateStarterPreview(){
  $('#nc-starter-preview').textContent=$('#nc-free-starter').checked?`Free service expiry: ${registrationForm?.starterExpiry||'Loading…'} · 12:00 Beirut. Following month's 5th, even when added before the current month's 5th.`:'Normal Proradius activation/expiry. No free expiry edit will be sent.';
}
function registrationService(){return registrationForm?.services?.find(p=>p.id===Number($('#nc-service').value));}
function registrationCost(q){return q?.billCost??q?.fixedCost;}
function registrationConfirmationReview(input){
  const service=registrationService(),fields=[{label:'Reseller',value:input.resellerUsername},{label:'Service',value:service?.billing?.bundleName||service?.name||'Selected service'},{label:'Activation',value:input.freeStarter?'Free starter month':'Normal Proradius activation'}];
  if(input.freeStarter)fields.push({label:'Free service expiry',value:registrationForm.starterExpiry+' · 12:00 Beirut'});
  else fields.push({label:'Billing month',value:input.servicePayment.billingPeriod});
  const serviceWhish=input.freeStarter?null:WhishPayments.preview(input.servicePayment.amount,input.servicePayment.paymentMethod),installationWhish=WhishPayments.preview(input.installationAmount,input.installationMethod);
  const payments=[{label:input.freeStarter?'Free starter service':'First Internet bill',amount:formatMoney(input.freeStarter?0:input.servicePayment.amount),method:input.freeStarter?'No service payment':input.servicePayment.paymentMethod,note:input.freeStarter?'No Internet bill or extra renewal.':input.servicePayment.paymentMethod==='Unpaid'?'Recorded as customer debt, not money received.':`Recorded once when the account is created.${serviceWhish?' '+serviceWhish.note:''}`},{label:'Installation funding',amount:formatMoney(input.installationAmount),method:input.installationMethod,note:`Saved separately in Expenses to fund company spending.${installationWhish?' '+installationWhish.note:''}`}];
  if(equipmentDraft.length)payments.push({label:'Equipment · separate checkout',amount:formatMoney(equipmentDraft.reduce((sum,p)=>sum+p.quantity*p.priceUsd,0)),method:'Not charged now',note:'Router, cable and other items need a separate POS receipt.',separate:true});
  return {title:'Confirm new Internet customer',actionLabel:'Create customer',icon:'user-plus',subtitle:'Check the customer, reseller and separate payments before creation.',subject:{name:input.name,username:input.username},fields,payments,metrics:input.freeStarter?[]:[{label:'Proradius service cost',value:formatMoney(input.servicePayment.expectedCost)},{label:'Internet profit before other expenses',value:formatMoney(input.servicePayment.amount-input.servicePayment.expectedCost-(serviceWhish?.fee||0))}],notice:'This creates one real account in Proradius and activates its service. No additional monthly renewal is sent. Installation funding and equipment are not included in Internet-bill revenue.'};
}
function updateRegistrationBilling(resetAmount=false){
  const free=$('#nc-free-starter').checked,service=registrationService(),q=service?.billing;
  $('#nc-service-payment-fields').classList.toggle('hidden',free);$('#nc-service-payment-fields').disabled=free||registrationBusy||Boolean(registeredCustomer);
  $('#nc-service-amount').required=!free;$('#nc-service-period').required=!free;
  if(resetAmount||!$('#nc-service-amount').value){$('#nc-service-amount').value=q?String(q.retailPricing?.suggestedAmount??q.price):'';registrationAmountAutomatic=true;}
  $('#nc-refresh-costs').disabled=registrationBusy||registrationCostRefreshing||Boolean(registeredCustomer)||!$('#nc-reseller').value;
  $('#nc-service-billing-preview').textContent=q?`${q.bundleName} · ${q.retailPricing?retailPriceNote(q.retailPricing):'app selling price '+formatMoney(q.price)} · ${q.costBasis==='current_internal'?'current Proradius cost used for this bill':'historical fixed cost used for this bill'} ${formatMoney(registrationCost(q))} · fixed monthly reference ${formatMoney(q.fixedCost)}${q.verifiedAt?' · Synced '+dateTimeFormatter.format(new Date(q.verifiedAt)):''}`:service?.billingError||'Choose the reseller and service first.';
  $('#nc-use-prorated').disabled=!q||free||registrationBusy||registrationCostRefreshing||Boolean(registeredCustomer);
  const amount=Number($('#nc-service-amount').value);
  const whish=WhishPayments.preview(amount,$('#nc-service-method').value);
  $('#nc-service-profit-preview').textContent=q&&amount>0?`Internet bill profit before other expenses: ${formatMoney(amount-registrationCost(q)-(whish?.fee||0))}. ${$('#nc-service-method').value==='Unpaid'?'This amount becomes customer debt; no money enters the drawer.':whish?whish.note:'Only Cash service payments enter the cash drawer.'} Installation and equipment are not included.`:'';
}
function registrationPaymentSummary(){return registeredCustomer?.serviceBill?`Internet bill ${formatMoney(registeredCustomer.serviceBill.amount)} · ${registeredCustomer.serviceBill.paymentMethod} · ${registeredCustomer.serviceBill.bundleName}`:registeredCustomer?.serviceBillArchived?'Initial service bill is archived; it will not be recreated.':'No service bill (free starter or historical registration).';}
function renderRegistrationEquipment(){
  $('#nc-print-service').disabled=registrationBusy||!registeredCustomer?.serviceBill;
  $('#nc-print-installation').disabled=registrationBusy||!registeredCustomer?.installationPayment;
  $('#nc-product').innerHTML='<option value="">Select equipment</option>'+state.products.filter(p=>String(p.category).toLowerCase()!=='printing').map(p=>`<option value="${p.id}">${escapeHtml(p.name)} · ${formatDualUsd(p.priceUsd)}${p.trackQuantity?` · stock ${p.quantity}`:''}</option>`).join('');
  $('#nc-equipment-items').innerHTML=equipmentDraft.map((line,index)=>`<div class="registration-equipment-line"><div><strong>${escapeHtml(line.name)}</strong><small>${line.quantity} × ${formatMoney(line.priceUsd)}</small></div><strong>${formatMoney(line.quantity*line.priceUsd)}</strong><button type="button" class="icon-button" data-nc-remove="${index}" aria-label="Remove ${escapeHtml(line.name)}">${icon('trash')}</button></div>`).join('')||'<p class="field-note">No equipment selected.</p>';
  const total=equipmentDraft.reduce((sum,p)=>sum+p.quantity*p.priceUsd,0);
  $('#nc-equipment-lbp').textContent=formatLbp(total*USD_TO_LBP);$('#nc-equipment-usd').textContent=formatMoney(total);
  $('#nc-equipment-checkout').disabled=registrationBusy||!registeredCustomer||!equipmentDraft.length||Boolean(registeredCustomer.equipmentSaleId)||!has('sales.create');
  $('#nc-open-pos').disabled=registrationBusy||!registeredCustomer||!has('sales.create');
  $('#nc-add-equipment').disabled=registrationBusy||Boolean(registeredCustomer?.equipmentSaleId)||!has('sales.create');
  if(api.warehouse){
    const panel=$('#nc-open-pos').closest('.registration-equipment');
    for(const child of panel.children)child.classList.toggle('hidden',!child.matches('h3,.eyebrow,#nc-open-pos,p.field-note'));
    panel.querySelector('p.field-note').textContent='Equipment belongs to Admin stock. After registration, open the full POS to choose equipment and review the Admin/business prices. It produces a separate receipt; installation money stays separate.';
    $('#nc-equipment-checkout').disabled=true;$('#nc-add-equipment').disabled=true;
  }
  WhishPayments.sync();
}
async function refreshRegistrationHistory(){
  if(!has('customers.manage'))return;
  registrationHistory=await api.portal.operations('create');
  $('#nc-history-body').innerHTML=registrationHistory.map(row=>`<tr><td><strong>${escapeHtml(row.input.name)}</strong><br>${escapeHtml(row.input.username)}<br><small>Reseller: ${escapeHtml(row.input.resellerUsername||'Original API account')} · ${escapeHtml(row.recordedAt)}</small></td><td class="number">${row.input.servicePayment?`Service ${formatMoney(row.input.servicePayment.amount)}<br><small>${escapeHtml(row.input.servicePayment.paymentMethod)}</small><br>`:`<small>${row.input.freeStarter?'Free starter':'Historical · no first bill'}</small><br>`}Installation ${formatMoney(row.input.installationAmount)}<br><small>${escapeHtml(row.input.installationMethod)}</small></td><td>${escapeHtml(row.state)}<br><small>${escapeHtml(row.message)}</small></td><td>${['confirmed','succeeded'].includes(row.state)?`<button type="button" class="text-button" data-nc-resume="${row.requestId}">Open / save once</button>`:row.state==='unknown'&&state.currentUser.role==='admin'?`<button type="button" class="text-button" data-nc-review="${row.requestId}">Verify outcome</button>`:''}</td></tr>`).join('')||emptyRow(4,'No registrations yet','New accounts and their outcomes will appear here.');
}
async function refreshRegistrationViews(){
  await Promise.all([has('bills.view')?loadBills():Promise.resolve(),has('debts.view')?loadDebts():Promise.resolve(),has('expenses.view')||has('expenses.manage')?loadExpenses():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve(),has('dashboard.view')?loadDashboard():Promise.resolve()]);
}
async function openNewCustomer(){
  if(!has('customers.manage')||$('#new-customer-dialog').open)return;
  $('#new-customer-form').reset();registrationAmountAutomatic=true;registrationForm=null;registeredCustomer=null;equipmentDraft=[];registrationResellers=[];registrationRequest=crypto.randomUUID();const epoch=++registrationEpoch;
  $('#new-customer-fields').disabled=false;$('#nc-installation-fields').disabled=false;$('#nc-create').disabled=true;
  $('#nc-username').value=FIBERNETLB_ACCOUNT_PREFIX;$('#nc-price-field').classList.add('hidden');$('#nc-price').required=false;
  $('#nc-service-period').value=localDate().slice(0,7);
  $('#nc-reseller').innerHTML='<option value="">Loading Proradius resellers…</option>';$('#nc-reseller').disabled=true;
  clearRegistrationChoices();$('#new-customer-dialog').showModal();registrationStatus('Loading Proradius resellers…');renderRegistrationEquipment();updateStarterPreview();
  try{
    const resellers=await api.portal.customerResellers();if(epoch!==registrationEpoch||!$('#new-customer-dialog').open)return;
    registrationResellers=resellers;$('#nc-reseller').innerHTML='<option value="">Choose a Proradius reseller</option>'+resellers.map(p=>`<option value="${p.id}">${escapeHtml(p.username)}${p.name?` · ${escapeHtml(p.name)}`:''}${p.self?' · API account':''}</option>`).join('');$('#nc-reseller').disabled=false;
    registrationStatus('Choose the reseller first. Their services, collectors and switches will load securely.');await refreshRegistrationHistory();$('#nc-reseller').focus();
  }catch(error){if(epoch!==registrationEpoch)return;registrationStatus(errorMessage(error));try{await refreshRegistrationHistory();}catch{} }
}
function clearRegistrationChoices(){for(const id of ['service','collector','switch']){$('#nc-'+id).innerHTML='<option value="">Choose a reseller first</option>';$('#nc-'+id).disabled=true;}updateRegistrationBilling(true);}
function lockRegistrationOwner(row){
  registrationEpoch++;const input=row?.input;
  if(input){
    $('#nc-reseller').innerHTML=`<option value="${input.resellerId||''}">${escapeHtml(input.resellerUsername||'Original API account')}</option>`;
    $('#nc-username').value=input.username;$('#nc-name').value=input.name;$('#nc-phone').value=input.phone;
    registrationForm={starterExpiry:input.starterExpiry,services:[{id:input.service,billing:row.quote?.serviceBilling}]};
    for(const id of ['service','collector','switch'])$('#nc-'+id).innerHTML=`<option value="${input[id]}">${id==='service'&&row.quote?.serviceBilling?escapeHtml(row.quote.serviceBilling.bundleName):id+' #'+input[id]}</option>`;
    $('#nc-free-starter').checked=input.freeStarter;$('#nc-installation').value=input.installationAmount;$('#nc-installation-method').value=input.installationMethod;
    if(input.servicePayment){$('#nc-service-amount').value=input.servicePayment.amount;$('#nc-service-method').value=input.servicePayment.paymentMethod;$('#nc-service-period').value=input.servicePayment.billingPeriod;}
    WhishPayments.restore('nc-service-method',input.servicePayment?.whishDestination);WhishPayments.restore('nc-installation-method',input.installationWhishDestination);
  }
  $('#nc-password').value='';$('#nc-confirm-password').value='';$('#nc-create').disabled=true;$('#new-customer-fields').disabled=true;$('#nc-installation-fields').disabled=true;updateRegistrationBilling();updateStarterPreview();
}
$('#nc-reseller').addEventListener('change',async()=>{
  if(registrationBusy||registeredCustomer)return;
  const reseller=registrationResellers.find(p=>p.id===Number($('#nc-reseller').value)),epoch=++registrationEpoch;
  registrationForm=null;$('#nc-create').disabled=true;clearRegistrationChoices();updateStarterPreview();
  if(!reseller){registrationStatus('Choose the reseller who will own this customer.');return;}
  registrationStatus(`Loading ${reseller.username}'s services, collectors and switches…`);
  try{
    const form=await api.portal.customerOptions({resellerId:reseller.id,resellerUsername:reseller.username});
    if(epoch!==registrationEpoch||!$('#new-customer-dialog').open||registeredCustomer)return;
    if(form.resellerId!==reseller.id||form.resellerUsername!==reseller.username)throw Error('The returned reseller does not match your selection. Select the reseller again.');
    registrationForm=form;
    for(const [id,list] of [['service',form.services],['collector',form.collectors],['switch',form.switches]]){$('#nc-'+id).innerHTML='<option value="">Choose '+id+'</option>'+list.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${id==='service'&&p.cost!==null?` · internal cost ${formatMoney(p.cost)}`:''}</option>`).join('');$('#nc-'+id).disabled=false;}
    $('#nc-create').disabled=false;registrationStatus(`Ready. Customer owner: ${reseller.username}. Free starter creates no service bill; otherwise record the first Internet bill. No extra renewal is sent.`);updateStarterPreview();updateRegistrationBilling(true);
  }catch(error){if(epoch===registrationEpoch)registrationStatus(errorMessage(error));}
});
function registrationValues(){
  const v=id=>$('#nc-'+id).value;
  const freeStarter=$('#nc-free-starter').checked,q=registrationService()?.billing;
  if(!freeStarter&&!q)throw Error(registrationService()?.billingError||'Choose a service with a verified selling price and current Proradius cost.');
  const retail=q?.retailPricing;
  return {requestId:registrationRequest,formId:registrationForm.formId,resellerId:registrationForm.resellerId,resellerUsername:registrationForm.resellerUsername,username:v('username'),name:v('name'),password:v('password'),confirmPassword:v('confirm-password'),collector:Number(v('collector')),service:Number(v('service')),switch:Number(v('switch')),phone:v('phone'),email:v('email'),nationality:v('nationality'),dueDate:Number(v('due-date')),discount:Number(v('discount')),overridePrice:$('#nc-override').checked,price:v('price'),address:v('address'),region:v('region'),building:v('building'),note:v('note'),freeStarter,installationAmount:Number(v('installation')),installationMethod:v('installation-method'),installationWhishDestinationId:WhishPayments.input('nc-installation-method').whishDestinationId,...freeStarter?{}:{servicePayment:{amount:Number(v('service-amount')),paymentMethod:v('service-method'),...WhishPayments.input('nc-service-method'),billingPeriod:v('service-period'),bundleCode:q.bundleCode,expectedPrice:q.price,expectedCost:registrationCost(q),...retail?{retailPricing:{policy:retail.policy,asOf:retail.asOf,automatic:registrationAmountAutomatic&&Number(v('service-amount'))===retail.suggestedAmount}}:{}}},confirm:true};
}
async function refreshRegistrationCosts(manual=false){
  const reseller=registrationResellers.find(p=>p.id===Number($('#nc-reseller').value));
  if(!reseller||registrationBusy||registeredCustomer||registrationCostRefreshing||!$('#new-customer-dialog').open||(!manual&&$('#nc-free-starter').checked))return;
  const epoch=registrationEpoch;registrationCostRefreshing=true;$('#nc-create').disabled=true;updateRegistrationBilling();
  try{
    const form=await api.portal.customerOptions({resellerId:reseller.id,resellerUsername:reseller.username});
    if(epoch!==registrationEpoch||registrationBusy||registeredCustomer||!$('#new-customer-dialog').open)return;
    if(form.resellerId!==reseller.id||form.resellerUsername!==reseller.username)throw Error('The refreshed reseller does not match your selection.');
    const previousCost=registrationCost(registrationService()?.billing);registrationForm=form;
    for(const [id,list] of [['service',form.services],['collector',form.collectors],['switch',form.switches]]){const selected=$('#nc-'+id).value;$('#nc-'+id).innerHTML='<option value="">Choose '+id+'</option>'+list.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${id==='service'&&p.cost!==null?` · internal cost ${formatMoney(p.cost)}`:''}</option>`).join('');$('#nc-'+id).value=list.some(p=>String(p.id)===selected)?selected:'';$('#nc-'+id).disabled=false;}
    updateStarterPreview();updateRegistrationBilling(registrationAmountAutomatic);
    if(manual||previousCost!==registrationCost(registrationService()?.billing))registrationStatus('Current Proradius costs refreshed. Your customer amount and profile are unchanged; review the updated profit before creating.');
  }catch(error){if(epoch===registrationEpoch){registrationForm=null;updateRegistrationBilling();registrationStatus(errorMessage(error)+' Refresh costs before paid creation.');}}
  finally{registrationCostRefreshing=false;if(!registrationBusy&&!registeredCustomer)$('#nc-create').disabled=!registrationForm;updateRegistrationBilling();}
}
$('#nc-refresh-costs').addEventListener('click',()=>refreshRegistrationCosts(true));
setInterval(()=>void refreshRegistrationCosts(false),60000);
$('#add-portal-customer').addEventListener('click',()=>openNewCustomer().catch(e=>showToast(errorMessage(e),'error')));
$('#new-customer-close').addEventListener('click',()=>{if(!registrationBusy)$('#new-customer-dialog').close();});
$('#new-customer-dialog').addEventListener('cancel',event=>{if(registrationBusy)event.preventDefault();});
$('#new-customer-dialog').addEventListener('close',()=>{registrationEpoch++;$('#nc-password').value='';$('#nc-confirm-password').value='';});
$('#nc-free-starter').addEventListener('change',()=>{updateStarterPreview();updateRegistrationBilling();});
$('#nc-service').addEventListener('change',()=>updateRegistrationBilling(true));
$('#nc-service-amount').addEventListener('input',()=>{registrationAmountAutomatic=false;updateRegistrationBilling();});
$('#nc-use-prorated').addEventListener('click',()=>updateRegistrationBilling(true));
$('#nc-service-method').addEventListener('change',()=>updateRegistrationBilling());
$('#nc-print-service').addEventListener('click',()=>{if(registeredCustomer?.serviceBill)showReceipt('bill',registeredCustomer.serviceBill);});
$('#nc-print-installation').addEventListener('click',()=>{const p=registeredCustomer?.installationPayment;if(p)showReceipt('installation',{...p,bundleName:'Installation payment',serviceType:'Installation',paymentStatus:'paid',paidAmount:p.amount,remainingAmount:0,bundleDetails:'Expense funding · equipment purchases are separate'});});
$('#nc-override').addEventListener('change',()=>{$('#nc-price-field').classList.toggle('hidden',!$('#nc-override').checked);$('#nc-price').required=$('#nc-override').checked;});
$('#nc-refresh-history').addEventListener('click',()=>refreshRegistrationHistory().catch(e=>showToast(errorMessage(e),'error')));
$('#nc-add-equipment').addEventListener('click',()=>{
  const product=state.products.find(p=>p.id===Number($('#nc-product').value)),quantity=Number($('#nc-quantity').value);
  if(!product||!Number.isSafeInteger(quantity)||quantity<1)return showToast('Select equipment and a whole quantity.','error');
  const prior=equipmentDraft.find(p=>p.id===product.id),total=(prior?.quantity||0)+quantity;
  if(product.trackQuantity&&total>product.quantity)return showToast(`Only ${product.quantity} available.`,'error');
  if(prior)prior.quantity=total;else equipmentDraft.push({id:product.id,name:product.name,quantity,priceUsd:Number(product.priceUsd)});
  renderRegistrationEquipment();
});
$('#nc-equipment-items').addEventListener('click',event=>{const button=event.target.closest('[data-nc-remove]');if(button&&!registrationBusy&&!registeredCustomer?.equipmentSaleId){equipmentDraft.splice(Number(button.dataset.ncRemove),1);renderRegistrationEquipment();}});
$('#new-customer-form').addEventListener('submit',async event=>{
  event.preventDefault();if(registrationBusy||registeredCustomer||registrationCostRefreshing||!registrationForm)return;
  let input;try{input=registrationValues();}catch(error){return showToast(errorMessage(error),'error');}if(input.password!==input.confirmPassword)return showToast('Passwords do not match.','error');
  registrationBusy=true;$('#nc-create').disabled=true;$('#new-customer-fields').disabled=true;$('#nc-installation-fields').disabled=true;updateRegistrationBilling();renderRegistrationEquipment();
  try{
    const serviceWhish=input.freeStarter?null:WhishPayments.preview(input.servicePayment.amount,input.servicePayment.paymentMethod),installationWhish=WhishPayments.preview(input.installationAmount,input.installationMethod);
    if(!await confirmPortalAction(`Create ${input.username} (${input.name}) in pi.fibernetlb.net?\nOwner reseller: ${input.resellerUsername}\n\n${input.freeStarter?`Free starter service expires ${registrationForm.starterExpiry} at 12:00 Beirut. No Internet service bill.`:`First Internet bill: ${formatMoney(input.servicePayment.amount)} by ${input.servicePayment.paymentMethod} · ${registrationService().billing.bundleName}\nService cost: ${formatMoney(input.servicePayment.expectedCost)} · Internet profit before other expenses: ${formatMoney(input.servicePayment.amount-input.servicePayment.expectedCost-(serviceWhish?.fee||0))}${serviceWhish?'\n'+serviceWhish.note:''}${input.servicePayment.paymentMethod==='Unpaid'?'\nService amount becomes a debt, not received money.':''}`}\nInstallation received: ${formatMoney(input.installationAmount)} by ${input.installationMethod}.${installationWhish?'\n'+installationWhish.note:''}\nEquipment total: ${formatMoney(equipmentDraft.reduce((s,p)=>s+p.quantity*p.priceUsd,0))} — NOT charged in this step; separate POS checkout follows.\n\nProradius activates the service during account creation and controls its charge. No extra monthly renewal is sent.`,registrationConfirmationReview(input))){ $('#new-customer-fields').disabled=false;$('#nc-installation-fields').disabled=false;return; }
    registrationStatus('Creating one customer. Please wait; do not repeat this request.');
    $('#new-customer-form').setAttribute('aria-busy','true');
    registeredCustomer=await api.portal.createCustomer(input);
    registrationStatus(`${registeredCustomer.customer.username} created under ${input.resellerUsername} · expiry ${registeredCustomer.customer.expiry||'Normal portal expiry'} · ${registrationPaymentSummary()} · installation ${formatMoney(registeredCustomer.installationPayment?.amount||0)} saved in Expenses. Equipment checkout is separate.`);
    await refreshRegistrationViews();if(!FiberActionFeedback.created(registeredCustomer))showToast('Customer created; separate payments recorded once.');
  }catch(error){registrationStatus(errorMessage(error)+' Open Registration history to review an uncertain outcome before retrying.');$('#new-customer-fields').disabled=false;$('#nc-installation-fields').disabled=false;}
  finally{$('#new-customer-form').removeAttribute('aria-busy');input.password='';input.confirmPassword='';$('#nc-password').value='';$('#nc-confirm-password').value='';registrationBusy=false;$('#nc-create').disabled=Boolean(registeredCustomer);updateRegistrationBilling();renderRegistrationEquipment();await refreshRegistrationHistory().catch(()=>{});if(!registeredCustomer&&registrationHistory.find(p=>p.requestId===registrationRequest)?.state==='failed')registrationRequest=crypto.randomUUID();}
});
$('#nc-equipment-checkout').addEventListener('click',async()=>{
  if(registrationBusy||!registeredCustomer||!equipmentDraft.length)return;
  registrationBusy=true;renderRegistrationEquipment();
  try{
    const total=equipmentDraft.reduce((sum,p)=>sum+p.quantity*p.priceUsd,0),method=$('#nc-equipment-method').value;
    const whish=WhishPayments.preview(total,method);
    if(!await confirmPortalAction(`Complete a separate equipment POS sale for ${registeredCustomer.customer.username}?\nTotal: ${formatDualUsd(total)}\nPayment: ${method}${whish?'\n'+whish.note:''}\n\nThis deducts stock and creates its own receipt${method==='Unpaid'?' and customer debt':''}. Installation money is unchanged.`))return;
    const sale=await api.sales.create({registrationId:registeredCustomer.requestId,items:equipmentDraft.map(p=>({productId:p.id,quantity:p.quantity})),paymentMethod:method,...WhishPayments.input('nc-equipment-method'),expectedSubtotal:Math.round(total*100)/100});
    registeredCustomer.equipmentSaleId=sale.id;await loadProducts();await refreshRegistrationViews();if(has('debts.view'))await loadDebts();showReceipt('sale',sale);showToast('Separate equipment sale completed.');
  }catch(error){showToast(errorMessage(error),'error');}
  finally{registrationBusy=false;renderRegistrationEquipment();}
});
$('#nc-open-pos').addEventListener('click',async()=>{
  if(!registeredCustomer||registrationBusy)return;
  if(api.warehouse){
    if(!await window.AdminWarehouse?.openForCustomer({...registeredCustomer.customer,...!registeredCustomer.equipmentSaleId?{registrationId:registeredCustomer.requestId}:{}}))return;
    $('#new-customer-dialog').close();switchView('pos');showToast('Admin-stock POS opened for this customer. Installation funding stays separate.');return;
  }
  if(state.cart.length&&!await confirmAppAction('Replace the current POS cart with this new customer’s equipment? Unsold items in the current cart will be cleared.',"Replace POS cart","Replace cart"))return;
  if(!registeredCustomer.equipmentSaleId&&equipmentDraft.some(line=>!state.products.some(p=>p.id===line.id)))return showToast('Equipment changed. Refresh products and select the items again.','error');
  state.cart=!registeredCustomer.equipmentSaleId?equipmentDraft.map(line=>{const p=state.products.find(item=>item.id===line.id);return {key:`product:${line.id}`,id:line.id,name:line.name,quantity:line.quantity,variantDescription:'',printingOptions:null,priceUsd:p.priceUsd,priceLbp:p.priceLbp,stock:p.quantity,trackQuantity:p.trackQuantity};}):[];
  renderCart();
  $('#pos-customer-name').value=registeredCustomer.customer.name;$('#pos-customer-phone').value=registeredCustomer.customer.phone;$('#pos-customer-account').value=registeredCustomer.customer.username;
  $('#new-customer-dialog').close();await switchView('pos');showToast('POS linked to the new customer. Installation money stays separate.');
});
$('#nc-history-body').addEventListener('click',async event=>{
  const resume=event.target.closest('[data-nc-resume]'),review=event.target.closest('[data-nc-review]');
  try{
    if(resume){registeredCustomer=await api.portal.resumeOperation(resume.dataset.ncResume);const row=registrationHistory.find(p=>p.requestId===resume.dataset.ncResume);lockRegistrationOwner(row);registrationStatus(`${registeredCustomer.customer.username} · reseller ${row?.input.resellerUsername||'Original API account'} · ${registrationPaymentSummary()} · installation recorded once. Equipment sale is separate.`);renderRegistrationEquipment();await refreshRegistrationViews();await refreshRegistrationHistory();}
    if(review){const row=registrationHistory.find(p=>p.requestId===review.dataset.ncReview);$('#nc-review-form').reset();$('#nc-review-id').value=row.requestId;$('#nc-review-summary').textContent=`${row.input.username} · ${row.input.name} · reseller ${row.input.resellerUsername||'Original API account'} · ${row.input.freeStarter?'Free expiry '+row.input.starterExpiry:'Normal expiry'} · ${row.input.servicePayment?`Internet bill ${formatMoney(row.input.servicePayment.amount)} by ${row.input.servicePayment.paymentMethod}`:'No first service bill'} · installation ${formatMoney(row.input.installationAmount)} by ${row.input.installationMethod}`;$('#nc-review-dialog').showModal();}
  }catch(error){showToast(errorMessage(error),'error');}
});
$('#nc-review-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#nc-review-form [type="submit"]');button.disabled=true;
  try{const result=await api.portal.resolveOperation($('#nc-review-id').value,{confirmation:$('#nc-review-outcome').value,note:$('#nc-review-note').value,finishStarter:$('#nc-review-expiry').checked});$('#nc-review-dialog').close();if(result.customer){registeredCustomer=result;lockRegistrationOwner(registrationHistory.find(p=>p.requestId===$('#nc-review-id').value));renderRegistrationEquipment();}await refreshRegistrationHistory();await refreshRegistrationViews();registrationStatus('Verified outcome recorded. No customer creation was repeated.');}catch(error){showToast(errorMessage(error),'error');}finally{button.disabled=false;}
});
