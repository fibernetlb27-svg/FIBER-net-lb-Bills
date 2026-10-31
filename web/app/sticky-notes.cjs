'use strict';
const crypto=require('node:crypto'),{query:q}=require('./finance-ledger.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const colors=new Set(['yellow','blue','green','pink']);
function object(input,keys){if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).some(key=>typeof key!=='string'||!keys.includes(key)))throw Error('Choose valid private note details.');return input;}
function text(value,label,max,empty=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||!empty&&!value.trim())throw Error('Enter a valid '+label+'.');return value;}
function identifier(value){const id=text(value,'note reference',100);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(id))throw Error('Use a valid private note reference.');return id;}
function version(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Refresh this note before editing.');return value;}
function owner(user){const key=user?.account_key??user?.accountKey;if(!user||user.active===false||user.active===0||user.activity_inspection||user.activityInspection||typeof key!=='string'||!key.trim())throw Error('Sign in to your own active account to open private notes.');return key;}
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS sticky_notes(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,color TEXT NOT NULL,pinned INTEGER NOT NULL,deleted INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sticky_notes_owner ON sticky_notes(owner_key,deleted,pinned,updated_at);
CREATE TABLE IF NOT EXISTS sticky_note_requests(request_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,input_hash TEXT NOT NULL,result_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS sticky_note_requests_update BEFORE UPDATE ON sticky_note_requests BEGIN SELECT RAISE(ABORT,'Private note request history is immutable.');END;
CREATE TRIGGER IF NOT EXISTS sticky_note_requests_delete BEFORE DELETE ON sticky_note_requests BEGIN SELECT RAISE(ABORT,'Private note request history is immutable.');END;`);}
function needsMigration(db){return ['sticky_notes','sticky_notes_owner','sticky_note_requests','sticky_note_requests_update','sticky_note_requests_delete'].some(name=>!q(db,'SELECT name FROM sqlite_master WHERE name=?',[name]).length);}
const dto=row=>({id:row.id,title:row.title,body:row.body,color:row.color,pinned:Boolean(row.pinned),deleted:Boolean(row.deleted),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
class StickyNotes{
 constructor(context){Object.assign(this,context);this.dirty=new Set();this.queue=Promise.resolve();}
 user(){return owner(this.authorize());}
 enqueue(task){const run=this.queue.then(task,task);this.queue=run.catch(()=>{});return run;}
 list(input={}){const key=this.user();object(input,['deleted']);if(input.deleted!==undefined&&typeof input.deleted!=='boolean')throw Error('Choose active notes or Trash.');return {notes:q(this.db,'SELECT * FROM sticky_notes WHERE owner_key=? AND deleted=? ORDER BY pinned DESC,updated_at DESC,id LIMIT 500',[key,input.deleted?1:0]).map(dto)};}
 prior(requestId,key,fingerprint){const row=q(this.db,'SELECT * FROM sticky_note_requests WHERE request_id=?',[requestId])[0];if(!row)return null;if(row.owner_key!==key||fingerprint&&row.input_hash!==fingerprint)throw Error('This private note request cannot be reused.');return JSON.parse(row.result_json);}
 async persist(requestId,result){this.dirty.add(requestId);try{await this.saveEntry();this.dirty.clear();return result;}catch{throw Error('The note save could not be confirmed. Check the original saved note request before retrying.');}}
 status(input){const key=this.user();object(input,['requestId']);const requestId=identifier(input.requestId),result=this.prior(requestId,key);return result?{state:this.dirty.has(requestId)?'save_required':'completed',requestId,result}:{state:'not_found',requestId,canRelease:true};}
 resume(input){return this.enqueue(async()=>{const key=this.user();object(input,['requestId']);const requestId=identifier(input.requestId),result=this.prior(requestId,key);if(!result)throw Error('The original private note request was not found.');return this.dirty.has(requestId)?this.persist(requestId,result):result;});}
 mutate(kind,input){return this.enqueue(async()=>{
  const key=this.user(),allowed=kind==='save'?['id','title','body','color','pinned','version','requestId']:['id','version','requestId'];object(input,allowed);
  const id=identifier(input.id),requestId=identifier(input.requestId),fingerprint=hash({kind,...input}),prior=this.prior(requestId,key,fingerprint);if(prior)return this.dirty.has(requestId)?this.persist(requestId,prior):prior;
  const existing=q(this.db,'SELECT * FROM sticky_notes WHERE id=?',[id])[0];if(existing&&existing.owner_key!==key)throw Error('This private note is unavailable.');
  const revision=version(input.version??0);if(existing?revision!==existing.version:kind!=='save'||revision!==0)throw Error('This note changed on another PC. Refresh it; your draft has not been replaced.');
  if(kind==='save'&&existing?.deleted)throw Error('Restore this note from Trash before editing.');
  if(kind==='remove'&&existing.deleted||kind==='restore'&&!existing.deleted)throw Error('Refresh the private note list before changing this note.');
  let title=existing?.title||'',body=existing?.body||'',color=existing?.color||'yellow',pinned=existing?.pinned||0;
  if(kind==='save'){title=text(input.title??'','note title',120,true).trim();body=text(input.body??'','note text',8000,true);if(!title&&!body.trim())throw Error('Write a title or note first.');if(!colors.has(input.color)||typeof input.pinned!=='boolean')throw Error('Choose a valid note color and pin setting.');color=input.color;pinned=input.pinned?1:0;}
  if((!existing||kind==='restore')&&q(this.db,'SELECT COUNT(*) AS n FROM sticky_notes WHERE owner_key=? AND deleted=0',[key])[0].n>=500)throw Error('Keep up to 500 active notes; move old notes to Trash first.');
  const at=this.now(),deleted=kind==='remove'?1:0;
  this.db.exec('BEGIN');let result;try{
   this.db.run('INSERT INTO sticky_notes VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,color=excluded.color,pinned=excluded.pinned,deleted=excluded.deleted,version=excluded.version,updated_at=excluded.updated_at',[id,key,title,body,color,pinned,deleted,revision+1,existing?.created_at||at,at]);
   result={state:'completed',requestId,note:dto(q(this.db,'SELECT * FROM sticky_notes WHERE id=? AND owner_key=?',[id,key])[0])};
   this.db.run('INSERT INTO sticky_note_requests VALUES(?,?,?,?)',[requestId,key,fingerprint,JSON.stringify(result)]);this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.persist(requestId,result);
 });}
 save(input){return this.mutate('save',input);}remove(input){return this.mutate('remove',input);}restore(input){return this.mutate('restore',input);}
}
module.exports={initialize,needsMigration,owner,StickyNotes};
