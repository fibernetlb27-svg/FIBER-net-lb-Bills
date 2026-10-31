const crypto=require('node:crypto'),zlib=require('node:zlib'),{promisify}=require('node:util');
const derive=promisify(crypto.scrypt);
const HEADER=Buffer.from('FIBERNETLB-BACKUP-1\n'),MAX_RAW=256*1024*1024,MAX_JSON=360*1024*1024;
const DATABASES=['isp-desk.sqlite',...['fiber-users','fiber-resellers','iptv','printer','studio','mobile-ogero'].map(id=>'sections/'+id+'.sqlite')];
const OPTIONAL=['network-config.json','internet-api-settings.json','update-settings.json'];
const ALLOWED=new Set([...DATABASES,...OPTIONAL]);
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
function password(value){if(typeof value!=='string'||value.length<12||value.length>256)throw Error('Use a backup passphrase of 12–256 characters and keep a separate safe copy.');return value;}
function validateEntries(entries){
 if(!Array.isArray(entries)||entries.length<DATABASES.length||entries.length>ALLOWED.size)throw Error('The backup must contain all seven business databases.');
 const seen=new Set();let total=0;
 for(const entry of entries){if(!ALLOWED.has(entry.name)||seen.has(entry.name)||!Buffer.isBuffer(entry.data))throw Error('Invalid or duplicate backup entry.');seen.add(entry.name);total+=entry.data.length;}
 if(DATABASES.some(name=>!seen.has(name)))throw Error('The backup must contain all seven business databases.');
 if(total>MAX_RAW)throw Error('Backup exceeds the 256 MiB snapshot safety limit.');
 return total;
}
async function sealBackup(entries,passphrase,metadata={}){
 password(passphrase);validateEntries(entries);
 const payload={format:'FIBERNETLB-BACKUP-1',version:String(metadata.version||''),createdAt:String(metadata.createdAt||new Date().toISOString()),timezone:'Asia/Beirut',files:entries.map(e=>({name:e.name,size:e.data.length,sha256:sha256(e.data),data:e.data.toString('base64')}))};
 const json=Buffer.from(JSON.stringify(payload));if(json.length>MAX_JSON)throw Error('Backup metadata exceeds its safety limit.');
 const packed=zlib.gzipSync(json),salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
 const key=await derive(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(HEADER);const encrypted=Buffer.concat([cipher.update(packed),cipher.final()]);return Buffer.concat([HEADER,salt,iv,cipher.getAuthTag(),encrypted]);}finally{key.fill(0);}
}
async function openBackup(data,passphrase){
 password(passphrase);
 if(!Buffer.isBuffer(data)||data.length<HEADER.length+45||data.length>MAX_JSON+1024||!data.subarray(0,HEADER.length).equals(HEADER))throw Error('This is not a supported FIBER net lb encrypted backup.');
 let offset=HEADER.length;const salt=data.subarray(offset,offset+=16),iv=data.subarray(offset,offset+=12),tag=data.subarray(offset,offset+=16);
 const key=await derive(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 let payload;
 try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(HEADER);decipher.setAuthTag(tag);const packed=Buffer.concat([decipher.update(data.subarray(offset)),decipher.final()]);payload=JSON.parse(zlib.gunzipSync(packed,{maxOutputLength:MAX_JSON}).toString('utf8'));}catch{throw Error('Wrong backup passphrase or damaged backup. Nothing was extracted.');}finally{key.fill(0);}
 if(payload.format!=='FIBERNETLB-BACKUP-1'||!Array.isArray(payload.files))throw Error('Invalid backup manifest.');
 const entries=payload.files.map(file=>{
  if(typeof file.data!=='string'||!Number.isSafeInteger(file.size)||file.size<0||file.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(file.data))throw Error('Invalid backup entry encoding.');
  const bytes=Buffer.from(file.data,'base64');
  if(bytes.toString('base64')!==file.data||bytes.length!==file.size||sha256(bytes)!==file.sha256)throw Error('Backup entry integrity check failed.');
  return {name:file.name,data:bytes};
 });
 validateEntries(entries);
 return {version:payload.version,createdAt:payload.createdAt,entries};
}
module.exports={sealBackup,openBackup,sha256,DATABASES,OPTIONAL,MAX_RAW};
