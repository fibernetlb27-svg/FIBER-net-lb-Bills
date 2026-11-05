'use strict';
// One durable parent owns the native change, one customer payment and every
// renewal cycle. Its rows use the existing portal operation audit tables.
const crypto=require('node:crypto');
const {customerChangePolicy}=require('./change-service-customer-pricing.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000||Math.abs(value*100-Math.round(value*100))>0.00001)throw Error('Enter a valid amount with at most two decimal places.');return Math.round(value*100);};
const amount=value=>cents(value)/100;
const fail=message=>{throw Error(message);};
function object(value,allowed,required=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('Choose valid combined service-change details.');return value;}
function requestId(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,90}$/.test(value))fail('Choose a valid combined request ID.');return value;}
function rows(db,sql,params=[]){const s=db.prepare(sql);try{s.bind(params);const result=[];while(s.step())result.push(s.getAsObject());return result;}finally{s.free();}}
const one=(db,sql,params=[])=>rows(db,sql,params)[0]||null;
const moneyEqual=(a,b)=>cents(a)===cents(b);
const customerIdentity=c=>({username:c.username,serviceId:c.serviceId,resellerId:c.resellerId,expiry:c.expiry,blocked:c.blocked===true});
const publicPolicy=policy=>({...Number.isSafeInteger(policy?.policyVersion)?{policyVersion:policy.policyVersion}:{},...typeof policy?.calendarWindow==='boolean'?{calendarWindow:policy.calendarWindow}:{},...typeof policy?.coverageReason==='string'?{coverageReason:policy.coverageReason}:{}});

class CombinedChangeRenew{
  constructor({db,ledger,api,authorize,actor,save,now=()=>new Date(),priceChange,targetRetail,renewalReview,normalizePayment,createBill,readBill,renewBill,assertReady,canInspect=()=>false}){
    Object.assign(this,{db,ledger,api,authorize,actor,save,now,priceChange,targetRetail,renewalReview,normalizePayment,createBill,readBill,renewBill,assertReady,canInspect});this.quotes=new Map();this.running=new Map();
  }
  time(){const date=new Date(this.now());if(!Number.isFinite(date.getTime()))fail('The server billing clock is unavailable.');return date;}
  at(){return this.time().toISOString();}
  serial(id,task){id=requestId(id);const previous=this.running.get(id)||Promise.resolve(),running=previous.catch(()=>{}).then(task);this.running.set(id,running);return running.finally(()=>{if(this.running.get(id)===running)this.running.delete(id);});}
  start(value){return this.serial(value?.requestId,()=>this.startLocked(value));}
  confirm(value){return this.serial(value?.requestId,()=>this.confirmLocked(value));}
  resume(value){return this.serial(value?.requestId,()=>this.resumeLocked(value));}
  resolve(value){return this.serial(value?.requestId,()=>this.resolveLocked(value));}
  read(id){
    const row=this.ledger.get(requestId(id));if(!row||row.kind!=='change_renew')fail('Combined service-change request not found.');
    let input,quote,result;try{input=JSON.parse(row.input_json);quote=JSON.parse(row.quote_json);result=JSON.parse(row.result_json);}catch{fail('The saved combined request could not be verified.');}
    if(input.version!==1||row.entity!==`customer:${input.username}`||row.fingerprint!==hash(input)||input.quoteHash!==hash(quote)||quote.username!==input.username||quote.targetId!==input.targetId||quote.expectedId!==input.expectedId||!Number.isSafeInteger(input.renewalMonths)||input.renewalMonths<1||input.renewalMonths>12||!moneyEqual(input.changeCustomerAmount,quote.changeCustomerAmount)||!moneyEqual(input.renewalCustomerAmount,quote.targetRetail.renewalCustomerAmount)||quote.changePolicy.policyDate!==input.policyDate||quote.changePolicy.zeroChargeWindow&&input.changeCustomerAmount!==0)fail('The saved combined request proof does not match.');
    amount(quote.total);amount(input.changeCustomerAmount);if(cents(input.changeCustomerAmount)+cents(input.renewalCustomerAmount)<=0)fail('This request needs a separate refund and renewal.');
    if(['confirmed','succeeded'].includes(row.state))this.confirmed({row,input,quote,result});
    if(result.payment)this.paymentProof({row,input,quote,result});
    return {row,input,quote,result};
  }
  confirmed(p){const customer=p.result.customer;if(!customer||customer.username!==p.input.username||customer.serviceId!==p.input.targetId||customer.resellerId!==(p.quote.resellerId??undefined))fail('The confirmed native service-change proof is unavailable.');}
  put(p,result,message,state=p.row.state){this.ledger.finish(p.row.request_id,state,message,this.actor().name,result);return this.read(p.row.request_id);}
  async quote(value){
    this.authorize();object(value,['username','expectedId','targetId','reseller','renewalMonths'],['username','expectedId','targetId','renewalMonths']);
    const months=Number(value.renewalMonths);if(!Number.isSafeInteger(months)||months<1||months>12)fail('Choose 1–12 renewal months.');
    const quote=await this.api.quoteChange(value),pricing=await this.priceChange(quote),retail=await this.targetRetail(quote,months);this.authorize();
    if(!retail||cents(retail.renewalCustomerAmount)<=0)fail('Verify the target service selling price before changing it.');
    const id=crypto.randomUUID(),until=this.time().getTime()+120000,change=pricing.available?amount(pricing.suggestedAmount):null;
    for(const [key,item]of this.quotes)if(item.until<this.time().getTime())this.quotes.delete(key);
    if(this.quotes.size>=200)this.quotes.delete(this.quotes.keys().next().value);
    this.quotes.set(id,{quote,pricing,retail,months,actorKey:this.actor().key,until});
    return {phase:'review_change',quoteId:id,validUntil:new Date(until).toISOString(),username:quote.username,customerName:quote.customerName,beforeName:quote.beforeName,targetName:quote.targetName,expectedId:quote.expectedId,targetId:quote.targetId,renewalMonths:months,changeCustomerAmount:change,changeAmountRequired:change===null,renewalCustomerAmount:retail.renewalCustomerAmount,totalToCollect:change===null?null:amount(change+retail.renewalCustomerAmount),policyDate:pricing.policyDate,policyDay:pricing.policyDay,policyTimezone:pricing.policyTimezone,zeroChargeWindow:pricing.zeroChargeWindow,...publicPolicy(pricing),...this.canInspect()?{changeCost:quote.total}:{}};
  }
  async startLocked(value){
    this.authorize();object(value,['requestId','quoteId','username','expectedId','targetId','renewalMonths','changeCustomerAmount','confirm'],['requestId','quoteId','username','expectedId','targetId','renewalMonths','changeCustomerAmount','confirm']);const id=requestId(value.requestId);
    const previous=this.ledger.get(id);if(previous){if(previous.kind!=='change_renew')fail('This request ID belongs to a different operation.');const p=this.read(id);if(value.username!==p.input.username||Number(value.expectedId)!==p.input.expectedId||Number(value.targetId)!==p.input.targetId||Number(value.renewalMonths)!==p.input.renewalMonths||!moneyEqual(Number(value.changeCustomerAmount),p.input.changeCustomerAmount))fail('This combined request already has different details.');return this.dto(p);}
    const saved=this.quotes.get(String(value.quoteId));if(!saved||saved.until<this.time().getTime()||saved.actorKey!==this.actor().key)fail('The change review expired. Calculate again; no service change was submitted.');
    if(value.confirm!==true||value.username!==saved.quote.username||Number(value.expectedId)!==saved.quote.expectedId||Number(value.targetId)!==saved.quote.targetId||Number(value.renewalMonths)!==saved.months)fail('Confirm the exact customer, target service and renewal duration.');
    const charge=amount(Number(value.changeCustomerAmount));if(saved.pricing.zeroChargeWindow&&charge!==0||saved.pricing.available&&!moneyEqual(charge,saved.pricing.suggestedAmount))fail('The customer change charge does not match the reviewed billing policy.');
    if(cents(charge)+cents(saved.retail.renewalCustomerAmount)<=0)fail('The combined total must be positive. Use the separate Change Plan refund and renewal flows.');
    this.policyDate(saved.pricing.policyDate);const freshPrice=await this.priceChange(saved.quote);await this.targetRetail(saved.quote,saved.months,saved.retail);this.authorize();this.policyDate(saved.pricing.policyDate);
    if(JSON.stringify(freshPrice)!==JSON.stringify(saved.pricing))fail('The customer change calculation changed. Review it again; no service change was submitted.');this.assertReady(saved.quote.username);
    if(one(this.db,'SELECT bill_id FROM bill_requests WHERE request_id=?',[id+'-bill']))fail('The combined payment request ID was already used. Start a new reviewed request; no service change was submitted.');
    const quote={...saved.quote,changePolicy:clone(saved.pricing),changeCustomerAmount:charge,targetRetail:clone(saved.retail)},input={version:1,username:quote.username,expectedId:quote.expectedId,targetId:quote.targetId,renewalMonths:saved.months,changeCustomerAmount:charge,renewalCustomerAmount:saved.retail.renewalCustomerAmount,policyDate:saved.pricing.policyDate,quoteHash:hash(quote)};
    try{await this.ledger.apply(id,'change_renew',`customer:${input.username}`,input,quote,this.actor().name,async before=>{
      await this.api.applyQuotedChange(quote,()=>{this.authorize();this.policyDate(input.policyDate);this.assertReady(input.username,id);before({phase:'change_submitted'});});
      const customer=await this.api.customer(input.username);
      if(customer.serviceId!==input.targetId||customer.resellerId!==(quote.resellerId??undefined))fail('The target service and reseller must be verified before proceeding.');
      return {phase:'change_confirmed',customer};
    });}catch(error){const row=this.ledger.get(id);if(row?.kind==='change_renew'&&row.state==='unknown')return this.dto(this.read(id));throw error;}
    return this.prepare(this.read(id));
  }
  policyDate(expected){if(customerChangePolicy(this.time()).policyDate!==expected)fail('The Beirut billing day changed. Review the customer charge again before submitting the service change.');}
  async prepare(p){
    if(p.row.bill_id||p.result.payment)return this.dto(p);if(p.row.state!=='confirmed')return this.dto(p);
    try{
      const review=await this.renewalReview(p.input,p.quote);this.authorize();this.confirmed(p);const retail=await this.targetRetail({...p.quote,expiry:review.customer.expiry},p.input.renewalMonths);this.authorize();
      if(review.customer.username!==p.input.username||review.customer.serviceId!==p.input.targetId||review.customer.resellerId!==(p.quote.resellerId??undefined)||review.customer.blocked||review.renewalQuote.username!==p.input.username||review.renewalQuote.serviceId!==p.input.targetId)fail('Verify the confirmed target customer before collecting payment.');
      const total=amount(p.input.changeCustomerAmount+retail.renewalCustomerAmount);if(cents(total)<=0)fail('The combined total needs the separate refund and renewal flows.');
      const token=crypto.randomUUID(),validUntil=new Date(this.time().getTime()+120000).toISOString(),proof={actorKey:this.actor().key,originalActorKey:p.row.actor_key,requestId:p.row.request_id,username:p.input.username,targetId:p.input.targetId,resellerId:p.quote.resellerId,months:p.input.renewalMonths,changePolicy:p.quote.changePolicy,changeCustomerAmount:p.input.changeCustomerAmount,targetRetail:retail,total,customer:review.customer,renewalQuote:review.renewalQuote,fixedMonthlyCost:review.fixedMonthlyCost,token,validUntil};
      p=this.read(p.row.request_id);if(p.row.bill_id||p.result.payment)return this.dto(p);
      return this.dto(this.put(p,{...p.result,phase:'awaiting_payment',review:{...proof,proofHash:hash(proof)},reviewError:null},'Service changed once. Review the fresh renewal quote and collect one combined payment.'));
    }catch(error){p=this.read(p.row.request_id);if(p.row.bill_id||p.result.payment)return this.dto(p);return this.dto(this.put(p,{...p.result,phase:'change_confirmed',review:null,reviewError:String(error.message||'The renewal quote is unavailable.')},'Service change confirmed; renewal quote needs review. No customer payment or renewal was submitted.'));}
  }
  review(p){const review=p.result.review;if(!review)fail('Refresh the target renewal quote before collecting payment.');const {proofHash,...proof}=review;if(proofHash!==hash(proof)||review.requestId!==p.row.request_id||review.username!==p.input.username||review.targetId!==p.input.targetId||review.actorKey!==this.actor().key||review.originalActorKey!==p.row.actor_key||review.months!==p.input.renewalMonths||review.total!==amount(p.input.changeCustomerAmount+review.targetRetail.renewalCustomerAmount)||JSON.stringify(review.changePolicy)!==JSON.stringify(p.quote.changePolicy))fail('The combined renewal review could not be verified.');return review;}
  async confirmLocked(value){
    this.authorize();object(value,['requestId','token','amount','paymentMethod','whishDestinationId','billingPeriod','reference','confirm'],['requestId','token','amount','paymentMethod','billingPeriod','confirm']);let p=this.read(value.requestId);
    if(p.result.payment){const payment=this.normalizePayment(value,p);if(hash(payment)!==p.result.payment.fingerprint)fail('The saved combined payment already has different details.');return this.dto(p);}
    if(p.row.state!=='confirmed')fail('Verify the service-change outcome before recording payment.');const review=this.review(p);
    if(value.confirm!==true||value.token!==review.token||new Date(review.validUntil).getTime()<this.time().getTime()||!moneyEqual(Number(value.amount),review.total))fail('Refresh and confirm the exact full customer amount before payment.');
    const fresh=await this.renewalReview(p.input,p.quote);this.authorize();const retail=await this.targetRetail({...p.quote,expiry:fresh.customer.expiry},p.input.renewalMonths);this.authorize();this.assertReady(p.input.username,p.row.request_id);
    if(JSON.stringify(customerIdentity(fresh.customer))!==JSON.stringify(customerIdentity(review.customer))||JSON.stringify(retail)!==JSON.stringify(review.targetRetail)||JSON.stringify({...fresh.renewalQuote,verifiedAt:undefined})!==JSON.stringify({...review.renewalQuote,verifiedAt:undefined})||fresh.fixedMonthlyCost!==review.fixedMonthlyCost)fail('The customer, retail price or renewal cost changed. Check the saved request for a fresh review; no payment was recorded.');
    p=this.read(p.row.request_id);if(p.result.payment){const same=this.normalizePayment(value,p);if(hash(same)!==p.result.payment.fingerprint)fail('The saved combined payment already has different details.');return this.dto(p);}
    if(p.row.state!=='confirmed'||this.review(p).proofHash!==review.proofHash)fail('The combined review changed. Check the exact saved request before payment.');
    const payment=this.normalizePayment(value,p);p=this.put(p,{...p.result,phase:'payment_prepared',payment:{input:payment,fingerprint:hash(payment),review:clone(review)}},'One combined payment prepared; recover this exact saved request after a lost response.');
    return this.completePayment(p,true);
  }
  async completePayment(p,renew){
    const intent=this.paymentProof(p);
    let bill;if(p.row.bill_id){this.supportForBill(p.row.bill_id);bill=this.readBill(p.row.bill_id);}else bill=await this.createBill(p,intent.input,intent.review);p=this.read(p.row.request_id);
    if(p.row.bill_id!==bill.id)fail('The combined receipt was not atomically attached to its exact payment parent.');
    p=this.put(p,{...p.result,phase:'renewal_pending'},'One combined payment recorded. Continue only this receipt’s renewal.');
    if(renew)await this.renewBill(bill.id);return this.finalize(p.row.request_id);
  }
  async resumeLocked(value){this.authorize();object(value,['requestId','renew'],['requestId']);const p=this.read(value.requestId);if(p.row.state==='unknown'||['checking','processing','failed'].includes(p.row.state))return this.dto(p);if(p.result.payment)return p.row.bill_id?(value.renew===true?this.continueRenewal(p):this.finalize(p.row.request_id)):this.completePayment(p,value.renew===true);return this.prepare(p);}
  async continueRenewal(p){const bill=this.readBill(p.row.bill_id);if(['unknown','checking','processing'].includes(bill.renewal?.state))return this.dto(p);await this.renewBill(bill.id);return this.finalize(p.row.request_id);}
  async resolveLocked(value){
    this.authorize();if(!this.actor().admin)fail('Only Admin can verify an uncertain combined service change.');object(value,['requestId','confirmation','note'],['requestId','confirmation','note']);let p=this.read(value.requestId);if(p.row.state!=='unknown'||p.row.bill_id)fail('Only an uncertain combined service change needs this review.');
    if(!['APPLIED','NOT APPLIED'].includes(value.confirmation)||typeof value.note!=='string'||value.note.trim().length<5||value.note.trim().length>500)fail('Check Proradius transactions, choose APPLIED or NOT APPLIED, and enter a 5–500 character audit note.');
    const customer=await this.api.customer(p.input.username);this.authorize();if(!this.actor().admin)fail('Only Admin can verify the service-change outcome.');
    p=this.read(p.row.request_id);if(p.row.state!=='unknown'||p.row.bill_id)fail('This combined service-change outcome was already reviewed.');
    if(customer.serviceId!==(value.confirmation==='APPLIED'?p.input.targetId:p.input.expectedId)||customer.resellerId!==(p.quote.resellerId??undefined))fail('The confirmation does not match the exact current Proradius service and reseller.');
    if(value.confirmation==='APPLIED')this.db.run('UPDATE portal_operations SET result_json=? WHERE request_id=?',[JSON.stringify({...p.result,phase:'change_confirmed',customer}),p.row.request_id]);
    this.ledger.resolve(p.row.request_id,value,this.actor().name);return value.confirmation==='APPLIED'?this.prepare(this.read(p.row.request_id)):this.dto(this.read(p.row.request_id));
  }
  paymentProof(p){
    const payment=p.result.payment;if(!payment||!payment.input||!payment.review)fail('No exact combined payment was prepared.');const {proofHash,...review}=payment.review;
    if(hash(payment.input)!==payment.fingerprint||hash(review)!==proofHash||review.requestId!==p.row.request_id||review.username!==p.input.username||review.targetId!==p.input.targetId||review.months!==p.input.renewalMonths||review.originalActorKey!==p.row.actor_key||review.changeCustomerAmount!==p.input.changeCustomerAmount||JSON.stringify(review.changePolicy)!==JSON.stringify(p.quote.changePolicy)||!moneyEqual(payment.input.amount,review.total)||review.total!==amount(p.input.changeCustomerAmount+review.targetRetail.renewalCustomerAmount)||payment.input.requestId!==p.row.request_id+'-bill'||payment.input.customerAccount!==p.input.username||payment.input.portalServiceId!==p.input.targetId||payment.input.portalExpectedServiceId!==p.input.targetId||payment.input.collectorAccountKey!==review.actorKey||payment.input.renewalMonths!==p.input.renewalMonths||payment.input.bundleCode!==review.targetRetail.bundleCode||!['Cash','Whish Money'].includes(payment.input.paymentMethod)||cents(payment.input.amount)<=0||review.renewalQuote.username!==p.input.username||review.renewalQuote.serviceId!==p.input.targetId||cents(review.renewalQuote.cost)<0||cents(review.fixedMonthlyCost)<0||JSON.stringify(customerIdentity(review.customer))!==JSON.stringify({username:p.input.username,serviceId:p.input.targetId,resellerId:p.quote.resellerId??undefined,expiry:review.customer.expiry,blocked:false}))fail('The saved combined payment proof does not match.');
    return payment;
  }
  paymentSupport(id,input){const p=this.read(id),payment=this.paymentProof(p),retail=payment.review.targetRetail;if(p.row.state!=='confirmed'||JSON.stringify(payment.input)!==JSON.stringify(input)||typeof retail.bundleCode!=='string'||!retail.bundleCode||typeof retail.bundleName!=='string'||!retail.bundleName||typeof retail.allowance!=='string'||cents(retail.monthlyPrice)<=0)fail('The exact confirmed combined payment proof is required.');return {requestId:p.row.request_id,changeCost:p.quote.total,bundleSnapshot:{code:retail.bundleCode,name:retail.bundleName,allowance:retail.allowance,price:retail.monthlyPrice,cost:0}};}
  supportForBill(id){
    const row=one(this.db,"SELECT request_id FROM portal_operations WHERE kind='change_renew' AND bill_id=?",[Number(id)]);if(!row)return null;const p=this.read(row.request_id);if(!['confirmed','succeeded'].includes(p.row.state)||!p.result.payment)fail('The combined receipt parent is not confirmed.');
    const payment=this.paymentProof(p),bill=one(this.db,'SELECT * FROM fibernetlb_bills WHERE id=?',[Number(id)]),request=one(this.db,'SELECT bill_id FROM bill_requests WHERE request_id=?',[payment.input.requestId]);
    const collector=one(this.db,'SELECT account_key FROM users WHERE id=?',[bill?.user_id]),snapshot=bill?require('./whish-destinations.cjs').readSnapshot(this.db,'bill',bill.id):null,expected=payment.input.whishDestination;
    if(!bill||!request||request.bill_id!==bill.id||bill.customer_account!==p.input.username||bill.portal_service_id!==p.input.targetId||bill.renewal_months!==p.input.renewalMonths||bill.service_type!=='Internet'||bill.payment_method!==payment.input.paymentMethod||!moneyEqual(bill.amount,payment.input.amount)||bill.billing_period!==payment.input.billingPeriod||bill.reference!==payment.input.reference||collector?.account_key!==payment.input.collectorAccountKey||bill.customer_name!==payment.input.customerName||bill.phone!==payment.input.phone||bill.bundle_code!==payment.review.targetRetail.bundleCode||bill.bundle_name!==payment.review.targetRetail.bundleName||!moneyEqual(bill.bundle_price,payment.review.targetRetail.monthlyPrice*p.input.renewalMonths)||payment.input.paymentMethod==='Whish Money'&&(!snapshot||!expected||['id','label','number','gross','fee','netCollected','walletAmount','feeRate','feePolicy','feeChargedAt','walletPolicy'].some(key=>snapshot[key]!==expected[key])||!moneyEqual(snapshot.gross,payment.input.amount)||!moneyEqual(snapshot.walletAmount,payment.input.amount)||snapshot.feePolicy!=='profit_only'||snapshot.walletPolicy!=='gross')||payment.input.paymentMethod==='Cash'&&snapshot)fail('The single combined receipt does not match its parent.');
    return {requestId:p.row.request_id,changeCost:p.quote.total};
  }
  finalize(id){let p=this.read(id);if(p.row.bill_id){this.supportForBill(p.row.bill_id);const bill=this.readBill(p.row.bill_id);if(bill.renewal?.state==='succeeded'&&bill.renewal.completedMonths===p.input.renewalMonths&&p.row.state!=='succeeded')p=this.put(p,{...p.result,phase:'completed'},'Service change, one combined payment and all renewal cycles confirmed once.','succeeded');}return this.dto(p);}
  status(value={}){this.authorize();object(value,['requestId']);if(value.requestId)return this.dto(this.read(value.requestId));const scope=this.ledger.owner?.scope(),pending=rows(this.db,"SELECT request_id FROM portal_operations WHERE kind='change_renew' AND state IN ('checking','processing','unknown','confirmed')"+(scope?' AND actor_key=?':'')+' ORDER BY rowid LIMIT 1001',scope?[scope]:[]);if(pending.length>1000)fail('Too many unfinished combined requests require Admin review.');return {pending:pending.map(row=>this.dto(this.read(row.request_id)))};}
  history(){this.authorize();return this.ledger.history('change_renew').map(row=>this.dto(this.read(row.requestId)));}
  dto(p){
    if(p.row.bill_id)this.supportForBill(p.row.bill_id);
    let phase=p.row.state==='unknown'?'change_unknown':p.row.state==='failed'?'change_failed':['checking','processing'].includes(p.row.state)?'change_pending':p.result.phase||'change_confirmed',bill=p.row.bill_id?this.readBill(p.row.bill_id):null;
    if(bill&&phase!=='completed')phase=bill.renewal?.state==='unknown'?'renewal_unknown':bill.renewal?.state==='failed'?'renewal_failed':'renewal_pending';
    if(bill&&!this.canInspect()){bill=clone(bill);for(const key of ['bundleCost','portalInternalCost','portalFixedMonthlyCost','portalCostSource'])delete bill[key];if(bill.renewal)delete bill.renewal.costQuotes;}
    const review=p.result.payment?.review||p.result.review,retailAmount=review?.targetRetail?.renewalCustomerAmount??p.input.renewalCustomerAmount,visible={requestId:p.row.request_id,state:p.row.state,phase,username:p.input.username,customerName:p.quote.customerName,beforeName:p.quote.beforeName,targetName:p.quote.targetName,expectedId:p.input.expectedId,targetId:p.input.targetId,renewalMonths:p.input.renewalMonths,changeCustomerAmount:p.input.changeCustomerAmount,renewalCustomerAmount:retailAmount,totalToCollect:amount(p.input.changeCustomerAmount+retailAmount),policyDate:p.input.policyDate,policyDay:p.quote.changePolicy.policyDay,policyTimezone:p.quote.changePolicy.policyTimezone,zeroChargeWindow:p.quote.changePolicy.zeroChargeWindow,expiry:p.result.customer?.expiry||p.quote.expiry,bill,canReview:p.row.state==='unknown'&&this.actor().admin,message:p.result.reviewError||p.row.message};
    Object.assign(visible,publicPolicy(p.quote.changePolicy));
    if(phase==='awaiting_payment'&&review){visible.token=review.token;visible.validUntil=review.validUntil;}
    if(bill?.renewal?.state==='succeeded'&&p.row.state!=='succeeded')visible.canFinalize=true;
    if(this.canInspect()){visible.changeCost=p.quote.total;if(review)visible.renewalCost=review.renewalQuote.cost;}
    return visible;
  }
}
module.exports={CombinedChangeRenew};
