const fs=require('node:fs'),path=require('node:path');
const ID=/^\d{8}T\d{9}-[a-f0-9-]{36}$/;
function list(directory,installDir){
 const root=path.join(directory,'update-rollback');if(!fs.existsSync(root))return [];
 return fs.readdirSync(root).filter(id=>ID.test(id)).flatMap(id=>{try{
  const folder=path.join(root,id);if(fs.lstatSync(folder).isSymbolicLink())return [];
  const m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
  if(m.format!=='FIBERNETLB-ROLLBACK-1'||m.id!==id||m.kind!=='pre-update'||m.mode!=='server'||m.data.filter(e=>e.exists&&e.name.endsWith('.sqlite')).length!==7||path.resolve(m.dataDir).toLowerCase()!==path.resolve(directory).toLowerCase()||path.resolve(m.installDir).toLowerCase()!==path.resolve(installDir).toLowerCase())return [];
  return [{id,version:String(m.version),createdAt:String(m.createdAt),databaseCount:m.data.filter(e=>e.exists&&e.name.endsWith('.sqlite')).length}];
 }catch{return [];}}).sort((a,b)=>b.id.localeCompare(a.id));
}
function select(directory,installDir,input){
 const snapshot=list(directory,installDir).find(s=>s.id===input?.id);if(!snapshot)throw Error('The pre-update snapshot is unavailable for this installation.');
 if(input.confirmation!==`RESTORE ${snapshot.version}`)throw Error(`Type RESTORE ${snapshot.version} to confirm the database rollback.`);
 return snapshot;
}
module.exports={list,select};
