'use strict';
// Disposable loopback website preview. Every account, balance and receipt is fictional.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),http=require('node:http');
const {createBackend}=require('../app/core.cjs'),{createServer}=require('../server.cjs'),{createSecretStorage}=require('../lib/secrets.cjs');
const {DATABASES}=require('../app/backup-archive.cjs');
const version=require('../package.json').version;
const PREFIX='fibernetlb-website-preview-fictional-';
const PASSWORD='PreviewOnly-2026!';

async function freeLoopbackPort(){
 const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));return port;
}
function previewClient(url){
 const origin=new URL(url);let cookie='',csrf='',appVersion=version;
 async function request(route,input){
  return new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port:origin.port,path:route,method:input?'POST':'GET',headers:{Host:origin.host,...cookie?{Cookie:cookie}:{},...input?{Origin:origin.origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-App-Version':appVersion}:{}}},res=>{
    if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode>=400)reject(Error(body.error||'Preview HTTP check failed.'));else resolve(body.data);}catch(error){reject(error);}});
   });req.setTimeout(15000,()=>req.destroy(Error('The local preview did not respond.')));req.on('error',reject);req.end(input?JSON.stringify(input):undefined);
  });
 }
 return {request,async start(credentials){const session=await request('/api/session');csrf=session.csrfToken;appVersion=session.version;return request('/api/rpc',{channel:'auth:login',args:[credentials],workspaceId:'main'});},rpc:(channel,args=[],workspaceId='main')=>request('/api/rpc',{channel,args,workspaceId})};
}
async function seedPreview(backend,credentials){
 const good=async(channel,args=[],token='',workspaceId='main')=>{const result=await backend.request({channel,args,token,workspaceId});if(result.status!==200)throw Error('Fictional preview seed failed at '+channel+': '+result.error);return result.data;};
 await backend.createOwner({username:credentials.username,password:credentials.password,fullName:'Fictional Preview Administrator'});
 const admin=(await good('auth:login',[{username:credentials.username,password:credentials.password}])).sessionToken;
 for(const role of ['cashier','support','viewer'])await good('users:create',[{username:credentials[role].username,password:credentials[role].password,fullName:'Fictional Preview '+role,role}],admin);
 const opening={main:500,'fiber-users':250,'fiber-resellers':350,iptv:80,printer:60,studio:120,'mobile-ogero':90},tokens={main:admin};
 for(const section of backend.metadata().sections){if(section.id!=='main')tokens[section.id]=(await good('auth:switch',[section.id],admin)).sessionToken;await good('drawer:setBalance',[{balance:opening[section.id],note:'Fictional preview opening custody; no real money'}],tokens[section.id],section.id);}
 const router=await good('warehouse:create',[{requestId:crypto.randomUUID(),product:{name:'Preview Wi-Fi router',sku:'DEMO-ROUTER',category:'Routers',currency:'USD',cost:15,price:25,quantity:12,reorderLevel:3,barcodes:[]}}],admin);
 for(const [workspaceId,wholesalePrice,retailPrice]of [['fiber-users',18,25],['fiber-resellers',17,22]])await good('warehouse:setOffer',[{productKey:router.productKey,workspaceId,wholesalePrice,retailPrice,expectedVersion:0}],admin);
 const maintenance=await good('maintenance:save',[{requestId:crypto.randomUUID(),expectedVersion:0,name:'Preview router installation',price:15,active:true}],admin);
 await good('maintenance:checkout',[{requestId:crypto.randomUUID(),workspaceId:'fiber-users',items:[{serviceId:maintenance.service.id,version:maintenance.service.version,quantity:1}],paymentMethod:'Cash',customerName:'Fictional Preview Customer',customerAccount:'preview-only-001'}],tokens['fiber-users'],'fiber-users');
 await good('products:create',[{name:'Preview passport photo session',sku:'DEMO-PHOTO',category:'Photos and shooting',currency:'USD',cost:0,markup:0,price:12,quantity:0,reorderLevel:0}],tokens.studio,'studio');
 await good('companyDebts:create',[{requestId:crypto.randomUUID(),creditor:'Fictional equipment supplier',description:'Preview example only; no real obligation',amount:600,workspaceId:'studio'}],admin);
 await good('fixedMonthly:saveTemplate',[{requestId:crypto.randomUUID(),name:'Fictional office rent',recipient:'Preview landlord',description:'Preview monthly bill only',amount:180,dueDay:5,participants:[{workspaceId:'fiber-users',basisPoints:5000},{workspaceId:'fiber-resellers',basisPoints:2500}],profitBasisPoints:10000,active:true}],admin);
 // Seed the accounting backend's current period rather than a second calendar.
 // Production uses Asia/Beirut; a disposable preview may run on a UTC host.
 const monthly=await good('fixedMonthly:overview',[],admin);
 await good('fixedMonthly:ensureMonth',[{requestId:crypto.randomUUID(),month:monthly.month}],admin);
 for(const [workspaceId,token]of Object.entries(tokens))await good('auth:logout',[],token,workspaceId);
}
async function createDemo({port=3810,host='127.0.0.1'}={}){
 if(host!=='127.0.0.1')throw Error('The disposable preview binds only to 127.0.0.1.');
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Choose a valid local preview port.');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)),marker=JSON.stringify({pid:process.pid,nonce:crypto.randomUUID(),directory});
 const markerFile=path.join(directory,'.owned-preview');fs.writeFileSync(markerFile,marker,{flag:'wx',mode:0o600});
 const rawKey=crypto.randomBytes(32),secrets=createSecretStorage(rawKey);rawKey.fill(0);
 const credentials=Object.freeze({username:'demo.admin',password:PASSWORD,cashier:Object.freeze({username:'demo.cashier',password:PASSWORD}),support:Object.freeze({username:'demo.support',password:PASSWORD}),viewer:Object.freeze({username:'demo.viewer',password:PASSWORD})});
 let backend,server,stopping;
 const cleanup=()=>{
  const resolved=path.resolve(directory),temporary=path.resolve(os.tmpdir()),stat=fs.lstatSync(resolved);
  if(path.dirname(resolved)!==temporary||!path.basename(resolved).startsWith(PREFIX)||!stat.isDirectory()||stat.isSymbolicLink()||fs.readFileSync(markerFile,'utf8')!==marker)throw Error('Refusing to clean an unexpected preview directory.');
  fs.rmSync(resolved,{recursive:true,force:false});
 };
 const stop=()=>{if(stopping)return stopping;stopping=(async()=>{if(server?.listening){await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections?.();});}await backend?.close();secrets.destroy();cleanup();})();return stopping;};
 try{
  backend=await createBackend({dataDirectory:directory,initialize:true,providersEnabled:false,secrets,version});
  await seedPreview(backend,credentials);
  if(port===0)port=await freeLoopbackPort();
  const url='http://127.0.0.1:'+port;
  server=createServer({backend,origin:url,demo:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const client=previewClient(url);await client.start({username:credentials.username,password:credentials.password});await client.rpc('finance:overview',[{workspaceId:'all'}]);await client.rpc('auth:logout');
  const memory=process.memoryUsage(),resourceProfile=Object.freeze({measuredAt:new Date().toISOString(),units:'bytes',rss:memory.rss,heapUsed:memory.heapUsed,heapTotal:memory.heapTotal,external:memory.external,arrayBuffers:memory.arrayBuffers,databaseFiles:DATABASES.length,databaseTotalBytes:DATABASES.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0),scope:'Current Node process after fictional seeding and a real HTTP finance overview; this is not a production capacity measurement.'});
  return {server,backend,url,stop,directory,credentials,resourceProfile};
 }catch(error){try{await stop();}catch(cleanupError){error.cleanupError=cleanupError.message;}throw error;}
}
async function main(args){
 if(args.length!==0&&(args.length!==2||args[0]!=='--port'||!/^\d+$/.test(args[1])))throw Error('Use node tools/demo.cjs [--port 3810].');
 const preview=await createDemo({port:args.length?Number(args[1]):3810});
 process.stdout.write('FICTIONAL LOOPBACK PREVIEW — providers disabled; no Main PC or live files used.\n'+preview.url+'\nUsername: '+preview.credentials.username+'\nPassword: '+preview.credentials.password+'\nResource profile: '+JSON.stringify(preview.resourceProfile)+'\n');
 let finishing=false;const finish=()=>{if(finishing)return;finishing=true;preview.stop().catch(()=>{process.stderr.write('Preview cleanup did not finish; its fictional temporary directory was retained.\n');process.exitCode=1;});};
 process.once('SIGINT',finish);process.once('SIGTERM',finish);
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{process.stderr.write('The fictional local website preview could not start: '+error.message+'\n');process.exitCode=1;});
module.exports={createDemo};
