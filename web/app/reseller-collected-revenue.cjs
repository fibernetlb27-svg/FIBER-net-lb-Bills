'use strict';
// Presentation-only counterpart of the Reseller Bills “Money collected” card.
// Never use current cash, wallet balances, POS income or supplier spending as
// substitutes. It intentionally spans all saved dates and all resellers.
const Collections=require('./reseller-collections.cjs');
const identity=Object.freeze({basis:'reseller_bill_collections',scope:'all_resellers',period:'all_recorded_dates'});
function exact(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('The saved reseller collection total is unavailable.');const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-6)throw Error('The saved reseller collection total exceeds exact USD cents.');return cents;}
function summary(db){
 if(arguments.length!==1||!db||typeof db.prepare!=='function')throw Error('Choose the authoritative Resellers ledger without an employee or date override.');
 try{const value=Collections.summary(db).total,amount=exact(value.moneyCollected);if(exact(value.netMoneyCollected)!==amount||exact(value.collectedNet)!==amount)throw Error('The saved reseller collection totals disagree.');return {...identity,available:true,amount:amount/100};}
 catch{return {...identity,available:false,reason:'Verified reseller bill collections are unavailable. Refresh Main before showing revenue.'};}
}
module.exports={summary};
