/* Browser transport for the shared FIBER net lb interface. No provider or core session tokens belong here. */
(() => {
  'use strict';
  const validWorkspace = value => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
  const currentUrl = new URL(window.location.href);
  const selected = currentUrl.searchParams.get('workspaceId');
  let workspaceId = validWorkspace(selected) ? selected : 'main';
  const storage = window.sessionStorage;
  const signoutKey = id => 'fibernetlb.web.signed-out:' + id;
  const authEventKey = 'fibernetlb.web.auth-event.v1';
  let metadata = null, csrfToken = '', bootstrapError = null, generation = 0, loadedVersion = '';
  let signedOut = false;
  try { storage.setItem('fibernetlb.web.workspace.v1', workspaceId); signedOut = storage.getItem(signoutKey(workspaceId)) === '1'; } catch (_) {}
  const fallback = () => ({version:'',section:{id:workspaceId,name:workspaceId === 'main' ? 'Main dashboard' : 'Business',kind:workspaceId === 'main' ? 'main' : 'unavailable'},sections:[],areas:[],needsSetup:false});
  const unwrap = value => value && Object.prototype.hasOwnProperty.call(value,'data') ? value.data : value;
  const readChannel = channel => /:(?:access|accounts|all|archive|categoryOverview|categoryPending|categoryStatus|checkoutOptions|collectionBills|collectionPreview|collectionSources|collections|csv|dashboard|debts|details|endDayPreview|endDayTargets|generateBarcode|get|history|importPreview|ledgerOverview|list|lookup|operations|options|overview|payBillPreview|paymentOptions|pending|planHistory|portalList|preview|previewReversal|quoteChange|receipt|receiptCopies|receiptCopy|receiptCredentials|reconciliationHistory|reconciliationPreview|renewalHistory|search|settings|sources|status|summary|test|walletCorrectionHistory|walletCorrectionPreview)$/.test(channel);
  const financialMutation = channel => !channel.startsWith('auth:') && !readChannel(channel);

  async function request(route, options = {}, uncertain = false, timeoutMs = 90000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(route, {...options,credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
      let payload;
      try { payload = await response.json(); } catch (_) { throw Error('The website returned an unreadable response.'); }
      if (!response.ok || payload?.error) {
        const error = Error(typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.');
        error.status = response.status;
        throw error;
      }
      return unwrap(payload);
    } catch (error) {
      if (error.status) throw error;
      const message = uncertain
        ? 'The result could not be confirmed. Check the saved pending request or its status before trying again. Nothing was automatically retried.'
        : 'The website could not be reached. Check your connection and try again.';
      const failure = Error(message);
      failure.uncertain = uncertain;
      throw failure;
    } finally { clearTimeout(timer); }
  }
  async function session() {
    const result = await request('/api/session?workspaceId=' + encodeURIComponent(workspaceId));
    if (typeof result?.csrfToken !== 'string' || !result.csrfToken) throw Error('The website session could not be verified. Reload the page.');
    csrfToken = result.csrfToken;
    return result;
  }
  function showMetadata() {
    const banner = document.getElementById('website-preview-banner');
    if (banner) banner.hidden = metadata?.demo !== true;
  }
  async function loadMetadata() {
    const result = await request('/api/meta?workspaceId=' + encodeURIComponent(workspaceId));
    if (!result?.section || result.section.id !== workspaceId || !Array.isArray(result.sections)) throw Error('The website business context could not be verified.');
    metadata = result;
    if (!loadedVersion) loadedVersion = result.version;
    showMetadata();
    return result;
  }
  const bootstrap = Promise.all([loadMetadata(),session()]).catch(error => { bootstrapError = error; });
  document.addEventListener('DOMContentLoaded', showMetadata);
  async function invoke(channel, ...args) {
    await bootstrap;
    if (!csrfToken) await session();
    if (signedOut && !['auth:login','auth:logout','auth:status'].includes(channel)) throw Error('Please sign in again.');
    if (metadata?.version !== loadedVersion) throw Error('The website version changed. Refresh this page and check saved pending requests before making another change.');
    const ticket = generation;
    const timeoutMs = ['bills:savePortal','bills:saveRenew','bills:renew','finance:commitMonthsClose','finance:resumeMonthsClose'].includes(channel) ? 600000 : /^finance:(?:closeMonth|commitMonth|resumeMonth|pendingMonth)/.test(channel) ? 120000 : 90000;
    let result;
    try { result = await request('/api/rpc', {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken,'X-App-Version':loadedVersion},body:JSON.stringify({channel,args,workspaceId})}, financialMutation(channel),timeoutMs); }
    catch (error) { if(error.status === 401) authEnded(); throw error; }
    if (ticket !== generation && !['auth:logout'].includes(channel)) throw Error('The signed-in session changed. Check the original request before trying again.');
    return result;
  }
  const api = window.buildBrowserPosApi(invoke);
  delete window.buildBrowserPosApi;
  const unavailable = action => async () => { throw Error(action + ' is managed by the website administrator on the server.'); };
  function authEnded(announce = false) {
    generation++; signedOut = true;
    try { storage.setItem(signoutKey(workspaceId),'1'); } catch (_) {}
    if (announce) try { localStorage.setItem(authEventKey,JSON.stringify({workspaceId,at:Date.now(),id:crypto.randomUUID()})); } catch (_) {}
    window.dispatchEvent(new CustomEvent('pos-web-auth-ended',{detail:{workspaceId}}));
  }
  window.addEventListener('storage',event => {
    if (event.key !== authEventKey || !event.newValue) return;
    try { if (JSON.parse(event.newValue).workspaceId === workspaceId) authEnded(); } catch (_) {}
  });
  api.auth = {
    status:async () => { await bootstrap; const result = await session(); return {needsSetup:metadata?.needsSetup === true,user:signedOut ? null : result.user || null}; },
    login:async credentials => {
      await bootstrap;
      await session();
      const user = await invoke('auth:login',credentials);
      if (!user || typeof user !== 'object' || !user.username || user.sessionToken) throw Error('The sign-in response could not be verified.');
      generation++; signedOut = false;
      try { storage.removeItem(signoutKey(workspaceId)); } catch (_) {}
      return user;
    },
    logout:async () => { try { return await invoke('auth:logout'); } finally { authEnded(true); } },
    createOwner:unavailable('Initial administrator setup')
  };
  api.workspace = {
    current:async () => { await bootstrap; return metadata || fallback(); },
    open:async id => {
      await bootstrap;
      if (!validWorkspace(id) || !metadata?.sections?.some(section => section.id === id)) throw Error('Unknown business section.');
      if (id !== workspaceId) await invoke('auth:switch',id);
      try { storage.removeItem(signoutKey(id)); } catch (_) {}
      window.location.assign('/?workspaceId=' + encodeURIComponent(id));
      return {ok:true};
    },
    login:async () => { window.location.assign('/?workspaceId=main'); return {ok:true}; },
    ready:async () => ({ok:true}),
    reset:unavailable('Starting fresh')
  };
  api.network = {
    status:async () => {
      await bootstrap;
      try { await loadMetadata(); bootstrapError = null; return {configured:true,connected:true,mode:'web',serverUrl:window.location.origin,version:loadedVersion,localVersion:loadedVersion,serverVersion:metadata.version,versionMismatch:metadata.version!==loadedVersion}; }
      catch (error) { return {configured:true,connected:false,mode:'web',serverUrl:window.location.origin,error:(bootstrapError || error).message}; }
    },
    configure:unavailable('Connection configuration'),
    restart:unavailable('Server restart')
  };
  const versionStatus = async () => { await bootstrap; await loadMetadata(); return {mode:'web',currentVersion:loadedVersion,serverVersion:metadata.version,available:loadedVersion!==metadata.version,website:true}; };
  api.updates = {status:versionStatus,check:versionStatus,onProgress:() => () => {},saveSettings:unavailable('Website updates'),download:unavailable('Website updates'),install:unavailable('Website updates'),prepareClients:unavailable('Desktop installers')};
  // Absence is deliberate: ReceiptPaper uses the browser dialog without claiming a printer job was accepted.
  delete api.printing;
  delete api.rollback;
  api.backups.openFolder = unavailable('Opening the server backup folder');
  api.backups.extract = unavailable('Backup extraction and recovery');
  api.bandwidth.open = async () => {
    if (workspaceId !== 'main') throw Error('Open Main dashboard first.');
    await invoke('bandwidth:access');
    window.location.assign('/bandwidth.html?workspaceId=main');
    return {ok:true};
  };
  api.bandwidth.close = async () => { window.location.assign('/?workspaceId=main'); return {ok:true}; };
  async function downloadCsv(channel,args) {
    const result = await invoke(channel,...args);
    if (!result || typeof result.contents !== 'string' || typeof result.filename !== 'string') throw Error('The CSV export could not be verified.');
    const filename = result.filename.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,160);
    const url = URL.createObjectURL(new Blob([result.contents],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = filename.endsWith('.csv') ? filename : filename + '.csv';
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    return {canceled:false};
  }
  api.bills.export = (...args) => downloadCsv('bills:csv',args);
  api.reports.export = (...args) => downloadCsv('reports:csv',args);
  api.sharing.openWhatsApp = async value => {
    let url;
    try { url = new URL(value); } catch (_) { throw Error('Invalid WhatsApp link.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['wa.me','api.whatsapp.com'].includes(url.hostname)) throw Error('Invalid WhatsApp link.');
    const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    document.body.appendChild(link); link.click(); link.remove(); return {ok:true};
  };
  Object.defineProperty(api,'web',{value:Object.freeze({workspaceId,metadata:() => metadata,authEnded}),enumerable:true});
  window.posApi = Object.freeze(api);
})();
