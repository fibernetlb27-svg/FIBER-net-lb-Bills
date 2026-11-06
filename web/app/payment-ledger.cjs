const crypto = require("node:crypto");
const {saveSnapshot,readSnapshot}=require('./whish-destinations.cjs');
const TYPES = { sale:{table:"sales",amount:"subtotal",reference:"invoice_no",date:"created_at",phone:"customer_phone",account:"customer_account"}, bill:{table:"fibernetlb_bills",amount:"amount",reference:"receipt_no",date:"paid_at",phone:"phone",account:"customer_account"}, telecom:{table:"telecom_payments",amount:"amount",reference:"receipt_no",date:"paid_at",phone:"phone",account:"provider"} };
const cents = value => Math.round(Number(value || 0) * 100);
const dollars = value => Math.round(value) / 100;
function allocatePaid(detail,portion,total) {
  const raw=[detail.cashPaid,detail.whishPaid,detail.otherPaid].map(value=>cents(value)*portion);
  const allocated=raw.map(Math.floor),target=Math.min(total,cents(detail.paidAmount*portion));
  let remainder=target-allocated.reduce((sum,value)=>sum+value,0);
  const order=raw.map((value,index)=>({index,fraction:value-Math.floor(value)})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  for(const item of order) {if(remainder<=0)break; if(raw[item.index]>0){allocated[item.index]++;remainder--;}}
  return allocated;
}
function query(db,sql,params=[]) { const statement=db.prepare(sql); try { statement.bind(params); const result=[]; while(statement.step()) result.push(statement.getAsObject()); return result; } finally { statement.free(); } }

function initializePayments(db) {
  db.run(`CREATE TABLE IF NOT EXISTS debt_payments (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('sale','bill','telecom')),
    record_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash','Whish Money')),
    received_at TEXT NOT NULL, cashier_name TEXT NOT NULL DEFAULT '',
    balance_after_cents INTEGER NOT NULL CHECK(balance_after_cents >= 0)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS debt_payments_record ON debt_payments(kind,record_id)");
  for (const [kind,type] of Object.entries(TYPES)) {
    for (const row of query(db,`SELECT id, ${type.amount} AS amount, payment_method, settled_at, cashier_name FROM ${type.table} WHERE settled_at IS NOT NULL AND payment_status = 'paid' AND payment_method IN ('Cash','Whish Money')`)) {
      if(query(db,"SELECT id FROM debt_payments WHERE kind=? AND record_id=?",[kind,row.id]).length || cents(row.amount)<=0) continue;
      // The old invoice cashier is not necessarily the person who collected it.
      db.run("INSERT INTO debt_payments (id,kind,record_id,amount_cents,payment_method,received_at,cashier_name,balance_after_cents) VALUES (?,?,?,?,?,?,?,0)",[`legacy:${kind}:${row.id}`,kind,row.id,cents(row.amount),row.payment_method,row.settled_at,"Legacy collection"]);
    }
  }
}

class PaymentLedger {
  logicalPayments(payments){
    if(!this.getUser()?.financial_ownership)return payments;
    const owners=new Map(query(this.getRawDatabase(),'SELECT o.id,u.id AS user_id FROM finance_collection_owners o JOIN users u ON u.account_key=o.owner_key').map(o=>[o.id,o.user_id]));
    return payments.map(p=>owners.has(p.id)?{...p,user_id:owners.get(p.id)}:p);
  }
  constructor(db,getUser=()=>null,getRawDatabase=()=>db) { this.db=db;this.getUser=getUser;this.getRawDatabase=getRawDatabase; this.readTables=Object.fromEntries(Object.entries(TYPES).map(([kind,type])=>[kind,query(db,"SELECT name FROM sqlite_master WHERE name=?",[`active_${type.table}`]).length?`active_${type.table}`:type.table])); }
  source(kind,id) {
    const type=TYPES[kind]; if(!type) throw new Error("Choose a valid debt record.");
    return query(this.db,`SELECT '${kind}' AS kind,id,${type.reference} AS referenceNo,${type.date} AS createdAt,${type.amount} AS originalAmount,customer_name AS customerName,${type.phone} AS phone,${type.account} AS customerAccount,payment_method AS originalMethod,payment_status AS originalStatus,settled_at AS settledAt,cashier_name AS cashierName FROM ${this.readTables[kind]} WHERE id=?`,[Number(id)])[0];
  }
  sources(category="") {
    return Object.entries(TYPES).flatMap(([kind,type]) => query(this.db,`SELECT '${kind}' AS kind,t.id,t.${type.reference} AS referenceNo,t.${type.date} AS createdAt,t.${type.amount} AS originalAmount,t.customer_name AS customerName,t.${type.phone} AS phone,t.${type.account} AS customerAccount,t.payment_method AS originalMethod,t.payment_status AS originalStatus,t.settled_at AS settledAt,t.cashier_name AS cashierName FROM ${this.readTables[kind]} t ${kind==="sale" && category ? "WHERE EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=t.id AND si.category=?)" : ""}`,kind==="sale" && category ? [category] : []));
  }
  summarize(source,payments) {
    payments=this.logicalPayments(payments);
    const whishDestination=readSnapshot(this.db,source.kind,source.id);
    const original=cents(source.originalAmount), refund=original<0, debt=!refund&&(source.originalMethod==="Unpaid" || payments.length>0);
    let cash=0,whish=0,other=0;
    if(!debt && source.originalStatus!=="unpaid") {
      if(source.originalMethod==="Cash") cash=original;
      else if(source.originalMethod==="Whish Money") whish=original;
      else other=original;
    }
    for(const p of payments) { if(p.payment_method==="Cash")cash+=p.amount_cents; else whish+=p.amount_cents; }
    const paid=Math.min(original,cash+whish+other),remaining=Math.max(0,original-paid);
    return {...source,whishDestination,isDebt:debt,isRefund:refund,originalAmount:dollars(original),paidAmount:dollars(paid),remainingAmount:dollars(remaining),amount:dollars(remaining),cashPaid:dollars(cash),whishPaid:dollars(whish),otherPaid:dollars(other),paymentStatus:remaining ? paid ? "partial" : "unpaid" : "paid",paymentMethod:cash && whish ? "Cash + Whish Money" : cash ? "Cash" : whish ? "Whish Money" : source.originalMethod,payments:payments.map(p=>({id:p.id,userId:p.user_id,amount:dollars(p.amount_cents),paymentMethod:p.payment_method,whishDestination:readSnapshot(this.db,'debt',p.id),receivedAt:p.received_at,cashierName:p.cashier_name,remainingAfter:dollars(p.balance_after_cents)}))};
  }
  details(kind,id) { const source=this.source(kind,id); if(!source)throw new Error("Debt record not found."); return this.summarize(source,query(this.db,"SELECT * FROM debt_payments WHERE kind=? AND record_id=? ORDER BY received_at,rowid",[kind,Number(id)])); }
  accounts(includePaid=false,category="") {
    const grouped=new Map();
    for(const payment of query(this.db,"SELECT * FROM debt_payments ORDER BY received_at,rowid")) { const key=`${payment.kind}:${payment.record_id}`; if(!grouped.has(key))grouped.set(key,[]); grouped.get(key).push(payment); }
    return this.sources(category).map(source=>this.summarize(source,grouped.get(`${source.kind}:${source.id}`)||[])).filter(item=>item.isDebt && (includePaid || item.remainingAmount>0)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  outstanding() { const rows=this.accounts(); return {value:dollars(rows.reduce((sum,item)=>sum+cents(item.remainingAmount),0)),count:rows.length}; }
  enrich(kind,item) { const detail=this.details(kind,item.id); return {...item,whishDestination:detail.whishDestination,isRefund:detail.isRefund,originalAmount:detail.originalAmount,paidAmount:detail.paidAmount,remainingAmount:detail.remainingAmount,cashPaid:detail.cashPaid,whishPaid:detail.whishPaid,paymentStatus:detail.paymentStatus,paymentMethod:detail.paymentMethod,paymentHistory:detail.payments}; }
  collect(kind,id,method,amountInput,requestId,receivedAt,cashierName,onCash,destination=null,onCollected=null) {
    if(!["Cash","Whish Money"].includes(method))throw new Error("Collect by Cash or Whish Money.");
    const key=requestId || crypto.randomUUID();
    if(!/^[a-zA-Z0-9-]{8,100}$/.test(key))throw new Error("Invalid payment request.");
    const preserved=require('./bill-payment-corrections.cjs').originalCollection(this.getRawDatabase(),key),prior=preserved?.payment||query(this.db,"SELECT * FROM debt_payments WHERE id=?",[key])[0];
    if(prior) {
      const user=this.getUser();if(user&&user.role!=='admin'&&Number(prior.user_id)!==Number(user.id))throw Error('This payment request belongs to another operator.');
      if(prior.kind!==kind || prior.record_id!==Number(id) || prior.payment_method!==method || (amountInput!==undefined && cents(amountInput)!==prior.amount_cents))throw new Error("This payment request was already used for another payment.");
      return {ok:true,...this.details(kind,id),amount:dollars(prior.amount_cents),idempotent:true};
    }
    const debt=this.details(kind,id);
    if(!debt.isDebt || debt.remainingAmount<=0)throw new Error("This debt is already fully paid.");
    const amount=amountInput===undefined ? debt.remainingAmount : Number(amountInput), paid=cents(amount);
    if(!Number.isFinite(amount) || !Number.isSafeInteger(paid) || paid<=0 || Math.abs(amount*100-paid)>1e-6)throw new Error("Enter a positive USD payment with no more than two decimal places.");
    if(paid>cents(debt.remainingAmount))throw new Error(`Payment exceeds the remaining debt of $${debt.remainingAmount.toFixed(2)}. Refresh the debt and try again.`);
    const remaining=cents(debt.remainingAmount)-paid, type=TYPES[kind];
    this.db.exec("BEGIN TRANSACTION");
    try {
      this.db.run("INSERT INTO debt_payments (id,kind,record_id,amount_cents,payment_method,received_at,cashier_name,balance_after_cents) VALUES (?,?,?,?,?,?,?,?)",[key,kind,Number(id),paid,method,receivedAt,cashierName || "",remaining]);
      saveSnapshot(this.db,'debt',key,destination,dollars(paid));
      if(this.getUser())this.db.run('UPDATE debt_payments SET user_id=? WHERE id=?',[this.getUser().id,key]);
      this.db.run(`UPDATE ${type.table} SET payment_status=?,settled_at=? WHERE id=?`,[remaining ? "unpaid" : "paid",remaining ? null : receivedAt,Number(id)]);
      if(method==="Cash")onCash(dollars(paid),debt.referenceNo);
      // Budget allocations must commit in the same customer-payment transaction.
      // They never create a second physical receipt or alter the customer debt.
      if(onCollected)onCollected({detail:this.details(kind,id),amount:dollars(paid),paymentId:key});
      this.db.exec("COMMIT");
    } catch(error) { this.db.exec("ROLLBACK"); throw error; }
    return {ok:true,...this.details(kind,id),amount:dollars(paid),receivedAt,requestId:key};
  }
  remove(kind,id) { this.db.run("DELETE FROM debt_payments WHERE kind=? AND record_id=?",[kind,Number(id)]); }
  report(start,end,category="") {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error("Choose a valid report date range.");
    const between=value=>value?.slice(0,10)>=start && value.slice(0,10)<=end;
    const allPayments=this.logicalPayments(query(this.db,"SELECT * FROM debt_payments ORDER BY received_at,rowid")), grouped=new Map();
    for(const p of allPayments) {const key=`${p.kind}:${p.record_id}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);}
    const result={cashPaid:0,whishPaid:0,otherPaid:0,periodDebt:0,paymentTotal:0,cashReceived:0,whishReceived:0,otherReceived:0,collectionsTotal:0,cashRefunded:0,whishRefunded:0,refundsTotal:0,refundPayments:[],debtAccounts:[],debtPayments:[]};
    result.whishPayments=[];result.whishFees=0;
    const sources=this.sources(category),user=this.getUser();
    // Collection custody can change without moving a closed original invoice.
    if(user&&user.role!=='admin')for(const payment of allPayments.filter(p=>Number(p.user_id)===Number(user.id)&&between(p.received_at))){
      if(sources.some(s=>s.kind===payment.kind&&s.id===payment.record_id))continue;
      const type=TYPES[payment.kind];if(!type)continue;
      const raw=this.getRawDatabase(),source=query(raw,`SELECT '${payment.kind}' AS kind,t.id,t.${type.reference} AS referenceNo,t.${type.date} AS createdAt,t.${type.amount} AS originalAmount,t.customer_name AS customerName,t.${type.phone} AS phone,t.${type.account} AS customerAccount,t.payment_method AS originalMethod,t.payment_status AS originalStatus,t.settled_at AS settledAt,t.cashier_name AS cashierName FROM ${this.readTables[payment.kind]} t WHERE t.id=? ${category&&payment.kind==='sale'?'AND EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=t.id AND si.category=?)':''}`,[payment.record_id,...(category&&payment.kind==='sale'?[category]:[])])[0];
      if(source)sources.push({...source,collectionOnly:true});
    }
    for(const source of sources) {
      const detail=this.summarize(source,grouped.get(`${source.kind}:${source.id}`)||[]);
      const user=this.getUser(),issued=!source.collectionOnly&&between(source.createdAt), collected=detail.payments.filter(p=>between(p.receivedAt)&&(!user||user.role==='admin'||Number(p.userId)===Number(user.id)));
      let portion=1;
      if(category && source.kind==="sale") {
        const lineTotal=query(this.db,"SELECT COALESCE(SUM(line_total),0) AS total FROM sale_items WHERE sale_id=? AND category=?",[source.id,category])[0].total;
        portion=source.originalAmount ? lineTotal/source.originalAmount : 0;
      }
      if(issued) {
        if(!detail.isDebt&&source.originalMethod==='Whish Money'){
          const fee=cents(detail.whishDestination?.fee||0)*portion;result.whishFees+=fee;
          result.whishReceived-=fee;
          result.whishPayments.push({referenceNo:source.referenceNo,kind:source.kind,receivedAt:source.createdAt,customerName:source.customerName,amount:dollars(cents(source.originalAmount*portion)),cashierName:source.cashierName,whishDestination:detail.whishDestination,fee:dollars(fee),netCollected:dollars(cents(source.originalAmount*portion)-fee)});
        }
        const total=cents(source.originalAmount*portion);result.paymentTotal+=total;
        // Allocate integer cents without letting separate method rounding create negative debt.
        const [cash,whish,other]=allocatePaid(detail,portion,total),paid=cash+whish+other;
        result.cashPaid+=cash;result.whishPaid+=whish;result.otherPaid+=other;result.periodDebt+=total-paid;
        if(!detail.isDebt) {result.cashReceived+=cash;result.whishReceived+=whish;result.otherReceived+=other;}
        if(detail.isRefund) {
          result.cashRefunded-=cash;result.whishRefunded-=whish;
          result.refundPayments.push({kind:source.kind,recordId:source.id,referenceNo:source.referenceNo,customerName:source.customerName,customerAccount:source.customerAccount,receivedAt:source.createdAt,paymentMethod:detail.paymentMethod,amount:dollars(-total),cashierName:source.cashierName});
        }
      }
      for(const payment of collected) {
        if(payment.paymentMethod==='Whish Money'){
          const fee=cents(payment.whishDestination?.fee||0)*portion;result.whishFees+=fee;result.whishReceived-=fee;
          result.whishPayments.push({...payment,referenceNo:source.referenceNo,kind:source.kind,customerName:source.customerName,amount:dollars(cents(payment.amount*portion)),fee:dollars(fee),netCollected:dollars(cents(payment.amount*portion)-fee)});
        }
        result[payment.paymentMethod==="Cash" ? "cashReceived" : "whishReceived"]+=cents(payment.amount*portion);
        result.debtPayments.push({...payment,kind:source.kind,recordId:source.id,referenceNo:source.referenceNo,customerName:source.customerName,customerAccount:source.customerAccount,originalAmount:detail.originalAmount,totalPaid:detail.paidAmount,remainingAmount:detail.remainingAmount});
      }
      if(detail.isDebt && (issued || collected.length || detail.remainingAmount>0)) result.debtAccounts.push(detail);
    }
    for(const field of ["cashPaid","whishPaid","otherPaid","periodDebt","paymentTotal","cashReceived","whishReceived","otherReceived","cashRefunded","whishRefunded"])result[field]=dollars(result[field]);
    result.collectionsTotal=dollars(cents(result.cashReceived)+cents(result.whishReceived)+cents(result.otherReceived));
    result.whishFees=dollars(result.whishFees);result.grossWhishReceived=dollars(cents(result.whishReceived)+cents(result.whishFees));
    result.refundsTotal=dollars(result.refundPayments.reduce((sum,p)=>sum+cents(p.amount),0));
    result.refundPayments.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    result.debtPayments.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    return result;
  }
  csv(report) {
    const q=value=>`"${String(value??'').replaceAll('"','""')}"`;
    const cashouts=['','WHISH CASH-OUT HISTORY - new cash-outs have no additional fee; historical fees remain unchanged','Date,Wallet,Wallet owner,Receiving drawer,Wallet debit USD,Fee USD,Net cash USD',...(report.whishCashouts||[]).map(c=>[c.receivedAt,c.fromWallet,c.owner,c.recipient,c.amount,c.fee,c.netCash].map(q).join(','))].join('\r\n');
    const corrections=['','OLDER UNCOLLECTED WHISH PAYMENTS - one-time current-date fee adjustments; original receipts and closed reports unchanged','Correction date,Type,Original record,Wallet,Wallet number,Remaining gross principal USD,Prepaid fee USD,Remaining net principal USD,Current reporting employee,Original correction employee',...(report.whishReceiptCorrections||[]).map(p=>[p.receivedAt,p.kind,p.key,p.walletLabel,p.walletNumber,p.gross,p.fee,p.netCollected,p.owner,p.originalOwner||p.owner].map(q).join(','))].join('\r\n');
    const restored=['','GROSS WHISH WALLET RESTORATIONS - balance corrections only; profit fees and original records unchanged','Date,Type,Original record,Wallet,Employee,Restored wallet amount USD,Corrected gross principal USD',...(report.whishWalletRestorations||[]).map(p=>[p.receivedAt,p.kind,p.key,p.walletLabel,p.owner,p.restoredFee??p.amount,p.grossWalletPrincipal].map(q).join(','))].join('\r\n');
    return cashouts+'\r\n'+corrections+'\r\n'+restored+'\r\n'+this.baseCsv(report)+['','WHISH MONEY - destination recorded; no money transferred by the app; new fees affect profit only, wallets receive gross payment','Date,Type,Reference,Customer,Destination name,Destination number,Gross paid USD,Profit fee USD,After-fee amount USD,Cashier',...(report.whishPayments||[]).map(p=>[p.receivedAt,p.kind,p.referenceNo,p.customerName,p.whishDestination?.label||'Legacy / not specified',p.whishDestination?.number||'',p.amount,p.fee||0,p.netCollected??p.amount,p.cashierName].map(q).join(','))].join('\r\n');
  }
  baseCsv(report) {
    const quote=value=>`"${String(value??"").replaceAll('"','""')}"`, row=values=>values.map(quote).join(",");
    return ["","PAYMENT BREAKDOWN - invoices issued in selected dates; balances as of now; refunds subtract from paid totals","Net Cash paid,Net Whish Money paid,Other legacy paid,Remaining debt,Net total invoiced",row([report.cashPaid,report.whishPaid,report.otherPaid,report.periodDebt,report.paymentTotal]),"","NET MONEY RECEIVED IN SELECTED DATES - includes collections of older debts minus refunds","Net Cash received,Net Whish Money received,Other legacy received,Net total received",row([report.cashReceived,report.whishReceived,report.otherReceived,report.collectionsTotal]),"","CUSTOMER REFUNDS - already deducted from net money received and revenue; do not deduct twice","Cash refunded USD,Whish Money refunded USD,Total refunded USD",row([report.cashRefunded,report.whishRefunded,report.refundsTotal]),"Date,Type,Reference,Customer,Account,Refund method,Amount refunded USD,Cashier",...(report.refundPayments||[]).map(p=>row([p.receivedAt,p.kind,p.referenceNo,p.customerName,p.customerAccount,p.paymentMethod,p.amount,p.cashierName])),"","CUSTOMER DEBT ACCOUNTS - full record totals","Type,Reference,Customer,Account,Recorded,Original amount USD,Paid USD,Remaining USD,Status",...report.debtAccounts.map(d=>row([d.kind,d.referenceNo,d.customerName,d.customerAccount,d.createdAt,d.originalAmount,d.paidAmount,d.remainingAmount,d.paymentStatus])),"","DEBT COLLECTION HISTORY - payments received in selected dates","Date,Type,Reference,Customer,Account,Payment method,Amount received USD,Balance after payment USD,Cashier",...report.debtPayments.map(p=>row([p.receivedAt,p.kind,p.referenceNo,p.customerName,p.customerAccount,p.paymentMethod,p.amount,p.remainingAfter,p.cashierName]))].join("\r\n");
  }
}
module.exports={PaymentLedger,initializePayments};
