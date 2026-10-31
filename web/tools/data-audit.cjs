'use strict';
// Read-only comparison for an EXPLICIT COPY of the stopped seven-database set.
// This never searches the Main PC or opens its normal application data path.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const initSql=require('sql.js'),Finance=require('../app/finance-ledger.cjs'),Whish=require('../app/whish-destinations.cjs');
const {DATABASES}=require('../app/backup-archive.cjs');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function regular(file){const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Every copied database must be a regular file.');return info;}
function exactTotal(values){const total=values.reduce((n,value)=>{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-6)throw Error('A copied monetary value could not be verified.');return n+BigInt(Math.round(value*100));},0n);if(total>BigInt(Number.MAX_SAFE_INTEGER)||total< -BigInt(Number.MAX_SAFE_INTEGER))throw Error('The copied monetary total exceeds exact cents.');return Number(total)/100;}
function assertCopiedSetUnchanged(root,expectedFiles){
 if(fs.existsSync(path.join(root,'.fibernetlb-web.lock')))throw Error('Stop the copied-data rehearsal server before auditing its files.');
 assert.deepEqual(expectedFiles.map(row=>row.name).sort(),[...DATABASES].sort());
 for(const expected of expectedFiles){const file=path.join(root,expected.name);regular(file);if(digest(fs.readFileSync(file))!==expected.fileSha256)throw Error('A copied database changed during the read-only audit. Stop all copied-data writers first.');}
}
async function auditCopiedData(directory,{copiedData=false}={}){
 if(!copiedData)throw Error('Confirm copiedData:true. Audit only an explicit consistent COPY, never an active data directory.');
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Choose an absolute copied-data directory.');
 const root=path.resolve(directory),info=fs.lstatSync(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Choose a regular copied-data directory.');
 if(fs.existsSync(path.join(root,'.fibernetlb-web.lock')))throw Error('Stop the copied-data rehearsal server before auditing its files.');
 const sectionInfo=fs.lstatSync(path.join(root,'sections'));if(!sectionInfo.isDirectory()||sectionInfo.isSymbolicLink())throw Error('Choose a regular copied sections directory.');
 const initialFiles=DATABASES.map(name=>{const file=path.join(root,name);regular(file);return {name,fileSha256:digest(fs.readFileSync(file))};});
 const SQL=await initSql({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});
 let destinations=[];const reports=[];
 for(const name of DATABASES){const file=path.join(root,name),before=fs.readFileSync(file),fileHash=digest(before);if(fileHash!==initialFiles.find(row=>row.name===name).fileSha256)throw Error('A copied database changed during the read-only audit. Stop all copied-data writers first.');const db=new SQL.Database(before);
  try{
   const check=Finance.query(db,'PRAGMA integrity_check');if(check.length!==1||Object.values(check[0])[0]!=='ok')throw Error('A copied database failed integrity checking.');
   const schema=Finance.query(db,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR name='sqlite_sequence' ORDER BY type,name"),tables={};
   // AUTOINCREMENT watermarks protect future record identity even when the
   // highest original row was deleted; retain them alongside application rows.
   for(const table of Finance.query(db,"SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name")){const quoted='"'+table.name.replaceAll('"','""')+'"',rows=Finance.query(db,'SELECT * FROM '+quoted),serialized=rows.map(row=>JSON.stringify(row)).sort();tables[table.name]={rows:rows.length,sha256:digest(JSON.stringify(serialized))};}
   const has=target=>Object.hasOwn(tables,target)||schema.some(row=>row.type==='view'&&row.name===target);
   if(name==='isp-desk.sqlite'&&has('whish_destinations'))destinations=Whish.listDestinations(db,true);
   const custody={cash:has('active_cash_drawer_transactions')?exactTotal(Finance.query(db,'SELECT amount FROM active_cash_drawer_transactions').map(row=>row.amount)):null,whish:has('finance_wallet_entries')&&has('payment_destinations')?exactTotal(Finance.walletBalances(db,destinations,null).map(row=>row.balance)):null};
   reports.push({name,fileBytes:before.length,fileSha256:fileHash,schemaSha256:digest(JSON.stringify(schema)),tables,custody});
   if(digest(fs.readFileSync(file))!==fileHash)throw Error('A copied database changed during the read-only audit. Stop all copied-data writers first.');
  }finally{db.close();}
 }
 // Recheck the complete initial set after the last section. A late change to
 // an already-audited Main file must invalidate the whole rehearsal snapshot.
 assertCopiedSetUnchanged(root,initialFiles);
 return {format:'FIBERNETLB-COPIED-DATA-AUDIT-1',privateReport:true,createdAt:new Date().toISOString(),readOnly:true,files:reports};
}
function compareAudits(before,after){
 for(const value of [before,after]){assert.equal(value?.format,'FIBERNETLB-COPIED-DATA-AUDIT-1');assert.equal(value.files?.length,DATABASES.length);assert.deepEqual(value.files.map(row=>row.name).sort(),[...DATABASES].sort());}
 const changes=[];for(const name of DATABASES){const left=before.files.find(row=>row.name===name),right=after.files.find(row=>row.name===name);for(const field of ['schemaSha256','custody'])if(JSON.stringify(left[field])!==JSON.stringify(right[field]))changes.push({name,field});for(const table of [...new Set([...Object.keys(left.tables),...Object.keys(right.tables)])].sort())if(JSON.stringify(left.tables[table])!==JSON.stringify(right.tables[table]))changes.push({name,field:'table:'+table});}
 return {format:'FIBERNETLB-COPIED-DATA-COMPARISON-1',equal:changes.length===0,databases:DATABASES.length,changes,scope:'All stored application table rows, AUTOINCREMENT watermarks, schema, cash and wallet totals. Physical SQLite page layout may differ.'};
}
async function main(args){
 if(args[0]==='compare'&&args.length===3){const result=compareAudits(JSON.parse(fs.readFileSync(args[1],'utf8')),JSON.parse(fs.readFileSync(args[2],'utf8')));console.log(JSON.stringify(result,null,2));if(!result.equal)process.exitCode=1;return;}
 if(args[0]!=='inspect'||args.length!==4||args[3]!=='--copied-data')throw Error('Use inspect ABSOLUTE_COPIED_DIRECTORY NEW_PRIVATE_REPORT.json --copied-data, or compare BEFORE.json AFTER.json.');
 const out=path.resolve(args[2]);if(fs.existsSync(out))throw Error('Preserve the existing private audit report.');const result=await auditCopiedData(path.resolve(args[1]),{copiedData:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Read-only copied-data audit passed for all seven databases. Keep this hashed report private; no source customer rows were exported.');
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Copied-data audit failed. Verify the explicit copy, complete seven-file set, stopped rehearsal server and new private report path. Nothing was migrated or replaced.');process.exitCode=1;});
module.exports={auditCopiedData,compareAudits,assertCopiedSetUnchanged};
