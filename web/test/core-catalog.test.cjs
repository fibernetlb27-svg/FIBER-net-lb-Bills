'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const initSqlJs=require('sql.js'),{createBackend}=require('../app/core.cjs'),{DATABASES}=require('../app/backup-archive.cjs');
function rows(db,table){const statement=db.prepare('SELECT * FROM '+table+' ORDER BY code'),result=[];try{while(statement.step())result.push(statement.getAsObject());return result;}finally{statement.free();}}
test('existing business catalogs retain exact rows, custom prices, inactive flags and timestamps across startup',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-core-catalog-fictional-'));let core;
 t.after(async()=>{await core?.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-core-catalog-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});
 core=await createBackend({dataDirectory:directory,initialize:true});await core.createOwner({username:'catalog.owner',fullName:'Fictional Catalog Owner',password:'Fictional-catalog-only-123'});await core.close();
 const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});
 const readCatalogs=()=>Object.fromEntries(DATABASES.map(name=>{const db=new SQL.Database(fs.readFileSync(path.join(directory,name)));try{return [name,{bundles:rows(db,'fibernetlb_bundles'),telecom:rows(db,'telecom_catalog')}];}finally{db.close();}}));
 const fresh=readCatalogs();assert.equal(fresh['isp-desk.sqlite'].bundles.length,8);assert.equal(fresh['isp-desk.sqlite'].telecom.length,16,'Brand-new businesses still receive the initial catalog');
 // Model a valid copied business file with administrator-maintained legacy
 // metadata. Direct fixture edits intentionally cover fields absent from UI.
 for(const name of DATABASES){const file=path.join(directory,name),db=new SQL.Database(fs.readFileSync(file));try{
  db.run("UPDATE fibernetlb_bundles SET updated_at='2001-01-01 01:02:03'");db.run("UPDATE telecom_catalog SET updated_at='2001-01-01 01:02:03'");
  db.run("UPDATE fibernetlb_bundles SET name='Fictional custom plan',allowance='27GB',price=123.45,cost=12.34,active=0,sort_order=999,source_url='https://fictional.invalid/plans' WHERE code='NET-6GB'");
  db.run("UPDATE telecom_catalog SET name='Fictional custom recharge',details='Fictional retained details',face_value=1.23,price=9.87,cost=8.54,active=0,sort_order=999,source_url='https://fictional.invalid/recharge' WHERE code='ALFA-1.22'");
  if(name==='isp-desk.sqlite'){db.run("DELETE FROM fibernetlb_bundles WHERE code='NET-18GB'");db.run("DELETE FROM telecom_catalog WHERE code='TOUCH-77.28'");}
  fs.writeFileSync(file,Buffer.from(db.export()),{mode:0o600});
 }finally{db.close();}}
 const copied=readCatalogs();
 for(const initialize of [false,true]){core=await createBackend({dataDirectory:directory,initialize});await core.close();assert.deepEqual(readCatalogs(),copied,'Existing catalogs must remain exact, including when initialization is explicitly allowed');}
});
