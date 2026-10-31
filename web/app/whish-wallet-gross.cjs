'use strict';
// Audited app-only restoration of surviving wallet fee reservations. Profit
// expenses, original receipts, portal credits and monthly archives stay intact.
const crypto=require('node:crypto'),F=require('./finance-ledger.cjs'),q=F.query;
const POLICY='wallet-gross-profit-fees-v1',TABLE='finance_whish_gross_restorations';
const TYPES={sale:{table:'sales',date:'created_at'},bill:{table:'fibernetlb_bills',date:'paid_at'},telecom:{table:'telecom_payments',date:'paid_at'},installation:{table:'installation_payments',date:'paid_at'}};
const exists=(db,name)=>q(db,'SELECT name FROM sqlite_master WHERE name=?',[name]).length>0;
const cents=value=>{const n=Number(value),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n*100-c)>1e-6)throw Error('A preserved Whish amount is invalid. No wallet restoration was made.');return c;};
const parse=value=>{const p=JSON.parse(value);if(!p||typeof p!=='object'||Array.isArray(p))throw Error('A preserved Whish snapshot is invalid.');return p;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ratio=(value,numerator,denominator)=>{if(!Number.isSafeInteger(value)||!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||denominator<=0)throw Error('Invalid surviving wallet fee allocation.');return Number((BigInt(value)*BigInt(numerator)*2n+BigInt(denominator))/(BigInt(denominator)*2n));};
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 id TEXT PRIMARY KEY,policy TEXT NOT NULL,tag_id TEXT NOT NULL,origin_kind TEXT NOT NULL,origin_key TEXT NOT NULL,
 wallet_id TEXT NOT NULL,owner_key TEXT NOT NULL,net_cents INTEGER NOT NULL,restored_fee_cents INTEGER NOT NULL,
 basis_net_cents INTEGER NOT NULL,basis_fee_cents INTEGER NOT NULL,fund_request_id TEXT NOT NULL,
 effective_at TEXT NOT NULL,backup_path TEXT NOT NULL,source_json TEXT NOT NULL,result_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS whish_gross_origin ON ${TABLE}(origin_kind,origin_key);
 CREATE INDEX IF NOT EXISTS whish_gross_date ON ${TABLE}(effective_at,owner_key);
 CREATE VIEW IF NOT EXISTS active_whish_wallet_gross_audit AS SELECT a.*,a.id AS event_id,a.id||'-wallet' AS wallet_entry_id FROM ${TABLE} a WHERE
 (a.origin_kind='sale' AND EXISTS(SELECT 1 FROM active_sales s WHERE CAST(s.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='bill' AND EXISTS(SELECT 1 FROM active_fibernetlb_bills b WHERE CAST(b.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='telecom' AND EXISTS(SELECT 1 FROM active_telecom_payments t WHERE CAST(t.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='installation' AND EXISTS(SELECT 1 FROM installation_payments i WHERE CAST(i.id AS TEXT)=a.origin_key)) OR
 (a.origin_kind='debt' AND EXISTS(SELECT 1 FROM debt_payments d WHERE d.id=a.origin_key AND
  ((d.kind='sale' AND EXISTS(SELECT 1 FROM active_sales s WHERE s.id=d.record_id)) OR
   (d.kind='bill' AND EXISTS(SELECT 1 FROM active_fibernetlb_bills b WHERE b.id=d.record_id)) OR
   (d.kind='telecom' AND EXISTS(SELECT 1 FROM active_telecom_payments t WHERE t.id=d.record_id))))) OR
 (a.origin_kind='reseller_fund' AND EXISTS(SELECT 1 FROM reseller_funds r WHERE r.request_id=a.origin_key));`);}
function sources(db){const out=[];
 for(const row of exists(db,'payment_destinations')?q(db,'SELECT * FROM payment_destinations ORDER BY kind,record_key'):[]){
  let source,type=TYPES[row.kind];
  if(row.kind==='debt'){
   source=q(db,'SELECT * FROM debt_payments WHERE id=?',[row.record_key])[0];type=source&&TYPES[source.kind];if(!type)continue;
   const active=exists(db,'active_'+type.table)?'active_'+type.table:type.table;if(!q(db,`SELECT id FROM ${active} WHERE id=?`,[source.record_id]).length)continue;source={...source,at:source.received_at};
  }else{if(!type||!exists(db,type.table))continue;const active=exists(db,'active_'+type.table)?'active_'+type.table:type.table;source=q(db,`SELECT *,${type.date} AS at FROM ${active} WHERE CAST(id AS TEXT)=?`,[row.record_key])[0];}
  if(!source||source.payment_method!=='Whish Money')continue;
  const snapshot=parse(row.snapshot_json);if(!snapshot.id)continue;
  const value=cents(snapshot.walletAmount??snapshot.netCollected??snapshot.gross??0),gross=cents(snapshot.gross??0),fee=cents(snapshot.fee||0),difference=gross-value;
  if(value>0&&difference>0&&(difference!==fee||fee<0))throw Error('The preserved receipt wallet reduction is not explained by its recorded fee.');
  const owner=q(db,'SELECT account_key FROM users WHERE id=?',[source.user_id])[0]?.account_key||'__unassigned__';
  const origin={kind:row.kind,key:String(row.record_key),source:row.snapshot_json},tag=value>0&&difference>0?{id:`receipt:${row.kind}:${row.record_key}`,origin,basisNet:value,basisFee:difference}:null;
  out.push({kind:'source',at:String(source.at),rank:0,sort:row.kind+':'+row.record_key,walletId:String(snapshot.id),ownerKey:owner,value,origin,tag,refund:value<0});
 }
 return out;
}
function replay(db,destinations,now,context){
 const warnings=[],events=sources(db),restorations=exists(db,TABLE)?q(db,`SELECT * FROM ${TABLE}`):[],activeRestorations=exists(db,'active_whish_wallet_gross_audit')?q(db,'SELECT * FROM active_whish_wallet_gross_audit'):restorations,
  restorationMap=new Map(activeRestorations.map(a=>[a.id,a])),inactiveRestorations=new Set(restorations.filter(a=>!restorationMap.has(a.id)).map(a=>a.id));
 const feeAudits=exists(db,'finance_receipt_fee_policy_audit')?q(db,'SELECT * FROM finance_receipt_fee_policy_audit'):[],activeFeeAudits=exists(db,'active_whish_fee_migration_audit')?q(db,'SELECT * FROM active_whish_fee_migration_audit'):feeAudits,
  feeAuditMap=new Map(activeFeeAudits.map(a=>[a.id,a])),inactiveFeeAudits=new Set(feeAudits.filter(a=>!feeAuditMap.has(a.id)).map(a=>a.id));
 const journals=exists(db,'reseller_money_journal')?new Map(q(db,'SELECT * FROM reseller_money_journal').map(r=>[r.id,r])):new Map(),funds=exists(db,'reseller_funds')?new Map(q(db,'SELECT * FROM reseller_funds').map(r=>[r.request_id,r])):new Map(),
  metadata=exists(db,'finance_events')?new Map(q(db,'SELECT * FROM finance_events').map(r=>[r.id,r])):new Map(),groups=new Map();
 // New paired Admin-wallet collections retain the original lot provenance.
 // Old saved cash-out routes keep their prior interpretation unchanged.
 for(const row of require('./reseller-collections.cjs').collectionMovementMetadata(db))if(row.kind==='wallet_transfer')metadata.set(row.eventId,{kind:row.kind,result_json:JSON.stringify({amount:row.amount,fee:row.fee})});
 for(const row of context.cashoutMetadata||[]){if(!row.eventId)throw Error('Invalid cross-business cash-out metadata.');metadata.set(row.eventId,{kind:'wallet_cashout',result_json:JSON.stringify({amount:row.amount,fee:row.fee})});}
 const voidEntries=exists(db,'pos_invoice_void_wallet')?new Set(q(db,'SELECT event_id FROM pos_invoice_void_wallet').map(row=>row.event_id)):new Set();
 for(const row of exists(db,'finance_wallet_entries')?q(db,'SELECT rowid AS sequence,* FROM finance_wallet_entries ORDER BY effective_at,rowid'):[]){
  if(voidEntries.has(row.id))continue;
  if(inactiveRestorations.has(row.event_id)||inactiveFeeAudits.has(row.event_id))continue;
  const key=row.event_id+'\u0000'+row.effective_at;if(!groups.has(key))groups.set(key,{kind:'movement',id:row.event_id,at:row.effective_at,rank:1,sort:String(row.sequence).padStart(15,'0'),rows:[]});groups.get(key).rows.push(row);
 }
 events.push(...groups.values());events.sort((a,b)=>a.at.localeCompare(b.at)||a.rank-b.rank||a.sort.localeCompare(b.sort));
 const buckets=new Map(),reservations=new Map(),warning=text=>{if(!warnings.includes(text))warnings.push(text);},keyOf=(wallet,owner)=>JSON.stringify([wallet,owner]);
 const bucket=(wallet,owner)=>{const key=keyOf(wallet,owner);if(!buckets.has(key))buckets.set(key,{walletId:wallet,ownerKey:owner,lots:[],deficit:0});return buckets.get(key);};
 const add=(b,lot)=>{let value=lot.value;if(value<=0)return;if(b.deficit){const consumed=Math.min(value,b.deficit);value-=consumed;b.deficit-=consumed;}if(value)b.lots.push({...lot,value});};
 const allLots=()=>[...buckets.values()].flatMap(b=>b.lots);
 function consume(b,value,{origin=null,tagId=null,refund=false}={}){
  const selected=[],matches=l=>(!origin||l.origin?.kind===origin.kind&&l.origin?.key===origin.key)&&(!tagId||l.tag?.id===tagId);
  const candidates=b.lots.filter(matches),tagged=candidates.filter(l=>l.tag&&!l.restored),other=candidates.filter(l=>!l.tag||l.restored);
  if(!origin&&!tagId&&tagged.length&&other.length)warning(`Pooled movements in ${b.walletId} consume known fee-reduced funds first, so unrelated gross or adjustment money cannot acquire invented restored fees.`);
  const before=new Map();if(refund)for(const lot of tagged){const tag=lot.tag;if(!before.has(tag.id)){const total=allLots().filter(l=>l.tag?.id===tag.id&&!l.restored).reduce((n,l)=>n+l.value,0);before.set(tag.id,{tag,fee:ratio(total,tag.basisFee,tag.basisNet)});}}
  for(const lot of [...tagged,...other]){if(!value)break;const used=Math.min(value,lot.value);lot.value-=used;value-=used;selected.push({...lot,value:used});}
  b.lots=b.lots.filter(l=>l.value>0);
  if(value){if(origin||tagId)throw Error('A preserved wallet fee cannot be attributed to its original remaining principal.');b.deficit+=value;selected.push({value,origin:null,tag:null});}
  // Historical refunds did not return the original receipt fee. Keep that fee
  // reservation attached to the still-held funds, rather than treating a refund
  // as a cash-out that already used a proportional part of the reservation.
  if(refund)for(const {tag,fee}of before.values()){const remaining=allLots().filter(l=>l.tag?.id===tag.id&&!l.restored).reduce((n,l)=>n+l.value,0);if(remaining){tag.basisNet=remaining;tag.basisFee=fee;}}
  return selected;
 }
 for(const e of events){
  if(e.at>now)continue;
  if(e.kind==='source'){const b=bucket(e.walletId,e.ownerKey);if(e.value<0)consume(b,-e.value,{refund:true});else add(b,{value:e.value,origin:e.origin,tag:e.tag,restored:false});continue;}
  const restored=restorationMap.get(e.id);
  if(restored){
   const b=bucket(restored.wallet_id,restored.owner_key),pieces=consume(b,restored.net_cents,{tagId:restored.tag_id});
   if(e.rows.length!==1||e.rows[0].amount_cents!==restored.restored_fee_cents||e.rows[0].wallet_id!==restored.wallet_id||e.rows[0].account_key!==restored.owner_key)throw Error('A gross-wallet restoration does not match its preserved wallet credit.');
   for(const lot of pieces)add(b,{...lot,restored:true});add(b,{value:restored.restored_fee_cents,origin:null,tag:null,restored:true});continue;
  }
  const audit=feeAuditMap.get(e.id);
  if(audit){
   if(e.rows.length!==1||e.rows[0].amount_cents!==-audit.fee_cents)throw Error('A preserved fee correction does not match its wallet debit.');
   const b=bucket(audit.wallet_id,audit.owner_key),origin={kind:audit.origin_kind,key:audit.origin_key,source:audit.original_json},pieces=consume(b,audit.gross_cents,{origin});
   const net=audit.gross_cents-audit.fee_cents;if(net<0)throw Error('A preserved fee exceeds its correction principal.');
   const fundRequestId=origin.kind==='reseller_fund'?origin.key:null,tag=net>0&&audit.fee_cents>0?{id:'prepayment:'+audit.id,origin,basisNet:net,basisFee:audit.fee_cents,...fundRequestId?{fundRequestId}:{}}:null;
   // The audit already proves the exact reduced net custody. Replace its gross
   // pieces once, rather than subtracting the fee from a newer pooled receipt.
   if(net)add(b,{value:net,origin,tag,restored:false});continue;
  }
  const event=metadata.get(e.id),negative=e.rows.filter(r=>r.amount_cents<0),positive=e.rows.filter(r=>r.amount_cents>0),sum=e.rows.reduce((n,r)=>n+r.amount_cents,0);
  if(['wallet_transfer','end_of_day'].includes(event?.kind)){
   if(sum!==0||!negative.length||!positive.length)throw Error('A historical wallet transfer is incomplete.');
   const moved=negative.map(row=>({walletId:row.wallet_id,lots:consume(bucket(row.wallet_id,row.account_key),-row.amount_cents)}));
   for(const row of positive){let left=row.amount_cents;for(const source of moved){if(event.kind==='end_of_day'&&source.walletId!==row.wallet_id)continue;for(const lot of source.lots){if(!left)break;const used=Math.min(left,lot.value);left-=used;lot.value-=used;add(bucket(row.wallet_id,row.account_key),{...lot,value:used});}}if(left)throw Error('A historical custody transfer has an unmatched wallet credit.');}continue;
  }
  for(const row of e.rows){
   if(!Number.isSafeInteger(row.amount_cents))throw Error('A historical wallet entry is invalid.');
   const b=bucket(row.wallet_id,row.account_key),journal=journals.get(row.id),fund=funds.get(row.event_id),input=fund?parse(fund.input_json):null;
   if(row.amount_cents<0){
    const refund=journal?.phase==='reserve'&&fund?.amount_cents<0,parts=consume(b,-row.amount_cents,{refund});if(journal?.phase==='reserve')reservations.set(journal.request_id,parts.map(l=>({...l})));continue;
   }
   if(!row.amount_cents)continue;
   if(journal&&['release','collection-cancel'].includes(journal.phase)&&reservations.has(journal.request_id)){let left=row.amount_cents;for(const lot of reservations.get(journal.request_id)){const used=Math.min(left,lot.value);left-=used;lot.value-=used;add(b,{...lot,value:used});if(!left)break;}if(left)add(b,{value:left,origin:null,tag:null});continue;}
   let tag=null,origin=null;
   if(journal?.phase==='credit'&&fund?.amount_cents>0&&fund.payment_method==='Whish Money'&&[2,3,4].includes(input?.accountingVersion)&&fund.username!=='fibernetlb2'){
    origin={kind:'reseller_fund',key:fund.request_id,source:fund.input_json};
    if(input.accountingVersion===4){const gross=cents(input.grossAmount),gap=gross-row.amount_cents,recorded=cents(input.walletFee??input.fee??0);if(gap<0||gap!==recorded)throw Error('A preserved reseller wallet deduction does not match its receipt.');if(gap)tag={id:'fund:'+fund.request_id,origin,basisNet:row.amount_cents,basisFee:gap,fundRequestId:fund.request_id};}
    if(input.accountingVersion===2){
     // Older v2 receipts were already "collected" in the reseller claim
     // ledger, but their receiving wallet can still hold net-reduced money.
     // Restore only an exact preserved custody/fee match; never reopen a claim.
     let verified=false,gap=0;try{const gross=cents(input.grossAmount),recorded=cents(input.fee||0);gap=gross-row.amount_cents;verified=gap>=0&&gap===recorded&&fund.amount_cents===row.amount_cents&&journal.amount_cents===row.amount_cents&&journal.request_id===fund.request_id&&journal.payment_method==='Whish Money'&&journal.wallet_id===row.wallet_id&&journal.account_key===row.account_key&&(!input.targetWallet||input.targetWallet===row.wallet_id)&&(!input.receiverKey||input.receiverKey===row.account_key);}catch{}
     if(!verified){origin=null;warning(`Older reseller funding ${fund.request_id} has no exact verified custody/fee match; its existing balance is retained and no fee is restored.`);}else if(gap)tag={id:'fund:'+fund.request_id,origin,basisNet:row.amount_cents,basisFee:gap,fundRequestId:fund.request_id};
    }
   }
   add(b,{value:row.amount_cents,origin,tag,restored:false});
  }
 }
 const owners=new Set([...buckets.values()].map(b=>b.ownerKey).filter(k=>k!=='__unassigned__'));
 for(const key of owners){const actual=F.walletBalances(db,destinations,key,now.slice(0,10));for(const b of [...buckets.values()].filter(b=>b.ownerKey===key)){const value=b.lots.reduce((n,l)=>n+l.value,0)-b.deficit;if(value!==cents(actual.find(w=>w.id===b.walletId)?.balance||0))throw Error('Restoration provenance does not match the available employee wallet balance.');}}
 for(const wallet of F.walletBalances(db,destinations,null,now.slice(0,10))){const value=[...buckets.values()].filter(b=>b.walletId===wallet.id).reduce((n,b)=>n+b.lots.reduce((s,l)=>s+l.value,0)-b.deficit,0);if(value!==cents(wallet.balance))throw Error('Restoration provenance does not match the available total wallet balance.');}
 return {buckets:[...buckets.values()],warnings};
}
function plan(db,destinations,now,context={}){const result={policy:POLICY,asOf:now,destinations,context,items:[],deferred:[],warnings:[]};
 try{
  if(!/^\d{4}-\d{2}-\d{2}T/.test(String(now)))throw Error('The Main accounting timestamp is required.');
  if(now.slice(0,7)<=F.latestMonth(db))throw Error('Wallet restoration needs an open accounting month.');
  const pending=F.pendingActions(db);if(pending.length){result.deferred=pending.map(p=>({reason:'Unfinished portal or custody operation',...p}));result.token=hash(result);return result;}
  const state=replay(db,destinations,now,context);result.warnings=state.warnings;const tags=new Map();
  for(const b of state.buckets){if(b.deficit){result.warnings.push(`Negative wallet ${b.walletId} needs reconciliation; no fee is restored to a negative balance.`);continue;}for(const lot of b.lots.filter(l=>l.tag&&!l.restored&&l.tag.basisFee>0)){
   const user=q(db,'SELECT id,full_name FROM users WHERE account_key=?',[b.ownerKey])[0];if(!user){result.deferred.push({reason:'A remaining fee-reduced lot has no mapped current employee',walletId:b.walletId,ownerKey:b.ownerKey});continue;}
   if(!tags.has(lot.tag.id))tags.set(lot.tag.id,{tag:lot.tag,parts:[]});const record=tags.get(lot.tag.id),prior=record.parts.find(p=>p.walletId===b.walletId&&p.ownerKey===b.ownerKey);if(prior)prior.netCents+=lot.value;else record.parts.push({walletId:b.walletId,ownerKey:b.ownerKey,ownerName:user.full_name,netCents:lot.value});
  }}
  for(const {tag,parts}of tags.values()){
   const remaining=parts.reduce((n,p)=>n+p.netCents,0);if(remaining>tag.basisNet)throw Error('Surviving wallet principal exceeds its preserved fee basis.');
   const fee=ratio(remaining,tag.basisFee,tag.basisNet);let cumulative=0,allocated=0;parts.sort((a,b)=>a.walletId.localeCompare(b.walletId)||a.ownerKey.localeCompare(b.ownerKey));
   for(const part of parts){cumulative+=part.netCents;const next=ratio(cumulative,fee,remaining),restoredFeeCents=next-allocated;allocated=next;const destination=destinations.find(d=>d.id===part.walletId),snapshot=parse(tag.origin.source||'{}');
    result.items.push({...part,restoredFeeCents,grossCents:part.netCents+restoredFeeCents,tagId:tag.id,originKind:tag.origin.kind,originKey:tag.origin.key,sourceJson:tag.origin.source,basisNetCents:tag.basisNet,basisFeeCents:tag.basisFee,walletLabel:destination?.label||snapshot.label||snapshot.targetWalletLabel||'Historical wallet',walletNumber:destination?.number||snapshot.number||snapshot.targetWalletNumber||'',...(tag.fundRequestId?{fundRequestId:tag.fundRequestId}:{}),id:'whish-gross-'+hash([POLICY,tag.id,part.walletId,part.ownerKey]).slice(0,40)});
   }
  }
  result.items.sort((a,b)=>a.id.localeCompare(b.id));
 }catch(error){result.items=[];result.deferred.push({reason:error.message});}
 result.token=hash({policy:POLICY,asOf:now,items:result.items,deferred:result.deferred,warnings:result.warnings});return result;
}
function apply(db,prepared,now,backupPath){
 if(typeof backupPath!=='string'||!backupPath.trim())throw Error('A verified all-section backup is required before restoring gross wallet custody.');
 if(!prepared||prepared.policy!==POLICY||prepared.asOf!==now||!Array.isArray(prepared.items))throw Error('Review the current wallet restoration plan.');initialize(db);
 if(prepared.items.length&&prepared.items.every(item=>{const old=q(db,`SELECT * FROM ${TABLE} WHERE id=?`,[item.id])[0];return old&&old.tag_id===item.tagId&&old.wallet_id===item.walletId&&old.owner_key===item.ownerKey&&old.net_cents===item.netCents&&old.restored_fee_cents===item.restoredFeeCents;}))return prepared.items.map(item=>({...parse(q(db,`SELECT result_json FROM ${TABLE} WHERE id=?`,[item.id])[0].result_json),idempotent:true}));
 const fresh=plan(db,prepared.destinations||[],now,prepared.context||{});if(fresh.token!==prepared.token)throw Error('The wallet history changed. Review the gross-wallet restoration again.');
 const changes=[];db.exec('BEGIN');try{for(const item of prepared.items){
  const user=q(db,'SELECT id,full_name FROM users WHERE account_key=?',[item.ownerKey])[0];if(!user)throw Error('The restoration employee is unavailable.');
  const saved={id:item.id,policy:POLICY,tagId:item.tagId,kind:item.originKind,key:item.originKey,walletId:item.walletId,walletLabel:item.walletLabel,walletNumber:item.walletNumber,ownerKey:item.ownerKey,owner:user.full_name,amount:item.restoredFeeCents/100,remainingNet:item.netCents/100,restoredFee:item.restoredFeeCents/100,grossWalletPrincipal:item.grossCents/100,profitFeeUnchanged:true,noRevenue:true,noPortalAction:true,createdAt:now,receivedAt:now,backupPath,...item.fundRequestId?{fundRequestId:item.fundRequestId}:{}};
  db.run(`INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[item.id,POLICY,item.tagId,item.originKind,item.originKey,item.walletId,item.ownerKey,item.netCents,item.restoredFeeCents,item.basisNetCents,item.basisFeeCents,item.fundRequestId||'',now,backupPath,item.sourceJson||'{}',JSON.stringify(saved)]);
  db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[item.id+'-wallet',item.id,item.walletId,item.ownerKey,item.restoredFeeCents,now]);
  db.run('INSERT INTO finance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',[item.id,'whish_wallet_gross_restoration',now,now,'__system__',null,item.ownerKey,item.restoredFeeCents,'Restore surviving wallet fee custody; recorded profit fees unchanged.',JSON.stringify({policy:POLICY,tagId:item.tagId,originKind:item.originKind,originKey:item.originKey,walletId:item.walletId,ownerKey:item.ownerKey,netCents:item.netCents,restoredFeeCents:item.restoredFeeCents}),JSON.stringify(saved)]);changes.push(saved);
 }db.exec('COMMIT');return changes;}catch(error){db.exec('ROLLBACK');throw error;}
}
function listRestorations(db,start,end,key=null){if(!exists(db,TABLE))return [];return q(db,`SELECT * FROM active_whish_wallet_gross_audit WHERE substr(effective_at,1,10) BETWEEN ? AND ?${key?' AND owner_key=?':''} ORDER BY effective_at,id`,[start,end,...key?[key]:[]]).map(row=>parse(row.result_json));}
module.exports={POLICY,initialize,plan,apply,listRestorations};
