const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const {readSnapshot}=require('./whish-destinations.cjs');
const {retailSelection}=require('./src/internet-pricing.js');
function registrationInput(value,expiry){
  const text=(key,max=200)=>{const s=String(value[key]??'').trim();if(s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))throw Error(`Invalid ${key}.`);return s;};
  const username=text('username',128),name=text('name');
  if(!/^[A-Za-z0-9._@+-]{3,128}$/.test(username)||!name)throw Error('A valid username and customer full name are required.');
  const id=key=>{const n=Number(value[key]);if(!Number.isSafeInteger(n)||n<=0)throw Error(`Select a valid ${key}.`);return n;};
  const dueDate=Number(value.dueDate),discount=Number(value.discount||0),amount=Number(value.installationAmount);
  if(!Number.isSafeInteger(dueDate)||dueDate<1||dueDate>31)throw Error('Due date must be a day from 1 to 31.');
  if(!Number.isFinite(discount)||discount<0||discount>100)throw Error('Discount must be 0–100%.');
  if(!Number.isFinite(amount)||amount<0||amount>1000000||Math.abs(round(amount)-amount)>0.00001)throw Error('Installation received must be zero or a positive USD amount with two decimals.');
  if(!['Cash','Whish Money'].includes(value.installationMethod))throw Error('Installation money received must be Cash or Whish Money.');
  if(typeof value.freeStarter!=='boolean'||typeof value.overridePrice!=='boolean')throw Error('Choose valid starter/price settings.');
  const email=text('email');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');
  const price=Number(value.price||0);if(value.overridePrice&&(!Number.isFinite(price)||price<0||price>1000000))throw Error('Invalid override price.');
  const resellerUsername=text('resellerUsername',128);
  if(resellerUsername&&!/^[A-Za-z0-9._@+-]{3,128}$/.test(resellerUsername))throw Error('Select a valid Proradius reseller username.');
  // Absent owner fields remain absent for existing v1.23.0 registration replay.
  const reseller=value.resellerId||resellerUsername?{resellerId:id('resellerId'),resellerUsername}:{};
  if(reseller.resellerId&&!resellerUsername)throw Error('Select a valid Proradius reseller.');
  let billing={};
  if(value.servicePayment!==undefined){
    if(value.freeStarter)throw Error('A free starter must not include a service payment.');
    const p=value.servicePayment;
    const validMoney=(n,positive)=>typeof n==='number'&&Number.isFinite(n)&&n>=(positive?0.01:0)&&n<=1000000&&Math.abs(round(n)-n)<0.00001;
    if(!p||!validMoney(p.amount,true)||!validMoney(p.expectedPrice,true)||!validMoney(p.expectedCost,false)||!['Cash','Whish Money','Unpaid'].includes(p.paymentMethod)||typeof p.billingPeriod!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.billingPeriod)||typeof p.bundleCode!=='string'||!/^[A-Z0-9._-]{1,64}$/.test(p.bundleCode))throw Error('Enter a valid first-service amount, payment method, month and verified bundle.');
    const retailPricing=retailSelection(p.retailPricing);
    billing={servicePayment:{amount:round(p.amount),paymentMethod:p.paymentMethod,billingPeriod:p.billingPeriod,bundleCode:p.bundleCode,expectedPrice:round(p.expectedPrice),expectedCost:round(p.expectedCost),...retailPricing?{retailPricing}:{}}};
  }
  // Keep absent billing fields absent for historical registration fingerprints.
  return {username,name,service:id('service'),collector:id('collector'),switch:id('switch'),phone:text('phone',40),email,address:text('address'),region:text('region'),nationality:text('nationality',80),building:text('building'),note:text('note',500),dueDate,discount,overridePrice:value.overridePrice,price:value.overridePrice?round(price):0,freeStarter:value.freeStarter,starterExpiry:value.freeStarter?expiry:null,installationAmount:round(amount),installationMethod:value.installationMethod,...reseller,...billing};
}
function query(db,sql,params=[]){const s=db.prepare(sql);s.bind(params);const list=[];try{while(s.step())list.push(s.getAsObject());}finally{s.free();}return list;}
function registrationBillCost(quote){
  // v1.23.2 saved the fixed cost. Keep that snapshot for historical recovery;
  // new quotes explicitly snapshot the selected reseller's current internal cost.
  const cost=quote?.billCost??quote?.fixedCost;
  if(!Number.isFinite(cost)||cost<0)throw Error('The initial service bill has no verified cost snapshot.');
  return round(cost);
}
function starterExpiry(now=new Date()){
  // Store policy: following calendar month's 5th, including signups on days 1–5.
  // Use Beirut's date, not the timezone of a remote/Windows client.
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit'}).formatToParts(now);
  let year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value)+1;
  if(month===13){month=1;year++;}
  return `${year}-${String(month).padStart(2,'0')}-05`;
}
function initializeCustomerRegistration(db){
  db.exec(`CREATE TABLE IF NOT EXISTS installation_payments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE REFERENCES portal_operations(request_id),
    receipt_no TEXT NOT NULL UNIQUE,customer_account TEXT NOT NULL,customer_name TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount>0),payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash','Whish Money')),
    paid_at TEXT NOT NULL,cashier_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_equipment_sales(
    request_id TEXT PRIMARY KEY REFERENCES portal_operations(request_id),sale_id INTEGER NOT NULL REFERENCES sales(id),fingerprint TEXT NOT NULL);`);
  if(!query(db,'PRAGMA table_info(installation_payments)').some(p=>p.name==='purpose'))db.run("ALTER TABLE installation_payments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'installation'");
}
function installationRows(db,start='0000-01-01',end='9999-12-31'){
  return query(db,'SELECT id,request_id AS requestId,receipt_no AS receiptNo,customer_account AS customerAccount,customer_name AS customerName,amount,payment_method AS paymentMethod,paid_at AS paidAt,cashier_name AS cashierName,purpose FROM installation_payments WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at DESC,id DESC',[start,end]).map(p=>({...p,whishDestination:readSnapshot(db,'installation',p.id)}));
}
function installationReport(db,start,end,payments){
  const entries=installationRows(db,start,end),income=round(entries.reduce((sum,p)=>sum+p.amount,0));
  const cash=round(entries.filter(p=>p.paymentMethod==='Cash').reduce((sum,p)=>sum+p.amount,0)),whish=round(income-cash);
  const whishEntries=entries.filter(p=>p.paymentMethod==='Whish Money').map(p=>({...p,referenceNo:p.receiptNo,receivedAt:p.paidAt,kind:'installation',fee:p.whishDestination?.fee||0,netCollected:round(p.amount-(p.whishDestination?.fee||0))})),fees=round(whishEntries.reduce((sum,p)=>sum+p.fee,0));
  return {...payments,whishPayments:[...(payments.whishPayments||[]),...whishEntries],whishFees:round((payments.whishFees||0)+fees),grossWhishReceived:round((payments.grossWhishReceived??payments.whishReceived)+whish),installationIncome:income,installationPayments:entries,cashPaid:round(payments.cashPaid+cash),whishPaid:round(payments.whishPaid+whish),paymentTotal:round(payments.paymentTotal+income),cashReceived:round(payments.cashReceived+cash),whishReceived:round(payments.whishReceived+whish-fees),collectionsTotal:round(payments.collectionsTotal+income-fees)};
}
function installationCsv(report){const q=value=>`"${String(value??'').replaceAll('"','""')}"`,funding=require('./src/expense-funding.js').reportSummary(report);return ['','INSTALLATION PAYMENTS AND FREE-RENEWAL FUNDING - separate from Internet bills, counted once in company revenue and collections','Receipt,Date,Account,Customer,Received USD,Payment,Cashier,Purpose',...(report.installationPayments||[]).map(p=>[p.receiptNo,p.paidAt,p.customerAccount,p.customerName,p.amount,p.paymentMethod,p.cashierName,p.purpose==='free_renewal'?'Free-renewal expense funding':'Installation'].map(q).join(',')),'',`Expense funding received USD,${q(funding.received)}`,`Expenses spent USD - excludes profit-only Whish fees,${q(funding.spent)}`,`Whish fees USD - profit only,${q(funding.fees)}`,`Funding balance USD,${q(funding.remaining)}`].join('\r\n');}
module.exports={starterExpiry,registrationInput,registrationBillCost,initializeCustomerRegistration,installationRows,installationReport,installationCsv};
