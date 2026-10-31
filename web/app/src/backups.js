(() => {
 let loaded=false,dirty=false,busy=false,lastStatus=null;
 const field=id=>document.getElementById(id),secretIds=['backup-passphrase','backup-ftp-password','backup-email-password','backup-extract-passphrase'];
 const clearSecrets=()=>secretIds.forEach(id=>{if(field(id))field(id).value='';});
 function settingsInput(){
  return {enabled:field('backup-auto-enabled').checked,time:field('backup-time').value,passphrase:field('backup-passphrase').value,
   ftp:{enabled:field('backup-ftp-enabled').checked,host:field('backup-ftp-host').value,port:Number(field('backup-ftp-port').value),protocol:field('backup-ftp-protocol').value,username:field('backup-ftp-user').value,password:field('backup-ftp-password').value,directory:field('backup-ftp-directory').value,allowInsecure:field('backup-ftp-insecure').checked},
   email:{enabled:field('backup-email-enabled').checked,host:field('backup-email-host').value,port:Number(field('backup-email-port').value),security:field('backup-email-security').value,username:field('backup-email-user').value,password:field('backup-email-password').value,from:field('backup-email-from').value,to:field('backup-email-to').value,maxMessageMb:Number(field('backup-email-limit').value)}};
 }
 function toggleInsecure(){field('backup-insecure-warning').classList.toggle('hidden',field('backup-ftp-protocol').value!=='ftp');}
 function populate(config){
  field('backup-auto-enabled').checked=config.enabled;field('backup-time').value=config.time;
  field('backup-ftp-enabled').checked=config.ftp.enabled;field('backup-email-enabled').checked=config.email.enabled;
  for(const [id,key] of [['host','host'],['port','port'],['protocol','protocol'],['user','username'],['directory','directory']])field('backup-ftp-'+id).value=config.ftp[key]??'';
  for(const [id,key] of [['host','host'],['port','port'],['security','security'],['user','username'],['from','from'],['to','to'],['limit','maxMessageMb']])field('backup-email-'+id).value=config.email[key]??'';
  field('backup-ftp-insecure').checked=config.ftp.allowInsecure;
  field('backup-passphrase').placeholder=config.hasPassphrase?'Saved · leave blank to keep':'Create a strong recovery passphrase';
  field('backup-ftp-password').placeholder=config.ftp.hasPassword?'Saved · leave blank to keep':'Enter server password';
  field('backup-email-password').placeholder=config.email.hasPassword?'Saved · leave blank to keep':'Enter SMTP/app password';
  clearSecrets();toggleInsecure();loaded=true;dirty=false;
 }
 const statusLabel={saved:'Saved',sent:'Delivered',failed:'Failed',unknown:'Uncertain · check inbox',pending:'Pending',sending:'Sending',connecting:'Connecting',creating:'Creating',disabled:'Disabled',not_attempted:'Not attempted'};
 function badge(value){return `<span class="status ${['saved','sent'].includes(value)?'status-ok':['failed','unknown'].includes(value)?'status-debt':''}">${escapeHtml(statusLabel[value]||value)}</span>`;}
 function render(status){
  lastStatus=status;field('backup-schedule-summary').textContent=status.settings.enabled?'Daily at '+status.settings.time:'Automatic disabled · manual available';
  field('backup-clock').textContent=(window.posApi?.web?'Server clock: ':'Main clock: ')+status.clock.day+' '+status.clock.time+' · Asia/Beirut';
  field('backup-running-status').textContent=status.running?'Backup in progress…':'Ready';
  const saved=status.history.find(job=>job.local==='saved');field('backup-local-summary').textContent=saved?dateTimeFormatter.format(new Date(saved.createdAt))+' · '+(saved.bytes/1048576).toFixed(2)+' MiB':'No saved backup yet';
  if(!window.posApi?.web)field('backup-open-folder').title=status.folder;field('backup-storage-warning').classList.toggle('hidden',status.storageAvailable);
  field('backup-history-body').innerHTML=status.history.map(job=>`<tr><td><strong>${escapeHtml(dateTimeFormatter.format(new Date(job.createdAt)))}</strong><small>${escapeHtml(job.kind)} · ${escapeHtml(job.actor)}</small></td><td><strong>${escapeHtml(job.filename)}</strong><small>${(Number(job.bytes||0)/1048576).toFixed(2)} MiB · Attempt ${Number(job.attempts||0)}</small><small class="backup-checksum">${escapeHtml(job.sha256||'Not available')}</small></td><td>${badge(job.local)}<small>${escapeHtml(job.error||'')}</small></td><td>${badge(job.ftp)}<small>${escapeHtml(job.ftpTarget||'')}</small><small>${escapeHtml(job.ftpNote||'')}</small></td><td>${badge(job.email)}<small>${escapeHtml(job.emailTarget||'')}</small><small>${escapeHtml(job.emailNote||'')}</small></td><td>${job.local==='saved'&&[job.ftp,job.email].some(value=>['failed','unknown','pending'].includes(value))?`<button type="button" class="button button-secondary backup-retry" data-id="${escapeHtml(job.id)}">Retry delivery</button>`:''}</td></tr>`).join('')||emptyRow(6,'No backups yet','Save your settings, then choose Back up now.');
  for(const id of ['backup-now','backup-save','backup-test-ftp','backup-test-email'])field(id).disabled=busy||status.running;
 }
 async function load(){
  if(!has('backups.manage'))return;
  const status=await api.backups.status();if(!has('backups.manage'))return;
  if(!loaded&&!dirty)populate(status.settings);render(status);
 }
 async function action(task){
  if(!has('backups.manage')||busy)return;busy=true;
  if(lastStatus)render(lastStatus);
  try{return await task();}catch(error){showToast(errorMessage(error),'error');}finally{busy=false;if(has('backups.manage'))await load().catch(error=>showToast(errorMessage(error),'error'));}
 }
 function bind(){
  if(window.posApi?.web){
   field('backup-open-folder').disabled=true;
   field('backup-open-folder').textContent='Backup folder is on the server';
   field('backup-open-folder').title='Server folder access is managed by your administrator.';
   field('backup-extract').disabled=true;
   field('backup-extract').textContent='Recovery requires server access';
   field('backup-extract-passphrase').disabled=true;
   field('backup-extract-result').textContent='Ask your administrator to verify and extract backups using the server recovery guide. Browser recovery never replaces running business databases.';
  }
  field('backup-settings-form').addEventListener('input',()=>{dirty=true;});
  field('backup-ftp-protocol').addEventListener('change',toggleInsecure);
  field('backup-refresh').addEventListener('click',()=>action(load));
  field('backup-settings-form').addEventListener('submit',event=>{
   event.preventDefault();void action(async()=>{const input=settingsInput();clearSecrets();const status=await api.backups.save(input);if(!has('backups.manage'))return;populate(status.settings);render(status);showToast('Backup settings saved. Automatic daily and manual backups are available.');});
  });
  field('backup-now').addEventListener('click',()=>action(async()=>{
   if(dirty)throw Error('Save your edited backup settings before starting a backup.');
   const status=await api.backups.run();if(!has('backups.manage'))return;render(status);const job=status.history[0];
   showToast(job?.local==='saved'?'Local backup saved. Check both delivery statuses below.':'Backup failed. Check its status below.',job?.local==='saved'?'success':'error');
  }));
  for(const destination of ['ftp','email'])field('backup-test-'+destination).addEventListener('click',()=>action(async()=>{if(dirty)throw Error('Save edited settings before testing.');const result=await api.backups.test(destination);if(has('backups.manage'))showToast(result.message);}));
  field('backup-open-folder').addEventListener('click',()=>action(()=>api.backups.openFolder()));
  field('backup-history-body').addEventListener('click',event=>{
   const button=event.target.closest('.backup-retry');if(!button)return;
   void action(async()=>{if(dirty)throw Error('Save edited settings before retrying.');const job=lastStatus.history.find(row=>row.id===button.dataset.id);if(!job)return;
    if(job.email==='unknown'&&!await confirmAppAction('This email may already have arrived. Check the recipient inbox first. Resend the same backup, possibly creating a duplicate email?',"Resend backup email","Resend email"))return;
    const status=await api.backups.retry(job.id,{confirmEmailResend:job.email==='unknown'});if(has('backups.manage'))render(status);
   });
  });
  field('backup-extract').addEventListener('click',()=>action(async()=>{const passphrase=field('backup-extract-passphrase').value;field('backup-extract-passphrase').value='';if(passphrase.length<12)throw Error('Enter that backup\'s recovery passphrase first.');const result=await api.backups.extract(passphrase);if(has('backups.manage')&&!result.canceled){field('backup-extract-result').textContent=result.folder+' · '+result.message;showToast('Backup verified and extracted. Live databases were not replaced.');}}));
  setInterval(()=>{if(has('backups.manage')&&state.currentView==='backups')void load().catch(()=>{});},10000);
 }
 window.BackupView={bind,load,reset(){clearSecrets();loaded=false;dirty=false;lastStatus=null;if(field('backup-history-body'))field('backup-history-body').innerHTML='';if(field('backup-extract-result'))field('backup-extract-result').textContent='';}};
})();
