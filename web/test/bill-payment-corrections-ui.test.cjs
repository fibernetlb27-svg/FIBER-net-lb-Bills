'use strict';
// Actual editor module in a fictional DOM. No accounting or provider writes.
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/bill-payment-corrections.js'),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
function fixture(storage=new Map()){
 const elements=new Map(),listeners=new Map(),calls=[],toasts=[],html=[];let user={accountKey:'fictional-cashier',role:'cashier',active:true},workspace={id:'fiber-users'},identity='fictional-session-1';const permissions=new Set(['bills.view','bills.create']);
 function node(tag='div'){
  let content='',value='',classes=new Set();const n={tagName:tag.toUpperCase(),children:[],dataset:{},disabled:false,checked:false,open:false,
   append(...children){n.children.push(...children);if(tag==='select'&&!value&&children[0])value=children[0].value;},replaceChildren(...children){n.children=[];content='';value='';n.append(...children);},setAttribute(k,v){n[k]=v;},
   addEventListener(name,fn){if(!n.events)n.events={};n.events[name]=fn;},showModal(){n.open=true;},close(){n.open=false;n.events?.close?.();},reset(){for(const id of ['bpc-reason','bpc-method','bpc-wallet'])element(id).value='';element('bpc-reviewed').checked=false;},
   classList:{toggle(k,force){if(force===undefined)force=!classes.has(k);force?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)}};
  Object.defineProperties(n,{id:{set(id){n.name=id;elements.set(id,n);},get:()=>n.name},value:{set:v=>{value=String(v);},get:()=>value},className:{set:v=>{classes=new Set(String(v).split(' '));},get:()=>[...classes].join(' ')},textContent:{set:v=>{content=String(v);n.children=[];},get:()=>content+n.children.map(x=>x.textContent||'').join('')},innerHTML:{set:v=>{html.push(String(v));content='';n.children=[];}}});return n;
 }
 function element(id){if(!elements.has(id)){const n=node(id==='bpc-payment'||id==='bpc-method'||id==='bpc-wallet'?'select':'div');n.id=id;}return elements.get(id);}
 const payments=[{paymentKey:'original',amount:20,method:'Cash',receivedAt:'2026-11-06T10:00:00',ownerName:'Fictional Cashier',canCorrect:true,blockedReason:''}];
 const handlers={options:async input=>({billId:input.billId,receiptNo:'FICTIONAL-BILL-1',paidAmount:20,remainingAmount:0,payments:structuredClone(payments),history:[]}),preview:async input=>({...input,oldMethod:'Cash',amount:20,ownerName:'Fictional Cashier',feeBefore:0,feeAfter:input.method==='Whish Money'?.2:0,debtBefore:0,debtAfter:input.method==='Unpaid'?20:0,token:'a'.repeat(64),...input.method==='Whish Money'?{whishDestination:{label:'Fictional Wallet',number:'03000001'}}:{}}),correct:async input=>({requestId:input.requestId,state:'completed',bill:{id:input.billId}}),status:async()=>null};
 const config={api:{billPayments:Object.fromEntries(Object.keys(handlers).map(method=>[method,async input=>{calls.push({method,input:structuredClone(input)});return handlers[method](input);}])),whish:{list:async()=>[{id:'fictional-wallet',label:'Fictional Wallet',number:'03000001'}]}},getUser:()=>user,getWorkspace:()=>workspace,has:p=>permissions.has(p),identity:()=>identity,toast:(message,type)=>toasts.push({message,type}),refresh:async bill=>{calls.push({method:'refresh',bill});}};
 const context=vm.createContext({window:{addEventListener:(name,fn)=>listeners.set('window:'+name,fn)},document:{body:node('body'),createElement:node,getElementById:element,addEventListener:(name,fn)=>listeners.set(name,fn)},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'fictional-correction-request-0001'},Intl,Number,JSON});
 vm.runInContext(source,context);const editor=context.window.BillPaymentCorrections;editor.init(config);
 return {editor,config,handlers,calls,toasts,html,storage,element,payments,permissions,context,setUser:v=>{user=v;},setWorkspace:v=>{workspace=v;},changeIdentity:()=>{identity+='changed';},submit:()=>element('bpc-form').events.submit({preventDefault(){}}),change:id=>element(id).onchange(),close:()=>element('bpc-close').onclick(),async ready(method='Unpaid'){await editor.open(1);element('bpc-method').value=method;element('bpc-reason').value='Correct fictional entry';if(method==='Whish Money')element('bpc-wallet').value='fictional-wallet';},async review(method='Unpaid'){await this.ready(method);await this.submit();element('bpc-reviewed').checked=true;this.change('bpc-reviewed');}};
}
for(const role of ['admin','cashier','support'])test(role+' sees Users payment corrections without gaining other-business access',()=>{
 const f=fixture();f.setUser({role,active:true});a.match(f.editor.button({id:1,amount:20}),/data-edit-bill-payment="1"/);f.setWorkspace({id:'fiber-resellers'});a.equal(f.editor.button({id:1,amount:20}),'');
});
test('viewer, inactive user and missing bill rights cannot open a payment correction',async()=>{
 const f=fixture();for(const u of [{role:'viewer'},{role:'cashier',active:false}]){f.setUser(u);await f.editor.open(1);a.equal(f.calls.length,0);}f.setUser({role:'cashier',active:true});f.permissions.delete('bills.create');await f.editor.open(1);a.equal(f.calls.length,0);
});
test('selected Cash payment becomes Whish only after wallet, preview and explicit reviewed confirmation',async()=>{
 const f=fixture();await f.ready('Whish Money');f.element('bpc-wallet').value='';await f.submit();a.equal(f.calls.filter(x=>x.method==='preview').length,0);f.element('bpc-wallet').value='fictional-wallet';await f.submit();a.match(f.element('bpc-preview').textContent,/Whish fee after\$0\.20/);a.equal(f.calls.filter(x=>x.method==='correct').length,0);a.equal(f.element('bpc-submit').disabled,true);
 f.element('bpc-reviewed').checked=true;f.change('bpc-reviewed');await f.submit();const input=f.calls.find(x=>x.method==='correct').input;a.deepEqual(input,{billId:1,paymentKey:'original',method:'Whish Money',whishDestinationId:'fictional-wallet',requestId:'fictional-correction-request-0001',token:'a'.repeat(64),reason:'Correct fictional entry'});a.equal(f.storage.size,0);a.equal(f.calls.filter(x=>x.method==='refresh').length,1);
});
test('Unpaid preview and save target only one selected partial collection and omit a wallet',async()=>{
 const f=fixture();f.payments.splice(0,1,{paymentKey:'fictional-collection-one',amount:5,method:'Cash',receivedAt:'2026-11-06T10:00:00',ownerName:'Fictional Cashier',canCorrect:true},{paymentKey:'fictional-collection-two',amount:10,method:'Whish Money',receivedAt:'2026-11-06T11:00:00',ownerName:'Other Fictional Cashier',canCorrect:false,blockedReason:'Other owner'});f.handlers.preview=async input=>({...input,oldMethod:'Cash',amount:5,ownerName:'Fictional Cashier',feeBefore:0,feeAfter:0,debtBefore:5,debtAfter:10,token:'b'.repeat(64)});await f.review();a.match(f.element('bpc-preview').textContent,/Customer debt after\$10\.00/);a.match(f.element('bpc-preview').textContent,/Other payments stay recorded/);await f.submit();const call=f.calls.find(x=>x.method==='correct');a.equal(call.input.paymentKey,'fictional-collection-one');a.equal(call.input.method,'Unpaid');a.equal(Object.hasOwn(call.input,'whishDestinationId'),false);
});
test('blocked payment exposes its concrete reason and cannot be submitted',async()=>{
 const f=fixture();f.payments[0].canCorrect=false;f.payments[0].blockedReason='This payment belongs to a closed month.';await f.ready();a.match(f.element('bpc-source-note').textContent,/closed month/);a.equal(f.element('bpc-submit').disabled,true);await f.submit();a.equal(f.calls.filter(x=>x.method==='preview'||x.method==='correct').length,0);
});
test('closing the editor before saving sends no correction and a late preview cannot reopen it',async()=>{
 const f=fixture(),pending=defer();await f.ready();f.handlers.preview=()=>pending.promise;const run=f.submit();a.equal(f.element('bpc-close').disabled,false);f.close();pending.resolve({billId:1,paymentKey:'original',token:'a'.repeat(64)});await run;a.equal(f.element('bill-payment-correction-dialog').open,false);a.equal(f.calls.filter(x=>x.method==='correct').length,0);await f.editor.open(1);a.equal(f.element('bill-payment-correction-dialog').open,true);
});
test('changing selected method or wallet invalidates the reviewed financial effects',async()=>{
 const f=fixture();await f.review();f.element('bpc-method').value='Whish Money';f.change('bpc-method');a.equal(f.element('bpc-preview').textContent,'');a.equal(f.element('bpc-reviewed').checked,false);a.equal(f.element('bpc-submit').textContent,'Review change');a.equal(f.calls.filter(x=>x.method==='correct').length,0);
});
for(const cause of ['identity','rights','closed'])test('deferred correction preview is ignored after '+cause+' changes',async()=>{
 const f=fixture(),pending=defer();await f.ready();f.handlers.preview=()=>pending.promise;const run=f.submit();if(cause==='identity')f.changeIdentity();if(cause==='rights')f.permissions.clear();if(cause==='closed')f.close();pending.resolve({billId:1,paymentKey:'original',token:'a'.repeat(64)});await run;a.equal(f.element('bpc-preview').textContent,'');a.equal(f.calls.filter(x=>x.method==='correct').length,0);
});
test('customer and history data are inserted as literal text, never executable HTML',async()=>{
 const f=fixture(),attack='<img src=x onerror="globalThis.pwned=true">';f.payments[0].ownerName=attack;f.handlers.options=async()=>({billId:1,receiptNo:attack,paidAmount:20,remainingAmount:0,payments:f.payments,history:[{oldMethod:attack,method:'Cash',amount:20,actorName:attack,reason:attack}]});f.handlers.preview=async input=>({...input,oldMethod:attack,amount:20,ownerName:attack,feeBefore:0,feeAfter:0,debtBefore:0,debtAfter:20,token:'a'.repeat(64)});await f.review();a.match(f.element('bpc-history').textContent,/<img/);a.match(f.element('bpc-preview').textContent,/<img/);a.equal(f.html.length,1);a.equal(f.html.some(x=>x.includes(attack)),false);a.equal(f.context.pwned,undefined);
});
test('lost save response retains one frozen request and status completion never resubmits',async()=>{
 const f=fixture();await f.review();f.handlers.correct=async()=>{throw Error('Fictional response lost');};await f.submit();a.equal(f.storage.size,1);a.equal(f.element('bpc-submit').classList.contains('hidden'),true);f.handlers.status=async input=>({requestId:input.requestId,state:'completed',bill:{id:1}});await f.element('bpc-check').onclick();a.equal(f.calls.filter(x=>x.method==='correct').length,1);a.equal(f.storage.size,0);a.equal(f.element('bill-payment-correction-dialog').open,false);
});
test('reload finds the saved request, checks first and retries only its exact reviewed payload',async()=>{
 const storage=new Map(),old=fixture(storage);await old.review();old.handlers.correct=async()=>{throw Error('Fictional response lost');};await old.submit();const sent=old.calls.find(x=>x.method==='correct').input;
 const f=fixture(storage);await f.editor.open(999);a.equal(f.calls.find(x=>x.method==='options').input.billId,1);a.equal(f.element('bpc-retry').classList.contains('hidden'),true);await f.element('bpc-check').onclick();a.equal(f.element('bpc-retry').classList.contains('hidden'),false);await f.element('bpc-retry').onclick();await Promise.resolve();await Promise.resolve();a.deepEqual(f.calls.find(x=>x.method==='correct').input,sent);
});
test('a successful save with a failed refresh stays saved and never invites a replacement write',async()=>{
 const f=fixture();await f.review();f.config.refresh=async()=>{throw Error('Fictional reload failure');};await f.submit();a.equal(f.storage.size,0);a.equal(f.element('bill-payment-correction-dialog').open,false);a.match(f.toasts.at(-1).message,/Correction saved.*Refresh/);a.equal(f.calls.filter(x=>x.method==='correct').length,1);
});
