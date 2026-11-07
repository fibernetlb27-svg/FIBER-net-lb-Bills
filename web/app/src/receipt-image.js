(function (host, factory) {
  'use strict';
  const api = factory(host);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.ReceiptImage = Object.freeze({ create: api.create });
})(typeof window === 'object' ? window : globalThis, function (host) {
  'use strict';
  // Only the server-prepared receipt message is rendered. Never capture the DOM:
  // the on-screen Internet receipt can also contain a customer's password.
  const WIDTH = 1000, PADDING = 60, MAX_HEIGHT = 12000, MAX_MESSAGE = 20000;
  const FONT = '"Segoe UI", Arial, sans-serif';
  const colors = Object.freeze({ ink: '#12283e', muted: '#567087', blue: '#165fe2', navy: '#112f46', orange: '#ff8a18', line: '#dce6ef', pale: '#eef5fc', green: '#087d5b' });

  function normalize(input) {
    if (!input || typeof input !== 'object' || typeof input.message !== 'string') throw Error('The saved receipt image could not be prepared. Open its preview again.');
    if (input.message.length > MAX_MESSAGE) throw Error('This receipt is too long for one image. Print or save it as PDF instead.');
    const message = input.message.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
    const lines = message.split('\n');
    if (lines.length < 3 || lines.length > 240 || lines[0] !== 'FIBER net lb' || !/^(Receipt|Refund):\s*\S/.test(lines[2])) throw Error('The saved receipt message is incomplete. Preview it again.');
    const number = String(input.number ?? '').trim();
    if (!number || number.length > 160) throw Error('The saved receipt number is missing or invalid.');
    const safeNumber = number.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'receipt';
    return { lines, name: `FIBER-${safeNumber}.png` };
  }

  function wrapText(text, maxWidth, measure) {
    if (!(maxWidth > 0) || typeof measure !== 'function') throw Error('The receipt image layout is unavailable.');
    const words = String(text).split(/\s+/u).filter(Boolean);
    if (!words.length) return [''];
    const lines = []; let current = '';
    for (const word of words) {
      const joined = current ? `${current} ${word}` : word;
      if (measure(joined) <= maxWidth) { current = joined; continue; }
      if (current) { lines.push(current); current = ''; }
      if (measure(word) <= maxWidth) { current = word; continue; }
      // Split long identifiers by Unicode code point, never half a surrogate.
      for (const character of Array.from(word)) {
        if (measure(character) > maxWidth) throw Error('A receipt character cannot fit in the image. Print or save it as PDF instead.');
        if (current && measure(current + character) > maxWidth) { lines.push(current); current = character; }
        else current += character;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function rowStyle(text, index) {
    if (index === 2) return { size: 35, weight: 700, line: 48, gap: 24, color: colors.ink };
    if (/^(Total|Refund amount|Expense funding received):/.test(text)) return { size: 34, weight: 700, line: 46, gap: 22, color: colors.blue, box: true };
    if (/^(Paid|Refunded|Balance due):/.test(text)) return { size: 29, weight: 700, line: 41, gap: 14, color: /^Balance due:/.test(text) ? colors.ink : colors.green };
    if (/^Thank you for choosing FIBER net lb\.$/.test(text)) return { size: 25, weight: 400, line: 36, gap: 0, color: colors.muted, footer: true };
    return { size: 28, weight: 400, line: 40, gap: 13, color: colors.ink };
  }

  function layout(normalized, context) {
    const rows = []; let y = 166;
    context.font = `600 27px ${FONT}`;
    const businessLines = wrapText(normalized.lines[1], WIDTH - PADDING * 2, text => context.measureText(text).width);
    const headerHeight = 117 + businessLines.length * 37;
    y = headerHeight + 36;
    for (let index = 2; index < normalized.lines.length; index++) {
      const text = normalized.lines[index];
      const style = rowStyle(text, index);
      context.font = `${style.weight} ${style.size}px ${FONT}`;
      const lines = wrapText(text, WIDTH - PADDING * 2 - (style.box ? 40 : 0), value => context.measureText(value).width);
      if (style.footer) y += 22;
      const height = lines.length * style.line + (style.box ? 32 : 0);
      rows.push({ lines, style, y, height });
      y += height + style.gap;
      if (y + PADDING > MAX_HEIGHT) throw Error('This receipt is too long for one image. Print or save it as PDF instead.');
    }
    return { rows, businessLines, headerHeight, height: Math.max(600, Math.ceil(y + PADDING)) };
  }

  function drawText(context, text, left, y, width) {
    // Canvas shapes Arabic text natively. Start Arabic-only rows from the right;
    // mixed English labels/account values retain their existing reading order.
    const rtl = /^[\s\u200e\u200f]*[\u0590-\u08ff]/u.test(text);
    context.direction = rtl ? 'rtl' : 'ltr';
    context.textAlign = rtl ? 'right' : 'left';
    context.fillText(text, rtl ? left + width : left, y);
  }

  function paint(context, plan) {
    context.textBaseline = 'top';
    context.fillStyle = '#fff'; context.fillRect(0, 0, WIDTH, plan.height);
    context.fillStyle = colors.navy; context.fillRect(0, 0, WIDTH, plan.headerHeight);
    context.fillStyle = colors.orange; context.fillRect(0, 0, 12, plan.headerHeight);
    context.font = `700 45px ${FONT}`; context.fillStyle = '#fff';
    drawText(context, 'FIBER net lb', PADDING, 34, WIDTH - PADDING * 2);
    context.font = `600 27px ${FONT}`; context.fillStyle = '#d9e8f6';
    for (let index = 0; index < plan.businessLines.length; index++) drawText(context, plan.businessLines[index], PADDING, 98 + index * 37, WIDTH - PADDING * 2);
    for (const row of plan.rows) {
      const { style } = row;
      if (style.box) {
        context.fillStyle = colors.pale; context.fillRect(PADDING, row.y, WIDTH - PADDING * 2, row.height);
        context.fillStyle = colors.blue; context.fillRect(PADDING, row.y, 5, row.height);
      }
      if (style.footer) { context.fillStyle = colors.line; context.fillRect(PADDING, row.y - 17, WIDTH - PADDING * 2, 2); }
      context.font = `${style.weight} ${style.size}px ${FONT}`; context.fillStyle = style.color;
      const inset = style.box ? 20 : 0;
      for (let index = 0; index < row.lines.length; index++) drawText(context, row.lines[index], PADDING + inset, row.y + (style.box ? 16 : 0) + index * style.line, WIDTH - PADDING * 2 - inset * 2);
    }
  }

  async function create(input) {
    const normalized = normalize(input);
    if (!host.document?.createElement) throw Error('Receipt images are unavailable in this browser.');
    const canvas = host.document.createElement('canvas');
    let context = canvas.getContext?.('2d');
    if (!context || typeof canvas.toBlob !== 'function') throw Error('This browser cannot create receipt images. Use a current browser and try again.');
    try {
      // Text uses installed system fonts; image generation never fetches assets.
      const plan = layout(normalized, context);
      canvas.width = WIDTH; canvas.height = plan.height;
      context = canvas.getContext('2d');
      if (!context) throw Error('The receipt image could not be created.');
      paint(context, plan);
      const blob = await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = host.setTimeout(() => { if (!settled) { settled = true; reject(Error('Receipt image creation timed out. Try again.')); } }, 15000);
        try {
          canvas.toBlob(value => {
            if (settled) return;
            settled = true; host.clearTimeout(timeout);
            if (!value || value.type !== 'image/png' || !value.size) reject(Error('The receipt image could not be encoded. Try again.'));
            else resolve(value);
          }, 'image/png');
        } catch (error) { settled = true; host.clearTimeout(timeout); reject(error); }
      });
      return { blob, name: normalized.name, width: WIDTH, height: plan.height };
    } finally {
      // Release the potentially large backing buffer after the PNG is encoded.
      canvas.width = 1; canvas.height = 1;
    }
  }

  return { create, normalize, wrapText, layout };
});
