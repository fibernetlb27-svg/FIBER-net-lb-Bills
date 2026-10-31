(() => {
  'use strict';
  const api=window.posApi,root=document.getElementById('bandwidth-accounting-root'),status=document.getElementById('bandwidth-window-status'),admin=document.getElementById('bandwidth-window-admin'),theme=document.getElementById('bandwidth-window-theme'),toastElement=document.getElementById('bandwidth-window-toast');
  let identity='',timer=null,checking=false,closed=false,toastTimer;
  const userKey=user=>JSON.stringify([user?.accountKey||user?.account_key,user?.username,user?.role,user?.active]);
  const applyTheme=value=>{const chosen=value==='fibernetlb'?'fibernetlb':'classic';document.documentElement.dataset.theme=chosen;theme.value=chosen;};
  try{applyTheme(localStorage.getItem('fibernetlb-theme'));}catch{applyTheme('classic');}
  theme.addEventListener('change',()=>{applyTheme(theme.value);try{localStorage.setItem('fibernetlb-theme',theme.value);}catch{}});
  window.addEventListener('storage',event=>{if(event.key==='fibernetlb-theme')applyTheme(event.newValue);});
  function toast(message,kind='success'){clearTimeout(toastTimer);toastElement.textContent=message;toastElement.dataset.kind=kind;toastElement.hidden=false;toastTimer=setTimeout(()=>{toastElement.hidden=true;},7000);}
  async function close(){closed=true;clearInterval(timer);clearTimeout(toastTimer);window.BandwidthAccounting?.reset();root.hidden=true;status.hidden=false;status.textContent='Closing Bandwidth Accounting…';try{await api.bandwidth.close();}catch(error){status.textContent='Bandwidth Accounting is cleared. Use Back to Main dashboard to close this window.';toast(error.message||String(error),'error');}}
  document.getElementById('bandwidth-window-close').addEventListener('click',close);
  function blocked(message){window.BandwidthAccounting?.reset();root.hidden=true;admin.textContent='';status.hidden=false;status.textContent=message;status.setAttribute('role','alert');identity='';}
  async function check(){
    if(checking||closed)return;checking=true;
    try{
      if(!api?.bandwidth||!window.BandwidthAccounting)throw Error('Bandwidth Accounting is unavailable. Update the Main PC and this PC together.');
      const result=await api.bandwidth.access(),user=result?.user;if(closed)return;
      if(!user||user.role!=='admin'||user.active===false)throw Error('Main administrator access is required. Return to Main dashboard and sign in again.');
      if(userKey(user)!==identity){identity=userKey(user);admin.textContent=(user.fullName||user.full_name||user.username)+' · Admin';window.BandwidthAccounting.init({api:api.bandwidth,user,workspace:{id:'main'},container:root,onBack:close,toast});await window.BandwidthAccounting.load();if(closed)return;}
      status.hidden=true;status.setAttribute('role','status');
    }catch(error){if(!closed)blocked(error.message||String(error));}
    finally{checking=false;}
  }
  window.addEventListener('beforeunload',()=>{closed=true;clearInterval(timer);clearTimeout(toastTimer);window.BandwidthAccounting?.reset();});
  window.addEventListener('pos-web-auth-ended',()=>blocked('You signed out. Return to Main dashboard and sign in again.'));
  check();timer=setInterval(check,15000);
})();
