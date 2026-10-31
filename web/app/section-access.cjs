const MAIN_AREAS = [
  { id: "main-expenses", name: "Company Expenses", icon: "expenses", kind: "area", view: "expenses", color: "amber" },
  { id: "main-attendance", name: "Employee Attendance", icon: "attendance", kind: "area", view: "attendance", color: "indigo" }
];

function query(db, sql, params = []) {
  const statement = db.prepare(sql);
  try { statement.bind(params); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
}

class SectionAccess {
  constructor(databases, sections, persist, backup) {
    this.databases = databases; this.sections = [...sections.filter(s => s.id !== "main"), ...MAIN_AREAS];
    this.persist = persist; this.backup = backup;
  }
  get root() { return this.databases.get("main").db; }
  initialize() {
    const needsMigration = [...this.databases.values()].some(entry => !query(entry.db, "PRAGMA table_info(users)").some(column => column.name === "account_key"));
    if (needsMigration) this.backup("pre-section-access");
    this.root.run("CREATE TABLE IF NOT EXISTS user_workspace_access (account_key TEXT PRIMARY KEY, section_ids TEXT NOT NULL, origin TEXT NOT NULL)");
    this.root.run("CREATE TABLE IF NOT EXISTS staff_account_deletions(account_key TEXT PRIMARY KEY,username TEXT NOT NULL,full_name TEXT NOT NULL,deleted_at TEXT NOT NULL,deleted_by TEXT NOT NULL,actor_key TEXT NOT NULL)");
    for (const [id, entry] of this.databases) {
      if (!query(entry.db, "PRAGMA table_info(users)").some(column => column.name === "account_key")) entry.db.run("ALTER TABLE users ADD COLUMN account_key TEXT");
      for (const user of query(entry.db, "SELECT * FROM users")) {
        let key = user.account_key;
        if (!key) {
          const master = id === "main" ? user : query(this.root, "SELECT * FROM users WHERE username = ? AND password_hash = ? AND password_salt = ?", [user.username, user.password_hash, user.password_salt])[0];
          key = master ? `main:${master.id}` : `${id}:${user.id}`;
          entry.db.run("UPDATE users SET account_key = ? WHERE id = ?", [key,user.id]);
        }
        const origin = key.slice(0, key.lastIndexOf(":"));
        const defaults = origin === "main" ? (user.role === "attendance_operator" ? ["main-attendance"] : this.sections.map(s => s.id)) : [origin];
        this.root.run("INSERT OR IGNORE INTO user_workspace_access (account_key, section_ids, origin) VALUES (?,?,?)", [key, JSON.stringify(defaults), origin]);
      }
      this.persist(entry);
    }
    this.persist(this.databases.get("main"));
    this.reconcileLegacyRoles();
  }
  copies(key) {
    return [...this.databases].flatMap(([id,entry]) => query(entry.db,"SELECT * FROM users WHERE account_key=?",[key]).map(user=>({id,entry,user})));
  }
  roleConflict(key) { return new Set(this.copies(key).map(copy=>copy.user.role)).size > 1; }
  reconcileLegacyRoles() {
    // Old releases allowed a cashier clone to remain Admin in another business.
    // Migrate to the least privileged existing role, never promote a stale clone.
    const ranks=["attendance_operator","viewer","support","cashier","manager","admin"];
    this.root.run("CREATE TABLE IF NOT EXISTS staff_role_reconciliations(account_key TEXT PRIMARY KEY,roles_json TEXT NOT NULL,chosen_role TEXT NOT NULL,status TEXT NOT NULL,recorded_at TEXT NOT NULL)");
    const pending=query(this.root,"SELECT account_key FROM user_workspace_access").map(row=>{
      const copies=this.copies(row.account_key),{user,policy}=this.master(row.account_key);
      const roles=[...new Set(copies.map(copy=>copy.user.role))];
      return {key:row.account_key,copies,user,policy,roles,chosen:roles.sort((a,b)=>ranks.indexOf(a)-ranks.indexOf(b))[0]};
    }).filter(row=>row.roles.length>1);
    if(!pending.length)return;
    if(pending.some(row=>!query(this.root,"SELECT account_key FROM staff_role_reconciliations WHERE account_key=?",[row.key]).length))this.backup("before-global-staff-roles");
    const safeRootAdmin=query(this.root,"SELECT * FROM users WHERE active=1 AND role='admin'").some(user=>!pending.some(row=>row.key===user.account_key&&row.chosen!=="admin"));
    for(const row of pending){
      const blocked=row.policy.origin==="main"&&row.user.active&&row.user.role==="admin"&&!safeRootAdmin;
      this.root.run("INSERT OR REPLACE INTO staff_role_reconciliations VALUES(?,?,?,?,?)",[row.key,JSON.stringify(row.copies.map(copy=>({workspace:copy.id,role:copy.user.role}))),row.chosen,blocked?"review-required":"restricted",new Date().toISOString()]);
      if(blocked)continue; // Keep Main recovery access; deny business switching until reviewed.
      const origin=this.databases.get(row.policy.origin);
      origin.db.run("UPDATE users SET role=? WHERE account_key=?",[row.chosen,row.key]);
      if(row.chosen==="attendance_operator")this.root.run("UPDATE user_workspace_access SET section_ids=? WHERE account_key=?",[JSON.stringify(row.policy.origin==="main"?["main-attendance"]:[]),row.key]);
      this.persist(origin);this.syncMaster(row.key);
    }
    this.persist(this.databases.get("main"));
  }
  key(user, workspaceId) {
    return user?.account_key || user?.accountKey || query(this.databases.get(workspaceId).db, "SELECT account_key FROM users WHERE id = ?", [user?.id ?? -1])[0]?.account_key;
  }
  isDeleted(key) { return Boolean(query(this.root,"SELECT account_key FROM staff_account_deletions WHERE account_key=?",[key||""])[0]); }
  assertUsernameAvailable(username,key=null) {
    for(const {db}of this.databases.values())if(query(db,'SELECT account_key FROM users WHERE username=?',[username]).some(user=>user.account_key!==key))throw Error('That username already belongs to another application account. Deleted usernames remain reserved.');
  }
  ids(user, workspaceId) {
    const record = query(this.root, "SELECT section_ids FROM user_workspace_access WHERE account_key = ?", [this.key(user,workspaceId) || ""])[0];
    try { return record ? JSON.parse(record.section_ids) : []; } catch { return []; }
  }
  permitted(user, workspaceId) {
    if (!user || !user.active) return false;
    const key = this.key(user,workspaceId);
    if(this.isDeleted(key))return false;
    const policy = query(this.root, "SELECT origin FROM user_workspace_access WHERE account_key = ?", [key || ""])[0];
    if (!policy) return false;
    const origin = this.databases.get(policy.origin);
    const master = origin && query(origin.db, "SELECT active FROM users WHERE account_key = ?", [key])[0];
    if (!master?.active) return false;
    return workspaceId === "main" || this.ids(user,workspaceId).includes(workspaceId);
  }
  validate(ids) {
    if (!Array.isArray(ids) || ids.some(id => !this.sections.some(s => s.id === id))) throw new Error("Choose valid business sections.");
    return [...new Set(ids)];
  }
  attach(user, workspaceId, ids) {
    const key = user.account_key || `${workspaceId}:${user.id}`;
    const entry = this.databases.get(workspaceId);
    entry.db.run("UPDATE users SET account_key = ? WHERE id = ?", [key,user.id]);
    const defaults = workspaceId === "main" ? (user.role === "attendance_operator" ? ["main-attendance"] : this.sections.map(s => s.id)) : [workspaceId];
    this.root.run("INSERT OR IGNORE INTO user_workspace_access (account_key,section_ids,origin) VALUES (?,?,?)", [key,JSON.stringify(defaults),workspaceId]);
    this.persist(entry); this.persist(this.databases.get("main"));
    if (ids !== undefined) this.assign(key,ids);
    return key;
  }
  master(key) {
    const policy = query(this.root, "SELECT * FROM user_workspace_access WHERE account_key = ?", [key])[0];
    const entry = policy && this.databases.get(policy.origin);
    const user = entry && query(entry.db, "SELECT * FROM users WHERE account_key = ?", [key])[0];
    if (!user) throw new Error("The user account was not found.");
    return { policy, user };
  }
  assign(key, ids) {
    if(this.isDeleted(key))throw Error("This application user was deleted. Its historical records are retained, but access cannot be restored.");
    const chosen = this.validate(ids), { policy, user } = this.master(key);
    if (policy.origin === "main" && user.role === "admin" && user.active && chosen.length !== this.sections.length) throw new Error("Main administrators must retain access to all sections.");
    if (user.role === "attendance_operator" && chosen.some(id => id !== "main-attendance")) throw new Error("Attendance Operators can access Employee Attendance only.");
    if (policy.origin !== "main" && chosen.some(id => id.startsWith("main-"))) throw new Error("Main-office access requires an account created in the main dashboard.");
    const targets = chosen.filter(id => this.databases.has(id));
    for (const id of targets) {
      const collision = query(this.databases.get(id).db, "SELECT account_key FROM users WHERE username = ?", [user.username])[0];
      if (collision && collision.account_key !== key) throw new Error(`The username already belongs to another account in ${this.sections.find(s => s.id === id).name}.`);
    }
    this.root.run("UPDATE user_workspace_access SET section_ids = ? WHERE account_key = ?", [JSON.stringify(chosen),key]);
    for (const id of targets) {
      const entry = this.databases.get(id);
      if (!query(entry.db, "SELECT id FROM users WHERE account_key = ?", [key])[0]) {
        entry.db.run("INSERT INTO users (username,full_name,password_hash,password_salt,role,active,account_key) VALUES (?,?,?,?,?,?,?)", [user.username,user.full_name,user.password_hash,user.password_salt,user.role,user.active,key]);
        this.persist(entry);
      }
    }
    this.persist(this.databases.get("main"));
    return chosen;
  }
  syncMaster(key) {
    const { user, policy } = this.master(key);
    for (const [id, entry] of this.databases) {
      if (id === policy.origin) continue;
      const clone = query(entry.db, "SELECT id FROM users WHERE account_key = ?", [key])[0];
      if (clone) {
        entry.db.run("UPDATE users SET username=?,full_name=?,password_hash=?,password_salt=?,role=?,active=? WHERE account_key=?", [user.username,user.full_name,user.password_hash,user.password_salt,user.role,user.active,key]);
        this.persist(entry);
      }
    }
  }
  updateAccount(key, values, ids) {
    if(this.isDeleted(key))throw Error("This application user was deleted and cannot be edited.");
    const {user,policy}=this.master(key),origin=this.databases.get(policy.origin);
    if(values.username!==user.username)this.assertUsernameAvailable(values.username,key);
    if(user.role==="admin"&&user.active&&(values.role!=="admin"||!values.active)) {
      const admins=query(origin.db,"SELECT * FROM users WHERE role='admin' AND active=1").filter(admin=>!this.roleConflict(admin.account_key));
      if(!admins.some(admin=>admin.account_key!==key))throw Error("At least one active administrator is required in the account's home dashboard. Create another administrator before changing the last one.");
    }
    const chosen=ids===undefined&&policy.origin==='main'&&values.role==='admin'&&values.active?this.sections.map(section=>section.id):this.validate(ids===undefined?this.ids(user,policy.origin):ids);
    if(policy.origin==='main'&&values.role==='admin'&&values.active&&chosen.length!==this.sections.length)throw Error("Main administrators must retain access to all sections.");
    if(policy.origin!=='main'&&chosen.some(id=>id.startsWith('main-')))throw Error("Main-office access requires an account created in the main dashboard.");
    if(values.role==="attendance_operator"&&chosen.some(id=>id!=="main-attendance"))throw Error("Attendance Operators can access Employee Attendance only. Set their role and access from Main.");
    for(const {entry} of this.copies(key)) {
      const collision=query(entry.db,"SELECT account_key FROM users WHERE username=?",[values.username])[0];
      if(collision&&collision.account_key!==key)throw Error("That username belongs to another account in a linked section.");
    }
    for(const id of chosen.filter(id=>this.databases.has(id))){
      const collision=query(this.databases.get(id).db,"SELECT account_key FROM users WHERE username=?",[values.username])[0];
      if(collision&&collision.account_key!==key)throw Error("That username belongs to another account in a linked section.");
    }
    origin.db.run("UPDATE users SET username=?,full_name=?,role=?,active=? WHERE account_key=?",[values.username,values.fullName,values.role,values.active?1:0,key]);
    if(values.passwordRecord)origin.db.run("UPDATE users SET password_hash=?,password_salt=? WHERE account_key=?",[values.passwordRecord.hash,values.passwordRecord.salt,key]);
    this.persist(origin);this.syncMaster(key);this.assign(key,chosen);
    this.root.run("UPDATE staff_role_reconciliations SET chosen_role=?,status='admin-reviewed',recorded_at=? WHERE account_key=?",[values.role,new Date().toISOString(),key]);
    this.persist(this.databases.get("main"));
  }
  removeAccount(key, actorKey, actorName, confirmation) {
    const {user,policy}=this.master(key);
    if(key===actorKey)throw Error("You cannot delete your own signed-in account. Sign in with another administrator.");
    if(confirmation!==user.username)throw Error("Type the exact username to confirm deleting this application account.");
    if(this.isDeleted(key))return {deleted:true,accountKey:key,username:user.username,historyKept:true};
    const origin=this.databases.get(policy.origin);
    if(user.active&&user.role==='admin'){
      const remaining=query(origin.db,"SELECT account_key FROM users WHERE role='admin' AND active=1").filter(row=>row.account_key!==key&&!this.isDeleted(row.account_key)&&!this.roleConflict(row.account_key));
      if(!remaining.length)throw Error("At least one active administrator is required in the account's home dashboard. Create another administrator before deleting the last one.");
    }
    // Keep IDs and transaction ownership intact; delete login/access, not finances.
    this.backup('before-delete-app-user');
    const entries=[...new Set([this.databases.get('main'),...this.copies(key).map(copy=>copy.entry)])];
    for(const entry of entries)entry.db.run('BEGIN TRANSACTION');
    try{
      for(const entry of entries)entry.db.run('UPDATE users SET active=0 WHERE account_key=?',[key]);
      this.root.run('UPDATE user_workspace_access SET section_ids=? WHERE account_key=?',['[]',key]);
      this.root.run('INSERT INTO staff_account_deletions VALUES(?,?,?,?,?,?)',[key,user.username,user.full_name,new Date().toISOString(),actorName,actorKey]);
      for(const entry of entries)entry.db.run('COMMIT');
    }catch(error){for(const entry of entries){try{entry.db.run('ROLLBACK');}catch{}}throw error;}
    for(const entry of entries)this.persist(entry);
    return {deleted:true,accountKey:key,username:user.username,historyKept:true};
  }
  forWorkspace(user,workspaceId) {
    const key=user.account_key || user.accountKey;
    const {policy,user:master}=this.master(key);
    const conflict=this.roleConflict(key);
    if(conflict&&workspaceId!=="main")throw new Error("This account has conflicting legacy staff roles. A Main administrator must save its intended global role in Users before opening a business.");
    const local=query(this.databases.get(workspaceId).db,"SELECT * FROM users WHERE account_key=?",[key])[0];
    const selected=workspaceId==="main" && policy.origin!=="main" ? {...master,role:"section_user",source_role:master.role} : local&&{...local,username:master.username,full_name:master.full_name,role:master.role,active:master.active,role_review_required:conflict};
    if(!selected || !this.permitted(selected,workspaceId))throw new Error("Your administrator has not granted an active login for this section.");
    return selected;
  }
  mainLogin(username,password,matches) {
    const rootUser=query(this.root,"SELECT * FROM users WHERE username=?",[username])[0];
    if(rootUser?.active && matches(password,rootUser.password_salt,rootUser.password_hash))return this.forWorkspace(rootUser,"main");
    const candidates=[];
    for(const policy of query(this.root,"SELECT account_key FROM user_workspace_access WHERE origin <> 'main'")) {
      const {user}=this.master(policy.account_key);
      if(user.username===username && user.active && matches(password,user.password_salt,user.password_hash))candidates.push(user);
    }
    if(candidates.length>1)throw new Error("More than one account uses this username and password. Ask the administrator to give them unique usernames.");
    if(!candidates.length)throw new Error("Incorrect username or password.");
    return this.forWorkspace(candidates[0],"main");
  }
  roster(workspaceId) {
    const seen = new Set(), list = [];
    const sourceIds = workspaceId === "main" ? [...this.databases.keys()] : [workspaceId];
    for (const id of sourceIds) for (const user of query(this.databases.get(id).db, "SELECT * FROM users ORDER BY full_name COLLATE NOCASE")) {
      if (seen.has(user.account_key)||this.isDeleted(user.account_key)) continue;
      seen.add(user.account_key);
      const master=this.master(user.account_key).user;
      list.push({ id:user.id, username:master.username, fullName:master.full_name, role:master.role, active:Boolean(master.active), createdAt:user.created_at, accountKey:user.account_key, originWorkspaceId:user.account_key.slice(0,user.account_key.lastIndexOf(":")), allowedSections:this.ids(user,id), roleReviewRequired:this.roleConflict(user.account_key) });
    }
    return list;
  }
}

module.exports = { SectionAccess, MAIN_AREAS };
