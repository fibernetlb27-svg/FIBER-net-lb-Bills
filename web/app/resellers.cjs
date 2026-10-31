function initializeResellers(db) {
  db.run(`CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const columns=db.exec("PRAGMA table_info(fibernetlb_bills)")[0].values;
  if (!columns.some(column=>column[1]==="reseller_id")) db.run("ALTER TABLE fibernetlb_bills ADD COLUMN reseller_id INTEGER REFERENCES resellers(id)");
}
module.exports={initializeResellers};
