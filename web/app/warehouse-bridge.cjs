'use strict';
// Durable local receipts/custody only. No portal or Whish provider requests.
const crypto=require('node:crypto');
const Finance=require('./finance-ledger.cjs');
const Whish=require('./whish-destinations.cjs');
const Accounting=require('./warehouse-accounting.cjs');
const {PaymentLedger}=require('./payment-ledger.cjs');
const query=Finance.query;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents=value=>{const n=Number(value),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n*100-c)>1e-6)throw Error('Review an exact USD amount.');return c;};
function createBridge({entries,sections,authorizeAdmin,authorizeSale,member,destinations,save,now,receipt,run}){
 const entry=id=>{const value=entries.get(id);if(!value)throw Error('The original business is unavailable.');return value;};
 function initialize(){for(const value of entries.values()){
  Accounting.initializeBusiness(value.db);
  value.db.exec(`CREATE TABLE IF NOT EXISTS warehouse_transfer_sides(request_id TEXT NOT NULL,side TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(request_id,side));`);
 }}
 function actor(key,id){const user=member(key,id);if(!user?.active||user.account_key!==key)throw Error('An active original employee account is required.');return user;}
 function assertOpen(id,date){if(String(date).slice(0,7)<=Finance.latestMonth(entry(id).db))throw Error('Use an open accounting month. Original product claims cannot change a closed ledger.');}
 function taggedReceipt(workspaceId,user,saleId){
  const section=sections.find(value=>value.id===workspaceId);if(!section)throw Error('The original warehouse receipt business is unavailable.');
  // Authorization-specific read-only markers belong at the outer API boundary:
  // a normal business POS print remains normal, while a Main cross-business
  // preview must never treat a coincident numeric sale ID as a Main receipt.
  return {...run(workspaceId,user,()=>receipt(saleId)),workspaceId,workspaceName:section.name};
 }
 function verifySavedSale(db,operation,link,user){
  const saved=JSON.parse(link.snapshot_json),{operationFingerprint,invoiceNo,...instruction}=saved,fingerprint=hash(operation);
  if(operationFingerprint!==fingerprint||hash(instruction)!==fingerprint||!invoiceNo||link.request_id!==operation.requestId)throw Error('The original warehouse sale instruction changed. No replacement was created.');
  const saleId=Number(link.sale_id),sale=query(db,'SELECT * FROM sales WHERE id=?',[saleId])[0];
  if(!sale||sale.invoice_no!==invoiceNo||sale.created_at!==operation.createdAt||cents(sale.subtotal)!==cents(operation.subtotal)||cents(sale.cost_total)!==cents(operation.costTotal)||cents(sale.profit)!==cents(operation.subtotal-operation.costTotal)||sale.payment_method!==operation.paymentMethod||Number(sale.user_id)!==Number(user.id)||sale.customer_name!==(operation.customerName||'')||sale.customer_phone!==(operation.customerPhone||'')||sale.customer_account!==(operation.customerAccount||''))throw Error('The original warehouse POS receipt changed. Review the preserved request.');
  if(operation.registrationId){const equipment=query(db,'SELECT sale_id,fingerprint FROM customer_equipment_sales WHERE request_id=?',[operation.registrationId])[0];if(!equipment||Number(equipment.sale_id)!==saleId||equipment.fingerprint!==fingerprint)throw Error('The original registration-equipment receipt link changed.');}
  const items=query(db,'SELECT * FROM sale_items WHERE sale_id=? ORDER BY id',[saleId]);if(items.length!==operation.items.length)throw Error('The original warehouse POS item list changed.');
  for(let index=0;index<items.length;index++){
   const row=items[index],item=operation.items[index],price=item.unitPrice??item.retailPrice,cost=item.unitCost??(operation.workspaceId==='main'?item.acquisitionCost:item.wholesalePrice),line=Math.round(price*item.quantity*100)/100;
   if(row.product_id!==null||row.product_name!==item.name||row.category!==item.category||row.quantity!==item.quantity||cents(row.unit_price)!==cents(price)||cents(row.unit_cost)!==cents(cost)||cents(row.line_total)!==cents(line)||row.price_currency!=='USD'||cents(row.unit_price_original)!==cents(price)||cents(row.line_total_original)!==cents(line)||Number(row.exchange_rate)!==90000||row.variant_description!==''||row.printing_options!=='')throw Error('The original warehouse POS item price or quantity changed.');
  }
  const mixed=operation.mixedPolicy||operation.items.some(item=>item.kind==='maintenance')?Accounting.mixedSnapshot(db,saleId):null;
  if(mixed&&(!mixed.physical.length||operation.workspaceId==='main')&&(query(db,'SELECT * FROM warehouse_margin_releases WHERE sale_id=?',[saleId]).length||query(db,'SELECT * FROM warehouse_margin_funding WHERE sale_id=?',[saleId]).length))throw Error('The service-only / direct Admin invoice has unexpected physical-product funding.');
  const destination=Whish.readSnapshot(db,'sale',saleId);
  if(operation.paymentMethod==='Whish Money'){
   if(!operation.whishDestination||!destination||hash(destination)!==hash({...operation.whishDestination,...Whish.receiptAmounts(operation.subtotal)}))throw Error('The original warehouse Whish receipt changed.');
  }else if(destination)throw Error('The original warehouse payment method has a conflicting wallet receipt.');
  const cash=query(db,"SELECT * FROM cash_drawer_transactions WHERE reference_type='sale' AND reference_id=? AND transaction_type='warehouse_pos_sale'",[saleId]);
  if(operation.paymentMethod==='Cash'){
   if(cash.length!==1||cents(cash[0].amount)!==cents(operation.subtotal)||cash[0].note!==invoiceNo||cash[0].created_at!==operation.createdAt||Number(cash[0].user_id)!==Number(user.id))throw Error('The original warehouse cash receipt is incomplete.');
  }else if(cash.length)throw Error('The original warehouse sale has an unexpected cash receipt.');
  if(operation.paymentMethod!=='Unpaid'&&operation.subtotal>0){
   const custody=query(db,'SELECT * FROM warehouse_custody_events WHERE id=?',['warehouse-sale-'+operation.requestId])[0];
   if(!custody||custody.request_id!==operation.requestId||custody.kind!=='sale'||custody.amount_cents!==cents(operation.subtotal)||custody.occurred_at!==operation.createdAt||Number(custody.user_id)!==Number(user.id)||custody.actor_key!==user.account_key)throw Error('The original warehouse customer custody proof is incomplete.');
   if(operation.workspaceId!=='main'&&(!mixed||mixed.physical.length)){
    const release=query(db,'SELECT * FROM warehouse_margin_releases WHERE sale_id=?',[saleId])[0];
    if(!release||release.amount_cents!==cents(mixed?operation.physicalMargin:operation.margin))throw Error('The original warehouse product margin release is incomplete.');
    Accounting.sourceReadRows(db);
   }
  }
  if(mixed)Accounting.mixedPaidState(db,saleId);
  return {saleId,invoiceNo};
 }
 async function commitSale(operation){
  const {requestId,workspaceId}=operation,value=entry(workspaceId),db=value.db;
  const user=actor(operation.actor.accountKey,workspaceId),fingerprint=hash(operation);
  let prior=query(db,'SELECT * FROM warehouse_sale_links WHERE request_id=?',[requestId])[0];
  if(prior){
   verifySavedSale(db,operation,prior,user);
   // A previous disk failure is not a successful durable result. Save again.
   await save(value);
   return {requestId,state:'completed',workspaceId,saleId:Number(prior.sale_id),receipt:taggedReceipt(workspaceId,user,Number(prior.sale_id))};
  }
  assertOpen(workspaceId,operation.createdAt);
  const destination=operation.whishDestination??Whish.resolveDestination(entry('main').db,operation.paymentMethod,operation.whishDestinationId);
  // Different valid request IDs may share an arbitrarily long prefix. Hash
  // the complete identity instead of truncating the caller's request text.
  const invoiceNo='WH-'+crypto.createHash('sha256').update(requestId).digest('hex').slice(0,24).toUpperCase();
  db.exec('BEGIN');
  let saleId;
  try{
   db.run('INSERT INTO sales(invoice_no,created_at,subtotal,cost_total,profit,payment_method,payment_status,customer_name,customer_phone,customer_account,user_id,cashier_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[invoiceNo,operation.createdAt,operation.subtotal,operation.costTotal,operation.subtotal-operation.costTotal,operation.paymentMethod,operation.paymentMethod==='Unpaid'?'unpaid':'paid',operation.customerName||'',operation.customerPhone||'',operation.customerAccount||'',user.id,user.full_name]);
   saleId=Number(query(db,'SELECT last_insert_rowid() AS id')[0].id);
   Whish.saveSnapshot(db,'sale',saleId,destination,operation.subtotal);
   for(const item of operation.items){
    const unitPrice=item.unitPrice??item.retailPrice,unitCost=item.unitCost??(workspaceId==='main'?item.acquisitionCost:item.wholesalePrice);
    db.run("INSERT INTO sale_items(sale_id,product_id,product_name,category,quantity,unit_price,unit_cost,line_total,price_currency,unit_price_original,line_total_original,exchange_rate,variant_description,printing_options) VALUES(?,NULL,?,?,?,?,?,?,'USD',?,?,90000,'','')",[saleId,item.name,item.category,item.quantity,unitPrice,unitCost,Math.round(unitPrice*item.quantity*100)/100,unitPrice,Math.round(unitPrice*item.quantity*100)/100]);
   }
   const snapshot={...operation,operationFingerprint:fingerprint,invoiceNo};
   db.run('INSERT INTO warehouse_sale_links(request_id,sale_id,snapshot_json) VALUES(?,?,?)',[requestId,saleId,JSON.stringify(snapshot)]);
   if(operation.registrationId)db.run('INSERT INTO customer_equipment_sales(request_id,sale_id,fingerprint) VALUES(?,?,?)',[operation.registrationId,saleId,fingerprint]);
   if(operation.paymentMethod==='Cash')db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,reference_id,note,created_at,user_id,user_name) VALUES(?,'warehouse_pos_sale','sale',?,?,?,?,?)",[operation.subtotal,saleId,invoiceNo,operation.createdAt,user.id,user.full_name]);
   if(operation.paymentMethod!=='Unpaid'&&operation.subtotal>0){
    Accounting.recordCustody(db,{id:'warehouse-sale-'+requestId,requestId,kind:'sale',amount:operation.subtotal,occurredAt:operation.createdAt,userId:user.id,actorKey:user.account_key});
    if(workspaceId!=='main'){
     const detail=new PaymentLedger(db).details('sale',saleId);
     Accounting.releaseFunding(db,{saleId,detail,receivedAt:operation.createdAt,userId:user.id,actorKey:user.account_key});
    }
   }
   verifySavedSale(db,operation,query(db,'SELECT * FROM warehouse_sale_links WHERE request_id=?',[requestId])[0],user);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  await save(value);
  return {requestId,state:'completed',workspaceId,saleId,receipt:taggedReceipt(workspaceId,user,saleId)};
 }
 function prepareSale(operation){
  for(const value of entries.values())if(Finance.pendingActions(value.db).length)throw Error('Finish or reconcile the original unfinished money operation before starting an Admin-stock sale.');
  actor(operation.actor.accountKey,operation.workspaceId);assertOpen(operation.workspaceId,operation.createdAt);
  if(operation.registrationId){
   const db=entry(operation.workspaceId).db,parent=query(db,"SELECT input_json FROM portal_operations WHERE request_id=? AND kind='create' AND state='succeeded'",[operation.registrationId])[0];
   if(!parent)throw Error('Complete this customer registration before selling its initial equipment.');
   const customer=JSON.parse(parent.input_json);
   if(operation.customerAccount!==customer.username||operation.customerName!==customer.name||operation.customerPhone!==customer.phone)throw Error('Use the original registered customer details for this equipment receipt.');
   if(query(db,'SELECT sale_id FROM customer_equipment_sales WHERE request_id=?',[operation.registrationId]).length)throw Error('Initial equipment for this registration already has a receipt. Review that receipt; use a new unlinked POS sale only for an additional intended purchase.');
  }
  return {whishDestination:Whish.resolveDestination(entry('main').db,operation.paymentMethod,operation.whishDestinationId)};
 }
 function prepareTransfer(operation){
  for(const value of entries.values())if(Finance.pendingActions(value.db).length)throw Error('Finish or reconcile the original unfinished money operation before collecting a business product debt.');
  const fromKey=operation.source.fromKey,walletId=operation.source.walletId,db=entry(operation.workspaceId).db;
  const from=actor(fromKey,operation.workspaceId),to=actor(operation.actor.accountKey,'main');
  if(to.role!=='admin')throw Error('The receiving account must be Main Admin.');
  assertOpen(operation.workspaceId,operation.createdAt);assertOpen('main',operation.createdAt);
  if(operation.paymentMethod==='Whish Money'&&!destinations().some(wallet=>wallet.id===walletId&&wallet.active))throw Error('Select an active Whish wallet.');
  const balance=operation.paymentMethod==='Cash'?Finance.drawerBalance(db,Number(from.id)):Finance.walletBalances(db,destinations(),fromKey).find(wallet=>wallet.id===walletId)?.balance;
  if(!Number.isFinite(balance)||cents(balance)<cents(operation.amount))throw Error('The chosen employee does not hold enough money in that source.');
  return {sourceName:from.full_name,recipientName:to.full_name,wallet:operation.paymentMethod==='Whish Money'?destinations().find(wallet=>wallet.id===walletId):null};
 }
 function paymentOptions({workspaceId}){
  const admin=authorizeAdmin();if(workspaceId==='main'||!sections.some(section=>section.id===workspaceId))throw Error('Choose a business owing Admin.');
  const db=entry(workspaceId).db,employees=query(db,"SELECT id,account_key AS accountKey,full_name AS fullName,role FROM users WHERE active=1 AND role IN ('admin','manager','cashier','support') ORDER BY full_name").map(user=>({...user,cashBalance:Finance.drawerBalance(db,Number(user.id))}));
  return {workspaceId,employees,wallets:destinations().filter(wallet=>wallet.active).map(wallet=>({...wallet,balance:Finance.walletBalances(db,destinations()).find(row=>row.id===wallet.id)?.balance??0})),adminName:admin.full_name};
 }
 function recordSide(db,operation,side,user,amount,result){
  const key=operation.requestId+'-'+side;
  db.run('INSERT INTO finance_events(id,kind,created_at,effective_at,actor_key,from_key,to_key,amount_cents,note,input_json,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[key,'warehouse_wholesale_payment',operation.createdAt,operation.createdAt,operation.actor.accountKey,operation.fromKey,operation.actor.accountKey,cents(operation.amount),operation.note,JSON.stringify(operation),JSON.stringify(result)]);
  if(operation.paymentMethod==='Cash')db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,reference_id,note,created_at,user_id,user_name) VALUES(?,'warehouse_wholesale_payment','finance',NULL,?,?,?,?)",[amount,key+' · '+operation.note,operation.createdAt,user.id,user.full_name]);
  else db.run('INSERT INTO finance_wallet_entries(id,event_id,wallet_id,account_key,amount_cents,effective_at) VALUES(?,?,?,?,?,?)',[key,key,operation.walletId,user.account_key,cents(amount),operation.createdAt]);
 }
 function verifySide(db,operation,side,user,amount,result,row){
  const key=operation.requestId+'-'+side,fingerprint=hash(operation),event=query(db,'SELECT * FROM finance_events WHERE id=?',[key])[0];
  if(!row||row.fingerprint!==fingerprint||row.result_json!==JSON.stringify(result)||!event||event.kind!=='warehouse_wholesale_payment'||event.created_at!==operation.createdAt||event.effective_at!==operation.createdAt||event.actor_key!==operation.actor.accountKey||event.from_key!==operation.fromKey||event.to_key!==operation.actor.accountKey||event.amount_cents!==cents(operation.amount)||event.note!==operation.note||event.input_json!==JSON.stringify(operation)||event.result_json!==JSON.stringify(result))throw Error('The original business-debt transfer audit changed. No transfer was repeated.');
  if(operation.paymentMethod==='Cash'){
   const moves=query(db,'SELECT * FROM cash_drawer_transactions WHERE note=?',[key+' · '+operation.note]);
   if(moves.length!==1||moves[0].transaction_type!=='warehouse_wholesale_payment'||moves[0].reference_type!=='finance'||moves[0].reference_id!==null||cents(moves[0].amount)!==cents(amount)||moves[0].created_at!==operation.createdAt||Number(moves[0].user_id)!==Number(user.id)||query(db,'SELECT id FROM finance_wallet_entries WHERE event_id=?',[key]).length)throw Error('The original business-debt cash movement proof changed.');
  }else{
   const moves=query(db,'SELECT * FROM finance_wallet_entries WHERE event_id=?',[key]);
   if(moves.length!==1||moves[0].id!==key||moves[0].wallet_id!==operation.walletId||moves[0].account_key!==user.account_key||moves[0].amount_cents!==cents(amount)||moves[0].effective_at!==operation.createdAt||query(db,'SELECT id FROM cash_drawer_transactions WHERE note=?',[key+' · '+operation.note]).length)throw Error('The original business-debt wallet movement proof changed.');
  }
  if(side==='source'){
   const custody=query(db,'SELECT * FROM warehouse_custody_events WHERE id=?',[key])[0];
   if(!custody||custody.request_id!==operation.requestId||custody.kind!=='wholesale_payment'||custody.amount_cents!==cents(amount)||custody.occurred_at!==operation.createdAt||Number(custody.user_id)!==Number(user.id)||custody.actor_key!==user.account_key)throw Error('The original wholesale repayment custody proof changed.');
  }
 }
 async function settleTransfer(operation){
  operation={...operation,fromKey:operation.source.fromKey,walletId:operation.source.walletId};
  const fingerprint=hash(operation),source=entry(operation.workspaceId),target=entry('main'),db=source.db;
  const from=actor(operation.fromKey,operation.workspaceId),to=actor(operation.actor.accountKey,'main');
  if(to.role!=='admin')throw Error('The receiving Main account must still be Admin.');
  if(!['Cash','Whish Money'].includes(operation.paymentMethod)||cents(operation.amount)<=0)throw Error('Choose a valid wholesale payment.');
  const result={requestId:operation.requestId,state:'completed',workspaceId:operation.workspaceId,amount:operation.amount,paymentMethod:operation.paymentMethod,fromKey:operation.fromKey,toKey:to.account_key,walletId:operation.walletId||null,fee:0,noRevenue:true};
  const prior=query(db,"SELECT * FROM warehouse_transfer_sides WHERE request_id=? AND side='source'",[operation.requestId])[0];
  const targetBefore=query(target.db,"SELECT * FROM warehouse_transfer_sides WHERE request_id=? AND side='target'",[operation.requestId])[0];
  if(targetBefore&&!prior)throw Error('The receiving product payment has no original source debit. Review both business ledgers.');
  if(prior)verifySide(db,operation,'source',from,-operation.amount,result,prior);
  if(!prior){
   assertOpen(operation.workspaceId,operation.createdAt);assertOpen('main',operation.createdAt);
   if(operation.paymentMethod==='Whish Money'&&!destinations().some(wallet=>wallet.id===operation.walletId&&wallet.active))throw Error('Select an active Whish wallet.');
   const available=operation.paymentMethod==='Cash'?Finance.drawerBalance(db,Number(from.id)):Finance.walletBalances(db,destinations(),from.account_key).find(wallet=>wallet.id===operation.walletId)?.balance;
   if(!Number.isFinite(available)||cents(available)<cents(operation.amount))throw Error('The chosen employee does not hold enough money in that source.');
   db.exec('BEGIN');try{
    recordSide(db,operation,'source',from,-operation.amount,result);
    Accounting.recordCustody(db,{id:operation.requestId+'-source',requestId:operation.requestId,kind:'wholesale_payment',amount:-operation.amount,occurredAt:operation.createdAt,userId:from.id,actorKey:from.account_key});
    db.run("INSERT INTO warehouse_transfer_sides VALUES(?,'source',?,?)",[operation.requestId,fingerprint,JSON.stringify(result)]);
    verifySide(db,operation,'source',from,-operation.amount,result,query(db,"SELECT * FROM warehouse_transfer_sides WHERE request_id=? AND side='source'",[operation.requestId])[0]);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  await save(source);
  const priorTarget=query(target.db,"SELECT * FROM warehouse_transfer_sides WHERE request_id=? AND side='target'",[operation.requestId])[0];
  if(priorTarget)verifySide(target.db,operation,'target',to,operation.amount,result,priorTarget);
  if(!priorTarget){
   assertOpen('main',operation.createdAt);
   target.db.exec('BEGIN');try{
    recordSide(target.db,operation,'target',to,operation.amount,result);
    target.db.run("INSERT INTO warehouse_transfer_sides VALUES(?,'target',?,?)",[operation.requestId,fingerprint,JSON.stringify(result)]);
    verifySide(target.db,operation,'target',to,operation.amount,result,query(target.db,"SELECT * FROM warehouse_transfer_sides WHERE request_id=? AND side='target'",[operation.requestId])[0]);
    target.db.exec('COMMIT');
   }catch(error){target.db.exec('ROLLBACK');throw error;}
  }
  await save(target);
  return result;
 }
 function fundingAfterCollection({kind,id,detail,amount,paymentId,receivedAt,user}){
  if(kind!=='sale')return;
  const db=entry(user.workspaceId).db;
  if(!query(db,'SELECT request_id FROM warehouse_sale_links WHERE sale_id=?',[id]).length)return;
  Accounting.recordCustody(db,{id:'warehouse-customer-'+paymentId,requestId:paymentId,kind:'customer_collection',amount,occurredAt:receivedAt,userId:user.id,actorKey:user.account_key});
  Accounting.releaseFunding(db,{saleId:id,detail,receivedAt,userId:user.id,actorKey:user.account_key});
 }
 return {initialize,prepareSale,prepareTransfer,commitSale,settleTransfer,paymentOptions,assertOpen,fundingAfterCollection};
}
module.exports={createBridge};
