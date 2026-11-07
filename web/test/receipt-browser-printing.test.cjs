'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'../app/src/receipt-paper.js'),'utf8');

function harness({browser=true,paper='a4',print}={}) {
  class Element {
    constructor(){this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.open=false;this.children=[];this.events=new Map();this.classes=new Set();this.classList={toggle:(name,force)=>force?this.classes.add(name):this.classes.delete(name)};}
    appendChild(child){this.children.push(child);return child;}
    replaceChildren(...children){this.children=children;}
    add(child){this.children.push(child);}
    closest(){return this.label ||= new Element();}
    querySelectorAll(){return this.closeButtons ||= [new Element(),new Element()];}
    addEventListener(type,callback){this.events.set(type,callback);}
    emit(type,event={}){this.events.get(type)?.(event);}
  }
  const ids=['receipt-paper-size','receipt-paper-settings','receipt-paper-note','receipt-printer','receipt-printer-status','refresh-receipt-printers','print-receipt','receipt-dialog','printable-receipt'];
  const elements=new Map(ids.map(id=>[id,new Element()]));
  elements.get('receipt-dialog').open=true;
  const saved=new Map([['fibernetlb.users-receipt-paper.v1',paper],['fibernetlb.users-receipt-printers.v1',JSON.stringify({a4:'Old desktop-only mapping'})]]);
  const events=new Map(),calls={prints:0,printers:0,native:[]};
  const document={head:new Element(),body:new Element(),querySelector:selector=>elements.get(selector.slice(1)),createElement:()=>new Element()};
  const window={posApi:{...(browser?{web:{}}:{}),printing:{printers:async()=>{calls.printers++;return [{name:'Old desktop-only mapping',displayName:'Fictional installed printer',isDefault:true}];},printReceipt:async input=>{calls.native.push({...input});return {success:true};}}},addEventListener:(type,callback)=>{if(!events.has(type))events.set(type,new Set());events.get(type).add(callback);},removeEventListener:(type,callback)=>events.get(type)?.delete(callback),print:()=>{calls.prints++;return print?.({window,document,emit});}};
  function emit(type){for(const callback of [...(events.get(type)||[])])callback();}
  vm.runInNewContext(source,{window,document,localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},crypto,Option:class{constructor(text,value){this.text=text;this.value=value;}}},{filename:'receipt-paper.js'});
  const api=window.ReceiptPaper,el=id=>elements.get(id),release=el('receipt-paper-settings').children.find(child=>child.id==='receipt-print-dialog-closed');
  return {api,el,release,window,document,calls,events,emit,saved};
}

test('browser paper settings work in every business and ignore old desktop printer mappings',async()=>{
  const h=harness();
  for(const business of ['main','fiber-users','fiber-resellers','printer','studio','iptv','mobile-ogero']){
    h.api.apply(business);
    assert.equal(h.el('receipt-paper-settings').classes.has('hidden'),false,business);
    assert.equal(h.el('receipt-paper-size').disabled,false);
    assert.equal(h.document.body.dataset.receiptPaperScope,'users');
    assert.match(h.document.head.children[0].textContent,/size: A4 portrait/);
    assert.equal(h.el('receipt-printer').closest().hidden,true);
    assert.match(h.el('receipt-printer-status').textContent,/this device.*Destination \/ Printer/);
  }
  h.el('receipt-paper-size').value='thermal-58';h.el('receipt-paper-size').emit('change');
  assert.equal(h.document.body.dataset.receiptPaper,'thermal-58');
  assert.equal(h.saved.get('fibernetlb.users-receipt-paper.v1'),'thermal-58');
  assert.equal(h.calls.printers,0,'Website never enumerates server or client printers');
  assert.equal(h.calls.native.length,0);
});

test('asynchronous browser print keeps its layout until afterprint without claiming success',async()=>{
  const h=harness({print:({document})=>assert.equal(document.body.dataset.printTarget,'receipt')});
  h.api.apply('fiber-resellers');h.api.open();h.api.setBusy(true);
  const result=await h.api.print();h.api.setBusy(false);
  assert.equal(result.dialogOnly,true);assert.equal(result.success,undefined);
  assert.equal(h.document.body.dataset.printTarget,'receipt','Returning from window.print is not completion');
  assert.equal(h.el('print-receipt').disabled,true);assert.equal(h.el('receipt-paper-size').disabled,true);
  assert.equal(h.release.hidden,false);
  await assert.rejects(h.api.print(),/current print dialog/);assert.equal(h.calls.prints,1);
  h.emit('afterprint');
  assert.equal(h.document.body.dataset.printTarget,undefined);assert.equal(h.el('print-receipt').disabled,false);
  assert.equal(h.release.hidden,true);assert.equal(h.events.get('afterprint').size,0);
  assert.match(h.el('receipt-printer-status').textContent,/cannot tell whether a copy printed/);
});

test('synchronous afterprint also clears the request without leaving controls busy',async()=>{
  const h=harness({print:({emit})=>emit('afterprint')});h.api.apply('fiber-users');h.api.open();
  h.api.setBusy(true);await h.api.print();h.api.setBusy(false);
  assert.equal(h.document.body.dataset.printTarget,undefined);assert.equal(h.el('print-receipt').disabled,false);
  assert.equal(h.events.get('afterprint').size,0);assert.equal(h.calls.prints,1);
});

test('explicit dialog-close acknowledgement unlocks a missing afterprint without reprinting',async()=>{
  const h=harness();h.api.apply('studio');h.api.open();await h.api.print();
  const oldAfter=[...h.events.get('afterprint')][0];
  h.release.emit('click');assert.equal(h.calls.prints,1);assert.equal(h.document.body.dataset.printTarget,undefined);
  assert.equal(h.el('print-receipt').disabled,false);assert.match(h.el('receipt-printer-status').textContent,/No print was repeated/);
  await h.api.print();oldAfter();
  assert.equal(h.calls.prints,2);assert.equal(h.document.body.dataset.printTarget,'receipt','Stale cleanup cannot clear a later explicit request');
  assert.equal(h.el('print-receipt').disabled,true);h.emit('afterprint');
});

test('receipt close and business teardown remove pending print state',async()=>{
  const h=harness();h.api.apply('main');h.api.open();await h.api.print();
  h.el('receipt-dialog').open=false;h.el('receipt-dialog').emit('close');
  assert.equal(h.document.body.dataset.printTarget,undefined);assert.equal(h.events.get('afterprint').size,0);
  assert.equal(h.el('printable-receipt').dataset.receiptToken,undefined);
  await assert.rejects(h.api.print(),/Open a saved receipt/);
  h.el('receipt-dialog').open=true;h.api.open();await h.api.print();h.api.apply('');
  assert.equal(h.document.body.dataset.printTarget,undefined);assert.equal(h.el('receipt-paper-settings').classes.has('hidden'),true);
});

test('print errors and unavailable browser printing do not retry or retain a busy request',async()=>{
  const h=harness({print:()=>{throw Error('Fictional blocked print');}});h.api.apply('printer');h.api.open();
  await assert.rejects(h.api.print(),/Fictional blocked/);assert.equal(h.calls.prints,1);
  assert.equal(h.document.body.dataset.printTarget,undefined);assert.equal(h.el('print-receipt').disabled,false);
  assert.equal(h.events.get('afterprint').size,0);
  h.window.print=undefined;await assert.rejects(h.api.print(),/Printing is unavailable/);
  assert.equal(h.calls.prints,1);assert.equal(h.release.hidden,true);
});

test('native desktop retains Users-only paper and installed printer behavior',async()=>{
  const h=harness({browser:false});h.api.apply('printer');
  assert.equal(h.el('receipt-paper-settings').classes.has('hidden'),true);
  await assert.rejects(h.api.print(),/Open a Users receipt/);
  h.api.apply('fiber-users');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.el('receipt-paper-settings').classes.has('hidden'),false);assert.equal(h.calls.printers,1);
  assert.equal(h.el('receipt-printer').closest().hidden,false);h.api.open();
  assert.equal((await h.api.print()).success,true);
  assert.deepEqual(h.calls.native,[{paperType:'a4',printerName:'Old desktop-only mapping'}]);
  assert.equal(h.calls.prints,0);
});
