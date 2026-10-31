'use strict';
function rows(db,sql){const s=db.prepare(sql);try{const out=[];while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
const roleCheck=/CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)\s*\)/i;
function needsSupportRole(db){const sql=rows(db,"SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")[0]?.sql||'';const match=sql.match(roleCheck);return Boolean(match&&!match[1].includes("'support'"));}
function migrateSupportRole(db){
 if(!needsSupportRole(db))return false;
 const original=rows(db,"SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")[0].sql;
 const schema=original.replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"users"|users|\[users\]|`users`)\s*\(/i,'CREATE TABLE users_support_upgrade (').replace(roleCheck,(_match,list)=>`CHECK(role IN (${list}, 'support'${list.includes("'attendance_operator'")?'':", 'attendance_operator'"}))`);
 if(schema===original||!schema.startsWith('CREATE TABLE users_support_upgrade'))throw Error('Unsupported staff schema; no user records changed.');
 const objects=rows(db,"SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL");
 const columns=rows(db,'PRAGMA table_info(users)').map(c=>'"'+c.name.replaceAll('"','""')+'"').join(',');
 const sequence=rows(db,"SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").length?(rows(db,"SELECT seq FROM sqlite_sequence WHERE name='users'")[0]?.seq??null):null;
 const fk=rows(db,'PRAGMA foreign_keys')[0].foreign_keys,legacy=rows(db,'PRAGMA legacy_alter_table')[0].legacy_alter_table,before=JSON.stringify(rows(db,'PRAGMA foreign_key_check'));
 db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN');
 try{
  db.exec(schema);db.exec(`INSERT INTO users_support_upgrade (${columns}) SELECT ${columns} FROM users; DROP TABLE users; ALTER TABLE users_support_upgrade RENAME TO users;`);
  for(const object of objects)db.exec(object.sql);
  if(sequence!==null)db.run("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='users'",[sequence]);
  if(JSON.stringify(rows(db,'PRAGMA foreign_key_check'))!==before)throw Error('Staff migration would change existing foreign-key integrity.');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 finally{db.exec(`PRAGMA foreign_keys=${fk}; PRAGMA legacy_alter_table=${legacy}`);}
 return true;
}
module.exports={needsSupportRole,migrateSupportRole};
