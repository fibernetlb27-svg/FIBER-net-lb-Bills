'use strict';
// Presentation only: all business/permission decisions remain in the existing application.
(() => {
  const shell=document.getElementById('app-shell'),sidebar=shell?.querySelector('.sidebar'),toggle=document.getElementById('website-navigation-toggle'),nav=document.getElementById('website-navigation');
  if(!shell||!sidebar||!toggle||!nav)return;
  const mobile=window.matchMedia('(max-width: 900px)');
  function setOpen(open,focusToggle=false){
    const expanded=Boolean(open&&mobile.matches&&!shell.classList.contains('hidden'));
    sidebar.classList.toggle('website-nav-open',expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.querySelector('span').textContent=expanded?'Close':'Menu';
    if(focusToggle&&mobile.matches)toggle.focus({preventScroll:true});
  }
  toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
  sidebar.addEventListener('click',event=>{
    if(event.target.closest('[data-view],[data-workspace],[data-jump],[data-open-bandwidth]'))setOpen(false,true);
  });
  document.addEventListener('click',event=>{
    if(toggle.getAttribute('aria-expanded')==='true'&&!sidebar.contains(event.target))setOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){
      event.preventDefault();setOpen(false,true);
    }
  });
  const reset=()=>setOpen(false);
  const breakpointChanged=()=>{if(!mobile.matches)reset();};
  if(mobile.addEventListener)mobile.addEventListener('change',breakpointChanged);else mobile.addListener(breakpointChanged);
  new MutationObserver(()=>{if(shell.classList.contains('hidden'))reset();}).observe(shell,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',reset);
  window.addEventListener('pageshow',reset);
  const banner=document.getElementById('website-preview-banner');
  function measureBanner(){
    const visible=Boolean(banner&&!banner.hidden);
    document.body.classList.toggle('website-preview-visible',visible);
    document.documentElement.style.setProperty('--website-preview-offset',(visible?banner.getBoundingClientRect().height:0)+'px');
  }
  if(banner){
    new MutationObserver(measureBanner).observe(banner,{attributes:true,attributeFilter:['hidden']});
    if(window.ResizeObserver)new ResizeObserver(measureBanner).observe(banner);
  }
  window.addEventListener('resize',measureBanner);
  measureBanner();reset();
})();
