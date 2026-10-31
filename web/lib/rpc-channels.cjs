'use strict';
// Explicit browser contract. Native dialogs, installer updates and destructive
// resets are not RPCs. Selected server settings also require Main Admin below.
const groups = {
  auth: 'status login logout switch',
  backups: 'status save run retry test',
  adminTransfers: 'access sources preview transfer status resume pending history',
  notes: 'list save remove restore status resume',
  bank: 'access overview sources preview transfer status resume pending',
  mainOfficePayables: 'overview details',
  maintenance: 'list save checkoutOptions checkout status pending resume',
  stockPurchases: 'options preview purchase status pending resume history',
  fixedMonthly: 'access overview ensureMonth saveTemplate freeze sources preview pay previewReversal reverse status resume pending categoryOverview saveCategory assignCategory categoryStatus categoryResume categoryPending',
  companyDebts: 'access overview create assignBusiness assignBusinesses addMonthly sources preview pay status resume pending',
  invoiceVoids: 'preview remove status resume pending',
  finance: 'ledgerOverview closeMonthsPreview commitMonthsClose closeMonthsStatus resumeMonthsClose closeMonthPreview closeMonthStatus resumeMonthClose pendingMonthClose overview handoverPreview handover walletMove setCostRecipient payInternetCost archive commitMonthClose endDayTargets endDayPreview endDay receiptCopies receiptCopy',
  bandwidth: 'access overview sources pending createSupplier updateSupplier createType updateType createPurchase pay resume',
  whish: 'list all save',
  receipts: 'whatsapp',
  adminCatalog: 'list generateBarcode create update remove sell receipt whatsapp',
  adminReceivables: 'summary debts resellers debtReceipt collectionBills collectionPreview payBill',
  warehouse: 'list create update purchase setOffer checkout status debts collect pending resume paymentOptions checkoutOptions receipt',
  users: 'list create update delete updateAccess',
  employees: 'list create update',
  attendance: 'scan list update delete',
  bills: 'list create saveRenew savePortal saveFreeRenewal renew renewalHistory resolveRenewal delete csv receiptCredentials',
  resellers: 'walletCorrectionPreview correctCollectedWallets walletCorrectionHistory resumeWalletCorrection reconciliationPreview reconcileWallets reconciliationHistory resumeWalletReconciliation collectionSources collectionBills collectionPreview payBill collections cancelCollection accounts fund refund importPreview importCharges releaseFailed portalList addMoney list create remove restore',
  portal: 'settings configure test disable customerResellers customerOptions createCustomer quoteChange applyChange operations resumeOperation resolveOperation status search lookup resellers planHistory resolvePlan',
  bundles: 'list updateCosts',
  telecomCatalog: 'list updatePricing',
  telecomPayments: 'list create delete',
  barcodes: 'generate',
  products: 'list create update delete',
  expenses: 'list options create update delete',
  expenseCategories: 'list create delete',
  purchases: 'list create receipt delete',
  sales: 'list create receipt',
  debts: 'list settle',
  drawer: 'get setBalance',
  reports: 'dashboard categories summary csv',
  dashboard: 'resellerCollections'
};
const PUBLIC_RPC_CHANNELS = new Set(Object.entries(groups).flatMap(([group, names]) => names.split(' ').map(name => `${group}:${name}`)));
const ADMIN_HOST_CHANNELS = new Set(['portal:settings', 'portal:configure', 'portal:test', 'portal:disable', ...groups.backups.split(' ').map(name => `backups:${name}`)]);
module.exports = {PUBLIC_RPC_CHANNELS, ADMIN_HOST_CHANNELS};
