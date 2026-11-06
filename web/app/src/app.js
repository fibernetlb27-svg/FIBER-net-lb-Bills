const api = window.posApi;
const MAIN_WORKSPACE = { id: "main", name: "Main dashboard", icon: "dashboard", kind: "main", color: "slate" };
let businessWorkspace = MAIN_WORKSPACE;
let businessSections = [];
let businessAreas = [{ id:"main-expenses", name:"Company Expenses", icon:"expenses", kind:"area", view:"expenses", color:"amber" }, { id:"main-attendance", name:"Employee Attendance", icon:"attendance", kind:"area", view:"attendance", color:"indigo" }];
function accessibleSections() { return state.currentUser?.allowedSections ?? [...businessSections.map(s => s.id), ...businessAreas.map(s => s.id)]; }
function canOpenWorkspace(id) { return id === "main" || accessibleSections().includes(id); }

const state = { products: [], expenses: [], expenseCategories: [], purchases: [], purchaseDraft: [], reportCategories: [], users: [], employees: [], attendance: [], bills: [], bundles: [], telecomCatalog: [], telecomPayments: [], debts: [], drawer: null, cart: [], posCategory: null, activeReceipt: null, currentView: "dashboard", currentUser: null, network: null, updateStatus: null, networkReturn: "auth", syncing: false };
let syncTimer = null;
let authSessionVersion = 0;
let nativeCacheOwner = '';
function nativeDataScope(){return JSON.stringify([authSessionVersion,businessWorkspace.id,state.currentUser?.accountKey||state.currentUser?.account_key||state.currentUser?.username,state.currentUser?.role]);}
let lastBackgroundDataRefresh = 0;
const BACKGROUND_DATA_REFRESH_MS = 15000;
let cashierCollectionsEpoch = 0, cashierCollectionsIdentity = "", cashierCollectionsRequest = null;
let updateUiBusy=false,updateCheckBusy=false;
let expenseOptionsVersion = 0, expenseOptionsLoading = false, expenseSaving = false;
let expenseFundingWallets = [], expenseFundingSaved = null, expenseFundingProjection = null, expenseFundingRefreshDraft = null;
let dashboardLoadVersion = 0, dashboardHeadlineKey = "";
let receiptPrintPending = false;
// Main Admin browses original business catalogues; IDs alone are never global.
const adminInventory = { session:0, epoch:0, identity:"", workspaces:[], loaded:false, loading:false, productToken:0, productBusy:false, checkoutBusy:false, uncertain:false, source:"", lastSales:[] };
let portalStatus = { ready: false }, portalCustomer = null, portalSearchCustomers = [], billRequestId = null, billSaving = false;
let billResetState=null,billResetSaving=false;
let billResetReview=null,billResetReviewSaving=false;
let portalSelecting = false, portalLookupVersion = 0, portalSearchVersion = 0, billBundleNeedsSelection = false;
let billAmountAutomatic=true;
function selectedPortalPlan() {
  if (portalCustomer?.username !== $("#bill-customer-account").value.trim()) return null;
  return FiberBillPlan.matchPortalPlan(state.bundles.find(bundle => bundle.code === $("#bill-bundle").value), portalCustomer.plans);
}
function portalWorkflowIdentity() {
  return JSON.stringify([authSessionVersion,businessWorkspace.id,state.currentUser?.accountKey||state.currentUser?.account_key||state.currentUser?.username,state.currentUser?.role,state.currentUser?.active,[...(state.currentUser?.permissions||[])].sort(),[...accessibleSections()].sort()]);
}
function portalWorkflowCurrent(identity,permission) {
  return identity===portalWorkflowIdentity()&&businessWorkspace.id==='fiber-users'&&Boolean(state.currentUser)&&state.currentUser.active!==false&&has(permission);
}
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_TO_LBP = 90000;
const FIBERNETLB_ACCOUNT_PREFIX = "fibernetlb";
const PRINT_SIZES = ["A5", "A4", "A3"];
const PRINT_SERVICES = [
  { key: "bw", label: "B/W" },
  { key: "color", label: "Color" },
  { key: "doubleBw", label: "Double-sided B/W" },
  { key: "doubleColor", label: "Double-sided Color" },
  { key: "boundColor", label: "Tejlid / Bound Color" },
  { key: "boundBw", label: "Tejlid / Bound B/W" },
  { key: "canson", label: "Canson / cardboard" },
  { key: "sticker", label: "Transparent / sticker" }
];
const DEFAULT_PRINT_PRICE_TABLE = {
  A5: { bw: 10000, color: 15000, doubleBw: 20000, doubleColor: 25000, boundColor: 50000, boundBw: 40000, canson: 0, sticker: 50000 },
  A4: { bw: 20000, color: 30000, doubleBw: 35000, doubleColor: 40000, boundColor: 100000, boundBw: 80000, canson: 100000, sticker: 100000 },
  A3: { bw: 40000, color: 60000, doubleBw: 60000, doubleColor: 80000, boundColor: 150000, boundBw: 110000, canson: 200000, sticker: 150000 }
};
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const AVAILABLE_THEMES = new Set(["classic", "fibernetlb"]);

function has(permission) {
  const role=state.currentUser?.role==='section_user'?(state.currentUser.sourceRole||state.currentUser.source_role):state.currentUser?.role;
  if(businessWorkspace.id==='fiber-users'&&['cashier','support'].includes(role)&&['products.manage','products.delete'].includes(permission))return false;
  if(permission==='ledger.manage')return state.currentUser?.role==='admin'&&Boolean(api.finance);
  if(permission==="backups.manage")return businessWorkspace.id==="main"&&state.currentUser?.role==="admin"&&(api.web||state.network?.mode==="server");
  if (permission === "users.manage") return state.currentUser?.role === "admin" && state.currentUser?.permissions?.includes(permission);
  if(permission==='customers.manage')return businessWorkspace.id==='fiber-users'&&(state.currentUser?.permissions?.includes('customers.manage')||state.currentUser?.permissions?.includes('bills.manage'));
  if(permission==="plans.manage")return businessWorkspace.id==="fiber-users"&&(state.currentUser?.permissions?.includes("plans.manage")||state.currentUser?.permissions?.includes("bills.manage"));
  if(permission==='bills.create'&&businessWorkspace.kind==='reseller')return false;
  if(permission==="topup.manage")return businessWorkspace.id==="fiber-resellers"&&['cashier','support'].includes(state.currentUser?.role)&&state.currentUser?.permissions?.includes('resellerFunding.manage')&&state.currentUser?.permissions?.includes('drawer.manage');
  // The current reseller list is authoritative Proradius data in ResellerFunding.
  // Local directory rows are retained only as references on historical receipts.
  if (permission === "resellers.manage") return false;
  if (businessWorkspace.id === "main") {
    if (permission.startsWith("products.") || permission.startsWith("sales.")) return state.currentUser?.role==='admin' && Boolean(api.warehouse||api.adminCatalog) && Boolean(state.currentUser.permissions?.includes(permission));
    if (permission.startsWith("purchases.")) return permission==='purchases.view'&&state.currentUser?.role==='admin'&&Boolean(api.stockPurchases);
    if (permission.startsWith("expenses.") && !accessibleSections().includes("main-expenses")) return false;
    if (permission.startsWith("attendance.") && !accessibleSections().includes("main-attendance")) return false;
  }
  if (permission.startsWith("attendance.") && businessWorkspace.id !== "main") return false;
  if ((permission.startsWith("bills.") || permission.startsWith("bundles.")) && !["main", "internet", "reseller", "satellite"].includes(businessWorkspace.kind)) return false;
  if (permission.startsWith("telecom") && !["main", "telecom"].includes(businessWorkspace.kind)) return false;
  return Boolean(state.currentUser?.permissions?.includes(permission));
}
function isMainAdmin() { return businessWorkspace.id === "main" && state.currentUser?.role === "admin"; }
function isMainCatalogAdmin() { return isMainAdmin() && !api.warehouse && Boolean(api.adminCatalog); }
function catalogIdentity() { return JSON.stringify([adminInventory.session,businessWorkspace.id,state.currentUser?.accountKey||state.currentUser?.id||state.currentUser?.username,state.currentUser?.role,[...(state.currentUser?.permissions||[])].sort()]); }
function catalogCurrent(identity) { return isMainCatalogAdmin() && identity === catalogIdentity(); }
function productKey(product) { return isMainCatalogAdmin() ? `${product.workspaceId}:${product.id}` : String(product.id); }
function productFromAction(target) { return isMainCatalogAdmin() ? state.products.find(product => productKey(product) === target.dataset.productKey) : state.products.find(product => Number(product.id) === Number(target.dataset.id)); }
function posProducts() { return isMainCatalogAdmin() ? state.products.filter(product => product.workspaceId === adminInventory.source) : state.products; }
function posProduct(id) { return posProducts().find(product => Number(product.id) === Number(id)); }
function productFormWorkspace() { return isMainCatalogAdmin() ? $("#product-business").value : businessWorkspace.id; }
function catalogWorkspace(id) { return adminInventory.workspaces.find(workspace => workspace.id === id); }
function cartTotalUsd() { return state.cart.reduce((sum,item) => sum + Math.round((item.priceUsd * item.quantity + Number.EPSILON) * 100) / 100,0); }
function resetAdminInventory() {
  adminInventory.session++; adminInventory.epoch++; adminInventory.productToken++;
  Object.assign(adminInventory,{identity:"",workspaces:[],loaded:false,loading:false,productBusy:false,checkoutBusy:false,uncertain:false,source:"",lastSales:[]});
  if (businessWorkspace.id === "main") { state.products=[]; state.cart=[]; state.posCategory=null;for(const id of ['products-body','product-catalog','cart-items'])if($(`#${id}`))$(`#${id}`).innerHTML=""; }
  for (const id of ["product-dialog","printing-options-dialog"]) if ($(`#${id}`)?.open) $(`#${id}`).close();
  if ($("#admin-pos-history-body")) $("#admin-pos-history-body").innerHTML="";
}
function configureAdminInventory() {
  const enabled=isMainCatalogAdmin();
  if (adminInventory.identity && adminInventory.identity !== catalogIdentity()) resetAdminInventory();
  if (enabled) adminInventory.identity=catalogIdentity();
  for (const id of ["product-business-filter-field","admin-pos-business-panel","admin-catalog-status"]) $(`#${id}`).classList.toggle("hidden",!enabled);
  $("#product-business-field").classList.toggle("hidden",!enabled);
  $("#admin-pos-history").classList.toggle("hidden",!enabled||!adminInventory.lastSales.length);
  if (!enabled) return;
  const choices=adminInventory.workspaces.map(workspace=>`<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`).join("");
  const filter=$("#product-business-filter"),previous=filter.value;
  if (filter.innerHTML !== `<option value="all">All businesses</option>${choices}`) {
    filter.innerHTML=`<option value="all">All businesses</option>${choices}`;
    filter.value=catalogWorkspace(previous)?previous:"all";
  }
  const source=$("#admin-pos-business");
  if (source.innerHTML !== `<option value="">Select selling business</option>${choices}`) source.innerHTML=`<option value="">Select selling business</option>${choices}`;
  source.value=adminInventory.source;
  const locked=state.cart.length>0||adminInventory.checkoutBusy||adminInventory.uncertain;
  source.disabled=locked||!adminInventory.loaded;
  $("#admin-pos-status").textContent=adminInventory.uncertain ? "The checkout result could not be confirmed. Do not submit again. Open this business's Reports and verify its sales and balances. After checking, use Clear to start a new sale." : adminInventory.checkoutBusy ? "Saving this sale once in the selected business. Please wait…" : adminInventory.source ? `Selling for ${catalogWorkspace(adminInventory.source)?.name||adminInventory.source}. Stock, drawer, wallet and customer debt stay in this business.${locked?" Clear or finish this cart before changing business.":""}` : "Choose one business before adding products. One sale cannot mix businesses.";
  $("#admin-pos-status").classList.toggle("admin-catalog-warning",adminInventory.uncertain);
  $("#admin-pos-open-history").disabled=!adminInventory.source||adminInventory.checkoutBusy;
  $("#quick-add-product").disabled=!adminInventory.loaded||adminInventory.checkoutBusy||adminInventory.uncertain;
  $("#add-product").disabled=!adminInventory.loaded||adminInventory.productBusy;
  $("#complete-sale").disabled=!adminInventory.loaded||!state.cart.length||!adminInventory.source||adminInventory.checkoutBusy||adminInventory.uncertain;
  $("#clear-cart").disabled=adminInventory.checkoutBusy;
  for(const selector of ["#cart-items button","#view-pos > .pos-layout input","#view-pos > .pos-layout select"]) $$(selector).forEach(control=>{if(control.id!=="admin-pos-business")control.disabled=adminInventory.checkoutBusy||adminInventory.uncertain;});
  WhishPayments.sync();
}
function syncServiceCatalogUi(){
  const role=state.currentUser?.role==='section_user'?(state.currentUser.sourceRole||state.currentUser.source_role):state.currentUser?.role;
  const usersReadOnly=businessWorkspace.id==='fiber-users'&&['cashier','support'].includes(role);
  // Users staff browse Admin stock above; historical services remain sellable
  // through their original POS, but local catalogue changes are Admin-only.
  $('#local-products-panel')?.classList.toggle('hidden',usersReadOnly||Boolean(api.warehouse&&businessWorkspace.id==='main'));
  if(usersReadOnly){
    $('#quick-add-product').classList.add('hidden');$('#add-product').classList.add('hidden');
    if($('#product-dialog').open){adminInventory.productToken++;$('#product-dialog').close();}
  }
  if(!api.warehouse)return;
  // Do not aggregate local services into Main stock. Each original business
  // retains its ordinary category screen, cart and service-management form.
  const main=businessWorkspace.id==='main';
  const emptyOriginalServices=['fiber-users','fiber-resellers'].includes(businessWorkspace.id)&&window.AdminWarehouse?.mixedCheckout?.()===true&&!state.products.length&&!state.cart.length;
  $('#view-pos > .pos-layout')?.classList.toggle('hidden',main||emptyOriginalServices);
  $('#products-body')?.closest('article')?.classList.toggle('hidden',main||usersReadOnly);
  $('#warehouse-services-note')?.remove();
  $('#admin-pos-business-panel').classList.add('hidden');
  $('#admin-pos-history').classList.add('hidden');
  if($('#ar-customer-total'))$('#ar-customer-total').closest('article').classList.add('hidden');
  $('#quick-add-product').innerHTML=icon('plus')+'Add product';$('#add-product').innerHTML=icon('plus')+'Add product';
}
function renderAdminSaleHistory() {
  $("#admin-pos-history").classList.toggle("hidden",!isMainCatalogAdmin()||!adminInventory.lastSales.length);
  $("#admin-pos-history-body").innerHTML=adminInventory.lastSales.map(sale=>`<tr><td><strong>${escapeHtml(sale.invoiceNo)}</strong><small>${escapeHtml(sale.workspaceName)}</small></td><td>${paymentBadge(sale.paymentMethod,sale.paymentStatus)}</td><td class="number">${formatMoney(sale.subtotal)}</td><td><button class="button button-secondary admin-catalog-receipt" data-sale-id="${sale.id}" data-sale-workspace="${escapeHtml(sale.workspaceId)}">Receipt</button></td></tr>`).join("");
}
async function completeAdminCatalogSale() {
  if(!isMainCatalogAdmin()||!has('sales.create')||adminInventory.checkoutBusy||adminInventory.uncertain||!adminInventory.loaded||!state.cart.length)return;
  const source=adminInventory.source,identity=catalogIdentity();
  if(!catalogWorkspace(source)||state.cart.some(item=>item.workspaceId!==source))return showToast("Choose one valid business for this sale. Products from different businesses cannot share a cart.","error");
  const paymentMethod=$("#payment-method").value,whish=WhishPayments.input('payment-method');
  if(paymentMethod==='Whish Money'&&!whish.whishDestinationId)return showToast("Select the Whish destination for this business's payment.","error");
  if(paymentMethod==='Unpaid'&&!$("#pos-customer-name").value.trim())return showToast("Enter the customer's name for the source business's debt record.","error");
  const input={workspaceId:source,items:state.cart.map(item=>({workspaceId:item.workspaceId,productId:item.id,quantity:item.quantity,...(item.printingOptions?{printingOptions:item.printingOptions}:{})})),expectedSubtotal:cartTotalUsd().toFixed(2),paymentMethod,...whish,customerName:$("#pos-customer-name").value,customerPhone:$("#pos-customer-phone").value,customerAccount:$("#pos-customer-account").value};
  adminInventory.checkoutBusy=true;configureAdminInventory();
  try {
    const sale=await api.adminCatalog.sell(input);
    if(!catalogCurrent(identity))return;
    if(sale?.workspaceId!==source||!sale.workspaceName||!Number.isSafeInteger(Number(sale.id))||!sale.invoiceNo)throw Error("The source business could not be verified on the sale response.");
    state.cart=[];
    adminInventory.lastSales=[sale,...adminInventory.lastSales].slice(0,20);
    $("#pos-customer-name").value="";$("#pos-customer-phone").value="";$("#pos-customer-account").value="";
    selectPayment('pos-payment','#payment-method','Cash');updatePosPayment();renderCart();renderAdminSaleHistory();
    // Once confirmed, a refresh failure must not turn this saved sale into a retry.
    await Promise.allSettled([loadProducts(),has('dashboard.view')?loadDashboard():Promise.resolve()]);
    if(!catalogCurrent(identity))return;
    if(state.currentView==='pos')showReceipt('sale',sale);
    showToast(`${sale.invoiceNo} saved in ${sale.workspaceName}${sale.paymentStatus==='unpaid'?" as customer debt":""}.`);
  } catch(error) {
    if(!catalogCurrent(identity))return;
    adminInventory.uncertain=true;
    showToast(`${errorMessage(error)} The result is unconfirmed. Check the source business's Reports before clearing this cart; do not submit it again.`,"error");
  } finally {
    if(catalogCurrent(identity)){adminInventory.checkoutBusy=false;renderCart();renderCatalog();}
  }
}
async function openAdminCatalogReceipt(workspaceId,saleId) {
  if(!isMainCatalogAdmin()||!catalogWorkspace(workspaceId))return showToast("Open the original business to view this receipt.","error");
  const identity=catalogIdentity(),view=state.currentView,receipt=state.activeReceipt;
  try {
    const sale=await api.adminCatalog.receipt({workspaceId,saleId});
    if(!catalogCurrent(identity)||view!==state.currentView||receipt!==state.activeReceipt)return;
    if(sale?.workspaceId!==workspaceId||Number(sale.id)!==Number(saleId))throw Error("The receipt's original business could not be verified.");
    showReceipt('sale',sale);
  }catch(error){if(catalogCurrent(identity))showToast(errorMessage(error),"error");}
}
async function saveMainCatalogProduct(id,product) {
  if(!isMainCatalogAdmin()||!has('products.manage')||adminInventory.productBusy||!adminInventory.loaded)return;
  const source=productFormWorkspace(),identity=catalogIdentity(),token=adminInventory.productToken,view=state.currentView,filter=$("#product-business-filter").value;
  if(!catalogWorkspace(source)||id&&$("#product-dialog").dataset.productWorkspace!==source)return showToast('Select the original product business. Existing products cannot change businesses.','error');
  if(id&&!state.products.some(item=>item.workspaceId===source&&Number(item.id)===id&&productKey(item)===$("#product-dialog").dataset.productKey))return showToast('This product is no longer verified. Reopen it from its original row.','error');
  const controls=$$('#product-form input,#product-form select,#product-form button').map(control=>[control,control.disabled]);
  const current=()=>catalogCurrent(identity)&&token===adminInventory.productToken&&$("#product-dialog").open&&source===productFormWorkspace();
  adminInventory.productBusy=true;controls.forEach(([control])=>control.disabled=true);
  try {
    if(id)await api.adminCatalog.update({workspaceId:source,productId:id,product});else await api.adminCatalog.create({workspaceId:source,product});
    if(!current())return;
    controls.forEach(([control,disabled])=>control.disabled=disabled);adminInventory.productBusy=false;
    $("#product-dialog").close();
    const closedToken=adminInventory.productToken;
    await Promise.allSettled([loadProducts(),has('dashboard.view')?loadDashboard():Promise.resolve()]);
    if(catalogCurrent(identity)&&closedToken===adminInventory.productToken&&view===state.currentView&&filter===$("#product-business-filter").value)showToast(`${id?'Product updated':'Product added'} in ${catalogWorkspace(source)?.name||source}.`);
  }catch(error){if(current())showToast(errorMessage(error).includes('UNIQUE')?'That SKU or barcode is already in use in this business.':errorMessage(error),'error');}
  finally {if(catalogCurrent(identity)){adminInventory.productBusy=false;if(token===adminInventory.productToken)controls.forEach(([control,disabled])=>control.disabled=disabled);configureAdminInventory();}}
}
async function deleteMainCatalogProduct(product) {
  if(!isMainCatalogAdmin()||!has('products.delete')||!product||adminInventory.productBusy||adminInventory.checkoutBusy||adminInventory.uncertain)return;
  const identity=catalogIdentity(),filter=$("#product-business-filter").value,view=state.currentView;
  if(!await confirmAppAction(`Delete ${product.name} from ${product.workspaceName}? Previous sales remain in that business's reports.`,'Delete product','Delete product')||!catalogCurrent(identity)||!has('products.delete')||adminInventory.checkoutBusy||adminInventory.uncertain)return;
  adminInventory.productBusy=true;configureAdminInventory();
  try {
    await api.adminCatalog.remove({workspaceId:product.workspaceId,productId:product.id});
    if(!catalogCurrent(identity))return;
    state.cart=state.cart.filter(item=>!(item.workspaceId===product.workspaceId&&Number(item.id)===Number(product.id)));
    await Promise.allSettled([loadProducts(),has('dashboard.view')?loadDashboard():Promise.resolve()]);
    if(!catalogCurrent(identity))return;
    renderCart();if(view===state.currentView&&filter===$("#product-business-filter").value)showToast(`Product deleted from ${product.workspaceName}.`);
  }catch(error){if(catalogCurrent(identity))showToast(errorMessage(error),'error');}
  finally{if(catalogCurrent(identity)){adminInventory.productBusy=false;configureAdminInventory();}}
}
function reportScope() { return businessWorkspace.id === "main" && has("reports.view") ? $("#report-workspace").value || "all" : ""; }

function configureReportScope() {
  const main = businessWorkspace.id === "main", permitted = accessibleSections();
  const sections = businessSections.filter(item => isMainAdmin() || (item.id === "main" ? permitted.includes("main-expenses") : permitted.includes(item.id)));
  const select = $("#report-workspace"), previous = select.value;
  const markup = `<option value="all">${isMainAdmin() ? "All sections" : "My activity · all assigned sections"}</option>${sections.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  if (main && select.innerHTML !== markup) {
    select.innerHTML = markup;
    select.value = sections.some(item => item.id === previous) ? previous : "all";
  }
  $("#report-workspace-field").classList.toggle("hidden", !main || !has("reports.view"));
}
function reportReceiptAction(sale) {
  const original = sale.workspaceId && sale.workspaceId !== businessWorkspace.id
    ? `<button class="icon-button" data-workspace="${escapeHtml(sale.workspaceId)}" title="Open ${escapeHtml(sale.workspaceName)} to view receipts" aria-label="Open receipt section">${icon("arrow-right")}</button>`
    : `<button class="icon-button print-sale" data-id="${sale.id}"${isMainCatalogAdmin()&&sale.workspaceId?` data-sale-workspace="${escapeHtml(sale.workspaceId)}"`:""} aria-label="Print ${escapeHtml(sale.invoiceNo)}" title="Print full receipt">${icon("print")}</button>`;
  return original + (window.InvoiceVoids?.reportButton(sale) || '');
}

function configureStudioProductCategory(category = "", workspaceId = productFormWorkspace()) {
  const select = $("#product-category");
  select.querySelectorAll("option[data-studio-photos]").forEach(option => option.remove());
  for(const option of select.options){
    const service=['printing','maintenance'].includes(option.value.trim().toLowerCase());
    option.hidden=Boolean(api.warehouse)&&!service;option.disabled=option.hidden;
  }
  if (workspaceId !== "studio") return;
  select.insertAdjacentHTML("beforeend", '<option data-studio-photos="true">Photos and shooting</option>');
  // Keep a historical spelling selected without rewriting the saved product.
  if (category && category !== "Photos and shooting" && String(category).trim().toLowerCase() === "photos and shooting") select.insertAdjacentHTML("beforeend", `<option data-studio-photos="true" value="${escapeHtml(category)}">Photos and shooting · saved category</option>`);
}

function configureWorkspace() {
  const section = businessWorkspace;
  configureStudioProductCategory();
  document.title = `${section.name} — FIBER net lb`;
  $("#workspace-label").textContent = section.name.toUpperCase();
  $("#workspace-title").textContent = section.name;
  $("#workspace-emblem").innerHTML = icon(section.icon);
  $("#workspace-intro").dataset.color = section.color;
  $("#workspace-description").textContent = section.id === "main" ? "Choose an assigned business. It opens with your current login and this window closes." : "Independent products, sales, purchases, expenses, debts, users, and cash drawer.";
  $("#login-form h2").textContent = `Sign in · ${section.name}`;
  renderBusinessNavigation();

  $("#workspace-actions").innerHTML = section.id === "main" ? "" : `<button class="button button-secondary" data-workspace="main">${icon("dashboard")}Main dashboard</button>`;
  if (["internet", "reseller", "satellite"].includes(section.kind)) {
    $("#workspace-actions").insertAdjacentHTML("beforeend", `<button class="button button-primary" data-jump="bills" data-permission-any="bills.view,bills.create,bills.manage">${icon(section.icon)}${section.kind === "reseller" ? "Reseller transfers" : "Customer payments"}</button>`);
    $("#view-bills .section-intro h2").textContent = section.kind === "reseller" ? "Reseller Bills" : section.kind === "internet" ? "FIBER net lb Bills" : `${section.name} payments`;
    $("#view-bills .section-intro p:last-child").textContent = section.kind === "reseller" ? "The current Admin reseller list, funding and refunds appear above. Earlier reseller bills remain available below as historical records; new manual transfers are not recorded here." : section.kind === "internet" ? "Search Proradius by username, phone or customer name. Save payment only, or save and renew the customer's current Internet plan after verification. Main-PC API setup is required." : "Record satellite service payments. IPTV renewal is not connected; its API documentation is still required.";
    $("#bill-service-type").innerHTML = section.kind === "satellite" ? "<option>Satellite</option>" : "<option>Internet</option>";
    $("#bill-service-type").closest("label").classList.add("hidden");
    $("#view-bills .bundle-panel h2").textContent = section.kind === "satellite" ? "IPTV monthly service" : "Internet bundles";
    $("#bill-dialog h2").textContent = section.kind === "reseller" ? "Record reseller transfer" : "Record customer payment";
    if (section.id === "fiber-users") $("#add-bill").innerHTML = `${icon("refresh")}Renew service`;
    if (section.kind === "reseller") {
      $("#fiber-bills-navigation").innerHTML = `${icon("receipt")}Reseller Bills`;
      $("#workspace-actions [data-jump='bills']").innerHTML = `${icon("receipt")}Reseller Bills`;
      $("#view-bills .bills-panel h2").textContent = "Historical reseller bills";
      $("#bill-reseller-field").classList.remove("hidden");
      $("#bill-reseller").required = true;
      $("#bill-customer-name").required = false;
      for (const id of ["bill-customer-account","bill-customer-name","bill-phone"]) $(`#${id}`).closest("label").classList.add("hidden");
      $("#bill-customer-account").closest("label").firstChild.textContent = "Reseller account / reference";
      $("#bill-customer-name").closest("label").firstChild.textContent = "Reseller name";
      $("#bill-bundle").required = false;
      $("#bill-bundle").closest("label").classList.add("hidden");
      $("#bill-customer-account").required = false;
      $("#bill-customer-account").placeholder = "Optional reseller account";
      $("#bill-customer-account").closest("label").querySelector("small").textContent = "Optional account or customer reference.";
      $("#bill-form [type='submit']").textContent = "Save transfer";
      $("#add-bill").innerHTML = `${icon("plus")}Record transfer`;
    }
  }
  if (section.kind === "telecom") $("#workspace-actions").insertAdjacentHTML("beforeend", `<button class="button button-primary" data-jump="telecom" data-permission-any="telecom.view,telecom.create,telecom.manage">${icon("telecom")}Cards & bill payments</button>`);
}

function renderBusinessNavigation() {
  const children = businessSections.filter(item => item.id !== "main" && canOpenWorkspace(item.id));
  const bandwidth=isMainAdmin()&&Boolean(api.bandwidth),fixedMonthly=isMainAdmin()&&Boolean(api.fixedMonthly),companyDebts=isMainAdmin()&&Boolean(api.companyDebts),bank=isMainAdmin()&&Boolean(api.bank);
  const areas = businessAreas.filter(item => item.view === "expenses" ? has("expenses.view") || has("expenses.manage") : has("attendance.clock") || has("attendance.view") || has("attendance.manage"));
  $("#workspace-nav-list").innerHTML = children.map(item => `<button type="button" class="workspace-nav-button" data-workspace="${item.id}" data-color="${item.color}">${icon(item.icon)}<span>${escapeHtml(item.name)}</span></button>`).join("") + (areas.length||bandwidth||fixedMonthly||companyDebts||bank ? `<div class="business-menu-divider">Main office</div>${bandwidth?`<button type="button" class="workspace-nav-button" data-open-bandwidth="true" data-color="blue">${icon('chart')}<span>Bandwidth Accounting</span></button>`:''}${fixedMonthly?`<button type="button" class="workspace-nav-button" data-jump="fixed-monthly" data-color="blue">${icon('clock')}<span>Fixed monthly payments</span></button>`:''}${companyDebts?`<button type="button" class="workspace-nav-button" data-jump="company-debts" data-color="amber">${icon('debt')}<span>Company debts</span></button>`:''}${bank?`<button type="button" class="workspace-nav-button" data-jump="bank" data-color="teal">${icon('wallet')}<span>Bank</span></button>`:''}${areas.map(item => `<button type="button" class="workspace-nav-button" data-jump="${item.view}" data-color="${item.color}">${icon(item.icon)}<span>${escapeHtml(item.name)}</span></button>`).join("")}` : "");
  $("#workspace-cards").innerHTML = state.currentUser?.role === "admin" || isCashierDashboardUser() ? "" : children.map(item => `<button type="button" class="workspace-card" data-workspace="${item.id}" data-color="${item.color}"><span class="workspace-card-icon">${icon(item.icon)}</span><strong>${escapeHtml(item.name)}</strong><span>Open business dashboard</span>${icon("arrow-right", "workspace-card-arrow")}</button>`).join("") || `<div class="panel no-business-access">No businesses assigned. Ask the main administrator to update your section access.</div>`;
}

function isCashierDashboardUser() {
  const role=state.currentUser?.role==='section_user'?(state.currentUser.sourceRole||state.currentUser.source_role):state.currentUser?.role;
  return ['cashier','support'].includes(role);
}
function isResellerCashierDashboard() {
  return businessWorkspace.id === "fiber-resellers" && isCashierDashboardUser();
}
function isAllBusinessDashboard() {
  return businessWorkspace.id==='main' && Boolean(window.FinanceDashboard?.isAggregate?.());
}
function cashierCollectionsAccess() {
  return businessWorkspace.id === "main" && isCashierDashboardUser() && has("dashboard.view") &&
    canOpenWorkspace("fiber-resellers") && has("reports.view");
}
function cashierCollectionsUserKey() {
  const user=state.currentUser;
  return user ? JSON.stringify([user.accountKey || user.id || user.username,user.username,user.role,user.sourceRole,
    [...(user.permissions || [])].sort(),[...accessibleSections()].sort()]) : "";
}
function resetCashierCollections() {
  cashierCollectionsEpoch++;
  cashierCollectionsIdentity="";
  cashierCollectionsRequest=null;
  $("#cashier-reseller-collections").classList.add("hidden");
  $("#cashier-reseller-collections").setAttribute("aria-busy","false");
  $("#cashier-reseller-collections").dataset.state="idle";
  for (const prefix of ["cashier-fiber2","cashier-all-resellers"]) {
    $(`#${prefix}-pending`).textContent="—";
    $(`#${prefix}-details`).textContent="";
  }
  $("#cashier-reseller-collections-status").textContent="";
  $("#refresh-cashier-reseller-collections").classList.add("hidden");
}
function syncCashierCollectionsAccess() {
  const allowed=cashierCollectionsAccess(),identity=cashierCollectionsUserKey();
  if (!allowed || cashierCollectionsIdentity !== identity) {
    resetCashierCollections();
    if (allowed) cashierCollectionsIdentity=identity;
  }
  $("#cashier-reseller-collections").classList.toggle("hidden",!allowed);
  return allowed;
}
async function loadCashierCollections() {
  if (!syncCashierCollectionsAccess()) return;
  const identity=cashierCollectionsIdentity;
  if (cashierCollectionsRequest?.identity === identity) return cashierCollectionsRequest.promise;
  const epoch=++cashierCollectionsEpoch,region=$("#cashier-reseller-collections");
  const current=()=>epoch===cashierCollectionsEpoch && identity===cashierCollectionsUserKey() && cashierCollectionsAccess();
  region.dataset.state="loading";
  region.setAttribute("aria-busy","true");
  $("#cashier-reseller-collections-status").textContent="Updating your reseller amounts…";
  $("#refresh-cashier-reseller-collections").classList.add("hidden");
  const promise=(async()=>{
    await Promise.resolve();
    if (!current()) return;
    try {
      if (!api.dashboard?.resellerCollections) throw new Error("Update the Main PC and this PC to load reseller collections.");
      const result=await api.dashboard.resellerCollections();
      if (!current()) return;
      if (!result?.available) throw new Error(result?.reason || "Reseller amounts are not available for your current access.");
      const valid=value=>value && ["pendingToCollect","moneyCollected","moneyAdded"].every(key=>typeof value[key]==="number" && Number.isFinite(value[key]) && value[key]>=0);
      if (result.scope!=="own" || result.includesRepresentative!==true || (result.accountKey && state.currentUser.accountKey && result.accountKey!==state.currentUser.accountKey) || !valid(result.fibernetlb2) || !valid(result.all)) {
        throw new Error("Your reseller amounts could not be verified. Refresh or contact the Admin.");
      }
      for (const [prefix,value] of [["cashier-fiber2",result.fibernetlb2],["cashier-all-resellers",result.all]]) {
        $(`#${prefix}-pending`).textContent=formatMoney(value.pendingToCollect);
        $(`#${prefix}-details`).textContent=`Collected ${formatMoney(value.moneyCollected)} · Money added ${formatMoney(value.moneyAdded)}`;
      }
      region.dataset.state="ready";
      $("#cashier-reseller-collections-status").textContent="Your reseller funding activity only. All resellers includes fibernetlb2 once. Use the sidebar to open a business.";
    } catch (error) {
      if (!current()) return;
      for (const prefix of ["cashier-fiber2","cashier-all-resellers"]) {
        $(`#${prefix}-pending`).textContent="—";
        $(`#${prefix}-details`).textContent="Not available";
      }
      region.dataset.state="unavailable";
      $("#cashier-reseller-collections-status").textContent=errorMessage(error);
      $("#refresh-cashier-reseller-collections").classList.remove("hidden");
    } finally {
      if (current()) region.setAttribute("aria-busy","false");
      if (cashierCollectionsRequest?.epoch===epoch) cashierCollectionsRequest=null;
    }
  })();
  cashierCollectionsRequest={identity,epoch,promise};
  return promise;
}

function applyWorkspaceRules() {
  const main = businessWorkspace.id === "main";
  const combined = isAllBusinessDashboard();
  renderBusinessNavigation();
  if(main) $("#workspace-description").textContent = state.currentUser?.role === "admin" ? "Open a business from the sidebar. Review all employees and business totals here." : isCashierDashboardUser() ? "Review your reseller collections here. Open an assigned business from the sidebar with your current login." : "Choose an assigned business. It opens with your current login and this window closes.";
  $("#back-main-dashboard").classList.toggle("hidden", main || !has("dashboard.view"));
  $("#portal-settings-button").classList.toggle("hidden", !isMainAdmin() || (!api.web && state.network?.mode !== "server"));
  $("#bill-portal-panel").classList.toggle("hidden", businessWorkspace.id !== "fiber-users");
  $("#bill-renew-button").classList.toggle("hidden", businessWorkspace.id !== "fiber-users");
  const canClearBills=!main&&state.currentUser?.role==="admin"&&has("users.manage")&&state.network?.mode==="server";
  $("#bill-settings-button").classList.toggle("hidden", !["internet","reseller","satellite"].includes(businessWorkspace.kind)||!canClearBills);
  $("#report-clear-bills").classList.toggle("hidden", !canClearBills);
  $("#workspace-menu").classList.toggle("hidden", !main || !(has("dashboard.view") || has("attendance.clock") || has("attendance.view")));
  $("#workspace-cards").classList.toggle("hidden", !main || state.currentUser?.role === "admin" || isCashierDashboardUser());
  syncCashierCollectionsAccess();
  window.AdminReceivables?.syncAccess();
  window.AdminPayables?.syncAccess();
  window.AdminWarehouse?.syncAccess();
  window.SharedMaintenance?.syncAccess();
  window.StockPurchases?.syncAccess();
  const fundedPurchases=isMainAdmin()&&Boolean(api.stockPurchases);
  $('#stock-purchases-root')?.classList.toggle('hidden',!fundedPurchases);
  $('#legacy-purchases-content')?.classList.toggle('hidden',fundedPurchases);
  const purchasesNav=$('[data-view="purchases"].nav-item');
  if(purchasesNav)purchasesNav.innerHTML=icon('purchase')+(fundedPurchases?'Purchase products':'Purchases');
  window.InvoiceVoids?.syncAccess();
  if(api.warehouse){
    syncServiceCatalogUi();
    $('#ar-customer-total')?.closest('article')?.classList.add('hidden');
    if($('#ar-panel-title'))$('#ar-panel-title').textContent='Businesses’ product debts and reseller bills';
    const receivableNote=$('#admin-receivables-panel .admin-receivables-note');
    if(receivableNote)receivableNote.textContent='Businesses’ product debts start with new Admin-stock POS sales. Saved reseller funding bills stay separate. These totals include earlier unpaid bills and do not use the finance filters.';
    $('#add-purchase').classList.add('hidden');
    $('#view-purchases .section-intro p:not(.eyebrow)').textContent='Historical supplier receipts are preserved here, read-only. Receive new physical stock in Main Office → Products → Receive stock. New stock purchases are not immediately charged as Other expenses.';
    $('#view-purchases .purchase-metrics .dark-card small').textContent='Historical supplier receipts only';
  }
  // Main Admin uses the scoped finance panel below instead of duplicate headline cards.
  // Keep the nodes in place: FinanceDashboard mounts after this grid and refreshes their IDs.
  $("#combined-overview").classList.add("hidden");
  $("#view-dashboard > .metric-grid").classList.add("hidden");
  configureReportScope();
  configureExpenseBusinessFilter();
  if (main) $("#workspace-actions").innerHTML = (isMainAdmin() && has("expenses.manage") ? `<button class="button button-secondary" data-jump="expenses">${icon("expenses")}Manage expenses</button>` : "") + (has("reports.view") ? `<button class="button button-primary" data-jump="reports">${icon("chart")}${isMainAdmin() ? "Combined reports" : "My reports · all assigned sections"}</button>` : "");
  $("#fresh-start-panel").classList.toggle("hidden", !isMainAdmin() || state.network?.mode !== "server");
  $$('[data-view="expenses"].nav-item, [data-view="attendance"].nav-item').forEach(element => element.classList.toggle("hidden", main || !((element.dataset.view === "expenses" ? ["expenses.view","expenses.manage"] : ["attendance.clock","attendance.view","attendance.manage"]).some(has))));
  $("#fiber-bills-navigation").classList.toggle("hidden", !["internet","reseller"].includes(businessWorkspace.kind) || !["bills.view","bills.create","bills.manage"].some(has));
  $("#telecom-navigation").classList.toggle("hidden", businessWorkspace.kind !== "telecom" || !["telecom.view","telecom.create","telecom.manage"].some(has));
  $("#view-dashboard .dashboard-grid").classList.toggle("hidden", (main && (!combined||!isMainAdmin())) || isResellerCashierDashboard());
  for (const id of ["metric-today-sales","metric-today-profit","metric-stock-value"]) $(`#${id}`).closest("article").classList.toggle("hidden", (main && !combined) || (id === "metric-today-profit" && !has("reports.view")));
  const payments = combined || ["internet", "reseller", "satellite"].includes(businessWorkspace.kind);
  $$("#view-dashboard .bills-metric").forEach(element => element.classList.toggle("hidden", !payments));
  $$("#view-dashboard .telecom-metric").forEach(element => element.classList.toggle("hidden", !combined && businessWorkspace.kind !== "telecom"));
  if (businessWorkspace.kind === "reseller") {
    // Also retire stale cached markup if present; the current page no longer
    // contains the local add/remove reseller directory at all.
    const legacyDirectory = $("#reseller-directory");
    if (legacyDirectory) { legacyDirectory.classList.add("hidden"); legacyDirectory.open = false; }
    $("#view-bills .bundle-panel").classList.add("hidden");
    $("#manage-bundle-costs").classList.add("hidden");
    $("#bills-internet-total").closest("article").classList.add("hidden");
    $("#bills-satellite-total").closest("article").classList.add("hidden");
  }
  if (payments) $("#metric-today-bills").previousElementSibling.textContent = businessWorkspace.kind === "reseller" ? "Today's reseller transfers" : "Today's customer payments";
  if (businessWorkspace.kind === "internet") $("#bills-satellite-total").closest("article").classList.add("hidden");
  if (businessWorkspace.kind === "satellite") $("#bills-internet-total").closest("article").classList.add("hidden");
  $("#report-service-revenue").previousElementSibling.textContent = "Service payments / transfers";
  $$("#view-reports .bills-metric").forEach(element => element.classList.toggle("hidden", !main && !payments));
  $$("#view-reports .telecom-metric").forEach(element => element.classList.toggle("hidden", !main && businessWorkspace.kind !== "telecom"));
  const simpleResellerCashier=isResellerCashierDashboard(),custodyMetrics=["metric-whish-wallets","metric-whish-fees","metric-cash-drawer"];
  $("#whish-wallet-total-card").classList.toggle("hidden",!(combined||businessWorkspace.id==='fiber-users'||simpleResellerCashier)||!has('drawer.view'));
  custodyMetrics.forEach((id,index)=>{$(`#${id}`).closest('article').style.order=simpleResellerCashier?String(index-3):'';});
  if(simpleResellerCashier) {
    $$("#view-dashboard > .metric-grid > .metric-card").forEach(card=>{
      const id=card.querySelector('strong[id]')?.id,permitted=id==='metric-whish-fees'?has('reports.view'):has('drawer.view');
      card.classList.toggle('hidden',!custodyMetrics.includes(id)||!permitted);
    });
  }
}
function roleLabel(role) { return role === "attendance_operator" ? "Attendance Operator" : String(role || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function defaultView() { return has("dashboard.view") ? "dashboard" : has("attendance.clock") ? "attendance" : "dashboard"; }
function applyTheme(theme, notify = false) {
  const selected = AVAILABLE_THEMES.has(theme) ? theme : "classic";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("fibernetlb-theme", selected);
  if ($("#theme-selector")) $("#theme-selector").value = selected;
  if (notify) showToast(selected === "fibernetlb" ? "FIBER net lb theme applied." : "Classic theme applied.");
}
function formatMoney(value) { return value === null || value === undefined ? "Restricted" : currency.format(Number(value) || 0); }
function formatLbp(value) { return value === null || value === undefined ? "Restricted" : `LBP ${Math.round(Number(value) || 0).toLocaleString("en-US")}`; }
function formatProductMoney(value, productCurrency = "USD") { return productCurrency === "LBP" ? formatLbp(value) : formatMoney(value); }
function formatDualUsd(value) { return `${formatLbp((Number(value) || 0) * USD_TO_LBP)} / ${formatMoney(value)}`; }
function localDate(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function icon(name, className = "") { return `<svg class="ui-icon${className ? ` ${className}` : ""}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`; }
function paymentIcon(method) { return method === "Cash" ? "banknotes" : method === "Whish Money" ? "mobile" : method === "Unpaid" ? "debt" : "wallet"; }
function paymentBadge(method,status="paid") { return `<span class="status ${status !== "paid" ? "status-debt" : "status-ok"}">${icon(paymentIcon(status !== "paid" ? "Unpaid" : method))}${escapeHtml(status === "partial" ? "Part paid · "+method : status === "unpaid" ? "Unpaid / Debt" : method)}</span>`; }
function showToast(message, type = "success") { const toast = document.createElement("div"); toast.className = `toast ${type === "error" ? "error" : ""}`; toast.textContent = message; $("#toast-region").appendChild(toast); setTimeout(() => toast.remove(), 3400); }
function errorMessage(error) { return String(error?.message || error || "Something went wrong.").replace(/^Error invoking remote method '[^']+': Error: /, ""); }
function emptyRow(columns, title, detail = "") { return `<tr class="empty-row"><td colspan="${columns}"><strong>${escapeHtml(title)}</strong>${detail ? `<br>${escapeHtml(detail)}` : ""}</td></tr>`; }

function updateNetworkIndicators(status) {
  state.network = status;
  if(api.web){
    for(const id of ['change-network-login','network-settings-button'])$('#'+id).classList.add('website-only-hidden');
    $('#login-connection-dot').className='connection-dot '+(status.connected?'online':'offline');
    $('#login-connection-title').textContent=status.connected?'Website connected':'Website unavailable';
    $('#login-connection-detail').textContent=status.connected?location.host:(status.error||'Check your connection and try again.');
    $('#sidebar-status-dot').className='status-dot '+(status.connected?'':'offline');
    $('#sidebar-network-title').textContent=status.connected?'Website connected':'Connection unavailable';
    $('#sidebar-network-detail').textContent=status.connected?location.host:'Refresh when the website is reachable.';
    if(status.versionMismatch){$('#login-connection-title').textContent='Website refresh required';$('#login-connection-detail').textContent='Save your work, refresh this page and check pending requests.';$('#sidebar-network-title').textContent='Refresh required';$('#sidebar-network-detail').textContent='The website version changed.';}
    return;
  }
  const connected = Boolean(status.connected);
  const isServer = status.mode === "server";
  const delayed = connected && !isServer && status.rpcHealthy === false;
  const address = isServer ? (status.addresses?.[0] || `Port ${status.port}`) : status.serverUrl;
  $("#login-connection-dot").className = `connection-dot ${connected ? "online" : "offline"}`;
  $("#login-connection-title").textContent = delayed ? "Connection delayed" : connected ? (isServer ? "Main computer online" : "Connected to main computer") : "Main computer unavailable";
  $("#login-connection-detail").textContent = delayed ? (status.rpcError || "Main is reachable, but some data could not load. Retrying safely.") : address || "Open network settings";
  $("#sidebar-status-dot").className = `status-dot ${connected && !delayed ? "" : "offline"}`;
  $("#sidebar-network-title").textContent = delayed ? "Connection delayed" : connected ? (isServer ? "Main computer" : "Connected to Main") : "Network unavailable";
  $("#sidebar-network-detail").textContent = delayed ? (status.rpcError || "Main is reachable; some data is unavailable.") : address || "Open network settings";
  if (status.versionMismatch) {
    $("#login-connection-title").textContent = "Client update required";
    $("#login-connection-detail").textContent = `This PC ${status.localVersion} · Main PC ${status.serverVersion}`;
    $("#login-update-button").classList.remove("hidden");
  }
}

function updateNetworkChoice() {
  const mode = $("input[name='network-mode']:checked")?.value;
  $("#server-setup-help").classList.toggle("hidden", mode !== "server");
  $("#client-address-field").classList.toggle("hidden", mode !== "client");
  $("#network-server-url").required = mode === "client";
}

function showNetworkSetup(canCancel = false) {
  if(api.web)return showToast('This website connects automatically. Server settings are managed by your administrator.','error');
  state.networkReturn = state.currentUser ? "app" : "auth";
  $("#app-shell").classList.add("hidden");
  $("#auth-screen").classList.add("hidden");
  $("#network-screen").classList.remove("hidden");
  $("#cancel-network-setup").classList.toggle("hidden", !canCancel);
  const selectedMode = state.network?.mode === "client" ? "client" : "server";
  const radio = $(`input[name='network-mode'][value='${selectedMode}']`);
  if (radio) radio.checked = true;
  $("#network-server-url").value = state.network?.serverUrl || "";
  $("#server-address-preview").textContent = state.network?.addresses?.length ? `Client PCs will connect to ${state.network.addresses[0]}` : "Its network address will appear after setup.";
  updateNetworkChoice();
}

function applyPermissions() {
  window.BillPaymentCorrections?.syncAccess();
  if(['fixed-monthly','company-debts','bank'].includes(state.currentView)&&!isMainAdmin())switchView(defaultView());
  configureAdminInventory();
  $$('[data-permission]').forEach((element) => element.classList.toggle("hidden", !has(element.dataset.permission)));
  $$('[data-permission-any]').forEach((element) => element.classList.toggle("hidden", !element.dataset.permissionAny.split(",").some(has)));
  $$(".financial-only").forEach((element) => element.classList.toggle("hidden", !has("reports.view")));
  $$('#view-dashboard .financial-only').forEach(element=>element.classList.toggle('hidden',!isMainAdmin()));
  $$('#view-products .financial-only').forEach(element=>element.classList.toggle('hidden',state.currentUser?.role!=='admin'&&!has('products.manage')));
  $('#activity-scope').classList.toggle('hidden',!state.currentUser||state.currentUser.role==='admin');
  $('#activity-scope').textContent=`Your activity only · ${state.currentUser?.fullName||state.currentUser?.username||''} · Products and services follow the selected business.`;
  applyWorkspaceRules();
  $('#internet-cost-card').classList.toggle('hidden',(!isAllBusinessDashboard()&&businessWorkspace.id!=='fiber-users')||!has('reports.view'));
  $('#bandwidth-cost-card').classList.toggle('hidden',businessWorkspace.id!=='fiber-resellers'||state.currentUser?.role!=='admin'||!has('reports.view'));
  if(isAllBusinessDashboard())$('#set-cash-drawer').classList.add('hidden');
  if(businessWorkspace.kind==='reseller')$('#add-bill').classList.add('hidden');
  if (!has("users.manage")) {
    state.users = []; $("#users-body").innerHTML = ""; $("#user-count").textContent = "0";
    if ($("#user-dialog").open) $("#user-dialog").close();
    if (state.currentView === "users") switchView(defaultView());
  }
  const permissionByView={pos:'sales.create',products:'products.read',reports:'reports.view','change-plan':'plans.manage'};
  if(permissionByView[state.currentView]&&!has(permissionByView[state.currentView]))switchView(defaultView());
  if(!canChangeRenew())clearChangeRenewal();
}

function clearNativeAccountData(){
  clearChangeRenewal();
  invalidateChange(true);
  for(const key of ['products','expenses','expenseCategories','purchases','purchaseDraft','reportCategories','users','employees','attendance','bills','bundles','telecomCatalog','telecomPayments','debts','cart'])state[key]=[];
  state.drawer=null;state.posCategory=null;state.activeReceipt=null;portalCustomer=null;portalSearchCustomers=[];portalLookupVersion++;portalSearchVersion++;
  expenseOptionsVersion++;expenseFundingWallets=[];expenseFundingSaved=null;expenseFundingProjection=null;expenseFundingRefreshDraft=null;dashboardLoadVersion++;dashboardHeadlineKey='';
  clearReceiptCredentials();
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  for(const form of document.querySelectorAll('dialog form'))form.reset();
  for(const input of document.querySelectorAll('#app-shell input[type="search"]'))input.value='';
  for(const id of ['pos-customer-name','pos-customer-phone','pos-customer-account','product-search','bill-search','telecom-search'])if($('#'+id))$('#'+id).value='';
  renderProducts();renderCatalog();renderCart();refreshExpenseCategorySelectors();renderExpenseCategoryManager();renderExpenses();renderPurchases();renderUsers();renderEmployees();renderAttendance();renderBundleCatalog();updateBillBundleOptions(false);renderBills();renderTelecomCatalog();renderTelecomPayments();renderDebts();
  for(const id of ['report-renewals-body','report-sections-body','report-refunds-body','report-debt-accounts-body','report-debt-payments-body','report-installation-body','report-profit-parts-body','report-sales-body','sales-chart','bundle-cost-list','telecom-pricing-list','purchase-lines','topup-operations-body','change-operations-body','nc-history-body'])$('#'+id)?.replaceChildren();
  for(const id of ['receipt-number','receipt-date','receipt-cashier','receipt-customer','receipt-customer-detail','receipt-items','receipt-total','receipt-paid-total','receipt-remaining-total','receipt-payment','receipt-note','bills-report-body'])$('#'+id)?.replaceChildren();
  for(const id of ['whatsapp-phone','whatsapp-preview'])if($('#'+id))$('#'+id).value='';
  for(const node of document.querySelectorAll('#view-reports .metric-card strong,#report-profit-parts-total,#report-gross-profit,#view-expenses .metric-card strong,#view-bills .metric-card strong,#view-telecom .metric-card strong,#debts-total,#purchase-total'))node.textContent='—';
  for(const id of ['report-filter-note','report-legacy-payments','report-transaction-count','report-sale-count','report-bill-count','report-telecom-count','report-debt-count','expense-cash-funding-note','expense-whish-funding-note'])if($('#'+id))$('#'+id).textContent='';
  $('#report-pos-category').innerHTML='<option value="">All categories</option>';$('#whish-report-panel')?.remove();
  if(typeof registrationForm!=='undefined'){registrationForm=null;registeredCustomer=null;equipmentDraft=[];registrationHistory=[];registrationResellers=[];registrationEpoch++;}
  clearCombinedHeadlines('Load this account’s verified totals.');
}

function showAuth(mode) {
  authSessionVersion++;
  clearChangeRenewal();
  state.syncing = false;
  window.AdminMoneyTransfers?.reset();
  window.StickyNotes?.reset();
  window.Bank?.reset();
  window.MonthCloseSchedule?.reset();
  window.CompanyDebts?.reset();
  window.FixedMonthlyPayments?.reset();
  window.BandwidthAccounting?.reset();
  window.InvoiceVoids?.reset();
  window.AdminWarehouse?.reset();
  window.SharedMaintenance?.reset();
  window.StockPurchases?.reset();
  window.AdminReceivables?.reset();
  window.AdminPayables?.reset();
  resetAdminInventory();
  resetCashierCollections();
  expenseOptionsVersion++;
  if ($("#expense-dialog").open) $("#expense-dialog").close();
  window.BackupView?.reset();
  window.SupportHandover?.reset?.();
  window.FinanceDashboard?.reset?.();
  window.ResellerFunding?.reset?.();
  clearReceiptCredentials(); state.activeReceipt = null;
  if ($("#receipt-dialog").open) $("#receipt-dialog").close();
  if(!api.web && businessWorkspace.id !== "main" && api.workspace?.login) { state.currentUser=null; if(syncTimer){clearInterval(syncTimer);syncTimer=null;} api.workspace.login().catch(error=>showToast(errorMessage(error),"error")); return; }
  state.currentUser = null;
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  $("#network-screen").classList.add("hidden");
  $("#app-shell").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
  $("#login-form").classList.toggle("hidden", mode !== "login");
  $("#setup-form").classList.toggle("hidden", mode !== "setup");
  setTimeout(() => $(mode === "setup" ? "#setup-full-name" : "#login-username").focus(), 50);
  api.workspace?.ready?.().catch(error => showToast(errorMessage(error),"error"));
}

async function startApp(user) {
  const sessionVersion = ++authSessionVersion;
  state.syncing = false;
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  resetAdminInventory();
  state.currentUser = user;
  const nextCacheOwner=JSON.stringify([businessWorkspace.id,user.accountKey||user.account_key||user.username,user.role]);
  if(nativeCacheOwner&&nativeCacheOwner!==nextCacheOwner)clearNativeAccountData();
  nativeCacheOwner=nextCacheOwner;
  window.AdminMoneyTransfers?.init({api:api.adminTransfers,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast,onComplete:async()=>{await Promise.all([loadDashboard(),has('drawer.view')?loadDrawer():Promise.resolve()]);}});
  window.StickyNotes?.init({api:api.notes,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast});
  $('#sticky-notes-button').onclick=()=>window.StickyNotes?.open().catch(error=>showToast(errorMessage(error),'error'));
  window.Bank?.init({container:'bank-root',api:api.bank,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast,onBack:()=>switchView('dashboard'),refresh:async()=>{await Promise.all([loadDashboard(),has('drawer.view')?loadDrawer():Promise.resolve()]);}});
  window.CompanyDebts?.init({container:'company-debts-root',api,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,isCurrentView:()=>state.currentView==='company-debts',toast:showToast,onBack:()=>switchView('dashboard'),onOpenMonthly:id=>switchView('fixed-monthly',{billId:id}),onPayMonthlyFromDashboard:id=>window.FixedMonthlyPayments.payFromDashboard(id),refreshMonthly:()=>window.FixedMonthlyPayments?.load(),refresh:async()=>{await Promise.all([loadDashboard(),has('drawer.view')?loadDrawer():Promise.resolve(),has('reports.view')&&state.currentView==='reports'?loadReport():Promise.resolve()]);}});
  window.FixedMonthlyPayments?.init({container:'fixed-monthly-root',api:api.fixedMonthly,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast,onBack:()=>switchView('dashboard'),onCompanyDebt:id=>switchView('company-debts',{debtId:id}),refresh:async()=>{await Promise.all([loadDashboard(),has('drawer.view')?loadDrawer():Promise.resolve(),has('reports.view')&&state.currentView==='reports'?loadReport():Promise.resolve()]);}});
  window.BandwidthAccounting?.init({container:'dashboard-bandwidth-payment-root',paymentOnly:true,api:api.bandwidth,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast,refresh:async()=>{await Promise.all([loadDashboard(),has('drawer.view')?loadDrawer():Promise.resolve(),has('reports.view')&&state.currentView==='reports'?loadReport():Promise.resolve()]);}});
  window.FinanceDashboard?.init({api,user,workspace:businessWorkspace,sections:businessSections,has,reload:loadDashboard,toast:showToast});
  window.MonthCloseSchedule?.init({api:api.finance,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace});
  window.SupportHandover?.init({api,user,workspace:businessWorkspace,has,reload:loadDashboard,toast:showToast});
  window.ResellerFunding?.init({api,user,workspace:businessWorkspace,toast:showToast,confirm:confirmPortalAction,reload:async()=>{await Promise.all([loadBills(),loadDashboard()]);}});
  window.AdminReceivables?.init({api,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,has,toast:showToast,confirm:confirmPortalAction,reload:loadDashboard,receipt:(type,record)=>showReceipt(type,record,true),clearReceipt:clearAdminReceivableReceipt});
  window.AdminPayables?.init({api,user,workspace:businessWorkspace,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,getBusiness:()=>$('#finance-business')?.value||'all',has,toast:showToast,openMonthly:()=>switchView('fixed-monthly'),openCompanyDebts:()=>switchView('company-debts'),payBandwidth:id=>window.BandwidthAccounting.payFromDashboard(id),payMonthly:id=>window.FixedMonthlyPayments.payFromDashboard(id),payCompanyDebt:id=>window.CompanyDebts.payFromDashboard(id)});
  window.AdminWarehouse?.init({api,user,workspace:businessWorkspace,sections:businessSections,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,has,syncCatalogUi:syncServiceCatalogUi,toast:showToast,showReceipt:(type,record)=>showReceipt(type,record,record.adminReceivableReadOnly===true),refresh:async()=>{await Promise.all([loadDashboard(),has('expenses.view')?loadExpenses():Promise.resolve(),has('debts.view')?loadDebts():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve()]);}});
  const serviceConfig={api,user,workspace:businessWorkspace,sections:businessSections,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,has,toast:showToast,showReceipt:(type,record)=>showReceipt(type,record,record.adminReceivableReadOnly===true),refresh:async()=>{await Promise.all([loadDashboard(),has('expenses.view')?loadExpenses():Promise.resolve(),has('debts.view')?loadDebts():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve(),has('products.read')?loadProducts():Promise.resolve()]);}};
  window.SharedMaintenance?.init(serviceConfig);
  window.StockPurchases?.init({...serviceConfig,container:'stock-purchases-root',onOpen:()=>switchView('purchases'),onBack:()=>switchView('dashboard')});
  window.InvoiceVoids?.init({api,user,workspace:businessWorkspace,sections:businessSections,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,toast:showToast,refresh:async result=>{
    const receipt=state.activeReceipt,record=receipt?.record;
    if(receipt?.type==='sale'&&Number(record.id)===result.saleId&&(record.workspaceId||businessWorkspace.id)===result.workspaceId){clearReceiptCredentials();state.activeReceipt=null;if($('#receipt-dialog').open)$('#receipt-dialog').close();window.InvoiceVoids?.setReceipt(null,null);}
    await Promise.all([loadDashboard(),has('products.read')?loadProducts():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve(),has('debts.view')?loadDebts():Promise.resolve(),has('expenses.view')?loadExpenses():Promise.resolve(),has('reports.view')&&state.currentView==='reports'?loadReport():Promise.resolve()]);
  }});
  window.BillPaymentCorrections?.init({api,getUser:()=>state.currentUser,getWorkspace:()=>businessWorkspace,has,identity:portalWorkflowIdentity,toast:showToast,refresh:async bill=>{
    if(state.activeReceipt?.type==='bill'&&Number(state.activeReceipt.record?.id)===Number(bill?.id)){clearReceiptCredentials();state.activeReceipt=null;if($('#receipt-dialog').open)$('#receipt-dialog').close();}
    await Promise.all([has('bills.view')?loadBills():Promise.resolve(),has('debts.view')?loadDebts():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve(),has('dashboard.view')?loadDashboard():Promise.resolve(),has('reports.view')&&state.currentView==='reports'?loadReport():Promise.resolve()]);
  }});
  // A destination/catalog read must not invalidate a successful sign-in.
  const whishStartup=has('dashboard.view')?WhishPayments.start(api,isMainAdmin):Promise.resolve();
  if (sessionVersion !== authSessionVersion || state.currentUser !== user) return;
  $("#network-screen").classList.add("hidden");
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#current-user-name").textContent = user.fullName;
  $("#current-user-role").textContent = roleLabel(user.role);
  $("#user-initials").textContent = user.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  if (isMainAdmin()) $("#report-workspace").innerHTML = `<option value="all">All sections</option>${businessSections.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  applyPermissions();
  api.workspace?.ready?.().catch(error => showToast(errorMessage(error),"error"));
  // Set the initial view once; its data is loaded by the tracked startup batch.
  const initialView=defaultView();
  switchView(initialView,{deferLoad:true});
  const tasks = [whishStartup];
  if (initialView==='dashboard'&&has("dashboard.view")) tasks.push(loadDashboard());
  if (initialView==='dashboard'&&has("drawer.view")) tasks.push(loadDrawer());
  if (initialView==='attendance'&&(has("attendance.view")||has("attendance.manage"))) tasks.push(loadEmployees(),loadAttendance());
  const initialResults = await Promise.allSettled(tasks);
  if (sessionVersion !== authSessionVersion || state.currentUser !== user) return;
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => synchronizeSharedData().catch(() => {}), 5000);
  lastBackgroundDataRefresh = Date.now();
  const failed=initialResults.filter(result=>result.status==='rejected');
  if(failed.length)showToast('Signed in. Some sections could not load and can be refreshed safely. '+errorMessage(failed[0].reason),'error');
  checkForUpdatesQuietly();
}

async function synchronizeSharedData() {
  if (!state.currentUser || state.syncing || document.querySelector("dialog[open]")) return;
  const sessionVersion = authSessionVersion, pollingUser = state.currentUser;
  const pollingCurrent = () => sessionVersion === authSessionVersion && state.currentUser === pollingUser;
  state.syncing = true;
  try {
    const status = await api.network.status();
    if (!pollingCurrent()) return;
    updateNetworkIndicators(status);
    if (!status.connected) return;
    if(status.mode==='client'&&status.versionMismatch){await checkForUpdatesQuietly();if(!pollingCurrent())return;showAuth('login');await openUpdateDialog();return;}
    const tasks = [];
    const auth = await api.auth.status();
    if (!pollingCurrent()) return;
    if (!auth.user) { showAuth("login"); return; }
    state.currentUser = auth.user;
    window.FinanceDashboard?.updateUser?.(auth.user);
    window.FixedMonthlyPayments?.updateUser?.(auth.user);
    window.CompanyDebts?.updateUser?.(auth.user);
    window.Bank?.updateUser?.(auth.user);
    window.MonthCloseSchedule?.updateUser?.(auth.user);
    window.AdminMoneyTransfers?.updateUser?.(auth.user);
    window.StickyNotes?.updateUser?.(auth.user);
    window.BandwidthAccounting?.updateUser?.(auth.user);
    window.SupportHandover?.updateUser?.(auth.user);
    window.ResellerFunding?.updateUser?.(auth.user);
    window.AdminReceivables?.updateUser?.(auth.user);
    window.AdminPayables?.updateUser?.(auth.user);
    window.AdminWarehouse?.updateUser?.(auth.user);
    window.InvoiceVoids?.updateUser?.(auth.user);
    $("#current-user-name").textContent = auth.user.fullName;
    $("#current-user-role").textContent = roleLabel(auth.user.role);
    applyPermissions();
    // Revalidate the session every5s, but refresh data only on the visible page
    // every15s. Do not rebuild hidden dashboard/catalogue DOM on every tick.
    if (Date.now() - lastBackgroundDataRefresh < BACKGROUND_DATA_REFRESH_MS) return;
    lastBackgroundDataRefresh = Date.now();
    if (has("products.read") && ["products","pos"].includes(state.currentView)) tasks.push(loadProducts());
    if (has("dashboard.view") && state.currentView === "dashboard") tasks.push(loadDashboard());
    if ((has("expenses.view") || has("expenses.manage")) && state.currentView === "expenses") tasks.push(loadExpenses());
    if (has("users.manage") && state.currentView === "users") tasks.push(loadUsers());
    if ((has("purchases.view") || has("purchases.manage")) && state.currentView === "purchases") tasks.push(loadPurchases());
    if ((has("attendance.view") || has("attendance.manage")) && state.currentView === "attendance") tasks.push(loadEmployees(), loadAttendance());
    if (state.currentView === "bills" && (has("bills.view") || has("bills.create") || has("bills.manage"))) tasks.push(loadBundles());
    if (has("bills.view") && state.currentView === "bills") tasks.push(loadBills());
    if (state.currentView === "telecom" && (has("telecom.view") || has("telecom.create") || has("telecom.manage"))) tasks.push(loadTelecomCatalog());
    if (has("telecom.view") && state.currentView === "telecom") tasks.push(loadTelecomPayments());
    if (has("debts.view") && state.currentView === "debts") tasks.push(loadDebts());
    if (has("drawer.view") && state.currentView === "dashboard") tasks.push(loadDrawer());
    if (has("reports.view") && state.currentView === "reports") tasks.push(loadReport());
    await Promise.all(tasks);
  } finally {
    if (sessionVersion === authSessionVersion) state.syncing = false;
  }
}

async function loadProducts() {
  window.SharedMaintenance?.load();
  if(api.warehouse)window.AdminWarehouse?.load();
  if(api.warehouse&&businessWorkspace.id==='main'){
    state.products=[];state.cart=[];renderProducts();renderCatalog();syncServiceCatalogUi();return;
  }
  if (!isMainCatalogAdmin()) {
    const identity=catalogIdentity(),products=await api.products.list();
    if (identity!==catalogIdentity() || !has('products.read')) return;
    state.products=products; renderProducts(); renderCatalog();syncServiceCatalogUi(); return;
  }
  const identity=catalogIdentity(),epoch=++adminInventory.epoch;
  adminInventory.loading=true;
  $("#admin-catalog-status").textContent="Loading original business catalogues…";
  try {
    const result=await api.adminCatalog.list();
    if (!catalogCurrent(identity)||epoch!==adminInventory.epoch) return;
    if (!Array.isArray(result?.workspaces)||!Array.isArray(result?.products)) throw Error("The business catalogues could not be verified. Refresh before making changes.");
    // Retain historical Main stock too: every canonical source keeps its own IDs.
    const workspaces=result.workspaces.filter(workspace=>workspace.id&&workspace.name);
    if (result.products.some(product=>!workspaces.some(workspace=>workspace.id===product.workspaceId)||!Number.isSafeInteger(Number(product.id))||Number(product.id)<=0)) throw Error("A product's original business could not be verified.");
    adminInventory.workspaces=workspaces;
    state.products=result.products;
    adminInventory.loaded=true;
    if (adminInventory.source&&!catalogWorkspace(adminInventory.source)) { if(state.cart.length)adminInventory.uncertain=true;else adminInventory.source=""; }
    $("#admin-catalog-status").textContent=api.warehouse?'Non-stock service catalogs. Admin-owned physical stock is managed above.':"Original inventory across businesses. Business labels identify where edits, stock and sales are saved. No stock is copied or combined.";
  } catch(error) {
    if (!catalogCurrent(identity)||epoch!==adminInventory.epoch) return;
    adminInventory.loaded=false;state.products=[];
    $("#admin-catalog-status").textContent=errorMessage(error);
  } finally {
    if (catalogCurrent(identity)&&epoch===adminInventory.epoch) {adminInventory.loading=false;renderProducts();renderCatalog();syncServiceCatalogUi();}
  }
}

async function loadExpenses() {
  const scope = isMainAdmin() ? $("#expense-business-filter").value || "all" : businessWorkspace.id;
  const identity = state.currentUser?.accountKey || state.currentUser?.username;
  const entries = await api.expenses.list(scope);
  if (!(has("expenses.view") || has("expenses.manage")) || identity !== (state.currentUser?.accountKey || state.currentUser?.username) || scope !== (isMainAdmin() ? $("#expense-business-filter").value || "all" : businessWorkspace.id)) return;
  state.expenses = entries; refreshExpenseFilterCategories(); renderExpenses();
}
async function loadExpenseCategories() {
  const scope=nativeDataScope(),categories=await api.expenseCategories.list();if(scope!==nativeDataScope())return;
  state.expenseCategories = categories;
  refreshExpenseCategorySelectors();
  renderExpenseCategoryManager();
}
async function loadPurchases() { if(isMainAdmin()&&api.stockPurchases)return window.StockPurchases?.load();const scope=nativeDataScope(),purchases=await api.purchases.list();if(scope!==nativeDataScope())return;state.purchases=purchases;renderPurchases(); }
async function loadReportCategories() {
  const scope=nativeDataScope(),categories=await api.reports.categories();if(scope!==nativeDataScope())return;
  state.reportCategories = categories;
  const select = $("#report-pos-category");
  const previous = select.value;
  select.innerHTML = `<option value="">All categories</option>${state.reportCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (state.reportCategories.includes(previous)) select.value = previous;
}
async function loadUsers() {
  if (!has("users.manage")) return;
  const account = state.currentUser?.accountKey || state.currentUser?.username;
  const users = await api.users.list();
  if (!has("users.manage") || account !== (state.currentUser?.accountKey || state.currentUser?.username)) return;
  state.users = users; renderUsers();
}
async function loadEmployees() { const scope=nativeDataScope(),employees=await api.employees.list();if(scope!==nativeDataScope())return;state.employees=employees;renderEmployees(); }
async function loadBundles() { const scope=nativeDataScope(),bundles=await api.bundles.list();if(scope!==nativeDataScope())return;state.bundles=bundles;renderBundleCatalog();updateBillBundleOptions(false); }
async function loadAttendance() {
  const start = $("#attendance-start").value;
  const end = $("#attendance-end").value;
  if (!start || !end || start > end) return;
  const scope=nativeDataScope(),attendance=await api.attendance.list(start,end);if(scope!==nativeDataScope())return;
  state.attendance = attendance;
  renderAttendance();
}
async function loadBills() {
  void loadChangeRenewPending();
  const start = $("#bills-start").value;
  const end = $("#bills-end").value;
  if (!start || !end || start > end) return;
  const scope=nativeDataScope(),bills=await api.bills.list(start,end);if(scope!==nativeDataScope())return;
  state.bills = bills;
  renderBills();
  if(businessWorkspace.id==='fiber-users'&&(has('bills.create')||has('bills.manage')))await loadFreeRenewalHistory();
}
async function loadTelecomCatalog() {
  const scope=nativeDataScope(),catalog=await api.telecomCatalog.list();if(scope!==nativeDataScope())return;
  state.telecomCatalog = catalog;
  renderTelecomCatalog();
  updateTelecomForm(false);
}
async function loadTelecomPayments() {
  const start = $("#telecom-start").value;
  const end = $("#telecom-end").value;
  if (!start || !end || start > end) return;
  const scope=nativeDataScope(),payments=await api.telecomPayments.list(start,end);if(scope!==nativeDataScope())return;
  state.telecomPayments = payments;
  renderTelecomPayments();
}
async function loadDebts() { const scope=nativeDataScope(),debts=await api.debts.list($("#debts-include-paid").checked);if(scope!==nativeDataScope())return;state.debts=debts;renderDebts(); }
async function loadDrawer() {
  if (isAllBusinessDashboard()) return;
  const identity = dashboardIdentity();let drawer;
  try{drawer=await api.drawer.get();}catch(error){if(identity===dashboardIdentity()&&!isAllBusinessDashboard()){state.drawer=null;$('#metric-cash-drawer').textContent='—';$('#metric-cash-today').textContent='Cash drawer unavailable — refresh to verify.';}throw error;}
  if (identity !== dashboardIdentity() || isAllBusinessDashboard()) return;
  state.drawer = drawer; renderDrawer();
}

function dashboardIdentity() {
  return JSON.stringify([cashierCollectionsUserKey(),businessWorkspace.id,$('#finance-business')?.value,$('#finance-employee')?.value]);
}
function clearCombinedHeadlines(note) {
  for (const id of ['metric-today-sales','metric-today-bills','metric-today-telecom','metric-today-profit','metric-stock-value','metric-month-expenses','metric-cash-drawer','metric-outstanding-debt','metric-internet-cost','metric-whish-wallets','metric-whish-fees','combined-revenue','combined-expenses','combined-profit']) $(`#${id}`).textContent = '—';
  for (const id of ['metric-sale-count','metric-bill-count','metric-telecom-count','metric-stock-units','metric-cash-today','metric-debt-count']) $(`#${id}`).textContent = note;
  $('#recent-sales-body').innerHTML = emptyRow(6, note, 'No previous business or employee totals are shown.');
  $('#low-stock-list').textContent = note; $('#low-stock-count').textContent = '—';
  state.drawer = null;
}
async function loadDashboard() {
  window.InvoiceVoids?.load();
  window.AdminReceivables?.load();
  window.AdminPayables?.load();
  window.AdminWarehouse?.refreshDebts?.();
  const generation = ++dashboardLoadVersion, identity = dashboardIdentity();
  $('#metric-bandwidth-cost').textContent='—';
  const current = () => generation === dashboardLoadVersion && identity === dashboardIdentity();
  if (isAllBusinessDashboard() && dashboardHeadlineKey !== identity) clearCombinedHeadlines('Loading combined totals…');
  dashboardHeadlineKey = identity;
  const cashierCollections=loadCashierCollections();
  let finances;
  try { finances = await window.FinanceDashboard?.load(); }
  catch (error) { if (current() && isAllBusinessDashboard()) clearCombinedHeadlines('Combined totals unavailable'); throw error; }
  if (!current()) return;
  if (api.finance && has('reports.view') && window.FinanceDashboard?.isCurrent && !window.FinanceDashboard.isCurrent(finances)) return;
  if(finances?.aggregate&&finances.admin===false){
    // Staff All is a minimal, read-only custody/debt DTO, not a company report.
    // Never fetch a broader report merely to populate retired headline nodes.
    clearCombinedHeadlines('Your assigned-business totals appear below.');
    applyPermissions();await cashierCollections;return;
  }
  const useFinanceDashboard = finances && (businessWorkspace.id !== 'main' || finances.aggregate);
  let dashboard;
  try{dashboard=useFinanceDashboard ? finances.dashboard : await api.reports.dashboard();}
  catch(error){if(current())clearCombinedHeadlines('Totals unavailable — refresh to verify.');throw error;}
  if (!current()) return;
  $('#metric-internet-cost').textContent=formatMoney(-(dashboard.monthInternetCost??0));
  $('#metric-whish-wallets').textContent=formatMoney(dashboard.totalWhishWallets??0);
  $('#whish-wallet-total-card').classList.toggle('hidden',!(finances?.aggregate||businessWorkspace.id==='fiber-users'||isResellerCashierDashboard())||!has('drawer.view'));
  $('#metric-whish-fees').textContent=formatMoney(dashboard.monthWhishFees??0);
  $('#internet-cost-card').classList.toggle('hidden',!finances?.aggregate&&businessWorkspace.id!=='fiber-users');
  const showBandwidth=businessWorkspace.id==='fiber-resellers'&&state.currentUser?.role==='admin',bandwidth=dashboard.bandwidthCost;
  $('#bandwidth-cost-card').classList.toggle('hidden',!showBandwidth);
  $('#metric-bandwidth-cost').textContent=showBandwidth&&Number.isFinite(bandwidth?.incurredCost)?formatMoney(-bandwidth.incurredCost):'—';
  $('#bandwidth-cost-note').textContent=Number.isFinite(bandwidth?.incurredCost)?'Purchased this month · includes unpaid supplier bills':'Bandwidth purchase costs unavailable. Update the Main PC and this PC together.';
  $("#metric-today-sales").textContent = formatMoney(dashboard.todaySales.value);
  $("#metric-sale-count").textContent = `${dashboard.todaySales.count} transaction${Number(dashboard.todaySales.count) === 1 ? "" : "s"}`;
  $("#metric-today-bills").textContent = formatMoney(dashboard.todayBills.value);
  $("#metric-bill-count").textContent = `${dashboard.todayBills.count} bill record${Number(dashboard.todayBills.count) === 1 ? "" : "s"}`;
  $("#metric-today-telecom").textContent = formatMoney(dashboard.todayTelecom.value);
  $("#metric-telecom-count").textContent = `${dashboard.todayTelecom.count} payment${Number(dashboard.todayTelecom.count) === 1 ? "" : "s"}`;
  $("#metric-today-profit").textContent = formatMoney(dashboard.todayProfit.value);
  $("#metric-stock-value").textContent = dashboard.stock.value === null ? `${dashboard.stock.units} units` : formatMoney(dashboard.stock.value);
  $("#metric-stock-units").textContent = `${dashboard.stock.units} units in stock`;
  $("#metric-month-expenses").textContent = formatMoney(dashboard.monthExpenses.value);
  state.drawer = dashboard.drawer;
  $("#metric-cash-drawer").textContent = formatMoney(dashboard.drawer.balance);
  $("#metric-cash-today").textContent = `${formatMoney(dashboard.drawer.todayIn)} received in cash today`;
  $("#metric-outstanding-debt").textContent = formatMoney(dashboard.outstandingDebt.value);
  $("#metric-debt-count").textContent = `${dashboard.outstandingDebt.count} unpaid record${Number(dashboard.outstandingDebt.count) === 1 ? "" : "s"}`;
  $("#low-stock-count").textContent = dashboard.lowStock.length;
  const activity=dashboard.recentActivity||dashboard.recentSales;
  $("#recent-sales-body").innerHTML = activity.length
    ? activity.map((sale) => `<tr><td><strong>${escapeHtml(sale.invoiceNo)}</strong><small>${sale.workspaceName?escapeHtml(sale.workspaceName)+' · ':''}${escapeHtml(sale.activity||'Products / POS')}${sale.customerName?' · '+escapeHtml(sale.customerName):''}</small></td><td>${dateTimeFormatter.format(new Date(sale.createdAt))}</td><td>${escapeHtml(sale.cashierName || "—")}</td><td>${paymentBadge(sale.paymentMethod, sale.paymentStatus)}</td><td class="number"><strong>${formatMoney(sale.subtotal)}</strong></td><td class="number financial-only">${formatMoney(sale.profit)}</td></tr>`).join("")
    : emptyRow(6, "No activity yet", "Sales, service bills and expense funding will appear here.");
  $("#low-stock-list").innerHTML = dashboard.lowStock.length
    ? dashboard.lowStock.map((product) => `<div class="stock-item"><div><strong>${escapeHtml(product.name)}</strong><span>${product.workspaceName?escapeHtml(product.workspaceName)+' · ':''}${escapeHtml(product.sku)} · alert at ${product.reorderLevel}</span></div><div class="stock-level"><strong>${product.quantity}</strong><span>remaining</span></div></div>`).join("")
    : `<div class="empty-state"><div><strong>Stock levels look good</strong><p>Products at or below their alert quantity will appear here.</p></div></div>`;
  applyPermissions();
  if(isAllBusinessDashboard()||(finances?.admin&&finances.accountKey))$('#set-cash-drawer').classList.add('hidden');
  if (isMainAdmin()) {
    const report = finances?.aggregate ? finances.report : await api.reports.summary(`${localDate().slice(0,7)}-01`, localDate(), "", "all");
    if (!current()) return;
    $('#combined-overview > div > span').textContent = finances?.aggregate ? `All businesses · ${finances.employeeName} · this month` : 'All sections · this month';
    $("#combined-revenue").textContent = formatMoney(report.revenue);
    $("#combined-expenses").textContent = formatMoney(report.expenses);
    $("#combined-profit").textContent = formatMoney(report.netProfit);
  }
  await cashierCollections;
}

function renderProducts() {
  const search = $("#product-search").value.trim().toLowerCase();
  const scope=isMainCatalogAdmin()?$("#product-business-filter").value:"all";
  const scoped=state.products.filter(product=>scope==="all"||product.workspaceId===scope);
  const filtered = scoped.filter((product) => `${product.name} ${product.sku} ${product.category} ${product.workspaceName||""} ${(product.barcodes || []).join(" ")}`.toLowerCase().includes(search));
  const units = scoped.filter((product) => product.trackQuantity).reduce((sum, product) => sum + Number(product.quantity), 0);
  $("#product-summary").textContent = `${scoped.length} product${scoped.length === 1 ? "" : "s"} · ${units} units${isMainCatalogAdmin()?` · ${scope==="all"?"All businesses":catalogWorkspace(scope)?.name||scope}`:""}`;
  $("#products-body").innerHTML = filtered.length
    ? filtered.map((product) => {
        const status = !product.trackQuantity ? ["Non-stock service", "status-ok"] : product.quantity === 0 ? ["Out of stock", "status-out"] : product.quantity <= product.reorderLevel ? ["Low stock", "status-low"] : ["In stock", "status-ok"];
        const canManage = has("products.manage");
        const printingLabel = String(product.category).toLowerCase() === "printing" ? "B&W base · " : "";
        const source=isMainCatalogAdmin()?` data-product-key="${escapeHtml(productKey(product))}"`:"";
        return `<tr><td><div class="product-name"><span class="product-avatar">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(product.name)}</strong><span>${product.barcodes.length} barcode${product.barcodes.length === 1 ? "" : "s"}</span>${isMainCatalogAdmin()?`<span class="admin-business-badge">${escapeHtml(product.workspaceName)}</span>`:""}</div></div></td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(product.sku)}</td><td><button class="barcode-link show-barcode" data-id="${product.id}"${source}>${escapeHtml(product.barcode)}</button></td><td><span class="currency-badge currency-${String(product.currency).toLowerCase()}">${escapeHtml(product.currency)}</span></td><td class="number financial-only">${formatProductMoney(product.cost, product.currency)}</td><td class="number financial-only">${Number(product.markup || 0).toFixed(1)}%</td><td class="number"><div class="money-pair"><strong>${formatProductMoney(product.price, product.currency)}</strong><small>${printingLabel}${product.currency === "LBP" ? formatMoney(product.priceUsd) : formatLbp(product.priceLbp)}</small></div></td><td class="number"><span class="status ${status[1]}">${status[0]}${product.trackQuantity ? ` · ${product.quantity}` : ""}</span></td><td><div class="row-actions">${canManage ? `<button class="icon-button edit-product" data-id="${product.id}"${source} aria-label="Edit ${escapeHtml(product.name)}" title="Edit product">${icon("edit")}</button>` : ""}${has("products.delete") ? `<button class="icon-button delete delete-product" data-id="${product.id}"${source} aria-label="Delete ${escapeHtml(product.name)}" title="Delete product">${icon("trash")}</button>` : ""}</div></td></tr>`;
      }).join("")
    : emptyRow(10, search ? "No matching products" : "No products yet", search ? "Try another search." : "Add your first inventory item to begin.");
  applyPermissions();
}

function renderCatalog() {
  configureAdminInventory();
  const products=posProducts();
  if(isMainCatalogAdmin()&&(!adminInventory.source||!adminInventory.loaded)) {
    $("#pos-catalog-title").textContent="Choose a selling business";
    $("#pos-catalog-subtitle").textContent="Each business keeps its own products, stock and payments.";
    $("#pos-category-back").classList.add("hidden");
    $("#product-catalog").innerHTML='<div class="empty-state" style="grid-column:1/-1"><div><strong>Select a business above</strong><p>One sale is saved in one original business.</p></div></div>';
    return;
  }
  const search = $("#pos-search").value.trim().toLowerCase();
  const categoryNames = products.map((product) => String(product.category || "Other"));
  if ((isMainCatalogAdmin()?adminInventory.source:businessWorkspace.id) === "studio" && !categoryNames.some(category => category.trim().toLowerCase() === "photos and shooting")) categoryNames.push("Photos and shooting");
  const categories = [...new Set(categoryNames)].sort((a, b) => a.localeCompare(b));
  if (state.posCategory && !categories.includes(state.posCategory)) state.posCategory = null;
  const categorySelected = Boolean(state.posCategory);
  $("#pos-category-back").classList.toggle("hidden", !categorySelected);
  $("#pos-catalog-title").textContent = categorySelected ? state.posCategory : "Select a category";
  $("#pos-catalog-subtitle").textContent = categorySelected ? "Choose a product from this category." : "Choose a category first, then select a product.";
  $("#pos-search").placeholder = categorySelected ? `Search ${state.posCategory} products` : "Search categories";
  if (!categorySelected) {
    const filteredCategories = categories.filter((category) => category.toLowerCase().includes(search));
    $("#product-catalog").innerHTML = filteredCategories.length
      ? filteredCategories.map((category) => {
          const categoryProducts = products.filter((product) => product.category === category);
          const available = categoryProducts.filter((product) => !product.trackQuantity || Number(product.quantity) > 0).length;
          return `<button class="category-card select-pos-category" data-category="${escapeHtml(category)}"><span class="category-card-icon">${escapeHtml(category.slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(category)}</strong><span>${categoryProducts.length} product${categoryProducts.length === 1 ? "" : "s"}</span><small>${available} available</small></button>`;
        }).join("")
      : `<div class="empty-state" style="grid-column:1/-1"><div><strong>${search ? "No matching categories" : "Your catalog is empty"}</strong><p>${search ? "Try another category name." : "Add products before starting a sale."}</p></div></div>`;
    return;
  }
  const filtered = products.filter((product) => product.category === state.posCategory && `${product.name} ${product.sku} ${(product.barcodes || []).join(" ")}`.toLowerCase().includes(search));
  $("#product-catalog").innerHTML = filtered.length
    ? filtered.map((product) => {
        const isPrinting = String(product.category).toLowerCase() === "printing";
        const availability = isPrinting ? "Choose size & service" : product.trackQuantity ? (product.quantity > 0 ? `${product.quantity} in stock` : "Out of stock") : "Service · no stock count";
        return `<button class="catalog-card add-to-cart" data-id="${product.id}" ${product.trackQuantity && product.quantity <= 0 ? "disabled" : ""}><span class="category">${escapeHtml(product.category)}</span><strong>${escapeHtml(product.name)}</strong><span class="sku">${escapeHtml(product.sku)} · ${escapeHtml(product.barcode)}</span><footer><b>${isPrinting ? "Price table" : formatLbp(product.priceLbp)}</b><span>${availability}</span></footer></button>`;
      }).join("")
    : `<div class="empty-state" style="grid-column:1/-1"><div><strong>${search ? "No matching products" : "No products in this category"}</strong><p>${search ? "Try another product name, SKU, or barcode." : "Return to categories or add a product."}</p></div></div>`;
}

function renderCart() {
  const totalUsd = cartTotalUsd();
  const totalLbp = state.cart.reduce((sum, item) => sum + item.priceLbp * item.quantity, 0);
  $("#cart-total-lbp").textContent = formatLbp(totalLbp);
  $("#cart-total-usd").textContent = formatMoney(totalUsd);
  $("#cart-items").innerHTML = state.cart.length
    ? state.cart.map((item) => `<div class="cart-item"><div class="cart-item-head"><div class="cart-item-title"><strong>${escapeHtml(item.name)}</strong>${item.variantDescription ? `<span>${escapeHtml(item.variantDescription)}</span>` : ""}</div><button class="remove-cart-item" data-key="${escapeHtml(item.key)}" aria-label="Remove ${escapeHtml(item.name)}" title="Remove item">${icon("close")}</button></div><div class="cart-item-foot"><div class="quantity-control"><button class="cart-minus" data-key="${escapeHtml(item.key)}" aria-label="Decrease ${escapeHtml(item.name)} quantity">${icon("minus")}</button><span>${item.quantity}</span><button class="cart-plus" data-key="${escapeHtml(item.key)}" aria-label="Increase ${escapeHtml(item.name)} quantity">${icon("plus")}</button></div><div class="money-pair"><strong>${formatLbp(item.priceLbp * item.quantity)}</strong><small>${formatMoney(Math.round((item.priceUsd * item.quantity + Number.EPSILON) * 100) / 100)}</small></div></div></div>`).join("")
    : `<div class="empty-state"><div><strong>Your cart is empty</strong><p>Scan or select a product to start a sale.</p></div></div>`;
  $("#complete-sale").disabled = state.cart.length === 0;
  WhishPayments.sync();
  configureAdminInventory();
}

function expenseBusinessName(id) { return id === "main" ? "Company Expenses" : businessSections.find(item => item.id === id)?.name || businessWorkspace.name; }
function configureExpenseBusinessFilter() {
  const select = $("#expense-business-filter"), previous = select.value;
  const options = `<option value="all">All businesses</option>${businessSections.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(expenseBusinessName(item.id))}</option>`).join("")}`;
  if (select.innerHTML !== options) { select.innerHTML = options; select.value = businessSections.some(item => item.id === previous) ? previous : "all"; }
  $("#expense-business-filter-label").classList.toggle("hidden", !isMainAdmin());
}
function refreshExpenseFilterCategories() {
  const select = $("#expense-category-filter"), previous = select.value;
  const ordinaryRows = state.expenses.filter(expense => !window.ExpenseFunding.isProfitOnlyFee(expense) && !window.ExpenseFunding.isBandwidthCost(expense));
  const ordinaryCategories = new Set(ordinaryRows.map(expense => expense.category));
  const separateOnlyCategories = new Set(state.expenses.filter(expense => window.ExpenseFunding.isProfitOnlyFee(expense) || window.ExpenseFunding.isBandwidthCost(expense)).map(expense => expense.category).filter(name => !ordinaryCategories.has(name)));
  const names = [...new Set([...state.expenseCategories.map(item => item.name).filter(name => !separateOnlyCategories.has(name)), ...ordinaryCategories])].sort((a,b)=>a.localeCompare(b));
  if (businessWorkspace.id === "fiber-users" && !names.includes("Installation payments")) names.push("Installation payments");
  select.innerHTML = `<option value="">All categories</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (names.includes(previous)) select.value = previous;
}
function updateExpensePaperFields() {
  const paper = $("#expense-business").value === "printer" && /^(A[345]) paper$/i.test($("#expense-category").value);
  $("#expense-paper-type-field").classList.toggle("hidden", !paper);
  $("#expense-paper-type").disabled = !paper; $("#expense-paper-type").required = paper;
  $("#expense-description-field").classList.toggle("hidden", paper);
  $("#expense-description").disabled = paper; $("#expense-description").required = !paper;
}
function syncSpendingWhishFee(kind) {
  const workspaceId = kind === "expense" ? $("#expense-business").value : businessWorkspace.id;
  const allowed = state.currentUser?.role === "admin" && workspaceId === "fiber-resellers";
  const checkbox = $(`#${kind}-whish-fee`);
  $(`#${kind}-whish-fee-field`).classList.toggle("hidden", !allowed);
  checkbox.disabled = !allowed;
  if (!allowed) checkbox.checked = false;
  const amount = kind === "expense" ? Number($("#expense-amount").value) : state.purchaseDraft.reduce((sum, line) => sum + Math.round((Number(line.quantity) || 0) * (Number(line.unitCost) || 0) * 100) / 100, 0);
  const fee = Number.isFinite(amount) && amount > 0 ? Math.round(Math.round(amount * 100) / 100) / 100 : 0;
  $(`#${kind}-whish-fee-preview`).textContent = checkbox.checked && allowed ? `${formatMoney(fee)} Whish fee will be deducted from profit once.` : "No additional Whish fee selected.";
}
function clearExpenseFundingSources() {
  expenseFundingWallets = [];
  expenseFundingProjection=null;
  $('#expense-funding-month').innerHTML='<option value="">Loading funding months…</option>';
  $('#expense-funding-month').disabled=true;
  $('#expense-funding-available').textContent='Funding balances need verification for the selected business and expense date.';
  $("#expense-funding-method").disabled = true;
  $("#expense-funding-method").value = "";
  $("#expense-funding-wallet").innerHTML = '<option value="">Choose wallet</option>';
  $("#expense-funding-wallet").disabled = true;
  $("#expense-funding-wallet").required = false;
  $("#expense-funding-wallet-field").classList.add("hidden");
}
function syncExpenseFundingSource() {
  const method = $("#expense-funding-method").value;
  const whish = method === "Whish Money";
  const projection=expenseFundingProjection,month=$('#expense-funding-month').value,bucket=projection?.months.find(row=>row.month===month),ready=Boolean(projection&&projection.workspaceId===$('#expense-business').value&&projection.asOf===$('#expense-date').value&&bucket);
  const usable = !expenseOptionsLoading && has("expenses.manage") && $("#expense-dialog").open && ready;
  $('#expense-funding-month').disabled=!usable;
  $('#expense-funding-refresh').disabled=expenseOptionsLoading||expenseSaving;
  $('#expense-submit').disabled=expenseSaving||!usable;
  $("#expense-funding-method").disabled = !usable;
  $("#expense-funding-wallet-field").classList.toggle("hidden", !whish);
  $("#expense-funding-wallet").disabled = !usable || !whish;
  $("#expense-funding-wallet").required = whish;
  const unknown = !method && Boolean($("#expense-id").value);
  $("#expense-funding-source-note").textContent = unknown
    ? "Source not recorded on this older expense. Keep it unchanged, or select Cash / Whish wallet if you can verify the original source. This records a funding allocation only; it does not create another drawer/wallet movement."
    : whish && !expenseFundingWallets.length
      ? "No active Whish wallet is available. Ask the Admin to configure a wallet, or choose Cash if that is the verified source. This records a funding allocation only; it does not send money."
      : "Records which funding paid this expense. This is a funding allocation only: it does not send money or create another drawer/wallet movement. Whish fees reduce net profit, not funding.";
  if(!ready)return;
  const amount=Number($('#expense-amount').value),knownAmount=Number.isFinite(amount)&&amount>0,source=method==='Cash'?bucket.cashRemaining:whish?bucket.whishRemaining:null;
  const lines=[`${expenseFundingMonthLabel(month)} funding · total remaining ${formatMoney(bucket.remaining)}`,`Cash ${formatMoney(bucket.cashRemaining)} · Whish ${formatMoney(bucket.whishRemaining)}`];
  if(knownAmount)lines.push(`After allocating ${formatMoney(amount)}: total ${formatMoney(Math.round((bucket.remaining-amount)*100)/100)}${source===null?'':` · ${whish?'Whish':'Cash'} ${formatMoney(Math.round((source-amount)*100)/100)}`}.`);
  if(bucket.hasUnallocated)lines.push('Some historical funding sources were not recorded. Cash and Whish figures are before unresolved allocations; no source was guessed.');
  const negative=bucket.remaining<0||source!==null&&source<0||knownAmount&&(bucket.remaining<amount||source!==null&&source<amount);
  if(negative)lines.push('This allocation leaves a negative recorded funding balance. You can still record the expense; this does not move cash or wallet money.');
  lines.push('Expense date controls spending reports. Funding month selects the budget only.');
  $('#expense-funding-available').textContent=lines.join('\n');$('#expense-funding-availability').dataset.warning=String(negative||bucket.hasUnallocated);
}
function expenseFundingMonthLabel(month){return new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});}
function verifyExpenseFundingProjection(value,id,date,excludeExpenseId){
  const validMonth=month=>typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month),money=amount=>typeof amount==='number'&&Number.isFinite(amount)&&Number.isSafeInteger(Math.round(amount*100))&&Math.abs(amount*100-Math.round(amount*100))<1e-6;
  if(!value||value.basis!=='expense_funding_months'||value.allocationOnly!==true||value.workspaceId!==id||value.asOf!==date||value.excludeExpenseId!==excludeExpenseId||!/^\d{4}-\d{2}-\d{2}$/.test(value.availableThrough||'')||value.availableThrough>date||!validMonth(value.currentMonth)||!Array.isArray(value.months)||!value.months.length||new Set(value.months.map(row=>row.month)).size!==value.months.length)throw Error('Funding months could not be verified for this business and expense date. Refresh Main and this PC together.');
  for(const row of value.months)if(!validMonth(row.month)||row.month>date.slice(0,7)||!['received','spent','remaining','cashReceived','cashSpent','cashRemaining','whishReceived','whishSpent','whishRemaining','unallocatedSpent','otherReceived'].every(key=>money(row[key]))||typeof row.hasUnallocated!=='boolean'||!Number.isSafeInteger(row.unallocatedCount)||row.unallocatedCount<0||Math.round(row.received*100)-Math.round(row.spent*100)!==Math.round(row.remaining*100)||Math.round(row.cashReceived*100)-Math.round(row.cashSpent*100)!==Math.round(row.cashRemaining*100)||Math.round(row.whishReceived*100)-Math.round(row.whishSpent*100)!==Math.round(row.whishRemaining*100))throw Error('A funding month balance could not be verified. No amount was guessed.');
  return value;
}
function expenseFundingDraft(){const wallet=expenseFundingWallets.find(row=>String(row.id)===$('#expense-funding-wallet').value);return {fundingMonth:$('#expense-funding-month').value,fundingMethod:$('#expense-funding-method').value,fundingWallet:wallet?{...wallet}:null,category:$('#expense-category').value,paperType:$('#expense-paper-type').value,deductWhishFee:$('#expense-whish-fee').checked};}
function setExpenseFundingSources(options, expense) {
  const savedMethod = ["Cash", "Whish Money"].includes(expense?.fundingMethod) ? expense.fundingMethod : "";
  const olderUnknown = Boolean(expenseFundingSaved) && !["Cash","Whish Money"].includes(expenseFundingSaved.fundingMethod);
  $("#expense-funding-method").innerHTML = `<option value="">${olderUnknown ? "Source not recorded · older expense" : "Choose Cash or Whish wallet"}</option><option value="Cash">Cash</option><option value="Whish Money">Whish wallet</option>`;
  $("#expense-funding-method").required = !olderUnknown;
  $("#expense-funding-method").value = savedMethod;
  expenseFundingWallets = (options.fundingWallets || []).map(wallet => ({...wallet}));
  const originalWallet=expenseFundingSaved?.fundingMethod==='Whish Money'&&String(expenseFundingSaved.fundingWallet?.id)===String(expense?.fundingWallet?.id)?expenseFundingSaved.fundingWallet:null;
  const savedWallet = savedMethod === "Whish Money" ? originalWallet : null;
  if (savedWallet?.id) {
    const savedIndex = expenseFundingWallets.findIndex(wallet => String(wallet.id) === String(savedWallet.id));
    const originalWallet = {...savedWallet, snapshotOnly:true};
    if (savedIndex >= 0) expenseFundingWallets[savedIndex] = originalWallet;
    else expenseFundingWallets.push(originalWallet);
  }
  $("#expense-funding-wallet").innerHTML = '<option value="">Choose wallet</option>' + expenseFundingWallets.map(wallet => `<option value="${escapeHtml(wallet.id)}">${escapeHtml(wallet.label || wallet.number || "Whish wallet")}${wallet.number && wallet.number !== wallet.label ? ` · ${escapeHtml(wallet.number)}` : ""}${wallet.snapshotOnly ? " · saved original wallet" : ""}</option>`).join("");
  const selectedId=savedWallet?.id||expense?.fundingWallet?.id||'';$("#expense-funding-wallet").value = expenseFundingWallets.some(wallet=>String(wallet.id)===String(selectedId))?selectedId:'';
}
async function setExpenseBusiness(id, expense = null) {
  syncSpendingWhishFee("expense");
  const version = ++expenseOptionsVersion, identity = state.currentUser?.accountKey || state.currentUser?.username;
  const savedRefresh=expenseFundingRefreshDraft?.workspaceId===id?expenseFundingRefreshDraft:null,sameBusiness=expenseFundingProjection?.workspaceId===id||Boolean(savedRefresh),liveDraft=expenseFundingDraft(),draft=expense||(!expenseFundingProjection&&savedRefresh?{...savedRefresh,category:liveDraft.category,paperType:liveDraft.paperType,deductWhishFee:liveDraft.deductWhishFee}:liveDraft),date=$('#expense-date').value,excludeExpenseId=$('#expense-id').value?Number($('#expense-id').value):null;
  if(!expense&&!sameBusiness){draft.fundingWallet=null;draft.fundingMonth='';}
  expenseFundingRefreshDraft={...draft,workspaceId:id};
  expenseOptionsLoading = true; $("#expense-submit").disabled = true; clearExpenseFundingSources();
  $('#expense-funding-refresh').disabled=true;
  try {
    const options = api.expenses.options ? await api.expenses.options(id,{expenseDate:date,...excludeExpenseId?{excludeExpenseId}:{}}) : { workspaceId: businessWorkspace.id, businesses: [{id:businessWorkspace.id,name:expenseBusinessName(businessWorkspace.id)}], categories:state.expenseCategories };
    if (version !== expenseOptionsVersion || !$("#expense-dialog").open || !has("expenses.manage") || identity !== (state.currentUser?.accountKey || state.currentUser?.username)) return;
    if(options.workspaceId!==id)throw Error('The selected funding business changed. Choose it again.');
    const projection=verifyExpenseFundingProjection(options.fundingMonths,id,date,excludeExpenseId);
    if(!expense&&sameBusiness){draft.category=$('#expense-category').value;draft.paperType=$('#expense-paper-type').value;draft.deductWhishFee=$('#expense-whish-fee').checked;}
    $("#expense-business").innerHTML = options.businesses.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    $("#expense-business").value = options.workspaceId;
    $("#expense-business").disabled = Boolean($("#expense-id").value) || options.businesses.length === 1;
    const categories = options.categories.map(item => item.name);
    if (expense && !categories.includes(expense.category)) categories.push(expense.category);
    $("#expense-category").innerHTML = categories.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    if(categories.includes(draft.category))$("#expense-category").value=draft.category;
    $("#expense-paper-type").value = draft.paperType || "";
    setExpenseFundingSources(options, draft);
    expenseFundingProjection=projection;
    $('#expense-funding-month').innerHTML=projection.months.map(row=>`<option value="${escapeHtml(row.month)}">${escapeHtml(expenseFundingMonthLabel(row.month))} · ${formatMoney(row.remaining)} remaining</option>`).join('');
    const wanted=draft.fundingMonth||(expense?expense.expenseDate.slice(0,7):date.slice(0,7));
    if(expense&&!projection.months.some(row=>row.month===wanted))throw Error('The original expense funding month is unavailable. Keep the saved record and refresh its funding options.');
    $('#expense-funding-month').value=projection.months.some(row=>row.month===wanted)?wanted:projection.months.some(row=>row.month===projection.currentMonth)?projection.currentMonth:projection.months[0].month;
    updateExpensePaperFields();
    $("#expense-whish-fee").checked = Boolean(draft.deductWhishFee);
    syncSpendingWhishFee("expense");
    expenseOptionsLoading = false; syncExpenseFundingSource();
  } catch (error) {
    if (version === expenseOptionsVersion && has("expenses.manage") && identity === (state.currentUser?.accountKey || state.currentUser?.username)) { clearExpenseFundingSources();$('#expense-funding-available').textContent=errorMessage(error);showToast(errorMessage(error), "error"); }
  } finally { if (version === expenseOptionsVersion) {expenseOptionsLoading = false;syncExpenseFundingSource();} }
}
async function openExpenseDialog(expense = null) {
  if (!has("expenses.manage") || (expense && state.currentUser?.role !== "admin")) return;
  $("#expense-form").reset(); $("#expense-id").value = expense?.id || "";
  expenseFundingSaved = expense;
  expenseFundingRefreshDraft=null;
  $("#expense-date").value = expense?.expenseDate || localDate();
  $("#expense-description").value = expense?.description || "";
  $("#expense-amount").value = expense?.amount ?? "";
  $("#expense-whish-fee").checked = Boolean(expense?.deductWhishFee);
  $("#expense-dialog-title").textContent = expense ? "Edit expense" : "Add expense";
  $("#expense-edit-note").textContent = expense ? "The original staff member and business are preserved. Changes are recorded in an admin audit trail." : "Choose the business that should carry this cost.";
  const selected = isMainAdmin() && $("#expense-business-filter").value !== "all" ? $("#expense-business-filter").value : businessWorkspace.id;
  $("#expense-business").innerHTML = `<option value="${escapeHtml(expense?.workspaceId || selected)}">${escapeHtml(expenseBusinessName(expense?.workspaceId || selected))}</option>`;
  $("#expense-dialog").showModal(); await setExpenseBusiness(expense?.workspaceId || selected, expense);
}

function renderExpenseCarry(month){
  try{
    const scope=isMainAdmin()?$('#expense-business-filter').value||'all':businessWorkspace.id,carry=window.ExpenseFunding.carry(state.expenses,{month,...scope!=='all'?{workspaceId:scope}:{}});
    $('#expense-carry-total').textContent=formatMoney(carry.remaining);
    $('#expense-carry-months').innerHTML=carry.buckets.length?carry.buckets.map(row=>`<div class="expense-carry-row"><div><strong>${escapeHtml(row.workspaceName||expenseBusinessName(row.workspaceId))}</strong><small>${escapeHtml(expenseFundingMonthLabel(row.month))}</small></div><div><span>Unused funding</span><strong>${formatMoney(row.remaining)}</strong></div><div><span>Cash remaining</span><strong>${formatMoney(row.cashRemaining)}</strong></div><div><span>Whish remaining</span><strong>${formatMoney(row.whishRemaining)}</strong></div>${row.hasUnallocated?'<small class="expense-carry-warning">Historical sources are incomplete. Cash and Whish figures are before unresolved allocations; no source was guessed.</small>':''}${row.cashRemaining<0||row.whishRemaining<0?'<small class="expense-carry-warning">One recorded source is negative. Review the original month and source before allocating more spending.</small>':''}</div>`).join(''):'<p class="field-note">No positive unused funding is recorded in earlier months for this business scope.</p>';
    $('#expense-carry-note').textContent='Choose the original funding month when adding an expense. Earlier funding is separate from this month’s bucket; selecting it creates no cash, wallet, Bank or profit transfer.'+(carry.deficits.length?` ${carry.deficits.length} earlier funding bucket${carry.deficits.length===1?' has':'s have'} a negative balance and ${carry.deficits.length===1?'is':'are'} not added to this unused total.`:'');
  }catch(error){$('#expense-carry-total').textContent='—';$('#expense-carry-months').replaceChildren();$('#expense-carry-note').textContent='Earlier funding could not be verified: '+errorMessage(error);}
}
function renderExpenses() {
  const selectedCategory = $("#expense-category-filter").value;
  // Keep fee records in state for profit, audit and funding reconciliation.
  // Fees and linked bandwidth costs have dashboard cards, not expense rows.
  const filtered = state.expenses.filter(expense => !window.ExpenseFunding.isProfitOnlyFee(expense) && !window.ExpenseFunding.isBandwidthCost(expense) && (!selectedCategory || expense.category === selectedCategory));
  const month = localDate().slice(0, 7);
  renderExpenseCarry(month);
  try {
    const funding = window.ExpenseFunding.summary(state.expenses, {month});
    $('#expense-installation-total').textContent = formatMoney(funding.received);
    $('#expense-funding-balance').textContent = formatMoney(funding.remaining);
    $('#expense-month-total').textContent = formatMoney(funding.spent);
    $('#expense-cash-funding').textContent = formatMoney(funding.cashRemaining);
    $('#expense-whish-funding').textContent = formatMoney(funding.whishRemaining);
    const beforeUnknown = funding.hasUnallocated ? ' · Before unallocated spending' : '';
    $('#expense-cash-funding-note').textContent = `${formatMoney(funding.cashReceived)} received − ${formatMoney(funding.cashSpent)} allocated to this funding month${beforeUnknown}. Funding record, not live drawer cash.`;
    $('#expense-whish-funding-note').textContent = `${formatMoney(funding.whishReceived)} received − ${formatMoney(funding.whishSpent)} allocated to this funding month${beforeUnknown}. Funding record, not live wallet balance; fees excluded.`;
    const warnings = [];
    if (funding.unallocatedCount) warnings.push(`${formatMoney(funding.unallocatedSpent)} allocated to this funding month has no recorded Cash / Whish source. The total remaining funding includes it, but the separate Cash and Whish amounts are before this unallocated spending. Older records were not guessed.`);
    if (funding.otherReceived) warnings.push(`${formatMoney(funding.otherReceived)} of funding has another or unrecorded receipt method and is included only in total funding.`);
    $('#expense-funding-warning').textContent = warnings.join(' ');
    $('#expense-funding-warning').classList.toggle('hidden', !warnings.length);
  } catch (error) {
    for (const id of ['expense-installation-total','expense-cash-funding','expense-whish-funding','expense-month-total','expense-funding-balance']) $(`#${id}`).textContent = '—';
    $('#expense-cash-funding-note').textContent = 'Funding totals unavailable until the recorded amounts are verified.';
    $('#expense-whish-funding-note').textContent = 'Funding totals unavailable until the recorded amounts are verified.';
    $('#expense-funding-warning').textContent = `Funding totals could not be calculated: ${errorMessage(error)}`;
    $('#expense-funding-warning').classList.remove('hidden');
  }
  $("#expenses-body").innerHTML = filtered.length
    ? filtered.map((expense) => {
      const marginFunding=expense.sourceType==='product_margin_funding';
      const maintenanceFunding=expense.sourceType==='maintenance_funding';
      const workspaceId = expense.workspaceId || businessWorkspace.id, manual = !["maintenance_funding","product_margin_funding","bandwidth_purchase","purchase_receipt","installation_payment","whish_fee","whish_cashout","whish_receipt_migration","reseller_whish_fee","reseller_collection_fee","optional_whish_fee"].includes(expense.sourceType);
      const attributes = `data-id="${escapeHtml(expense.id)}" data-expense-workspace="${escapeHtml(workspaceId)}"`;
      const feeOnly = ["whish_fee","whish_cashout","whish_receipt_migration","reseller_whish_fee","reseller_collection_fee","optional_whish_fee"].includes(expense.sourceType);
      const sourceNote = maintenanceFunding ? 'Maintenance customer payment · full received amount allocated · original receipt preserved' : marginFunding ? 'Fully paid POS margin · expense budget only · original customer receipt preserved' : expense.sourceType === 'bandwidth_purchase' ? 'Bandwidth cost · linked supplier purchase · payment does not add another expense' : expense.sourceType === 'installation_payment' ? `Money received · ${escapeHtml(expense.paymentMethod)} · covers expenses` : expense.sourceType === "purchase_receipt" ? "Created by a product purchase receipt" : expense.sourceType === "whish_receipt_migration" ? "One-time Whish fee on remaining older wallet funds · original receipts kept" : expense.sourceType === "optional_whish_fee" ? "Optional Whish fee · edit or delete through the original expense or purchase" : feeOnly ? "Automatic Whish fee" : "Manual expense";
      const fundingNote = (maintenanceFunding ? `Received into ${escapeHtml(expense.paymentMethod || expense.fundingMethod)} funding in full · fees separate · no second cash or wallet credit` : marginFunding ? `Allocated to ${escapeHtml(expense.paymentMethod)} funding · no second cash or wallet credit` : feeOnly ? 'Profit only · does not reduce funding' : expense.sourceType === 'installation_payment' ? 'Funding received in full · fees kept separate' : expense.fundingMethod === 'Cash' ? 'Pay from: Cash · funding allocation' : expense.fundingMethod === 'Whish Money' ? `Pay from: Whish wallet${expense.fundingWallet ? ` · ${escapeHtml(expense.fundingWallet.label || expense.fundingWallet.number || 'Saved wallet')}${expense.fundingWallet.number && expense.fundingWallet.number !== expense.fundingWallet.label ? ` · ${escapeHtml(expense.fundingWallet.number)}` : ''}` : ''} · funding allocation` : 'Payment source not recorded · unallocated spending')+((manual||expense.sourceType==='purchase_receipt')?` · Funding month ${escapeHtml(expense.fundingMonth||expense.expenseDate.slice(0,7))}`:'');
      const receivedFunding=maintenanceFunding||expense.sourceType==='installation_payment';
      return `<tr><td>${dateFormatter.format(new Date(`${expense.expenseDate}T12:00:00`))}</td><td>${escapeHtml(expense.workspaceName || expenseBusinessName(workspaceId))}</td><td><span class="status status-ok">${escapeHtml(expense.category)}</span></td><td><div class="user-cell"><strong>${escapeHtml(expense.description)}</strong><span>${sourceNote}${expense.recordedBy ? ` · ${escapeHtml(expense.recordedBy)}` : ""}</span><span>${fundingNote}</span>${expense.deductWhishFee ? `<span>Selected Whish fee: ${formatMoney(expense.whishFee)} · recorded separately · profit only</span>` : ""}${expense.lastEditedBy ? `<span>Edited by ${escapeHtml(expense.lastEditedBy)} · ${escapeHtml(expense.lastEditedAt)}</span>` : ""}</div></td><td class="number"><strong class="${receivedFunding?'installation-received':''}">${receivedFunding?'+':''}${formatMoney(expense.amount)}</strong></td><td><div class="row-actions">${has("expenses.manage") && manual ? `${state.currentUser?.role === "admin" ? `<button class="icon-button edit-expense" ${attributes} aria-label="Edit expense" title="Edit expense">${icon("edit")}</button>` : ""}<button class="icon-button delete delete-expense" ${attributes} aria-label="Delete expense" title="Delete expense">${icon("trash")}</button>` : ""}</div></td></tr>`;
    }).join("")
    : emptyRow(6, selectedCategory ? "No expenses in this category" : "No expenses recorded", selectedCategory ? "Choose another expense category." : "Add a company expense to include it in profit reports.");
}

function refreshExpenseCategorySelectors() {
  const options = state.expenseCategories.map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join("");
  const expenseSelect = $("#expense-category");
  const purchaseSelect = $("#purchase-category");
  const previousExpense = expenseSelect.value;
  const previousPurchase = purchaseSelect.value;
  if (!$("#expense-dialog").open) { expenseSelect.innerHTML = options; if (state.expenseCategories.some(item => item.name === previousExpense)) expenseSelect.value = previousExpense; }
  purchaseSelect.innerHTML = options;
  if (state.expenseCategories.some((item) => item.name === previousPurchase)) purchaseSelect.value = previousPurchase;
  else if (state.expenseCategories.some((item) => item.name === "Product purchases")) purchaseSelect.value = "Product purchases";
  refreshExpenseFilterCategories();
  renderExpenses();
}

function renderExpenseCategoryManager() {
  $("#expense-category-list").innerHTML = state.expenseCategories.length
    ? state.expenseCategories.map((category) => `<div class="category-manager-row"><strong>${escapeHtml(category.name)}</strong><button type="button" class="icon-button delete delete-expense-category" data-id="${category.id}" aria-label="Delete ${escapeHtml(category.name)}" title="Delete category">${icon("trash")}</button></div>`).join("")
    : `<div class="empty-state"><div><strong>No expense categories</strong><p>Add one to record expenses.</p></div></div>`;
}

function renderPurchases() {
  const total = state.purchases.reduce((sum, receipt) => sum + Number(receipt.total), 0);
  $("#purchase-count").textContent = state.purchases.length;
  $("#purchase-total").textContent = formatMoney(total);
  $("#purchases-body").innerHTML = state.purchases.length
    ? state.purchases.map((receipt) => `<tr><td>${dateFormatter.format(new Date(`${receipt.purchaseDate}T12:00:00`))}</td><td><strong>${escapeHtml(receipt.receiptNo)}</strong></td><td>${escapeHtml(receipt.supplier || "—")}</td><td><div class="user-cell"><strong>${receipt.itemCount} product${Number(receipt.itemCount) === 1 ? "" : "s"}</strong><span>${escapeHtml(receipt.itemSummary || "")}</span></div></td><td><span class="status status-ok">${escapeHtml(receipt.category)}</span></td><td>${escapeHtml(receipt.recordedBy || "—")}</td><td class="number"><div class="user-cell"><strong>${formatMoney(receipt.total)}</strong>${receipt.deductWhishFee ? `<span>Whish fee ${formatMoney(receipt.whishFee)} · separate expense</span>` : ""}</div></td><td><div class="row-actions">${!api.warehouse&&has("purchases.manage") ? `<button class="icon-button delete delete-purchase" data-id="${receipt.id}" aria-label="Delete purchase receipt" title="Delete and reverse stock">${icon("trash")}</button>` : ""}</div></td></tr>`).join("")
    : emptyRow(8, "No purchase receipts", api.warehouse?"Receive new stock through Admin Products. Historical receipts remain here.":"Record a supplier receipt to add products to stock.");
}

function renderUsers() {
  $("#user-count").textContent = state.users.length;
  $("#users-body").innerHTML = state.users.map((user,index) => {
    const canEdit=isMainAdmin()||String(state.currentUser?.accountKey||'').startsWith('main:')||!user.originWorkspaceId||user.originWorkspaceId===businessWorkspace.id;
    const self=user.accountKey?user.accountKey===state.currentUser?.accountKey:Number(user.id)===Number(state.currentUser?.id);
    return `<tr><td><div class="user-cell"><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(businessSections.find(s => s.id === user.originWorkspaceId)?.name || "Main office account")}</span></div></td><td>${escapeHtml(user.username)}</td><td><span class="status status-ok">${escapeHtml(roleLabel(user.role))}</span></td><td><span class="status ${user.active ? "status-ok" : "status-out"}">${user.active ? "Active" : "Inactive"}</span></td><td><div class="user-access-tags">${(user.allowedSections || []).map(id => `<span>${escapeHtml([...businessSections,...businessAreas].find(s => s.id === id)?.name || id)}</span>`).join("") || "Main login only"}</div></td><td><div class="row-actions">${canEdit?`<button class="icon-button edit-user" data-index="${index}" aria-label="Edit ${escapeHtml(user.fullName)}" title="Edit user and section access">${icon("edit")}</button>${!self?`<button class="icon-button delete delete-user" data-index="${index}" aria-label="Delete ${escapeHtml(user.fullName)}" title="Delete application login; keep financial history">${icon("trash")}</button>`:''}`:'Main admin only'}</div></td></tr>`;
  }).join("");
}

function renderEmployees() {
  const active = state.employees.filter((employee) => employee.active);
  const present = active.filter((employee) => employee.present);
  $("#attendance-employee-count").textContent = active.length;
  $("#attendance-present-count").textContent = present.length;
  $("#employees-body").innerHTML = state.employees.length
    ? state.employees.map((employee) => {
        const status = !employee.active ? ["Inactive", "status-out"] : employee.present ? ["Present", "status-ok"] : ["Away", "status-low"];
        return `<tr><td><div class="user-cell"><strong>${escapeHtml(employee.fullName)}</strong><span>${escapeHtml(employee.jobTitle)}</span></div></td><td>${escapeHtml(employee.employeeNo)}</td><td><code>${escapeHtml(employee.rfidCard)}</code></td><td><span class="status ${status[1]}">${status[0]}</span></td><td><div class="row-actions">${has("attendance.manage") ? `<button class="icon-button edit-employee" data-id="${employee.id}" aria-label="Edit ${escapeHtml(employee.fullName)}" title="Edit employee">${icon("edit")}</button>` : ""}</div></td></tr>`;
      }).join("")
    : emptyRow(5, "No employees yet", "Add an employee and assign their RFID card.");
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  return `${hours}h ${remaining}m`;
}

function renderAttendance() {
  const today = localDate();
  $("#attendance-today-count").textContent = state.attendance.filter((record) => record.clockIn?.startsWith(today)).length;
  $("#attendance-body").innerHTML = state.attendance.length
    ? state.attendance.map((record) => `<tr><td><div class="user-cell"><strong>${escapeHtml(record.fullName)}</strong><span>${escapeHtml(record.employeeNo)}</span></div></td><td>${dateTimeFormatter.format(new Date(record.clockIn))}</td><td>${record.clockOut ? dateTimeFormatter.format(new Date(record.clockOut)) : `<span class="status status-ok">Working now</span>`}</td><td>${formatDuration(record.durationMinutes)}</td><td><div class="row-actions">${has("attendance.manage") ? `<button class="icon-button edit-attendance" data-id="${record.id}" aria-label="Edit attendance" title="Edit attendance">${icon("edit")}</button><button class="icon-button delete delete-attendance" data-id="${record.id}" aria-label="Delete attendance" title="Delete attendance">${icon("trash")}</button>` : ""}</div></td></tr>`).join("")
    : emptyRow(5, "No attendance records", "Scan an employee RFID card to record arrival.");
}

function renderBundleCatalog() {
  const bundles = state.bundles.filter(bundle => businessWorkspace.kind === "satellite" ? bundle.serviceType === "Satellite" : businessWorkspace.kind === "internet" ? bundle.serviceType === "Internet" : true);
  $("#bundle-catalog").innerHTML = bundles.length
    ? bundles.map((bundle) => `<article class="bundle-card ${bundle.serviceType === "Satellite" ? "satellite" : ""}"><span>${escapeHtml(bundle.serviceType.toUpperCase())}</span><strong>${escapeHtml(bundle.name)}</strong><small>${escapeHtml(bundle.allowance)}</small><b>${formatMoney(bundle.price)}</b>${bundle.cost !== undefined ? `<small class="bundle-cost">Fixed monthly cost: ${formatMoney(bundle.cost)}</small>${bundle.costSource?`<small>${escapeHtml(bundle.costSource)}${bundle.costVerifiedAt?` · verified ${escapeHtml(dateTimeFormatter.format(new Date(bundle.costVerifiedAt)))}`:""}</small>`:""}` : ""}</article>`).join("")
    : `<div class="empty-state" style="grid-column:1/-1"><div><strong>No bundles available</strong><p>Check the connection to the main computer.</p></div></div>`;
}

function updateBillBundleOptions(updateAmount = true) {
  if (businessWorkspace.kind === "reseller") { $("#bill-bundle").innerHTML = ""; $("#bill-months-field").classList.add("hidden");$("#bill-months").value=1;$("#bill-pricing-panel").classList.add('hidden');return; }
  const serviceType = $("#bill-service-type").value;
  $("#bill-months-field").classList.toggle("hidden",businessWorkspace.id!=="fiber-users"||serviceType!=="Internet");
  if(businessWorkspace.id!=="fiber-users"||serviceType!=="Internet")$("#bill-months").value=1;
  const select = $("#bill-bundle");
  const previous = select.value;
  const currentPlanOnly=businessWorkspace.id==='fiber-users'&&serviceType==='Internet'&&portalStatus.ready;
  const verified=portalCustomer?.username===$('#bill-customer-account').value.trim();
  const eligible = state.bundles.filter((bundle) => (serviceType === "Satellite" ? bundle.serviceType === "Satellite" : bundle.serviceType === "Internet")&&(!currentPlanOnly||(verified&&FiberBillPlan.matchPortalPlan(bundle,portalCustomer.plans)?.id===portalCustomer.serviceId)));
  const needsSelection=billBundleNeedsSelection||currentPlanOnly&&!eligible.length;
  select.innerHTML = (needsSelection ? `<option value="" disabled>${currentPlanOnly?'Verify the customer’s current service first':'Choose the billing bundle for this portal plan'}</option>` : "") + eligible.map((bundle) => `<option value="${escapeHtml(bundle.code)}">${escapeHtml(bundle.name)} — ${formatMoney(bundle.price)}</option>`).join("");
  if (eligible.some((bundle) => bundle.code === previous)) select.value = previous;
  if (needsSelection) select.value = "";
  const selected = eligible.find((bundle) => bundle.code === select.value);
  const satellite = state.bundles.find((bundle) => bundle.serviceType === "Satellite");
  const listPrice = Number(selected?.price || 0) + (serviceType === "Internet + Satellite" ? Number(satellite?.price || 0) : 0);
  if ((updateAmount || billAmountAutomatic) && selected) {$("#bill-amount").value = (billRetailQuote()?.suggestedAmount??listPrice*billMonths()).toFixed(2);billAmountAutomatic=true;}
  updateBillBundleNote();
}

function billMonths(){const value=Number($("#bill-months").value);return Number.isSafeInteger(value)&&value>=1&&value<=12?value:1;}
function billFreePolicy(){return businessWorkspace.id==='fiber-users'&&$('#bill-service-type').value==='Internet'?FiberInternetPricing.lateRenewalPolicy(portalCustomer?.billingDate||portalStatus.renewalPolicy?.asOf,portalCustomer?.expiry):null;}
function updateFreeRenewalForm(){
  const policy=billFreePolicy(),free=Boolean(policy?.free);
  $('#bill-free-funding-panel').classList.toggle('hidden',!free);$('#bill-free-funding').disabled=!free||billSaving;
  $('#bill-amount-field').classList.toggle('hidden',free);$('#bill-amount').disabled=free;
  $('#bill-months').disabled=free;$('#bill-months-field').classList.toggle('hidden',free||businessWorkspace.id!=='fiber-users'||$('#bill-service-type').value!=='Internet');if(free)$('#bill-months').value=1;
  $('#bill-bundle').disabled=businessWorkspace.id==='fiber-users'&&$('#bill-service-type').value==='Internet'&&portalStatus.ready||free&&Boolean(portalCustomer);$('#bill-pricing-panel').classList.toggle('hidden',free||!billRetailQuote());
  $('#bill-save-only').classList.toggle('hidden',free);
  $('#bill-portal-pricing-help').classList.toggle('hidden',free);
  const unpaid=$('input[name="bill-payment"][value="Unpaid"]');unpaid.disabled=free;
  if(free&&$('#bill-payment-method').value==='Unpaid')selectPayment('bill-payment','#bill-payment-method','Cash');
  if(free)$('#bill-free-funding-note').textContent=`Main billing date ${policy.asOf}. From the 11th through the 4th: free current-plan service until ${policy.expiry} at ${policy.cutoffTime}. No paid renewal or prorated Internet charge is sent.${portalCustomer?.expiry?.slice(0,10)>=policy.expiry?' This customer already expires on that date or later; no free renewal will be submitted.':''}`;
  if(free)$('#bill-renew-button').innerHTML=`${icon('update')}Confirm free renewal & expense funding`;
  WhishPayments.sync();
}
function billRetailQuote(){
  if(businessWorkspace.id!=='fiber-users'||$("#bill-service-type").value!=='Internet')return null;
  const bundle=state.bundles.find(p=>p.code===$("#bill-bundle").value);
  return bundle?FiberInternetPricing.internetBillPricing(Number(bundle.price),billMonths(),portalCustomer?.billingDate,portalCustomer?.expiry):null;
}
function retailPriceNote(q){return q?`Monthly selling price ${formatMoney(q.monthlyPrice)} · ${q.advance?'Already renewed: additional full month · ':''}${q.remainingDays}/${q.cycleDays} days (${q.advance?q.cycleStart:q.asOf} → ${q.cycleEnd})${q.additionalFullMonths?` + ${q.additionalFullMonths} full cycle(s)`:''} · Suggested customer amount ${formatMoney(q.suggestedAmount)}`:'';}
function billRetailSelection(){const q=billRetailQuote();return q?{policy:q.policy,asOf:q.asOf,automatic:billAmountAutomatic&&Number($("#bill-amount").value)===q.suggestedAmount,...q.advance?{advance:true,expectedExpiry:q.expectedExpiry}:{}}:undefined;}
function renderPortalConfirmation(review){
  const container=$("#portal-confirm-review");container.replaceChildren();
  container.classList.toggle("hidden",!review);
  $("#portal-confirm-title").textContent=review?.title||"Confirm Proradius action";
  $("#portal-confirm-subtitle").textContent=review?.subtitle||"Review the details before submitting this action.";
  $("#portal-confirm-accept").textContent=review?.actionLabel||"Confirm action";
  const symbol=["receipt","update","user-plus","cart","change-plan"].includes(review?.icon)?review.icon:"receipt";
  $("#portal-confirm-icon use").setAttribute("href",`#icon-${symbol}`);
  const details=$("#portal-confirm-details");details.open=!review;details.classList.toggle("plain-confirm-details",!review);
  $("#portal-confirm-details-toggle").classList.toggle("hidden",!review);
  if(!review)return;
  const element=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
  if(review.subject){
    const subject=element("section","confirm-subject");subject.append(element("span","confirm-label","CUSTOMER"),element("strong","confirm-customer-name",review.subject.name||review.subject.username));
    if(review.subject.username)subject.append(element("span","confirm-customer-account",review.subject.username));
    container.append(subject);
  }
  if(review.fields?.length){
    const fields=element("dl","confirm-facts");
    for(const item of review.fields){const row=element("div");row.append(element("dt",null,item.label),element("dd",null,item.value));fields.append(row);}container.append(fields);
  }
  if(review.payments?.length){
    const payments=element("section","confirm-payments");payments.append(element("h3",null,"Payment summary"));
    for(const item of review.payments){const row=element("div",`confirm-payment-row${item.separate?" confirm-payment-separate":""}`),label=element("div"),amount=element("div","confirm-payment-value");
      label.append(element("strong",null,item.label));if(item.note)label.append(element("small",null,item.note));
      amount.append(element("strong",null,item.amount));if(item.method)amount.append(element("small",null,item.method));row.append(label,amount);payments.append(row);}container.append(payments);
  }
  if(review.metrics?.length){const metrics=element("dl","confirm-metrics");for(const item of review.metrics){const row=element("div");row.append(element("dt",null,item.label),element("dd",null,item.value));metrics.append(row);}container.append(metrics);}
  if(review.notice){const notice=element("aside","confirm-notice");notice.append(element("strong",null,review.noticeTitle||"Before you confirm"),element("p",null,review.notice));container.append(notice);}
}
function confirmPortalAction(message,review=null){
  const dialog=$("#portal-confirm-dialog");if(dialog.open)return Promise.resolve(false);
  const previousFocus=document.activeElement;
  renderPortalConfirmation(review);
  $("#portal-confirm-message").textContent=message;dialog.returnValue="";
  return new Promise(resolve=>{dialog.addEventListener("close",()=>{if(previousFocus?.isConnected)previousFocus.focus();resolve(dialog.returnValue==="confirmed");},{once:true});dialog.showModal();$(".portal-confirm-body").scrollTop=0;$("#portal-confirm-cancel").focus();});
}
function confirmAppAction(message,title,actionLabel="Confirm"){
  return confirmPortalAction(message,{title,subtitle:"Review this app action before continuing.",actionLabel,notice:message,noticeTitle:"What will happen"});
}

function updateBillBundleNote() {
  const serviceType = $("#bill-service-type").value;
  const selected = state.bundles.find(bundle => bundle.code === $("#bill-bundle").value);
  const satellite = state.bundles.find(bundle => bundle.serviceType === "Satellite");
  const price = Number(selected?.price || 0) + (serviceType === "Internet + Satellite" ? Number(satellite?.price || 0) : 0);
  let note = selected ? `${selected.allowance}${serviceType === "Internet + Satellite" ? " + Satellite" : ""} · Published price ${formatMoney(price)}` : billBundleNeedsSelection ? "Choose a billing bundle and enter the amount." : "No active bundle available";
  if (businessWorkspace.id === "fiber-users" && portalCustomer?.username === $("#bill-customer-account").value.trim()) {
    const match = FiberBillPlan.matchInternetBundle(portalCustomer.service, state.bundles), target = selectedPortalPlan();
    const plan = portalCustomer.service || "Not supplied by portal";
    note = match && selected?.code === match.code ? `Matched to portal plan ${plan} · ${note}`
      : match ? `Portal plan: ${plan}. · ${note}`
      : `Portal plan: ${plan}. No unique billing bundle matches; ask Admin to check the current service’s billing bundle. · ${note}`;
    if (target) {
      if (target.cost !== undefined) note += target.cost === null ? " · Proradius internal cost unavailable; saving is blocked." : ` · Daily service-option internal cost ${formatMoney(target.cost)} (reference only)`;
      if(target.renewalCost!==undefined)note+=` · Proradius renewal preview cost ${formatMoney(target.renewalCost)} is used for bill profit`;
      if(portalCustomer.renewalQuoteError)note+=' · Renewal preview unavailable: verify again; no daily-cost fallback.';
      if (target.fixedCost !== undefined) note += target.fixedCost === null ? " · fibernetlb2 reference unavailable; saving is blocked." : ` · Fixed monthly reference ${formatMoney(target.fixedCost)}${billMonths()>1&&Number.isFinite(target.renewalCost)?` · Estimated ${billMonths()}-cycle cost ${formatMoney(target.renewalCost+target.fixedCost*(billMonths()-1))}; each cycle is re-quoted and saved separately when renewed`:''}`;
      if (portalCustomer.costVerifiedAt) note += ` · Synced ${dateTimeFormatter.format(new Date(portalCustomer.costVerifiedAt))}`;
      if (portalCustomer.costRefreshError) note += " · Refresh failed; verify again. Save rechecks live costs.";
      if (target.id !== portalCustomer.serviceId) note += " · Use Change service & renew to switch service with one customer payment.";
    } else note += !portalCustomer.plans?.length ? " · Proradius supplied no services for this customer’s owner. Check the reseller’s assigned services before saving." : " · Selected bundle has no unique Proradius plan; saving is blocked.";
  }
  $("#bill-bundle-note").textContent = note;
  const retail=billRetailQuote();$("#bill-pricing-panel").classList.toggle('hidden',!retail);$("#bill-pricing-note").textContent=retail?retailPriceNote(retail)+` · ${billAmountAutomatic?'Automatically calculated.':'Edited customer amount; the suggestion is unchanged.'} Proradius internal cost is separate.`:'';
  updateFreeRenewalForm();
  if(billFreePolicy()?.free)$('#bill-bundle-note').textContent=`Current plan: ${portalCustomer?.service||'Verify customer first'}. Free expiry edit only; no paid renewal quote is charged. Any amount received is separate expense funding.`;
}

function openBundleCostDialog() {
  $("#bundle-cost-list").innerHTML = state.bundles.map((bundle) => `<div class="bundle-cost-row"><div><strong>${escapeHtml(bundle.name)}</strong><span>${escapeHtml(bundle.allowance)} · ${escapeHtml(bundle.serviceType)}</span></div><b>Price ${formatMoney(bundle.price)}</b><label>Fixed monthly cost<input class="bundle-cost-input" data-code="${escapeHtml(bundle.code)}" type="number" min="0" step="0.01" value="${Number(bundle.cost || 0).toFixed(2)}" required /></label></div>`).join("");
  $("#bundle-cost-dialog").showModal();
}

function renderDrawer() {
  if (!state.drawer || isAllBusinessDashboard()) return;
  $("#metric-cash-drawer").textContent = formatMoney(state.drawer.balance);
  $("#metric-cash-today").textContent = `${formatMoney(state.drawer.todayIn)} received in cash today`;
}

function renderDebts() {
  const total = state.debts.reduce((sum, debt) => sum + Number(debt.amount), 0);
  $("#debts-total").textContent = formatMoney(total);
  $("#debts-count").textContent = `${state.debts.filter(item=>Number(item.remainingAmount ?? item.amount)>0).length} outstanding · ${state.debts.length} displayed`;
  $("#debts-body").innerHTML = state.debts.length
    ? state.debts.map((debt) => `<tr><td><span class="status status-debt">${escapeHtml(debt.kind === "sale" ? "POS sale" : debt.kind === "telecom" ? "Mobile / Ogero" : "Internet bill")}</span></td><td><strong>${escapeHtml(debt.referenceNo)}</strong></td><td><div class="user-cell"><strong>${escapeHtml(debt.customerName || "Unnamed customer")}</strong><span>${escapeHtml([debt.customerAccount, debt.phone].filter(Boolean).join(" · ") || "No contact details")}</span></div></td><td>${dateTimeFormatter.format(new Date(debt.createdAt))}</td><td>${escapeHtml(debt.cashierName || "—")}</td><td class="number">${formatMoney(debt.originalAmount ?? debt.amount)}</td><td class="number paid-amount">${formatMoney(debt.paidAmount ?? 0)}</td><td class="number"><strong>${formatMoney(debt.remainingAmount ?? debt.amount)}</strong></td><td><div class="row-actions"><button class="icon-button debt-history" data-id="${debt.id}" data-kind="${escapeHtml(debt.kind)}" title="Payment history" aria-label="Payment history">${icon("clock")}</button>${has("debts.manage") && Number(debt.remainingAmount ?? debt.amount)>0 ? `<button class="button button-secondary settle-debt" data-id="${debt.id}" data-kind="${escapeHtml(debt.kind)}">${icon("check")}Collect</button>` : ""}</div></td></tr>`).join("")
    : emptyRow(9, "No debts to show", "Unpaid sales and bills appear automatically. Enable Include settled to see completed debt accounts.");
}

function renderBills() {
  const search = $("#bill-search").value.trim().toLowerCase();
  const filtered = state.bills.filter((bill) => `${bill.receiptNo} ${bill.customerAccount} ${bill.customerName} ${bill.phone} ${bill.serviceType} ${bill.bundleName} ${bill.bundleDetails} ${bill.billingPeriod} ${bill.paymentMethod} ${bill.paymentStatus}`.toLowerCase().includes(search));
  const total = state.bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
  const internet = state.bills.filter((bill) => bill.serviceType.includes("Internet")).reduce((sum, bill) => sum + Number(bill.amount), 0);
  const satellite = state.bills.filter((bill) => bill.serviceType.includes("Satellite")).reduce((sum, bill) => sum + Number(bill.amount), 0);
  $("#bills-period-total").textContent = formatMoney(total);
  $("#bills-period-count").textContent = `${state.bills.length} bill record${state.bills.length === 1 ? "" : "s"}`;
  $("#bills-internet-total").textContent = formatMoney(internet);
  $("#bills-satellite-total").textContent = formatMoney(satellite);
  $("#bills-body").innerHTML = filtered.length
    ? filtered.map((bill) => `<tr><td><strong>${escapeHtml(bill.receiptNo)}</strong><small>Recorded by ${escapeHtml(bill.cashierName || "—")}</small>${bill.renewal?.requestedBy ? `<small>Renewed by ${escapeHtml(bill.renewal.requestedBy)}</small>` : ""}</td><td>${dateTimeFormatter.format(new Date(bill.paidAt))}</td><td><div class="user-cell"><strong>${escapeHtml(bill.customerName)}</strong><span>${escapeHtml(bill.customerAccount)}${bill.phone ? ` · ${escapeHtml(bill.phone)}` : ""}</span></div></td><td><span class="status status-ok">${escapeHtml(bill.serviceType)}</span>${billRenewalBadge(bill)}</td><td><div class="user-cell"><strong>${escapeHtml(bill.bundleName || "Custom / legacy")}</strong><span>${escapeHtml(bill.bundleDetails || "No saved bundle")}</span></div></td><td>${escapeHtml(bill.billingPeriod)}</td><td>${paymentBadge(bill.paymentMethod, bill.paymentStatus)}${Number(bill.amount)<0?"<small>Refund</small>":""}</td><td class="number"><strong>${formatMoney(bill.amount)}</strong></td><td><div class="row-actions"><button class="icon-button print-bill" data-id="${bill.id}" aria-label="Print ${escapeHtml(bill.receiptNo)}" title="Print receipt">${icon("print")}</button>${window.BillPaymentCorrections?.button(bill)||''}${internetBillActions(bill)}${has("bills.manage") ? `<button class="icon-button delete delete-bill" data-id="${bill.id}" aria-label="Delete bill payment" title="Delete bill payment">${icon("trash")}</button>` : ""}</div></td></tr>`).join("")
    : emptyRow(9, search ? "No matching payments" : "No bill payments in this period");
}

function renderBillsPrintReport() {
  const start = $("#bills-start").value;
  const end = $("#bills-end").value;
  const paid = state.bills.reduce((sum, bill) => sum + Number(bill.paidAmount ?? (bill.paymentStatus === "paid" ? bill.amount : 0)), 0);
  const unpaid = state.bills.reduce((sum, bill) => sum + Number(bill.remainingAmount ?? (bill.paymentStatus === "unpaid" ? bill.amount : 0)), 0);
  $("#bills-report-range").textContent = `${dateFormatter.format(new Date(`${start}T12:00:00`))} – ${dateFormatter.format(new Date(`${end}T12:00:00`))}`;
  $("#bills-report-count").textContent = state.bills.length;
  $("#bills-report-paid").textContent = formatMoney(paid);
  $("#bills-report-unpaid").textContent = formatMoney(unpaid);
  $("#bills-report-total").textContent = formatMoney(paid + unpaid);
  $("#bills-report-generated").textContent = `Printed ${dateTimeFormatter.format(new Date())}`;
  $("#bills-report-body").innerHTML = state.bills.length
    ? state.bills.map((bill) => `<tr><td>${escapeHtml(new Date(bill.paidAt).toLocaleDateString("en-CA"))}</td><td><strong>${escapeHtml(bill.receiptNo)}</strong><small>Recorded by ${escapeHtml(bill.cashierName || "—")}</small>${bill.renewal?.requestedBy ? `<small>Renewed by ${escapeHtml(bill.renewal.requestedBy)}</small>` : ""}</td><td><strong>${escapeHtml(bill.customerName)}</strong><small>${escapeHtml(bill.customerAccount)}</small></td><td>${escapeHtml(bill.phone || "—")}</td><td><strong>${escapeHtml(bill.serviceType)}</strong><small>${escapeHtml(bill.bundleName || "Custom / legacy")}</small></td><td>${escapeHtml(bill.billingPeriod)}</td><td>${escapeHtml(Number(bill.amount)<0?`REFUND · ${bill.paymentMethod}`:bill.paymentStatus === "partial" ? `PART PAID ${formatMoney(bill.paidAmount)} · DUE ${formatMoney(bill.remainingAmount)}` : bill.paymentStatus === "unpaid" ? "UNPAID / DEBT" : bill.paymentMethod)}</td><td class="number"><strong>${formatMoney(bill.amount)}</strong></td></tr>`).join("")
    : `<tr><td colspan="8" class="report-empty">No FibernetLB bills in this date range.</td></tr>`;
}

async function openBillsPrintReport() {
  await loadBills();
  renderBillsPrintReport();
  $("#bill-report-dialog").showModal();
}

function telecomVoucherImage(item) {
  const imageName = item.provider === "Alfa" ? "voucher-alfa.png" : "voucher-mtc.png";
  return `<span class="telecom-voucher-art"><img src="${imageName}" alt="" /><strong>${formatMoney(item.faceValue)}</strong></span>`;
}

function renderTelecomCatalog() {
  const providers = ["Alfa", "touch / MTC"];
  $("#telecom-catalog").innerHTML = providers.map((provider) => {
    const items = state.telecomCatalog.filter((item) => item.provider === provider);
    return items.map((item) => `<article class="bundle-card telecom-catalog-card ${provider === "Alfa" ? "alfa" : "touch"}">${telecomVoucherImage(item)}<span>${escapeHtml(provider === "Alfa" ? "ALFA" : "MTC (TOUCH)")}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.details)}</small><b>${formatMoney(item.price)}</b>${item.cost !== undefined ? `<small class="bundle-cost">Cost ${formatMoney(item.cost)}</small>` : ""}${has("telecom.create") || has("telecom.manage") ? `<button class="button button-secondary select-telecom-voucher" data-provider="${escapeHtml(provider)}" data-code="${escapeHtml(item.code)}">Record recharge</button>` : ""}</article>`).join("");
  }).join("") || `<div class="empty-state" style="grid-column:1/-1"><div><strong>No refill cards available</strong><p>Check the connection to the main computer.</p></div></div>`;
}

function renderTelecomOptions() {
  const provider = $("#telecom-provider").value;
  const eligible = state.telecomCatalog.filter((item) => item.provider === provider);
  $("#telecom-refill-choices").innerHTML = eligible.map((item) => `<label class="telecom-option-card"><input type="radio" name="telecom-refill-card" value="${escapeHtml(item.code)}" ${item.code === $("#telecom-item-code").value ? "checked" : ""} />${telecomVoucherImage(item)}<span class="telecom-option-copy"><strong>${formatMoney(item.price)}</strong><small>${formatMoney(item.faceValue)} recharge value</small></span></label>`).join("") || `<p class="field-note">No recharge cards available for this provider.</p>`;
  $("#telecom-validity-choices").innerHTML = [30, 60, 90, 180, 360].map((days) => `<label class="telecom-option-card"><input type="radio" name="telecom-validity-card" value="${days}" ${String(days) === $("#telecom-validity-days").value ? "checked" : ""} /><span class="telecom-validity-art"><img src="validity-mtc.png" alt="" /><strong>${days}<small>days</small></strong></span><span class="telecom-option-copy"><strong>${days} days</strong>${days === 360 ? "<small>Maximum line validity</small>" : ""}</span></label>`).join("");
}

function updateTelecomForm(updateAmount = true) {
  const provider = $("#telecom-provider").value;
  $$(`input[name='telecom-provider-card']`).forEach((radio) => { radio.checked = radio.value === provider; });
  const isOgero = provider === "Ogero";
  const kindSelect = $("#telecom-kind");
  const previousKind = isOgero ? "Bill" : kindSelect.value;
  const services = provider === "touch / MTC"
    ? [["Refill", "Recharge card"], ["Airtime", "Airtime USD"], ["Validity", "Validity time"], ["Bill", "Mobile bill payment"]]
    : isOgero ? [["Bill", "Ogero bill payment"]] : [["Refill", "Recharge card"], ["Airtime", "Airtime USD"], ["Bill", "Mobile bill payment"]];
  kindSelect.innerHTML = services.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  kindSelect.value = services.some(([value]) => value === previousKind) ? previousKind : services[0][0];
  kindSelect.disabled = isOgero;
  const serviceIcons = { Refill: "wallet", Airtime: "banknotes", Validity: "clock", Bill: "receipt" };
  $("#telecom-service-choices").innerHTML = services.map(([value, label]) => `<label class="telecom-service-choice"><input type="radio" name="telecom-service" value="${value}" ${value === kindSelect.value ? "checked" : ""} />${icon(serviceIcons[value])}<span>${label}</span></label>`).join("");
  const transactionType = kindSelect.value;
  const isBill = transactionType === "Bill";
  const isAirtime = transactionType === "Airtime";
  const isValidity = transactionType === "Validity";
  const isRefill = transactionType === "Refill";
  $("#telecom-refill-field").classList.toggle("hidden", !isRefill);
  $("#telecom-period-field").classList.toggle("hidden", !isBill);
  $("#telecom-credit-field").classList.toggle("hidden", !isAirtime);
  $("#telecom-validity-field").classList.toggle("hidden", !isValidity);
  $("#telecom-item-code").disabled = !isRefill;
  $("#telecom-period").disabled = !isBill;
  $("#telecom-credit-amount").disabled = !isAirtime;
  $("#telecom-validity-days").disabled = !isValidity;
  $$("input[name='telecom-refill-card']").forEach((input) => { input.disabled = !isRefill; });
  $$("input[name='telecom-validity-card']").forEach((input) => { input.disabled = !isValidity; });
  $("#telecom-period").required = isBill;
  $("#telecom-credit-amount").required = isAirtime;
  $("#telecom-amount").readOnly = isRefill;
  $("#telecom-amount-label").textContent = isRefill ? "Admin selling price (USD)" : isBill ? "Bill amount (USD)" : "Price charged (USD)";
  $("#telecom-phone-label").textContent = isOgero ? "Related landline number" : "Mobile number";
  $("#telecom-phone").placeholder = isOgero ? "01 234 567" : "03 123 456";
  if (!isRefill) {
    if (updateAmount) { $("#telecom-amount").value = ""; $("#telecom-credit-amount").value = ""; }
    renderTelecomOptions();
    return;
  }
  const select = $("#telecom-item-code");
  const previous = select.value;
  const eligible = state.telecomCatalog.filter((item) => item.provider === provider);
  select.innerHTML = eligible.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)} — ${formatMoney(item.price)}</option>`).join("");
  if (eligible.some((item) => item.code === previous)) select.value = previous;
  const selected = eligible.find((item) => item.code === select.value) || eligible[0];
  $("#telecom-refill-note").textContent = selected ? `${selected.details} · Customer price ${formatMoney(selected.price)}` : "No refill values available";
  $("#telecom-amount").value = selected ? Number(selected.price).toFixed(2) : "";
  renderTelecomOptions();
}

function updateTelecomPayment() {
  const method = $("input[name='telecom-payment']:checked")?.value || "Cash";
  $("#telecom-payment-method").value = method;
  $("#telecom-payment-note").textContent = method === "Cash" ? "Cash payments are added to the cash drawer." : method === "Whish Money" ? "The full customer payment settles the bill and enters the selected wallet. Its 1% fee reduces net profit only, not the wallet balance. Cash-out has no additional fee." : "This payment will be added to Outstanding Debts.";
}

function openTelecomDialog(provider = "Alfa", itemCode = "") {
  $("#telecom-form").reset();
  $("#telecom-provider").value = provider;
  $("#telecom-kind").value = provider === "Ogero" ? "Bill" : "Refill";
  $("#telecom-period").value = localDate().slice(0, 7);
  selectPayment("telecom-payment", "#telecom-payment-method", "Cash");
  updateTelecomPayment();
  updateTelecomForm(true);
  if (itemCode) { $("#telecom-item-code").value = itemCode; updateTelecomForm(true); }
  $("#telecom-dialog").showModal();
  $("#telecom-dialog").scrollTop = 0;
}

function openTelecomPricingDialog() {
  $("#telecom-pricing-list").innerHTML = state.telecomCatalog.map((item) => `<div class="bundle-cost-row telecom-pricing-row"><div><strong>${escapeHtml(item.provider)} · ${escapeHtml(item.name)}</strong><span>${escapeHtml(item.details)} · Operator value ${formatMoney(item.faceValue)}</span></div><label>Selling price<input class="telecom-price-input" data-code="${escapeHtml(item.code)}" type="number" min="0.01" step="0.01" value="${Number(item.price).toFixed(2)}" required /></label><label>Internal cost<input class="telecom-cost-input" data-code="${escapeHtml(item.code)}" type="number" min="0" step="0.01" value="${Number(item.cost || 0).toFixed(2)}" required /></label></div>`).join("");
  $("#telecom-pricing-dialog").showModal();
}

function renderTelecomPayments() {
  const search = $("#telecom-search").value.trim().toLowerCase();
  const filtered = state.telecomPayments.filter((item) => `${item.receiptNo} ${item.provider} ${item.phone} ${item.customerName} ${item.itemName} ${item.itemDetails} ${item.billingPeriod} ${item.paymentMethod} ${item.paymentStatus}`.toLowerCase().includes(search));
  const totalFor = (provider) => state.telecomPayments.filter((item) => item.provider === provider).reduce((sum, item) => sum + Number(item.amount), 0);
  const total = state.telecomPayments.reduce((sum, item) => sum + Number(item.amount), 0);
  $("#telecom-period-total").textContent = formatMoney(total);
  $("#telecom-period-count").textContent = `${state.telecomPayments.length} payment${state.telecomPayments.length === 1 ? "" : "s"}`;
  $("#telecom-alfa-total").textContent = formatMoney(totalFor("Alfa"));
  $("#telecom-touch-total").textContent = formatMoney(totalFor("touch / MTC"));
  $("#telecom-ogero-total").textContent = formatMoney(totalFor("Ogero"));
  $("#telecom-body").innerHTML = filtered.length
    ? filtered.map((item) => `<tr><td><strong>${escapeHtml(item.receiptNo)}</strong></td><td>${dateTimeFormatter.format(new Date(item.paidAt))}</td><td><span class="status status-ok">${escapeHtml(item.provider)}</span></td><td><div class="user-cell"><strong>${escapeHtml(item.phone)}</strong><span>${escapeHtml(item.customerName || "Customer")}</span></div></td><td><div class="user-cell"><strong>${escapeHtml(item.itemName)}</strong><span>${escapeHtml(item.itemDetails || item.transactionType)}</span></div></td><td>${escapeHtml(item.billingPeriod || "—")}</td><td>${paymentBadge(item.paymentMethod, item.paymentStatus)}</td><td class="number"><strong>${formatMoney(item.amount)}</strong></td><td><div class="row-actions"><button class="icon-button print-telecom" data-id="${item.id}" aria-label="Print ${escapeHtml(item.receiptNo)}" title="Print receipt">${icon("print")}</button>${has("telecom.manage") ? `<button class="icon-button delete delete-telecom" data-id="${item.id}" aria-label="Delete telecom payment" title="Delete payment">${icon("trash")}</button>` : ""}</div></td></tr>`).join("")
    : emptyRow(9, search ? "No matching telecom payments" : "No mobile or Ogero payments in this period");
}

async function loadReport() {
  const start = $("#report-start").value;
  const end = $("#report-end").value;
  const posCategory = $("#report-pos-category").value;
  if (!start || !end || start > end) return showToast("Choose a valid report date range.", "error");
  const scope=nativeDataScope(),report=await api.reports.summary(start,end,posCategory,reportScope());if(scope!==nativeDataScope()||!has('reports.view'))return;
  $("#report-renewals-panel").classList.toggle("hidden", !(report.internetRenewals || []).length);
  $("#report-renewals-body").innerHTML = (report.internetRenewals || []).map(bill => `<tr><td>${escapeHtml(bill.workspaceName || businessWorkspace.name)}<small>${dateTimeFormatter.format(new Date(bill.paidAt))}</small></td><td><strong>${escapeHtml(bill.customerAccount)}</strong><small>${escapeHtml(bill.customerName)} · ${escapeHtml(bill.receiptNo)}</small></td><td>${escapeHtml(bill.bundleName)}<small>${Number(bill.renewal.completedMonths || 0)} / ${Number(bill.renewalMonths || 1)} cycle(s) confirmed</small></td><td>${escapeHtml(bill.cashierName || "—")}</td><td><strong>${escapeHtml(bill.renewal.requestedBy || "Not renewed in app")}</strong><small>${escapeHtml(renewalLabel(bill.renewal.state))}</small></td><td class="number">${formatMoney(bill.amount)}</td></tr>`).join("");
  $("#report-sections-panel").classList.toggle("hidden", !report.sections?.length);
  $("#report-sections-body").innerHTML = (report.sections || []).map(item => `<tr><td><div class="section-name">${icon(item.icon)}<strong>${escapeHtml(item.name)}</strong></div></td><td class="number">${formatMoney(item.revenue)}</td><td class="number">${formatMoney(item.expenses)}</td><td class="number">${formatMoney(item.netProfit)}</td><td class="number">${formatMoney(item.outstandingDebt)}</td><td class="number">${formatMoney(item.cashBalance)}</td><td class="number">${formatMoney(item.cashReceived ?? 0)}</td><td class="number">${formatMoney(item.whishReceived ?? 0)}</td><td class="number">${formatMoney(item.collectionsTotal ?? 0)}</td></tr>`).join("");
  $("#report-filter-note").textContent = posCategory ? `POS category: ${posCategory}. All LBP sales are converted to USD at 1 USD = ${Number(report.exchangeRate).toLocaleString("en-US")} LBP. FibernetLB, Mobile & Ogero, and expenses remain included.` : `All POS product categories · Report currency USD · 1 USD = ${Number(report.exchangeRate).toLocaleString("en-US")} LBP`;
  $("#report-revenue").textContent = formatMoney(report.revenue);
  const incompleteWholesale=report.wholesaleAttributionUnavailable===true;
  if(incompleteWholesale)$("#report-filter-note").textContent+=' · Native employee transactions only. '+(report.profitUnavailableReason||'Warehouse wholesale profit is unallocated. Select All employees for verified totals.');
  if (report.unknownPrintingUnits) $("#report-filter-note").textContent += ` · ${Number(report.unknownPrintingUnits)} printing unit(s), ${formatMoney(report.unknownPrintingRevenue)} revenue, have unknown costs. Profit is before those unmeasured costs.`;
  for(const [id,field] of [["report-cash-paid","cashPaid"],["report-whish-paid","whishPaid"],["report-period-debt","periodDebt"],["report-payment-total","paymentTotal"],["report-cash-received","cashReceived"],["report-whish-received","whishReceived"],["report-collections-total","collectionsTotal"],["report-cash-refunded","cashRefunded"],["report-whish-refunded","whishRefunded"],["report-refunds-total","refundsTotal"]]) $(`#${id}`).textContent=formatMoney(report[field] ?? 0);
  $("#report-refunds-body").innerHTML=(report.refundPayments||[]).map(p=>`<tr><td>${escapeHtml(p.workspaceName||businessWorkspace.name)}</td><td>${dateTimeFormatter.format(new Date(p.receivedAt))}</td><td>${escapeHtml(p.referenceNo)}</td><td><strong>${escapeHtml(p.customerName||"Customer")}</strong><small>${escapeHtml(p.customerAccount)}</small></td><td>${paymentBadge(p.paymentMethod)}<small>Refund</small></td><td class="number">${formatMoney(p.amount)}</td><td>${escapeHtml(p.cashierName)}</td></tr>`).join("")||emptyRow(7,"No customer refunds in these dates");
  $("#report-legacy-payments").classList.toggle("hidden",!report.otherPaid && !report.otherReceived);
  $("#report-legacy-payments").textContent=`Legacy payment methods: ${formatMoney(report.otherPaid || 0)} on period invoices; ${formatMoney(report.otherReceived || 0)} collected in selected dates (included in totals).`;
  $("#report-debt-accounts-body").innerHTML=(report.debtAccounts || []).map(d=>`<tr><td>${escapeHtml(d.workspaceName || businessWorkspace.name)}</td><td>${escapeHtml(d.kind)}</td><td>${escapeHtml(d.referenceNo)}</td><td><div class="user-cell"><strong>${escapeHtml(d.customerName || "Customer")}</strong><span>${escapeHtml(d.customerAccount)}</span></div></td><td class="number">${formatMoney(d.originalAmount)}</td><td class="number paid-amount">${formatMoney(d.paidAmount)}</td><td class="number">${formatMoney(d.remainingAmount)}</td><td>${paymentBadge(d.paymentMethod,d.paymentStatus)}</td></tr>`).join("") || emptyRow(8,"No debt accounts to show");
  $("#report-debt-payments-body").innerHTML=(report.debtPayments || []).map(p=>`<tr><td>${escapeHtml(p.workspaceName || businessWorkspace.name)}</td><td>${dateTimeFormatter.format(new Date(p.receivedAt))}</td><td>${escapeHtml(p.referenceNo)}</td><td>${escapeHtml(p.customerName || p.customerAccount || "Customer")}</td><td>${paymentBadge(p.paymentMethod)}</td><td class="number">${formatMoney(p.amount)}</td><td class="number">${formatMoney(p.remainingAfter)}</td><td>${escapeHtml(p.cashierName)}</td></tr>`).join("") || emptyRow(8,"No debt payments received in these dates");
  $("#report-pos-revenue").textContent = formatMoney(report.posRevenue);
  $("#report-service-revenue").textContent = formatMoney(report.serviceRevenue);
  $("#report-telecom-revenue").textContent = formatMoney(report.telecomRevenue);
  $("#report-outstanding-debt").textContent = formatMoney(report.outstandingDebt);
  $("#report-debt-count").textContent = `${report.debtCount} unpaid record${Number(report.debtCount) === 1 ? "" : "s"}`;
  $("#report-cost").textContent = formatMoney(report.costOfGoods);
  $("#report-expenses").textContent = formatMoney(report.expenses);
  $('#report-installation-panel').classList.toggle('hidden',!(report.installationPayments||[]).length);
  $('#report-installation-body').innerHTML=(report.installationPayments||[]).map(p=>`<tr><td>${escapeHtml(p.receiptNo)}<br><small>${escapeHtml(p.paidAt)}</small></td><td>${escapeHtml(p.customerName)}<br>${escapeHtml(p.customerAccount)}<br><small>${p.purpose==='free_renewal'?'Free-renewal expense funding':'Installation payment'} · ${escapeHtml(p.cashierName)}</small></td><td>${paymentBadge(p.paymentMethod)}</td><td class="number"><strong>${formatMoney(p.amount)}</strong></td></tr>`).join('');
  $("#report-net-profit").textContent = incompleteWholesale?'—':formatMoney(report.netProfit);
  WhishPayments.renderReport(report);
  $("#report-profit-parts-body").innerHTML=(report.profitParts||[]).map(part=>`<tr><td>${escapeHtml(part.label)}</td><td class="number">${formatMoney(part.revenue)}</td><td class="number">${formatMoney(part.cost)}</td><td class="number"><strong>${formatMoney(part.profit)}</strong></td></tr>`).join("")||emptyRow(4,"No profit breakdown available");
  $("#report-profit-parts-total").textContent=incompleteWholesale?'—':formatMoney(report.netProfit);
  $("#report-sale-count").textContent = `${report.saleCount} sale${Number(report.saleCount) === 1 ? "" : "s"}`;
  $("#report-bill-count").textContent = `${report.billCount} bill record${Number(report.billCount) === 1 ? "" : "s"}`;
  $("#report-telecom-count").textContent = `${report.telecomCount} payment${Number(report.telecomCount) === 1 ? "" : "s"}`;
  $("#report-transaction-count").textContent = `${Number(report.saleCount) + Number(report.billCount) + Number(report.telecomCount)+(report.installationPayments||[]).length} transactions`;
  $("#report-gross-profit").textContent = incompleteWholesale?`${formatMoney(report.grossProfit)} native gross profit · total profit unavailable`:`${formatMoney(report.grossProfit)} gross profit`;
  const maximum = Math.max(...report.daily.map((day) => Number(day.revenue)), 1);
  $("#sales-chart").innerHTML = report.daily.length ? report.daily.map((day) => `<div class="bar-column"><div class="bar-track"><div class="bar" style="height:${Math.max((Number(day.revenue) / maximum) * 100, 2)}%" data-value="${formatMoney(day.revenue)}"></div></div><small>${new Date(`${day.day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div>`).join("") : `<div class="empty-state" style="width:100%"><div><strong>No sales in this period</strong><p>Choose another date range or complete a sale.</p></div></div>`;
  $("#report-sales-body").innerHTML = report.recentSales.length ? report.recentSales.map((sale) => `<tr><td><div class="user-cell"><strong>${escapeHtml(sale.invoiceNo)}</strong><span>${escapeHtml([sale.workspaceName, sale.categories || "Uncategorized"].filter(Boolean).join(" · "))}</span></div></td><td>${dateTimeFormatter.format(new Date(sale.createdAt))}</td><td>${escapeHtml(sale.cashierName || "—")}</td><td>${paymentBadge(sale.paymentMethod, sale.paymentStatus)}</td><td class="number">${formatMoney(sale.subtotal)}</td><td class="number">${formatMoney(sale.profit)}</td><td>${reportReceiptAction(sale)}</td></tr>`).join("") : emptyRow(7, "No sales in this period");
}

function switchView(view,options={}) {
  if(view==='bank'&&(!isMainAdmin()||!api.bank))return;
  if(view!=='bank')window.Bank?.suspend?.();
  window.AdminMoneyTransfers?.suspend?.();
  if(view==='fixed-monthly'&&(!isMainAdmin()||!api.fixedMonthly))return;
  if(view==='company-debts'&&(!isMainAdmin()||!api.companyDebts))return;
  if(view==='ledger'&&!has('ledger.manage'))return;
  if(view==="backups"&&!has("backups.manage"))return;
  if (view === "bills" && !has("bills.view") && !has("bills.create") && !has("bills.manage")) return;
  if (view === "telecom" && !has("telecom.view") && !has("telecom.create") && !has("telecom.manage")) return;
  const permissions = {ledger:['ledger.manage'], "change-plan":["plans.manage"],dashboard:["dashboard.view"], pos:["sales.create"], products:["products.read"], purchases:["purchases.view","purchases.manage"], expenses:["expenses.view","expenses.manage"], attendance:["attendance.clock","attendance.view","attendance.manage"], reports:["reports.view"], users:["users.manage"], debts:["debts.view"] };
  if (permissions[view] && !permissions[view].some(has)) return;
  const titles = { dashboard: "Dashboard", pos: "Point of Sale", products: "Products", purchases: "Purchases", expenses: "Expenses", attendance: "Employee Attendance", bills: "FibernetLB Bills", telecom: "Mobile & Ogero", debts: "Outstanding Debts", reports: "Reports", users: "Users" };
  state.currentView = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  $$(".nav-item").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === view));
  $("#page-title").textContent = view==='bank'?'Bank':view==='company-debts'?'Company debts':view==='fixed-monthly'?'Fixed monthly payments':view==="change-plan"?"Change Plan":titles[view];
  if(view==='purchases'&&isMainAdmin()&&api.stockPurchases)$('#page-title').textContent='Purchase products';
  if(options.deferLoad)return;
  if(['products','pos'].includes(view)&&has('products.read'))loadProducts().catch(error=>showToast(errorMessage(error),'error'));
  let officeOpen;
  if(view==='fixed-monthly')officeOpen=options.billId?window.FixedMonthlyPayments?.openBill(options.billId):window.FixedMonthlyPayments?.open();
  if(view==='company-debts')officeOpen=options.debtId?window.CompanyDebts?.openDebt(options.debtId):window.CompanyDebts?.open();
  if(view==='bank')officeOpen=window.Bank?.open();
  officeOpen?.catch(error=>showToast(errorMessage(error),'error'));
  if(view==="backups"){$("#page-title").textContent="Backups";window.BackupView?.load().catch(error=>showToast(errorMessage(error),"error"));}
  if(view==='ledger'){$('#page-title').textContent='Monthly ledger';window.FinanceDashboard?.loadLedger().catch(error=>showToast(errorMessage(error),'error'));}
  if(view==="change-plan")loadChangePlanView().catch(error=>showToast(errorMessage(error),"error"));
  if (view === "bills") $("#page-title").textContent = businessWorkspace.kind === "reseller" ? "Reseller Bills" : businessWorkspace.kind === "internet" ? "FIBER net lb Bills" : "Customer payments";
  if (view === "pos") { state.posCategory = null; $("#pos-search").value = ""; renderCatalog(); }
  if (view === "dashboard") loadDashboard().catch((error) => showToast(errorMessage(error), "error"));
  if (view === "reports") loadReportCategories().then(loadReport).catch((error) => showToast(errorMessage(error), "error"));
  if (view === "expenses") Promise.all([loadExpenseCategories(),loadExpenses()]).catch((error) => showToast(errorMessage(error), "error"));
  if (view === "purchases") Promise.all([loadExpenseCategories(), loadPurchases()]).catch((error) => showToast(errorMessage(error), "error"));
  if (view === "users") loadUsers().catch((error) => showToast(errorMessage(error), "error"));
  if (view === "attendance") {
    if (has("attendance.view") || has("attendance.manage")) Promise.all([loadEmployees(), loadAttendance()]).catch((error) => showToast(errorMessage(error), "error"));
    if (has("attendance.clock")) setTimeout(() => $("#rfid-scan-input").focus(), 80);
  }
  if (view === "bills") Promise.all([loadBundles(), has("bills.view") ? loadBills() : Promise.resolve()]).catch((error) => showToast(errorMessage(error), "error"));
  if(view==='bills'&&!api.warehouse&&has('customers.manage')&&has('products.read'))loadProducts().catch(error=>showToast(errorMessage(error),'error'));
  if(view==='bills'&&businessWorkspace.id==='fiber-users'&&(has('bills.create')||has('bills.manage')))loadPortalStatus().catch(error=>showToast(errorMessage(error),'error'));
  if(view==="bills"&&has("topup.manage"))loadPortalOperations("topup").catch(error=>showToast(errorMessage(error),"error"));
  if (view === "telecom") Promise.all([loadTelecomCatalog(), has("telecom.view") ? loadTelecomPayments() : Promise.resolve()]).catch((error) => showToast(errorMessage(error), "error"));
  if (view === "debts") loadDebts().catch((error) => showToast(errorMessage(error), "error"));
  return officeOpen;
}

function normalizedPrintPriceTable(value) {
  const source = value && typeof value === "object" ? value : DEFAULT_PRINT_PRICE_TABLE;
  return { ...Object.fromEntries(PRINT_SIZES.map((size) => [size, Object.fromEntries(PRINT_SERVICES.map(({ key }) => [key, Math.max(0, Math.round(Number(source?.[size]?.[key] ?? DEFAULT_PRINT_PRICE_TABLE[size][key]) || 0))]))])), custom: PrintingPricing.normalizeCustom(source.custom) };
}

function fillPrintingPriceTable(value) {
  const table = normalizedPrintPriceTable(value);
  $$(".printing-matrix-input").forEach((input) => { input.value = table[input.dataset.size][input.dataset.service]; });
  renderCustomPrintingTypes(table.custom);
}

function readCustomPrintingTypes() {
  return $$(".custom-printing-row").map(row => ({ key: row.dataset.key, name: row.querySelector(".custom-printing-name").value.trim(), price: Number(row.querySelector(".custom-printing-price").value) }));
}

function renderCustomPrintingTypes(items) {
  const admin = state.currentUser?.role === "admin";
  $("#add-printing-type").classList.toggle("hidden", !admin);
  $("#custom-printing-types").innerHTML = items.map(item => `<div class="custom-printing-row" data-key="${escapeHtml(item.key)}"><label>Paper / service name<input class="custom-printing-name" maxlength="80" required value="${escapeHtml(item.name)}" ${admin ? "" : "disabled"} placeholder="e.g. ID Photo" /></label><label>Unit selling price (LBP)<input class="custom-printing-price" type="number" min="0" max="1000000000000" step="1" required value="${Number(item.price) || 0}" ${admin ? "" : "disabled"} /></label><span class="field-note">Non-stock · Cost unknown</span>${admin ? `<button type="button" class="icon-button delete remove-printing-type" title="Remove type" aria-label="Remove printing type">${icon("trash")}</button>` : ""}</div>`).join("");
}

function readPrintingPriceTable() {
  const table = Object.fromEntries(PRINT_SIZES.map((size) => [size, {}]));
  $$(".printing-matrix-input").forEach((input) => { table[input.dataset.size][input.dataset.service] = Math.max(0, Math.round(Number(input.value) || 0)); });
  table.custom = readCustomPrintingTypes();
  return table;
}

function syncPrintingBasePrice() {
  if ($("#product-category").value !== "Printing") return;
  const a4BwLbp = readPrintingPriceTable().A4.bw;
  $("#product-price").value = $("#product-currency").value === "LBP" ? a4BwLbp : Math.round((a4BwLbp / USD_TO_LBP + Number.EPSILON) * 100) / 100;
  updatePricePreview();
}

function openProductDialog(product = null) {
  if(api.warehouse&&businessWorkspace.id==='main')return;
  if (!has('products.manage') || (isMainCatalogAdmin()&&(!adminInventory.loaded||adminInventory.productBusy))) return;
  adminInventory.productToken++;
  $$('#product-form input,#product-form select,#product-form button').forEach(control=>{control.disabled=false;});
  const source=product?.workspaceId || (state.currentView==='pos'?adminInventory.source:$("#product-business-filter").value);
  $("#product-business").innerHTML='<option value="">Select business</option>'+adminInventory.workspaces.map(workspace=>`<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`).join('');
  $("#product-business").value=catalogWorkspace(source)?source:"";
  $("#product-business").disabled=Boolean(product)||!isMainCatalogAdmin();
  $("#product-business").required=isMainCatalogAdmin();
  $("#product-dialog").dataset.productWorkspace=product?.workspaceId||"";
  $("#product-dialog").dataset.productKey=product?productKey(product):"";
  configureStudioProductCategory(product?.category);
  $("#product-form").reset(); $("#product-id").value = product?.id ?? ""; $("#product-dialog-title").textContent = product ? "Edit product" : "Add product"; $("#product-name").value = product?.name ?? ""; $("#product-sku").value = product?.sku ?? ""; $("#product-category").value = product?.category ?? "Router"; $("#product-currency").value = product?.currency ?? "USD"; $("#product-currency").dataset.previous = product?.currency ?? "USD"; $("#product-cost").value = product?.cost ?? 0; $("#product-price").value = product?.price ?? 0; $("#product-markup").value = product?.markup ?? 0; $("#product-quantity").value = product?.quantity ?? 0; $("#product-reorder").value = product?.reorderLevel ?? 5; fillPrintingPriceTable(product?.printPriceTable); $("#product-barcode").value = product?.barcodes?.[0] ?? ""; $("#product-additional-barcodes").value = product?.barcodes?.slice(1).join(", ") ?? "";
  // reset() also resets the required owning-business selector.
  $("#product-business").value=catalogWorkspace(source)?source:"";
  configureStudioProductCategory(product?.category);
  $("#product-category").value=product?.category||(api.warehouse?"Maintenance":"Router");
  $("#generate-barcode").disabled=isMainCatalogAdmin()&&!catalogWorkspace(productFormWorkspace());
  updateProductCurrency(false); updatePricePreview(); updateBarcodePreview(); updateProductInventoryMode(); $("#product-dialog").showModal(); setTimeout(() => $("#product-name").focus(), 50);
}

function openUserDialog(user = null) {
  $("#user-form").reset(); $("#user-id").value = user?.id ?? ""; $("#user-dialog-title").textContent = user ? "Edit user" : "Add user"; $("#user-full-name").value = user?.fullName ?? ""; $("#user-username").value = user?.username ?? ""; $("#user-role").value = user?.role ?? "cashier"; $("#user-active").checked = user?.active ?? true; $("#user-password").required = !user; $("#password-note").textContent = user ? "Leave blank to keep current password" : "Minimum 8 characters"; $("#user-dialog").showModal(); $("#user-full-name").focus();
  $("#user-account-key").value = user?.accountKey || "";
  $("#user-origin").value = user?.originWorkspaceId || businessWorkspace.id;
  const businessOwned = user?.originWorkspaceId && user.originWorkspaceId !== "main";
  for (const id of ["user-full-name","user-username","user-role","user-password","user-active"]) $(`#${id}`).disabled = false;
  $("#user-access-note").textContent = (user?.roleReviewRequired?"Conflicting old roles: business access is paused until a Main administrator saves the intended global role. Create another Admin before demoting the last Main Admin. ":"")+(isMainAdmin() ? `Edit this application account and choose its business access. Changes apply to every assigned business.${businessOwned?' Main-office access requires an account created in Main.':''}` : "Business access is assigned by the Main administrator. Changing a linked account's profile, role, password or active status applies across its assigned businesses.");
  const chosen = user?.allowedSections || (user ? accessibleSections() : []);
  const features=window.StaffCapabilities.effective(user?.featurePermissions||{});
  $('#user-feature-permissions').innerHTML=window.StaffCapabilities.catalog.map(item=>`<label class="section-access-choice staff-feature-choice"><input type="checkbox" value="${item.permission}" ${features[item.permission]?'checked':''} /><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span></label>`).join('');
  $("#user-section-access").innerHTML = [...businessSections.filter(s => s.id !== "main"),...businessAreas].map(item => `<label class="section-access-choice" data-color="${item.color}"><input type="checkbox" value="${item.id}" ${chosen.includes(item.id) ? "checked" : ""} ${!isMainAdmin() || (businessOwned && item.kind === "area") ? "disabled" : ""} />${icon(item.icon)}<span>${escapeHtml(item.name)}</span></label>`).join("");
  updateUserAccessRole();
}

function updateUserAccessRole() {
  $('#user-feature-fieldset').classList.toggle('hidden',!['cashier','support'].includes($('#user-role').value));
  if (!isMainAdmin()) return;
  const mainOwned=$("#user-origin").value==='main';
  const role = $("#user-role").value;
  $$("#user-section-access input").forEach(input => {
    input.disabled = (mainOwned&&role === "admin") || (!mainOwned&&input.value.startsWith('main-')) || (role === "attendance_operator" && (!mainOwned||input.value !== "main-attendance"));
    if (role === "admin"&&mainOwned) input.checked = true;
    if (role === "attendance_operator") input.checked = mainOwned&&input.value === "main-attendance";
  });
}

function openDeleteUserDialog(user) {
  if(!user)return;
  $('#user-delete-form').reset();
  $('#user-delete-key').value=user.accountKey||String(user.id);
  $('#user-delete-name').textContent=`${user.fullName} (${user.username})`;
  $('#user-delete-confirmation').dataset.username=user.username;
  $('#user-delete-confirmation').placeholder=user.username;
  $('#user-delete-submit').disabled=true;
  $('#user-delete-error').textContent='';
  $('#user-delete-dialog').showModal();
  setTimeout(()=>$('#user-delete-confirmation').focus(),50);
}

function openEmployeeDialog(employee = null) {
  $("#employee-form").reset();
  $("#employee-id").value = employee?.id ?? "";
  $("#employee-dialog-title").textContent = employee ? "Edit employee" : "Add employee";
  $("#employee-number").value = employee?.employeeNo ?? "";
  $("#employee-name").value = employee?.fullName ?? "";
  $("#employee-job-title").value = employee?.jobTitle ?? "";
  $("#employee-rfid").value = employee?.rfidCard ?? "";
  $("#employee-active").checked = employee?.active ?? true;
  $("#employee-dialog").showModal();
  setTimeout(() => $(employee ? "#employee-name" : "#employee-number").focus(), 50);
}

function openAttendanceDialog(record) {
  $("#attendance-id").value = record.id;
  $("#attendance-clock-in").value = String(record.clockIn ?? "").slice(0, 16);
  $("#attendance-clock-out").value = String(record.clockOut ?? "").slice(0, 16);
  $("#attendance-dialog").showModal();
}

function renewalLabel(state) { return ({ not_requested: "Not renewed", free:"Free service · expense funding separate", created:"Activated on account creation", checking: "Verifying customer", processing: "Renewing — do not repeat", succeeded: "Internet renewed", failed: "Not renewed — retry available", unknown: "Check portal — outcome uncertain",archived:"Archived test bill — audit only" })[state] || "Not renewed"; }
let changeCustomer=null,changeQuote=null,changeResults=[],changeVersion=0,changeBusy=false,changeRequestId=null;
let portalHandoffBusy=false;
const changeRenewWorkflow={version:0,identity:'',customer:null,reseller:'',quote:null,record:null,requestId:null,busy:false,error:'',paymentReviewKey:''};
const CHANGE_RENEW_PHASES=new Set(['change_pending','change_unknown','change_confirmed','awaiting_payment','payment_prepared','renewal_pending','renewal_unknown','renewal_failed','completed','change_failed']);
function canChangeRenew(){return portalWorkflowCurrent(portalWorkflowIdentity(),'plans.manage')&&(has('bills.create')||has('bills.manage'))&&Boolean(api.bills.quoteChangeRenew&&api.bills.changeRenewStatus);}
function changeRenewCurrent(version){return version===changeRenewWorkflow.version&&portalWorkflowCurrent(changeRenewWorkflow.identity,'plans.manage')&&(has('bills.create')||has('bills.manage'))&&$('#change-renew-dialog').open;}
function resetChangeRenewWorkflow(){
  changeRenewWorkflow.version++;
  Object.assign(changeRenewWorkflow,{identity:'',customer:null,reseller:'',quote:null,record:null,requestId:null,busy:false,error:'',paymentReviewKey:''});
  if($('#change-renew-dialog')?.open)$('#change-renew-dialog').close();
  $('#change-renew-form')?.reset();
  for(const id of ['change-renew-customer','change-renew-status','change-renew-change-summary','change-renew-policy','change-renew-estimate','change-renew-payment-summary','change-renew-provider-cost','change-renew-recovery-note','change-renew-change-charge','change-renew-renewal-charge','change-renew-total'])if($('#'+id))$('#'+id).textContent='';
  if($('#change-renew-target'))$('#change-renew-target').innerHTML='<option value="">Choose a different service</option>';
}
function changeRenewMoney(value){return Number.isFinite(value)&&Math.abs(value)<=1000000&&Math.abs(value*100-Math.round(value*100))<0.000001;}
function acceptChangeRenewRecord(record){
  const flow=changeRenewWorkflow;
  if(!record||record.requestId!==flow.requestId||record.username!==flow.customer?.username||!CHANGE_RENEW_PHASES.has(record.phase))throw Error('The saved service-change request could not be verified. Check its exact request reference before continuing.');
  if(flow.quote&&(record.expectedId!==flow.quote.expectedId||record.targetId!==flow.quote.targetId))throw Error('The saved request does not match the reviewed service change.');
  if(record.phase==='awaiting_payment'&&(!record.token||!Number.isFinite(Date.parse(record.validUntil))||!changeRenewMoney(record.changeCustomerAmount)||!changeRenewMoney(record.renewalCustomerAmount)||!changeRenewMoney(record.totalToCollect)||Math.round(record.totalToCollect*100)!==Math.round(record.changeCustomerAmount*100)+Math.round(record.renewalCustomerAmount*100)))throw Error('The full customer charge could not be verified. Refresh the saved request before taking payment.');
  if(record.bill&&(record.bill.customerAccount!==record.username||!Number.isSafeInteger(record.bill.id)||record.bill.id<=0))throw Error('The saved customer receipt could not be verified.');
  flow.record=record;flow.error='';
}
function renderChangeRenew(){
  const flow=changeRenewWorkflow,record=flow.record,quote=flow.quote,phase=record?.phase,ready=phase==='awaiting_payment',fresh=ready&&Date.parse(record.validUntil)>Date.now();
  $('#change-renew-customer').textContent=flow.customer?`${flow.customer.name||flow.customer.username} · ${flow.customer.username}${record?` · Request ${record.requestId}`:` · Current service: ${flow.customer.service}`}`:'';
  const messages={change_pending:'The saved service change is being checked or submitted. Wait and check this request; do not send a replacement or collect payment.',change_unknown:'Service-change outcome is uncertain. Do not submit a replacement or collect the payment yet.',change_confirmed:'Service change is confirmed. Continue this saved request to obtain a fresh renewal quote.',awaiting_payment:fresh?'New service confirmed. Review the fresh full charge below, then collect and confirm one payment.':'The payment quote expired. Refresh this saved request and review the new total before confirming.',payment_prepared:'The payment has already been prepared. Continue the saved request to recover its exact receipt; do not take payment again.',renewal_pending:'Payment is recorded. Only the remaining unconfirmed renewal can continue; the service change will not repeat.',renewal_unknown:'Payment is recorded, but the renewal outcome needs review. Do not repeat it. Use its renewal history.',renewal_failed:'Payment is recorded. The renewal did not complete; review and explicitly continue its remaining renewal.',completed:'Service change, one customer payment and renewal are recorded.',change_failed:'The service change was not applied. No combined customer payment was recorded. Review the saved outcome before starting again.'};
  const instruction=phase?messages[phase]:'Choose the new service, then review the server’s service-change quote.',genericUnknown='Portal outcome is uncertain. Check Proradius transactions; no second submission or local payment was made.';
  let detail=['change_unknown','change_failed'].includes(phase)&&typeof record.message==='string'?record.message:'';
  if(detail.startsWith(genericUnknown))detail=detail.slice(genericUnknown.length);
  detail=detail.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim().slice(0,1000);
  $('#change-renew-status').textContent=flow.error||instruction+(detail&&detail!==instruction?` ${detail}`:'');
  $('#change-renew-selection').classList.toggle('hidden',Boolean(flow.requestId));
  $('#change-renew-first-review').classList.toggle('hidden',!quote||Boolean(flow.requestId));
  $('#change-renew-payment').classList.toggle('hidden',!ready||Boolean(flow.error));
  $('#change-renew-recovery').classList.toggle('hidden',!flow.requestId);
  if(quote&&!flow.requestId){
    $('#change-renew-change-summary').textContent=`${quote.beforeName} → ${quote.targetName}${Number.isFinite(quote.changeCost)?` · Proradius service-change cost/credit ${formatMoney(quote.changeCost)}`:''}`;
    $('#change-renew-policy').textContent=`Beirut date ${quote.policyDate} · ${quote.policyVersion===2?(quote.zeroChargeWindow?'No extra change charge for the closing period before renewing.':quote.coverageReason==='manual_review'?'Review the customer adjustment: paid-cycle coverage could not be verified.':quote.calendarWindow?'The adjustment for already covered cycles is retained; only the eligible closing-period portion is waived.':'Normal service-change customer pricing applies.'):(quote.zeroChargeWindow?'Dates 1–5: service-change customer charge is $0.':'From the 6th: normal service-change customer pricing applies.')} Renewal customer pricing is separate.`;
    const amount=$('#change-renew-change-amount');amount.readOnly=!quote.changeAmountRequired||quote.zeroChargeWindow;amount.required=Boolean(quote.changeAmountRequired);if(amount.readOnly)amount.value=Number(quote.changeCustomerAmount||0).toFixed(2);
    $('#change-renew-change-amount-note').textContent=quote.changeAmountRequired?'Automatic service-change pricing is unavailable. Enter the agreed service-change charge or refund before continuing.':'This quoted service-change charge is carried into the single combined payment.';
    $('#change-renew-estimate').textContent=(Number.isFinite(quote.renewalCustomerAmount)?`Renewal customer charge ${formatMoney(quote.renewalCustomerAmount)}${Number.isFinite(quote.totalToCollect)?` · Full customer charge ${formatMoney(quote.totalToCollect)}`:''}. Target retail pricing is verified; the provider’s renewal cost is still quoted after the service change.`:'The full amount collected will be filled after the service changes and its live renewal quote is verified.')+(quote.policyVersion===2&&['paid_current_period','paid_current_period_and_refills','closing_period_with_paid_refills'].includes(quote.coverageReason)?' This workflow adds a new renewal. Use Change Plan if you only want to adjust the service for an already renewed cycle.':'');
  }
  if(ready){
    const reviewKey=JSON.stringify([record.requestId,record.token,record.totalToCollect]);if(reviewKey!==flow.paymentReviewKey){flow.paymentReviewKey=reviewKey;$('#change-renew-ack').checked=false;}
    $('#change-renew-payment-summary').textContent=`${record.targetName} · ${record.renewalMonths} renewal month${record.renewalMonths===1?'':'s'} · Quote valid until ${dateTimeFormatter.format(new Date(record.validUntil))}. A refreshed total needs your review and confirmation.`;
    $('#change-renew-change-charge').textContent=formatMoney(record.changeCustomerAmount);$('#change-renew-renewal-charge').textContent=formatMoney(record.renewalCustomerAmount);$('#change-renew-total').textContent=formatMoney(record.totalToCollect);$('#change-renew-amount').value=record.totalToCollect.toFixed(2);
    $('#change-renew-provider-cost').textContent=[Number.isFinite(record.changeCost)?`Proradius change cost/credit ${formatMoney(record.changeCost)}`:'',Number.isFinite(record.renewalCost)?`Fresh renewal cost ${formatMoney(record.renewalCost)}`:''].filter(Boolean).join(' · ');
  }
  $('#change-renew-recovery-note').textContent=record?.bill?`${record.bill.receiptNo}: one payment already recorded. Continue only this saved request; no extra cash or Whish credit is created.`:flow.requestId?`Keep request ${flow.requestId}. Check this request after any lost response; never create a replacement to guess the outcome.`:'';
  $('#change-renew-resume').classList.toggle('hidden',!['change_confirmed','awaiting_payment','payment_prepared','renewal_pending','renewal_failed'].includes(phase));
  $('#change-renew-resume').textContent=record?.canFinalize?'Finalize saved receipt':ready?'Refresh payment quote':['renewal_pending','renewal_failed'].includes(phase)?'Continue remaining renewal':'Continue saved request';
  $('#change-renew-review').classList.toggle('hidden',phase!=='change_unknown'||state.currentUser?.role!=='admin');
  $('#change-renew-receipt').classList.toggle('hidden',!record?.bill);
  for(const control of $$('#change-renew-form button,#change-renew-form input,#change-renew-form select'))control.disabled=flow.busy;
  $('#change-renew-target').disabled=flow.busy||Boolean(flow.requestId);
  $('#change-renew-change-amount').disabled=flow.busy||Boolean(flow.requestId);
  $('#change-renew-confirm').disabled=flow.busy||!fresh||Boolean(flow.error)||!$('#change-renew-ack').checked;
  $('#change-renew-quote').disabled=flow.busy||!$('#change-renew-target').value;
  WhishPayments.sync();
}
async function runChangeRenew(action){
  const flow=changeRenewWorkflow,version=flow.version;if(flow.busy||!changeRenewCurrent(version))return;
  flow.busy=true;flow.error='';renderChangeRenew();
  try{const result=await action();if(!changeRenewCurrent(version))return;acceptChangeRenewRecord(result);}
  catch(error){if(changeRenewCurrent(version)){flow.error=errorMessage(error);showToast(flow.error,'error');}}
  finally{if(changeRenewCurrent(version)){flow.busy=false;renderChangeRenew();void loadChangeRenewPending();}}
}
async function openChangeRenewFromBill(){
  if(portalHandoffBusy||billSaving||portalSelecting||changeBusy||!canChangeRenew())return;
  const customer=portalCustomer;if(!customer||customer.username!==$('#bill-customer-account').value.trim()||customer.blocked)throw Error('Verify an active customer before changing service and renewing.');
  const reseller=$('#portal-reseller-search').value.trim(),months=billMonths(),period=$('#bill-period').value;
  resetChangeRenewWorkflow();Object.assign(changeRenewWorkflow,{identity:portalWorkflowIdentity(),customer,reseller,renewalMonths:months});
  $('#change-renew-target').innerHTML='<option value="">Choose a different service</option>'+(customer.plans||[]).filter(plan=>plan.id!==customer.serviceId).map(plan=>`<option value="${Number(plan.id)}">${escapeHtml(plan.name)}</option>`).join('');
  $('#change-renew-period').value=period||localDate().slice(0,7);$('#bill-dialog').close();$('#change-renew-dialog').showModal();renderChangeRenew();
}
async function loadChangeRenewPending(){
  const panel=$('#change-renew-pending-panel');if(!panel)return;
  const identity=portalWorkflowIdentity();if(!canChangeRenew()){panel.classList.add('hidden');$('#change-renew-pending-list').replaceChildren();return;}
  try{const result=await api.bills.changeRenewStatus({});if(identity!==portalWorkflowIdentity()||!canChangeRenew())return;
    if(!Array.isArray(result?.pending))throw Error('Pending service-change requests could not be verified.');
    $('#change-renew-pending-list').innerHTML=result.pending.map(row=>`<div class="portal-customer-choice"><span><strong>${escapeHtml(row.customerName||row.username)}</strong><small>${escapeHtml(row.username)} · ${escapeHtml(row.targetName)} · ${escapeHtml(row.phase)} · ${escapeHtml(row.requestId)}</small></span><button class="button button-secondary" type="button" data-change-renew-request="${escapeHtml(row.requestId)}">Review saved request</button></div>`).join('');panel.classList.toggle('hidden',!result.pending.length);
  }catch(error){if(identity===portalWorkflowIdentity()&&canChangeRenew()){$('#change-renew-pending-list').textContent=errorMessage(error);panel.classList.remove('hidden');}}
}
async function openSavedChangeRenew(requestId){
  if(!canChangeRenew()||changeRenewWorkflow.busy)return;
  resetChangeRenewWorkflow();Object.assign(changeRenewWorkflow,{identity:portalWorkflowIdentity(),requestId});
  const version=changeRenewWorkflow.version;$('#change-renew-dialog').showModal();changeRenewWorkflow.busy=true;renderChangeRenew();
  try{const record=await api.bills.changeRenewStatus({requestId});if(!changeRenewCurrent(version))return;changeRenewWorkflow.customer={username:record.username,name:record.customerName};acceptChangeRenewRecord(record);$('#change-renew-period').value=localDate().slice(0,7);}
  catch(error){if(changeRenewCurrent(version))changeRenewWorkflow.error=errorMessage(error);}
  finally{if(changeRenewCurrent(version)){changeRenewWorkflow.busy=false;renderChangeRenew();}}
}
let topupRequestId=null,topupBusy=false,topupChoices=[],portalOperations={change:[],topup:[]};
function clearChangeRenewal(){
  resetChangeRenewWorkflow();
  $('#change-renew-pending-panel')?.classList.add('hidden');$('#change-renew-pending-list')?.replaceChildren();
}
async function openChangePlanFromBill(){
  const identity=portalWorkflowIdentity(),customer=portalCustomer,target=selectedPortalPlan(),reseller=$('#portal-reseller-search').value.trim();
  if(portalHandoffBusy||billSaving||portalSelecting||changeBusy)return;
  if(!portalWorkflowCurrent(identity,'plans.manage')||!customer||customer.username!==$('#bill-customer-account').value.trim())throw Error('Verify the customer and check your Change Plan access first.');
  portalHandoffBusy=true;
  try{
    $('#bill-dialog').close();invalidateChange(true);switchView('change-plan',{deferLoad:true});
    $('#change-reseller').value=reseller;$('#change-search').value=customer.username;
    await loadChangePlanView();
    if(!portalWorkflowCurrent(identity,'plans.manage')||state.currentView!=='change-plan')return;
    await selectChangeCustomer(customer.username);
    if(!portalWorkflowCurrent(identity,'plans.manage')||state.currentView!=='change-plan')return;
    if(target&&target.id!==changeCustomer?.serviceId&&Array.from($('#change-target').options).some(option=>option.value===String(target.id))){$('#change-target').value=String(target.id);invalidateChange();}
    $('#change-target').focus();
  }finally{portalHandoffBusy=false;}
}
function invalidateChange(customerToo=false) {
  changeVersion++;changeQuote=null;changeRequestId=crypto.randomUUID();
  if(customerToo){changeCustomer=null;changeResults=[];$("#change-search-results").innerHTML="";$("#change-target").innerHTML='<option value="">Select a customer first</option>';$("#change-target").disabled=true;$("#change-customer-summary").textContent="Select a customer to see the current service and expiry.";}
  $("#change-quote-panel").classList.add("hidden");$("#change-amount").value="";$("#change-amount").readOnly=false;$("#change-amount").disabled=true;$("#change-apply").disabled=true;$("#change-calculate").disabled=!changeCustomer||!$("#change-target").value||changeBusy;
}
async function loadChangePlanView() {
  const identity=portalWorkflowIdentity();if(!portalWorkflowCurrent(identity,'plans.manage'))return;
  if(!$("#change-period").value)$("#change-period").value=localDate().slice(0,7);
  const list=await api.portal.resellers();
  if(!portalWorkflowCurrent(identity,'plans.manage'))return;
  $("#change-reseller-options").innerHTML=list.map(item=>`<option value="${escapeHtml(item.username)}">${escapeHtml(item.name||item.username)}</option>`).join("");
  await loadPortalOperations("change");
}
async function searchChangeCustomers() {
  const identity=portalWorkflowIdentity();if(changeBusy||!portalWorkflowCurrent(identity,'plans.manage')||state.currentView!=='change-plan')return;
  invalidateChange(true);
  const version=changeVersion,term=$("#change-search").value.trim(),reseller=$("#change-reseller").value.trim();
  const current=()=>version===changeVersion&&portalWorkflowCurrent(identity,'plans.manage')&&state.currentView==='change-plan'&&term===$('#change-search').value.trim()&&reseller===$('#change-reseller').value.trim();
  $('#change-search-results').textContent='Searching portal customers…';
  let result;try{result=await api.portal.search({term,reseller});}catch(error){if(current()){$('#change-search-results').textContent=errorMessage(error);throw error;}return;}
  if(!current())return;
  changeResults=result.customers;
  $("#change-search-results").innerHTML=result.customers.map((item,index)=>`<button type="button" class="portal-customer-choice" data-change-customer="${index}"><span><strong>${escapeHtml(item.name||item.username)}</strong><small>${escapeHtml(item.username)} · ${escapeHtml(item.phone||"No phone")}</small></span>${icon("arrow-right")}</button>`).join("")||(result.truncated?'<p class="field-note">No verified customers in the first results. Narrow your search.</p>':'<p class="field-note">No matching customers. Try an exact username.</p>');
  if(result.truncated)$('#change-search-results').insertAdjacentHTML('beforeend','<p class="field-note">More customers may match. Enter a longer name, phone number or exact username to narrow this reseller search.</p>');
}
async function selectChangeCustomer(username) {
  const identity=portalWorkflowIdentity();if(!portalWorkflowCurrent(identity,'plans.manage'))return;
  invalidateChange(true);const version=changeVersion,reseller=$("#change-reseller").value.trim();
  const customer=await api.portal.lookup({username,reseller});
  if(version!==changeVersion||!portalWorkflowCurrent(identity,'plans.manage')||state.currentView!=='change-plan'||reseller!==$('#change-reseller').value.trim())return;
  changeCustomer=customer;
  $("#change-customer-summary").textContent=`${customer.name||customer.username} · ${customer.username} · ${customer.phone||"No phone"} · Current plan: ${customer.service} · Expiry: ${customer.expiry}${customer.blocked?" · BLOCKED":""}`;
  $("#change-search-results").innerHTML="";
  $("#change-target").innerHTML='<option value="">Choose a different service</option>'+ (customer.plans||[]).filter(plan=>plan.id!==customer.serviceId&&(plan.cost===undefined||Number.isFinite(plan.cost))).map(plan=>`<option value="${plan.id}">${escapeHtml(plan.name)}${Number.isFinite(plan.cost)?` · internal cost ${formatMoney(plan.cost)}`:''}</option>`).join("");
  $("#change-target").disabled=customer.blocked;await loadBundles();
}
async function calculateChange() {
  const identity=portalWorkflowIdentity();if(changeBusy||!changeCustomer||!portalWorkflowCurrent(identity,'plans.manage'))return;
  invalidateChange();const version=changeVersion,reseller=$('#change-reseller').value.trim();$("#change-calculate").disabled=true;
  const quote=await api.portal.quoteChange({username:changeCustomer.username,expectedId:changeCustomer.serviceId,targetId:Number($("#change-target").value),reseller});
  if(version!==changeVersion||!portalWorkflowCurrent(identity,'plans.manage')||state.currentView!=='change-plan'||reseller!==$('#change-reseller').value.trim())return;
  changeQuote=quote;
  const financial=Number.isFinite(quote.total);
  $('#change-quote-panel .eyebrow').textContent=financial?'PRORADIUS INTERNAL COST · NOT THE CUSTOMER PRICE':'CUSTOMER SERVICE ADJUSTMENT';
  $("#change-quote-total").textContent=financial?(quote.total<0?`Your Proradius internal credit: ${formatMoney(-quote.total)}`:`Your Proradius internal cost: ${formatMoney(quote.total)}`):'Confirm the customer charge or refund below';
  const costParts=[Number.isFinite(quote.currentPeriodPrice)?`Current period ${formatMoney(quote.currentPeriodPrice)}`:'',Number.isSafeInteger(quote.pendingRefills)?`${quote.pendingRefills} pending refills${Number.isFinite(quote.pendingRefillsPrice)?` (${formatMoney(quote.pendingRefillsPrice)})`:''}`:'',Number.isFinite(quote.freetimePrice)?`Freetime ${formatMoney(quote.freetimePrice)}`:''].filter(Boolean);
  $("#change-quote-details").textContent=`${quote.beforeName} → ${quote.targetName}${costParts.length?' · '+costParts.join(' · '):''} · Expiry ${quote.expiry||"Not supplied"}. Quote valid for 2 minutes; it is rechecked before submission.`;
  $('#change-cost-preview').parentElement.classList.toggle('hidden',!financial);$('#change-profit-preview').parentElement.classList.toggle('hidden',!financial);
  const pricing=quote.retailPricing;
  $("#change-pricing-note").textContent=pricing?.zeroChargeWindow?`Beirut date ${pricing.policyDate}: ${pricing.policyVersion===2?'no extra change charge for the closing period before the next renewal.':'dates 1–5 have a $0 service-change customer charge.'} Proradius’s service-change cost is separate; renewal customer pricing is unchanged.`:pricing?.available?`${pricing.policyDate?`Beirut date ${pricing.policyDate} · ${pricing.policyVersion===2&&pricing.calendarWindow?'The customer adjustment for already covered cycles is retained.':'Normal service-change pricing.'} `:''}${Number.isFinite(pricing.beforePrice)&&Number.isFinite(pricing.targetPrice)?`Monthly selling prices: ${formatMoney(pricing.beforePrice)} → ${formatMoney(pricing.targetPrice)}. `:''}${Number.isFinite(pricing.currentFraction)?`Current period share: ${(pricing.currentFraction*100).toFixed(2)}% · ${pricing.pendingRefills} future full cycle(s). `:''}${Number.isFinite(pricing.waivedFraction)&&pricing.waivedFraction>0?`Closing-period share waived: ${(pricing.waivedFraction*100).toFixed(2)}%. `:''}${pricing.customerCredit>0?`Calculated customer refund: ${formatMoney(pricing.customerCredit)}. Confirm only money actually returned. The negative adjustment reduces revenue and reverses the corresponding profit.`:"The customer upgrade price is separate from your portal cost."}`:pricing?.reason||"Automatic retail pricing is unavailable. Enter the actual signed customer amount; do not use portal cost as the selling price.";
  $("#change-quote-panel").classList.remove("hidden");$("#change-amount").value=pricing?.available?pricing.customerAmount.toFixed(2):"";$("#change-amount").readOnly=Boolean(pricing?.zeroChargeWindow);$("#change-amount").disabled=false;$("#change-calculate").disabled=false;updateChangeProfitPreview();
}
function updateChangeProfitPreview(){
  if(!changeQuote)return;
  const raw=$("#change-amount").value.trim(),amount=Number(raw),refund=amount<0,financial=Number.isFinite(changeQuote.total),refundAllowed=(changeQuote.refundAllowed||changeQuote.total<0)&&(!changeQuote.retailPricing?.available||changeQuote.retailPricing.retailAdjustment<0);
  const unpaidOption=Array.from($("#change-method").options).find(option=>option.value==="Unpaid");
  unpaidOption.disabled=refund;if(refund&&$("#change-method").value==="Unpaid")$("#change-method").value="Cash";
  const valid=raw!==""&&Number.isFinite(amount)&&Math.abs(amount)<=1000000&&Math.abs(amount*100-Math.round(amount*100))<0.000001&&(!refund||refundAllowed);
  const whish=WhishPayments.preview(amount,$('#change-method').value),profit=valid&&financial?Math.round((amount-changeQuote.total-(whish?.fee||0)+Number.EPSILON)*100)/100:null;
  $("#change-cost-preview").textContent=financial?formatMoney(changeQuote.total):'';
  $("#change-customer-preview").textContent=valid?formatMoney(amount):"Enter amount";
  $("#change-profit-preview").textContent=valid&&financial?formatMoney(profit):"—";
  $("#change-margin-warning").textContent=(!valid?"Enter a valid customer charge, or a negative refund for a quoted downgrade credit.":!financial?(refund?`Refund ${formatMoney(-amount)} by ${$('#change-method').value}. Record only money actually returned; no Whish transfer is sent by the app.`:'Record the amount the customer pays; unpaid charges remain debts.'):refund?`Refund ${formatMoney(-amount)} by ${$("#change-method").value}. Revenue adjustment ${formatMoney(amount)} minus portal cost adjustment ${formatMoney(changeQuote.total)} = ${formatMoney(profit)} profit adjustment. Record only money actually returned; no Whish transfer is sent by the app.`:profit===0?"Zero profit after the service cost and payment fee.":profit<0?"Below cost: this customer amount records a loss before company expenses.":"Profit uses this customer charge minus the portal cost and any receipt fee; unpaid charges remain debts.")+(valid&&whish?` ${whish.note}`:'');
  $("#change-apply").disabled=!valid||changeBusy;
  $("#change-apply").textContent=refund?"Confirm change & record refund":"Confirm change & record payment";
}
async function loadFreeRenewalHistory(){
  if(businessWorkspace.id!=='fiber-users'||!api.portal?.operations)return;
  let panel=$('#free-renewal-history-panel');if(!panel){panel=document.createElement('article');panel.id='free-renewal-history-panel';panel.className='panel';panel.innerHTML='<div class="panel-heading"><div><p class="eyebrow">FREE SERVICE · EXPENSE FUNDING</p><h2>Free renewal history</h2><p class="subtext">Expiry edits only, not paid renewals. Uncertain outcomes require administrator review before retrying.</p></div><button type="button" class="button button-secondary refresh-portal-operations" data-kind="free">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Time / staff</th><th>Customer</th><th>Free expiry</th><th>Expense funding</th><th>Status</th><th></th></tr></thead><tbody id="free-operations-body"></tbody></table></div>';$('#view-bills').append(panel);}
  await loadPortalOperations('free');
}
async function loadPortalOperations(kind) {
  const identity=portalWorkflowIdentity(),list=await api.portal.operations(kind);if(identity!==portalWorkflowIdentity()||!state.currentUser||state.currentUser.active===false)return;portalOperations[kind]=list;
  const displayed=kind==='topup'?list.filter(item=>![1,2].includes(item.input.accountingVersion)):list;
  if(kind==='topup')$('#topup-operation-panel').classList.toggle('hidden',!has('topup.manage')||!displayed.length);
  $(`#${kind==='free'?'free':kind==='change'?'change':'topup'}-operations-body`).innerHTML=displayed.map(item=>{
    const actions=item.state==="unknown"&&state.currentUser?.role==="admin"?`<button class="button button-secondary review-portal-operation" data-id="${escapeHtml(item.requestId)}" data-kind="${kind}">Review outcome</button>`:item.state==="confirmed"?`<button class="button button-secondary resume-portal-operation" data-id="${escapeHtml(item.requestId)}" data-kind="${kind}">Save confirmed payment</button>`:"";
    return `<tr><td>${escapeHtml(dateTimeFormatter.format(new Date(item.recordedAt)))}<small>${escapeHtml(item.actor)}</small></td><td><strong>${escapeHtml(item.input.username)}</strong>${kind==="change"?`<small>${escapeHtml(item.quote.beforeName)} → ${escapeHtml(item.quote.targetName)}</small>`:""}<small>Ref: ${escapeHtml(item.requestId)}</small></td><td>${kind==='free'?escapeHtml(item.input.expiry):kind==='change'&&!Number.isFinite(item.quote.total)?'Restricted':formatMoney(kind==="change"?item.quote.total:item.input.amount)}</td><td>${kind==='free'?`${formatMoney(item.input.amount)} · ${escapeHtml(item.input.paymentMethod)}`:kind==="change"?formatMoney(item.input.amount):escapeHtml(item.input.paymentMethod)}</td>${kind==="change"?`<td>${!Number.isFinite(item.quote.total)?'Restricted':item.billId?formatMoney(item.input.amount-item.quote.total):"Not booked"}</td>`:""}<td><strong>${escapeHtml(item.state)}</strong><small>${escapeHtml(item.message)}${item.billId?` · Payment #${Number(item.billId)}`:""}</small></td><td>${actions}</td></tr>`;
  }).join("")||emptyRow(kind==="change"?7:6,"No portal operations yet");
}
async function openTopupDialog() {
  if(topupBusy)return;
  $("#topup-form").reset();topupRequestId=crypto.randomUUID();topupChoices=[];
  const [local,portal]=await Promise.all([api.resellers.list(),api.resellers.portalList()]);
  topupChoices=local.filter(item=>item.active).flatMap(item=>{
    const matches=portal.filter(remote=>remote.username===item.username);
    return matches.length===1?[{...item,portalId:matches[0].id,balance:matches[0].balance}]:[];
  });
  $("#topup-reseller").innerHTML='<option value="">Choose a matched reseller</option>'+topupChoices.map(item=>`<option value="${item.id}">${escapeHtml(item.username)} — ${escapeHtml(item.fullName)} · balance ${formatMoney(item.balance)}</option>`).join("");
  $("#topup-status").textContent=topupChoices.length?"Only exact matching active reseller usernames are shown. No money has been sent.":"No matching Admin reseller is available. Sync the current reseller list and check the API account’s reseller permissions.";
  $("#topup-submit").disabled=!topupChoices.length;$("#topup-dialog").showModal();
}
function bindPortalOperations() {
  $('#change-renew-payment').addEventListener('input',event=>{if(event.target.id!=='change-renew-ack')$('#change-renew-ack').checked=false;$('#change-renew-confirm').disabled=!$('#change-renew-ack').checked||changeRenewWorkflow.busy;});
  $('#change-renew-payment').addEventListener('change',event=>{if(event.target.id!=='change-renew-ack')$('#change-renew-ack').checked=false;$('#change-renew-confirm').disabled=!$('#change-renew-ack').checked||changeRenewWorkflow.busy;});
  $('#portal-change-renew-open').addEventListener('click',()=>openChangeRenewFromBill().catch(error=>showToast(errorMessage(error),'error')));
  $('#change-renew-close').addEventListener('click',()=>{if(!changeRenewWorkflow.busy)$('#change-renew-dialog').close();});
  $('#change-renew-dialog').addEventListener('cancel',event=>{if(changeRenewWorkflow.busy)event.preventDefault();});
  $('#change-renew-target').addEventListener('change',()=>{changeRenewWorkflow.version++;changeRenewWorkflow.quote=null;changeRenewWorkflow.error='';$('#change-renew-change-amount').value='';renderChangeRenew();});
  $('#change-renew-pending-refresh').addEventListener('click',()=>void loadChangeRenewPending());
  $('#change-renew-pending-list').addEventListener('click',event=>{const button=event.target.closest('[data-change-renew-request]');if(button)openSavedChangeRenew(button.dataset.changeRenewRequest).catch(error=>showToast(errorMessage(error),'error'));});
  $('#change-renew-quote').addEventListener('click',async()=>{
    const flow=changeRenewWorkflow,version=flow.version,targetId=Number($('#change-renew-target').value);if(flow.busy||flow.requestId||!targetId||!changeRenewCurrent(version))return;
    flow.busy=true;flow.quote=null;flow.error='';renderChangeRenew();
    try{const quote=await api.bills.quoteChangeRenew({username:flow.customer.username,expectedId:flow.customer.serviceId,targetId,reseller:flow.reseller,renewalMonths:flow.renewalMonths});
      if(!changeRenewCurrent(version))return;
      if(quote?.phase!=='review_change'||!quote.quoteId||quote.username!==flow.customer.username||quote.expectedId!==flow.customer.serviceId||quote.targetId!==targetId||!Number.isFinite(Date.parse(quote.validUntil))||!quote.changeAmountRequired&&!changeRenewMoney(quote.changeCustomerAmount)||quote.zeroChargeWindow&&quote.changeCustomerAmount!==0)throw Error('The service-change quote could not be verified. Refresh it before continuing.');
      flow.quote=quote;$('#change-renew-change-amount').value=quote.changeAmountRequired?'':quote.changeCustomerAmount.toFixed(2);
    }catch(error){if(changeRenewCurrent(version))flow.error=errorMessage(error);}
    finally{if(changeRenewCurrent(version)){flow.busy=false;renderChangeRenew();}}
  });
  $('#change-renew-start').addEventListener('click',async()=>{
    const flow=changeRenewWorkflow,version=flow.version,quote=flow.quote,amount=Number($('#change-renew-change-amount').value);
    if(flow.busy||flow.requestId||!quote||!changeRenewCurrent(version))return;
    if(Date.parse(quote.validUntil)<=Date.now()||!changeRenewMoney(amount)||$('#change-renew-change-amount').value.trim()===''||quote.zeroChargeWindow&&amount!==0||!quote.changeAmountRequired&&amount!==quote.changeCustomerAmount)return showToast('Review a current service-change quote and its customer charge first.','error');
    if(!await confirmPortalAction(`Change ${quote.username} from ${quote.beforeName} to ${quote.targetName}?\n\nService-change customer charge: ${formatMoney(amount)}. ${quote.zeroChargeWindow?(quote.policyVersion===2?'No extra change charge for the reviewed closing period.':'Beirut dates 1–5: this customer charge is $0.'):''}\n${Number.isFinite(quote.renewalCustomerAmount)?`Renewal customer charge: ${formatMoney(quote.renewalCustomerAmount)}\nFull customer charge: ${formatMoney(amount+quote.renewalCustomerAmount)}\n`:''}${Number.isFinite(quote.changeCost)?`Proradius service-change cost/credit: ${formatMoney(quote.changeCost)}.\n`:''}This submits the service change once. It does not collect payment yet. After it is confirmed, review the fresh full charge and confirm one payment and renewal.`))return;
    if(!changeRenewCurrent(version)||quote!==flow.quote||Date.parse(quote.validUntil)<=Date.now())return;
    flow.requestId=crypto.randomUUID();await runChangeRenew(()=>api.bills.startChangeRenew({requestId:flow.requestId,quoteId:quote.quoteId,username:quote.username,expectedId:quote.expectedId,targetId:quote.targetId,renewalMonths:quote.renewalMonths,changeCustomerAmount:amount,confirm:true}));
  });
  $('#change-renew-form').addEventListener('submit',async event=>{
    event.preventDefault();const flow=changeRenewWorkflow,version=flow.version,record=flow.record;if(flow.busy||record?.phase!=='awaiting_payment'||!changeRenewCurrent(version))return;
    if(!$('#change-renew-ack').checked)return showToast('Review the full amount collected and the payment destination first.','error');
    if(Date.parse(record.validUntil)<=Date.now())return showToast('Refresh the payment quote and review its new total before confirming.','error');
    const amount=Number($('#change-renew-amount').value),method=$('#change-renew-method').value;
    if(amount!==record.totalToCollect||!['Cash','Whish Money'].includes(method))return showToast('Confirm the full quoted amount using Cash or Whish Money.','error');
    let input;try{input={requestId:flow.requestId,token:record.token,amount,paymentMethod:method,billingPeriod:$('#change-renew-period').value,reference:$('#change-renew-reference').value,confirm:true,...WhishPayments.input('change-renew-method')};}catch(error){return showToast(errorMessage(error),'error');}
    const whish=WhishPayments.preview(amount,method);
    if(!await confirmPortalAction(`Record one ${formatMoney(amount)} customer payment by ${method} and renew ${record.targetName}?\n\nService-change charge: ${formatMoney(record.changeCustomerAmount)}\nRenewal customer charge: ${formatMoney(record.renewalCustomerAmount)}\nFull amount collected: ${formatMoney(amount)}${whish?`\n${whish.note}`:''}\n\nThe service change is already confirmed and will not repeat. One receipt, cash/wallet credit and any Whish fee are recorded. Confirm only money actually received.`,{title:'Confirm full customer payment',actionLabel:'Confirm payment & renew',icon:'update',subtitle:'Service changed. Collect the verified full charge once.',subject:{name:record.customerName,username:record.username},fields:[{label:'Current service',value:record.targetName},{label:'Renewal',value:`${record.renewalMonths} month${record.renewalMonths===1?'':'s'}`}],payments:[{label:'Service-change charge',amount:formatMoney(record.changeCustomerAmount)},{label:'Renewal customer charge',amount:formatMoney(record.renewalCustomerAmount)},{label:'Total amount collected',amount:formatMoney(amount),method,separate:true,note:whish?.note||'One customer payment'}],notice:'The already confirmed service change is not repeated. Only this saved request can record the payment and submit its renewal. An uncertain response must be reviewed before any retry.'}))return;
    let currentInput;try{currentInput={requestId:flow.requestId,token:flow.record?.token,amount:Number($('#change-renew-amount').value),paymentMethod:$('#change-renew-method').value,billingPeriod:$('#change-renew-period').value,reference:$('#change-renew-reference').value,confirm:true,...WhishPayments.input('change-renew-method')};}catch{return;}
    if(!changeRenewCurrent(version)||record!==flow.record||!$('#change-renew-ack').checked||JSON.stringify(currentInput)!==JSON.stringify(input))return;
    if(Date.parse(record.validUntil)<=Date.now()){renderChangeRenew();return showToast('The payment quote expired. Refresh and review the current full charge.','error');}
    await runChangeRenew(()=>api.bills.confirmChangeRenew(input));
  });
  $('#change-renew-refresh').addEventListener('click',()=>{const requestId=changeRenewWorkflow.requestId;if(requestId)void runChangeRenew(()=>api.bills.changeRenewStatus({requestId}));});
  $('#change-renew-resume').addEventListener('click',async()=>{
    const flow=changeRenewWorkflow,version=flow.version,record=flow.record;if(!record||flow.busy||!changeRenewCurrent(version))return;
    const renew=['renewal_pending','renewal_failed'].includes(record.phase)&&!record.canFinalize;
    if(renew&&!await confirmPortalAction(`Continue only the remaining, unconfirmed renewal for ${record.username}?\n\nThe saved payment is ${record.bill?.receiptNo||'already recorded'}. Do not collect payment again. The confirmed service change and confirmed renewal cycles will not repeat.`))return;
    if(!changeRenewCurrent(version)||record!==flow.record)return;
    await runChangeRenew(()=>api.bills.resumeChangeRenew({requestId:record.requestId,...renew?{renew:true}:{}}));
  });
  $('#change-renew-receipt').addEventListener('click',()=>{const flow=changeRenewWorkflow;if(changeRenewCurrent(flow.version)&&flow.record?.bill){$('#change-renew-dialog').close();showReceipt('bill',flow.record.bill);}});
  $('#change-renew-review').addEventListener('click',()=>{
    const flow=changeRenewWorkflow;if(!changeRenewCurrent(flow.version)||flow.record?.phase!=='change_unknown'||state.currentUser?.role!=='admin')return;
    $('#portal-operation-review-form').reset();$('#portal-operation-review-form').dataset.changeRenewRequest=flow.requestId;
    $('#portal-operation-review .auth-copy').textContent='Check the exact service-change transaction and its financial outcome in Proradius. APPLIED confirms only that saved service change, then the same request can obtain its renewal quote. NOT APPLIED records the failed change. This review does not submit another change, collect payment or send a renewal.';
    $('#portal-operation-review-id').value=flow.requestId;$('#portal-operation-review-summary').textContent=`${flow.record.username} · ${flow.record.beforeName} → ${flow.record.targetName} · Request ${flow.requestId}. Check the exact native service-change transaction before deciding. This review does not send a new action or collect money.`;$('#portal-operation-review').showModal();
  });
  $('#portal-change-plan-first').addEventListener('click',()=>openChangePlanFromBill().catch(error=>showToast(errorMessage(error),'error')));
  $("#portal-operation-review .auth-copy").textContent="Check the exact transfer in Proradius: for top-ups use its FIBER Bills request reference; for plan changes match the customer, timestamp, service and quoted charge. A balance or current plan alone does not prove the financial outcome. APPLIED saves the original local payment once; NOT APPLIED allows a new confirmed attempt. This review never sends money or changes service.";
  $$('[data-close]').forEach(button=>button.addEventListener("click",()=>button.closest("dialog").close()));
  $("#topup-dialog").addEventListener("cancel",event=>{if(topupBusy)event.preventDefault();});
  for(const selector of ["#change-reseller","#change-search"])for(const event of ['input','change'])$(selector).addEventListener(event,()=>{if(!changeBusy)invalidateChange(true);});
  $("#change-target").addEventListener("change",()=>invalidateChange());
  $("#change-amount").addEventListener("input",updateChangeProfitPreview);
  $("#change-method").addEventListener("change",updateChangeProfitPreview);
  $("#change-search-button").addEventListener("click",()=>searchChangeCustomers().catch(error=>showToast(errorMessage(error),"error")));
  $("#change-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();$("#change-search-button").click();}});
  $("#change-search-results").addEventListener("click",event=>{const button=event.target.closest("[data-change-customer]");const customer=button&&changeResults[Number(button.dataset.changeCustomer)];if(customer)selectChangeCustomer(customer.username).catch(error=>showToast(errorMessage(error),"error"));});
  $("#change-calculate").addEventListener("click",()=>calculateChange().catch(error=>{showToast(errorMessage(error),"error");invalidateChange();}));
  $("#change-plan-form").addEventListener("submit",async event=>{
    event.preventDefault();const identity=portalWorkflowIdentity(),version=changeVersion;if(changeBusy||!changeQuote||!portalWorkflowCurrent(identity,'plans.manage'))return;
    const quote=changeQuote,input={requestId:changeRequestId,quoteId:quote.quoteId,username:quote.username,expectedId:quote.expectedId,targetId:quote.targetId,amount:Number($("#change-amount").value),paymentMethod:$("#change-method").value,billingPeriod:$("#change-period").value,reference:$("#change-reference").value,confirm:true};
    Object.assign(input,WhishPayments.input('change-method'));
    const refund=input.amount<0;
    const whish=WhishPayments.preview(input.amount,input.paymentMethod);
    if(!await confirmPortalAction(`Change ${quote.username} from ${quote.beforeName} to ${quote.targetName}?\n\nCustomer ${refund?"refund":"amount"}: ${formatMoney(refund?-input.amount:input.amount)} (${input.paymentMethod})${Number.isFinite(quote.total)?`\nYour Proradius cost/credit: ${formatMoney(quote.total)}\nProfit ${refund?"adjustment":"before other expenses"}: ${formatMoney(input.amount-quote.total-(whish?.fee||0))}`:''}${whish?`\n${whish.note}`:''}\n\n${refund?`Confirm that ${formatMoney(-input.amount)} is being returned to the customer by ${input.paymentMethod}. This records a refund, subtracts revenue and ${input.paymentMethod==="Cash"?"reduces the cash drawer":"reduces net Whish collections"}. It does not send money or create future customer credit.`:"This records the customer payment/debt."} This applies one real Change Service action, not a monthly renewal.`))return;
    if(!portalWorkflowCurrent(identity,'plans.manage')||version!==changeVersion||quote!==changeQuote||state.currentView!=='change-plan')return;
    changeBusy=true;const fields=$$("#change-plan-form input,#change-plan-form select,#change-plan-form button"),prior=fields.map(field=>field.disabled);fields.forEach(field=>field.disabled=true);
    try{const bill=await api.portal.applyChange(input);
      if(!portalWorkflowCurrent(identity,'plans.manage')||version!==changeVersion)return;
      invalidateChange(true);showToast(`${bill.receiptNo}: plan changed and ${refund?"refund":"payment"} recorded.`);
      await Promise.all([loadBills(),loadPortalOperations("change"),has("reports.view")?loadReport():Promise.resolve(),has("dashboard.view")?loadDashboard():Promise.resolve(),has("debts.view")?loadDebts():Promise.resolve(),has("drawer.view")?loadDrawer():Promise.resolve()]);}
    catch(error){if(portalWorkflowCurrent(identity,'plans.manage')){showToast(errorMessage(error),"error");await loadPortalOperations("change").catch(()=>{});}}
    finally{changeBusy=false;if(portalWorkflowCurrent(identity,'plans.manage')){fields.forEach((field,index)=>field.disabled=prior[index]);$("#change-apply").disabled=!changeQuote;$("#change-calculate").disabled=!changeCustomer||!$("#change-target").value;$("#change-amount").disabled=!changeQuote;$("#change-target").disabled=!changeCustomer||changeCustomer.blocked;updateChangeProfitPreview();}}
  });
  $("#add-reseller-money").addEventListener("click",()=>window.ResellerFunding?.open().catch(error=>showToast(errorMessage(error),"error")));
  $("#topup-form").addEventListener("submit",async event=>{
    event.preventDefault();if(topupBusy)return;const reseller=topupChoices.find(item=>String(item.id)===$("#topup-reseller").value);if(!reseller)return;
    const input={requestId:topupRequestId,resellerId:reseller.id,portalResellerId:reseller.portalId,amount:Number($("#topup-amount").value),paymentMethod:$("#topup-method").value,reference:$("#topup-reference").value,billingPeriod:localDate().slice(0,7),confirm:true};
    Object.assign(input,WhishPayments.input('topup-method'));
    if(!await confirmPortalAction(`Credit ${formatMoney(input.amount)} to ${reseller.username} in Proradius and record the same amount received by ${input.paymentMethod}?\n\nThis is a real balance credit, not just a payment record.`))return;
    topupBusy=true;const fields=$$("#topup-form input,#topup-form select,#topup-form button");fields.forEach(field=>field.disabled=true);$("#topup-status").textContent="Submitting once. Do not repeat; wait for the confirmed result.";
    try{const bill=await api.resellers.addMoney(input);$("#topup-dialog").close();showToast(`${bill.receiptNo}: Proradius credited and payment recorded.`);await Promise.all([loadBills(),loadPortalOperations("topup")]);}
    catch(error){$("#topup-status").textContent=errorMessage(error);showToast(errorMessage(error),"error");await loadPortalOperations("topup").catch(()=>{});}
    finally{topupBusy=false;fields.forEach(field=>field.disabled=false);}
  });
  document.addEventListener("click",async event=>{
    const refresh=event.target.closest(".refresh-portal-operations"),review=event.target.closest(".review-portal-operation"),resume=event.target.closest(".resume-portal-operation");
    try{
      if(refresh)await loadPortalOperations(refresh.dataset.kind);
      if(resume){resume.disabled=true;await api.portal.resumeOperation(resume.dataset.id);await Promise.all([loadBills(),loadPortalOperations(resume.dataset.kind)]);showToast("Confirmed payment saved. No new portal submission.");}
      if(review){const row=portalOperations[review.dataset.kind].find(item=>item.requestId===review.dataset.id);$("#portal-operation-review-form").reset();delete $('#portal-operation-review-form').dataset.changeRenewRequest;$('#portal-operation-review .auth-copy').textContent='Check the exact transfer in Proradius: for top-ups use its FIBER Bills request reference; for plan changes match the customer, timestamp, service and quoted charge. A balance or current plan alone does not prove the financial outcome. APPLIED saves the original local payment once; NOT APPLIED allows a new confirmed attempt. This review never sends money or changes service.';$('#portal-operation-review-form').dataset.kind=review.dataset.kind;$("#portal-operation-review-id").value=row.requestId;$("#portal-operation-review-summary").textContent=`${row.input.username} · ${formatMoney(row.input.amount)} · ${row.requestId}${review.dataset.kind==='free'?' · Free expiry '+row.input.expiry+' · Check the exact expiry edit, not a renewal charge.':''}`;$("#portal-operation-review").showModal();}
    }catch(error){showToast(errorMessage(error),"error");if(resume)resume.disabled=false;}
  });
  $("#portal-operation-review-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("#portal-operation-review-form [type='submit']");button.disabled=true;
    const combinedRequest=$('#portal-operation-review-form').dataset.changeRenewRequest;
    if(combinedRequest){try{const flow=changeRenewWorkflow;if(combinedRequest!==flow.requestId||flow.record?.phase!=='change_unknown'||state.currentUser?.role!=='admin'||!changeRenewCurrent(flow.version))throw Error('Open the exact saved request again before reviewing its outcome.');await runChangeRenew(()=>api.bills.resolveChangeRenew({requestId:combinedRequest,confirmation:$('#portal-operation-review-confirmation').value,note:$('#portal-operation-review-note').value}));if(!flow.error)$('#portal-operation-review').close();}catch(error){showToast(errorMessage(error),'error');}finally{button.disabled=false;}return;}
    try{await api.portal.resolveOperation($("#portal-operation-review-id").value,{confirmation:$("#portal-operation-review-confirmation").value,note:$("#portal-operation-review-note").value});$("#portal-operation-review").close();await Promise.all([loadBills(),loadPortalOperations($('#portal-operation-review-form').dataset.kind==='free'?'free':businessWorkspace.kind==="reseller"?"topup":"change")]);showToast("Verified portal outcome recorded; no portal action repeated.");}
    catch(error){showToast(errorMessage(error),"error");}finally{button.disabled=false;}
  });
}
function billRenewalBadge(bill) {
  if (businessWorkspace.id !== "fiber-users" || bill.serviceType !== "Internet") return "";
  const status = bill.renewal?.state || "not_requested";
  if(status==='free')return `<small class="portal-renewal-badge renewed">Free service until ${escapeHtml(bill.renewal.afterExpiry)}</small><small>Expense funding ${formatMoney(bill.expenseFunding?.amount||0)} · not Internet revenue</small>`;
  return `<small class="portal-renewal-badge ${["succeeded","created"].includes(status) ? "renewed" : status === "unknown" ? "uncertain" : ""}">${escapeHtml(renewalLabel(status))}${!["not_requested","created"].includes(status)?` · ${Number(bill.renewal.completedMonths??(status==="succeeded"?1:0))}/${Number(bill.renewal.requestedMonths??bill.renewalMonths??1)} confirmed`:""}</small>${has('reports.view')&&bill.portalCostSource?`<small>Cost ${formatMoney(bill.bundleCost)} · Profit ${formatMoney(Number(bill.amount)-Number(bill.bundleCost))}</small><small>${escapeHtml(bill.portalCostSource)}</small>`:''}`;
}
function internetBillActions(bill) {
  if (businessWorkspace.id !== "fiber-users" || bill.serviceType !== "Internet") return "";
  const status = bill.renewal?.state || "not_requested", paid = bill.paymentStatus === "paid" && Number(bill.remainingAmount ?? 0) === 0;
  const canRenew = (paid || bill.renewal?.onCredit === true) && (has("bills.create") || has("bills.manage")) && ["not_requested","failed"].includes(status);
  const remaining=bill.renewal?.remainingMonths??bill.renewalMonths??1;
  return `${canRenew ? `<button class="button button-secondary renew-internet-bill" type="button" data-id="${bill.id}" ${portalStatus.ready ? "" : "disabled"} title="Only remaining, unconfirmed monthly cycles are submitted">${icon("update")}Renew ${remaining} month${remaining===1?"":"s"}</button>` : ""}${status !== "not_requested" ? `<button class="icon-button renewal-history" data-id="${bill.id}" aria-label="${status==='created'?'Account creation history':'Renewal history'}" title="${status==='created'?'Account creation history':'Renewal history'}">${icon("clock")}</button>` : ""}`;
}
async function loadPortalStatus() {
  try { portalStatus = api.portal ? await api.portal.status() : { ready: false }; }
  catch(error) { portalStatus={ready:false,error:errorMessage(error)}; }
  updatePortalCustomerSummary(); renderBills(); return portalStatus;
}
function updatePortalCustomerSummary() {
  const valid = portalCustomer?.username === $("#bill-customer-account").value.trim();
  if (!valid) portalCustomer = null;
  $("#portal-account-summary").textContent = !portalStatus.ready ? portalStatus.error || "Ask the main administrator to configure and test the Internet API." : valid ? `${portalCustomer.name || portalCustomer.username} · Current plan: ${portalCustomer.service || "Not supplied by portal"} · Expiry: ${portalCustomer.expiry || "Not supplied"}${portalCustomer.blocked ? " · BLOCKED" : ""}` : "Search for a customer or verify the entered username before Save & Renew.";
  $("#portal-search-button").disabled = billSaving || portalSelecting || !portalStatus.ready;
  $("#portal-verify-button").disabled = billSaving || portalSelecting || !portalStatus.ready;
  const linked = businessWorkspace.id === "fiber-users" && $("#bill-service-type").value === "Internet" && portalStatus.ready;
  const freePolicy=billFreePolicy(),free=Boolean(freePolicy?.free);
  const target = selectedPortalPlan(), invalidPlan = valid && (!target || target.id!==portalCustomer.serviceId || (!free&&(target.cost === null || target.fixedCost === null || Boolean(portalCustomer.renewalQuoteError))));
  const onCredit = $('#bill-payment-method').value === 'Unpaid';
  $("#bill-save-only").textContent = businessWorkspace.kind === "reseller" ? "Save transfer" : onCredit ? "Save debt only" : "Save payment only";
  $("#bill-renew-button").innerHTML = `${icon("update")}${onCredit ? 'Save debt & Renew current service' : 'Save & Renew current service'}`;
  $('#portal-change-plan-step').classList.toggle('hidden',!linked||!valid||!has('plans.manage'));
  $('#portal-change-plan-first').disabled=billSaving||portalSelecting||changeBusy||portalCustomer?.blocked;
  $('#portal-change-renew-open').disabled=billSaving||portalSelecting||changeBusy||portalCustomer?.blocked||!canChangeRenew();
  $("#bill-save-only").disabled = billSaving || portalSelecting || (linked && (!valid || invalidPlan || portalCustomer.blocked));
  $("#bill-renew-button").disabled = billSaving || portalSelecting || !portalStatus.ready || !valid || invalidPlan || !$("#bill-bundle").value || portalCustomer?.blocked || $("#bill-service-type").value !== "Internet";
  if(free&&valid&&portalCustomer.expiry.slice(0,10)>=freePolicy.expiry)$('#bill-renew-button').disabled=true;
  $("#portal-plan-history").classList.toggle("hidden", !valid);
  $("#portal-plan-history").disabled = billSaving || portalSelecting;
  $("#portal-refresh-cost").classList.toggle("hidden",!valid||free);
  $("#portal-refresh-cost").disabled=billSaving||portalSelecting;
  updateBillBundleNote();
}
let costRefreshPending=false;
async function refreshPortalCustomerCosts(manual=false){
  if(costRefreshPending||billSaving||portalSelecting||!$("#bill-dialog").open||businessWorkspace.id!=="fiber-users"||!portalStatus.ready||!portalCustomer)return;
  const identity=portalWorkflowIdentity(),username=portalCustomer.username,requestId=billRequestId,version=portalLookupVersion,reseller=$("#portal-reseller-search").value.trim();
  costRefreshPending=true;
  try{
    const customer=await api.portal.lookup(reseller?{username,reseller}:username);
    if(identity!==portalWorkflowIdentity()||reseller!==$('#portal-reseller-search').value.trim()||billSaving||requestId!==billRequestId||version!==portalLookupVersion||!$("#bill-dialog").open||portalCustomer?.username!==username)return;
    if(customer.serviceId!==portalCustomer.serviceId){portalCustomer=null;updatePortalCustomerSummary();if(manual)showToast("The portal plan changed. Verify the customer again before saving.","error");return;}
    portalCustomer=customer;
    if(billAmountAutomatic)updateBillBundleOptions(true);
    updatePortalCustomerSummary();
    if(manual)showToast(billAmountAutomatic?"Proradius costs and automatic selling amount refreshed.":"Proradius costs refreshed; your edited amount is unchanged.");
  }catch(error){if(identity===portalWorkflowIdentity()&&reseller===$('#portal-reseller-search').value.trim()&&requestId===billRequestId&&version===portalLookupVersion&&portalCustomer?.username===username){portalCustomer.costRefreshError=true;updateBillBundleNote();if(manual)showToast(errorMessage(error),"error");}}
  finally{costRefreshPending=false;}
}
async function selectPortalCustomer(username) {
  const identity=portalWorkflowIdentity(),version = ++portalLookupVersion, requestId = billRequestId, reseller = $("#portal-reseller-search").value.trim();
  const current=()=>identity===portalWorkflowIdentity()&&version===portalLookupVersion&&requestId===billRequestId&&$('#bill-dialog').open&&reseller===$('#portal-reseller-search').value.trim();
  portalSelecting = true; portalCustomer = null; updatePortalCustomerSummary();
  try {
    const customer = await api.portal.lookup(reseller ? {username,reseller} : username);
    if(!current())return;
    await loadBundles();
    if(!current())return;
    portalCustomer = customer; $("#bill-customer-account").value = customer.username;
    $("#bill-customer-name").value = customer.name || "";
    $("#bill-phone").value = customer.phone || "";
    $("#bill-service-type").value = "Internet";
    const bundle = FiberBillPlan.matchInternetBundle(customer.service, state.bundles);
    billBundleNeedsSelection = !bundle;
    updateBillBundleOptions(false);
    if (bundle) { $("#bill-bundle").value = bundle.code; updateBillBundleOptions(true); }
    else { $("#bill-amount").value = ""; updateBillBundleNote(); }
    $("#portal-search-results").innerHTML = "";
  } catch (error) {
    if(current())throw error;
  } finally {
    if (identity===portalWorkflowIdentity()&&version === portalLookupVersion) { portalSelecting = false; updatePortalCustomerSummary(); }
  }
}
async function searchPortalCustomers(){
  const identity=portalWorkflowIdentity(),version=++portalSearchVersion,requestId=billRequestId;
  const term=$('#portal-customer-search').value.trim(),reseller=$('#portal-reseller-search').value.trim();
  const current=()=>version===portalSearchVersion&&identity===portalWorkflowIdentity()&&requestId===billRequestId&&$('#bill-dialog').open&&term===$('#portal-customer-search').value.trim()&&reseller===$('#portal-reseller-search').value.trim();
  portalSearchCustomers=[];
  $('#portal-search-button').disabled=true;$('#portal-search-results').textContent='Searching portal customers…';
  try{
    const result=await api.portal.search({term,reseller});if(!current())return;portalSearchCustomers=result.customers;
    $('#portal-search-results').innerHTML=result.customers.map((customer,index)=>`<button type="button" class="portal-customer-choice" data-portal-index="${index}"><span><strong>${escapeHtml(customer.name||customer.username)}</strong><small>${escapeHtml(customer.username)} · ${escapeHtml(customer.phone||'No phone recorded')}</small></span>${icon('arrow-right')}</button>`).join('')||(result.truncated?'<p class="field-note">No verified customers in the first results. Narrow your search.</p>':'<p class="field-note">No matching customers. Try an exact username, another phone format or a longer name.</p>');
    if(result.truncated)$('#portal-search-results').insertAdjacentHTML('beforeend','<p class="field-note">More customers may match. Enter a longer name, phone number or exact username to narrow this reseller search.</p>');
    else if(result.total>result.customers.length)$('#portal-search-results').insertAdjacentHTML('beforeend',`<small>${Number(result.total)} matches. Showing the first 30; refine your search.</small>`);
  }catch(error){if(current()){$('#portal-search-results').textContent=errorMessage(error);showToast(errorMessage(error),'error');}}
  finally{if(identity===portalWorkflowIdentity()&&requestId===billRequestId)updatePortalCustomerSummary();}
}
async function openPortalSettings() {
  const settings = await api.portal.settings();
  $("#portal-api-username").value = settings.username; $("#portal-api-password").value = "";
  renderPortalSettings(settings); $("#portal-settings-dialog").showModal();
}
function renderPortalSettings(settings) { $("#portal-settings-status").textContent = settings.ready ? `Connected and enabled · Last read-only verification ${dateTimeFormatter.format(new Date(settings.verifiedAt))}` : settings.configured ? "Credentials saved. Test a real customer username to enable renewals." : "Not configured. No renewals can be sent."; }
async function refreshBillSettings() {
  billResetState=await api.bills.resetPreview();
  const kind=billResetState.kind||'bill',label=kind==='sale'?'POS receipts':kind==='telecom'?'Mobile & Ogero payments':'service bills (including plan changes and reseller transfers)';
  $("#bill-reset-title").textContent=`${businessWorkspace.name} · Clear bills`;
  $("#bill-reset-scope-note").textContent=`Archive all ${label} in ${businessWorkspace.name}. This applies to all dates, not just the displayed filter. Other businesses are not cleared.`;
  $("#bill-reset-kept-note").textContent=`A backup is created first. These receipts, their debt collections and linked cash entries are excluded from active lists, debts, reports and this business's drawer. Users, products, current stock quantities, purchases, expenses, installation funding, other receipt types and API settings are kept.${kind==='sale'?' Stock sold on these receipts is NOT returned to inventory.':''}`;
  $("#bill-reset-preview").textContent=`All dates: ${billResetState.billCount} active bills · ${formatMoney(billResetState.totalAmount)} invoiced · ${formatMoney(billResetState.cashExcluded)} linked cash contribution will be excluded from this drawer.`;
  $("#bill-reset-submit").disabled=billResetSaving||!billResetState.billCount;
  const blockers=billResetState.blockers||[],ready=billResetState.readyToFinalize||[];
  $('#bill-reset-actions-panel').classList.toggle('hidden',!blockers.length&&!ready.length);
  $('#bill-reset-actions-summary').textContent=(ready.length?`${ready.length} confirmed action(s) already have verified local receipts. Their audit flags will be finalized automatically during reset, without new payments or charges. `:'')+(blockers.length?`${blockers.length} other action(s) need a decision below. Unknown/in-flight actions cannot be skipped.`:'No unresolved actions block reset.');
  $('#bill-reset-actions-body').innerHTML=blockers.map(row=>`<tr><td><strong>${escapeHtml(row.username)}</strong><small>${escapeHtml(row.id)}</small><small>${escapeHtml(row.recordedAt)}</small></td><td>${escapeHtml(row.kind)}<br><strong>${escapeHtml(row.state)}</strong></td><td>${row.canCloseTest?`<label class="reset-test-choice"><input type="checkbox" data-reset-close-id="${escapeHtml(row.id)}" /><span>Close confirmed TEST locally · do not create missing payments</span></label>`:row.state==='unknown'?`<button type="button" class="button button-secondary" data-reset-review-id="${escapeHtml(row.id)}" data-reset-review-source="${escapeHtml(row.source)}">Verify exact outcome</button>`:'Wait for this action to finish. If Main was interrupted, restart Main once and review the recovered outcome.'}</td></tr>`).join('');
  $('#bill-reset-close-ack').checked=false;
  updateBillResetReadiness();
  $("#bill-reset-history").textContent=billResetState.resets.map(item=>`${dateTimeFormatter.format(new Date(item.recordedAt))} · ${item.actor} · ${item.billCount} bills · ${item.note} · Backup: ${item.backupPath}`).join("\n")||"No bill resets recorded.";
  $("#bill-reset-archive-body").innerHTML=billResetState.archived.map(item=>`<tr><td>${escapeHtml(item.receiptNo)}</td><td>${escapeHtml(item.customerName)}<br><small>${escapeHtml(item.customerAccount)}</small></td><td>${formatMoney(item.amount)}</td><td>${item.renewalState?`Archived · ${item.completedMonths}/${item.requestedMonths} cycles confirmed <button class="icon-button renewal-history" type="button" data-id="${item.id}" aria-label="Archived renewal history">${icon("clock")}</button>`:"No renewal requested"}</td></tr>`).join("")||emptyRow(4,"No archived bills");
}
function updateBillResetReadiness(){
 const selected=new Set($$('[data-reset-close-id]:checked').map(input=>input.dataset.resetCloseId));
 const blockers=billResetState?.blockers||[];
 $('#bill-reset-close-ack-field').classList.toggle('hidden',!selected.size);
 if(!selected.size)$('#bill-reset-close-ack').checked=false;
 const unresolved=blockers.some(row=>!row.canCloseTest||!selected.has(row.id));
 $('#bill-reset-submit').disabled=billResetSaving||billResetReviewSaving||!billResetState?.billCount||unresolved||(selected.size&&!$('#bill-reset-close-ack').checked);
}
async function openBillSettings() {
  if(billSaving||billResetSaving)throw Error("Wait for the current bill action to finish.");
  await refreshBillSettings();$("#bill-reset-form").reset();$("#bill-reset-reason").value="Clear test bills";$("#bill-reset-result").textContent="";$("#bill-settings-dialog").showModal();
}
async function openRenewalHistory(id) {
  const archived=billResetState?.archived?.find(item=>Number(item.id)===id);
  const bill = state.bills.find(item => Number(item.id) === id)||(archived?{...archived,renewal:{state:"archived",completedMonths:archived.completedMonths,requestedMonths:archived.requestedMonths,message:`Archived local test bill; portal action was not undone. Original state: ${archived.renewalState}. Unsent remaining cycles are abandoned.`}}:null); if (!bill) return;
  const events = await api.bills.renewalHistory(id);
  const created=bill.renewal?.source==='account_creation';
  const eventLabel=value=>created?({checking:'Checking new customer',processing:'Creating customer',confirmed:'Customer confirmed',succeeded:'First bill recorded',unknown:'Creation outcome uncertain',failed:'Creation not confirmed'})[value]||value:value==='unpaid_authorized'?'Renewal on credit authorized':value==='cost_quoted'?'Live cost quote saved':renewalLabel(value);
  $("#renewal-history-summary").textContent = `${bill.receiptNo} · ${bill.customerAccount} · ${renewalLabel(bill.renewal?.state)}${bill.renewal?.state==='created'?'':` · ${bill.renewal?.completedMonths??0}/${bill.renewal?.requestedMonths??bill.renewalMonths??1} months confirmed`} · ${bill.renewal?.message || ""}`;
  $("#renewal-history-body").innerHTML = events.map(item => `<tr><td>${dateTimeFormatter.format(new Date(item.recordedAt))}</td><td>${escapeHtml(eventLabel(item.state))}</td><td>${escapeHtml(item.note)}</td><td>${escapeHtml(item.actor)}</td></tr>`).join("") || emptyRow(4,created?'No creation events recorded':'No renewal requests recorded');
  $("#renewal-review-form").reset(); $("#renewal-review-id").value = id;
  configurePortalReview("renewal");
  if(created){$("#renewal-history-dialog h2").textContent='Account creation history';$("#renewal-history-dialog .eyebrow").textContent='INITIAL SERVICE AUDIT';}
  $("#renewal-review-form").classList.toggle("hidden", state.currentUser?.role !== "admin" || bill.renewal?.state !== "unknown");
  $("#renewal-history-dialog").showModal();
}
function configurePortalReview(kind) {
  const plan = kind === "plan";
  $("#renewal-review-kind").value = kind;
  $("#renewal-history-dialog h2").textContent = plan ? "Portal plan change history" : "Portal renewal history";
  $("#renewal-history-dialog .eyebrow").textContent = plan ? "PLAN CHANGE AUDIT" : "INTERNET RENEWAL AUDIT";
  $("#renewal-review-instructions").textContent = plan ? "Check this customer's current service and account details in Proradius. Your confirmation is checked against the live plan; no update or renewal is sent by this review." : "Check this username’s refill history in pi.fibernetlb.net. Do not guess: repeating a successful renewal can charge the account again.";
  $("#renewal-review-label").textContent = plan ? "Type PLAN CHANGED or NOT CHANGED" : "Type RENEWED or NOT RENEWED";
  $("#renewal-review-confirmation").pattern = plan ? "PLAN CHANGED|NOT CHANGED" : "RENEWED|NOT RENEWED";
}
async function openPortalPlanHistory() {
  const username = $("#bill-customer-account").value.trim(), history = await api.portal.planHistory(username);
  configurePortalReview("plan");
  $("#renewal-history-summary").textContent = `${username} · ${history.latest?.targetName || "No plan change recorded"} · ${history.latest?.state || ""} · ${history.latest?.message || ""}`;
  $("#renewal-history-body").innerHTML = history.events.map(item => `<tr><td>${dateTimeFormatter.format(new Date(item.recordedAt))}</td><td>${escapeHtml(item.state)}</td><td>${escapeHtml(item.note)}</td><td>${escapeHtml(item.actor)}</td></tr>`).join("") || emptyRow(4,"No plan changes recorded");
  $("#renewal-review-form").reset(); configurePortalReview("plan");
  $("#renewal-review-id").value = history.latest?.requestId || "";
  $("#renewal-review-form").classList.toggle("hidden", state.currentUser?.role !== "admin" || history.latest?.state !== "unknown");
  $("#renewal-history-dialog").showModal();
}
function billRenewalConfirmation(username, amount, customer, target, changing, wantRenew,months=1) {
  const quote=Number.isFinite(target?.renewalCost)&&Number.isFinite(target?.fixedCost)?target.renewalCost+target.fixedCost*(months-1):null;
  const onCredit=wantRenew&&$('#bill-payment-method').value==='Unpaid';
  const whish=WhishPayments.preview(amount,$('#bill-payment-method').value),pricing=quote!==null?`\n${months>1?'Estimated total service cost':'Current Proradius service cost'}: ${formatMoney(quote)} · ${months>1?'Estimated':'Bill'} profit before other expenses: ${formatMoney(Number(amount)-quote-(whish?.fee||0))}${whish?`\n${whish.note}`:''}${months>1?'\nEach submitted renewal cycle gets its own live cost quote; reports update to the sum of those saved quotes. Unsubmitted cycles remain estimates.':''}`:'';
  return `Save ${formatMoney(amount)} ${onCredit?'as customer debt ':''}for ${username}?\n\nCurrent Proradius plan: ${customer?.service || "Current account plan"}\nCurrent expiry: ${customer?.expiry || "Not supplied"}\n${retailPriceNote(billRetailQuote())}${pricing}\n\n${wantRenew ? `Renew ${months} monthly cycle${months===1?"":"s"} of this current service after saving one ${onCredit?'unpaid bill. No money has been received. Cash or Whish is credited only when the debt is collected; collection does not renew the service again':'payment'}. Future cycles may appear as pending refills. The app stops on an uncertain response; confirmed cycles are never repeated.` : "Save the payment or debt only. No service change or renewal will be sent."}\nSelling price remains the amount entered in the app. Customer Override Price is not used or modified. IPTV is not renewed.`;
}
function billRenewalReview(bill,customer,target,changing,wantRenew){
  const months=Number(bill.renewalMonths),cost=Number.isFinite(target?.renewalCost)&&Number.isFinite(target?.fixedCost)?target.renewalCost+target.fixedCost*(months-1):null;
  const pricing=billRetailQuote(),fields=[{label:"Current service",value:customer?.service||target?.name||'Current account plan'},{label:"Current expiry",value:customer?.expiry||'Not supplied'},{label:"Renewal",value:wantRenew?`${months} monthly cycle${months===1?'':'s'}`:'Payment only · no renewal'}];
  if(pricing)fields.push({label:"Billing coverage",value:pricing.advance?`Additional full month${months>1?'s':''} · existing subscription stays active`:`${pricing.remainingDays}/${pricing.cycleDays} days through ${pricing.cycleEnd}${pricing.additionalFullMonths?` + ${pricing.additionalFullMonths} full cycle(s)`:''}`});
  if(bill.whishDestinationId)fields.push({label:"Whish destination",value:$('#bill-payment-method-whish')?.selectedOptions[0]?.textContent||'Selected wallet'});
  const whish=WhishPayments.preview(bill.amount,bill.paymentMethod);
  const onCredit=wantRenew&&bill.paymentMethod==='Unpaid';
  return {title:onCredit?'Confirm renewal on credit':wantRenew?'Confirm current-service renewal':'Confirm payment',actionLabel:onCredit?'Save debt & Renew':wantRenew?'Confirm renewal':'Confirm payment',icon:'update',subtitle:onCredit?'No money received. Renew now and record the full amount owed.':'Check the account and the exact amount collected before continuing.',subject:{name:bill.customerName||customer?.name,username:bill.customerAccount},fields,payments:[{label:bill.paymentMethod==='Unpaid'?'Customer debt':'Customer payment',amount:formatMoney(bill.amount),method:bill.paymentMethod,note:onCredit?'Full amount remains due. Cash or Whish is credited only when actually collected.':`Uses the amount you entered, including any manual edit.${whish?' '+whish.note:''}`}],metrics:cost===null?[]:[{label:months>1?'Estimated service cost':'Proradius service cost',value:formatMoney(cost)},{label:months>1?'Estimated profit before other expenses':'Profit before other expenses',value:formatMoney(Number(bill.amount)-cost-(whish?.fee||0))}],notice:wantRenew?`One ${onCredit?'unpaid bill':'payment'} is recorded for ${months} monthly cycle${months===1?'':'s'} of the verified current service.${onCredit?' Collecting this debt later does not renew the service again.':''} Each cycle uses a fresh Proradius quote. Confirmed cycles are not repeated; an uncertain result stops the request. IPTV is not renewed.`:'Records the payment or debt only. No service change or renewal is sent.'};
}

async function openBillDialog() {
  const identity=portalWorkflowIdentity();
  if(!state.currentUser||state.currentUser.active===false||!has('bills.create')&&!has('bills.manage'))return showToast('Your role cannot record customer bills.','error');
  if (businessWorkspace.kind === "reseller") return showToast("Use Add money or Refund in the current reseller list. Earlier bills are historical records.", "error");
  if(billSaving)return showToast("Please wait for the current payment to finish.","error");
  $("#bill-form").reset();
  billAmountAutomatic=true;
  $$("#bill-form button").forEach(button=>button.disabled=false);
  billRequestId = crypto.randomUUID(); portalCustomer = null; portalSearchCustomers = [];
  portalLookupVersion++; portalSearchVersion++; portalSelecting = false; billBundleNeedsSelection = false;
  $("#portal-search-results").innerHTML = "";
  $("#bill-customer-account").value = businessWorkspace.kind === "reseller" ? "" : FIBERNETLB_ACCOUNT_PREFIX;
  $("#bill-period").value = localDate().slice(0, 7);
  selectPayment("bill-payment", "#bill-payment-method", "Cash");
  updateBillPayment();
  updateBillBundleOptions(true);
  if (businessWorkspace.id === "fiber-users") await loadPortalStatus();
  if(identity!==portalWorkflowIdentity())return;
  updateBillBundleOptions(true);
  updatePortalCustomerSummary();
  $("#bill-dialog").showModal();
  if (businessWorkspace.id === "fiber-users" && portalStatus.ready && api.portal.resellers) {
    const requestId=billRequestId;
    api.portal.resellers().then(list=>{if(requestId===billRequestId && $("#bill-dialog").open)$("#portal-reseller-options").innerHTML=list.map(item=>`<option value="${escapeHtml(item.username)}">${escapeHtml(item.name || item.username)}</option>`).join("");}).catch(()=>{if(requestId===billRequestId)$("#portal-reseller-options").innerHTML="";});
  }
  requestAnimationFrame(() => { const dialog=$('#bill-dialog'),active=document.activeElement;const input = $(businessWorkspace.kind === "reseller" ? "#bill-reseller" : businessWorkspace.id==="fiber-users"&&portalStatus.ready ? "#portal-customer-search" : "#bill-customer-account"); if(!dialog.open||dialog.contains(active)&&['INPUT','SELECT','TEXTAREA'].includes(active.tagName))return;input.focus(); if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length); });
  return billRequestId;
}

async function saveFreeRenewal(){
  const policy=billFreePolicy(),account=normalizedBillAccount(),customer=portalCustomer,method=$('#bill-payment-method').value;
  if(!policy?.free||!portalStatus.ready||customer?.username!==account||customer.blocked||!['Cash','Whish Money'].includes(method))return showToast('Verify the current Proradius customer and select Cash or Whish Money for expense funding.','error');
  const input={requestId:billRequestId,username:account,serviceId:customer.serviceId,resellerId:customer.resellerId,expectedExpiry:customer.expiry,amount:Number($('#bill-free-funding').value),paymentMethod:method,reference:$('#bill-reference').value,policy:policy.policy,asOf:policy.asOf,expiry:policy.expiry,confirm:true,...WhishPayments.input('bill-payment-method')};
  const whish=WhishPayments.preview(input.amount,method);
  if($('#bill-free-funding').value==='')return showToast('Enter the expense funding received, or 0 for no payment.','error');
  billSaving=true;const controls=$$('#bill-form button, #bill-free-funding'),prior=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
  try{
    if(!await confirmPortalAction(`Free service for ${account} using ${customer.service}?\nCurrent expiry: ${customer.expiry}\nNew expiry: ${policy.expiry} at 12:00 Beirut.\n\nInternet amount and paid renewal cost: $0.00. Only expiry is edited; no paid renewal or plan change is sent.\nExpense funding received: ${formatMoney(input.amount)} by ${method}${whish?' · '+whish.note:''}. This is saved in Expenses, separate from Internet-bill revenue.\n\nConfirm the money actually received.`,{title:'Confirm free service renewal',actionLabel:'Confirm free renewal',icon:'update',subtitle:'Review the free expiry and the separate expense funding received.',subject:{name:customer.name,username:account},fields:[{label:'Current service',value:customer.service},{label:'Current expiry',value:customer.expiry},{label:'New expiry',value:policy.expiry+' · 12:00 Beirut'}],payments:[{label:'Internet service',amount:'$0.00',note:'Free expiry extension · no paid renewal'},{label:'Expense funding received',amount:formatMoney(input.amount),method,note:`Saved in Expenses, not Internet-bill revenue.${whish?' '+whish.note:''}`}],notice:'Only the expiry date is changed. No paid renewal, service cost or plan change is sent. Confirm only the funding you actually received.'}))return;
    $('#bill-form').setAttribute('aria-busy','true');
    const saved=await api.bills.saveFreeRenewal(input);$('#bill-dialog').close();await Promise.all([loadBills(),has('expenses.view')?loadExpenses():Promise.resolve(),has('dashboard.view')?loadDashboard():Promise.resolve(),has('drawer.view')?loadDrawer():Promise.resolve()]);
    showReceipt('bill',saved);if(!FiberActionFeedback.renewed(saved))showToast(`Free service until ${policy.expiry}. Expense funding ${formatMoney(saved.expenseFunding?.amount||0)} saved separately.`);
  }catch(error){showToast(`${errorMessage(error)} If the outcome is uncertain, use Free renewal history before retrying; this form keeps the same request ID.`,'error');await loadFreeRenewalHistory().catch(()=>{});}
  finally{$('#bill-form').removeAttribute('aria-busy');billSaving=false;controls.forEach((c,i)=>c.disabled=prior[i]);updatePortalCustomerSummary();}
}
function normalizedBillAccount() {
  const input = $("#bill-customer-account");
  const value = input.value.trim();
  if (businessWorkspace.kind === "reseller") return value;
  if (businessWorkspace.id === "fiber-users" && portalCustomer?.username === value) return value;
  const normalized = value.toLowerCase().startsWith(FIBERNETLB_ACCOUNT_PREFIX) ? value : `${FIBERNETLB_ACCOUNT_PREFIX}${value}`;
  input.value = normalized;
  return normalized;
}

function updatePricePreview() {
  const cost = Number($("#product-cost").value) || 0;
  const price = Number($("#product-price").value) || 0;
  const selectedCurrency = $("#product-currency").value;
  const markup = cost > 0 ? ((price - cost) / cost) * 100 : 0;
  $("#product-markup").value = Number.isFinite(markup) ? Math.round((markup + Number.EPSILON) * 100) / 100 : 0;
  $("#price-preview").textContent = formatProductMoney(price, selectedCurrency);
  const converted = selectedCurrency === "LBP" ? formatMoney(price / USD_TO_LBP) : formatLbp(price * USD_TO_LBP);
  $("#price-preview-secondary").textContent = `${converted} · ${Number(markup || 0).toFixed(2)}% markup`;
}
function updateProductCurrency(convertValue = true) {
  const select = $("#product-currency");
  const current = select.value;
  const previous = select.dataset.previous || current;
  if (convertValue && previous !== current) {
    for (const selector of ["#product-cost", "#product-price"]) {
      const input = $(selector);
      const value = Number(input.value) || 0;
      input.value = current === "LBP" ? String(Math.round(value * USD_TO_LBP)) : String(Math.round((value / USD_TO_LBP + Number.EPSILON) * 100) / 100);
    }
  }
  select.dataset.previous = current;
  for (const selector of ["#product-cost", "#product-price"]) $(selector).step = current === "LBP" ? "1" : "0.01";
  $("#product-cost-label").textContent = `Cost price (${current})`;
  $("#product-price-label").textContent = `${$("#product-category").value === "Printing" ? "A4 B/W reference price" : "Selling price"} (${current})`;
  $("#printing-currency-badge").textContent = "LBP";
  $("#printing-currency-badge").className = "currency-badge currency-lbp";
  if ($("#product-category").value === "Printing") syncPrintingBasePrice(); else updatePricePreview();
}
function updateBarcodePreview() { $("#barcode-preview strong").textContent = $("#product-barcode").value.trim() || "Generated on save"; }
function updateProductInventoryMode() {
  const isPrinting = $("#product-category").value === "Printing";
  const isMaintenance = $("#product-category").value === "Maintenance";
  const isPhotos = productFormWorkspace() === "studio" && $("#product-category").value.trim().toLowerCase() === "photos and shooting";
  const isNonStock = isPrinting || isMaintenance || isPhotos;
  $("#product-quantity-field").classList.toggle("hidden", isNonStock);
  $("#product-reorder-field").classList.toggle("hidden", isNonStock);
  $("#product-nonstock-note").classList.toggle("hidden", !isNonStock);
  $("#printing-pricing-fields").classList.toggle("hidden", !isPrinting);
  $("#printing-cost-note").classList.toggle("hidden", !isPrinting);
  $$("#custom-printing-types input").forEach(input => { input.disabled = !isPrinting || state.currentUser?.role !== "admin"; input.required = isPrinting; });
  $("#product-quantity").required = !isNonStock;
  $("#product-reorder").required = !isNonStock;
  $("#product-price").readOnly = isPrinting;
  if (isNonStock) {
    $("#product-quantity").value = 0;
    $("#product-reorder").value = 0;
  }
  if (isNonStock) {
    $("#product-nonstock-title").textContent = isPhotos ? "Photos and shooting is a non-stock service." : isPrinting ? "Printing is a non-stock service." : "Maintenance is a non-stock service.";
    $("#product-nonstock-description").textContent = isPhotos ? "Sell photo and shooting services without a stock count. The number of services sold is still recorded on each receipt." : isPrinting ? "It can be sold without counting paper quantity and never shows as out of stock." : "It can be sold without counting jobs or parts and never shows as out of stock.";
  }
  updateProductCurrency(false);
}

function openExpenseCategoryDialog() {
  $("#expense-category-form").reset();
  renderExpenseCategoryManager();
  $("#expense-category-dialog").showModal();
  setTimeout(() => $("#new-expense-category").focus(), 50);
}

function stockedProducts() { return state.products.filter((product) => product.trackQuantity); }

function renderPurchaseTotal() {
  const total = state.purchaseDraft.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);
  $("#purchase-form-total").textContent = formatMoney(total);
  syncSpendingWhishFee("purchase");
}

function renderPurchaseLines() {
  const products = stockedProducts();
  $("#purchase-lines").innerHTML = state.purchaseDraft.length
    ? state.purchaseDraft.map((line, index) => `<div class="purchase-line" data-index="${index}"><label class="purchase-product-field">Product<select class="purchase-product" required>${products.map((product) => `<option value="${product.id}" ${Number(product.id) === Number(line.productId) ? "selected" : ""}>${escapeHtml(product.name)} — ${escapeHtml(product.sku)} (${product.quantity} in stock)</option>`).join("")}</select></label><label>Quantity<input class="purchase-quantity" type="number" min="1" step="1" value="${Number(line.quantity) || 1}" required /></label><label>Unit cost (USD)<input class="purchase-unit-cost" type="number" min="0" step="0.01" value="${Number(line.unitCost || 0).toFixed(2)}" required /></label><div class="purchase-line-total"><strong>${formatMoney((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}</strong></div><button type="button" class="icon-button delete remove-purchase-line" data-index="${index}" aria-label="Remove product" title="Remove product">${icon("trash")}</button></div>`).join("")
    : `<div class="empty-state"><div><strong>No products on this receipt</strong><p>Use Add product to create a receipt line.</p></div></div>`;
  renderPurchaseTotal();
}

function addPurchaseLine() {
  const products = stockedProducts();
  if (!products.length) return showToast("Add an inventory-tracked product before recording a purchase.", "error");
  const unused = products.find((product) => !state.purchaseDraft.some((line) => Number(line.productId) === Number(product.id))) || products[0];
  state.purchaseDraft.push({ productId: Number(unused.id), quantity: 1, unitCost: Number(unused.costUsd) || 0 });
  renderPurchaseLines();
}

function openPurchaseDialog() {
  if (!stockedProducts().length) return showToast("Add an inventory product before recording a purchase receipt.", "error");
  $("#purchase-form").reset();
  $("#purchase-date").value = localDate();
  if (state.expenseCategories.some((category) => category.name === "Product purchases")) $("#purchase-category").value = "Product purchases";
  state.purchaseDraft = [];
  addPurchaseLine();
  $("#purchase-dialog").showModal();
  setTimeout(() => $("#purchase-receipt-number").focus(), 50);
}

function selectedPrintingOptions() {
  const size = $("#printing-size").value || "A4";
  return { size, service: size.startsWith("custom:") ? "custom" : $("#printing-service").value || "bw" };
}

function printingSelection(product, options = selectedPrintingOptions()) {
  const table = normalizedPrintPriceTable(product.printPriceTable);
  const custom = PrintingPricing.customSelection(table, options.size);
  if (custom) return { options: custom.options, priceUsd: Math.round((custom.unitPrice / USD_TO_LBP + Number.EPSILON) * 100) / 100, priceLbp: custom.unitPrice, available: custom.unitPrice > 0, description: custom.description, costKnown: false };
  const priceLbp = Number(table?.[options.size]?.[options.service]) || 0;
  const service = PRINT_SERVICES.find((item) => item.key === options.service);
  const priceUsd = Math.round((priceLbp / USD_TO_LBP + Number.EPSILON) * 100) / 100;
  return { options, priceUsd, priceLbp, available: priceLbp > 0, description: `${options.size} · ${service?.label || "Printing"}` };
}

function refreshPrintingServiceOptions(product, preferredService = "") {
  const size = $("#printing-size").value || "A4";
  const table = normalizedPrintPriceTable(product.printPriceTable);
  const custom = size.startsWith("custom:");
  $("#printing-service-field").classList.toggle("hidden", custom);
  $("#printing-service").disabled = custom;
  if (custom) { $("#printing-service").innerHTML = '<option value="custom">Custom printing</option>'; return; }
  const previous = preferredService || $("#printing-service").value;
  $("#printing-service").innerHTML = PRINT_SERVICES.map((service) => {
    const price = Number(table[size][service.key]) || 0;
    return `<option value="${service.key}" ${price <= 0 ? "disabled" : ""}>${escapeHtml(service.label)} — ${price > 0 ? formatLbp(price) : "Unavailable"}</option>`;
  }).join("");
  const preferredAvailable = PRINT_SERVICES.some((service) => service.key === previous && Number(table[size][service.key]) > 0);
  $("#printing-service").value = preferredAvailable ? previous : PRINT_SERVICES.find((service) => Number(table[size][service.key]) > 0)?.key || "";
}

function updatePrintingOptionsPreview() {
  const product = posProduct($("#printing-options-product-id").value);
  if (!product) return;
  const selection = printingSelection(product);
  const quantity = Math.max(Number($("#printing-quantity").value) || 1, 1);
  $("#printing-selection-summary").textContent = selection.description;
  $("#printing-total-lbp").textContent = formatLbp(selection.priceLbp * quantity);
  $("#printing-total-usd").textContent = formatMoney(Math.round((selection.priceUsd * quantity + Number.EPSILON) * 100) / 100);
  $("#printing-availability-note").textContent = selection.available ? selection.costKnown === false ? "Admin unit price · Non-stock · Cost unknown; profit excludes this unmeasured cost." : "Price from this product's A5/A4/A3 table" : "This type is not priced yet. Ask an admin to set its price or choose another type.";
  $("#printing-option-submit").disabled = !selection.available;
}

function openPrintingOptions(product) {
  if (isMainCatalogAdmin() && (adminInventory.checkoutBusy||adminInventory.uncertain||product.workspaceId!==adminInventory.source)) return;
  $("#printing-options-form").reset();
  $("#printing-options-product-id").value = product.id;
  $("#printing-options-dialog").dataset.productWorkspace=product.workspaceId||businessWorkspace.id;
  $("#printing-options-title").textContent = product.name;
  const table = normalizedPrintPriceTable(product.printPriceTable);
  $("#printing-size").innerHTML = PRINT_SIZES.map(size => `<option value="${size}">${size}</option>`).join("") + table.custom.map(item => `<option value="custom:${escapeHtml(item.key)}">${escapeHtml(item.name)} — ${item.price > 0 ? formatLbp(item.price) : "Set price first"}</option>`).join("");
  const availableSize = Object.values(table.A4).some(price => price > 0) ? "A4" : PRINT_SIZES.find(size => Object.values(table[size]).some(price => price > 0));
  $("#printing-size").value = availableSize || `custom:${table.custom.find(item => item.price > 0)?.key || "id-photo"}`;
  $("#printing-quantity").value = 1;
  refreshPrintingServiceOptions(product, "bw");
  updatePrintingOptionsPreview();
  $("#printing-options-dialog").showModal();
}

function addToCart(id) {
  if (!has('sales.create') || (isMainCatalogAdmin()&&(!adminInventory.loaded||!adminInventory.source||adminInventory.checkoutBusy||adminInventory.uncertain))) return false;
  const product = posProduct(id);
  if (!product || (product.trackQuantity && product.quantity <= 0)) return;
  if (isMainCatalogAdmin()&&state.cart.some(item=>item.workspaceId!==product.workspaceId)) return showToast("Finish or clear this business's cart before selling another business's products.","error");
  if (String(product.category).toLowerCase() === "printing") { openPrintingOptions(product); return false; }
  const key = `product:${productKey(product)}`;
  const existing = state.cart.find((item) => item.key === key);
  if (existing) { if (existing.trackQuantity && existing.quantity >= product.quantity) return showToast(`Only ${product.quantity} available.`, "error"); existing.quantity += 1; }
  else state.cart.push({ key, id: product.id, ...(isMainCatalogAdmin()?{workspaceId:product.workspaceId}:{}), name: product.name, variantDescription: "", printingOptions: null, priceUsd: Number(product.priceUsd), priceLbp: Number(product.priceLbp), quantity: 1, stock: product.quantity, trackQuantity: product.trackQuantity });
  renderCart();
  return true;
}

function changeCartQuantity(key, change) { if(isMainCatalogAdmin()&&(adminInventory.checkoutBusy||adminInventory.uncertain))return;const item = state.cart.find((entry) => entry.key === key); if (!item) return; const next = item.quantity + change; if (next <= 0) state.cart = state.cart.filter((entry) => entry.key !== key); else if (item.trackQuantity && next > item.stock) showToast(`Only ${item.stock} available.`, "error"); else item.quantity = next; renderCart(); }

function barcodeSvg(code) {
  if (!/^\d{13}$/.test(code)) return `<p class="subtext">Numeric barcode: ${escapeHtml(code)}</p>`;
  const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  let bits = "101";
  for (let index = 1; index <= 6; index += 1) bits += parity[Number(code[0])][index - 1] === "L" ? L[Number(code[index])] : G[Number(code[index])];
  bits += "01010";
  for (let index = 7; index <= 12; index += 1) bits += R[Number(code[index])];
  bits += "101";
  const rects = [...bits].map((bit, index) => bit === "1" ? `<rect x="${index + 10}" y="2" width="1" height="${index < 3 || (index >= 45 && index < 50) || index >= 92 ? 64 : 57}"/>` : "").join("");
  return `<svg viewBox="0 0 115 72" xmlns="http://www.w3.org/2000/svg" aria-label="Barcode ${escapeHtml(code)}"><g fill="#071725">${rects}</g></svg>`;
}

function showBarcode(product) { if(!product)return;const code = product.barcodes[0]; $("#barcode-product-name").textContent = `${product.name}${isMainCatalogAdmin()?` · ${product.workspaceName}`:""}`; $("#barcode-number").textContent = code; $("#barcode-sku").textContent = `${product.sku}${product.barcodes.length > 1 ? ` · ${product.barcodes.length} accepted barcodes` : ""}`; $("#barcode-svg").innerHTML = barcodeSvg(code); $("#barcode-dialog").showModal(); }

function selectPayment(groupName, hiddenSelector, value = "Cash") {
  const radio = $(`input[name='${groupName}'][value='${value}']`) || $(`input[name='${groupName}'][value='Cash']`);
  if (radio) radio.checked = true;
  $(hiddenSelector).value = radio?.value || "Cash";
  WhishPayments.sync();
}

function updatePosPayment() {
  const method = $("input[name='pos-payment']:checked")?.value || "Cash";
  $("#payment-method").value = method;
  const unpaid = method === "Unpaid";
  $("#pos-debt-fields").classList.toggle("hidden", !unpaid);
  $("#pos-customer-name").required = unpaid;
}

function updateBillPayment() {
  const method = $("input[name='bill-payment']:checked")?.value || "Cash";
  $("#bill-payment-method").value = method;
  $("#bill-payment-note").textContent = method === "Cash" ? "Cash payments are added to the cash drawer." : method === "Whish Money" ? "The full customer payment settles the bill and enters the selected wallet. Its 1% fee reduces net profit only, not the wallet balance. Cash-out has no additional fee." : "The full bill stays as customer debt. No cash or Whish is received until payment. Save debt & Renew renews now; Save debt only records it without renewing.";
  updatePortalCustomerSummary();
}

function openCashDrawerDialog() {
  if (isAllBusinessDashboard()) return showToast("Combined balances are read-only. Open a specific business to count its drawer.", "error");
  $("#cash-drawer-form").reset();
  $("#cash-drawer-balance").value = Number(state.drawer?.balance || 0).toFixed(2);
  $("#cash-drawer-dialog").showModal();
  setTimeout(() => $("#cash-drawer-balance").select(), 50);
}

function openSettleDebtDialog(debt) {
  $("#settle-debt-kind").value=debt.kind; $("#settle-debt-id").value=debt.id;
  const remaining=Number(debt.remainingAmount ?? debt.amount);
  $("#settle-debt-summary").textContent=`${debt.referenceNo} · ${debt.customerName || "Customer"} · Original ${formatMoney(debt.originalAmount ?? debt.amount)} · Paid ${formatMoney(debt.paidAmount || 0)} · Remaining ${formatMoney(remaining)}`;
  $("#settle-amount").value=remaining.toFixed(2); $("#settle-amount").max=remaining.toFixed(2); $("#settle-amount").dataset.remaining=remaining;
  $("#settle-request-id").value=crypto.randomUUID();
  selectPayment("settle-payment","#settle-payment-method","Cash");
  updateDebtPreview(); $("#settle-debt-dialog").showModal();
}
function updateDebtPreview() {
  const remaining=Number($("#settle-amount").dataset.remaining || 0),amount=Number($("#settle-amount").value);
  const whish=WhishPayments.preview(amount,$('#settle-payment-method').value);
  $("#settle-payment-preview").textContent=amount>0 && amount<=remaining ? `Receive ${formatMoney(amount)} · Remaining after payment: ${formatMoney(remaining-amount)}${whish?' · '+whish.note:''}` : "Enter an amount between $0.01 and the remaining debt.";
}
function showDebtHistory(debt) {
  $("#debt-history-summary").textContent=`${debt.referenceNo} · ${debt.customerName || "Customer"} · Original ${formatMoney(debt.originalAmount ?? debt.amount)} · Paid ${formatMoney(debt.paidAmount || 0)} · Remaining ${formatMoney(debt.remainingAmount ?? debt.amount)}`;
  $("#debt-history-body").innerHTML=(debt.payments || []).map(payment=>`<tr><td>${dateTimeFormatter.format(new Date(payment.receivedAt))}</td><td>${paymentBadge(payment.paymentMethod)}</td><td class="number">${formatMoney(payment.amount)}</td><td class="number">${formatMoney(payment.remainingAfter)}</td><td>${escapeHtml(payment.cashierName)}</td></tr>`).join("") || emptyRow(5,"No payments collected yet");
  $("#debt-history-dialog").showModal();
}

function renderReceipt(type, record) {
  window.ReceiptPaper.apply(businessWorkspace.id);
  renderReceiptCredentials();
  const isSale = type === "sale";
  const isTelecom = type === "telecom";
  const isRefund = type === "bill" && Number(record.amount)<0;
  const number = isSale ? record.invoiceNo : record.receiptNo;
  const createdAt = isSale ? record.createdAt : record.paidAt;
  const customer = record.customerName || "Walk-in customer";
  const detail = isSale ? [record.customerAccount, record.customerPhone].filter(Boolean).join(" · ") : isTelecom ? [record.provider, record.phone].filter(Boolean).join(" · ") : [record.customerAccount, record.phone].filter(Boolean).join(" · ");
  const items = isSale
    ? record.items || []
    : isTelecom
      ? [{ name: `${record.itemName || `${record.provider} ${record.transactionType}`}${record.billingPeriod ? ` · ${record.billingPeriod}` : ""}`, variantDescription: record.itemDetails || "", quantity: 1, unitPrice: Number(record.amount), lineTotal: Number(record.amount) }]
      : [{ name: `${record.bundleName || record.serviceType}${record.billingPeriod ? ` · ${record.billingPeriod}` : ""}`, variantDescription: record.serviceType==="Internet"?`${record.renewalMonths??1} renewal month(s)`:"", quantity: 1, unitPrice: Number(record.amount), lineTotal: Number(record.amount) }];
  const saleItemLbp = (item, originalField, usdField) => Math.round(Number(item[originalField] ?? item[usdField]) * (item.priceCurrency === "LBP" ? 1 : Number(item.exchangeRate || USD_TO_LBP)));
  const receiptBusiness=state.activeReceipt?.adminReceivableReadOnly?record.workspaceName:isMainCatalogAdmin()&&isSale?record.workspaceName:businessWorkspace.name;
  $("#receipt-type").textContent = `${receiptBusiness} · ${isRefund?"PLAN CHANGE REFUND":isSale ? "POINT OF SALE RECEIPT" : isTelecom ? "MOBILE & OGERO RECEIPT" : businessWorkspace.kind === "reseller" ? "RESELLER TRANSFER" : "SERVICE RECEIPT"}`;
  $("#receipt-number").textContent = number;
  if(type==='installation')$('#receipt-type').textContent=`${businessWorkspace.name} · INSTALLATION RECEIPT`;
  $("#receipt-date").textContent = dateTimeFormatter.format(new Date(createdAt));
  $("#receipt-cashier").textContent = record.cashierName || state.currentUser?.fullName || "—";
  $("#receipt-customer").textContent = customer;
  $("#receipt-customer-detail").textContent = detail || "—";
  $("#receipt-items").innerHTML = items.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong>${item.variantDescription ? `<small class="receipt-item-variant">${escapeHtml(item.variantDescription)}</small>` : ""}</td><td class="number">${Number(item.quantity)}</td><td class="number">${isSale ? formatLbp(saleItemLbp(item, "unitPriceOriginal", "unitPrice")) : formatMoney(item.unitPrice)}</td><td class="number"><strong>${isSale ? formatLbp(saleItemLbp(item, "lineTotalOriginal", "lineTotal")) : formatMoney(item.lineTotal)}</strong></td></tr>`).join("");
  $("#receipt-total-label").textContent=isRefund?"Refund amount":"Total";
  $("#receipt-paid-label").textContent=isRefund?"Total refunded (USD)":"Total paid (USD)";
  $("#receipt-total").textContent = isSale ? `${formatLbp(record.subtotalLbp ?? Number(record.subtotal) * USD_TO_LBP)} / ${formatMoney(record.subtotal)}` : formatMoney(isRefund?-Number(record.amount):record.amount);
  const unpaid = ["unpaid","partial"].includes(record.paymentStatus);
  $("#receipt-payment").className = `receipt-payment${unpaid ? " debt" : ""}`;
  $("#receipt-payment").innerHTML = `${icon(paymentIcon(unpaid ? "Unpaid" : record.paymentMethod))}<span>${isRefund?`REFUNDED BY ${escapeHtml(record.paymentMethod).toUpperCase()}`:record.paymentStatus === "partial" ? "PARTIALLY PAID — BALANCE DUE" : unpaid ? "UNPAID — CUSTOMER DEBT" : `PAID BY ${escapeHtml(record.paymentMethod).toUpperCase()}`}</span>`;
  $('#receipt-payment').insertAdjacentHTML('beforeend',WhishPayments.details(record.expenseFunding||record));
  const total=Number(record.subtotal ?? record.amount ?? 0),paid=Number(record.paidAmount ?? (unpaid ? 0 : total));
  $("#receipt-paid-total").textContent=formatMoney(isRefund?-paid:paid); $("#receipt-remaining-total").textContent=formatMoney(record.remainingAmount ?? total-paid);
  $("#receipt-note").textContent = isSale ? "" : isTelecom ? [record.provider, record.transactionType, record.itemDetails, record.reference].filter(Boolean).join(" · ") : [record.serviceType, record.bundleDetails, record.reference].filter(Boolean).join(" · ");
  if (!isSale && !isTelecom && businessWorkspace.id === "fiber-users" && record.serviceType === "Internet") $("#receipt-note").textContent += ` · ${renewalLabel(record.renewal?.state)}${record.renewal?.afterExpiry ? ` · Expiry ${record.renewal.afterExpiry}` : ""}`;
  if(record.renewal?.state==='free'){
    const funding=record.expenseFunding,amount=Number(funding?.amount||0);
    $('#receipt-items').insertAdjacentHTML('beforeend',`<tr><td><strong>Expense funding · not Internet revenue</strong><small>${escapeHtml(funding?.receiptNo||'No payment received')}</small></td><td class="number">1</td><td class="number">${formatMoney(amount)}</td><td class="number"><strong>${formatMoney(amount)}</strong></td></tr>`);
    $('#receipt-total-label').textContent='Expense funding received';$('#receipt-total').textContent=formatMoney(amount);$('#receipt-paid-total').textContent=formatMoney(amount);$('#receipt-remaining-total').textContent=formatMoney(0);
    $('#receipt-note').textContent+=' · Internet service $0.00 · Funding covers company expenses, separate from Internet-bill revenue.';
  }
  $("#printable-receipt").dataset.receiptNumber = number;
}

function showReceipt(type, record, adminReceivableReadOnly = false) {
  if(type==='sale'&&(record?.deleted||record?.invoiceDeleted))return showToast('This invoice was deleted and reversed. Use its preserved audit copy instead of an active receipt.','error');
  if(adminReceivableReadOnly&&(!isMainAdmin()||record?.adminReceivableReadOnly!==true||!record.workspaceId||!record.workspaceName||!record.debtKey))return showToast("The original debt receipt could not be verified.","error");
  if(!adminReceivableReadOnly&&isMainCatalogAdmin()&&type==='sale'&&(!catalogWorkspace(record?.workspaceId)||!record.workspaceName))return showToast("The receipt's original business is missing. Open that business's Reports instead.","error");
  clearReceiptCredentials();
  state.activeReceipt = { type, record: JSON.parse(JSON.stringify(record)), adminReceivableReadOnly };
  window.InvoiceVoids?.setReceipt(type,record);
  $('#share-receipt').classList.toggle('hidden',adminReceivableReadOnly);
  window.ReceiptPaper.open();
  renderReceipt(state.activeReceipt.type, state.activeReceipt.record);
  if (!$("#receipt-dialog").open) $("#receipt-dialog").showModal();
  loadReceiptCredentials(state.activeReceipt);
}

function clearAdminReceivableReceipt() {
  if(!state.activeReceipt?.adminReceivableReadOnly)return;
  clearReceiptCredentials();state.activeReceipt=null;
  if($('#receipt-dialog').open)$('#receipt-dialog').close();
  for(const id of ['receipt-type','receipt-number','receipt-date','receipt-cashier','receipt-customer','receipt-customer-detail','receipt-items','receipt-total','receipt-paid-total','receipt-remaining-total','receipt-payment','receipt-note'])$(`#${id}`).textContent='';
  $('#share-receipt').classList.remove('hidden');
}

function clearReceiptCredentials() {
  if (state.activeReceipt) state.activeReceipt.credentials = null;
  $("#receipt-internet-username").textContent = "";
  $("#receipt-internet-password").textContent = "";
  $("#receipt-credential-status").textContent = "";
  $("#receipt-internet-credentials").classList.add("hidden");
  $("#retry-receipt-credentials").classList.add("hidden");
}

function renderReceiptCredentials() {
  const receipt = state.activeReceipt;
  const internet = receipt?.type === "bill" && receipt.record.serviceType === "Internet" && businessWorkspace.id === "fiber-users";
  $("#receipt-internet-credentials").classList.toggle("hidden", !internet);
  $("#receipt-internet-username").textContent = internet ? receipt.record.customerAccount : "";
  $("#receipt-internet-password").textContent = internet ? receipt.credentials?.password || (receipt.credentialLoading ? "Loading…" : "Unavailable") : "";
  $("#receipt-credential-status").textContent = internet && receipt.credentialError ? receipt.credentialError : "";
  $("#retry-receipt-credentials").classList.toggle("hidden", !internet || !receipt.credentialError || !api.bills.receiptCredentials);
}

async function loadReceiptCredentials(receipt) {
  if(receipt?.adminReceivableReadOnly)return;
  if (receipt?.type !== "bill" || receipt.record.serviceType !== "Internet" || businessWorkspace.id !== "fiber-users") return;
  if (receipt.credentialLoading) return receipt.credentialPromise;
  receipt.credentialLoading = true; receipt.credentialError = ""; renderReceiptCredentials();
  receipt.credentialPromise = (async () => {
    try {
      if (!api.bills.receiptCredentials) throw Error("Customer password lookup is unavailable.");
      const credentials = await api.bills.receiptCredentials(receipt.record.id);
      if (state.activeReceipt !== receipt || !$("#receipt-dialog").open) return;
      if (credentials.username !== receipt.record.customerAccount || typeof credentials.password !== "string") throw Error("The customer credentials do not match this receipt.");
      receipt.credentials = {username:credentials.username,password:credentials.password};
    } catch (error) {
      if (state.activeReceipt === receipt) receipt.credentialError = errorMessage(error);
    } finally {
      receipt.credentialLoading = false;
      if (state.activeReceipt === receipt) renderReceiptCredentials();
    }
  })();
  return receipt.credentialPromise;
}

function printTarget(target) {
  document.body.dataset.printTarget = target;
  window.print();
}

async function printCurrentReceipt() {
  if (receiptPrintPending) return;
  if (!state.activeReceipt) return showToast("Open a receipt before printing.", "error");
  const receipt = state.activeReceipt;
  receiptPrintPending = true;
  window.ReceiptPaper.setBusy(true);
  try {
  if (receipt.credentialPromise) await receipt.credentialPromise;
  if (state.activeReceipt !== receipt || !$("#receipt-dialog").open) return;
  renderReceipt(receipt.type, receipt.record);
  const paper = $("#printable-receipt");
  void paper.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (state.activeReceipt !== receipt || !$("#receipt-dialog").open) return;
  if (businessWorkspace.id === 'fiber-users') {
    document.body.dataset.printTarget = 'receipt';
    try { await window.ReceiptPaper.print(); }
    finally { if (document.body.dataset.printTarget === 'receipt') delete document.body.dataset.printTarget; }
  } else printTarget("receipt");
  } finally { receiptPrintPending = false; window.ReceiptPaper.setBusy(false); }
}

let whatsappDraft=null;
async function prepareWhatsAppReceipt(){
  whatsappDraft=null;
  const receipt=state.activeReceipt;if(!receipt)throw Error('Open a saved receipt first.');
  if(receipt.adminReceivableReadOnly)throw Error('Open the original business to share this debt receipt.');
  const phone=$('#whatsapp-phone').value,draft=isMainCatalogAdmin()&&receipt.type==='sale'
    ? await api.adminCatalog.whatsapp({workspaceId:receipt.record.workspaceId,saleId:receipt.record.id,phone})
    : await api.receipts.whatsapp({kind:receipt.type,id:receipt.record.id,phone});
  // Never share a different receipt if another form opened while preparing.
  if(receipt!==state.activeReceipt||phone!==$('#whatsapp-phone').value||!$('#whatsapp-dialog').open)throw Error('The receipt or phone number changed. Preview it again.');
  whatsappDraft=draft;$('#whatsapp-preview').value=draft.message;return draft;
}
async function showWhatsAppReceipt(){
  if(!state.activeReceipt)return showToast('Open a receipt first.','error');
  if(state.activeReceipt.adminReceivableReadOnly)return showToast('Open the original business to share this debt receipt.','error');
  whatsappDraft=null;$('#whatsapp-preview').value='Enter the customer phone number, then preview the saved receipt.';
  const record=state.activeReceipt.record;$('#whatsapp-phone').value=record.customerPhone||record.phone||'';
  $('#whatsapp-dialog').showModal();
  if($('#whatsapp-phone').value)try{await prepareWhatsAppReceipt();}catch(error){showToast(errorMessage(error),'error');}
  $('#whatsapp-phone').focus();
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderUpdateStatus(status) {
  state.updateStatus = status;
  if(api.web){
    $('#updates-button').classList.remove('hidden');$('#login-update-button').classList.remove('hidden');
    $('#updates-button-label').textContent=status?.available?'Refresh required':'Website version';$('#login-update-button').textContent=status?.available?'Refresh required':'Website version';
    $('#update-dialog h2').textContent='FIBER net lb website';
    $('#update-current-version').textContent=status?.currentVersion?'v'+status.currentVersion:'—';
    $('#update-target-label').textContent='Server version';$('#update-target-version').textContent=status?.serverVersion?'v'+status.serverVersion:'—';
    for(const id of ['update-repository-group','prepare-client-updates','client-update-sharing','download-update','update-progress-wrap','update-release-notes-wrap','rollback-panel'])$('#'+id).classList.add('website-only-hidden');
    $('#check-update').textContent='Refresh website';
    $('#update-status-title').textContent=status?.error?'Connection needs attention':status?.available?'Website refresh required':'Website version';
    $('#update-status-detail').textContent=status?.error||'Website updates are installed by your administrator. Save your current work before refreshing this page.';
    return;
  }
  const update = status?.update;
  const isMain = status?.mode === "server";
  const canManageMain = isMain && has("updates.manage");
  const shouldShowTopButton = canManageMain || status?.mode === "client";
  $("#updates-button").classList.toggle("hidden", !shouldShowTopButton);
  $("#login-update-button").classList.toggle("hidden", status?.mode !== "client");
  $("#updates-button-label").textContent = status?.available ? `Update ${update?.version || status.serverVersion || ""}`.trim() : "Updates";
  $("#update-current-version").textContent = status?.currentVersion ? `v${status.currentVersion}` : "—";
  $("#update-target-label").textContent = isMain ? "Latest GitHub release" : "Main PC version";
  $("#update-target-version").textContent = update?.version ? `v${update.version}` : status?.serverVersion ? `v${status.serverVersion}` : "—";
  $("#update-repository-group").classList.toggle("hidden", !canManageMain);
  if (canManageMain && document.activeElement !== $("#update-github-repository")) $("#update-github-repository").value = status.githubRepository || "";
  $('#prepare-client-updates').classList.toggle('hidden',!canManageMain||businessWorkspace.id!=='main');
  $('#prepare-client-updates').disabled=updateUiBusy||!status?.githubRepository;
  $('#client-update-sharing').classList.toggle('hidden',!canManageMain);
  $('#client-update-sharing').textContent=status?.clientUpdateReady?`Client installer v${status.currentVersion} is ready on Main. Older clients can use Updates or Update app at login.`:'After updating Main manually, use Prepare client updates to download its exact published GitHub version for clients. This does not reinstall Main. Main must stay running; clients use their configured Main address.';
  const notes = String(update?.releaseNotes || "").trim();
  $("#update-release-notes-wrap").classList.toggle("hidden", !notes);
  $("#update-release-notes").textContent = notes;
  const action = $("#download-update");
  action.classList.toggle("hidden", !status?.available);
  action.disabled = false;
  action.textContent = status?.prepared ? `Install v${update?.version}` : `Download and install v${update?.version}`;

  if (status?.error) {
    $("#update-status-title").textContent = "Update check needs attention";
    $("#update-status-detail").textContent = status.error;
  } else if (isMain && !status.githubRepository) {
    $("#update-status-title").textContent = "Connect a public GitHub repository";
    $("#update-status-detail").textContent = "Enter owner/repository above. Only the main PC connects to GitHub.";
  } else if (status?.available && status?.prepared) {
    $("#update-status-title").textContent = `Version ${update.version} is verified and ready`;
    $("#update-status-detail").textContent = isMain ? "Install it on the main PC first. After restart, clients will receive it over the LAN." : "The verified installer was downloaded from the main PC and is ready.";
  } else if (status?.available) {
    $("#update-status-title").textContent = `Version ${update.version} is available`;
    $("#update-status-detail").textContent = isMain ? `Download ${formatBytes(update.size)} once from GitHub, then install it on the main PC.` : `Download ${formatBytes(update.size)} from the main PC over the local network.`;
  } else {
    $("#update-status-title").textContent = "This computer is up to date";
    $("#update-status-detail").textContent = isMain ? "No newer published GitHub release was found." : "This client matches the main computer.";
  }
}

async function checkForUpdates(openDialog = false) {
  if(api.web){if(await confirmAppAction('Save your current work before refreshing the website. Pending request references are kept.','Refresh website','Refresh'))location.reload();return;}
  if (openDialog && !$("#update-dialog").open) $("#update-dialog").showModal();
  $("#check-update").disabled = true;
  $("#update-status-title").textContent = "Checking for updates…";
  try {
    const status = await api.updates.check();
    renderUpdateStatus(status);
    return status;
  } catch (error) {
    const fallback = { ...(state.updateStatus || {}), error: errorMessage(error) };
    renderUpdateStatus(fallback);
    if (openDialog) showToast(errorMessage(error), "error");
    return fallback;
  } finally {
    $("#check-update").disabled = false;
  }
}

async function openUpdateDialog() {
  if (!$("#update-dialog").open) $("#update-dialog").showModal();
  $('#rollback-panel').classList.add('hidden');
  if(api.rollback&&isMainAdmin()&&state.network?.mode==='server'){
    api.rollback.status().then(result=>{
      $('#rollback-panel').classList.remove('hidden');$('#rollback-warning').textContent=result.warning;
      $('#rollback-snapshot').innerHTML=result.snapshots.map(s=>`<option value="${escapeHtml(s.id)}" data-version="${escapeHtml(s.version)}">v${escapeHtml(s.version)} · ${escapeHtml(s.createdAt)} · ${s.databaseCount} databases</option>`).join('');
      $('#rollback-update').disabled=!result.snapshots.length;$('#rollback-result').textContent=result.snapshots.length?'A recovery copy of the newer data is made before restoring.':'No pre-update snapshots found. Installers from v1.32.0 create verified snapshots before replacing an existing installation.';
      $('#rollback-confirmation').value='';
    }).catch(()=>{});
  }
  try {
    const status = await api.updates.status();
    renderUpdateStatus(status);
    if ((status.mode === "client" && status.available) || (status.mode === "server" && status.githubRepository)) await checkForUpdates(false);
  } catch (error) {
    renderUpdateStatus({ ...(state.updateStatus || {}), error: errorMessage(error) });
  }
}

async function checkForUpdatesQuietly() {
  if(updateUiBusy||updateCheckBusy||$('#update-dialog').open)return;
  updateCheckBusy=true;
  try {
    const status = await api.updates.status();
    renderUpdateStatus(status);
    if (status.mode === "server" && has("updates.manage") && status.githubRepository) renderUpdateStatus(await api.updates.check());
  } catch {}finally{updateCheckBusy=false;}
}

async function downloadAndInstallUpdate() {
  if(updateUiBusy)return;
  const status = state.updateStatus;
  if (!status?.available || !status.update) return;
  const source = status.mode === "server" ? "GitHub" : "the main computer";
  if (!await confirmAppAction(`Install version ${status.update.version} from ${source}? The application will close during the update.`,"Install application update","Install update")) return;
  updateUiBusy=true;
  const button = $("#download-update");
  button.disabled = true;
  $("#check-update").disabled = true;
  try {
    if (!status.prepared) {
      $("#update-progress-wrap").classList.remove("hidden");
      $("#update-status-title").textContent = `Downloading version ${status.update.version}…`;
      const prepared = await api.updates.download();
      renderUpdateStatus({ ...status, update: prepared, available: true, prepared: true });
    }
    $("#update-status-title").textContent = "Starting verified installer…";
    $("#update-status-detail").textContent = status.mode === "server" ? "A database backup was created. Finish the installer, then reopen the main PC application." : "Finish the installer. This client will reconnect after it restarts.";
    await api.updates.install();
  } catch (error) {
    renderUpdateStatus({ ...status, error: errorMessage(error) });
    showToast(errorMessage(error), "error");
  } finally {
    updateUiBusy=false;
    button.disabled = false;
    $("#check-update").disabled = false;
  }
}

function bindEvents() {
  $("#refresh-cashier-reseller-collections").addEventListener("click",()=>loadCashierCollections());
  window.BackupView?.bind();
  $("#bill-settings-button").addEventListener("click",()=>openBillSettings().catch(error=>showToast(errorMessage(error),"error")));
  $("#report-clear-bills").addEventListener("click",()=>openBillSettings().catch(error=>showToast(errorMessage(error),"error")));
  $("#bill-reset-form").addEventListener("submit",async event=>{
    event.preventDefault();if(billResetSaving||!billResetState)return;
    billResetSaving=true;$("#bill-reset-submit").disabled=true;
    try {
      const closeConfirmedTestIds=$$('[data-reset-close-id]:checked').map(input=>input.dataset.resetCloseId);
      const result=await api.bills.reset({confirmation:$("#bill-reset-confirmation").value,note:$("#bill-reset-reason").value,token:billResetState.token,closeConfirmedTestIds,closeConfirmedAcknowledged:$('#bill-reset-close-ack').checked});
      portalCustomer=null;billRequestId=null;state.activeReceipt=null;
      await Promise.all([['internet','reseller','satellite'].includes(businessWorkspace.kind)?loadBills():businessWorkspace.kind==='telecom'?loadTelecomPayments():Promise.resolve(),loadDashboard(),loadDebts(),loadDrawer(),has('reports.view')?loadReport():Promise.resolve()]);
      await refreshBillSettings();$("#bill-reset-form").reset();
      $("#bill-reset-result").textContent=`${result.billCount} bills archived. ${result.finalizedCount||0} existing local recording flags finalized. ${result.closedTestCount||0} confirmed test actions closed without creating missing payments. Backup: ${result.backupPath}. Proradius services/charges were not changed.`;
      showToast("Test bills reset. Portal audit history retained; other business data kept.");
    } catch(error){const message=errorMessage(error);await refreshBillSettings().catch(()=>{});$("#bill-reset-result").textContent=message;showToast(message,"error");}
    finally{billResetSaving=false;updateBillResetReadiness();}
  });
  $('#bill-reset-actions-body').addEventListener('change',updateBillResetReadiness);
  $('#bill-reset-close-ack').addEventListener('change',updateBillResetReadiness);
  $('#bill-reset-actions-body').addEventListener('click',event=>{
    const button=event.target.closest('[data-reset-review-id]');if(!button||billResetSaving||billResetReviewSaving)return;
    billResetReview=billResetState?.blockers?.find(row=>row.id===button.dataset.resetReviewId&&row.source===button.dataset.resetReviewSource);
    if(!billResetReview||billResetReview.state!=='unknown')return;
    $('#bill-reset-review-form').reset();$('#bill-reset-review-result').textContent='';
    $('#bill-reset-review-summary').textContent=`${billResetReview.username} · ${billResetReview.kind} · ${billResetReview.recordedAt} · Ref ${billResetReview.id}`;
    $('#bill-reset-review-dialog').showModal();
  });
  $('#bill-reset-review-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!billResetReview||billResetReviewSaving||billResetSaving)return;
    const row=billResetReview,applied=$('#bill-reset-review-outcome').value==='applied',note=$('#bill-reset-review-note').value;
    billResetReviewSaving=true;$$('#bill-reset-review-form input, #bill-reset-review-form textarea, #bill-reset-review-form select, #bill-reset-review-form button').forEach(control=>control.disabled=true);
    try{
      if(row.source==='renewal')await api.bills.resolveRenewal(Number(row.id),{confirmation:applied?'RENEWED':'NOT RENEWED',note});
      else if(row.source==='plan')await api.portal.resolvePlan(row.id,{confirmation:applied?'PLAN CHANGED':'NOT CHANGED',note});
      else await api.portal.resolveOperation(row.id,{confirmation:applied?'APPLIED':'NOT APPLIED',note});
      $('#bill-reset-review-dialog').close();await Promise.all([refreshBillSettings(),loadBills(),loadDashboard(),loadDebts(),loadDrawer()]);
      showToast('Exact outcome saved. No new portal submission was made.');
    }catch(error){$('#bill-reset-review-result').textContent=errorMessage(error);}
    finally{billResetReviewSaving=false;$$('#bill-reset-review-form input, #bill-reset-review-form textarea, #bill-reset-review-form select, #bill-reset-review-form button').forEach(control=>control.disabled=false);updateBillResetReadiness();}
  });
  $('#bill-reset-review-dialog').addEventListener('cancel',event=>{if(billResetReviewSaving)event.preventDefault();});
  $('#bill-reset-review-dialog').addEventListener('close',()=>{billResetReview=null;});
  $("#bill-settings-dialog").addEventListener("cancel",event=>{if(billResetSaving)event.preventDefault();});
  $("#portal-confirm-accept").addEventListener("click",()=>$("#portal-confirm-dialog").close("confirmed"));
  $("#portal-confirm-cancel").addEventListener("click",()=>$("#portal-confirm-dialog").close("cancelled"));
  $("#portal-confirm-close").addEventListener("click",()=>$("#portal-confirm-dialog").close("cancelled"));
  bindPortalOperations();
  $("#portal-settings-button").addEventListener("click", () => openPortalSettings().catch(error=>showToast(errorMessage(error),"error")));
  $("#portal-settings-form").addEventListener("submit", async event => {
    event.preventDefault(); const button=$("#portal-settings-save"); button.disabled=true;
    try { const settings=await api.portal.configure({username:$("#portal-api-username").value,password:$("#portal-api-password").value}); $("#portal-api-password").value=""; renderPortalSettings(settings); showToast("Encrypted credentials saved. Complete the read-only customer test to enable renewals."); }
    catch(error){showToast(errorMessage(error),"error");} finally {button.disabled=false;}
  });
  $("#portal-test-form").addEventListener("submit", async event => {
    event.preventDefault(); const button=$("#portal-test-button"); button.disabled=true; $("#portal-settings-status").textContent="Testing customer lookup — no renewal will be sent…";
    try { const settings=await api.portal.test($("#portal-test-username").value.trim()); renderPortalSettings(settings); showToast(`Internet API enabled. Verified ${settings.customer.username}; no recharge performed.`); }
    catch(error){ $("#portal-settings-status").textContent=`Renewals remain disabled. ${errorMessage(error)}`; showToast(errorMessage(error),"error"); } finally {button.disabled=false;}
  });
  $("#portal-disable-button").addEventListener("click", async () => { try { renderPortalSettings(await api.portal.disable()); showToast("New Internet renewals disabled. Existing renewal and payment records are kept."); } catch(error){showToast(errorMessage(error),"error");} });
  $("#portal-settings-dialog").addEventListener("close",()=>{$("#portal-api-password").value="";});
  $("#bill-dialog").addEventListener("cancel", event => { if(billSaving)event.preventDefault(); });
  $("#bill-customer-account").addEventListener("input", () => { portalLookupVersion++; portalSelecting = false; updatePortalCustomerSummary(); });
  for(const event of ['input','change'])$("#portal-reseller-search").addEventListener(event, () => {
    portalLookupVersion++; portalSearchVersion++; portalSelecting=false; portalCustomer=null; portalSearchCustomers=[];
    $("#portal-search-results").innerHTML=""; updatePortalCustomerSummary();
  });
  for(const event of ['input','change'])$("#portal-customer-search").addEventListener(event, () => { portalSearchVersion++; portalSearchCustomers=[]; $("#portal-search-results").innerHTML=""; });
  $("#portal-plan-history").addEventListener("click", () => openPortalPlanHistory().catch(error=>showToast(errorMessage(error),"error")));
  $("#bill-service-type").addEventListener("change", updatePortalCustomerSummary);
  $("#bill-months").addEventListener("input",()=>{updateBillBundleOptions(true);updatePortalCustomerSummary();});
  $("#bill-amount").addEventListener("input",()=>{billAmountAutomatic=false;updateBillBundleNote();});
  $("#bill-use-prorated").addEventListener("click",()=>updateBillBundleOptions(true));
  $("#portal-search-button").addEventListener("click",searchPortalCustomers);
  $("#portal-customer-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();if(!$("#portal-search-button").disabled)$("#portal-search-button").click();}});
  $("#portal-search-results").addEventListener("click",async event=>{
    const button=event.target.closest("[data-portal-index]"); if(!button)return;
    const customer=portalSearchCustomers[Number(button.dataset.portalIndex)];if(!customer)return;button.disabled=true;
    try{await selectPortalCustomer(customer.username);}catch(error){showToast(errorMessage(error),"error");button.disabled=false;}
  });
  $("#portal-verify-button").addEventListener("click",async()=>{
    const button=$("#portal-verify-button");button.disabled=true;
    try{await selectPortalCustomer($("#bill-customer-account").value.trim());}catch(error){portalCustomer=null;updatePortalCustomerSummary();showToast(errorMessage(error),"error");}finally{updatePortalCustomerSummary();}
  });
  $("#renewal-review-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector("[type='submit']");button.disabled=true;
    try {
      const input={confirmation:$("#renewal-review-confirmation").value,note:$("#renewal-review-note").value};
      if($("#renewal-review-kind").value==="plan")await api.portal.resolvePlan($("#renewal-review-id").value,input);
      else await api.bills.resolveRenewal(Number($("#renewal-review-id").value),input);
      $("#renewal-history-dialog").close();await loadBills();showToast("Verified portal outcome saved with an administrator audit note.");
    }
    catch(error){showToast(errorMessage(error),"error");}finally{button.disabled=false;}
  });
  $("#debts-include-paid").addEventListener("change",()=>loadDebts().catch(error=>showToast(errorMessage(error),"error")));
  $("#settle-amount").addEventListener("input",updateDebtPreview);
  $("#settle-pay-full").addEventListener("click",()=>{$("#settle-amount").value=Number($("#settle-amount").dataset.remaining).toFixed(2);updateDebtPreview();});
  $("#debts-body").addEventListener("click",event=>{const button=event.target.closest(".debt-history");if(button){const debt=state.debts.find(d=>d.kind===button.dataset.kind && d.id===Number(button.dataset.id));if(debt)showDebtHistory(debt);}});
  $("#user-role").addEventListener("change",updateUserAccessRole);
  $('#user-feature-defaults').addEventListener('click',()=>{$$('#user-feature-permissions input').forEach(input=>input.checked=true);});
  $('#user-delete-confirmation').addEventListener('input',()=>{$('#user-delete-submit').disabled=$('#user-delete-confirmation').value!==$('#user-delete-confirmation').dataset.username;});
  $('#user-delete-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#user-delete-submit');if(button.disabled)return;
    button.disabled=true;$('#user-delete-error').textContent='';
    try{await api.users.remove($('#user-delete-key').value,$('#user-delete-confirmation').value);$('#user-delete-dialog').close();await loadUsers();showToast('Application user deleted. Login removed in every section; historical transactions kept.');}
    catch(error){$('#user-delete-error').textContent=errorMessage(error);button.disabled=false;}
  });
  $("#open-fresh-start").addEventListener("click", () => { $("#fresh-start-form").reset(); $("#fresh-start-submit").disabled = true; $("#fresh-start-dialog").showModal(); });
  $("#fresh-start-confirmation").addEventListener("input", () => { $("#fresh-start-submit").disabled = $("#fresh-start-confirmation").value !== "START FRESH"; });
  $("#fresh-start-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#fresh-start-submit"); button.disabled = true;
    try {
      const result = await api.workspace.reset($("#fresh-start-confirmation").value);
      $("#fresh-start-dialog").close(); state.cart = []; state.activeReceipt = null; renderCart();
      await startApp(state.currentUser);
      showToast(`Business records cleared. Users kept. Backup: ${result.backupPath}`);
    } catch (error) { button.disabled = false; showToast(errorMessage(error), "error"); }
  });
  $$("input[name='network-mode']").forEach((radio) => radio.addEventListener("change", updateNetworkChoice));
  $("#network-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = $("input[name='network-mode']:checked")?.value;
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    try {
      submitButton.disabled = true;
      submitButton.textContent = mode === "client" ? "Testing connection..." : "Saving...";
      await api.network.configure({ mode, serverUrl: $("#network-server-url").value });
      submitButton.textContent = "Restarting...";
      await api.network.restart();
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Save and restart";
      showToast(errorMessage(error), "error");
    }
  });
  $("#cancel-network-setup").addEventListener("click", () => {
    $("#network-screen").classList.add("hidden");
    if (state.networkReturn === "app" && state.currentUser) $("#app-shell").classList.remove("hidden");
    else $("#auth-screen").classList.remove("hidden");
  });
  $("#change-network-login").addEventListener("click", () => showNetworkSetup(true));
  $("#network-settings-button").addEventListener("click", () => showNetworkSetup(true));
  $("#updates-button").addEventListener("click", openUpdateDialog);
  $('#rollback-update').addEventListener('click',async()=>{
    if(updateUiBusy||!isMainAdmin())return;
    const selected=$('#rollback-snapshot').selectedOptions[0];if(!selected)return;
    if($('#rollback-confirmation').value!==`RESTORE ${selected.dataset.version}`){$('#rollback-result').textContent=`Type RESTORE ${selected.dataset.version} exactly.`;return;}
    if(!await confirmAppAction('Restore the old program AND exact pre-update databases? Payments and changes after that snapshot will no longer be active. Proradius renewals and charges are NOT undone. Close client PCs first. The newer data will be preserved separately.',"Restore program and databases","Continue rollback"))return;
    updateUiBusy=true;$('#rollback-update').disabled=true;
    try{await api.rollback.restore({id:selected.value,confirmation:$('#rollback-confirmation').value});$('#rollback-result').textContent='Closing the Main PC app. The verified restore helper will reopen the old version. If a verification fails, a Windows message explains why nothing was restored.';}
    catch(error){$('#rollback-result').textContent=errorMessage(error);updateUiBusy=false;$('#rollback-update').disabled=false;}
  });
  $("#login-update-button").addEventListener("click", openUpdateDialog);
  $("#check-update").addEventListener("click", () => checkForUpdates(true));
  $("#save-update-repository").addEventListener("click", async () => {
    try {
      const settings = await api.updates.saveSettings({ githubRepository: $("#update-github-repository").value });
      renderUpdateStatus({ ...(state.updateStatus || {}), mode: "server", githubRepository: settings.githubRepository, error: null });
      showToast("GitHub update repository saved.");
      await checkForUpdates(false);
    } catch (error) { showToast(errorMessage(error), "error"); }
  });
  $("#download-update").addEventListener("click", downloadAndInstallUpdate);
  $('#prepare-client-updates').addEventListener('click',async()=>{
    if(updateUiBusy)return;updateUiBusy=true;$('#prepare-client-updates').disabled=true;$('#check-update').disabled=true;$('#download-update').disabled=true;
    try{const update=await api.updates.prepareClients();const status=await api.updates.status();renderUpdateStatus({...status,clientUpdateReady:true});$('#client-update-sharing').textContent=`Client installer v${update.version} downloaded, SHA-256 verified and ready on Main. Clients can now select Update app. Main was not reinstalled.`;showToast('Verified client update ready on Main.');}
    catch(error){$('#client-update-sharing').textContent=errorMessage(error);showToast(errorMessage(error),'error');}
    finally{updateUiBusy=false;$('#prepare-client-updates').disabled=false;$('#check-update').disabled=false;$('#download-update').disabled=false;}
  });
  api.updates.onProgress((progress) => {
    $("#update-progress-wrap").classList.remove("hidden");
    $("#update-progress-bar").style.width = `${progress.percent ?? 4}%`;
    $("#update-progress-text").textContent = progress.total ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)} (${progress.percent}%)` : `${formatBytes(progress.received)} downloaded`;
  });
  $("#theme-selector").addEventListener("change", (event) => applyTheme(event.currentTarget.value, true));
  $("#purchase-lines").addEventListener("input", (event) => {
    const row = event.target.closest(".purchase-line");
    if (!row) return;
    const line = state.purchaseDraft[Number(row.dataset.index)];
    if (!line) return;
    if (event.target.classList.contains("purchase-quantity")) line.quantity = Number(event.target.value);
    if (event.target.classList.contains("purchase-unit-cost")) line.unitCost = Number(event.target.value);
    row.querySelector(".purchase-line-total strong").textContent = formatMoney((Number(line.quantity) || 0) * (Number(line.unitCost) || 0));
    renderPurchaseTotal();
  });
  $("#purchase-lines").addEventListener("change", (event) => {
    if (!event.target.classList.contains("purchase-product")) return;
    const row = event.target.closest(".purchase-line");
    const line = state.purchaseDraft[Number(row.dataset.index)];
    const product = state.products.find((item) => Number(item.id) === Number(event.target.value));
    if (!line || !product) return;
    line.productId = Number(product.id);
    line.unitCost = Number(product.costUsd) || 0;
    renderPurchaseLines();
  });
  $("#login-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const user = await api.auth.login({ username: $("#login-username").value, password: $("#login-password").value }); $("#login-password").value = ""; await startApp(user); } catch (error) { showToast(errorMessage(error), "error"); } });
  $("#setup-form").addEventListener("submit", async (event) => { event.preventDefault(); if ($("#setup-password").value !== $("#setup-confirm-password").value) return showToast("Passwords do not match.", "error"); try { const user = await api.auth.createOwner({ fullName: $("#setup-full-name").value, username: $("#setup-username").value, password: $("#setup-password").value }); await startApp(user); } catch (error) { showToast(errorMessage(error), "error"); } });
  $("#logout-button").addEventListener("click", async () => { if(api.web){try{await api.auth.logout();}catch(error){showToast('Signed out in this browser. Server sign-out could not be confirmed.','error');}return;} authSessionVersion++; state.syncing=false; if(syncTimer){clearInterval(syncTimer);syncTimer=null;} resetAdminInventory(); await api.auth.logout(); clearReceiptCredentials(); if ($("#receipt-dialog").open) $("#receipt-dialog").close(); state.products = []; state.expenses = []; state.expenseCategories = []; state.purchases = []; state.purchaseDraft = []; state.reportCategories = []; state.users = []; state.employees = []; state.attendance = []; state.bills = []; state.bundles = []; state.telecomCatalog = []; state.telecomPayments = []; state.debts = []; state.drawer = null; state.cart = []; state.posCategory = null; state.activeReceipt = null; renderCart(); $("#login-form").reset(); showAuth("login"); });
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$('[data-jump]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.jump)));
  $("#quick-add-product").addEventListener("click", () => openProductDialog()); $("#add-product").addEventListener("click", () => openProductDialog()); $("#add-user").addEventListener("click", () => openUserDialog());
  $("#product-business-filter").addEventListener('change',renderProducts);
  $("#admin-pos-business").addEventListener('change',()=>{
    if(!isMainCatalogAdmin())return;
    const select=$("#admin-pos-business"),next=select.value;
    if(state.cart.length||adminInventory.checkoutBusy||adminInventory.uncertain){select.value=adminInventory.source;return;}
    adminInventory.source=catalogWorkspace(next)?next:"";state.posCategory=null;$("#pos-search").value="";
    $("#pos-customer-name").value="";$("#pos-customer-phone").value="";$("#pos-customer-account").value="";
    selectPayment('pos-payment','#payment-method','Cash');updatePosPayment();WhishPayments.restore('payment-method',null);
    if($("#printing-options-dialog").open)$("#printing-options-dialog").close();renderCatalog();renderCart();
  });
  $("#admin-pos-open-history").addEventListener('click',async()=>{const source=adminInventory.source;if(isMainCatalogAdmin()&&source&&!adminInventory.checkoutBusy)try{await api.workspace.open(source);}catch(error){showToast(errorMessage(error),'error');}});
  $("#product-business").addEventListener('change',()=>{
    if(!isMainCatalogAdmin()||$("#product-id").value||adminInventory.productBusy)return;
    adminInventory.productToken++;
    const category=$("#product-category").value;configureStudioProductCategory(category);
    $("#product-category").value=[...$("#product-category").options].some(option=>option.value===category)?category:'Other';
    $("#product-barcode").value="";$("#generate-barcode").disabled=!catalogWorkspace(productFormWorkspace());updateBarcodePreview();updateProductInventoryMode();
  });
  $("#product-dialog").addEventListener('cancel',event=>{if(adminInventory.productBusy)event.preventDefault();});
  $("#product-dialog").addEventListener('close',()=>{adminInventory.productToken++;});
  $("#add-employee").addEventListener("click", () => openEmployeeDialog());
  $("#add-bill").addEventListener("click", () => openBillDialog().catch(error=>showToast(errorMessage(error),"error")));
  $("#add-telecom-payment").addEventListener("click", () => openTelecomDialog());
  $("#add-printing-type").addEventListener("click", () => {
    if (state.currentUser?.role !== "admin") return;
    const items = readCustomPrintingTypes();
    if (items.length >= 50) return showToast("Use up to 50 custom printing types.", "error");
    items.push({ key: crypto.randomUUID(), name: "", price: 0 });
    renderCustomPrintingTypes(items);
    $("#custom-printing-types .custom-printing-row:last-child .custom-printing-name").focus();
  });
  $("#custom-printing-types").addEventListener("click", event => {
    if (state.currentUser?.role !== "admin" || !event.target.closest(".remove-printing-type")) return;
    event.target.closest(".custom-printing-row").remove();
  });
  $("#manage-telecom-pricing").addEventListener("click", openTelecomPricingDialog);
  $("#set-cash-drawer").addEventListener("click", openCashDrawerDialog);
  $("#manage-bundle-costs").addEventListener("click", openBundleCostDialog);
  $("#add-expense").addEventListener("click", () => openExpenseDialog().catch(error=>showToast(errorMessage(error),"error")));
  $("#expense-business").addEventListener("change", () => setExpenseBusiness($("#expense-business").value));
  $("#expense-funding-method").addEventListener("change", syncExpenseFundingSource);
  $('#expense-funding-wallet').addEventListener('change',syncExpenseFundingSource);
  $('#expense-funding-month').addEventListener('change',syncExpenseFundingSource);
  $('#expense-date').addEventListener('change',()=>setExpenseBusiness($('#expense-business').value));
  $('#expense-funding-refresh').addEventListener('click',()=>setExpenseBusiness($('#expense-business').value));
  $("#expense-category").addEventListener("change", updateExpensePaperFields);
  $("#expense-amount").addEventListener("input", () => {syncSpendingWhishFee("expense");syncExpenseFundingSource();});
  $("#expense-whish-fee").addEventListener("change", () => syncSpendingWhishFee("expense"));
  $("#purchase-whish-fee").addEventListener("change", () => syncSpendingWhishFee("purchase"));
  $("#expense-business-filter").addEventListener("change", () => loadExpenses().catch(error=>showToast(errorMessage(error),"error")));
  $("#expense-dialog").addEventListener("close", () => { expenseOptionsVersion++; expenseOptionsLoading = false; expenseFundingSaved = null; expenseFundingRefreshDraft=null; clearExpenseFundingSources(); });
  $("#manage-expense-categories").addEventListener("click", openExpenseCategoryDialog);
  $("#add-purchase").addEventListener("click", openPurchaseDialog);
  $("#add-purchase-line").addEventListener("click", addPurchaseLine);
  $("#pos-category-back").addEventListener("click", () => { state.posCategory = null; $("#pos-search").value = ""; renderCatalog(); });
  $$(".close-modal").forEach((button) => button.addEventListener("click", () => {const dialog=button.closest("dialog");if(dialog.id==="bill-settings-dialog"&&billResetSaving||dialog.id==="bill-reset-review-dialog"&&billResetReviewSaving||dialog.id==='product-dialog'&&adminInventory.productBusy)return;dialog.close();}));
  $("#product-cost").addEventListener("input", updatePricePreview); $("#product-price").addEventListener("input", updatePricePreview); $("#product-currency").addEventListener("change", () => updateProductCurrency(true)); $("#product-category").addEventListener("change", updateProductInventoryMode); $("#product-barcode").addEventListener("input", updateBarcodePreview); $("#product-search").addEventListener("input", renderProducts); $("#pos-search").addEventListener("input", renderCatalog); $("#bill-search").addEventListener("input", renderBills); $("#telecom-search").addEventListener("input", renderTelecomPayments); $("#expense-category-filter").addEventListener("change", renderExpenses);
  $$(".printing-matrix-input").forEach((input) => input.addEventListener("input", syncPrintingBasePrice));
  $("#printing-size").addEventListener("change", () => { const product = posProduct($("#printing-options-product-id").value); if (product) { refreshPrintingServiceOptions(product); updatePrintingOptionsPreview(); } });
  $("#printing-service").addEventListener("change", updatePrintingOptionsPreview); $("#printing-quantity").addEventListener("input", updatePrintingOptionsPreview);
  $("#bill-service-type").addEventListener("change", () => updateBillBundleOptions(true));
  $("#bill-bundle").addEventListener("change", () => { billBundleNeedsSelection = false; updateBillBundleOptions(true); updatePortalCustomerSummary(); });
  $("#telecom-provider").addEventListener("change", () => { $("#telecom-kind").value = $("#telecom-provider").value === "Ogero" ? "Bill" : "Refill"; updateTelecomForm(true); });
  $$(`input[name='telecom-provider-card']`).forEach((radio) => radio.addEventListener("change", () => { if (!radio.checked) return; $("#telecom-provider").value = radio.value; $("#telecom-kind").value = radio.value === "Ogero" ? "Bill" : "Refill"; updateTelecomForm(true); }));
  $("#telecom-kind").addEventListener("change", () => updateTelecomForm(true));
  $("#telecom-item-code").addEventListener("change", () => updateTelecomForm(true));
  $("#telecom-form").addEventListener("change", (event) => {
    if (event.target.name === "telecom-service") { $("#telecom-kind").value = event.target.value; updateTelecomForm(true); }
    if (event.target.name === "telecom-refill-card") { $("#telecom-item-code").value = event.target.value; updateTelecomForm(true); }
    if (event.target.name === "telecom-validity-card") { $("#telecom-validity-days").value = event.target.value; renderTelecomOptions(); }
  });
  $$(`input[name='pos-payment']`).forEach((radio) => radio.addEventListener("change", updatePosPayment));
  $$(`input[name='bill-payment']`).forEach((radio) => radio.addEventListener("change", updateBillPayment));
  $$(`input[name='telecom-payment']`).forEach((radio) => radio.addEventListener("change", updateTelecomPayment));
  $$(`input[name='settle-payment']`).forEach((radio) => radio.addEventListener("change", () => { $("#settle-payment-method").value = $("input[name='settle-payment']:checked")?.value || "Cash"; updateDebtPreview(); }));
  $("#generate-barcode").addEventListener("click", async () => {
    if(!has('products.manage'))return;
    const main=isMainCatalogAdmin(),identity=catalogIdentity(),token=adminInventory.productToken,source=productFormWorkspace(),button=$("#generate-barcode");
    if(main&&(!catalogWorkspace(source)||adminInventory.productBusy))return showToast('Select the product business first.','error');
    button.disabled=true;
    try {const code=main?await api.adminCatalog.generateBarcode(source):await api.barcodes.generate();if(identity!==catalogIdentity()||token!==adminInventory.productToken||!$("#product-dialog").open||source!==productFormWorkspace())return;$("#product-barcode").value=code;updateBarcodePreview();}
    catch(error){if(identity===catalogIdentity()&&token===adminInventory.productToken)showToast(errorMessage(error),'error');}
    finally{if(token===adminInventory.productToken&&!adminInventory.productBusy)button.disabled=false;}
  });
  $("#pos-search").addEventListener("keydown", (event) => { if (event.key !== "Enter") return; event.preventDefault(); if(isMainCatalogAdmin()&&!adminInventory.source)return showToast('Choose the selling business before scanning.','error');const code = event.currentTarget.value.trim(); const matches = posProducts().filter((item) => item.barcodes.includes(code)); if (!matches.length) return showToast("No product found for that barcode in this business.", "error");if(matches.length>1)return showToast('This barcode matches more than one product. Select the exact product in the catalogue.','error');const product=matches[0]; const added = addToCart(product.id); event.currentTarget.value = ""; renderCatalog(); if (added) showToast(`${product.name} added.`); });
  $("#print-barcode").addEventListener("click", () => printTarget("barcode"));
  $("#print-receipt").addEventListener("click", () => printCurrentReceipt().catch((error) => showToast(errorMessage(error), "error")));
  $("#retry-receipt-credentials").addEventListener("click", () => loadReceiptCredentials(state.activeReceipt));
  $("#receipt-dialog").addEventListener("close", () => { if (!$("#receipt-dialog").open) { clearReceiptCredentials(); state.activeReceipt = null; window.InvoiceVoids?.setReceipt(null,null); } });
  $('#share-receipt').addEventListener('click',()=>showWhatsAppReceipt().catch(error=>showToast(errorMessage(error),'error')));
  $('#whatsapp-phone').addEventListener('input',()=>{whatsappDraft=null;$('#whatsapp-preview').value='Preview the receipt for this phone number before sending.';});
  $('#whatsapp-preview-button').addEventListener('click',()=>prepareWhatsAppReceipt().catch(error=>showToast(errorMessage(error),'error')));
  $('#whatsapp-open').addEventListener('click',async()=>{const button=$('#whatsapp-open');button.disabled=true;try{const draft=await prepareWhatsAppReceipt();await api.sharing.openWhatsApp(draft.url);showToast('WhatsApp opened. Review the message there and press Send.');}catch(error){showToast(errorMessage(error),'error');}finally{button.disabled=false;}});
  $("#print-bills-report").addEventListener("click", () => printTarget("bills-report"));
  window.addEventListener("afterprint", () => delete document.body.dataset.printTarget);

  $("#rfid-scan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#rfid-scan-input");
    try {
      const result = await api.attendance.scan(input.value);
      const direction = result.direction === "in" ? "ARRIVAL RECORDED" : "DEPARTURE RECORDED";
      const resultPanel = $("#attendance-scan-result");
      resultPanel.className = `scan-result clock-${result.direction}`;
      resultPanel.innerHTML = `<strong>${direction}: ${escapeHtml(result.employee.fullName)}</strong><span>${escapeHtml(result.employee.jobTitle)} · ${dateTimeFormatter.format(new Date(result.time))}</span>`;
      input.value = "";
      input.focus();
      if (has("attendance.view") || has("attendance.manage")) await Promise.all([loadEmployees(), loadAttendance()]);
      showToast(`${result.employee.fullName} clocked ${result.direction}.`);
    } catch (error) {
      $("#attendance-scan-result").className = "scan-result";
      $("#attendance-scan-result").innerHTML = `<strong>Card not accepted</strong><span>${escapeHtml(errorMessage(error))}</span>`;
      input.select();
      showToast(errorMessage(error), "error");
    }
  });

  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if(!has('products.manage'))return;
    const id = Number($("#product-id").value) || null;
    const product = { name: $("#product-name").value, sku: $("#product-sku").value, category: $("#product-category").value, currency: $("#product-currency").value, cost: $("#product-cost").value, price: $("#product-price").value, markup: $("#product-markup").value, printPriceTable: readPrintingPriceTable(), quantity: Number($("#product-quantity").value), reorderLevel: Number($("#product-reorder").value), barcodes: [$("#product-barcode").value, ...$("#product-additional-barcodes").value.split(",")] };
    if(isMainCatalogAdmin()){await saveMainCatalogProduct(id,product);return;}
    try { if (id) await api.products.update(id, product); else await api.products.create(product); $("#product-dialog").close(); await loadProducts(); await loadDashboard(); showToast(id ? "Product updated." : "Product added with barcode."); }
    catch (error) { const message = errorMessage(error); showToast(message.includes("UNIQUE") ? "That SKU or barcode is already in use." : message, "error"); }
  });

  $("#printing-options-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const product = posProduct($("#printing-options-product-id").value);
    if (!product) return showToast("This printing product is no longer available.", "error");
    if(isMainCatalogAdmin()&&(adminInventory.checkoutBusy||adminInventory.uncertain||product.workspaceId!==adminInventory.source||$("#printing-options-dialog").dataset.productWorkspace!==product.workspaceId||state.cart.some(item=>item.workspaceId!==product.workspaceId)))return showToast("Reopen this printing product in its original selling business.","error");
    const quantity = Number($("#printing-quantity").value);
    if (!Number.isInteger(quantity) || quantity <= 0) return showToast("Printing quantity must be a positive whole number.", "error");
    const selection = printingSelection(product);
    if (!selection.available) return showToast("That Printing table option is unavailable.", "error");
    const key = `printing:${productKey(product)}:${selection.options.size}:${selection.options.service}`;
    const existing = state.cart.find((item) => item.key === key);
    if (existing) existing.quantity += quantity;
    else state.cart.push({ key, id: product.id, ...(isMainCatalogAdmin()?{workspaceId:product.workspaceId}:{}), name: product.name, variantDescription: selection.description, printingOptions: selection.options, priceUsd: selection.priceUsd, priceLbp: selection.priceLbp, quantity, stock: 0, trackQuantity: false });
    $("#printing-options-dialog").close();
    renderCart();
    showToast(`${product.name} added with selected printing options.`);
  });

  $("#expense-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (expenseSaving || expenseOptionsLoading || !has("expenses.manage")) return;
    const id = $("#expense-id").value;
    if (id && state.currentUser?.role !== "admin") return;
    const input = { workspaceId:$("#expense-business").value, expenseDate:$("#expense-date").value, category:$("#expense-category").value, description:$("#expense-description").value, paperType:$("#expense-paper-type").disabled ? "" : $("#expense-paper-type").value, amount:$("#expense-amount").value, deductWhishFee: !$("#expense-whish-fee").disabled && $("#expense-whish-fee").checked };
    const fundingMonth=$('#expense-funding-month').value;
    if(!expenseFundingProjection||expenseFundingProjection.workspaceId!==input.workspaceId||expenseFundingProjection.asOf!==input.expenseDate||!expenseFundingProjection.months.some(row=>row.month===fundingMonth))return showToast('Refresh the selected business’s funding months before saving.','error');
    input.fundingMonth=fundingMonth;
    const method = $("#expense-funding-method").value;
    if (["Cash", "Whish Money"].includes(method)) input.fundingMethod = method;
    else if (!id || ["Cash", "Whish Money"].includes(expenseFundingSaved?.fundingMethod)) return showToast("Choose Cash or Whish wallet for this expense.", "error");
    if (method === "Whish Money") {
      const walletId = $("#expense-funding-wallet").value;
      if (!walletId || !expenseFundingWallets.some(wallet => String(wallet.id) === walletId)) return showToast("Choose the Whish wallet that funded this expense.", "error");
      input.fundingWalletId = walletId;
    }
    expenseSaving = true; $("#expense-submit").disabled = true;
    try {
      if (id) await api.expenses.update(Number(id), input); else await api.expenses.create(input);
      $("#expense-dialog").close(); await loadExpenses(); await loadDashboard();
      showToast(`Expense ${id ? "updated" : "recorded"} in ${expenseBusinessName(input.workspaceId)}.`);
    } catch (error) { showToast(errorMessage(error), "error"); }
    finally { expenseSaving = false; syncExpenseFundingSource(); }
  });

  $("#expense-category-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.expenseCategories = await api.expenseCategories.create($("#new-expense-category").value);
      event.currentTarget.reset();
      refreshExpenseCategorySelectors();
      renderExpenseCategoryManager();
      $("#new-expense-category").focus();
      showToast("Expense category added.");
    } catch (error) {
      const message = errorMessage(error);
      showToast(message.includes("UNIQUE") ? "That expense category already exists." : message, "error");
    }
  });

  $("#purchase-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.purchaseDraft.length) return showToast("Add at least one product to the receipt.", "error");
    try {
      const receipt = await api.purchases.create({
        purchaseDate: $("#purchase-date").value,
        receiptNo: $("#purchase-receipt-number").value,
        supplier: $("#purchase-supplier").value,
        category: $("#purchase-category").value,
        notes: $("#purchase-notes").value,
        deductWhishFee: !$("#purchase-whish-fee").disabled && $("#purchase-whish-fee").checked,
        items: state.purchaseDraft.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) }))
      });
      $("#purchase-dialog").close();
      state.purchaseDraft = [];
      await Promise.all([loadProducts(), loadPurchases(), loadExpenses(), loadDashboard()]);
      showToast(`${receipt.receiptNo} saved. Stock and expenses were updated.`);
    } catch (error) {
      const message = errorMessage(error);
      showToast(message.includes("UNIQUE") ? "That purchase receipt number already exists." : message, "error");
    }
  });

  $("#user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = Number($("#user-id").value) || null;
    const user = { fullName: $("#user-full-name").value, username: $("#user-username").value, role: $("#user-role").value, password: $("#user-password").value, active: $("#user-active").checked };
    if(['cashier','support'].includes(user.role))user.featurePermissions=Object.fromEntries($$('#user-feature-permissions input').map(input=>[input.value,input.checked]));
    if (isMainAdmin()) user.allowedSections = $$("#user-section-access input:checked").map(input => input.value);
    try {
      const key=$('#user-account-key').value;
      const updated = id ? await api.users.update(key||id, user) : await api.users.create(user);
      if (id && (key?key===state.currentUser.accountKey:id === Number(state.currentUser.id))) {
        state.currentUser = updated;
        $("#current-user-name").textContent = updated.fullName;
        $("#current-user-role").textContent = roleLabel(updated.role);
        $("#user-initials").textContent = updated.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        applyPermissions();
      }
      $("#user-dialog").close();
      if (has("users.manage")) await loadUsers();
      else switchView(defaultView());
      showToast(id ? "User updated." : "User account created.");
    } catch (error) {
      const message = errorMessage(error);
      showToast(message.includes("UNIQUE") ? "That username is already in use." : message, "error");
    }
  });

  $("#employee-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = Number($("#employee-id").value) || null;
    const employee = { employeeNo: $("#employee-number").value, fullName: $("#employee-name").value, jobTitle: $("#employee-job-title").value, rfidCard: $("#employee-rfid").value, active: $("#employee-active").checked };
    try {
      if (id) await api.employees.update(id, employee); else await api.employees.create(employee);
      $("#employee-dialog").close();
      await Promise.all([loadEmployees(), loadAttendance()]);
      showToast(id ? "Employee updated." : "Employee and RFID card added.");
    } catch (error) {
      const message = errorMessage(error);
      showToast(message.includes("UNIQUE") ? "That employee ID or RFID card is already assigned." : message, "error");
    }
  });

  $("#attendance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api.attendance.update(Number($("#attendance-id").value), { clockIn: $("#attendance-clock-in").value, clockOut: $("#attendance-clock-out").value });
      $("#attendance-dialog").close();
      await Promise.all([loadEmployees(), loadAttendance()]);
      showToast("Attendance record corrected.");
    } catch (error) { showToast(errorMessage(error), "error"); }
  });

  $("#cash-drawer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isAllBusinessDashboard()) return showToast("Combined balances are read-only. Open a specific business to count its drawer.", "error");
    try {
      state.drawer = await api.drawer.setBalance({ balance: $("#cash-drawer-balance").value, note: $("#cash-drawer-note").value });
      $("#cash-drawer-dialog").close();
      renderDrawer();
      showToast(`Cash drawer set to ${formatMoney(state.drawer.balance)}.`);
    } catch (error) { showToast(errorMessage(error), "error"); }
  });

  $("#settle-debt-form").addEventListener("submit",async event=>{
    event.preventDefault(); const button=event.currentTarget.querySelector("[type='submit']");button.disabled=true;
    try {
      const result=await api.debts.settle($("#settle-debt-kind").value,Number($("#settle-debt-id").value),$("#settle-payment-method").value,$("#settle-amount").value,$("#settle-request-id").value,WhishPayments.input('settle-payment-method').whishDestinationId);
      $("#settle-debt-dialog").close();
      await Promise.all([loadDebts(),has("bills.view") ? loadBills() : Promise.resolve(),has("telecom.view") ? loadTelecomPayments() : Promise.resolve(),has("drawer.view") ? loadDrawer() : Promise.resolve(),has("dashboard.view") ? loadDashboard() : Promise.resolve()]);
      showToast(`Received ${formatMoney(result.amount)}. Remaining: ${formatMoney(result.remainingAmount ?? 0)}.`);
    } catch(error){showToast(errorMessage(error),"error");}finally{button.disabled=false;}
  });

  $("#bill-form").addEventListener("submit", async (event) => {
    event.preventDefault();const identity=portalWorkflowIdentity(); if(billSaving || portalSelecting)return;
    if(!state.currentUser||state.currentUser.active===false||!has('bills.create')&&!has('bills.manage'))return showToast('Your role cannot record customer bills.','error');
    if(businessWorkspace.id==='fiber-users'&&portalStatus.ready&&$('#bill-service-type').value==='Internet'&&portalCustomer&&selectedPortalPlan()?.id!==portalCustomer.serviceId)return showToast('Use Change service & renew for a different service. This form only renews the verified current service.','error');
    if(billFreePolicy()?.free){await saveFreeRenewal();return;}
    const wantRenew=event.submitter?.id==="bill-renew-button";
    const account=normalizedBillAccount();
    if(wantRenew && (!portalStatus.ready || portalCustomer?.username!==account))return showToast("Verify the portal customer before renewal.","error");
    const bill = { requestId:billRequestId, exactPortalAccount:portalCustomer?.username===account, customerAccount:account, customerName:$("#bill-customer-name").value, phone:$("#bill-phone").value, serviceType:$("#bill-service-type").value, bundleCode:$("#bill-bundle").value, billingPeriod:$("#bill-period").value, renewalMonths:Number($("#bill-months").value), amount:$("#bill-amount").value, paymentMethod:$("#bill-payment-method").value, reference:$("#bill-reference").value };
    if(wantRenew&&bill.paymentMethod==='Unpaid')bill.renewOnCredit=true;
    Object.assign(bill,WhishPayments.input('bill-payment-method'));
    const retailPricing=billRetailSelection();if(retailPricing)bill.retailPricing=retailPricing;
    if(businessWorkspace.kind==="reseller")bill.resellerId=Number($("#bill-reseller").value);
    const linked=businessWorkspace.id==="fiber-users" && portalStatus.ready && bill.serviceType==="Internet";
    const target=selectedPortalPlan(), changing=linked && target?.id!==portalCustomer?.serviceId;
    if(linked){
      if(!portalCustomer || portalCustomer.username!==account || !target || target.cost===null || target.fixedCost===null || portalCustomer.blocked)return showToast("Verify the customer and select a supported plan with current internal cost and fibernetlb2 fixed cost.","error");
      if(changing)return showToast('Use Change service & renew for a different service. This form only renews the verified current service.','error');
      Object.assign(bill,{portalServiceId:target.id,portalExpectedServiceId:portalCustomer.serviceId,portalReseller:$("#portal-reseller-search").value.trim(),confirmPlanChange:false});
    }
    billSaving=true;const buttons=$$("#bill-form button"),prior=buttons.map(button=>button.disabled);buttons.forEach(button=>button.disabled=true);
    try {
      if(wantRenew&&!await confirmPortalAction(billRenewalConfirmation(account,bill.amount,portalCustomer,target,false,wantRenew,bill.renewalMonths),billRenewalReview(bill,portalCustomer,target,false,wantRenew)))return;
      if(identity!==portalWorkflowIdentity()||bill.requestId!==billRequestId||!$('#bill-dialog').open||!has('bills.create')&&!has('bills.manage'))return;
      $('#bill-form').setAttribute('aria-busy','true');
      const saved=await (linked ? api.bills.savePortal(bill,wantRenew) : wantRenew ? api.bills.saveRenew(bill) : api.bills.create(bill));
      $("#bill-dialog").close();
      await Promise.all([has("bills.view") ? loadBills() : Promise.resolve(),has("dashboard.view") ? loadDashboard() : Promise.resolve(),has("debts.view") ? loadDebts() : Promise.resolve(),has("drawer.view") ? loadDrawer() : Promise.resolve()]);
      showReceipt("bill",saved);
      if(wantRenew){if(!FiberActionFeedback.renewed(saved))FiberActionFeedback.incomplete(saved);}
      else showToast(`${saved.receiptNo} ${saved.paymentStatus==="unpaid" ? "added to customer debts" : "payment saved"}; ${saved.planChanged ? "portal plan changed; " : ""}no portal renewal sent.`);
    }catch(error){showToast(`${errorMessage(error)} If the connection was lost, check Bills before opening a new payment. Retrying this form uses the same request ID.`,"error");}
    finally{$('#bill-form').removeAttribute('aria-busy');billSaving=false;buttons.forEach((button,index)=>button.disabled=prior[index]);updatePortalCustomerSummary();}
  });

  $("#telecom-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payment = { provider: $("#telecom-provider").value, transactionType: $("#telecom-kind").value, phone: $("#telecom-phone").value, customerName: $("#telecom-customer-name").value, itemCode: $("#telecom-item-code").value, billingPeriod: $("#telecom-period").value, creditAmount: $("#telecom-credit-amount").value, validityDays: $("#telecom-validity-days").value, amount: $("#telecom-amount").value, paymentMethod: $("#telecom-payment-method").value, reference: $("#telecom-reference").value };
    Object.assign(payment,WhishPayments.input('telecom-payment-method'));
    try {
      const saved = await api.telecomPayments.create(payment);
      $("#telecom-dialog").close();
      await Promise.all([has("telecom.view") ? loadTelecomPayments() : Promise.resolve(), has("dashboard.view") ? loadDashboard() : Promise.resolve(), has("debts.view") ? loadDebts() : Promise.resolve(), has("drawer.view") ? loadDrawer() : Promise.resolve()]);
      showReceipt("telecom", saved);
      showToast(saved.paymentStatus === "unpaid" ? `${saved.receiptNo} added to customer debts.` : `${saved.receiptNo} recorded for ${formatMoney(saved.amount)}.`);
    } catch (error) { showToast(errorMessage(error), "error"); }
  });

  $("#telecom-pricing-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const prices = $$(".telecom-price-input").map((input) => ({ code: input.dataset.code, price: input.value, cost: $(`.telecom-cost-input[data-code='${input.dataset.code}']`).value }));
    try {
      state.telecomCatalog = await api.telecomCatalog.updatePricing(prices);
      $("#telecom-pricing-dialog").close();
      renderTelecomCatalog();
      updateTelecomForm(false);
      if (has("reports.view")) await Promise.all([loadDashboard(), state.currentView === "reports" ? loadReport() : Promise.resolve()]);
      showToast("Refill selling prices and costs saved.");
    } catch (error) { showToast(errorMessage(error), "error"); }
  });

  $("#bundle-cost-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const costs = $$(".bundle-cost-input").map((input) => ({ code: input.dataset.code, cost: input.value }));
    try {
      state.bundles = await api.bundles.updateCosts(costs);
      $("#bundle-cost-dialog").close();
      renderBundleCatalog();
      updateBillBundleOptions(false);
      if (has("reports.view")) await Promise.all([loadDashboard(), state.currentView === "reports" ? loadReport() : Promise.resolve()]);
      showToast("Bundle costs saved for new bills. Existing bill costs are unchanged.");
    } catch (error) { showToast(errorMessage(error), "error"); }
  });

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button"); if (!target) return; const id = Number(target.dataset.id);
    if(target.classList.contains('admin-catalog-receipt')){await openAdminCatalogReceipt(target.dataset.saleWorkspace,Number(target.dataset.saleId));return;}
    if(businessWorkspace.id==='main'&&['edit-product','show-barcode','delete-product'].some(name=>target.classList.contains(name))){
      if(!isMainCatalogAdmin())return;
      const product=productFromAction(target);if(!product)return showToast('This product row is no longer available. Refresh the catalogues.','error');
      if(target.classList.contains('edit-product'))openProductDialog(product);
      else if(target.classList.contains('show-barcode'))showBarcode(product);
      else await deleteMainCatalogProduct(product);
      return;
    }
    if(target.classList.contains("renewal-history")){try{await openRenewalHistory(id);}catch(error){showToast(errorMessage(error),"error");}return;}
    if(target.classList.contains("renew-internet-bill")) {
      const bill=state.bills.find(item=>Number(item.id)===id);if(!bill||target.disabled)return;target.disabled=true;
      try {
        const customer=await api.portal.lookup(bill.customerAccount);
        const remaining=bill.renewal?.remainingMonths??bill.renewalMonths??1;
        const creditNote=bill.renewal?.onCredit===true&&bill.paymentStatus!=='paid'?`Unpaid bill ${bill.receiptNo} is already saved. Customer still owes ${formatMoney(bill.remainingAmount??bill.amount)}. No money is collected by this renewal; cash or Whish is credited only when paid.`:`Payment ${bill.receiptNo} is already saved.`;
        if(!await confirmPortalAction(`Renew Internet for ${customer.username}?\nCurrent plan: ${customer.service || "Current account plan"}\nCurrent expiry: ${customer.expiry || "Not supplied"}\n\n${creditNote} Submit only the ${remaining} remaining monthly cycle${remaining===1?"":"s"}; never repeat confirmed cycles. No new payment or IPTV renewal is recorded.`))return;
        const updated=await api.bills.renew(id);await loadBills();
        if(!FiberActionFeedback.renewed(updated))FiberActionFeedback.incomplete(updated);
      }catch(error){showToast(errorMessage(error),"error");}finally{target.disabled=false;}return;
    }
    if(target.dataset.openBandwidth){if(!isMainAdmin()||!api.bandwidth)return;target.disabled=true;try{await api.bandwidth.open();}catch(error){showToast(errorMessage(error),'error');}finally{target.disabled=false;}return;}
    if (target.dataset.workspace) { try { await api.workspace.open(target.dataset.workspace); } catch (error) { showToast(errorMessage(error), "error"); } return; }
    if (target.dataset.jump && target.closest("#workspace-actions, #workspace-nav-list")) { switchView(target.dataset.jump); return; }
    if (target.classList.contains("select-telecom-provider")) { openTelecomDialog(target.dataset.provider); return; }
    if (target.classList.contains("select-telecom-voucher")) { openTelecomDialog(target.dataset.provider, target.dataset.code); return; }
    if (target.classList.contains("select-pos-category")) { state.posCategory = target.dataset.category; $("#pos-search").value = ""; renderCatalog(); return; }
    if (target.classList.contains("add-to-cart")) addToCart(id); if (target.classList.contains("cart-plus")) changeCartQuantity(target.dataset.key, 1); if (target.classList.contains("cart-minus")) changeCartQuantity(target.dataset.key, -1); if (target.classList.contains("remove-cart-item")) { if(isMainCatalogAdmin()&&(adminInventory.checkoutBusy||adminInventory.uncertain))return;state.cart = state.cart.filter((item) => item.key !== target.dataset.key); renderCart(); }
    if (target.classList.contains("remove-purchase-line")) { state.purchaseDraft.splice(Number(target.dataset.index), 1); renderPurchaseLines(); }
    if (target.classList.contains("edit-product")) openProductDialog(state.products.find((product) => Number(product.id) === id)); if (target.classList.contains("show-barcode")) showBarcode(state.products.find((product) => Number(product.id) === id)); if (target.classList.contains("edit-user")) openUserDialog(state.users[Number(target.dataset.index)]);
    if(target.classList.contains('delete-user'))openDeleteUserDialog(state.users[Number(target.dataset.index)]);
    if (target.classList.contains("edit-employee")) openEmployeeDialog(state.employees.find((employee) => Number(employee.id) === id));
    if (target.classList.contains("edit-attendance")) openAttendanceDialog(state.attendance.find((record) => Number(record.id) === id));
    if (target.classList.contains("print-bill")) { const bill = state.bills.find((item) => Number(item.id) === id); if (bill) showReceipt("bill", bill); }
    if (target.classList.contains("print-telecom")) { const payment = state.telecomPayments.find((item) => Number(item.id) === id); if (payment) showReceipt("telecom", payment); }
    if (target.classList.contains("print-sale")) { if(isMainCatalogAdmin()){if(target.dataset.saleWorkspace)await openAdminCatalogReceipt(target.dataset.saleWorkspace,id);else showToast('Open the original business to view this receipt. Its source cannot be inferred from a receipt number.','error');return;}try { showReceipt("sale", await api.sales.receipt(id)); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("settle-debt")) { const debt = state.debts.find((item) => item.kind === target.dataset.kind && Number(item.id) === id); if (debt) openSettleDebtDialog(debt); }
    if (target.classList.contains("delete-product") && await confirmAppAction("Delete this product? Previous sales will remain in reports.","Delete product","Delete product")) { try { await api.products.remove(id); state.cart = state.cart.filter((item) => Number(item.id) !== id); await loadProducts(); renderCart(); await loadDashboard(); showToast("Product deleted."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("edit-expense")) { const expense = state.expenses.find(item => Number(item.id) === id && (item.workspaceId || businessWorkspace.id) === target.dataset.expenseWorkspace); if (expense) await openExpenseDialog(expense); }
    if (target.classList.contains("delete-expense") && await confirmAppAction("Delete this expense? Its amount will be removed from expense totals.","Delete expense","Delete expense")) { try { await api.expenses.remove(id, target.dataset.expenseWorkspace); await loadExpenses(); await loadDashboard(); showToast("Expense deleted."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("delete-expense-category") && await confirmAppAction("Delete this unused expense category?","Delete expense category","Delete category")) { try { state.expenseCategories = await api.expenseCategories.remove(id); refreshExpenseCategorySelectors(); renderExpenseCategoryManager(); showToast("Expense category deleted."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("delete-purchase") && await confirmAppAction("Delete this purchase receipt and reverse its stock quantities and expense?","Delete purchase receipt","Delete and reverse")) { try { await api.purchases.remove(id); await Promise.all([loadProducts(), loadPurchases(), loadExpenses(), loadDashboard()]); showToast("Purchase receipt deleted and stock reversed."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("delete-attendance") && await confirmAppAction("Delete this attendance record?","Delete attendance record","Delete record")) { try { await api.attendance.remove(id); await Promise.all([loadEmployees(), loadAttendance()]); showToast("Attendance record deleted."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("delete-bill") && await confirmAppAction("Delete this FibernetLB bill? Its cash drawer entry or debt will also be corrected.","Delete customer bill","Delete bill")) { try { await api.bills.remove(id); await Promise.all([loadBills(), has("dashboard.view") ? loadDashboard() : Promise.resolve(), has("debts.view") ? loadDebts() : Promise.resolve(), has("drawer.view") ? loadDrawer() : Promise.resolve()]); showToast("Bill deleted and balances updated."); } catch (error) { showToast(errorMessage(error), "error"); } }
    if (target.classList.contains("delete-telecom") && await confirmAppAction("Delete this mobile or Ogero payment? Its cash drawer entry or debt will also be corrected.","Delete Mobile / Ogero payment","Delete payment")) { try { await api.telecomPayments.remove(id); await Promise.all([loadTelecomPayments(), has("dashboard.view") ? loadDashboard() : Promise.resolve(), has("debts.view") ? loadDebts() : Promise.resolve(), has("drawer.view") ? loadDrawer() : Promise.resolve()]); showToast("Telecom payment deleted and balances updated."); } catch (error) { showToast(errorMessage(error), "error"); } }
  });

  $("#clear-cart").addEventListener("click", async () => {
    if(isMainCatalogAdmin()){
      if(adminInventory.checkoutBusy)return;
      const identity=catalogIdentity();
      if(adminInventory.uncertain&&!await confirmAppAction("The checkout result is unconfirmed. Check the source business's Reports, stock and balances first. Clearing this cart does not cancel or reverse a sale that may already be saved. Have you checked before starting a new sale?","Verify source history first","I checked — clear cart"))return;
      if(!catalogCurrent(identity))return;
      adminInventory.uncertain=false;
    }
    state.cart = []; renderCart();renderCatalog();
  });
  $("#complete-sale").addEventListener("click", async () => {
    if (!state.cart.length) return;
    if(isMainCatalogAdmin()){await completeAdminCatalogSale();return;}
    if(!has('sales.create'))return;
    try {
      const sale = await api.sales.create({ items: state.cart.map((item) => ({ productId: item.id, quantity: item.quantity, printingOptions: item.printingOptions })), paymentMethod: $("#payment-method").value,...WhishPayments.input('payment-method'), customerName: $("#pos-customer-name").value, customerPhone: $("#pos-customer-phone").value, customerAccount: $("#pos-customer-account").value });
      state.cart = [];
      $("#pos-customer-name").value = ""; $("#pos-customer-phone").value = ""; $("#pos-customer-account").value = "";
      selectPayment("pos-payment", "#payment-method", "Cash"); updatePosPayment(); renderCart();
      await Promise.all([loadProducts(), loadDashboard(), has("debts.view") ? loadDebts() : Promise.resolve(), has("drawer.view") ? loadDrawer() : Promise.resolve()]);
      showReceipt("sale", sale);
      showToast(sale.paymentStatus === "unpaid" ? `${sale.invoiceNo} added to customer debts.` : `${sale.invoiceNo} completed for ${formatDualUsd(sale.subtotal)}.`);
    } catch (error) { showToast(errorMessage(error), "error"); }
  });
  $("#run-report").addEventListener("click", () => loadReport().catch((error) => showToast(errorMessage(error), "error")));
  $("#run-attendance").addEventListener("click", () => loadAttendance().catch((error) => showToast(errorMessage(error), "error")));
  $("#run-bills").addEventListener("click", () => loadBills().catch((error) => showToast(errorMessage(error), "error")));
  $("#export-bills").addEventListener("click", async () => { try { const result = await api.bills.export($("#bills-start").value, $("#bills-end").value); if (!result.canceled) showToast("FibernetLB bills exported as a printable CSV table."); } catch (error) { showToast(errorMessage(error), "error"); } });
  $("#preview-bills-print").addEventListener("click", () => openBillsPrintReport().catch((error) => showToast(errorMessage(error), "error")));
  $("#run-telecom").addEventListener("click", () => loadTelecomPayments().catch((error) => showToast(errorMessage(error), "error")));
  $("#report-workspace").addEventListener("change", () => loadReport().catch(error => showToast(errorMessage(error), "error")));
  $("#export-report").addEventListener("click", async () => { try { const result = await api.reports.export($("#report-start").value, $("#report-end").value, $("#report-pos-category").value, reportScope()); if (!result.canceled) showToast("Report exported successfully."); } catch (error) { showToast(errorMessage(error), "error"); } });
}

async function initialize() {
  if (api.workspace) { const context = await api.workspace.current(); businessWorkspace = context.section; businessSections = context.sections; businessAreas = context.areas || businessAreas; }
  configureWorkspace();
  applyTheme(document.documentElement.dataset.theme || "classic");
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  $("#expense-date").value = localDate(); $("#report-end").value = localDate(); $("#report-start").value = `${localDate().slice(0, 7)}-01`;
  $("#attendance-end").value = localDate(); $("#attendance-start").value = `${localDate().slice(0, 7)}-01`;
  $("#bills-end").value = localDate(); $("#bills-start").value = `${localDate().slice(0, 7)}-01`; $("#bill-period").value = localDate().slice(0, 7);
  $("#telecom-end").value = localDate(); $("#telecom-start").value = `${localDate().slice(0, 7)}-01`; $("#telecom-period").value = localDate().slice(0, 7);
  selectPayment("pos-payment", "#payment-method", "Cash"); updatePosPayment();
  selectPayment("bill-payment", "#bill-payment-method", "Cash"); updateBillPayment();
  selectPayment("telecom-payment", "#telecom-payment-method", "Cash"); updateTelecomPayment(); updateTelecomForm(false);
  bindEvents(); renderCart();
  try {
    const network = await api.network.status();
    updateNetworkIndicators(network);
    if(network.mode==='client')await checkForUpdatesQuietly();
    if (!network.configured) return showNetworkSetup(false);
    if (!network.connected) {
      showAuth("login");
      showToast(network.error || "The main computer is unavailable.", "error");
      return;
    }
    if (network.mode === "client" && network.versionMismatch) {
      showAuth("login");
      await openUpdateDialog();
      showToast(`Update this client from ${network.localVersion} to ${network.serverVersion} before signing in.`, "error");
      return;
    }
    const auth = await api.auth.status();
    if (auth.user) await startApp(auth.user);
    else if (network.mode === "client") {
      showAuth("login");
      if (auth.needsSetup) {
        $("#login-form .auth-copy").textContent = "Create the owner account on the main computer first, then sign in here.";
        showToast("The main computer needs its owner account created first.", "error");
      }
    } else showAuth(auth.needsSetup && businessWorkspace.id === "main" ? "setup" : "login");
  } catch (error) {
    showAuth("login");
    showToast(errorMessage(error), "error");
  }
}

$("#portal-refresh-cost").addEventListener("click",()=>refreshPortalCustomerCosts(true));
setInterval(()=>void refreshPortalCustomerCosts(),60000);
setInterval(()=>{if(state.network?.mode==='client'&&!document.querySelector('dialog[open]'))void checkForUpdatesQuietly();},60000);
if(api.web)window.addEventListener('pos-web-auth-ended',()=>{showAuth('login');clearNativeAccountData();nativeCacheOwner='';$('#login-form').reset();});
initialize();
