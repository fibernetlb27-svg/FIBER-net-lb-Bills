'use strict';
// Actual Bank renderer with a tiny DOM adapter. Synthetic data only; no writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
function fixture({role='admin',pending=false,overviewWait=null}={}){
 const ids=new Map(),calls=[],navigations=[],storage=new Map();let user={role,active:true,accountKey:'main:synthetic-admin'},dialogs=0;
 class Element{
  constructor(tag='div'){this.tagName=tag;this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.dataset={};this.classList={add(){},toggle(){}};this._html='';}
  set innerHTML(value){this._html=value;for(const found of value.matchAll(/id="([^"]+)"/g))ids.set(found[1],new Element());}
  get innerHTML(){return this._html;}
  setAttribute(){}replaceChildren(){this._html='';}querySelectorAll(){return [];}addEventListener(){}showModal(){dialogs++;}close(){}remove(){}
 }
 const host=new Element();ids.set('bank-root',host);
 const overview={workspaces:[{id:'fiber-users',name:'Users'},{id:'fiber-resellers',name:'Resellers'}],accounts:[{workspaceId:'fiber-users',workspaceName:'Users',bankBalance:0,deposited:0,withdrawn:0,transferCount:0},{workspaceId:'fiber-resellers',workspaceName:'Resellers',bankBalance:0,deposited:0,withdrawn:0,transferCount:0}],totals:{bankBalance:0,deposited:0,withdrawn:0},history:[]};
 const api={pending:async()=>{calls.push(['pending']);return {requests:pending?[{workspaceId:'fiber-users',requestId:'synthetic-pending-bank',state:'save_required'}]:[]};},overview:async input=>{calls.push(['overview',input]);if(overviewWait)await overviewWait;return overview;},sources:async input=>{calls.push(['sources',input]);return {workspaceId:input.workspaceId,workspaceName:'Users',bankBalance:0,lockedOwner:false,holders:[{accountKey:'main:synthetic-admin',name:'Admin',role:'admin',cashBalance:100,wallets:[{id:'wallet-a',label:'Wallet A',balance:100,active:true}]},{accountKey:'main:synthetic-cashier',name:'Cashier',role:'cashier',cashBalance:50,wallets:[{id:'wallet-b',label:'Wallet B',balance:30,active:true},{id:'wallet-c',label:'Wallet C',balance:20,active:true}]}]};},transfer:async()=>{throw Error('No test may submit a money movement.');}};
 const context=vm.createContext({window:{},document:{getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),body:{append(){}}},Intl,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 vm.runInContext(source,context);const bank=context.window.Bank;
 bank.init({container:'bank-root',api,user,workspace:{id:'main'},getUser:()=>user,onBack:()=>navigations.push('back')});
 return {bank,ids,calls,navigations,get dialogs(){return dialogs;},setUser:next=>{user=next;}};
}
(async()=>{
 let checked=0;
 const denied=fixture({role:'cashier'});await assert.rejects(denied.bank.openDeposit({method:'cash'}),/administrator/);assert.equal(denied.calls.length,0);checked++;
 const wallet=fixture();wallet.bank.suspend();await wallet.bank.openDeposit({workspaceId:'fiber-users',holderAccountKey:'main:synthetic-cashier',method:'whish',walletId:'wallet-c'});assert.equal(wallet.ids.get('bank-transfer-business').value,'fiber-users');assert.equal(wallet.ids.get('bank-holder').value,'main:synthetic-cashier');assert.equal(wallet.ids.get('bank-method').value,'whish');assert.equal(wallet.ids.get('bank-wallet').value,'wallet-c');assert.equal(wallet.navigations.length,0);assert.equal(wallet.dialogs,1);checked++;
 const aggregate=fixture();await aggregate.bank.openDeposit({workspaceId:'all',method:'cash'});assert.equal(aggregate.ids.get('bank-transfer-business').value,'');assert.equal(aggregate.calls.filter(row=>row[0]==='sources').length,0);checked++;
 const unknown=fixture();await assert.rejects(unknown.bank.openDeposit({workspaceId:'missing-business',method:'cash'}),/business.*available/);assert.equal(unknown.dialogs,0);checked++;
 const staleHolder=fixture();await assert.rejects(staleHolder.bank.openDeposit({workspaceId:'fiber-users',holderAccountKey:'missing-holder',method:'cash'}),/holder.*available/);assert.equal(staleHolder.ids.get('bank-holder').value,'');checked++;
 const staleWallet=fixture();await assert.rejects(staleWallet.bank.openDeposit({workspaceId:'fiber-users',holderAccountKey:'main:synthetic-cashier',method:'whish',walletId:'missing-wallet'}),/wallet.*available/);assert.equal(staleWallet.ids.get('bank-wallet').value,'');checked++;
 for(const bad of [{workspaceId:'all',holderAccountKey:'main:synthetic-admin',method:'cash'},{workspaceId:'fiber-users',method:'cash',walletId:'wallet-a'},{method:'cash',amount:100},{workspaceId:'fiber-users',method:'whish',walletId:'wallet-a'}]){const item=fixture();await assert.rejects(item.bank.openDeposit(bad),/valid|Choose/);assert.equal(item.calls.length,0);checked++;}
 const held=fixture({pending:true});await assert.rejects(held.bank.openDeposit({method:'cash'}),/original saved request/);assert.equal(held.dialogs,0);checked++;
 let release;const wait=new Promise(resolve=>{release=resolve;}),raced=fixture({overviewWait:wait}),first=raced.bank.openDeposit({method:'cash'});await Promise.resolve();await assert.rejects(raced.bank.openDeposit({method:'cash'}),/Finish the open/);release();await first;assert.equal(raced.dialogs,1);checked++;
 console.log('Bank dashboard presets QA passed: '+checked+' cases; no navigation or financial submission, exact method/holder/wallet presets, aggregate explicit choice, denied access, stale source rejection, pending recovery and duplicate-open protection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
