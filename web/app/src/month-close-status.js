// The monthly closing schedule is displayed only in the Admin monthly ledger.
window.MonthCloseSchedule = (() => {
  'use strict';
  const identifier = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
  let config, identity = '', epoch = 0, sequence = 0;
  const user = () => config?.getUser?.() ?? config?.user;
  const workspace = () => config?.getWorkspace?.() ?? config?.workspace;
  const identityOf = () => JSON.stringify([workspace()?.id,user()?.accountKey || user()?.account_key,user()?.role,user()?.active,user()?.activity_inspection,user()?.activityInspection,user()?.allowedSections]);
  const allowed = () => workspace()?.id === 'main' && user()?.role === 'admin' && user()?.active !== false && user()?.active !== 0 && !user()?.activity_inspection && !user()?.activityInspection && identifier(user()?.accountKey || user()?.account_key) && typeof config?.api?.autoMonthStatus === 'function';
  function clear() { const note = document.getElementById('automatic-month-status'); if (note) { note.hidden = true; note.textContent = ''; } }
  function reset() { epoch++; sequence++; clear(); config = null; identity = ''; }
  function init(value) { reset(); config = value; identity = identityOf(); }
  async function load() {
    if (!allowed()) { clear(); return; }
    const ledger = document.querySelector('#view-ledger .finance-content'); if (!ledger) return;
    let note = document.getElementById('automatic-month-status');
    if (!note) { note = document.createElement('p'); note.id = 'automatic-month-status'; note.className = 'month-auto-status'; note.setAttribute('role','status'); ledger.prepend(note); }
    const stamp = {epoch,identity}, request = ++sequence;
    const current = () => allowed() && stamp.epoch === epoch && stamp.identity === identity && identityOf() === identity && request === sequence;
    try {
      const value = await config.api.autoMonthStatus();
      if (!current()) return;
      const month = value => value === null || value === '' || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value || '');
      if (!value || value.basis !== 'automatic_month_close' || value.enabled !== true || value.timeZone !== 'Asia/Beirut' || value.hour !== 23 || value.minute !== 59 || value.carryForward !== true || value.automaticBankDeposit !== false || !['ready','running','waiting','completed'].includes(value.state) || !month(value.firstMonth) || !month(value.completedThrough) || !month(value.month)) throw Error('The automatic month-closing schedule could not be verified.');
      const state = value.state === 'waiting' ? 'Waiting for pending accounting operations to be reviewed. It will retry automatically.' : value.state === 'running' ? 'Closing is in progress.' : value.completedThrough ? 'Completed through ' + value.completedThrough + '.' : 'Ready' + (value.firstMonth ? ' from ' + value.firstMonth : '') + '.';
      note.hidden = false; note.classList.toggle('month-auto-waiting',value.state === 'waiting'); note.textContent = 'Automatic closing: 11:59 PM on the last day of every month · Beirut time. ' + state + ' Cash and Whish carry forward; Admin chooses Bank deposits. After closing, new financial entries wait until midnight.';
    } catch (error) {
      if (!current()) return;
      note.hidden = false; note.classList.add('month-auto-waiting'); note.textContent = String(error?.message || error);
    }
  }
  function updateUser(value) { if (!config) return; config.user = value; if (!allowed() || identityOf() !== identity) { epoch++; sequence++; identity = identityOf(); clear(); } }
  return {init,load,reset,updateUser};
})();
