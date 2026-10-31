'use strict';
const crypto=require('node:crypto'),Finance=require('./finance-ledger.cjs');
const sources={sale:{table:'active_sales',date:'created_at',amount:'subtotal',cost:'cost_total',reference:'invoice_no'},bill:{table:'active_fibernetlb_bills',date:'paid_at',amount:'amount',cost:'bundle_cost',reference:'receipt_no'},telecom:{table:'active_telecom_payments',date:'paid_at',amount:'amount',cost:'cost',reference:'receipt_no'},installation:{table:'installation_payments',date:'paid_at',amount:'amount',cost:'0',reference:'receipt_no'},expense:{table:'expenses',date:'expense_date',amount:'amount',cost:'amount',reference:'description'},purchase:{table:'purchase_receipts',date:'purchase_date',amount:'total',cost:'total',reference:'receipt_no'}};
const query=Finance.query,cents=n=>{const value=Math.round(Number(n)*100);if(!Number.isSafeInteger(value)||Math.abs(value)>100000000)throw Error('Invalid handover amount.');return value;};
function initializeSupport(db){db.exec(`CREATE TABLE IF NOT EXISTS finance_collection_owners(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,event_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_fee_owners(event_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,handover_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_receipt_copies(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,kind TEXT NOT NULL,record_key TEXT NOT NULL,support_key TEXT NOT NULL,cashier_key TEXT NOT NULL,original_name TEXT NOT NULL,recorded_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,UNIQUE(event_id,kind,record_key));`);}
function ownedRows(db,from){const closed=Finance.latestMonth(db),out=[];
 for(const [kind,type]of Object.entries(sources)){
  const exists=query(db,'SELECT name FROM sqlite_master WHERE name=?',[type.table]).length;if(!exists)continue;
  for(const row of query(db,`SELECT s.* FROM ${type.table} s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN finance_receipt_owners f ON f.kind=? AND f.record_key=CAST(s.id AS TEXT) WHERE COALESCE(f.owner_key,u.account_key)=?`,[kind,from.account_key])){
   // Closed reports remain immutable. Carry unpaid invoices as current debt responsibility.
   const unpaid=['sale','bill','telecom'].includes(kind)&&['unpaid','partial'].includes(row.payment_status);
   if(String(row[type.date]).slice(0,7)<=closed&&!unpaid)continue;
   out.push({kind,id:row.id,reference:row[type.reference]||`${kind}-${row.id}`,date:row[type.date],amount:Number(row[type.amount]||0),cost:type.cost==='0'?0:Number(row[type.cost]||0),originalName:row.cashier_name||row.recorded_by||from.full_name,originalUsername:query(db,'SELECT username FROM users WHERE id=?',[row.user_id])[0]?.username||from.username,row});
  }
 }return out;
}
function checkPeople(from,to){if(from.role!=='support'||!from.active)throw Error('Only an active Support account can end its day.');if(!to?.active||to.role!=='cashier'||!to.account_key||to.account_key===from.account_key)throw Error('Choose an active Cashier assigned to this business.');}
function collections(db,from){return query(db,`SELECT p.* FROM debt_payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN finance_collection_owners o ON o.id=p.id WHERE COALESCE(o.owner_key,u.account_key)=? AND substr(p.received_at,1,7)>? ORDER BY p.id`,[from.account_key,Finance.latestMonth(db)]);}
function preview(db,from,to,destinations){checkPeople(from,to);if(Finance.pendingActions(db).length)throw Error('Resolve unfinished portal actions before ending the day.');
 const cash=Finance.drawerBalance(db,from.id),wallets=Finance.walletBalances(db,destinations,from.account_key).filter(w=>cents(w.balance)!==0),receipts=ownedRows(db,from),collectionRows=collections(db,from),collectionIds=collectionRows.map(r=>r.id);
 if(cash<0||wallets.some(w=>w.balance<0))throw Error('Resolve negative cash or wallet balances before ending the day.');
 if(!cash&&!wallets.length&&!receipts.length&&!collectionIds.length)throw Error('There is no new cash, wallet balance or activity to hand over.');
 const token=crypto.createHash('sha256').update(JSON.stringify({from:from.account_key,to:to.account_key,closed:Finance.latestMonth(db),cash,wallets:wallets.map(w=>[w.id,w.balance]),receipts:receipts.map(r=>[r.kind,r.id,r.row]),collectionRows})).digest('hex');
 return {fromKey:from.account_key,toKey:to.account_key,from:from.full_name,to:to.full_name,cash,wallets:wallets.map(({id,label,number,balance})=>({id,label,number,balance})),receipts:receipts.map(({row,...r})=>r),collectionIds,token,amount:cash,walletTotal:wallets.reduce((sum,w)=>sum+cents(w.balance),0)/100,fee:0};
}
function endDay(db,input,actor,from,to,destinations,now){checkPeople(from,to);if(actor.account_key!==from.account_key)throw Error('Support can end only its own day.');if(!/^[A-Za-z0-9-]{8,100}$/.test(input.requestId||''))throw Error('Invalid end-of-day request.');
 const prior=query(db,'SELECT * FROM finance_events WHERE id=?',[input.requestId])[0];if(prior){if(prior.kind!=='end_of_day'||prior.actor_key!==actor.account_key||prior.input_json!==JSON.stringify(input))throw Error('This request already has other details.');return {...JSON.parse(prior.result_json),idempotent:true};}
 if(now.slice(0,7)<=Finance.latestMonth(db))throw Error('The current monthly ledger is closed.');const p=preview(db,from,to,destinations);
 if(input.confirmation!=='END DAY'||p.token!==input.token)throw Error('Cash, wallets or activity changed. Review the end of day again.');if(String(input.note||'').trim().length<3||String(input.note).length>500)throw Error('Enter an end-of-day note (3–500 characters).');
 const rows=ownedRows(db,from),result={...p,id:input.requestId,createdAt:now,copyCount:rows.length,originalOperator:from.full_name,originalOperatorUsername:from.username,receiptResponsibility:true,walletResponsibilityOnly:true};
 db.exec('BEGIN');try{
  for(const sign of [-1,1])if(cents(p.cash)){const u=sign<0?from:to;db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,reference_id,note,created_at,user_id,user_name) VALUES(?,?,'finance',NULL,?,?,?,?)",[sign*p.cash,sign<0?'end_day_out':'end_day_in',`${input.requestId} · ${from.full_name} → ${to.full_name}`,now,u.id,u.full_name]);}
  for(const w of p.wallets)for(const sign of [-1,1])db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',[`${input.requestId}-${w.id}-${sign}`,input.requestId,w.id,sign<0?from.account_key:to.account_key,sign*cents(w.balance),now]);
  for(const r of rows){
   const snapshot={...r};if(r.kind==='sale')snapshot.items=query(db,'SELECT * FROM sale_items WHERE sale_id=? ORDER BY id',[r.id]);if(['sale','bill','telecom'].includes(r.kind))snapshot.collections=query(db,'SELECT * FROM debt_payments WHERE kind=? AND record_id=? ORDER BY received_at,id',[r.kind,r.id]);
   db.run('INSERT INTO finance_receipt_copies(event_id,kind,record_key,support_key,cashier_key,original_name,recorded_at,snapshot_json) VALUES(?,?,?,?,?,?,?,?)',[input.requestId,r.kind,String(r.id),from.account_key,to.account_key,r.originalName,now,JSON.stringify(snapshot)]);
   db.run('INSERT INTO finance_receipt_owners VALUES(?,?,?,?,?,?) ON CONFLICT(kind,record_key) DO UPDATE SET owner_key=excluded.owner_key,event_id=excluded.event_id',[r.kind,String(r.id),r.row.user_id,r.originalName,to.account_key,input.requestId]);
  }
  for(const id of p.collectionIds)db.run('INSERT OR REPLACE INTO finance_collection_owners VALUES(?,?,?)',[id,to.account_key,input.requestId]);
  for(const fee of query(db,"SELECT f.id FROM finance_events f LEFT JOIN finance_fee_owners o ON o.event_id=f.id WHERE f.kind='wallet_cashout' AND COALESCE(o.owner_key,f.from_key)=? AND substr(f.effective_at,1,7)>?",[from.account_key,Finance.latestMonth(db)]))db.run('INSERT OR REPLACE INTO finance_fee_owners VALUES(?,?,?)',[fee.id,to.account_key,input.requestId]);
  db.run('INSERT INTO finance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',[input.requestId,'end_of_day',now,now,actor.account_key,from.account_key,to.account_key,cents(p.cash),input.note,JSON.stringify(input),JSON.stringify(result)]);
  db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
function copies(db,key){return query(db,'SELECT id,event_id,kind,record_key,original_name,recorded_at,cashier_key,snapshot_json FROM finance_receipt_copies WHERE support_key=? ORDER BY id DESC LIMIT 500',[key]).map(r=>{const s=JSON.parse(r.snapshot_json);return {id:r.id,eventId:r.event_id,kind:r.kind,reference:s.reference,date:s.date,amount:s.amount,originalName:r.original_name,handedOverAt:r.recorded_at,cashierKey:r.cashier_key};});}
function copy(db,key,id){const item=query(db,'SELECT * FROM finance_receipt_copies WHERE id=? AND support_key=?',[Number(id),key])[0];if(!item)throw Error('Receipt copy not found for this account.');return {...JSON.parse(item.snapshot_json),handedOverAt:item.recorded_at,cashierKey:item.cashier_key,readOnly:true};}
module.exports={initializeSupport,preview,endDay,copies,copy,sources};
