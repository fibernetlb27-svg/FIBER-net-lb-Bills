const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Writable}=require('node:stream');
const {sealBackup,openBackup,sha256}=require('./backup-archive.cjs');
const MAX_HISTORY=2000,JOB_ID=/^\d{8}T\d{6}-[a-f0-9-]{36}$/;
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const pending=file+'.pending';fs.writeFileSync(pending,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(pending,file);}
function line(value,max=250){const text=String(value??'').trim();if(text.length>max||/[\r\n\0]/.test(text))throw Error('Invalid backup configuration field.');return text;}
function host(value){const text=line(value);if(!/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(text)||text.includes('://'))throw Error('Enter a server hostname or IP address, without a URL or path.');return text;}
function port(value,fallback){const number=Number(value??fallback);if(!Number.isSafeInteger(number)||number<1||number>65535)throw Error('Enter a port between 1 and 65535.');return number;}
function email(value){const text=line(value);if(!/^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(text))throw Error('Enter one valid email address, without a display name.');return text;}
function defaults(){return {enabled:false,time:'23:00',ftp:{enabled:false,protocol:'ftps',port:21,host:'',username:'',directory:'/fibernetlb-backups',allowInsecure:false},email:{enabled:false,host:'',port:587,security:'starttls',username:'',from:'',to:'',maxMessageMb:20}};}
function beirutClock(date){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute};
}
class BackupManager{
 constructor({directory,safeStorage,snapshot,version,canRun=()=>true,now=()=>new Date(),ftpFactory=null,mailFactory=null}){
  this.directory=directory;this.storage=safeStorage;this.snapshot=snapshot;this.version=version;this.canRun=canRun;this.now=now;
  this.settingsFile=path.join(directory,'backup-settings.json');this.historyFile=path.join(directory,'backup-history.json');this.folder=path.join(directory,'scheduled-backups');
  this.ftpFactory=ftpFactory||(()=>new (require('basic-ftp').Client)(30000));
  this.mailFactory=mailFactory||(options=>require('nodemailer').createTransport(options));
  this.running=null;this.timer=null;this.recover();
 }
 secure(){if(!this.storage?.isEncryptionAvailable()||(process.platform==='linux'&&this.storage.getSelectedStorageBackend?.()==='basic_text'))throw Error('Secure Windows credential storage is unavailable. Backup secrets were not saved.');}
 readSettings(){if(!fs.existsSync(this.settingsFile))return defaults();try{const data=JSON.parse(fs.readFileSync(this.settingsFile,'utf8'));return {...defaults(),...data,ftp:{...defaults().ftp,...data.ftp},email:{...defaults().email,...data.email}};}catch{throw Error('Backup settings could not be read. Ask the administrator to repair them on Main.');}}
 readHistory(){if(!fs.existsSync(this.historyFile))return [];const list=JSON.parse(fs.readFileSync(this.historyFile,'utf8'));if(!Array.isArray(list)||list.length>MAX_HISTORY||list.some(job=>!JOB_ID.test(job.id)))throw Error('Backup history could not be validated. No backup delivery was started.');return list;}
 persist(job){const history=this.readHistory(),index=history.findIndex(row=>row.id===job.id);if(index<0){if(history.length>=MAX_HISTORY)throw Error('Backup history is full. Archive its log before creating more backups.');history.push(job);}else history[index]=job;atomicJson(this.historyFile,history);}
 recover(){const history=this.readHistory();let changed=false;for(const job of history){
  if(job.local==='creating'){job.local='failed';job.error='The app stopped while creating this backup. Create a new manual backup.';if(job.ftp==='pending')job.ftp='not_attempted';if(job.email==='pending')job.email='not_attempted';changed=true;}
  if(['sending','connecting'].includes(job.ftp)){job.ftp='failed';job.ftpNote='Interrupted server delivery; retry verifies the same uniquely named file.';changed=true;}
  if(job.email==='sending'){job.email='unknown';job.emailNote='The app stopped during sending. Check the recipient inbox before retrying; it may have arrived.';changed=true;}
  if(job.email==='connecting'){job.email='failed';job.emailNote='The app stopped before sending email.';changed=true;}
 }if(changed)atomicJson(this.historyFile,history);}
 publicSettings(){const data=this.readSettings();const {passphraseEncrypted,...config}=data;const {passwordEncrypted:ftpSecret,...ftp}=data.ftp,{passwordEncrypted:emailSecret,...mail}=data.email;return {...config,hasPassphrase:Boolean(passphraseEncrypted),ftp:{...ftp,hasPassword:Boolean(ftpSecret)},email:{...mail,hasPassword:Boolean(emailSecret)}};}
 status(){const history=this.readHistory();return {settings:this.publicSettings(),running:Boolean(this.running),folder:this.folder,timezone:'Asia/Beirut',requiresMainRunning:true,clock:beirutClock(this.now()),history:history.slice(-100).reverse().map(job=>({...job,filename:this.filename(job.id)})),storageAvailable:Boolean(this.storage?.isEncryptionAvailable())};}
 secret(value){this.secure();try{return this.storage.decryptString(Buffer.from(value,'base64'));}catch{throw Error('Saved backup secrets cannot be decrypted on this Windows account. Re-enter them on Main.');}}
 save(input={}){
  if(this.running)throw Error('Wait until the current backup finishes before editing its settings.');
  this.secure();const old=this.readSettings(),next=defaults();next.enabled=input.enabled===true;next.time=line(input.time||'23:00');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time))throw Error('Choose a valid daily backup time.');
  const backupPassword=String(input.passphrase??'');if(backupPassword&&(backupPassword.length<12||backupPassword.length>256))throw Error('Use a backup passphrase of 12–256 characters.');
  next.passphraseEncrypted=backupPassword?this.storage.encryptString(backupPassword).toString('base64'):old.passphraseEncrypted;
  if(!next.passphraseEncrypted)throw Error('Enter a backup passphrase and keep a safe copy outside this PC.');
  for(const destination of ['ftp','email']){
   const supplied=input[destination]||{},prior=old[destination];next[destination].enabled=supplied.enabled===true;
   next[destination].host=supplied.host?host(supplied.host):'';next[destination].username=line(supplied.username);
   next[destination].port=port(supplied.port,destination==='ftp'?21:587);
   if(destination==='ftp'){
    next.ftp.protocol=line(supplied.protocol||'ftps');if(!['ftps','ftps-implicit','ftp'].includes(next.ftp.protocol))throw Error('Choose FTPS or FTP.');
    next.ftp.directory=line(supplied.directory||'/fibernetlb-backups',500);
    if(!/^\/?[A-Za-z0-9 _./-]+$/.test(next.ftp.directory)||next.ftp.directory.split('/').includes('..'))throw Error('Use a simple remote folder without parent-directory segments.');
    next.ftp.allowInsecure=supplied.allowInsecure===true;
    if(next.ftp.enabled&&next.ftp.protocol==='ftp'&&!next.ftp.allowInsecure)throw Error('Plain FTP exposes its login password. Choose FTPS or explicitly acknowledge this risk.');
   }else{
    next.email.security=line(supplied.security||'starttls');if(!['starttls','tls'].includes(next.email.security))throw Error('Email requires STARTTLS or TLS.');
    next.email.from=supplied.from?email(supplied.from):'';next.email.to=supplied.to?email(supplied.to):'';
    next.email.maxMessageMb=Number(supplied.maxMessageMb??20);if(!Number.isSafeInteger(next.email.maxMessageMb)||next.email.maxMessageMb<1||next.email.maxMessageMb>50)throw Error('Email size limit must be 1–50 MiB.');
   }
   const suppliedPassword=String(supplied.password??'');if(suppliedPassword.length>1024||/[\r\n\0]/.test(suppliedPassword))throw Error('Invalid delivery password.');
   const same=next[destination].host===prior.host&&next[destination].port===prior.port&&next[destination].username===prior.username&&(destination==='ftp'?next.ftp.protocol===prior.protocol:next.email.security===prior.security);
   next[destination].passwordEncrypted=suppliedPassword?this.storage.encryptString(suppliedPassword).toString('base64'):same?prior.passwordEncrypted:undefined;
   if(next[destination].enabled&&(!next[destination].host||!next[destination].username||!next[destination].passwordEncrypted))throw Error('Enter the '+destination.toUpperCase()+' host, username and password.');
  }
  if(next.email.enabled&&(!next.email.from||!next.email.to))throw Error('Enter the sender and recipient email addresses.');
  // Every scheduled job first saves an encrypted local snapshot. External
  // delivery is optional, so local protection does not require FTP or email.
  next.configuredAt=old.enabled&&old.configuredAt?old.configuredAt:this.now().toISOString();
  atomicJson(this.settingsFile,next);return this.status();
 }
 filename(id){if(!JOB_ID.test(id))throw Error('Invalid backup ID.');return 'FIBER-net-lb-backup-'+id+'.fnbak';}
 file(id){return path.join(this.folder,this.filename(id));}
 async run({automatic=false,actor='System',dailyKey=null}={}){
  if(!this.canRun())throw Error('Backups run on the Main computer only.');
  if(this.running)throw Error('A backup is already running. Wait for it to finish.');
  const config=this.readSettings();if(!config.passphraseEncrypted)throw Error('Save the backup settings and encryption passphrase first.');
  const job={id:this.now().toISOString().replace(/[-:]/g,'').slice(0,15)+'-'+crypto.randomUUID(),createdAt:this.now().toISOString(),actor:line(actor),kind:automatic?'automatic':'manual',dailyKey,local:'creating',ftp:config.ftp.enabled?'pending':'disabled',email:config.email.enabled?'pending':'disabled',attempts:0};
  this.running=job;
  try{
   this.persist(job);
   const entries=this.snapshot(); // Synchronous all-workspace snapshot before any await.
   const encrypted=await sealBackup(entries,this.secret(config.passphraseEncrypted),{version:this.version,createdAt:job.createdAt});
   fs.mkdirSync(this.folder,{recursive:true});const file=this.file(job.id),temporary=file+'.pending';fs.writeFileSync(temporary,encrypted,{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);
   job.local='saved';job.bytes=encrypted.length;job.sha256=sha256(encrypted);this.persist(job);
   await this.deliver(job,config);
  }catch(error){
   if(job.local!=='saved'){job.local='failed';job.error='Local encrypted backup failed. Check disk space, database availability and Windows credential storage.';if(job.ftp==='pending')job.ftp='not_attempted';if(job.email==='pending')job.email='not_attempted';this.persist(job);}
   else throw error;
  }finally{this.running=null;}
  return this.status();
 }
 async retry(id,{confirmEmailResend=false}={}){
  if(!this.canRun())throw Error('Backups run on the Main computer only.');
  if(this.running)throw Error('A backup is already running.');
  const job=this.readHistory().find(row=>row.id===id);if(!job||job.local!=='saved')throw Error('A saved local backup is required for retry.');
  if(job.email==='unknown'&&!confirmEmailResend)throw Error('Check the inbox first, then explicitly confirm an uncertain email resend.');
  const config=this.readSettings();
  if(job.ftp==='disabled'&&config.ftp.enabled)job.ftp='pending';
  if(job.email==='disabled'&&config.email.enabled)job.email='pending';
  if(job.email==='unknown'&&confirmEmailResend)job.email='failed';
  this.running=job;try{await this.deliver(job,config);}finally{this.running=null;}return this.status();
 }
 async remoteMatches(client,job){
  const name=this.filename(job.id);let size;try{size=await client.size(name);}catch(error){if(Number(error.code)===550)return false;throw error;}
  if(size!==job.bytes)throw Error('A conflicting remote backup file exists.');
  const hash=crypto.createHash('sha256');let received=0;
  const sink=new Writable({write(chunk,encoding,next){received+=chunk.length;if(received>job.bytes)return next(Error('Remote file exceeds the expected size.'));hash.update(chunk);next();}});
  await client.downloadTo(sink,name);
  if(received!==job.bytes||hash.digest('hex')!==job.sha256)throw Error('Remote backup checksum mismatch.');
  return true;
 }
 async sendFtp(job,config){
  const client=this.ftpFactory();let timer;
  try{
   timer=setTimeout(()=>client.close(),5*60*1000);timer.unref?.();
   await client.access({host:config.host,port:config.port,user:config.username,password:this.secret(config.passwordEncrypted),secure:config.protocol==='ftps'?true:config.protocol==='ftps-implicit'?'implicit':false,secureOptions:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
   await client.ensureDir(config.directory);
   if(await this.remoteMatches(client,job))return;
   const name=this.filename(job.id),temporary=name+'.part';
   await client.uploadFrom(this.file(job.id),temporary);if(await client.size(temporary)!==job.bytes)throw Error('Remote temporary backup is incomplete.');
   await client.rename(temporary,name);if(!await this.remoteMatches(client,job))throw Error('Remote backup is missing after upload.');
  }finally{clearTimeout(timer);client.close();}
 }
 async deliver(job,config){
  const file=this.file(job.id);if(!fs.existsSync(file)||sha256(fs.readFileSync(file))!==job.sha256)throw Error('The local backup failed its integrity check. Delivery was blocked.');
  job.attempts++;job.lastAttemptAt=this.now().toISOString();this.persist(job);
  if(config.ftp.enabled&&!['sent','disabled'].includes(job.ftp)){
   job.ftpTarget=config.ftp.protocol+'://'+config.ftp.host+':'+config.ftp.port+config.ftp.directory;
   job.ftp='sending';this.persist(job);
   try{await this.sendFtp(job,config.ftp);job.ftp='sent';job.ftpNote='Uploaded and downloaded SHA-256 verified.';}
   catch{job.ftp='failed';job.ftpNote='Server delivery failed. Check host, credentials, TLS certificate, passive-mode access and folder permissions. The local backup is retained.';}this.persist(job);
  }
  if(config.email.enabled&&!['sent','disabled','unknown'].includes(job.email)){
   job.emailTarget=config.email.to;
   const estimatedMessageSize=Math.ceil(job.bytes*4/3)+16384;
   if(estimatedMessageSize>config.email.maxMessageMb*1024*1024){job.email='failed';job.emailNote='Encrypted attachment exceeds the configured email message-size limit. Use the local/server copy or raise the limit only if your mail provider supports it.';this.persist(job);return;}
   let transport,sending=false;
   try{
    transport=this.mailFactory({host:config.email.host,port:config.email.port,secure:config.email.security==='tls',requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:config.email.username,pass:this.secret(config.email.passwordEncrypted)},connectionTimeout:30000,greetingTimeout:30000,socketTimeout:60000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
    job.email='connecting';this.persist(job);await transport.verify();
    job.email='sending';this.persist(job);sending=true;
    const result=await transport.sendMail({from:{name:'FIBER net lb backups',address:config.email.from},to:config.email.to,messageId:'<'+job.id+'@'+config.email.from.split('@')[1]+'>',subject:'FIBER net lb backup — '+beirutClock(new Date(job.createdAt)).day,text:'Encrypted backup of all seven business databases.\nCreated: '+job.createdAt+'\nSHA-256: '+job.sha256+'\nKeep the decryption passphrase separately. This email never includes it.\nExtract with the app Backup section; do not replace live databases while the app is running.',attachments:[{filename:this.filename(job.id),content:fs.readFileSync(file),contentType:'application/octet-stream'}]});
    if(!result.accepted?.some(address=>String(address).toLowerCase()===config.email.to.toLowerCase()))throw Error('Recipient acceptance was not confirmed.');
    job.email='sent';job.emailNote='SMTP server accepted the recipient. Check delivery/spam in the recipient inbox.';
   }catch(error){const knownRejected=Number(error.responseCode)>=400&&Number(error.responseCode)<600;job.email=sending&&!knownRejected?'unknown':'failed';job.emailNote=job.email==='unknown'?'Email outcome is uncertain. Check the inbox before explicitly retrying; it may already have arrived.':'Email delivery failed before acceptance. Check SMTP login, required TLS, sender/recipient and mail-provider permissions. The local backup is retained.';}
   finally{transport?.close?.();this.persist(job);}
  }
 }
 async test(destination){
  if(this.running)throw Error('Wait for the running backup first.');
  const config=this.readSettings()[destination];if(!config?.enabled)throw Error('Save and enable this delivery destination first.');
  if(destination==='ftp'){
   const client=this.ftpFactory();try{await client.access({host:config.host,port:config.port,user:config.username,password:this.secret(config.passwordEncrypted),secure:config.protocol==='ftps'?true:config.protocol==='ftps-implicit'?'implicit':false,secureOptions:{minVersion:'TLSv1.2',rejectUnauthorized:true}});await client.cd(config.directory);}catch{throw Error('FTP connection/folder test failed. Check credentials, TLS certificate and folder. No backup was uploaded.');}finally{client.close();}
   return {ok:true,message:'Server login and folder access verified. No backup uploaded.'};
  }
  if(destination!=='email')throw Error('Unknown backup destination.');
  const transport=this.mailFactory({host:config.host,port:config.port,secure:config.security==='tls',requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:config.username,pass:this.secret(config.passwordEncrypted)},connectionTimeout:30000,greetingTimeout:30000,socketTimeout:60000,logger:false,debug:false});
  try{await transport.verify();}catch{throw Error('SMTP connection/authentication test failed. Check login and TLS settings. No email was sent.');}finally{transport.close?.();}
  return {ok:true,message:'SMTP login verified. No email sent; this does not verify recipient delivery.'};
 }
 async tick(){
  if(this.running||!this.canRun())return;const config=this.readSettings();if(!config.enabled)return;
  const clock=beirutClock(this.now()),history=this.readHistory();
  const existing=history.find(job=>job.kind==='automatic'&&job.dailyKey===clock.day);
  if(!existing){
   const previousDate=new Date(clock.day+'T12:00:00Z');previousDate.setUTCDate(previousDate.getUTCDate()-1);
   const previousKey=previousDate.toISOString().slice(0,10);
   const previousSaved=history.some(job=>job.kind==='automatic'&&job.dailyKey===previousKey&&job.local==='saved');
   const configuredDay=config.configuredAt?beirutClock(new Date(config.configuredAt)).day:clock.day;
   if(clock.time<config.time&&(configuredDay>=clock.day||previousSaved))return;
   await this.run({automatic:true,dailyKey:clock.day});return;
  }
  if(existing.local==='saved'&&existing.attempts<3&&this.now()-new Date(existing.lastAttemptAt)>=15*60*1000&&(existing.ftp==='failed'||existing.email==='failed')){
   this.running=existing;try{await this.deliver(existing,config);}finally{this.running=null;}
  }
 }
 start(){if(this.timer)return;const invoke=()=>this.tick().catch(()=>{});void invoke();this.timer=setInterval(invoke,60000);this.timer.unref?.();}
 stop(){clearInterval(this.timer);this.timer=null;}
 async extract(file,passphrase){
  if(!this.canRun())throw Error('Extract backups on Main only.');const size=fs.statSync(file).size;if(size>360*1024*1024)throw Error('Backup exceeds the extraction safety limit.');
  const backup=await openBackup(fs.readFileSync(file),passphrase),root=path.join(this.directory,'recovered-backups',crypto.randomUUID());
  fs.mkdirSync(root,{recursive:true});
  for(const entry of backup.entries){const target=path.join(root,entry.name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,entry.data,{flag:'wx',mode:0o600});}
  return {folder:root,version:backup.version,createdAt:backup.createdAt,files:backup.entries.length,message:'Verified and extracted to a NEW folder. Live databases were not replaced. Close the app before a separately authorized restore. Proradius encrypted settings require the original Windows account/PC or reconfiguration.'};
 }
}
module.exports={BackupManager,beirutClock,defaults};
