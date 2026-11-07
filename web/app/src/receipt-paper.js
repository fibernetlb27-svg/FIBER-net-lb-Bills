(function () {
  'use strict';
  // Local display/print preference only. It never reads or writes receipt data.
  const key = 'fibernetlb.users-receipt-paper.v1';
  const printerKey = 'fibernetlb.users-receipt-printers.v1';
  const choices = new Set(['auto','a4','a5','thermal-80','thermal-58','xp-235b']);
  const select = document.querySelector('#receipt-paper-size');
  const settings = document.querySelector('#receipt-paper-settings');
  const note = document.querySelector('#receipt-paper-note');
  const printerSelect = document.querySelector('#receipt-printer');
  const printerStatus = document.querySelector('#receipt-printer-status');
  const refreshButton = document.querySelector('#refresh-receipt-printers');
  const printButton = document.querySelector('#print-receipt');
  const receiptDialog = document.querySelector('#receipt-dialog');
  const receiptContent = document.querySelector('#printable-receipt');
  const browser = Boolean(window.posApi?.web);
  // Browser printing belongs to this device, never to the Ubuntu server.
  const releasePrintButton = document.createElement('button');
  releasePrintButton.type = 'button';
  releasePrintButton.className = 'button button-secondary';
  releasePrintButton.textContent = 'Print dialog closed';
  releasePrintButton.hidden = true;
  releasePrintButton.id = 'receipt-print-dialog-closed';
  settings.appendChild(releasePrintButton);
  const pageStyle = document.createElement('style');
  pageStyle.id = 'users-receipt-page-size';
  document.head.appendChild(pageStyle);
  let workspace = '', value = 'auto', mappings = {}, printers = [], loaded = false, loading = false, busy = false, request = 0;
  let browserPrint = null, printGeneration = 0;
  try { const saved = localStorage.getItem(key); if (choices.has(saved)) value = saved; } catch (_) {}
  try { if(!window.posApi?.web){const saved = JSON.parse(localStorage.getItem(printerKey) || '{}'); for (const paper of choices) if (typeof saved?.[paper] === 'string' && saved[paper].length <= 512) mappings[paper] = saved[paper];} } catch (_) {}

  function enabled() { return browser ? Boolean(workspace) : workspace === 'fiber-users'; }
  function currentPrinter() { return browser ? '' : mappings[value] || ''; }
  function missingPrinter() { return Boolean(currentPrinter()) && loaded && !printers.some(printer => printer.name === currentPrinter()); }
  function controls() {
    const active = enabled(), pending = busy || Boolean(browserPrint);
    select.disabled = !active || pending;
    printerSelect.disabled = !active || pending || loading || browser;
    refreshButton.disabled = !active || pending || loading || browser;
    if(browser){printerSelect.closest('label').hidden=true;refreshButton.hidden=true;}
    printButton.disabled = pending || (active && (loading || missingPrinter()));
    releasePrintButton.hidden = !browserPrint;
    releasePrintButton.disabled = busy;
    for (const button of receiptDialog.querySelectorAll('.close-modal')) button.disabled = busy && active;
  }
  function renderPrinters() {
    printerSelect.replaceChildren(new Option('Ask in print dialog / current default',''));
    for (const printer of printers) printerSelect.add(new Option(`${printer.displayName || printer.name}${printer.isDefault ? ' (Windows default)' : ''}`,printer.name));
    const saved = currentPrinter();
    if (saved && !printers.some(printer => printer.name === saved)) printerSelect.add(new Option(`Unavailable saved printer: ${saved}`,saved));
    printerSelect.value = saved;
    if (browserPrint) printerStatus.textContent = 'Print dialog requested on this device. Choose your installed printer and matching paper there. If you already closed the dialog, press “Print dialog closed” before printing again. Check the printer to avoid duplicate copies.';
    else if (browser) printerStatus.textContent = 'Print receipt opens this device’s print dialog. Select your printer under Destination / Printer; it must be installed on this device or available through its print service. The website cannot list printers or confirm a physical print.';
    else if (loading) printerStatus.textContent = 'Loading printers installed on this PC...';
    else if (missingPrinter()) printerStatus.textContent = 'The saved printer is unavailable on this PC. Choose another printer or Ask in print dialog; it will not be replaced automatically.';
    else if (!window.posApi?.printing?.printers) printerStatus.textContent = 'Choose the printer and matching paper in your browser print dialog. The website cannot confirm that a print job completed.';
    else printerStatus.textContent = saved ? `Saved for this paper on this PC: ${saved}. The Windows default printer is unchanged.` : 'Choose a printer for this paper, or ask in the print dialog. This does not change the Windows default.';
    controls();
  }
  async function refreshPrinters() {
    if (browser) { renderPrinters(); return; }
    if (workspace !== 'fiber-users' || loading || busy) return;
    if (!window.posApi?.printing?.printers) { renderPrinters(); return; }
    const version = ++request;
    loading = true; renderPrinters();
    try {
      const rows = await window.posApi.printing.printers();
      if (version !== request || workspace !== 'fiber-users') return;
      if (!Array.isArray(rows)) throw Error('The installed printer list is unavailable.');
      printers = rows.filter(printer => printer && typeof printer.name === 'string' && printer.name.length > 0).map(printer => ({name:printer.name,displayName:typeof printer.displayName === 'string' ? printer.displayName : '',isDefault:printer.isDefault === true}));
      loaded = true; loading = false; renderPrinters();
    } catch (error) {
      if (version !== request || workspace !== 'fiber-users') return;
      loading = false; controls();
      printerStatus.textContent = `Printers could not be loaded: ${error?.message || 'Try refreshing the printer list.'} No printer was substituted.`;
    }
  }

  function apply(workspaceId) {
    if (workspaceId !== workspace) finishBrowserPrint();
    workspace = workspaceId;
    const active = enabled();
    settings.classList.toggle('hidden', !active);
    select.value = value;
    document.body.dataset.receiptPaperScope = active ? 'users' : '';
    document.body.dataset.receiptPaper = active ? value : '';
    receiptContent.dataset.receiptPaperType = active ? value : '';
    if (!active) { pageStyle.textContent = ''; delete receiptContent.dataset.receiptToken; request++; loading = false; controls(); return; }
    const size = value === 'a4' ? 'A4 portrait' : value === 'a5' ? 'A5 portrait' : 'auto';
    const thermal = value.startsWith('thermal-') || value === 'xp-235b';
    const margin = thermal ? '3mm' : '4mm';
    // Auto/thermal never impose a sheet width or roll length on the driver.
    // A named page prevents this preference from changing other print targets.
    pageStyle.textContent = `@page users-receipt { size: ${size}; margin: ${margin}; }`;
    note.textContent = value === 'xp-235b'
      ? 'Xprinter XP-235B: 58 mm continuous receipt roll, 48 mm printable content. Select the matching receipt roll in the printer driver; roll length stays driver-controlled. This is a saved layout, not automatic printer detection.'
      : thermal
      ? `Thermal ${value === 'thermal-80' ? '80' : '58'} mm layout. Select the matching roll width in the printer dialog; the printer controls roll length. Saved on this PC only.`
      : value === 'auto'
        ? 'Uses the paper selected in your printer dialog, including A4, A5 and thermal rolls. Saved on this PC only.'
        : `${value.toUpperCase()} portrait layout. Confirm the matching paper in the printer dialog. Saved on this PC only.`;
    renderPrinters();
    if (!browser && !loaded && !loading && !busy) void refreshPrinters();
  }
  select.addEventListener('change', () => {
    value = choices.has(select.value) ? select.value : 'auto';
    try { localStorage.setItem(key,value); } catch (_) {}
    apply(workspace);
  });
  printerSelect.addEventListener('change', () => {
    mappings[value] = printerSelect.value;
    try { localStorage.setItem(printerKey,JSON.stringify(mappings)); } catch (_) {}
    renderPrinters();
  });
  refreshButton.addEventListener('click', () => { void refreshPrinters(); });
  receiptDialog.addEventListener('cancel', event => { if (busy && enabled()) event.preventDefault(); });
  receiptDialog.addEventListener('close', () => { if (!receiptDialog.open) { delete receiptContent.dataset.receiptToken; finishBrowserPrint(); } });
  function finishBrowserPrint(generation) {
    if (!browserPrint || generation !== undefined && generation !== browserPrint.generation) return;
    window.removeEventListener('afterprint', browserPrint.after);
    browserPrint = null;
    if (document.body.dataset.printTarget === 'receipt') delete document.body.dataset.printTarget;
    controls();
  }
  releasePrintButton.addEventListener('click', () => {
    if (busy || !browserPrint) return;
    finishBrowserPrint();
    printerStatus.textContent = 'Ready to open another print dialog. Check the printer first to avoid duplicate copies. No print was repeated.';
  });
  function printInBrowser() {
    if (!receiptDialog.open || !receiptContent.dataset.receiptToken) throw Error('Open a saved receipt before printing.');
    if (typeof window.print !== 'function') throw Error('Printing is unavailable in this browser. Open the website in your device’s full browser and try again.');
    if (browserPrint) throw Error('Finish or close the current print dialog first. If it is already closed, press “Print dialog closed”.');
    const generation = ++printGeneration;
    const after = () => {
      // A later explicitly opened print request must not be cleared by a queued cleanup.
      finishBrowserPrint(generation);
      if (generation === printGeneration) printerStatus.textContent = 'Print dialog closed. The browser cannot tell whether a copy printed. Check the printer before opening it again.';
    };
    browserPrint = {generation,after};
    window.addEventListener('afterprint', after);
    document.body.dataset.printTarget = 'receipt';
    renderPrinters();
    try { window.print(); }
    catch (error) {
      finishBrowserPrint(generation);
      printerStatus.textContent = 'The print dialog could not be opened. No automatic retry was made.';
      throw error;
    }
    // Some browsers return before their dialog closes. Keep its print layout
    // alive until afterprint, receipt close or the explicit close acknowledgement.
    return {dialogOnly:true};
  }
  async function print() {
    if (browser) return printInBrowser();
    if (workspace !== 'fiber-users') throw Error('Open a Users receipt before choosing its printer.');
    const printerName = currentPrinter();
    if (loading) throw Error('Wait for this PC printer list to finish loading.');
    if (missingPrinter()) throw Error('The saved printer is unavailable. Select another printer explicitly; no fallback was used.');
    if (!window.posApi?.printing?.printReceipt) {
      if (printerName) throw Error('This version cannot use the saved printer. Update this PC, or explicitly choose Ask in print dialog.');
      window.print();
      printerStatus.textContent = 'The print dialog was opened. No automatic retry was made.';
      return {success:true,dialogOnly:true};
    }
    let result;
    try { result = await window.posApi.printing.printReceipt({paperType:value,printerName}); }
    catch (error) { printerStatus.textContent = `Printing could not be completed: ${error?.message || 'Unknown printer error'}. Nothing was retried.`; throw error; }
    const warning = typeof result?.warning === 'string' && result.warning ? ` ${result.warning}` : result?.sessionChanged === true ? ' The session changed after submission. Check the printer before retrying.' : '';
    if (result?.success === true) printerStatus.textContent = 'Print job accepted. No automatic retry was made.';
    else if (result?.canceled === true) printerStatus.textContent = 'Printing was canceled. Nothing was retried.';
    else { printerStatus.textContent = `Printing could not be completed: ${result?.reason || 'The result could not be confirmed'}. Nothing was retried.${warning}`; throw Error(result?.reason || 'The print result could not be confirmed. Nothing was retried.'); }
    printerStatus.textContent += warning;
    return result;
  }
  function setBusy(pending) { busy = Boolean(pending); controls(); }
  function open() { finishBrowserPrint(); receiptContent.dataset.receiptToken = crypto.randomUUID(); }
  window.ReceiptPaper = Object.freeze({apply,print,setBusy,open});
})();
