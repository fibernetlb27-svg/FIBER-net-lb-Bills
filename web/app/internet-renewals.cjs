const crypto = require("node:crypto");
const LIVE_COST_SOURCE='Proradius live renewal quotes';
const CREDIT_EVENT='unpaid_authorized';
const CREDIT_HISTORY_NOTE='Renewal on credit authorized; full amount remains customer debt. No cash or wallet payment received.';
const roundCost=value=>Math.round((value+Number.EPSILON)*100)/100;
function portalBillCost(pricing,months){
  if(!Number.isSafeInteger(months)||months<1||months>12||!Number.isFinite(pricing.cost)||pricing.cost<0||!Number.isFinite(pricing.fixedMonthlyCost)||pricing.fixedMonthlyCost<0)throw Error('A current Proradius cost, fixed monthly reference and 1–12 months are required.');
  // Only the first live quote is known before renewal. Future cycles are
  // provisional full-month references, replaced by each cycle's own live quote.
  return roundCost(pricing.cost+pricing.fixedMonthlyCost*(months-1));
}

function query(db, sql, params = []) {
  const statement = db.prepare(sql); statement.bind(params); const result = [];
  try { while (statement.step()) result.push(statement.getAsObject()); } finally { statement.free(); }
  return result;
}
function initializeRenewals(db) {
  const billColumns=query(db,"PRAGMA table_info(fibernetlb_bills)");
  if(!billColumns.some(column=>column.name==="portal_service_id")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN portal_service_id INTEGER");
  if(!billColumns.some(column=>column.name==="portal_cost_source")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN portal_cost_source TEXT NOT NULL DEFAULT ''");
  if(!billColumns.some(column=>column.name==="renewal_months")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN renewal_months INTEGER NOT NULL DEFAULT 1");
  if(!billColumns.some(column=>column.name==="portal_internal_cost")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN portal_internal_cost REAL");
  if(!billColumns.some(column=>column.name==="portal_fixed_monthly_cost")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN portal_fixed_monthly_cost REAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bill_requests (
      request_id TEXT PRIMARY KEY, bill_id INTEGER NOT NULL UNIQUE REFERENCES fibernetlb_bills(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS internet_renewals (
      bill_id INTEGER PRIMARY KEY REFERENCES fibernetlb_bills(id) ON DELETE CASCADE,
      username TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, completed_at TEXT,
      before_expiry TEXT NOT NULL DEFAULT '', after_expiry TEXT NOT NULL DEFAULT '',
      portal_service TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS internet_renewal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL REFERENCES fibernetlb_bills(id) ON DELETE CASCADE,
      state TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS internet_renewal_costs (
      bill_id INTEGER NOT NULL REFERENCES fibernetlb_bills(id) ON DELETE CASCADE,
      cycle_no INTEGER NOT NULL,quoted_cost REAL NOT NULL CHECK(quoted_cost>=0),
      state TEXT NOT NULL CHECK(state IN ('quoted','confirmed','not_applied')),
      quoted_at TEXT NOT NULL,PRIMARY KEY(bill_id,cycle_no)
    );
    UPDATE internet_renewals SET state = 'unknown', message = 'The app restarted during renewal. Check Proradius refill history before retrying.' WHERE state = 'processing';
    UPDATE internet_renewals SET state = 'failed', message = 'The app restarted before sending renewal. It is safe to retry.' WHERE state = 'checking';
    CREATE TABLE IF NOT EXISTS internet_plan_changes (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, username TEXT NOT NULL,
      before_service INTEGER NOT NULL, target_service INTEGER NOT NULL, target_name TEXT NOT NULL,
      state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL,
      recorded_at TEXT NOT NULL, bill_id INTEGER REFERENCES fibernetlb_bills(id)
    );
    CREATE TABLE IF NOT EXISTS internet_plan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES internet_plan_changes(request_id) ON DELETE CASCADE,
      state TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    UPDATE internet_plan_changes SET state='unknown',message='The app restarted during a plan change. Check Proradius before retrying.' WHERE state='processing';
    UPDATE internet_plan_changes SET state='failed',message='The app restarted before sending the plan change.' WHERE state='checking';
  `);
  const renewalColumns=query(db,"PRAGMA table_info(internet_renewals)");
  if(!renewalColumns.some(column=>column.name==="requested_months"))db.run("ALTER TABLE internet_renewals ADD COLUMN requested_months INTEGER NOT NULL DEFAULT 1");
  if(!renewalColumns.some(column=>column.name==="completed_months")){
    db.run("ALTER TABLE internet_renewals ADD COLUMN completed_months INTEGER NOT NULL DEFAULT 0");
    db.run("UPDATE internet_renewals SET completed_months=1 WHERE state='succeeded'");
  }
}

class PlanChangeLedger {
  constructor(db, api, save, authorize,owner=null) { this.db=db; this.api=api; this.save=save; this.authorize=authorize;this.owner=owner; }
  one(sql, params=[]) { return query(this.db,sql,params)[0] || null; }
  latest(username) { const scope=this.owner?.scope();return this.one(`SELECT request_id AS requestId,username,before_service AS beforeId,target_service AS targetId,target_name AS targetName,state,message,actor,recorded_at AS recordedAt FROM internet_plan_changes WHERE username=? ${scope?'AND actor_key=?':''} ORDER BY rowid DESC LIMIT 1`,scope?[username,scope]:[username]); }
  history(username) { const scope=this.owner?.scope();return { latest:this.latest(username), events:query(this.db,`SELECT e.state,e.note,e.actor,e.recorded_at AS recordedAt FROM internet_plan_events e JOIN internet_plan_changes p ON p.request_id=e.request_id WHERE p.username=? ${scope?'AND p.actor_key=?':''} ORDER BY e.id DESC LIMIT 100`,scope?[username,scope]:[username]) }; }
  event(id,state,note,actor) { this.db.run("INSERT INTO internet_plan_events (request_id,state,note,actor,recorded_at) VALUES (?,?,?,?,?)",[id,state,note,actor,new Date().toISOString()]); }
  finish(id,state,message,actor) { this.db.run("UPDATE internet_plan_changes SET state=?,message=? WHERE request_id=?",[state,message,id]); this.event(id,state,message,actor); this.save(); }
  attach(id,billId) { this.db.run("UPDATE internet_plan_changes SET bill_id=? WHERE request_id=?",[billId,id]); this.save(); }
  async apply(input,actor) {
    this.authorize();
    const {requestId,username,expectedId,targetId,targetName,expectedResellerId}=input;
    if(this.one("SELECT name FROM sqlite_master WHERE name='portal_operations'")&&this.one("SELECT request_id FROM portal_operations WHERE request_id=? AND state='archived'",[requestId]))throw Error('This test request was archived and cannot change a service again.');
    if(this.one("SELECT name FROM sqlite_master WHERE name='portal_operations'")&&this.one("SELECT request_id FROM portal_operations WHERE entity=? AND state IN ('checking','processing','unknown','confirmed')",[`customer:${username}`]))throw Error("Review the unfinished charged plan change before changing this customer.");
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error("Invalid plan-change request ID.");
    const fingerprint=crypto.createHash("sha256").update(JSON.stringify({username,expectedId,targetId})).digest("hex");
    const previous=this.one("SELECT * FROM internet_plan_changes WHERE request_id=?",[requestId]);
    if(previous&&this.owner?.scope()&&previous.actor_key!==this.owner.scope())throw Error('Plan change not found for your account.');
    if(previous && previous.fingerprint!==fingerprint) throw new Error("This request already refers to another plan change. Verify the customer and open a new bill form.");
    if(previous && ["checking","processing","unknown"].includes(previous.state)) throw new Error("A plan change is unfinished. Use Plan change history to verify its outcome before retrying. No new change or renewal was sent.");
    if(previous?.state==="succeeded") {
      const customer=await this.api.customer(username);
      if(customer.serviceId!==targetId) throw new Error("The portal plan changed after this request. Open a new bill after verifying the customer; the old change was not repeated.");
      return customer;
    }
    const unfinished=this.one("SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[username]);
    if(unfinished) throw new Error("This customer has an unfinished plan change. Review Plan change history before trying another request.");
    this.db.run("INSERT INTO internet_plan_changes (request_id,fingerprint,username,before_service,target_service,target_name,state,actor,recorded_at) VALUES (?,?,?,?,?,?,'checking',?,?) ON CONFLICT(request_id) DO UPDATE SET state='checking',message='',actor=excluded.actor",[requestId,fingerprint,username,expectedId,targetId,targetName,actor,new Date().toISOString()]);
    if(this.owner&&!previous)this.db.run('UPDATE internet_plan_changes SET actor_key=? WHERE request_id=?',[this.owner.key(),requestId]);
    this.event(requestId,"checking","Verifying customer and preserving account details before plan change.",actor); this.save();
    let sent=false;
    try {
      const customer=await this.api.changePlan(username,expectedId,targetId,()=>{
        this.authorize();
        if(!this.api.settings.status().ready) throw new Error("Internet API disabled; no plan change was sent.");
        this.db.run("UPDATE internet_plan_changes SET state='processing' WHERE request_id=?",[requestId]);
        this.event(requestId,"processing",`One change to ${targetName} submitted; do not repeat it until confirmed.`,actor); this.save(); sent=true;
      },expectedResellerId);
      this.finish(requestId,"succeeded",`Proradius read-back confirmed ${targetName}.`,actor); return customer;
    } catch(error) {
      this.finish(requestId,sent?"unknown":"failed",sent?"Plan-change outcome needs review. No renewal or payment was sent. Check Proradius and review Plan change history before retrying.":error.message,actor);
      throw new Error(sent?"Plan-change outcome needs review. Check Proradius and use Plan change history; no renewal or payment was sent.":error.message);
    }
  }
  async resolve(id,input,actor,authorizeReview=this.authorize) {
    const row=this.one("SELECT * FROM internet_plan_changes WHERE request_id=?",[id]);
    if(row?.state!=="unknown") throw new Error("Only an uncertain plan change needs reconciliation.");
    const changed=input.confirmation==="PLAN CHANGED", unchanged=input.confirmation==="NOT CHANGED",note=String(input.note||"").trim();
    if((!changed&&!unchanged)||note.length<5||note.length>500) throw new Error("Type PLAN CHANGED or NOT CHANGED and enter an audit note (5–500 characters).");
    const customer=await this.api.customer(row.username); authorizeReview();
    if(this.one('SELECT state FROM internet_plan_changes WHERE request_id=?',[id])?.state!=='unknown')throw Error('This plan-change outcome was already reviewed. Refresh its history.');
    if(customer.serviceId!==(changed?row.target_service:row.before_service)) throw new Error("Your confirmation does not match the current Proradius plan. Check the account again.");
    this.finish(id,changed?"succeeded":"failed",`Administrator verified ${input.confirmation}. ${note}`,actor); return this.latest(row.username);
  }
}

class RenewalLedger {
  constructor(db, api, save, authorize, combinedSupport = null) { this.db = db; this.api = api; this.save = save; this.authorize = authorize; this.combinedSupport = combinedSupport; }
  one(sql, params = []) { return query(this.db, sql, params)[0] || null; }
  creditIdentity(id){
    const bill=this.one("SELECT b.id,b.receipt_no,b.customer_account,b.service_type,b.bundle_code,b.amount,b.payment_method,b.paid_at,b.user_id,u.account_key AS creator_key,b.portal_service_id,b.renewal_months FROM fibernetlb_bills b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=?",[Number(id)]);
    if(!bill||bill.service_type!=='Internet'||bill.payment_method!=='Unpaid'||!Number.isFinite(bill.amount)||bill.amount<=0||bill.amount>1000000||Math.abs(bill.amount*100-Math.round(bill.amount*100))>0.00001||!Number.isSafeInteger(bill.portal_service_id)||bill.portal_service_id<=0||!Number.isSafeInteger(bill.renewal_months)||bill.renewal_months<1||bill.renewal_months>12||!bill.customer_account||!bill.receipt_no||!bill.paid_at||!bill.creator_key)throw Error('The original Unpaid Internet renewal authorization could not be verified. Review this bill; no renewal was sent.');
    return bill;
  }
  creditHash(bill){return crypto.createHash('sha256').update(JSON.stringify(bill)).digest('hex');}
  creditAuthorization(id){
    const events=query(this.db,'SELECT note FROM internet_renewal_events WHERE bill_id=? AND state=?',[Number(id),CREDIT_EVENT]);
    if(!events.length)return null;
    const invalid=()=>{throw Error('The saved Unpaid renewal authorization is invalid or conflicting. Review this bill; no renewal was sent.');};
    if(events.length!==1)invalid();
    let proof;try{proof=JSON.parse(events[0].note);}catch{invalid();}
    const keys=['type','version','billId','requestId','requestFingerprint','billFingerprint','originalAmount'];
    if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).length!==keys.length||keys.some(key=>!Object.hasOwn(proof,key))||proof.type!=='unpaid_internet_renewal'||proof.version!==1||proof.billId!==Number(id)||typeof proof.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(proof.requestId)||typeof proof.requestFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(proof.requestFingerprint)||typeof proof.billFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(proof.billFingerprint))invalid();
    const bill=this.creditIdentity(id),request=this.one('SELECT bill_id,fingerprint FROM bill_requests WHERE request_id=?',[proof.requestId]);
    if(!request||request.bill_id!==bill.id||request.fingerprint!==proof.requestFingerprint||proof.billFingerprint!==this.creditHash(bill)||proof.originalAmount!==bill.amount)invalid();
    return {...proof,bill};
  }
  authorizeOnCredit(id,requestId,fingerprint,actor){
    const bill=this.creditIdentity(id),request=this.one('SELECT bill_id,fingerprint FROM bill_requests WHERE request_id=?',[requestId]);
    if(!request||request.bill_id!==bill.id||request.fingerprint!==fingerprint||!this.liveCostBill(id)||this.one('SELECT bill_id FROM internet_renewals WHERE bill_id=?',[id])||this.one('SELECT id FROM internet_renewal_events WHERE bill_id=? AND state=?',[id,CREDIT_EVENT])||this.one("SELECT id FROM debt_payments WHERE kind='bill' AND record_id=?",[id])||this.one("SELECT id FROM fibernetlb_bills WHERE id=? AND (payment_status<>'unpaid' OR settled_at IS NOT NULL)",[id]))throw Error('Renewal on credit requires a new verified Unpaid Internet bill with its full original debt.');
    const proof={type:'unpaid_internet_renewal',version:1,billId:bill.id,requestId,requestFingerprint:fingerprint,billFingerprint:this.creditHash(bill),originalAmount:bill.amount};
    this.event(id,CREDIT_EVENT,JSON.stringify(proof),actor);
  }
  liveCostBill(id){return this.one('SELECT portal_cost_source AS source FROM fibernetlb_bills WHERE id=?',[id])?.source?.startsWith(LIVE_COST_SOURCE);}
  costQuotes(id){return query(this.db,'SELECT cycle_no AS cycle,quoted_cost AS cost,state,quoted_at AS quotedAt FROM internet_renewal_costs WHERE bill_id=? ORDER BY cycle_no',[id]);}
  syncBillCost(id){
    if(!this.liveCostBill(id))return;
    const bill=this.one('SELECT renewal_months AS months,portal_internal_cost AS initialCost,portal_fixed_monthly_cost AS fixedCost FROM fibernetlb_bills WHERE id=?',[id]);
    const quotes=this.costQuotes(id).filter(p=>p.state!=='not_applied'),known=quotes.reduce((sum,p)=>sum+p.cost,0),missing=bill.months-quotes.length;
    const firstMissing=!quotes.some(p=>p.cycle===1),remaining=missing-(firstMissing?1:0);
    const extra=this.combinedSupport?.(id)?.changeCost??0;
    if(!Number.isFinite(extra)||Math.abs(extra)>1000000||Math.abs(extra*100-Math.round(extra*100))>0.00001)throw Error('The confirmed service-change cost could not be verified.');
    const cost=roundCost(known+(firstMissing?bill.initialCost:0)+bill.fixedCost*remaining+extra),confirmed=quotes.filter(p=>p.state==='confirmed').length;
    const status=confirmed===bill.months?'all cycles confirmed':quotes.some(p=>p.state==='quoted')?'submission awaiting confirmation; remaining cycles estimated':`${confirmed}/${bill.months} confirmed; unsubmitted cycles estimated`;
    this.db.run('UPDATE fibernetlb_bills SET bundle_cost=?,portal_cost_source=? WHERE id=?',[cost,`${LIVE_COST_SOURCE} · ${status}`,id]);
  }
  creation(id){return this.one("SELECT name FROM sqlite_master WHERE name='portal_operations'")?this.one("SELECT request_id,result_json,actor,recorded_at FROM portal_operations WHERE bill_id=? AND kind='create' AND state IN ('confirmed','succeeded')",[id]):null;}
  details(id) {
    const free=this.free(id);
    if(free){const result=JSON.parse(free.result_json);return {state:'free',source:'free_expiry',message:'Free service until the next 5th; expiry edited only. Received money is separate expense funding, not Internet revenue.',username:result.customer?.username,service:result.customer?.service,afterExpiry:result.customer?.expiry,requestedBy:free.actor,requestedAt:free.recorded_at,attempts:0,requestedMonths:0,completedMonths:0,remainingMonths:0};}
    const creation=this.creation(id);
    if(creation){const result=JSON.parse(creation.result_json);return {state:'created',source:'account_creation',message:'Proradius activated the selected service when creating this customer. Initial service payment recorded; no additional renewal was sent.',username:result.customer?.username,service:result.customer?.service,afterExpiry:result.customer?.expiry,requestedBy:creation.actor,requestedAt:creation.recorded_at,attempts:0,requestedMonths:0,completedMonths:0,remainingMonths:0};}
    const row = this.one("SELECT * FROM internet_renewals WHERE bill_id = ?", [id]),onCredit=Boolean(this.creditAuthorization(id));
    if (!row) return { state: "not_requested", message: onCredit?"Renewal on credit authorized; full customer debt is recorded. Internet renewal has not been submitted yet.":"Payment record only — Internet not renewed.",...onCredit?{onCredit:true}:{} };
    return { state: row.state, message: row.message, username: row.username, requestedBy: row.requested_by, requestedAt: row.requested_at, completedAt: row.completed_at, beforeExpiry: row.before_expiry, afterExpiry: row.after_expiry, service: row.portal_service, attempts: row.attempts, requestedMonths:row.requested_months, completedMonths:row.completed_months, remainingMonths:row.requested_months-row.completed_months,costQuotes:this.costQuotes(id),...onCredit?{onCredit:true}:{} };
  }
  free(id){return this.one("SELECT name FROM sqlite_master WHERE name='portal_operations'")?this.one("SELECT request_id,result_json,actor,recorded_at FROM portal_operations WHERE bill_id=? AND kind='free' AND state IN ('confirmed','succeeded')",[id]):null;}
  enrich(bill) {const free=this.free(bill.id),funding=free?this.one('SELECT id,receipt_no AS receiptNo,customer_account AS customerAccount,customer_name AS customerName,amount,payment_method AS paymentMethod,paid_at AS paidAt,cashier_name AS cashierName FROM installation_payments WHERE request_id=?',[free.request_id]):null;return { ...bill, renewal: this.details(bill.id),...free?{expenseFunding:funding?{...funding,whishDestination:require('./whish-destinations.cjs').readSnapshot(this.db,'installation',funding.id)}:null}: {}}; }
  fingerprint(bill, renew) { return crypto.createHash("sha256").update(JSON.stringify({ bill, renew })).digest("hex"); }
  replay(id, fingerprint) {
    if (!id) return null;
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error("Invalid bill request ID.");
    const row = this.one("SELECT * FROM bill_requests WHERE request_id = ?", [id]);
    if (row && row.fingerprint !== fingerprint) throw new Error("This payment request was already used with different details. Open a new bill form.");
    return row?.bill_id || null;
  }
  recordRequest(id, billId, fingerprint) {
    if (id) this.db.run("INSERT INTO bill_requests (request_id,bill_id,fingerprint,created_at) VALUES (?,?,?,?)", [id,billId,fingerprint,new Date().toISOString()]);
  }
  event(id, state, note, actor) { this.db.run("INSERT INTO internet_renewal_events (bill_id,state,note,actor,recorded_at) VALUES (?,?,?,?,?)", [id,state,note,actor,new Date().toISOString()]); }
  recordFailure(bill, actor, message) {
    if (this.details(bill.id).state !== "not_requested") return;
    this.db.run("INSERT INTO internet_renewals (bill_id,username,state,message,requested_by,requested_at,completed_at,requested_months) VALUES (?,?,'failed',?,?,?,?,?)",[bill.id,bill.customerAccount,message,actor,new Date().toISOString(),new Date().toISOString(),Number(bill.renewalMonths??1)]);
    this.event(bill.id,"failed",message,actor); this.save();
  }
  finish(id, state, message, actor, expiry = "") {
    this.db.run("UPDATE internet_renewals SET state = ?, message = ?, completed_at = ?, after_expiry = ? WHERE bill_id = ?", [state,message,new Date().toISOString(),expiry,id]);
    this.event(id,state,message,actor); this.save(); return this.details(id);
  }
  async start(bill, actor, options = {}) {
    this.authorize();
    if(this.free(bill.id))throw Error('This free service was extended by expiry edit. It cannot submit a paid renewal. Start a new renewal form for a new cycle.');
    if(this.creation(bill.id))throw Error('This initial service was activated during customer creation. Record a new bill for an additional renewal; this first bill will not renew twice.');
    const combined=this.combinedSupport?.(bill.id);
    if(this.one("SELECT name FROM sqlite_master WHERE name='portal_operations'")&&query(this.db,"SELECT request_id FROM portal_operations WHERE entity=? AND state IN ('checking','processing','unknown','confirmed')",[`customer:${bill.customerAccount}`]).some(row=>row.request_id!==combined?.requestId))throw Error("Review the unfinished charged plan change before renewal.");
    const credit=this.creditAuthorization(bill.id);
    if(credit&&(bill.customerAccount!==credit.bill.customer_account||bill.serviceType!=='Internet'||Number(bill.amount)!==credit.bill.amount||Number(bill.renewalMonths??1)!==credit.bill.renewal_months||Number(bill.portalServiceId)!==credit.bill.portal_service_id))throw Error('This bill does not match its saved Unpaid renewal authorization. No renewal was sent.');
    if (bill.serviceType !== "Internet" || !credit&&(Number(bill.remainingAmount) !== 0 || bill.paymentStatus !== "paid")) throw new Error("Renewal is available for fully paid Internet bills only. Collect any remaining debt first.");
    const existing = this.details(bill.id);
    if (["checking","processing","succeeded","unknown"].includes(existing.state)) return existing;
    const other = this.one("SELECT b.id AS bill_id,b.receipt_no FROM fibernetlb_bills b LEFT JOIN internet_renewals r ON r.bill_id=b.id WHERE b.id<>? AND (r.username=? AND r.state IN ('checking','processing','unknown') OR b.customer_account=? AND EXISTS(SELECT 1 FROM internet_renewal_events e WHERE e.bill_id=b.id AND e.state='unpaid_authorized') AND (r.bill_id IS NULL OR r.state='failed' AND r.completed_months<r.requested_months)) LIMIT 1", [bill.id,bill.customerAccount,bill.customerAccount]);
    if (other) throw new Error(`This account already has an unfinished renewal on ${other.receipt_no}. Review that bill before sending another renewal.`);
    const planChange=this.one("SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[bill.customerAccount]);
    if(planChange) throw new Error("This customer has an unfinished plan change. Review Plan change history before renewal.");
    if (!this.api.settings.status().ready) throw new Error("The main administrator must test and enable the Internet API first.");
    const months=Number(bill.renewalMonths??1);
    if(!Number.isSafeInteger(months)||months<1||months>12)throw Error("Choose 1–12 renewal months.");
    if(existing.requestedMonths&&existing.requestedMonths!==months)throw Error("The saved renewal duration cannot be changed. Review this bill's history.");
    this.db.run("INSERT INTO internet_renewals (bill_id,username,state,requested_by,requested_at,requested_months) VALUES (?,?,'checking',?,?,?) ON CONFLICT(bill_id) DO UPDATE SET state='checking',message='',requested_by=excluded.requested_by,requested_at=excluded.requested_at,completed_at=NULL", [bill.id,bill.customerAccount,actor,new Date().toISOString(),months]);
    this.event(bill.id,"checking","Customer verification started; no renewal sent yet.",actor); this.save();
    let sent = false;
    try {
      const costCustomer=bill.portalCostSource&&this.api.billingCustomer?this.api.billingCustomer.bind(this.api):this.api.customer.bind(this.api);
      let customer = await costCustomer(bill.customerAccount);
      const requiredService=options.serviceId ?? bill.portalServiceId ?? customer.serviceId;
      if(requiredService && customer.serviceId!==Number(requiredService)) throw new Error("The portal plan no longer matches this bill. Verify the customer and record the correct plan before renewing.");
      this.authorize();
      if (!this.api.settings.status().ready) throw new Error("The Internet API was disabled. No renewal was sent.");
      if (customer.blocked) throw new Error("This customer is blocked in Proradius. An administrator must review the account.");
      if(!this.details(bill.id).beforeExpiry)this.db.run("UPDATE internet_renewals SET before_expiry=?,portal_service=? WHERE bill_id=?",[customer.expiry,customer.service,bill.id]);
      let completed=this.details(bill.id).completedMonths,expiry=this.details(bill.id).afterExpiry;
      while(completed<months){
        // Each month is a separate documented one-cycle action, not a retry.
        // Completed cycles are persisted before any next verification/write.
        if(completed>0)customer=await costCustomer(bill.customerAccount);
        this.authorize();
        if(!this.api.settings.status().ready||customer.blocked)throw Error("Internet API disabled or customer blocked. No further cycle was sent.");
        if(requiredService&&customer.serviceId!==Number(requiredService))throw Error("The portal plan changed. No further cycle was sent; review the saved bill.");
        if(this.liveCostBill(bill.id)){
          if(!this.api.quoteRenewal)throw Error('The live Proradius renewal preview is required. No further renewal was sent.');
          const quote=await this.api.quoteRenewal(customer.username,customer.serviceId),cost=quote.cost;
          this.authorize();
          if(!this.api.settings.status().ready)throw Error('Internet API disabled during the renewal quote. No further cycle was sent.');
          if(!Number.isFinite(cost)||cost<0)throw Error('Proradius did not supply a valid live cost for this cycle. No further renewal was sent.');
          this.db.run("INSERT INTO internet_renewal_costs(bill_id,cycle_no,quoted_cost,state,quoted_at) VALUES(?,?,?,'quoted',?) ON CONFLICT(bill_id,cycle_no) DO UPDATE SET quoted_cost=excluded.quoted_cost,state='quoted',quoted_at=excluded.quoted_at",[bill.id,completed+1,roundCost(cost),new Date().toISOString()]);
          if(completed===0)this.db.run('UPDATE fibernetlb_bills SET portal_internal_cost=? WHERE id=?',[roundCost(cost),bill.id]);
          this.syncBillCost(bill.id);this.event(bill.id,'cost_quoted',`Cycle ${completed+1} Proradius renewcheck cost: USD ${roundCost(cost).toFixed(2)}. Service-option daily costs were not used.`,actor);
        }
        this.db.run("UPDATE internet_renewals SET state='processing',attempts=attempts+1,message=? WHERE bill_id=?",[`Submitting cycle ${completed+1} of ${months}; awaiting confirmation.`,bill.id]);
        this.event(bill.id,"processing",`Cycle ${completed+1} of ${months} submitted once. Do not repeat it until confirmed.`,actor);
        this.save();sent=true;
        await this.api.renew(customer.username,customer.serviceId??null);
        if(this.liveCostBill(bill.id)){this.db.run("UPDATE internet_renewal_costs SET state='confirmed' WHERE bill_id=? AND cycle_no=?",[bill.id,completed+1]);this.syncBillCost(bill.id);}
        completed++;
        this.db.run("UPDATE internet_renewals SET completed_months=?,state='checking',message=? WHERE bill_id=?",[completed,`Proradius confirmed ${completed} of ${months} cycles.`,bill.id]);
        this.event(bill.id,"cycle_confirmed",`Proradius explicitly confirmed cycle ${completed} of ${months}.`,actor);this.save();sent=false;
        try{expiry=(await this.api.customer(customer.username)).expiry;this.db.run("UPDATE internet_renewals SET after_expiry=? WHERE bill_id=?",[expiry,bill.id]);this.save();}catch{}
      }
      return this.finish(bill.id,"succeeded",`Proradius explicitly confirmed all ${months} renewal cycle${months===1?"":"s"}. Future cycles may appear as pending refills in Proradius.`,actor,expiry);
    } catch (error) {
      const progress=this.details(bill.id),prefix=`${progress.completedMonths} of ${months} cycles confirmed. `;
      const message = prefix+(sent ? `Cycle ${progress.completedMonths+1} outcome is uncertain. Check Proradius refill/pending history; do not repeat until an administrator verifies this specific cycle.` : (error.message || "Customer verification failed. No further renewal was sent."));
      return this.finish(bill.id,sent ? "unknown" : "failed",message,actor);
    }
  }
  resolve(id, input, actor) {
    if (this.details(id).state !== "unknown") throw new Error("Only an uncertain renewal needs manual reconciliation.");
    const renewed = input.confirmation === "RENEWED", notRenewed = input.confirmation === "NOT RENEWED";
    const note = String(input.note || "").trim();
    if ((!renewed && !notRenewed) || note.length < 5 || note.length > 500) throw new Error("Check Proradius, type RENEWED or NOT RENEWED, and enter an audit note (5–500 characters).");
    const progress=this.details(id),completed=progress.completedMonths+(renewed?1:0);
    if(this.liveCostBill(id)){
      const quote=this.costQuotes(id).find(p=>p.cycle===progress.completedMonths+1&&p.state==='quoted');
      if(!quote)throw Error('The uncertain cycle has no saved cost quote. Review its audit before reconciliation.');
      this.db.run('UPDATE internet_renewal_costs SET state=? WHERE bill_id=? AND cycle_no=?',[renewed?'confirmed':'not_applied',id,quote.cycle]);this.syncBillCost(id);
    }
    this.db.run("UPDATE internet_renewals SET completed_months=? WHERE bill_id=?",[completed,id]);
    return this.finish(id,completed===progress.requestedMonths?"succeeded":"failed",`Administrator checked uncertain cycle ${progress.completedMonths+1}: ${input.confirmation}. ${completed} of ${progress.requestedMonths} confirmed; ${progress.requestedMonths-completed} remaining. ${note}`,actor,progress.afterExpiry);
  }
  canDelete(id) {
    if(this.combinedSupport?.(id))throw Error('This receipt owns a confirmed service change and renewal audit. Deleting it would not reverse those provider actions.');
    if(this.one("SELECT request_id FROM internet_plan_changes WHERE bill_id=?",[id])) throw new Error("This bill has a portal plan-change audit trail and cannot be deleted. Removing a payment would not undo the plan change.");
    const row = this.one("SELECT state,attempts FROM internet_renewals WHERE bill_id = ?",[id]);
    if (row && (row.attempts > 0 || ["checking","processing","unknown"].includes(row.state))) throw new Error("This bill has a portal renewal audit trail and cannot be deleted. Removing a payment would not undo the Internet renewal.");
  }
  history(id) { const operation=this.creation(id)||this.free(id);return operation?query(this.db,"SELECT state,note,actor,recorded_at AS recordedAt FROM portal_operation_events WHERE request_id=? ORDER BY id",[operation.request_id]):query(this.db,"SELECT state,note,actor,recorded_at AS recordedAt FROM internet_renewal_events WHERE bill_id=? ORDER BY id",[id]).map(event=>event.state===CREDIT_EVENT?{...event,note:CREDIT_HISTORY_NOTE}:event); }
}
module.exports = { initializeRenewals, RenewalLedger, PlanChangeLedger,portalBillCost,LIVE_COST_SOURCE };
