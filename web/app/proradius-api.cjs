const fs = require("node:fs");
const path = require("node:path");
const ResellerTransactions=require('./reseller-transactions.cjs');

const PORTAL_URL = "https://pi.fibernetlb.net";
const MAX_RESPONSE = 1024 * 1024;
// Exact spendable cents stay private to the API; no additional native balance
// field is exposed to application reports, funding calculations or Staff DTOs.
const nativeBalanceCredits = new WeakMap();
class PortalError extends Error {
  constructor(message, sent = false, status = null) { super(message); this.sent = sent; this.status = status; }
}
function portalUsername(value) {
  const username = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._@+-]{3,128}$/.test(username)) throw new PortalError("Enter a valid Proradius customer username.");
  return username;
}
const short = value => typeof value === "string" || typeof value === "number" ? String(value).slice(0, 200) : "";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const flag = value => value === true || value === 1 || ["1", "true"].includes(String(value).toLowerCase());
const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function registrationPrincipal(payload) {
  const wrappers=envelopes(payload);
  if(wrappers.some(responseFailed))throw new PortalError('Proradius denied the reseller session identity check. Nothing was created.');
  const candidates=wrappers.flatMap(item=>[item,item.user]);
  const user=candidates.find(item=>object(item)&&typeof item.username==='string'&&Number(item.user_type)===2);
  if(!user)return null;
  if(Object.hasOwn(user,'id')&&!positiveId(user.id))throw new PortalError('Proradius returned an invalid reseller identity. Nothing was created.');
  return {id:positiveId(user.id),username:portalUsername(user.username),name:short(user.fullname??user.full_name??user.name),self:true};
}
function portalCost(value) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= 1000000 ? Math.round(amount * 100) / 100 : null;
}
function signedPortalMoney(value) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new PortalError("Proradius returned an invalid charge. No action was sent.");
  const amount=Number(value);
  if(!Number.isFinite(amount)||Math.abs(amount)>1000000) throw new PortalError("Proradius returned an invalid charge. No action was sent.");
  return Math.round(amount*100)/100;
}
// A portal account balance is not a two-decimal service charge. Keep native
// precision for withdrawal checks; only the display rounds to currency cents.
function representativeBalance(value) {
  if(typeof value!=='number'&&typeof value!=='string')throw new PortalError('This reseller’s Proradius balance is unavailable. No financial action was sent.');
  if(typeof value==='string'&&!/^-?\d+(?:\.\d+)?$/.test(value.trim()))throw new PortalError('This reseller’s Proradius balance has an unsupported format. No financial action was sent.');
  const amount=Number(value);
  const exact=typeof value==='string'?value.trim().match(/^-?(\d+)(?:\.(\d+))?$/):null;
  if(!Number.isFinite(amount)||Math.abs(amount)>1000000||exact&&(BigInt(exact[1])>1000000n||BigInt(exact[1])===1000000n&&/[1-9]/.test(exact[2]||'')))throw new PortalError('This reseller’s Proradius balance is outside the supported range. No financial action was sent.');
  return Object.is(amount,-0)?0:amount;
}
function nativeSpendableCents(value) {
  const exact=String(value).trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if(!exact)return Math.trunc(Number(value)*100); // Tiny numeric scientific notation.
  const cents=BigInt(exact[2])*100n+BigInt((exact[3]||'').slice(0,2).padEnd(2,'0'));
  return Number(exact[1]?-cents:cents);
}
function renewalQuoteFromResponse(payload, username, serviceId) {
  if(envelopes(payload).some(responseFailed))throw new PortalError('Proradius denied the renewal preview. No renewal was sent.');
  const data=payload?.body?.data;
  if(!Array.isArray(data)||data.length!==1||data[0]?.username!==username||responseFailed(data[0]))throw new PortalError('Proradius did not quote this exact customer. No renewal was sent.');
  const row=data[0];
  if(positiveId(row.service_id)!==serviceId)throw new PortalError('The renewal preview service changed. Verify the customer again; no renewal was sent.');
  const price=portalCost(row.price),freetimePrice=portalCost(row.freetime_price??0);
  if(price===null||freetimePrice===null||price+freetimePrice>1000000)throw new PortalError('Proradius supplied an invalid renewal cost. No service-option or fixed-cost fallback is allowed.');
  return {username,serviceId,service:short(row.servicename),price,freetimePrice,cost:Math.round((price+freetimePrice)*100)/100,source:'Proradius renewcheck',verifiedAt:new Date().toISOString()};
}
function changeQuoteFromResponse(payload) {
  const wrappers=envelopes(payload);
  if(wrappers.some(responseFailed)) throw new PortalError("Proradius denied the plan-change calculation. No change was sent.");
  const body=object(payload?.body)?payload.body:null;
  if(!body||!Object.hasOwn(body,"price")) throw new PortalError("Proradius did not provide its plan-change calculation. No estimated charge or change was sent.");
  const price=signedPortalMoney(body.price),freetimePrice=signedPortalMoney(body.freetime_price??0);
  const pendingRefills=Number(body.pending_refills??0);
  if(!Number.isSafeInteger(pendingRefills)||pendingRefills<0||pendingRefills>1000) throw new PortalError("Proradius returned invalid pending refills.");
  return {price,freetimePrice,total:Math.round((price+freetimePrice)*100)/100,currentPeriodPrice:signedPortalMoney(body.current_period_price??price),pendingRefills,pendingRefillsPrice:signedPortalMoney(body.pending_refills_price??0),hasPeriodBreakdown:Object.hasOwn(body,"current_period_price")&&(pendingRefills===0||Object.hasOwn(body,"pending_refills_price"))};
}
function envelopes(payload) {
  const result = [], seen = new Set();
  const visit = (value, depth) => {
    if (!object(value) || seen.has(value) || depth > 3) return;
    seen.add(value); result.push(value);
    for (const key of ["body", "data", "result", "results"]) visit(value[key], depth + 1);
  };
  visit(payload, 0); return result;
}
function responseFailed(item) {
  return Boolean(item && (item.success === false || item.ok === false || item.status === false ||
    ["error", "failed", "failure"].includes(String(item.status).toLowerCase()) ||
    (typeof item.status === "number" && item.status >= 400) ||
    (item.error && item.error !== false) || (Array.isArray(item.errors) ? item.errors.length : item.errors)));
}
function customerRecord(payload, expected) {
  const wrappers = envelopes(payload);
  if (wrappers.some(responseFailed)) throw new PortalError("The portal denied customer lookup. Check the API account's customer-view permissions; no renewal was sent.");
  // Proradius V5.19 uses body.info, shortname, service_expiry and a services
  // catalogue. Only inspect known customer containers, never arbitrary fields.
  const candidates = wrappers.flatMap(item => [item, item.info, item.user, item.customer]);
  for (const item of wrappers) for (const key of ["body", "data", "results"]) if (Array.isArray(item[key])) candidates.push(...item[key]);
  if (Array.isArray(payload)) candidates.push(...payload);
  const found = candidates.find(item => object(item) && item.username === expected);
  if (!found) throw new PortalError("The portal did not return this exact customer username. Check the account or API response format; no renewal was sent.");
  if (responseFailed(found)) throw new PortalError("The portal denied this customer lookup; no renewal was sent.");
  return { found, wrappers };
}
function customerFromResponse(payload, expected) {
  const { found, wrappers } = customerRecord(payload, expected);
  const serviceIdValue = found.service_id ?? (object(found.service) ? found.service.service_id ?? found.service.id : found.service);
  const serviceId = /^\d+$/.test(String(serviceIdValue)) && Number.isSafeInteger(Number(serviceIdValue)) && Number(serviceIdValue) > 0 ? Number(serviceIdValue) : null;
  const catalogue = wrappers.flatMap(item => Array.isArray(item.services) ? item.services : []);
  const plan = serviceId === null ? null : catalogue.find(item => String(item?.service_id ?? item?.id) === String(serviceId));
  const service = found.servicename ?? found.service_name ?? (object(found.service) ? found.service.shortname ?? found.service.name ?? found.service.commercialname : typeof found.service === "string" && serviceId === null ? found.service : null) ?? plan?.shortname ?? plan?.name ?? plan?.commercialname ?? (serviceId === null ? "" : `Service #${serviceId}`);
  const customer = {
    username: expected, name: short(found.full_name ?? found.fullname ?? found.shortname ?? found.name),
    phone: short(found.phone ?? found.mobile), service: short(service), serviceId,
    expiry: short(found.service_expiry ?? found.expire_datetime ?? found.expiry_date ?? found.expiry ?? found.expiration),
    blocked: flag(found.blocked) || flag(found.system_blocked)
  };
  const resellerId = positiveId(found.reseller_id ?? found.reseller ?? found.owner);
  if (resellerId) customer.resellerId = resellerId;
  if (catalogue.length) {
    const seen = new Set();
    customer.plans = catalogue.map(item => {
      const id = positiveId(item?.service_id ?? item?.id), name = short(item?.shortname ?? item?.name ?? item?.commercialname);
      if (!id || !name || seen.has(id)) throw new PortalError("The portal service catalogue is invalid or ambiguous. No plan change was sent.");
      seen.add(id);
      // V5's service dropdown uses services[].price for the reseller cost.
      // Never read info.price/override_price, or use this as the selling price.
      return { id, name, cost: portalCost(item.price) };
    });
    customer.cost = customer.plans.find(item => item.id === serviceId)?.cost ?? null;
  }
  return customer;
}
function planUpdateBody(payload, username, targetId) {
  const { found } = customerRecord(payload, username);
  const required = ["password", "shortname", "reseller", "collector", "switch", "duedate", "override_price", "discount", "service_expiry", "save_mac", "note", "phone", "email", "address", "region", "nationality", "building", "latitude", "longitude"];
  if (required.some(key => !Object.hasOwn(found, key)) || typeof found.password !== "string" || !found.password || /^[*•●]+$/.test(found.password) || /^(redacted|hidden)$/i.test(found.password)) throw new PortalError("Proradius did not supply a complete editable customer profile. Plan change is blocked to protect other account details.");
  const body = { username, password: found.password, service: targetId, owner: found.reseller, name: found.shortname, expiry_date: found.service_expiry };
  for (const key of ["collector", "switch", "duedate", "note", "phone", "email", "address", "region", "nationality", "building", "latitude", "longitude"]) body[key] = found[key];
  body.override_price = flag(found.override_price);
  if (body.override_price) body.price = found.price;
  if (body.override_price && !Object.hasOwn(found, "price")) throw new PortalError("The customer price override could not be preserved. No plan change was sent.");
  body.discount = found.discount || 0;
  body.save_mac = flag(found.save_mac);
  if (!Object.hasOwn(found, "freetime_enabled")) throw new PortalError("The customer's freetime settings could not be preserved. No plan change was sent.");
  body.freetime = flag(found.freetime_enabled) ? found.freetime : 0;
  if (flag(found.freetime_enabled) && !Object.hasOwn(found, "freetime")) throw new PortalError("The customer's freetime settings are incomplete. No plan change was sent.");
  if (Object.hasOwn(found, "freetime_active")) body.freetime_active = found.freetime_active;
  return body;
}
function renewalConfirmed(payload, username) {
  // Match the portal's body.data per-user results and success/fail counts.
  // This connector submits ONE user. HTTP 200, a message, contradictory results
  // or an unrelated user's success can never confirm this user's renewal.
  const wrappers = envelopes(payload), lists = Array.isArray(payload) ? [payload] : [];
  for (const item of wrappers) for (const key of ["body", "data", "results", "result"]) if (Array.isArray(item[key])) lists.push(item[key]);
  const invalid = item => responseFailed(item) || (Object.hasOwn(item, "fail") && item.fail !== 0) || (Object.hasOwn(item, "success") && item.success !== true && item.success !== 1);
  if (wrappers.some(item => invalid(item) || (item.username && item.username !== username))) return false;
  const explicit = item => item?.success === true || item?.success === 1 || item?.ok === true || ["success", "ok", "succeeded"].includes(String(item?.status).toLowerCase());
  const populated = lists.filter(list => list.length);
  if (populated.length) {
    if (populated.some(list => list.length !== 1 || !object(list[0]) || list[0].username !== username || invalid(list[0]) || !explicit(list[0]))) return false;
    if (wrappers.some(item => typeof item.success === "number" && item.success !== 1)) return false;
    return true;
  }
  if (lists.length) return false;
  if (wrappers.some(item => typeof item.success === "number" && item.success !== 1)) return false;
  return wrappers.some(item => (item.success !== 1 && explicit(item)) || (item.success === 1 && item.fail === 0));
}

function directoryPage(payload) {
  const wrappers = envelopes(payload);
  if (wrappers.some(responseFailed)) throw new PortalError("The portal denied customer search. Check the API account's customer-view permissions.");
  const native = wrappers.find(item => Array.isArray(item.data) && Object.hasOwn(item, "itemscount"));
  if (native) {
    const count = Number(native.itemscount);
    if (!/^\d+$/.test(String(native.itemscount)) || !Number.isSafeInteger(count) || count < native.data.length) throw new PortalError("The portal returned invalid customer pagination. Use exact username lookup.");
    return { list: native.data, count, native: true, next: null };
  }
  const list = Array.isArray(payload) ? payload : wrappers.flatMap(item => [item.results, item.users, item.data]).find(Array.isArray);
  if (!list) throw new PortalError("The portal customer-list format is not recognized. Use exact username lookup.");
  return { list, native: false, count: null, next: wrappers.find(item => item.next)?.next || null };
}

const localPhone = value => String(value).replace(/\D/g, "").replace(/^00961|^961/, "").replace(/^0/, "");
function customerMatches(customer, term) {
  const lower = term.toLocaleLowerCase(), phoneTerm = /^[+\d\s().-]+$/.test(term) ? localPhone(term) : "";
  return customer.username.toLocaleLowerCase().includes(lower) || customer.name.toLocaleLowerCase().includes(lower) || (phoneTerm.length >= 3 && localPhone(customer.phone).includes(phoneTerm));
}

class PortalSettings {
  constructor(file, safeStorage) { this.file = file; this.safeStorage = safeStorage; }
  read() {
    if (!fs.existsSync(this.file)) return {};
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { throw new PortalError("Internet API settings could not be read. Reconfigure them on the main PC."); }
  }
  secure() {
    if (!this.safeStorage?.isEncryptionAvailable() || (process.platform === "linux" && this.safeStorage.getSelectedStorageBackend?.() === "basic_text")) throw new PortalError("Secure Windows credential storage is unavailable. No password was saved.");
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  status() {
    const data = this.read();
    return { url: PORTAL_URL, configured: Boolean(data.username && data.passwordEncrypted), ready: Boolean(data.username && data.passwordEncrypted && data.enabled && data.verifiedAt), verifiedAt: data.verifiedAt || null };
  }
  publicSettings() { return { ...this.status(), username: this.read().username || "" }; }
  configure(input = {}) {
    this.secure();
    const old = this.read(), username = portalUsername(input.username);
    const password = String(input.password ?? "");
    if (!password && (username !== old.username || !old.passwordEncrypted)) throw new PortalError("Enter the dedicated Proradius API account password.");
    if (password.length > 2048) throw new PortalError("The password is too long.");
    this.write({ username, passwordEncrypted: password ? this.safeStorage.encryptString(password).toString("base64") : old.passwordEncrypted, enabled: false, verifiedAt: null });
    return this.publicSettings();
  }
  credentials() {
    this.secure();
    const data = this.read();
    if (!data.username || !data.passwordEncrypted) throw new PortalError("Configure the Internet API on the main PC first.");
    try { return { username: data.username, password: this.safeStorage.decryptString(Buffer.from(data.passwordEncrypted, "base64")) }; } catch { throw new PortalError("Windows could not unlock the API password. Re-enter it on the main PC."); }
  }
  enable() { const data = this.read(); this.write({ ...data, enabled: true, verifiedAt: new Date().toISOString() }); return this.publicSettings(); }
  disable() { const data = this.read(); this.write({ ...data, enabled: false, verifiedAt: null }); return this.publicSettings(); }
}

class ProradiusApi {
  constructor(settings, fetchImpl = globalThis.fetch) {
    this.settings = settings; this.fetch = fetchImpl; this.access = null; this.directory = null;
    this.searchCache = new Map(); this.generation = 0; this.tokenPending = null;
  }
  clearToken() { this.access = null; this.billingContext=null; this.directory = null; this.searchCache.clear(); this.fixedCostCatalogue=null;this.fixedCostPending=null;this.generation++; this.tokenPending = null; }
  async request(route, { method = "GET", authorization, body, renewal = false, planChange = false, financial = false, customerCreate = false } = {}) {
    const writing=renewal||planChange||financial||customerCreate;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetch(`${PORTAL_URL}${route}`, { method, redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(authorization ? { Authorization: authorization } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new PortalError(response.status === 401 || response.status === 403 ? "The portal rejected the API account or its permissions." : `The Internet portal returned HTTP ${response.status}.`, writing, response.status);
      if (Number(response.headers.get("content-length")) > MAX_RESPONSE) throw new PortalError("The portal response is too large.", writing);
      const reader = response.body?.getReader();
      if (!reader) throw new PortalError("The portal returned an empty response.", writing);
      const chunks = []; let size = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE) { await reader.cancel(); throw new PortalError("The portal response is too large.", writing); }
        chunks.push(Buffer.from(value));
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new PortalError("The portal returned an unrecognized response.", writing); }
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(financial ? "The money-transfer response was lost. Check Proradius transactions; do not send the transfer again." : planChange ? "The plan-change response was lost. Verify the current plan in Proradius before retrying." : renewal ? "The renewal response was lost. Check Proradius before retrying; the account may already be renewed." : "Cannot securely connect to pi.fibernetlb.net. Check the connection and HTTPS certificate.", writing);
    } finally { clearTimeout(timer); }
  }
  async token() {
    if(this.registrationScope){
      if(this.registrationScope.parent.generation!==this.registrationScope.generation)throw new PortalError('The Internet API settings changed. Select the reseller again; no further submission was sent.');
      if(!this.access||this.access.until<=Date.now())throw new PortalError('The selected reseller session expired. Select the reseller again.');
      return this.access.value;
    }
    if (this.access && this.access.until > Date.now()) return this.access.value;
    if (this.tokenPending) return this.tokenPending;
    const generation = this.generation;
    const pending = (async () => {
      const data = await this.request("/api/token/", { method: "POST", body: this.settings.credentials() });
      if (generation !== this.generation) throw new PortalError("The Internet API settings changed. Test the connection again; no renewal was sent.");
      if (data && Object.hasOwn(data, "2fa_required")) throw new PortalError("This account requires interactive two-factor login. Use a dedicated API account supported by Proradius; keep administrator two-factor protection enabled.");
      if (responseFailed(data) || typeof data?.access !== "string" || !data.access || data.access.length > 16384) throw new PortalError("The portal did not return the documented access token. Check API authentication.");
      this.access = { value: data.access, until: Date.now() + 60000 };
      return data.access;
    })();
    this.tokenPending = pending;
    try { return await pending; } finally { if (this.tokenPending === pending) this.tokenPending = null; }
  }
  async get(route) {
    const generation = this.generation;
    const read = async () => {
      const token = await this.token();
      if (generation !== this.generation) throw new PortalError("The Internet API settings changed. Test the connection again.");
      const payload = await this.request(route, { authorization: `Bearer ${token}` });
      if (generation !== this.generation) throw new PortalError("The Internet API settings changed. Test the connection again.");
      if(this.registrationScope&&this.registrationScope.parent.generation!==this.registrationScope.generation)throw new PortalError('The Internet API settings changed. Select the reseller again.');
      return payload;
    };
    try { return await read(); } catch (error) {
      // A read-only GET can safely reauthenticate once after an expired token.
      // Forbidden responses and non-idempotent renewal POSTs are never retried.
      if(this.registrationScope&&error.status===401)throw new PortalError('The selected reseller session expired or was rejected. Select the reseller again; no fallback to the main API account was attempted.');
      if (error.status !== 401 || generation !== this.generation) throw error;
      this.access = null; return read();
    }
  }
  async customer(value) {
    const username = portalUsername(object(value) ? value.username : value);
    const scope = object(value) && value.reseller ? await this.resellerScope(value.reseller) : null;
    const customer=customerFromResponse(await this.get(`/api/user/?${new URLSearchParams({ username })}`), username);
    if(scope && customer.resellerId!==scope.id) throw new PortalError("This customer does not belong to the selected reseller. No plan change or renewal was sent.");
    return customer;
  }
  async receiptCredentials(value) {
    const username = portalUsername(value);
    const {found} = customerRecord(await this.get(`/api/user/?${new URLSearchParams({username})}`), username);
    const password = typeof found.password === "string" ? found.password : "";
    if (!password || password.length > 128 || /[\r\n\x00]/.test(password) || /^[*•●]+$/.test(password) || /^(hidden|redacted|masked)$/i.test(password)) throw new PortalError("Proradius did not supply this customer's Internet password. Check customer-view permissions.");
    return {username,password};
  }
  async costContext(){
    const cached=this.billingContext;
    if(cached&&cached.registrationScope.generation===this.generation&&cached.access?.until>Date.now()+15000)return cached;
    const reseller=await this.resellerScope('fibernetlb2');
    const context=await this.registrationContext({resellerId:reseller.id,resellerUsername:'fibernetlb2'});
    this.billingContext=context;return context;
  }
  async billingCustomer(value){return (await this.costContext()).customer(value);}
  async billingOptions(){return (await this.costContext()).newCustomerOptions();}
  async quoteRenewal(value, serviceId) {
    if(this.billingOnly&&this.registrationScope?.username!=='fibernetlb2')return (await this.costContext()).quoteRenewal(value,serviceId);
    const username=portalUsername(value),id=positiveId(serviceId);
    if(!id)throw new PortalError('Verify the current service before quoting a renewal.');
    const generation=this.generation,token=await this.token();
    // Verified in Proradius V5.19's public Renew User preview. This is a
    // read-only calculation, unlike op:renew, and includes pending/full cycles.
    const payload=await this.request('/api/user/bulk/actions/',{method:'POST',authorization:`Bearer ${token}`,body:{op:'renewcheck',ids:[{username}]}});
    if(generation!==this.generation||(this.registrationScope&&this.registrationScope.parent.generation!==this.registrationScope.generation))throw new PortalError('API settings changed during the renewal preview. Verify again.');
    return renewalQuoteFromResponse(payload,username,id);
  }
  async customerResellers(){
    // Portal's official UI: authApis.getPermissions() -> /me; reseller list
    // supplies the same IDs used by resellersApis.loginAsReseller().
    const own=registrationPrincipal(await this.get('/api/me'));
    const list=await this.resellers();
    if(new Set(list.map(p=>p.username)).size!==list.length)throw new PortalError('The reseller usernames are ambiguous. Nothing was created.');
    if(own){
      const existing=list.find(p=>p.id===own.id||p.username===own.username);
      if(existing&&((own.id&&existing.id!==own.id)||existing.username!==own.username))throw new PortalError('The reseller identity list is inconsistent. Nothing was created.');
      if(!existing){if(!own.id)throw new PortalError('The API reseller has no verifiable ID in its profile or reseller list. Nothing was created.');list.unshift(own);}else own.id=existing.id;
    }
    if(!list.length)throw new PortalError('No customer resellers are available to the API account. Check reseller-list and Login as permissions.');
    return list.map(p=>({...p,self:Boolean(own&&p.id===own.id)}));
  }
  async registrationContext(selection){
    const id=positiveId(selection?.resellerId),username=portalUsername(selection?.resellerUsername);
    const generation=this.generation;
    const reseller=(await this.customerResellers()).find(p=>p.id===id&&p.username===username);
    if(!reseller)throw new PortalError('Select an exact current Proradius reseller. Nothing was created.');
    let access=await this.token();
    if(!reseller.self){
      // Verified from the portal's public API client and reseller menu:
      // POST /reseller/loginas/ {reseller_id}, response {access,user}.
      // This temporary token is never saved and never replaces the parent login.
      const result=await this.request('/api/reseller/loginas/',{method:'POST',authorization:`Bearer ${access}`,body:{reseller_id:id}});
      const principal=registrationPrincipal(result?.user);
      if(envelopes(result).some(responseFailed)||typeof result?.access!=='string'||!result.access||result.access.length>16384||/[\s\r\n]/.test(result.access)||!principal||(principal.id&&principal.id!==id)||principal.username!==username)throw new PortalError('Proradius did not confirm Login as the selected reseller. Check Login as permission; nothing was created.');
      access=result.access;
    }
    if(this.generation!==generation)throw new PortalError('The Internet API settings changed. Select the reseller again.');
    const context=new ProradiusApi({credentials(){throw new PortalError('Reseller sessions cannot fall back to the saved API login.');}},this.fetch);
    context.registrationScope={parent:this,generation,id,username};
    context.access={value:access,until:Date.now()+5*60000};
    const identity=registrationPrincipal(await context.get('/api/me'));
    // /me's documented UI contract always supplies username and user_type;
    // some builds omit id. Exact unique username verifies that authenticated
    // session; if an ID is supplied it must also match the selected catalogue ID.
    if(!identity||(identity.id&&identity.id!==id)||identity.username!==username)throw new PortalError('The reseller session does not match the selected owner. Nothing was created.');
    return context;
  }
  async newCustomerOptions(){
    const payload=await this.get('/api/user/get_services_switches/'),wrappers=envelopes(payload);
    if(wrappers.some(responseFailed))throw new PortalError('Proradius denied Add User options. The API account needs customer-create permission and assigned services.');
    const readList=(key)=>wrappers.map(item=>item[key]).find(Array.isArray);
    const choices=(list,kind)=>{
      if(!Array.isArray(list)||list.length>2000)throw new PortalError(`Proradius returned an unrecognized ${kind} list. Nothing was created.`);
      const seen=new Set();return list.map(item=>{
        const id=positiveId(item?.service_id??item?.switch_id??item?.collector_id??item?.id),name=short(item?.shortname??item?.name??item?.servicename??item?.switchname??item?.username??item?.fullname);
        if(!id||!name||seen.has(id))throw new PortalError(`Proradius returned ambiguous ${kind} choices. Nothing was created.`);
        seen.add(id);return {id,name,...kind==='service'?{cost:portalCost(item.price)}:{}};
      });
    };
    // The current Add User page loads collectors from this same reseller-scoped
    // bootstrap. An empty list is authoritative, not a reason to query invoices.
    const collectorSource=wrappers.find(item=>Object.hasOwn(item,'collectors'));
    let collectors=collectorSource?.collectors;
    if(!collectorSource){
      const collectorsPayload=await this.get('/api/invoices/collectors/'),collectorWrappers=envelopes(collectorsPayload);
      if(collectorWrappers.some(responseFailed))throw new PortalError('Proradius denied collector lookup. Nothing was created.');
      collectors=Array.isArray(collectorsPayload)?collectorsPayload:collectorWrappers.flatMap(item=>[item.body,item.collectors,item.data]).find(Array.isArray);
    }
    const services=choices(readList('services'),'service');
    if(!services.length)throw new PortalError('No services are assigned to the API account. Configure a customer-create account with the correct reseller services.');
    return {services,switches:choices(readList('switches'),'switch'),collectors:choices(collectors,'collector')};
  }
  async assertCustomerAbsent(username){
    const page=directoryPage(await this.get(`/api/users?${new URLSearchParams({username:portalUsername(username),pageIndex:'1',pageSize:'50'})}`));
    // A failed customer lookup is NOT evidence that an account is absent.
    if(!page.native||page.count>page.list.length)throw new PortalError('Cannot prove this username is unused. Narrow the username or check the portal; no account was created.');
    if(page.list.some(item=>typeof item?.username!=='string'))throw new PortalError('The portal directory format changed. Nothing was created.');
    if(page.list.some(item=>item.username.toLowerCase()===username.toLowerCase()))throw new PortalError('This username already exists in Proradius. Choose a different username; nothing was created.');
    return true;
  }
  async verifyNewCustomer(input){
    const customer=await this.customer(input.username);
    if(customer.serviceId!==input.service||customer.name!==input.name||customer.phone!==input.phone||(input.resellerId&&customer.resellerId!==input.resellerId))throw new PortalError('The read-back customer details or reseller owner do not match this registration. Check Proradius; no payment was recorded.',true);
    return customer;
  }
  async setFreeRenewalExpiry(input,beforeSend){
    if(!/^\d{4}-\d{2}-05$/.test(input.expiry))throw new PortalError('Invalid free renewal expiry.');
    const payload=await this.get(`/api/user/?${new URLSearchParams({username:input.username})}`);
    const customer=customerFromResponse(payload,input.username);
    if(customer.blocked||customer.serviceId!==input.serviceId||customer.resellerId!==input.resellerId||customer.expiry!==input.expectedExpiry)throw new PortalError('The customer, owner, service or expiry changed. Verify again; no free renewal was sent.');
    if(customer.expiry.slice(0,10)>=input.expiry)throw new PortalError('This customer already has service until the requested 5th or later. No expiry was shortened and no funding was recorded.');
    const body=planUpdateBody(payload,input.username,input.serviceId);body.expiry_date=input.expiry;
    const token=await this.token();beforeSend({customer,beforeExpiry:customer.expiry});
    const result=await this.request('/api/user/',{method:'PUT',authorization:`Bearer ${token}`,body,customerCreate:true});
    if(envelopes(result).some(responseFailed)||result?.success!==true)throw new PortalError('Proradius did not confirm the free expiry edit. Check the customer; do not repeat the operation.',true);
    const after=await this.customer(input.username);
    if(after.serviceId!==input.serviceId||after.resellerId!==input.resellerId||after.name!==customer.name||after.phone!==customer.phone||after.expiry.slice(0,10)!==input.expiry)throw new PortalError('The free renewal could not be verified. Review the exact expiry edit before retrying.',true);
    return {customer:after,beforeExpiry:customer.expiry,freeExpiry:input.expiry};
  }
  async setStarterExpiry(input,beforeSend){
    if(!/^\d{4}-\d{2}-05$/.test(input.starterExpiry))throw new PortalError('Invalid free starter expiry.');
    const payload=await this.get(`/api/user/?${new URLSearchParams({username:input.username})}`);
    const customer=customerFromResponse(payload,input.username);
    if(customer.serviceId!==input.service||customer.name!==input.name||customer.phone!==input.phone||(input.resellerId&&customer.resellerId!==input.resellerId))throw new PortalError('The new customer or reseller owner changed before expiry was set. Review the account.',true);
    // Preserve every editable field; never perform a paid renewal to grant free days.
    const body=planUpdateBody(payload,input.username,input.service);body.expiry_date=input.starterExpiry;
    const token=await this.token();beforeSend?.({phase:'expiry-submission',customer});
    const result=await this.request('/api/user/',{method:'PUT',authorization:`Bearer ${token}`,body,customerCreate:true});
    if(envelopes(result).some(responseFailed)||result?.success!==true)throw new PortalError('Proradius did not confirm the expiry edit. Check the new customer before retrying.',true);
    const after=await this.verifyNewCustomer(input);
    if(after.expiry.slice(0,10)!==input.starterExpiry)throw new PortalError('The free starter expiry was not confirmed by Proradius. Review the new account.',true);
    return after;
  }
  async createCustomer(input,password,beforeSend,validateOptions){
    const options=await this.newCustomerOptions();
    if(!options.services.some(p=>p.id===input.service)||!options.collectors.some(p=>p.id===input.collector)||!options.switches.some(p=>p.id===input.switch))throw new PortalError('Choose a current service, collector and switch from Proradius. Nothing was created.');
    await validateOptions?.(options);
    await this.assertCustomerAbsent(input.username);
    const body={username:input.username,password,'confirm-password':password,collector:input.collector,name:input.name,note:input.note,phone:input.phone,email:input.email,address:input.address,'due-date':input.dueDate,region:input.region,nationality:input.nationality,building:input.building,service:input.service,switch:input.switch,discount:input.discount,...input.overridePrice?{'price-override':'on',price:String(input.price)}:{}};
    const token=await this.token();beforeSend({phase:'create-submission'});
    const result=await this.request('/api/user/',{method:'POST',authorization:`Bearer ${token}`,body,customerCreate:true});
    if(envelopes(result).some(responseFailed)||result?.success!==true)throw new PortalError('Proradius did not explicitly confirm account creation. Check the username; do not create it again.',true);
    let customer=await this.verifyNewCustomer(input);
    beforeSend({phase:'created',customer});
    if(input.freeStarter)customer=await this.setStarterExpiry(input,beforeSend);
    this.directory=null;this.searchCache.clear();
    return {phase:'complete',customer,starterExpiry:input.freeStarter?input.starterExpiry:null};
  }
  async resellers() {
    const payload = await this.get("/api/resellers"), wrappers = envelopes(payload);
    if (wrappers.some(responseFailed)) throw new PortalError("Proradius denied reseller lookup.");
    const list = Array.isArray(payload) ? payload : wrappers.flatMap(item => [item.body, item.resellers, item.data]).find(Array.isArray);
    if (!list || list.length > 2000) throw new PortalError("The portal reseller-list format is not recognized.");
    const seen = new Set();
    return list.map(item => {
      const id = positiveId(item?.id), username = short(item?.username);
      if (!id || !username || seen.has(id)) throw new PortalError("The portal reseller list is invalid or ambiguous.");
      seen.add(id); return { id, username, name: short(item.fullname ?? item.full_name ?? item.name) };
    });
  }
  async search(value) {
    const term = String(object(value) ? value.term ?? "" : value ?? "").trim();
    const resellerName = String(object(value) ? value.reseller ?? "" : "").trim();
    if (resellerName.length > 128) throw new PortalError("The reseller name is too long.");
    const scope = resellerName ? await this.resellerScope(resellerName) : null;
    if (term.length < 3 || term.length > 128) throw new PortalError("Enter at least 3 characters of a username, phone number or customer name.");
    const result = customers => {
      const matches = customers.filter(item => customerMatches(item, term));
      return { customers: matches.slice(0, 30), total: matches.length };
    };
    const cacheKey = JSON.stringify([term, scope?.id ?? null]);
    if (this.directory?.until > Date.now() && this.directory.scope === (scope?.id ?? null)) return result(this.directory.customers);
    const cached = this.searchCache.get(cacheKey);
    if (cached?.until > Date.now()) return cached.result;
    const started = Date.now(), customers = [], seen = new Set(), generation = this.generation;
    const readPage = async route => {
      if (Date.now() - started > 30000) throw new PortalError("Customer search took too long. Narrow the search or use exact username lookup.");
      const page = directoryPage(await this.get(route));
      if (generation !== this.generation) throw new PortalError("The Internet API settings changed. Search again.");
      for (const item of page.list) {
        if (typeof item?.username !== "string") throw new PortalError("The customer directory contains an unrecognized username. Use exact username lookup.");
        const username = portalUsername(item.username);
        if (!seen.has(username)) {
          let customer = customerFromResponse(item, username);
          if (scope) {
            if (!customer.resellerId && !customerMatches(customer, term)) continue;
            if (!customer.resellerId) {
              if(Date.now()-started>30000) throw new PortalError("Reseller-scoped search took too long. Narrow it or verify an exact username.");
              customer = await this.customer(username);
            }
            if (customer.resellerId !== scope.id) continue;
          }
          customers.push(customer); seen.add(username);
        }
      }
      return page;
    };
    const routeFor = (field, value, pageIndex) => `/api/users?${new URLSearchParams({ [field]: value, ...(scope ? { reseller: String(scope.id) } : {}), pageIndex: String(pageIndex), pageSize: "50" })}`;
    const first = await readPage(routeFor("username", term, 1));
    if (!first.native) {
      // Compatibility with older flat or next-link API responses. Never follow
      // a pagination link to another host or another API endpoint.
      let page = first, pages = 1; const visited = new Set();
      while (page.next) {
        let next; try { next = new URL(page.next, PORTAL_URL); } catch { throw new PortalError("The portal returned an unsafe customer-list link."); }
        if (next.origin !== PORTAL_URL || next.username || next.password || !["/api/users", "/api/users/"].includes(next.pathname)) throw new PortalError("The portal returned an unsafe customer-list link.");
        if (scope && next.searchParams.get("reseller") !== String(scope.id)) throw new PortalError("The portal pagination lost the reseller filter. No unfiltered page was read.");
        const route = next.pathname + next.search;
        if (visited.has(route) || pages++ >= 5) throw new PortalError("The customer directory is too large or pagination repeated. Use exact username lookup.");
        visited.add(route); page = await readPage(route);
        if (page.native) throw new PortalError("The customer pagination format changed. Use exact username lookup.");
      }
      if(!scope) this.directory = { customers, scope: null, until: Date.now() + 30000 };
      return result(customers);
    }
    const collectNative = async (field, value, firstPage) => {
      let page = firstPage || await readPage(routeFor(field, value, 1)), collected = 0, index = 1;
      const count = page.count, pageUsers = new Set();
      for (;;) {
        if (!page.native || page.count !== count) throw new PortalError("The portal customer directory changed during search. Search again.");
        for (const item of page.list) {
          if (pageUsers.has(item.username)) throw new PortalError("The portal repeated a customer page. Use exact username lookup.");
          pageUsers.add(item.username);
        }
        collected += page.list.length;
        if (collected > count || (!page.list.length && collected < count)) throw new PortalError("The portal returned incomplete customer pagination. Use exact username lookup.");
        if (collected === count) break;
        if (++index > 5) throw new PortalError("Too many customers match this search. Narrow it or use exact username lookup.");
        page = await readPage(routeFor(field, value, index));
      }
    };
    await collectNative("username", term, first);
    await collectNative("shortname", term);
    const phoneTerm = /^[+\d\s().-]+$/.test(term) ? localPhone(term) : "";
    // Searching a digit suffix accommodates local, +961 and formatted phone
    // numbers. The complete normalized number is still checked client-side.
    if (phoneTerm.length >= 3) await collectNative("phone", phoneTerm.slice(-3));
    const found = result(customers);
    for (const [key, entry] of this.searchCache) if (entry.until < Date.now()) this.searchCache.delete(key);
    if (this.searchCache.size >= 40) this.searchCache.delete(this.searchCache.keys().next().value);
    this.searchCache.set(cacheKey, { result: found, until: Date.now() + 30000 });
    return found;
  }
  async resellerScope(value) {
    const name=String(value??"").trim();
    if(!name || name.length>128) throw new PortalError("Enter a valid reseller name.");
    const matches=(await this.resellers()).filter(item=>[item.username,item.name].some(label=>label && label.toLocaleLowerCase()===name.toLocaleLowerCase()));
    if(matches.length!==1) throw new PortalError("Enter or select one exact Proradius reseller name. No unfiltered search was performed.");
    return matches[0];
  }
  async fixedCosts(force=false){
    if(!force&&this.fixedCostCatalogue?.until>Date.now())return this.fixedCostCatalogue;
    if(this.fixedCostPending)return this.fixedCostPending;
    const generation=this.generation;
    const pending=(async()=>{
      const reseller=await this.resellerScope("fibernetlb2");
      const payload=await this.get(`/api/services/reseller/action/?${new URLSearchParams({id:String(reseller.id)})}`),wrappers=envelopes(payload);
      if(wrappers.some(responseFailed))throw new PortalError("Proradius denied fibernetlb2's fixed bundle costs.");
      const body=wrappers.find(item=>Array.isArray(item.services));
      if(!body||body.services.length>2000||(body.username&&body.username!=="fibernetlb2"))throw new PortalError("Proradius's fibernetlb2 service-cost response is invalid.");
      const seen=new Set();
      const plans=body.services.map(item=>{
        const id=positiveId(item?.service_id??item?.serviceid??item?.id),name=short(item?.servicename??item?.shortname),cost=portalCost(item?.price);
        if(!id||!name||seen.has(id)||cost===null)throw new PortalError("Proradius returned invalid or ambiguous fixed service costs.");
        seen.add(id);
        return {id,name,cost:item.limittype&&item.limittype!=="fixed"?null:cost};
      });
      if(generation!==this.generation)throw new PortalError("API settings changed during cost synchronization.");
      const result={plans,reseller:"fibernetlb2",verifiedAt:new Date().toISOString(),until:Date.now()+3600000};this.fixedCostCatalogue=result;return result;
    })();
    this.fixedCostPending=pending;
    try{return await pending;}finally{if(this.fixedCostPending===pending)this.fixedCostPending=null;}
  }
  async test(username) {
    this.clearToken(); this.settings.disable();
    let customer = await this.customer(username);
    if(this.billingOnly){
      const scoped=await this.billingCustomer(username);
      if(scoped.serviceId!==customer.serviceId||scoped.resellerId!==customer.resellerId)throw new PortalError('The customer changed during fibernetlb2 billing verification. Test again.');
      await this.fixedCosts(true);
      customer={...scoped,costReseller:'fibernetlb2'};
    }
    return { ...this.settings.enable(), customer };
  }
  async moneyResellers() {
    // Official List Admin Resellers UI uses resellersApis.getListAdminResellers:
    // /api/reseller/admin/list, pageIndex/pageSize, data + itemscount, ID/Reseller.
    const ids=new Set(),names=new Set(),result=[];let count=null;
    for(let page=1;page<=20;page++){
      const payload=await this.get('/api/reseller/admin/list?'+new URLSearchParams({pageIndex:String(page),pageSize:'500',sortField:'ID',sortOrder:'asc'}));
      if(envelopes(payload).some(responseFailed)||!Array.isArray(payload?.data)||!/^\d+$/.test(String(payload?.itemscount)))throw new PortalError('Proradius Admin Resellers list is unavailable or has an unsupported format. Use an API account with Admin Resellers read permission.');
      const total=Number(payload.itemscount);if(!Number.isSafeInteger(total)||total>10000||total<payload.data.length||count!==null&&count!==total)throw new PortalError('Admin Resellers list changed or is too large. Refresh; nothing was submitted.');count=total;
      if(!payload.data.length&&result.length<count)throw new PortalError('Proradius returned an incomplete Admin Resellers list.');
      for(const item of payload.data){
        const id=positiveId(item?.ID),username=short(item?.Reseller),name=short(item?.Name);
        if(!id||!username||ids.has(id)||names.has(username.toLowerCase()))throw new PortalError('Proradius returned ambiguous Admin Reseller identities.');
        let balance=null,balanceError='',spendableCents=null;const balanceRead=true;
        try{const raw=item.Balance;balance=representativeBalance(raw);spendableCents=nativeSpendableCents(raw);}catch(error){balanceError=error.message;}
        const row={id,username,name,balance,balanceRead,balanceAvailable:!balanceError,balanceError};
        if(!balanceError)nativeBalanceCredits.set(row,spendableCents);
        ids.add(id);names.add(username.toLowerCase());result.push(row);
      }
      if(result.length===count)return result;if(result.length>count)throw new PortalError('Admin Reseller count does not match its list.');
    }
    throw new PortalError('Admin Reseller pagination limit reached. Nothing was submitted.');
  }
  async topUp(input,beforeSend) {
    const amount=portalCost(input.amount),id=positiveId(input.portalResellerId);
    if(!id||amount===null||amount<1||!["Cash","Whish Money"].includes(input.paymentMethod)) throw new PortalError("Add Money requires at least $1 received by Cash or Whish Money.");
    const reseller=(await this.moneyResellers()).find(item=>item.id===id&&item.username===input.username);
    if(!reseller) throw new PortalError("The exact reseller is not available for money transfer.");
    if(reseller.balanceRead&&!reseller.balanceAvailable)throw new PortalError(reseller.balanceError);
    const comment=String(input.comment??"");
    if(comment.length>500) throw new PortalError("The transfer comment is too long.");
    const body={"destination-reseller":id,sum:amount,"confirm-sum":amount,comment,transfer_method:input.paymentMethod==="Cash"?"cash":"whish",paid:true,cash:input.paymentMethod==="Cash",whish:input.paymentMethod==="Whish Money",wu:false,cheque:false,discount:false,maintenance:false};
    const token=await this.token();beforeSend({beforeBalance:reseller.balance});
    const response=await this.request("/api/money/transfer/",{method:"POST",authorization:`Bearer ${token}`,body,financial:true});
    // A balance delta alone is not proof (another operator may transfer money).
    if(envelopes(response).some(responseFailed)||response?.success!==true) throw new PortalError("Proradius did not explicitly confirm this transfer. Review its transactions before retrying.",true);
    const after=(await this.moneyResellers()).find(item=>item.id===id&&item.username===input.username);
    if(!after||after.balanceRead&&!after.balanceAvailable) throw new PortalError("The transfer succeeded but its reseller identity or Proradius balance could not be verified. Review the portal.",true);
    return {username:reseller.username,portalResellerId:id,amount,balanceRead:reseller.balanceRead,beforeBalance:reseller.balance,afterBalance:after.balance};
  }
  async withdraw(input,beforeSend){
    const amount=portalCost(input.amount),id=positiveId(input.portalResellerId);
    if(!id||amount===null||amount<1)throw new PortalError('Refund requires a positive amount of at least $1.');
    const reseller=(await this.moneyResellers()).find(r=>r.id===id&&r.username===input.username);
    if(!reseller)throw new PortalError('The exact reseller is unavailable. No withdrawal was sent.');
    const credit=nativeBalanceCredits.get(reseller),insufficient=credit===undefined?reseller.balance<amount:credit<Math.round(amount*100);
    if(reseller.balanceRead&&(!reseller.balanceAvailable||insufficient))throw new PortalError(reseller.balanceError||'This reseller has insufficient unused portal credit. No withdrawal was sent.');
    const comment=String(input.comment||'');if(comment.length>500)throw new PortalError('The refund comment is too long.');
    const token=await this.token();beforeSend({beforeBalance:reseller.balance});
    const response=await this.request('/api/money/withdraw/',{method:'POST',authorization:`Bearer ${token}`,body:{'destination-reseller':id,sum:amount,'confirm-sum':amount,comment},financial:true});
    if(envelopes(response).some(responseFailed)||response?.success!==true)throw new PortalError('Proradius did not explicitly confirm the withdrawal. Review its transactions; do not repeat it.',true);
    const after=(await this.moneyResellers()).find(r=>r.id===id&&r.username===input.username);if(!after||after.balanceRead&&!after.balanceAvailable)throw new PortalError('Withdrawal confirmed but its reseller identity or Proradius balance could not be verified. Review the portal.',true);
    return {username:reseller.username,portalResellerId:id,amount,balanceRead:reseller.balanceRead,beforeBalance:reseller.balance,afterBalance:after.balance};
  }
  async resellerTransactions(start,end){
    try{ResellerTransactions.date(start);ResellerTransactions.date(end);if(start>end)throw Error('Choose an ordered date range.');const resellers=await this.moneyResellers(),seen=new Set(),charges=[];let count=null,received=0;
      for(let index=1;index<=40;index++){
        const route='/api/transactions/list/?'+new URLSearchParams({pageIndex:String(index),pageSize:'500',date_from:start,date_till:end});
        const current=ResellerTransactions.page(await this.get(route));if(count!==null&&count!==current.count)throw Error('Portal transactions changed during pagination. Refresh; nothing was imported.');count=current.count;
        if(!current.rows.length&&received<count)throw Error('Portal returned an incomplete transaction list. Nothing was imported.');
        for(const row of current.rows){const item=ResellerTransactions.parseTransaction(row,resellers,start,end);if(seen.has(item.id))throw Error('Portal repeated a transaction page. Nothing was imported.');seen.add(item.id);received++;if(!item.ignored)charges.push(item);}
        if(received===count)return {start,end,count,charges,resellers,verifiedAt:new Date().toISOString()};if(received>count)throw Error('Portal transaction pagination is inconsistent.');
      }throw Error('Too many transactions; choose a shorter period.');
    }catch(error){if(error instanceof PortalError)throw error;throw new PortalError(error.message);}
  }
  async quoteChange(value) {
    if(this.billingOnly&&this.registrationScope?.username!=='fibernetlb2')return (await this.costContext()).quoteChange(value);
    const customer=await this.customer({username:value.username,reseller:value.reseller||""});
    const targetId=positiveId(value.targetId),expectedId=positiveId(value.expectedId);
    if(customer.blocked||!targetId||!expectedId||customer.serviceId!==expectedId||targetId===expectedId) throw new PortalError("Verify an unblocked customer and select a different service. No change was sent.");
    const target=customer.plans?.find(item=>item.id===targetId&&item.cost!==null);
    if(!target) throw new PortalError("The target service or its internal cost is unavailable for this customer.");
    const allowed=await this.get(`/api/user/services/?${new URLSearchParams({username:customer.username})}`);
    if(envelopes(allowed).some(responseFailed)||!Array.isArray(allowed?.body)||allowed.body.filter(item=>positiveId(item?.service_id)===targetId).length!==1)throw new PortalError("Proradius does not offer this service in Change Service for this customer.");
    const token=await this.token();
    // Confirmed read-only operation used by Proradius's Change Service preview.
    const payload=await this.request("/api/user/bulk/actions/",{method:"POST",authorization:`Bearer ${token}`,body:{op:"checkchangeservice",username:customer.username,service:String(targetId)}});
    return {username:customer.username,customerName:customer.name,phone:customer.phone,resellerId:customer.resellerId??null,expectedId,targetId,beforeName:customer.service,targetName:target.name,expiry:customer.expiry,serviceCost:target.cost,...changeQuoteFromResponse(payload)};
  }
  async applyQuotedChange(quote,beforeSend) {
    if(this.billingOnly&&this.registrationScope?.username!=='fibernetlb2')return (await this.costContext()).applyQuotedChange(quote,beforeSend);
    const fresh=await this.quoteChange({username:quote.username,expectedId:quote.expectedId,targetId:quote.targetId});
    for(const key of ["username","resellerId","expectedId","targetId","expiry","price","freetimePrice","total","currentPeriodPrice","pendingRefills","pendingRefillsPrice","serviceCost","hasPeriodBreakdown"]) if(JSON.stringify(fresh[key])!==JSON.stringify(quote[key])) throw new PortalError("The Proradius quote or account changed. Get a fresh calculation and confirm it again; no change was sent.");
    const token=await this.token();beforeSend();
    const response=await this.request("/api/user/bulk/actions/",{method:"POST",authorization:`Bearer ${token}`,body:{op:"changeservice",data:{username:quote.username,service:quote.targetId}},planChange:true});
    if(envelopes(response).some(responseFailed)||response?.success!==true) throw new PortalError("Proradius did not explicitly confirm the charged plan change. Review its service and transactions before retrying.",true);
    const after=await this.customer(quote.username);
    if(after.serviceId!==quote.targetId||after.resellerId!==(quote.resellerId??undefined)) throw new PortalError("Proradius did not read back the selected plan and reseller. Review the account before retrying.",true);
    this.directory=null;this.searchCache.clear();
    return {username:after.username,serviceId:after.serviceId,service:after.service,expiry:after.expiry};
  }
  async changePlan(username, expectedId, targetId, beforeSend, expectedResellerId = null) {
    if(this.billingOnly&&this.registrationScope?.username!=='fibernetlb2')return (await this.costContext()).changePlan(username,expectedId,targetId,beforeSend,expectedResellerId);
    username = portalUsername(username);
    if (!positiveId(expectedId) || !positiveId(targetId)) throw new PortalError("Choose valid current and target portal plans.");
    const payload = await this.get(`/api/user/?${new URLSearchParams({ username })}`), customer = customerFromResponse(payload, username);
    if (customer.serviceId !== expectedId) throw new PortalError("The customer's portal plan changed since lookup. Verify the customer again; no plan change was sent.");
    if(expectedResellerId && customer.resellerId!==expectedResellerId) throw new PortalError("The customer's reseller changed since lookup. Verify the customer again; no plan change was sent.");
    if (customer.blocked) throw new PortalError("This customer is blocked. No plan change was sent.");
    if (!customer.plans?.some(item => item.id === targetId && item.cost !== null)) throw new PortalError("The target plan or its internal cost is unavailable for this customer.");
    const body = planUpdateBody(payload, username, targetId), token = await this.token();
    beforeSend();
    const response = await this.request("/api/user/", { method: "PUT", authorization: `Bearer ${token}`, body, planChange: true });
    if (envelopes(response).some(responseFailed)) throw new PortalError("Proradius denied the plan update. Verify the customer's current plan before retrying.", true);
    // No write retry. A fresh exact GET, not HTTP 200 or a message, proves the plan.
    const afterPayload = await this.get(`/api/user/?${new URLSearchParams({ username })}`), after = customerFromResponse(afterPayload, username);
    if (after.serviceId !== targetId) throw new PortalError("The portal did not confirm the selected plan. Verify it manually before retrying.", true);
    const beforeInfo = customerRecord(payload, username).found, afterInfo = customerRecord(afterPayload, username).found;
    for (const key of ["password", "reseller", "collector", "switch", "service_expiry", "override_price", "price", "save_mac", "freetime", "freetime_enabled", "shortname", "phone", "email", "address", "note", "region", "nationality", "building", "duedate", "latitude", "longitude", "discount"]) {
      if (JSON.stringify(beforeInfo[key]) !== JSON.stringify(afterInfo[key])) throw new PortalError("The plan changed, but another customer setting also changed. Review Proradius before saving or renewing.", true);
    }
    this.directory = null; this.searchCache.clear(); return after;
  }
  async renew(value, serviceId = null) {
    if(this.billingOnly&&this.registrationScope?.username!=='fibernetlb2')return (await this.costContext()).renew(value,serviceId);
    const username = portalUsername(value), customer = { username };
    if (serviceId !== null) {
      if (!Number.isSafeInteger(serviceId) || serviceId <= 0) throw new PortalError("The current portal service ID is invalid. No renewal was sent.");
      customer.service = serviceId;
    }
    const token = await this.token();
    // Match the live V5 portal's Bearer authentication and current service ID.
    // Never retry this non-idempotent endpoint, even after authentication errors.
    const result = await this.request("/api/user/bulk/actions/", { method: "POST", authorization: `Bearer ${token}`, body: { op: "renew", ids: [customer] }, renewal: true });
    if (!renewalConfirmed(result, username)) throw new PortalError("The portal did not explicitly confirm renewal. Check its refill history before retrying.", true);
    return { confirmed: true };
  }
}
module.exports = { PORTAL_URL, PortalError, PortalSettings, ProradiusApi, portalUsername, customerFromResponse, renewalConfirmed, planUpdateBody, changeQuoteFromResponse,renewalQuoteFromResponse };
