// Read isolation is per statement, never a mutable view shared by LAN requests.
const {activeReceiptSql}=require('./bill-reset.cjs');
const OWNED = {
  sales:'user_id',active_sales:'user_id',fibernetlb_bills:'user_id',active_fibernetlb_bills:'user_id',
  telecom_payments:'user_id',active_telecom_payments:'user_id',expenses:'user_id',active_expenses:'user_id',purchase_receipts:'user_id',
  installation_payments:'user_id',cash_drawer_transactions:'user_id',active_cash_drawer_transactions:'user_id'
};
function query(db,sql,params=[]){const s=db.prepare(sql);try{s.bind(params);const out=[];while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
function scopedReadSql(sql,user){
  if(!user||user.role==='admin'||!/^\s*SELECT\b/i.test(sql))return sql;
  if(user.role==='section_user' && Object.keys(OWNED).some(table=>new RegExp(`\\b${table}\\b`,'i').test(sql)))throw Error('Section-only logins must read financial activity through their assigned-section reports.');
  const id=Number(user.id);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid activity owner.');
  const ctes=[],kinds={sales:'sale',active_sales:'sale',fibernetlb_bills:'bill',active_fibernetlb_bills:'bill',telecom_payments:'telecom',active_telecom_payments:'telecom',installation_payments:'installation',expenses:'expense',active_expenses:'expense',purchase_receipts:'purchase'};
  const condition=table=>user.financial_ownership&&kinds[table]?`COALESCE((SELECT o.owner_key FROM main.finance_receipt_owners o WHERE o.kind='${kinds[table]}' AND o.record_key=CAST(main.${table}.id AS TEXT)),(SELECT account_key FROM main.users WHERE id=main.${table}.user_id))=(SELECT account_key FROM main.users WHERE id=${id})`:`user_id=${id}`;
  for(const [table,column] of Object.entries(OWNED))if(new RegExp(`\\b${table}\\b`,'i').test(sql))ctes.push(`${table} AS (SELECT * FROM main.${table} WHERE ${column==='user_id'?condition(table):`${column}=${id}`})`);
  for(const [table,parent,column] of [['sale_items','sales','sale_id'],['purchase_receipt_items','purchase_receipts','purchase_receipt_id']])
    if(new RegExp(`\\b${table}\\b`,'i').test(sql))ctes.push(`${table} AS (SELECT * FROM main.${table} WHERE ${column} IN (SELECT id FROM main.${parent} WHERE ${condition(parent)}))`);
  return ctes.length?`WITH ${ctes.join(', ')} ${sql}`:sql;
}
function scopedDatabase(db,getUser,getArchiveDatabase=()=>db){return new Proxy(db,{get(target,key){if(key==='prepare')return sql=>target.prepare(scopedReadSql(activeReceiptSql(getArchiveDatabase(),sql),getUser()));const value=target[key];return typeof value==='function'?value.bind(target):value;}});}
const EXTRA={portal_operations:'actor_key TEXT',internet_plan_changes:'actor_key TEXT',installation_payments:'user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',debt_payments:'user_id INTEGER REFERENCES users(id) ON DELETE SET NULL'};
function needsActivityMigration(db){return Object.entries(EXTRA).some(([table,definition])=>!query(db,`PRAGMA table_info(${table})`).some(c=>c.name===definition.split(' ')[0]));}
function initializeActivity(db){
  // Historical money stays untouched. Ambiguous/deleted actors remain admin-only.
  for(const [table,definition] of Object.entries(EXTRA)){
    const column=definition.split(' ')[0];if(query(db,`PRAGMA table_info(${table})`).some(c=>c.name===column))continue;
    db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    if(column==='actor_key'){
      db.run(`UPDATE ${table} SET actor_key=(SELECT u.account_key FROM users u JOIN fibernetlb_bills b ON b.user_id=u.id WHERE b.id=${table}.bill_id) WHERE bill_id IS NOT NULL`);
      db.run(`UPDATE ${table} SET actor_key=(SELECT account_key FROM users WHERE full_name=${table}.actor) WHERE actor_key IS NULL AND (SELECT COUNT(*) FROM users WHERE full_name=${table}.actor)=1`);
    }else if(table==='installation_payments'){
      db.run('UPDATE installation_payments SET user_id=(SELECT u.id FROM users u JOIN portal_operations p ON p.actor_key=u.account_key WHERE p.request_id=installation_payments.request_id)');
    }else{
      db.run(`UPDATE debt_payments SET user_id=(SELECT id FROM users WHERE full_name=debt_payments.cashier_name) WHERE cashier_name<>'Legacy collection' AND (SELECT COUNT(*) FROM users WHERE full_name=debt_payments.cashier_name)=1`);
    }
    db.run(`CREATE INDEX IF NOT EXISTS ${table}_activity_owner ON ${table}(${column})`);
  }
}
function actorUser(db,row){
  if(row.actor_key)return query(db,'SELECT id,full_name FROM users WHERE account_key=?',[row.actor_key])[0]||{id:null,full_name:row.actor};
  return {id:null,full_name:row.actor};
}
module.exports={scopedReadSql,scopedDatabase,needsActivityMigration,initializeActivity,actorUser};
