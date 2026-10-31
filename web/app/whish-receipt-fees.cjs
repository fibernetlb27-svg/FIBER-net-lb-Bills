'use strict';
// Transition bookkeeping only. This module never calls Whish or Proradius.
// Historical receipts and monthly archive snapshots are never rewritten.
const crypto=require('node:crypto'),Finance=require('./finance-ledger.cjs'),q=Finance.query;
const POLICY='receipt-prepayment-v1',TABLE='finance_receipt_fee_policy_audit';
const TYPES={sale:{table:'sales',date:'created_at'},bill:{table:'fibernetlb_bills',date:'paid_at'},telecom:{table:'telecom_payments',date:'paid_at'},installation:{table:'installation_payments',date:'paid_at'}};
const exists=(db,name)=>q(db,'SELECT name FROM sqlite_master WHERE name=?',[name]).length>0;
const cents=v=>{const n=Number(v),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n*100-c)>1e-6)throw Error('A historical Whish amount is invalid. No correction was made.');return c;};
const json=v=>{const value=JSON.parse(v);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('A historical Whish snapshot is invalid.');return value;};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prepaid=s=>Number(s.fee||0)>0||s.walletPolicy==='gross'||/receipt|prepaid|prepayment|profit_only/.test(`${s.feePolicy||''} ${s.feeTiming||''}`);
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 id TEXT PRIMARY KEY,policy TEXT NOT NULL,origin_kind TEXT NOT NULL,origin_key TEXT NOT NULL,
 wallet_id TEXT NOT NULL,owner_key TEXT NOT NULL,gross_cents INTEGER NOT NULL,fee_cents INTEGER NOT NULL,
 effective_at TEXT NOT NULL,backup_path TEXT NOT NULL,original_json TEXT NOT NULL,result_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS finance_receipt_fee_origin ON ${TABLE}(origin_kind,origin_key);
 CREATE INDEX IF NOT EXISTS finance_receipt_fee_date ON ${TABLE}(effective_at,owner_key);
 CREATE VIEW IF NOT EXISTS active_whish_fee_migration_audit AS SELECT a.*,a.id AS event_id,a.id||'-wallet' AS wallet_entry_id FROM ${TABLE} a WHERE
 (a.origin_kind='sale' AND EXISTS(SELECT 1 FROM active_sales s WHERE CAST(s.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='bill' AND EXISTS(SELECT 1 FROM active_fibernetlb_bills b WHERE CAST(b.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='telecom' AND EXISTS(SELECT 1 FROM active_telecom_payments t WHERE CAST(t.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='installation' AND EXISTS(SELECT 1 FROM installation_payments i WHERE CAST(i.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='debt' AND EXISTS(SELECT 1 FROM debt_payments d WHERE d.id=a.origin_key AND
  ((d.kind='sale' AND EXISTS(SELECT 1 FROM active_sales s WHERE s.id=d.record_id)) OR
   (d.kind='bill' AND EXISTS(SELECT 1 FROM active_fibernetlb_bills b WHERE b.id=d.record_id)) OR
   (d.kind='telecom' AND EXISTS(SELECT 1 FROM active_telecom_payments t WHERE t.id=d.record_id))))) OR
 (a.origin_kind='reseller_fund' AND EXISTS(SELECT 1 FROM reseller_funds r WHERE r.request_id=a.origin_key));`);}
function sourceEvents(db){
 const out=[];
 if(!exists(db,'payment_destinations'))return out;
 for(const row of q(db,'SELECT * FROM payment_destinations ORDER BY kind,record_key')){
  let source,type=TYPES[row.kind];
  if(row.kind==='debt'){
   if(!exists(db,'debt_payments'))continue;
   source=q(db,'SELECT * FROM debt_payments WHERE id=?',[row.record_key])[0];
   type=source&&TYPES[source.kind];if(!type)continue;
   const active=exists(db,'active_'+type.table)?'active_'+type.table:type.table;
   if(!q(db,`SELECT id FROM ${active} WHERE id=?`,[source.record_id]).length)continue;
   source={...source,at:source.received_at};
  }else{
   if(!type||!exists(db,type.table))continue;
   const active=exists(db,'active_'+type.table)?'active_'+type.table:type.table;
   source=q(db,`SELECT *,${type.date} AS at FROM ${active} WHERE CAST(id AS TEXT)=?`,[row.record_key])[0];
  }
  if(!source||source.payment_method!=='Whish Money')continue;
  const snap=json(row.snapshot_json);if(!snap.id)continue;
  const value=cents(snap.walletAmount??snap.netCollected??snap.gross??0),user=q(db,'SELECT account_key FROM users WHERE id=?',[source.user_id])[0];
  out.push({kind:'source',at:String(source.at),rank:0,sort:`${row.kind}:${row.record_key}`,walletId:String(snap.id),ownerKey:user?.account_key||'__unassigned__',value,
   origin:{kind:row.kind,key:String(row.record_key),original:row.snapshot_json},feeFree:value>0&&!prepaid(snap)});
 }
 return out;
}
function replay(db,destinations,now,context={}){
 const warnings=[],events=sourceEvents(db),audits=exists(db,TABLE)?q(db,`SELECT * FROM ${TABLE} ORDER BY effective_at,id`):[],activeAudits=exists(db,'active_whish_fee_migration_audit')?q(db,'SELECT * FROM active_whish_fee_migration_audit'):audits,auditMap=new Map(activeAudits.map(a=>[a.id,a])),inactiveAuditIds=new Set(audits.filter(a=>!auditMap.has(a.id)).map(a=>a.id));
 const funds=exists(db,'reseller_funds')?new Map(q(db,'SELECT * FROM reseller_funds').map(f=>[f.request_id,f])):new Map();
 const journals=exists(db,'reseller_money_journal')?new Map(q(db,'SELECT * FROM reseller_money_journal').map(j=>[j.id,j])):new Map();
 const metadata=exists(db,'finance_events')?new Map(q(db,'SELECT * FROM finance_events').map(e=>[e.id,e])):new Map(),groups=new Map(),paidFees=new Map(),unknownFeeOrigins=new Set(),reservedOrigins=new Map();
 const grossAudits=exists(db,'finance_whish_gross_restorations')?new Set(q(db,'SELECT id FROM finance_whish_gross_restorations').map(r=>r.id)):null;
 const activeGrossAudits=grossAudits?new Set(q(db,'SELECT id FROM active_whish_wallet_gross_audit').map(r=>r.id)):null;
 const voidEntries=exists(db,'pos_invoice_void_wallet')?new Set(q(db,'SELECT event_id FROM pos_invoice_void_wallet').map(row=>row.event_id)):new Set();
 // Collection journals use a prefixed event ID. Preserve the saved destination:
 // a proven Admin-wallet collection transfers custody, it is not a cash-out.
 for(const row of require('./reseller-collections.cjs').collectionMovementMetadata(db))metadata.set(row.eventId,{kind:row.kind,result_json:JSON.stringify({amount:row.amount,fee:row.fee})});
 for(const row of context.cashoutMetadata||[]){if(!row?.eventId)throw Error('Invalid cross-business cash-out metadata.');metadata.set(row.eventId,{kind:'wallet_cashout',result_json:JSON.stringify({amount:row.amount,fee:row.fee})});}
 for(const row of exists(db,'finance_wallet_entries')?q(db,'SELECT rowid AS sequence,* FROM finance_wallet_entries ORDER BY effective_at,rowid'):[]){
  if(voidEntries.has(row.id))continue;
  if(inactiveAuditIds.has(row.event_id))continue;
  if(grossAudits?.has(row.event_id)&&!activeGrossAudits.has(row.event_id))continue;
  const groupKey=`${row.event_id}\u0000${row.effective_at}`;if(!groups.has(groupKey))groups.set(groupKey,{kind:'movement',at:row.effective_at,rank:1,sort:String(row.sequence).padStart(15,'0'),id:row.event_id,rows:[]});groups.get(groupKey).rows.push(row);
 }
 events.push(...groups.values());events.sort((a,b)=>a.at.localeCompare(b.at)||a.rank-b.rank||a.sort.localeCompare(b.sort));
 const buckets=new Map(),warning=value=>{if(!warnings.includes(value))warnings.push(value);};
 const bucket=(wallet,owner)=>{const id=JSON.stringify([wallet,owner]);if(!buckets.has(id))buckets.set(id,{walletId:wallet,ownerKey:owner,lots:[],deficit:0});return buckets.get(id);};
 const add=(b,lot)=>{let value=lot.value;if(value<=0)return;if(b.deficit){const offset=Math.min(b.deficit,value);b.deficit-=offset;value-=offset;}if(value)b.lots.push({...lot,value});};
 const consume=(b,value)=>{
  if(!Number.isSafeInteger(value)||value<0)throw Error('A historical wallet debit is invalid.');
  const selected=[];if(b.lots.some(l=>l.feeFree)&&b.lots.some(l=>!l.feeFree))warning(`Pooled historical movements in ${b.walletId} were allocated conservatively to fee-free payments first; prepaid funds were not charged twice.`);
  // Without withdrawal-to-receipt links, consuming fee-free funds first is the
  // conservative allocation: it cannot manufacture another fee on prepaid money.
  const ordered=[...b.lots.filter(l=>l.feeFree),...b.lots.filter(l=>!l.feeFree)];
  for(const lot of ordered){if(!value)break;const used=Math.min(value,lot.value);lot.value-=used;value-=used;selected.push({...lot,value:used});}
  b.lots=b.lots.filter(l=>l.value>0);if(value){b.deficit+=value;selected.push({value,feeFree:false,origin:null});}return selected;
 };
 for(const e of events){
  if(e.at>now)continue;
  if(e.kind==='source'){const b=bucket(e.walletId,e.ownerKey);if(e.value<0)consume(b,-e.value);else add(b,{value:e.value,feeFree:e.feeFree,origin:e.origin});continue;}
  const audit=auditMap.get(e.id);
  if(audit){
   if(audit.policy!==POLICY)throw Error('An unknown historical fee-transition policy needs Admin review.');
   const b=bucket(audit.wallet_id,audit.owner_key);let left=audit.gross_cents;
   for(const lot of [...b.lots])if(left&&lot.feeFree&&lot.origin?.kind===audit.origin_kind&&lot.origin?.key===audit.origin_key){const used=Math.min(left,lot.value);left-=used;if(used===lot.value)lot.feeFree=false;else{lot.value-=used;add(b,{...lot,value:used,feeFree:false});}}
   if(left)throw Error('A previously corrected Whish source is no longer attributable to its preserved wallet history. Review its archive or adjustment before another correction.');
   const rows=e.rows.filter(r=>r.wallet_id===audit.wallet_id&&r.account_key===audit.owner_key);
   if(rows.length!==1||rows[0].amount_cents!==-audit.fee_cents||e.rows.length!==1)throw Error('A Whish transition audit does not match its wallet debit.');
   // Debit the prepaid lot itself, not a newer fee-free receipt in the same pool.
   let fee=audit.fee_cents;for(const lot of b.lots)if(fee&&!lot.feeFree&&lot.origin?.kind===audit.origin_kind&&lot.origin?.key===audit.origin_key){const used=Math.min(fee,lot.value);lot.value-=used;fee-=used;}
   if(fee)throw Error('A preserved prepaid fee exceeds its remaining source principal.');b.lots=b.lots.filter(l=>l.value>0);continue;
  }
  const event=metadata.get(e.id),negative=e.rows.filter(r=>r.amount_cents<0),positive=e.rows.filter(r=>r.amount_cents>0),sum=e.rows.reduce((n,r)=>n+r.amount_cents,0);
  const transfer=['wallet_transfer','end_of_day'].includes(event?.kind);
  if(transfer){
   if(sum!==0||!negative.length||!positive.length)throw Error('A historical wallet custody transfer is incomplete.');
   const moved=[];for(const row of negative)moved.push({walletId:row.wallet_id,lots:consume(bucket(row.wallet_id,row.account_key),-row.amount_cents)});
   for(const row of positive){let left=row.amount_cents;const target=bucket(row.wallet_id,row.account_key);for(const source of moved){if(event.kind==='end_of_day'&&source.walletId!==row.wallet_id)continue;for(const lot of source.lots){if(!left)break;const used=Math.min(left,lot.value);left-=used;lot.value-=used;add(target,{...lot,value:used});}}if(left)throw Error('A wallet custody transfer has an unmatched credit.');}continue;
  }
  const consumed=[];
  for(const row of e.rows){
   if(!Number.isSafeInteger(row.amount_cents))throw Error('A historical wallet movement is invalid.');
   const b=bucket(row.wallet_id,row.account_key),journal=journals.get(row.id);
   if(row.amount_cents<0){const portions=consume(b,-row.amount_cents);consumed.push(...portions);if(journal?.phase==='reserve')reservedOrigins.set(journal.request_id,portions.map(p=>({...p})));continue;}
   if(!row.amount_cents)continue;
   if(journal&&['release','collection-cancel'].includes(journal.phase)&&reservedOrigins.has(journal.request_id)){
    let left=row.amount_cents;for(const lot of reservedOrigins.get(journal.request_id)){if(!left)break;const used=Math.min(left,lot.value);left-=used;lot.value-=used;add(b,{...lot,value:used});}if(left)add(b,{value:left,feeFree:false,origin:null});continue;
   }
   const fund=funds.get(row.event_id),input=fund?json(fund.input_json):null;
   const eligible=journal?.phase==='credit'&&fund?.amount_cents>0&&fund.payment_method==='Whish Money'&&input?.accountingVersion===3&&fund.username!=='fibernetlb2'&&!prepaid(input);
   add(b,{value:row.amount_cents,feeFree:!!eligible,origin:eligible?{kind:'reseller_fund',key:fund.request_id,original:fund.input_json,fundRequestId:fund.request_id}:null});
  }
  const possibleCollection=e.rows.some(row=>{const journal=journals.get(row.id);return journal?.phase==='reserve'&&journal.state!=='released'&&journal.request_id.startsWith('collection-');});
  if(event?.kind==='wallet_cashout'||possibleCollection){
   const result=event?json(event.result_json):{},total=consumed.reduce((n,l)=>n+l.value,0);
   const known=Object.hasOwn(result,'fee')&&typeof result.fee==='number'&&Number.isFinite(result.fee)&&result.fee>=0;
   if(!known){for(const lot of consumed.filter(l=>l.feeFree&&l.origin))unknownFeeOrigins.add(JSON.stringify([lot.origin.kind,lot.origin.key]));}
   else if(total){const fee=cents(result.fee);let cumulative=0,allocated=0;for(const lot of consumed){cumulative+=lot.value;const next=Number((BigInt(cumulative)*BigInt(fee)*2n+BigInt(total))/(BigInt(total)*2n)),part=next-allocated;allocated=next;if(lot.feeFree&&lot.origin){const key=JSON.stringify([lot.origin.kind,lot.origin.key]);paidFees.set(key,(paidFees.get(key)||0)+part);}}}
  }
 }
 // Compare to the application's authoritative available balances, not a guessed
 // positive receipt total. Inactive configured wallets remain part of the audit.
 const all=Finance.walletBalances(db,destinations,null,now.slice(0,10)),owners=new Set([...buckets.values()].map(b=>b.ownerKey).filter(k=>k!=='__unassigned__'));
 for(const key of owners){const actual=Finance.walletBalances(db,destinations,key,now.slice(0,10));for(const b of [...buckets.values()].filter(v=>v.ownerKey===key)){const calculated=b.lots.reduce((n,l)=>n+l.value,0)-b.deficit,expected=cents(actual.find(w=>w.id===b.walletId)?.balance||0);if(calculated!==expected)throw Error('Historical Whish lot reconstruction does not match the available employee wallet balance. No correction was made.');}}
 for(const wallet of all){const calculated=[...buckets.values()].filter(b=>b.walletId===wallet.id).reduce((n,b)=>n+b.lots.reduce((s,l)=>s+l.value,0)-b.deficit,0);if(calculated!==cents(wallet.balance))throw Error('Historical Whish lot reconstruction does not match the available total wallet balance. No correction was made.');}
 return {buckets:[...buckets.values()],warnings,audits,paidFees,unknownFeeOrigins};
}
function plan(db,destinations,now,context={}){
 const result={policy:POLICY,asOf:now,items:[],deferred:[],warnings:[],context,destinations};
 try{
  if(!/^\d{4}-\d{2}-\d{2}T/.test(String(now)))throw Error('The Main accounting timestamp is required.');
  if(now.slice(0,7)<=Finance.latestMonth(db))throw Error('Record the fee transition in an open accounting month.');
  const pending=Finance.pendingActions(db);if(pending.length){result.deferred=pending.map(action=>({reason:'Unfinished portal or custody operation',...action}));result.token=digest(result);return result;}
  const state=replay(db,destinations,now,context);result.warnings=state.warnings;
  const byOrigin=new Map();
  for(const b of state.buckets){
   if(b.deficit){result.warnings.push(`Negative historical wallet balance in ${b.walletId} for ${b.ownerKey}; only verified remaining payments can be corrected.`);continue;}
   for(const lot of b.lots.filter(l=>l.feeFree&&l.origin)){
    const user=q(db,'SELECT id,full_name FROM users WHERE account_key=?',[b.ownerKey])[0];if(!user){result.deferred.push({reason:'A remaining payment has no mapped current employee',walletId:b.walletId,ownerKey:b.ownerKey,kind:lot.origin.kind,key:lot.origin.key});continue;}
    const key=JSON.stringify([lot.origin.kind,lot.origin.key]);if(!byOrigin.has(key))byOrigin.set(key,[]);const parts=byOrigin.get(key),old=parts.find(p=>p.walletId===b.walletId&&p.ownerKey===b.ownerKey);if(old)old.grossCents+=lot.value;else{const destination=destinations.find(d=>d.id===b.walletId),saved=json(lot.origin.original);parts.push({walletId:b.walletId,walletLabel:destination?.label||saved.label||saved.targetWalletLabel||'Historical wallet',walletNumber:destination?.number||saved.number||saved.targetWalletNumber||'',ownerKey:b.ownerKey,ownerName:user.full_name,grossCents:lot.value,feeCents:0,origins:[{...lot.origin,grossCents:lot.value,feeCents:0}],...(lot.origin.fundRequestId?{fundRequestId:lot.origin.fundRequestId}:{})});}
   }
  }
  for(const parts of byOrigin.values()){
   const gross=parts.reduce((n,p)=>n+p.grossCents,0),origin=parts[0].origins[0],originKey=JSON.stringify([origin.kind,origin.key]);let totalFee=Math.round(gross/100);
   // Reseller collections already have a source-specific cumulative-cent fee
   // allocation. Preserve it exactly instead of rounding the remainder again.
   if(parts[0].fundRequestId){
    const id=parts[0].fundRequestId,saved=exists(db,'reseller_fee_prepayments')?q(db,'SELECT * FROM reseller_fee_prepayments WHERE fund_request_id=?',[id])[0]:null;
    const verified=saved?{grossCents:saved.gross_cents,feeCents:saved.fee_cents}:require('./reseller-collections.cjs').prepaymentPlans(db).find(p=>p.fundRequestId===id);
    if(!verified||verified.grossCents!==gross){result.deferred.push({reason:'The remaining reseller custody does not match its verified uncollected funding. Review its pooled movements before correcting fees.',fundRequestId:id,remainingWalletPrincipal:gross/100,verifiedFundingPrincipal:verified?.grossCents/100});continue;}
    totalFee=verified.feeCents;
   }else{
    if(state.unknownFeeOrigins.has(originKey)){result.deferred.push({reason:'An earlier cash-out has no verified fee amount for a remaining payment. Review its preserved history before correcting another fee.',kind:origin.kind,key:origin.key});continue;}
    const original=json(origin.original),originalGross=cents(original.gross??0),paid=state.paidFees.get(originKey)||0;
    totalFee=Math.min(totalFee,Math.max(0,Math.round(originalGross/100)-paid));
   }
   let cumulative=0,fees=0;parts.sort((a,b)=>a.walletId.localeCompare(b.walletId)||a.ownerKey.localeCompare(b.ownerKey));
   for(const part of parts){cumulative+=part.grossCents;const cumulativeFee=Number((BigInt(cumulative)*BigInt(totalFee)*2n+BigInt(gross))/(BigInt(gross)*2n));part.feeCents=cumulativeFee-fees;fees=cumulativeFee;part.origins[0].grossCents=part.grossCents;part.origins[0].feeCents=part.feeCents;part.id='whish-prepaid-'+digest([POLICY,part.origins[0].kind,part.origins[0].key,part.walletId,part.ownerKey]).slice(0,40);result.items.push(part);}
  }
  result.items.sort((a,b)=>a.id.localeCompare(b.id));
 }catch(error){result.items=[];result.deferred.push({reason:error.message});}
 result.token=digest({policy:result.policy,asOf:now,items:result.items,deferred:result.deferred,warnings:result.warnings});return result;
}
function apply(db,prepared,now,backupPath){
 if(typeof backupPath!=='string'||!backupPath.trim())throw Error('A verified all-section database backup is required before correcting older Whish payments.');
 if(!prepared||prepared.policy!==POLICY||!Array.isArray(prepared.items)||prepared.asOf!==now)throw Error('Review the current Whish fee-transition plan.');
 initialize(db);
 if(prepared.items.length&&prepared.items.every(item=>{const old=q(db,`SELECT * FROM ${TABLE} WHERE id=?`,[item.id])[0];return old&&old.policy===POLICY&&old.wallet_id===item.walletId&&old.owner_key===item.ownerKey&&old.gross_cents===item.grossCents&&old.fee_cents===item.feeCents&&old.origin_kind===item.origins[0].kind&&old.origin_key===item.origins[0].key;}))return prepared.items.map(item=>({...json(q(db,`SELECT result_json FROM ${TABLE} WHERE id=?`,[item.id])[0].result_json),idempotent:true}));
 const fresh=plan(db,prepared.destinations||[],now,prepared.context||{});
 if(fresh.token!==prepared.token)throw Error('The Whish wallet history changed. Review the correction again before applying it.');
 const changes=[];db.exec('BEGIN');try{
  for(const item of prepared.items){
   const old=q(db,`SELECT * FROM ${TABLE} WHERE id=?`,[item.id])[0];if(old)continue;
   const origin=item.origins[0],user=q(db,'SELECT id,full_name FROM users WHERE account_key=?',[item.ownerKey])[0];if(!user)throw Error('The correction employee no longer exists.');
   const result={id:item.id,policy:POLICY,kind:origin.kind,key:origin.key,walletId:item.walletId,walletLabel:item.walletLabel,walletNumber:item.walletNumber,ownerKey:item.ownerKey,owner:user.full_name,gross:item.grossCents/100,amount:item.grossCents/100,fee:item.feeCents/100,netCollected:(item.grossCents-item.feeCents)/100,createdAt:now,receivedAt:now,backupPath,originalReceiptUnchanged:true};
   db.run(`INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[item.id,POLICY,origin.kind,origin.key,item.walletId,item.ownerKey,item.grossCents,item.feeCents,now,backupPath,origin.original||'{}',JSON.stringify(result)]);
   db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[item.id+'-wallet',item.id,item.walletId,item.ownerKey,-item.feeCents,now]);
   if(item.feeCents)db.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id) VALUES(?,?,?,?,?,'whish_receipt_migration',?)",[now.slice(0,10),'Whish Money fees',`Prepaid 1% on remaining uncollected Whish payment · ${origin.kind}:${origin.key}`,item.feeCents/100,user.id,item.id]);
   db.run('INSERT INTO finance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',[item.id,'whish_fee_prepayment',now,now,'__system__',item.ownerKey,null,item.grossCents,'Existing uncollected payment fee prepaid once; no portal transaction.',JSON.stringify({policy:POLICY,origin:{kind:origin.kind,key:origin.key},walletId:item.walletId,ownerKey:item.ownerKey,grossCents:item.grossCents,feeCents:item.feeCents}),JSON.stringify(result)]);
   changes.push(result);
  }
  db.exec('COMMIT');return changes;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
function listFees(db,start,end,key=null){
 if(!exists(db,TABLE))return [];
 return q(db,`SELECT a.*,d.label,d.number,COALESCE(o.owner_key,a.owner_key) AS current_owner_key,u.full_name AS current_owner_name
 FROM active_whish_fee_migration_audit a LEFT JOIN whish_destinations d ON d.id=a.wallet_id
 LEFT JOIN expenses e ON e.source_type='whish_receipt_migration' AND e.source_id=a.id
 LEFT JOIN finance_receipt_owners o ON o.kind='expense' AND o.record_key=CAST(e.id AS TEXT)
 LEFT JOIN users u ON u.account_key=COALESCE(o.owner_key,a.owner_key)
 WHERE substr(a.effective_at,1,10) BETWEEN ? AND ?${key?' AND COALESCE(o.owner_key,a.owner_key)=?':''} ORDER BY a.effective_at,a.id`,[start,end,...key?[key]:[]]).filter(a=>a.fee_cents>0).map(a=>{
  const saved=json(a.result_json),owner=a.current_owner_name||saved.owner;
  return {...saved,originalOwnerKey:a.owner_key,originalOwner:saved.owner,ownerKey:a.current_owner_key,owner,wallet:a.label||saved.walletLabel||'Historical wallet',walletLabel:a.label||saved.walletLabel||'Historical wallet',walletNumber:a.number||saved.walletNumber||'',cashierName:owner,referenceNo:a.id,sourceType:'whish_receipt_migration'};
 });
}
function needs(db,destinations,now){return plan(db,destinations,now).items.length>0;}
module.exports={POLICY,initialize,plan,apply,listFees,needs};
