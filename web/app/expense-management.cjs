const PAPER_CATEGORIES=['A3 paper','A4 paper','A5 paper'];
const OptionalWhishFees=require('./optional-whish-fees.cjs');
const {resolveFundingMonth,effectiveMonth}=require('./expense-funding-months.cjs');
const PAPER_TYPES={plain:'Plain',canson:'Conson (cardboard)',sticker:'Stickers'};
function query(db,sql,params=[]){const statement=db.prepare(sql);try{statement.bind(params);const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}}
function needsExpenseMigration(db){const columns=query(db,'PRAGMA table_info(expenses)').map(c=>c.name);return !columns.includes('paper_size')||!columns.includes('paper_type')||!columns.includes('funding_method')||!columns.includes('funding_wallet_json')||!columns.includes('funding_month')||!query(db,"SELECT name FROM sqlite_master WHERE name='expense_edits'").length;}
function initializeExpenses(db,workspaceId){
 const columns=query(db,'PRAGMA table_info(expenses)').map(c=>c.name);
 if(!columns.includes('paper_size'))db.run("ALTER TABLE expenses ADD COLUMN paper_size TEXT NOT NULL DEFAULT ''");
 if(!columns.includes('paper_type'))db.run("ALTER TABLE expenses ADD COLUMN paper_type TEXT NOT NULL DEFAULT ''");
 // These fields allocate expense funding only. They do not debit a physical
 // drawer or wallet. Earlier expenses deliberately remain source-unrecorded.
 if(!columns.includes('funding_method'))db.run("ALTER TABLE expenses ADD COLUMN funding_method TEXT NOT NULL DEFAULT ''");
 if(!columns.includes('funding_wallet_json'))db.run("ALTER TABLE expenses ADD COLUMN funding_wallet_json TEXT NOT NULL DEFAULT ''");
 // NULL keeps legacy classification tied to its actual expense-date month.
 // An explicit selection is a separate budget bucket, not an accounting date.
 if(!columns.includes('funding_month'))db.run('ALTER TABLE expenses ADD COLUMN funding_month TEXT');
 db.run(`CREATE TABLE IF NOT EXISTS expense_edits (id INTEGER PRIMARY KEY AUTOINCREMENT,expense_id INTEGER NOT NULL,actor_key TEXT NOT NULL,actor_name TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 db.run('CREATE INDEX IF NOT EXISTS idx_expense_edits_record ON expense_edits(expense_id,id)');
 if(workspaceId==='printer')for(const category of PAPER_CATEGORIES)db.run('INSERT OR IGNORE INTO expense_categories(name) VALUES (?)',[category]);
}
function fundingInput(input,{fundingWallets=[],previous=null}={}){
 const method=input.fundingMethod===undefined?String(previous?.fundingMethod||''):input.fundingMethod;
 if(!['','Cash','Whish Money'].includes(method)||input.fundingMethod!==undefined&&method==='')throw Error('Choose Cash or Whish Money for the expense funding source.');
 const walletId=input.fundingWalletId===undefined?String(previous?.fundingWallet?.id||''):String(input.fundingWalletId);
 if(method!=='Whish Money'){
  if(input.fundingWalletId!==undefined&&walletId!=='')throw Error('A Whish wallet can be selected only for Whish Money funding.');
  return {fundingMethod:method,fundingWallet:null};
 }
 if(previous?.fundingMethod===method&&previous.fundingWallet&&walletId===previous.fundingWallet.id)return {fundingMethod:method,fundingWallet:{...previous.fundingWallet}};
 const wallet=fundingWallets.find(row=>row.id===walletId&&(row.active===true||row.active===1));
 if(!wallet)throw Error('Choose an active Whish wallet for the expense funding source.');
 return {fundingMethod:method,fundingWallet:{id:wallet.id,label:wallet.label,number:wallet.number}};
}
function expenseInput(input={},workspaceId,fundingContext={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Enter the expense details.');
 const expenseDate=String(input.expenseDate??''),category=String(input.category??'Other').trim()||'Other',amount=Number(input.amount);
 const date=new Date(expenseDate+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==expenseDate)throw Error('Choose a valid expense date.');
 if(!Number.isFinite(amount)||amount<=0||amount>1e12)throw Error('Amount must be greater than zero and within the supported range.');
 const rounded=Math.round((amount+Number.EPSILON)*100)/100;if(rounded<=0)throw Error('Amount must be at least $0.01.');
 if(category.length>80)throw Error('Category name must be 80 characters or fewer.');
 let description=String(input.description??'').trim(),paperSize='',paperType='';
 const match=workspaceId==='printer'&&/^(A[345]) paper$/i.exec(category);
 if(match){paperSize=match[1].toUpperCase();paperType=String(input.paperType??'');if(!Object.hasOwn(PAPER_TYPES,paperType))throw Error('Select Plain, Conson or Stickers for the paper expense.');if(input.paperSize&&input.paperSize!==paperSize)throw Error('Paper size must match the selected category.');description=paperSize+' paper · '+PAPER_TYPES[paperType];}
 if(!description)throw Error('Description is required.');if(description.length>1000)throw Error('Description must be 1,000 characters or fewer.');
 return {expenseDate,category,description,amount:rounded,paperSize,paperType,fundingMonth:resolveFundingMonth(input,expenseDate,fundingContext),...fundingInput(input,fundingContext)};
}
function requireCategory(db,category){if(!query(db,'SELECT id FROM expense_categories WHERE name=? COLLATE NOCASE',[category]).length)throw Error('Choose a valid expense category.');}
function expenseRecord(db,id){const row=query(db,'SELECT id,expense_date AS expenseDate,category,description,amount,user_id AS userId,source_type AS sourceType,source_id AS sourceId,paper_size AS paperSize,paper_type AS paperType,funding_method AS fundingMethod,funding_wallet_json AS fundingWalletJson,funding_month AS fundingMonth,created_at AS createdAt FROM expenses WHERE id=?',[id])[0];if(!row)return row;const fundingWallet=row.fundingWalletJson?JSON.parse(row.fundingWalletJson):null;delete row.fundingWalletJson;if(fundingWallet&&(!fundingWallet.id||typeof fundingWallet.label!=='string'||typeof fundingWallet.number!=='string')||row.fundingMethod==='Whish Money'&&!fundingWallet||row.fundingMethod!=='Whish Money'&&fundingWallet)throw Error('The original expense funding source is invalid. Review its audit before editing.');return {...row,fundingMonth:effectiveMonth(row),fundingMonthExplicit:row.fundingMonth!==null,fundingWallet,...row.sourceType==='manual'?OptionalWhishFees.details(db,'expense',row.id):{deductWhishFee:false,whishFee:0}};}
function updateExpense(db,id,input,{workspaceId,actorKey,actorName,actorRole,now,fundingWallets=[]}){
 const number=Number(id);if(!Number.isSafeInteger(number)||number<=0)throw Error('Choose a valid expense.');
 const before=expenseRecord(db,number);if(!before)throw Error('Expense was not found.');
 if(before.sourceType!=='manual')throw Error('Purchase-linked costs and installation receipts must be changed through their original transaction, not as a manual expense.');
 const next=expenseInput(input,workspaceId,{fundingWallets,previous:before});requireCategory(db,next.category);
 const deductWhishFee=OptionalWhishFees.choice(input,{workspaceId,actorRole},before.deductWhishFee);
 db.run('BEGIN TRANSACTION');try{
  db.run('UPDATE expenses SET expense_date=?,category=?,description=?,amount=?,paper_size=?,paper_type=?,funding_method=?,funding_wallet_json=?,funding_month=? WHERE id=?',[next.expenseDate,next.category,next.description,next.amount,next.paperSize,next.paperType,next.fundingMethod,next.fundingWallet?JSON.stringify(next.fundingWallet):'',input.fundingMonth===undefined&&!before.fundingMonthExplicit?null:next.fundingMonth,number]);
  OptionalWhishFees.sync(db,{kind:'expense',recordId:number,amount:next.amount,date:next.expenseDate,userId:before.userId,reference:next.description,enabled:deductWhishFee,actorKey,actorName,now});
  const after=expenseRecord(db,number);
  db.run('INSERT INTO expense_edits(expense_id,actor_key,actor_name,before_json,after_json) VALUES (?,?,?,?,?)',[number,actorKey,actorName,JSON.stringify(before),JSON.stringify(after)]);
  db.run('COMMIT');return after;
 }catch(error){db.run('ROLLBACK');throw error;}
}
module.exports={PAPER_CATEGORIES,PAPER_TYPES,needsExpenseMigration,initializeExpenses,expenseInput,fundingInput,requireCategory,expenseRecord,updateExpense};
