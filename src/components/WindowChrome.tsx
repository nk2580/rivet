import { useLayoutEffect } from 'react';

export function WindowChrome(){
  const desktop=window.rivet;
  useLayoutEffect(()=>{
    if(desktop?.platform!=='darwin')return;
    const root=document.documentElement;
    let active=true,eventReceived=false;
    const sidebar=document.getElementById('workspace-sidebar');
    const alignButtons=()=>{
      if(active&&sidebar)void desktop.alignWindowButtons(sidebar.getBoundingClientRect().width).catch(()=>{});
    };
    const apply=(state:{fullScreen:boolean})=>{if(active){root.dataset.windowFullscreen=String(state.fullScreen);alignButtons();}};
    root.dataset.platform='darwin';
    const observer=new ResizeObserver(alignButtons);
    if(sidebar)observer.observe(sidebar,{box:'border-box'});
    window.addEventListener('resize',alignButtons);
    alignButtons();
    const unsubscribe=desktop.onWindowStateChanged(state=>{eventReceived=true;apply(state);});
    void desktop.windowState().then(state=>{if(!eventReceived)apply(state);}).catch(()=>{});
    return()=>{active=false;unsubscribe();observer.disconnect();window.removeEventListener('resize',alignButtons);delete root.dataset.platform;delete root.dataset.windowFullscreen;};
  },[desktop]);
  return desktop?.platform==='darwin'?<div className="window-drag-region" aria-hidden="true"/>:null;
}
