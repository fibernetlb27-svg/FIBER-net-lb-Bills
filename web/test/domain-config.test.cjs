'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const Tool=require('../tools/prepare-domain-config.cjs'),{sourceFiles}=require('../tools/package-source.cjs');
const root=path.resolve(__dirname,'..');
function temporary(t){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-domain-fictional-'));t.after(()=>{assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert(path.basename(parent).startsWith('fibernetlb-domain-fictional-'));fs.rmSync(parent,{recursive:true,force:true});});return parent;}
test('domain preparation creates verified new candidate files without activating or modifying an installation',t=>{
 const parent=temporary(t),out=path.join(parent,'candidate'),report=Tool.prepare({primary:'https://192.0.2.40',domain:'Accounts.Example.com',out,serverPath:'/srv/fibernetlb/private/fictional-domain-candidate'});
 assert.equal(report.primaryOrigin,'https://192.0.2.40');assert.equal(report.additionalOrigin,'https://accounts.example.com');assert.equal(report.activationPerformed,false);assert.equal(report.dnsChanged,false);assert.equal(report.firewallChanged,false);assert.equal(report.dataChanged,false);
 assert.deepEqual(fs.readdirSync(out).sort(),['Caddyfile','DOMAIN-CANDIDATE.json','README.md','compose-domain-candidate.yaml']);
 for(const row of report.files){const file=fs.readFileSync(path.join(out,row.name));assert.equal(file.length,row.size);assert.equal(crypto.createHash('sha256').update(file).digest('hex'),row.sha256);if(process.platform!=='win32')assert.equal(fs.statSync(path.join(out,row.name)).mode&0o777,0o600);}
 const compose=fs.readFileSync(path.join(out,'compose-domain-candidate.yaml'),'utf8');assert.match(compose,/APP_ADDITIONAL_ORIGINS: "https:\/\/accounts\.example\.com"/);assert.match(compose,/APP_IP_ADDRESS: "192\.0\.2\.40"/);assert.match(compose,/source: "\/srv\/fibernetlb\/private\/fictional-domain-candidate\/Caddyfile"/);
 assert.doesNotMatch(compose,/\n\s*(APP_ORIGIN|PROVIDERS_ENABLED|ports|networks|dataDirectory|replicas|trusted_proxies|command|build):/);assert.equal((compose.match(/target:/g)||[]).length,1);assert.match(compose,/target: \/etc\/caddy\/Caddyfile/);assert.match(compose,/create_host_path: false/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'DOMAIN-CANDIDATE.json'),'utf8')),report);
 const before=fs.readFileSync(path.join(out,'Caddyfile'));assert.throws(()=>Tool.prepare({primary:'https://192.0.2.40',domain:'other.example.com',out}),/Preserve existing/);assert.ok(fs.readFileSync(path.join(out,'Caddyfile')).equals(before));
});
test('domain preparation rejects injection, local or wildcard aliases and unsafe paths before creating files',t=>{
 const parent=temporary(t),base={primary:'https://192.0.2.40',domain:'accounts.example.com'};
 const domains=['*.example.com','https://accounts.example.com','accounts.example.com/path','accounts.example.com:8443','accounts.example.com\nadmin off','a{b}.example.com','accounts.example.com,other.example.com','localhost','office.local','office.internal','192.0.2.41','one..example.com','trailing.example.com.','-bad.example.com','bad-.example.com','éxample.com'];
 let count=0;for(const domain of domains){const out=path.join(parent,'rejected-'+count++);assert.throws(()=>Tool.prepare({...base,domain,out}));assert.equal(fs.existsSync(out),false);}
 for(const primary of ['http://192.0.2.40','https://user:password@192.0.2.40','https://192.0.2.40/path','https://192.0.2.40?x=1','https://192.0.2.40#part','https://192.0.2.40:8443','https://0.0.0.0','https://127.0.0.1','https://224.0.0.1','https://accounts.example.com']){const out=path.join(parent,'rejected-'+count++);assert.throws(()=>Tool.prepare({...base,primary,out}));assert.equal(fs.existsSync(out),false);}
 for(const serverPath of ['/srv/fibernetlb/private/../live-data','/srv/fibernetlb/private','/etc/caddy','/srv/fibernetlb/private/a/b','/srv/fibernetlb/private/a\nmalicious','/srv/fibernetlb/private/.']){const out=path.join(parent,'rejected-'+count++);assert.throws(()=>Tool.prepare({...base,serverPath,out}));assert.equal(fs.existsSync(out),false);}
 assert.throws(()=>Tool.prepare({...base,out:'relative-folder'}));assert.throws(()=>Tool.prepare({...base,out:path.join(root,'fictional-domain-candidate')}),/outside/);assert.equal(fs.readdirSync(parent).length,0);
});
test('candidate gateway has exactly two HTTPS sites and never rewrites origins or enables unknown-host issuance',()=>{
 const text=fs.readFileSync(path.join(root,'deploy/Caddyfile-domain.example'),'utf8');assert.equal((text.match(/^https:\/\//gm)||[]).length,2);assert.match(text,/https:\/\/\{\$APP_IP_ADDRESS\} \{\s+tls internal/);assert.match(text,/https:\/\/\{\$APP_DOMAIN\} \{/);assert.match(text,/default_sni \{\$APP_IP_ADDRESS\}/);assert.match(text,/skip_install_trust/);assert.match(text,/admin off/);assert.equal((text.match(/^\s+reverse_proxy /gm)||[]).length,1);assert.match(text,/reverse_proxy web:3000/);
 assert.doesNotMatch(text,/header_up|header_down|on_demand|local_certs|auto_https off|\*\.|lb_retries|lb_try_duration|\n\s*log\s*\{/);
});
test('CLI produces only a new candidate and rejects duplicate arguments rather than interpreting commands',t=>{
 const parent=temporary(t),out=path.join(parent,'cli-candidate'),script=path.join(root,'tools/prepare-domain-config.cjs');
 const completed=cp.spawnSync(process.execPath,[script,'--primary-origin','https://192.0.2.40','--domain','accounts.example.com','--out',out],{encoding:'utf8',windowsHide:true});assert.equal(completed.status,0);assert.deepEqual(JSON.parse(completed.stdout),{prepared:true,version:require('../package.json').version,files:4,activationPerformed:false,dnsChanged:false,firewallChanged:false,dataChanged:false});assert.equal(completed.stderr,'');
 const invalid=cp.spawnSync(process.execPath,[script,'--domain','accounts.example.com','--domain','other.example.com','--out',path.join(parent,'duplicate')],{encoding:'utf8',windowsHide:true});assert.equal(invalid.status,1);assert.equal(fs.existsSync(path.join(parent,'duplicate')),false);
});
test('only the explicit public domain guide, generator and template join the existing source allowlist',()=>{
 const files=sourceFiles();for(const name of ['DOMAIN-SETUP.md','tools/prepare-domain-config.cjs','deploy/Caddyfile-domain.example'])assert.ok(files.includes(name));assert.ok(files.every(name=>!name.includes('DOMAIN-CANDIDATE.json')&&!name.includes('compose-domain-candidate.yaml')&&!name.includes('private/')));
});
