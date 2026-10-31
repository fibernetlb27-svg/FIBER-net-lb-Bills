const crypto=require("node:crypto");
function rows(db,sql,params=[]) {const statement=db.prepare(sql);statement.bind(params);const result=[];try{while(statement.step())result.push(statement.getAsObject());}finally{statement.free();}return result;}
function initializePortalOperations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS portal_operations (
    request_id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity TEXT NOT NULL,fingerprint TEXT NOT NULL,
    input_json TEXT NOT NULL,quote_json TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,
    recorded_at TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',result_json TEXT NOT NULL DEFAULT '{}',
    bill_id INTEGER REFERENCES fibernetlb_bills(id));
    CREATE TABLE IF NOT EXISTS portal_operation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL REFERENCES portal_operations(request_id) ON DELETE CASCADE,
    state TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,recorded_at TEXT NOT NULL);
    UPDATE portal_operations SET state='unknown',message='The application restarted during submission. Check Proradius transactions before retrying.' WHERE state='processing';
    UPDATE portal_operations SET state='failed',message='Restarted before submission; no portal action was sent.' WHERE state='checking';`);
  const columns=rows(db,"PRAGMA table_info(fibernetlb_bundles)");
  if(!columns.some(item=>item.name==="cost_source"))db.run("ALTER TABLE fibernetlb_bundles ADD COLUMN cost_source TEXT NOT NULL DEFAULT ''");
  if(!columns.some(item=>item.name==="cost_verified_at"))db.run("ALTER TABLE fibernetlb_bundles ADD COLUMN cost_verified_at TEXT NOT NULL DEFAULT ''");
}
class PortalOperationLedger {
  constructor(db,save,authorize,owner=null){this.db=db;this.save=save;this.authorize=authorize;this.owner=owner;}
  one(sql,params=[]){return rows(this.db,sql,params)[0]??null;}
  get(id){const row=this.one("SELECT * FROM portal_operations WHERE request_id=?",[id]),scope=this.owner?.scope();if(row&&scope&&row.actor_key!==scope)throw Error('Operation not found for your account.');if(row?.state==='archived')throw Error('This confirmed test request was archived locally and cannot be resumed or replayed. Start a new request only for a new, intended transaction.');return row;}
  pending(entity){return this.one("SELECT request_id FROM portal_operations WHERE entity=? AND state IN ('checking','processing','unknown','confirmed')",[entity]);}
  fingerprint(input){return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");}
  event(id,state,note,actor){this.db.run("INSERT INTO portal_operation_events(request_id,state,note,actor,recorded_at) VALUES(?,?,?,?,?)",[id,state,note,actor,new Date().toISOString()]);}
  finish(id,state,message,actor,result={}){this.db.run("UPDATE portal_operations SET state=?,message=?,result_json=? WHERE request_id=?",[state,message,JSON.stringify(result),id]);this.event(id,state,message,actor);this.save();return this.get(id);}
  history(kind){const scope=this.owner?.scope();return rows(this.db,`SELECT request_id AS requestId,kind,entity,state,actor,recorded_at AS recordedAt,message,bill_id AS billId,input_json,quote_json FROM portal_operations WHERE kind=? ${scope?'AND actor_key=?':''} ORDER BY rowid DESC LIMIT 100`,scope?[kind,scope]:[kind]).map(({input_json,quote_json,...item})=>({...item,input:JSON.parse(input_json),quote:JSON.parse(quote_json)}));}
  async apply(id,kind,entity,input,quote,actor,perform){
    this.authorize(kind);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw Error("Invalid operation request ID.");
    const fingerprint=this.fingerprint(input),previous=this.get(id);
    if(previous&&(previous.kind!==kind||previous.fingerprint!==fingerprint))throw Error("This request already has different details. Start a new operation.");
    if(previous&&["confirmed","succeeded"].includes(previous.state))return previous;
    if(previous&&["checking","processing","unknown"].includes(previous.state))throw Error("This operation needs review. Do not repeat it; check Proradius transactions.");
    if(this.pending(entity))throw Error("This account has an unfinished portal operation. Review it first.");
    this.db.run("INSERT INTO portal_operations(request_id,kind,entity,fingerprint,input_json,quote_json,state,actor,recorded_at) VALUES(?,?,?,?,?,?,'checking',?,?) ON CONFLICT(request_id) DO UPDATE SET state='checking',message='',quote_json=excluded.quote_json,actor=excluded.actor",[id,kind,entity,fingerprint,JSON.stringify(input),JSON.stringify(quote),actor,new Date().toISOString()]);
    if(this.owner&&!previous)this.db.run('UPDATE portal_operations SET actor_key=? WHERE request_id=?',[this.owner.key(),id]);
    this.event(id,"checking","Verifying the exact account and charge; nothing submitted yet.",actor);this.save();
    let sent=false;
    try{
      const result=await perform(metadata=>{
        this.authorize(kind);
        if(metadata)this.db.run("UPDATE portal_operations SET result_json=? WHERE request_id=?",[JSON.stringify(metadata),id]);
        this.db.run("UPDATE portal_operations SET state='processing' WHERE request_id=?",[id]);
        this.event(id,"processing","One portal submission; never retry until its outcome is confirmed.",actor);this.save();sent=true;
      });
      return this.finish(id,"confirmed","Proradius explicitly confirmed the operation. Saving the local payment next.",actor,result);
    }catch(error){
      const message=sent?"Portal outcome is uncertain. Check Proradius transactions; no second submission or local payment was made.":error.message;
      const metadata=JSON.parse(this.get(id).result_json);
      this.finish(id,sent?"unknown":"failed",message,actor,metadata);throw Error(message);
    }
  }
  attach(id,billId,actor){this.db.run("UPDATE portal_operations SET bill_id=? WHERE request_id=?",[billId,id]);return this.finish(id,"succeeded","Portal action and local payment recorded once.",actor,JSON.parse(this.get(id).result_json));}
  resolve(id,input,actor){
    const row=this.get(id);
    if(row?.state!=="unknown")throw Error("Only an uncertain operation needs manual reconciliation.");
    const applied=input.confirmation==="APPLIED",notApplied=input.confirmation==="NOT APPLIED",note=String(input.note??"").trim();
    if((!applied&&!notApplied)||note.length<5||note.length>500)throw Error("Check the Proradius transaction history, type APPLIED or NOT APPLIED, and add an audit note (5–500 characters).");
    return this.finish(id,applied?"confirmed":"failed",`Authorized operator checked portal transactions: ${input.confirmation}. ${note}`,actor,JSON.parse(row.result_json));
  }
}
module.exports={initializePortalOperations,PortalOperationLedger};
