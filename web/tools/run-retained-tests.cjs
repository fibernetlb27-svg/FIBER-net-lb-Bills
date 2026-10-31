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
 for(const row of manifest.modules)assert.equal(hash(fs.readFileSync(path.join(app,row.file))),row.sha256,'Accounting module changed from accepted desktop source: '+row.file);
 for(const row of manifest.tests)assert.equal(hash(fs.readFileSync(path.join(fixtures,row.file))),row.sha256,'Retained assertion source changed: '+row.file);
 const results=[];for(const row of manifest.tests){const started=Date.now(),run=cp.spawnSync(process.execPath,[__filename,'--one',row.file],{cwd:app,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});const output=(run.stdout||'')+(run.stderr||'');results.push({test:row.file,ok:run.status===0&&!run.error,status:run.status,error:run.error?.message||null,durationMs:Date.now()-started,outputSha256:hash(output),output});console.log((results.at(-1).ok?'PASS ':'FAIL ')+row.file);if(!results.at(-1).ok)console.log(output);}
 const report={sourceVersion:manifest.sourceVersion,moduleCopiesUnchanged:true,testsUnchanged:true,tests:results.length,passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,results};fs.mkdirSync(path.join(root,'validation'),{recursive:true});fs.writeFileSync(path.join(root,'validation','retained-financial.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:report.tests,passed:report.passed,failed:report.failed,moduleCopiesUnchanged:true,testsUnchanged:true}));process.exitCode=report.failed?1:0;
}
