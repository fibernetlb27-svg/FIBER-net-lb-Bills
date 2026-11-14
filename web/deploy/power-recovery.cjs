'use strict';
// Host operator service, never an HTTP/RPC endpoint. Run under a persistent host
// flock. It archives only an exact previously attested, previous-boot marker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const FORMAT='FIBERNETLB-POWER-RECOVERY-CONFIG-1';
const STATE_FORMAT='FIBERNETLB-POWER-RECOVERY-ATTESTATION-1';
const AUDIT_FORMAT='FIBERNETLB-POWER-RECOVERY-AUDIT-1';
const DATABASES=Object.freeze(['isp-desk.sqlite',...['fiber-users','fiber-resellers','iptv','printer','studio','mobile-ogero'].map(id=>'sections/'+id+'.sqlite')]);
const OMIT=new Set(['backups','scheduled-backups','recovered-backups']);
const MAX_BYTES=512*1024*1024, MAX_FILES=2048;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
class GuardError extends Error { constructor(code){super(code);this.name='GuardError';this.code=code;} }
function ensure(value,code){if(!value)throw new GuardError(code);}
function inside(file,root){const relative=path.posix.relative(root,file);return !relative||relative!=='..'&&!relative.startsWith('../')&&!path.posix.isAbsolute(relative);}
function absolute(value){return typeof value==='string'&&path.posix.isAbsolute(value)&&path.posix.resolve(value)===value&&!value.includes('\0')&&!value.includes('\\');}
function exactKeys(value,keys,code){ensure(value&&typeof value==='object'&&!Array.isArray(value),code);ensure(Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key)),code);}
function readBytes(file,limit=1024*1024){
 const before=fs.lstatSync(file,{bigint:true});ensure(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=BigInt(limit),'UNTRUSTED_FILE');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const stat=fs.fstatSync(fd,{bigint:true});ensure(stat.dev===before.dev&&stat.ino===before.ino,'SOURCE_CHANGED');const bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd,{bigint:true});ensure(bytes.length<=limit&&after.mtimeNs===stat.mtimeNs&&after.size===stat.size,'SOURCE_CHANGED');return {bytes,stat:after};}finally{fs.closeSync(fd);}
}
function rootPath(file,{directory=false,mode,readable=false}={}){
 ensure(absolute(file)&&fs.realpathSync(file)===file,'UNTRUSTED_PATH');const stat=fs.lstatSync(file);
 ensure(!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile()&&stat.nlink===1)&&stat.uid===0&&(stat.mode&0o022)===0,'UNTRUSTED_PATH');
 if(mode!==undefined)ensure((stat.mode&0o777)===mode,'UNTRUSTED_PERMISSIONS');if(readable)ensure((stat.mode&0o004)!==0,'AUDITOR_NOT_READABLE');return stat;
}
function rootParents(file){let parent=path.dirname(file);while(true){rootPath(parent,{directory:true});if(parent===path.dirname(parent))break;parent=path.dirname(parent);}}
function readJson(file,{root=false,mode,limit=1024*1024}={}){if(root){rootParents(file);rootPath(file,{mode});}const value=readBytes(file,limit);try{return {...value,value:JSON.parse(value.bytes.toString('utf8'))};}catch{throw new GuardError('INVALID_JSON');}}
function validateConfig(input){
 const keys=['format','privateDirectory','dataDirectory','activeRecord','stateFile','jobsDirectory','containerName','auditScript','dockerBinary','serializationLock'];ensure(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>[...keys,'expectedImage'].includes(key))&&keys.every(key=>Object.hasOwn(input,key)),'INVALID_CONFIG');ensure(input.format===FORMAT,'INVALID_CONFIG');
 for(const key of keys.filter(k=>!['format','containerName'].includes(k)))ensure(absolute(input[key]),'INVALID_CONFIG');
 ensure(input.dockerBinary==='/usr/bin/docker'&&/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(input.containerName),'INVALID_CONFIG');
 if(input.expectedImage!==undefined)ensure(typeof input.expectedImage==='string'&&/^[a-z0-9][a-z0-9_.:/-]{1,180}$/.test(input.expectedImage),'INVALID_CONFIG');
 for(const key of ['dataDirectory','activeRecord','stateFile','jobsDirectory','serializationLock'])ensure(inside(input[key],input.privateDirectory)&&input[key]!==input.privateDirectory,'INVALID_CONFIG');
 ensure(input.dataDirectory!==input.jobsDirectory&&!inside(input.jobsDirectory,input.dataDirectory)&&!inside(input.stateFile,input.dataDirectory)&&!inside(input.serializationLock,input.dataDirectory)&&!inside(input.activeRecord,input.dataDirectory),'INVALID_CONFIG');
 ensure(new Set(keys.filter(k=>k!=='format'&&k!=='containerName').map(k=>input[k])).size===keys.length-2,'INVALID_CONFIG');return Object.freeze({...input});
}
function protectedDocker(binary){
 rootParents(binary);
 ensure(fs.lstatSync(binary).uid===0,'UNTRUSTED_DOCKER_PATH');
 const target=fs.realpathSync(binary);
 rootParents(target);
 const stat=fs.statSync(target);
 ensure(stat.isFile()&&stat.uid===0&&(stat.mode&0o022)===0&&(stat.mode&0o111)!==0,'UNTRUSTED_DOCKER_PATH');
}
function readConfig(file){ensure(process.platform==='linux'&&process.getuid?.()===0,'ROOT_HOST_REQUIRED');rootParents(file);rootPath(file,{mode:0o600});const config=validateConfig(readJson(file,{root:true,mode:0o600}).value);rootPath(config.privateDirectory,{directory:true,mode:0o700});rootParents(config.privateDirectory);rootPath(config.activeRecord,{mode:0o600});rootParents(config.auditScript);rootPath(config.auditScript,{readable:true});protectedDocker(config.dockerBinary);rootPath(config.serializationLock,{mode:0o600});rootParents(config.serializationLock);return config;}
function fileIdentity(stat){return {dev:String(stat.dev),ino:String(stat.ino),size:Number(stat.size),mtimeNs:String(stat.mtimeNs),uid:Number(stat.uid),mode:Number(stat.mode&0o777n)};}
function validateLock(value){exactKeys(value,['pid','instance'],'UNRECOGNIZED_WRITER_LOCK');ensure(Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.instance==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.instance),'UNRECOGNIZED_WRITER_LOCK');return value;}
function readLock(directory){const file=path.join(directory,'.fibernetlb-web.lock');let saved;try{saved=readJson(file,{limit:4096});}catch(error){if(error.code==='ENOENT')return null;throw error;}ensure(saved.stat.uid===10001n&&(saved.stat.mode&0o777n)===0o600n,'UNTRUSTED_WRITER_LOCK');return {...fileIdentity(saved.stat),sha256:hash(saved.bytes),...validateLock(saved.value)};}
function claimOf(context){return {format:STATE_FORMAT,machineIdHash:context.machineIdHash,data:context.data,boot:context.boot,authority:context.authority,lock:context.lock};}
function stableClaim(context){return {machineIdHash:context.machineIdHash,data:context.data,authority:context.authority,lock:context.lock};}
function verifyAttestation(state,context){
 ensure(state&&state.format===STATE_FORMAT&&state.lock&&state.boot,'MISSING_ATTESTATION');
 exactKeys(state,['format','machineIdHash','data','boot','authority','lock','attestedAt'],'INVALID_ATTESTATION');
 ensure(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(state.boot.id)&&Object.keys(state.boot).sort().join(',')==='btime,id'&&Number.isSafeInteger(state.boot.btime)&&state.boot.btime>0,'INVALID_ATTESTATION');
 ensure(typeof state.attestedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.attestedAt)&&Number.isFinite(Date.parse(state.attestedAt))&&new Date(state.attestedAt).toISOString()===state.attestedAt,'INVALID_ATTESTATION');
 ensure(JSON.stringify({machineIdHash:state.machineIdHash,data:state.data,authority:state.authority,lock:state.lock})===JSON.stringify(stableClaim(context)),'ATTESTATION_MISMATCH');
 ensure(typeof state.boot.id==='string'&&state.boot.id!==context.boot.id&&Number.isSafeInteger(state.boot.btime)&&state.boot.btime<context.boot.btime,'SAME_OR_UNPROVEN_BOOT');
 ensure(BigInt(context.lock.mtimeNs)<BigInt(context.boot.btime)*1000000000n,'LOCK_NOT_PREVIOUS_BOOT');
}
function sameContext(before,after){ensure(JSON.stringify(stableClaim(before))===JSON.stringify(stableClaim(after))&&JSON.stringify(before.boot)===JSON.stringify(after.boot),'CONTEXT_CHANGED');}
function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicJson(file,value){
 rootParents(file);if(fs.existsSync(file))rootPath(file,{mode:0o600});const temporary=file+'.new-'+crypto.randomUUID();
 const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,file);const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
function linuxDevice(dev){return {major:((dev>>8n)&0xfffn)|((dev>>32n)&0xfffff000n),minor:(dev&0xffn)|((dev>>12n)&0xffffff00n)};}
function mountOverlapsData(sourceIdentity,sourceAncestors,protectedInodes,dataAncestors){return protectedInodes.has(sourceIdentity)||dataAncestors.has(sourceIdentity)||sourceAncestors.some(identity=>protectedInodes.has(identity));}
function assertSerialized(config){
 const stat=fs.lstatSync(config.serializationLock,{bigint:true}),device=linuxDevice(stat.dev),ancestors=new Set();let pid=process.pid;
 for(let depth=0;pid>0&&depth<64;depth++){ancestors.add(pid);const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8');pid=Number(raw.slice(raw.lastIndexOf(')')+2).split(' ')[1]);}
 const found=fs.readFileSync('/proc/locks','utf8').split('\n').some(line=>{const m=line.match(/^\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+([a-f0-9]+):([a-f0-9]+):(\d+)\s+/i);return m&&ancestors.has(Number(m[1]))&&BigInt('0x'+m[2])===device.major&&BigInt('0x'+m[3])===device.minor&&BigInt(m[4])===stat.ino;});ensure(found,'HOST_FLOCK_REQUIRED');
}
class NativeAdapter {
 constructor(config){this.config=config;this.lastCheckpoint=null;assertSerialized(config);}
 async command(binary,args,{timeout=10000,allowFailure=false}={}){
  try{return {status:0,stdout:(await execute(binary,args,{timeout,maxBuffer:8*1024*1024,windowsHide:true,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8'},killSignal:'SIGTERM'})).stdout};}
  catch(error){if(allowFailure&&Number.isInteger(error.code))return {status:error.code,stdout:''};throw new GuardError('HOST_COMMAND_FAILED');}
 }
 async docker(args,options){return this.command(this.config.dockerBinary,['--host','unix:///var/run/docker.sock',...args],options);}
 async inspect(){
  assertSerialized(this.config);const c=this.config,active=readJson(c.activeRecord,{root:true,mode:0o600}),record=active.value;
  ensure(record.format==='FIBERNETLB-ACTIVE-DOMAIN-1'&&/^\d+\.\d+\.\d+$/.test(record.version)&&/^[a-f0-9]{40}$/.test(record.sourceCommit),'UNTRUSTED_AUTHORITY');
  const dataReal=fs.realpathSync(c.dataDirectory);ensure(dataReal===c.dataDirectory,'DATA_ALIAS_REJECTED');const dataStat=fs.lstatSync(dataReal,{bigint:true});ensure(dataStat.isDirectory()&&dataStat.uid===10001n&&(dataStat.mode&0o777n)===0o700n,'UNTRUSTED_DATA_DIRECTORY');
  const filesystem=(await this.command('/usr/bin/findmnt',['-T',dataReal,'-n','-o','FSTYPE'])).stdout.trim();ensure(filesystem==='ext4','LOCAL_EXT4_REQUIRED');
  const raw=(await this.docker(['inspect',c.containerName])).stdout;let container;try{const values=JSON.parse(raw);ensure(values.length===1,'UNKNOWN_CONTAINER');container=values[0];}catch(error){if(error instanceof GuardError)throw error;throw new GuardError('INVALID_CONTAINER_METADATA');}
  ensure(container.Name==='/'+c.containerName&&/^[a-f0-9]{64}$/.test(container.Id)&&/^sha256:[a-f0-9]{64}$/.test(container.Image)&&container.Config.Image===(c.expectedImage||'fibernetlb-web:'+record.version)&&container.Config.User==='10001:10001','UNKNOWN_CONTAINER');
  const mounted=(container.Mounts||[]).filter(m=>m.Destination==='/data');ensure(mounted.length===1&&mounted[0].Type==='bind'&&mounted[0].RW===true&&fs.realpathSync(mounted[0].Source)===dataReal,'WRONG_DATA_MOUNT');
  const bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),btime=Number(fs.readFileSync('/proc/stat','utf8').match(/^btime (\d+)$/m)?.[1]);ensure(/^[a-f0-9-]{36}$/.test(bootId)&&Number.isSafeInteger(btime)&&btime>0,'BOOT_ID_UNAVAILABLE');
  const machine=fs.readFileSync('/etc/machine-id','utf8').trim();ensure(/^[a-f0-9]{32}$/i.test(machine),'MACHINE_ID_UNAVAILABLE');
  return {machineIdHash:hash(machine),data:{path:dataReal,dev:String(dataStat.dev),ino:String(dataStat.ino)},boot:{id:bootId,btime},authority:{recordSha256:hash(active.bytes),containerName:c.containerName,containerId:container.Id,imageId:container.Image,imageName:container.Config.Image,version:record.version,sourceCommit:record.sourceCommit},lock:readLock(dataReal),healthy:container.State.Running===true&&!container.State.Paused&&!container.State.Restarting&&container.State.Health?.Status==='healthy',running:container.State.Running===true||container.State.Restarting===true||container.State.Paused===true,container};
 }
 async loadState(){if(!fs.existsSync(this.config.stateFile))return null;return readJson(this.config.stateFile,{root:true,mode:0o600,limit:16384}).value;}
 async saveState(context){ensure(context.healthy&&context.lock,'HEALTHY_WRITER_REQUIRED');const claim=claimOf(context);const current=await this.loadState();if(current&&JSON.stringify({...current,attestedAt:undefined})===JSON.stringify(claim))return;atomicJson(this.config.stateFile,{...claim,attestedAt:new Date().toISOString()});}
 async stop(context){await this.docker(['stop','--timeout','720',context.authority.containerId],{timeout:735000});const after=await this.inspect();ensure(!after.running,'WRITER_DID_NOT_STOP');sameContext(context,after);}
 ancestors(file){const result=[];let next=fs.realpathSync(file);while(true){const stat=fs.statSync(next,{bigint:true});result.push(String(stat.dev)+':'+String(stat.ino));if(next===path.dirname(next))return result;next=path.dirname(next);}}
 dataDirectories(){const identities=[];let count=0;const walk=directory=>{const stat=fs.lstatSync(directory,{bigint:true});ensure(stat.isDirectory()&&!stat.isSymbolicLink(),'UNTRUSTED_DATA_DIRECTORY');identities.push(String(stat.dev)+':'+String(stat.ino));for(const entry of fs.readdirSync(directory,{withFileTypes:true})){ensure(++count<=MAX_FILES,'CHECKPOINT_LIMIT');const file=path.join(directory,entry.name),child=fs.lstatSync(file);ensure(!child.isSymbolicLink(),'DATA_SYMLINK_REJECTED');if(directory===this.config.dataDirectory&&OMIT.has(entry.name))continue;if(child.isDirectory())walk(file);}};walk(this.config.dataDirectory);return identities;}
 async exclusive(context){
  const ids=(await this.docker(['ps','-aq'])).stdout.trim().split(/\s+/).filter(Boolean);const containers=ids.length?JSON.parse((await this.docker(['inspect',...ids])).stdout):[];
  const dataKey=context.data.dev+':'+context.data.ino,dataAncestors=new Set(this.ancestors(this.config.dataDirectory));
  const files=this.snapshot(),protectedInodes=new Set([...files.map(x=>x.dev+':'+x.ino),...this.dataDirectories()]);protectedInodes.add(dataKey);
  for(const container of containers){if(!container.State.Running&&!container.State.Restarting&&!container.State.Paused)continue;for(const mount of container.Mounts||[]){if(!mount.RW||!mount.Source)continue;let real;try{real=fs.realpathSync(mount.Source);}catch{throw new GuardError('MOUNT_IDENTITY_UNAVAILABLE');}const stat=fs.statSync(real,{bigint:true}),identity=String(stat.dev)+':'+String(stat.ino);ensure(!inside(real,this.config.dataDirectory)&&!inside(this.config.dataDirectory,real)&&!mountOverlapsData(identity,this.ancestors(real),protectedInodes,dataAncestors),'OTHER_DATA_WRITER');}}
  for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){let descriptors;try{descriptors=fs.readdirSync('/proc/'+pid+'/fd');}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw new GuardError('PROCESS_HANDLES_UNAVAILABLE');}for(const fd of descriptors){try{const target='/proc/'+pid+'/fd/'+fd,real=fs.readlinkSync(target);if(real===this.config.dataDirectory||real.startsWith(this.config.dataDirectory+'/'))throw new GuardError('OPEN_DATA_HANDLE');const stat=fs.statSync(target,{bigint:true});ensure(!protectedInodes.has(String(stat.dev)+':'+String(stat.ino)),'OPEN_DATA_HANDLE');}catch(error){if(error instanceof GuardError)throw error;if(!['ENOENT','ESRCH','EINVAL','ENOTDIR'].includes(error.code))throw new GuardError('PROCESS_HANDLES_UNAVAILABLE');}}}
  const fuser=await this.command('/usr/bin/fuser',[...DATABASES.map(x=>path.join(this.config.dataDirectory,x)),...(context.lock?[path.join(this.config.dataDirectory,'.fibernetlb-web.lock')]:[])],{allowFailure:true});ensure(fuser.status===1,'OPEN_DATA_HANDLE');
 }
 snapshot(){
  const c=this.config,rows=[];let bytes=0,nodes=0;
  const walk=relative=>{const directory=path.join(c.dataDirectory,relative),s=fs.lstatSync(directory);ensure(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'UNTRUSTED_DATA_DIRECTORY');for(const item of fs.readdirSync(directory,{withFileTypes:true})){ensure(++nodes<=MAX_FILES,'CHECKPOINT_LIMIT');const name=relative?relative+'/'+item.name:item.name,file=path.join(c.dataDirectory,name),stat=fs.lstatSync(file,{bigint:true});ensure(!stat.isSymbolicLink(),'DATA_SYMLINK_REJECTED');if(!relative&&OMIT.has(item.name)){ensure(stat.isDirectory(),'UNTRUSTED_BACKUP_DIRECTORY');continue;}ensure(!item.name.endsWith('.pending'),'PENDING_FILE_REQUIRES_REVIEW');if(stat.isDirectory()){walk(name);continue;}ensure(stat.isFile()&&stat.nlink===1n&&(stat.mode&0o077n)===0n,'UNTRUSTED_DATA_FILE');ensure(rows.length<MAX_FILES&&bytes+Number(stat.size)<=MAX_BYTES,'CHECKPOINT_LIMIT');const saved=readBytes(file,MAX_BYTES);bytes+=saved.bytes.length;if(name.endsWith('.json')){try{JSON.parse(saved.bytes.toString('utf8'));}catch{throw new GuardError('INVALID_DATA_JOURNAL');}}rows.push({name,...fileIdentity(saved.stat),sha256:hash(saved.bytes)});}};
  walk('');for(const name of DATABASES)ensure(rows.some(row=>row.name===name&&row.size>=100),'INCOMPLETE_DATABASE_SET');ensure(rows.some(row=>row.name==='automatic-month-closing.json'),'MISSING_SCHEDULER_JOURNAL');return rows.sort((a,b)=>a.name.localeCompare(b.name));
 }
 validateSettings(context){
  const keyMount=(context.container.Mounts||[]).filter(m=>m.Destination==='/run/secrets/server-key');ensure(keyMount.length===1&&keyMount[0].RW===false,'WRONG_KEY_MOUNT');const key=keyMount[0].Source;ensure(absolute(key)&&fs.realpathSync(key)===key,'INVALID_SERVER_KEY');rootParents(key);const stat=fs.lstatSync(key);ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.uid===10001&&(stat.mode&0o777)===0o600&&stat.size===32,'INVALID_SERVER_KEY');
  const scheduler=readJson(path.join(this.config.dataDirectory,'automatic-month-closing.json'));ensure(scheduler.value&&typeof scheduler.value.state==='object'&&hash(JSON.stringify(scheduler.value.state))===scheduler.value.sha256&&['ready','completed'].includes(scheduler.value.state.state),'SCHEDULER_REQUIRES_REVIEW');
  return {keyPath:key,keySha256:hash(readBytes(key,32).bytes),schedulerSha256:hash(scheduler.bytes)};
 }
 async checkpoint(context){
  const c=this.config;if(!fs.existsSync(c.jobsDirectory))fs.mkdirSync(c.jobsDirectory,{mode:0o700});rootParents(c.jobsDirectory);rootPath(c.jobsDirectory,{directory:true,mode:0o700});
  const job=path.join(c.jobsDirectory,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID());fs.mkdirSync(job,{mode:0o700});
  const before=this.snapshot(),settings=this.validateSettings(context),files=path.join(job,'current-data'),copy=path.join(job,'audit-copy'),reports=path.join(job,'reports');for(const directory of [files,copy,reports])fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(path.join(copy,'sections'),{mode:0o700});
  const copiedDirectories=new Set([files]);
  for(const row of before){const target=path.join(files,row.name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(path.join(c.dataDirectory,row.name),target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);ensure(hash(readBytes(target,MAX_BYTES).bytes)===row.sha256,'CHECKPOINT_MISMATCH');const durable=fs.openSync(target,'r');try{fs.fsyncSync(durable);}finally{fs.closeSync(durable);}for(let directory=path.dirname(target);directory!==files;directory=path.dirname(directory))copiedDirectories.add(directory);}
  for(const directory of [...copiedDirectories].sort((a,b)=>b.length-a.length))syncDirectory(directory);
  syncDirectory(c.jobsDirectory);
  syncDirectory(path.dirname(c.jobsDirectory));
  for(const name of [...DATABASES,'automatic-month-closing.json']){const target=path.join(copy,name);fs.copyFileSync(path.join(files,name),target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);fs.chownSync(target,10001,10001);}
  for(const directory of [copy,path.join(copy,'sections'),reports])fs.chownSync(directory,10001,10001);
  fs.copyFileSync(c.auditScript,path.join(job,'auditor.cjs'),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(job,'auditor.cjs'),0o444);
  const checkpoint={job,before,settings,copy,reports,auditorSha256:hash(readBytes(path.join(job,'auditor.cjs'),1024*1024).bytes)};atomicJson(path.join(job,'checkpoint.json'),{format:'FIBERNETLB-POWER-CHECKPOINT-1',createdAt:new Date().toISOString(),authority:context.authority,data:context.data,files:before,settings:{schedulerSha256:settings.schedulerSha256},auditorSha256:checkpoint.auditorSha256});this.lastCheckpoint=checkpoint;return checkpoint;
 }
 async audit(context,checkpoint){
  await this.docker(['run','--rm','--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,noexec,size=32m','--entrypoint','node','--mount','type=bind,src='+path.join(checkpoint.job,'auditor.cjs')+',dst=/app/tools/power-recovery-audit.cjs,readonly','--mount','type=bind,src='+checkpoint.copy+',dst=/copy,readonly','--mount','type=bind,src='+checkpoint.reports+',dst=/report',context.authority.imageId,'/app/tools/power-recovery-audit.cjs','--inspect','/copy','/report/result.json'],{timeout:120000});
  const report=readJson(path.join(checkpoint.reports,'result.json'),{limit:4*1024*1024}).value;ensure(report.format===AUDIT_FORMAT&&report.integrityPassed===true&&report.databases===7&&report.readOnly===true&&Array.isArray(report.files)&&report.files.length===7,'AUDIT_FAILED');
  for(const row of report.files){const before=checkpoint.before.find(value=>value.name===row.name);ensure(before&&row.sha256===before.sha256&&row.length===before.size,'AUDIT_COPY_CHANGED');}return report;
 }
 async recheck(context,checkpoint){const now=await this.inspect();sameContext(context,now);ensure(!now.running,'WRITER_DID_NOT_STOP');await this.exclusive(now);ensure(JSON.stringify(this.snapshot())===JSON.stringify(checkpoint.before),'SOURCE_CHANGED');ensure(JSON.stringify(this.validateSettings(now))===JSON.stringify(checkpoint.settings),'SETTINGS_CHANGED');ensure(hash(readBytes(path.join(checkpoint.job,'auditor.cjs'),1024*1024).bytes)===checkpoint.auditorSha256,'AUDITOR_CHANGED');}
 async archive(context,checkpoint){
  ensure(context.lock,'WRITER_LOCK_REQUIRED');const now=readLock(this.config.dataDirectory);ensure(JSON.stringify(now)===JSON.stringify(context.lock),'WRITER_LOCK_CHANGED');const target=path.join(checkpoint.job,'abandoned-writer-lock.json');ensure(!fs.existsSync(target),'ARCHIVE_ALREADY_EXISTS');fs.renameSync(path.join(this.config.dataDirectory,'.fibernetlb-web.lock'),target);ensure(hash(readBytes(target,4096).bytes)===context.lock.sha256,'LOCK_ARCHIVE_FAILED');
  for(const folder of [this.config.dataDirectory,checkpoint.job]){const directory=fs.openSync(folder,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
 }
 async start(context){const now=await this.inspect();ensure(!now.running&&!now.lock,'WRITER_NOT_EXCLUSIVE');ensure(JSON.stringify(now.authority)===JSON.stringify(context.authority),'AUTHORITY_CHANGED');await this.docker(['start',context.authority.containerId],{timeout:15000});}
 async waitHealthy(context){const started=Date.now();while(Date.now()-started<100000){const now=await this.inspect();ensure(JSON.stringify(now.authority)===JSON.stringify(context.authority),'AUTHORITY_CHANGED');if(now.healthy)return now;await new Promise(resolve=>setTimeout(resolve,1000));}throw new GuardError('STARTUP_REQUIRES_REVIEW');}
 async finish(result){if(this.lastCheckpoint)atomicJson(path.join(this.lastCheckpoint.job,'result.json'),{format:'FIBERNETLB-POWER-RECOVERY-RESULT-1',completedAt:new Date().toISOString(),...result});}
 async fail(code){if(this.lastCheckpoint)try{await this.finish({success:false,code,oldDataRestored:false});}catch{} }
}
function createController(adapter){
 async function attest(context){const current=context||await adapter.inspect();ensure(current.healthy&&current.lock,'HEALTHY_WRITER_REQUIRED');await adapter.saveState(current);return {success:true,action:'healthy-attested',version:current.authority.version};}
 return {
  attest:()=>attest(),
  async recover(){
   try{
    const context=await adapter.inspect();if(context.healthy)return await attest(context);
    if(context.lock)verifyAttestation(await adapter.loadState(),context);
    await adapter.stop(context);await adapter.exclusive(context);
    const checkpoint=await adapter.checkpoint(context),report=await adapter.audit(context,checkpoint);
    ensure(Number.isSafeInteger(report.pendingFinancialActions)&&report.pendingFinancialActions===0,'PENDING_FINANCIAL_REVIEW_REQUIRED');
    await adapter.recheck(context,checkpoint);
    if(context.lock)await adapter.archive(context,checkpoint);
    await adapter.start(context);const healthy=await adapter.waitHealthy(context);await attest(healthy);
    const result={success:true,action:context.lock?'previous-boot-lock-archived-and-started':'verified-unlocked-container-started',version:context.authority.version,databasesIntegrityPassed:7,pendingFinancialActions:0,oldDataRestored:false};await adapter.finish(result);return result;
   }catch(error){const code=error instanceof GuardError?error.code:'RECOVERY_REQUIRES_REVIEW';await adapter.fail?.(code);throw new GuardError(code);}
  }
 };
}
async function main(args){
 let mode,file;if(args.length===3&&['--attest','--recover'].includes(args[0])&&args[1]==='--config'){mode=args[0];file=args[2];}else if(args.length===3&&args[0]==='--config'&&['--attest','--recover'].includes(args[2])){mode=args[2];file=args[1];}else throw new GuardError('INVALID_ARGUMENTS');
 const config=readConfig(file),controller=createController(new NativeAdapter(config));const result=await controller[mode==='--attest'?'attest':'recover']();console.log(JSON.stringify(result));
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({success:false,code:error instanceof GuardError?error.code:'HOST_GUARD_REQUIRES_REVIEW',oldDataRestored:false}));process.exitCode=1;});
module.exports={GuardError,validateConfig,validateLock,verifyAttestation,claimOf,stableClaim,sameContext,createController,NativeAdapter,readConfig,linuxDevice,mountOverlapsData,DATABASES};
