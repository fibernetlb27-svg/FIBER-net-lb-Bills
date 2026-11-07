'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'receipt-share.js'), 'utf8');
const message = 'FIBER net lb\nFictional Users\nReceipt: FICTIONAL-001\nCustomer: Fictional customer\nTotal: $20.00\nPaid: $5.00\nBalance due: $15.00';
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function harness(options = {}) {
  const calls = {drafts: [], images: [], shares: [], chats: [], downloads: [], created: [], revoked: []};
  const ids = ['whatsapp-dialog', 'whatsapp-phone', 'whatsapp-preview', 'whatsapp-image', 'whatsapp-image-status', 'whatsapp-preview-button', 'whatsapp-open', 'whatsapp-download', 'whatsapp-chat', 'receipt-dialog'];
  const elements = new Map(), windowListeners = new Map(), timers = new Map();
  let time = 100000, timerId = 0, active = false, current = true, objectSequence = 0;
  class Element {
    constructor(id) { this.id = id; this.listeners = new Map(); this.disabled = false; this.hidden = false; this.value = ''; this.textContent = ''; this.open = false; }
    addEventListener(type, listener) { const rows = this.listeners.get(type) || []; rows.push(listener); this.listeners.set(type, rows); }
    emit(type) { for (const listener of this.listeners.get(type) || []) listener({type, target: this}); }
    removeAttribute(name) { delete this[name]; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.emit('close'); } }
    focus() { this.focused = true; }
    click() { if (this.disabled) return; if (this.tagName === 'A') calls.downloads.push({href: this.href, name: this.download}); else this.emit('click'); }
    remove() { this.removed = true; }
  }
  for (const id of ids) elements.set(id, new Element(id));
  const document = {
    getElementById: id => elements.get(id),
    createElement: tag => { const node = new Element(''); node.tagName = tag.toUpperCase(); return node; },
    body: {appendChild() {}}
  };
  const navigator = {};
  if (options.native !== false) {
    navigator.canShare = value => options.canShare ? options.canShare(value) : true;
    navigator.share = value => {
      calls.shares.push({value, activated: active, draftsAtClick: calls.drafts.length, imagesAtClick: calls.images.length});
      return options.share ? options.share(value) : Promise.resolve();
    };
  }
  const window = {
    isSecureContext: options.secure !== false,
    addEventListener(type, listener) { const rows = windowListeners.get(type) || []; rows.push(listener); windowListeners.set(type, rows); },
    ReceiptImage: {create: async value => {
      calls.images.push(value);
      return options.image ? options.image(value) : {blob: new Blob(['fictional PNG bytes'], {type: 'image/png'}), name: 'FIBER-FICTIONAL-001.png'};
    }},
    posApi: {sharing: {openWhatsApp(value) { calls.chats.push(value); return options.chat ? options.chat(value) : Promise.resolve({ok: true}); }}}
  };
  const clock = class extends Date { static now() { return time; } };
  const context = vm.createContext({window, document, navigator, Blob, File, Date: clock, URL: {
    createObjectURL(blob) {
      if (options.urlFailure) throw Error('Fictional object URL failure');
      const url = 'blob:fictional-' + ++objectSequence; calls.created.push({url, blob}); return url;
    },
    revokeObjectURL(value) { calls.revoked.push(value); }
  }, setTimeout(callback, delay) { const id = ++timerId; timers.set(id, {callback, at: time + Number(delay)}); return id; }, clearTimeout(id) { timers.delete(id); }});
  vm.runInContext(source, context, {filename: 'receipt-share.js'});
  const getDraft = async phone => {
    calls.drafts.push(phone);
    return options.draft ? options.draft(phone) : {phone: '96170000000', message};
  };
  return {
    calls, elements, api: window.ReceiptSharing,
    open(overrides = {}) { window.ReceiptSharing.open({number: 'FICTIONAL-001', phone: '03000000', getDraft, isCurrent: () => current, ...overrides}); },
    click(id) { active = true; try { elements.get(id).click(); } finally { active = false; } },
    phone(value) { elements.get('whatsapp-phone').value = value; elements.get('whatsapp-phone').emit('input'); },
    emit(type) { for (const listener of windowListeners.get(type) || []) listener({type}); },
    current(value) { current = value; },
    advance(milliseconds) {
      time += milliseconds;
      for (;;) {
        const row = [...timers].find(([, timer]) => timer.at <= time);
        if (!row) break;
        timers.delete(row[0]); row[1].callback();
      }
    }
  };
}

test('prepared PNG is shared synchronously from the click with no repeated receipt request', async () => {
  const share = deferred(), h = harness({share: () => share.promise});
  h.open(); await settle();
  assert.equal(h.calls.drafts.length, 1); assert.equal(h.calls.images.length, 1);
  assert.equal(h.calls.images[0].message, message);
  assert.equal(h.elements.get('whatsapp-open').disabled, false);
  h.click('whatsapp-open');
  assert.equal(h.calls.shares.length, 1, 'native share is invoked before the click returns');
  const saved = h.calls.shares[0];
  assert.equal(saved.activated, true); assert.equal(saved.draftsAtClick, 1); assert.equal(saved.imagesAtClick, 1);
  assert.equal(saved.value.files.length, 1); assert.ok(saved.value.files[0] instanceof File);
  assert.equal(saved.value.files[0].type, 'image/png'); assert.equal(saved.value.files[0].name, 'FIBER-FICTIONAL-001.png');
  assert.equal(Object.hasOwn(saved.value, 'text'), false); assert.equal(Object.hasOwn(saved.value, 'url'), false);
  assert.equal(h.elements.get('whatsapp-phone').disabled, true);
  h.click('whatsapp-open'); assert.equal(h.calls.shares.length, 1, 'an active sharing dialog cannot be duplicated');
  share.resolve(); await settle();
  assert.match(h.elements.get('whatsapp-image-status').textContent, /sharing menu.*Check WhatsApp/);
  assert.equal(h.elements.get('whatsapp-phone').disabled, false);
  assert.equal(h.calls.chats.length, 0); assert.equal(h.calls.downloads.length, 0);
});

test('unsupported native file sharing leaves explicit PNG download and an attachment-free customer chat', async () => {
  const h = harness({canShare: () => false}); h.open(); await settle();
  assert.equal(h.elements.get('whatsapp-open').disabled, true);
  assert.equal(h.elements.get('whatsapp-download').disabled, false); assert.equal(h.elements.get('whatsapp-chat').disabled, false);
  assert.equal(h.calls.downloads.length, 0); assert.equal(h.calls.chats.length, 0);
  h.click('whatsapp-download'); h.click('whatsapp-chat'); await settle();
  assert.deepEqual(h.calls.downloads, [{href: 'blob:fictional-1', name: 'FIBER-FICTIONAL-001.png'}]);
  assert.deepEqual(h.calls.chats, ['https://wa.me/96170000000']);
  assert.equal(h.calls.shares.length, 0);
  assert.match(h.elements.get('whatsapp-image-status').textContent, /Attach the downloaded receipt image/);
});

test('missing or insecure Web Share support never attempts a native share', async () => {
  for (const options of [{native: false}, {secure: false}, {canShare() { throw Error('Unsupported'); }}]) {
    const h = harness(options); h.open(); await settle(); h.click('whatsapp-open');
    assert.equal(h.elements.get('whatsapp-open').disabled, true);
    assert.equal(h.elements.get('whatsapp-download').disabled, false); assert.equal(h.calls.shares.length, 0);
  }
});

test('canceling or rejecting native sharing does not fall back to sending text or opening chats', async () => {
  for (const name of ['AbortError', 'NotAllowedError']) {
    const error = Object.assign(Error('Fictional denied share'), {name});
    const h = harness({share: () => Promise.reject(error)}); h.open(); await settle(); h.click('whatsapp-open'); await settle();
    assert.equal(h.calls.shares.length, 1); assert.equal(h.calls.drafts.length, 1);
    assert.equal(h.calls.downloads.length, 0); assert.equal(h.calls.chats.length, 0);
    assert.equal(h.elements.get('whatsapp-phone').disabled, false);
    assert.match(h.elements.get('whatsapp-image-status').textContent, name === 'AbortError' ? /canceled/ : /Download it/);
  }
});

test('phone changes, receipt closure and ended sessions revoke the prepared image and disable actions', async () => {
  for (const action of ['phone', 'receipt', 'dialog', 'logout', 'pagehide', 'clear']) {
    const h = harness(); h.open(); await settle();
    if (action === 'phone') h.phone('03000001');
    else if (action === 'receipt') h.elements.get('receipt-dialog').emit('close');
    else if (action === 'dialog') h.elements.get('whatsapp-dialog').close();
    else if (action === 'logout') h.emit('pos-web-auth-ended');
    else if (action === 'pagehide') h.emit('pagehide');
    else h.api.clear();
    assert.deepEqual(h.calls.revoked, ['blob:fictional-1'], action + ' revokes its URL exactly once');
    assert.equal(h.elements.get('whatsapp-image').hidden, true); assert.equal(h.elements.get('whatsapp-image').src, undefined);
    assert.equal(h.elements.get('whatsapp-preview').value, '');
    for (const id of ['whatsapp-open', 'whatsapp-download', 'whatsapp-chat']) assert.equal(h.elements.get(id).disabled, true, action + ' disables ' + id);
    h.click('whatsapp-open'); h.click('whatsapp-download'); h.click('whatsapp-chat');
    assert.equal(h.calls.shares.length + h.calls.chats.length + h.calls.downloads.length, 0);
    if (action !== 'phone') assert.equal(h.elements.get('whatsapp-phone').value, '');
  }
});

test('a changed receipt owner or context blocks ready-image actions even before the view is cleared', async () => {
  const h = harness(); h.open(); await settle(); h.current(false);
  h.click('whatsapp-open'); h.click('whatsapp-download'); h.click('whatsapp-chat');
  assert.equal(h.calls.shares.length + h.calls.chats.length + h.calls.downloads.length, 0);
  for (const id of ['whatsapp-open', 'whatsapp-download', 'whatsapp-chat']) assert.equal(h.elements.get(id).disabled, true);
});

test('late receipt replies and image encodings cannot restore a changed phone or ended session', async () => {
  for (const stage of ['draft', 'image']) {
    const pending = deferred(), options = stage === 'draft' ? {draft: () => pending.promise} : {image: () => pending.promise};
    const h = harness(options); h.open(); await settle();
    if (stage === 'draft') h.phone('03000001'); else h.emit('pos-web-auth-ended');
    pending.resolve(stage === 'draft' ? {phone: '96170000000', message} : {blob: new Blob(['old PNG'], {type: 'image/png'}), name: 'old.png'});
    await settle();
    assert.equal(h.calls.created.length, 0); assert.equal(h.elements.get('whatsapp-preview').value, '');
    assert.equal(h.elements.get('whatsapp-open').disabled, true); assert.equal(h.elements.get('whatsapp-image').hidden, true);
  }
});

test('a new preview supersedes an earlier pending request without mixing receipt data', async () => {
  const pending = deferred(), h = harness({draft: phone => phone === '03000000' ? pending.promise : {phone: '96170000001', message: message.replace('FICTIONAL-001', 'FICTIONAL-002')}});
  h.open(); await settle(); h.phone('03000001'); h.click('whatsapp-preview-button'); await settle();
  pending.resolve({phone: '96170000000', message}); await settle();
  assert.equal(h.calls.created.length, 1); assert.match(h.elements.get('whatsapp-preview').value, /FICTIONAL-002/);
  h.click('whatsapp-chat'); await settle(); assert.deepEqual(h.calls.chats, ['https://wa.me/96170000001']);
});

test('receipt pictures older than two minutes cannot be shared, downloaded or used to open a chat', async () => {
  const h = harness(); h.open(); await settle(); h.advance(120001);
  h.click('whatsapp-open'); h.click('whatsapp-download'); h.click('whatsapp-chat');
  assert.equal(h.calls.shares.length + h.calls.chats.length + h.calls.downloads.length, 0);
  assert.equal(h.elements.get('whatsapp-open').disabled, true); assert.equal(h.elements.get('whatsapp-download').disabled, true);
  assert.equal(h.elements.get('whatsapp-preview-button').disabled, false, 'the same permitted receipt can be freshly prepared');
});

test('failed receipt requests, encodings and invalid outputs cannot enable sharing or downloading', async () => {
  const bad = [
    {draft: () => Promise.reject(Error('Fictional unauthorized receipt'))},
    {draft: () => ({phone: 'bad', message})},
    {image: () => Promise.reject(Error('Fictional PNG encoder failure'))},
    {image: () => ({blob: new Blob(['not png'], {type: 'text/plain'}), name: 'bad.png'})},
    {image: () => ({blob: new Blob([], {type: 'image/png'}), name: 'empty.png'})},
    {image: () => ({blob: new Blob(['png'], {type: 'image/png'}), name: '../private.png'})},
    {urlFailure: true}
  ];
  for (const options of bad) {
    const h = harness(options); h.open(); await settle();
    assert.equal(h.elements.get('whatsapp-open').disabled, true, JSON.stringify(options) + ' cannot share');
    assert.equal(h.elements.get('whatsapp-download').disabled, true, JSON.stringify(options) + ' cannot download');
    assert.equal(h.elements.get('whatsapp-chat').disabled, true); assert.equal(h.elements.get('whatsapp-preview-button').disabled, false);
    assert.equal(h.elements.get('whatsapp-image').hidden, true); assert.equal(h.calls.shares.length + h.calls.chats.length + h.calls.downloads.length, 0);
  }
});

test('a late chat error from an old receipt does not replace the new receipt preview status', async () => {
  const pending = deferred(), h = harness({chat: () => pending.promise}); h.open(); await settle(); h.click('whatsapp-chat');
  h.open({number: 'FICTIONAL-NEW', phone: '03000002'}); await settle();
  const newStatus = h.elements.get('whatsapp-image-status').textContent;
  pending.reject(Error('Old receipt chat failed')); await settle();
  assert.equal(h.elements.get('whatsapp-image-status').textContent, newStatus);
  assert.deepEqual(h.calls.revoked, ['blob:fictional-1']);
});
