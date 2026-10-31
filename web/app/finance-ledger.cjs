// Local bookkeeping only. No Whish/API transfers or portal actions are sent.
const crypto=require('node:crypto');
function query(db,sql,params=[]){const s=db.prepare(sql);try{s.bind(params);const out=[];while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
function cents(value){const n=Number(value),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n*100-c)>1e-6)throw Error('Enter a USD amount with at most two decimal places.');return c;}
function amount(value){return Math.round(Number(value)*100)/100;}
const SOURCES={sale:{table:'sales',date:'created_at',total:'subtotal',cost:'cost_total',receipt:'invoice_no'},bill:{table:'fibernetlb_bills',date:'paid_at',total:'amount',cost:'bundle_cost',receipt:'receipt_no'},telecom:{table:'telecom_payments',date:'paid_at',total:'amount',cost:'cost',receipt:'receipt_no'},installation:{table:'installation_payments',date:'paid_at',total:'amount',cost:'0',receipt:'receipt_no'}};
function initializeFinance(db){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL,effective_at TEXT NOT NULL,actor_key TEXT NOT NULL,from_key TEXT,to_key TEXT,amount_cents INTEGER NOT NULL,note TEXT NOT NULL,input_json TEXT NOT NULL,result_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_wallet_entries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,wallet_id TEXT NOT NULL,account_key TEXT NOT NULL,amount_cents INTEGER NOT NULL,effective_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_receipt_owners(kind TEXT NOT NULL,record_key TEXT NOT NULL,original_user_id INTEGER,original_name TEXT,owner_key TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(kind,record_key));
 CREATE TABLE IF NOT EXISTS finance_months(month TEXT PRIMARY KEY,closed_at TEXT NOT NULL,actor_key TEXT NOT NULL,actor_name TEXT NOT NULL,backup_path TEXT NOT NULL,archive_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_whish_corrections(kind TEXT NOT NULL,record_key TEXT NOT NULL,original_json TEXT NOT NULL,corrected_at TEXT NOT NULL,backup_path TEXT NOT NULL,PRIMARY KEY(kind,record_key));
 CREATE INDEX IF NOT EXISTS finance_wallet_owner ON finance_wallet_entries(account_key,wallet_id,effective_at);`);
 // SQL-level locks also protect older LAN clients and direct handler paths.
 for(const [kind,type] of Object.entries(SOURCES)){
  const immutable=kind==='installation'?['amount','paid_at','user_id','payment_method','customer_account']:['user_id',type.total,type.cost,type.date,'reset_id','payment_method','customer_name',kind==='telecom'?'phone':'customer_account'];
  const cols=query(db,`PRAGMA table_info(${type.table})`).map(c=>c.name);
  const changed=immutable.filter(c=>cols.includes(c)).map(c=>`NEW.${c} IS NOT OLD.${c}`).join(' OR ');
  db.exec(`CREATE TRIGGER IF NOT EXISTS finance_${kind}_insert BEFORE INSERT ON ${type.table} WHEN substr(NEW.${type.date},1,7)<=(SELECT MAX(month) FROM finance_months) BEGIN SELECT RAISE(ABORT,'This monthly ledger is closed. Record the transaction in an open month.'); END;
  CREATE TRIGGER IF NOT EXISTS finance_${kind}_update BEFORE UPDATE ON ${type.table} WHEN (substr(OLD.${type.date},1,7)<=(SELECT MAX(month) FROM finance_months) AND (${changed})) OR (NEW.${type.date} IS NOT OLD.${type.date} AND substr(NEW.${type.date},1,7)<=(SELECT MAX(month) FROM finance_months)) BEGIN SELECT RAISE(ABORT,'Closed-month receipts cannot be edited, archived again, or handed over.'); END;
  CREATE TRIGGER IF NOT EXISTS finance_${kind}_delete BEFORE DELETE ON ${type.table} WHEN substr(OLD.${type.date},1,7)<=(SELECT MAX(month) FROM finance_months) BEGIN SELECT RAISE(ABORT,'Closed-month receipts are read-only.'); END;`);
 }
 for(const [table,date] of [['expenses','expense_date'],['purchase_receipts','purchase_date'],['debt_payments','received_at'],['cash_drawer_transactions','created_at']]){
  for(const action of ['INSERT','UPDATE','DELETE']){const test=action==='INSERT'?`substr(NEW.${date},1,7)`:action==='DELETE'?`substr(OLD.${date},1,7)`:`MIN(substr(OLD.${date},1,7),substr(NEW.${date},1,7))`;
   db.exec(`CREATE TRIGGER IF NOT EXISTS finance_lock_${table}_${action} BEFORE ${action} ON ${table} WHEN ${test}<=(SELECT MAX(month) FROM finance_months) BEGIN SELECT RAISE(ABORT,'This monthly ledger is closed and read-only. Debts can be collected in an open month.'); END;`);
  }
 }
}
function latestMonth(db){return query(db,'SELECT MAX(month) AS month FROM finance_months')[0].month||'';}
function monthRange(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))throw Error('Select a valid accounting month.');const [year,m]=month.split('-').map(Number);if(year<2000||year>2199)throw Error('Select a valid accounting year.');const end=new Date(Date.UTC(year,m,0)).getUTCDate();return {start:`${month}-01`,end:`${month}-${end}`,opening:new Date(Date.UTC(year,m,1)).toISOString().slice(0,10)+'T00:00:00'};}
function assertOpen(db,date){if(String(date).slice(0,7)<=latestMonth(db))throw Error('This ledger is closed. Use an open accounting month.');}
function pendingActions(db){
 const out=[];
 for(const [table,source] of [['shared_maintenance_operations','shared_maintenance'],['funded_stock_purchase_intents','funded_stock_purchase']])if(query(db,"SELECT name FROM sqlite_master WHERE name=?",[table]).length)out.push(...query(db,`SELECT request_id AS requestId,state,created_at AS recordedAt FROM ${table} WHERE state<>'completed'`).map(row=>({...row,source})));
 for(const [table,time] of [['internet_renewals','requested_at'],['internet_plan_changes','recorded_at'],['portal_operations','recorded_at']]){
  const exists=query(db,"SELECT name FROM sqlite_master WHERE name=?",[table]).length;if(!exists)continue;
  const states=table==='portal_operations'?"'checking','processing','unknown','confirmed'":"'checking','processing','unknown'";
  out.push(...query(db,`SELECT state,${time} AS recordedAt FROM ${table} WHERE state IN (${states})`).map(r=>({...r,source:table})));
 }
 if(query(db,"SELECT name FROM sqlite_master WHERE name='reseller_money_journal'").length)out.push(...query(db,"SELECT state,recorded_at AS recordedAt FROM reseller_money_journal WHERE state='held'").map(r=>({...r,source:'reseller_funding_reservation'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='reseller_collections'").length)out.push(...query(db,"SELECT state,created_at AS recordedAt FROM reseller_collections WHERE state NOT IN ('completed','cancelled')").map(r=>({...r,source:'reseller_collection'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='reseller_wallet_reconciliations'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM reseller_wallet_reconciliations WHERE state NOT IN ('completed','cancelled')").map(r=>({...r,source:'reseller_wallet_reconciliation'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='reseller_admin_wallet_corrections'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM reseller_admin_wallet_corrections WHERE state NOT IN ('completed','cancelled')").map(r=>({...r,source:'reseller_admin_wallet_correction'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='bandwidth_payment_intents'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM bandwidth_payment_intents WHERE state<>'completed'").map(r=>({...r,source:'bandwidth_payment'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='fixed_monthly_payment_intents'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM fixed_monthly_payment_intents WHERE state<>'completed'").map(r=>({...r,source:'fixed_monthly_payment'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='fixed_monthly_payment_attempts'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM fixed_monthly_payment_attempts WHERE state<>'completed'").map(r=>({...r,source:'fixed_monthly_payment'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='fixed_monthly_reversal_intents'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM fixed_monthly_reversal_intents WHERE state<>'completed'").map(r=>({...r,source:'fixed_monthly_reversal'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='fixed_monthly_category_requests'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM fixed_monthly_category_requests WHERE state<>'completed'").map(r=>({...r,source:'fixed_monthly_category'})));
 if(query(db,"SELECT name FROM sqlite_master WHERE name='company_debt_business_requests'").length)out.push(...query(db,"SELECT request_id AS requestId,state,created_at AS recordedAt FROM company_debt_business_requests WHERE state<>'completed'").map(r=>({...r,source:'company_debt_business'})));
 for(const table of ['company_debt_payment_intents','company_debt_partial_payment_intents'])if(query(db,"SELECT name FROM sqlite_master WHERE name=?",[table]).length)out.push(...query(db,`SELECT request_id AS requestId,state,created_at AS recordedAt FROM ${table} WHERE state<>'completed'`).map(r=>({...r,source:'company_debt_payment'})));
 return out;
}
function archivedRange(db,start,end,key=null){
 const closed=months(db).filter(m=>m.month>=start.slice(0,7)&&m.month<=end.slice(0,7));
 if(!closed.length)return null;
 const reports=[];
 for(const m of closed){const saved=archive(db,m.month,key);for(const day of saved.daily)if(day.date>=start&&day.date<=end)reports.push({date:day.date,report:day.report});}
 return {reports,months:closed.map(m=>m.month)};
}
function walletBalances(db,destinations,accountKey=null,through=null){
 const balances=new Map(destinations.map(d=>[d.id,{...d,balance:0,gross:0,fees:0}]));
 const add=(id,value,details={})=>{const prior=balances.get(id)||{id,label:details.label||'Historical wallet',number:details.number||'',active:0,balance:0,gross:0,fees:0};prior.balance=amount(prior.balance+value);prior.gross=amount(prior.gross+(details.gross||0));prior.fees=amount(prior.fees+(details.fee||0));balances.set(id,prior);};
 const limit=through?`${through}T23:59:59`:null;
 for(const [kind,type] of Object.entries(SOURCES)){
  const active=kind==='installation'?type.table:`active_${type.table}`;
  for(const row of query(db,`SELECT p.snapshot_json,u.account_key,b.${type.date} AS at FROM payment_destinations p JOIN ${active} b ON CAST(b.id AS TEXT)=p.record_key LEFT JOIN users u ON u.id=b.user_id WHERE p.kind=? AND b.payment_method='Whish Money'`,[kind])){
   if(accountKey!==null&&row.account_key!==accountKey||limit&&row.at>limit)continue;
   const snap=JSON.parse(row.snapshot_json);if(snap.id)add(snap.id,Number(snap.walletAmount??snap.netCollected??0),snap);
  }
 }
 for(const row of query(db,"SELECT p.snapshot_json,u.account_key,d.received_at AS at,d.kind,d.record_id FROM payment_destinations p JOIN debt_payments d ON d.id=p.record_key LEFT JOIN users u ON u.id=d.user_id WHERE p.kind='debt' AND d.payment_method='Whish Money'")){
  if(accountKey!==null&&row.account_key!==accountKey||limit&&row.at>limit)continue;
  const type=SOURCES[row.kind];if(!type||!query(db,`SELECT id FROM active_${type.table} WHERE id=?`,[row.record_id]).length)continue;
  const snap=JSON.parse(row.snapshot_json);if(snap.id)add(snap.id,Number(snap.walletAmount??snap.netCollected??0),snap);
 }
 const feeAudits=query(db,"SELECT name FROM sqlite_master WHERE name='finance_receipt_fee_policy_audit'").length?new Set(query(db,'SELECT id FROM finance_receipt_fee_policy_audit').map(r=>r.id)):null;
 const activeFeeAudits=feeAudits?new Set(query(db,'SELECT id FROM active_whish_fee_migration_audit').map(r=>r.id)):null;
 const grossAudits=query(db,"SELECT name FROM sqlite_master WHERE name='finance_whish_gross_restorations'").length?new Set(query(db,'SELECT id FROM finance_whish_gross_restorations').map(r=>r.id)):null;
 const activeGrossAudits=grossAudits?new Set(query(db,'SELECT id FROM active_whish_wallet_gross_audit').map(r=>r.id)):null;
 const voidWalletEvents=query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='pos_invoice_void_wallet'").length?new Set(query(db,'SELECT event_id FROM pos_invoice_void_wallet').map(row=>row.event_id)):null;
 for(const row of query(db,'SELECT * FROM finance_wallet_entries'))if((accountKey===null||row.account_key===accountKey)&&(!limit||row.effective_at<=limit)){
  // The marker stores the exact entry ID, despite its historical event_id
  // column name. Shared event groups must retain unrelated wallet entries.
  if(voidWalletEvents?.has(row.id))continue;
  // Test-receipt archives exclude their linked transition fee just as they
  // exclude the original wallet receipt. The immutable audit remains stored.
  if(feeAudits?.has(row.event_id)&&!activeFeeAudits.has(row.event_id))continue;
  if(grossAudits?.has(row.event_id)&&!activeGrossAudits.has(row.event_id))continue;
  add(row.wallet_id,row.amount_cents/100);
 }
 return [...balances.values()];
}
function drawerBalance(db,userId=null,through=null){const terms=[],params=[];if(userId!==null){terms.push('user_id=?');params.push(userId);}if(through){terms.push('date(created_at)<=?');params.push(through);}return amount(query(db,`SELECT COALESCE(SUM(amount),0) AS balance FROM active_cash_drawer_transactions ${terms.length?'WHERE '+terms.join(' AND '):''}`,params)[0].balance);}
function priorEvent(db,input,actor){if(!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId||''))throw Error('Invalid finance request.');const row=query(db,'SELECT * FROM finance_events WHERE id=?',[input.requestId])[0];if(row){if(row.actor_key!==actor.account_key||row.input_json!==JSON.stringify(input))throw Error('This request was already used for another operation.');return JSON.parse(row.result_json);}return null;}
function event(db,input,actor,kind,now,result,from=null,to=null){db.run('INSERT INTO finance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',[input.requestId,kind,now,now,actor.account_key,from,to,cents(result.amount??result.balance??0),String(input.note||'').trim(),JSON.stringify(input),JSON.stringify(result)]);}
function cashMovement(db,value,type,id,now,user,note){if(value)db.run('INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,reference_id,note,created_at,user_id,user_name) VALUES(?,?,?,?,?,?,?,?)',[value,type,'finance',null,`${id} · ${note}`,now,user.id,user.full_name]);}
function walletMove(db,input,actor,owner,recipient,destinations,now){const prior=priorEvent(db,input,actor);if(prior)return {...prior,idempotent:true};assertOpen(db,now);const kind=input.kind;if(!['wallet_transfer','wallet_cashout','wallet_adjustment'].includes(kind))throw Error('Choose a valid wallet movement.');const source=destinations.find(d=>d.id===input.fromWallet),target=destinations.find(d=>d.id===input.toWallet&&d.active);if(!source||kind==='wallet_transfer'&&(!target||source.id===target.id))throw Error('Choose valid, different wallets.');const value=cents(input.amount);if(value<=0&&kind!=='wallet_adjustment')throw Error('Enter a positive transfer amount.');if(kind==='wallet_cashout'&&!recipient?.active)throw Error('Choose an active receiving employee.');if(!String(input.note||'').trim())throw Error('Enter a bookkeeping note.');
 const available=walletBalances(db,destinations,owner.account_key).find(w=>w.id===source.id)?.balance||0;if(kind!=='wallet_adjustment'&&value>cents(available))throw Error(`Only $${available.toFixed(2)} is available for this employee in this wallet.`);
 // Receipt fees affect profit only. Cash-out moves recorded wallet custody
 // unchanged and never creates a second fee expense.
 const fee=0,net=value;
 db.exec('BEGIN TRANSACTION');try{const put=(suffix,wallet,n)=>db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[`${input.requestId}-${suffix}`,input.requestId,wallet,owner.account_key,n,now]);put('from',source.id,kind==='wallet_adjustment'?value:-value);if(kind==='wallet_transfer')put('to',target.id,value);if(kind==='wallet_cashout'){cashMovement(db,net/100,'whish_cashout',input.requestId,now,recipient,`${source.label} · gross $${(value/100).toFixed(2)} · fee $${(fee/100).toFixed(2)} · ${input.note}`);if(fee)db.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id) VALUES(?,?,?,?,?,'whish_cashout',?)",[now.slice(0,10),'Whish Money fees',`1% cash-out fee · ${source.label} · ${input.requestId}`,fee/100,owner.id,input.requestId]);}
  const result={id:input.requestId,amount:value/100,fee:fee/100,netCash:net/100,feePolicy:'profit_only',fromWallet:source.label,toWallet:target?.label||null,owner:owner.full_name,recipient:kind==='wallet_cashout'?recipient.full_name:null,kind,createdAt:now};event(db,input,actor,kind,now,result,owner.account_key,recipient?.account_key||null);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
function history(db,accountKey=null){return query(db,`SELECT id,kind,created_at AS createdAt,actor_key AS actorKey,from_key AS fromKey,to_key AS toKey,note,result_json FROM finance_events ${accountKey?'WHERE actor_key=? OR from_key=? OR to_key=?':''} ORDER BY created_at DESC,rowid DESC LIMIT 100`,accountKey?[accountKey,accountKey,accountKey]:[]).map(r=>{const result=JSON.parse(r.result_json);return {...r,result,result_json:undefined};});}
function months(db){return query(db,'SELECT month,closed_at AS closedAt,actor_name AS actorName FROM finance_months ORDER BY month DESC');}
function archive(db,month,key=null){const row=query(db,'SELECT * FROM finance_months WHERE month=?',[month])[0];if(!row)throw Error('This month has not been closed.');const all=JSON.parse(row.archive_json),selected=key?all.employees[key]:all.all;if(!selected)throw Error('No archived report is available for this employee.');return {month,closedAt:row.closed_at,actorName:row.actor_name,report:selected.report,daily:selected.daily,closing:selected.closing,readOnly:true};}
function closeMonth(db,input,actor,destinations,employeeReports,now,backup){const range=monthRange(input.month);if(input.month>=now.slice(0,7))throw Error('Only completed months can be closed. The current month stays open.');if(input.confirmation!==`CLOSE ${input.month}`)throw Error(`Type CLOSE ${input.month} to confirm.`);if(query(db,'SELECT month FROM finance_months WHERE month=?',[input.month]).length)return archive(db,input.month);if(input.month<=latestMonth(db))throw Error('Close months in chronological order.');if(pendingActions(db).length)throw Error('Finish or reconcile pending portal actions before closing the monthly ledger.');
 const backupPath=backup(),wallets=walletBalances(db,destinations,null,range.end),employees=employeeReports.employees;const archived={...employeeReports,all:{...employeeReports.all,closing:{cash:drawerBalance(db,null,range.end),wallets}},month:input.month};
 db.exec('BEGIN TRANSACTION');try{
  for(const user of query(db,'SELECT id,full_name,account_key FROM users')){
   const cash=drawerBalance(db,user.id,range.end);cashMovement(db,-cash,'month_opening',input.month,range.opening,user,`New monthly opening after ${input.month}; historical balance archived, not withdrawn`);
   const balances=walletBalances(db,destinations,user.account_key,range.end);for(const w of balances)if(cents(w.balance))db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[`month-${input.month}-${user.id}-${w.id}`,`month-${input.month}`,w.id,user.account_key,-cents(w.balance),range.opening]);
   if(employees[user.account_key])employees[user.account_key].closing={cash,wallets:balances};
  }
  const unowned=drawerBalance(db,null,range.end)-query(db,'SELECT id FROM users').reduce((n,u)=>n+drawerBalance(db,u.id,range.end),0);if(amount(unowned))cashMovement(db,-amount(unowned),'month_opening',input.month,range.opening,{id:null,full_name:'Unassigned historical activity'},'New monthly opening');
  const totalOwned=new Map();for(const u of query(db,'SELECT account_key FROM users'))for(const w of walletBalances(db,destinations,u.account_key,range.end))totalOwned.set(w.id,amount((totalOwned.get(w.id)||0)+w.balance));for(const w of wallets){const rest=cents(amount(w.balance-(totalOwned.get(w.id)||0)));if(rest)db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[`month-${input.month}-unowned-${w.id}`,`month-${input.month}`,w.id,'__unassigned__',-rest,range.opening]);}
  db.run('INSERT INTO finance_months VALUES(?,?,?,?,?,?)',[input.month,now,actor.account_key,actor.full_name,String(backupPath),JSON.stringify(archived)]);db.exec('COMMIT');return archive(db,input.month);
 }catch(error){db.exec('ROLLBACK');throw error;}
}
// Cash custody is independent of receipt/reporting ownership from v1.33 onward.
function cashHandoverPreview(db,from,to,value){
 if(from.role==='admin'||to?.role==='admin')throw Error('Employee transfers cannot use an Admin drawer. Use Pay bill for Internet costs.');
 if(!to?.active||!to.account_key||from.account_key===to.account_key)throw Error('Choose another active employee with access to this business.');
 const balance=drawerBalance(db,from.id),transfer=cents(value);
 if(transfer<=0||transfer>cents(balance))throw Error(`Enter an amount between $0.01 and $${Math.max(0,balance).toFixed(2)}.`);
 const token=crypto.createHash('sha256').update(JSON.stringify({from:from.account_key,to:to.account_key,balance,transfer,closed:latestMonth(db)})).digest('hex');
 return {balance,amount:transfer/100,remaining:amount(balance-transfer/100),receipts:[],revenue:0,cost:0,profit:0,token};
}
function cashHandover(db,input,actor,from,to,now){
 const prior=priorEvent(db,input,actor);if(prior)return {...prior,idempotent:true};assertOpen(db,now);
 if(String(input.note||'').trim().length<3||String(input.note).length>500)throw Error('Enter a handover note (3–500 characters).');
 const preview=cashHandoverPreview(db,from,to,input.amount);
 if(input.token!==preview.token||input.confirmation!=='HAND OVER')throw Error('The amount or drawer changed. Review again and type HAND OVER.');
 db.exec('BEGIN TRANSACTION');try{
  cashMovement(db,-preview.amount,'handover_out',input.requestId,now,from,`To ${to.full_name}`);cashMovement(db,preview.amount,'handover_in',input.requestId,now,to,`From ${from.full_name}`);
  const result={...preview,from:from.full_name,to:to.full_name,fromKey:from.account_key,toKey:to.account_key,actorName:actor.full_name,id:input.requestId,createdAt:now,cashOnly:true};
  event(db,input,actor,'handover',now,result,from.account_key,to.account_key);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
function costSettlement(db,user,month){
 monthRange(month);const params=[month],owner=user? ' AND b.user_id=?':'';if(user)params.push(user.id);
 const total=amount(query(db,`SELECT COALESCE(SUM(bundle_cost),0) AS total FROM active_fibernetlb_bills b WHERE substr(paid_at,1,7)=? AND service_type IN ('Internet','Internet plan change')${owner}`,params)[0].total);
 const paid=amount(query(db,`SELECT COALESCE(SUM(amount_cents),0) AS total FROM finance_events WHERE kind='internet_cost_payment' AND substr(effective_at,1,7)=?${user?' AND from_key=?':''}`,[month,...user?[user.account_key]:[]])[0].total/100);
 return {total,paid,remaining:Math.max(0,amount(total-paid)),month};
}
function payInternetCost(db,input,actor,from,to,now){
 const prior=priorEvent(db,input,actor);if(prior)return {...prior,idempotent:true};assertOpen(db,now);
 if(from.role==='admin'||!to?.active||to.role!=='admin'||to.account_key===from.account_key)throw Error('Pay bill requires an employee drawer and the designated active Admin recipient.');
 if(pendingActions(db).length)throw Error('Reconcile pending portal actions before paying Internet costs.');
 const value=cents(input.amount),settlement=costSettlement(db,from,now.slice(0,7)),cash=drawerBalance(db,from.id);
 if(value<=0||value>cents(settlement.remaining)||value>cents(cash))throw Error(`Available cash: $${cash.toFixed(2)}; unpaid Internet cost: $${settlement.remaining.toFixed(2)}. Enter an amount within both limits.`);
 if(input.confirmation!=='PAY BILL'||String(input.note||'').trim().length<3||String(input.note).length>500)throw Error('Enter a payment note and type PAY BILL.');
 db.exec('BEGIN TRANSACTION');try{
  cashMovement(db,-value/100,'internet_cost_out',input.requestId,now,from,`Internet costs to ${to.full_name}`);cashMovement(db,value/100,'internet_cost_in',input.requestId,now,to,`Internet costs from ${from.full_name}`);
  const result={id:input.requestId,amount:value/100,from:from.full_name,to:to.full_name,remainingCost:amount(settlement.remaining-value/100),remainingCash:amount(cash-value/100),createdAt:now,cashOnly:true};
  event(db,input,actor,'internet_cost_payment',now,result,from.account_key,to.account_key);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
function cashoutFees(db,start,end,key=null){const mapped=query(db,"SELECT name FROM sqlite_master WHERE name='finance_fee_owners'").length;return query(db,`SELECT f.* FROM finance_events f ${mapped?'LEFT JOIN finance_fee_owners o ON o.event_id=f.id':''} WHERE f.kind='wallet_cashout' AND date(f.effective_at) BETWEEN ? AND ?${key?` AND ${mapped?'COALESCE(o.owner_key,f.from_key)':'f.from_key'}=?`:''} ORDER BY f.effective_at`,[start,end,...key?[key]:[]]).map(row=>{const saved=JSON.parse(row.result_json);return {...saved,fee:Number(saved.fee||0),legacyFeeUnknown:!Object.hasOwn(saved,'fee'),receivedAt:row.effective_at,actorKey:row.actor_key};});}
function whishCorrectionNeeded(db){return query(db,'SELECT snapshot_json FROM payment_destinations').some(r=>Number(JSON.parse(r.snapshot_json).fee)>0);}
function correctWhishReceipts(db,now,backupPath){
 if(!backupPath)throw Error('A verified database backup is required before correcting receipts.');
 const closed=latestMonth(db),changes=[];db.exec('BEGIN TRANSACTION');try{
  for(const row of query(db,'SELECT * FROM payment_destinations')){
   const snapshot=JSON.parse(row.snapshot_json),fee=cents(snapshot.fee||0);if(fee<=0)continue;
   const type=row.kind==='debt'?{table:'debt_payments',date:'received_at'}:SOURCES[row.kind];if(!type)throw Error('Unknown Whish receipt type; no correction committed.');
   const source=query(db,`SELECT ${type.date} AS at,user_id FROM ${type.table} WHERE id=?`,[row.record_key])[0];
   // Deleted receipts have no active wallet credit. Preserve their snapshot
   // audit, but do not invent a wallet owner or restoration movement.
   const user=source?query(db,'SELECT account_key FROM users WHERE id=?',[source.user_id])[0]:null;
   db.run('INSERT INTO finance_whish_corrections VALUES(?,?,?,?,?)',[row.kind,row.record_key,row.snapshot_json,now,String(backupPath)]);
   const updated={...snapshot,fee:0,netCollected:Number(snapshot.gross),feeRate:0,feePolicy:'cashout',correctedAt:now};
   db.run('UPDATE payment_destinations SET snapshot_json=? WHERE kind=? AND record_key=?',[JSON.stringify(updated),row.kind,row.record_key]);
   // Preserve zero monthly openings and immutable closed reports. The restored
   // historical fee is offset at the already-closed month's next opening.
   if(closed&&source&&source.at.slice(0,7)<=closed&&snapshot.id)db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[`whish-correction-${row.kind}-${row.record_key}`,'whish-policy-correction',snapshot.id,user?.account_key||'__unassigned__',-fee,monthRange(closed).opening]);
   changes.push({kind:row.kind,key:row.record_key,restoredFee:fee/100,sourceMissing:!source});
  }
  db.exec('COMMIT');return changes;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={query,initializeFinance,walletBalances,drawerBalance,handoverPreview:cashHandoverPreview,handover:cashHandover,walletMove,history,months,archive,archivedRange,closeMonth,monthRange,latestMonth,pendingActions,costSettlement,payInternetCost,cashoutFees,whishCorrectionNeeded,correctWhishReceipts};
