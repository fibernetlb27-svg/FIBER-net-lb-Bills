/* Shared method contract copied from desktop 1.45.3; transport is supplied by browser-api.js. */
window.buildBrowserPosApi = invoke => {
const api = {
  adminTransfers:Object.fromEntries(['access','sources','preview','transfer','status','resume','pending','history'].map(method=>[method,(input={})=>invoke('adminTransfers:'+method,input)])),
  notes:Object.fromEntries(['list','save','remove','restore','status','resume'].map(method=>[method,(input={})=>invoke('notes:'+method,input)])),
  bank:Object.fromEntries(['access','overview','sources','preview','transfer','status','resume','pending'].map(method=>[method,(input={})=>invoke('bank:'+method,input)])),
  mainOfficePayables:{overview:(...args)=>invoke('mainOfficePayables:overview',...args),details:(...args)=>invoke('mainOfficePayables:details',...args)},
  maintenance:Object.fromEntries(['list','save','checkoutOptions','checkout','status','pending','resume'].map(method=>[method,input=>invoke('maintenance:'+method,input)])),
  stockPurchases:Object.fromEntries(['options','preview','purchase','status','pending','resume','history'].map(method=>[method,(...args)=>invoke('stockPurchases:'+method,...args)])),
  fixedMonthly:{access:()=>invoke('fixedMonthly:access'),overview:input=>invoke('fixedMonthly:overview',input),ensureMonth:input=>invoke('fixedMonthly:ensureMonth',input),saveTemplate:input=>invoke('fixedMonthly:saveTemplate',input),freeze:input=>invoke('fixedMonthly:freeze',input),sources:()=>invoke('fixedMonthly:sources'),preview:input=>invoke('fixedMonthly:preview',input),pay:input=>invoke('fixedMonthly:pay',input),previewReversal:input=>invoke('fixedMonthly:previewReversal',input),reverse:input=>invoke('fixedMonthly:reverse',input),status:input=>invoke('fixedMonthly:status',input),resume:input=>invoke('fixedMonthly:resume',input),pending:()=>invoke('fixedMonthly:pending'),categoryOverview:()=>invoke('fixedMonthly:categoryOverview'),saveCategory:input=>invoke('fixedMonthly:saveCategory',input),assignCategory:input=>invoke('fixedMonthly:assignCategory',input),categoryStatus:input=>invoke('fixedMonthly:categoryStatus',input),categoryResume:input=>invoke('fixedMonthly:categoryResume',input),categoryPending:()=>invoke('fixedMonthly:categoryPending')},
  // JSON arrays turn undefined into null on Client PCs. An omitted overview
  // means an empty filter object; explicit invalid inputs still reach Main.
  companyDebts:{access:()=>invoke('companyDebts:access'),overview:(input={})=>invoke('companyDebts:overview',input),create:input=>invoke('companyDebts:create',input),assignBusiness:input=>invoke('companyDebts:assignBusiness',input),assignBusinesses:input=>invoke('companyDebts:assignBusinesses',input),addMonthly:input=>invoke('companyDebts:addMonthly',input),sources:()=>invoke('companyDebts:sources'),preview:input=>invoke('companyDebts:preview',input),pay:input=>invoke('companyDebts:pay',input),status:input=>invoke('companyDebts:status',input),resume:input=>invoke('companyDebts:resume',input),pending:()=>invoke('companyDebts:pending')},
  invoiceVoids:{preview:input=>invoke('invoiceVoids:preview',input),remove:input=>invoke('invoiceVoids:remove',input),status:input=>invoke('invoiceVoids:status',input),resume:input=>invoke('invoiceVoids:resume',input),pending:()=>invoke('invoiceVoids:pending')},
  warehouse:{checkoutOptions:input=>invoke('warehouse:checkoutOptions',input),list:input=>invoke('warehouse:list',input),create:input=>invoke('warehouse:create',input),update:input=>invoke('warehouse:update',input),purchase:input=>invoke('warehouse:purchase',input),setOffer:input=>invoke('warehouse:setOffer',input),checkout:input=>invoke('warehouse:checkout',input),status:input=>invoke('warehouse:status',input),debts:()=>invoke('warehouse:debts'),collect:input=>invoke('warehouse:collect',input),pending:input=>input===undefined?invoke('warehouse:pending'):invoke('warehouse:pending',input),resume:input=>invoke('warehouse:resume',input),paymentOptions:input=>invoke('warehouse:paymentOptions',input),receipt:input=>invoke('warehouse:receipt',input)},
  bandwidth:{open:()=>invoke('bandwidth:open'),close:()=>invoke('bandwidth:close'),access:()=>invoke('bandwidth:access'),overview:input=>invoke('bandwidth:overview',input),sources:()=>invoke('bandwidth:sources'),pending:()=>invoke('bandwidth:pending'),createSupplier:input=>invoke('bandwidth:createSupplier',input),updateSupplier:(id,input)=>invoke('bandwidth:updateSupplier',id,input),createType:input=>invoke('bandwidth:createType',input),updateType:(id,input)=>invoke('bandwidth:updateType',id,input),createPurchase:input=>invoke('bandwidth:createPurchase',input),pay:input=>invoke('bandwidth:pay',input),resume:id=>invoke('bandwidth:resume',id)},
  dashboard:{resellerCollections:()=>invoke('dashboard:resellerCollections')},
  adminReceivables:{summary:()=>invoke('adminReceivables:summary'),debts:()=>invoke('adminReceivables:debts'),resellers:()=>invoke('adminReceivables:resellers'),debtReceipt:input=>invoke('adminReceivables:debtReceipt',input),collectionBills:input=>invoke('adminReceivables:collectionBills',input),collectionPreview:input=>invoke('adminReceivables:collectionPreview',input),payBill:input=>invoke('adminReceivables:payBill',input)},
  rollback:{status:()=>invoke('updates:rollbackStatus'),restore:input=>invoke('updates:rollback',input)},
  finance:{
    ledgerOverview:input=>invoke('finance:ledgerOverview',input),
    closeMonthsPreview:input=>invoke('finance:closeMonthsPreview',input),
    closeMonths:input=>invoke('finance:commitMonthsClose',input),
    closeMonthsStatus:input=>invoke('finance:closeMonthsStatus',input),
    resumeMonthsClose:input=>invoke('finance:resumeMonthsClose',input),
    closeMonthPreview:input=>invoke('finance:closeMonthPreview',input),closeMonthStatus:input=>invoke('finance:closeMonthStatus',input),resumeMonthClose:input=>invoke('finance:resumeMonthClose',input),pendingMonthClose:()=>invoke('finance:pendingMonthClose'),overview:input=>invoke('finance:overview',input),handoverPreview:input=>invoke('finance:handoverPreview',input),handover:input=>invoke('finance:handover',input),walletMove:input=>invoke('finance:walletMove',input),setCostRecipient:input=>invoke('finance:setCostRecipient',input),payInternetCost:input=>invoke('finance:payInternetCost',input),archive:input=>invoke('finance:archive',input),closeMonth:input=>invoke('finance:commitMonthClose',input),endDayTargets:()=>invoke('finance:endDayTargets'),endDayPreview:input=>invoke('finance:endDayPreview',input),endDay:input=>invoke('finance:endDay',input),receiptCopies:input=>invoke('finance:receiptCopies',input),receiptCopy:id=>invoke('finance:receiptCopy',id)},
  whish:{list:()=>invoke('whish:list'),all:()=>invoke('whish:all'),save:input=>invoke('whish:save',input)},
  backups:{
    status:()=>invoke("backups:status"),
    save:input=>invoke("backups:save",input),
    run:()=>invoke("backups:run"),
    retry:(id,input)=>invoke("backups:retry",id,input),
    test:destination=>invoke("backups:test",destination),
    openFolder:()=>invoke("backups:openFolder"),
    extract:passphrase=>invoke("backups:extract",passphrase)
  },
  receipts:{whatsapp:input=>invoke('receipts:whatsapp',input)},
  printing:{printers:()=>invoke('printing:printers'),printReceipt:input=>invoke('printing:printReceipt',input)},
  adminCatalog:{list:()=>invoke('adminCatalog:list'),generateBarcode:workspaceId=>invoke('adminCatalog:generateBarcode',workspaceId),create:input=>invoke('adminCatalog:create',input),update:input=>invoke('adminCatalog:update',input),remove:input=>invoke('adminCatalog:remove',input),sell:input=>invoke('adminCatalog:sell',input),receipt:input=>invoke('adminCatalog:receipt',input),whatsapp:input=>invoke('adminCatalog:whatsapp',input)},
  sharing:{openWhatsApp:url=>invoke('sharing:openWhatsApp',url)},
  workspace: {
    current: () => invoke("workspace:current"),
    open: (id) => invoke("workspace:open", id),
    login: () => invoke("workspace:login"),
    ready: () => invoke("workspace:ready"),
    reset: (confirmation) => invoke("workspace:reset", confirmation)
  },
  network: {
    status: () => invoke("network:status"),
    configure: (settings) => invoke("network:configure", settings),
    restart: () => invoke("network:restart")
  },
  updates: {
    status: () => invoke("updates:status"),
    check: () => invoke("updates:check"),
    saveSettings: (settings) => invoke("updates:saveSettings", settings),
    download: () => invoke("updates:download"),
    prepareClients: () => invoke('updates:prepareClients'),
    install: () => invoke("updates:install"),
    onProgress: (listener) => {
      const handler = (_event, progress) => listener(progress);
      void handler;
      return () => {};
    }
  },
  auth: {
    status: () => invoke("auth:status"),
    createOwner: (user) => invoke("auth:createOwner", user),
    login: (credentials) => invoke("auth:login", credentials),
    logout: () => invoke("auth:logout")
  },
  users: {
    updateAccess: (key, ids) => invoke("users:updateAccess", key, ids),
    list: () => invoke("users:list"),
    create: (user) => invoke("users:create", user),
    update: (id, user) => invoke("users:update", id, user),
    remove: (key, confirmation) => invoke("users:delete", key, confirmation)
  },
  employees: {
    list: () => invoke("employees:list"),
    create: (employee) => invoke("employees:create", employee),
    update: (id, employee) => invoke("employees:update", id, employee)
  },
  attendance: {
    scan: (cardId) => invoke("attendance:scan", cardId),
    list: (startDate, endDate) => invoke("attendance:list", startDate, endDate),
    update: (id, record) => invoke("attendance:update", id, record),
    remove: (id) => invoke("attendance:delete", id)
  },
  bills: {
    receiptCredentials: id => invoke("bills:receiptCredentials",id),
    resetPreview: () => invoke("bills:resetPreview"),
    reset: input => invoke("bills:reset",input),
    list: (startDate, endDate) => invoke("bills:list", startDate, endDate),
    create: (bill) => invoke("bills:create", bill),
    saveRenew: (bill) => invoke("bills:saveRenew", bill),
    savePortal: (bill, renew) => invoke("bills:savePortal", bill, renew),
    saveFreeRenewal: input => invoke("bills:saveFreeRenewal", input),
    renew: (id) => invoke("bills:renew", id),
    renewalHistory: (id) => invoke("bills:renewalHistory", id),
    resolveRenewal: (id, input) => invoke("bills:resolveRenewal", id, input),
    remove: (id) => invoke("bills:delete", id),
    export: (startDate, endDate) => invoke("bills:export", startDate, endDate)
  },
  resellers: {
    walletCorrectionPreview:input=>invoke('resellers:walletCorrectionPreview',input),
    correctCollectedWallets:input=>invoke('resellers:correctCollectedWallets',input),
    walletCorrectionHistory:()=>invoke('resellers:walletCorrectionHistory'),
    resumeWalletCorrection:input=>invoke('resellers:resumeWalletCorrection',input),
    reconciliationPreview:input=>invoke('resellers:reconciliationPreview',input),
    reconcileWallets:input=>invoke('resellers:reconcileWallets',input),
    reconciliationHistory:()=>invoke('resellers:reconciliationHistory'),
    resumeWalletReconciliation:input=>invoke('resellers:resumeWalletReconciliation',input),
    collectionSources:()=>invoke('resellers:collectionSources'),
    collectionBills:input=>invoke('resellers:collectionBills',input),
    collectionPreview:input=>invoke('resellers:collectionPreview',input),
    payBill:input=>invoke('resellers:payBill',input),
    collections:()=>invoke('resellers:collections'),
    cancelCollection:(id,note)=>invoke('resellers:cancelCollection',id,note),
    accounts:()=>invoke('resellers:accounts'),
    fund:input=>invoke('resellers:fund',input),
    refund:input=>invoke('resellers:refund',input),
    importPreview:input=>invoke('resellers:importPreview',input),
    importCharges:input=>invoke('resellers:importCharges',input),
    releaseFailed:id=>invoke('resellers:releaseFailed',id),
    portalList: () => invoke("resellers:portalList"),
    addMoney: input => invoke("resellers:addMoney",input),
    list: () => invoke("resellers:list"),
    create: input => invoke("resellers:create",input),
    remove: id => invoke("resellers:remove",id),
    restore: id => invoke("resellers:restore",id)
  },
  portal: {
    customerResellers:()=>invoke('portal:customerResellers'),
    customerOptions:selection=>invoke('portal:customerOptions',selection),
    createCustomer:input=>invoke('portal:createCustomer',input),
    quoteChange: input => invoke("portal:quoteChange",input),
    applyChange: input => invoke("portal:applyChange",input),
    operations: kind => invoke("portal:operations",kind),
    resumeOperation: id => invoke("portal:resumeOperation",id),
    resolveOperation: (id,input) => invoke("portal:resolveOperation",id,input),
    status: () => invoke("portal:status"),
    settings: () => invoke("portal:settings"),
    configure: (input) => invoke("portal:configure", input),
    test: (username) => invoke("portal:test", username),
    disable: () => invoke("portal:disable"),
    search: (term) => invoke("portal:search", term),
    lookup: (username) => invoke("portal:lookup", username),
    resellers: () => invoke("portal:resellers"),
    planHistory: (username) => invoke("portal:planHistory", username),
    resolvePlan: (id, input) => invoke("portal:resolvePlan", id, input)
  },
  bundles: {
    list: () => invoke("bundles:list"),
    updateCosts: (costs) => invoke("bundles:updateCosts", costs)
  },
  telecomCatalog: {
    list: () => invoke("telecomCatalog:list"),
    updatePricing: (pricing) => invoke("telecomCatalog:updatePricing", pricing)
  },
  telecomPayments: {
    list: (startDate, endDate) => invoke("telecomPayments:list", startDate, endDate),
    create: (payment) => invoke("telecomPayments:create", payment),
    remove: (id) => invoke("telecomPayments:delete", id)
  },
  barcodes: {
    generate: () => invoke("barcodes:generate")
  },
  products: {
    list: () => invoke("products:list"),
    create: (product) => invoke("products:create", product),
    update: (id, product) => invoke("products:update", id, product),
    remove: (id) => invoke("products:delete", id)
  },
  expenses: {
    list: (workspaceId) => invoke("expenses:list", workspaceId),
    options: (workspaceId, query) => invoke("expenses:options", workspaceId, query),
    create: (expense) => invoke("expenses:create", expense),
    update: (id,expense) => invoke("expenses:update", id,expense),
    remove: (id,workspaceId) => invoke("expenses:delete", id,workspaceId)
  },
  expenseCategories: {
    list: () => invoke("expenseCategories:list"),
    create: (name) => invoke("expenseCategories:create", name),
    remove: (id) => invoke("expenseCategories:delete", id)
  },
  purchases: {
    list: () => invoke("purchases:list"),
    create: (receipt) => invoke("purchases:create", receipt),
    receipt: (id) => invoke("purchases:receipt", id),
    remove: (id) => invoke("purchases:delete", id)
  },
  sales: {
    list: (limit) => invoke("sales:list", limit),
    create: (sale) => invoke("sales:create", sale),
    receipt: (id) => invoke("sales:receipt", id)
  },
  debts: {
    list: (includePaid = false) => invoke("debts:list", includePaid),
    settle: (kind, id, method, amount, requestId,destinationId) => invoke("debts:settle", kind, id, method, amount, requestId,destinationId)
  },
  drawer: {
    get: () => invoke("drawer:get"),
    setBalance: (settings) => invoke("drawer:setBalance", settings)
  },
  reports: {
    dashboard: () => invoke("reports:dashboard"),
    categories: () => invoke("reports:categories"),
    summary: (startDate, endDate, posCategory, section) => invoke("reports:summary", startDate, endDate, posCategory, section),
    export: (startDate, endDate, posCategory, section) => invoke("reports:export", startDate, endDate, posCategory, section)
  }
};
return api;
};
