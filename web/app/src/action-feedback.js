(function (root, factory) {
  const feedback = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = feedback;
  else root.FiberActionFeedback = feedback;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  let active = null;
  function show(title, detail, options = {}) {
    if (!root.document?.body) return false;
    active?.dismiss();
    const doc = root.document, panel = doc.createElement('div');
    // A body-level popover would be inert while a modal receipt is open.
    const dialogs = doc.querySelectorAll?.('dialog[open]') || [];
    const host = doc.activeElement?.closest?.('dialog[open]') || dialogs[dialogs.length - 1] || doc.body;
    const warning = options.type === 'warning';
    panel.className = 'operation-success' + (warning ? ' operation-warning' : '');
    panel.setAttribute('popover', 'manual');
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-atomic', 'true');
    // The static SVG contains no customer data; all dynamic content uses textContent.
    const mark = doc.createElement('span');
    mark.className = 'operation-success-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = warning ? '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/><path d="M24 13v14M24 34v1"/></svg>' : '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/><path d="m14 24 7 7 13-14"/></svg>';
    const copy = doc.createElement('div'), heading = doc.createElement('strong'), text = doc.createElement('p');
    copy.className = 'operation-success-copy';
    heading.textContent = title; text.textContent = detail;
    copy.append(heading, text);
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'operation-success-close';
    close.setAttribute('aria-label', warning ? 'Dismiss renewal warning' : 'Dismiss success notification'); close.textContent = '×';
    let timer = null;
    const entry = { dismiss() {
      if (timer !== null) root.clearTimeout(timer);
      host.removeEventListener?.('close', entry.dismiss);
      // Never strand keyboard focus when the notification is explicitly dismissed.
      const returnFocus = panel.contains(doc.activeElement) && entry.previousFocus?.isConnected;
      panel.remove(); if (returnFocus) entry.previousFocus.focus();
      if (active === entry) active = null;
    }, previousFocus: doc.activeElement };
    const pause = () => { if (timer !== null) root.clearTimeout(timer); timer = null; };
    const resume = () => { pause(); if (warning) return; timer = root.setTimeout(() => {
      if (panel.contains(doc.activeElement)) return;
      entry.dismiss();
    }, 7000); };
    close.addEventListener('click', entry.dismiss);
    panel.addEventListener('pointerenter', pause); panel.addEventListener('pointerleave', resume);
    panel.addEventListener('focusin', pause); panel.addEventListener('focusout', resume);
    panel.append(mark, copy, close); host.append(panel); active = entry;
    if (host !== doc.body) host.addEventListener('close', entry.dismiss, { once: true });
    // Popover keeps this non-blocking status above the receipt/creation dialog without
    // opening another modal, moving focus, or delaying the next customer.
    if (typeof panel.showPopover === 'function') panel.showPopover();
    resume(); return true;
  }
  function renewed(record) {
    const renewal = record?.renewal;
    if (renewal?.state === 'free') return show('Free service renewed', `${record.customerAccount || 'Customer'} · ${record.bundleDetails || 'Expiry extension confirmed. Expense funding is separate.'}`);
    if (renewal?.state !== 'succeeded') return false;
    const requested = Number(renewal.requestedMonths ?? record.renewalMonths ?? 1);
    const completed = Number(renewal.completedMonths ?? requested);
    if (!Number.isSafeInteger(requested) || requested < 1 || !Number.isSafeInteger(completed) || completed < requested) return false;
    return show('Service renewed successfully', `${record.customerAccount || 'Customer'} · ${requested} month${requested === 1 ? '' : 's'} confirmed${renewal.afterExpiry ? ' · Expiry ' + renewal.afterExpiry : ''}${record.receiptNo ? ' · ' + record.receiptNo : ''}`);
  }
  function created(result) {
    if (result?.state !== 'succeeded' || !result.customer?.username) return false;
    return show('Customer account created', `${result.customer.username} · Account and separate payments saved.${result.customer.expiry ? ' Expiry ' + result.customer.expiry + '.' : ''} Equipment checkout remains separate.`);
  }
  function incomplete(record) {
    const renewal = record?.renewal || {}, requested = Number(renewal.requestedMonths ?? record?.renewalMonths ?? 1), completed = Number(renewal.completedMonths ?? (renewal.state === 'succeeded' ? requested : 0));
    if (renewal.state === 'free' || (renewal.state === 'succeeded' && Number.isSafeInteger(requested) && requested > 0 && Number.isSafeInteger(completed) && completed >= requested)) return false;
    const counts = Number.isSafeInteger(requested) && requested > 0 && Number.isSafeInteger(completed) && completed >= 0 ? `${completed} of ${requested} month${requested === 1 ? '' : 's'} confirmed. ` : '';
    const uncertain = ['unknown', 'checking', 'processing'].includes(renewal.state);
    const title = uncertain ? 'Renewal outcome needs review' : 'Renewal incomplete';
    const detail = `${record?.customerAccount || 'Customer'}${record?.receiptNo ? ' · ' + record.receiptNo : ''} · ${counts}${record?.renewalError || renewal.message || 'Renewal is not fully confirmed.'} ${uncertain ? 'Check the portal and ask an Admin to verify the outcome before retrying.' : 'Open Renewal history before retrying; never repeat confirmed months.'}`;
    return show(title, detail, { type: 'warning' });
  }
  return { show, renewed, created, incomplete, dismiss: () => active?.dismiss() };
});
