'use strict';
// Strict routing/DTO checks with fictional delegates. Real IPC/LAN and durable
// collection/restart coverage are separate integration tests.
const assert=require('node:assert/strict');
const {createAdminReceivables}=require('./admin-receivables.cjs');
const {WORKSPACES}=require('./workspaces.cjs');
const token='a'.repeat(64);
function fixture(){
  let allowed=true,failedSource='',failedResellers=false,checks=0;
  const authority={account_key:'main:fictional-admin'},calls=[];
  const data=new Map(WORKSPACES.map(source=>[source.id,[{kind:'sale',id:1,referenceNo:'INV-'+source.id,customerName:'Fictional '+source.id,createdAt:'2026-10-21T10:00:00',originalAmount:20,paidAmount:10,remainingAmount:10,isDebt:true,workspaceId:'forged',debtKey:'forged'},
    {kind:'sale',id:2,remainingAmount:0,isDebt:true},{kind:'bill',id:3,remainingAmount:0,isRefund:true,isDebt:false}]]));
  const snapshot={rows:[{id:1,username:'Alpha',full_name:'Fictional Alpha',active:1},{id:2,username:'Beta',full_name:'Fictional Beta',active:0}],lots:[{username:'Alpha',remaining:4500,reserved:1500},{username:'Beta',remaining:2000,reserved:0},{username:'Orphan',remaining:3000,reserved:0}],summary:{byReseller:[{username:'Alpha',pendingToCollect:60,reserved:15,unreservedPending:45},{username:'Beta',pendingToCollect:20,reserved:0,unreservedPending:20},{username:'Orphan',pendingToCollect:30,reserved:0,unreservedPending:30}],total:{pendingToCollect:110}}};
  const api=createAdminReceivables({workspaces:WORKSPACES,authorize:()=>{checks++;if(!allowed)throw Error('Main Admin required.');return authority;},delegate:(actor,source,channel,args)=>{
    assert.equal(actor.account_key,authority.account_key);assert(WORKSPACES.some(item=>item.id===source));calls.push({source,channel,args:structuredClone(args)});
    if(source===failedSource)throw Error('Source unavailable.');
    if(channel==='debts:list'){assert.deepEqual(args,[false]);return structuredClone(data.get(source));}
    if(channel==='receivables:debtReceipt')return {id:args[1],invoiceNo:'SAME-ID-'+source,workspaceId:'forged',kind:args[0]};
    assert.equal(source,'fiber-resellers');
    if(failedResellers)throw Error('Reseller ledger unavailable.');
    if(channel==='receivables:resellerSnapshot')return structuredClone(snapshot);
    if(channel==='receivables:collectionBills')return {resellerId:args[0].resellerId,receiver:{accountKey:'main:fictional-admin'},bills:[{fundRequestId:'fictional-fund-1',remainingAmount:45,canPay:true}]};
    if(channel==='resellers:collectionPreview')return {...args[0],token,amount:45};
    if(channel==='resellers:payBill')return Promise.resolve({receiptNo:'COLLECTION-FICTIONAL',amount:45,state:'completed'});
    throw Error('Unexpected routing.');
  }});
  return {api,calls,data,snapshot,get checks(){return checks;},set allowed(value){allowed=value;},set failedSource(value){failedSource=value;},set failedResellers(value){failedResellers=value;}};
}
const preview=()=>({requestId:'fictional-request-1',resellerId:1,fundRequestId:'fictional-fund-1',note:'Original description'});
(async()=>{
  const f=fixture(),before=JSON.stringify([...f.data]);
  const summary=f.api.summary();assert.equal(summary.scope,'all-businesses');assert.equal(summary.accountKey,'main:fictional-admin');assert.deepEqual(summary.customerDebts,{available:true,total:70,count:7});assert.deepEqual(summary.resellerBills,{available:true,total:110,count:3,billCount:3,reservedAmount:15});assert.equal(JSON.stringify([...f.data]),before);
  const debts=f.api.debts();assert.equal(debts.count,7);assert.equal(debts.total,70);assert.equal(new Set(debts.debts.map(row=>row.debtKey)).size,7);for(const source of WORKSPACES){const row=debts.debts.find(row=>row.workspaceId===source.id);assert.equal(row.debtKey,source.id+':sale:1');assert.equal(row.workspaceName,source.name);assert.equal(row.workspaceKind,source.kind);}
  const owing=f.api.resellers();assert.equal(owing.total,110);assert.equal(owing.reservedAmount,15);assert.equal(owing.count,3);assert.equal(owing.billCount,3);
  const alpha=owing.resellers.find(row=>row.username==='Alpha');assert.equal(alpha.resellerId,1);assert.equal(alpha.collectibleAmount,45);assert.equal(alpha.canPay,true);
  const inactive=owing.resellers.find(row=>row.username==='Beta');assert.equal(inactive.pendingToCollect,20);assert.equal(inactive.canPay,false);assert.match(inactive.blockedReason,/inactive/);
  const orphan=owing.resellers.find(row=>row.username==='Orphan');assert.equal(orphan.resellerId,null);assert.equal(orphan.pendingToCollect,30);assert.equal(orphan.canPay,false);assert.match(orphan.blockedReason,/local reseller/);
  for(const kind of ['sale','bill','telecom']){const value=f.api.debtReceipt({workspaceId:'studio',kind,id:1});assert.equal(value.kind,kind);assert.equal(value.debtKey,`studio:${kind}:1`);assert.equal(value.workspaceId,'studio');assert.equal(value.record.workspaceId,'studio');assert.equal(value.record.debtKey,`studio:${kind}:1`);assert.equal(value.record.adminReceivableReadOnly,true);assert.equal(value.record.invoiceNo,'SAME-ID-studio');}
  const bills=f.api.collectionBills({resellerId:1});assert.equal(bills.bills[0].remainingAmount,45);assert.equal(f.calls.at(-1).channel,'receivables:collectionBills');
  const p=f.api.collectionPreview(preview());assert.equal(p.token,token);assert.equal(f.calls.at(-1).source,'fiber-resellers');assert.equal(f.calls.at(-1).channel,'resellers:collectionPreview');assert.deepEqual(f.calls.at(-1).args,[preview()]);
  const result=await f.api.payBill({...preview(),token,confirm:true,confirmation:'PAY BILL'});assert.equal(result.state,'completed');assert.equal(f.calls.at(-1).channel,'resellers:payBill');assert(!f.calls.some(call=>/portal:|resellers:fund|debts:settle/.test(call.channel)));
  for(const bad of [null,[],{},Object.assign(Object.create({}),preview()),{...preview(),amount:45},{...preview(),sourceKey:'forged'},{...preview(),paymentMethod:'Cash'},{...preview(),token},{...preview(),fundRequestId:''},{...preview(),resellerId:'1'},{...preview(),resellerId:-1},{...preview(),requestId:'short'},{...preview(),note:'xx'}]){const g=fixture();assert.throws(()=>g.api.collectionPreview(bad));assert.equal(g.calls.length,0);}
  for(const bad of [{...preview(),token:'short',confirm:true,confirmation:'PAY BILL'},{...preview(),token,confirm:false,confirmation:'PAY BILL'},{...preview(),token,confirm:true,confirmation:'PAY'},{...preview(),token,confirm:true,confirmation:'PAY BILL',amount:1}]){const g=fixture();assert.throws(()=>g.api.payBill(bad));assert.equal(g.calls.length,0);}
  for(const bad of [{workspaceId:'all',kind:'sale',id:1},{workspaceId:'../main',kind:'sale',id:1},{workspaceId:'main',kind:'installation',id:1},{workspaceId:'main',kind:'sale',id:'1'},{workspaceId:'main',kind:'sale',id:1,source:'forged'}]){const g=fixture();assert.throws(()=>g.api.debtReceipt(bad));assert.equal(g.calls.length,0);}
  const denied=fixture();denied.allowed=false;for(const call of [()=>denied.api.summary(),()=>denied.api.debts(),()=>denied.api.resellers(),()=>denied.api.debtReceipt({workspaceId:'main',kind:'sale',id:1}),()=>denied.api.collectionBills({resellerId:1}),()=>denied.api.collectionPreview(preview()),()=>denied.api.payBill({...preview(),token,confirm:true,confirmation:'PAY BILL'})])assert.throws(call,/Main Admin/);assert.equal(denied.calls.length,0);
  const partial=fixture();partial.failedSource='studio';const partialResult=partial.api.summary();assert.equal(partialResult.customerDebts.available,false);assert.equal(partialResult.customerDebts.total,null);assert.equal(partialResult.resellerBills.total,110);assert.throws(()=>partial.api.debts(),/unavailable/);
  const missingResellers=fixture();missingResellers.failedResellers=true;const missingResult=missingResellers.api.summary();assert.equal(missingResult.customerDebts.total,70);assert.equal(missingResult.resellerBills.available,false);assert.equal(missingResult.resellerBills.total,null);
  const malformed=fixture();malformed.data.get('studio')[0].remainingAmount=0.001;assert.throws(()=>malformed.api.debts(),/amount/);const duplicate=fixture();duplicate.data.get('main').push({...duplicate.data.get('main')[0]});assert.throws(()=>duplicate.api.debts(),/more than once/);
  const badTotals=fixture();badTotals.snapshot.summary.total.pendingToCollect=111;assert.throws(()=>badTotals.api.resellers(),/total/);const badReserve=fixture();badReserve.snapshot.summary.byReseller[0].reserved=16;assert.throws(()=>badReserve.api.resellers(),/reservation/);
  assert(f.checks>=8);
  console.log('Main Admin receivables unit QA passed: seven-source composite debts, exact remaining cents, independent unavailable sections, original receipt provenance, inactive/orphan and reserved reseller claims retained, strict saved-bill-only routing, fresh authority, and no provider or customer collection action. Mock delegates only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
