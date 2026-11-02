'use strict';
// Read-only links for a true monthly-payment Undo. The cohort replay restores
// only the old cents consumed by the verified original current-month debit.
// Ordinary receipts, refunds without this proof, and Bank returns stay new.
const crypto=require('node:crypto'),Finance=require('./finance-ledger.cjs'),Monthly=require('./fixed-monthly-payments.cjs'),{WORKSPACES}=require('./workspaces.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),q=Finance.query;
function fail(){throw Error('The original monthly payment Undo could not be verified for last month’s remaining money.');}
function parse(value){try{const result=JSON.parse(value);if(!result||typeof result!=='object'||Array.isArray(result))return fail();return result;}catch{return fail();}}
function pairs({entries,workspaceId,through,movements}={}){
 if(!(entries instanceof Map)||!WORKSPACES.some(row=>row.id===workspaceId)||!entries.get(workspaceId)?.db||typeof through!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(through)||!Number.isFinite(Date.parse(through+'T12:00:00Z'))||new Date(through+'T12:00:00Z').toISOString().slice(0,10)!==through||!Array.isArray(movements)||new Set(movements.map(row=>row?.id)).size!==movements.length)return fail();
 let verified;try{verified=Monthly.projectionRows({entries});}catch{return fail();}
 if(!verified||!Array.isArray(verified.payments)||!Array.isArray(verified.reversals)||!Array.isArray(verified.pending)||verified.pending.length)return fail();
 const db=entries.get(workspaceId).db,month=through.slice(0,7),end=through+'T23:59:59',links=[],used=new Set();
 function movement(source,eventId,at,amount,kind,note){
  const method=source.paymentMethod==='Cash'?'cash':source.paymentMethod==='Whish Money'?'whish':null,walletId=method==='cash'?'':source.sourceWalletId;
  if(!method||!Number.isSafeInteger(source.amountCents)||source.amountCents<=0||typeof source.sourceAccountKey!=='string'||!source.sourceAccountKey||!Number.isSafeInteger(source.sourceUserId)||source.sourceUserId<=0)return fail();
  const found=movements.filter(row=>row?.accountKey===source.sourceAccountKey&&row.method===method&&row.walletId===walletId&&row.amount===amount&&row.at===at&&row.raw&&
   (method==='cash'?row.id==='cash:'+row.raw.id&&row.raw.user_id===source.sourceUserId&&row.raw.transaction_type===kind&&row.raw.reference_type===(kind==='fixed_monthly_payment'?'fixed_monthly':'fixed_monthly_reversal')&&row.raw.reference_id===null&&row.raw.note===eventId+' · '+note:
    row.id==='wallet:'+eventId&&row.raw.id===eventId&&row.raw.event_id===eventId&&row.raw.account_key===source.sourceAccountKey&&row.raw.wallet_id===walletId&&row.raw.amount_cents===amount&&row.raw.effective_at===at));
  if(found.length!==1)return fail();return found[0];
 }
 for(const reversal of verified.reversals){
  if(reversal.state!=='completed'||reversal.effectiveAt?.slice(0,7)!==month||reversal.effectiveAt>end)continue;
  const original=verified.payments.find(row=>row.requestId===reversal.paymentRequestId);if(!original)return fail();
  // Undo of an earlier accounting period cannot replenish this opening pool.
  if(original.effectiveAt?.slice(0,7)!==month)continue;
  const originals=original.sources.filter(source=>source.sourceWorkspaceId===workspaceId),returns=reversal.sources.filter(source=>source.sourceWorkspaceId===workspaceId);
  if(!originals.length&&!returns.length)continue;if(originals.length!==1||returns.length!==1)return fail();
  const source=originals[0],returned=returns[0],fields=['sourceWorkspaceId','sourceAccountKey','sourceUserId','paymentMethod','sourceWalletId','amountCents'];if(fields.some(key=>source[key]!==returned[key]))return fail();
  const debitReference='fixed-monthly-payment-'+original.requestId,creditReference='fixed-monthly-reversal-'+reversal.requestId;
  const debitEvents=q(db,'SELECT * FROM finance_events WHERE id=?',[debitReference]),creditEvents=q(db,'SELECT * FROM finance_events WHERE id=?',[creditReference]);if(debitEvents.length!==1||creditEvents.length!==1)return fail();
  const debitPlan=parse(debitEvents[0].input_json),creditPlan=parse(creditEvents[0].input_json);
  if(debitPlan.requestId!==original.requestId||creditPlan.requestId!==reversal.requestId||creditPlan.paymentRequestId!==original.requestId||typeof debitPlan.input?.note!=='string'||typeof creditPlan.input?.reason!=='string')return fail();
  const debit=movement(source,debitReference,original.effectiveAt,-source.amountCents,'fixed_monthly_payment',debitPlan.input.note),credit=movement(returned,creditReference,reversal.effectiveAt,source.amountCents,'fixed_monthly_reversal',creditPlan.input.reason);
  if(debit.bucket!==credit.bucket||used.has(credit.id)||used.has(debit.id)||Date.parse(original.effectiveAt)>Date.parse(reversal.effectiveAt))return fail();used.add(debit.id);used.add(credit.id);
  links.push({id:'reversal:'+reversal.requestId,at:reversal.effectiveAt,debitId:debit.id,creditId:credit.id,proofHash:hash({original,reversal,debitEvent:debitEvents[0],creditEvent:creditEvents[0],debit:debit.raw,credit:credit.raw})});
 }
 // A current-month monthly-return movement must never silently become an
 // ordinary new credit if its saved immutable reversal ancestry is missing.
 for(const row of movements.filter(row=>row.amount>0&&(row.raw?.transaction_type==='fixed_monthly_reversal'||typeof row.raw?.id==='string'&&row.raw.id.startsWith('fixed-monthly-reversal-')))){
  if(used.has(row.id))continue;
  const eventId=row.method==='cash'?String(row.raw.note||'').split(' · ')[0]:row.raw.event_id,known=verified.reversals.find(value=>'fixed-monthly-reversal-'+value.requestId===eventId),original=known&&verified.payments.find(value=>value.requestId===known.paymentRequestId);
  if(!known||!original||original.effectiveAt.slice(0,7)===month)return fail();
 }
 return links;
}
module.exports={pairs};
