'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {sourceFiles}=require('./package-source.cjs'),root=path.resolve(__dirname,'..');
const files=sourceFiles();let checked=0;
for(const name of files){
 if(/\.(?:js|cjs)$/.test(name)){const result=cp.spawnSync(process.execPath,['--check',path.join(root,name)],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error('JavaScript syntax failed: '+name+'\n'+(result.stderr||result.error?.message||''));checked++;}
 if(/\.(?:js|cjs|json|html|md|yaml|example)$/.test(name)){const text=fs.readFileSync(path.join(root,name),'utf8');if(/EAA[A-Za-z0-9]{70,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|95\.214\.212\.1/.test(text))throw Error('Review a credential or live-server-address pattern in '+name);}
}
const pkg=require('../package.json'),lock=require('../package-lock.json');if(pkg.version!==lock.version||JSON.stringify(pkg.dependencies)!==JSON.stringify(lock.packages[''].dependencies))throw Error('Package lock must match the release dependencies.');
console.log(JSON.stringify({publicFiles:files.length,javascriptSyntaxChecked:checked,privateFilePatternsFound:0,credentialOrLiveAddressPatternsFound:0,lockMatches:true,note:'Pattern checks complement manual review; they are not a penetration test or a coverage measure.'}));
