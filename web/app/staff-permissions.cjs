'use strict';
const Features=require('./src/staff-capabilities.js');
function query(db,sql,args=[]){const s=db.prepare(sql);try{s.bind(args);const rows=[];while(s.step())rows.push(s.getAsObject());return rows;}finally{s.free();}}
class StaffPermissions{
  constructor(db,persist){this.db=db;this.persist=persist;}
  initialize(){this.db.run(`CREATE TABLE IF NOT EXISTS staff_feature_permissions (
    account_key TEXT PRIMARY KEY, permissions_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL, actor_key TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS staff_feature_permission_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL, before_json TEXT NOT NULL,
    after_json TEXT NOT NULL, changed_at TEXT NOT NULL, actor_key TEXT NOT NULL, actor_name TEXT NOT NULL
  )`);this.persist();}
  get(key){
    const row=query(this.db,'SELECT permissions_json FROM staff_feature_permissions WHERE account_key=?',[key||''])[0];
    if(!row)return {};
    try{return Features.normalize(JSON.parse(row.permissions_json));}
    catch{return Object.fromEntries(Features.catalog.map(item=>[item.permission,false]));} // Corrupt settings fail closed.
  }
  save(key,value,actor){
    const normalized=Features.normalize(value);
    if(!key||!actor?.key)throw new Error('An identified administrator and staff account are required.');
    const before=this.get(key),after=JSON.stringify(normalized),date=new Date().toISOString();
    this.db.run('BEGIN');
    try{
      this.db.run('INSERT OR REPLACE INTO staff_feature_permissions VALUES (?,?,?,?,?)',[key,after,date,actor.name,actor.key]);
      this.db.run('INSERT INTO staff_feature_permission_audit (account_key,before_json,after_json,changed_at,actor_key,actor_name) VALUES (?,?,?,?,?,?)',[key,JSON.stringify(before),after,date,actor.key,actor.name]);
      this.db.run('COMMIT');
    }catch(error){this.db.run('ROLLBACK');throw error;}
    this.persist();return normalized;
  }
}
module.exports={StaffPermissions};
