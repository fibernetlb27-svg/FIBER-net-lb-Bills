'use strict';
// Read-only opening custody for balance-derived dashboard profit. Bank assets
// are excluded: only prior closing Cash/Whish still held by the same business
// and selected account form this baseline. Legacy zero openings remain zero.
const Finance=require('./finance-ledger.cjs');
const {WORKSPACES}=require('./workspaces.cjs');
const IDS=new Set(WORKSPACES.map(row=>row.id)),LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
function fail(){throw Error('The carried monthly opening could not be verified. No unverified business profit was shown.');}
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function day(value){if(typeof value!=='string'||!/^2[01]\d{2}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail();return value;}
function account(value){if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value)))fail();return value;}
function cents(value){if(typeof value!=='number'||!Number.isFinite(value))fail();const result=Math.round(value*100);if(!Number.isSafeInteger(result)||Math.abs(value*100-result)>1e-6)fail();return result;}
function sum(values){const result=values.reduce((n,value)=>n+BigInt(value),0n);if(result>LIMIT||result< -LIMIT)fail();return Number(result);}
function month(value){if(typeof value!=='string'||!/^2[01]\d{2}-(?:0[1-9]|1[0-2])$/.test(value))fail();return value;}
function validateSummary(value){
 if(!plain(value)||value.basis!=='month_opening_custody'||!IDS.has(value.workspaceId)||!['none','legacy_zero','carry_forward'].includes(value.mode))fail();
 account(value.accountKey);day(value.through);const cash=cents(value.cash),wallets=cents(value.wallets),total=cents(value.total);if(sum([cash,wallets])!==total)fail();
 if(value.mode==='none'){if(value.month!==null||value.openingDate!==null||cash||wallets||total)fail();}
 else{month(value.month);if(value.month>=value.through.slice(0,7)||value.openingDate!==Finance.monthRange(value.month).opening.slice(0,10)||value.openingDate>value.through||value.mode==='legacy_zero'&&(cash||wallets||total))fail();}
 return value;
}
function summary({db,workspaceId,accountKey=null,through}={}){
 if(!db||typeof db.prepare!=='function'||!IDS.has(workspaceId))fail();account(accountKey);day(through);
 const empty={basis:'month_opening_custody',workspaceId,accountKey,through,month:null,openingDate:null,mode:'none',cash:0,wallets:0,total:0};
 if(!Finance.query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='finance_months'").length)return empty;
 const row=Finance.query(db,'SELECT * FROM finance_months WHERE month<? ORDER BY month DESC LIMIT 1',[through.slice(0,7)])[0];if(!row)return empty;
 month(row.month);let archive;try{archive=JSON.parse(row.archive_json);}catch{return fail();}
 if(!plain(archive)||!plain(archive.all)||!plain(archive.all.closing))fail();
 const mode=archive.all.closing.mode;
 if(mode!==undefined&&mode!=='carry_forward')fail();
 const result={...empty,month:row.month,openingDate:Finance.monthRange(row.month).opening.slice(0,10),mode:mode==='carry_forward'?'carry_forward':'legacy_zero'};
 // A carried opening is accepted only from the durable close request proof.
 // Ask the verifier for legacy rows too, so removing a new archive's mode
 // cannot downgrade an anchored carry-forward close into an unproved zero.
 let verified;try{verified=require('./month-closing.cjs').verifyArchive({db,workspaceId,month:row.month});}catch{return fail();}
 if(mode===undefined){if(verified!==null)return fail();return validateSummary(result);}
 if(!plain(verified)||JSON.stringify(verified)!==row.archive_json||verified.month!==row.month||!plain(verified.all)||!plain(verified.all.closing)||verified.all.closing.mode!=='carry_forward')fail();
 let closing=verified.all.closing;
 if(accountKey!==null){
  if(!plain(verified.employees))fail();
  if(!Object.hasOwn(verified.employees,accountKey))return validateSummary(result);
  const selected=verified.employees[accountKey];if(!plain(selected)||!plain(selected.closing))fail();closing=selected.closing;
 }
 if(closing.mode!=='carry_forward'||!Array.isArray(closing.wallets))fail();
 const seen=new Set(),wallets=[];
 for(const wallet of closing.wallets){if(!plain(wallet)||typeof wallet.id!=='string'||!wallet.id.trim()||seen.has(wallet.id))fail();seen.add(wallet.id);wallets.push(cents(wallet.balance));}
 const cash=cents(closing.cash),heldWallets=sum(wallets);
 return validateSummary({...result,cash:cash/100,wallets:heldWallets/100,total:sum([cash,heldWallets])/100});
}
module.exports={summary,validateSummary};
