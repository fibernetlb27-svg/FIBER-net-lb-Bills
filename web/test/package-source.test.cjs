'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {sourceFiles,exportSource}=require('../tools/package-source.cjs');
test('public source export includes tested code and exact digests, without runtime/private paths',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-public-source-fictional-')),out=path.join(parent,'public');t.after(()=>{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert(path.basename(parent).startsWith('fibernetlb-public-source-fictional-'));fs.rmSync(parent,{recursive:true,force:true});});
 const names=sourceFiles();assert(names.includes('app/core.cjs'));assert(names.includes('test/retained/manifest.json'));assert(names.includes('tools/data-audit.cjs'));assert(names.includes('app/proradius-validation.cjs'));assert.equal(names.filter(name=>/node_modules|\.qa-|(?:^|\/)validation(?:\/|$)|settings\.json|\.sqlite|\.fnbak|\.key$/.test(name)).length,0);
 const result=exportSource(out);assert.equal(result.files.length,names.length);for(const file of result.files){const bytes=fs.readFileSync(path.join(out,file.name));assert.equal(bytes.length,file.length);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 assert.throws(()=>exportSource(out),/existing export/);assert.throws(()=>exportSource('relative'),/absolute/);assert.equal(fs.existsSync(path.join(out,'app/build/update-rollback.ps1')),false);
});
