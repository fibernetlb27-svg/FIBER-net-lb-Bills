(() => {
  let theme = 'classic';
  try { if (localStorage.getItem('fibernetlb-theme') === 'fibernetlb') theme = 'fibernetlb'; } catch (_) {}
  document.documentElement.dataset.theme = theme;
})();
