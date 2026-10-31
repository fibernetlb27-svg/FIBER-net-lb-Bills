'use strict';
// One attempt per request. A timeout never retries a financial operation.
const DEFAULT_RPC_TIMEOUT_MS=30_000;
const contains=(values,key)=>values instanceof Set?values.has(key):Array.isArray(values)&&values.includes(key);
function rpcTimeout(channel,{asyncChannels=[],monthClosingChannels=[]}={}){
 if(['bills:savePortal','bills:saveRenew','bills:renew'].includes(channel))return 600_000;
 // An explicitly reviewed batch can persist up to seven separate archives.
 // Its original request remains the recovery reference; it is never retried.
 if(['finance:commitMonthsClose','finance:resumeMonthsClose'].includes(channel))return 600_000;
 if(contains(monthClosingChannels,channel))return 120_000;
 if(contains(asyncChannels,channel))return 60_000;
 return DEFAULT_RPC_TIMEOUT_MS;
}
function transportError(code,message){const error=new Error(message);error.code=code;error.clientTransport=true;return error;}
const timeoutError=readOnly=>transportError('CLIENT_RPC_TIMEOUT','The main computer is busy or the connection is slow. '+(readOnly?'This read took too long; try refreshing after Main has finished loading.':'The request timed out; check its saved result before repeating a payment or other change.'));
const offlineError=()=>transportError('CLIENT_RPC_OFFLINE','Cannot reach the main computer. Check that it is running and that this connection is available.');
const invalidError=readOnly=>transportError('CLIENT_RPC_INVALID_RESPONSE','The main computer returned an incomplete or invalid response.'+(readOnly?' Try refreshing this view.':' Check its saved result before repeating a payment or other change.'));
class ClientTransport{
 constructor({fetch:fetcher,setTimeout:schedule,clearTimeout:cancel}={}){
  this.fetch=fetcher||((...args)=>globalThis.fetch(...args));
  this.schedule=schedule||((...args)=>globalThis.setTimeout(...args));
  this.cancel=cancel||((...args)=>globalThis.clearTimeout(...args));
  this.generation=0;this.reset();
 }
 reset(scope=''){this.scope=scope;this.generation++;this.sequence=0;this.resultSequence=0;this.state={rpcHealthy:null,rpcError:''};}
 health(scope){return scope===this.scope?{...this.state}:{rpcHealthy:null,rpcError:''};}
 begin(scope){if(scope!==this.scope)this.reset(scope);return {scope,generation:this.generation,sequence:++this.sequence};}
 record(ticket,error){
  if(!ticket||ticket.scope!==this.scope||ticket.generation!==this.generation||ticket.sequence<this.resultSequence)return;
  this.resultSequence=ticket.sequence;this.state={rpcHealthy:!error,rpcError:error?.message||''};
 }
 async json(url,options={}, {timeoutMs=DEFAULT_RPC_TIMEOUT_MS,rpcScope,readOnly=false}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error('Choose a valid Client request deadline.');
  const ticket=rpcScope===undefined?null:this.begin(rpcScope),controller=new AbortController();let expired=false,timer;
  const deadline=new Promise((_resolve,reject)=>{timer=this.schedule(()=>{expired=true;controller.abort();reject(timeoutError(readOnly));},timeoutMs);});
  const operation=(async()=>{
   let response;try{response=await this.fetch(url,{...options,signal:controller.signal});}catch{throw expired?timeoutError(readOnly):offlineError();}
   let payload;try{payload=await response.json();}catch{throw expired?timeoutError(readOnly):invalidError(readOnly);}
   if(!payload||typeof payload!=='object'||Array.isArray(payload))throw invalidError(readOnly);
   return {response,payload};
  })();
  try{
   const result=await Promise.race([operation,deadline]);
   // An application or sign-in rejection still proves the transport responded.
   this.record(ticket,null);return result;
  }catch(error){const failure=error?.clientTransport?error:expired?timeoutError(readOnly):offlineError();this.record(ticket,failure);throw failure;}
  finally{this.cancel(timer);}
 }
}
module.exports={ClientTransport,rpcTimeout,DEFAULT_RPC_TIMEOUT_MS};
