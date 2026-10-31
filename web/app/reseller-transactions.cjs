'use strict';
// Native v5 transaction columns verified against the portal's transaction table.
const ignored=new Set(['transfer','withdraw','comission','commission','itv commission']);
const charged=new Set(['new','renew','rent ip','refill','reset','fup','change service','freetime','itv','reset itv','add days','addons','rename']);
function money(value){if(!/^-?\d+(\.\d{1,2})?$/.test(String(value))||Math.abs(Number(value))>1000000)throw Error('Proradius returned an invalid transaction amount. Nothing was imported.');return Math.round(Number(value)*100);}
function date(value){const text=String(value||''),day=text.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('Proradius returned an unsupported transaction date. Nothing was imported.');return day;}
function party(value,resellers){if(value===null||value===undefined||value==='')return null;const id=typeof value==='object'?value.id:typeof value==='number'?value:null,name=typeof value==='object'?value.username:typeof value==='string'?value:null;const found=resellers.filter(r=>(id!==null&&Number(r.id)===Number(id))||(name!==null&&r.username===name));if(found.length>1||found.length===1&&id!==null&&name!==null&&(Number(found[0].id)!==Number(id)||found[0].username!==name))throw Error('Proradius returned an ambiguous reseller identity. Nothing was imported.');return found[0]||null;}
function parseTransaction(row,resellers,start,end){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid portal transaction. Nothing was imported.');
 const id=String(row.id??'');if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<1)throw Error('Portal transaction has no stable ID. Nothing was imported.');
 const day=date(row.transdate);if(day<start||day>end)throw Error('The portal did not honor the requested transaction dates. Nothing was imported.');
 const type=String(row.type??'').trim().toLowerCase();if(!ignored.has(type)&&!charged.has(type)&&type!=='refund')throw Error(`Unsupported Proradius transaction type: ${type||'missing'}. Nothing was imported.`);
 if(ignored.has(type))return {id,ignored:true};
 if(!Object.hasOwn(row,'payer')||!Object.hasOwn(row,'payee')||['payer','payee'].some(key=>row[key]===null||row[key]===undefined||row[key]===''||typeof row[key]==='object'&&(!row[key].id&&!row[key].username)))throw Error('Portal transaction is missing its Debit/Credit parties. Nothing was imported.');
 const reseller=party(type==='refund'?row.payee:row.payer,resellers);if(!reseller)return {id,ignored:true};
 const raw=money(row.amount),charge=type==='refund'?-Math.abs(raw):raw;
 if(Object.hasOwn(row,'oldbalance')&&Object.hasOwn(row,'newbalance')&&money(row.oldbalance)-money(row.newbalance)!==charge)throw Error('Portal charge and reseller balance direction disagree. Nothing was imported.');
 const occurredAt=String(row.transdate).replace(' ','T').slice(0,19);if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(occurredAt))throw Error('Portal service charge is missing an exact transaction time. Nothing was imported.');
 return {id,username:reseller.username,portalResellerId:reseller.id,date:day,occurredAt,type:String(row.type),chargeCents:charge,description:String(row.servicename||row.description||'').slice(0,200)};
}
function page(payload){if(payload?.success===false||payload?.body?.success===false)throw Error('Proradius denied transaction access.');const body=payload?.body;if(!body||!Array.isArray(body.data)||!/^\d+$/.test(String(body.itemscount)))throw Error('Unsupported transaction pagination. Nothing was imported.');const count=Number(body.itemscount);if(!Number.isSafeInteger(count)||count>20000||count<body.data.length)throw Error('Invalid transaction count. Narrow the date range.');return {rows:body.data,count};}
module.exports={parseTransaction,page,date};
