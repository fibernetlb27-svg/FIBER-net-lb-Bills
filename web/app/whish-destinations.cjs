const crypto=require('node:crypto');
function query(db,sql,params=[]){const s=db.prepare(sql);try{s.bind(params);const out=[];while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
function initializeWhish(db){db.exec(`CREATE TABLE IF NOT EXISTS whish_destinations(id TEXT PRIMARY KEY,label TEXT NOT NULL,number TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS payment_destinations(kind TEXT NOT NULL,record_key TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,record_key));`);}
function listDestinations(db,all=false){return query(db,`SELECT id,label,number,active FROM whish_destinations ${all?'':'WHERE active=1'} ORDER BY label COLLATE NOCASE,number`);}
function saveDestination(db,input){
 const label=String(input?.label??'').trim(),number=String(input?.number??'').trim().replace(/[ ()-]/g,'');
 if(!label||label.length>80||/[\x00-\x1f]/.test(label)||!/^\+?\d{6,20}$/.test(number)||typeof input.active!=='boolean')throw Error('Enter a name, a valid destination number (6–20 digits), and its active status.');
 const id=input.id?String(input.id):crypto.randomUUID();
 if(input.id&&!query(db,'SELECT id FROM whish_destinations WHERE id=?',[id]).length)throw Error('Whish destination not found.');
 if(query(db,'SELECT id FROM whish_destinations WHERE number=? AND id<>?',[number,id]).length)throw Error('This destination number is already configured.');
 db.run('INSERT INTO whish_destinations(id,label,number,active,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,number=excluded.number,active=excluded.active,updated_at=excluded.updated_at',[id,label,number,Number(input.active),new Date().toISOString()]);
 return {id,label,number,active:Number(input.active)};
}
function resolveDestination(db,method,id,previous=undefined){
 if(method!=='Whish Money')return null;
 // Replays use the original immutable snapshot, even after the admin changes
 // or deactivates that number. Old requests with no snapshot remain recoverable.
 if(previous!==undefined){if(String(id||'')!==String(previous?.id||''))throw Error('This payment request already has a different Whish destination.');return previous?{id:previous.id,label:previous.label,number:previous.number}:null;}
 const row=listDestinations(db).find(p=>p.id===String(id||''));
 if(!row)throw Error('Select an active Whish Money destination number. Ask the admin to configure the list on Main dashboard.');
 return {id:row.id,label:row.label,number:row.number};
}
function receiptAmounts(amount){
 const value=Number(amount),gross=Math.round(value*100);
 if(!Number.isFinite(value)||!Number.isSafeInteger(gross)||Math.abs(value*100-gross)>1e-6)throw Error('Enter a valid USD payment with at most two decimal places.');
 // Incoming payments accrue a profit expense, without reducing wallet money.
 // A signed refund is
 // not another incoming payment and does not refund an earlier fee implicitly.
 const fee=gross>0?Math.round(gross/100):0;
 return {gross:gross/100,fee:fee/100,netCollected:(gross-fee)/100,walletAmount:gross/100,feeRate:gross>0?0.01:0,feePolicy:'profit_only',feeChargedAt:'receipt',walletPolicy:'gross'};
}
function saveSnapshot(db,kind,key,snapshot,amount){if(snapshot)db.run('INSERT INTO payment_destinations(kind,record_key,snapshot_json) VALUES(?,?,?)',[kind,String(key),JSON.stringify({...snapshot,...receiptAmounts(amount)})]);}
function readSnapshot(db,kind,key){
 if(!query(db,"SELECT name FROM sqlite_master WHERE name='payment_destinations'").length)return null;
 const row=query(db,'SELECT snapshot_json FROM payment_destinations WHERE kind=? AND record_key=?',[kind,String(key)])[0];return row?JSON.parse(row.snapshot_json):null;
}
module.exports={initializeWhish,listDestinations,saveDestination,resolveDestination,saveSnapshot,readSnapshot,receiptAmounts};
