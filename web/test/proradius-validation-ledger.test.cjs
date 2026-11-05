'use strict';
// All provider errors and accounting records below are synthetic and in memory.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PortalOperationLedger,initializePortalOperations}=require('../app/portal-operations.cjs');
const {publicMessage}=require('../app/proradius-validation.cjs');
const UNKNOWN='Portal outcome is uncertain. Check Proradius transactions; no second submission or local payment was made.';
const metadata=()=>({operation:'changeservice',code:'expired_current_period',fields:[]});
let sqlPromise;
function rows(db,sql,params=[]){const statement=db.prepare(sql);try{statement.bind(params);const found=[];while(statement.step())found.push(statement.getAsObject());return found;}finally{statement.free();}}
async function fixture(t){
  const SQL=await(sqlPromise||=require('sql.js')()),db=new SQL.Database();t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE fibernetlb_bills(id INTEGER PRIMARY KEY,amount REAL NOT NULL,reference TEXT NOT NULL);
    CREATE TABLE fibernetlb_bundles(id INTEGER PRIMARY KEY);
    CREATE TABLE financial_fixture(id INTEGER PRIMARY KEY,amount INTEGER NOT NULL,note TEXT NOT NULL);
    INSERT INTO fibernetlb_bills VALUES(1,25,'Synthetic previous receipt');
    INSERT INTO financial_fixture VALUES(1,2500,'Synthetic existing drawer and debt proof');`);
  initializePortalOperations(db);
  const ledger=new PortalOperationLedger(db,()=>{},()=>{}),financial=()=>({bills:rows(db,'SELECT * FROM fibernetlb_bills ORDER BY id'),money:rows(db,'SELECT * FROM financial_fixture ORDER BY id')});
  return {SQL,db,ledger,financial,before:financial()};
}
function apply(f,perform,{id='fictional-validation-request',kind='change',entity='customer:fictional.validation.customer'}={}){
  return f.ledger.apply(id,kind,entity,{username:'fictional.validation.customer',targetId:22,amount:0},{expectedId:11,targetId:22,total:3},'Synthetic Operator',perform);
}
function rejection(value=metadata(),status=422){return Object.assign(new Error('Synthetic untrusted response: <img src=x> password=never-display-this-value'),{status,sent:true,...value===undefined?{}:{providerValidation:value}});}
test('a validation failure before submission stays failed without any customer payment',async t=>{
  const f=await fixture(t),preview={operation:'checkchangeservice',code:'expired_current_period',fields:[]},message=publicMessage(preview);let writes=0;
  assert.equal(typeof message,'string');
  await assert.rejects(apply(f,async()=>{throw Object.assign(new Error(message),{status:422,sent:false,providerValidation:preview});}),{message});
  assert.equal(f.ledger.get('fictional-validation-request').state,'failed');
  assert.equal(f.ledger.get('fictional-validation-request').message,message);assert.equal(writes,0);
  assert.deepEqual(rows(f.db,'SELECT state FROM portal_operation_events ORDER BY id').map(row=>row.state),['checking','failed']);
  assert.deepEqual(f.financial(),f.before);
});
for(const kind of ['change','change_renew'])test(`submitted ${kind} HTTP422 retains uncertainty, fixed safe details and replay protection`,async t=>{
  const f=await fixture(t),expected=UNKNOWN+' '+publicMessage(metadata());let writes=0;
  const perform=async before=>{before({phase:'change_submitted'});writes++;throw rejection();};
  await assert.rejects(apply(f,perform,{kind}),{message:expected});
  const saved=f.ledger.get('fictional-validation-request');
  assert.equal(saved.state,'unknown');assert.equal(saved.message,expected);assert.equal(saved.bill_id,null);
  assert.deepEqual(JSON.parse(saved.result_json),{phase:'change_submitted'});assert.equal(writes,1);
  assert.doesNotMatch(saved.message,/never-display|password=|<img/);
  assert.deepEqual(rows(f.db,'SELECT state FROM portal_operation_events ORDER BY id').map(row=>row.state),['checking','processing','unknown']);
  await assert.rejects(apply(f,perform,{kind}),/needs review/);
  await assert.rejects(apply(f,perform,{id:'fictional-replacement-request',kind}),/unfinished portal operation/);
  assert.equal(writes,1);assert.deepEqual(f.financial(),f.before);
});
test('failed read-back after a write stays uncertain even when error.sent is false',async t=>{
  const f=await fixture(t);let writes=0;
  await assert.rejects(apply(f,async before=>{before();writes++;throw Object.assign(new Error('Synthetic failed read-back'),{status:422,sent:false});}),{message:UNKNOWN});
  assert.equal(f.ledger.get('fictional-validation-request').state,'unknown');assert.equal(writes,1);assert.deepEqual(f.financial(),f.before);
});
const ignored=[
  ['missing metadata',null,422,'change'],
  ['extra raw response property',{...metadata(),raw:'password=never-display-this-value'},422,'change'],
  ['unknown code',{...metadata(),code:'<img src=x onerror=alert(1)>'},422,'change'],
  ['unknown field',{...metadata(),fields:['password=never-display-this-value']},422,'change'],
  ['duplicate fields',{...metadata(),fields:['service','service']},422,'change'],
  ['wrong fields type',{...metadata(),fields:'service'},422,'change'],
  ['wrong operation',{...metadata(),operation:'renew'},422,'change'],
  ['preview operation after submission',{...metadata(),operation:'checkchangeservice'},422,'change'],
  ['non422 response',metadata(),500,'change'],
  ['different financial operation',metadata(),422,'topup']
];
for(const[label,value,status,kind]of ignored)test(`unrecognized validation context retains the exact generic message: ${label}`,async t=>{
  const f=await fixture(t);
  await assert.rejects(apply(f,async before=>{before();throw rejection(value,status);},{kind}),{message:UNKNOWN});
  const saved=f.ledger.get('fictional-validation-request');assert.equal(saved.state,'unknown');assert.equal(saved.message,UNKNOWN);
  assert.deepEqual(f.financial(),f.before);
});
test('restart preserves old audit rows and new validation details without replay or financial changes',async t=>{
  const f=await fixture(t);
  for(const state of ['unknown','confirmed','succeeded','failed'])f.db.run("INSERT INTO portal_operations(request_id,kind,entity,fingerprint,input_json,quote_json,state,actor,recorded_at,message,result_json,bill_id) VALUES(?,'change',?,'fictional-proof','{}','{}',?,'Synthetic Previous Operator','2026-11-01T12:00:00.000Z',?,'{}',?)",['fictional-old-'+state,'customer:fictional.old.'+state,state,'Synthetic existing '+state+' message',state==='succeeded'?1:null]);
  await assert.rejects(apply(f,async before=>{before({phase:'change_submitted'});throw rejection();}));
  const audit=rows(f.db,'SELECT * FROM portal_operations ORDER BY request_id'),events=rows(f.db,'SELECT * FROM portal_operation_events ORDER BY id'),schema=rows(f.db,'SELECT type,name,sql FROM sqlite_master ORDER BY type,name');
  const reopened=new f.SQL.Database(f.db.export());t.after(()=>reopened.close());initializePortalOperations(reopened);
  assert.deepEqual(rows(reopened,'SELECT * FROM portal_operations ORDER BY request_id'),audit);
  assert.deepEqual(rows(reopened,'SELECT * FROM portal_operation_events ORDER BY id'),events);
  assert.deepEqual(rows(reopened,'SELECT type,name,sql FROM sqlite_master ORDER BY type,name'),schema);
  const ledger=new PortalOperationLedger(reopened,()=>{},()=>{});let replayed=false;
  await assert.rejects(ledger.apply('fictional-validation-request','change','customer:fictional.validation.customer',{username:'fictional.validation.customer',targetId:22,amount:0},{},'Synthetic Operator',async()=>{replayed=true;}),/needs review/);
  assert.equal(replayed,false);assert.deepEqual(f.financial(),f.before);
});
function renderFixture(phase,message){
  const source=fs.readFileSync(path.join(__dirname,'../app/src/app.js'),'utf8'),start=source.indexOf('function renderChangeRenew(){'),end=source.indexOf('\nasync function runChangeRenew(',start);
  assert(start>=0&&end>start,'Exercise the actual browser rendering function.');
  const elements=new Map();
  const element=selector=>{
    if(!elements.has(selector)){
      const hidden=new Set(),value={textContent:'',value:'',checked:false,disabled:false,classList:{toggle(name,force){if(force)hidden.add(name);else hidden.delete(name);},contains:name=>hidden.has(name)}};
      Object.defineProperty(value,'innerHTML',{set(){throw Error('Browser validation details must use textContent.');}});elements.set(selector,value);
    }
    return elements.get(selector);
  };
  const flow={record:{phase,message,requestId:'fictional-browser-validation',username:'fictional.validation.customer',bill:null},quote:null,customer:null,requestId:'fictional-browser-validation',busy:false,error:''};
  const context=vm.createContext({changeRenewWorkflow:flow,state:{currentUser:{role:'admin'}},$:element,$$:()=>[],WhishPayments:{sync(){}},Date});
  vm.runInContext(source.slice(start,end)+'\nrenderChangeRenew();',context);
  return {status:element('#change-renew-status'),elements,context,flow};
}
test('combined browser shows safe validation details while uncertain payment and retry controls stay locked',()=>{
  const detail=publicMessage(metadata()),f=renderFixture('change_unknown',UNKNOWN+' '+detail),text=f.status.textContent;
  assert.match(text,/Do not submit a replacement or collect the payment yet/);assert(text.endsWith(detail));
  assert.equal(text.includes(UNKNOWN),false,'Do not duplicate the generic unknown-outcome instruction.');
  assert.equal(f.elements.get('#change-renew-payment').classList.contains('hidden'),true);
  assert.equal(f.elements.get('#change-renew-resume').classList.contains('hidden'),true);
  assert.equal(f.elements.get('#change-renew-confirm').disabled,true);
});
test('combined browser retains its exact generic instruction for old generic unknown rows',()=>{
  const f=renderFixture('change_unknown',UNKNOWN);
  assert.equal(f.status.textContent,'Service-change outcome is uncertain. Do not submit a replacement or collect the payment yet.');
});
test('combined browser presents failed validation as literal bounded text without HTML insertion',()=>{
  const malicious='<img src=x onerror="globalThis.injected=true">\0'+('x'.repeat(2000)),f=renderFixture('change_failed',malicious);
  assert.match(f.status.textContent,/No combined customer payment was recorded/);assert(f.status.textContent.includes('<img src=x'));
  assert.equal(f.context.injected,undefined);assert.equal(f.status.textContent.includes('\0'),false);assert(f.status.textContent.length<1200);
  assert.equal(f.elements.get('#change-renew-payment').classList.contains('hidden'),true);
  assert.equal(f.elements.get('#change-renew-resume').classList.contains('hidden'),true);
  assert.equal(f.elements.get('#change-renew-confirm').disabled,true);
});
