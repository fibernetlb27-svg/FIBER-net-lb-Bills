const assert=require('node:assert/strict'),init=require('sql.js');
const {initializeExpenses,needsExpenseMigration,expenseInput,requireCategory,updateExpense,expenseRecord,PAPER_TYPES}=require('./expense-management.cjs');
(async()=>{
 const SQL=await init();const db=new SQL.Database();
 db.run(`CREATE TABLE expense_categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);INSERT INTO expense_categories(name) VALUES('Other');CREATE TABLE expenses(id INTEGER PRIMARY KEY,expense_date TEXT,category TEXT,description TEXT,amount REAL,user_id INTEGER,source_type TEXT DEFAULT 'manual',source_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO expenses VALUES(1,'2026-10-09','Other','Legacy expense',13,42,'manual',NULL,'2026-10-01');INSERT INTO expenses VALUES(2,'2026-10-09','Other','Purchase',20,43,'purchase_receipt',7,'2026-10-01');`);
 assert(needsExpenseMigration(db));initializeExpenses(db,'printer');assert(!needsExpenseMigration(db));initializeExpenses(db,'printer');
 assert.equal(db.exec('SELECT count(*) FROM expense_categories')[0].values[0][0],4);assert.equal(expenseRecord(db,1).amount,13);assert.equal(expenseRecord(db,2).sourceId,7);
 const context={workspaceId:'printer',actorKey:'main:1',actorName:'Admin (owner)'};
 for(const size of ['A3','A4','A5'])for(const type of Object.keys(PAPER_TYPES)){
  const input={expenseDate:'2026-10-09',category:size+' paper',paperType:type,description:'IGNORED',amount:14.25};
  const result=updateExpense(db,1,input,context);assert.equal(result.description,size+' paper · '+PAPER_TYPES[type]);assert.equal(result.paperType,type);assert.equal(result.paperSize,size);assert.equal(result.userId,42);assert.equal(result.createdAt,'2026-10-01');
 }
 const logs=db.exec('SELECT before_json,after_json,actor_key FROM expense_edits')[0].values;assert.equal(logs.length,9);assert.equal(JSON.parse(logs[0][0]).amount,13);assert.equal(JSON.parse(logs[8][1]).paperType,'sticker');assert.equal(logs[0][2],'main:1');
 for(const input of [null,{expenseDate:'2026-02-30',category:'Other',amount:1,description:'x'},{expenseDate:'2026-10-09',category:'A4 paper',amount:5,paperType:'__proto__'},{expenseDate:'2026-10-09',category:'A4 paper',amount:5,paperType:'plain',paperSize:'A3'},{expenseDate:'2026-10-09',amount:Infinity,description:'x'},{expenseDate:'2026-10-09',amount:.001,description:'x'}])assert.throws(()=>expenseInput(input,'printer'));
 assert.throws(()=>updateExpense(db,2,{expenseDate:'2026-10-09',category:'Other',amount:1,description:'x'},context),/original transaction/);assert.equal(db.exec('SELECT count(*) FROM expense_edits')[0].values[0][0],9);
 assert.throws(()=>requireCategory(db,'Unknown'),/category/);
 assert.throws(()=>expenseInput({expenseDate:'2026-10-09',category:'A4 paper',paperType:'plain',amount:1},'studio'),/Description/);
 updateExpense(db,1,{expenseDate:'2026-10-08',category:'Other',description:'Normal cost',amount:5},context);assert.equal(expenseRecord(db,1).paperType,'');
 const other=new SQL.Database(db.export());other.run('DELETE FROM expense_categories');initializeExpenses(other,'studio');assert.equal(other.exec('SELECT count(*) FROM expense_categories')[0].values[0][0],0);
 console.log('Expense unit QA passed: additive legacy migration, nine paper variants, required types, dates and amounts, immutable original ownership/source, linked-record protection and before/after audit.');
})().catch(e=>{console.error(e);process.exitCode=1;});
