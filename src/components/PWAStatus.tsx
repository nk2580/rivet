import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X } from 'lucide-react';
import { Button } from './ui/button';

interface InstallPrompt extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
export function PWAStatus(){
  const [failed,setFailed]=useState(false),[install,setInstall]=useState<InstallPrompt|null>(null);
  const {offlineReady:[ready,setReady],needRefresh:[refresh,setRefresh],updateServiceWorker}=useRegisterSW({onRegisterError:()=>setFailed(true)});
  useEffect(()=>{
    const prompt=(event:Event)=>{event.preventDefault();setInstall(event as InstallPrompt);};
    const installed=()=>setInstall(null);
    window.addEventListener('beforeinstallprompt',prompt);window.addEventListener('appinstalled',installed);
    return()=>{window.removeEventListener('beforeinstallprompt',prompt);window.removeEventListener('appinstalled',installed);};
  },[]);
  if(!ready&&!refresh&&!failed&&!install)return null;
  return <div className="pwa-status" role="status"><span>{refresh?'A new version is ready. Save any open form before updating.':failed?'Offline setup could not finish. Check your connection, then reload Rivet.':ready?'Rivet is ready offline on this device.':'Keep Rivet close. Install it for quick access at your table.'}</span>
    {refresh&&<Button size="sm" variant="outline" onClick={()=>{void updateServiceWorker(true).catch(()=>setFailed(true));}}><RefreshCw size={15}/>Update Rivet</Button>}
    {install&&!refresh&&<Button size="sm" variant="outline" onClick={()=>{void install.prompt().then(()=>install.userChoice).then(()=>setInstall(null)).catch(()=>setInstall(null));}}><Download size={15}/>Install</Button>}
    <Button size="icon" variant="ghost" aria-label="Dismiss offline notice" onClick={()=>{setReady(false);setRefresh(false);setFailed(false);setInstall(null);}}><X size={17}/></Button>
  </div>;
}
