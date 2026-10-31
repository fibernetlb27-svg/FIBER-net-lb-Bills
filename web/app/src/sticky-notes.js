// Private notes are always resolved by the authenticated server account.
// Note titles, bodies and drafts never enter browser storage.
window.StickyNotes = (() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['yellow','blue','green','pink'];
  const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value);
  const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=100&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
  const safeError=value=>String(value?.message||value||'Your note could not be saved.').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,700);
  let config,dialog,notes=[],draft=null,dirty=false,trash=false,search='',pending=null,identity='',storageKey='',epoch=0,ticket=0,busy=false,loading=false;
  const user=()=>config?.getUser?.()??config?.user;
  const account=()=>String(user()?.accountKey||user()?.account_key||'');
  const allowed=()=>Boolean(user()&&identifier(account())&&user()?.active!==false&&user()?.active!==0&&!user()?.activity_inspection&&!user()?.activityInspection&&typeof config?.api?.list==='function');
  const identityOf=()=>JSON.stringify([account(),user()?.active,user()?.activity_inspection,user()?.activityInspection]);
  const capture=()=>({epoch,identity});
  const current=stamp=>allowed()&&stamp.epoch===epoch&&stamp.identity===identity&&identityOf()===identity;
  const notify=(text,error=false)=>config?.toast?.(text,error?'error':undefined);
  function validNote(value){
    if(!value||!identifier(value.id)||typeof value.title!=='string'||value.title.length>120||typeof value.body!=='string'||value.body.length>8000||!colors.includes(value.color)||typeof value.pinned!=='boolean'||typeof value.deleted!=='boolean'||!Number.isSafeInteger(value.version)||value.version<1||!['createdAt','updatedAt'].every(key=>typeof value[key]==='string'&&Number.isFinite(Date.parse(value[key]))))throw Error('Your saved note could not be verified.');
    return value;
  }
  function status(text='',error=false){const node=el('sn-status');if(!node)return;node.textContent=text;node.hidden=!text;node.classList.toggle('sn-error',error);}
  function validReference(value){if(!value||value.version!==1||value.accountKey!==account()||!requestId(value.requestId)||!['save','remove','restore'].includes(value.method)||Object.keys(value).some(key=>!['version','accountKey','requestId','method'].includes(key)))throw Error('The saved notes request reference is invalid.');return value;}
  function restoreReference(){
    storageKey='fiber-private-note-request-v1:'+encodeURIComponent(account());
    try{const raw=sessionStorage.getItem(storageKey);pending=raw?{...validReference(JSON.parse(raw)),restored:true}:null;}
    catch(error){pending={corrupt:true,error:'A private-note request reference needs review. '+safeError(error)};}
  }
  function remember(method,input){
    if(pending)throw Error('Check the original note request before making another change.');
    const reference=validReference({version:1,accountKey:account(),requestId:input.requestId,method}),raw=JSON.stringify(reference);
    sessionStorage.setItem(storageKey,raw);if(sessionStorage.getItem(storageKey)!==raw)throw Error('The original note request could not be retained. No change was submitted.');
    pending={...reference,input:{...input}};return pending;
  }
  function forget(marker){if(pending?.requestId!==marker.requestId)return;sessionStorage.removeItem(storageKey);if(sessionStorage.getItem(storageKey)!==null)throw Error('The completed note reference could not be cleared. Check it before another change.');pending=null;}
  function close(force=false){if(busy&&!force)return;ticket++;if(dialog){dialog.close();dialog.remove();dialog=null;}loading=false;}
  function reset(){epoch++;close(true);config=null;notes=[];draft=null;dirty=false;trash=false;search='';pending=null;identity='';storageKey='';busy=false;}
  function init(value){const nextAccount=String(value?.getUser?.()?.accountKey||value?.getUser?.()?.account_key||value?.user?.accountKey||value?.user?.account_key||'');if(config&&account()===nextAccount&&allowed()&&identityOf()===identity){config=value;if(allowed()&&identityOf()===identity)return;}reset();config=value;if(!allowed())return;identity=identityOf();restoreReference();}
  function updateUser(value){if(!config)return;const next={...config,user:value};config=next;if(!allowed()||identityOf()!==identity)init(next);}
  function mount(){
    close(true);dialog=document.createElement('dialog');dialog.className='sn-dialog';dialog.setAttribute('aria-labelledby','sn-title');
    dialog.innerHTML='<div class="modal-heading"><div><p class="eyebrow">YOUR PRIVATE WORKSPACE</p><h2 id="sn-title">Sticky notes</h2><p class="sn-subtitle">Only your signed-in account can see these notes, across your businesses.</p></div><button id="sn-close" type="button" class="button button-secondary">Close</button></div><p id="sn-status" class="sn-status" role="status" hidden></p><div id="sn-recovery"></div><div class="sn-toolbar"><div class="sn-tabs"><button id="sn-active" type="button" class="button button-secondary">Notes</button><button id="sn-trash" type="button" class="button button-secondary">Trash</button></div><button id="sn-new" type="button" class="button button-primary">+ New note</button></div><div class="sn-workspace"><aside class="sn-list-panel"><label class="sn-search">Search your notes<input id="sn-search" type="search" placeholder="Title or note text" /></label><div id="sn-list" class="sn-list"></div><button id="sn-refresh" type="button" class="button button-secondary">Refresh notes</button></aside><section id="sn-editor" class="sn-editor"></section></div>';
    document.body.append(dialog);el('sn-close').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});el('sn-new').onclick=newNote;el('sn-active').onclick=()=>switchTrash(false);el('sn-trash').onclick=()=>switchTrash(true);el('sn-search').value=search;el('sn-search').oninput=()=>{search=el('sn-search').value;renderList();};el('sn-refresh').onclick=()=>load();dialog.showModal();render();
  }
  async function open(){if(!allowed())throw Error('Sign in with your own active account to open private notes.');if(busy)return;if(identityOf()!==identity)init({...config});if(!allowed())return;mount();await load();}
  async function load(){
    if(!allowed()||!dialog||loading||busy)return;const stamp=capture(),version=++ticket,view=trash;loading=true;controls();
    try{const value=await config.api.list({deleted:view});if(!current(stamp)||version!==ticket||!dialog)return;if(!value||!Array.isArray(value.notes)||new Set(value.notes.map(note=>note?.id)).size!==value.notes.length)throw Error('Your private notes list could not be verified.');notes=value.notes.map(note=>{validNote(note);if(note.deleted!==view)throw Error('A note was returned in the wrong private view.');return {...note};});if(draft&&!dirty){const fresh=notes.find(note=>note.id===draft.id);draft=fresh?{...fresh}:null;}if(!draft&&!dirty&&notes.length)draft={...ordered()[0]};render();status('');}
    catch(error){if(current(stamp)&&version===ticket)status(safeError(error),true);}
    finally{if(current(stamp)&&version===ticket){loading=false;renderRecovery();controls();}}
  }
  function ordered(){return [...notes].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));}
  function render(){if(!dialog)return;renderList();renderEditor();renderRecovery();controls();}
  function renderList(){
    const node=el('sn-list');if(!node)return;const term=search.trim().toLocaleLowerCase(),rows=ordered().filter(note=>!term||(note.title+'\n'+note.body).toLocaleLowerCase().includes(term));
    node.innerHTML=rows.map(note=>'<button type="button" class="sn-card sn-color-'+esc(note.color)+(draft?.id===note.id?' selected':'')+'" data-sn-note="'+esc(note.id)+'"><span class="sn-card-meta">'+(note.pinned?'Pinned':'Note')+'</span><strong>'+esc(note.title||'Untitled note')+'</strong><span class="sn-card-body">'+esc(note.body.slice(0,180))+'</span><small>'+esc(new Date(note.updatedAt).toLocaleString())+'</small></button>').join('')||'<p class="sn-empty">'+(loading?'Loading your notes…':term?'No notes match this search.':trash?'Trash is empty.':'Create your first private note.')+'</p>';
    for(const button of node.querySelectorAll('[data-sn-note]'))button.onclick=()=>selectNote(button.dataset.snNote);
  }
  function renderEditor(){
    const node=el('sn-editor');if(!node)return;
    if(!draft){node.className='sn-editor';node.innerHTML='<div class="sn-editor-empty"><span aria-hidden="true">▤</span><h3>'+esc(trash?'Your deleted notes stay recoverable.':'Keep a thought close.')+'</h3><p>Select a note'+(trash?' to restore it.':' or create a new one. Draft text stays in this window until you save.')+'</p></div>';return;}
    node.className='sn-editor sn-color-'+draft.color;
    node.innerHTML='<form id="sn-form"><div class="sn-editor-heading"><span class="sn-draft-label">'+esc(draft.deleted?'In Trash':dirty?'Unsaved draft':'Saved privately')+'</span><label class="sn-pin"><input id="sn-pinned" type="checkbox"'+(draft.pinned?' checked':'')+' />Pinned</label></div><label>Title<input id="sn-note-title" maxlength="120" placeholder="Note title" /></label><label>Note<textarea id="sn-note-body" maxlength="8000" rows="10" placeholder="Write something to remember…"></textarea></label><div class="sn-editor-options"><label>Color<select id="sn-color">'+colors.map(color=>'<option value="'+color+'">'+color[0].toUpperCase()+color.slice(1)+'</option>').join('')+'</select></label><span id="sn-count" class="sn-subtitle"></span></div><div class="sn-editor-actions">'+(draft.deleted?'<button id="sn-restore" type="button" class="button button-primary">Restore note</button>':'<button id="sn-save" type="submit" class="button button-primary">Save note</button><button id="sn-discard" type="button" class="button button-secondary">Discard draft</button>'+((draft.version||0)>0?'<button id="sn-remove" type="button" class="button button-secondary">Move to Trash</button>':''))+'</div></form>';
    el('sn-note-title').value=draft.title;el('sn-note-body').value=draft.body;el('sn-color').value=draft.color;updateCount();
    for(const id of ['sn-note-title','sn-note-body','sn-pinned','sn-color'])el(id).oninput=()=>{draft={...draft,title:el('sn-note-title').value,body:el('sn-note-body').value,pinned:el('sn-pinned').checked,color:el('sn-color').value};dirty=true;node.className='sn-editor sn-color-'+draft.color;node.querySelector('.sn-draft-label').textContent='Unsaved draft';updateCount();controls();};
    el('sn-form').onsubmit=event=>{event.preventDefault();save();};if(el('sn-discard'))el('sn-discard').onclick=discardDraft;if(el('sn-remove'))el('sn-remove').onclick=()=>mutate('remove',{id:draft.id,version:draft.version});if(el('sn-restore'))el('sn-restore').onclick=()=>mutate('restore',{id:draft.id,version:draft.version});
  }
  function updateCount(){if(el('sn-count'))el('sn-count').textContent=(draft?.body.length||0).toLocaleString()+' / 8,000 characters';}
  function controls(){
    if(!dialog)return;dialog.setAttribute('aria-busy',String(busy||loading));for(const field of dialog.querySelectorAll('button,input,textarea,select'))field.disabled=busy||loading;
    const blocked=busy||loading||Boolean(pending);el('sn-new').disabled=blocked||trash;el('sn-active').classList.toggle('active',!trash);el('sn-trash').classList.toggle('active',trash);
    el('sn-active').disabled=blocked;el('sn-trash').disabled=blocked;
    if(draft){for(const id of ['sn-note-title','sn-note-body','sn-pinned','sn-color'])el(id).disabled=blocked||draft.deleted;for(const id of ['sn-save','sn-remove','sn-restore','sn-discard'])if(el(id))el(id).disabled=blocked;if(el('sn-save'))el('sn-save').disabled=blocked||!dirty;if(el('sn-remove'))el('sn-remove').disabled=blocked||dirty;}
    if(pending)for(const field of dialog.querySelectorAll('.sn-card'))field.disabled=true;
  }
  function canLeaveDraft(){if(busy||loading||pending)return false;if(dirty){status('Save this draft or choose Discard draft before opening another note or view.');return false;}return true;}
  function selectNote(id){if(!canLeaveDraft())return;const note=notes.find(row=>row.id===id);if(!note)return;draft={...note};dirty=false;status('');render();}
  function newNote(){if(!canLeaveDraft()||trash)return;draft={id:'note-'+crypto.randomUUID(),title:'',body:'',color:'yellow',pinned:false,deleted:false,version:0};dirty=true;status('');render();el('sn-note-title').focus();}
  async function switchTrash(value){if(trash===value||!canLeaveDraft())return;trash=value;draft=null;notes=[];render();await load();}
  function discardDraft(){if(busy||pending)return;draft=notes.find(note=>note.id===draft?.id)?{...notes.find(note=>note.id===draft.id)}:null;dirty=false;status('Draft discarded. Saved notes are unchanged.');render();}
  async function save(){
    if(!draft||draft.deleted||busy||pending||!dirty)return;
    const title=draft.title.trim(),body=draft.body;
    if(!title&&!body.trim()){status('Enter a title or some note text before saving.',true);return;}
    if(title.length>120||body.length>8000||!colors.includes(draft.color)){status('Keep the title within 120 characters and note within 8,000 characters.',true);return;}
    await mutate('save',{id:draft.id,title,body,color:draft.color,pinned:draft.pinned,version:draft.version||0});
  }
  async function mutate(method,input){
    if(!allowed()||busy||pending)return;input={...input,requestId:'notes-'+crypto.randomUUID()};let marker;
    try{marker=remember(method,input);}catch(error){status('No note change was submitted. '+safeError(error),true);return;}
    const stamp=capture(),view=ticket;busy=true;controls();
    try{const value=await config.api[method](input);if(!current(stamp)||view!==ticket)return;await complete(value,marker);}
    catch(error){if(current(stamp)&&view===ticket)status('Keep this draft and check its original saved request before trying another change. '+safeError(error),true);}
    finally{if(current(stamp)&&view===ticket){busy=false;renderRecovery();controls();}}
  }
  async function complete(value,marker){
    const result=value?.result||value,note=validNote(result?.note);
    if(value?.state!=='completed'||result.state!=='completed'||result.requestId!==marker.requestId||marker.input?.id&&note.id!==marker.input.id||marker.method==='remove'&&!note.deleted||marker.method!=='remove'&&note.deleted)throw Error('The original private-note result could not be verified.');
    forget(marker);notes=notes.filter(row=>row.id!==note.id);if(note.deleted===trash)notes.push({...note});draft=note.deleted===trash?{...note}:null;dirty=false;
    status(marker.method==='remove'?'Note moved to Trash. You can restore it.':marker.method==='restore'?'Note restored to your notes.':'Note saved privately.');notify(marker.method==='remove'?'Note moved to Trash.':marker.method==='restore'?'Note restored.':'Private note saved.');render();
  }
  function renderRecovery(){
    const node=el('sn-recovery');if(!node)return;if(!pending){node.replaceChildren();return;}
    if(pending.corrupt){node.innerHTML='<section class="sn-recovery"><h3>Review the original note request</h3><p>'+esc(pending.error)+'</p><p>Your draft remains in memory. New changes stay blocked until this reference is reviewed.</p></section>';return;}
    node.innerHTML='<section class="sn-recovery"><strong>Original note change needs confirmation</strong><p>Check this request before replacing it. Draft text is kept only in this window.</p><div class="sn-recovery-actions"><button id="sn-check" type="button" class="button button-secondary">Check saved request</button><button id="sn-resume" type="button" class="button button-primary"'+(pending.checkedState==='save_required'?'':' hidden')+'>Finish original save</button><button id="sn-retry" type="button" class="button button-secondary"'+(pending.checkedState==='not_found'&&pending.input?'':' hidden')+'>Retry original change</button><button id="sn-release" type="button" class="button button-secondary"'+(pending.checkedState==='not_found'&&pending.canRelease?'':' hidden')+'>Release unsaved reference</button></div><small class="sn-reference">'+esc(pending.requestId)+'</small></section>';
    el('sn-check').onclick=()=>check();el('sn-resume').onclick=()=>check(true);el('sn-retry').onclick=retry;el('sn-release').onclick=release;
  }
  async function check(resume=false){
    if(!allowed()||busy||!pending||pending.corrupt)return;const marker=pending,stamp=capture(),view=ticket;busy=true;controls();
    try{const value=await config.api[resume?'resume':'status']({requestId:marker.requestId});if(!current(stamp)||view!==ticket)return;if(value?.requestId!==marker.requestId)throw Error('The original note reference did not match.');if(value.state==='completed')await complete(value,marker);else if(value.state==='save_required'){pending.checkedState=value.state;pending.canRelease=false;status('The original note change needs its durable save completed.');}else if(value.state==='not_found'){pending.checkedState=value.state;pending.canRelease=value.canRelease===true;status('No saved change was found under this reference. Your draft is unchanged.');}else throw Error('The original note result could not be verified.');}
    catch(error){if(current(stamp)&&view===ticket)status(safeError(error),true);}
    finally{if(current(stamp)&&view===ticket){busy=false;renderRecovery();controls();}}
  }
  async function retry(){if(!allowed()||busy||pending?.checkedState!=='not_found'||!pending.input)return;const marker=pending,stamp=capture(),view=ticket;busy=true;controls();try{const value=await config.api[marker.method]({...marker.input});if(current(stamp)&&view===ticket)await complete(value,marker);}catch(error){if(current(stamp)&&view===ticket)status('The original change is still retained. '+safeError(error),true);}finally{if(current(stamp)&&view===ticket){busy=false;renderRecovery();controls();}}}
  async function release(){if(!allowed()||busy||pending?.checkedState!=='not_found'||!pending.canRelease)return;const marker=pending,stamp=capture(),view=ticket;busy=true;controls();try{const value=await config.api.status({requestId:marker.requestId});if(!current(stamp)||view!==ticket)return;if(value?.state!=='not_found'||value.requestId!==marker.requestId||value.canRelease!==true)throw Error('The original reference can no longer be released. Check its result.');forget(marker);status('Unsaved reference released. Your draft remains available.');}catch(error){if(current(stamp)&&view===ticket)status(safeError(error),true);}finally{if(current(stamp)&&view===ticket){busy=false;renderRecovery();controls();}}}
  return {init,open,reset,close,updateUser,hasPending:()=>Boolean(pending)||busy,hasDraft:()=>dirty};
})();
