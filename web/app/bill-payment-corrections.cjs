'use strict';
// Explicit local bookkeeping corrections. No provider object or network API.
const crypto=require('node:crypto'),Finance=require('./finance-ledger.cjs'),Whish=require('./whish-destinations.cjs');
const q=Finance.query,TABLE='bill_payment_corrections';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function has(db,name){return q(db,"SELECT name FROM sqlite_master WHERE name=?",[name]).length>0;}
function cents(value){if(typeof value!=='number'||!Number.isFinite(value))throw Error('The original payment amount is invalid.');const n=Math.round(value*100);if(!Number.isSafeInteger(n)||Math.abs(value*100-n)>1e-6)throw Error('The original payment amount is invalid.');return n;}
function object(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw Error('Choose valid payment correction details.');}
function billId(value){if(!Number.isSafeInteger(value)||value<=0)throw Error('Choose a saved bill.');return value;}
function requestId(value){if(typeof value!=='string'||!/^[A-Za-z0-9-]{8,100}$/.test(value))throw Error('Choose a valid payment correction request.');return value;}
function assertOpen(db,date){if(String(date).slice(0,7)<=Finance.latestMonth(db))throw Error('This payment belongs to a closed monthly ledger and cannot be corrected.');}
function parsed(row){let value;try{value=JSON.parse(row.evidence_json);}catch{throw Error('The payment correction audit could not be verified.');}if(!value||value.version!==1||hash(value)!==row.evidence_hash||value.input.requestId!==row.request_id||value.bill.id!==row.bill_id||value.input.paymentKey!==row.payment_key)throw Error('The payment correction audit could not be verified.');return value;}
function records(db,id,key){if(!has(db,TABLE))return [];return q(db,`SELECT * FROM ${TABLE} WHERE bill_id=?${key===undefined?'':' AND payment_key=?'} ORDER BY rowid`,key===undefined?[id]:[id,key]).map(row=>({row,evidence:parsed(row)}));}
function stableBill(row){const {payment_method,payment_status,settled_at,bundle_cost,portal_cost_source,portal_internal_cost,...rest}=row;return rest;}
function billPaymentEvidence(value){return {...value,source:{...stableBill(value.source),payment_method:value.source.payment_method}};}
function verifyCashEvidence(db,values){for(const value of values)if(value.before.cash){const current=q(db,'SELECT * FROM cash_drawer_transactions WHERE id=?',[value.before.cash.id])[0];if(hash(current||null)!==hash({...value.before.cash,amount:0}))throw Error('The cancelled Cash receipt no longer matches its correction audit.');}const latest=values.at(-1)?.after.cash;if(latest&&hash(q(db,'SELECT * FROM cash_drawer_transactions WHERE id=?',[latest.id])[0]||null)!==hash(latest))throw Error('The corrected Cash receipt no longer matches its payment proof.');}
function originalBill(db,id){const entries=records(db,id,'original');if(!entries.length)return null;const current=q(db,'SELECT * FROM fibernetlb_bills WHERE id=?',[id])[0],first=entries[0].evidence,last=entries.at(-1).evidence;
 if(!current||hash(stableBill(current))!==hash(stableBill(first.bill))||current.payment_method!==last.after.source.payment_method||JSON.stringify(Whish.readSnapshot(db,'bill',id))!==JSON.stringify(last.after.snapshot))throw Error('The corrected bill no longer matches its preserved payment proof.');
 for(let index=1;index<entries.length;index++)if(hash(billPaymentEvidence(entries[index].evidence.before))!==hash(billPaymentEvidence(entries[index-1].evidence.after)))throw Error('The payment correction audit chain is invalid.');
 verifyCashEvidence(db,entries.map(entry=>entry.evidence));
 return {bill:{...current,payment_method:first.before.source.payment_method},snapshot:clone(first.before.snapshot)};
}
function originalCollection(db,id){if(!has(db,TABLE))return null;const rows=q(db,`SELECT * FROM ${TABLE} WHERE payment_key=? ORDER BY rowid`,[id]);if(!rows.length)return null;const values=rows.map(parsed),first=values[0],last=values.at(-1),current=q(db,'SELECT * FROM debt_payments WHERE id=?',[id])[0]||null;
 if(first.before.source?.id!==id||values.some(v=>v.bill.id!==first.bill.id)||hash(current)!==hash(last.after.source)||JSON.stringify(Whish.readSnapshot(db,'debt',id))!==JSON.stringify(last.after.snapshot))throw Error('The corrected collection no longer matches its preserved payment proof.');
 for(let index=1;index<values.length;index++)if(hash(values[index].before)!==hash(values[index-1].after))throw Error('The payment correction audit chain is invalid.');
 verifyCashEvidence(db,values);
 return {payment:clone(first.before.source),snapshot:clone(first.before.snapshot),cancelled:current===null};
}
function needsMigration(db){return !has(db,TABLE)||!has(db,TABLE+'_update')||!has(db,TABLE+'_delete');}
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(request_id TEXT PRIMARY KEY,bill_id INTEGER NOT NULL,payment_key TEXT NOT NULL,actor_key TEXT NOT NULL,created_at TEXT NOT NULL,evidence_json TEXT NOT NULL,evidence_hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS bill_payment_corrections_bill ON ${TABLE}(bill_id,payment_key);
 CREATE TRIGGER IF NOT EXISTS ${TABLE}_update BEFORE UPDATE ON ${TABLE} BEGIN SELECT RAISE(ABORT,'Payment correction audits are immutable.');END;
 CREATE TRIGGER IF NOT EXISTS ${TABLE}_delete BEFORE DELETE ON ${TABLE} BEGIN SELECT RAISE(ABORT,'Payment correction audits are immutable.');END;`);}
class BillPaymentCorrections{
 constructor({db,authorize,readBill,readDetail,destinations,now,save,backup,ready=()=>{}}){Object.assign(this,{db,authorize,readBill,readDetail,destinations,now,save,backup,ready});}
 ctx(){return this.authorize();}
 assertIdle(id){if(this.dirtyRequest&&this.dirtyRequest!==id)throw Error('A payment correction is awaiting a safe database save. Check its original request before further financial work.');}
 saved(id){this.assertIdle(id);this.save();if(this.dirtyRequest===id)this.dirtyRequest=null;}
 raw(id){billId(id);this.readBill(id);const bill=q(this.db,'SELECT * FROM active_fibernetlb_bills WHERE id=?',[id])[0];if(!bill)throw Error('Bill payment was not found.');return bill;}
 input(value,write=false){object(value,['billId','paymentKey','method','whishDestinationId',...write?['requestId','token','reason']:[]],['billId','paymentKey','method',...write?['requestId','token','reason']:[]]);billId(value.billId);if(typeof value.paymentKey!=='string'||!value.paymentKey||value.paymentKey.length>100||!['Cash','Whish Money','Unpaid'].includes(value.method))throw Error('Choose one actual payment and its corrected method.');if(value.method!=='Whish Money'&&value.whishDestinationId!==undefined)throw Error('A wallet applies only to Whish Money.');const input={billId:value.billId,paymentKey:value.paymentKey,method:value.method,...value.method==='Whish Money'?{whishDestinationId:String(value.whishDestinationId||'')}:{}};if(write){requestId(value.requestId);if(typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token))throw Error('Review the payment correction first.');if(typeof value.reason!=='string'||value.reason.trim().length<5||value.reason.trim().length>500)throw Error('Enter a correction reason (5–500 characters).');Object.assign(input,{requestId:value.requestId,token:value.token,reason:value.reason.trim()});}return input;}
 source(bill,key){
  if(!['Internet','Internet plan change','Satellite','Internet + Satellite'].includes(bill.service_type))throw Error('This receipt belongs to a linked transfer or another payment workflow.');
  const payments=q(this.db,"SELECT * FROM debt_payments WHERE kind='bill' AND record_id=? ORDER BY received_at,rowid",[bill.id]);
  let source,kind,at,amount,ownerRow;
  if(key==='original'){
   if(!['Cash','Whish Money'].includes(bill.payment_method)||bill.payment_status==='unpaid'||payments.length)throw Error('Select an actual debt collection; the original bill did not receive this payment.');
   source=bill;kind='bill';at=bill.paid_at;amount=cents(bill.amount);ownerRow=q(this.db,"SELECT * FROM finance_receipt_owners WHERE kind='bill' AND record_key=?",[String(bill.id)])[0];originalBill(this.db,bill.id);
  }else{
   source=payments.find(row=>row.id===key);if(!source)throw Error('The selected debt payment was not found or was already cancelled.');kind='debt';at=source.received_at;amount=source.amount_cents;ownerRow=q(this.db,'SELECT * FROM finance_collection_owners WHERE id=?',[key])[0];originalCollection(this.db,key);
   if(bill.payment_method!=='Unpaid')throw Error('This historical bill has ambiguous original and collected payments. Review its original payment evidence.');
  }
  if(!Number.isSafeInteger(amount)||amount<=0)throw Error('This bill has no positive customer payment to correct.');
  if(!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at)||!Number.isFinite(Date.parse(at)))throw Error('The original payment date is invalid.');
  assertOpen(this.db,at);assertOpen(this.db,this.now());
  const user=q(this.db,'SELECT * FROM users WHERE id=?',[source.user_id])[0];if(!user?.account_key)throw Error('The original payment owner could not be verified.');
  if(ownerRow&&ownerRow.owner_key!==user.account_key)throw Error('This payment was handed over to another employee. Its linked transfer must be reconciled before correcting the original receipt.');
  const actor=this.ctx();if(actor.role!=='admin'&&actor.account_key!==user.account_key)throw Error('You can correct only your own actual payments.');
  const method=source.payment_method;if(!['Cash','Whish Money'].includes(method))throw Error('The selected record is not an actual received payment.');
  const snapshot=Whish.readSnapshot(this.db,kind,kind==='bill'?bill.id:key);
  for(const table of ['finance_receipt_fee_policy_audit','finance_whish_gross_restorations'])if(has(this.db,table)&&q(this.db,`SELECT id FROM ${table} WHERE origin_kind=? AND origin_key=?`,[kind,String(kind==='bill'?bill.id:key)]).length)throw Error('This older Whish payment has linked fee or wallet-restoration audits. Review those linked adjustments before correction.');
  if(method==='Whish Money'&&(!snapshot||typeof snapshot.id!=='string'||cents(snapshot.gross)!==amount||cents(snapshot.walletAmount)!==amount||cents(snapshot.fee)!==Math.round(amount/100)||snapshot.feePolicy!=='profit_only'||snapshot.walletPolicy!=='gross'))throw Error('The original Whish gross amount, fee and wallet proof could not be verified.');
  if(method==='Cash'&&snapshot)throw Error('A Cash payment has an unexplained wallet snapshot.');
  let cash=null;if(method==='Cash'){
   const matches=q(this.db,"SELECT * FROM active_cash_drawer_transactions WHERE reference_type='bill' AND reference_id=? AND transaction_type=? AND created_at=? AND user_id=? AND abs(amount-?)<0.000001",[bill.id,kind==='bill'?'bill_payment':'debt_settlement',at,user.id,amount/100]);
   if(matches.length!==1)throw Error('The exact original Cash receipt could not be identified uniquely. Review its cash ledger before correction.');cash=matches[0];
  }
  const available=method==='Cash'?Finance.drawerBalance(this.db,user.id):Finance.walletBalances(this.db,this.destinations(),user.account_key).find(w=>w.id===snapshot.id)?.balance||0;
  if(cents(available)<amount)throw Error('The original employee drawer or Whish wallet no longer holds the full selected payment. Restore its funds before correcting it.');
  return {source,kind,at,amount,user,snapshot,cash,payments,available,ownerRow:ownerRow||null};
 }
 pending(bill){this.ready();const customer=bill.customer_account;if(q(this.db,"SELECT bill_id FROM internet_renewals WHERE username=? AND state IN ('checking','processing','unknown')",[customer]).length||q(this.db,"SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[customer]).length||q(this.db,"SELECT request_id FROM portal_operations WHERE entity=? AND state IN ('checking','processing','unknown','confirmed')",['customer:'+customer]).length)throw Error('Review this customer’s unfinished provider action before correcting a payment.');}
 publicSource(bill,key){try{this.pending(bill);const s=this.source(bill,key);return {paymentKey:key,amount:s.amount/100,method:s.source.payment_method,receivedAt:s.at,ownerName:s.user.full_name,canCorrect:true,blockedReason:''};}catch(error){const p=key==='original'?bill:q(this.db,'SELECT * FROM debt_payments WHERE id=?',[key])[0];return {paymentKey:key,amount:key==='original'?bill.amount:p?.amount_cents/100,method:p?.payment_method,receivedAt:key==='original'?bill.paid_at:p?.received_at,ownerName:q(this.db,'SELECT full_name FROM users WHERE id=?',[p?.user_id])[0]?.full_name||'',canCorrect:false,blockedReason:error.message};}}
 options(value){object(value,['billId']);this.ctx();const bill=this.raw(value.billId),detail=this.readDetail(bill.id),payments=[];if(['Cash','Whish Money'].includes(bill.payment_method)&&cents(bill.amount)>0)payments.push(this.publicSource(bill,'original'));for(const p of q(this.db,"SELECT id FROM debt_payments WHERE kind='bill' AND record_id=? ORDER BY received_at,rowid",[bill.id]))payments.push(this.publicSource(bill,p.id));return {billId:bill.id,receiptNo:bill.receipt_no,paidAmount:detail.paidAmount,remainingAmount:detail.remainingAmount,payments,history:this.history(value)};}
 preview(value){const input=this.input(value),actor=this.ctx(),bill=this.raw(input.billId);this.pending(bill);const s=this.source(bill,input.paymentKey),detail=this.readDetail(bill.id),destination=input.method==='Whish Money'?this.destinations().find(w=>w.id===input.whishDestinationId&&w.active):null;if(input.method==='Whish Money'&&!destination)throw Error('Select an active Whish Money destination.');if(input.method===s.source.payment_method&&(input.method!=='Whish Money'||destination.id===s.snapshot.id))throw Error('Choose a different payment method or Whish wallet.');const snapshot=destination?{id:destination.id,label:destination.label,number:destination.number,...Whish.receiptAmounts(s.amount/100)}:null;
  const proof={input,actorKey:actor.account_key,bill,payments:s.payments,source:s.source,snapshot:s.snapshot,cash:s.cash,user:{id:s.user.id,key:s.user.account_key,name:s.user.full_name,active:s.user.active},owner:s.ownerRow,available:s.available,closed:Finance.latestMonth(this.db),destination:snapshot,nowDate:this.now().slice(0,10)};
  return {billId:bill.id,paymentKey:input.paymentKey,method:input.method,oldMethod:s.source.payment_method,amount:s.amount/100,receivedAt:s.at,ownerName:s.user.full_name,feeBefore:s.snapshot?.fee||0,feeAfter:snapshot?.fee||0,debtBefore:detail.remainingAmount,debtAfter:(cents(detail.remainingAmount)+(input.method==='Unpaid'?s.amount:0))/100,whishDestination:snapshot,token:hash(proof)};
 }
 read(id){const row=q(this.db,`SELECT * FROM ${TABLE} WHERE request_id=?`,[id])[0];return row?{row,evidence:parsed(row)}:null;}
 summary(e){return {requestId:e.input.requestId,billId:e.bill.id,paymentKey:e.input.paymentKey,oldMethod:e.before.source.payment_method,method:e.input.method,amount:e.amount/100,feeBefore:e.before.snapshot?.fee||0,feeAfter:e.after.snapshot?.fee||0,ownerName:e.ownerName,actorName:e.actorName,reason:e.input.reason,recordedAt:e.createdAt,receivedAt:e.at,debtBefore:e.debtBefore,debtAfter:e.debtAfter};}
 result(e){return {requestId:e.input.requestId,state:'completed',correction:this.summary(e),bill:this.readBill(e.bill.id)};}
 correct(value){const input=this.input(value,true),actor=this.ctx();this.assertIdle(input.requestId);const prior=this.read(input.requestId);if(prior){this.raw(prior.row.bill_id);if(prior.row.actor_key!==actor.account_key||JSON.stringify(prior.evidence.input)!==JSON.stringify(input))throw Error('This correction request already contains different details.');this.saved(input.requestId);return {...this.result(prior.evidence),idempotent:true};}
  const base={billId:input.billId,paymentKey:input.paymentKey,method:input.method,...input.method==='Whish Money'?{whishDestinationId:input.whishDestinationId}:{}},review=this.preview(base);if(review.token!==input.token)throw Error('The payment, debt, wallet or custody changed. Review a fresh correction.');const backupPath=this.backup();this.ctx();if(this.preview(base).token!==input.token)throw Error('The payment or access changed during backup. Review a fresh correction.');const bill=this.raw(input.billId),s=this.source(bill,input.paymentKey),createdAt=this.now(),before={source:clone(s.source),snapshot:clone(s.snapshot),cash:clone(s.cash)};
  this.db.exec('BEGIN');try{
   if(s.cash)this.db.run('UPDATE cash_drawer_transactions SET amount=0 WHERE id=?',[s.cash.id]);
   this.db.run('DELETE FROM payment_destinations WHERE kind=? AND record_key=?',[s.kind,String(s.kind==='bill'?bill.id:input.paymentKey)]);
   if(input.method==='Whish Money')this.db.run('INSERT INTO payment_destinations VALUES(?,?,?)',[s.kind,String(s.kind==='bill'?bill.id:input.paymentKey),JSON.stringify(review.whishDestination)]);
   let cash=null;if(input.method==='Cash'){
    this.db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,reference_id,note,created_at,user_id,user_name) VALUES(?,?,'bill',?,?,?,?,?)",[s.amount/100,s.kind==='bill'?'bill_payment':'debt_settlement',bill.id,`${bill.receipt_no} · payment correction ${input.requestId}`,s.at,s.user.id,s.user.full_name]);cash=q(this.db,'SELECT * FROM cash_drawer_transactions WHERE id=last_insert_rowid()')[0];
   }
   if(s.kind==='bill')this.db.run('UPDATE fibernetlb_bills SET payment_method=?,payment_status=?,settled_at=NULL WHERE id=?',[input.method,input.method==='Unpaid'?'unpaid':'paid',bill.id]);
   else if(input.method==='Unpaid')this.db.run('DELETE FROM debt_payments WHERE id=?',[input.paymentKey]);
   else this.db.run('UPDATE debt_payments SET payment_method=? WHERE id=?',[input.method,input.paymentKey]);
   const payments=q(this.db,"SELECT * FROM debt_payments WHERE kind='bill' AND record_id=? ORDER BY received_at,rowid",[bill.id]);if(s.kind==='debt'){
    const paid=payments.reduce((n,p)=>n+p.amount_cents,0),total=cents(bill.amount);if(paid>total)throw Error('The corrected collections exceed the original bill.');this.db.run('UPDATE fibernetlb_bills SET payment_status=?,settled_at=? WHERE id=?',[paid<total?'unpaid':'paid',paid<total?null:payments.at(-1)?.received_at||null,bill.id]);
   }
   const source=s.kind==='bill'?q(this.db,'SELECT * FROM fibernetlb_bills WHERE id=?',[bill.id])[0]:q(this.db,'SELECT * FROM debt_payments WHERE id=?',[input.paymentKey])[0]||null;
   const evidence={version:1,input,bill,amount:s.amount,at:s.at,ownerName:s.user.full_name,actorName:actor.full_name,createdAt,backupPath,debtBefore:review.debtBefore,debtAfter:review.debtAfter,before,after:{source,snapshot:review.whishDestination,cash}};
   this.db.run(`INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?,?)`,[input.requestId,bill.id,input.paymentKey,actor.account_key,createdAt,JSON.stringify(evidence),hash(evidence)]);this.db.exec('COMMIT');this.dirtyRequest=input.requestId;this.saved(input.requestId);return this.result(evidence);
  }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
 }
 status(value){object(value,['requestId']);requestId(value.requestId);const actor=this.ctx();this.assertIdle(value.requestId);const saved=this.read(value.requestId);if(!saved)return null;this.raw(saved.row.bill_id);if(actor.role!=='admin'&&saved.row.actor_key!==actor.account_key)throw Error('You can view only your own payment corrections.');this.saved(value.requestId);return this.result(saved.evidence);}
 history(value){object(value,['billId']);this.ctx();this.raw(value.billId);return records(this.db,value.billId).map(v=>this.summary(v.evidence)).reverse();}
}
module.exports={TABLE,initialize,needsMigration,originalBill,originalCollection,BillPaymentCorrections};
