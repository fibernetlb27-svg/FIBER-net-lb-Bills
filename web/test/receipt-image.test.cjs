const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const generator = require('../app/src/receipt-image.js');
const { whatsappReceipt } = require('../app/receipt-sharing.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'receipt-image.js'), 'utf8');

function harness({ noContext = false, noBlob = false, blobThrows = false } = {}) {
  const drawn = [], canvases = [];
  const context = {
    measureText: text => ({ width: Array.from(text).length * 14 }),
    fillRect: () => {}, fillText: (text, x, y) => drawn.push({ text, x, y }),
  };
  const window = { document: { createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 300, height: 150, getContext: () => noContext ? null : context, toBlob(callback, type) {
      assert.equal(type, 'image/png');
      if (blobThrows) throw Error('encoder failure');
      callback(noBlob ? null : new Blob(['fictional receipt image'], { type }));
    } };
    canvases.push(canvas); return canvas;
  } }, setTimeout, clearTimeout };
  vm.runInNewContext(source, { window, Blob, setTimeout, clearTimeout }, { filename: 'receipt-image.js' });
  return { api: window.ReceiptImage, drawn, canvases };
}

function draft(kind = 'bill', extra = {}) {
  const record = { id: 1, receiptNo: 'F-0001', customerName: 'Fictional Customer', customerAccount: 'fictional.account', paidAt: '2026-11-07T10:30:00Z', serviceType: 'Internet', bundleName: 'Fictional service', amount: 25, paidAmount: 10, remainingAmount: 15, paymentMethod: 'Cash', paymentStatus: 'partial', ...extra };
  return { number: record.invoiceNo ?? record.receiptNo, message: whatsappReceipt(kind, record, '96170000000', 'FIBER net lb Users').message };
}

test('receipt image preserves authoritative partial, unpaid, zero and refund amounts without accounting recalculation', async () => {
  for (const [extra, expected] of [
    [{}, ['Total: $25.00', 'Paid: $10.00', 'Balance due: $15.00']],
    [{ paymentStatus: 'unpaid', paymentMethod: 'Unpaid', paidAmount: 0, remainingAmount: 25 }, ['Paid: $0.00', 'Balance due: $25.00']],
    [{ amount: 0, paidAmount: 0, remainingAmount: 0 }, ['Total: $0.00', 'Paid: $0.00', 'Balance due: $0.00']],
    [{ amount: -7.5, paidAmount: -7.5, remainingAmount: 0, paymentStatus: 'paid' }, ['Refund amount: $7.50', 'Refunded: $7.50', 'Balance due: $0.00']],
  ]) {
    const h = harness(); const image = await h.api.create(draft('bill', extra));
    assert.equal(image.blob.type, 'image/png'); assert.equal(image.name, 'FIBER-F-0001.png');
    const text = h.drawn.map(row => row.text).join('\n');
    for (const value of expected) assert.ok(text.includes(value), value);
    assert.equal(image.width, 1000); assert.ok(image.height >= 600 && image.height <= 12000);
    assert.equal(h.canvases[0].width, 1); assert.equal(h.canvases[0].height, 1);
  }
});

test('POS products and maintenance, free funding and Whish notes render from the prepared message', async () => {
  const examples = [
    draft('sale', { invoiceNo: 'POS-9', subtotal: 45, items: [{ name: 'Router', quantity: 1, lineTotal: 40 }, { name: 'Maintenance', quantity: 1, lineTotal: 5 }] }),
    draft('bill', { amount: 0, paidAmount: 0, remainingAmount: 0, renewal: { state: 'free' }, expenseFunding: { amount: 8, receiptNo: 'FUND-1', paymentMethod: 'Whish Money', whishDestination: { label: 'Fictional wallet', number: '70000000' } } }),
  ];
  for (const example of examples) {
    const h = harness(); await h.api.create(example);
    const text = h.drawn.map(row => row.text).join(' ');
    for (const value of example.message.split('\n').filter(Boolean)) assert.ok(text.includes(value), value);
    assert.equal(text.includes('password'), false);
  }
});

test('Unicode wrapping retains Arabic, emoji and long identifiers without clipping', () => {
  const input = 'صيانة العميل 😀 Router' + 'A'.repeat(90);
  const rows = generator.wrapText(input, 120, text => Array.from(text).length * 10);
  assert.equal(rows.join(' ').replace(/\s+/g, ''), input.replace(/\s+/g, ''));
  assert.ok(rows.every(row => Array.from(row).length <= 12));
  assert.ok(rows.some(row => row.includes('😀')));
  assert.equal(rows.some(row => /[\ud800-\udbff]$/.test(row)), false);
});

test('long saved names, literal markup and Unicode remain text; filename excludes paths', async () => {
  const h = harness(); const input = draft('bill', { customerName: 'صيانة العميل <img src=x onerror=alert(1)> ' + 'LongName'.repeat(30) });
  input.number = '../../F:001?secret';
  const image = await h.api.create(input);
  assert.equal(image.name, 'FIBER-F-001-secret.png');
  const text = h.drawn.map(row => row.text).join(' ');
  assert.ok(text.includes('<img')); assert.ok(text.includes('صيانة'));
  assert.ok(h.drawn.every(row => row.x >= 0 && row.x <= 940 && row.y < image.height));
});

test('invalid or oversized receipt fails visibly instead of truncating or generating an incomplete image', async () => {
  for (const input of [null, {}, { number: '1', message: 'not a receipt' }, { number: '', message: draft().message }, { number: '1', message: 'x'.repeat(20001) }]) assert.throws(() => generator.normalize(input), /receipt/i);
  const h = harness();
  const tooTall = { number: 'LONG', message: ['FIBER net lb', 'Fictional business', 'Receipt: LONG', ...Array.from({ length: 160 }, () => 'Very long product description '.repeat(3))].join('\n') };
  await assert.rejects(h.api.create(tooTall), /too long for one image/);
  assert.equal(h.drawn.length, 0);
  assert.equal(h.canvases[0].width, 1);
});

test('unsupported canvas and encoding failures reject; allocated image buffers are released', async () => {
  for (const options of [{ noContext: true }, { noBlob: true }, { blobThrows: true }]) {
    const h = harness(options);
    await assert.rejects(h.api.create(draft()), /browser|encoded|encoder failure/);
    if (!options.noContext) assert.equal(h.canvases[0].width, 1);
  }
});
