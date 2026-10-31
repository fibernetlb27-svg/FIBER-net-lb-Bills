'use strict';
// Accounting behavior extracted from desktop 1.45.3, SHA-256 9756baca022fc00623932dc05c77ac2395823e70cd301aba087a46dbe71be111.
// No Electron imports, native windows, HTTP listeners, or global module interception.
const pathForRuntime=require('node:path');
const fsForRuntime=require('node:fs');
const {DATABASES:REQUIRED_DATABASES}=require('./backup-archive.cjs');
const {promisify}=require('node:util');
const derivePassword=promisify(require('node:crypto').scrypt);
const activeDirectories=new Set();

async function createBackend({dataDirectory,version='0.1.0',wasmPath,secrets,initialize=false,providersEnabled=false,sessionClock=Date.now}={}){
 if(typeof dataDirectory!=='string'||!pathForRuntime.isAbsolute(dataDirectory))throw Error('An explicit absolute private dataDirectory is required.');
 initialize=initialize===true;providersEnabled=providersEnabled===true;
 dataDirectory=pathForRuntime.resolve(dataDirectory);
 const dataKey=process.platform==='win32'?dataDirectory.toLowerCase():dataDirectory;
 if(activeDirectories.has(dataKey))throw Error('This data directory already has an active backend writer.');
 if(!initialize){
  const missing=REQUIRED_DATABASES.filter(name=>{try{return !fsForRuntime.statSync(pathForRuntime.join(dataDirectory,name)).isFile();}catch{return true;}});
  if(missing.length)throw Error('Production startup requires all seven business databases. Missing: '+missing.join(', '));
 }
 fsForRuntime.mkdirSync(dataDirectory,{recursive:true,mode:0o700});
 const lockPath=pathForRuntime.join(dataDirectory,'.fibernetlb-web.lock'),lockValue=JSON.stringify({pid:process.pid,instance:require('node:crypto').randomUUID()});
 try{fsForRuntime.writeFileSync(lockPath,lockValue,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw Error('This data directory has a backend writer lock. Stop its server before opening the same files.');throw error;}
 activeDirectories.add(dataKey);
 const safeStorage=secrets||{isEncryptionAvailable:()=>false,encryptString(){throw Error('Protected server secrets are not configured.');},decryptString(){throw Error('Protected server secrets are not configured.');}};
 const providerFetch=providersEnabled?globalThis.fetch:async()=>{throw new (require('./proradius-api.cjs').PortalError)('External provider access is disabled for this server.',false);};
 let closed=false;
 const assertOpen=()=>{if(closed)throw Error('The accounting backend is closed.');};
 let releaseResources=()=>{};
 const releaseLock=()=>{try{if(fsForRuntime.readFileSync(lockPath,'utf8')===lockValue)fsForRuntime.unlinkSync(lockPath);}catch(error){if(error.code!=='ENOENT')throw error;}};
 try{
const {scopedReadSql,scopedDatabase,needsActivityMigration,initializeActivity,actorUser}=require('./user-activity.cjs');
const {whatsappReceipt,validateWhatsAppUrl}=require('./receipt-sharing.cjs');
const {BackupManager}=require('./backup-manager.cjs');
const {OPTIONAL:BACKUP_CONFIG_FILES}=require('./backup-archive.cjs');
const {PAPER_CATEGORIES,needsExpenseMigration,initializeExpenses,expenseInput,expenseRecord,requireCategory,updateExpense}=require('./expense-management.cjs');
const ExpenseFundingMonths=require('./expense-funding-months.cjs');
const OptionalWhishFees=require('./optional-whish-fees.cjs');
const ConsolidatedFinance=require('./consolidated-finance.cjs');
const EmployeeDashboard=require('./employee-dashboard.cjs');
const Bandwidth=require('./bandwidth-accounting.cjs');
const BandwidthPaymentService=require('./bandwidth-payments.cjs');
const BandwidthSpending=require('./bandwidth-spending.cjs');
const FixedMonthlyService=require('./fixed-monthly-payments.cjs');
const FixedMonthlyCategories=require('./fixed-monthly-categories.cjs');
const FixedMonthlySpending=require('./fixed-monthly-spending.cjs');
const FixedMonthlyDashboard=require('./fixed-monthly-dashboard.cjs');
const CompanyDebtService=require('./company-debts.cjs');
const BankService=require('./bank-accounts.cjs');
const MonthClosingService=require('./month-closing.cjs');
const {MonthClosingAll}=require('./month-closing-all.cjs');
const MonthOpeningCustody=require('./month-opening-custody.cjs');
const AdminTransferService=require('./admin-money-transfers.cjs');
const ResellerCarryCustody=require('./reseller-carry-custody.cjs');
const StickyNotesService=require('./sticky-notes.cjs');
const CompanyDebtSpending=require('./company-debt-spending.cjs');
const MainOfficeSummary=require('./main-office-summary.cjs');
const ResellerCollectedRevenue=require('./reseller-collected-revenue.cjs');
const {createAdminCatalog}=require('./admin-catalog.cjs');
const {createAdminReceivables}=require('./admin-receivables.cjs');
const {createWarehouse}=require('./admin-warehouse.cjs');
const {createBridge:createWarehouseBridge}=require('./warehouse-bridge.cjs');
const WarehouseAccounting=require('./warehouse-accounting.cjs');
const InvoiceVoidService=require('./invoice-voids.cjs');
const SharedMaintenance=require('./shared-maintenance.cjs');
const MaintenanceFunding=require('./maintenance-funding.cjs');
const FundedStockPurchases=require('./funded-stock-purchases.cjs');
let sharedMaintenance,fundedStockPurchases;
let adminWarehouse,warehouseBridge,warehouseDeferredReason='';
let invoiceVoids;
let bandwidthPayments;
let fixedMonthlyPayments;
let fixedMonthlyCategories;
let companyDebts;
let bankAccounts;
let monthClosing,monthClosingAll;
let adminMoneyTransfers,stickyNotes;
const MONTH_CLOSING_CHANNELS=new Set(['finance:closeMonthPreview','finance:commitMonthClose','finance:closeMonth','finance:closeMonthStatus','finance:resumeMonthClose','finance:pendingMonthClose','finance:closeMonthsPreview','finance:commitMonthsClose','finance:closeMonthsStatus','finance:resumeMonthsClose']);
const BANDWIDTH_GUARDED_WRITES=new Set(['workspace:reset','users:update','users:updateAccess','users:delete','drawer:setBalance','sales:create','purchases:create','purchases:update','purchases:delete','expenses:create','expenses:update','expenses:delete','bills:create','bills:delete','bills:savePortal','bills:saveRenew','bills:saveFreeRenewal','bills:reset','telecomPayments:create','telecomPayments:delete','debts:pay','debts:refund','finance:closeMonth','finance:handover','finance:walletMove','finance:endDay','resellers:fund','resellers:refund','resellers:payBill','resellers:cancelCollection','resellers:reconcileWallets','resellers:correctCollectedWallets','whish:save']);
let backupManager;
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { AsyncLocalStorage } = require("node:async_hooks");
const { WORKSPACES, RESET_TABLES, workspace, combineReports } = require("./workspaces.cjs");
const { SectionAccess, MAIN_AREAS } = require("./section-access.cjs");

let database;
let activityDatabase;
let databasePath;
const requestContext = new AsyncLocalStorage();
const defaultSession = { workspaceId: "main", user: null, remoteToken: null };
const workspaceDatabases = new Map();
let sectionAccess;
let staffPermissions;
const StaffCapabilities=require('./src/staff-capabilities.js');
const {StaffPermissions}=require('./staff-permissions.cjs');
const {needsSupportRole,migrateSupportRole}=require('./staff-role-schema.cjs');
const SupportLedger=require('./support-ledger.cjs');
const ResellerAccounting=require('./reseller-accounting.cjs');
const {ResellerFundingService,resellerBalanceForRole}=require('./reseller-funding-service.cjs');
const ResellerCollections=require('./reseller-collections.cjs');
const ResellerWalletReconciliation=require('./reseller-wallet-reconciliation.cjs');
const ResellerAdminWalletCorrections=require('./reseller-admin-wallet-corrections.cjs');
let resellerFunding,resellerCollections,resellerWalletReconciliation,resellerAdminWalletCorrections;
let supportAccountingReady=false;
const whishReceiptPolicyStatus=new Map();
const whishPolicyPendingSaves=new Set();
let refreshingWhishReceiptPolicy=false;
function activityUser(){const user=currentUser();return user?{...user,financial_ownership:supportAccountingReady}:user;}
let paymentLedger;
const {PaymentLedger,initializePayments}=require("./payment-ledger.cjs");
const Whish=require('./whish-destinations.cjs');
const Finance=require('./finance-ledger.cjs');
const ReceiptFees=require('./whish-receipt-fees.cjs');
const WalletGross=require('./whish-wallet-gross.cjs');
const { initializeResellers } = require("./resellers.cjs");
const { PortalSettings, ProradiusApi } = require("./proradius-api.cjs");
const { initializeRenewals, RenewalLedger, PlanChangeLedger,portalBillCost,LIVE_COST_SOURCE } = require("./internet-renewals.cjs");
const { initializePortalOperations, PortalOperationLedger } = require("./portal-operations.cjs");
const { matchPortalPlan, matchInternetBundle } = require("./src/bill-plan.js");
const {beirutDate,internetBillPricing,retailSelection,verifyRetailSelection,retailDescription,lateRenewalPolicy}=require('./src/internet-pricing.js');
const {freeRenewalInput}=require('./free-renewals.cjs');
const {profitBreakdown,profitBreakdownCsv}=require("./profit-breakdown.cjs");
const {planChangePricing}=require("./plan-change-pricing.cjs");
const {initializeBillReset,billResetPreview,billResetEpoch,resetBills,activeReceiptSql}=require("./bill-reset.cjs");
const {starterExpiry,registrationInput,registrationBillCost,initializeCustomerRegistration,installationRows,installationReport,installationCsv}=require('./customer-registration.cjs');
let portalApi, renewalLedger, planLedger, operationLedger;
const portalQuotes=new Map();
const customerForms=new Map();
const PORTAL_ASYNC_CHANNELS = ["bills:saveFreeRenewal","bills:receiptCredentials","portal:customerResellers","portal:customerOptions","portal:createCustomer","portal:lookup", "portal:search", "portal:resellers", "portal:resolvePlan", "portal:quoteChange", "portal:applyChange", "portal:resolveOperation", "resellers:portalList", "resellers:addMoney", "bills:savePortal", "bills:saveRenew", "bills:renew"];
PORTAL_ASYNC_CHANNELS.push('resellers:accounts','resellers:fund','resellers:refund','resellers:importPreview','resellers:importCharges');
// Local collection journals also await durable cross-section saves; no portal action.
PORTAL_ASYNC_CHANNELS.push('resellers:payBill','resellers:cancelCollection');
PORTAL_ASYNC_CHANNELS.push('resellers:reconcileWallets','resellers:resumeWalletReconciliation');
PORTAL_ASYNC_CHANNELS.push('resellers:correctCollectedWallets','resellers:resumeWalletCorrection');
PORTAL_ASYNC_CHANNELS.push('bandwidth:pay','bandwidth:resume');
PORTAL_ASYNC_CHANNELS.push(...['overview','ensureMonth','saveTemplate','freeze','sources','preview','pay','previewReversal','reverse','status','resume','pending'].map(name=>'fixedMonthly:'+name));
PORTAL_ASYNC_CHANNELS.push(...['categoryOverview','saveCategory','assignCategory','categoryStatus','categoryResume','categoryPending'].map(name=>'fixedMonthly:'+name));
PORTAL_ASYNC_CHANNELS.push(...['overview','create','assignBusiness','assignBusinesses','addMonthly','sources','preview','pay','status','resume','pending'].map(name=>'companyDebts:'+name));
PORTAL_ASYNC_CHANNELS.push(...['overview','sources','preview','transfer','status','resume','pending'].map(name=>'bank:'+name));
PORTAL_ASYNC_CHANNELS.push(...MONTH_CLOSING_CHANNELS);
PORTAL_ASYNC_CHANNELS.push(...['sources','preview','transfer','status','resume','pending','history'].map(method=>'adminTransfers:'+method));
PORTAL_ASYNC_CHANNELS.push(...['list','save','remove','restore','status','resume'].map(method=>'notes:'+method));
// This shortcut delegates the existing durable local Resellers collection.
PORTAL_ASYNC_CHANNELS.push('adminReceivables:payBill');
PORTAL_ASYNC_CHANNELS.push('warehouse:create','warehouse:update','warehouse:purchase','warehouse:setOffer','warehouse:checkout','warehouse:collect','warehouse:resume');
PORTAL_ASYNC_CHANNELS.push('invoiceVoids:preview','invoiceVoids:remove','invoiceVoids:resume');
PORTAL_ASYNC_CHANNELS.push(...['list','save','checkoutOptions','checkout','status','pending','resume'].map(name=>'maintenance:'+name));
PORTAL_ASYNC_CHANNELS.push(...['options','preview','purchase','status','pending','resume','history'].map(name=>'stockPurchases:'+name));
function activeSession() { return requestContext.getStore() || defaultSession; }
function currentUser() { return activeSession().user; }
function activeWorkspace() { return workspace(activeSession().workspaceId); }
function invalidateReceiptAuthorization(session){if(session)session.receiptAuthEpoch=(Number.isSafeInteger(session.receiptAuthEpoch)?session.receiptAuthEpoch:0)+1;}
const hostHandlers=new Map();
function registerIpc(channel,handler){hostHandlers.set(channel,handler);}
const networkConfig={mode:"server"};

const localHandlers = new Map();
const serverSessions = new Map();
const NETWORK_PORT = 3210;
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const UPDATE_DOWNLOAD_LIMIT = 1_000_000_000;
const GITHUB_API_VERSION = "2022-11-28";
const UPDATE_ASSET_PATTERN = /^FIBER-net-lb-bills-Update-(\d+\.\d+\.\d+)-x64\.exe$/i;
const PAYMENT_METHODS = ["Cash", "Whish Money", "Unpaid"];
const USD_TO_LBP = 90000;
const PrintingPricing = require("./src/printing-pricing.js");
const PRODUCT_CURRENCIES = ["USD", "LBP"];
const PRINT_SIZES = ["A5", "A4", "A3"];
const PRINT_SERVICES = ["bw", "color", "doubleBw", "doubleColor", "boundColor", "boundBw", "canson", "sticker"];
const FIBERNETLB_ACCOUNT_PREFIX = "fibernetlb";
const DEFAULT_PRINT_PRICE_TABLE = {
  A5: { bw: 10000, color: 15000, doubleBw: 20000, doubleColor: 25000, boundColor: 50000, boundBw: 40000, canson: 0, sticker: 50000 },
  A4: { bw: 20000, color: 30000, doubleBw: 35000, doubleColor: 40000, boundColor: 100000, boundBw: 80000, canson: 100000, sticker: 100000 },
  A3: { bw: 40000, color: 60000, doubleBw: 60000, doubleColor: 80000, boundColor: 150000, boundBw: 110000, canson: 200000, sticker: 150000 }
};
const DEFAULT_EXPENSE_CATEGORIES = ["Product purchases", "Internet backbone", "Electricity", "Rent", "Payroll", "Fuel", "Maintenance", "Marketing", "Other"];
const FIBERNETLB_BUNDLES = [
  { code: "NET-6GB", name: "6GB Internet", serviceType: "Internet", allowance: "6GB", price: 20, sortOrder: 10 },
  { code: "NET-8GB", name: "8GB Internet", serviceType: "Internet", allowance: "8GB", price: 25, sortOrder: 20 },
  { code: "NET-10GB", name: "10GB Internet", serviceType: "Internet", allowance: "10GB", price: 30, sortOrder: 30 },
  { code: "NET-12GB", name: "12GB Internet", serviceType: "Internet", allowance: "12GB", price: 40, sortOrder: 40 },
  { code: "NET-14GB", name: "14GB Internet", serviceType: "Internet", allowance: "14GB", price: 50, sortOrder: 50 },
  { code: "NET-16GB", name: "16GB Internet", serviceType: "Internet", allowance: "16GB", price: 60, sortOrder: 60 },
  { code: "NET-18GB", name: "18GB Internet", serviceType: "Internet", allowance: "18GB", price: 70, sortOrder: 70 },
  { code: "SAT-MONTHLY", name: "Satellite", serviceType: "Satellite", allowance: "Monthly", price: 10, sortOrder: 80 }
];
const TELECOM_REFILLS = [
  { code: "ALFA-1.22", provider: "Alfa", name: "$1.22 recharge", value: 1.22, details: "Credit only", sortOrder: 10, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-3.03", provider: "Alfa", name: "$3.03 recharge", value: 3.03, details: "13 days validity", sortOrder: 20, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-4.50", provider: "Alfa", name: "$4.50 recharge", value: 4.5, details: "Up to 35 days validity", sortOrder: 30, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-7.58", provider: "Alfa", name: "$7.58 recharge", value: 7.58, details: "35 days validity", sortOrder: 40, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-15.15", provider: "Alfa", name: "$15.15 recharge", value: 15.15, details: "65 days validity", sortOrder: 50, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-22.73", provider: "Alfa", name: "$22.73 recharge", value: 22.73, details: "95 days validity", sortOrder: 60, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "ALFA-77.28", provider: "Alfa", name: "$77.28 recharge", value: 77.28, details: "365 days validity", sortOrder: 70, sourceUrl: "https://www.alfa.com.lb/en/prepaid/recharge/alfa-opens-its-new-store-in-bekfaya-" },
  { code: "TOUCH-1.00", provider: "touch / MTC", name: "$1.00 recharge", value: 1, details: "Credit only", sortOrder: 110, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-1.67", provider: "touch / MTC", name: "$1.67 recharge", value: 1.67, price: 2.08, details: "Credit only · price shown in supplied payment reference", sortOrder: 120, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-3.79", provider: "touch / MTC", name: "$3.79 recharge", value: 3.79, price: 4.44, details: "Credit only · price shown in supplied payment reference", sortOrder: 130, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-4.50", provider: "touch / MTC", name: "$4.50 recharge", value: 4.5, price: 5.22, details: "Credit only · price shown in supplied payment reference", sortOrder: 140, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-7.58", provider: "touch / MTC", name: "$7.58 recharge", value: 7.58, price: 8.64, details: "Credit only · price shown in supplied payment reference", sortOrder: 150, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-10.00", provider: "touch / MTC", name: "$10.00 recharge", value: 10, price: 11.33, details: "Credit only · price shown in supplied payment reference", sortOrder: 160, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-15.15", provider: "touch / MTC", name: "$15.15 recharge", value: 15.15, details: "Credit only", sortOrder: 170, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-22.73", provider: "touch / MTC", name: "$22.73 recharge", value: 22.73, details: "Credit only", sortOrder: 180, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" },
  { code: "TOUCH-77.28", provider: "touch / MTC", name: "$77.28 recharge", value: 77.28, details: "Credit only", sortOrder: 190, sourceUrl: "https://payment.touch.com.lb/autoforms/portal/touch/personal/prepaid/ma3ak/tariffs" }
];

const ROLE_PERMISSIONS = {
  section_user: ["dashboard.view","network.configure"],
  admin: ["dashboard.view", "products.read", "products.manage", "products.delete", "sales.create", "expenses.view", "expenses.manage", "purchases.view", "purchases.manage", "reports.view", "users.manage", "customers.manage", "attendance.clock", "attendance.view", "attendance.manage", "bills.view", "bills.create", "bills.manage", "bundles.manage", "telecom.view", "telecom.create", "telecom.manage", "telecomCatalog.manage", "debts.view", "debts.manage", "drawer.view", "drawer.manage", "network.configure", "updates.manage"],
  manager: ["dashboard.view", "products.read", "products.manage", "products.delete", "sales.create", "expenses.view", "expenses.manage", "purchases.view", "purchases.manage", "reports.view", "customers.manage", "attendance.clock", "attendance.view", "attendance.manage", "bills.view", "bills.create", "bills.manage", "telecom.view", "telecom.create", "telecom.manage", "debts.view", "debts.manage", "drawer.view", "drawer.manage", "network.configure"],
  cashier: ["dashboard.view", "products.read", "products.manage", "sales.create", "reports.view", "expenses.view", "customers.manage", "attendance.clock", "bills.view", "bills.create", "telecom.view", "telecom.create", "debts.view", "debts.manage", "drawer.view", "drawer.manage", "network.configure"],
  viewer: ["dashboard.view", "products.read", "expenses.view", "purchases.view", "reports.view", "attendance.view", "bills.view", "telecom.view", "debts.view", "network.configure"],
  attendance_operator: ["attendance.clock"]
};
for(const role of ['admin','manager','cashier'])ROLE_PERMISSIONS[role].push('plans.manage');
ROLE_PERMISSIONS.cashier.push('resellerFunding.manage');
ROLE_PERMISSIONS.support=[...ROLE_PERMISSIONS.cashier];

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function productMoney(value, currency) {
  return currency === "LBP" ? Math.round(Number(value)) : money(value);
}

function productAmountToUsd(value, currency) {
  return money(currency === "LBP" ? Number(value) / USD_TO_LBP : Number(value));
}

function normalizePrintPriceTable(value, { requireAvailable = true } = {}) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  if (!source || typeof source !== "object") source = DEFAULT_PRINT_PRICE_TABLE;
  const table = {};
  let available = 0;
  for (const size of PRINT_SIZES) {
    table[size] = {};
    for (const service of PRINT_SERVICES) {
      const raw = source?.[size]?.[service] ?? DEFAULT_PRINT_PRICE_TABLE[size][service];
      const price = Math.round(Number(raw));
      if (!Number.isFinite(price) || price < 0) throw new Error(`${size} printing prices must be zero or more.`);
      table[size][service] = price;
      if (price > 0) available += 1;
    }
  }
  table.custom = PrintingPricing.normalizeCustom(source.custom);
  available += table.custom.filter(item => item.price > 0).length;
  if (requireAvailable && available === 0) throw new Error("Enter at least one available Printing price.");
  return table;
}

function paymentMethod(value, { allowUnpaid = true } = {}) {
  const method = String(value ?? "Cash").trim();
  const allowed = allowUnpaid ? PAYMENT_METHODS : PAYMENT_METHODS.filter((item) => item !== "Unpaid");
  if (!allowed.includes(method)) throw new Error(`Payment method must be ${allowed.join(" or ")}.`);
  return method;
}
function whishSelection(input,method,previous=undefined){
  return Whish.resolveDestination(workspaceDatabases.get('main').db,method,input?.whishDestinationId??input?.whishDestination?.id,previous);
}
function billWhishSelection(input,method){
  const previous=input.requestId?one('SELECT bill_id FROM bill_requests WHERE request_id=?',[String(input.requestId)]):null;
  const snapshot=whishSelection(input,method,previous?Whish.readSnapshot(database,'bill',previous.bill_id):undefined);
  return snapshot?{whishDestination:snapshot}:{};
}

function localIso(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

function rows(sql, parameters = []) {
  const statement = database.prepare(scopedReadSql(activeReceiptSql(workspaceDatabases.get(activeSession().workspaceId)?.db||database,sql),activityUser()));
  statement.bind(parameters);
  const result = [];
  while (statement.step()) result.push(statement.getAsObject());
  statement.free();
  return result;
}

function one(sql, parameters = []) {
  return rows(sql, parameters)[0] ?? null;
}

function saveDatabase() {
  const selected = workspaceDatabases.get(activeSession().workspaceId);
  const target = selected?.path || databasePath, temporary = `${target}.pending`;
  const descriptor = fs.openSync(temporary,"w",0o600);
  try { writePrivateFile(descriptor,Buffer.from(database.export())); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary,target);
}

function hasPermission(permission) {
  return Boolean(currentUser() && userPermissions(currentUser()).includes(permission));
}

function userPermissions(user) {
  if(user?.activity_inspection)return [...ROLE_PERMISSIONS.viewer,'drawer.view'];
  const settings=staffPermissions?.get(sectionAccess?.key(user,activeSession().workspaceId))||{};
  if (user?.role === "section_user" && ROLE_PERMISSIONS[user.source_role]?.includes("reports.view")) return [...ROLE_PERMISSIONS.section_user, ...(['cashier','support'].includes(user.source_role)&&settings['reports.view']===false?[]:['reports.view'])];
  const permissions = ['cashier','support'].includes(user?.role)?StaffCapabilities.apply(ROLE_PERMISSIONS[user.role],settings):ROLE_PERMISSIONS[user?.role] || [];
  // Users Cashier/Support may browse and sell the Admin catalog, not maintain
  // a second local catalog. Other businesses' non-stock services stay unchanged.
  const restrictProducts=activeWorkspace().id==='main'||activeWorkspace().id==='fiber-users'&&['cashier','support'].includes(user?.role==='section_user'?user.source_role:user?.role);
  return user?.role!=='admin'?permissions.filter(permission=>permission!=='purchases.manage'&&(!restrictProducts||!['products.manage','products.delete'].includes(permission))):permissions;
}

function staffFeatureProfile(user){
  return ['cashier','support'].includes(user?.role)?{...user,featurePermissions:StaffCapabilities.effective(staffPermissions?.get(user.accountKey)||{})}:user;
}
function staffFeatureInput(input,role){
  if(input.featurePermissions===undefined)return undefined;
  if(!['cashier','support'].includes(role))throw new Error('Feature switches apply only to Cashier or Support accounts.');
  return StaffCapabilities.normalize(input.featurePermissions);
}
function saveStaffFeatures(key,value){
  if(value!==undefined)staffPermissions.save(key,value,{key:sectionAccess.key(currentUser(),activeSession().workspaceId),name:currentUser().full_name||currentUser().fullName||currentUser().username});
}

function requireStaffAdmin() {
  requirePermission("users.manage");
  if (currentUser()?.role !== "admin") throw new Error("Only administrators can manage staff users.");
}

function requirePermission(permission) {
  if (!currentUser()) throw new Error("Please sign in to continue.");
  if (!hasPermission(permission)) throw new Error("Your user role does not allow this action.");
}

function requireSectionAccess(user = currentUser(), id = activeSession().workspaceId) {
  const allowed = networkConfig.mode === "client" ? user && (id === "main" || user.allowedSections?.includes(id)) : sectionAccess?.permitted(user,id);
  if (!allowed) throw new Error("Your administrator has not granted access to this business section.");
}

function userAccessInput(input, role, active, existing, origin=activeWorkspace().id) {
  const requested = input.allowedSections === undefined ? existing : sectionAccess.validate(input.allowedSections);
  if (role === "admin" && active && origin === "main") {
    const all = sectionAccess.sections.map(s => s.id);
    if (input.allowedSections !== undefined && all.some(id => !requested.includes(id))) throw new Error("Main administrators must retain access to all sections.");
    return all;
  }
  if (role === "attendance_operator") {
    if (input.allowedSections !== undefined && requested.some(id => id !== "main-attendance")) throw new Error("Attendance Operators can access Employee Attendance only.");
    return origin==='main'?["main-attendance"]:[];
  }
  return requested;
}

function staffAccountTarget(value) {
  const key=typeof value==='string'&&value.includes(':')?value:one('SELECT account_key FROM users WHERE id=?',[Number(value)])?.account_key;
  if(!key)throw Error('User not found.');
  const target=sectionAccess.master(key),actorKey=sectionAccess.key(currentUser(),activeWorkspace().id);
  if(target.policy.origin!==activeWorkspace().id&&!actorKey.startsWith('main:'))throw Error('Only a Main administrator can change a staff account that belongs to another dashboard.');
  if(activeWorkspace().id!=='main'&&!sectionAccess.copies(key).some(copy=>copy.id===activeWorkspace().id))throw Error('This staff account does not belong to this business.');
  return {...target,key,actorKey};
}

function endStaffSessions(key,except=null) {
  for(const [token,session] of serverSessions)if(session.accountKey===key&&token!==except?.sessionToken)serverSessions.delete(token);
  for(const session of [defaultSession])if(session!==except&&(session.user?.account_key===key||session.user?.accountKey===key)){invalidateReceiptAuthorization(session);session.user=null;session.remoteToken=null;}
}

function publicUser(user) {
  if (!user) return null;
  return staffFeatureProfile({
    id: Number(user.id),
    username: user.username,
    fullName: user.full_name ?? user.fullName,
    role: user.role,
    sourceRole: user.role === 'section_user' ? user.source_role : undefined,
    active: Boolean(user.active),
    permissions: userPermissions(user),
    accountKey: sectionAccess?.key(user,activeSession().workspaceId),
    allowedSections: sectionAccess?.ids(user,activeSession().workspaceId) || []
  });
}

function authenticateUser(input,matches=passwordMatches) {
  const username = String(input?.username ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  if(activeSession().workspaceId==="main")return sectionAccess.mainLogin(username,password,matches);
  const local = one("SELECT * FROM users WHERE username = ?", [username]);
  const master=local&&sectionAccess.master(local.account_key).user;
  if (!master || !master.active || username!==master.username || !matches(password, master.password_salt, master.password_hash)) throw new Error("Incorrect username or password.");
  const user=sectionAccess.forWorkspace(local,activeSession().workspaceId);
  requireSectionAccess(user);
  if (user.role === "attendance_operator" && activeSession().workspaceId !== "main") throw new Error("Attendance Operators can sign in to the main attendance screen only.");
  return user;
}

function checkWorkspaceChannel(channel) {

  // LAN sessions are refreshed again after awaited portal work. Internal report reads
  // deliberately use the main administrator, not a section's local role.
  const isWindowSession = activeSession().externalSession || activeSession() === defaultSession;
  if (!channel.startsWith("auth:") && currentUser() && sectionAccess && isWindowSession) {
    let fresh; try { fresh=sectionAccess.forWorkspace(currentUser(),activeSession().workspaceId); } catch { fresh=null; }
    activeSession().user = fresh?.active ? fresh : null;
    if (!fresh?.active) throw new Error("Your session ended. Please sign in again.");
  }
  if (!channel.startsWith("auth:") && currentUser()) {
    const authority=activeSession().consolidatedReadAuthority;
    if(authority){
      // This internal context is created only after Main Admin authorization.
      // It allows historical employee reads, never an employee login or write.
      if(!['reports:summary','reports:dashboard'].includes(channel)||!currentUser().activity_inspection)throw Error('The consolidated employee scope is read-only.');
      const admin=sectionAccess.forWorkspace({account_key:authority},'main');if(!admin?.active||admin.role!=='admin')throw Error('Main administrator access is required for consolidated reports.');requireSectionAccess(admin,activeWorkspace().id);
    }else requireSectionAccess();
  }
  const kind = activeWorkspace().kind;
  if (kind === "main" && currentUser()) {
    const access = sectionAccess.ids(currentUser(),"main");
    if ((channel.startsWith("expenses:") || channel.startsWith("expenseCategories:")) && !access.includes("main-expenses")) throw new Error("Company Expenses access is not assigned to this user.");
    if ((channel.startsWith("attendance:") || channel.startsWith("employees:")) && !access.includes("main-attendance")) throw new Error("Employee Attendance access is not assigned to this user.");
  }
  if ((channel.startsWith("bills:") || channel.startsWith("bundles:")) && !["bills:resetPreview","bills:reset"].includes(channel) && !["main", "internet", "reseller", "satellite"].includes(kind)) throw new Error("Customer payments are not available in this section.");
  if ((channel.startsWith("telecomPayments:") || channel.startsWith("telecomCatalog:")) && !["main", "telecom"].includes(kind)) throw new Error("Mobile and Ogero payments belong to their own section.");
  if ((channel.startsWith("attendance:") || channel.startsWith("employees:")) && kind !== "main") throw new Error("Employee attendance is available in the main dashboard only.");
  if (channel.startsWith("resellers:") && kind !== "reseller") throw new Error("Reseller accounts belong to FIBER net lb Resellers only.");
  if(channel.startsWith('bandwidth:')&&(kind!=='main'||currentUser()?.role!=='admin'))throw Error('Bandwidth Accounting is available only to the Main Office administrator.');
  if(channel.startsWith('fixedMonthly:')&&(kind!=='main'||currentUser()?.role!=='admin'))throw Error('Fixed monthly payments are available only to the Main Office administrator.');
  if(channel.startsWith('companyDebts:')&&(kind!=='main'||currentUser()?.role!=='admin'))throw Error('Company debts are available only to the Main Office administrator.');
  if(channel.startsWith('bank:')&&(kind!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection))throw Error('Bank is available only to the Main Office administrator.');
  if(channel.startsWith('adminTransfers:')&&(kind!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection))throw Error('Admin transfers are available only to the Main Office administrator.');
  if(channel.startsWith('mainOfficePayables:')&&(kind!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection))throw Error('Main Office payment summaries are available only to the Main administrator.');
  if(channel.startsWith('stockPurchases:')&&(kind!=='main'||currentUser()?.role!=='admin'))throw Error('Purchasing Admin stock is available only to Main Admin.');
}

function registerHandler(channel, handler) {
  const guarded = (event, ...args) => {
    checkWorkspaceChannel(channel);
    if(currentUser()&&/^notes:(save|remove|restore|resume)$/.test(channel)){bankAccounts?.assertIdle();monthClosing?.assertIdle();assertCommerceIdle();assertWarehouseIdle();assertInvoiceVoidIdle();assertNoFixedMonthlyPending('main');assertNoBandwidthPending('main');}
    if(currentUser()&&!channel.startsWith('adminTransfers:')&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(warehouse:|invoiceVoids:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|fixedMonthly:|companyDebts:|bank:|maintenance:|stockPurchases:|portal:|bills:|telecomPayments:|backups:|notes:save|notes:remove|notes:restore|notes:resume|updates:rollback)/.test(channel)))adminMoneyTransfers?.assertIdle();
    if(currentUser()&&!MONTH_CLOSING_CHANNELS.has(channel)&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(warehouse:|invoiceVoids:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|fixedMonthly:|companyDebts:|bank:|maintenance:|stockPurchases:|portal:|bills:|telecomPayments:|backups:|updates:rollback)/.test(channel)))monthClosing?.assertIdle();
    if(currentUser()&&!channel.startsWith('bank:')&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(warehouse:|invoiceVoids:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|fixedMonthly:|companyDebts:|maintenance:|stockPurchases:|portal:|bills:|telecomPayments:|backups:|updates:rollback)/.test(channel)))bankAccounts?.assertIdle();
    if(currentUser()&&!/^(maintenance:|stockPurchases:)/.test(channel)&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(warehouse:|invoiceVoids:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|fixedMonthly:|companyDebts:|portal:|bills:|telecomPayments:)/.test(channel)))assertCommerceIdle();
    if(currentUser()&&!/^(fixedMonthly:|companyDebts:)/.test(channel)&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(warehouse:|invoiceVoids:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|portal:|bills:|telecomPayments:|updates:rollback)/.test(channel)))assertNoFixedMonthlyPending('main');
    if(currentUser()&&!channel.startsWith('invoiceVoids:')&&(BANDWIDTH_GUARDED_WRITES.has(channel)||/^(fixedMonthly:|companyDebts:|warehouse:|reports:|finance:|adminReceivables:|adminCatalog:|products:|purchases:|debts:|resellers:|bandwidth:|portal:|bills:|telecomPayments:)/.test(channel)))assertInvoiceVoidIdle();
    if(currentUser()&&(BANDWIDTH_GUARDED_WRITES.has(channel)||['debts:settle','bills:reset','updates:rollback','portal:createCustomer','portal:applyChange','portal:resolvePlan','portal:resumeOperation','portal:resolveOperation','bills:renew','bills:resolveRenewal','resellers:releaseFailed','resellers:resumeWalletReconciliation','resellers:resumeWalletCorrection','resellers:importCharges','finance:payInternetCost','adminReceivables:payBill','bandwidth:createPurchase','bandwidth:pay','bandwidth:resume'].includes(channel)))assertWarehouseIdle();
    if(currentUser()&&['finance:handoverPreview','finance:handover','finance:walletMove','finance:endDayPreview','finance:endDay','finance:closeMonth','resellers:fund','resellers:refund','resellers:collectionPreview','resellers:payBill','resellers:cancelCollection','resellers:releaseFailed','portal:resumeOperation','portal:resolveOperation','workspace:reset','bills:reset'].includes(channel))assertNoWalletReconciliationPending(channel.startsWith('finance:')?String(args[0]?.workspaceId||activeWorkspace().id):activeWorkspace().id);
    if(currentUser()&&BANDWIDTH_GUARDED_WRITES.has(channel)){
      let target=activeWorkspace().id;
      if(channel.startsWith('finance:'))target=String(args[0]?.workspaceId||target);
      if(channel.startsWith('expenses:')){const input=args[channel==='expenses:create'?0:1];target=typeof input==='string'?input:String(input?.workspaceId||target);}
      if(channel.startsWith('users:')||channel==='whish:save'||channel==='workspace:reset')target='main';
      assertNoBandwidthPending(target);
    }
    return handler(event, ...args);
  };
  localHandlers.set(channel, guarded);
}

function validateUserInput(input, { passwordRequired = true } = {}) {
  const fullName = String(input.fullName ?? "").trim();
  const username = String(input.username ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  const role = String(input.role ?? "cashier").toLowerCase();
  if (!fullName || fullName.length>120) throw new Error("Full name is required and must be at most 120 characters.");
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error("Username must be 3–30 letters, numbers, dots, dashes, or underscores.");
    if (!["admin","manager","cashier","support","viewer","attendance_operator"].includes(role)) throw new Error("Choose a valid user role.");
  if ((passwordRequired || password) && password.length < 8) throw new Error("Password must contain at least 8 characters.");
  if(password.length>256)throw new Error("Password must be at most 256 characters.");
  return { fullName, username, password, role, active: input.active === undefined ? true : Boolean(input.active) };
}

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, salt, storedHash) {
  const supplied = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, "hex");
  return stored.length === supplied.length && crypto.timingSafeEqual(stored, supplied);
}

function ean13CheckDigit(firstTwelve) {
  const total = [...firstTwelve].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (total % 10)) % 10);
}

function generateBarcode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = `290${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
    const barcode = `${base}${ean13CheckDigit(base)}`;
    if (!one("SELECT id FROM product_barcodes WHERE barcode = ?", [barcode])) return barcode;
  }
  throw new Error("Could not generate a unique barcode. Please try again.");
}

function validateBarcodes(input) {
  const source = Array.isArray(input.barcodes) ? input.barcodes : [input.barcode, input.additionalBarcodes];
  const cleaned = [...new Set(source.flatMap((value) => String(value ?? "").split(",")).map((value) => value.trim()).filter(Boolean))];
  for (const barcode of cleaned) {
    if (!/^\d{8,14}$/.test(barcode)) throw new Error("Barcodes must contain 8–14 digits.");
  }
  return cleaned.length ? cleaned : [generateBarcode()];
}

function validateProduct(input, existing = null) {
  const name = String(input.name ?? "").trim();
  const sku = String(input.sku ?? "").trim().toUpperCase();
  const category = String(input.category ?? "Other").trim() || "Other";
  const currency = String(input.currency ?? "USD").trim().toUpperCase();
  const categoryKey = category.toLowerCase();
  const isPrinting = categoryKey === "printing";
  const isStudioPhotoService = activeWorkspace().id === 'studio' && categoryKey === 'photos and shooting';
  const trackQuantity = !["printing", "maintenance"].includes(categoryKey) && !isStudioPhotoService;
  const printPriceTable = isPrinting ? normalizePrintPriceTable(input.printPriceTable) : null;
  if (isPrinting && currentUser()?.role !== "admin") {
    const previous = existing && String(existing.category).toLowerCase() === "printing"
      ? normalizePrintPriceTable(existing.print_price_table, { requireAvailable: false }).custom
      : PrintingPricing.normalizeCustom();
    if (JSON.stringify(previous) !== JSON.stringify(printPriceTable.custom)) throw Error("Only an administrator can add, remove or price custom printing types.");
  }
  const cost = Number(input.cost);
  const printingBasePrice = isPrinting ? (currency === "LBP" ? printPriceTable.A4.bw : printPriceTable.A4.bw / USD_TO_LBP) : null;
  const suppliedPrice = isPrinting
    ? printingBasePrice
    : (input.price === undefined || input.price === null || String(input.price).trim() === "" ? null : Number(input.price));
  const suppliedMarkup = Number(input.markup);
  // Photo services never consume inventory. Keep an existing product's dormant
  // stock counts intact rather than erasing them when its category is changed.
  const quantity = trackQuantity ? Number(input.quantity) : isStudioPhotoService ? Number(existing?.quantity ?? 0) : 0;
  const reorderLevel = trackQuantity ? Number(input.reorderLevel ?? 5) : isStudioPhotoService ? Number(existing?.reorder_level ?? 0) : 0;
  if (!name) throw new Error("Product name is required.");
  if (!sku) throw new Error("SKU is required.");
  if (!PRODUCT_CURRENCIES.includes(currency)) throw new Error("Product currency must be USD or LBP.");
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost must be zero or more.");
  if (suppliedPrice !== null && (!Number.isFinite(suppliedPrice) || suppliedPrice < 0)) throw new Error("Selling price must be zero or more.");
  if (suppliedPrice === null && (!Number.isFinite(suppliedMarkup) || suppliedMarkup < 0)) throw new Error("Markup must be zero or more.");
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Quantity must be a whole number.");
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) throw new Error("Reorder level must be a whole number.");
  const price = productMoney(suppliedPrice === null ? cost * (1 + suppliedMarkup / 100) : suppliedPrice, currency);
  if (!isPrinting && price < productMoney(cost, currency)) throw new Error("Selling price cannot be lower than cost price.");
  const markup = cost > 0 ? money(((price - cost) / cost) * 100) : 0;
  const printColorPrice = isPrinting ? productMoney(input.printColorPrice === undefined || String(input.printColorPrice).trim() === "" ? price : Number(input.printColorPrice), currency) : 0;
  const printSinglePrice = isPrinting ? productMoney(Number(input.printSinglePrice ?? 0), currency) : 0;
  const printDoublePrice = isPrinting ? productMoney(Number(input.printDoublePrice ?? input.printDuplexExtra ?? 0), currency) : 0;
  const printNoBindingPrice = isPrinting ? productMoney(Number(input.printNoBindingPrice ?? 0), currency) : 0;
  const printBindingPrice = isPrinting ? productMoney(Number(input.printBindingPrice ?? input.printBindingExtra ?? 0), currency) : 0;
  const printPlainPrice = isPrinting ? productMoney(Number(input.printPlainPrice ?? 0), currency) : 0;
  const printCansonPrice = isPrinting ? productMoney(Number(input.printCansonPrice ?? input.printCansonExtra ?? 0), currency) : 0;
  const printStickerPrice = isPrinting ? productMoney(Number(input.printStickerPrice ?? input.printStickerExtra ?? 0), currency) : 0;
  for (const [label, value] of [["Color printing price", printColorPrice], ["Single-sided price", printSinglePrice], ["Double-sided price", printDoublePrice], ["No-binding price", printNoBindingPrice], ["Thermal binding price", printBindingPrice], ["Plain paper price", printPlainPrice], ["Canson paper price", printCansonPrice], ["Sticker paper price", printStickerPrice]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or more.`);
  }
  return { name, sku, category, currency, cost: productMoney(cost, currency), markup, price, printPriceTable, printColorPrice, printSinglePrice, printDoublePrice, printNoBindingPrice, printBindingPrice, printPlainPrice, printCansonPrice, printStickerPrice, quantity, reorderLevel, trackQuantity, barcodes: validateBarcodes(input) };
}

function printingSaleDetails(product, input) {
  const source = input && typeof input === "object" ? input : {};
  const rawSize = String(source.size ?? "A4");
  const table = normalizePrintPriceTable(product.print_price_table);
  const custom = PrintingPricing.customSelection(table, rawSize);
  if (custom) {
    if (custom.unitPrice <= 0) throw Error(`${custom.description} is not priced yet. Ask an administrator to set its selling price.`);
    return custom;
  }
  const size = rawSize.toUpperCase();
  const service = String(source.service ?? "bw");
  if (!PRINT_SIZES.includes(size)) throw new Error("Choose A5, A4, or A3 paper size.");
  if (!PRINT_SERVICES.includes(service)) throw new Error("Choose a valid Printing service.");
  const unitPrice = Number(table[size][service]);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error(`${size} ${service} printing is not available.`);
  const serviceLabels = { bw: "B/W", color: "Color", doubleBw: "Double-sided B/W", doubleColor: "Double-sided Color", boundColor: "Tejlid / Bound Color", boundBw: "Tejlid / Bound B/W", canson: "Canson / cardboard", sticker: "Transparent / sticker" };
  const options = { size, service };
  return { options, unitPrice: Math.round(unitPrice), currency: "LBP", description: `${size} · ${serviceLabels[service]}` };
}

function normalizeRfid(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function validateEmployee(input) {
  const employeeNo = String(input.employeeNo ?? "").trim().toUpperCase();
  const fullName = String(input.fullName ?? "").trim();
  const jobTitle = String(input.jobTitle ?? "").trim();
  const rfidCard = normalizeRfid(input.rfidCard);
  if (!employeeNo) throw new Error("Employee ID is required.");
  if (!fullName) throw new Error("Employee name is required.");
  if (!jobTitle) throw new Error("Job title is required.");
  if (!/^[A-Z0-9._:-]{3,100}$/.test(rfidCard)) throw new Error("RFID card ID must contain 3–100 letters or numbers.");
  return { employeeNo, fullName, jobTitle, rfidCard, active: input.active === undefined ? true : Boolean(input.active) };
}

function validateBill(input) {
  if (activeWorkspace().kind === "reseller") {
    const amount = Number(input.amount);
    const reseller = one("SELECT * FROM resellers WHERE id = ? AND active = 1",[Number(input.resellerId)]);
    if (!reseller) throw new Error("Choose an active reseller from the list.");
    const customerName = reseller.full_name;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Transfer amount must be greater than zero.");
    const method = paymentMethod(input.paymentMethod);
    const billingPeriod = String(input.billingPeriod || localIso().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(billingPeriod)) throw new Error("Choose a valid billing month.");
    return { resellerId:reseller.id, customerAccount: reseller.username, customerName, phone: reseller.phone, serviceType: "Reseller transfer", billingPeriod, amount: money(amount), paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid", reference: String(input.reference ?? "").trim(), bundleCode: null, bundleName: "Reseller transfer", bundleDetails: "Recorded transfer only", bundlePrice: money(amount), bundleCost: 0,...method==='Whish Money'?billWhishSelection(input,method):{} };
  }
  const accountInput = String(input.customerAccount ?? "").trim();
  const customerAccount = (activeWorkspace().id === "fiber-users" && input.exactPortalAccount === true) || accountInput.toLowerCase().startsWith(FIBERNETLB_ACCOUNT_PREFIX) ? accountInput : `${FIBERNETLB_ACCOUNT_PREFIX}${accountInput}`;
  const customerName = String(input.customerName ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const serviceType = activeWorkspace().kind === "internet" ? "Internet" : activeWorkspace().kind === "satellite" ? "Satellite" : String(input.serviceType ?? "Internet").trim();
  const billingPeriod = String(input.billingPeriod ?? "").trim();
  const amount = Number(input.amount);
  const method = paymentMethod(input.paymentMethod);
  const reference = String(input.reference ?? "").trim();
  if (!accountInput || customerAccount.toLowerCase() === FIBERNETLB_ACCOUNT_PREFIX) throw new Error("Enter the customer username after fibernetlb.");
  if (!customerName) throw new Error("Customer name is required.");
  if (!["Internet", "Satellite", "Internet + Satellite"].includes(serviceType)) throw new Error("Choose a valid service type.");
  const renewalMonths=Number(input.renewalMonths??1);
  if(!Number.isSafeInteger(renewalMonths)||renewalMonths<1||renewalMonths>12||(serviceType!=="Internet"&&renewalMonths!==1))throw Error("Choose 1–12 months for Internet; other services use one month.");
  const requestedBundleCode = String(input.bundleCode ?? "").trim().toUpperCase();
  const satelliteBundle = one("SELECT * FROM fibernetlb_bundles WHERE code = 'SAT-MONTHLY' AND active = 1");
  const selectedBundle = serviceType === "Satellite"
    ? satelliteBundle
    : one("SELECT * FROM fibernetlb_bundles WHERE code = ? AND service_type = 'Internet' AND active = 1", [requestedBundleCode]);
  if (!selectedBundle) throw new Error(serviceType === "Satellite" ? "The satellite bundle is unavailable." : "Choose an active Internet bundle.");
  if (serviceType === "Internet + Satellite" && !satelliteBundle) throw new Error("The satellite bundle is unavailable.");
  if (!/^\d{4}-\d{2}$/.test(billingPeriod)) throw new Error("Choose a valid billing month.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Bill amount must be greater than zero.");
  const listPrice = money((Number(selectedBundle.price) + (serviceType === "Internet + Satellite" ? Number(satelliteBundle.price) : 0))*renewalMonths);
  const bundleCost = money((Number(selectedBundle.cost) + (serviceType === "Internet + Satellite" ? Number(satelliteBundle.cost) : 0))*renewalMonths);
  const bundleName = serviceType === "Internet + Satellite" ? `${selectedBundle.name} + Satellite` : selectedBundle.name;
  const bundleDetails = (serviceType === "Internet + Satellite" ? `${selectedBundle.allowance} data + Satellite` : selectedBundle.allowance)+(renewalMonths>1?` · ${renewalMonths} months`:"");
  const retailPricing=serviceType==='Internet'?retailSelection(input.retailPricing):undefined;
  return { customerAccount, customerName, phone, serviceType, billingPeriod, renewalMonths, amount: money(amount), paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid", reference, bundleCode: selectedBundle.code, bundleName, bundleDetails, bundlePrice: listPrice, bundleCost,...retailPricing?{retailPricing}:{},...method==='Whish Money'?billWhishSelection(input,method):{} };
}

function listBundles() {
  const bundles = rows(`
    SELECT id, code, name, service_type AS serviceType, allowance, price, cost, currency, source_url AS sourceUrl
    , cost_source AS costSource, cost_verified_at AS costVerifiedAt
    FROM fibernetlb_bundles WHERE active = 1 ORDER BY sort_order, id
  `);
  if (hasPermission("bundles.manage") || hasPermission("bills.manage")) return bundles;
  return bundles.map(({ cost: _cost, ...bundle }) => bundle);
}

function listProducts() {
  return rows(`
    SELECT p.id, p.sku, p.name, p.category, p.currency, p.cost, p.markup, p.price, p.quantity, p.track_quantity AS trackQuantity,
           p.print_color_price AS printColorPrice, p.print_single_price AS printSinglePrice,
           p.print_double_price AS printDoublePrice, p.print_no_binding_price AS printNoBindingPrice,
           p.print_binding_price AS printBindingPrice, p.print_plain_price AS printPlainPrice,
           p.print_canson_price AS printCansonPrice, p.print_sticker_price AS printStickerPrice,
           p.print_price_table AS printPriceTableJson,
           p.reorder_level AS reorderLevel, p.created_at AS createdAt, p.updated_at AS updatedAt,
           (SELECT GROUP_CONCAT(ordered_barcodes.barcode, '|')
              FROM (SELECT barcode FROM product_barcodes
                    WHERE product_id = p.id
                    ORDER BY is_primary DESC, id) AS ordered_barcodes) AS barcodeList
    FROM products p ORDER BY p.name COLLATE NOCASE
  `).map((product) => {
    const barcodes = String(product.barcodeList ?? "").split("|").filter(Boolean);
    const currency = PRODUCT_CURRENCIES.includes(product.currency) ? product.currency : "USD";
    const costUsd = productAmountToUsd(product.cost, currency);
    const isPrinting = String(product.category).toLowerCase() === "printing";
    const printPriceTable = isPrinting ? normalizePrintPriceTable(product.printPriceTableJson) : null;
    const price = isPrinting
      ? productMoney(currency === "LBP" ? printPriceTable.A4.bw : printPriceTable.A4.bw / USD_TO_LBP, currency)
      : Number(product.price);
    const priceUsd = productAmountToUsd(price, currency);
    const markup = Number(product.cost) > 0 ? money(((price - Number(product.cost)) / Number(product.cost)) * 100) : 0;
    const { printPriceTableJson: _printPriceTableJson, ...cleanProduct } = product;
    return { ...cleanProduct, currency, price, markup, costUsd, priceUsd, priceLbp: Math.round(price * (currency === "LBP" ? 1 : USD_TO_LBP)), printPriceTable, trackQuantity: Boolean(product.trackQuantity), barcodes, barcode: barcodes[0] ?? "" };
  });
}

function listExpenseCategories() {
  return rows("SELECT id, name FROM expense_categories ORDER BY CASE WHEN name = 'Product purchases' THEN 0 ELSE 1 END, name COLLATE NOCASE");
}

function purchaseReceipt(id) {
  const receipt = one(`
    SELECT id, receipt_no AS receiptNo, supplier, purchase_date AS purchaseDate, category, notes, total,
           created_at AS createdAt, recorded_by AS recordedBy
    FROM purchase_receipts WHERE id = ?
  `, [Number(id)]);
  if (!receipt) throw new Error("Purchase receipt was not found.");
  receipt.items = rows(`
    SELECT product_id AS productId, product_name AS productName, sku, quantity,
           unit_cost AS unitCost, line_total AS lineTotal
    FROM purchase_receipt_items WHERE purchase_receipt_id = ? ORDER BY id
  `, [Number(id)]);
  return {...receipt,...OptionalWhishFees.details(database,'purchase',receipt.id)};
}

function listPurchaseReceipts() {
  return rows(`
    SELECT pr.id, pr.receipt_no AS receiptNo, pr.supplier, pr.purchase_date AS purchaseDate,
           pr.category, pr.notes, pr.total, pr.created_at AS createdAt, pr.recorded_by AS recordedBy,
           COUNT(pri.id) AS itemCount,
           GROUP_CONCAT(pri.product_name || ' ×' || pri.quantity, ', ') AS itemSummary
    FROM purchase_receipts pr
    LEFT JOIN purchase_receipt_items pri ON pri.purchase_receipt_id = pr.id
    GROUP BY pr.id
    ORDER BY pr.purchase_date DESC, pr.id DESC
  `).map(receipt=>({...receipt,...OptionalWhishFees.details(database,'purchase',receipt.id)}));
}

function validatePurchaseReceipt(input) {
  const receiptNo = String(input.receiptNo ?? "").trim().toUpperCase();
  const supplier = String(input.supplier ?? "").trim();
  const purchaseDate = String(input.purchaseDate ?? "").trim();
  const category = String(input.category ?? "Product purchases").trim() || "Product purchases";
  const notes = String(input.notes ?? "").trim();
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  if (!receiptNo) throw new Error("Receipt number is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) throw new Error("Choose a valid purchase date.");
  if (!one("SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE", [category])) throw new Error("Choose a valid expense category.");
  if (!sourceItems.length) throw new Error("Add at least one purchased product.");
  const seenProducts = new Set();
  let total = 0;
  const items = sourceItems.map((item) => {
    const product = one("SELECT id, sku, name, track_quantity AS trackQuantity FROM products WHERE id = ?", [Number(item.productId)]);
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost);
    if (!product) throw new Error("One of the selected products no longer exists.");
    if (!product.trackQuantity) throw new Error(`${product.name} does not use stock quantity and cannot be added to a purchase receipt.`);
    if (seenProducts.has(Number(product.id))) throw new Error(`${product.name} is listed more than once.`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Purchased quantities must be positive whole numbers.");
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Unit cost must be zero or more.");
    seenProducts.add(Number(product.id));
    const lineTotal = money(quantity * unitCost);
    total += lineTotal;
    return { product, quantity, unitCost: money(unitCost), lineTotal };
  });
  total = money(total);
  if (total <= 0) throw new Error("The purchase receipt total must be greater than zero.");
  return { receiptNo, supplier, purchaseDate, category, notes, total, items };
}

function listEmployees() {
  return rows(`
    SELECT e.id, e.employee_no AS employeeNo, e.full_name AS fullName, e.job_title AS jobTitle,
           e.rfid_card AS rfidCard, e.active, e.created_at AS createdAt,
           (SELECT clock_in FROM attendance_records WHERE employee_id = e.id ORDER BY id DESC LIMIT 1) AS lastClockIn,
           (SELECT clock_out FROM attendance_records WHERE employee_id = e.id ORDER BY id DESC LIMIT 1) AS lastClockOut
    FROM employees e ORDER BY e.full_name COLLATE NOCASE
  `).map((employee) => ({ ...employee, active: Boolean(employee.active), present: Boolean(employee.lastClockIn && !employee.lastClockOut) }));
}

function listAttendance(startDate, endDate) {
  return rows(`
    SELECT a.id, a.employee_id AS employeeId, e.employee_no AS employeeNo, e.full_name AS fullName,
           e.job_title AS jobTitle, a.clock_in AS clockIn, a.clock_out AS clockOut,
           CASE WHEN a.clock_out IS NULL
             THEN MAX(0, CAST((julianday('now', 'localtime') - julianday(a.clock_in)) * 1440 AS INTEGER))
             ELSE MAX(0, CAST((julianday(a.clock_out) - julianday(a.clock_in)) * 1440 AS INTEGER))
           END AS durationMinutes
    FROM attendance_records a JOIN employees e ON e.id = a.employee_id
    WHERE date(a.clock_in) BETWEEN ? AND ? ${currentUser()?.role==='admin'?'':'AND a.recorded_by=?'}
    ORDER BY a.clock_in DESC, a.id DESC
  `, currentUser()?.role==='admin'?[startDate, endDate]:[startDate,endDate,currentUser()?.id??-1]);
}

function listBills(startDate, endDate) {
  return rows(`
    SELECT id, receipt_no AS receiptNo, customer_account AS customerAccount, customer_name AS customerName,
           phone, service_type AS serviceType, bundle_code AS bundleCode, bundle_name AS bundleName,
           bundle_details AS bundleDetails, bundle_price AS bundlePrice, bundle_cost AS bundleCost, billing_period AS billingPeriod, amount,
           payment_method AS paymentMethod, payment_status AS paymentStatus, settled_at AS settledAt,
           reference, paid_at AS paidAt, cashier_name AS cashierName, reseller_id AS resellerId,
           portal_service_id AS portalServiceId, portal_cost_source AS portalCostSource, renewal_months AS renewalMonths, portal_internal_cost AS portalInternalCost,portal_fixed_monthly_cost AS portalFixedMonthlyCost
    FROM active_fibernetlb_bills WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at DESC, id DESC
  `, [startDate, endDate]).map(item=>renewalLedger.enrich(paymentLedger.enrich("bill",item)));
}

function billById(id) {
  const bill = one("SELECT id,receipt_no AS receiptNo,customer_account AS customerAccount,customer_name AS customerName,phone,service_type AS serviceType,bundle_code AS bundleCode,bundle_name AS bundleName,bundle_details AS bundleDetails,bundle_price AS bundlePrice,bundle_cost AS bundleCost,billing_period AS billingPeriod,amount,payment_method AS paymentMethod,payment_status AS paymentStatus,reference,paid_at AS paidAt,cashier_name AS cashierName,portal_service_id AS portalServiceId,portal_cost_source AS portalCostSource,renewal_months AS renewalMonths,portal_internal_cost AS portalInternalCost,portal_fixed_monthly_cost AS portalFixedMonthlyCost FROM active_fibernetlb_bills WHERE id=?",[Number(id)]);
  if (!bill) throw new Error("Bill payment was not found.");
  return renewalLedger.enrich(paymentLedger.enrich("bill",bill));
}
function authorizeInternet(permission='bills.create') {
  checkWorkspaceChannel("bills:renew");
  if (activeWorkspace().id !== "fiber-users") throw new Error("Proradius Internet renewal belongs to FIBER net lb Users only. IPTV and reseller transfers are not connected to this API.");
  if(permission!=='bills.create')requirePermission(permission);
  else if (!hasPermission("bills.create") && !hasPermission("bills.manage")) requirePermission("bills.create");
}
function authorizeInternetLookup(){
  const permission=['bills.create','bills.manage','customers.manage','plans.manage'].find(hasPermission)||'bills.create';
  authorizeInternet(permission);
}
function renewalActor() { return `${currentUser().full_name} (${currentUser().username})`; }
function authorizeResellerFunding(mode='read',row=null){
  checkWorkspaceChannel('resellers:accounts');
  const user=currentUser();
  if(activeWorkspace().id!=='fiber-resellers'||!['admin','cashier','support'].includes(user?.role))throw Error('Reseller funding is available to Admin, Cashier and Support in Resellers only.');
  requirePermission('bills.view');
  if(mode==='recover'&&user.role==='admin'){
    if(!row||JSON.parse(row.input_json).accountingVersion!==1)throw Error('Admin may recover old payments only, not start or finish new staff payments.');
  }else if(mode!=='read'){
    if(!['cashier','support'].includes(user.role))throw Error('Only Cashier or Support can Add Money or Refund. Admin is view-only.');
    requirePermission('resellerFunding.manage');requirePermission('drawer.manage');
    if(row&&row.actor_key!==user.account_key)throw Error('You can recover only your own funding payment.');
  }
  if(!portalApi.settings.status().ready)throw Error('The main administrator must enable the Proradius API first.');
  return user;
}
function authorizeResellerCollection(){
  checkWorkspaceChannel('resellers:collectionSources');
  const user=currentUser();
  if(activeWorkspace().id!=='fiber-resellers'||user?.role!=='admin')throw Error('Only Admin can use Pay bill in Resellers.');
  requirePermission('bills.view');requirePermission('drawer.manage');
  return user;
}
function assertNoWalletReconciliationPending(section){
  if(!['fiber-users','fiber-resellers'].includes(section))return;
  const entry=workspaceDatabases.get('fiber-resellers');
  if(entry&&ResellerWalletReconciliation.pending(entry.db).length)throw Error('Finish the pending older Whish wallet reconciliation in Resellers before moving money or closing either business ledger.');
  if(entry)ResellerAdminWalletCorrections.assertIdle(entry.db);
}
function assertNoAdminWalletCorrectionPending(){const entry=workspaceDatabases.get('fiber-resellers');if(entry)ResellerAdminWalletCorrections.assertIdle(entry.db);}
function resellerRecipientKey(){
  const key=Finance.query(workspaceDatabases.get('main').db,"SELECT value FROM finance_settings WHERE name='internet_cost_recipient'")[0]?.value;
  if(key)return key;
  const admins=sectionAccess.roster('fiber-resellers').filter(p=>p.role==='admin'&&p.active);
  if(admins.length!==1)throw Error('The Main Admin must select a Pay bill cash recipient in Dashboard → Money & employee activity.');
  return admins[0].accountKey;
}
function resellerCashiers(section){
  return sectionAccess.roster(section).filter(p=>p.active&&p.role==='cashier').map(p=>{
    try{return sectionAccess.forWorkspace({account_key:p.accountKey},section);}catch{return null;}
  }).filter(p=>p?.active&&p.role==='cashier');
}
function saveSectionEntry(entry){
  const temporary=entry.path+'.pending',descriptor=fs.openSync(temporary,"w",0o600);
  try{writePrivateFile(descriptor,Buffer.from(entry.db.export()));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
  fs.renameSync(temporary,entry.path);
}
function saveWhishPolicyEntry(id,entry){
  whishPolicyPendingSaves.add(id);
  saveSectionEntry(entry);
  if(!fs.readFileSync(entry.path).equals(Buffer.from(entry.db.export())))throw Error('The Whish custody correction could not be verified on disk.');
  whishPolicyPendingSaves.delete(id);
}
function refreshWhishReceiptPolicy(requiredSections=[]){
  if(refreshingWhishReceiptPolicy||!workspaceDatabases.size)return;
  try{
    assertInvoiceVoidIdle();
    assertNoFixedMonthlyPending('main');
    if(adminWarehouse)adminWarehouse.assertIdle();
    else if(warehouseHasTable('main','admin_warehouse_intents')&&Finance.query(workspaceDatabases.get('main').db,"SELECT request_id FROM admin_warehouse_intents WHERE state<>'completed' LIMIT 1").length)throw Error('A saved Admin-stock operation needs recovery before wallet custody corrections.');
  }catch(error){
    // Read-only screens must not run a historical custody correction while a
    // saved stock sale, monthly payment or two-sided collection awaits recovery.
    for(const id of workspaceDatabases.keys())whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:[{reason:error.message}],warnings:[]});
    if(requiredSections.length)throw error;
    return;
  }
  refreshingWhishReceiptPolicy=true;
  try{
    const now=localIso(),destinations=Whish.listDestinations(workspaceDatabases.get('main').db,true),prepared=[],resellerEntry=workspaceDatabases.get('fiber-resellers');
    const persistenceBlocked=new Set();
    for(const id of [...whishPolicyPendingSaves]){
      try{saveWhishPolicyEntry(id,workspaceDatabases.get(id));}
      catch(error){persistenceBlocked.add(id);whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:[{reason:'The wallet correction is not saved safely yet: '+error.message}],warnings:[]});}
    }
    let collectionMetadata=[],collectionMetadataError='';
    try{collectionMetadata=resellerEntry?Finance.query(resellerEntry.db,"SELECT request_id,amount_cents,fee_cents,net_cents FROM reseller_collections WHERE state='completed' AND source_section='fiber-users' AND source_wallet<>''").map(row=>{
      if(![row.amount_cents,row.fee_cents,row.net_cents].every(Number.isSafeInteger)||row.amount_cents<=0||row.fee_cents<0||row.net_cents!==row.amount_cents-row.fee_cents)throw Error('The preserved cross-business Whish collection needs Admin review.');
      return {eventId:'collection-'+row.request_id,amount:row.amount_cents/100,fee:row.fee_cents/100};
    }):[];if(resellerEntry)collectionMetadata.push(...ResellerWalletReconciliation.cashoutMetadata(resellerEntry.db));}catch(error){collectionMetadataError=error.message;}
    for(const [id,entry] of workspaceDatabases){
      if(persistenceBlocked.has(id))continue;
      if(['fiber-users','fiber-resellers'].includes(id)&&resellerEntry&&(ResellerWalletReconciliation.pending(resellerEntry.db).length||ResellerAdminWalletCorrections.pending(resellerEntry.db).length)){whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:[{reason:'Finish the pending older Whish wallet reconciliation or Admin collection correction before further custody corrections.'}],warnings:[]});continue;}
      const plan=ReceiptFees.plan(entry.db,destinations,now,id==='fiber-users'?{cashoutMetadata:collectionMetadata}:{});plan.destinations=destinations;
      if(id==='fiber-users'&&collectionMetadataError){plan.items=[];plan.deferred.push({reason:collectionMetadataError});}
      whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:plan.deferred,warnings:plan.warnings});
      if(plan.items.length&&!plan.deferred.length)prepared.push({id,entry,plan});
    }
    let fundingPlans=[];
    if(resellerEntry&&!whishReceiptPolicyStatus.get('fiber-resellers')?.deferred.length){
      try{fundingPlans=ResellerCollections.prepaymentPlans(resellerEntry.db).filter(plan=>!plan.internal||!whishReceiptPolicyStatus.get('fiber-users')?.deferred.length);}
      catch(error){whishReceiptPolicyStatus.set('fiber-resellers',{policy:'profit_only',deferred:[{reason:error.message}],warnings:[]});}
    }
    if(prepared.length||fundingPlans.length){
      const backup=backupAllSections('before-remaining-whish-fee-prepayment');
      for(const {id,entry,plan} of prepared){
        if(whishReceiptPolicyStatus.get(id)?.deferred.length)continue;
        try{ReceiptFees.apply(entry.db,plan,now,backup);saveWhishPolicyEntry(id,entry);}
        catch(error){whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:[{reason:error.message}],warnings:plan.warnings});}
      }
      const safeFunds=fundingPlans.filter(plan=>!whishReceiptPolicyStatus.get(plan.sourceSection)?.deferred.length);
      if(safeFunds.length){let committed=false;resellerEntry.db.exec('BEGIN');try{for(const plan of safeFunds)ResellerCollections.recordPrepayment(resellerEntry.db,plan,now);resellerEntry.db.exec('COMMIT');committed=true;saveWhishPolicyEntry('fiber-resellers',resellerEntry);}catch(error){if(!committed)resellerEntry.db.exec('ROLLBACK');whishReceiptPolicyStatus.set('fiber-resellers',{policy:'profit_only',deferred:[{reason:error.message}],warnings:[]});}}
    }
    const grossPrepared=[];let grossFundingPlans=[];
    for(const [id,entry] of workspaceDatabases){
      const prior=whishReceiptPolicyStatus.get(id);if(prior?.deferred.length)continue;
      const plan=WalletGross.plan(entry.db,destinations,now,id==='fiber-users'?{cashoutMetadata:collectionMetadata}:{});
      whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:plan.deferred,warnings:[...(prior?.warnings||[]),...plan.warnings]});
      if(plan.items.length&&!plan.deferred.length)grossPrepared.push({id,entry,plan});
    }
    if(resellerEntry&&!whishReceiptPolicyStatus.get('fiber-resellers')?.deferred.length){
      try{grossFundingPlans=ResellerCollections.grossPolicyPlans(resellerEntry.db).filter(plan=>!whishReceiptPolicyStatus.get(plan.sourceSection)?.deferred.length);}
      catch(error){whishReceiptPolicyStatus.set('fiber-resellers',{policy:'profit_only',deferred:[{reason:error.message}],warnings:[]});}
    }
    if(grossPrepared.length||grossFundingPlans.length){
      const backup=backupAllSections('before-whish-gross-wallet-restoration');
      for(const {id,entry,plan} of grossPrepared){
        if(whishReceiptPolicyStatus.get(id)?.deferred.length)continue;
        try{WalletGross.apply(entry.db,plan,now,backup);saveWhishPolicyEntry(id,entry);}
        catch(error){whishReceiptPolicyStatus.set(id,{policy:'profit_only',deferred:[{reason:error.message}],warnings:plan.warnings});}
      }
      const proven=[];
      for(const plan of grossFundingPlans){
        if(whishReceiptPolicyStatus.get(plan.sourceSection)?.deferred.length)continue;
        const source=workspaceDatabases.get(plan.sourceSection);
        const audits=plan.internal?[]:Finance.query(source.db,"SELECT id,restored_fee_cents FROM active_whish_wallet_gross_audit WHERE origin_kind='reseller_fund' AND origin_key=?",[plan.fundRequestId]);
        if(!plan.internal&&plan.excludedFeeCents>audits.reduce((sum,a)=>sum+a.restored_fee_cents,0)){
          whishReceiptPolicyStatus.set('fiber-resellers',{policy:'profit_only',deferred:[{reason:'A reseller gross-wallet claim needs verified remaining custody before collection.'}],warnings:[]});continue;
        }
        proven.push({...plan,verifiedGrossWallet:true,restorationIds:audits.map(a=>a.id),backupPath:backup});
      }
      if(proven.length){let committed=false;resellerEntry.db.exec('BEGIN');try{for(const plan of proven)ResellerCollections.recordGrossPolicy(resellerEntry.db,plan,now);resellerEntry.db.exec('COMMIT');committed=true;saveWhishPolicyEntry('fiber-resellers',resellerEntry);}catch(error){if(!committed)resellerEntry.db.exec('ROLLBACK');whishReceiptPolicyStatus.set('fiber-resellers',{policy:'profit_only',deferred:[{reason:error.message}],warnings:[]});}}
    }
    for(const id of requiredSections)if(whishReceiptPolicyStatus.get(id)?.deferred.length)throw Error('Older Whish wallet custody needs Admin review before money can be withdrawn. Finish unfinished operations and refresh; no extra fee or uncertain wallet correction was made.');
  }finally{refreshingWhishReceiptPolicy=false;}
}
function authorizePortalOperation(kind) {
  if(kind==='free'){authorizeInternet();if(!portalApi.settings.status().ready)throw Error('The main administrator must enable the Proradius API first.');return;}
  if(kind==="change"||kind==="create")authorizeInternet(kind==='create'?'customers.manage':'plans.manage');
  else if(kind==="topup"||kind==='reseller_refund') {authorizeResellerFunding('write');return;}
  else throw Error("Unknown portal operation.");
  requirePermission(kind==='create'?'customers.manage':kind==='change'?'plans.manage':'bills.manage');
  if(!portalApi.settings.status().ready)throw Error("The main administrator must enable the Proradius API first.");
}
function storeFixedCosts(catalogue) {
  const bundles=rows("SELECT code,name,service_type AS serviceType,allowance FROM fibernetlb_bundles WHERE service_type='Internet' AND active=1");
  for(const bundle of bundles) {
    const plan=matchPortalPlan(bundle,catalogue.plans);
    if(plan&&Number.isFinite(plan.cost)&&plan.cost>=0)database.run("UPDATE fibernetlb_bundles SET cost=?,cost_source=?,cost_verified_at=?,updated_at=CURRENT_TIMESTAMP WHERE code=?",[plan.cost,"Proradius · fibernetlb2 (fixed monthly)",catalogue.verifiedAt,bundle.code]);
  }
  saveDatabase();
}
async function syncPortalCosts(customer,{force=false,strict=false}={}){
  const scoped=await portalApi.billingCustomer(customer.username);
  if(scoped.serviceId!==customer.serviceId||scoped.resellerId!==customer.resellerId)throw Error('The customer changed during fibernetlb2 cost lookup. Verify again; no bill was saved.');
  customer={...customer,cost:scoped.cost,plans:scoped.plans,costReseller:'fibernetlb2'};
  // Daily/customer-dependent costs never overwrite the fixed bundle catalogue.
  let catalogue;
  try{catalogue=await portalApi.fixedCosts(force);storeFixedCosts(catalogue);}catch(error){if(strict)throw error;return {...customer,costVerifiedAt:new Date().toISOString(),fixedCostError:"Fixed cost sync unavailable. Ask the administrator to grant fibernetlb2 service-cost read access.",plans:customer.plans?.map(plan=>({...plan,fixedCost:null}))};}
  const bundles=rows("SELECT code,name,service_type AS serviceType,allowance,price FROM fibernetlb_bundles WHERE service_type='Internet' AND active=1"),billingDate=beirutDate();
  let renewalQuote,renewalQuoteError;
  if(!lateRenewalPolicy(billingDate,customer.expiry).free&&!customer.blocked){
    try{renewalQuote=await portalApi.quoteRenewal(customer.username,customer.serviceId);}catch(error){if(strict)throw error;renewalQuoteError=error.message;}
  }
  return {...customer,billingDate,...renewalQuote?{renewalQuote}:{},...renewalQuoteError?{renewalQuoteError}:{},costVerifiedAt:new Date().toISOString(),fixedCostVerifiedAt:catalogue.verifiedAt,plans:customer.plans?.map(plan=>{const bundle=matchInternetBundle(plan.name,bundles),fixed=matchPortalPlan(bundle,catalogue.plans);return {...plan,fixedCost:fixed?.cost??null,...plan.id===renewalQuote?.serviceId?{renewalCost:renewalQuote.cost}:{},...bundle?{retailPricing:internetBillPricing(Number(bundle.price),1,billingDate,customer.expiry)}:{}};})};
}
function startFixedCostSync(){
  if(networkConfig.mode!=="server")return;
  let syncing=false;
  const run=async()=>{if(syncing||!portalApi.settings.status().ready)return;syncing=true;try{const catalogue=await portalApi.fixedCosts(true);for(const section of WORKSPACES)requestContext.run({workspaceId:section.id,user:null},()=>storeFixedCosts(catalogue));}catch{/* Keep last verified values; billing performs a strict fresh check. */}finally{syncing=false;}};
  void run();const timer=setInterval(()=>void run(),6*3600000);timer.unref?.();
}
async function pricePlanChange(quote){
  try{
    const catalogue=await portalApi.fixedCosts(true);storeFixedCosts(catalogue);
    return planChangePricing(quote,listBundles(),catalogue.plans);
  }catch{return {available:false,reason:"Fixed monthly costs could not be verified. Enter the customer amount manually; the portal charge remains your cost."};}
}
function portalOperationBill(row) {
  if([1,2,3,4,5,6].includes(JSON.parse(row.input_json).accountingVersion)&&['topup','reseller_refund'].includes(row.kind))return resellerFunding.complete(row);
  if(row.bill_id){if(row.state==="confirmed")operationLedger.attach(row.request_id,row.bill_id,currentUser().full_name);return {...billById(row.bill_id),idempotent:true};}
  if(row.state!=="confirmed")throw Error("The portal action is not confirmed. No payment was recorded.");
  const input=JSON.parse(row.input_json),quote=JSON.parse(row.quote_json),topup=row.kind==="topup",owner=actorUser(database,row);
  const amount=Number(input.amount),cost=topup?0:quote.total,method=input.paymentMethod;
  const pricingDetails=!topup&&quote.retailPricing?.available?` · App monthly selling prices ${quote.retailPricing.beforePrice} → ${quote.retailPricing.targetPrice} · Portal current-period share ${(quote.retailPricing.currentFraction*100).toFixed(2)}% · Suggested customer adjustment ${quote.retailPricing.retailAdjustment}`:"";
  const receiptNo=`${topup?"RTP":"PLN"}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  database.exec("BEGIN TRANSACTION");
  try {
    database.run("INSERT INTO fibernetlb_bills(receipt_no,customer_account,customer_name,phone,service_type,bundle_name,bundle_details,bundle_price,bundle_cost,billing_period,amount,payment_method,payment_status,reference,paid_at,user_id,cashier_name,portal_service_id,portal_cost_source,reseller_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[receiptNo,input.username,input.customerName,input.phone||"",topup?"Reseller transfer":"Internet plan change",topup?"Proradius balance top-up":`${quote.beforeName} → ${quote.targetName}`,topup?"Balance credited in Proradius":`Proradius calculation · current period ${quote.currentPeriodPrice} · pending refills ${quote.pendingRefills} · freetime ${quote.freetimePrice}${pricingDetails}`,amount,cost,input.billingPeriod,amount,method,method==="Unpaid"&&amount>0?"unpaid":"paid",`${input.reference||""} · Portal request ${row.request_id}`,localIso(),currentUser().id,currentUser().full_name,topup?null:quote.targetId,topup?"Proradius balance transfer":"Proradius Change Service calculation",topup?input.resellerId:null]);
    const id=Number(one("SELECT id FROM fibernetlb_bills WHERE receipt_no=?",[receiptNo]).id);
    Whish.saveSnapshot(database,'bill',id,input.whishDestination,amount);
    database.run('UPDATE fibernetlb_bills SET user_id=?,cashier_name=? WHERE id=?',[owner.id,owner.full_name,id]);
    if(method==="Cash"&&amount!==0)addDrawerMovement(amount,amount<0?"bill_refund":"bill_payment","bill",id,receiptNo,owner);
    renewalLedger.recordRequest(row.request_id,id,row.fingerprint);
    database.run("UPDATE portal_operations SET bill_id=? WHERE request_id=?",[id,row.request_id]);
    database.exec("COMMIT");saveDatabase();operationLedger.attach(row.request_id,id,currentUser().full_name);return billById(id);
  } catch(error) {try{database.exec("ROLLBACK");}catch{}throw error;}
}
async function registrationBillingChoices(options){
  let catalogue,error,costs;
  try{costs=(await portalApi.billingOptions()).services;}catch{error='Current internal costs could not be verified in the fibernetlb2 session. Paid creation is blocked; no fallback is allowed.';}
  try{catalogue=await portalApi.fixedCosts(true);storeFixedCosts(catalogue);}catch{error='Fixed monthly service costs could not be verified under fibernetlb2. Refresh the reseller choices before paid creation.';}
  const bundles=rows("SELECT code,name,service_type AS serviceType,allowance,price FROM fibernetlb_bundles WHERE active=1 AND service_type='Internet'");
  return {...options,services:options.services.map(service=>{
    const bundle=matchInternetBundle(service.name,bundles),fixed=matchPortalPlan(bundle,catalogue?.plans);
    const live=matchPortalPlan(bundle,costs);
    service={...service,cost:live?.cost??null};
    const billingError=!bundle?'This service has no unique active Internet bundle in the app. Configure its selling price before paid creation.':error||(!fixed||!Number.isFinite(fixed.cost)||fixed.cost<0?'This service has no verified fixed monthly cost under fibernetlb2.':!Number.isFinite(service.cost)||service.cost<0?'Proradius did not supply the current internal cost.':!Number.isFinite(bundle.price)||bundle.price<=0?'The app bundle needs a positive selling price.':null);
    return {...service,...billingError?{billingError}:{billing:{bundleCode:bundle.code,bundleName:bundle.name,bundleDetails:bundle.allowance,price:money(bundle.price),retailPricing:internetBillPricing(Number(bundle.price)),fixedCost:money(fixed.cost),internalCost:money(service.cost),billCost:money(service.cost),costBasis:'current_internal',verifiedAt:new Date().toISOString()}}};
  })};
}
function completeCustomerRegistration(row){
  authorizePortalOperation('create');
  if(row.kind!=='create'||!['confirmed','succeeded'].includes(row.state))throw Error('Customer creation is not confirmed. No local payment was recorded.');
  const input=JSON.parse(row.input_json),result=JSON.parse(row.result_json),owner=actorUser(database,row);
  if(!result.customer||result.customer.username!==input.username||(input.resellerId&&result.customer.resellerId!==input.resellerId)||(input.freeStarter&&result.customer.expiry.slice(0,10)!==input.starterExpiry))throw Error('Verify the new customer, reseller owner and starter expiry first.');
  const quote=JSON.parse(row.quote_json),firstPayment=input.servicePayment;
  if(firstPayment&&(!quote.serviceBilling||input.freeStarter||quote.serviceBilling.bundleCode!==firstPayment.bundleCode||quote.serviceBilling.price!==firstPayment.expectedPrice||registrationBillCost(quote.serviceBilling)!==firstPayment.expectedCost))throw Error('The initial service bill has no matching verified pricing snapshot. No local money was recorded.');
  let serviceBillId=row.bill_id;
  database.exec('BEGIN TRANSACTION');
  try{
    if(firstPayment&&!serviceBillId){
      const q=quote.serviceBilling,receiptNo=`FBL-NEW-${row.request_id.toUpperCase()}`,now=localIso();
      database.run('INSERT INTO fibernetlb_bills(receipt_no,customer_account,customer_name,phone,service_type,bundle_code,bundle_name,bundle_details,bundle_price,bundle_cost,billing_period,amount,payment_method,payment_status,reference,paid_at,user_id,cashier_name,portal_service_id,portal_cost_source,renewal_months,portal_internal_cost,portal_fixed_monthly_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[receiptNo,input.username,input.name,input.phone,'Internet',q.bundleCode,q.bundleName,`${q.bundleDetails} · Initial service activated during account creation; no additional renewal${q.retailPricing?' · '+retailDescription(q.retailPricing,firstPayment.amount):''}`,q.price,registrationBillCost(q),firstPayment.billingPeriod,firstPayment.amount,firstPayment.paymentMethod,firstPayment.paymentMethod==='Unpaid'?'unpaid':'paid',`New customer · reseller ${input.resellerUsername} · Portal request ${row.request_id}`,now,currentUser().id,row.actor,input.service,q.costBasis==='current_internal'?'Proradius current internal cost · initial service':'Proradius fibernetlb2 fixed monthly cost · initial service',1,q.internalCost,q.fixedCost]);
      serviceBillId=Number(one('SELECT id FROM fibernetlb_bills WHERE receipt_no=?',[receiptNo]).id);
      Whish.saveSnapshot(database,'bill',serviceBillId,firstPayment.whishDestination,firstPayment.amount);
      database.run('UPDATE fibernetlb_bills SET user_id=? WHERE id=?',[owner.id,serviceBillId]);
      if(firstPayment.paymentMethod==='Cash')addDrawerMovement(firstPayment.amount,'bill_payment','bill',serviceBillId,receiptNo,owner);
      renewalLedger.recordRequest(row.request_id,serviceBillId,row.fingerprint);
      database.run('UPDATE portal_operations SET bill_id=? WHERE request_id=?',[serviceBillId,row.request_id]);
    }
    let payment=one('SELECT id FROM installation_payments WHERE request_id=?',[row.request_id]);
    if(!payment&&input.installationAmount>0){
      const receiptNo=`INS-${row.request_id.toUpperCase()}`;
      database.run('INSERT INTO installation_payments(request_id,receipt_no,customer_account,customer_name,amount,payment_method,paid_at,cashier_name,user_id) VALUES(?,?,?,?,?,?,?,?,?)',[row.request_id,receiptNo,input.username,input.name,input.installationAmount,input.installationMethod,localIso(),row.actor,owner.id]);
      payment=one('SELECT id FROM installation_payments WHERE request_id=?',[row.request_id]);
      Whish.saveSnapshot(database,'installation',payment.id,input.installationWhishDestination,input.installationAmount);
      if(input.installationMethod==='Cash')addDrawerMovement(input.installationAmount,'installation_payment','installation',payment.id,receiptNo,owner);
    }
    database.run("UPDATE portal_operations SET state='succeeded',message='Customer, initial service bill and installation funding recorded once; equipment sales remain separate.' WHERE request_id=?",[row.request_id]);
    if(row.state!=='succeeded')operationLedger.event(row.request_id,'succeeded','Customer, initial service bill and installation funding recorded once; equipment sales remain separate.',currentUser().full_name);
    database.exec('COMMIT');saveDatabase();
    const billActive=serviceBillId&&one('SELECT id FROM active_fibernetlb_bills WHERE id=?',[serviceBillId]);
    return {requestId:row.request_id,state:'succeeded',customer:result.customer,serviceBill:billActive?billById(serviceBillId):null,serviceBillArchived:Boolean(serviceBillId&&!billActive),installationPayment:installationRows(activityDatabase).find(p=>p.requestId===row.request_id)||null,equipmentSaleId:one('SELECT sale_id AS id FROM customer_equipment_sales WHERE request_id=?',[row.request_id])?.id||null};
  }catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
}
function completeFreeRenewal(row){
  authorizePortalOperation('free');
  if(row.kind!=='free'||!['confirmed','succeeded'].includes(row.state))throw Error('The free expiry edit is not confirmed; no expense funding was recorded.');
  const input=JSON.parse(row.input_json),result=JSON.parse(row.result_json),quote=JSON.parse(row.quote_json),owner=actorUser(database,row),customer=result.customer;
  if(!customer||customer.username!==input.username||customer.serviceId!==input.serviceId||customer.resellerId!==input.resellerId||customer.expiry.slice(0,10)!==input.expiry)throw Error('Verify the exact customer, current plan and free expiry first.');
  let billId=row.bill_id;
  database.exec('BEGIN TRANSACTION');
  try{
    if(!billId){
      const receiptNo=`FBL-FREE-${row.request_id.toUpperCase()}`,now=localIso();
      database.run('INSERT INTO fibernetlb_bills(receipt_no,customer_account,customer_name,phone,service_type,bundle_code,bundle_name,bundle_details,bundle_price,bundle_cost,billing_period,amount,payment_method,payment_status,reference,paid_at,user_id,cashier_name,portal_service_id,portal_cost_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[receiptNo,input.username,customer.name,customer.phone,'Internet',quote.bundleCode,quote.bundleName,`Free service until ${input.expiry} at 12:00 Beirut; expiry edit only; expense funding is a separate receipt`,0,0,input.asOf.slice(0,7),0,input.paymentMethod,'paid',input.reference,now,owner.id,row.actor,input.serviceId,'Free renewal · no paid Proradius renewal submitted']);
      billId=Number(one('SELECT id FROM fibernetlb_bills WHERE receipt_no=?',[receiptNo]).id);
      renewalLedger.recordRequest(row.request_id,billId,row.fingerprint);
      database.run('UPDATE portal_operations SET bill_id=? WHERE request_id=?',[billId,row.request_id]);
    }
    if(input.amount>0&&!one('SELECT id FROM installation_payments WHERE request_id=?',[row.request_id])){
      const receiptNo=`FND-${row.request_id.toUpperCase()}`;
      database.run('INSERT INTO installation_payments(request_id,receipt_no,customer_account,customer_name,amount,payment_method,paid_at,cashier_name,user_id,purpose) VALUES(?,?,?,?,?,?,?,?,?,?)',[row.request_id,receiptNo,input.username,customer.name,input.amount,input.paymentMethod,localIso(),row.actor,owner.id,'free_renewal']);
      const id=Number(one('SELECT id FROM installation_payments WHERE request_id=?',[row.request_id]).id);
      Whish.saveSnapshot(database,'installation',id,input.whishDestination,input.amount);
      if(input.paymentMethod==='Cash')addDrawerMovement(input.amount,'installation_payment','installation',id,receiptNo,owner);
    }
    database.run("UPDATE portal_operations SET state='succeeded',message='Free expiry confirmed; expense funding recorded once, separate from Internet revenue.' WHERE request_id=?",[row.request_id]);
    if(row.state!=='succeeded')operationLedger.event(row.request_id,'succeeded','Free expiry confirmed; expense funding recorded once, separate from Internet revenue.',currentUser().full_name);
    database.exec('COMMIT');saveDatabase();return billById(billId);
  }catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
}
function completePortalOperation(row){return row.kind==='free'?completeFreeRenewal(row):row.kind==='create'?completeCustomerRegistration(row):portalOperationBill(row);}
function paymentFingerprint(bill,input,wantRenew) {
  const {bundleCost:_cost,...portalBill}=bill;
  return renewalLedger.fingerprint(input.portalServiceId ? {...portalBill,portalServiceId:Number(input.portalServiceId),portalExpectedServiceId:Number(input.portalExpectedServiceId)} : bill,wantRenew);
}
function createBillPayment(input, wantRenew = false, portalPricing = null) {
  if(input.portalServiceId && !portalPricing) throw new Error("Portal-priced bills must use the verified Proradius save action.");
  if (!hasPermission("bills.create") && !hasPermission("bills.manage")) requirePermission("bills.create");
  if(activeWorkspace().kind==='reseller')throw Error('Use reseller Add Money or Refund. Manual transfers are historical records only.');
  const bill = validateBill(input), requestId = String(input.requestId || ""), fingerprint = paymentFingerprint(bill,input,wantRenew);
  if(requestId&&one("SELECT request_id FROM portal_operations WHERE request_id=? AND state='archived'",[requestId]))throw Error('This test request was archived and cannot create another payment or renewal.');
  const replay = renewalLedger.replay(requestId,fingerprint);
  if (replay) return { ...billById(replay), idempotent: true };
  if(bill.retailPricing){
    const monthly=Number(one("SELECT price FROM fibernetlb_bundles WHERE code=? AND active=1",[bill.bundleCode]).price),quote=portalPricing?.retailQuote??internetBillPricing(monthly,bill.renewalMonths);
    verifyRetailSelection(bill.retailPricing,quote,bill.amount);
    bill.bundlePrice=quote.suggestedAmount;bill.bundleDetails+=' · '+retailDescription(quote,bill.amount);
  }
  if(activeWorkspace().id==="fiber-users"&&operationLedger.pending(`customer:${bill.customerAccount}`))throw Error("Review this customer's unfinished portal operation before billing or renewal.");
  if (wantRenew) {
    authorizeInternet();
    if(lateRenewalPolicy(undefined,portalPricing?.customerExpiry).free)throw Error('From the 11th through the 4th, use Free renewal for an unrenewed current cycle. Already-renewed customers may purchase additional full months. No paid renewal or bill was saved.');
    if (bill.serviceType !== "Internet" || bill.paymentMethod === "Unpaid") throw new Error("Save & Renew requires a paid Internet bill. Unpaid bills are records only.");
    if (!requestId) throw new Error("Save & Renew needs a unique payment request ID.");
    if (!portalApi.settings.status().ready) throw new Error("The main administrator must test and enable the Internet API first. No bill or renewal was saved.");
  }
  if(portalPricing) {
    if(!Number.isFinite(portalPricing.cost)||portalPricing.cost<0) throw new Error("Proradius did not supply a valid internal cost. No bill was saved.");
    if(!Number.isFinite(portalPricing.fixedMonthlyCost)||portalPricing.fixedMonthlyCost<0) throw new Error("Proradius did not supply a valid fibernetlb2 fixed monthly cost. No bill was saved.");
    bill.bundleCost=portalBillCost(portalPricing,bill.renewalMonths);
  }
  const paidAt = localIso(), receiptNo = `FBL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  database.exec("BEGIN TRANSACTION");
  try {
    database.run("INSERT INTO fibernetlb_bills (receipt_no, customer_account, customer_name, phone, service_type, bundle_code, bundle_name, bundle_details, bundle_price, bundle_cost, billing_period, amount, payment_method, payment_status, reference, paid_at, user_id, cashier_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [receiptNo,bill.customerAccount,bill.customerName,bill.phone,bill.serviceType,bill.bundleCode,bill.bundleName,bill.bundleDetails,bill.bundlePrice,bill.bundleCost,bill.billingPeriod,bill.amount,bill.paymentMethod,bill.paymentStatus,bill.reference,paidAt,currentUser().id,currentUser().full_name]);
    const billId = Number(one("SELECT id FROM fibernetlb_bills WHERE receipt_no=?",[receiptNo]).id);
    Whish.saveSnapshot(database,'bill',billId,bill.whishDestination,bill.amount);
    database.run("UPDATE fibernetlb_bills SET renewal_months=? WHERE id=?",[bill.renewalMonths??1,billId]);
    if(portalPricing) database.run("UPDATE fibernetlb_bills SET portal_service_id=?,portal_cost_source=?,portal_internal_cost=?,portal_fixed_monthly_cost=? WHERE id=?",[Number(input.portalServiceId),`${LIVE_COST_SOURCE} · ${bill.renewalMonths>1?'first live quote; future cycles estimated':'current internal cost at save; renewal not submitted'}`,portalPricing.cost,portalPricing.fixedMonthlyCost,billId]);
    if (bill.resellerId) database.run("UPDATE fibernetlb_bills SET reseller_id=? WHERE id=?",[bill.resellerId,billId]);
    if (bill.paymentMethod === "Cash") addDrawerMovement(bill.amount,"bill_payment","bill",billId,receiptNo);
    renewalLedger.recordRequest(requestId,billId,fingerprint);
    database.exec("COMMIT"); saveDatabase(); return billById(billId);
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function listTelecomCatalog() {
  const catalog = rows(`
    SELECT id, code, provider, name, face_value AS faceValue, details, price, cost, currency,
           source_url AS sourceUrl, sort_order AS sortOrder
    FROM telecom_catalog WHERE active = 1 ORDER BY sort_order, id
  `);
  if (hasPermission("telecomCatalog.manage") || hasPermission("telecom.manage")) return catalog;
  return catalog.map(({ cost: _cost, ...item }) => item);
}

function validateTelecomPayment(input) {
  const provider = String(input?.provider ?? "").trim();
  const requestedType = String(input?.transactionType ?? "Refill").trim();
  const phone = String(input?.phone ?? "").trim();
  const customerName = String(input?.customerName ?? "").trim();
  const billingPeriod = String(input?.billingPeriod ?? "").trim();
  const reference = String(input?.reference ?? "").trim();
  const method = paymentMethod(input?.paymentMethod);
  if (!["Alfa", "touch / MTC", "Ogero"].includes(provider)) throw new Error("Choose Alfa, touch / MTC, or Ogero.");
  if (!phone || phone.length > 40) throw new Error(provider === "Ogero" ? "Enter the Ogero landline number." : "Enter the Alfa or touch / MTC mobile number.");
  const transactionType = provider === "Ogero" ? "Bill" : requestedType;
  if (!["Refill", "Bill", "Airtime", "Validity"].includes(transactionType)) throw new Error("Choose a valid telecom service.");
  if (transactionType === "Airtime" && provider === "Ogero") throw new Error("USD airtime is available only for Alfa or MTC.");
  if (transactionType === "Validity" && provider !== "touch / MTC") throw new Error("Validity time is available only for MTC.");
  if (transactionType === "Bill") {
    const amount = Number(input?.amount);
    if (!/^\d{4}-\d{2}$/.test(billingPeriod)) throw new Error("Choose the billing month.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Bill amount must be greater than zero.");
    const itemCode = provider === "Ogero" ? "OGERO-BILL" : `${provider === "Alfa" ? "ALFA" : "TOUCH"}-BILL`;
    const itemName = provider === "Ogero" ? "Ogero landline / Internet bill" : `${provider} mobile bill payment`;
    return { provider, transactionType, phone, customerName, billingPeriod, reference, amount: money(amount), cost: money(amount), itemCode, itemName, itemDetails: billingPeriod, paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid" };
  }
  if (transactionType === "Airtime") {
    const creditAmount = Number(input?.creditAmount);
    const amount = Number(input?.amount);
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) throw new Error("Enter the USD airtime credits to transfer.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the USD price charged for the airtime transfer.");
    const providerCode = provider === "Alfa" ? "ALFA" : "TOUCH";
    const providerName = provider === "Alfa" ? "Alfa" : "MTC (touch)";
    return { provider, transactionType, phone, customerName, billingPeriod: "", reference, amount: money(amount), cost: money(amount), itemCode: `${providerCode}-AIRTIME`, itemName: `${providerName} USD airtime transfer`, itemDetails: `${money(creditAmount)} USD airtime`, paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid" };
  }
  if (transactionType === "Validity") {
    const validityDays = Number(input?.validityDays);
    const amount = Number(input?.amount);
    if (![30, 60, 90, 180, 360].includes(validityDays)) throw new Error("Choose 30, 60, 90, 180, or 360 validity days.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the USD price charged for the validity extension.");
    return { provider, transactionType, phone, customerName, billingPeriod: "", reference, amount: money(amount), cost: money(amount), itemCode: `TOUCH-VALIDITY-${validityDays}`, itemName: `touch / MTC ${validityDays}-day validity`, itemDetails: validityDays === 360 ? "360 days · line validity cannot exceed 360 days" : `${validityDays} days`, paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid" };
  }
  const itemCode = String(input?.itemCode ?? "").trim().toUpperCase();
  const item = one("SELECT * FROM telecom_catalog WHERE code = ? AND provider = ? AND active = 1", [itemCode, provider]);
  if (!item) throw new Error("Choose an available refill card for this company.");
  return { provider, transactionType: "Refill", phone, customerName, billingPeriod: "", reference, amount: money(item.price), cost: money(item.cost), itemCode: item.code, itemName: item.name, itemDetails: item.details, paymentMethod: method, paymentStatus: method === "Unpaid" ? "unpaid" : "paid" };
}

function listTelecomPayments(startDate, endDate) {
  return rows(`
    SELECT id, receipt_no AS receiptNo, provider, transaction_type AS transactionType,
           phone, customer_name AS customerName, item_code AS itemCode, item_name AS itemName,
           item_details AS itemDetails, billing_period AS billingPeriod, amount, cost,
           payment_method AS paymentMethod, payment_status AS paymentStatus, settled_at AS settledAt,
           reference, paid_at AS paidAt, cashier_name AS cashierName
    FROM telecom_payments WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at DESC, id DESC
  `, [startDate, endDate]).map(item=>paymentLedger.enrich("telecom",item));
}

function telecomReceipt(id) {
  const record=one(`
    SELECT id, receipt_no AS receiptNo, provider, transaction_type AS transactionType,
           phone, customer_name AS customerName, item_code AS itemCode, item_name AS itemName,
           item_details AS itemDetails, billing_period AS billingPeriod, amount, cost,
           payment_method AS paymentMethod, payment_status AS paymentStatus, settled_at AS settledAt,
           reference, paid_at AS paidAt, cashier_name AS cashierName
    FROM telecom_payments WHERE id = ?
  `, [Number(id)]);
  return record?paymentLedger.enrich('telecom',record):null;
}

function cashDrawerSummary() {
  const today = localIso().slice(0, 10);
  const summary = one("SELECT COALESCE(SUM(amount), 0) AS balance, COALESCE(SUM(CASE WHEN amount > 0 AND date(created_at) = ? AND transaction_type NOT IN ('manual_count','month_opening') THEN amount ELSE 0 END), 0) AS todayIn FROM active_cash_drawer_transactions", [today]);
  const lastCount = one("SELECT created_at AS createdAt, user_name AS userName, note FROM cash_drawer_transactions WHERE transaction_type = 'manual_count' ORDER BY id DESC LIMIT 1");
  return { balance: money(summary.balance), todayIn: money(summary.todayIn), lastCount };
}

function addDrawerMovement(amount, transactionType, referenceType, referenceId, note = "", owner=currentUser()) {
  const value = money(amount);
  if (!value) return;
  database.run("INSERT INTO cash_drawer_transactions (amount, transaction_type, reference_type, reference_id, note, created_at, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [value, transactionType, referenceType || null, referenceId || null, String(note || ""), localIso(), owner?.id ?? null, owner?.full_name ?? null]);
}

function listDebts(includePaid = false) { return paymentLedger.accounts(Boolean(includePaid)); }

function saleReceipt(id) {
  const sale = one("SELECT id, invoice_no AS invoiceNo, created_at AS createdAt, subtotal, cost_total AS costTotal, profit, payment_method AS paymentMethod, payment_status AS paymentStatus, settled_at AS settledAt, customer_name AS customerName, customer_phone AS customerPhone, customer_account AS customerAccount, cashier_name AS cashierName FROM sales WHERE id = ?", [Number(id)]);
  if (!sale) throw new Error("Sale receipt was not found.");
  sale.items = rows("SELECT product_name AS name, variant_description AS variantDescription, quantity, unit_price AS unitPrice, line_total AS lineTotal, price_currency AS priceCurrency, unit_price_original AS unitPriceOriginal, line_total_original AS lineTotalOriginal, exchange_rate AS exchangeRate FROM sale_items WHERE sale_id = ? ORDER BY id", [Number(id)]);
  sale.exchangeRate = USD_TO_LBP;
  sale.subtotalLbp = sale.items.reduce((sum, item) => sum + Math.round(Number(item.lineTotalOriginal) * (item.priceCurrency === "LBP" ? 1 : Number(item.exchangeRate || USD_TO_LBP))), 0);
  return paymentLedger.enrich("sale",sale);
}

async function initializeDatabase() {
  const databaseWasmPath=wasmPath || require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => databaseWasmPath });
  databasePath = path.join(dataDirectory, "isp-desk.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const mainDatabaseExists=fs.existsSync(databasePath);
  database = mainDatabaseExists ? new SQL.Database(fs.readFileSync(databasePath)) : new SQL.Database();

  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'cashier', 'viewer', 'attendance_operator')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency IN ('USD', 'LBP')),
      cost REAL NOT NULL,
      markup REAL NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 5,
      track_quantity INTEGER NOT NULL DEFAULT 1,
      print_color_price REAL NOT NULL DEFAULT 0,
      print_single_price REAL NOT NULL DEFAULT 0,
      print_double_price REAL NOT NULL DEFAULT 0,
      print_no_binding_price REAL NOT NULL DEFAULT 0,
      print_binding_price REAL NOT NULL DEFAULT 0,
      print_plain_price REAL NOT NULL DEFAULT 0,
      print_canson_price REAL NOT NULL DEFAULT 0,
      print_sticker_price REAL NOT NULL DEFAULT 0,
      print_price_table TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      barcode TEXT NOT NULL UNIQUE,
      is_primary INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      subtotal REAL NOT NULL,
      cost_total REAL NOT NULL,
      profit REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'paid',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      customer_account TEXT NOT NULL DEFAULT '',
      settled_at TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cashier_name TEXT
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      price_currency TEXT NOT NULL DEFAULT 'USD',
      unit_price_original REAL NOT NULL DEFAULT 0,
      line_total_original REAL NOT NULL DEFAULT 0,
      exchange_rate REAL NOT NULL DEFAULT 90000,
      variant_description TEXT NOT NULL DEFAULT '',
      printing_options TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      supplier TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL,
      category TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      total REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      recorded_by TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_receipt_id INTEGER NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_no TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      rfid_card TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fibernetlb_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK(service_type IN ('Internet', 'Satellite')),
      allowance TEXT NOT NULL,
      price REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_url TEXT NOT NULL DEFAULT 'https://fibernetlb.net/bundles',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fibernetlb_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      customer_account TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      service_type TEXT NOT NULL,
      bundle_code TEXT,
      bundle_name TEXT,
      bundle_details TEXT,
      bundle_price REAL,
      bundle_cost REAL,
      billing_period TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'paid',
      settled_at TEXT,
      reference TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cashier_name TEXT
    );
    CREATE TABLE IF NOT EXISTS telecom_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL CHECK(provider IN ('Alfa', 'touch / MTC')),
      name TEXT NOT NULL,
      face_value REAL NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      cost REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS telecom_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL CHECK(provider IN ('Alfa', 'touch / MTC', 'Ogero')),
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('Refill', 'Bill', 'Airtime', 'Validity')),
      phone TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_details TEXT NOT NULL DEFAULT '',
      billing_period TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      cost REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'paid',
      settled_at TEXT,
      reference TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cashier_name TEXT
    );
    CREATE TABLE IF NOT EXISTS cash_drawer_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_time ON attendance_records(employee_id, clock_in);
    CREATE INDEX IF NOT EXISTS idx_attendance_clock_in ON attendance_records(clock_in);
    CREATE INDEX IF NOT EXISTS idx_fibernetlb_bills_paid_at ON fibernetlb_bills(paid_at);
    CREATE INDEX IF NOT EXISTS idx_fibernetlb_bills_customer ON fibernetlb_bills(customer_account, customer_name);
    CREATE INDEX IF NOT EXISTS idx_fibernetlb_bundles_type ON fibernetlb_bundles(service_type, active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_telecom_catalog_provider ON telecom_catalog(provider, active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_telecom_payments_paid_at ON telecom_payments(paid_at);
    CREATE INDEX IF NOT EXISTS idx_telecom_payments_phone ON telecom_payments(phone, provider);
    CREATE INDEX IF NOT EXISTS idx_cash_drawer_created_at ON cash_drawer_transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_date ON purchase_receipts(purchase_date);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_receipt ON purchase_receipt_items(purchase_receipt_id);
  `);

  const usersTableSql = String(one("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")?.sql ?? "");
  if (!usersTableSql.includes("attendance_operator")) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'cashier', 'viewer', 'attendance_operator')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users_new (id, username, full_name, password_hash, password_salt, role, active, created_at)
      SELECT id, username, full_name, password_hash, password_salt, role, active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  const salesColumns = rows("PRAGMA table_info(sales)").map((column) => column.name);
  if (!salesColumns.includes("user_id")) database.exec("ALTER TABLE sales ADD COLUMN user_id INTEGER");
  if (!salesColumns.includes("cashier_name")) database.exec("ALTER TABLE sales ADD COLUMN cashier_name TEXT");
  if (!salesColumns.includes("payment_status")) database.exec("ALTER TABLE sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'");
  if (!salesColumns.includes("customer_name")) database.exec("ALTER TABLE sales ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''");
  if (!salesColumns.includes("customer_phone")) database.exec("ALTER TABLE sales ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''");
  if (!salesColumns.includes("customer_account")) database.exec("ALTER TABLE sales ADD COLUMN customer_account TEXT NOT NULL DEFAULT ''");
  if (!salesColumns.includes("settled_at")) database.exec("ALTER TABLE sales ADD COLUMN settled_at TEXT");
  const productColumns = rows("PRAGMA table_info(products)").map((column) => column.name);
  if (!productColumns.includes("track_quantity")) database.exec("ALTER TABLE products ADD COLUMN track_quantity INTEGER NOT NULL DEFAULT 1");
  if (!productColumns.includes("currency")) database.exec("ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
  if (!productColumns.includes("print_color_price")) database.exec("ALTER TABLE products ADD COLUMN print_color_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_single_price")) database.exec("ALTER TABLE products ADD COLUMN print_single_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_double_price")) database.exec("ALTER TABLE products ADD COLUMN print_double_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_no_binding_price")) database.exec("ALTER TABLE products ADD COLUMN print_no_binding_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_binding_price")) database.exec("ALTER TABLE products ADD COLUMN print_binding_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_plain_price")) database.exec("ALTER TABLE products ADD COLUMN print_plain_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_canson_price")) database.exec("ALTER TABLE products ADD COLUMN print_canson_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_sticker_price")) database.exec("ALTER TABLE products ADD COLUMN print_sticker_price REAL NOT NULL DEFAULT 0");
  if (!productColumns.includes("print_price_table")) database.exec("ALTER TABLE products ADD COLUMN print_price_table TEXT NOT NULL DEFAULT ''");
  if (productColumns.includes("print_duplex_extra")) database.run("UPDATE products SET print_double_price = print_duplex_extra WHERE print_double_price = 0");
  if (productColumns.includes("print_binding_extra")) database.run("UPDATE products SET print_binding_price = print_binding_extra WHERE print_binding_price = 0");
  if (productColumns.includes("print_canson_extra")) database.run("UPDATE products SET print_canson_price = print_canson_extra WHERE print_canson_price = 0");
  if (productColumns.includes("print_sticker_extra")) database.run("UPDATE products SET print_sticker_price = print_sticker_extra WHERE print_sticker_price = 0");
  database.run("UPDATE products SET currency = 'USD' WHERE currency IS NULL OR currency NOT IN ('USD', 'LBP')");
  database.run("UPDATE products SET track_quantity = 0, quantity = 0, reorder_level = 0 WHERE lower(category) IN ('printing', 'maintenance')");
  database.run("UPDATE products SET print_color_price = price WHERE lower(category) = 'printing' AND print_color_price = 0");
  database.run("UPDATE products SET print_price_table = ? WHERE lower(category) = 'printing' AND (print_price_table IS NULL OR trim(print_price_table) = '')", [JSON.stringify(DEFAULT_PRINT_PRICE_TABLE)]);
  const saleItemColumns = rows("PRAGMA table_info(sale_items)").map((column) => column.name);
  if (!saleItemColumns.includes("category")) database.exec("ALTER TABLE sale_items ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  if (!saleItemColumns.includes("price_currency")) database.exec("ALTER TABLE sale_items ADD COLUMN price_currency TEXT NOT NULL DEFAULT 'USD'");
  if (!saleItemColumns.includes("unit_price_original")) database.exec("ALTER TABLE sale_items ADD COLUMN unit_price_original REAL NOT NULL DEFAULT 0");
  if (!saleItemColumns.includes("line_total_original")) database.exec("ALTER TABLE sale_items ADD COLUMN line_total_original REAL NOT NULL DEFAULT 0");
  if (!saleItemColumns.includes("exchange_rate")) database.exec(`ALTER TABLE sale_items ADD COLUMN exchange_rate REAL NOT NULL DEFAULT ${USD_TO_LBP}`);
  if (!saleItemColumns.includes("variant_description")) database.exec("ALTER TABLE sale_items ADD COLUMN variant_description TEXT NOT NULL DEFAULT ''");
  if (!saleItemColumns.includes("printing_options")) database.exec("ALTER TABLE sale_items ADD COLUMN printing_options TEXT NOT NULL DEFAULT ''");
  database.run("UPDATE sale_items SET category = COALESCE((SELECT category FROM products WHERE products.id = sale_items.product_id), 'Uncategorized') WHERE category = ''");
  database.run("UPDATE sale_items SET price_currency = 'USD' WHERE price_currency IS NULL OR price_currency NOT IN ('USD', 'LBP')");
  database.run("UPDATE sale_items SET unit_price_original = unit_price WHERE unit_price_original = 0 AND unit_price <> 0");
  database.run("UPDATE sale_items SET line_total_original = line_total WHERE line_total_original = 0 AND line_total <> 0");
  const expenseColumns = rows("PRAGMA table_info(expenses)").map((column) => column.name);
  if (!expenseColumns.includes("user_id")) database.exec("ALTER TABLE expenses ADD COLUMN user_id INTEGER");
  if (!expenseColumns.includes("source_type")) database.exec("ALTER TABLE expenses ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'");
  if (!expenseColumns.includes("source_id")) database.exec("ALTER TABLE expenses ADD COLUMN source_id INTEGER");
  database.exec("CREATE INDEX IF NOT EXISTS idx_expenses_source ON expenses(source_type, source_id)");
  const billColumns = rows("PRAGMA table_info(fibernetlb_bills)").map((column) => column.name);
  if (!billColumns.includes("bundle_code")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN bundle_code TEXT");
  if (!billColumns.includes("bundle_name")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN bundle_name TEXT");
  if (!billColumns.includes("bundle_details")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN bundle_details TEXT");
  if (!billColumns.includes("bundle_price")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN bundle_price REAL");
  if (!billColumns.includes("bundle_cost")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN bundle_cost REAL");
  if (!billColumns.includes("payment_status")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'");
  if (!billColumns.includes("settled_at")) database.exec("ALTER TABLE fibernetlb_bills ADD COLUMN settled_at TEXT");
  const bundleColumns = rows("PRAGMA table_info(fibernetlb_bundles)").map((column) => column.name);
  if (!bundleColumns.includes("cost")) database.exec("ALTER TABLE fibernetlb_bundles ADD COLUMN cost REAL NOT NULL DEFAULT 0");

  for (const category of DEFAULT_EXPENSE_CATEGORIES) ensureExpenseCategory(database,category);
  for (const category of rows("SELECT DISTINCT category FROM expenses WHERE trim(category) <> ''")) ensureExpenseCategory(database,category.category);

  // Seed only a genuinely new database. Imported catalog prices, names,
  // inactive rows and timestamps belong to the business and survive startup.
  if(!mainDatabaseExists){
    for(const bundle of FIBERNETLB_BUNDLES)database.run("INSERT INTO fibernetlb_bundles (code, name, service_type, allowance, price, cost, currency, active, sort_order, source_url) VALUES (?, ?, ?, ?, ?, 0, 'USD', 1, ?, 'https://fibernetlb.net/bundles')",[bundle.code,bundle.name,bundle.serviceType,bundle.allowance,bundle.price,bundle.sortOrder]);
    for(const refill of TELECOM_REFILLS)database.run("INSERT INTO telecom_catalog (code, provider, name, face_value, details, price, cost, currency, active, sort_order, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', 1, ?, ?)",[refill.code,refill.provider,refill.name,refill.value,refill.details,refill.price??refill.value,refill.price??refill.value,refill.sortOrder,refill.sourceUrl]);
  }

  const existingProducts = rows("SELECT id FROM products WHERE id NOT IN (SELECT product_id FROM product_barcodes)");
  for (const product of existingProducts) database.run("INSERT INTO product_barcodes (product_id, barcode, is_primary) VALUES (?, ?, 1)", [product.id, generateBarcode()]);
  saveDatabase();
  initializeBusinessSections(SQL);
  await initializeAdminWarehouse();
  await initializeAdminCommerce();
  invoiceVoids=new InvoiceVoidService.InvoiceVoids({entries:workspaceDatabases,sections:WORKSPACES,authorize:invoiceVoidAdmin,now:localIso,saveEntry:saveSectionEntry,backup:()=>backupAllSections('before-pos-invoice-deletion'),destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),assertReady:()=>{
    if(!adminWarehouse)throw Error(warehouseDeferredReason||'Restore Admin stock before reversing an invoice.');
    assertWarehouseIdle();for(const section of WORKSPACES){assertNoBandwidthPending(section.id);assertNoWalletReconciliationPending(section.id);if(Finance.pendingActions(workspaceDatabases.get(section.id).db).length)throw Error('Reconcile unfinished money actions before deleting an invoice.');}
  }});
}

function reportCsv(startDate, endDate, posCategoryInput = "", sectionInput = "") {
  requirePermission("reports.view");
  if (activeWorkspace().id === "main" && currentUser().role === "section_user" && !sectionInput) sectionInput = "all";
  if (sectionInput) {
    const blocks = reportTargets(sectionInput).map(({section,user}) => requestContext.run({ workspaceId: section.id, user }, () => `SECTION,\"${section.name}\"\r\n${reportCsv(startDate, endDate, posCategoryInput).contents}`));
    return { filename: `FIBER-net-lb-${sectionInput}-${startDate}-to-${endDate}.csv`, contents: blocks.join("\r\n\r\n") };
  }
  const posCategory = String(posCategoryInput ?? "").trim();
  const categoryClause = posCategory ? " AND si.category = ?" : "";
  const sales = rows(`
    SELECT s.id, s.invoice_no AS invoice, s.created_at AS date, s.customer_name AS customer, s.customer_phone AS phone,
           s.customer_account AS account, s.cashier_name AS cashier, s.payment_method AS payment,
           s.payment_status AS status, GROUP_CONCAT(DISTINCT si.category) AS categories,
           ROUND(SUM(si.line_total), 2) AS revenue,
           ROUND(SUM(si.unit_cost * si.quantity), 2) AS cost,
           ROUND(SUM(si.line_total - (si.unit_cost * si.quantity)), 2) AS profit
    FROM sales s JOIN sale_items si ON si.sale_id = s.id
    WHERE date(s.created_at) BETWEEN ? AND ?${categoryClause}
    GROUP BY s.id ORDER BY s.created_at
  `, posCategory ? [startDate, endDate, posCategory] : [startDate, endDate]).map(item => { const payment=paymentLedger.details("sale",item.id); return {...item,payment:payment.paymentMethod,status:payment.paymentStatus}; });
  const bills = rows("SELECT id, receipt_no AS receipt, paid_at AS date, customer_account AS account, customer_name AS customer, service_type AS service, bundle_name AS bundle, bundle_details AS bundleDetails, bundle_price AS listPrice, COALESCE(bundle_cost, 0) AS cost, ROUND(amount - COALESCE(bundle_cost, 0), 2) AS profit, billing_period AS billingPeriod, payment_method AS payment, payment_status AS status, amount, cashier_name AS cashier FROM active_fibernetlb_bills WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at", [startDate, endDate]).map(item => { const payment=paymentLedger.details("bill",item.id); return {...item,payment:payment.paymentMethod,status:payment.paymentStatus,renewedBy:renewalLedger.details(item.id).requestedBy||""}; });
  const telecom = rows("SELECT id, receipt_no AS receipt, paid_at AS date, provider, transaction_type AS transactionType, phone, customer_name AS customer, item_name AS item, item_details AS details, billing_period AS billingPeriod, payment_method AS payment, payment_status AS status, amount, cost, ROUND(amount - cost, 2) AS profit, cashier_name AS cashier FROM telecom_payments WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at", [startDate, endDate]).map(item => { const payment=paymentLedger.details("telecom",item.id); return {...item,payment:payment.paymentMethod,status:payment.paymentStatus}; });
  const expenses = rows(`
    SELECT e.expense_date AS date, e.category, e.description, e.amount,
           CASE WHEN e.source_type = 'purchase_receipt' THEN 'Purchase receipt' WHEN e.source_type='optional_whish_fee' THEN 'Optional Whish fee' ELSE 'Manual' END AS source,
           CASE WHEN e.source_type='optional_whish_fee' THEN e.source_id ELSE COALESCE((SELECT receipt_no FROM purchase_receipts WHERE id = e.source_id), '') END AS reference
    FROM expenses e WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date, e.id
  `, [startDate, endDate]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = ["REPORT CURRENCY,USD", `LBP conversion rate,1 USD = ${USD_TO_LBP} LBP`, "", "POS SALES", `POS category filter,${quote(posCategory || "All categories")}`, "Invoice,Date,Customer,Phone,Account,Cashier,Payment,Status,Categories,Revenue USD,Cost USD,Profit USD", ...sales.map((sale) => [sale.invoice, sale.date, sale.customer, sale.phone, sale.account, sale.cashier, sale.payment, sale.status, sale.categories, sale.revenue, sale.cost, sale.profit].map(quote).join(",")), "", "FIBERNETLB BILLS", "Receipt,Date,Account,Customer,Service,Bundle,Bundle Details,List Price USD,Billing Period,Payment,Status,Amount USD,Cost USD,Profit USD,Cashier,Renewed by staff", ...bills.map((bill) => [bill.receipt, bill.date, bill.account, bill.customer, bill.service, bill.bundle, bill.bundleDetails, bill.listPrice, bill.billingPeriod, bill.payment, bill.status, bill.amount, bill.cost, bill.profit, bill.cashier, bill.renewedBy].map(quote).join(",")), "", "TELECOM AND OGERO", "Receipt,Date,Provider,Type,Phone,Customer,Item,Details,Billing Period,Payment,Status,Amount USD,Cost USD,Profit USD,Cashier", ...telecom.map((entry) => [entry.receipt, entry.date, entry.provider, entry.transactionType, entry.phone, entry.customer, entry.item, entry.details, entry.billingPeriod, entry.payment, entry.status, entry.amount, entry.cost, entry.profit, entry.cashier].map(quote).join(",")), "", "EXPENSES", "Date,Category,Description,Source,Reference,Amount USD", ...expenses.map((expense) => [expense.date, expense.category, expense.description, expense.source, expense.reference, expense.amount].map(quote).join(","))];
  const suffix = posCategory ? `-${posCategory.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  const summary=localHandlers.get("reports:summary")(null,startDate,endDate,posCategory);
  if (summary.unknownPrintingUnits) lines.unshift(`PRINTING COST NOTE,${quote(`${summary.unknownPrintingUnits} non-stock units (${money(summary.unknownPrintingRevenue)} USD revenue) have unknown cost. Direct costs exclude these unmeasured costs; profit is before those costs.`)}`, "");
  return { filename: `ISP-report-${startDate}-to-${endDate}${suffix}.csv`, contents: profitBreakdownCsv(summary)+"\r\n"+lines.join("\r\n") + paymentLedger.csv(summary)+installationCsv(summary) };
}

function billCsv(startDate, endDate) {
  requirePermission("bills.view");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("Choose a valid bill date range.");
  const bills = listBills(startDate, endDate);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    "FIBERNETLB BILLS",
    `From,${quote(startDate)},To,${quote(endDate)}`,
    "",
    "Receipt,Recorded,Customer username,Customer name,Phone,Service,Bundle,Bundle details,Billing month,Payment method,Status,Amount USD,Cost USD,Profit USD,Reference,Cashier,Paid USD,Remaining USD,Cash paid USD,Whish Money paid USD,Internet renewal,Portal service,Previous expiry,New expiry,Renewal note,Renewal months,Confirmed renewal cycles,Fixed monthly cost USD,Proradius internal cost at save USD,Profit cost source,Renewed by staff",
    ...bills.map((bill) => [bill.receiptNo, bill.paidAt, bill.customerAccount, bill.customerName, bill.phone, bill.serviceType, bill.bundleName, bill.bundleDetails, bill.billingPeriod, bill.paymentMethod, bill.paymentStatus, money(bill.amount), money(bill.bundleCost || 0), money(Number(bill.amount) - Number(bill.bundleCost || 0)), bill.reference, bill.cashierName, bill.paidAmount, bill.remainingAmount, bill.cashPaid, bill.whishPaid, bill.renewal.state, bill.renewal.service, bill.renewal.beforeExpiry, bill.renewal.afterExpiry, bill.renewal.message, bill.renewalMonths, bill.renewal.completedMonths??0, bill.portalFixedMonthlyCost??"", bill.portalInternalCost??"", bill.portalCostSource,bill.renewal.requestedBy||""].map(quote).join(","))
  ];
  lines.push('','WHISH MONEY DESTINATIONS','Receipt,Destination name,Destination number,Gross USD,Fee USD,Net collected USD');
  for(const bill of bills){for(const p of [bill.whishDestination,...(bill.paymentHistory||[]).map(p=>p.whishDestination)].filter(Boolean))lines.push([bill.receiptNo,p.label,p.number,p.gross,p.fee,p.netCollected].map(quote).join(','));}
  return { filename: `FibernetLB-bills-${startDate}-to-${endDate}.csv`, contents: `\uFEFF${lines.join("\r\n")}` };
}

function seedWorkspaceCatalog(db) {
  for (const category of DEFAULT_EXPENSE_CATEGORIES) ensureExpenseCategory(db,category);
  for (const b of FIBERNETLB_BUNDLES) db.run("INSERT OR IGNORE INTO fibernetlb_bundles (code,name,service_type,allowance,price,cost,currency,sort_order) VALUES (?,?,?,?,?,0,'USD',?)", [b.code,b.name,b.serviceType,b.allowance,b.price,b.sortOrder]);
  for (const r of TELECOM_REFILLS) db.run("INSERT OR IGNORE INTO telecom_catalog (code,provider,name,face_value,details,price,cost,currency,sort_order,source_url) VALUES (?,?,?,?,?,?,?,'USD',?,?)", [r.code,r.provider,r.name,r.value,r.details,r.price ?? r.value,r.price ?? r.value,r.sortOrder,r.sourceUrl]);
}

function initializeBusinessSections(SQL) {
  const core = database;
  workspaceDatabases.set("main", { db: core, path: databasePath });
  const schema = rows("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END");
  const users = rows("SELECT * FROM users");
  const directory = path.join(dataDirectory, "sections");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const section of WORKSPACES.filter(item => item.id !== "main")) {
    const file = path.join(directory, `${section.id}.sqlite`);
    const exists = fs.existsSync(file);
    const db = exists ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    if (!exists) {
      for (const entry of schema) db.exec(entry.sql);
      for (const user of users) db.run("INSERT INTO users (id,username,full_name,password_hash,password_salt,role,active,created_at) VALUES (?,?,?,?,?,?,?,?)", [user.id,user.username,user.full_name,user.password_hash,user.password_salt,user.role,user.active,user.created_at]);
      seedWorkspaceCatalog(db);
    }
    db.exec("PRAGMA foreign_keys = ON");
    workspaceDatabases.set(section.id, { db, path: file });
    if (!exists) writePrivateFile(file, Buffer.from(db.export()));
  }
  database = new Proxy(core, { get(_target, key) {
    const selected = workspaceDatabases.get(activeSession().workspaceId)?.db || core;
    const value = selected[key];
    return typeof value === "function" ? value.bind(selected) : value;
  } });
  const studioEntry=workspaceDatabases.get('studio');
  if(Finance.query(studioEntry.db,"SELECT id FROM products WHERE lower(trim(category))='photos and shooting' AND track_quantity<>0 LIMIT 1").length){
    backupAllSections('pre-studio-photo-services');
    studioEntry.db.run("UPDATE products SET track_quantity=0 WHERE lower(trim(category))='photos and shooting'");
    writePrivateFile(studioEntry.path,Buffer.from(studioEntry.db.export()));
  }
  sectionAccess = new SectionAccess(workspaceDatabases, WORKSPACES, entry => writePrivateFile(entry.path, Buffer.from(entry.db.export())), backupAllSections);
  sectionAccess.initialize();
  if([...workspaceDatabases.values()].some(entry=>needsSupportRole(entry.db)))backupAllSections('before-support-role');
  for(const entry of workspaceDatabases.values()){migrateSupportRole(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  const staffRoot=workspaceDatabases.get('main');
  if(!staffRoot.db.exec("SELECT name FROM sqlite_master WHERE name='staff_feature_permissions'").length)backupAllSections('pre-staff-feature-permissions');
  staffPermissions=new StaffPermissions(staffRoot.db,()=>{
    const temporary=`${staffRoot.path}.pending`;
    writePrivateFile(temporary,Buffer.from(staffRoot.db.export()));fs.renameSync(temporary,staffRoot.path);
  });
  staffPermissions.initialize();
  const missingResellers = [...workspaceDatabases.values()].some(entry => !entry.db.exec("SELECT name FROM sqlite_master WHERE name = 'resellers'").length);
  if (missingResellers) backupAllSections("pre-reseller-directory");
  for (const entry of workspaceDatabases.values()) { initializeResellers(entry.db); writePrivateFile(entry.path,Buffer.from(entry.db.export())); }
  const needsPayments=[...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='debt_payments'").length);
  if(needsPayments)backupAllSections("pre-partial-payments");
  if([...workspaceDatabases.values()].some(entry=>['fibernetlb_bills','sales','telecom_payments'].some(table=>!entry.db.exec(`PRAGMA table_info(${table})`)[0].values.some(column=>column[1]==="reset_id"))))backupAllSections("pre-business-receipt-archives");
  if([...workspaceDatabases].some(([id,entry])=>InvoiceVoidService.needsMigration(entry.db,{main:id==='main'})))backupAllSections('before-pos-invoice-deletion-schema');
  for(const [id,entry]of workspaceDatabases){InvoiceVoidService.initialize(entry.db,{main:id==='main'});initializeBillReset(entry.db);}
  for(const entry of workspaceDatabases.values()) {initializePayments(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  const needsRenewals = [...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='internet_renewals'").length);
  if (needsRenewals) backupAllSections("pre-internet-renewals");
  else if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='internet_plan_changes'").length)) backupAllSections("pre-portal-plan-changes");
  else if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("PRAGMA table_info(fibernetlb_bills)")[0].values.some(column=>column[1]==="renewal_months")))backupAllSections("pre-multi-month-renewals");
  else if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='internet_renewal_costs'").length))backupAllSections('pre-live-renewal-costs');
  for (const entry of workspaceDatabases.values()) { initializeRenewals(entry.db); writePrivateFile(entry.path,Buffer.from(entry.db.export())); }
  if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='portal_operations'").length))backupAllSections("pre-portal-money-and-charges");
  for(const entry of workspaceDatabases.values()){initializePortalOperations(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='installation_payments'").length))backupAllSections('pre-customer-registration');
  for(const entry of workspaceDatabases.values()){initializeCustomerRegistration(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>!entry.db.exec("SELECT name FROM sqlite_master WHERE name='payment_destinations'").length))backupAllSections('pre-whish-destinations');
  for(const entry of workspaceDatabases.values()){Whish.initializeWhish(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>needsActivityMigration(entry.db)))backupAllSections('pre-user-activity-isolation');
  for(const entry of workspaceDatabases.values()){initializeActivity(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>needsExpenseMigration(entry.db)))backupAllSections('pre-expense-editing');
  for(const [id,entry] of workspaceDatabases){initializeExpenses(entry.db);if(id==='printer')for(const category of PAPER_CATEGORIES)ensureExpenseCategory(entry.db,category);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>!Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE name='finance_months'").length))backupAllSections('pre-monthly-finance-ledgers');
  for(const entry of workspaceDatabases.values()){Finance.initializeFinance(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  const optionalFeeEntry=workspaceDatabases.get('fiber-resellers');if(OptionalWhishFees.needsMigration(optionalFeeEntry.db)){backupAllSections('before-optional-reseller-whish-fees');optionalFeeEntry.db.exec('BEGIN');try{OptionalWhishFees.initialize(optionalFeeEntry.db);optionalFeeEntry.db.exec('COMMIT');}catch(error){optionalFeeEntry.db.exec('ROLLBACK');throw error;}writePrivateFile(optionalFeeEntry.path,Buffer.from(optionalFeeEntry.db.export()));}
  const bandwidthRoot=workspaceDatabases.get('main');
  if(Bandwidth.needsMigration(bandwidthRoot.db)||[...workspaceDatabases].some(([id,entry])=>BandwidthPaymentService.needsMigration(entry.db,{main:id==='main'}))){
    backupAllSections('before-bandwidth-accounting');
    for(const [id,entry]of workspaceDatabases){entry.db.exec('BEGIN');try{if(id==='main'){Bandwidth.initialize(entry.db);ensureExpenseCategory(entry.db,'Bandwidth cost');}BandwidthPaymentService.initialize(entry.db,{main:id==='main'});entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  bandwidthPayments=new BandwidthPaymentService.BandwidthPayments({entries:workspaceDatabases,authorize:bandwidthAdmin,saveEntry:saveSectionEntry,now:localIso,assertReady:(section,requestId)=>{assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section,requestId);}});
  if([...workspaceDatabases].some(([id,entry])=>FixedMonthlyService.needsMigration(entry.db,{main:id==='main'}))){
    backupAllSections('before-fixed-monthly-payments');
    for(const [id,entry]of workspaceDatabases){entry.db.exec('BEGIN');try{FixedMonthlyService.initialize(entry.db,{main:id==='main'});entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  fixedMonthlyPayments=new FixedMonthlyService.FixedMonthlyPayments({entries:workspaceDatabases,authorize:fixedMonthlyAdmin,holders:fixedMonthlyHolders,saveEntry:saveSectionEntry,now:localIso,backup:reason=>backupAllSections(reason),assertReady:(section,requestId)=>{assertInvoiceVoidIdle();assertWarehouseIdle();assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section);assertNoFixedMonthlyPending(section,requestId);}});
  if([...workspaceDatabases].some(([id,entry])=>CompanyDebtService.needsMigration(entry.db,{main:id==='main'}))){
    backupAllSections('before-company-debts');
    for(const [id,entry]of workspaceDatabases){entry.db.exec('BEGIN');try{CompanyDebtService.initialize(entry.db,{main:id==='main'});entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  companyDebts=new CompanyDebtService.CompanyDebts({entries:workspaceDatabases,authorize:companyDebtAdmin,holders:fixedMonthlyHolders,monthly:fixedMonthlyPayments,queueOwner:fixedMonthlyPayments,saveEntry:saveSectionEntry,now:localIso,backup:reason=>backupAllSections(reason),assertReady:(section,requestId)=>{assertInvoiceVoidIdle();assertWarehouseIdle();assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section);assertNoFixedMonthlyPending(section,requestId);}});
  if([...workspaceDatabases.values()].some(entry=>BankService.needsMigration(entry.db))){
    backupAllSections('before-business-bank-accounts');
    for(const entry of workspaceDatabases.values()){entry.db.exec('BEGIN');try{BankService.initialize(entry.db);entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  bankAccounts=new BankService.BankAccounts({entries:workspaceDatabases,sections:WORKSPACES,authorize:bankAdmin,holders:bankHolders,destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),saveEntry:saveSectionEntry,now:localIso,assertReady:section=>{assertCommerceIdle();assertInvoiceVoidIdle();assertWarehouseIdle();assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section);assertNoFixedMonthlyPending(section);}});
  if([...workspaceDatabases.values()].some(entry=>MonthClosingService.needsMigration(entry.db))){
    backupAllSections('before-month-closing-carry-forward');
    for(const entry of workspaceDatabases.values()){entry.db.exec('BEGIN');try{MonthClosingService.initialize(entry.db);entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  monthClosing=new MonthClosingService.MonthClosing({entries:workspaceDatabases,sections:WORKSPACES,authorize:monthClosingAdmin,holders:section=>moneyHolders(section,monthClosingAdmin),destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),saveEntry:saveSectionEntry,now:localIso,backup:reason=>backupAllSections(reason),snapshot:monthClosingSnapshot,assertReady:section=>{bankAccounts?.assertIdle();assertCommerceIdle();assertInvoiceVoidIdle();assertWarehouseIdle();assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section);assertNoFixedMonthlyPending(section);assertMonthClosingTransfersReady(section);}});
  monthClosingAll=new MonthClosingAll({service:monthClosing});
  if([...workspaceDatabases].some(([id,entry])=>AdminTransferService.needsMigration(entry.db,{main:id==='main'}))){
    backupAllSections('before-admin-money-transfers');
    for(const [id,entry]of workspaceDatabases){entry.db.exec('BEGIN');try{AdminTransferService.initialize(entry.db,{main:id==='main'});entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}saveSectionEntry(entry);}
  }
  adminMoneyTransfers=new AdminTransferService.AdminMoneyTransfers({entries:workspaceDatabases,sections:WORKSPACES,authorize:adminTransferAdmin,holders:adminTransferHolders,destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),saveEntry:saveSectionEntry,now:localIso,assertReady:section=>{bankAccounts?.assertIdle();monthClosing?.assertIdle();assertCommerceIdle();assertInvoiceVoidIdle();assertWarehouseIdle();assertNoWalletReconciliationPending(section);assertNoBandwidthPending(section);assertNoFixedMonthlyPending(section);}});
  const notesEntry=workspaceDatabases.get('main');
  if(StickyNotesService.needsMigration(notesEntry.db)){backupAllSections('before-private-sticky-notes');notesEntry.db.exec('BEGIN');try{StickyNotesService.initialize(notesEntry.db);notesEntry.db.exec('COMMIT');}catch(error){notesEntry.db.exec('ROLLBACK');throw error;}saveSectionEntry(notesEntry);}
  stickyNotes=new StickyNotesService.StickyNotes({db:notesEntry.db,authorize:notesOwner,now:localIso,saveEntry:()=>saveSectionEntry(notesEntry)});
  if(FixedMonthlyCategories.needsMigration(workspaceDatabases.get('main').db)){
    backupAllSections('before-fixed-monthly-categories');
    const entry=workspaceDatabases.get('main');entry.db.exec('BEGIN');
    try{FixedMonthlyCategories.initialize(entry.db);entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}
    saveSectionEntry(entry);
  }
  fixedMonthlyCategories=new FixedMonthlyCategories.FixedMonthlyCategories({monthly:fixedMonthlyPayments,authorize:fixedMonthlyAdmin,saveEntry:saveSectionEntry,now:localIso,backup:reason=>backupAllSections(reason)});
  fixedMonthlyPayments.categoryCatalog=fixedMonthlyCategories;
  // The former receipt-fee reversal must not run under the receipt-time policy.
  // Existing snapshots and paid cash-outs remain immutable; only surviving
  // fee-free custody is corrected below, after all journal schemas are ready.
  if([...workspaceDatabases.values()].some(entry=>!Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE name='finance_receipt_copies'").length))backupAllSections('before-support-accounting');
  for(const entry of workspaceDatabases.values()){SupportLedger.initializeSupport(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  if([...workspaceDatabases.values()].some(entry=>!Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE name='reseller_funds'").length))backupAllSections('before-reseller-funding-ledger');
  for(const entry of workspaceDatabases.values()){ResellerAccounting.initialize(entry.db);writePrivateFile(entry.path,Buffer.from(entry.db.export()));}
  const resellerEntry=workspaceDatabases.get('fiber-resellers');ResellerAccounting.start(resellerEntry.db,workspaceDatabases.get('fiber-users').db,localIso());writePrivateFile(resellerEntry.path,Buffer.from(resellerEntry.db.export()));
  if(!Finance.query(resellerEntry.db,"SELECT name FROM sqlite_master WHERE name='reseller_collections'").length)backupAllSections('before-reseller-pay-bill');
  ResellerCollections.initialize(resellerEntry.db);saveSectionEntry(resellerEntry);
  if(!Finance.query(resellerEntry.db,"SELECT name FROM sqlite_master WHERE name='reseller_wallet_reconciliations'").length)backupAllSections('before-older-reseller-wallet-reconciliation-schema');
  ResellerWalletReconciliation.initialize(resellerEntry.db);saveSectionEntry(resellerEntry);
  if(!Finance.query(resellerEntry.db,"SELECT name FROM sqlite_master WHERE name='reseller_admin_wallet_corrections'").length)backupAllSections('before-admin-whish-collection-correction-schema');
  ResellerAdminWalletCorrections.initialize(resellerEntry.db);saveSectionEntry(resellerEntry);
  if([...workspaceDatabases.values()].some(entry=>!Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE name='finance_receipt_fee_policy_audit'").length))backupAllSections('before-whish-receipt-fee-policy');
  for(const entry of workspaceDatabases.values()){
    ReceiptFees.initialize(entry.db);
    entry.db.exec("CREATE VIEW IF NOT EXISTS active_expenses AS SELECT e.* FROM expenses e WHERE e.source_type<>'whish_receipt_migration' OR e.source_type IS NULL OR EXISTS(SELECT 1 FROM active_whish_fee_migration_audit a WHERE a.id=e.source_id)");
    saveSectionEntry(entry);
  }
  if([...workspaceDatabases.values()].some(entry=>!Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE name='finance_whish_gross_restorations'").length))backupAllSections('before-whish-gross-wallet-policy');
  for(const entry of workspaceDatabases.values()){WalletGross.initialize(entry.db);saveSectionEntry(entry);}
  refreshWhishReceiptPolicy();
  supportAccountingReady=true;
  activityDatabase=scopedDatabase(database,activityUser,()=>workspaceDatabases.get(activeSession().workspaceId)?.db||database);
  paymentLedger=new PaymentLedger(activityDatabase,activityUser,()=>workspaceDatabases.get(activeWorkspace().id).db);
  const actorScope={key:()=>sectionAccess.key(currentUser(),activeSession().workspaceId),scope:()=>currentUser()?.role==='admin'?null:sectionAccess.key(currentUser(),activeSession().workspaceId)||'__no_owner__'};
  portalApi = new ProradiusApi(new PortalSettings(path.join(dataDirectory,"internet-api-settings.json"),safeStorage),providerFetch);
  portalApi.billingOnly=true;
  renewalLedger = new RenewalLedger(database,portalApi,saveDatabase,authorizeInternet);
  planLedger = new PlanChangeLedger(database,portalApi,saveDatabase,()=>authorizeInternet('plans.manage'),actorScope);
  operationLedger = new PortalOperationLedger(database,saveDatabase,authorizePortalOperation,actorScope);
  resellerFunding=new ResellerFundingService({entries:workspaceDatabases,api:()=>portalApi,ledger:()=>operationLedger,now:localIso,
    authorize:authorizeResellerFunding,canManage:()=>hasPermission('resellerFunding.manage')&&hasPermission('drawer.manage'),
    receiverKey:resellerRecipientKey,cashiers:resellerCashiers,
    destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),roster:()=>sectionAccess.roster('fiber-users'),
    member:(key,section='fiber-users')=>sectionAccess.forWorkspace({account_key:String(key)},section),
    save:saveSectionEntry});
  resellerCollections=new ResellerCollections.ResellerCollections({entries:workspaceDatabases,now:localIso,
    authorizeAdmin:authorizeResellerCollection,cashiers:resellerCashiers,
    member:(key,section)=>sectionAccess.forWorkspace({account_key:String(key)},section),
    destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),
    receiver:()=>sectionAccess.forWorkspace({account_key:resellerRecipientKey()},'fiber-resellers'),save:saveSectionEntry});
  resellerWalletReconciliation=new ResellerWalletReconciliation.ResellerWalletReconciliation({entries:workspaceDatabases,now:localIso,
    authorizeAdmin:authorizeResellerCollection,collections:resellerCollections,
    member:(key,section)=>sectionAccess.forWorkspace({account_key:String(key)},section),
    destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),
    backup:()=>backupAllSections('before-older-reseller-whish-reconciliation'),save:saveSectionEntry});
  resellerAdminWalletCorrections=new ResellerAdminWalletCorrections.ResellerAdminWalletCorrections({entries:workspaceDatabases,now:localIso,
    authorizeAdmin:authorizeResellerCollection,collections:resellerCollections,
    member:(key,section)=>sectionAccess.forWorkspace({account_key:String(key)},section),
    destinations:()=>Whish.listDestinations(workspaceDatabases.get('main').db,true),
    backup:()=>backupAllSections('before-admin-whish-collection-correction'),save:saveSectionEntry});
  startFixedCostSync();
}

function reportTargets(selection = "all") {
  requirePermission("reports.view");
  if (activeWorkspace().id !== "main") throw new Error("Open Main dashboard to view reports across sections.");
  const user = currentUser();
  if (user.role === "admin") return (selection === "all" ? WORKSPACES : [workspace(selection)]).map(section => ({section,user}));
  const ids = sectionAccess.ids(user,"main");
  const allowed = WORKSPACES.filter(section => section.id === "main" ? ids.includes("main-expenses") : ids.includes(section.id));
  if (selection !== "all" && !allowed.some(section => section.id === selection)) throw new Error("You do not have report access to this section.");
  return allowed.filter(section => selection === "all" || section.id === selection).map(section => {
    const selected = sectionAccess.forWorkspace(user, section.id);
    // Map the stable account key to each database's local ID. Never carry a
    // Main numeric ID or an admin-wide scope into a cashier's combined report.
    return {section,user:{...selected,role:"viewer"}};
  });
}

function warehouseAdmin(){
  if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection)throw Error('Only the signed-in Main administrator can manage owned stock and collect business product debts.');
  const user=sectionAccess.forWorkspace(currentUser(),'main');
  if(!user?.active||user.role!=='admin')throw Error('Current Main administrator access is required.');
  return user;
}
function warehouseHasTable(id,name){const db=workspaceDatabases.get(id)?.db;return !!db&&Finance.query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]).length>0;}
function assertInvoiceVoidIdle(){
  if(invoiceVoids)return invoiceVoids.assertIdle();
  const root=workspaceDatabases.get('main');
  if(root&&warehouseHasTable('main','pos_invoice_void_journal')&&InvoiceVoidService.pending(root.db).length)throw Error('Finish the saved invoice deletion from Main dashboard before changing money, stock or verified totals.');
}
function invoiceVoidAdmin(id){
  const caller=currentUser();
  if(!caller||caller.role!=='admin'||caller.activity_inspection)throw Error('Only Admin can delete POS invoices.');
  const fresh=sectionAccess.forWorkspace(caller,'main');
  if(!fresh?.active||fresh.role!=='admin'||!sectionAccess.permitted(fresh,'main'))throw Error('Active Main administrator access is required to reverse stock and financial records.');
  if(id!==undefined){
    workspace(id);
    if(id!=='main'&&activeWorkspace().id!=='main'&&activeWorkspace().id!==id)throw Error('Delete invoices only in the original business or from Main dashboard.');
    const source=sectionAccess.forWorkspace(fresh,id);if(!source?.active||source.role!=='admin'||!sectionAccess.permitted(source,id))throw Error('Current Admin access to the original invoice business is required.');
  }
  return fresh;
}
function registerInvoiceVoidHandlers(){
  for(const method of ['preview','remove','status','resume','pending'])registerHandler('invoiceVoids:'+method,(_event,...args)=>{
    if(!invoiceVoids)throw Error('Update Main and this PC together before deleting invoices.');
    if(method==='pending'){if(args.length)throw Error('Invoice recovery accepts no selectors.');invoiceVoidAdmin();return invoiceVoids.pending().filter(row=>{if(activeWorkspace().id!=='main'&&row.workspaceId!==activeWorkspace().id)return false;try{invoiceVoidAdmin(row.workspaceId);return true;}catch{return false;}});}
    if(args.length!==1)throw Error('Choose one original POS invoice or saved deletion request.');
    invoiceVoidAdmin();
    const savedScope=['status','resume'].includes(method)&&typeof args[0]?.requestId==='string'?Finance.query(workspaceDatabases.get('main').db,'SELECT workspace_id FROM pos_invoice_void_journal WHERE request_id=?',[args[0].requestId])[0]?.workspace_id:null;
    const target=['preview','remove'].includes(method)?args[0]?.workspaceId:savedScope;
    if(target&&activeWorkspace().id!=='main'&&target!==activeWorkspace().id)throw Error('Delete or recover invoices only in their original business or from Main dashboard.');
    const result=invoiceVoids[method](args[0]);
    if(method==='remove'||method==='resume')return Promise.resolve(result).then(value=>{if(value?.state==='completed')refreshWhishReceiptPolicy();return value;});
    return result;
  });
}
function assertWarehouseIdle(){
  assertCommerceIdle();
  if(adminWarehouse)return adminWarehouse.assertIdle(activeSession().stockPurchaseRequestId||undefined);
  if(warehouseHasTable('main','admin_warehouse_intents')&&Finance.query(workspaceDatabases.get('main').db,"SELECT request_id FROM admin_warehouse_intents WHERE state<>'completed' LIMIT 1").length)throw Error('A saved Admin-stock operation needs recovery before financial changes. Restore storage access and restart Main; never replace its saved request.');
}
function assertCommerceIdle(){
  const session=activeSession();
  if(sharedMaintenance)sharedMaintenance.assertReady(session.maintenanceRequestId||null);
  else for(const [id,entry] of workspaceDatabases)if(warehouseHasTable(id,'shared_maintenance_operations')&&Finance.query(entry.db,"SELECT request_id FROM shared_maintenance_operations WHERE state<>'completed' LIMIT 1").length)throw Error('Resume the saved Maintenance request before changing money or verified totals.');
  if(fundedStockPurchases)fundedStockPurchases.assertReady(session.stockPurchaseRequestId||undefined);
  else if(warehouseHasTable('main','funded_stock_purchase_intents')&&Finance.query(workspaceDatabases.get('main').db,"SELECT request_id FROM funded_stock_purchase_intents WHERE state<>'completed' LIMIT 1").length)throw Error('Resume the saved stock purchase before changing money or verified totals.');
}
function commerceExternalReady(ownId,kind){
  const trusted={...activeSession(),[kind==='maintenance'?'maintenanceRequestId':'stockPurchaseRequestId']:ownId};
  return requestContext.run(trusted,()=>{
    adminMoneyTransfers?.assertIdle();bankAccounts?.assertIdle();monthClosing?.assertIdle();assertWarehouseIdle();assertInvoiceVoidIdle();assertNoFixedMonthlyPending('main');
    for(const section of WORKSPACES){
      assertNoBandwidthPending(section.id);assertNoWalletReconciliationPending(section.id);
      const pending=Finance.pendingActions(workspaceDatabases.get(section.id).db).filter(row=>!(row.requestId===ownId&&row.source===(kind==='maintenance'?'shared_maintenance':'funded_stock_purchase')));
      if(pending.length)throw Error('Finish or reconcile the original unfinished money operation first.');
    }
  });
}
function stockSourceOptions(input={}){
  commerceExternalReady(undefined,'stock');
  const actor=warehouseAdmin(),businesses=WORKSPACES.filter(section=>{try{fixedMonthlyAdmin(section.id);return true;}catch{return false;}}).map(({id,name})=>({id,name}));
  const id=String(input.workspaceId||'main');if(!businesses.some(row=>row.id===id))throw Error('Choose an authorized paying business.');
  const entry=workspaceDatabases.get(id),destinations=Whish.listDestinations(workspaceDatabases.get('main').db,true);
  const employees=fixedMonthlyHolders(id).map(user=>({accountKey:user.account_key,userId:user.id,fullName:user.full_name,role:user.role,cashBalance:Finance.drawerBalance(entry.db,user.id),wallets:Finance.walletBalances(entry.db,destinations,user.account_key).filter(wallet=>wallet.active).map(({id,label,number,balance})=>({id,label,number,balance,active:true}))}));
  return {businesses,workspaceId:id,employees,today:localIso().slice(0,10),admin:{accountKey:actor.account_key,fullName:actor.full_name}};
}
function stockPrepareSource(plan){
  warehouseAdmin();const id=workspace(plan.sourceWorkspaceId).id,entry=workspaceDatabases.get(id),holder=fixedMonthlyHolders(id).find(user=>user.account_key===plan.sourceAccountKey);
  if(!holder)throw Error('The original source money holder is no longer eligible. No other holder was substituted.');
  const destinations=Whish.listDestinations(workspaceDatabases.get('main').db,true),wallet=plan.paymentMethod==='Whish Money'?destinations.find(row=>row.id===plan.sourceWalletId&&row.active):null;
  if(plan.paymentMethod==='Whish Money'&&!wallet)throw Error('Choose an active original Whish wallet.');
  const balance=wallet?Finance.walletBalances(entry.db,destinations,holder.account_key).find(row=>row.id===wallet.id)?.balance:Finance.drawerBalance(entry.db,holder.id);
  return {workspaceId:id,accountKey:holder.account_key,userId:holder.id,fullName:holder.full_name,role:holder.role,paymentMethod:plan.paymentMethod,wallet:wallet?{id:wallet.id,label:wallet.label,number:wallet.number}:null,balanceCents:EmployeeDashboard.cents(balance,true)};
}
function maintenanceReceipt(id,actor,saleId){
  // Request recovery always returns the original receipt, including after an
  // authorized cancellation/archive. It must never invent a replacement sale.
  const db=workspaceDatabases.get(id).db,person=sectionAccess.forWorkspace({account_key:actor.accountKey},id);
  const sale=Finance.query(db,'SELECT id,invoice_no AS invoiceNo,created_at AS createdAt,subtotal,cost_total AS costTotal,profit,payment_method AS paymentMethod,payment_status AS paymentStatus,settled_at AS settledAt,customer_name AS customerName,customer_phone AS customerPhone,customer_account AS customerAccount,cashier_name AS cashierName,reset_id FROM sales WHERE id=?',[saleId])[0];
  if(!sale)throw Error('The original Maintenance receipt is unavailable.');
  sale.items=Finance.query(db,'SELECT product_name AS name,variant_description AS variantDescription,quantity,unit_price AS unitPrice,line_total AS lineTotal,price_currency AS priceCurrency,unit_price_original AS unitPriceOriginal,line_total_original AS lineTotalOriginal,exchange_rate AS exchangeRate FROM sale_items WHERE sale_id=? ORDER BY id',[saleId]);
  const ledger=new PaymentLedger(db,()=>({...person,financial_ownership:true}),()=>db);ledger.readTables.sale='sales';
  const deleted=warehouseHasTable(id,'pos_invoice_voids')&&Finance.query(db,'SELECT sale_id FROM pos_invoice_voids WHERE sale_id=?',[saleId]).length>0,readOnly=Boolean(sale.reset_id||deleted||id!==activeWorkspace().id);
  sale.exchangeRate=USD_TO_LBP;sale.subtotalLbp=Math.round(sale.subtotal*USD_TO_LBP);delete sale.reset_id;
  return {...ledger.enrich('sale',sale),workspaceId:id,workspaceName:workspace(id).name,invoiceDeleted:deleted,adminReceivableReadOnly:readOnly};
}
async function initializeAdminCommerce(){
  if(!adminWarehouse)return;
  const root=workspaceDatabases.get('main'),ids=['main','fiber-users','fiber-resellers'];
  if(ids.some(id=>SharedMaintenance.needsMigration(workspaceDatabases.get(id).db,{main:id==='main'})))await backupAllSections('before-shared-maintenance');
  sharedMaintenance=SharedMaintenance.createSharedMaintenance({entries:workspaceDatabases,now:localIso,saveEntry:saveSectionEntry,destinations:()=>Whish.listDestinations(root.db,true),
    authorize:(action,id)=>{const person=action==='save'?warehouseAdmin():action==='list'?warehouseReadActor(id):warehouseSaleActor(id);return {...person,id:person.id??person.userId,active:true};},
    assertWritable:(_id,ownId)=>commerceExternalReady(ownId,'maintenance'),
    receipt:maintenanceReceipt
  }).initialize();
  for(const id of ids)saveSectionEntry(workspaceDatabases.get(id));
  fundedStockPurchases=FundedStockPurchases.createFundedPurchases({db:root.db,entries:workspaceDatabases,sections:WORKSPACES,now:localIso,saveMain:()=>saveSectionEntry(root),saveEntry:saveSectionEntry,authorizeAdmin:warehouseAdmin,sourceOptions:stockSourceOptions,prepareSource:stockPrepareSource,
    stockSnapshot:keys=>keys.map(key=>{const row=Finance.query(root.db,'SELECT * FROM admin_warehouse_products WHERE product_key=?',[key])[0];if(!row)throw Error('Warehouse product not found.');return {productKey:key,name:JSON.parse(row.product_json).name,quantity:row.quantity,acquisitionCents:row.acquisition_cents,version:row.version,active:row.active};}),
    receiveStock:input=>adminWarehouse.purchase(input),assertOpen:(id,date)=>warehouseBridge.assertOpen(id,date),backup:()=>backupAllSections('before-paid-stock-purchase'),assertExternalReady:ownId=>commerceExternalReady(ownId,'stock')});
  await fundedStockPurchases.initialize();
}
function registerCommerceHandlers(){
  for(const method of ['list','save','checkoutOptions','checkout','status','pending','resume'])registerHandler('maintenance:'+method,(_event,...args)=>{
    if(!sharedMaintenance)throw Error(warehouseDeferredReason||'Update Main before using shared Maintenance.');
    if(args.length!==1)throw Error('Choose one Maintenance business or original request.');
    const callerWorkspace=activeWorkspace().id,result=sharedMaintenance[method](args[0]);
    const decorate=value=>value?.receipt?{...value,receipt:{...value.receipt,adminReceivableReadOnly:value.receipt.adminReceivableReadOnly===true||value.workspaceId!==callerWorkspace}}:value;
    return result&&typeof result.then==='function'?result.then(decorate):decorate(result);
  });
  for(const method of ['options','preview','purchase','status','pending','resume','history'])registerHandler('stockPurchases:'+method,(_event,...args)=>{
    warehouseAdmin();if(!fundedStockPurchases)throw Error(warehouseDeferredReason||'Update Main before purchasing stock.');
    if(['pending','history'].includes(method)){if(args.length)throw Error('Saved stock purchases accept no selectors.');return fundedStockPurchases[method]();}
    if(method==='options'&&(!args.length||args.length===1&&args[0]==null))return fundedStockPurchases.options();
    if(args.length!==1)throw Error('Choose one original stock purchase.');return fundedStockPurchases[method](args[0]);
  });
}
function warehouseSaleActor(id){
  const caller=currentUser();
  if(!caller||caller.activity_inspection)throw Error('Sign in with your own POS account.');
  if(id!==activeWorkspace().id&&(activeWorkspace().id!=='main'||caller.role!=='admin'))throw Error('Sell products only for your current business.');
  if(id==='main'&&caller.role!=='admin')throw Error('Main Office POS is for Admin.');
  const user=sectionAccess.forWorkspace(caller,workspace(id).id);
  if(!user?.active||!sectionAccess.permitted(user,id))throw Error('Active access to the selling business is required.');
  const permissions=requestContext.run({workspaceId:id,user},()=>userPermissions(user));
  if(!permissions.includes('sales.create')||!['admin','manager','cashier','support'].includes(user.role))throw Error('Your current role cannot sell Admin stock.');
  return {accountKey:user.account_key,userId:user.id,role:user.role,fullName:user.full_name,username:user.username};
}
function warehouseReadActor(id){
  const caller=currentUser();
  if(!caller||caller.activity_inspection)throw Error('Sign in to view product stock.');
  if(id!==activeWorkspace().id&&(activeWorkspace().id!=='main'||caller.role!=='admin'))throw Error('View physical stock only for your assigned business.');
  if(id==='main'&&caller.role!=='admin')throw Error('Main Office stock is for Admin.');
  const user=sectionAccess.forWorkspace(caller,workspace(id).id);
  if(!user?.active||!sectionAccess.permitted(user,id)||!requestContext.run({workspaceId:id,user},()=>userPermissions(user).includes('products.read')))throw Error('Product read access is required.');
  return {accountKey:user.account_key,userId:user.id,role:user.role,fullName:user.full_name,username:user.username};
}
async function initializeAdminWarehouse(){
  if(whishPolicyPendingSaves.size){warehouseDeferredReason='An older Whish custody correction has not been safely saved. Fix storage access, review its original correction and restart Main before using Admin stock or changing financial records. No new stock migration was applied.';return;}
  const root=workspaceDatabases.get('main');
  if(!Finance.query(root.db,"SELECT name FROM sqlite_master WHERE name='admin_warehouse_products'").length)backupAllSections('before-admin-owned-stock');
  else if(!Finance.query(root.db,"SELECT name FROM sqlite_master WHERE name='admin_warehouse_product_requests'").length)backupAllSections('before-admin-stock-product-requests');
  warehouseBridge=createWarehouseBridge({entries:workspaceDatabases,sections:WORKSPACES,authorizeAdmin:warehouseAdmin,authorizeSale:warehouseSaleActor,
    member:(key,id)=>sectionAccess.forWorkspace({account_key:String(key)},id),destinations:()=>Whish.listDestinations(root.db,true),save:saveSectionEntry,now:localIso,
    receipt:saleReceipt,run:(id,user,task)=>requestContext.run({workspaceId:id,user},task)});
  warehouseBridge.initialize();
  for(const entry of workspaceDatabases.values())saveSectionEntry(entry);
  adminWarehouse=createWarehouse({db:root.db,sections:WORKSPACES,now:localIso,saveMain:()=>saveSectionEntry(root),authorizeAdmin:warehouseAdmin,authorizeSale:warehouseSaleActor,authorizeRead:warehouseReadActor,canReadAcquisition:()=>activeWorkspace().id==='main'&&currentUser()?.role==='admin'&&!currentUser()?.activity_inspection,
    maintenanceServices:id=>{if(!sharedMaintenance)throw Error('Shared Maintenance is not ready. Refresh after Main finishes loading.');return sharedMaintenance.list({workspaceId:id}).services;},
    readOpenings:()=>WORKSPACES.flatMap(section=>requestContext.run({workspaceId:section.id,user:null},()=>listProducts().filter(product=>product.trackQuantity).map(product=>({workspaceId:section.id,productId:product.id,product})))),
    prepareSale:operation=>warehouseBridge.prepareSale(operation),prepareTransfer:operation=>warehouseBridge.prepareTransfer(operation),
    commitSale:operation=>warehouseBridge.commitSale(operation),settleTransfer:operation=>warehouseBridge.settleTransfer(operation),assertOpen:(id,date)=>warehouseBridge.assertOpen(id,date)});
  await adminWarehouse.initialize();
}
function registerWarehouseHandlers(){
  for(const method of ['list','create','update','purchase','setOffer','checkout','status','debts','collect','pending','resume'])registerHandler('warehouse:'+method,(_event,...args)=>{
    if(!adminWarehouse)throw Error(warehouseDeferredReason||'Update the Main PC before using Admin stock.');
    if(method==='purchase'&&!Finance.query(workspaceDatabases.get('main').db,'SELECT request_id FROM admin_warehouse_purchases WHERE request_id=?',[typeof args[0]?.requestId==='string'?args[0].requestId:'']).length)throw Error('Use Main dashboard → Purchase products and choose its actual business Cash/Whish source. Original saved stock receipts remain replayable.');
    if(method==='debts'){if(args.length)throw Error('This saved product ledger accepts no selectors.');}
    else if(method==='pending'){if(args.length>1)throw Error('Choose at most one selling-business recovery scope.');}
    else if(args.length!==1)throw Error('Choose one set of product details.');
    if(['create','update','purchase','setOffer','checkout','collect','resume'].includes(method)){
      assertNoBandwidthPending('main');assertNoWalletReconciliationPending(activeWorkspace().id);
    }
    const callerWorkspace=activeWorkspace().id;
    if(method==='checkout'&&args[0]?.registrationId){
      const input=args[0],id=workspace(input.workspaceId).id,person=warehouseSaleActor(id),user=sectionAccess.forWorkspace({account_key:person.accountKey},id);
      const customer=requestContext.run({workspaceId:id,user},()=>{authorizePortalOperation('create');const parent=operationLedger.get(String(input.registrationId));if(parent?.kind!=='create'||parent.state!=='succeeded')throw Error('Complete the original customer registration first.');return JSON.parse(parent.input_json);});
      args=[{...input,customerName:customer.name,customerPhone:customer.phone,customerAccount:customer.username}];
    }
    const decorate=value=>{
      if(!value?.receipt||value.state!=='completed'||!value.workspaceId)return value;
      const id=workspace(value.workspaceId).id;
      return {...value,receipt:{...value.receipt,workspaceId:id,workspaceName:workspace(id).name,...value.deleted?{invoiceDeleted:true}:{},...id!==callerWorkspace?{adminReceivableReadOnly:true}:{}}};
    };
    const result=adminWarehouse[method](...args);return result&&typeof result.then==='function'?result.then(decorate):decorate(result);
  });
  registerHandler('warehouse:paymentOptions',(_event,input)=>warehouseBridge.paymentOptions(input));
  registerHandler('warehouse:checkoutOptions',(_event,input)=>{
    if(!input||Object.keys(input).length!==1||typeof input.workspaceId!=='string')throw Error('Choose one selling business.');
    warehouseSaleActor(input.workspaceId);
    if(!['main','fiber-users','fiber-resellers'].includes(input.workspaceId))throw Error('Only FIBER net lb Users and Resellers buy Admin stock. Open this business’s original service POS.');
    return {workspaceId:input.workspaceId,wallets:Whish.listDestinations(workspaceDatabases.get('main').db).map(({id,label,number})=>({id,label,number}))};
  });
  registerHandler('warehouse:receipt',(_event,input)=>{
    warehouseAdmin();if(!input||!Number.isSafeInteger(input.saleId)||input.saleId<1)throw Error('Choose a saved business product receipt.');
    const id=workspace(input.workspaceId).id,user=sectionAccess.forWorkspace(currentUser(),id),db=workspaceDatabases.get(id).db;
    if(!Finance.query(db,'SELECT request_id FROM warehouse_sale_links WHERE sale_id=?',[input.saleId]).length)throw Error('Choose an original product sale.');
    return requestContext.run({workspaceId:id,user},()=>({...saleReceipt(input.saleId),workspaceId:id,workspaceName:workspace(id).name,adminReceivableReadOnly:true}));
  });
}

function allSectionReport(startDate, endDate, category = "", selection = "all") {
  const result = combineReports(reportTargets(selection).map(({section,user}) => requestContext.run({ workspaceId: section.id, user }, () => ({ section, report: localHandlers.get("reports:summary")(null, startDate, endDate, category), drawer: cashDrawerSummary() }))));
  return {...result, activityScope: currentUser().role === "admin" ? "all" : "own", reportCurrency:"USD",exchangeRate:USD_TO_LBP};
}

function warehouseWholesaleProjection(start,end,category=''){
  // This private projection is used only by already-authorized Main reports.
  // No warehouse cost, raw journal or cross-business selector is exposed to POS staff.
  if(!warehouseHasTable('main','admin_warehouse_intents')||activeWorkspace().id!=='main')return null;
  const actor=currentUser(),db=workspaceDatabases.get('main').db;
  const original=Finance.query(db,'SELECT role FROM users WHERE account_key=?',[actor?.account_key])[0];
  const scopedAdmin=actor?.role!=='admin'&&original?.role==='admin';
  if(actor?.role!=='admin'&&!scopedAdmin)return null;
  const operations=Finance.query(db,"SELECT operation_json FROM admin_warehouse_intents i WHERE kind='checkout' AND state='completed' AND substr(created_at,1,10) BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM pos_invoice_void_warehouse v WHERE v.sale_request_id=i.request_id)",[start,end]).map(row=>JSON.parse(row.operation_json)).filter(row=>row.workspaceId!=='main');
  const daily=new Map();let wholesale=0,acquisition=0,count=0;
  for(const operation of operations){
    const items=operation.items.filter(item=>item.kind!=='maintenance'&&(!category||item.category===category));if(!items.length)continue;
    const cost=items.reduce((sum,item)=>sum+Math.round(item.lineAcquisition*100),0),revenue=items.reduce((sum,item)=>sum+Math.round(item.lineCost*100),0);
    if(!Number.isSafeInteger(cost)||!Number.isSafeInteger(revenue))throw Error('The saved wholesale report exceeds its supported range.');
    wholesale+=revenue;acquisition+=cost;count++;
    const day=operation.createdAt.slice(0,10),prior=daily.get(day)||{day,wholesaleRevenue:0,wholesaleCost:0,checkoutCount:0};prior.wholesaleRevenue+=revenue;prior.wholesaleCost+=cost;prior.checkoutCount++;daily.set(day,prior);
  }
  if(!Number.isSafeInteger(wholesale)||!Number.isSafeInteger(acquisition))throw Error('The wholesale report exceeds its supported range.');
  // Warehouse ownership is Main-wide. No verified allocation assigns this
  // wholesale markup to an individual Admin, including the signed-in owner.
  if(scopedAdmin)return count?{wholesaleAttributionUnavailable:true,profitUnavailableReason:'Admin warehouse wholesale has no verified employee ownership. Select All employees for the verified Main profit.',wholesaleAttributionDays:[...daily.keys()].sort()}:null;
  return {pendingCount:Finance.query(db,"SELECT request_id FROM admin_warehouse_intents WHERE state<>'completed'").length,wholesaleRevenue:wholesale/100,wholesaleCost:acquisition/100,wholesaleProfit:(wholesale-acquisition)/100,checkoutCount:count,daily:[...daily.values()].map(row=>({...row,wholesaleRevenue:row.wholesaleRevenue/100,wholesaleCost:row.wholesaleCost/100}))};
}
function warehousePurchaseFeeRows(start='1900-01-01',end='9999-12-31'){
  if(!warehouseHasTable('main','admin_warehouse_purchases')||activeWorkspace().id!=='main')return [];
  const scope=currentUser()?.role==='admin'?null:currentUser()?.account_key;
  return Finance.query(workspaceDatabases.get('main').db,'SELECT result_json,actor_key FROM admin_warehouse_purchases').filter(row=>!scope||row.actor_key===scope).map(row=>({...JSON.parse(row.result_json),actorKey:row.actor_key})).filter(row=>row.purchaseDate>=start&&row.purchaseDate<=end&&row.whishFee>0).map(row=>({id:'warehouse-fee:'+row.requestId,sourceId:row.requestId,sourceType:'optional_whish_fee',feeProfitOnly:true,expenseDate:row.purchaseDate,category:'Whish Money fees',description:'1% Whish fee · Admin stock purchase '+row.receiptNo,amount:row.whishFee,fee:row.whishFee,recordedBy:row.recordedBy,referenceNo:row.receiptNo,receivedAt:row.createdAt,actorKey:row.actorKey,profitOnly:true}));
}

// Inspection scopes never change the signed-in identity or grant employee management.
function financeContext(input,callback){
  requirePermission('reports.view');
  const caller=currentUser(),sourceId=activeWorkspace().id,id=String(input?.workspaceId||sourceId),section=workspace(id);
  if(id!==sourceId&&sourceId!=='main')throw Error('Open Main dashboard to select another business.');
  const selected=sectionAccess.forWorkspace(caller,id),entry=workspaceDatabases.get(id),admin=caller.role==='admin';
  const requested=String(input?.accountKey||'');
  if(!admin&&requested&&requested!==caller.account_key)throw Error('Only administrators can inspect another employee.');
  const roster=sectionAccess.roster(id).filter(u=>Finance.query(entry.db,'SELECT id FROM users WHERE account_key=?',[u.accountKey]).length&&(admin||u.allowedSections.includes(id)||id==='main'&&u.allowedSections.includes('main-expenses')));
  const safeRoster=roster.map(u=>({accountKey:u.accountKey,fullName:u.fullName,username:u.username,active:u.active,role:u.role,canReceive:u.active&&(u.allowedSections.includes(id)||id==='main'&&u.allowedSections.includes('main-expenses'))}));
  let viewed=selected;
  if(requested){const local=Finance.query(entry.db,'SELECT * FROM users WHERE account_key=?',[requested])[0];if(!local||!roster.some(u=>u.accountKey===requested))throw Error('This employee is not available in this business.');viewed={...local,role:'viewer',activity_inspection:true};}
  if(!admin)viewed={...selected,role:'viewer',activity_inspection:true};
  const debtReadAllowed=requestContext.run({workspaceId:id,user:selected},()=>hasPermission('debts.view'));
  return requestContext.run({workspaceId:id,user:viewed},()=>callback({entry,section,caller,selected,viewed,admin,debtReadAllowed,roster:safeRoster}));
}
function financeMember(ctx,key,{own=false}={}){
  const chosen=String(key||ctx.caller.account_key);
  if(!ctx.admin&&own&&chosen!==ctx.caller.account_key)throw Error('You can only hand over or move your own money.');
  const person=ctx.roster.find(u=>u.accountKey===chosen&&u.canReceive&&['admin','manager','cashier','support'].includes(u.role));
  if(!person||sectionAccess.isDeleted(chosen)||sectionAccess.roleConflict(chosen))throw Error('Choose an active, authorized employee for this business.');
  return sectionAccess.forWorkspace({account_key:chosen},ctx.section.id);
}
function dashboardSource(id){
  const entry=workspaceDatabases.get(id),section=workspace(id);
  if(!entry?.db)throw Error(`The required ${section.name} database is unavailable. No incomplete employee total was shown.`);
  const names=new Set(Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE type IN ('table','view')").map(row=>row.name));
  if(['users','active_sales','active_fibernetlb_bills','active_telecom_payments','debt_payments','payment_destinations','active_cash_drawer_transactions','finance_wallet_entries','finance_receipt_owners','finance_collection_owners'].some(name=>!names.has(name)))throw Error(`The required ${section.name} customer and custody ledger is incomplete. No incomplete employee total was shown.`);
  Finance.query(entry.db,'SELECT account_key FROM users LIMIT 1');return entry;
}
function dashboardReadReady(id){
  const entry=dashboardSource(id),status=whishReceiptPolicyStatus.get(id);
  if(Finance.pendingActions(entry.db).length||whishPolicyPendingSaves.has(id)||status?.deferred?.length)throw Error('Finish or reconcile pending custody operations in '+workspace(id).name+' before viewing verified employee totals.');
  assertWarehouseIdle();return entry;
}
function customerDebtOverview(id,accountKey,today){
  dashboardReadReady(id);
  // Warehouse customer checkouts already have one original native POS invoice.
  // The wholesale debt owed to Admin is a different liability, not added here.
  const types={sale:{table:'active_sales',amount:'subtotal'},bill:{table:'active_fibernetlb_bills',amount:'amount'},telecom:{table:'active_telecom_payments',amount:'amount'}},records=[];
  for(const row of listDebts(true)){
    const type=types[row.kind];if(!type)throw Error('The original customer debt type could not be verified.');
    const original=rows(`SELECT ${type.amount} AS amount${row.kind==='bill'?',service_type AS serviceType':''} FROM ${type.table} WHERE id=?`,[row.id]);
    if(original.length!==1)throw Error('The original customer debt could not be verified.');
    if(row.kind==='bill'&&original[0].serviceType==='Reseller transfer')continue;
    const principal=EmployeeDashboard.cents(original[0].amount),payments=Finance.query(workspaceDatabases.get(id).db,'SELECT amount_cents,payment_method FROM debt_payments WHERE kind=? AND record_id=?',[row.kind,row.id]);
    const collected=EmployeeDashboard.sum(payments.map(payment=>{if(!Number.isSafeInteger(payment.amount_cents)||payment.amount_cents<=0||!['Cash','Whish Money'].includes(payment.payment_method))throw Error('A saved customer collection could not be verified.');return payment.amount_cents;}));
    if(collected>principal||principal!==EmployeeDashboard.cents(row.originalAmount)||collected!==EmployeeDashboard.cents(row.paidAmount))throw Error('Saved customer collections do not match their original invoice.');
    records.push(row);
  }
  return EmployeeDashboard.customerDebts(records,{workspaceId:id,accountKey,asOf:today});
}
function availableCustomerDebtOverview(id,accountKey,today){
  // This additional card must not replace the existing Admin report's pending
  // state. Missing proof is unavailable (never zero); Staff All stays strict.
  try{return customerDebtOverview(id,accountKey,today);}catch{return undefined;}
}
function verifyEmployeeWalletSources(entry,key,today){
  const verify=value=>{let snapshot;try{snapshot=JSON.parse(value);}catch{throw Error('The saved employee wallet receipt could not be verified.');}if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||typeof snapshot.id!=='string'||!snapshot.id)throw Error('A saved employee Whish receipt has no verified wallet.');EmployeeDashboard.cents(snapshot.walletAmount??snapshot.netCollected,true);};
  for(const [kind,table,date]of [['sale','active_sales','created_at'],['bill','active_fibernetlb_bills','paid_at'],['telecom','active_telecom_payments','paid_at'],['installation','installation_payments','paid_at']]){
    for(const row of Finance.query(entry.db,`SELECT p.snapshot_json FROM ${table} b JOIN users u ON u.id=b.user_id LEFT JOIN payment_destinations p ON p.kind=? AND p.record_key=CAST(b.id AS TEXT) WHERE b.payment_method='Whish Money' AND u.account_key=? AND date(b.${date})<=?`,[kind,key,today]))verify(row.snapshot_json);
  }
  for(const row of Finance.query(entry.db,"SELECT d.kind,d.record_id,p.snapshot_json FROM debt_payments d JOIN users u ON u.id=d.user_id LEFT JOIN payment_destinations p ON p.kind='debt' AND p.record_key=d.id WHERE d.payment_method='Whish Money' AND u.account_key=? AND date(d.received_at)<=?",[key,today])){
    const table={sale:'active_sales',bill:'active_fibernetlb_bills',telecom:'active_telecom_payments'}[row.kind];if(!table)throw Error('A saved employee wallet collection has no verified customer receipt.');if(Finance.query(entry.db,`SELECT id FROM ${table} WHERE id=?`,[row.record_id]).length)verify(row.snapshot_json);
  }
}
function staffConsolidatedFinanceOverview(input){
  requirePermission('reports.view');const caller=currentUser();
  if(activeWorkspace().id!=='main'||caller?.activity_inspection)throw Error('Open Main dashboard with your own staff account to view assigned-business totals.');
  const authority=sectionAccess.forWorkspace(caller,'main'),key=authority.account_key,{policy,user:master}=sectionAccess.master(key),role=authority.role==='section_user'?authority.source_role:authority.role;
  if(!['cashier','support'].includes(role)||master.role!==role||!authority.active||sectionAccess.isDeleted(key)||sectionAccess.roleConflict(key))throw Error('Active Cashier or Support access is required for your assigned-business totals.');
  if(input.accountKey&&input.accountKey!==key)throw Error('You may view only your own assigned-business totals.');
  if(Object.keys(input).some(name=>!['workspaceId','accountKey'].includes(name)))throw Error('These totals accept only your own business and account scope.');
  let assigned;try{assigned=JSON.parse(policy.section_ids);}catch{throw Error('Your assigned business access could not be verified.');}
  if(!Array.isArray(assigned)||new Set(assigned).size!==assigned.length||assigned.some(id=>typeof id!=='string'||![...WORKSPACES.filter(section=>section.id!=='main').map(section=>section.id),...MAIN_AREAS.map(section=>section.id)].includes(id)))throw Error('Your assigned business access could not be verified.');
  if(policy.origin!=='main'&&assigned.some(id=>id.startsWith('main-')))throw Error('Your assigned Main Office access could not be verified.');
  const workspaceIds=WORKSPACES.filter(section=>section.id==='main'?policy.origin==='main'&&assigned.includes('main-expenses'):assigned.includes(section.id)).map(section=>section.id),today=localIso().slice(0,10),destinations=Whish.listDestinations(workspaceDatabases.get('main').db,true);
  const sources=workspaceIds.map(id=>{
    const entry=dashboardReadReady(id),selected=sectionAccess.forWorkspace(authority,id);
    if(!selected?.active||selected.account_key!==key||selected.role!==role)throw Error('An assigned business account could not be verified. No incomplete employee total was shown.');
    return requestContext.run({workspaceId:id,user:selected},()=>{
      for(const permission of ['reports.view','drawer.view','debts.view'])requirePermission(permission);
      const local=Finance.query(entry.db,'SELECT id,active,account_key FROM users WHERE account_key=?',[key]);if(local.length!==1||!local[0].active||local[0].id!==selected.id)throw Error('The assigned employee custody account could not be verified.');
      const cashRows=Finance.query(entry.db,'SELECT amount FROM active_cash_drawer_transactions WHERE user_id=? AND date(created_at)<=?',[selected.id,today]),cash=EmployeeDashboard.sum(cashRows.map(row=>EmployeeDashboard.cents(row.amount,true)))/100;
      if(cash!==Finance.drawerBalance(entry.db,selected.id,today))throw Error('The saved employee cash drawer could not be verified.');
      for(const row of Finance.query(entry.db,'SELECT amount_cents FROM finance_wallet_entries WHERE account_key=?',[key]))if(!Number.isSafeInteger(row.amount_cents))throw Error('The saved employee wallet ledger could not be verified.');
      verifyEmployeeWalletSources(entry,key,today);
      const wallets=Finance.walletBalances(entry.db,destinations,key,today);
      return requestContext.run({workspaceId:id,user:{...selected,role:'viewer',activity_inspection:true}},()=>({workspaceId:id,accountKey:key,cash,wallets,customerDebts:customerDebtOverview(id,key,today)}));
    });
  });
  return EmployeeDashboard.aggregate(sources,{workspaceIds,accountKey:key,asOf:today,employee:{accountKey:key,fullName:authority.full_name,username:authority.username,active:true,role}});
}
function consolidatedFinanceOverview(input){
  requirePermission('reports.view');const caller=currentUser();if(activeWorkspace().id!=='main'||caller?.role!=='admin')throw Error('Only the Main administrator can view the All businesses finance dashboard.');
  const authority=sectionAccess.forWorkspace(caller,'main');if(!authority?.active||authority.role!=='admin')throw Error('Main administrator access is required for consolidated reports.');
  // A missing required business is an error. An employee genuinely absent
  // from an otherwise healthy database is the only zero contribution.
  for(const section of WORKSPACES){const entry=workspaceDatabases.get(section.id);if(!entry?.db)throw Error(`The required ${section.name} database is unavailable. No incomplete consolidated total was shown.`);const present=new Set(Finance.query(entry.db,"SELECT name FROM sqlite_master WHERE type IN ('table','view')").map(row=>row.name));if(['users','expenses','active_sales','active_fibernetlb_bills','active_telecom_payments','installation_payments','cash_drawer_transactions','finance_wallet_entries','finance_months'].some(name=>!present.has(name)))throw Error(`The required ${section.name} accounting database is incomplete. No incomplete consolidated total was shown.`);Finance.query(entry.db,'SELECT account_key FROM users LIMIT 1');}
  const employees=sectionAccess.roster('main').map(person=>({accountKey:person.accountKey,fullName:person.fullName,username:person.username,active:person.active,role:person.role,canReceive:false,originWorkspaceId:person.originWorkspaceId})),accountKey=String(input.accountKey||'')||null;
  if(accountKey&&!employees.some(person=>person.accountKey===accountKey))throw Error('This employee is not available in any business.');
  const today=localIso().slice(0,10),start=today.slice(0,7)+'-01',destinations=Whish.listDestinations(workspaceDatabases.get('main').db,true);
  const policy=(id,entry)=>{const cached=whishReceiptPolicyStatus.get(id)||{deferred:[],warnings:[]},actions=Finance.pendingActions(entry.db),reasons=[...(cached.deferred||[]).map(row=>row.reason).filter(Boolean),...actions.map(row=>'Unfinished '+row.source+' custody or portal operation')];if(whishPolicyPendingSaves.has(id))reasons.push('A previous wallet correction is not safely saved yet.');return {policy:'profit_only',readOnly:true,additionalCashoutFee:0,deferred:reasons.length>0,warnings:cached.warnings||[],reason:[...new Set(reasons)].join('; ')};};
  const bandwidthCost=BandwidthSpending.purchaseSummary({entries:workspaceDatabases,start,end:today,accountKey}),bandwidthSpending=BandwidthSpending.summary({entries:workspaceDatabases,workspaceId:'fiber-resellers',start,end:today,accountKey});
  const contributions=WORKSPACES.map(section=>{const entry=workspaceDatabases.get(section.id),local=accountKey?Finance.query(entry.db,'SELECT * FROM users WHERE account_key=?',[accountKey])[0]:null,feePolicy=policy(section.id,entry),fixedMonthly=fixedMonthlySummary(start,today,accountKey,section.id),companyDebt=companyDebtSummary(start,today,accountKey,section.id);if(accountKey&&!local){const overview={...ConsolidatedFinance.emptyOverview(),fixedMonthly,companyDebt,whishFeePolicy:feePolicy,...section.id==='fiber-resellers'?{bandwidthCost,bandwidthSpending}:{}};overview.report=CompanyDebtSpending.applyToReport(FixedMonthlySpending.applyToReport({...overview.report,revenue:0,costOfGoods:0,grossProfit:0,expenses:0,netProfit:0,whishFees:0},fixedMonthly),companyDebt);return {section,overview:{...overview,dashboardTotals:ConsolidatedFinance.businessTotals(section,overview)}};}
    const selected=sectionAccess.forWorkspace(authority,section.id),viewed=accountKey?{...local,role:'viewer',activity_inspection:true}:selected;
    return requestContext.run({workspaceId:section.id,user:viewed,consolidatedFinanceRead:true,...accountKey?{consolidatedReadAuthority:authority.account_key}:{}},()=>{const overview={report:financeReport(start,today),fixedMonthly,companyDebt,bankCustody:BankService.custodySummary({db:entry.db,workspaceId:section.id,accountKey,through:today}),monthOpening:MonthOpeningCustody.summary({db:entry.db,workspaceId:section.id,accountKey,through:today}),adminTransferCustody:AdminTransferService.custodySummary({entries:workspaceDatabases,workspaceId:section.id,accountKey,through:today}),...section.id==='fiber-resellers'?{carriedResellerCollectionCustody:ResellerCarryCustody.custodySummary({entries:workspaceDatabases,workspaceId:section.id,accountKey,through:today})}:{},accountKey,today,wallets:Finance.walletBalances(entry.db,destinations,accountKey),dashboard:localHandlers.get('reports:dashboard')(null),whishFeePolicy:feePolicy,...['main','fiber-resellers'].includes(section.id)?{bandwidthCost}:{},...section.id==='fiber-resellers'?{bandwidthSpending}:{}},legacyFunding=rows("SELECT service_type AS serviceType,date(paid_at) AS day,amount,COALESCE(bundle_cost,0) AS cost FROM active_fibernetlb_bills WHERE service_type='Reseller transfer' AND date(paid_at) BETWEEN ? AND ?",[start,today]);overview.dashboardTotals=ConsolidatedFinance.businessTotals(section,overview);return {section,overview:ConsolidatedFinance.excludeLegacyFunding(overview,legacyFunding,{start,today})};});
  });
  const combined=ConsolidatedFinance.combine(contributions,{sections:WORKSPACES,employees,accountKey,today});
  let customerDebts;try{
    const debtSources=WORKSPACES.map(section=>{
      const entry=dashboardReadReady(section.id),local=accountKey?Finance.query(entry.db,'SELECT * FROM users WHERE account_key=?',[accountKey])[0]:null;
      if(accountKey&&!local)return {workspaceId:section.id,customerDebts:EmployeeDashboard.customerDebts([],{workspaceId:section.id,accountKey,asOf:today})};
      const selected=sectionAccess.forWorkspace(authority,section.id),viewed=accountKey?{...local,role:'viewer',activity_inspection:true}:selected;
      return requestContext.run({workspaceId:section.id,user:viewed},()=>({workspaceId:section.id,customerDebts:customerDebtOverview(section.id,accountKey,today)}));
    });
    customerDebts=EmployeeDashboard.mergeDebts(debtSources,{workspaceId:'all',accountKey,asOf:today});
  }catch{/* Preserve the established Admin report; this new card has no proof. */}
  return {...combined,...customerDebts?{customerDebts}:{},bandwidthCost,dashboard:{...combined.dashboard,bandwidthCost}};
}
function financeReport(start,end){return localHandlers.get('reports:summary')(null,start,end);}
function fixedMonthlySummary(start,end,accountKey=currentUser()?.role==='admin'?null:currentUser()?.account_key,workspaceId=activeWorkspace().id){
  const entry=workspaceDatabases.get(workspaceId),last=entry?Finance.latestMonth(entry.db):'',custodyStart=last?Finance.monthRange(last).opening.slice(0,10):'2000-01-01';
  return FixedMonthlySpending.summary({entries:workspaceDatabases,workspaceId,start,end,accountKey,custodyStart});
}
function companyDebtSummary(start,end,accountKey=currentUser()?.role==='admin'?null:currentUser()?.account_key,workspaceId=activeWorkspace().id){
  const entry=workspaceDatabases.get(workspaceId),last=entry?Finance.latestMonth(entry.db):'',custodyStart=last?Finance.monthRange(last).opening.slice(0,10):'2000-01-01';
  return CompanyDebtSpending.summary({entries:workspaceDatabases,workspaceId,start,end,accountKey,custodyStart});
}
function cashoutReport(start,end,paid){
  const user=currentUser(),key=user?.role==='admin'?null:user?.account_key;
  const whishCashouts=Finance.cashoutFees(workspaceDatabases.get(activeWorkspace().id).db,start,end,key);
  const cashoutFees=money(whishCashouts.reduce((sum,r)=>sum+r.fee,0));
  const resellerWhishPayments=ResellerAccounting.fundingFees(workspaceDatabases.get(activeWorkspace().id).db,start,end,key),resellerWhishFees=money(resellerWhishPayments.reduce((sum,r)=>sum+r.fee,0));
  const whishReceiptCorrections=ReceiptFees.listFees(workspaceDatabases.get(activeWorkspace().id).db,start,end,key),receiptMigrationFees=money(whishReceiptCorrections.reduce((sum,r)=>sum+r.fee,0));
  const whishWalletRestorations=WalletGross.listRestorations(workspaceDatabases.get(activeWorkspace().id).db,start,end,key);
  const optionalWhishPayments=OptionalWhishFees.report(workspaceDatabases.get(activeWorkspace().id).db,start,end,key),optionalWhishFees=money(optionalWhishPayments.reduce((sum,row)=>sum+row.fee,0));
  return {...paid,whishCashouts,cashoutFees,resellerWhishPayments,resellerWhishFees,whishReceiptCorrections,receiptMigrationFees,whishWalletRestorations,optionalWhishPayments,optionalWhishFees,whishFees:money((paid.whishFees||0)+cashoutFees+resellerWhishFees+receiptMigrationFees+optionalWhishFees)};
}
function monthlySnapshot(month){
  const range=Finance.monthRange(month),report=financeReport(range.start,range.end),days=new Map();
  const numeric=['revenue','posRevenue','serviceRevenue','serviceCost','serviceProfit','telecomRevenue','telecomCost','telecomProfit','costOfGoods','posCostOfGoods','posGrossProfit','grossProfit','saleCount','billCount','telecomCount','expenses','netProfit','cashPaid','whishPaid','otherPaid','periodDebt','paymentTotal','cashReceived','whishReceived','otherReceived','collectionsTotal','cashRefunded','whishRefunded','refundsTotal','installationIncome','whishFees','cashoutFees','receiptMigrationFees','grossWhishReceived','optionalWhishFees','maintenanceFunding','fundedStockFees'];
  for(let n=1;n<=Number(range.end.slice(-2));n++){const date=`${month}-${String(n).padStart(2,'0')}`;days.set(date,{date,report:{...Object.fromEntries(numeric.map(k=>[k,0])),outstandingDebt:report.outstandingDebt,debtCount:report.debtCount,debtAccounts:[],debtPayments:[],refundPayments:[],installationPayments:[],internetRenewals:[],whishPayments:[],recentSales:[],daily:[],profitParts:[],posCategory:'',reportCurrency:'USD',exchangeRate:USD_TO_LBP,_billParts:[]}});}
  const get=date=>days.get(String(date).slice(0,10))?.report;
  const debtMap=new Map((report.debtAccounts||[]).map(d=>[`${d.kind}:${d.id}`,d]));
  for(const [kind,type] of Object.entries({sale:{table:'sales',date:'created_at',total:'subtotal',cost:'cost_total'},bill:{table:'active_fibernetlb_bills',date:'paid_at',total:'amount',cost:'bundle_cost'},telecom:{table:'telecom_payments',date:'paid_at',total:'amount',cost:'cost'}}))for(const row of rows(`SELECT * FROM ${type.table} WHERE date(${type.date}) BETWEEN ? AND ?`,[range.start,range.end])){
    const d=get(row[type.date]),value=Number(row[type.total]),cost=Number(row[type.cost]||0),debt=debtMap.get(`${kind}:${row.id}`);d.revenue+=value;d.costOfGoods+=cost;d.grossProfit+=value-cost;d.paymentTotal+=value;
    if(kind==='sale'){d.posRevenue+=value;d.posCostOfGoods+=cost;d.posGrossProfit+=value-cost;d.saleCount++;}
    else if(kind==='bill'){d.serviceRevenue+=value;d.serviceCost+=cost;d.serviceProfit+=value-cost;d.billCount++;d._billParts.push({serviceType:row.service_type,revenue:value,cost});}
    else{d.telecomRevenue+=value;d.telecomCost+=cost;d.telecomProfit+=value-cost;d.telecomCount++;}
    if(debt){d.cashPaid+=debt.cashPaid;d.whishPaid+=debt.whishPaid;d.otherPaid+=debt.otherPaid;d.periodDebt+=debt.remainingAmount;}
    else if(row.payment_method==='Cash'){d.cashPaid+=value;d.cashReceived+=value;}
    else if(row.payment_method==='Whish Money')d.whishPaid+=value;
    else if(row.payment_method==='Unpaid')d.periodDebt+=value;
    else{d.otherPaid+=value;d.otherReceived+=value;}
  }
  for(const entry of rows('SELECT expense_date AS day,SUM(amount) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date',[range.start,range.end]))get(entry.day).expenses+=Number(entry.total);
  for(const entry of report.installationPayments||[]){const d=get(entry.paidAt);if(!d)continue;d.installationPayments.push(entry);d.installationIncome+=entry.amount;d.revenue+=entry.amount;d.grossProfit+=entry.amount;d.paymentTotal+=entry.amount;if(entry.paymentMethod==='Cash'){d.cashPaid+=entry.amount;d.cashReceived+=entry.amount;}else d.whishPaid+=entry.amount;}
  for(const entry of report.debtPayments||[]){const d=get(entry.receivedAt);if(!d)continue;d.debtPayments.push(entry);if(entry.paymentMethod==='Cash')d.cashReceived+=entry.amount;}
  for(const entry of report.whishPayments||[]){const d=get(entry.receivedAt);if(!d)continue;d.whishPayments.push(entry);d.whishReceived+=entry.netCollected;d.whishFees+=entry.fee;d.grossWhishReceived+=entry.amount;d.expenses+=entry.fee;}
  for(const entry of report.whishCashouts||[]){const d=get(entry.receivedAt);if(d){d.whishFees+=entry.fee;d.cashoutFees+=entry.fee;(d.whishCashouts||=[]).push(entry);}}
  for(const entry of report.resellerWhishPayments||[]){const d=get(entry.receivedAt);if(d){d.whishFees+=entry.fee;(d.resellerWhishPayments||=[]).push(entry);d.resellerWhishFees=(d.resellerWhishFees||0)+entry.fee;}}
  for(const entry of report.whishReceiptCorrections||[]){const d=get(entry.receivedAt);if(d){d.whishFees+=entry.fee;d.receiptMigrationFees+=entry.fee;(d.whishReceiptCorrections||=[]).push(entry);}}
  for(const entry of report.optionalWhishPayments||[]){const stockFee=entry.sourceType==='optional_whish_fee'&&String(entry.id||'').startsWith('warehouse-fee:'),d=get(stockFee?entry.expenseDate:entry.receivedAt);if(d){d.whishFees+=entry.fee;d.optionalWhishFees+=entry.fee;if(stockFee)d.expenses+=entry.fee;(d.optionalWhishPayments||=[]).push(entry);}}
  for(const entry of report.fundedStockFeePayments||[]){const d=get(entry.receivedAt);if(d){d.whishFees+=entry.fee;d.fundedStockFees+=entry.fee;d.expenses+=entry.fee;(d.fundedStockFeePayments||=[]).push(entry);}}
  for(const entry of report.maintenancePayments||[]){const d=get(entry.createdAt);if(d){d.maintenanceFunding+=entry.amount;(d.maintenancePayments||=[]).push(entry);}}
  for(const entry of report.whishWalletRestorations||[]){const d=get(entry.receivedAt);if(d)(d.whishWalletRestorations||=[]).push(entry);}
  for(const entry of report.refundPayments||[]){const d=get(entry.receivedAt);if(!d)continue;d.refundPayments.push(entry);d.refundsTotal+=entry.amount;if(entry.paymentMethod==='Cash')d.cashRefunded+=entry.amount;else d.whishRefunded+=entry.amount;}
  for(const entry of report.internetRenewals||[])get(entry.paidAt)?.internetRenewals.push(entry);
  for(const entry of report.recentSales||[])get(entry.createdAt)?.recentSales.push(entry);
  const printing=rows('SELECT date(s.created_at) AS day,si.printing_options AS printingOptions,si.quantity,si.line_total AS lineTotal FROM sales s JOIN sale_items si ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN ? AND ?',[range.start,range.end]);
  for(const {date,report:d} of days.values()){d.netProfit=d.grossProfit-d.expenses;d.collectionsTotal=d.cashReceived+d.whishReceived+d.otherReceived;d.daily=d.revenue||d.grossProfit?[{day:date,revenue:money(d.revenue),profit:money(d.grossProfit)}]:[];d.profitParts=profitBreakdown({revenue:d.posRevenue,costOfGoods:d.posCostOfGoods},d._billParts,{telecomRevenue:d.telecomRevenue,telecomCost:d.telecomCost},d.expenses,d.installationIncome);delete d._billParts;Object.assign(d,PrintingPricing.unknownCostSummary(printing.filter(p=>p.day===date)));for(const k of numeric)d[k]=money(d[k]);}
  if(report.internalWholesaleProjection===true)for(const {date,report:d}of days.values()){
    const row=(report.internalWholesaleDaily||[]).find(value=>value.day===date),revenue=Number(row?.revenue||0),cost=Number(row?.acquisitionCost||0),profit=money(revenue-cost),count=Number(row?.count||0);
    Object.assign(d,WarehouseAccounting.internalWholesaleReport(d,{wholesaleRevenue:revenue,wholesaleCost:cost,wholesaleProfit:profit,checkoutCount:count,daily:row?[{day:date,wholesaleRevenue:revenue,wholesaleCost:cost,wholesaleProfit:profit,checkoutCount:count}]:[]}));
  }
  if(report.wholesaleAttributionUnavailable===true)for(const {date,report:d}of days.values())if(report.wholesaleAttributionDays?.includes(date))Object.assign(d,{wholesaleAttributionUnavailable:true,profitUnavailableReason:report.profitUnavailableReason,wholesaleAttributionDays:[date]});
  if(report.productTrade){
    const trade=report.productTrade,db=workspaceDatabases.get(activeWorkspace().id).db,scope=trade.accountKey,custody=Finance.query(db,'SELECT amount_cents,occurred_at,actor_key FROM warehouse_custody_events c WHERE NOT EXISTS(SELECT 1 FROM pos_invoice_void_custody v WHERE v.event_id=c.id) ORDER BY occurred_at,id').filter(row=>(!scope||row.actor_key===scope)&&row.occurred_at.slice(0,10)<=range.end&&(!trade.custodyStart||row.occurred_at>=trade.custodyStart)),funding=WarehouseAccounting.sourceReadRows(db).filter(row=>!scope||row.actorKey===scope),tradeDays=new Map((trade.daily||[]).map(row=>[row.day,row]));
    let custodyIndex=0,custodyCents=0n;
    for(const {date,report:d}of days.values()){
      while(custodyIndex<custody.length&&custody[custodyIndex].occurred_at.slice(0,10)<=date)custodyCents+=BigInt(custody[custodyIndex++].amount_cents);
      if(custodyCents>BigInt(Number.MAX_SAFE_INTEGER)||custodyCents< -BigInt(Number.MAX_SAFE_INTEGER))throw Error('The archived product custody balance exceeds its supported range.');
      const row=tradeDays.get(date),margin=Number(row?.profit||0),netCustody=Number(custodyCents)/100,marginFunding=money(funding.filter(value=>value.expenseDate===date).reduce((sum,value)=>sum+value.amount,0));
      const mixedServiceRevenue=Number(row?.mixedServiceRevenue??row?.mixedServiceProfit??0),mixedServiceGrossMargin=Number(row?.mixedServiceProfit||0);
      d.productMarginFunding=marginFunding;d.productTrade={...trade,start:date,end:date,saleCount:Number(row?.count||0),physicalProductRevenue:Number(row?.revenue||0),physicalProductWholesaleCost:Number(row?.cost||0),physicalProductAcquisitionCost:Number(row?.acquisitionCost||0),physicalProductGrossMargin:margin,...trade.mixedServiceGrossMargin!==undefined?{mixedServiceRevenue,mixedServiceGrossMargin}:{},warehouseNetCustody:netCustody,productTradeAdjustment:money(margin+mixedServiceGrossMargin-netCustody),marginFunding,internalWholesaleCost:Number(row?.cost||0),daily:row?[{...row}]:[]};
    }
  }
  if(report.fundedStock){let custody=Number(report.fundedStock.openingCustodyPaid);for(const {date,report:d}of days.values()){const source=report.fundedStock,part=(source.daily||[]).find(row=>row.day===date),principal=Number(part?.principal||0),fee=Number(part?.fee||0),payments=(source.rows||[]).filter(row=>row.paidAt.slice(0,10)===date);custody=money(custody+principal);d.fundedStock={...source,start:date,end:date,principal,paid:principal,periodCustodyPaid:principal,custodyPaid:custody,openingCustodyPaid:money(custody-principal),cashPaid:money(payments.filter(row=>row.paymentMethod==='Cash').reduce((sum,row)=>sum+row.total,0)),whishPaid:money(payments.filter(row=>row.paymentMethod==='Whish Money').reduce((sum,row)=>sum+row.total,0)),fee,fees:fee,additionalProfitDeduction:fee,count:payments.length,rows:payments,daily:part?[{...part}]:[]};}}
  for(const {date,report:dayReport}of days.values())Object.assign(dayReport,CompanyDebtSpending.applyToReport(FixedMonthlySpending.applyToReport(dayReport,fixedMonthlySummary(date,date)),companyDebtSummary(date,date)));
  return {name:currentUser().full_name,report,daily:[...days.values()]};
}
function mergeLedgerReports(entries){
  const section=activeWorkspace(),combined=combineReports(entries.map(report=>({section,report,drawer:{balance:0}}))),last=entries.at(-1);
  delete combined.sections;combined.outstandingDebt=last?.outstandingDebt||0;combined.debtCount=last?.debtCount||0;combined.debtAccounts=last?.debtAccounts||[];
  return {...combined,posCategory:'',reportCurrency:'USD',exchangeRate:USD_TO_LBP};
}
function closedLedgerReport(start,end){
  if(activeSession().liveLedgerRead)return null;
  const db=workspaceDatabases.get(activeWorkspace().id).db,periods=Finance.months(db).filter(m=>m.month>=String(start).slice(0,7)&&m.month<=String(end).slice(0,7)).sort((a,b)=>a.month.localeCompare(b.month));
  if(!periods.length)return null;
  const key=currentUser().role==='admin'?null:currentUser().account_key,reports=[];
  const live=(from,to)=>requestContext.run({...activeSession(),liveLedgerRead:true},()=>financeReport(from,to));
  let cursor=start;
  for(const period of periods){
    const range=Finance.monthRange(period.month),from=start>range.start?start:range.start,to=end<range.end?end:range.end;
    if(cursor<from){const d=new Date(from+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);reports.push(live(cursor,d.toISOString().slice(0,10)));}
    let archived;try{archived=Finance.archive(db,period.month,key);}catch(error){if(!key)throw error;reports.push(live(from,to));}
    if(archived){const piece=from===range.start&&to===range.end?archived.report:mergeLedgerReports(archived.daily.filter(d=>d.date>=from&&d.date<=to).map(d=>d.report));reports.push({...piece,debtAccounts:archived.report.debtAccounts});}
    const next=new Date(to+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);
  }
  if(cursor<=end)reports.push(live(cursor,end));
  return {...mergeLedgerReports(reports),closedMonths:periods.map(p=>p.month),archiveNote:'Closed-month figures are immutable snapshots; debt balances in a closed month are as recorded at closing. Current debts remain available separately.'};
}
function bandwidthAdmin(){
  checkWorkspaceChannel('bandwidth:access');const user=currentUser();
  if(activeWorkspace().id!=='main'||user?.role!=='admin'||user?.activity_inspection)throw Error('Only the Main Office administrator can use Bandwidth Accounting.');
  const fresh=sectionAccess.forWorkspace(user,'main');if(!fresh?.active||fresh.role!=='admin')throw Error('Main administrator access is required.');
  return fresh;
}
function fixedMonthlyAdmin(sourceWorkspaceId='main'){
  checkWorkspaceChannel('fixedMonthly:access');const user=currentUser();
  if(activeWorkspace().id!=='main'||user?.role!=='admin'||user?.activity_inspection)throw Error('Only the Main Office administrator can use Fixed monthly payments.');
  const fresh=sectionAccess.forWorkspace(user,'main');if(!fresh?.active||fresh.role!=='admin')throw Error('Main administrator access is required.');
  requireSectionAccess(fresh,sourceWorkspaceId);const selected=sectionAccess.forWorkspace(fresh,sourceWorkspaceId);if(!selected?.active||selected.role!=='admin')throw Error('An active administrator with access to this business must approve the monthly payment.');return selected;
}
function fixedMonthlyHolders(workspaceId){
  return moneyHolders(workspaceId,fixedMonthlyAdmin);
}
function bankHolders(workspaceId){return moneyHolders(workspaceId,bankAdmin);}
function moneyHolders(workspaceId,authorize){
  const actor=authorize(workspaceId),locked=['main','fiber-resellers'].includes(workspaceId),entry=workspaceDatabases.get(workspaceId);
  if(!entry)throw Error('The selected business is unavailable.');
  const candidates=sectionAccess.roster(workspaceId).filter(person=>person.active&&!person.roleReviewRequired&&(person.accountKey===actor.account_key||!locked&&person.role==='cashier'));
  return candidates.flatMap(person=>{
    try{
      const fresh=sectionAccess.forWorkspace({account_key:person.accountKey},workspaceId),rows=Finance.query(entry.db,'SELECT * FROM users WHERE account_key=?',[person.accountKey]);
      if(rows.length!==1||!rows[0].active||!fresh.active||rows[0].id!==fresh.id||rows[0].role!==fresh.role||fresh.role_review_required||!(person.accountKey===actor.account_key&&fresh.role==='admin'||!locked&&fresh.role==='cashier'))return [];
      requireSectionAccess(fresh,workspaceId);return [rows[0]];
    }catch{return [];}
  });
}
function assertNoFixedMonthlyPending(_section='main',ownRequestId=''){
  const entry=workspaceDatabases.get('main');if(!entry)return;
  fixedMonthlyPayments?.assertIdle(ownRequestId);
  companyDebts?.assertIdle(ownRequestId);
  if(FixedMonthlyService.pending(entry.db).some(row=>row.requestId!==ownRequestId))throw Error('Finish the saved payment in Main Office → Fixed monthly payments before changing funds or viewing final financial totals.');
  if(CompanyDebtService.pending(entry.db).some(row=>row.requestId!==ownRequestId))throw Error('Finish the saved request in Main Office → Company debts before changing funds or viewing final financial totals.');
  if(FixedMonthlyCategories.pending(entry.db).some(row=>row.requestId!==ownRequestId))throw Error('Finish the saved category request in Main Office → Fixed monthly payments before changing records or viewing final totals.');
}
function registerFixedMonthlyHandlers(){
  registerHandler('fixedMonthly:access',()=>({user:publicUser(fixedMonthlyAdmin())}));
  for(const method of ['overview','ensureMonth','saveTemplate','freeze','sources','preview','pay','previewReversal','reverse','status','resume','pending'])registerHandler('fixedMonthly:'+method,(_event,input)=>{fixedMonthlyAdmin();return fixedMonthlyPayments[method](input);});
  for(const [method,task] of Object.entries({categoryOverview:'overview',saveCategory:'saveCategory',assignCategory:'assignCategory',categoryStatus:'status',categoryResume:'resume',categoryPending:'pending'}))registerHandler('fixedMonthly:'+method,(_event,input)=>{fixedMonthlyAdmin();return fixedMonthlyCategories[task](input);});
}
function companyDebtAdmin(sourceWorkspaceId='main'){
  checkWorkspaceChannel('companyDebts:access');const user=currentUser();
  if(activeWorkspace().id!=='main'||user?.role!=='admin'||user?.activity_inspection)throw Error('Only the Main Office administrator can manage Company debts.');
  const fresh=sectionAccess.forWorkspace(user,'main');if(!fresh?.active||fresh.role!=='admin')throw Error('Main administrator access is required.');
  requireSectionAccess(fresh,sourceWorkspaceId);const selected=sectionAccess.forWorkspace(fresh,sourceWorkspaceId);if(!selected?.active||selected.role!=='admin')throw Error('An active administrator with access to this business must approve the company debt payment.');return selected;
}
function registerCompanyDebtHandlers(){
  registerHandler('companyDebts:access',()=>({user:publicUser(companyDebtAdmin())}));
  for(const method of ['overview','create','assignBusiness','assignBusinesses','addMonthly','sources','preview','pay','status','resume','pending'])registerHandler('companyDebts:'+method,(_event,input)=>{companyDebtAdmin();return companyDebts[method](input);});
}
function bankAdmin(sourceWorkspaceId='main'){
  checkWorkspaceChannel('bank:access');const user=currentUser();
  if(activeWorkspace().id!=='main'||user?.role!=='admin'||user?.activity_inspection)throw Error('Only the Main Office administrator can manage Bank.');
  const fresh=sectionAccess.forWorkspace(user,'main');if(!fresh?.active||fresh.role!=='admin')throw Error('Main administrator access is required.');
  requireSectionAccess(fresh,sourceWorkspaceId);const selected=sectionAccess.forWorkspace(fresh,sourceWorkspaceId);if(!selected?.active||selected.role!=='admin')throw Error('An active administrator with access to this business must approve its Bank transfer.');return selected;
}
function registerBankHandlers(){
  registerHandler('bank:access',()=>({user:publicUser(bankAdmin())}));
  for(const method of ['overview','sources','preview','transfer','status','resume','pending'])registerHandler('bank:'+method,(_event,input)=>{bankAdmin();return bankAccounts[method](input);});
}
function adminTransferAdmin(workspaceId='main'){
  checkWorkspaceChannel('adminTransfers:access');const user=currentUser();
  if(activeWorkspace().id!=='main'||user?.role!=='admin'||user?.activity_inspection)throw Error('Only the Main Office administrator can approve money transfers.');
  const actor=sectionAccess.forWorkspace(user,'main');if(!actor?.active||actor.role!=='admin')throw Error('Main administrator access is required.');
  requireSectionAccess(actor,workspaceId);const selected=sectionAccess.forWorkspace(actor,workspaceId);if(!selected?.active||selected.role!=='admin')throw Error('Administrator access to this business is required.');return selected;
}
function adminTransferHolders(workspaceId){
  const actor=adminTransferAdmin(workspaceId),entry=workspaceDatabases.get(workspaceId);
  return sectionAccess.roster(workspaceId).filter(person=>person.active&&!person.roleReviewRequired&&(person.accountKey===actor.account_key||['cashier','support'].includes(person.role))).flatMap(person=>{
    try{const fresh=sectionAccess.forWorkspace({account_key:person.accountKey},workspaceId),rows=Finance.query(entry.db,'SELECT * FROM users WHERE account_key=?',[person.accountKey]);if(rows.length!==1||!fresh.active||!rows[0].active||fresh.id!==rows[0].id||fresh.role!==rows[0].role||fresh.role_review_required||!(fresh.account_key===actor.account_key&&fresh.role==='admin'||['cashier','support'].includes(fresh.role)))return [];requireSectionAccess(fresh,workspaceId);return [rows[0]];}catch{return [];}
  });
}
function registerAdminTransferHandlers(){
  registerHandler('adminTransfers:access',()=>({user:publicUser(adminTransferAdmin())}));
  for(const method of ['sources','preview','transfer','status','resume','pending','history'])registerHandler('adminTransfers:'+method,(_event,input)=>{adminTransferAdmin();return adminMoneyTransfers[method](input);});
}
function notesOwner(){
  const user=currentUser();StickyNotesService.owner(user);const fresh=sectionAccess.forWorkspace(user,activeWorkspace().id);if(!fresh?.active||fresh.account_key!==user.account_key)throw Error('Sign in to your own active account to open private notes.');return {...fresh,activity_inspection:user.activity_inspection};
}
function registerNotesHandlers(){
  for(const method of ['list','save','remove','restore','status','resume'])registerHandler('notes:'+method,(_event,input)=>{notesOwner();return stickyNotes[method](input);});
}
function monthClosingAdmin(sourceWorkspaceId='main'){
  requirePermission('reports.view');const user=currentUser();
  if(user?.role!=='admin'||user?.activity_inspection)throw Error('Only an active administrator can close a monthly ledger.');
  const main=sectionAccess.forWorkspace(user,'main');if(!main?.active||main.role!=='admin')throw Error('An active Main administrator must approve monthly closing.');
  requireSectionAccess(main,sourceWorkspaceId);const selected=sectionAccess.forWorkspace(main,sourceWorkspaceId);if(!selected?.active||selected.role!=='admin')throw Error('Administrator access to this business is required for monthly closing.');return selected;
}
function assertMonthClosingTransfersReady(section){
  const entry=workspaceDatabases.get(section);if(Finance.pendingActions(entry.db).length)throw Error('Reconcile pending transfers before closing this ledger.');
  if(section==='fiber-users'&&Finance.query(workspaceDatabases.get('fiber-resellers').db,"SELECT input_json FROM portal_operations WHERE state IN ('checking','processing','unknown','confirmed')").some(row=>{const saved=JSON.parse(row.input_json);return (saved.accountingVersion===6||saved.reconciliationTransfer===true)&&saved.sourceSection==='fiber-users';}))throw Error('Finish or reconcile the pending Users-to-Resellers transfer before closing Users.');
  if(ResellerCollections.pending(workspaceDatabases.get('fiber-resellers').db).some(row=>row.sourceSection===section))throw Error('Finish or cancel the pending reseller Pay bill collection before closing its source business.');
}
function monthClosingSnapshot(workspaceId,month){
  const actor=monthClosingAdmin(workspaceId),entry=workspaceDatabases.get(workspaceId),users=Finance.query(entry.db,'SELECT * FROM users WHERE account_key IS NOT NULL');
  const snap=user=>requestContext.run({workspaceId,user:{...user,activity_inspection:true},consolidatedReadAuthority:actor.account_key},()=>monthlySnapshot(month));
  return {all:snap({...actor,role:'admin'}),employees:Object.fromEntries(users.map(user=>[user.account_key,snap({...user,role:'viewer'})]))};
}
function registerMainOfficeSummaryHandlers(){
  registerHandler('mainOfficePayables:overview',(_event,...args)=>{
    companyDebtAdmin();
    return MainOfficeSummary.createMainOfficeSummary({authorize:companyDebtAdmin,now:localIso,bandwidth:()=>({overview:bandwidthCore().overview({start:'',end:''}),pending:bandwidthPayments.pending()}),monthly:fixedMonthlyPayments,companyDebts}).overview(...args);
  });
  registerHandler('mainOfficePayables:details',(_event,...args)=>{
    companyDebtAdmin();
    return MainOfficeSummary.createMainOfficeSummary({authorize:companyDebtAdmin,now:localIso,bandwidth:()=>({overview:bandwidthCore().overview({start:'',end:''}),pending:bandwidthPayments.pending()}),monthly:fixedMonthlyPayments,companyDebts}).details(...args);
  });
}
function assertNoBandwidthPending(section,ownRequestId=''){
  const entry=workspaceDatabases.get('main');if(!entry)return;
  const pending=BandwidthPaymentService.pending(entry.db).filter(row=>row.requestId!==ownRequestId&&(section==='main'||row.sourceWorkspaceId===section));
  if(pending.length)throw Error('Finish the pending supplier payment in Main Office → Bandwidth Accounting before changing its funds, users or monthly ledgers.');
}
function bandwidthCore(){return new Bandwidth.BandwidthAccounting({db:workspaceDatabases.get('main').db,workspaceId:'main',actor:bandwidthAdmin(),now:localIso});}
function bandwidthWrite(task){
  const core=bandwidthCore(),entry=workspaceDatabases.get('main');assertNoBandwidthPending('main');
  let result;entry.db.exec('BEGIN');try{result=task(core,entry.db);entry.db.exec('COMMIT');}catch(error){entry.db.exec('ROLLBACK');throw error;}
  // Replays use the same saved request ID, including a prior failed file save.
  saveSectionEntry(entry);return result;
}
function registerBandwidthHandlers(){
  registerHandler('bandwidth:access',()=>({user:publicUser(bandwidthAdmin())}));
  registerHandler('bandwidth:overview',(_event,input)=>{const result=bandwidthCore().overview(input||{});return {...result,pending:bandwidthPayments.pending(),costCategory:'Bandwidth cost',feePolicy:'No automatic supplier-payment fee',today:localIso().slice(0,10)};});
  registerHandler('bandwidth:sources',()=>{bandwidthAdmin();return bandwidthPayments.sources();});
  registerHandler('bandwidth:pending',()=>{bandwidthAdmin();return bandwidthPayments.pending();});
  registerHandler('bandwidth:createSupplier',(_event,input)=>bandwidthWrite(core=>core.createSupplier(input)));
  registerHandler('bandwidth:updateSupplier',(_event,id,input)=>bandwidthWrite(core=>core.updateSupplier(id,input)));
  registerHandler('bandwidth:createType',(_event,input)=>bandwidthWrite(core=>core.createType(input)));
  registerHandler('bandwidth:updateType',(_event,id,input)=>bandwidthWrite(core=>core.updateType(id,input)));
  registerHandler('bandwidth:createPurchase',(_event,input)=>bandwidthWrite((core,db)=>{
    const purchase=core.createPurchase(input);if(purchase.expenseId)return purchase;
    if(purchase.idempotent)throw Error('The existing bandwidth purchase has no linked cost. Review its original accounting record.');
    db.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id,created_at) VALUES(?,'Bandwidth cost',?,?,?,'bandwidth_purchase',?,?)",[purchase.purchaseDate,`${purchase.receiptNo} · ${purchase.supplierName} · ${purchase.typeName} · ${purchase.quantity} ${purchase.unit}`,purchase.totalCost,purchase.actorId,String(purchase.id),localIso()]);
    const expenseId=Number(Finance.query(db,'SELECT last_insert_rowid() AS id')[0].id);return core.linkPurchaseExpense(purchase.id,{expenseId,sourceType:'bandwidth_purchase',sourceId:String(purchase.id)});
  }));
  registerHandler('bandwidth:pay',(_event,input)=>{bandwidthAdmin();return bandwidthPayments.pay(input);});
  registerHandler('bandwidth:resume',(_event,id)=>{bandwidthAdmin();return bandwidthPayments.resume(id);});
}
function registerFinanceHandlers(){
  // Undefined optional IPC arguments become null when a Client PC serializes them.
  // Accept either as an empty read request, never as a different employee scope.
  function financeReadInput(value){
    if(value==null)return {};
    if(typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Choose valid finance request options.');
    if(value.accountKey!==undefined&&(typeof value.accountKey!=='string'||value.accountKey.length>100||value.accountKey&& !/^[a-z][a-z0-9-]*:[1-9][0-9]*$/.test(value.accountKey)))throw Error('Choose a valid application employee account.');
    if(value.workspaceId!==undefined&&(typeof value.workspaceId!=='string'||value.workspaceId.length>64))throw Error('Choose a valid business section.');
    return value;
  }
  function supportContext(input={}){
    input=financeReadInput(input);
    requirePermission('drawer.manage');
    if(activeWorkspace().id!=='fiber-users'||currentUser()?.role!=='support'||currentUser()?.activity_inspection)throw Error('End of day is for Support in FIBER net lb Users only.');
    const entry=workspaceDatabases.get('fiber-users'),from=currentUser(),to=input.toKey?sectionAccess.forWorkspace({accountKey:String(input.toKey)},'fiber-users'):null;
    return {entry,from,to,destinations:Whish.listDestinations(workspaceDatabases.get('main').db,true)};
  }
  registerHandler('finance:endDayTargets',()=>{const {from}=supportContext();return sectionAccess.roster('fiber-users').filter(u=>u.role==='cashier'&&u.active&&u.allowedSections.includes('fiber-users')&&u.accountKey!==from.account_key).map(u=>({accountKey:u.accountKey,fullName:u.fullName,username:u.username}));});
  registerHandler('finance:endDayPreview',(_event,input)=>{const c=supportContext(input);refreshWhishReceiptPolicy(['fiber-users']);return SupportLedger.preview(c.entry.db,c.from,c.to,c.destinations);});
  registerHandler('finance:endDay',(_event,input)=>{const c=supportContext(input);refreshWhishReceiptPolicy(['fiber-users']);const result=SupportLedger.endDay(c.entry.db,input,c.from,c.from,c.to,c.destinations,localIso());saveDatabase();return result;});
  registerHandler('finance:receiptCopies',(_event,input={})=>{
    input=financeReadInput(input);
    if(activeWorkspace().id!=='fiber-users')throw Error('Support receipt copies belong to FIBER net lb Users.');requirePermission('bills.view');
    const own=sectionAccess.key(currentUser(),'fiber-users'),key=input.accountKey||own;if(key!==own&&currentUser()?.role!=='admin')throw Error('You can view only your own receipt copies.');
    if(!Finance.query(workspaceDatabases.get('fiber-users').db,'SELECT id FROM users WHERE account_key=?',[key]).length)throw Error('This employee is not available in this business.');
    return SupportLedger.copies(workspaceDatabases.get('fiber-users').db,key);
  });
  registerHandler('finance:receiptCopy',(_event,id)=>{if(activeWorkspace().id!=='fiber-users')throw Error('Open FIBER net lb Users to view a receipt copy.');requirePermission('bills.view');if(!Number.isSafeInteger(id)||id<1)throw Error('Choose a valid receipt copy.');return SupportLedger.copy(workspaceDatabases.get('fiber-users').db,sectionAccess.key(currentUser(),'fiber-users'),id);});
  registerHandler('finance:overview',(_event,input={})=>{input=financeReadInput(input);const result=input.workspaceId==='all'?(currentUser()?.role==='admin'?consolidatedFinanceOverview(input):staffConsolidatedFinanceOverview(input)):financeContext(input,ctx=>{
    refreshWhishReceiptPolicy();
    const today=localIso().slice(0,10),start=`${today.slice(0,7)}-01`,report=financeReport(start,today);
    const scope=ctx.admin&&!input.accountKey?null:ctx.viewed.account_key,customerDebts=ctx.debtReadAllowed?availableCustomerDebtOverview(ctx.section.id,scope,today):undefined;
    const bandwidthSpending=ctx.admin&&ctx.section.id==='fiber-resellers'?BandwidthSpending.summary({entries:workspaceDatabases,workspaceId:ctx.section.id,start,end:today,accountKey:scope}):undefined;
    const bandwidthCost=ctx.admin&&['main','fiber-resellers'].includes(ctx.section.id)?BandwidthSpending.purchaseSummary({entries:workspaceDatabases,start,end:today,accountKey:scope}):undefined;
    const fixedMonthly=report.fixedMonthly||fixedMonthlySummary(start,today,scope,ctx.section.id),companyDebt=report.companyDebt||companyDebtSummary(start,today,scope,ctx.section.id);
    const dashboard=localHandlers.get('reports:dashboard')(null);
    if(bandwidthSpending)dashboard.bandwidthSpending=bandwidthSpending;
    if(bandwidthCost)dashboard.bandwidthCost=bandwidthCost;
    dashboard.fixedMonthly=fixedMonthly;
    dashboard.companyDebt=companyDebt;
    const wallets=Finance.walletBalances(ctx.entry.db,Whish.listDestinations(workspaceDatabases.get('main').db,true),scope);
    const bankCustody=ctx.admin?BankService.custodySummary({db:ctx.entry.db,workspaceId:ctx.section.id,accountKey:scope,through:today}):undefined;
    const monthOpening=ctx.admin?MonthOpeningCustody.summary({db:ctx.entry.db,workspaceId:ctx.section.id,accountKey:scope,through:today}):undefined;
    const adminTransferCustody=ctx.admin?AdminTransferService.custodySummary({entries:workspaceDatabases,workspaceId:ctx.section.id,accountKey:scope,through:today}):undefined;
    const carriedResellerCollectionCustody=ctx.admin&&ctx.section.id==='fiber-resellers'?ResellerCarryCustody.custodySummary({entries:workspaceDatabases,workspaceId:ctx.section.id,accountKey:scope,through:today}):undefined;
    const dashboardTotals=ctx.admin?ConsolidatedFinance.businessTotals(ctx.section,{report,dashboard,wallets,bandwidthCost,bandwidthSpending,fixedMonthly,companyDebt,bankCustody,monthOpening,adminTransferCustody,carriedResellerCollectionCustody,accountKey:scope,today}):undefined;
    const recipientKey=Finance.query(workspaceDatabases.get('main').db,"SELECT value FROM finance_settings WHERE name='internet_cost_recipient'")[0]?.value||'';
    const recipient=ctx.roster.find(u=>u.accountKey===recipientKey&&u.canReceive&&u.role==='admin');
    const corrections=Finance.query(ctx.entry.db,'SELECT corrected_at,original_json FROM finance_whish_corrections');
    const legacyCashouts=Finance.query(ctx.entry.db,"SELECT result_json FROM finance_events WHERE kind='wallet_cashout'").filter(r=>!Object.hasOwn(JSON.parse(r.result_json),'fee')).length;
    const transition=whishReceiptPolicyStatus.get(ctx.section.id)||{policy:'profit_only',deferred:[],warnings:[]};
    return {workspaceId:ctx.section.id,workspaceName:ctx.section.name,admin:ctx.admin,accountKey:scope,customerDebts,employeeName:scope?ctx.viewed.full_name:'All employees',employees:ctx.admin?ctx.roster:ctx.roster.filter(u=>u.accountKey===ctx.caller.account_key),recipients:ctx.roster.filter(u=>u.canReceive&&['admin','manager','cashier','support'].includes(u.role)),costSettlement:Finance.costSettlement(ctx.entry.db,scope?ctx.viewed:null,today.slice(0,7)),costRecipient:recipient||null,costRecipientKey:recipientKey,whishCorrection:ctx.admin?{count:corrections.length,restoredFees:money(corrections.reduce((n,r)=>n+Number(JSON.parse(r.original_json).fee),0)),legacyCashouts}:null,whishFeePolicy:{policy:'profit_only',additionalCashoutFee:0,deferred:transition.deferred.length>0,warnings:ctx.admin?transition.warnings:[],reason:transition.deferred.length?(ctx.admin?transition.deferred.map(item=>item.reason).filter(Boolean).join('; '):'Older wallet custody needs Admin review before withdrawal. No uncertain balance correction is applied.') :''},wallets,whishFees:report.whishFees,serviceCost:report.serviceCost,internetCost:report.profitParts?.find(p=>p.id==='internet')?.cost??0,bandwidthSpending,bandwidthCost,companyDebt,bankCustody,monthOpening,adminTransferCustody,carriedResellerCollectionCustody,dashboardTotals,history:Finance.history(ctx.entry.db,scope),months:Finance.months(ctx.entry.db),lastClosedMonth:Finance.latestMonth(ctx.entry.db),today,dashboard,report};
  });
    // Billing-month choices belong only to the Main Admin's read-only dashboard.
    // Build after financeContext restores Main authority; never alter actual-date reports.
    if(activeWorkspace().id==='main'&&currentUser()?.role==='admin'){
      fixedMonthlyAdmin();assertNoFixedMonthlyPending('main');
      const overview=fixedMonthlyPayments.overview({month:result.today.slice(0,7)}),owners={};
      for(const bill of overview.bills){
        const saved=Finance.query(workspaceDatabases.get('main').db,'SELECT * FROM fixed_monthly_template_versions WHERE template_id=? AND version=?',[bill.templateId,bill.templateVersion])[0];
        let version;try{version=JSON.parse(saved?.snapshot_json);}catch{throw Error('Monthly payment responsibility could not be verified.');}
        let reviewedCurrentRevision=false;
        if(version?.effectiveMonth>bill.month){
          const db=workspaceDatabases.get('main').db,anchor=Finance.query(db,'SELECT * FROM fixed_monthly_bills WHERE bill_id=?',[bill.billId])[0],revision=Finance.query(db,'SELECT snapshot_json FROM fixed_monthly_bill_revisions WHERE bill_id=? ORDER BY revision DESC LIMIT 1',[bill.billId])[0];
          if(anchor&&revision){
            const verified=FixedMonthlyService.verifiedBill(db,anchor),matchesSnapshot=(expected,actual)=>Array.isArray(expected)?Array.isArray(actual)&&expected.length===actual.length&&expected.every((value,index)=>matchesSnapshot(value,actual[index])):expected&&typeof expected==='object'?actual&&typeof actual==='object'&&Object.keys(expected).every(key=>Object.hasOwn(actual,key)&&matchesSnapshot(expected[key],actual[key])):expected===actual;
            reviewedCurrentRevision=revision.snapshot_json===JSON.stringify(verified)&&verified.templateVersion===bill.templateVersion&&matchesSnapshot(verified,bill);
          }
        }
        if(!version||version.id!==bill.templateId||version.version!==bill.templateVersion||version.effectiveMonth!==saved.effective_month||version.effectiveMonth>bill.month&&!reviewedCurrentRevision||version.updatedBy!==saved.actor_key||crypto.createHash('sha256').update(JSON.stringify(version)).digest('hex')!==saved.snapshot_hash)throw Error('Monthly payment responsibility could not be verified.');
        owners[bill.billId]=version.updatedBy;
      }
      result.monthlyPayments=FixedMonthlyDashboard.summarize({overview,workspaceId:result.workspaceId,accountKey:result.accountKey,owners,asOf:result.today});
      result.companyDebtPayments=CompanyDebtSpending.dashboardPaid({entries:workspaceDatabases,workspaceId:result.workspaceId,accountKey:result.accountKey,start:result.today.slice(0,7)+'-01',end:result.today,asOf:result.today});
      if(result.workspaceId==='fiber-resellers')result.resellerCollectionsRevenue=result.accountKey?{basis:'reseller_bill_collections',scope:'all_resellers',period:'all_recorded_dates',available:false,reason:'Select All employees to view the company-wide reseller bill collection total.'}:ResellerCollectedRevenue.summary(workspaceDatabases.get('fiber-resellers').db);
    }
    return result;
  });
  registerHandler('finance:handoverPreview',(_event,input)=>{requirePermission('drawer.manage');return financeContext(input,ctx=>{if(ctx.section.id==='fiber-users')throw Error('Use Support End of day instead of manual cash handovers.');const from=financeMember(ctx,input.fromKey,{own:true}),to=financeMember(ctx,input.toKey);return Finance.handoverPreview(ctx.entry.db,from,to,input.amount);});});
  registerHandler('finance:handover',(_event,input)=>{requirePermission('drawer.manage');return financeContext(input,ctx=>{if(ctx.section.id==='fiber-users')throw Error('Use Support End of day instead of manual cash handovers.');const from=financeMember(ctx,input.fromKey,{own:true}),to=financeMember(ctx,input.toKey);const result=Finance.handover(ctx.entry.db,input,ctx.caller,from,to,localIso());saveDatabase();return result;});});
  registerHandler('finance:walletMove',(_event,input)=>{requirePermission('drawer.manage');return financeContext(input,ctx=>{
    if(ctx.section.id==='fiber-users')throw Error('Wallet responsibility moves through Support End of day; manual Whish movements are unavailable here.');
    if(input.kind==='wallet_adjustment'&&!ctx.admin)throw Error('Only administrators can record opening wallet balances.');
    if(input.kind!=='wallet_adjustment')refreshWhishReceiptPolicy([ctx.section.id]);
    const owner=financeMember(ctx,input.fromKey,{own:true}),recipient=input.kind==='wallet_cashout'?financeMember(ctx,input.toKey):null;
    const result=Finance.walletMove(ctx.entry.db,input,ctx.caller,owner,recipient,Whish.listDestinations(workspaceDatabases.get('main').db,true),localIso());saveDatabase();return result;
  });});
  registerHandler('finance:archive',(_event,input)=>financeContext(input,ctx=>{MonthClosingService.verifyArchive({db:ctx.entry.db,workspaceId:ctx.section.id,month:input.month});return Finance.archive(ctx.entry.db,input.month,ctx.admin&&!input.accountKey?null:ctx.viewed.account_key);}));
  registerHandler('finance:ledgerOverview',(_event,input)=>{
    if(activeWorkspace().id!=='main')throw Error('Open Main dashboard to view all business monthly ledgers.');
    monthClosingAdmin();
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='workspaceId')||input.workspaceId!=='all')throw Error('Choose All businesses for the combined monthly ledger list.');
    const businesses=WORKSPACES.map(section=>{
      monthClosingAdmin(section.id);
      const entry=workspaceDatabases.get(section.id),months=Finance.months(entry.db);
      for(const row of months)MonthClosingService.verifyArchive({db:entry.db,workspaceId:section.id,month:row.month});
      return {workspaceId:section.id,workspaceName:section.id==='main'?'Company Expenses':section.name,months};
    });
    return {basis:'monthly_ledger_businesses',workspaceId:'all',aggregate:true,readOnly:true,businesses};
  });
  registerHandler('finance:setCostRecipient',(_event,input)=>{
    if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin')throw Error('Only the Main administrator can configure the Internet-cost recipient.');
    return financeContext({workspaceId:'fiber-users'},ctx=>{
      const person=financeMember(ctx,input.accountKey);if(person.role!=='admin')throw Error('Choose an active Admin account.');
      const db=workspaceDatabases.get('main').db;
      db.run("INSERT INTO finance_settings VALUES('internet_cost_recipient',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",[person.account_key]);
      writePrivateFile(workspaceDatabases.get('main').path,Buffer.from(db.export()));return {ok:true};
    });
  });
  registerHandler('finance:payInternetCost',(_event,input)=>{requirePermission('drawer.manage');return financeContext(input,ctx=>{
    throw Error('Settle Internet costs through fibernetlb2 in the Resellers business.');
    if(ctx.section.id!=='fiber-users')throw Error('Internet-cost payments belong to FIBER net lb Users.');
    const key=Finance.query(workspaceDatabases.get('main').db,"SELECT value FROM finance_settings WHERE name='internet_cost_recipient'")[0]?.value;
    if(!key||input.toKey!==key)throw Error('The recipient changed or is not configured. Refresh the dashboard.');
    const result=Finance.payInternetCost(ctx.entry.db,input,ctx.caller,financeMember(ctx,input.fromKey,{own:true}),financeMember(ctx,key),localIso());saveDatabase();return result;
  });});
  for(const [channel,method]of Object.entries({'finance:closeMonthPreview':'preview','finance:commitMonthClose':'close','finance:closeMonth':'close','finance:closeMonthStatus':'status','finance:resumeMonthClose':'resume','finance:pendingMonthClose':'pending'}))registerHandler(channel,(_event,input)=>{
    monthClosingAdmin();
    if(method!=='pending'&&activeWorkspace().id!=='main'&&input?.workspaceId!==activeWorkspace().id)throw Error('Open Main dashboard to close another business.');
    return monthClosing[method](input);
  });
  for(const [channel,method]of Object.entries({'finance:closeMonthsPreview':'preview','finance:commitMonthsClose':'close','finance:closeMonthsStatus':'status','finance:resumeMonthsClose':'resume'}))registerHandler(channel,(_event,input)=>{
    if(activeWorkspace().id!=='main')throw Error('Open Main dashboard to close all business monthly ledgers.');
    monthClosingAdmin();
    return monthClosingAll[method](input);
  });
}

function expenseBusinesses() {
  requirePermission('expenses.manage');
  if(currentUser()?.role==='admin') {
    const mainUser=sectionAccess.forWorkspace(currentUser(),'main');
    if(mainUser.role==='admin')return WORKSPACES.filter(section=>section.id==='main'||sectionAccess.permitted(mainUser,section.id));
  }
  return [activeWorkspace()];
}

function inExpenseWorkspace(selection,task,{adminOnly=false}={}) {
  const target=workspace(String(selection||activeWorkspace().id));
  if(adminOnly&&currentUser()?.role!=='admin')throw Error('Only administrators can edit expenses.');
  if(target.id===activeWorkspace().id)return task();
  if(currentUser()?.role!=='admin')throw Error('Only the main administrator can assign expenses to another business.');
  const mainUser=sectionAccess.forWorkspace(currentUser(),'main');
  if(mainUser.role!=='admin')throw Error('Only the main administrator can assign expenses to another business.');
  const user=sectionAccess.forWorkspace(mainUser,target.id);
  if(user.role!=='admin')throw Error('Administrator access is required in the selected business.');
  return requestContext.run({workspaceId:target.id,user},()=>{checkWorkspaceChannel('expenses:list');return task();});
}

function listExpensesInWorkspace({fullFunding=false,includeFees=true}={}) {
  const businessDb=workspaceDatabases.get(activeWorkspace().id).db,expenseQuery=fullFunding?sql=>Finance.query(businessDb,activeReceiptSql(businessDb,sql)):rows;
  const expenses=expenseQuery(`SELECT e.id,e.expense_date AS expenseDate,e.category,e.description,e.amount,e.created_at AS createdAt,e.source_type AS sourceType,e.source_id AS sourceId,e.paper_size AS paperSize,e.paper_type AS paperType,e.funding_method AS fundingMethod,e.funding_wallet_json AS fundingWalletJson,e.funding_month AS storedFundingMonth,
    (SELECT actor_name FROM expense_edits WHERE expense_id=e.id ORDER BY id DESC LIMIT 1) AS lastEditedBy,
    (SELECT edited_at FROM expense_edits WHERE expense_id=e.id ORDER BY id DESC LIMIT 1) AS lastEditedAt,
    (SELECT full_name FROM users WHERE id=e.user_id) AS recordedBy
    FROM expenses e ORDER BY e.expense_date DESC,e.id DESC`);
  const fundingUserId=fullFunding||currentUser().role==='admin'?null:currentUser().id;
  const funding=installationRows(fullFunding?businessDb:activityDatabase).map(p=>({...p,id:`installation:${p.id}`,expenseDate:p.paidAt.slice(0,10),category:p.purpose==='free_renewal'?'Free renewal expense funding':'Installation payments',description:`${p.customerName} · ${p.customerAccount} · ${p.receiptNo}`,sourceType:'installation_payment',direction:'received'}));
  if(warehouseHasTable(activeWorkspace().id,'warehouse_margin_funding'))funding.push(...WarehouseAccounting.sourceReadRows(businessDb,{userId:fundingUserId}).map(row=>({...row,fundingWalletJson:row.fundingWallet?JSON.stringify(row.fundingWallet):''})));
  if(warehouseHasTable(activeWorkspace().id,'shared_maintenance_sale_links'))funding.push(...MaintenanceFunding.fundingRows(businessDb,{userId:fundingUserId,workspaceId:activeWorkspace().id}).map(row=>({...row,direction:'received',fundingWalletJson:row.fundingWallet?JSON.stringify(row.fundingWallet):''})));
  const whishFees=includeFees?installationReport(activityDatabase,'0000-01-01','9999-12-31',paymentLedger.report('0000-01-01','9999-12-31')).whishPayments.filter(p=>p.fee>0).map((p,index)=>({id:`whish:${p.kind}:${p.referenceNo}:${index}`,expenseDate:p.receivedAt.slice(0,10),category:'Whish Money fees',description:`1% Whish fee · ${p.referenceNo} · ${p.whishDestination?.number||''}`,amount:p.fee,sourceType:'whish_fee',recordedBy:p.cashierName})):[];
  const feeSources=new Set(['whish_fee','whish_cashout','whish_receipt_migration','reseller_whish_fee','reseller_collection_fee','stock_purchase_whish_fee',OptionalWhishFees.SOURCE]);
  if(includeFees)whishFees.push(...warehousePurchaseFeeRows());
  if(includeFees&&fundedStockPurchases)whishFees.push(...fundedStockPurchases.feeRows({workspaceId:activeWorkspace().id,start:'1900-01-01',end:'2199-12-31',accountKey:currentUser().role==='admin'?null:currentUser().account_key}));
  return [...expenses,...funding,...whishFees].map(row=>{const result={...row,...row.sourceType==='manual'?OptionalWhishFees.details(database,'expense',row.id):row.sourceType==='purchase_receipt'?OptionalWhishFees.details(database,'purchase',row.sourceId):{deductWhishFee:false,whishFee:0},fundingMonth:row.storedFundingMonth??row.expenseDate.slice(0,7),fundingMethod:row.sourceType==='installation_payment'?row.paymentMethod:row.fundingMethod||'',fundingWallet:row.sourceType==='installation_payment'?row.whishDestination?{id:row.whishDestination.id,label:row.whishDestination.label,number:row.whishDestination.number}:null:row.fundingWalletJson?JSON.parse(row.fundingWalletJson):null,feeProfitOnly:feeSources.has(row.sourceType),workspaceId:activeWorkspace().id,workspaceName:activeWorkspace().id==='main'?'Company Expenses':activeWorkspace().name};delete result.fundingWalletJson;return result;});
}

function backupAllSections(reason) {
  const directory = path.join(dataDirectory, "backups", `${reason}-${new Date().toISOString().replace(/[:.]/g,"-")}-${crypto.randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [id, entry] of workspaceDatabases) {
    if(entry.db.exec('PRAGMA quick_check')[0]?.values?.[0]?.[0]!=='ok')throw Error('Database integrity check failed; no financial correction can proceed.');
    const data=Buffer.from(entry.db.export()),file=path.join(directory,`${id}.sqlite`);writePrivateFile(file,data);
    if(!fs.readFileSync(file).equals(data))throw Error('Database backup verification failed; no financial correction can proceed.');
  }
  return directory;
}

function backupSnapshot() {
  adminMoneyTransfers?.assertIdle();
  bankAccounts?.assertIdle();monthClosing?.assertIdle();
  if (networkConfig.mode !== "server" || workspaceDatabases.size !== WORKSPACES.length) throw Error("All business databases must be loaded on Main before backup.");
  const entries=[];
  for (const [id,entry] of workspaceDatabases) {
    if(entry.db.exec("PRAGMA quick_check")[0]?.values?.[0]?.[0]!=="ok") throw Error("Database integrity check failed. Ask the administrator to inspect the local database.");
    entries.push({name:id==="main"?"isp-desk.sqlite":`sections/${id}.sqlite`,data:Buffer.from(entry.db.export())});
  }
  for(const name of BACKUP_CONFIG_FILES){const file=path.join(dataDirectory,name);if(fs.existsSync(file))entries.push({name,data:fs.readFileSync(file)});}
  return entries;
}

function requireBackupAdmin() {
  if(networkConfig.mode!=="server"||activeWorkspace().id!=="main"||currentUser()?.role!=="admin")throw Error("Backup settings and all-section files are available only to an administrator on Main.");
  requirePermission("users.manage");
  const refreshed=sectionAccess.forWorkspace(currentUser(),"main");
  if(refreshed.role!=="admin")throw Error("Your administrator role changed. Please sign in again.");
  activeSession().user=refreshed;
}

function registerBackupHandlers(){
 const authorized=()=>{requireBackupAdmin();if(!backupManager)throw Error('The backup service is unavailable.');return backupManager;};
 registerIpc('backups:status',()=>authorized().status());
 registerIpc('backups:save',(_event,input)=>authorized().save(input));
 registerIpc('backups:run',()=>authorized().run({actor:currentUser().full_name+' ('+currentUser().username+')'}));
 registerIpc('backups:retry',(_event,id,input)=>authorized().retry(String(id),input||{}));
 registerIpc('backups:test',(_event,destination)=>authorized().test(String(destination)));
}

function registerWorkspaceHandlers() {
  registerHandler('whish:list',()=>{requirePermission('dashboard.view');return Whish.listDestinations(workspaceDatabases.get('main').db);});
  const whishAdmin=()=>{requirePermission('users.manage');if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin'||sectionAccess.forWorkspace(currentUser(),'main').role!=='admin')throw Error('Only the Main administrator can manage Whish destination numbers.');return workspaceDatabases.get('main');};
  registerHandler('whish:all',()=>Whish.listDestinations(whishAdmin().db,true));
  registerHandler('whish:save',(_event,input)=>{const entry=whishAdmin(),saved=Whish.saveDestination(entry.db,input);writePrivateFile(entry.path,Buffer.from(entry.db.export()));return saved;});
}

function registerAdminCatalogHandlers(){
  const authorize=()=>{
    if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection)throw Error('Only the signed-in Main administrator can manage the combined catalog.');
    const fresh=sectionAccess.forWorkspace(currentUser(),'main');
    if(!fresh?.active||fresh.role!=='admin'||!sectionAccess.permitted(fresh,'main'))throw Error('Current Main administrator access is required.');
    return fresh;
  };
  const channels=new Set(['products:list','barcodes:generate','products:create','products:update','products:delete','sales:create','sales:receipt','receipts:whatsapp']);
  const catalog=createAdminCatalog({workspaces:WORKSPACES,authorize,delegate:(authority,id,channel,args,{checkout})=>{
    const fresh=authorize(),source=workspace(id);
    if(fresh.account_key!==authority.account_key||!channels.has(channel)||checkout&&channel!=='sales:create')throw Error('The catalog authority changed. Refresh the catalog.');
    const user=sectionAccess.forWorkspace(fresh,source.id);
    if(!user?.active||user.role!=='admin'||user.account_key!==fresh.account_key||!sectionAccess.permitted(user,source.id))throw Error('An active Admin account is required in the source business.');
    // Stable identity is mapped to the source database's local user ID. The
    // original guarded handler retains financial locks, stock and persistence.
    return requestContext.run({workspaceId:source.id,user,externalSession:true,adminCatalogCheckout:checkout===true},()=>localHandlers.get(channel)(null,...args));
  }});
  registerHandler('adminCatalog:list',(_event,...args)=>{if(args.length)throw Error('The combined catalog list does not accept selectors.');return catalog.list();});
  for(const method of ['generateBarcode','create','update','remove','sell','receipt','whatsapp'])registerHandler('adminCatalog:'+method,(_event,...args)=>{if(args.length!==1)throw Error('Choose exactly one set of catalog details.');return catalog[method](args[0]);});
}

function registerAdminReceivablesHandlers(){
  const authorize=()=>{
    if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin'||currentUser()?.activity_inspection)throw Error('Only the signed-in Main administrator can view these receivables.');
    const fresh=sectionAccess.forWorkspace(currentUser(),'main');
    if(!fresh?.active||fresh.role!=='admin'||!sectionAccess.permitted(fresh,'main'))throw Error('Current Main administrator access is required.');
    requirePermission('dashboard.view');requirePermission('reports.view');
    return fresh;
  };
  const channels=new Set(['debts:list','receivables:debtReceipt','receivables:resellerSnapshot','receivables:collectionBills','resellers:collectionPreview','resellers:payBill']);
  const receivables=createAdminReceivables({workspaces:WORKSPACES,authorize,delegate:(authority,id,channel,args)=>{
    const fresh=authorize(),source=workspace(id);
    if(fresh.account_key!==authority.account_key||!channels.has(channel)||!['debts:list','receivables:debtReceipt'].includes(channel)&&source.id!=='fiber-resellers')throw Error('The receivable authority or original business changed. Refresh the dashboard.');
    const user=sectionAccess.forWorkspace(fresh,source.id);
    if(!user?.active||user.role!=='admin'||user.account_key!==fresh.account_key||!sectionAccess.permitted(user,source.id))throw Error('An active Admin account is required in the original business.');
    return requestContext.run({workspaceId:source.id,user,externalSession:true},()=>{
      if(channel==='receivables:debtReceipt'){
        checkWorkspaceChannel('debts:list');requirePermission('debts.view');
        const [kind,id]=args,debt=paymentLedger.details(kind,id);
        if(!debt.isDebt||debt.isRefund)throw Error('Choose an original debt receipt.');
        if(kind==='sale')return localHandlers.get('sales:receipt')(null,id);
        if(kind==='bill'){checkWorkspaceChannel('bills:list');requirePermission('bills.view');return billById(id);}
        if(kind==='telecom'){checkWorkspaceChannel('telecomPayments:list');requirePermission('telecom.view');const record=telecomReceipt(id);if(!record)throw Error('The original debt receipt was not found.');return record;}
        throw Error('Choose a supported debt receipt.');
      }
      if(channel==='receivables:resellerSnapshot'){
        authorizeResellerCollection();requirePermission('reports.view');
        const db=workspaceDatabases.get('fiber-resellers').db;
        return {rows:Finance.query(db,'SELECT id,username,full_name,active FROM resellers ORDER BY id'),summary:ResellerCollections.summary(db),lots:ResellerCollections.lots(db).map(lot=>({username:lot.fund.username,remaining:lot.remaining,reserved:lot.reserved}))};
      }
      if(channel==='receivables:collectionBills'){
        authorizeResellerCollection();
        // The existing read wrapper also refreshes legacy fee policies. This
        // dashboard read deliberately calls only the original pure bill view.
        return resellerCollections.bills(args[0]);
      }
      // Fixed original guarded handlers retain custody locks, source checks,
      // saved-bill snapshots and the durable, replay-safe Pay bill journal.
      return localHandlers.get(channel)(null,...args);
    });
  }});
  for(const method of ['summary','debts','resellers'])registerHandler('adminReceivables:'+method,(_event,...args)=>{if(args.length)throw Error('These cards do not accept employee, business or date selectors.');return receivables[method]();});
  for(const method of ['debtReceipt','collectionBills','collectionPreview','payBill'])registerHandler('adminReceivables:'+method,(_event,...args)=>{if(args.length!==1)throw Error('Choose exactly one set of saved receivable details.');return receivables[method](args[0]);});
}

function registerHandlers() {
  registerCommerceHandlers();
  registerInvoiceVoidHandlers();
  registerWarehouseHandlers();
  registerAdminCatalogHandlers();
  registerAdminReceivablesHandlers();

  registerBandwidthHandlers();
  registerFixedMonthlyHandlers();
  registerCompanyDebtHandlers();
  registerBankHandlers();
  registerAdminTransferHandlers();
  registerNotesHandlers();
  registerMainOfficeSummaryHandlers();
  registerFinanceHandlers();
  // Main's Cashier/Support cards are saved-ledger reads, not portal balances or an
  // account-selection API. Resolve the caller afresh inside Resellers.
  registerHandler('dashboard:resellerCollections',(_event,input)=>{
    requirePermission('dashboard.view');requirePermission('reports.view');
    if(activeWorkspace().id!=='main')throw new Error('Open Main dashboard to view your reseller collection cards.');
    if(input!==undefined)throw new Error('These cards use your own account only; no employee or business selector is accepted.');
    const caller=currentUser(),role=caller.role==='section_user'?caller.source_role:caller.role;
    const unavailable=reason=>({available:false,scope:'own',includesRepresentative:true,reason});
    if(!['cashier','support'].includes(role))return unavailable('These collection cards are for Cashier or Support accounts.');
    let selected;try{selected=sectionAccess.forWorkspace(caller,'fiber-resellers');}catch{return unavailable('Resellers access is not assigned to your account.');}
    if(!selected.active||selected.role!==role)return unavailable('An active matching Cashier or Support account in Resellers is required.');
    return requestContext.run({workspaceId:'fiber-resellers',user:selected},()=>{
      if(!hasPermission('bills.view')||!hasPermission('reports.view'))return unavailable('Your account cannot view reseller collections.');
      const totals=ResellerAccounting.collectionOverview(workspaceDatabases.get('fiber-resellers').db,selected.account_key);
      const card=row=>({pendingToCollect:row.pendingToCollect,moneyAdded:row.moneyAdded,moneyCollected:row.moneyCollected});
      return {available:true,scope:'own',accountKey:selected.account_key,includesRepresentative:true,fibernetlb2:card(totals.fibernetlb2),all:card(totals.all)};
    });
  });
  // Main validates receipt ownership; the requesting PC opens WhatsApp locally.
  registerHandler('receipts:whatsapp',(_event,input)=>{
    const kind=String(input?.kind||''),id=Number(input?.id);if(!Number.isSafeInteger(id)||id<=0)throw Error('Choose a saved receipt.');
    let record;
    if(kind==='sale'){requirePermission('reports.view');record=saleReceipt(id);}
    else if(kind==='bill'){checkWorkspaceChannel('bills:list');requirePermission('bills.view');record=billById(id);}
    else if(kind==='telecom'){checkWorkspaceChannel('telecomPayments:list');requirePermission('telecom.view');const receipt=telecomReceipt(id);if(!receipt)throw Error('Receipt not found.');record=paymentLedger.enrich('telecom',receipt);}
    else if(kind==='installation'){checkWorkspaceChannel('expenses:list');requirePermission('expenses.view');record=installationRows(activityDatabase).find(p=>p.id===id);if(!record)throw Error('Receipt not found.');}
    else throw Error('Choose a supported receipt.');
    return whatsappReceipt(kind,record,input.phone,activeWorkspace().name);
  });
  const portalAdmin = () => {
    checkWorkspaceChannel("portal:settings");
    requirePermission("users.manage");
    if (networkConfig.mode !== "server" || activeWorkspace().id !== "main" || currentUser().role !== "admin") throw new Error("Internet API credentials can only be configured by the main administrator on the main PC.");
  };
  // Deliberately IPC-only: API passwords never travel over the store's LAN.
  registerIpc("portal:settings", () => { portalAdmin(); return portalApi.settings.publicSettings(); });
  registerIpc("portal:configure", (_event,input) => { portalAdmin(); const result=portalApi.settings.configure(input); portalApi.clearToken(); return result; });
  registerIpc("portal:test", async (_event,username) => { portalAdmin(); return portalApi.test(username); });
  registerIpc("portal:disable", () => { portalAdmin(); portalApi.clearToken(); return portalApi.settings.disable(); });
  registerHandler("portal:status", () => {
    if (activeWorkspace().id === "main") portalAdmin(); else if(activeWorkspace().kind==="reseller")authorizeResellerFunding();else authorizeInternetLookup();
    return {...portalApi.settings.status(),...activeWorkspace().id==='fiber-users'?{renewalPolicy:lateRenewalPolicy()}: {}};
  });
  const publicPortalCustomer = customer => hasPermission("bills.manage") || hasPermission("bundles.manage") ? customer : {...customer,cost:undefined,renewalQuote:undefined,plans:customer.plans?.map(({cost,fixedCost,renewalCost,...plan})=>plan)};
  const publicPlanQuote = quote => {
    if(hasPermission('bills.manage')||hasPermission('bundles.manage'))return quote;
    const pricing=quote.retailPricing;
    return {username:quote.username,expectedId:quote.expectedId,targetId:quote.targetId,beforeName:quote.beforeName,targetName:quote.targetName,expiry:quote.expiry,pendingRefills:quote.pendingRefills,refundAllowed:quote.total<0,
      retailPricing:pricing?.available?{available:true,beforePrice:pricing.beforePrice,targetPrice:pricing.targetPrice,currentFraction:pricing.currentFraction,pendingRefills:pricing.pendingRefills,retailAdjustment:pricing.retailAdjustment,customerAmount:pricing.customerAmount,customerCredit:pricing.customerCredit}:{available:false,reason:pricing?.reason}};
  };
  for (const [channel,method] of [["portal:lookup","customer"],["portal:search","search"],["portal:resellers","resellers"]]) registerHandler(channel,async (_event,value) => {
    authorizeInternetLookup();
    if (!portalApi.settings.status().ready) throw new Error("The main administrator must test and enable the Internet API first.");
    const result=await portalApi[method](value);
    authorizeInternetLookup();
    if(method==="customer") {const priced=await syncPortalCosts(result);authorizeInternetLookup();return publicPortalCustomer({...priced,lastPlanChange:planLedger.latest(result.username)});}
    if(method==="search") return {...result,customers:result.customers.map(publicPortalCustomer)};
    return result;
  });
  registerHandler("portal:planHistory",(_event,username)=>{authorizeInternetLookup();return planLedger.history(String(username));});
  registerHandler('portal:customerResellers',async()=>{authorizePortalOperation('create');const resellers=await portalApi.customerResellers();authorizePortalOperation('create');return resellers;});
  registerHandler('portal:customerOptions',async(_event,selection)=>{
    authorizePortalOperation('create');const context=await portalApi.registrationContext(selection);const options=await registrationBillingChoices(await context.newCustomerOptions());authorizePortalOperation('create');
    const formId=crypto.randomUUID(),expiry=starterExpiry();
    for(const [id,entry] of customerForms)if(entry.until<Date.now())customerForms.delete(id);
    if(customerForms.size>100)customerForms.delete(customerForms.keys().next().value);
    const resellerId=context.registrationScope.id,resellerUsername=context.registrationScope.username;
    customerForms.set(formId,{expiry,resellerId,resellerUsername,resetEpoch:billResetEpoch(database),workspaceId:activeWorkspace().id,userId:currentUser().account_key,until:Date.now()+30*60000});
    return {...options,resellerId,resellerUsername,formId,starterExpiry:expiry,cutoffTime:'12:00 · Asia/Beirut'};
  });
  registerHandler('portal:createCustomer',async(_event,value)=>{
    authorizePortalOperation('create');
    if(value.confirm!==true)throw Error('Confirm customer creation and the installation money received.');
    const previous=operationLedger.get(String(value.requestId||'')),form=customerForms.get(value.formId);
    if(!previous&&(!form||form.until<Date.now()||form.workspaceId!==activeWorkspace().id||form.userId!==currentUser().account_key||form.expiry!==starterExpiry()))throw Error('Reload the new-customer form to verify the next billing cycle. Nothing was created.');
    const expiry=previous?JSON.parse(previous.input_json).starterExpiry:form.expiry;
    const input=registrationInput(value,expiry);
    const original=previous?JSON.parse(previous.input_json):null;
    if(input.servicePayment?.paymentMethod==='Whish Money'){
      const snapshot=whishSelection(value.servicePayment,'Whish Money',original?original.servicePayment?.whishDestination??null:undefined);
      if(snapshot)input.servicePayment.whishDestination=snapshot;
    }
    if(input.installationAmount>0&&input.installationMethod==='Whish Money'){
      const snapshot=whishSelection({whishDestinationId:value.installationWhishDestinationId},'Whish Money',original?original.installationWhishDestination??null:undefined);
      if(snapshot)input.installationWhishDestination=snapshot;
    }
    if(!previous&&(!input.resellerId||input.resellerId!==form.resellerId||input.resellerUsername!==form.resellerUsername))throw Error('The selected reseller changed. Reload their services and confirm the correct owner. Nothing was created.');
    if(!previous&&!input.freeStarter&&!input.servicePayment)throw Error('Record the first Internet service payment when Free starter month is off. Nothing was created.');
    if(!previous&&input.servicePayment&&form.resetEpoch!==billResetEpoch(database))throw Error('Bills were reset. Reopen the new-customer form before recording a paid account.');
    const password=String(value.password??'');
    if(!['confirmed','succeeded','unknown','checking','processing'].includes(previous?.state)&&(!password||password.length>128||/[\r\n\x00]/.test(password)||password!==String(value.confirmPassword??'')))throw Error('Enter matching customer passwords (1–128 characters).');
    const row=await operationLedger.apply(String(value.requestId||''),'create',`customer:${input.username}`,input,{starterExpiry:input.starterExpiry,resellerId:input.resellerId,resellerUsername:input.resellerUsername},currentUser().full_name,async beforeSend=>{
      // Check under the parent account too, then use only the chosen reseller's
      // isolated session for options, create, profile verification and expiry.
      const context=input.resellerId?await portalApi.registrationContext(input):portalApi;
      if(input.resellerId)await portalApi.assertCustomerAbsent(input.username);
      return context.createCustomer(input,password,beforeSend,async options=>{
        if(!input.servicePayment)return;
        const selected=(await registrationBillingChoices(options)).services.find(p=>p.id===input.service),q=selected?.billing,p=input.servicePayment;
        if(!q)throw Error(selected?.billingError||'The selected service cannot be priced. Nothing was created.');
        if(q.bundleCode!==p.bundleCode||q.price!==p.expectedPrice||registrationBillCost(q)!==p.expectedCost)throw Error('The service selling price or current Proradius cost changed. Refresh costs and confirm the updated first bill. Nothing was created.');
        verifyRetailSelection(p.retailPricing,q.retailPricing,p.amount);
        const savedQuote={starterExpiry:input.starterExpiry,resellerId:input.resellerId,resellerUsername:input.resellerUsername,serviceBilling:q};
        database.run('UPDATE portal_operations SET quote_json=? WHERE request_id=?',[JSON.stringify(savedQuote),String(value.requestId)]);saveDatabase();
      });
    });
    return completeCustomerRegistration(row);
  });
  registerHandler("portal:resolvePlan",async (_event,id,input)=>{
    authorizeInternet();requirePermission("bills.manage");
    if(currentUser().role!=="admin") throw new Error("Only an administrator can reconcile an uncertain plan change.");
    return planLedger.resolve(String(id),input,currentUser().full_name,()=>{authorizeInternet();requirePermission('bills.manage');if(currentUser()?.role!=='admin')throw Error('Only an administrator can reconcile an uncertain plan change.');});
  });
  registerHandler("portal:quoteChange",async (_event,input)=>{
    authorizePortalOperation("change");
    const quote=await portalApi.quoteChange(input);quote.retailPricing=await pricePlanChange(quote);authorizePortalOperation("change");
    const id=crypto.randomUUID(),now=Date.now();
    for(const [key,item]of portalQuotes)if(item.until<now)portalQuotes.delete(key);
    if(portalQuotes.size>=200)portalQuotes.delete(portalQuotes.keys().next().value);
    portalQuotes.set(id,{quote,userKey:sectionAccess.key(currentUser(),activeWorkspace().id),until:now+120000});
    return {...publicPlanQuote(quote),quoteId:id,validUntil:new Date(now+120000).toISOString()};
  });
  registerHandler("portal:applyChange",async (_event,value)=>{
    authorizePortalOperation("change");
    const amount=Number(value.amount),method=paymentMethod(value.paymentMethod),reference=String(value.reference??"").trim(),period=String(value.billingPeriod??"");
    if(!Number.isFinite(amount)||Math.abs(amount)>1000000||money(amount)!==amount||reference.length>400||!/^\d{4}-\d{2}$/.test(period))throw Error("Enter a valid signed customer amount, month and reference.");
    if(amount<0&&!["Cash","Whish Money"].includes(method))throw Error("Record a downgrade refund by Cash or Whish Money, not as an unpaid customer debt.");
    const input={username:String(value.username),expectedId:Number(value.expectedId),targetId:Number(value.targetId),amount,paymentMethod:method,reference,billingPeriod:period};
    const previous=operationLedger.get(String(value.requestId));
    if(method==='Whish Money'){const snapshot=whishSelection(value,method,previous?JSON.parse(previous.input_json).whishDestination??null:undefined);if(snapshot)input.whishDestination=snapshot;}
    if(previous){
      const original=JSON.parse(previous.input_json);
      for(const key of Object.keys(input))if(JSON.stringify(input[key])!==JSON.stringify(original[key]))throw Error("This request already has different details. Start a new operation.");
      if(["confirmed","succeeded"].includes(previous.state))return portalOperationBill(previous);
    }
    const saved=portalQuotes.get(String(value.quoteId));
    if(!saved||saved.until<Date.now()||saved.userKey!==sectionAccess.key(currentUser(),activeWorkspace().id))throw Error("The calculation expired. Get a fresh Proradius quote.");
    const quote=saved.quote;
    if(input.username!==quote.username||input.expectedId!==quote.expectedId||input.targetId!==quote.targetId||value.confirm!==true)throw Error("Confirm the exact customer and quoted target plan.");
    if(amount<0&&(quote.total>=0||(quote.retailPricing?.available&&quote.retailPricing.retailAdjustment>=0)))throw Error("A negative customer amount is only allowed for a quoted downgrade credit.");
    if(one("SELECT request_id FROM bill_requests WHERE request_id=?",[String(value.requestId)]))throw Error("This request ID was already used for a payment.");
    if(one("SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[quote.username])||one("SELECT bill_id FROM internet_renewals WHERE username=? AND state IN ('checking','processing','unknown')",[quote.username]))throw Error("Review the customer's unfinished renewal or plan change first.");
    Object.assign(input,{customerName:quote.customerName||quote.username,phone:quote.phone});
    // Never silently revise a customer amount after confirmation.
    const resetEpoch=billResetEpoch(database),freshPricing=await pricePlanChange(quote);
    authorizePortalOperation("change");
    if(resetEpoch!==billResetEpoch(database))throw Error("Bills were reset during calculation. Start a new plan change; no portal action was sent.");
    if(saved.until<Date.now())throw Error("The calculation expired while checking costs. Get a fresh Proradius quote; no plan change was sent.");
    if(quote.retailPricing?.available!==freshPricing.available||(freshPricing.available&&JSON.stringify(freshPricing)!==JSON.stringify(quote.retailPricing)))throw Error("The bundle selling prices or monthly costs changed. Calculate again and confirm the new customer amount; no plan change was sent.");
    const row=await operationLedger.apply(String(value.requestId),"change",`customer:${quote.username}`,input,quote,currentUser().full_name,before=>portalApi.applyQuotedChange(quote,before));
    return portalOperationBill(row);
  });
  registerHandler("resellers:portalList",async ()=>{authorizeResellerFunding();const list=await portalApi.moneyResellers();const actor=authorizeResellerFunding();return list.map(row=>resellerBalanceForRole(row,actor.role));});
  registerHandler('resellers:accounts',()=>{authorizeResellerFunding();refreshWhishReceiptPolicy();return resellerFunding.accounts();});
  registerHandler('resellers:fund',(_event,value)=>{authorizeResellerFunding('write');const prior=operationLedger.get(String(value?.requestId||'')),reseller=Finance.query(workspaceDatabases.get('fiber-resellers').db,'SELECT username FROM resellers WHERE id=?',[Number(value?.resellerId)])[0];refreshWhishReceiptPolicy(!prior&&reseller?.username==='fibernetlb2'&&value?.paymentMethod==='Whish Money'?['fiber-users','fiber-resellers']:[]);return resellerFunding.apply(value,false);});
  registerHandler('resellers:refund',(_event,value)=>{authorizeResellerFunding('write');const prior=operationLedger.get(String(value?.requestId||'')),reseller=Finance.query(workspaceDatabases.get('fiber-resellers').db,'SELECT username FROM resellers WHERE id=?',[Number(value?.resellerId)])[0];refreshWhishReceiptPolicy(prior?[]:reseller?.username==='fibernetlb2'?['fiber-resellers','fiber-users']:['fiber-resellers']);return resellerFunding.apply(value,true);});
  registerHandler('resellers:collectionSources',()=>{authorizeResellerCollection();refreshWhishReceiptPolicy();return resellerCollections.accounts();});
  registerHandler('resellers:collectionBills',(_event,value)=>{authorizeResellerCollection();refreshWhishReceiptPolicy();return resellerCollections.bills(value);});
  registerHandler('resellers:collectionPreview',(_event,value)=>{authorizeResellerCollection();const db=workspaceDatabases.get('fiber-resellers').db,prior=Finance.query(db,'SELECT request_id FROM reseller_collections WHERE request_id=?',[String(value?.requestId||'')])[0],reseller=Finance.query(db,'SELECT username FROM resellers WHERE id=?',[Number(value?.resellerId)])[0];if(!prior&&!value?.fundRequestId)throw new Error('Select a saved Add Money bill. New collections must use its original payment details; only an already saved collection may resume its legacy input.');if(!prior)refreshWhishReceiptPolicy(reseller?.username==='fibernetlb2'?['fiber-resellers','fiber-users']:['fiber-resellers']);return resellerCollections.prepare(value);});
  registerHandler('resellers:payBill',(_event,value)=>{authorizeResellerCollection();const db=workspaceDatabases.get('fiber-resellers').db,prior=Finance.query(db,'SELECT request_id FROM reseller_collections WHERE request_id=?',[String(value?.requestId||'')])[0],reseller=Finance.query(db,'SELECT username FROM resellers WHERE id=?',[Number(value?.resellerId)])[0];if(!prior&&!value?.fundRequestId)throw new Error('Select a saved Add Money bill. New collections must use its original payment details; only an already saved collection may resume its legacy input.');if(!prior)refreshWhishReceiptPolicy(reseller?.username==='fibernetlb2'?['fiber-resellers','fiber-users']:['fiber-resellers']);return resellerCollections.apply(value);});
  registerHandler('resellers:collections',()=>resellerCollections.history());
  registerHandler('resellers:reconciliationPreview',(_event,input)=>{authorizeResellerCollection();assertNoAdminWalletCorrectionPending();refreshWhishReceiptPolicy();return resellerWalletReconciliation.preview(input||{});});
  registerHandler('resellers:reconcileWallets',(_event,input)=>{authorizeResellerCollection();assertNoAdminWalletCorrectionPending();if(!ResellerWalletReconciliation.pending(workspaceDatabases.get('fiber-resellers').db).length)refreshWhishReceiptPolicy(['fiber-users','fiber-resellers']);return resellerWalletReconciliation.apply(input||{});});
  registerHandler('resellers:reconciliationHistory',()=>{authorizeResellerCollection();return resellerWalletReconciliation.history();});
  registerHandler('resellers:resumeWalletReconciliation',(_event,input)=>{authorizeResellerCollection();assertNoAdminWalletCorrectionPending();return resellerWalletReconciliation.resume(String(input?.requestId||''));});
  registerHandler('resellers:walletCorrectionPreview',(_event,input)=>{authorizeResellerCollection();refreshWhishReceiptPolicy();return resellerAdminWalletCorrections.preview(input||{});});
  registerHandler('resellers:correctCollectedWallets',(_event,input)=>{authorizeResellerCollection();if(!ResellerAdminWalletCorrections.pending(workspaceDatabases.get('fiber-resellers').db).length)refreshWhishReceiptPolicy(['fiber-resellers']);return resellerAdminWalletCorrections.apply(input||{});});
  registerHandler('resellers:walletCorrectionHistory',()=>{authorizeResellerCollection();return resellerAdminWalletCorrections.history();});
  registerHandler('resellers:resumeWalletCorrection',(_event,input)=>{authorizeResellerCollection();return resellerAdminWalletCorrections.resume(String(input?.requestId||''));});
  registerHandler('resellers:cancelCollection',(_event,id,note)=>resellerCollections.cancel(String(id),String(note||'')));
  registerHandler('resellers:importPreview',(_event,value)=>resellerFunding.previewImport(value));
  registerHandler('resellers:importCharges',(_event,value)=>resellerFunding.import(value));
  registerHandler('resellers:releaseFailed',(_event,id)=>{const row=operationLedger.get(String(id));authorizeResellerFunding('recover',row);if(!row||row.state!=='failed'||![1,2,3,4,5,6].includes(JSON.parse(row.input_json).accountingVersion))throw Error('Only a known failed funding request can release its reservation.');resellerFunding.release(row);return {ok:true};});
  registerHandler("resellers:addMoney",async (_event,value)=>{
    throw Error('Use the updated reseller funding form. Legacy top-up receipts cannot settle the new independent ledger.');
    authorizePortalOperation("topup");
    const local=one("SELECT * FROM resellers WHERE id=? AND active=1",[Number(value.resellerId)]),amount=Number(value.amount),method=paymentMethod(value.paymentMethod),reference=String(value.reference??"").trim();
    if(!local||!Number.isFinite(amount)||amount<1||amount>1000000||money(amount)!==amount||!["Cash","Whish Money"].includes(method)||reference.length>350||!Number.isSafeInteger(Number(value.portalResellerId)))throw Error("Select an active reseller and at least $1 received by Cash or Whish Money.");
    const input={resellerId:local.id,portalResellerId:Number(value.portalResellerId),username:local.username,customerName:local.full_name,phone:local.phone,amount,paymentMethod:method,reference,billingPeriod:String(value.billingPeriod||localIso().slice(0,7))};
    if(!/^\d{4}-\d{2}$/.test(input.billingPeriod)||value.confirm!==true)throw Error("Confirm the reseller transfer and a valid billing month.");
    const previous=operationLedger.get(String(value.requestId));
    if(method==='Whish Money'){const snapshot=whishSelection(value,method,previous?JSON.parse(previous.input_json).whishDestination??null:undefined);if(snapshot)input.whishDestination=snapshot;}
    if(previous&&previous.fingerprint!==operationLedger.fingerprint(input))throw Error("This request already has different details. Start a new operation.");
    if(previous&&["confirmed","succeeded"].includes(previous.state))return portalOperationBill(previous);
    if(one("SELECT request_id FROM bill_requests WHERE request_id=?",[String(value.requestId)]))throw Error("This request ID was already used for a payment.");
    const row=await operationLedger.apply(String(value.requestId),"topup",`reseller:${input.portalResellerId}`,input,{},currentUser().full_name,before=>portalApi.topUp({...input,comment:`${reference} · FIBER Bills ${value.requestId}`},before));
    return portalOperationBill(row);
  });
  registerHandler("portal:operations",(_event,kind)=>{if(['topup','reseller_refund'].includes(kind))authorizeResellerFunding();else authorizePortalOperation(kind);return operationLedger.history(kind).map(row=>kind==='change'?{...row,quote:publicPlanQuote(row.quote)}:row);});
  registerHandler("portal:resumeOperation",(_event,id)=>{
    const row=operationLedger.get(String(id));if(!row)throw Error("Operation not found.");if(['topup','reseller_refund'].includes(row.kind))authorizeResellerFunding('recover',row);else authorizePortalOperation(row.kind);
    if(!["confirmed","succeeded"].includes(row.state))throw Error("Verify the portal outcome first.");
    return completePortalOperation(row);
  });
  registerHandler("portal:resolveOperation",async (_event,id,input)=>{
    const row=operationLedger.get(String(id));if(!row)throw Error("Operation not found.");const funding=['topup','reseller_refund'].includes(row.kind);
    if(funding)authorizeResellerFunding('recover',row);else{authorizePortalOperation(row.kind);if(currentUser().role!=="admin")throw Error("Only an administrator can reconcile an uncertain portal action.");}
    if(row.kind==='free'){
      const original=JSON.parse(row.input_json),customer=await portalApi.customer(original.username),quote=JSON.parse(row.quote_json);
      if(customer.serviceId!==original.serviceId||customer.resellerId!==original.resellerId)throw Error('The customer owner or service changed. Review the exact expiry edit in Proradius.');
      if(input.confirmation==='APPLIED'&&customer.expiry.slice(0,10)!==original.expiry)throw Error('The requested free expiry is not present in Proradius. No funding was saved.');
      if(input.confirmation==='NOT APPLIED'&&customer.expiry!==original.expectedExpiry)throw Error('The expiry changed; a failed response does not prove the edit was not applied. Review the exact action.');
      if(input.confirmation==='APPLIED'){database.run('UPDATE portal_operations SET result_json=? WHERE request_id=?',[JSON.stringify({customer,beforeExpiry:quote.customer.expiry,freeExpiry:original.expiry}),row.request_id]);saveDatabase();}
    }
    if(["APPLIED","NOT APPLIED"].includes(input.confirmation)&&row.kind==="change"){
      const quote=JSON.parse(row.quote_json),customer=await portalApi.customer(quote.username);
      if(customer.serviceId!==(input.confirmation==="APPLIED"?quote.targetId:quote.expectedId))throw Error("Your confirmation does not match the active Proradius service. Review the account and transactions.");
    }
    if(row.kind==='create'){
      const note=String(input.note??'').trim();
      if(row.state!=='unknown'||!['APPLIED','NOT APPLIED'].includes(input.confirmation)||note.length<5||note.length>500)throw Error('Only an uncertain registration can be reviewed. Choose APPLIED or NOT APPLIED and supply a 5–500 character audit note.');
      const original=JSON.parse(row.input_json);
      if(input.confirmation==='NOT APPLIED')await portalApi.assertCustomerAbsent(original.username);
      else if(input.confirmation==='APPLIED'){
        const context=original.resellerId?await portalApi.registrationContext(original):portalApi;
        let customer=await context.verifyNewCustomer(original);
        if(original.freeStarter&&customer.expiry.slice(0,10)!==original.starterExpiry){
          if(input.finishStarter!==true)throw Error('The customer exists but the starter expiry is incomplete. Confirm Finish free expiry to repair only the date; the account will not be recreated.');
          customer=await context.setStarterExpiry(original,metadata=>{authorizePortalOperation('create');if(currentUser()?.role!=='admin')throw Error('Only an administrator can reconcile an uncertain portal action.');operationLedger.finish(row.request_id,'unknown','Administrator is completing only the free expiry date.',currentUser().full_name,metadata);});
        }
        authorizePortalOperation('create');if(currentUser()?.role!=='admin')throw Error('Only an administrator can reconcile an uncertain portal action.');
        database.run('UPDATE portal_operations SET result_json=? WHERE request_id=?',[JSON.stringify({phase:'complete',customer}),row.request_id]);saveDatabase();
      }
    }
    if(funding)authorizeResellerFunding('recover',row);else{authorizePortalOperation(row.kind);if(currentUser()?.role!=='admin')throw Error('Only an administrator can reconcile an uncertain portal action.');}const resolved=operationLedger.resolve(String(id),input,currentUser().full_name);
    if(resolved.state!=='confirmed'&&[1,2,3,4,5,6].includes(JSON.parse(resolved.input_json).accountingVersion))resellerFunding.release(resolved);
    return resolved.state==='confirmed'?completePortalOperation(resolved):{state:resolved.state};
  });
  registerHandler('bills:saveFreeRenewal',async(_event,value)=>{
    authorizePortalOperation('free');const resetEpoch=billResetEpoch(database),previous=operationLedger.get(String(value?.requestId||''));
    const input=freeRenewalInput(value,previous?JSON.parse(previous.input_json).asOf:new Date());
    if(input.amount>0)input.whishDestination=Whish.resolveDestination(workspaceDatabases.get('main').db,input.paymentMethod,value.whishDestinationId,previous?JSON.parse(previous.input_json).whishDestination:undefined);
    if(previous){
      if(previous.kind!=='free'||previous.fingerprint!==operationLedger.fingerprint(input))throw Error('This renewal request already has different details. Open a new form.');
      if(['confirmed','succeeded'].includes(previous.state))return completeFreeRenewal(previous);
      if(['checking','processing','unknown'].includes(previous.state))throw Error('This free renewal needs review; do not repeat it. Check Free renewal history.');
    }
    const currentPolicy=lateRenewalPolicy();if(!currentPolicy.free||currentPolicy.asOf!==input.asOf)throw Error('The renewal day changed. Refresh the form; nothing was submitted.');
    const customer=await portalApi.customer(input.username);
    const bundle=matchInternetBundle(customer.service,listBundles());
    if(!bundle||customer.serviceId!==input.serviceId||customer.resellerId!==input.resellerId||customer.expiry!==input.expectedExpiry||customer.blocked)throw Error('Verify the current customer, owner, active plan and expiry before free renewal.');
    if(one("SELECT bill_id FROM internet_renewals WHERE username=? AND state IN ('checking','processing','unknown')",[input.username])||one("SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[input.username]))throw Error('Resolve this customer’s unfinished renewal or plan change first.');
    authorizePortalOperation('free');if(resetEpoch!==billResetEpoch(database))throw Error('Bills were reset during lookup. Open a new renewal form.');
    const row=await operationLedger.apply(input.requestId,'free',`customer:${input.username}`,input,{customer,bundleCode:bundle.code,bundleName:bundle.name},currentUser().full_name,beforeSend=>portalApi.setFreeRenewalExpiry(input,metadata=>{
      authorizePortalOperation('free');const livePolicy=lateRenewalPolicy();if(!livePolicy.free||livePolicy.asOf!==input.asOf||resetEpoch!==billResetEpoch(database))throw Error('The renewal day or bills changed before submission. Refresh the form.');beforeSend(metadata);
    }));
    return completeFreeRenewal(row);
  });
  registerHandler("bills:savePortal",async (_event,input,wantRenew=false)=>{
    authorizeInternet();
    const resetEpoch=billResetEpoch(database);
    if(typeof wantRenew!=="boolean") throw new Error("Choose a valid bill action.");
    const bill=validateBill(input),requestId=String(input.requestId||"");
    if(!requestId) throw new Error("A unique payment request ID is required.");
    const replay=renewalLedger.replay(requestId,paymentFingerprint(bill,input,wantRenew));
    if(replay) return {...billById(replay),idempotent:true};
    if(!portalApi.settings.status().ready) throw new Error("The main administrator must enable the Internet API first.");
    if(wantRenew && bill.paymentMethod==="Unpaid") throw new Error("Unpaid bills are records only; no plan change or renewal was sent.");
    const expectedId=Number(input.portalExpectedServiceId),targetId=Number(input.portalServiceId);
    if(!Number.isSafeInteger(expectedId)||expectedId<=0||!Number.isSafeInteger(targetId)||targetId<=0) throw new Error("Verify the customer's current portal plan first.");
    let customer=await portalApi.customer({username:bill.customerAccount,reseller:input.portalReseller||""});
    customer=await syncPortalCosts(customer,{force:true,strict:true});
    if(wantRenew&&lateRenewalPolicy(undefined,customer.expiry).free)throw Error('Use Free renewal for this unrenewed current cycle. Already-renewed customers may purchase additional full months. No paid renewal was sent.');
    if(resetEpoch!==billResetEpoch(database))throw Error("Bills were reset during lookup. Open a new bill form; no plan change, bill or renewal was sent.");
    if(operationLedger.pending(`customer:${customer.username}`))throw Error("Review this customer's unfinished portal operation first.");
    const target=matchPortalPlan(one("SELECT code,name,service_type AS serviceType,allowance FROM fibernetlb_bundles WHERE code=? AND active=1",[bill.bundleCode]),customer.plans);
    if(!target||target.id!==targetId||target.cost===null) throw new Error("The selected bundle or its internal cost cannot be verified in Proradius. No change or bill was saved.");
    const fixedMonthlyCost=target.fixedCost;
    if(!Number.isFinite(fixedMonthlyCost)||fixedMonthlyCost<0)throw Error("The selected plan has no verified fixed monthly cost under fibernetlb2. No plan change, bill or renewal was saved.");
    const retailQuote=bill.retailPricing?internetBillPricing(Number(one('SELECT price FROM fibernetlb_bundles WHERE code=? AND active=1',[bill.bundleCode]).price),bill.renewalMonths,undefined,customer.expiry):null;
    if(retailQuote)verifyRetailSelection(bill.retailPricing,retailQuote,bill.amount);
    const changing=targetId!==expectedId;
    if(changing) {
      if(input.confirmPlanChange!==true) throw new Error("Confirm the plan change before saving.");
      const unfinishedRenewal=one("SELECT bill_id FROM internet_renewals WHERE username=? AND state IN ('checking','processing','unknown')",[customer.username]);
      if(unfinishedRenewal) throw new Error("Resolve this customer's unfinished renewal before changing plans.");
      customer=await planLedger.apply({requestId,username:customer.username,expectedId,targetId,targetName:target.name,expectedResellerId:customer.resellerId},currentUser().full_name);
    } else if(customer.serviceId!==expectedId) throw new Error("The customer's portal plan changed since lookup. Verify it again before saving.");
    const renewalQuote=changing?await portalApi.quoteRenewal(customer.username,targetId):customer.renewalQuote;
    const cost=renewalQuote?.cost;
    if(!Number.isFinite(cost)||cost<0) throw new Error("The selected plan's internal cost is unavailable. No bill or renewal was saved; review Plan change history if a change was requested.");
    if(one("SELECT request_id FROM internet_plan_changes WHERE username=? AND state IN ('checking','processing','unknown')",[customer.username])) throw new Error("This customer has an unfinished plan change. Review Plan change history before saving or renewing.");
    authorizeInternet();
    if(!portalApi.settings.status().ready) throw new Error("The Internet API was disabled. No bill was saved.");
    const saved=createBillPayment(input,wantRenew,{cost,fixedMonthlyCost,retailQuote,customerExpiry:customer.expiry});
    if(changing) planLedger.attach(requestId,saved.id);
    if(wantRenew && !saved.idempotent) {
      try { await renewalLedger.start(saved,renewalActor(),{serviceId:targetId}); }
      catch(error) {renewalLedger.recordFailure(saved,currentUser().full_name,error.message||"No renewal was sent.");}
    }
    return {...billById(saved.id),planChanged:changing};
  });
  registerHandler("bills:saveRenew", async (_event,input) => {
    authorizeInternet(); const bill=createBillPayment(input,true);
    if (bill.idempotent) return bill;
    const actor=renewalActor();
    try { await renewalLedger.start(bill,actor); }
    catch(error) { renewalLedger.recordFailure(bill,actor,error.message || "No renewal was sent."); }
    return billById(bill.id);
  });
  registerHandler("bills:renew", async (_event,id) => {
    authorizeInternet(); const bill=billById(id);
    await renewalLedger.start(bill,renewalActor()); return billById(bill.id);
  });
  registerHandler("bills:receiptCredentials", async (_event,id) => {
    authorizeInternet(); requirePermission("bills.view");
    const bill = billById(id);
    if (bill.serviceType !== "Internet") throw new Error("Internet credentials are available for Internet receipts only.");
    if (!portalApi.settings.status().ready) throw new Error("The administrator must connect Proradius before printing Internet passwords.");
    const credentials = await portalApi.receiptCredentials(bill.customerAccount);
    // Recheck current access and the saved receipt after the asynchronous read.
    authorizeInternet(); requirePermission("bills.view");
    if (billById(id).customerAccount !== credentials.username) throw new Error("The receipt changed. Open it again.");
    return credentials;
  });
  registerHandler("bills:renewalHistory", (_event,id) => { requirePermission("bills.view"); if (activeWorkspace().id !== "fiber-users") throw new Error("Internet renewals belong to FIBER net lb Users."); if(!one('SELECT id FROM fibernetlb_bills WHERE id=?',[Number(id)]))throw Error('Bill payment was not found.'); return renewalLedger.history(Number(id)); });
  registerHandler("bills:resolveRenewal", (_event,id,input) => {
    authorizeInternet(); requirePermission("bills.manage");
    if (currentUser().role !== "admin") throw new Error("Only an administrator can reconcile an uncertain renewal.");
    renewalLedger.resolve(Number(id),input,currentUser().full_name); return billById(id);
  });
  registerHandler("auth:status", () => {
    if(currentUser()) {try{activeSession().user=sectionAccess.forWorkspace(currentUser(),activeSession().workspaceId);}catch{activeSession().user=null;}}
    if (currentUser() && !sectionAccess.permitted(currentUser(),activeSession().workspaceId)) activeSession().user = null;
    return { needsSetup:Number(one("SELECT COUNT(*) AS count FROM users").count) === 0, user:publicUser(currentUser()) };
  });

  registerHandler("auth:createOwner", (_event, input) => {
    if (activeWorkspace().id !== "main") throw new Error("Create the owner account in the main dashboard first.");
    if (Number(one("SELECT COUNT(*) AS count FROM users").count) > 0) throw new Error("The owner account has already been created.");
    const user = validateUserInput({ ...input, role: "admin", active: true });
    const password = passwordRecord(user.password);
    database.run("INSERT INTO users (username, full_name, password_hash, password_salt, role, active) VALUES (?, ?, ?, ?, 'admin', 1)", [user.username, user.fullName, password.hash, password.salt]);
    activeSession().user = one("SELECT * FROM users WHERE username = ?", [user.username]);
    sectionAccess.attach(activeSession().user,"main");
    activeSession().user = one("SELECT * FROM users WHERE username = ?", [user.username]);
    sectionAccess.assign(activeSession().user.account_key,sectionAccess.sections.map(s => s.id));
    saveDatabase();
    if (activeWorkspace().id === "main") {
      const owner = one("SELECT * FROM users WHERE username = ?", [user.username]);
      for (const [id, entry] of workspaceDatabases) {
        if (id === "main" || entry.db.exec("SELECT id FROM users LIMIT 1").length) continue;
        entry.db.run("INSERT INTO users (username,full_name,password_hash,password_salt,role,active) VALUES (?,?,?,?, 'admin',1)", [owner.username,owner.full_name,owner.password_hash,owner.password_salt]);
        writePrivateFile(entry.path, Buffer.from(entry.db.export()));
      }
    }
    return publicUser(currentUser());
  });

  registerHandler("auth:login", (_event, input) => {
    const user = authenticateUser(input);
    activeSession().user = user;
    return publicUser(user);
  });

  registerHandler("auth:logout", () => { activeSession().user = null; return { ok: true }; });

  registerHandler("users:list", () => {
    requireStaffAdmin();
    return sectionAccess.roster(activeSession().workspaceId).map(staffFeatureProfile);
  });

  registerHandler("users:updateAccess", (_event, key, ids) => {
    requireStaffAdmin();
    if (activeWorkspace().id !== "main" || currentUser()?.role !== "admin") throw new Error("Only the main administrator can assign business access.");
    sectionAccess.assign(String(key),ids);
    return staffFeatureProfile(sectionAccess.roster("main").find(user => user.accountKey === key));
  });

  registerHandler("users:create", (_event, input) => {
    requireStaffAdmin();
    const user = validateUserInput(input);
    const features=staffFeatureInput(input,user.role);
    sectionAccess.assertUsernameAvailable(user.username);
    if (input.allowedSections !== undefined && activeWorkspace().id !== "main") throw new Error("Only the main administrator can assign business access.");
    const defaults = user.role === "attendance_operator" ? ["main-attendance"] : [...WORKSPACES.filter(s => s.id !== "main"), ...MAIN_AREAS].map(s => s.id);
    const ids = activeWorkspace().id === "main" ? userAccessInput(input,user.role,user.active,defaults) : undefined;
    for (const id of ids || []) {
      const entry = workspaceDatabases.get(id);
      if (entry) {
        const statement = entry.db.prepare("SELECT id FROM users WHERE username = ?");
        statement.bind([user.username]); const collision = statement.step(); statement.free();
        if (collision) throw new Error("That username already exists in a selected section.");
      }
    }
    const password = passwordRecord(user.password);
    database.run("INSERT INTO users (username, full_name, password_hash, password_salt, role, active) VALUES (?, ?, ?, ?, ?, ?)", [user.username, user.fullName, password.hash, password.salt, user.role, user.active ? 1 : 0]);
    const created = one("SELECT * FROM users WHERE username = ?", [user.username]);
    sectionAccess.attach(created,activeSession().workspaceId,ids);
    saveStaffFeatures(sectionAccess.key(created,activeSession().workspaceId),features);
    saveDatabase();
    return publicUser(one("SELECT * FROM users WHERE username = ?", [user.username]));
  });

  registerHandler("users:update", (_event, id, input) => {
    requireStaffAdmin();
    const {user:target,key,actorKey,policy}=staffAccountTarget(id),origin=policy.origin;
    const user = validateUserInput(input, { passwordRequired: false });
    const features=staffFeatureInput(input,user.role);
    if (input.allowedSections !== undefined && activeWorkspace().id !== "main") throw new Error("Only the main administrator can assign business access.");
    const ids = activeWorkspace().id === "main" ? userAccessInput(input,user.role,user.active,sectionAccess.ids(target,"main"),origin) : undefined;
    for (const [sectionId, entry] of workspaceDatabases) {
      if (sectionId === activeSession().workspaceId) continue;
      const statement = entry.db.prepare("SELECT account_key FROM users WHERE username = ?"); statement.bind([user.username]);
      const collision = statement.step() ? statement.getAsObject() : null; statement.free();
      const clone = entry.db.prepare("SELECT id FROM users WHERE account_key = ?"); clone.bind([target.account_key]); const hasClone = clone.step(); clone.free();
      if ((hasClone || ids?.includes(sectionId)) && collision && collision.account_key !== target.account_key) throw new Error("That username belongs to another account in a linked section.");
    }
    if (target.account_key===actorKey && !user.active) throw new Error("You cannot deactivate your own account.");
    sectionAccess.updateAccount(target.account_key,{...user,passwordRecord:user.password?passwordRecord(user.password):null},ids);
    saveStaffFeatures(key,features);
    if(user.password||user.username!==target.username||!user.active)endStaffSessions(key,target.account_key===actorKey?activeSession():null);
    if (target.account_key===actorKey) activeSession().user = sectionAccess.forWorkspace(target,activeWorkspace().id);
    saveDatabase();
    return key===actorKey?publicUser(currentUser()):staffFeatureProfile(sectionAccess.roster(activeWorkspace().id).find(user=>user.accountKey===key));
  });

  registerHandler('users:delete',(_event,value,confirmation)=>{
    requireStaffAdmin();
    const {key,actorKey}=staffAccountTarget(value);
    const result=sectionAccess.removeAccount(key,actorKey,currentUser().full_name,String(confirmation??''));
    endStaffSessions(key);
    return result;
  });

  registerHandler("employees:list", () => {
    if (!hasPermission("attendance.view") && !hasPermission("attendance.manage")) requirePermission("attendance.view");
    return listEmployees();
  });

  registerHandler("employees:create", (_event, input) => {
    requirePermission("attendance.manage");
    const employee = validateEmployee(input);
    database.run("INSERT INTO employees (employee_no, full_name, job_title, rfid_card, active) VALUES (?, ?, ?, ?, ?)", [employee.employeeNo, employee.fullName, employee.jobTitle, employee.rfidCard, employee.active ? 1 : 0]);
    saveDatabase();
    return listEmployees().find((item) => item.employeeNo === employee.employeeNo);
  });

  registerHandler("employees:update", (_event, id, input) => {
    requirePermission("attendance.manage");
    const existing = one("SELECT * FROM employees WHERE id = ?", [Number(id)]);
    if (!existing) throw new Error("Employee not found.");
    const employee = validateEmployee(input);
    if (!employee.active && one("SELECT id FROM attendance_records WHERE employee_id = ? AND clock_out IS NULL", [Number(id)])) throw new Error("Clock this employee out before deactivating them.");
    database.run("UPDATE employees SET employee_no = ?, full_name = ?, job_title = ?, rfid_card = ?, active = ? WHERE id = ?", [employee.employeeNo, employee.fullName, employee.jobTitle, employee.rfidCard, employee.active ? 1 : 0, Number(id)]);
    saveDatabase();
    return listEmployees().find((item) => Number(item.id) === Number(id));
  });

  registerHandler("attendance:scan", (_event, cardValue) => {
    requirePermission("attendance.clock");
    const rfidCard = normalizeRfid(cardValue);
    if (!rfidCard) throw new Error("Scan an RFID card.");
    const employee = one("SELECT * FROM employees WHERE rfid_card = ? AND active = 1", [rfidCard]);
    if (!employee) throw new Error("This RFID card is not assigned to an active employee.");
    const now = localIso();
    const openRecord = one("SELECT * FROM attendance_records WHERE employee_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1", [employee.id]);
    if (openRecord) {
      const secondsSinceClockIn = (new Date(now).getTime() - new Date(openRecord.clock_in).getTime()) / 1000;
      if (secondsSinceClockIn < 10) throw new Error("Card already scanned. Wait a few seconds before clocking out.");
      database.run("UPDATE attendance_records SET clock_out = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [now, currentUser().id, openRecord.id]);
      saveDatabase();
      return { direction: "out", employee: { id: Number(employee.id), employeeNo: employee.employee_no, fullName: employee.full_name, jobTitle: employee.job_title }, time: now };
    }
    database.run("INSERT INTO attendance_records (employee_id, clock_in, recorded_by) VALUES (?, ?, ?)", [employee.id, now, currentUser().id]);
    saveDatabase();
    return { direction: "in", employee: { id: Number(employee.id), employeeNo: employee.employee_no, fullName: employee.full_name, jobTitle: employee.job_title }, time: now };
  });

  registerHandler("attendance:list", (_event, startDate, endDate) => {
    requirePermission("attendance.view");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("Choose a valid attendance date range.");
    return listAttendance(startDate, endDate);
  });

  registerHandler("attendance:update", (_event, id, input) => {
    requirePermission("attendance.manage");
    if(!one(`SELECT id FROM attendance_records WHERE id=? ${currentUser().role==='admin'?'':'AND recorded_by=?'}`,currentUser().role==='admin'?[Number(id)]:[Number(id),currentUser().id]))throw Error('Attendance record not found for your account.');
    const normalizeDateTime = (value, required) => {
      const text = String(value ?? "").trim();
      if (!text && !required) return null;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new Error("Enter a valid attendance date and time.");
      return text.length === 16 ? `${text}:00` : text;
    };
    const clockIn = normalizeDateTime(input.clockIn, true);
    const clockOut = normalizeDateTime(input.clockOut, false);
    if (clockOut && new Date(clockOut) < new Date(clockIn)) throw new Error("Clock-out time cannot be before clock-in time.");
    database.run("UPDATE attendance_records SET clock_in = ?, clock_out = ?, recorded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [clockIn, clockOut, currentUser().id, Number(id)]);
    saveDatabase();
    return one("SELECT id, clock_in AS clockIn, clock_out AS clockOut FROM attendance_records WHERE id = ?", [Number(id)]);
  });

  registerHandler("attendance:delete", (_event, id) => {
    requirePermission("attendance.manage");
    if(!one(`SELECT id FROM attendance_records WHERE id=? ${currentUser().role==='admin'?'':'AND recorded_by=?'}`,currentUser().role==='admin'?[Number(id)]:[Number(id),currentUser().id]))throw Error('Attendance record not found for your account.');
    database.run("DELETE FROM attendance_records WHERE id = ?", [Number(id)]);
    saveDatabase();
    return { ok: true };
  });

  registerHandler("resellers:list", () => {
    if (!hasPermission("bills.view") && !hasPermission("bills.create") && !hasPermission("bills.manage")) requirePermission("bills.view");
    return rows(`SELECT id, username, full_name AS fullName, phone, active FROM resellers ${currentUser().role === "admin" ? "" : "WHERE active = 1"} ORDER BY username COLLATE NOCASE`).map(item=>({...item,active:Boolean(item.active)}));
  });
  // Keep legacy channels explicitly blocked for older clients; sync and history remain available.
  for (const channel of ["resellers:create", "resellers:remove", "resellers:restore"]) registerHandler(channel,()=>{
    requirePermission("bills.view");
    throw new Error("Adding, removing or restoring resellers in this application is disabled. Use the synced Proradius reseller list.");
  });

  registerHandler("bills:list", (_event, startDate, endDate) => {
    requirePermission("bills.view");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("Choose a valid bill date range.");
    return listBills(startDate, endDate);
  });

  registerHandler("bills:csv", (_event, startDate, endDate) => billCsv(startDate, endDate));

  registerHandler("bills:export", async (_event, startDate, endDate) => {
    return billCsv(startDate, endDate);
  });

  registerHandler("bundles:list", () => {
    if (!hasPermission("bills.view") && !hasPermission("bills.create") && !hasPermission("bills.manage")) requirePermission("bills.view");
    return listBundles();
  });

  registerHandler("bundles:updateCosts", (_event, costs) => {
    requirePermission("bundles.manage");
    if (!Array.isArray(costs) || !costs.length) throw new Error("Enter at least one bundle cost.");
    database.exec("BEGIN TRANSACTION");
    try {
      for (const item of costs) {
        const code = String(item.code ?? "").trim().toUpperCase();
        const cost = Number(item.cost);
        if (!one("SELECT id FROM fibernetlb_bundles WHERE code = ?", [code])) throw new Error("One of the bundles no longer exists.");
        if (!Number.isFinite(cost) || cost < 0) throw new Error("Bundle costs must be zero or more.");
        database.run("UPDATE fibernetlb_bundles SET cost = ?, cost_source='Manual',cost_verified_at='', updated_at = CURRENT_TIMESTAMP WHERE code = ?", [money(cost), code]);
      }
      database.exec("COMMIT");
      saveDatabase();
      return listBundles();
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  registerHandler("bills:create", (_event,input) => createBillPayment(input));

  const authorizeBillReset=()=>{
    requireStaffAdmin();
    if(activeWorkspace().id==="main")throw Error("Open a business to clear its bills/receipts.");
    if(networkConfig.mode!=="server")throw Error("Reset bills on the main computer only.");
    return activeWorkspace().kind==="telecom"?"telecom":["printer","studio"].includes(activeWorkspace().id)?"sale":"bill";
  };
  registerHandler("bills:resetPreview",()=>{const kind=authorizeBillReset();return {...billResetPreview(database,kind),workspaceName:activeWorkspace().name};});
  registerHandler("bills:reset",(_event,input)=>{
    const kind=authorizeBillReset();
    return resetBills(database,input,currentUser().full_name,()=>backupAllSections(`before-${activeWorkspace().id}-bills-reset`),saveDatabase,kind);
  });

  registerHandler("bills:delete", (_event, id) => {
    requirePermission("bills.manage");
    if(one("SELECT request_id FROM portal_operations WHERE bill_id=?",[Number(id)]))throw Error("This payment has a Proradius customer-creation, transfer or charged plan-change audit trail and cannot be deleted.");
    renewalLedger.canDelete(Number(id));
    const bill = one("SELECT id, receipt_no, amount, payment_method, payment_status FROM active_fibernetlb_bills WHERE id = ?", [Number(id)]);
    if (!bill) throw new Error("Bill payment was not found.");
    database.exec("BEGIN TRANSACTION");
    try {
      const collected=paymentLedger.details("bill",Number(id)).cashPaid;
      if(collected) addDrawerMovement(-collected,"bill_deleted","bill",Number(id),bill.receipt_no);
      paymentLedger.remove("bill",Number(id));
      database.run("DELETE FROM fibernetlb_bills WHERE id = ?", [Number(id)]);
      database.exec("COMMIT");
      saveDatabase();
      return { ok: true };
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("telecomCatalog:list", () => {
    if (!hasPermission("telecom.view") && !hasPermission("telecom.create") && !hasPermission("telecom.manage")) requirePermission("telecom.view");
    return listTelecomCatalog();
  });

  registerHandler("telecomCatalog:updatePricing", (_event, pricing) => {
    requirePermission("telecomCatalog.manage");
    if (!Array.isArray(pricing) || !pricing.length) throw new Error("Enter at least one refill price.");
    database.exec("BEGIN TRANSACTION");
    try {
      for (const entry of pricing) {
        const code = String(entry?.code ?? "").trim().toUpperCase();
        const price = Number(entry?.price);
        const cost = Number(entry?.cost);
        if (!one("SELECT id FROM telecom_catalog WHERE code = ?", [code])) throw new Error("One refill card no longer exists.");
        if (!Number.isFinite(price) || price <= 0) throw new Error("Refill selling prices must be greater than zero.");
        if (!Number.isFinite(cost) || cost < 0) throw new Error("Refill costs must be zero or more.");
        database.run("UPDATE telecom_catalog SET price = ?, cost = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?", [money(price), money(cost), code]);
      }
      database.exec("COMMIT");
      saveDatabase();
      return listTelecomCatalog();
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("telecomPayments:list", (_event, startDate, endDate) => {
    requirePermission("telecom.view");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("Choose a valid telecom payment date range.");
    return listTelecomPayments(startDate, endDate);
  });

  registerHandler("telecomPayments:create", (_event, input) => {
    if (!hasPermission("telecom.create") && !hasPermission("telecom.manage")) requirePermission("telecom.create");
    const entry = validateTelecomPayment(input);
    const destination=whishSelection(input,entry.paymentMethod);
    const paidAt = localIso();
    const receiptNo = `TEL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    database.exec("BEGIN TRANSACTION");
    try {
      database.run("INSERT INTO telecom_payments (receipt_no, provider, transaction_type, phone, customer_name, item_code, item_name, item_details, billing_period, amount, cost, payment_method, payment_status, reference, paid_at, user_id, cashier_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [receiptNo, entry.provider, entry.transactionType, entry.phone, entry.customerName, entry.itemCode, entry.itemName, entry.itemDetails, entry.billingPeriod, entry.amount, entry.cost, entry.paymentMethod, entry.paymentStatus, entry.reference, paidAt, currentUser().id, currentUser().full_name]);
      const paymentId = Number(one("SELECT id FROM telecom_payments WHERE receipt_no = ?", [receiptNo]).id);
      Whish.saveSnapshot(database,'telecom',paymentId,destination,entry.amount);
      if (entry.paymentMethod === "Cash") addDrawerMovement(entry.amount, "telecom_payment", "telecom", paymentId, receiptNo);
      database.exec("COMMIT");
      saveDatabase();
      return telecomReceipt(paymentId);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("telecomPayments:delete", (_event, id) => {
    requirePermission("telecom.manage");
    const payment = one("SELECT id, receipt_no, amount, payment_method, payment_status FROM telecom_payments WHERE id = ?", [Number(id)]);
    if (!payment) throw new Error("Telecom payment was not found.");
    database.exec("BEGIN TRANSACTION");
    try {
      const collected=paymentLedger.details("telecom",Number(id)).cashPaid;
      if(collected) addDrawerMovement(-collected,"telecom_deleted","telecom",Number(id),payment.receipt_no);
      paymentLedger.remove("telecom",Number(id));
      database.run("DELETE FROM telecom_payments WHERE id = ?", [Number(id)]);
      database.exec("COMMIT");
      saveDatabase();
      return { ok: true };
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("barcodes:generate", () => { requirePermission("products.manage"); return generateBarcode(); });
  registerHandler("products:list", () => {
    requirePermission("products.read");
    // Physical stock is canonical in Admin's warehouse. These original rows
    // remain unchanged for historical receipts and native non-stock services.
    const products = listProducts().filter(product=>!product.trackQuantity);
    if (currentUser().role==='admin' || hasPermission("products.manage")) return products;
    return products.map(({ cost: _cost, costUsd: _costUsd, markup: _markup, ...product }) => product);
  });

  registerHandler("products:create", (_event, input) => {
    requirePermission("products.manage");
    const product = validateProduct(input);
    if(product.trackQuantity)throw Error('Add physical products through Admin stock. This form is for non-stock services only.');
    database.exec("BEGIN TRANSACTION");
    try {
      database.run("INSERT INTO products (sku, name, category, currency, cost, markup, price, quantity, reorder_level, track_quantity, print_color_price, print_single_price, print_double_price, print_no_binding_price, print_binding_price, print_plain_price, print_canson_price, print_sticker_price, print_price_table) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [product.sku, product.name, product.category, product.currency, product.cost, product.markup, product.price, product.quantity, product.reorderLevel, product.trackQuantity ? 1 : 0, product.printColorPrice, product.printSinglePrice, product.printDoublePrice, product.printNoBindingPrice, product.printBindingPrice, product.printPlainPrice, product.printCansonPrice, product.printStickerPrice, JSON.stringify(product.printPriceTable || {})]);
      const id = Number(one("SELECT id FROM products WHERE sku = ?", [product.sku]).id);
      product.barcodes.forEach((barcode, index) => database.run("INSERT INTO product_barcodes (product_id, barcode, is_primary) VALUES (?, ?, ?)", [id, barcode, index === 0 ? 1 : 0]));
      database.exec("COMMIT");
      saveDatabase();
      return listProducts().find((item) => Number(item.id) === id);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("products:update", (_event, id, input) => {
    requirePermission("products.manage");
    const existing = one("SELECT * FROM products WHERE id = ?", [Number(id)]);
    if (!existing) throw Error("Product not found.");
    const product = validateProduct(input, existing);
    if(existing.track_quantity||product.trackQuantity)throw Error('Edit owned physical products through Admin stock. Original stock rows remain historical.');
    database.exec("BEGIN TRANSACTION");
    try {
      database.run("UPDATE products SET sku = ?, name = ?, category = ?, currency = ?, cost = ?, markup = ?, price = ?, quantity = ?, reorder_level = ?, track_quantity = ?, print_color_price = ?, print_single_price = ?, print_double_price = ?, print_no_binding_price = ?, print_binding_price = ?, print_plain_price = ?, print_canson_price = ?, print_sticker_price = ?, print_price_table = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [product.sku, product.name, product.category, product.currency, product.cost, product.markup, product.price, product.quantity, product.reorderLevel, product.trackQuantity ? 1 : 0, product.printColorPrice, product.printSinglePrice, product.printDoublePrice, product.printNoBindingPrice, product.printBindingPrice, product.printPlainPrice, product.printCansonPrice, product.printStickerPrice, JSON.stringify(product.printPriceTable || {}), Number(id)]);
      database.run("DELETE FROM product_barcodes WHERE product_id = ?", [Number(id)]);
      product.barcodes.forEach((barcode, index) => database.run("INSERT INTO product_barcodes (product_id, barcode, is_primary) VALUES (?, ?, ?)", [Number(id), barcode, index === 0 ? 1 : 0]));
      database.exec("COMMIT");
      saveDatabase();
      return listProducts().find((item) => Number(item.id) === Number(id));
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("products:delete", (_event, id) => { requirePermission("products.delete"); if(one('SELECT track_quantity FROM products WHERE id=?',[Number(id)])?.track_quantity)throw Error('Original physical stock references cannot be deleted. Manage current Admin stock instead.');database.run("DELETE FROM products WHERE id = ?", [Number(id)]); saveDatabase(); return { ok: true }; });

  registerHandler("expenseCategories:list", () => {
    if (!hasPermission("expenses.view") && !hasPermission("expenses.manage") && !hasPermission("purchases.view") && !hasPermission("purchases.manage")) requirePermission("expenses.view");
    return listExpenseCategories();
  });

  registerHandler("expenseCategories:create", (_event, nameInput) => {
    requirePermission("expenses.manage");
    const name = String(nameInput ?? "").trim();
    if (!name) throw new Error("Category name is required.");
    if (name.length > 80) throw new Error("Category name must be 80 characters or fewer.");
    database.run("INSERT INTO expense_categories (name) VALUES (?)", [name]);
    saveDatabase();
    return listExpenseCategories();
  });

  registerHandler("expenseCategories:delete", (_event, id) => {
    requirePermission("expenses.manage");
    const category = one("SELECT id, name FROM expense_categories WHERE id = ?", [Number(id)]);
    if (!category) throw new Error("Expense category was not found.");
    const usage = Number(one("SELECT (SELECT COUNT(*) FROM expenses WHERE category = ? COLLATE NOCASE) + (SELECT COUNT(*) FROM purchase_receipts WHERE category = ? COLLATE NOCASE) AS count", [category.name, category.name]).count);
    if (usage > 0) throw new Error("This category is already used by an expense or purchase receipt and cannot be deleted.");
    database.run("DELETE FROM expense_categories WHERE id = ?", [Number(id)]);
    saveDatabase();
    return listExpenseCategories();
  });

  registerHandler("expenses:list", (_event,selection) => {
    if (!hasPermission("expenses.view") && !hasPermission("expenses.manage")) requirePermission("expenses.view");
    const selected=selection||((activeWorkspace().id==='main'&&currentUser()?.role==='admin')?'all':activeWorkspace().id);
    if(selected==='all'){
      if(activeWorkspace().id!=='main'||currentUser()?.role!=='admin')throw Error('All-business expense access is restricted to the main administrator.');
      return WORKSPACES.flatMap(section=>inExpenseWorkspace(section.id,listExpensesInWorkspace)).sort((a,b)=>b.expenseDate.localeCompare(a.expenseDate));
    }
    return inExpenseWorkspace(selected,listExpensesInWorkspace).sort((a,b)=>b.expenseDate.localeCompare(a.expenseDate));
  });

  registerHandler('expenses:options',(_event,selection,query)=>{
    requirePermission('expenses.manage');const businesses=expenseBusinesses().map(section=>({id:section.id,name:section.id==='main'?'Company Expenses':section.name}));
    // Older Client PCs serialize an omitted query as null. Funding balances
    // belong to the selected business; individual receipt details stay scoped.
    query=query??{};
    if(typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(key=>!['expenseDate','excludeExpenseId'].includes(key)))throw Error('Choose valid expense funding month options.');
    return inExpenseWorkspace(selection,()=>{
      const expenseDate=query.expenseDate??localIso().slice(0,10);
      let excludeExpenseId=null;
      if(query.excludeExpenseId!==undefined&&query.excludeExpenseId!==null){
        if(currentUser()?.role!=='admin')throw Error('Only administrators can preview editing an expense.');
        if(!Number.isSafeInteger(query.excludeExpenseId)||query.excludeExpenseId<=0)throw Error('Choose a valid expense.');
        const original=expenseRecord(database,query.excludeExpenseId);
        if(!original||original.sourceType!=='manual')throw Error('Choose a manual expense in the selected business.');
        excludeExpenseId=query.excludeExpenseId;
      }
      const fundingMonths=ExpenseFundingMonths.summary(listExpensesInWorkspace({fullFunding:true,includeFees:false}),{workspaceId:activeWorkspace().id,through:expenseDate,today:localIso().slice(0,10),excludeExpenseId});
      return {workspaceId:activeWorkspace().id,businesses,categories:listExpenseCategories(),fundingWallets:Whish.listDestinations(workspaceDatabases.get('main').db),fundingMonths};
    });
  });

  registerHandler("expenses:create", (_event, input) => {
    requirePermission("expenses.manage");
    return inExpenseWorkspace(input?.workspaceId,()=>{
      const value=expenseInput(input,activeWorkspace().id,{fundingWallets:Whish.listDestinations(workspaceDatabases.get('main').db)}),deductWhishFee=OptionalWhishFees.choice(input,{workspaceId:activeWorkspace().id,actorRole:currentUser().role});requireCategory(database,value.category);OptionalWhishFees.assertOpen(database,value.expenseDate);
      let id;database.exec('BEGIN');try{database.run("INSERT INTO expenses (expense_date,category,description,amount,user_id,source_type,paper_size,paper_type,funding_method,funding_wallet_json,funding_month) VALUES (?,?,?,?,?,'manual',?,?,?,?,?)",[value.expenseDate,value.category,value.description,value.amount,currentUser().id,value.paperSize,value.paperType,value.fundingMethod,value.fundingWallet?JSON.stringify(value.fundingWallet):'',value.fundingMonth]);
       id=Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);OptionalWhishFees.sync(database,{kind:'expense',recordId:id,amount:value.amount,date:value.expenseDate,userId:currentUser().id,reference:value.description,enabled:deductWhishFee,actorKey:sectionAccess.key(currentUser(),activeWorkspace().id),actorName:`${currentUser().full_name} (${currentUser().username})`,now:localIso()});database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}saveDatabase();return listExpensesInWorkspace().find(row=>row.id===id);
    });
  });

  registerHandler('expenses:update',(_event,id,input)=>{
    requirePermission('expenses.manage');if(currentUser()?.role!=='admin')throw Error('Only administrators can edit expenses.');
    return inExpenseWorkspace(input?.workspaceId,()=>{
      const fundingWallets=Whish.listDestinations(workspaceDatabases.get('main').db),existing=expenseRecord(database,Number(id)),next=expenseInput(input,activeWorkspace().id,{fundingWallets,previous:existing});if(existing)OptionalWhishFees.assertOpen(database,existing.expenseDate);OptionalWhishFees.assertOpen(database,next.expenseDate);
      updateExpense(database,id,input,{workspaceId:activeWorkspace().id,actorKey:sectionAccess.key(currentUser(),activeWorkspace().id),actorName:`${currentUser().full_name} (${currentUser().username})`,actorRole:currentUser().role,now:localIso(),fundingWallets});
      saveDatabase();return listExpensesInWorkspace().find(row=>row.id===Number(id));
    },{adminOnly:true});
  });

  registerHandler("expenses:delete", (_event, id,selection) => {
    requirePermission("expenses.manage");
    return inExpenseWorkspace(selection,()=>{
    const expense = one("SELECT source_type AS sourceType,expense_date AS expenseDate FROM expenses WHERE id = ?", [Number(id)]);
    if (!expense) throw new Error("Expense was not found.");
    if (expense.sourceType === "purchase_receipt") throw new Error("Delete this record from Purchases so its stock quantities are also reversed.");
    if(expense.sourceType==='bandwidth_purchase')throw Error('Bandwidth cost is linked to its original supplier purchase and cannot be deleted as a manual expense.');
    if(['whish_cashout','whish_receipt_migration','reseller_whish_fee','reseller_collection_fee',OptionalWhishFees.SOURCE].includes(expense.sourceType))throw Error('Whish fees are audited financial movements and cannot be deleted as manual expenses.');
    OptionalWhishFees.assertOpen(database,expense.expenseDate);database.exec('BEGIN');try{if(expense.sourceType==='manual')OptionalWhishFees.remove(database,'expense',Number(id),{actorKey:sectionAccess.key(currentUser(),activeWorkspace().id),actorName:`${currentUser().full_name} (${currentUser().username})`,now:localIso()});database.run("DELETE FROM expenses WHERE id = ?", [Number(id)]);database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
    saveDatabase();
    return { ok: true };
    });
  });

  registerHandler("purchases:list", () => {
    if (!hasPermission("purchases.view") && !hasPermission("purchases.manage")) requirePermission("purchases.view");
    return listPurchaseReceipts();
  });

  registerHandler("purchases:receipt", (_event, id) => {
    if (!hasPermission("purchases.view") && !hasPermission("purchases.manage")) requirePermission("purchases.view");
    return purchaseReceipt(id);
  });

  registerHandler("purchases:create", (_event, input) => {
    requirePermission("purchases.manage");
    throw Error('Record new stock purchases in Admin Products → Receive stock. Inventory acquisition is not a second operating expense.');
    const receipt = validatePurchaseReceipt(input),deductWhishFee=OptionalWhishFees.choice(input,{workspaceId:activeWorkspace().id,actorRole:currentUser().role});OptionalWhishFees.assertOpen(database,receipt.purchaseDate);
    database.exec("BEGIN TRANSACTION");
    try {
      database.run("INSERT INTO purchase_receipts (receipt_no, supplier, purchase_date, category, notes, total, user_id, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [receipt.receiptNo, receipt.supplier, receipt.purchaseDate, receipt.category, receipt.notes, receipt.total, currentUser().id, currentUser().full_name]);
      const receiptId = Number(one("SELECT id FROM purchase_receipts WHERE receipt_no = ?", [receipt.receiptNo]).id);
      for (const item of receipt.items) {
        database.run("INSERT INTO purchase_receipt_items (purchase_receipt_id, product_id, product_name, sku, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)", [receiptId, item.product.id, item.product.name, item.product.sku, item.quantity, item.unitCost, item.lineTotal]);
        database.run("UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND track_quantity = 1", [item.quantity, item.product.id]);
      }
      const description = `Purchase receipt ${receipt.receiptNo}${receipt.supplier ? ` from ${receipt.supplier}` : ""}`;
      database.run("INSERT INTO expenses (expense_date, category, description, amount, user_id, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'purchase_receipt', ?)", [receipt.purchaseDate, receipt.category, description, receipt.total, currentUser().id, receiptId]);
      OptionalWhishFees.sync(database,{kind:'purchase',recordId:receiptId,amount:receipt.total,date:receipt.purchaseDate,userId:currentUser().id,reference:receipt.receiptNo,enabled:deductWhishFee,actorKey:sectionAccess.key(currentUser(),activeWorkspace().id),actorName:`${currentUser().full_name} (${currentUser().username})`,now:localIso()});
      database.exec("COMMIT");
      saveDatabase();
      return purchaseReceipt(receiptId);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("purchases:delete", (_event, id) => {
    requirePermission("purchases.manage");
    throw Error('Historical purchase receipts remain read-only after Admin stock adoption. Use a reviewed Admin stock adjustment.');
    const receipt = purchaseReceipt(id);OptionalWhishFees.assertOpen(database,receipt.purchaseDate);
    database.exec("BEGIN TRANSACTION");
    try {
      for (const item of receipt.items) {
        if (!item.productId) throw new Error(`Cannot reverse ${item.productName} because that product was deleted.`);
        const product = one("SELECT name, quantity, track_quantity AS trackQuantity FROM products WHERE id = ?", [Number(item.productId)]);
        if (!product || !product.trackQuantity) throw new Error(`Cannot reverse stock for ${item.productName}.`);
        if (Number(product.quantity) < Number(item.quantity)) throw new Error(`Cannot delete this receipt because ${product.name} now has less stock than the purchased quantity.`);
      }
      for (const item of receipt.items) database.run("UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(item.quantity), Number(item.productId)]);
      OptionalWhishFees.remove(database,'purchase',Number(id),{actorKey:sectionAccess.key(currentUser(),activeWorkspace().id),actorName:`${currentUser().full_name} (${currentUser().username})`,now:localIso()});
      database.run("DELETE FROM expenses WHERE source_type = 'purchase_receipt' AND source_id = ?", [Number(id)]);
      database.run("DELETE FROM purchase_receipts WHERE id = ?", [Number(id)]);
      database.exec("COMMIT");
      saveDatabase();
      return { ok: true };
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("sales:list", (_event, limit = 100) => {
    requirePermission("reports.view");
    return rows("SELECT id, invoice_no AS invoiceNo, created_at AS createdAt, subtotal, cost_total AS costTotal, profit, payment_method AS paymentMethod, payment_status AS paymentStatus, customer_name AS customerName, customer_phone AS customerPhone, customer_account AS customerAccount, cashier_name AS cashierName FROM sales ORDER BY created_at DESC, id DESC LIMIT ?", [Math.min(Math.max(Number(limit) || 100, 1), 500)]);
  });

  registerHandler("sales:receipt", (_event, id) => {
    if (!hasPermission("reports.view") && !hasPermission("sales.create")) requirePermission("reports.view");
    return saleReceipt(id);
  });

  registerHandler("sales:create", (_event, input) => {
    requirePermission("sales.create");
    let registration=null,linkedFingerprint=null;
    if(input.registrationId){
      authorizePortalOperation('create');registration=operationLedger.get(String(input.registrationId));
      if(registration?.kind!=='create'||registration.state!=='succeeded')throw Error('Complete customer registration before selling equipment.');
      const customer=JSON.parse(registration.input_json);
      input={...input,customerName:customer.name,customerPhone:customer.phone,customerAccount:customer.username};
      linkedFingerprint=operationLedger.fingerprint({items:input.items,paymentMethod:input.paymentMethod,...input.whishDestinationId?{whishDestinationId:input.whishDestinationId}:{}});
      const linked=one('SELECT sale_id AS id,fingerprint FROM customer_equipment_sales WHERE request_id=?',[registration.request_id]);
      if(linked){if(linked.fingerprint!==linkedFingerprint)throw Error('Equipment for this registration was already sold with different details. Use POS for another sale.');return {...saleReceipt(linked.id),idempotent:true};}
    }
    const items = Array.isArray(input.items) ? input.items : [];
    const method = paymentMethod(input.paymentMethod);
    const destination=whishSelection(input,method);
    const paymentStatus = method === "Unpaid" ? "unpaid" : "paid";
    const customerName = String(input.customerName ?? "").trim();
    const customerPhone = String(input.customerPhone ?? "").trim();
    const customerAccount = String(input.customerAccount ?? "").trim();
    if (paymentStatus === "unpaid" && !customerName) throw new Error("Customer name is required for an unpaid sale.");
    if (!items.length) throw new Error("Add at least one product to the sale.");
    database.exec("BEGIN TRANSACTION");
    try {
      let subtotal = 0;
      let costTotal = 0;
      const preparedItems = items.map((item) => {
        const product = one("SELECT * FROM products WHERE id = ?", [Number(item.productId)]);
        const quantity = Number(item.quantity);
        if (!product) throw new Error("One of the selected products no longer exists.");
        if(product.track_quantity)throw Error('Sell physical products through the Admin-stock POS, not the historical catalog.');
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Sale quantities must be whole numbers.");
        if (product.track_quantity && Number(product.quantity) < quantity) throw new Error(`Only ${product.quantity} ${product.name} available.`);
        const productCurrency = PRODUCT_CURRENCIES.includes(product.currency) ? product.currency : "USD";
        const isPrinting = String(product.category).toLowerCase() === "printing";
        const printing = isPrinting ? printingSaleDetails(product, item.printingOptions) : null;
        const priceCurrency = printing?.currency || productCurrency;
        const originalUnitPrice = printing ? printing.unitPrice : Number(product.price);
        const unitPriceUsd = productAmountToUsd(originalUnitPrice, priceCurrency);
        const unitCostUsd = printing?.costKnown === false ? 0 : productAmountToUsd(product.cost, productCurrency);
        const lineTotal = money(unitPriceUsd * quantity);
        const lineTotalOriginal = productMoney(originalUnitPrice * quantity, priceCurrency);
        subtotal += lineTotal;
        costTotal += unitCostUsd * quantity;
        return { product, quantity, priceCurrency, originalUnitPrice, unitPriceUsd, unitCostUsd, lineTotal, lineTotalOriginal, variantDescription: printing?.description || "", printingOptions: printing ? JSON.stringify(printing.options) : "" };
      });
      if(registration||activeSession().adminCatalogCheckout===true){const quantities=new Map();for(const item of preparedItems){const count=(quantities.get(item.product.id)||0)+item.quantity;quantities.set(item.product.id,count);if(item.product.track_quantity&&count>item.product.quantity)throw Error(`Only ${item.product.quantity} ${item.product.name} available.`);}}
      subtotal = money(subtotal);
      if((registration||activeSession().adminCatalogCheckout===true)&&money(input.expectedSubtotal)!==subtotal)throw Error(registration?'Equipment prices changed. Refresh the products and review the separate POS total before checkout.':'Product prices changed. Refresh the source catalog and review the total before checkout.');
      costTotal = money(costTotal);
      const profit = money(subtotal - costTotal);
      const now = localIso();
      const invoiceNo = `INV-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`;
      database.run("INSERT INTO sales (invoice_no, created_at, subtotal, cost_total, profit, payment_method, payment_status, customer_name, customer_phone, customer_account, user_id, cashier_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [invoiceNo, now, subtotal, costTotal, profit, method, paymentStatus, customerName, customerPhone, customerAccount, currentUser().id, currentUser().full_name]);
      const saleId = Number(one("SELECT id FROM sales WHERE invoice_no = ?", [invoiceNo]).id);
      Whish.saveSnapshot(database,'sale',saleId,destination,subtotal);
      for (const item of preparedItems) {
        database.run("INSERT INTO sale_items (sale_id, product_id, product_name, category, quantity, unit_price, unit_cost, line_total, price_currency, unit_price_original, line_total_original, exchange_rate, variant_description, printing_options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [saleId, item.product.id, item.product.name, item.product.category, item.quantity, item.unitPriceUsd, item.unitCostUsd, item.lineTotal, item.priceCurrency, item.originalUnitPrice, item.lineTotalOriginal, USD_TO_LBP, item.variantDescription, item.printingOptions]);
        if (item.product.track_quantity) database.run("UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.quantity, item.product.id]);
      }
      if (method === "Cash") addDrawerMovement(subtotal, "pos_sale", "sale", saleId, invoiceNo);
      if(registration)database.run('INSERT INTO customer_equipment_sales(request_id,sale_id,fingerprint) VALUES(?,?,?)',[registration.request_id,saleId,linkedFingerprint]);
      database.exec("COMMIT");
      saveDatabase();
      return saleReceipt(saleId);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });

  registerHandler("drawer:get", () => { requirePermission("drawer.view"); return cashDrawerSummary(); });

  registerHandler("drawer:setBalance", (_event, input) => {
    requirePermission("drawer.manage");
    const balance = Number(input?.balance);
    const note = String(input?.note ?? "").trim();
    if (!Number.isFinite(balance) || balance < 0) throw new Error("Cash drawer amount must be zero or more.");
    const current = cashDrawerSummary().balance;
    addDrawerMovement(money(balance - current), "manual_count", null, null, note || "Manual cash count");
    saveDatabase();
    return cashDrawerSummary();
  });

  registerHandler("debts:list", (_event,includePaid=false) => { requirePermission("debts.view"); return listDebts(includePaid); });
  registerHandler("debts:settle", (_event,kind,id,methodInput,amount,requestId,destinationId) => {
    requirePermission("debts.manage");
    if(kind==='sale'&&!warehouseBridge&&warehouseHasTable(activeWorkspace().id,'warehouse_sale_links')&&one('SELECT request_id FROM warehouse_sale_links WHERE sale_id=?',[Number(id)]))throw Error(warehouseDeferredReason||'Restart Main after restoring storage access before collecting an Admin-stock customer debt. Its custody and margin funding must be recorded together.');
    const method=paymentMethod(methodInput,{allowUnpaid:false});
    const prior=one('SELECT id FROM debt_payments WHERE id=?',[String(requestId||'')]);
    const destination=whishSelection({whishDestinationId:destinationId},method,prior?Whish.readSnapshot(database,'debt',prior.id):undefined);
    const at=localIso(),user=currentUser();
    const result=paymentLedger.collect(kind,Number(id),method,amount,requestId,at,user.full_name,(value,reference)=>addDrawerMovement(value,"debt_settlement",kind,Number(id),reference),destination,
      saved=>warehouseBridge?.fundingAfterCollection({...saved,kind,id:Number(id),receivedAt:at,user:{...user,workspaceId:activeWorkspace().id}}));
    saveDatabase(); return result;
  });

  registerHandler("reports:categories", () => {
    requirePermission("reports.view");
    if (activeWorkspace().id === "main") {
      const categories = reportTargets().flatMap(({section,user}) => requestContext.run({ workspaceId: section.id,user }, () => rows("SELECT category FROM products UNION SELECT category FROM sale_items").map(item => item.category)));
      return [...new Set(categories.filter(value => String(value).trim()))].sort((a,b) => a.localeCompare(b));
    }
    return rows(`
      SELECT category FROM (
        SELECT category FROM products WHERE trim(category) <> ''
        UNION
        SELECT category FROM sale_items WHERE trim(category) <> ''
      ) ORDER BY category COLLATE NOCASE
    `).map((item) => item.category);
  });

  registerHandler("reports:summary", (_event, startDate, endDate, posCategoryInput = "", sectionInput = "") => {
    requirePermission("reports.view");
    if (activeWorkspace().id === "main" && currentUser().role === "section_user" && !sectionInput) sectionInput = "all";
    if (sectionInput) return allSectionReport(startDate, endDate, posCategoryInput, sectionInput);
    if(!posCategoryInput){const closed=closedLedgerReport(startDate,endDate);if(closed)return closed;}
    const posCategory = String(posCategoryInput ?? "").trim();
    const categoryClause = posCategory ? " AND si.category = ?" : "";
    const saleParams = posCategory ? [startDate, endDate, posCategory] : [startDate, endDate];
    const sales = one(`
      SELECT COALESCE(SUM(si.line_total), 0) AS revenue,
             COALESCE(SUM(si.unit_cost * si.quantity), 0) AS costOfGoods,
             COALESCE(SUM(si.line_total - (si.unit_cost * si.quantity)), 0) AS grossProfit,
             COUNT(DISTINCT s.id) AS saleCount
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?${categoryClause}
    `, saleParams);
    const bills = one("SELECT COALESCE(SUM(amount), 0) AS serviceRevenue, COALESCE(SUM(COALESCE(bundle_cost, 0)), 0) AS serviceCost, COALESCE(SUM(amount - COALESCE(bundle_cost, 0)), 0) AS serviceProfit, COUNT(*) AS billCount FROM active_fibernetlb_bills WHERE date(paid_at) BETWEEN ? AND ?", [startDate, endDate]);
    const billProfitParts=rows("SELECT service_type AS serviceType,COALESCE(SUM(amount),0) AS revenue,COALESCE(SUM(COALESCE(bundle_cost,0)),0) AS cost FROM active_fibernetlb_bills WHERE date(paid_at) BETWEEN ? AND ? GROUP BY service_type",[startDate,endDate]);
    const telecom = one("SELECT COALESCE(SUM(amount), 0) AS telecomRevenue, COALESCE(SUM(cost), 0) AS telecomCost, COALESCE(SUM(amount - cost), 0) AS telecomProfit, COUNT(*) AS telecomCount FROM telecom_payments WHERE date(paid_at) BETWEEN ? AND ?", [startDate, endDate]);
    const expense = one("SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date BETWEEN ? AND ?", [startDate, endDate]);
    const unknownPrinting = PrintingPricing.unknownCostSummary(rows(`SELECT si.printing_options AS printingOptions, si.quantity, si.line_total AS lineTotal FROM sales s JOIN sale_items si ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN ? AND ?${categoryClause}`, saleParams));
    const paid={...cashoutReport(startDate,endDate,installationReport(activityDatabase,startDate,endDate,paymentLedger.report(startDate,endDate,posCategory))),...unknownPrinting};
    expense.expenses=money(Number(expense.expenses)+paid.whishFees-paid.cashoutFees-paid.resellerWhishFees-paid.receiptMigrationFees-paid.optionalWhishFees);
    const posDaily = rows(`
      SELECT date(s.created_at) AS day, ROUND(SUM(si.line_total), 2) AS revenue,
             ROUND(SUM(si.line_total - (si.unit_cost * si.quantity)), 2) AS profit
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?${categoryClause}
      GROUP BY date(s.created_at)
    `, saleParams);
    const billDaily = rows("SELECT date(paid_at) AS day, ROUND(SUM(amount), 2) AS revenue, ROUND(SUM(amount - COALESCE(bundle_cost, 0)), 2) AS profit FROM active_fibernetlb_bills WHERE date(paid_at) BETWEEN ? AND ? GROUP BY date(paid_at)", [startDate, endDate]);
    const telecomDaily = rows("SELECT date(paid_at) AS day, ROUND(SUM(amount), 2) AS revenue, ROUND(SUM(amount - cost), 2) AS profit FROM telecom_payments WHERE date(paid_at) BETWEEN ? AND ? GROUP BY date(paid_at)", [startDate, endDate]);
    const dailyMap = new Map();
    const installationDaily=rows('SELECT date(paid_at) AS day,ROUND(SUM(amount),2) AS revenue,ROUND(SUM(amount),2) AS profit FROM installation_payments WHERE date(paid_at) BETWEEN ? AND ? GROUP BY date(paid_at)',[startDate,endDate]);
    for (const entry of [...posDaily, ...billDaily, ...telecomDaily,...installationDaily]) {
      const previous = dailyMap.get(entry.day) || { day: entry.day, revenue: 0, profit: 0 };
      previous.revenue = money(previous.revenue + Number(entry.revenue));
      previous.profit = money(previous.profit + Number(entry.profit));
      dailyMap.set(entry.day, previous);
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));
    const recentSales = rows(`
      SELECT s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt,
             ROUND(SUM(si.line_total), 2) AS subtotal,
             ROUND(SUM(si.line_total - (si.unit_cost * si.quantity)), 2) AS profit,
             s.payment_method AS paymentMethod, s.payment_status AS paymentStatus,
             s.customer_name AS customerName, s.cashier_name AS cashierName,
             GROUP_CONCAT(DISTINCT si.category) AS categories
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?${categoryClause}
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100
    `, saleParams).map(sale => paymentLedger.enrich("sale",sale));
    const outstanding=paymentLedger.outstanding();
    const debts={outstanding:outstanding.value,count:outstanding.count};
    const serviceRevenue = Number(bills.serviceRevenue);
    const serviceCost = Number(bills.serviceCost);
    const serviceProfit = Number(bills.serviceProfit);
    const telecomRevenue = Number(telecom.telecomRevenue);
    const telecomCost = Number(telecom.telecomCost);
    const telecomProfit = Number(telecom.telecomProfit);
    const grossProfit = money(Number(sales.grossProfit) + serviceProfit + telecomProfit+paid.installationIncome);
    const profitParts=profitBreakdown(sales,billProfitParts,telecom,expense.expenses,paid.installationIncome);
    const internetRenewals = listBills(startDate,endDate).filter(bill => bill.serviceType === "Internet");
    let result={ ...paid, internetRenewals, profitParts, posCategory, reportCurrency: "USD", exchangeRate: USD_TO_LBP, revenue: money(Number(sales.revenue) + serviceRevenue + telecomRevenue+paid.installationIncome), posRevenue: Number(sales.revenue), serviceRevenue, serviceCost, serviceProfit, telecomRevenue, telecomCost, telecomProfit, costOfGoods: money(Number(sales.costOfGoods) + serviceCost + telecomCost), posCostOfGoods: Number(sales.costOfGoods), posGrossProfit: Number(sales.grossProfit), grossProfit, saleCount: Number(sales.saleCount), billCount: Number(bills.billCount), telecomCount: Number(telecom.telecomCount), expenses: Number(expense.expenses), netProfit: money(grossProfit - Number(expense.expenses)), outstandingDebt: money(debts.outstanding), debtCount: Number(debts.count), daily, recentSales };
    if(warehouseHasTable(activeWorkspace().id,'warehouse_sale_links')){
      const purchaseFees=warehousePurchaseFeeRows(startDate,endDate),fee=money(purchaseFees.reduce((sum,row)=>sum+row.amount,0));
      if(fee){result.whishFees=money(result.whishFees+fee);result.optionalWhishFees=money((result.optionalWhishFees||0)+fee);result.expenses=money(result.expenses+fee);result.netProfit=money(result.netProfit-fee);result.optionalWhishPayments=[...(result.optionalWhishPayments||[]),...purchaseFees];result.profitParts=result.profitParts.map(part=>part.id==='expenses'?{...part,cost:money(part.cost+fee),profit:money(part.profit-fee)}:part);}
      const raw=workspaceDatabases.get(activeWorkspace().id).db,last=Finance.latestMonth(raw),custodyStart=last?Finance.monthRange(last).opening.slice(0,10):'1900-01-01';
      const trade=WarehouseAccounting.report(raw,{start:startDate,end:endDate,accountKey:currentUser().role==='admin'?null:currentUser().account_key,custodyStart});
      if(activeWorkspace().id==='fiber-resellers'&&currentUser().role!=='admin'){
        const first=Finance.query(raw,'SELECT MIN(occurred_at) AS at FROM warehouse_custody_events WHERE occurred_at>=?',[custodyStart])[0]?.at;
        trade.custodyAttributionUnavailable=!!first&&Finance.query(raw,"SELECT id FROM finance_events WHERE kind IN ('handover','end_of_day','wallet_cashout') AND effective_at>=? AND effective_at<=? AND (from_key=? OR to_key=?) AND from_key<>to_key",[first,endDate+'T23:59:59',currentUser().account_key,currentUser().account_key]).length>0;
      }
      result.productTrade=trade;result.productMarginFunding=trade.marginFunding;
      const wholesale=warehouseWholesaleProjection(startDate,endDate,posCategory);if(wholesale?.wholesaleAttributionUnavailable)Object.assign(result,wholesale);else if(wholesale)result=WarehouseAccounting.internalWholesaleReport(result,wholesale);
    }
    const sourceDb=workspaceDatabases.get(activeWorkspace().id).db,scope=currentUser().role==='admin'?null:currentUser().account_key;
    if(warehouseHasTable(activeWorkspace().id,'shared_maintenance_sale_links')){const payments=!posCategory||posCategory==='Maintenance'?MaintenanceFunding.fundingRows(sourceDb,{accountKey:scope,start:startDate,end:endDate,workspaceId:activeWorkspace().id}):[];result.maintenancePayments=payments;result.maintenanceFunding=money(payments.reduce((sum,row)=>sum+row.amount,0));}
    if(fundedStockPurchases){const last=Finance.latestMonth(sourceDb),custodyStart=last?Finance.monthRange(last).opening.slice(0,10):'1900-01-01',stock=fundedStockPurchases.spending({workspaceId:activeWorkspace().id,start:startDate,end:endDate,accountKey:scope,custodyStart}),fees=fundedStockPurchases.feeRows({workspaceId:activeWorkspace().id,start:startDate,end:endDate,accountKey:scope,custodyStart});result.fundedStock=stock;result.fundedStockFees=stock.fee;result.fundedStockFeePayments=fees;if(stock.fee){result.whishFees=money(result.whishFees+stock.fee);result.expenses=money(result.expenses+stock.fee);result.netProfit=money(result.netProfit-stock.fee);result.profitParts=result.profitParts.map(part=>part.id==='expenses'?{...part,cost:money(part.cost+stock.fee),profit:money(part.profit-stock.fee)}:part);}}
    else if(warehouseHasTable('main','funded_stock_purchase_intents')&&Finance.query(workspaceDatabases.get('main').db,'SELECT request_id FROM funded_stock_purchase_intents LIMIT 1').length)throw Error('Paid stock purchase accounting is unavailable. Restart Main and recover its original request before viewing profit.');
    return CompanyDebtSpending.applyToReport(FixedMonthlySpending.applyToReport(result,fixedMonthlySummary(startDate,endDate)),companyDebtSummary(startDate,endDate));
  });

  registerHandler("reports:dashboard", () => {
    requirePermission("dashboard.view");
    if(currentUser().role==="section_user")return {canViewFinancials:false,todaySales:{value:0,count:0},todayBills:{value:0,count:0},todayTelecom:{value:0,count:0},todayProfit:{value:null},monthExpenses:{value:null},outstandingDebt:{value:null,count:0},drawer:{balance:null,todayIn:null,lastCount:null},stock:{value:null,units:0},lowStock:[],recentSales:[]};
    const today = localIso().slice(0, 10);
    const month = today.slice(0, 7);
    const canViewFinancials = hasPermission("reports.view");
    const todaySales = one("SELECT COALESCE(SUM(subtotal), 0) AS value, COUNT(*) AS count FROM sales WHERE date(created_at) = ?", [today]);
    const todayBills = one("SELECT COALESCE(SUM(amount), 0) AS value, COUNT(*) AS count FROM active_fibernetlb_bills WHERE date(paid_at) = ?", [today]);
    const todayTelecom = one("SELECT COALESCE(SUM(amount), 0) AS value, COUNT(*) AS count FROM telecom_payments WHERE date(paid_at) = ?", [today]);
    const todayProfit = canViewFinancials ? one("SELECT (SELECT COALESCE(SUM(profit), 0) FROM sales WHERE date(created_at) = ?) + (SELECT COALESCE(SUM(amount - COALESCE(bundle_cost, 0)), 0) FROM active_fibernetlb_bills WHERE date(paid_at) = ?) + (SELECT COALESCE(SUM(amount - cost), 0) FROM telecom_payments WHERE date(paid_at) = ?) AS value", [today, today, today]) : { value: null };
    const monthExpenses = canViewFinancials ? one("SELECT COALESCE(SUM(amount), 0) AS value FROM expenses WHERE substr(expense_date, 1, 7) = ?", [month]) : { value: null };
    let monthWhishFees=null;
    if(canViewFinancials){
      const todayPayments=cashoutReport(today,today,installationReport(activityDatabase,today,today,paymentLedger.report(today,today)));
      todayProfit.value=money(todayProfit.value+todayPayments.installationIncome-todayPayments.whishFees);
      const monthPayments=cashoutReport(`${month}-01`,`${month}-31`,installationReport(activityDatabase,`${month}-01`,`${month}-31`,paymentLedger.report(`${month}-01`,`${month}-31`)));
      monthWhishFees=monthPayments.whishFees;
      monthExpenses.value=money(monthExpenses.value+monthWhishFees-monthPayments.cashoutFees-monthPayments.resellerWhishFees-monthPayments.receiptMigrationFees-monthPayments.optionalWhishFees);
      const todayStockFees=money(warehousePurchaseFeeRows(today,today).reduce((sum,row)=>sum+row.amount,0)),monthStockFees=money(warehousePurchaseFeeRows(`${month}-01`,`${month}-31`).reduce((sum,row)=>sum+row.amount,0));
      todayProfit.value=money(todayProfit.value-todayStockFees);monthWhishFees=money(monthWhishFees+monthStockFees);monthExpenses.value=money(monthExpenses.value+monthStockFees);
      if(fundedStockPurchases){const scope=currentUser().role==='admin'?null:currentUser().account_key,todayFees=fundedStockPurchases.spending({workspaceId:activeWorkspace().id,start:today,end:today,accountKey:scope}).fee,monthFees=fundedStockPurchases.spending({workspaceId:activeWorkspace().id,start:`${month}-01`,end:today,accountKey:scope}).fee;todayProfit.value=money(todayProfit.value-todayFees);monthWhishFees=money(monthWhishFees+monthFees);monthExpenses.value=money(monthExpenses.value+monthFees);}
      const fixedToday=fixedMonthlySummary(today,today),fixedMonth=fixedMonthlySummary(`${month}-01`,today);
      todayProfit.value=money(todayProfit.value-fixedToday.profitCost-fixedToday.fee);monthWhishFees=money(monthWhishFees+fixedMonth.fee);
      const companyToday=companyDebtSummary(today,today),companyMonth=companyDebtSummary(`${month}-01`,today);
      todayProfit.value=money(todayProfit.value-companyToday.fee);monthWhishFees=money(monthWhishFees+companyMonth.fee);
    }
    let stock = one(`SELECT COALESCE(SUM((CASE WHEN currency = 'LBP' THEN cost / ${USD_TO_LBP} ELSE cost END) * quantity), 0) AS value, COALESCE(SUM(quantity), 0) AS units FROM products WHERE track_quantity = 1`);
    let lowStock = rows("SELECT id, sku, name, quantity, reorder_level AS reorderLevel FROM products WHERE track_quantity = 1 AND quantity <= reorder_level ORDER BY quantity, name LIMIT 8"),wholesaleAttribution=null;
    if(warehouseHasTable('main','admin_warehouse_products')){
      stock=activeWorkspace().id==='main'?Finance.query(workspaceDatabases.get('main').db,'SELECT COALESCE(SUM(acquisition_cents*quantity),0)/100.0 AS value,COALESCE(SUM(quantity),0) AS units FROM admin_warehouse_products WHERE active=1')[0]:{value:0,units:0};
      lowStock=[];
      const wholesale=canViewFinancials?warehouseWholesaleProjection(today,today):null;if(wholesale?.wholesaleAttributionUnavailable){wholesaleAttribution=wholesale;todayProfit.value=null;}else if(wholesale)todayProfit.value=money(todayProfit.value+wholesale.wholesaleProfit);
    }
    const outstandingDebt = hasPermission("debts.view") ? paymentLedger.outstanding() : { value:null,count:0 };
    const drawer = hasPermission("drawer.view") ? cashDrawerSummary() : { balance: null, todayIn: null, lastCount: null };
    const recentSales = rows("SELECT id, invoice_no AS invoiceNo, created_at AS createdAt, subtotal, profit, payment_method AS paymentMethod, payment_status AS paymentStatus, cashier_name AS cashierName FROM sales ORDER BY created_at DESC LIMIT 6").map((sale) => paymentLedger.enrich("sale",sale)).map((sale) => canViewFinancials ? sale : { ...sale, profit: null });
    const monthInternetCost=canViewFinancials?Number(one("SELECT COALESCE(SUM(COALESCE(bundle_cost,0)),0) AS cost FROM active_fibernetlb_bills WHERE substr(paid_at,1,7)=? AND service_type IN ('Internet','Internet plan change')",[month]).cost):null;
    const billActivity=hasPermission('bills.view')?rows("SELECT id,receipt_no AS invoiceNo,paid_at AS createdAt,amount AS subtotal,amount-COALESCE(bundle_cost,0) AS profit,payment_method AS paymentMethod,payment_status AS paymentStatus,cashier_name AS cashierName,bundle_name AS activity,customer_name AS customerName FROM active_fibernetlb_bills"+(activeSession().consolidatedFinanceRead?" WHERE service_type<>'Reseller transfer'":"")+" ORDER BY paid_at DESC LIMIT 8"):[];
    const telecomActivity=hasPermission('telecom.view')?rows("SELECT id,receipt_no AS invoiceNo,paid_at AS createdAt,amount AS subtotal,amount-cost AS profit,payment_method AS paymentMethod,payment_status AS paymentStatus,cashier_name AS cashierName,item_name AS activity,customer_name AS customerName FROM telecom_payments ORDER BY paid_at DESC LIMIT 8"):[];
    const fundingActivity=canViewFinancials?installationRows(activityDatabase).slice(0,8).map(p=>({...p,invoiceNo:p.receiptNo,createdAt:p.paidAt,subtotal:p.amount,profit:p.amount,activity:'Expense funding'})):[];
    const recentActivity=[...recentSales.map(s=>({...s,activity:'Products / POS'})),...billActivity,...telecomActivity,...fundingActivity].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10).map(p=>canViewFinancials?p:{...p,profit:null});
    const totalWhishWallets=hasPermission('drawer.view')?money(Finance.walletBalances(workspaceDatabases.get(activeWorkspace().id).db,Whish.listDestinations(workspaceDatabases.get('main').db,true),currentUser().role==='admin'?null:sectionAccess.key(currentUser(),activeWorkspace().id)).reduce((sum,wallet)=>sum+wallet.balance,0)):null;
    return { canViewFinancials, activityScope:currentUser().role==='admin'?'all':'own', todaySales, todayBills, todayTelecom, todayProfit, monthExpenses, outstandingDebt, drawer, stock: { value: currentUser().role==='admin' ? stock.value : null, units: stock.units }, lowStock, recentSales,recentActivity,monthInternetCost,monthWhishFees,totalWhishWallets,...wholesaleAttribution||{} };
  });

  registerHandler("reports:csv", (_event, startDate, endDate, posCategory = "", section = "") => reportCsv(startDate, endDate, posCategory, section));

  registerHandler("reports:export", async (_event, startDate, endDate, posCategory = "", section = "") => {
    return reportCsv(startDate, endDate, posCategory, section);
  });
}


// The web runtime invokes the same guarded financial handlers directly.
function ensureExpenseCategory(db,name){if(!Finance.query(db,'SELECT id FROM expense_categories WHERE name=?',[name]).length)db.run('INSERT INTO expense_categories(name) VALUES(?)',[name]);}
function writePrivateFile(file,data,options={}){fs.writeFileSync(file,data,{mode:0o600,...options});if(typeof file==='string'&&process.platform!=='win32')fs.chmodSync(file,0o600);}
const EXPOSED_HOST_CHANNELS=new Set(['portal:settings','portal:configure','portal:test','portal:disable','backups:status','backups:save','backups:run','backups:retry','backups:test']);
const DENIED_CHANNELS=new Set(['auth:createOwner','workspace:reset','bills:reset','bills:resetPreview','reports:export','bills:export']);
const SESSION_ABSOLUTE_MS=24*60*60*1000,MAX_SESSIONS=5000;
function pruneSessions(){const now=sessionClock();for(const [token,value]of serverSessions)if(now-value.lastSeen>SESSION_MAX_AGE_MS||now-value.createdAt>SESSION_ABSOLUTE_MS)serverSessions.delete(token);}
function issueSession(user,workspaceId){pruneSessions();if(serverSessions.size>=MAX_SESSIONS)throw Error('The server session limit was reached. Please try again later.');const token=crypto.randomBytes(32).toString('hex'),now=sessionClock();serverSessions.set(token,{userId:Number(user.id),accountKey:user.account_key,workspaceId,lastSeen:now,createdAt:now});return token;}
function findSession(token){
 pruneSessions();const stored=typeof token==='string'&&serverSessions.get(token);if(!stored)return null;
 let user;try{user=sectionAccess.forWorkspace({account_key:stored.accountKey},stored.workspaceId);}catch{serverSessions.delete(token);return null;}
 if(!user?.active||!sectionAccess.permitted(user,stored.workspaceId)){serverSessions.delete(token);return null;}stored.lastSeen=sessionClock();return {token,user,workspaceId:stored.workspaceId};
}
async function authenticatePublic(input,workspaceId){
 const username=String(input?.username??'').trim().toLowerCase(),password=String(input?.password??'');
 if(!username||username.length>256||password.length>256)throw Error('Incorrect username or password.');
 const candidates=[];
 if(workspaceId==='main'){
  const root=one('SELECT * FROM users WHERE username=?',[username]);if(root)candidates.push(root);
  for(const policy of Finance.query(workspaceDatabases.get('main').db,"SELECT account_key FROM user_workspace_access WHERE origin <> 'main'")){const user=sectionAccess.master(policy.account_key).user;if(user.username===username)candidates.push(user);}
 }else{const local=one('SELECT * FROM users WHERE username=?',[username]);if(local)candidates.push(sectionAccess.master(local.account_key).user);}
 const records=new Map(candidates.map(user=>[user.password_salt+'\0'+user.password_hash,user]));
 const matches=new Set();
 if(!records.size)await derivePassword(password,'fibernetlb-invalid-login',64);
 for(const [key,user]of records){const supplied=await derivePassword(password,user.password_salt,64),stored=Buffer.from(user.password_hash,'hex');if(stored.length===supplied.length&&crypto.timingSafeEqual(stored,supplied))matches.add(key);}
 // Re-read the authoritative account after awaiting the password derivation.
 return authenticateUser(input,(_password,salt,hash)=>matches.has(salt+'\0'+hash));
}
function cleanBackupStatus(value){const {folder,...safe}=value;return {...safe,requiresMainRunning:false,requiresServerRunning:true};}
function safeError(error){return String(error?.message||'The request could not be completed.').split(dataDirectory).join('[private data directory]');}
const pendingRequests=new Set();
let backupTimer=null,scheduledBackup=Promise.resolve();
async function requestOperation({channel,args=[],workspaceId='main',token=''}={}){
 try{
  assertOpen();if(typeof channel!=='string'||!Array.isArray(args)||args.length>20)return {status:400,error:'Invalid application request.'};
  const selected=workspace(workspaceId).id;
  if(channel==='auth:status'){
   const session=findSession(token);return {status:200,data:requestContext.run({workspaceId:selected},()=>({needsSetup:Number(one('SELECT COUNT(*) AS count FROM users').count)===0,user:publicUser(session?.workspaceId===selected?session.user:null)}))};
  }
  if(channel==='auth:login'){
   const user=await requestContext.run({workspaceId:selected},()=>authenticatePublic(args[0],selected));
   const sessionToken=issueSession(user,selected);return {status:200,data:{user:requestContext.run({workspaceId:selected},()=>publicUser(user)),sessionToken}};
  }
  if(channel==='auth:logout'){if(typeof token==='string')serverSessions.delete(token);return {status:200,data:{ok:true}};}
  if(DENIED_CHANNELS.has(channel)||/^(printing:|sharing:|network:|updates:|workspace:|bandwidth:(open|close)$)/.test(channel))return {status:403,error:'This server does not expose that desktop or administrative action.'};
  const session=findSession(token);if(!session)return {status:401,error:'Your session ended. Please sign in again.'};
  if(session.workspaceId!==selected)return {status:403,error:'This session belongs to another business section. Sign in to that section first.'};
  if(channel==='auth:switch'){
   const target=workspace(String(args[0])).id,user=sectionAccess.forWorkspace(session.user,target),sessionToken=issueSession(user,target);
   return {status:200,data:{user:requestContext.run({workspaceId:target},()=>publicUser(user)),sessionToken}};
  }
  const handler=localHandlers.get(channel)||(EXPOSED_HOST_CHANNELS.has(channel)&&hostHandlers.get(channel));
  if(!handler)return {status:404,error:'Unknown application request.'};
  return await requestContext.run({workspaceId:selected,user:session.user,externalSession:true,sessionToken:session.token},async()=>{
   checkWorkspaceChannel(channel);const result=await handler(null,...args);return {status:200,data:channel.startsWith('backups:')?cleanBackupStatus(result):result};
  });
 }catch(error){return {status:400,error:safeError(error)};}
}
function metadata(workspaceId='main'){
 assertOpen();const section=workspace(workspaceId);return requestContext.run({workspaceId:section.id},()=>({version,providersEnabled,section:{...section},sections:WORKSPACES.map(item=>({...item})),areas:MAIN_AREAS.map(item=>({...item})),needsSetup:Number(one('SELECT COUNT(*) AS count FROM users').count)===0}));
}
async function createOwner(input){assertOpen();return requestContext.run({workspaceId:'main',user:null},()=>localHandlers.get('auth:createOwner')(null,input));}
function request(options){const pending=requestOperation(options??{}).catch(error=>({status:400,error:safeError(error)}));pendingRequests.add(pending);void pending.then(()=>pendingRequests.delete(pending));return pending;}
releaseResources=()=>{clearInterval(backupTimer);backupManager?.stop();serverSessions.clear();for(const entry of workspaceDatabases.values())entry.db.close();if(workspaceDatabases.size===0&&database)database.close();workspaceDatabases.clear();releaseLock();activeDirectories.delete(dataKey);};
let closing;
async function close(){if(closing)return closing;closed=true;clearInterval(backupTimer);closing=(async()=>{await Promise.allSettled([...pendingRequests,scheduledBackup]);releaseResources();})();return closing;}

// Validate every existing file before the initializer can migrate or save any one.
if(!initialize){
 const VerificationSql=await initSqlJs({locateFile:()=>wasmPath||require.resolve('sql.js/dist/sql-wasm.wasm')});
 for(const name of REQUIRED_DATABASES){let verified;try{verified=new VerificationSql.Database(fs.readFileSync(path.join(dataDirectory,name)));if(verified.exec('PRAGMA quick_check')[0]?.values?.[0]?.[0]!=='ok')throw Error('integrity');}catch{throw Error('Business database validation failed for '+name+'. No accounting migrations were started.');}finally{verified?.close();}}
}
await initializeDatabase();
registerHandlers();registerWorkspaceHandlers();registerBackupHandlers();
const blockedDelivery=()=>{throw Error('External backup delivery is disabled for this server.');};
backupManager=new BackupManager({directory:dataDirectory,safeStorage,snapshot:backupSnapshot,version,canRun:()=>!closed&&workspaceDatabases.size===WORKSPACES.length,...providersEnabled?{}:{ftpFactory:blockedDelivery,mailFactory:blockedDelivery}});
// Local encrypted snapshots remain scheduled even when provider access is off.
{const tick=()=>{scheduledBackup=backupManager.tick().catch(()=>{});};tick();backupTimer=setInterval(tick,60000);backupTimer.unref?.();}
return {request,metadata,createOwner,close};
}catch(error){try{releaseResources();}finally{releaseLock();activeDirectories.delete(dataKey);}throw error;}
}
module.exports={createBackend};
