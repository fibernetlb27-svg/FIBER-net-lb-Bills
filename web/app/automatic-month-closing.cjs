'use strict';
// Server-only scheduling. Custody stays in its existing drawer/wallet; the
// existing verified month-close service owns all financial writes and recovery.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TIME_ZONE='Asia/Beirut',BASIS='automatic_month_close',FORMAT=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function localTime(value=new Date()){
 const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))throw Error('The automatic monthly closing clock is invalid.');
 const parts=Object.fromEntries(FORMAT.formatToParts(date).filter(row=>row.type!=='literal').map(row=>[row.type,row.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
function validMonth(value){return typeof value==='string'&&/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value);}
function nextMonth(month,delta=1){if(!validMonth(month))throw Error('The automatic closing month is invalid.');const [year,n]=month.split('-').map(Number);return new Date(Date.UTC(year,n-1+delta,1)).toISOString().slice(0,7);}
function dueMonth(value){
 const local=localTime(value),month=local.slice(0,7),[year,n]=month.split('-').map(Number),lastDay=String(new Date(Date.UTC(year,n,0)).getUTCDate()).padStart(2,'0');
 return local.slice(8,10)===lastDay&&local.slice(11,16)>='23:59'?month:nextMonth(month,-1);
}
function mayCloseCurrent(month,at){return validMonth(month)&&typeof at==='string'&&/^20\d{2}-\d{2}-\d{2}T23:59:[0-5]\d$/.test(at)&&month===at.slice(0,7)&&at.slice(8,10)===String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');}
function requestId(month,workspaceId){if(!validMonth(month)||typeof workspaceId!=='string'||!workspaceId)throw Error('The automatic closing business is invalid.');return 'auto-month-'+hash([BASIS,month,workspaceId]);}
function validState(value){return value&&value.version===1&&Object.keys(value).sort().join(',')==='completedThrough,createdAt,firstMonth,lastAttemptAt,lastError,month,state,version'&&validMonth(value.firstMonth)&&(!value.completedThrough||validMonth(value.completedThrough)&&value.completedThrough>=value.firstMonth)&&(!value.month||validMonth(value.month))&&typeof value.createdAt==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value.createdAt)&&typeof value.lastAttemptAt==='string'&&typeof value.lastError==='string'&&['ready','running','waiting','completed'].includes(value.state);}
class AutomaticMonthClosing{
 constructor({directory,now=()=>new Date(),workspaces,execute}){
  if(!path.isAbsolute(directory)||!Array.isArray(workspaces)||!workspaces.length||new Set(workspaces).size!==workspaces.length||typeof execute!=='function')throw Error('Automatic closing requires private server persistence and the complete business close executor.');
  this.file=path.join(directory,'automatic-month-closing.json');this.now=now;this.workspaces=[...workspaces];this.execute=execute;this.running=null;
  if(fs.existsSync(this.file)){
   if(!fs.lstatSync(this.file).isFile()||fs.lstatSync(this.file).isSymbolicLink())throw Error('The automatic monthly closing journal is not a regular private file.');
   let envelope;try{envelope=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{throw Error('The automatic monthly closing journal could not be verified.');}
   if(!validState(envelope.state)||envelope.sha256!==hash(envelope.state))throw Error('The automatic monthly closing journal could not be verified.');this.state=envelope.state;
  }else{
   const at=localTime(this.now());this.state={version:1,firstMonth:at.slice(0,7),createdAt:at,completedThrough:'',month:'',state:'ready',lastAttemptAt:'',lastError:''};this.save();
  }
 }
 save(){
  if(!validState(this.state))throw Error('The automatic monthly closing journal is invalid.');
  const bytes=JSON.stringify({state:this.state,sha256:hash(this.state)})+'\n',temporary=this.file+'.'+crypto.randomUUID()+'.pending';let descriptor;
  try{descriptor=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;fs.renameSync(temporary,this.file);if(process.platform!=='win32'){fs.chmodSync(this.file,0o600);const folder=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}}if(fs.readFileSync(this.file,'utf8')!==bytes)throw Error('verification');}
  catch(error){if(descriptor!==undefined)fs.closeSync(descriptor);try{fs.unlinkSync(temporary);}catch{}throw Error('The automatic monthly closing journal could not be saved. No replacement close should be submitted.');}
 }
 status(){return {basis:BASIS,enabled:true,timeZone:TIME_ZONE,hour:23,minute:59,schedule:'Last day of each month at 11:59 PM',firstMonth:this.state.firstMonth,completedThrough:this.state.completedThrough,month:this.state.month,state:this.running?'running':this.state.state,lastAttemptAt:this.state.lastAttemptAt,lastError:this.state.lastError,carryForward:true,automaticBankDeposit:false};}
 tick(){
  if(this.running)return this.running;
  const target=dueMonth(this.now()),month=this.state.completedThrough?nextMonth(this.state.completedThrough):this.state.firstMonth;if(month>target)return Promise.resolve(this.status());
  this.running=(async()=>{
   let current=month;
   // Bounded catch-up after downtime; the next tick continues any later months.
   for(let count=0;current<=target&&count<12;count++,current=nextMonth(current)){
    this.state={...this.state,month:current,state:'running',lastAttemptAt:localTime(this.now()),lastError:''};this.save();
    try{
     await this.execute({month:current,workspaces:this.workspaces.map(workspaceId=>({workspaceId,requestId:requestId(current,workspaceId)}))});
     this.state={...this.state,completedThrough:current,state:'completed',lastError:''};this.save();
    }catch{
     this.state={...this.state,state:'waiting',lastError:'Automatic closing is waiting. Review pending financial operations and the Monthly ledger; the original completed business archives are preserved.'};this.save();break;
    }
   }
   return {...this.status(),state:this.state.state};
  })().finally(()=>{this.running=null;});return this.running;
 }
}
module.exports={AutomaticMonthClosing,localTime,dueMonth,nextMonth,mayCloseCurrent,requestId,TIME_ZONE};
