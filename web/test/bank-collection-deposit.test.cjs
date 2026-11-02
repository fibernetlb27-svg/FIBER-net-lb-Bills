'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),F=require('../app/finance-ledger.cjs');
test('genuine Bank RPC caps prior-month deposits, rejects stale proof after spending, and preserves exact replay and current-money transfers',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernetlb-old-collection-fictional-')),password='Fictional-old-collection-owner-123';let core;
 t.after(async()=>{await core?.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernetlb-old-collection-fictional-'));fs.rmSync(directory,{recursive:true,force:true});});
 const now=new Date(),current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,month=new Date(Date.UTC(now.getFullYear(),now.getMonth()-1,1)).toISOString().slice(0,7),file=path.join(directory,'isp-desk.sqlite'),make=()=>createBackend({dataDirectory:directory,initialize:!fs.existsSync(file),providersEnabled:false,automaticMonthClose:false});
 const call=async(channel,args=[],token='')=>core.request({channel,args,token,workspaceId:'main'});
 const good=async(channel,args=[],token='')=>{const reply=await call(channel,args,token);assert.equal(reply.status,200,channel+': '+reply.error);return reply.data;};
 const login=async()=>good('auth:login',[{username:'collection.owner',password}]);
 core=await make();await core.createOwner({username:'collection.owner',fullName:'Fictional Collection Owner',password});await core.close();
 const SQL=await require('sql.js')();let db=new SQL.Database(fs.readFileSync(file)),owner;
 try{owner=F.query(db,"SELECT * FROM users WHERE username='collection.owner'")[0];db.run("INSERT INTO whish_destinations VALUES('fictional-old-wallet','Fictional old wallet','03000001',1,?)",[month+'-25T09:00:00']);db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,note,created_at,user_id,user_name) VALUES(100,'synthetic_opening','test','Fictional prior-month cash',?,?,?)",[month+'-25T09:00:00',owner.id,owner.full_name]);db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-old-wallet-opening','fictional-old','fictional-old-wallet',owner.account_key,5000,month+'-25T09:00:00']);fs.writeFileSync(file,Buffer.from(db.export()));}finally{db.close();}
 core=await make();let token=(await login()).sessionToken,base={workspaceId:'main',month,allocations:[]},review=await good('finance:closeMonthPreview',[base],token);await good('finance:commitMonthClose',[{...base,requestId:crypto.randomUUID(),token:review.token,confirmation:'CLOSE '+month}],token);await core.close();
 db=new SQL.Database(fs.readFileSync(file));try{
  db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,note,created_at,user_id,user_name) VALUES(-80,'synthetic_spend','test','Fictional old cash spent',?,?,?)",[current+'-01T00:00:00',owner.id,owner.full_name]);
  db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,reference_type,note,created_at,user_id,user_name) VALUES(300,'synthetic_new_receipt','test','Fictional new cash is separate',?,?,?)",[current+'-01T00:00:01',owner.id,owner.full_name]);fs.writeFileSync(file,Buffer.from(db.export()));
 }finally{db.close();}
 core=await make();token=(await login()).sessionToken;
 const native={workspaceId:'main',holderAccountKey:owner.account_key,method:'cash',walletId:'',direction:'deposit',amount:21,note:'Fictional current-money deposit'},prior={...native,collectionMonth:month,note:'Fictional prior-month deposit'};
 const plain=await good('bank:preview',[native],token);assert(!Object.hasOwn(plain,'collectionMonth'));assert(!Object.hasOwn(plain,'collectionBefore'));assert(!Object.hasOwn(plain,'collectionProof'));
 const tooMuch=await call('bank:preview',[prior],token);assert.equal(tooMuch.status,400);assert.match(tooMuch.error,/remaining prior-month/);
 const wrongMonth=await call('bank:preview',[{...prior,amount:1,collectionMonth:current}],token);assert.equal(wrongMonth.status,400);
 const withdrawal=await call('bank:preview',[{...prior,amount:1,direction:'withdraw'}],token);assert.equal(withdrawal.status,400);assert.match(withdrawal.error,/only be deposited/);
 const exact={...prior,amount:20},oldReview=await good('bank:preview',[exact],token);assert.deepEqual([oldReview.collectionMonth,oldReview.collectionBefore,oldReview.collectionAfter],[month,20,0]);assert.match(oldReview.collectionProof,/^[a-f0-9]{64}$/);
 await good('drawer:setBalance',[{balance:315,note:'Fictional five dollars spent after preview'}],token);
 await good('drawer:setBalance',[{balance:320,note:'Fictional new cash replaces the spent amount, not its prior-month provenance'}],token);
 const stale=await call('bank:transfer',[{...exact,requestId:crypto.randomUUID(),token:oldReview.token,confirmation:'TRANSFER BANK'}],token);assert.equal(stale.status,400);
 const currentInput={...prior,amount:15},fresh=await good('bank:preview',[currentInput],token),input={...currentInput,requestId:crypto.randomUUID(),token:fresh.token,confirmation:'TRANSFER BANK'};assert.deepEqual([fresh.collectionBefore,fresh.collectionAfter],[15,0]);const deposited=await good('bank:transfer',[input],token);assert.equal(deposited.collectionMonth,month);assert.deepEqual([deposited.collectionBefore,deposited.collectionAfter],[15,0]);assert.equal(deposited.noProfitChange,true);const repeated=await good('bank:transfer',[input],token);assert.equal(repeated.idempotent,true);
 const conflicting=await call('bank:transfer',[{...input,collectionMonth:current}],token);assert.equal(conflicting.status,400);assert.match(conflicting.error,/different transfer/);
 const spent=await call('bank:preview',[{...prior,amount:0.01}],token);assert.equal(spent.status,400,'New receipts cannot replenish a spent or deposited prior-month pool.');
 const walletInput={...prior,method:'whish',walletId:'fictional-old-wallet',amount:25},walletReview=await good('bank:preview',[walletInput],token);assert.deepEqual([walletReview.collectionBefore,walletReview.collectionAfter],[50,25]);await good('bank:transfer',[{...walletInput,requestId:crypto.randomUUID(),token:walletReview.token,confirmation:'TRANSFER BANK'}],token);
 await core.close();db=new SQL.Database(fs.readFileSync(file));try{const rows=F.query(db,'SELECT * FROM bank_transfers ORDER BY rowid');assert.equal(rows.length,2);assert(rows.every(row=>JSON.parse(row.input_json).collectionMonth===month));assert.deepEqual(rows.map(row=>row.amount_cents),[1500,2500]);assert.equal(F.drawerBalance(db),305);assert.equal(require('../app/bank-accounts.cjs').balance(db,'main'),40);}finally{db.close();}
 core=await make();token=(await login()).sessionToken;const recovered=await good('bank:transfer',[input],token);assert.equal(recovered.idempotent,true);const overview=await good('bank:overview',[{workspaceId:'main'}],token);assert.equal(overview.accounts[0].bankBalance,40);assert.equal(overview.history.length,2);await core.close();
 // Genuine persisted archive/journals, with only the durable-file boundary
 // replaced by an explicit fictional fault. Neither path adds another debit.
 const Bank=require('../app/bank-accounts.cjs'),Whish=require('../app/whish-destinations.cjs'),seed=fs.readFileSync(file),stamp=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,19);
 for(const phase of ['before','after'])for(const recovery of ['same','restart']){
  let durable=Buffer.from(seed),failure=true;const originalDb=new SQL.Database(new Uint8Array(seed));let targetDb=originalDb;
  const serviceFor=current=>new Bank.BankAccounts({entries:new Map([['main',{id:'main',db:current}]]),sections:[{id:'main',name:'Main Office'}],authorize:()=>F.query(current,'SELECT * FROM users WHERE account_key=?',[owner.account_key])[0],destinations:()=>Whish.listDestinations(current,true),now:()=>stamp,saveEntry:async()=>{if(failure&&phase==='before')throw Error('Fictional before-save interruption');durable=Buffer.from(current.export());if(failure)throw Error('Fictional after-save interruption');}});
  let service=serviceFor(originalDb);const value={...walletInput,amount:5,note:'Fictional recoverable prior-month deposit'},proof=service.preview(value),request={...value,requestId:'old-pool-'+phase+'-'+recovery,token:proof.token,confirmation:'TRANSFER BANK'};
  try{
   await assert.rejects(service.transfer(request),/save could not be confirmed/);assert.equal(service.status({workspaceId:'main',requestId:request.requestId}).state,'save_required');failure=false;
   if(recovery==='restart'){targetDb=new SQL.Database(durable);service=serviceFor(targetDb);}
   const status=service.status({workspaceId:'main',requestId:request.requestId});if(status.state==='save_required')await service.resume({workspaceId:'main',requestId:request.requestId});else await service.transfer(request);
   assert.equal(F.query(targetDb,'SELECT * FROM bank_transfers').length,3);assert.equal(Bank.balance(targetDb,'main'),45);assert.equal(F.walletBalances(targetDb,Whish.listDestinations(targetDb,true),owner.account_key).find(row=>row.id==='fictional-old-wallet').balance,20);assert.equal((await service.transfer(request)).idempotent,true);
  }finally{if(targetDb!==originalDb)targetDb.close();originalDb.close();}
 }
});
