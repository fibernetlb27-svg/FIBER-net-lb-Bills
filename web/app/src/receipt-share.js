/* Local receipt images. Only the server-authorized, credential-free receipt message is rendered. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const dialog = el('whatsapp-dialog'), phone = el('whatsapp-phone'), preview = el('whatsapp-preview');
  const image = el('whatsapp-image'), status = el('whatsapp-image-status');
  const prepareButton = el('whatsapp-preview-button'), shareButton = el('whatsapp-open');
  const downloadButton = el('whatsapp-download'), chatButton = el('whatsapp-chat');
  const MAX_AGE = 2 * 60 * 1000;
  let context = null, prepared = null, objectUrl = '', generation = 0, preparing = false, sharing = false;
  function current() { return Boolean(context && dialog.open && context.isCurrent()); }
  function ready() { return Boolean(current() && prepared && prepared.phoneInput === phone.value && Date.now() - prepared.at <= MAX_AGE); }
  function canShare(file) {
    try { return window.isSecureContext !== false && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({files:[file]}) === true; }
    catch (_) { return false; }
  }
  function controls() {
    const available = ready();
    prepareButton.disabled = preparing || sharing || !current();
    shareButton.disabled = preparing || sharing || !available || !prepared.native;
    downloadButton.disabled = preparing || sharing || !available;
    chatButton.disabled = preparing || sharing || !available;
    phone.disabled = sharing;
  }
  function discard() {
    generation++;
    prepared = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    image.removeAttribute('src'); image.hidden = true;
    preview.value = '';
  }
  function clear() {
    discard(); context = null; preparing = false; sharing = false;
    phone.value = ''; status.textContent = ''; controls();
    if (dialog.open) dialog.close();
  }
  function requireReady() {
    if (!ready()) throw Error('Prepare the receipt image again before sharing or downloading it.');
    return prepared;
  }
  function failure(error) {
    if (!current()) return;
    status.textContent = error?.message || 'The receipt image could not be prepared. Try Preview image again.';
  }
  async function prepare() {
    if (!current() || preparing || sharing) return;
    discard(); preparing = true;
    const ticket = generation, original = context, number = phone.value;
    status.textContent = 'Preparing the saved receipt image…'; controls();
    try {
      const draft = await original.getDraft(number);
      if (ticket !== generation || !current() || context !== original || phone.value !== number) return;
      if (!draft || typeof draft.message !== 'string' || typeof draft.phone !== 'string' || !/^[1-9]\d{6,14}$/.test(draft.phone)) throw Error('The saved receipt could not be verified.');
      const output = await window.ReceiptImage.create({number:original.number,message:draft.message});
      if (ticket !== generation || !current() || context !== original || phone.value !== number) return;
      if (!(output.blob instanceof Blob) || output.blob.type !== 'image/png' || output.blob.size === 0 || output.blob.size > 20 * 1024 * 1024 || typeof output.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,180}\.png$/.test(output.name)) throw Error('The receipt image could not be verified.');
      const file = new File([output.blob],output.name,{type:'image/png'});
      prepared = {file,phone:draft.phone,phoneInput:number,at:Date.now(),native:canShare(file)};
      objectUrl = URL.createObjectURL(output.blob); image.src = objectUrl; image.hidden = false;
      preview.value = draft.message;
      status.textContent = prepared.native
        ? 'Image ready. Share image opens your device’s share menu; choose WhatsApp and the customer. Review and send there.'
        : 'Image ready. Download it, open the customer’s WhatsApp chat, then attach the downloaded picture. This browser cannot attach files through a WhatsApp link.';
    } catch (error) {
      if (ticket === generation) {
        prepared = null;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = ''; image.removeAttribute('src'); image.hidden = true; preview.value = '';
        failure(error);
      }
    }
    finally { if (ticket === generation) { preparing = false; controls(); } }
  }
  function share() {
    let saved;
    try {
      saved = requireReady();
      if (sharing) return;
      if (!saved.native) throw Error('Use Download image, then attach the picture in WhatsApp on this device.');
      sharing = true; controls();
      // Invoke before any await: the browser requires this actual click's user activation.
      const result = navigator.share({files:[saved.file],title:'FIBER net lb receipt'});
      Promise.resolve(result).then(() => {
        if (current() && prepared === saved) status.textContent = 'The image was handed to your device’s sharing menu. Check WhatsApp to confirm it was sent.';
      },error => {
        if (!current() || prepared !== saved) return;
        status.textContent = error?.name === 'AbortError'
          ? 'Sharing was canceled. The receipt was not sent automatically.'
          : 'This device could not share the image. Download it and attach the picture in WhatsApp.';
      }).finally(() => { if (prepared === saved) { sharing = false; controls(); } });
    } catch (error) { sharing = false; failure(error); controls(); }
  }
  function download() {
    try {
      const saved = requireReady(), link = document.createElement('a');
      link.href = objectUrl; link.download = saved.file.name;
      document.body.appendChild(link); link.click(); link.remove();
      status.textContent = 'Image download requested. Open the WhatsApp chat and attach this picture from Downloads.';
    } catch (error) { failure(error); controls(); }
  }
  function chat() {
    try {
      const saved = requireReady();
      // A chat link cannot attach a file. Never replace the requested image with a text receipt.
      Promise.resolve(window.posApi.sharing.openWhatsApp('https://wa.me/' + saved.phone))
        .then(() => { if (current() && prepared === saved) status.textContent = 'WhatsApp chat opened. Attach the downloaded receipt image, review the recipient and press Send.'; })
        .catch(error => { if (current() && prepared === saved) failure(error); });
    } catch (error) { failure(error); controls(); }
  }
  function open(options) {
    clear();
    if (!options || typeof options.getDraft !== 'function' || typeof options.isCurrent !== 'function' || !options.isCurrent()) throw Error('Open a saved receipt first.');
    context = options; phone.value = options.phone || '';
    dialog.showModal(); status.textContent = 'Enter the customer’s number and prepare the receipt image.'; controls();
    phone.focus();
    if (phone.value) void prepare();
  }
  phone.addEventListener('input',() => { discard(); preparing = false; status.textContent = 'Prepare the receipt image for this phone number before sharing.'; controls(); });
  prepareButton.addEventListener('click',() => { void prepare(); });
  shareButton.addEventListener('click',share);
  downloadButton.addEventListener('click',download);
  chatButton.addEventListener('click',chat);
  dialog.addEventListener('close',() => { if (!dialog.open) clear(); });
  el('receipt-dialog').addEventListener('close',clear);
  window.addEventListener('pos-web-auth-ended',clear);
  window.addEventListener('pagehide',clear);
  window.ReceiptSharing = Object.freeze({open,clear});
})();
