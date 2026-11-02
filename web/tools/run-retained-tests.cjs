'use strict';
// Run the unchanged accepted financial unit fixtures against the WEB modules.
// The virtual filename affects test-only relative imports, never production.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),fixtures=path.join(root,'test','retained'),app=path.join(root,'app');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'),'utf8'));
if(process.argv[2]==='--one'){
 const name=process.argv[3],entry=manifest.tests.find(row=>row.file===name);assert(entry,'Choose an explicit retained fixture.');
 const file=path.join(fixtures,name),source=fs.readFileSync(file);assert.equal(hash(source),entry.sha256,'The retained assertion source is unchanged.');
 const deny=()=>{throw Error('External network/provider access is forbidden in retained financial QA.');};
 globalThis.fetch=deny;for(const protocol of ['node:http','node:https']){const value=require(protocol);value.request=value.get=deny;}
 const originalLoad=Module._load;Module._load=function(name,...args){assert.notEqual(name,'electron','The website financial tests must not load Electron.');return originalLoad.call(this,name,...args);};
 const virtual=path.join(app,name),testModule=new Module(virtual,module);testModule.filename=virtual;testModule.paths=Module._nodeModulePaths(app);process.argv=[process.execPath,virtual];testModule._compile(source.toString('utf8'),virtual);
}else{
 const adaptations=new Map(),acceptedAdaptations=new Set(['backup-manager.cjs','reseller-accounting.cjs','reseller-collected-revenue.cjs','reseller-collections.cjs','reseller-funding-service.cjs','month-closing.cjs','backup-archive.cjs']);
 for(const row of manifest.websiteAdaptations||[]){
  assert(acceptedAdaptations.has(row.file),'Only the specifically reviewed website backup, reseller accounting and automatic closing adaptations are accepted.');
  assert(!adaptations.has(row.file),'Duplicate website adaptation.');
  const original=manifest.modules.find(module=>module.file===row.file);
  assert(original&&original.sha256===row.sourceSha256,'Preserve the accepted desktop baseline for each adaptation.');
  assert(/^[a-f0-9]{64}$/.test(row.sha256)&&row.reason,'Record the exact website hash and reason.');
  adaptations.set(row.file,row);
 }
 assert.deepEqual([...adaptations.keys()].sort(),[...acceptedAdaptations].sort(),'Record every reviewed website adaptation with its exact hash.');
 for(const row of manifest.modules){const adapted=adaptations.get(row.file);assert.equal(hash(fs.readFileSync(path.join(app,row.file))),adapted?.sha256||row.sha256,(adapted?'Reviewed website adaptation changed: ':'Accounting module changed from accepted desktop source: ')+row.file);}
 for(const row of manifest.tests)assert.equal(hash(fs.readFileSync(path.join(fixtures,row.file))),row.sha256,'Retained assertion source changed: '+row.file);
 const results=[];for(const row of manifest.tests){const started=Date.now(),run=cp.spawnSync(process.execPath,[__filename,'--one',row.file],{cwd:app,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});const output=(run.stdout||'')+(run.stderr||'');results.push({test:row.file,ok:run.status===0&&!run.error,status:run.status,error:run.error?.message||null,durationMs:Date.now()-started,outputSha256:hash(output),output});console.log((results.at(-1).ok?'PASS ':'FAIL ')+row.file);if(!results.at(-1).ok)console.log(output);}
 const report={sourceVersion:manifest.sourceVersion,moduleCopiesUnchanged:adaptations.size===0,unchangedDesktopModules:manifest.modules.length-adaptations.size,websiteAdaptedModules:[...adaptations.keys()],moduleHashesVerified:true,testsUnchanged:true,tests:results.length,passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,results};fs.mkdirSync(path.join(root,'validation'),{recursive:true});fs.writeFileSync(path.join(root,'validation','retained-financial.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:report.tests,passed:report.passed,failed:report.failed,moduleCopiesUnchanged:report.moduleCopiesUnchanged,unchangedDesktopModules:report.unchangedDesktopModules,websiteAdaptedModules:report.websiteAdaptedModules,moduleHashesVerified:true,testsUnchanged:true}));process.exitCode=report.failed?1:0;
}
