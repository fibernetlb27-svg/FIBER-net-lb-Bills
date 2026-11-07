'use strict';
// Explicit public-source export. Never recurse through runtime data or dependencies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const top=['package.json','package-lock.json','server.cjs','Dockerfile','.dockerignore','.gitignore','.gitattributes','README.md','DEPLOYMENT.md','MIGRATION.md','DOMAIN-SETUP.md','RECEIPTS-PRINTING-GUIDE.md'];
const toolNames=['demo.cjs','data-audit.cjs','verify-backup.cjs','run-retained-tests.cjs','container-smoke.cjs','package-source.cjs','check-source.cjs','prepare-domain-config.cjs'];
const testHelpers=['test/helpers/bill-payment-corrections-fixture.cjs'];
const safeAsset=/\.(?:js|css|html|svg|png|jpg|jpeg|ico|woff2?|ttf|txt)$/i;
function filesUnder(relative,accept){
 const result=[];
 function walk(folder){for(const item of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){if(item.name.startsWith('.')||item.name==='node_modules')continue;const file=folder+'/'+item.name;if(item.isSymbolicLink())throw Error('Public source must not contain symbolic links.');if(item.isDirectory())walk(file);else if(item.isFile()&&accept(file))result.push(file);}}
 walk(relative);return result;
}
function sourceFiles(){
 const files=[...top,...fs.readdirSync(path.join(root,'app')).filter(name=>name.endsWith('.cjs')).map(name=>'app/'+name),...filesUnder('app/src',file=>safeAsset.test(file)),...['DAISYUI-LICENSE.txt','icon.ico'].map(name=>'app/build/'+name),...filesUnder('lib',file=>file.endsWith('.cjs')),...filesUnder('deploy',file=>/\/(?:Caddyfile|Caddyfile-domain\.example|compose\.yaml|environment\.example)$/.test(file)),...toolNames.map(name=>'tools/'+name),...fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.cjs')).map(name=>'test/'+name),'test/retained/manifest.json'];
 const retained=JSON.parse(fs.readFileSync(path.join(root,'test/retained/manifest.json'),'utf8'));files.push(...retained.tests.map(row=>'test/retained/'+row.file));
 const unique=[...new Set([...files,...testHelpers])].sort();for(const name of unique){if(name.includes('..')||/\.(?:sqlite(?:-\w+)?|db|fnbak|key|pem|pfx|log)$/i.test(name)||/(?:^|\/)\.env/.test(name))throw Error('A private/runtime file was selected.');const info=fs.lstatSync(path.join(root,name));if(!info.isFile()||info.isSymbolicLink())throw Error('Public source entries must be regular files.');}return unique;
}
function exportSource(destination){
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('Choose a new absolute source export directory.');
 const target=path.resolve(destination);if(fs.existsSync(target))throw Error('Preserve the existing export. Choose a new directory.');
 const entries=sourceFiles().map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {name,bytes,length:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 fs.mkdirSync(target,{recursive:true});for(const entry of entries){const file=path.join(target,entry.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,entry.bytes,{flag:'wx'});}
 const report={format:'FIBERNETLB-WEB-PUBLIC-SOURCE-1',version:require('../package.json').version,scope:'Explicit public application source only; no dependencies, runtime data, credentials, logs or private audit reports.',files:entries.map(({name,length,sha256})=>({name,length,sha256}))};
 fs.writeFileSync(path.join(target,'SOURCE-MANIFEST.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(require.main===module){try{if(process.argv.length!==4||process.argv[2]!=='--out')throw Error('Use --out NEW_ABSOLUTE_DIRECTORY.');const report=exportSource(process.argv[3]);console.log(JSON.stringify({version:report.version,files:report.files.length,privateDataIncluded:false}));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={sourceFiles,exportSource};
