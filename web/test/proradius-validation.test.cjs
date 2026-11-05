'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ProradiusApi, PortalError} = require('../app/proradius-api.cjs');
const {publicMessage, readProviderValidation} = require('../app/proradius-validation.cjs');

const route = '/api/user/bulk/actions/';
const json = (body, status = 422, headers = {}) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json', ...headers}});
const metadata = (code, fields = [], operation = 'changeservice') => ({operation, code, fields});

test('known provider reasons yield fixed text and only known structured metadata', async () => {
  for (const [message, code] of [
    ['The subscription has expired.', 'expired_current_period'],
    ['Renew the current period first.', 'expired_current_period'],
    ['Insufficient balance.', 'insufficient_balance'],
    ['Permission denied.', 'permission'],
    ['The selected service is not available for this customer.', 'invalid_service'],
    ['Validation failed.', 'invalid_fields']
  ]) {
    const result = await readProviderValidation(json({message}), {operation:'changeservice'});
    assert.deepEqual(result, metadata(code));
    assert.equal(typeof publicMessage(result), 'string');
    assert.deepEqual(Object.keys(result), ['operation', 'code', 'fields']);
    assert.equal(Object.hasOwn(result, 'message'), false);
  }
  assert.deepEqual(await readProviderValidation(json({body:{message:'Invalid service.'}}), {operation:'checkchangeservice'}), metadata('invalid_service', [], 'checkchangeservice'));
});

test('field validation retains allowlisted names without provider values or unknown keys', async () => {
  const result = await readProviderValidation(json({errors:{
    service:['A valid integer is required.'],
    data:{username:['This field is required.'],service:['Invalid choice.'],password:['This field is required.']},
    'data.service':['This field may not be null.'],
    password:['This field is required.'],secret:'fictional-secret-value'
  }}), {operation:'changeservice'});
  assert.deepEqual(result, metadata('invalid_fields', ['service', 'data.username', 'data.service']));
  assert.match(publicMessage(result), /Check: service, data.username, data.service\./);
  assert.doesNotMatch(JSON.stringify(result) + publicMessage(result), /password|secret|fictional/);
});

test('unknown, secret-bearing, HTML and malformed bodies keep the generic fallback', async () => {
  const responses = [
    json({message:'Something unexpected happened.'}),
    json({message:'Invalid service. token=fictional-secret-value'}),
    json({message:'Bearer fictional-secret-value',password:'fictional-secret-value'}),
    json({errors:{password:['This field is required.'],service:['fictional-secret-value']}}),
    json({message:'Permission denied.',body:{message:'Invalid service.'}}),
    json(['Permission denied.']),
    new Response('<html>Permission denied. fictional-secret-value</html>', {status:422, headers:{'Content-Type':'text/html'}}),
    new Response('{"message":"Permission denied.",', {status:422, headers:{'Content-Type':'application/json'}}),
    new Response('<html>Permission denied.</html>', {status:422, headers:{'Content-Type':'application/json'}})
  ];
  for (const response of responses) assert.equal(await readProviderValidation(response, {operation:'changeservice'}), null);
});

test('provider error reads are capped before and during streaming', async () => {
  let advertisedRead = false;
  const advertised = {status:422,headers:new Headers({'Content-Type':'application/json','Content-Length':'32768'}),body:{getReader(){advertisedRead=true;throw Error('must not read');}}};
  assert.equal(await readProviderValidation(advertised, {operation:'changeservice'}), null);
  assert.equal(advertisedRead, false);
  let cancelled = false;
  const streaming = new Response(new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode('{"message":"Permission denied.","padding":"' + 'x'.repeat(17000)));},
    cancel(){cancelled=true;}
  }), {status:422,headers:{'Content-Type':'application/json'}});
  assert.equal(await readProviderValidation(streaming, {operation:'changeservice'}), null);
  assert.equal(cancelled, true);
});

test('a stalled validation stream observes the existing request abort signal', async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({cancel(){cancelled=true;}}), {status:422,headers:{'Content-Type':'application/json'}});
  const reading = readProviderValidation(response, {operation:'changeservice',signal:controller.signal});
  controller.abort();
  assert.equal(await reading, null);
  assert.equal(cancelled, true);
});

test('publicMessage rejects forged metadata instead of treating stored text as trusted', () => {
  for (const value of [null, {}, metadata('unknown'), metadata('permission', ['password']), metadata('permission', ['service','service']),
    metadata('permission', [], 'renew'), {...metadata('permission'),message:'fictional-secret-value'},
    metadata({toString(){return 'permission';}}), metadata('permission', new Array(1)),
    {operation:'changeservice',code:'permission',get fields(){throw Error('untrusted');}}
  ]) assert.equal(publicMessage(value), null);
});

test('only the exact Change Service POST 422 reads provider validation and preserves sent/status', async () => {
  for (const [method, pathname, op, status, sent, expected] of [
    ['POST',route,'checkchangeservice',422,false,true],
    ['POST',route,'changeservice',422,true,true],
    ['GET',route,'changeservice',422,true,false],
    ['POST','/api/user/','changeservice',422,true,false],
    ['POST',route,'renew',422,true,false],
    ['POST',route,'changeservice',403,true,false],
    ['POST',route,'changeservice',500,true,false]
  ]) {
    let calls=0;
    const api = new ProradiusApi({}, async () => {calls++;return json({message:'Permission denied.'},status);});
    await assert.rejects(api.request(pathname,{method,body:{op},planChange:sent}), error => {
      assert(error instanceof PortalError);assert.equal(error.status,status);assert.equal(error.sent,sent);
      assert.equal(Boolean(error.providerValidation),expected);
      if (expected) {assert.deepEqual(error.providerValidation,metadata('permission',[],op));assert.match(error.message,/not permitted to change the service/);}
      else assert.equal(error.message,status===403?'The portal rejected the API account or its permissions.':`The Internet portal returned HTTP ${status}.`);
      return true;
    });
    assert.equal(calls,1);
  }
});

test('unknown 422 validation keeps the existing status, uncertainty and generic message', async () => {
  const api = new ProradiusApi({}, async () => json({message:'Invalid service. password=fictional-secret-value'}));
  await assert.rejects(api.request(route,{method:'POST',body:{op:'changeservice'},planChange:true}), error => {
    assert.equal(error.message,'The Internet portal returned HTTP 422.');assert.equal(error.status,422);assert.equal(error.sent,true);
    assert.equal(error.providerValidation,undefined);assert.doesNotMatch(JSON.stringify(error),/fictional-secret/);return true;
  });
});

function nativeApi() {
  const calls=[];
  const api = new ProradiusApi({}, async (url,options) => {
    const body=JSON.parse(options.body);calls.push({url,method:options.method,body});
    if(body.op==='checkchangeservice')return json({body:{price:3,current_period_price:3,freetime_price:0,pending_refills:0,pending_refills_price:0}},200);
    assert.equal(body.op,'changeservice');return json({success:true},200);
  });
  api.token=async()=> 'fictional-test-token';
  api.get=async pathname => {assert.match(pathname,/^\/api\/user\/services\/\?/);return {body:[{service_id:571}]};};
  api.customer=async()=>({username:'fictional.native',name:'Fictional Native',phone:'',serviceId:11,service:'6GB',resellerId:2,expiry:'2099-11-05',plans:[{id:571,name:'8GB',cost:16}]});
  return {api,calls};
}

test('native preview string and apply nested numeric payload remain unchanged', async () => {
  const {api,calls}=nativeApi();
  const quote=await api.quoteChange({username:'fictional.native',expectedId:11,targetId:571});
  const originalCustomer=api.customer;let lookups=0,sent=0;
  api.customer=async value => {lookups++;return lookups===1?originalCustomer(value):{username:'fictional.native',serviceId:571,service:'8GB',resellerId:2,expiry:'2099-11-05'};};
  const result=await api.applyQuotedChange(quote,()=>{sent++;});
  assert.equal(result.serviceId,571);assert.equal(sent,1);
  assert.deepEqual(calls.map(call=>call.body),[
    {op:'checkchangeservice',username:'fictional.native',service:'571'},
    {op:'checkchangeservice',username:'fictional.native',service:'571'},
    {op:'changeservice',data:{username:'fictional.native',service:571}}
  ]);
  assert(calls.every(call=>call.method==='POST'&&call.url==='https://pi.fibernetlb.net'+route));
});

test('successful apply followed by failed read-back never retries the provider submission', async () => {
  const {api,calls}=nativeApi();
  const quote=await api.quoteChange({username:'fictional.native',expectedId:11,targetId:571});
  const originalCustomer=api.customer;let lookups=0,sent=0;
  api.customer=async value => {if(++lookups===1)return originalCustomer(value);throw new PortalError('Fictional read-back unavailable.',false,503);};
  await assert.rejects(api.applyQuotedChange(quote,()=>{sent++;}), /read-back unavailable/);
  assert.equal(sent,1);assert.equal(calls.filter(call=>call.body.op==='changeservice').length,1);
});

test('actual API validation reaches the ledger safely while preserving unknown state and replay block', async () => {
  const SQL = await require('sql.js')();
  const {initializePortalOperations, PortalOperationLedger} = require('../app/portal-operations.cjs');
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE fibernetlb_bundles (id INTEGER PRIMARY KEY); CREATE TABLE fibernetlb_bills (id INTEGER PRIMARY KEY, amount REAL); INSERT INTO fibernetlb_bills VALUES (1,25)');
    initializePortalOperations(db);
    const before=db.exec('SELECT * FROM fibernetlb_bills');
    const ledger = new PortalOperationLedger(db,()=>{},()=>{});let submissions=0;
    const api = new ProradiusApi({}, async () => {submissions++;return json({message:'The subscription has expired.',password:'fictional-secret-value'});});
    const perform = async send => {send();return api.request(route,{method:'POST',body:{op:'changeservice',data:{username:'fictional.native',service:571}},planChange:true});};
    await assert.rejects(ledger.apply('fictional_422_change','change','fictional.native',{}, {},'Fictional Admin',perform), /uncertain.*expired or inactive current subscription period/);
    assert.equal(ledger.get('fictional_422_change').state,'unknown');
    assert.doesNotMatch(JSON.stringify(db.exec('SELECT * FROM portal_operations'))+JSON.stringify(db.exec('SELECT * FROM portal_operation_events')), /fictional-secret-value|password/);
    await assert.rejects(ledger.apply('fictional_422_change','change','fictional.native',{}, {},'Fictional Admin',perform), /needs review/);
    assert.equal(submissions,1);assert.deepEqual(db.exec('SELECT * FROM fibernetlb_bills'),before);
  } finally {db.close();}
});
