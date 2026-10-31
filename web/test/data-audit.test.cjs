'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),{auditCopiedData,compareAudits,assertCopiedSetUnchanged}=require('../tools/data-audit.cjs');
test('copied-data rehearsal preserves every financial row and exposes no customer fields',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-audit-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32));let core;
 t.after(async()=>{await core?.close();secrets.destroy();const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('fibernetlb-audit-fictional-'));fs.rmSync(resolved,{recursive:true,force:true});});
 core=await createBackend({dataDirectory:directory,initialize:true,secrets});await core.createOwner({username:'audit.owner',fullName:'Private Fictional Owner',password:'Fictional-audit-passphrase-123'});
 await assert.rejects(auditCopiedData(directory,{copiedData:true}),/rehearsal server/);await core.close();
 await assert.rejects(auditCopiedData(directory),/copiedData/);const before=await auditCopiedData(directory,{copiedData:true});assert.equal(before.files.length,7);assert.equal(before.readOnly,true);assert(!JSON.stringify(before).includes('Private Fictional Owner'));assert(!JSON.stringify(before).includes('Fictional-audit-passphrase-123'));
 core=await createBackend({dataDirectory:directory,secrets});await core.close();const after=await auditCopiedData(directory,{copiedData:true});assert.deepEqual(compareAudits(before,after).changes,[],'Reopening genuine web core cannot alter stored history or money.');
 const loginCore=await createBackend({dataDirectory:directory,secrets});core=loginCore;const login=await core.request({channel:'auth:login',args:[{username:'audit.owner',password:'Fictional-audit-passphrase-123'}]});assert.equal(login.status,200);const moved=await core.request({channel:'drawer:setBalance',args:[{balance:17.25,note:'Fictional audit change detector'}],token:login.data.sessionToken});assert.equal(moved.status,200);await core.close();const changed=compareAudits(before,await auditCopiedData(directory,{copiedData:true}));assert.equal(changed.equal,false);assert(changed.changes.some(row=>row.name==='isp-desk.sqlite'&&row.field==='custody'));
});
test('copied-data audit detects identity-watermark changes and a late change to an earlier file',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-audit-watermark-fictional-'));let core;
 t.after(async()=>{await core?.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-audit-watermark-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});
 core=await createBackend({dataDirectory:directory,initialize:true});await core.createOwner({username:'watermark.owner',fullName:'Fictional Watermark Owner',password:'Fictional-watermark-only-123'});await core.close();
 const before=await auditCopiedData(directory,{copiedData:true});assert(before.files.every(file=>Object.hasOwn(file.tables,'sqlite_sequence')));
 assertCopiedSetUnchanged(directory,before.files);
 const SQL=await require('sql.js')(),file=path.join(directory,'isp-desk.sqlite'),db=new SQL.Database(fs.readFileSync(file));
 try{db.run("UPDATE sqlite_sequence SET seq=seq+100 WHERE name='users'");fs.writeFileSync(file,Buffer.from(db.export()),{mode:0o600});}finally{db.close();}
 // Exercise the same whole-set final check used after the final section,
 // without timing races, production callbacks or filesystem interception.
 assert.throws(()=>assertCopiedSetUnchanged(directory,before.files),/changed during the read-only audit/);
 const after=await auditCopiedData(directory,{copiedData:true}),comparison=compareAudits(before,after);
 assert.equal(comparison.equal,false);assert.deepEqual(comparison.changes,[{name:'isp-desk.sqlite',field:'table:sqlite_sequence'}]);
 assert.deepEqual(before.files[0].custody,after.files[0].custody,'An identity-only change leaves current financial custody unchanged but must still fail preservation');
 const marker=path.join(directory,'.fibernetlb-web.lock');fs.writeFileSync(marker,'fictional rehearsal writer');assert.throws(()=>assertCopiedSetUnchanged(directory,after.files),/rehearsal server/);fs.unlinkSync(marker);
});
