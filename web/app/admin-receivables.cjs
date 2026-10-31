'use strict';
// Main Admin shortcuts only. Existing source ledgers remain authoritative;
// no debt, funding, collection or provider transaction is created by a read.
const DEBT_KINDS=new Set(['sale','bill','telecom']);
function object(value,allowed,required=allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Choose valid receivable details.');
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw Error('Unsupported or missing receivable details.');
  return value;
}
function id(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Choose a valid saved account or receipt.');return value;}
function text(value,label,max=500){if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))throw Error('Choose valid '+label+'.');return value;}
function cents(value){const amount=Math.round(value*100);if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(amount)||Math.abs(value*100-amount)>1e-6)throw Error('The saved receivable amount could not be verified.');return amount;}
function sumCents(values){let total=0;for(const value of values){total+=value;if(!Number.isSafeInteger(total)||total<0)throw Error('Receivable totals exceed the supported accounting range.');}return total;}
function collectionInput(value,apply=false){
  const allowed=['requestId','resellerId','fundRequestId','note',...(apply?['token','confirm','confirmation']:[])];object(value,allowed);
  const requestId=text(value.requestId,'collection request',100);if(!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw Error('Choose a valid collection request.');
  const note=text(value.note,'saved bill description',500).trim();if(note.length<3)throw Error('The saved bill description must contain at least three characters.');
  const result={requestId,resellerId:id(value.resellerId),fundRequestId:text(value.fundRequestId,'saved funding bill',200),note};
  if(apply){if(typeof value.token!=='string'||! /^[a-f0-9]{64}$/.test(value.token)||value.confirm!==true||value.confirmation!=='PAY BILL')throw Error('Review this exact saved bill before paying.');Object.assign(result,{token:value.token,confirm:true,confirmation:'PAY BILL'});}
  return result;
}
function createAdminReceivables({workspaces,authorize,delegate}){
  const sections=workspaces.map(({id,name,kind})=>Object.freeze({id,name,kind})),byId=new Map(sections.map(source=>[source.id,source]));
  const section=value=>{if(typeof value!=='string'||!byId.has(value))throw Error('Choose the original receipt business.');return byId.get(value);};
  const tag=(value,source)=>({...value,workspaceId:source.id,workspaceName:source.name,workspaceKind:source.kind});
  function debts(authority){
    const debts=[],keys=new Set();
    for(const source of sections){
      const rows=delegate(authority,source.id,'debts:list',[false]);if(!Array.isArray(rows))throw Error('The original debt accounts could not be loaded.');
      for(const row of rows){
        if(!row||!DEBT_KINDS.has(row.kind))throw Error('The original debt account type could not be verified.');
        const originalId=id(row.id),remaining=cents(row.remainingAmount),debtKey=`${source.id}:${row.kind}:${originalId}`;
        if(!remaining||row.isRefund||row.isDebt===false)continue;
        if(keys.has(debtKey))throw Error('A debt account was returned more than once. Refresh the original ledger.');keys.add(debtKey);
        debts.push({...tag(row,source),id:originalId,debtKey,remainingAmount:remaining/100,amount:remaining/100});
      }
    }
    debts.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||a.debtKey.localeCompare(b.debtKey));
    return {scope:'all-businesses',accountKey:authority.account_key,total:sumCents(debts.map(row=>cents(row.remainingAmount)))/100,count:debts.length,debts};
  }
  function resellers(authority){
    const snapshot=delegate(authority,'fiber-resellers','receivables:resellerSnapshot',[]);
    if(!snapshot||!Array.isArray(snapshot.rows)||!Array.isArray(snapshot.lots)||!Array.isArray(snapshot.summary?.byReseller))throw Error('The saved reseller collection ledger could not be loaded.');
    const rows=[],names=new Set();let reserved=0;
    for(const row of snapshot.summary.byReseller){
      const pending=cents(row.pendingToCollect);if(!pending)continue;
      const username=text(row.username,'saved reseller username',200);if(names.has(username))throw Error('A reseller collection account was returned more than once.');names.add(username);
      const held=cents(row.reserved),collectible=cents(row.unreservedPending);if(pending!==held+collectible)throw Error('The saved reseller reservation totals do not match.');reserved=sumCents([reserved,held]);
      const matches=snapshot.rows.filter(item=>item.username===username),local=matches.length===1?matches[0]:null;
      const active=local?.active===1||local?.active===true,resellerId=local?id(local.id):null;
      const billCount=snapshot.lots.filter(lot=>lot.username===username&&(lot.remaining>0||lot.reserved>0)).length;
      const blockedReason=!local?'No unambiguous local reseller record matches this saved funding. Review Resellers.':!active?'This reseller is inactive. Review its saved funding in Resellers.':!collectible?'A Pay bill collection is unfinished. Resume or cancel its original request in Resellers.':'';
      rows.push({resellerId,username,name:typeof local?.full_name==='string'?local.full_name:'',active,pendingToCollect:pending/100,collectibleAmount:collectible/100,reservedAmount:held/100,billCount,canPay:active&&collectible>0,blockedReason});
    }
    rows.sort((a,b)=>b.pendingToCollect-a.pendingToCollect||a.username.localeCompare(b.username));
    const total=sumCents(rows.map(row=>cents(row.pendingToCollect)));if(total!==cents(snapshot.summary.total.pendingToCollect))throw Error('The saved reseller total does not match its account list.');
    return {scope:'fiber-resellers',total:total/100,count:rows.length,billCount:rows.reduce((n,row)=>n+row.billCount,0),reservedAmount:reserved/100,resellers:rows};
  }
  return {
    summary(){
      const authority=authorize(),unavailable=error=>({available:false,total:null,count:null,error:error?.message||'Receivable totals are not available.'});
      let customerDebts,resellerBills;
      try{const value=debts(authority);customerDebts={available:true,total:value.total,count:value.count};}catch(error){customerDebts=unavailable(error);}
      try{const value=resellers(authority);resellerBills={available:true,total:value.total,count:value.count,billCount:value.billCount,reservedAmount:value.reservedAmount};}catch(error){resellerBills=unavailable(error);}
      return {scope:'all-businesses',accountKey:authority.account_key,workspaces:sections.map(source=>({...source})),customerDebts,resellerBills};
    },
    debts(){return debts(authorize());},
    resellers(){return resellers(authorize());},
    debtReceipt(value){
      const authority=authorize();object(value,['workspaceId','kind','id']);const source=section(value.workspaceId),recordId=id(value.id);
      if(!DEBT_KINDS.has(value.kind))throw Error('Choose a supported debt receipt.');
      const record=delegate(authority,source.id,'receivables:debtReceipt',[value.kind,recordId]);
      if(!record||record.id!==recordId)throw Error('The original debt receipt could not be verified.');
      const debtKey=`${source.id}:${value.kind}:${recordId}`,provenance=tag({kind:value.kind,debtKey},source);
      return {...provenance,record:{...tag(record,source),debtKey,adminReceivableReadOnly:true}};
    },
    collectionBills(value){const authority=authorize();object(value,['resellerId']);return delegate(authority,'fiber-resellers','receivables:collectionBills',[{resellerId:id(value.resellerId)}]);},
    collectionPreview(value){const authority=authorize(),input=collectionInput(value);return delegate(authority,'fiber-resellers','resellers:collectionPreview',[input]);},
    payBill(value){const authority=authorize(),input=collectionInput(value,true);return delegate(authority,'fiber-resellers','resellers:payBill',[input]);}
  };
}
module.exports={createAdminReceivables,collectionInput};
