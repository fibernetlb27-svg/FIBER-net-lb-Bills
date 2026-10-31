const crypto = require('node:crypto');
const archiveDatabases=new WeakSet();
function activeReceiptSql(db,sql){
  if(!archiveDatabases.has(db)||!/^\s*SELECT\b/i.test(sql))return sql;
  let active=sql.replace(/\b(FROM|JOIN)\s+(sales|telecom_payments)\b/gi,(_all,keyword,table)=>`${keyword} active_${table.toLowerCase()}`);
  if(query(db,"SELECT name FROM sqlite_master WHERE name='active_expenses'").length)active=active.replace(/\b(FROM|JOIN)\s+expenses\b/gi,(_all,keyword)=>`${keyword} active_expenses`);
  return active;
}
function query(db,sql,params=[]) {
  const statement=db.prepare(sql);
  try { statement.bind(params);const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows; }
  finally { statement.free(); }
}
function initializeBillReset(db) {
  for(const table of ['fibernetlb_bills','sales','telecom_payments'])if(hasTable(db,table)) {
    if(!query(db,`PRAGMA table_info(${table})`).some(column=>column.name==='reset_id'))db.run(`ALTER TABLE ${table} ADD COLUMN reset_id TEXT`);
    if(table==='sales'&&hasTable(db,'pos_invoice_voids')){
      db.run('DROP VIEW IF EXISTS active_sales');
      db.run('CREATE VIEW active_sales AS SELECT s.* FROM sales s WHERE s.reset_id IS NULL AND NOT EXISTS(SELECT 1 FROM pos_invoice_voids v WHERE v.sale_id=s.id)');
    }else db.run(`CREATE VIEW IF NOT EXISTS active_${table} AS SELECT * FROM ${table} WHERE reset_id IS NULL`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS bill_resets (
    id TEXT PRIMARY KEY,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,
    note TEXT NOT NULL,bill_count INTEGER NOT NULL,cash_excluded REAL NOT NULL,
    backup_path TEXT NOT NULL
  );
  `);
  if(!query(db,'PRAGMA table_info(bill_resets)').some(column=>column.name==='kind'))db.run("ALTER TABLE bill_resets ADD COLUMN kind TEXT NOT NULL DEFAULT 'bill'");
  const excluded=Object.entries(RESET_KINDS).filter(([,type])=>hasTable(db,type.table)).map(([kind,type])=>`NOT EXISTS (SELECT 1 FROM ${type.table} b WHERE b.id=c.reference_id AND c.reference_type='${kind}' AND b.reset_id IS NOT NULL)`);
  if(hasTable(db,'pos_invoice_voids'))excluded.push("NOT EXISTS(SELECT 1 FROM pos_invoice_voids v WHERE c.reference_type='sale' AND v.sale_id=c.reference_id)");
  if(hasTable(db,'pos_invoice_void_cash'))excluded.push('NOT EXISTS(SELECT 1 FROM pos_invoice_void_cash v WHERE v.cash_id=c.id)');
  db.run('DROP VIEW IF EXISTS active_cash_drawer_transactions');
  db.run(`CREATE VIEW active_cash_drawer_transactions AS SELECT c.* FROM cash_drawer_transactions c WHERE ${excluded.join(' AND ')||'1'}`);
  archiveDatabases.add(db);
}
const RESET_KINDS={bill:{table:'fibernetlb_bills',amount:'amount',receipt:'receipt_no',account:'customer_account'},sale:{table:'sales',amount:'subtotal',receipt:'invoice_no',account:'customer_account'},telecom:{table:'telecom_payments',amount:'amount',receipt:'receipt_no',account:'phone'}};
function resetKind(kind){if(!RESET_KINDS[kind])throw Error('Choose a valid receipt archive type.');return RESET_KINDS[kind];}
function billResetEpoch(db) {return query(db,'SELECT id FROM bill_resets ORDER BY rowid DESC LIMIT 1')[0]?.id||'';}
function json(value){try{const result=JSON.parse(value||'{}');return result&&typeof result==='object'&&!Array.isArray(result)?result:{};}catch{return {};}}
function hasTable(db,name){return query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]).length>0;}
function sameMoney(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.round(Number(a)*100)===Math.round(Number(b)*100);}
// A confirmed portal outcome may be left behind after its money was already
// recorded. Prove immutable request/receipt links, not today's plan or price.
// This never calls Proradius or inserts/recalculates a financial record.
function recordedOperation(db,row){
 const input=json(row.input_json),result=json(row.result_json);
 if(row.state!=='confirmed'||!['create','change','topup'].includes(row.kind)||!input.username)return null;
 const payment=row.kind==='create'?input.servicePayment:input;
 let bill=null;
 if(payment){
  const linked=hasTable(db,'bill_requests')?query(db,'SELECT bill_id FROM bill_requests WHERE request_id=? AND fingerprint=?',[row.request_id,row.fingerprint])[0]:null;
  const id=row.bill_id||linked?.bill_id;
  if(!id||!linked||Number(id)!==Number(linked.bill_id))return null;
  bill=query(db,'SELECT * FROM fibernetlb_bills WHERE id=?',[id])[0];
  if(!bill||bill.customer_account!==input.username||!sameMoney(bill.amount,payment.amount)||bill.payment_method!==payment.paymentMethod)return null;
  if(row.kind==='create'&&bill.receipt_no!==`FBL-NEW-${row.request_id.toUpperCase()}`)return null;
 }
 if(row.kind==='create'){
  if(!result.customer||result.customer.username!==input.username)return null;
  if(input.resellerId&&Number(result.customer.resellerId)!==Number(input.resellerId))return null;
  if(input.freeStarter&&String(result.customer.expiry||'').slice(0,10)!==input.starterExpiry)return null;
  if(!Number.isFinite(Number(input.installationAmount))||Number(input.installationAmount)<0)return null;
  if(Number(input.installationAmount)>0){
   if(!hasTable(db,'installation_payments'))return null;
   const installation=query(db,'SELECT * FROM installation_payments WHERE request_id=?',[row.request_id])[0];
   if(!installation||installation.customer_account!==input.username||!sameMoney(installation.amount,input.installationAmount)||installation.payment_method!==input.installationMethod)return null;
   if(input.installationMethod==='Cash'&&!query(db,"SELECT id FROM cash_drawer_transactions WHERE reference_type='installation' AND reference_id=? AND abs(amount-?)<0.000001",[installation.id,Number(input.installationAmount)]).length)return null;
  }
 }
 if(payment?.paymentMethod==='Cash'&&Number(payment.amount)!==0&&!query(db,"SELECT id FROM cash_drawer_transactions WHERE reference_type='bill' AND reference_id=? AND abs(amount-?)<0.000001",[bill.id,Number(payment.amount)]).length)return null;
 return {billId:bill?.id||null};
}
function resetActions(db){
 const renewals=query(db,"SELECT bill_id,username,state,requested_at AS recordedAt FROM internet_renewals WHERE state IN ('checking','processing','unknown') ORDER BY bill_id").map(row=>({...row,id:String(row.bill_id),source:'renewal',kind:'renewal',canCloseTest:false}));
 const plans=query(db,"SELECT request_id AS id,username,state,recorded_at AS recordedAt FROM internet_plan_changes WHERE state IN ('checking','processing','unknown') ORDER BY rowid").map(row=>({...row,source:'plan',kind:'plan change',canCloseTest:false}));
 const operations=query(db,"SELECT * FROM portal_operations WHERE state IN ('checking','processing','unknown','confirmed') ORDER BY rowid");
 const ready=[],blocked=[...renewals,...plans];
 for(const row of operations){
  const input=json(row.input_json),proof=recordedOperation(db,row);
  const item={id:row.request_id,source:'operation',kind:row.kind,username:input.username||row.entity,state:row.state,recordedAt:row.recorded_at,billId:row.bill_id||proof?.billId||null,canCloseTest:row.state==='confirmed',repairable:Boolean(proof)};
  (proof?ready:blocked).push(item);
 }
 return {ready,blocked,operations};
}
function billResetPreview(db,kind='bill') {
  const type=resetKind(kind),active=`active_${type.table}`;
  const bills=query(db,`SELECT * FROM ${active} ORDER BY id`);
  const payments=query(db,`SELECT p.* FROM debt_payments p JOIN ${active} b ON b.id=p.record_id WHERE p.kind=? ORDER BY p.rowid`,[kind]);
  const drawer=query(db,`SELECT c.* FROM cash_drawer_transactions c JOIN ${active} b ON b.id=c.reference_id WHERE c.reference_type=? ORDER BY c.id`,[kind]);
  const renewals=kind==='bill'?query(db,'SELECT r.* FROM internet_renewals r JOIN active_fibernetlb_bills b ON b.id=r.bill_id ORDER BY r.bill_id'):[];
  const resets=query(db,'SELECT id,recorded_at AS recordedAt,actor,note,bill_count AS billCount,cash_excluded AS cashExcluded,backup_path AS backupPath FROM bill_resets WHERE kind=? ORDER BY rowid DESC LIMIT 20',[kind]);
  const archived=resets.length?query(db,`SELECT b.id,b.${type.receipt} AS receiptNo,b.${type.account} AS customerAccount,b.customer_name AS customerName,b.${type.amount} AS amount,${kind==='bill'?'r.state AS renewalState,r.completed_months AS completedMonths,r.requested_months AS requestedMonths':'NULL AS renewalState'} FROM ${type.table} b ${kind==='bill'?'LEFT JOIN internet_renewals r ON r.bill_id=b.id':''} WHERE b.reset_id=? ORDER BY b.id DESC LIMIT 100`,[resets[0].id]):[];
  const actions=kind==='bill'?resetActions(db):{ready:[],blocked:[]};
  if(kind==='sale'&&hasTable(db,'warehouse_sale_links'))for(const row of query(db,'SELECT l.request_id,s.id FROM warehouse_sale_links l JOIN active_sales s ON s.id=l.sale_id'))actions.blocked.push({id:String(row.id),source:'warehouse',kind:'Admin-owned product sale',username:row.request_id,state:'linked stock and business debt',canCloseTest:false});
  if(hasTable(db,'finance_receipt_owners'))for(const row of query(db,`SELECT f.record_key,u.account_key AS original_key,f.owner_key FROM finance_receipt_owners f JOIN ${active} b ON CAST(b.id AS TEXT)=f.record_key LEFT JOIN users u ON u.id=b.user_id WHERE f.kind=? AND f.owner_key IS NOT u.account_key`,[kind]))actions.blocked.push({id:row.record_key,source:'handover',kind:'transferred receipt',username:row.owner_key,state:'custody transferred',canCloseTest:false});
  if(hasTable(db,'reseller_money_journal'))for(const row of query(db,"SELECT request_id FROM reseller_money_journal WHERE state='held'"))actions.blocked.push({id:row.request_id,source:'funding',kind:'reserved reseller payment',username:'funding reservation',state:'held',canCloseTest:false});
  return {kind,billCount:bills.length,totalAmount:Math.round(bills.reduce((n,b)=>n+b[type.amount],0)*100)/100,
    cashExcluded:Math.round(drawer.reduce((n,c)=>n+c.amount,0)*100)/100,
    token:crypto.createHash('sha256').update(JSON.stringify({kind,bills,payments,drawer,renewals,actions})).digest('hex'),resets,archived,blockers:actions.blocked,readyToFinalize:actions.ready};
}
function resetBills(db,input,actor,backup,save,kind='bill') {
  const type=resetKind(kind);
  if(input?.confirmation!=='RESET BILLS')throw Error('Type RESET BILLS to archive these local bills/receipts.');
  const note=String(input.note||'').trim();if(note.length<5||note.length>500)throw Error('Enter a reset reason (5–500 characters).');
  const preview=billResetPreview(db,kind);
  const closeIds=input.closeConfirmedTestIds??[];
  if(!Array.isArray(closeIds)||closeIds.some(id=>typeof id!=='string')||new Set(closeIds).size!==closeIds.length)throw Error('Select valid confirmed test actions.');
  if(closeIds.length&&input.closeConfirmedAcknowledged!==true)throw Error('Confirm that selected Proradius-confirmed actions are test-only and their unfinished local payments should not be created.');
  for(const id of closeIds)if(!preview.blockers.some(row=>row.source==='operation'&&row.id===id&&row.canCloseTest))throw Error('The selected action changed or is not confirmed. Refresh Bill settings.');
  const blocking=preview.blockers.filter(row=>!closeIds.includes(row.id)||row.source!=='operation');
  if(blocking.length){const row=blocking[0];if(row.source==='warehouse')throw Error('Admin-stock receipts are linked to shared stock, business product debts and margin funding. Keep these audited receipts and use monthly closing to start a new month. No reset was made.');if(row.source==='handover')throw Error('Some receipts were handed over to another employee. Clearing their original cash/Whish entries would corrupt custody balances. Keep these audited receipts and use monthly closing to start a new month. No reset was made.');const kind=row.source==='renewal'?'Internet renewal cycles':row.source==='plan'?'portal plan changes':'portal actions';throw Error(`Review unfinished ${kind}: ${row.username} · ${row.kind} · ${row.state} · Ref ${row.id}. Use the blocking-action list in Bill settings. No reset or portal action was sent.`);}
  if(!preview.billCount)throw Error('There are no active bills to reset.');
  if(input.token!==preview.token)throw Error('Bills or collections changed. Reopen Bill settings and review the new totals before resetting.');
  // Keep original bills, collections, cash entries, request IDs and portal audit
  // foreign keys. Active views exclude their financial contribution. No API write.
  const backupPath=backup(),id=crypto.randomUUID();
  db.exec('BEGIN TRANSACTION');
  try {
    for(const item of preview.readyToFinalize){
      db.run("UPDATE portal_operations SET state='succeeded',bill_id=COALESCE(bill_id,?),message='Existing local receipts and request links verified during test-bill reset; no new payment or portal action.' WHERE request_id=? AND state='confirmed'",[item.billId,item.id]);
      db.run("INSERT INTO portal_operation_events(request_id,state,note,actor,recorded_at) VALUES(?,'succeeded',?,?,?)",[item.id,`Reset ${id}: existing local records verified; no money inserted or cost changed. ${note}`,actor,new Date().toISOString()]);
    }
    for(const requestId of closeIds){
      db.run("UPDATE portal_operations SET state='archived',message=? WHERE request_id=? AND state='confirmed'",[`Confirmed test action closed locally by reset ${id}. Proradius action is retained, no unfinished payment is created, and this request cannot be replayed. ${note}`,requestId]);
      db.run("INSERT INTO portal_operation_events(request_id,state,note,actor,recorded_at) VALUES(?,'archived',?,?,?)",[requestId,`Admin explicitly closed a confirmed test-only local action during reset ${id}. Portal charge/account unchanged. ${note}`,actor,new Date().toISOString()]);
    }
    db.run('INSERT INTO bill_resets(id,recorded_at,actor,note,bill_count,cash_excluded,backup_path,kind) VALUES(?,?,?,?,?,?,?,?)',[id,new Date().toISOString(),actor,note,preview.billCount,preview.cashExcluded,backupPath,kind]);
    for(const renewal of kind==='bill'?query(db,'SELECT r.* FROM internet_renewals r JOIN active_fibernetlb_bills b ON b.id=r.bill_id'):[]) {
      const remaining=renewal.requested_months-renewal.completed_months;
      db.run("INSERT INTO internet_renewal_events(bill_id,state,note,actor,recorded_at) VALUES(?,'archived',?,?,?)",[renewal.bill_id,`Local test bill archived by reset ${id}. ${renewal.completed_months}/${renewal.requested_months} cycles confirmed; ${remaining} unsubmitted/not-applied cycles abandoned. No portal action undone. ${note}`,actor,new Date().toISOString()]);
    }
    db.run(`UPDATE ${type.table} SET reset_id=? WHERE reset_id IS NULL`,[id]);
    db.exec('COMMIT');save();
  } catch(error) {try{db.exec('ROLLBACK');}catch{}throw error;}
  return {ok:true,id,billCount:preview.billCount,cashExcluded:preview.cashExcluded,backupPath,finalizedCount:preview.readyToFinalize.length,closedTestCount:closeIds.length};
}
module.exports={initializeBillReset,billResetPreview,billResetEpoch,resetBills,recordedOperation,activeReceiptSql};
