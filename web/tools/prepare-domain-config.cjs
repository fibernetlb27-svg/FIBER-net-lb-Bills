'use strict';
// Prepare new candidate files only. Never contacts DNS, a CA, SSH or the app.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function primaryOrigin(value){
 let url;try{url=new URL(value);}catch{throw Error('Choose the existing explicit HTTPS IPv4 origin.');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port||net.isIP(url.hostname)!==4)throw Error('The primary origin must be the existing HTTPS IPv4 address on standard port 443.');
 const octets=url.hostname.split('.').map(Number);if(octets[0]===0||octets[0]===127||octets[0]>=224||octets.every(v=>v===255))throw Error('Choose the existing unicast IPv4 website address.');
 return url;
}
function domainName(value){
 if(typeof value!=='string'||value!==value.trim()||value.length>253||!value.includes('.')||/[^A-Za-z0-9.-]/.test(value))throw Error('Enter one exact public DNS hostname, without scheme, port, path or wildcard.');
 const domain=value.toLowerCase(),labels=domain.split('.');
 if(labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||!/^[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(labels.at(-1))||net.isIP(domain)||/\.(?:local|localhost|internal|test|invalid|example)$/.test(domain))throw Error('Choose a complete public DNS hostname. Local names, IPs and wildcard aliases are not supported by this candidate.');
 return domain;
}
function serverDirectory(value,domain){
 const directory=value??'/srv/fibernetlb/private/domain-candidate-'+domain;
 if(typeof directory!=='string'||!/^\/srv\/fibernetlb\/private\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(directory)||['.','..'].includes(directory.split('/').at(-1)))throw Error('Choose one candidate directory directly inside /srv/fibernetlb/private.');
 return directory;
}
function inside(candidate,root){const relative=path.relative(root,candidate);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function prepare({primary,domain,out,serverPath}={}){
 const origin=primaryOrigin(primary),hostname=domainName(domain),targetOrigin='https://'+hostname,remote=serverDirectory(serverPath,hostname);
 if(typeof out!=='string'||!path.isAbsolute(out))throw Error('Choose a new absolute output directory outside the public application package.');
 const target=path.resolve(out);if(inside(target,ROOT)||fs.existsSync(target))throw Error('Preserve existing files. Choose a new output directory outside the application package.');
 const parent=fs.realpathSync(path.dirname(target));if(path.resolve(parent)!==path.resolve(path.dirname(target)))throw Error('The output parent must be its real directory, not a symbolic-link path.');
 const template=fs.readFileSync(path.join(ROOT,'deploy/Caddyfile-domain.example'),'utf8');
 const compose=`# Candidate only. Append AFTER every currently active Compose override.\n# Existing primary APP_ORIGIN, data, key, provider switch and CA volumes stay in place.\nservices:\n  web:\n    environment:\n      APP_ADDITIONAL_ORIGINS: ${JSON.stringify(targetOrigin)}\n  caddy:\n    environment:\n      APP_IP_ADDRESS: ${JSON.stringify(origin.hostname)}\n      APP_DOMAIN: ${JSON.stringify(hostname)}\n    volumes:\n      - type: bind\n        source: ${JSON.stringify(remote+'/Caddyfile')}\n        target: /etc/caddy/Caddyfile\n        read_only: true\n        bind:\n          create_host_path: false\n`;
 const readme=`# Unapplied domain candidate\n\nPrimary IP origin: ${origin.origin}\nAdditional exact origin: ${targetOrigin}\nExpected private Ubuntu candidate directory: ${remote}\n\nThis tool created files only. It did not change DNS, firewall rules, certificates, services, application data, provider settings or accounts.\n\nUse only with an existing IP-primary deployment whose additional-origin list is empty. If aliases already exist, review and merge their exact origins; this candidate replaces the alias environment value.\n\nBefore applying, have the ISP confirm this exact hostname, its public A/AAAA target and inbound TCP 80/443 route to the Ubuntu gateway. Do not guess or reuse an older application's public address. DNS alone does not forward traffic. Avoid an AAAA record unless its IPv6 route works.\n\nCopy these candidate files to the private Ubuntu directory above without overwriting an existing candidate. Review the resolved configuration with all currently active Compose files in their original order and this override last. It must preserve the single backend, private data and key mounts, provider switch, trusted proxy address, gateway bindings and persistent Caddy certificate volumes. No second accounting writer or database copy is needed.\n\nValidate the Caddyfile with the exact APP_IP_ADDRESS and APP_DOMAIN values, then verify certificate issuance prerequisites. This example disables Caddy's admin API, so applying the reviewed file requires the existing operator's gateway replacement procedure, not an unauthenticated reload endpoint. No deployment command is run by this tool.\n\nAfter approved activation, use ordinary trusted HTTPS on the domain and the original IP. Sign in separately on each origin. Check read-only metadata and security rejection cases; do not create a payment merely to test connectivity. Preserve original request IDs after an uncertain result.\n\nSee the public DOMAIN-SETUP.md for the detailed staging and acceptance procedure.\n`;
 const files=[['Caddyfile',template],['compose-domain-candidate.yaml',compose],['README.md',readme]];
 const report={format:'FIBERNETLB-DOMAIN-CANDIDATE-1',version:require('../package.json').version,primaryOrigin:origin.origin,additionalOrigin:targetOrigin,hostname,serverDirectory:remote,createdAt:new Date().toISOString(),activationPerformed:false,dnsChanged:false,firewallChanged:false,dataChanged:false,files:files.map(([name,text])=>({name,size:Buffer.byteLength(text),sha256:hash(Buffer.from(text))}))};
 fs.mkdirSync(target,{mode:0o700});for(const [name,text]of files)fs.writeFileSync(path.join(target,name),text,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(target,'DOMAIN-CANDIDATE.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 return report;
}
function main(argv){
 const values={};for(let i=0;i<argv.length;i+=2){const name=argv[i];if(!['--primary-origin','--domain','--out','--server-directory'].includes(name)||!argv[i+1]||Object.hasOwn(values,name))throw Error('Use --primary-origin EXISTING_HTTPS_IP --domain EXACT_DNS_HOST --out NEW_ABSOLUTE_DIRECTORY [--server-directory PRIVATE_UBUNTU_DIRECTORY].');values[name]=argv[i+1];}
 const report=prepare({primary:values['--primary-origin'],domain:values['--domain'],out:values['--out'],serverPath:values['--server-directory']});
 process.stdout.write(JSON.stringify({prepared:true,version:report.version,files:report.files.length+1,activationPerformed:false,dnsChanged:false,firewallChanged:false,dataChanged:false})+'\n');
}
if(require.main===module)try{main(process.argv.slice(2));}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
module.exports={prepare,primaryOrigin,domainName,serverDirectory};
