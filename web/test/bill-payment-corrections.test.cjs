'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {fixture,clock,username}=require('./helpers/bill-payment-corrections-fixture.cjs');
const {BillPaymentCorrections}=require('../app/bill-payment-corrections.cjs');
async function correction(f,billId,paymentKey,method,extra={}){const input={billId,paymentKey,method,...extra},preview=await f.client.good('billPayments:preview',[input]),write={...input,requestId:crypto.randomUUID(),token:preview.token,reason:'Fictional selected payment method entered incorrectly.'};return {input,preview,write,result:await f.client.good('billPayments:correct',[write])};}

test('HTTP selected direct payment Cash to Whish to Cash to Unpaid keeps the provider audit and exact original request',async t=>{
 clock(t);const f=await fixture(t),wallet=await f.client.good('whish:save',[{label:'Fictional Correction Wallet',number:'03000112',active:true}],'main'),original=f.input({paymentMethod:'Cash',renewOnCredit:undefined}),bill=await f.client.good('bills:savePortal',[original,true]);
 const providerActions=()=>f.portal.state.calls.filter(call=>call.method==='POST'&&call.body?.op&&call.body.op!=='renewcheck'),originalActions=JSON.stringify(providerActions()),renewal=f.read(db=>f.q(db,'SELECT * FROM internet_renewals WHERE bill_id=?',[bill.id])[0]),costs=f.read(db=>f.q(db,'SELECT * FROM internet_renewal_costs WHERE bill_id=?',[bill.id]));
 const options=await f.client.good('billPayments:options',[{billId:bill.id}]);assert.equal(options.payments.length,1);assert.equal(options.payments[0].paymentKey,'original');assert.equal(options.payments[0].canCorrect,true);
 const first=await correction(f,bill.id,'original','Whish Money',{whishDestinationId:wallet.id});assert.equal(first.result.bill.paymentMethod,'Whish Money');assert.equal(first.result.bill.renewal.state,'succeeded');assert.equal(first.preview.feeBefore,0);assert.equal(first.preview.feeAfter,0.2);assert.equal(f.counts().cash,0);
 let finance=await f.client.good('finance:overview',[{workspaceId:'fiber-users'}],'main');assert.equal(finance.wallets.find(w=>w.id===wallet.id).balance,20);assert.equal(finance.whishFees,0.2);
 assert.equal((await f.client.good('billPayments:correct',[first.write])).idempotent,true);assert.equal((await f.client.good('bills:savePortal',[original,true])).idempotent,true);
 await f.stop();await f.start();assert.equal((await f.client.good('billPayments:status',[{requestId:first.write.requestId}])).state,'completed');
 await correction(f,bill.id,'original','Cash');assert.equal(f.counts().cash,20);finance=await f.client.good('finance:overview',[{workspaceId:'fiber-users'}],'main');assert.equal(finance.wallets.find(w=>w.id===wallet.id).balance,0);assert.equal(finance.whishFees,0);
 const third=await correction(f,bill.id,'original','Unpaid');assert.equal(third.result.bill.paymentStatus,'unpaid');assert.equal(third.result.bill.remainingAmount,20);assert.equal(third.result.bill.renewal.state,'succeeded');assert.equal(third.result.bill.renewal.onCredit,undefined);assert.equal(f.counts().cash,0);
 assert.equal((await f.client.good('bills:savePortal',[original,true])).idempotent,true);
 const paid=await f.client.good('debts:settle',['bill',bill.id,'Cash',20,crypto.randomUUID()]);assert.equal(paid.remainingAmount,0);assert.equal(f.counts().cash,20);assert.equal(f.portal.state.cycles,1);
 assert.deepEqual(f.read(db=>f.q(db,'SELECT * FROM internet_renewals WHERE bill_id=?',[bill.id])[0]),renewal);assert.deepEqual(f.read(db=>f.q(db,'SELECT * FROM internet_renewal_costs WHERE bill_id=?',[bill.id])),costs);assert.equal(JSON.stringify(providerActions()),originalActions);
 const history=await f.client.good('billPayments:history',[{billId:bill.id}]);assert.equal(history.length,3);assert.doesNotMatch(JSON.stringify(history),/evidence_hash|backupPath|requestFingerprint/);
});

test('HTTP original Whish request remains replayable after wallet correction, deactivation and paid to Unpaid',async t=>{
 clock(t);const f=await fixture(t),first=await f.client.good('whish:save',[{label:'Fictional First Wallet',number:'03000113',active:true}],'main'),second=await f.client.good('whish:save',[{label:'Fictional Second Wallet',number:'03000114',active:true}],'main'),input=f.input({paymentMethod:'Whish Money',renewOnCredit:undefined,whishDestinationId:first.id}),bill=await f.client.good('bills:savePortal',[input,true]);
 await correction(f,bill.id,'original','Whish Money',{whishDestinationId:second.id});await f.client.good('whish:save',[{...first,active:false}],'main');assert.equal((await f.client.good('bills:savePortal',[input,true])).idempotent,true);
 await correction(f,bill.id,'original','Unpaid');await f.stop();await f.start();assert.equal((await f.client.good('bills:savePortal',[input,true])).idempotent,true);assert.equal((await f.bill(bill.id)).remainingAmount,20);assert.equal(f.portal.state.cycles,1);
 const result=await f.client.good('finance:overview',[{workspaceId:'fiber-users'}],'main');assert.equal(result.wallets.find(w=>w.id===first.id).balance,0);assert.equal(result.wallets.find(w=>w.id===second.id).balance,0);
});

test('HTTP one credit-bill collection correction preserves other mixed payments and original credit authorization across restart',async t=>{
 clock(t);const f=await fixture(t),wallet=await f.client.good('whish:save',[{label:'Fictional Mixed Wallet',number:'03000115',active:true}],'main'),bill=await f.client.good('bills:savePortal',[f.input(),true]),cashId=crypto.randomUUID(),whishId=crypto.randomUUID();
 await f.client.good('debts:settle',['bill',bill.id,'Cash',8,cashId]);await f.client.good('debts:settle',['bill',bill.id,'Whish Money',12,whishId,wallet.id]);
 const proof=f.read(db=>f.q(db,"SELECT note FROM internet_renewal_events WHERE bill_id=? AND state='unpaid_authorized'",[bill.id])[0].note),other=f.read(db=>f.q(db,'SELECT * FROM debt_payments WHERE id=?',[whishId])[0]);
 const converted=await correction(f,bill.id,cashId,'Whish Money',{whishDestinationId:wallet.id});assert.equal(converted.result.bill.whishPaid,20);assert.equal(converted.result.bill.remainingAmount,0);assert.equal(f.counts().cash,0);
 assert.equal((await f.client.good('debts:settle',['bill',bill.id,'Cash',8,cashId])).idempotent,true);
 const cancelled=await correction(f,bill.id,cashId,'Unpaid');assert.equal(cancelled.result.bill.remainingAmount,8);assert.equal(cancelled.result.bill.paidAmount,12);assert.equal(cancelled.result.bill.renewal.onCredit,true);assert.equal(cancelled.result.bill.renewal.state,'succeeded');
 await f.stop();await f.start();assert.equal((await f.client.good('debts:settle',['bill',bill.id,'Cash',8,cashId])).idempotent,true);assert.equal((await f.bill(bill.id)).remainingAmount,8);
 const duplicateWithChangedMethod=await f.client.call('debts:settle',['bill',bill.id,'Whish Money',8,cashId,wallet.id]);assert.equal(duplicateWithChangedMethod.status,400);
 await f.client.good('debts:settle',['bill',bill.id,'Cash',8,crypto.randomUUID()]);assert.equal((await f.bill(bill.id)).remainingAmount,0);assert.equal(f.counts().cash,8);assert.equal(f.portal.state.cycles,1);
 assert.deepEqual(f.read(db=>f.q(db,'SELECT * FROM debt_payments WHERE id=?',[whishId])[0]),other);assert.equal(f.read(db=>f.q(db,"SELECT note FROM internet_renewal_events WHERE bill_id=? AND state='unpaid_authorized'",[bill.id])[0].note),proof);assert.equal(f.read(db=>f.q(db,'SELECT payment_method FROM fibernetlb_bills WHERE id=?',[bill.id])[0].payment_method),'Unpaid');
});

test('HTTP correction failed save holds other work, exact status durably recovers once, and old audit rows cannot be changed',async t=>{
 clock(t);const f=await fixture(t),bill=await f.client.good('bills:savePortal',[f.input({paymentMethod:'Cash',renewOnCredit:undefined}),true]),input={billId:bill.id,paymentKey:'original',method:'Unpaid'},preview=await f.client.good('billPayments:preview',[input]),write={...input,token:preview.token,requestId:crypto.randomUUID(),reason:'Fictional persistent save failure test.'};
 const saved=BillPaymentCorrections.prototype.saved;BillPaymentCorrections.prototype.saved=function(id){if(this.dirtyRequest===id)throw Error('Fictional correction save interrupted.');return saved.call(this,id);};
 try{const failed=await f.client.call('billPayments:correct',[write]);assert.equal(failed.status,400);assert.match(failed.error,/save interrupted/);const blocked=await f.client.call('bills:savePortal',[f.input(),true]);assert.equal(blocked.status,400);assert.match(blocked.error,/awaiting a safe database save/);}finally{BillPaymentCorrections.prototype.saved=saved;}
 const recovered=await f.client.good('billPayments:status',[{requestId:write.requestId}]);assert.equal(recovered.bill.remainingAmount,20);assert.equal(f.counts().cash,0);assert.equal((await f.client.good('billPayments:correct',[write])).idempotent,true);
 await f.stop();f.seed(db=>{assert.throws(()=>db.run("UPDATE bill_payment_corrections SET actor_key='forged'"),/immutable/);assert.throws(()=>db.run('DELETE FROM bill_payment_corrections'),/immutable/);});await f.start();assert.equal((await f.client.good('billPayments:status',[{requestId:write.requestId}])).bill.remainingAmount,20);assert.equal(f.read(db=>f.q(db,'SELECT COUNT(*) AS n FROM bill_payment_corrections')[0].n),1);
});

test('HTTP completed combined payment corrections retain the frozen parent method, cost and original replay proof',async t=>{
 clock(t);const f=await fixture(t),wallet=await f.client.good('whish:save',[{label:'Fictional Combined Wallet',number:'03000116',active:true}],'main'),quote=await f.client.good('bills:quoteChangeRenew',[{username,expectedId:11,targetId:22,renewalMonths:1}]),start={requestId:crypto.randomUUID(),quoteId:quote.quoteId,username,expectedId:11,targetId:22,renewalMonths:1,changeCustomerAmount:quote.changeCustomerAmount,confirm:true},ready=await f.client.good('bills:startChangeRenew',[start]),payment={requestId:ready.requestId,token:ready.token,amount:ready.totalToCollect,paymentMethod:'Cash',billingPeriod:'2026-11',reference:'Fictional combined correction original receipt',confirm:true},done=await f.client.good('bills:confirmChangeRenew',[payment]);
 assert.equal(done.phase,'completed');const before=f.read(db=>f.q(db,'SELECT * FROM portal_operations WHERE request_id=?',[ready.requestId])[0]);
 await correction(f,done.bill.id,'original','Whish Money',{whishDestinationId:wallet.id});const status=await f.client.good('bills:changeRenewStatus',[{requestId:ready.requestId}]);assert.equal(status.phase,'completed');assert.equal(status.bill.paymentMethod,'Whish Money');assert.equal(status.bill.bundleCost,20);
 assert.equal((await f.client.good('bills:confirmChangeRenew',[payment])).bill.id,done.bill.id);
 await correction(f,done.bill.id,'original','Unpaid');await f.stop();await f.start();const current=await f.client.good('bills:changeRenewStatus',[{requestId:ready.requestId}]);assert.equal(current.phase,'completed');assert.equal(current.bill.remainingAmount,done.bill.amount);assert.equal(current.bill.renewal.state,'succeeded');
 assert.deepEqual(f.read(db=>f.q(db,'SELECT * FROM portal_operations WHERE request_id=?',[ready.requestId])[0]),before);assert.equal(f.portal.state.calls.filter(row=>row.body?.op==='changeservice').length,1);assert.equal(f.portal.state.cycles,1);
});

module.exports={correction};
