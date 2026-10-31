'use strict';
// Per-PC native printing only. No server RPC, HTML, credentials or database access.
const PAPER_TYPES=Object.freeze(['auto','a4','a5','thermal-80','thermal-58','xp-235b']);
const key=user=>user?.account_key||user?.accountKey||'';
const validName=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\u0000-\u001f\u007f]/.test(value);
function input(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Choose a valid receipt paper and printer.');
  if(Reflect.ownKeys(value).some(name=>!['paperType','printerName'].includes(name)))throw Error('Receipt printing accepts paper type and printer name only.');
  if(!PAPER_TYPES.includes(value.paperType))throw Error('Choose a supported receipt paper type.');
  const printerName=value.printerName===undefined?'':value.printerName;
  if(typeof printerName!=='string'||(printerName!==''&&!validName(printerName)))throw Error('Choose a valid installed printer.');
  return {paperType:value.paperType,printerName};
}
function installed(rows){
  if(!Array.isArray(rows))throw Error('Windows did not return a valid printer list.');
  const seen=new Set();return rows.map(row=>{
    if(!row||!validName(row.name)||seen.has(row.name))throw Error('Windows returned an invalid or ambiguous printer name.');
    seen.add(row.name);
    return {name:row.name,displayName:validName(row.displayName)?row.displayName:row.name,isDefault:row.isDefault===true};
  });
}
function options(paperType,printerName){
  const result={silent:false,printBackground:true};
  if(printerName)result.deviceName=printerName;
  if(paperType==='a4')result.pageSize='A4';
  if(paperType==='a5')result.pageSize='A5';
  // Electron 38 has no usePrinterDefaultPageSize option. Thermal/Auto deliberately
  // omit pageSize. The dialog may still start at A4/default sheet: the operator
  // must select matching driver paper; automatic roll adoption is not guaranteed.
  return result;
}
function createReceiptPrinterApi({sessionForSender,windowForUsers,getConnection,expectedUrl,refreshUser,canPrint,receiptState}){
  const pending=new Set();
  function capture(event){
    const sender=event?.sender,session=sender&&sessionForSender(sender.id),window=windowForUsers();
    if(!sender||sender.isDestroyed?.()||!session||window?.isDestroyed?.()||window?.webContents!==sender)throw Error('Receipt printing requires the open FIBER net lb Users window.');
    const frame=event.senderFrame,main=sender.mainFrame;
    const sameFrame=frame&&main&&(frame===main||(Number.isInteger(frame.processId)&&Number.isInteger(frame.routingId)&&frame.processId===main.processId&&frame.routingId===main.routingId));
    if(!sameFrame||frame.parent!==null||main.parent!==null||sender.getURL?.()!==expectedUrl||frame.url!==expectedUrl)throw Error('Only the trusted top-level Users page can print receipts.');
    if(session.workspaceId!=='fiber-users'||!session.user?.active||!key(session.user)||session.bandwidthParentId!==undefined)throw Error('Sign in to FIBER net lb Users before printing.');
    const config=getConnection();
    if(!['server','client'].includes(config.mode))throw Error('Connect this computer before printing.');
    if(config.mode==='client'&&(!session.remoteToken||!config.serverUrl))throw Error('Your session ended. Please sign in again.');
    return {event,sender,session,window,workspaceId:session.workspaceId,accountKey:key(session.user),remoteToken:session.remoteToken,epoch:session.receiptAuthEpoch||0,mode:config.mode,serverUrl:config.serverUrl,frame};
  }
  function current(ticket){
    const now=capture(ticket.event);
    for(const field of ['sender','session','window','workspaceId','accountKey','remoteToken','epoch','mode','serverUrl','frame'])if(now[field]!==ticket[field])throw Error('Your session or window changed. Open the receipt again before printing.');
  }
  async function authorized(ticket){
    current(ticket);
    const fresh=await refreshUser(ticket);
    current(ticket);
    if(!fresh?.active||key(fresh)!==ticket.accountKey||!canPrint(fresh,ticket))throw Error('Your current account cannot print Users receipts. Please refresh your sign-in.');
  }
  async function ready(ticket,paperType,previous){
    const state=await receiptState(ticket.sender);current(ticket);
    if(!state||state.open!==true||state.printTarget!=='receipt'||state.paperType!==paperType||typeof state.token!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(state.token)||previous&&state.token!==previous.token)throw Error('The receipt or paper changed. Open the saved receipt again before printing.');
    return {token:state.token,paperType};
  }
  async function printers(event){
    const ticket=capture(event);await authorized(ticket);
    const rows=await ticket.sender.getPrintersAsync();current(ticket);
    await authorized(ticket);return installed(rows);
  }
  async function printReceipt(event,value){
    const request=input(value),ticket=capture(event);
    if(pending.has(ticket.sender))throw Error('A receipt print dialog is already open. Finish or cancel it before printing again.');
    pending.add(ticket.sender);
    try{
      const receipt=await ready(ticket,request.paperType);
      await authorized(ticket);
      const rows=installed(await ticket.sender.getPrintersAsync());current(ticket);
      if(request.printerName&&!rows.some(row=>row.name===request.printerName))throw Error('The mapped printer is no longer installed on this PC. Select another printer; nothing was printed.');
      await authorized(ticket);await ready(ticket,request.paperType,receipt);current(ticket);
      const result=await new Promise((resolve,reject)=>{
        try{ticket.sender.print(options(request.paperType,request.printerName),(success,failureReason)=>{
          if(success===true)return resolve({success:true});
          const reason=typeof failureReason==='string'?failureReason.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500):'';
          resolve({success:false,canceled:/cancel(?:led|ed)?/i.test(reason),reason:reason||'Windows did not complete the print request. Check the printer before trying again.'});
        });}catch(error){reject(Error('The print dialog could not be opened. '+(error?.message||'Check the installed printer.')));}
      });
      // Once Windows owns its dialog/job, logout cannot retract a physical print.
      // Preserve the actual callback result instead of claiming no job was sent.
      try{current(ticket);}catch{
        return {...result,sessionChanged:true,warning:'Your session changed while the Windows print dialog was open. Check the printer before printing again.'};
      }
      return result;
    }finally{pending.delete(ticket.sender);}
  }
  return {printers,printReceipt};
}
module.exports={PAPER_TYPES,input,installed,options,createReceiptPrinterApi};
